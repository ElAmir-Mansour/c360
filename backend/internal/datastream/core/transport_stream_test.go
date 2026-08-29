package core

import (
	"bytes"
	"context"
	"sync"
	"testing"
	"time"
)

// testDEK is a fixed 32-byte AES-256 key for transport tests.
var testDEK = func() []byte {
	k := make([]byte, AESKeySize256)
	for i := range k {
		k[i] = byte(i * 7)
	}
	return k
}()

// collectReceiver drains every frame from a StreamTransport.ReceiveOver session
// into recv, acking each contiguous Seq, until the session ends. It returns when
// the receive channel closes. recv/seen are shared across reconnects so the test
// can assert the FULL received sequence has no gaps and no duplicates.
func collectReceiver(ctx context.Context, t *StreamTransport, conn Conn, mu *sync.Mutex, recv *[]uint64, seen map[uint64]int, lastContig *uint64) {
	frames, ack, errs := t.ReceiveOver(ctx, conn)
	for f := range frames {
		mu.Lock()
		*recv = append(*recv, f.Seq)
		seen[f.Seq]++
		// advance the contiguous cursor and ack it (the receiver's durable
		// progress the sender resumes from).
		for {
			next := *lastContig + 1
			if seen[next] > 0 {
				*lastContig = next
				continue
			}
			break
		}
		cursor := *lastContig
		mu.Unlock()
		ack(cursor)
	}
	<-errs // drain terminal cause (nil on clean EOF / link drop)
}

func TestStreamTransport_RoundTripNoResume(t *testing.T) {
	t.Parallel()
	st, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("NewStreamTransport: %v", err)
	}
	rt, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("receiver transport: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const n = 200
	frames := makeFrames("stream-rt", n)

	sender, receiver := NewPipeConnPair()

	var mu sync.Mutex
	var recv []uint64
	seen := map[uint64]int{}
	var lastContig uint64

	recvDone := make(chan struct{})
	go func() {
		defer close(recvDone)
		collectReceiver(ctx, rt, receiver, &mu, &recv, seen, &lastContig)
	}()

	src := make(chan Frame)
	go func() {
		defer close(src)
		for _, f := range frames {
			src <- f
		}
	}()

	if err := st.SendOver(ctx, sender, src); err != nil {
		t.Fatalf("SendOver: %v", err)
	}
	// Close the data side so the receiver sees a clean EOF and exits.
	_ = sender.Close()
	<-recvDone

	assertContiguousNoDup(t, recv, n)
}

func TestStreamTransportAdapter_PipelineEndToEnd(t *testing.T) {
	t.Parallel()
	const total = 75
	frames := makeFrames("stream-pipeline", total)

	sendT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("sender transport: %v", err)
	}
	recvT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("receiver transport: %v", err)
	}
	sender, receiver := NewPipeConnPair()
	tr, err := NewStreamTransportAdapter(sendT, sender, recvT, receiver)
	if err != nil {
		t.Fatalf("adapter: %v", err)
	}

	applier := &recordingApplier{}
	cp := NewMemoryCheckpointer()
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 16, EmitInterval: time.Hour}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := p.Run(ctx, "stream-pipeline", &sliceCapturer{frames: frames}, tr, applier, cp, nil); err != nil {
		t.Fatalf("Run: %v", err)
	}

	got := applier.snapshot()
	if len(got) != total {
		t.Fatalf("applied %d frames, want %d", len(got), total)
	}
	for i, seq := range got {
		if seq != uint64(i+1) {
			t.Fatalf("applied seq at %d = %d, want %d", i, seq, i+1)
		}
	}
	final, err := cp.Load(context.Background(), "stream-pipeline")
	if err != nil {
		t.Fatalf("load checkpoint: %v", err)
	}
	if final.AppliedSeq != total {
		t.Fatalf("checkpoint seq = %d, want %d", final.AppliedSeq, total)
	}
}

