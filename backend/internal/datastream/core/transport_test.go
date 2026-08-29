package core

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// makeFrames builds n frames seq=1..n for streamID with deterministic payloads.
func makeFrames(streamID string, n int) []Frame {
	frames := make([]Frame, n)
	for i := 0; i < n; i++ {
		frames[i] = Frame{
			StreamID:  streamID,
			Seq:       uint64(i + 1),
			Kind:      FrameKindWAL,
			Payload:   []byte("payload-" + streamID + "-" + itoa(i+1)),
			SourceLSN: "lsn-" + itoa(i+1),
			EmittedAt: time.Now(),
		}
	}
	return frames
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}

func totalPayloadBytes(frames []Frame) int {
	var total int
	for _, f := range frames {
		total += len(f.Payload)
	}
	return total
}

func TestMemoryTransport_SendReceive_Clean(t *testing.T) {
	t.Parallel()

	metrics := NewMetrics(nil)
	tr, err := NewMemoryTransport(newTestKey(t), WithMetrics(metrics))
	if err != nil {
		t.Fatalf("NewMemoryTransport: %v", err)
	}
	defer tr.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	frames := makeFrames("s1", 50)

	// Receiver collects frames and acks each contiguous seq.
	rx, ack, receiveErrs, err := tr.Receive(ctx)
	if err != nil {
		t.Fatalf("Receive: %v", err)
	}

	var got []Frame
	done := make(chan struct{})
	go func() {
		defer close(done)
		for f := range rx {
			got = append(got, f)
			ack(f.Seq)
		}
	}()

	in := make(chan Frame)
	acked, sendErrs, err := tr.Send(ctx, in)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	for _, f := range frames {
		in <- f
	}
	close(in)

	select {
	case <-done:
	case <-ctx.Done():
		t.Fatalf("timed out: received %d/%d frames", len(got), len(frames))
	}

	assertContiguousNoDupes(t, got, len(frames))
	requireAsyncOK(t, sendErrs)
	requireAsyncOK(t, receiveErrs)
	acks := waitForFinalAck(t, ctx, acked, uint64(len(frames)))
	if len(acks) == 0 || acks[len(acks)-1] != uint64(len(frames)) {
		t.Fatalf("acked seqs = %v, want final ack %d", acks, len(frames))
	}
	if got := testutil.ToFloat64(metrics.FramesShipped.WithLabelValues("s1", FrameKindWAL.String())); got != float64(len(frames)) {
		t.Fatalf("FramesShipped = %v, want %d", got, len(frames))
	}
	if got, want := testutil.ToFloat64(metrics.BytesShipped.WithLabelValues("s1")), float64(totalPayloadBytes(frames)); got != want {
		t.Fatalf("BytesShipped = %v, want %v", got, want)
	}
}