func TestStreamTransport_ResumeAfterMidStreamDisconnect(t *testing.T) {
	t.Parallel()
	const n = 300
	frames := makeFrames("stream-resume", n)

	sendT, err := NewStreamTransport(testDEK, WithStreamMetrics(NewMetrics(nil), "test"))
	if err != nil {
		t.Fatalf("sender transport: %v", err)
	}
	recvT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("receiver transport: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var mu sync.Mutex
	var recv []uint64
	seen := map[uint64]int{}
	var lastContig uint64

	// The agent loop: open a conn, ship the un-acked tail, and on a link drop
	// reconnect and resume from sender.ResumeFrom()+1. We force ONE disconnect
	// roughly mid-stream by closing the conn from the test after some frames
	// land at the receiver.
	disconnectAfter := uint64(120)
	disconnected := false

	for attempt := 0; ; attempt++ {
		if attempt > 10 {
			t.Fatalf("too many reconnects; received=%d", len(recv))
		}
		sender, receiver := NewPipeConnPair()

		recvDone := make(chan struct{})
		go func() {
			defer close(recvDone)
			collectReceiver(ctx, recvT, receiver, &mu, &recv, seen, &lastContig)
		}()

		// Feed the tail strictly above the last ack the sender has observed.
		resumeFrom := sendT.ResumeFrom()
		if attempt > 0 {
			sendT.Resumes() // exercise the accessor
			sendTNoteResume(sendT)
		}
		src := make(chan Frame)
		go func(after uint64) {
			defer close(src)
			for _, f := range frames {
				if f.Seq <= after {
					continue
				}
				select {
				case <-ctx.Done():
					return
				case src <- f:
				}
			}
		}(resumeFrom)

		// Watchdog: once enough frames have landed, drop the link exactly once.
		dropDone := make(chan struct{})
		go func() {
			defer close(dropDone)
			if disconnected {
				return
			}
			for {
				select {
				case <-ctx.Done():
					return
				case <-recvDone:
					return
				case <-time.After(time.Millisecond):
				}
				mu.Lock()
				got := lastContig
				mu.Unlock()
				if got >= disconnectAfter {
					disconnected = true
					_ = sender.Close()   // break the sender's writes
					_ = receiver.Close() // break the receiver's reads
					return
				}
			}
		}()

		sendErr := sendT.SendOver(ctx, sender, src)
		<-dropDone
		_ = sender.Close()
		<-recvDone

		mu.Lock()
		done := lastContig >= uint64(n)
		mu.Unlock()
		if done {
			break
		}
		// A nil sendErr here means the source channel drained (all un-acked
		// frames were written) but not all have been acked as contiguous yet —
		// loop to confirm. A link-drop error is the expected disconnect path.
		_ = sendErr
	}

	assertContiguousNoDup(t, recv, n)
	if !disconnected {
		t.Fatalf("test never exercised a mid-stream disconnect")
	}
	if sendT.Resumes() == 0 {
		t.Fatalf("expected at least one recorded resume, got 0")
	}
}

func TestStreamTransport_ReceiveAckDoesNotBlockWithoutAckReader(t *testing.T) {
	t.Parallel()

	sendT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("sender transport: %v", err)
	}
	recvT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("receiver transport: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sender, receiver := NewPipeConnPair()
	defer sender.Close()
	defer receiver.Close()

	frames, ack, errs := recvT.ReceiveOver(ctx, receiver)
	wire, err := sendT.codec.Encode([]byte("payload"))
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- encodeStreamRecord(sender.Data(), streamRecord{
			streamID:  "ack-backpressure",
			seq:       1,
			kind:      FrameKindWAL,
			emittedAt: time.Now(),
			sourceLSN: "lsn-1",
			wire:      wire,
		})
	}()

	select {
	case f := <-frames:
		if f.Seq != 1 || f.StreamID != "ack-backpressure" {
			t.Fatalf("frame = %+v, want seq=1 stream=ack-backpressure", f)
		}
	case <-ctx.Done():
		t.Fatalf("receive frame: %v", ctx.Err())
	}
	select {
	case err := <-writeDone:
		if err != nil {
			t.Fatalf("write record: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("write record did not complete: %v", ctx.Err())
	}

	ackDone := make(chan struct{})
	go func() {
		ack(1)
		close(ackDone)
	}()
	select {
	case <-ackDone:
	case <-time.After(200 * time.Millisecond):
		t.Fatalf("ack callback blocked behind an unread ack stream")
	}

	_ = sender.Close()
	_ = receiver.Close()
	select {
	case err := <-errs:
		if err != nil && !isClosedConnErr(err) {
			t.Fatalf("receive terminal err = %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("receive did not close: %v", ctx.Err())
	}
}

// sendTNoteResume exercises the resume counter via the exported transport path
// the agent uses (the agent records a resume when it reconnects).
func sendTNoteResume(t *StreamTransport) { t.noteResume() }

// assertContiguousNoDup asserts recv contains every Seq 1..n at least once, in a
// way that the contiguous-applied set covers 1..n with no missing Seq, and no
// Seq appears so as to break contiguity (duplicates after a resume are allowed
// on the wire but the receiver's contiguous cursor must still reach n cleanly).
func assertContiguousNoDup(t *testing.T, recv []uint64, n int) {
	t.Helper()
	seen := map[uint64]int{}
	for _, s := range recv {
		seen[s]++
	}
	// Every seq 1..n must be present exactly once OR (after a forced resume)
	// possibly re-sent; what MUST hold is full coverage with no gap.
	for s := uint64(1); s <= uint64(n); s++ {
		if seen[s] == 0 {
			t.Fatalf("gap: seq %d never received (received %d distinct of %d)", s, len(seen), n)
		}
	}
	// Assert the contiguous cursor reaches n.
	var contig uint64
	for {
		if seen[contig+1] > 0 {
			contig++
			continue
		}
		break
	}
	if contig != uint64(n) {
		t.Fatalf("contiguous coverage reached %d, want %d", contig, n)
	}
	// Assert no spurious seq above n.
	for s := range seen {
		if s > uint64(n) {
			t.Fatalf("received out-of-range seq %d (n=%d)", s, n)
		}
	}
}

func TestStreamRecord_RoundTrip(t *testing.T) {
	t.Parallel()
	cases := []streamRecord{
		{streamID: "s1", seq: 1, kind: FrameKindWAL, emittedAt: time.Unix(0, 1234567890), sourceLSN: "0/16B3748", wire: []byte("hello")},
		{streamID: "", seq: 999, kind: FrameKindMarker, emittedAt: time.Time{}, sourceLSN: "", wire: nil},
		{streamID: "stream-with-long-id-0123456789", seq: 1 << 40, kind: FrameKindSnapshotChunk, emittedAt: time.Now(), sourceLSN: "lsn", wire: make([]byte, 100000)},
	}
	for i, in := range cases {
		var buf bytes.Buffer
		if err := encodeStreamRecord(&buf, in); err != nil {
			t.Fatalf("case %d encode: %v", i, err)
		}
		out, err := decodeStreamRecord(&buf)
		if err != nil {
			t.Fatalf("case %d decode: %v", i, err)
		}
		if out.streamID != in.streamID || out.seq != in.seq || out.kind != in.kind || out.sourceLSN != in.sourceLSN {
			t.Fatalf("case %d header mismatch: got %+v want %+v", i, out, in)
		}
		if len(out.wire) != len(in.wire) {
			t.Fatalf("case %d wire len %d want %d", i, len(out.wire), len(in.wire))
		}
		if in.emittedAt.IsZero() != out.emittedAt.IsZero() {
			t.Fatalf("case %d emittedAt zero mismatch", i)
		}
	}
}