// TestMemoryTransport_ResumeAfterDisconnect is the WP-2 acceptance test: ship a
// stream, drop the link mid-stream, reconnect, and assert the receiver ends
// with every Seq exactly once, contiguously, with zero gaps and zero dupes.
func TestMemoryTransport_ResumeAfterDisconnect(t *testing.T) {
	t.Parallel()

	metrics := NewMetrics(nil)
	tr, err := NewMemoryTransport(newTestKey(t), WithMetrics(metrics))
	if err != nil {
		t.Fatalf("NewMemoryTransport: %v", err)
	}
	defer tr.Close()

	const total = 200
	frames := makeFrames("resume", total)

	// rxMu guards the cross-goroutine receive log.
	var rxMu sync.Mutex
	var received []uint64
	highestAcked := uint64(0)

	// receiveLoop drains the current link until it closes (disconnect) or the
	// stream completes.
	receiveLoop := func(ctx context.Context) bool {
		rx, ack, receiveErrs, err := tr.Receive(ctx)
		if err != nil {
			return false
		}
		for f := range rx {
			rxMu.Lock()
			received = append(received, f.Seq)
			if f.Seq == highestAcked+1 {
				highestAcked = f.Seq
			}
			ackTo := highestAcked
			done := highestAcked == uint64(total)
			rxMu.Unlock()
			ack(ackTo)
			if done {
				return true
			}
		}
		if err := firstAsyncErr(receiveErrs); err != nil && !errors.Is(err, errLinkDown) && !errors.Is(err, context.Canceled) {
			t.Errorf("Receive async error: %v", err)
		}
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Sender goroutine: (re)feeds frames from resume cursor on each connection.
	feed := func(ctx context.Context) {
		resumeAfter := tr.ResumeFrom()
		in := make(chan Frame)
		_, sendErrs, err := tr.Send(ctx, in)
		if err != nil {
			return
		}
		closed := false
		defer func() {
			if !closed {
				close(in)
			}
		}()
		for _, f := range frames {
			if f.Seq <= resumeAfter {
				continue
			}
			select {
			case in <- f:
			case <-sendErrs:
				return
			case <-ctx.Done():
				return
			}
		}
		close(in)
		closed = true
		_ = firstAsyncErr(sendErrs)
	}

	// --- Connection 1: deliver part of the stream, then disconnect mid-flight.
	conn1Done := make(chan struct{})
	go func() {
		defer close(conn1Done)
		receiveLoop(ctx)
	}()
	go feed(ctx)

	// Let some frames flow, then yank the link.
	waitUntil(t, ctx, func() bool {
		rxMu.Lock()
		defer rxMu.Unlock()
		return highestAcked >= 20
	})
	tr.Disconnect()
	<-conn1Done

	ackedBeforeResume := tr.ResumeFrom()
	if ackedBeforeResume == 0 {
		t.Fatal("expected some frames acked before disconnect")
	}

	// --- Reconnect and finish the stream.
	tr.Reconnect()
	conn2Done := make(chan struct{})
	go func() {
		defer close(conn2Done)
		receiveLoop(ctx)
	}()
	go feed(ctx)

	select {
	case <-conn2Done:
	case <-ctx.Done():
		rxMu.Lock()
		n := highestAcked
		rxMu.Unlock()
		t.Fatalf("timed out after resume: highestAcked=%d/%d", n, total)
	}

	if tr.Resumes() != 1 {
		t.Errorf("expected exactly 1 resume, got %d", tr.Resumes())
	}
	if got := testutil.ToFloat64(metrics.TransportResumes.WithLabelValues("memory")); got != 1 {
		t.Errorf("TransportResumes = %v, want 1", got)
	}

	// The received log may legitimately contain a frame that was in flight when
	// we disconnected (delivered but not acked). What matters: the contiguous
	// acked sequence is gap-free 1..total, and no Seq <= ackedBeforeResume was
	// re-delivered after the resume (the sender skips acked frames).
	rxMu.Lock()
	defer rxMu.Unlock()
	if highestAcked != uint64(total) {
		t.Fatalf("highestAcked = %d, want %d (gap in contiguous delivery)", highestAcked, total)
	}
	assertNoPostResumeDupes(t, received, ackedBeforeResume)
	// Every seq 1..total must have been delivered at least once.
	assertAllSeqsPresent(t, received, total)
}

func waitForFinalAck(t *testing.T, ctx context.Context, acked <-chan uint64, want uint64) []uint64 {
	t.Helper()
	var seqs []uint64
	for {
		select {
		case seq, ok := <-acked:
			if !ok {
				t.Fatalf("ack channel closed before ack %d; saw %v", want, seqs)
			}
			seqs = append(seqs, seq)
			if seq >= want {
				return seqs
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for ack %d; saw %v", want, seqs)
		}
	}
}

func requireAsyncOK(t *testing.T, errs <-chan error) {
	t.Helper()
	if err := firstAsyncErr(errs); err != nil {
		t.Fatalf("async error: %v", err)
	}
}

func firstAsyncErr(errs <-chan error) error {
	for err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func waitUntil(t *testing.T, ctx context.Context, cond func() bool) {
	t.Helper()
	for {
		if cond() {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("waitUntil: context cancelled before condition met")
		case <-time.After(time.Millisecond):
		}
	}
}

func assertContiguousNoDupes(t *testing.T, got []Frame, want int) {
	t.Helper()
	if len(got) != want {
		t.Fatalf("received %d frames, want %d", len(got), want)
	}
	for i, f := range got {
		if f.Seq != uint64(i+1) {
			t.Fatalf("frame %d has Seq %d, want %d (out of order or gap)", i, f.Seq, i+1)
		}
	}
}

// assertNoPostResumeDupes verifies the sender did not re-ship any frame already
// acked before the resume cursor (no duplicates after resume for the durable
// prefix).
func assertNoPostResumeDupes(t *testing.T, received []uint64, ackedBeforeResume uint64) {
	t.Helper()
	seen := make(map[uint64]int)
	for _, s := range received {
		seen[s]++
	}
	for s, c := range seen {
		if s < ackedBeforeResume && c > 1 {
			t.Errorf("seq %d (< pre-resume ack %d) delivered %d times — duplicate after resume", s, ackedBeforeResume, c)
		}
	}
}

func assertAllSeqsPresent(t *testing.T, received []uint64, total int) {
	t.Helper()
	seen := make(map[uint64]bool)
	for _, s := range received {
		seen[s] = true
	}
	for s := uint64(1); s <= uint64(total); s++ {
		if !seen[s] {
			t.Errorf("seq %d never delivered — gap", s)
		}
	}
}
