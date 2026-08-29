package core

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// recordingApplier records every Seq it is asked to apply, in order, so a test
// can assert each Seq is applied exactly once and contiguously.
type recordingApplier struct {
	mu      sync.Mutex
	applied []uint64
}

func (r *recordingApplier) Apply(_ context.Context, f Frame) (uint64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.applied = append(r.applied, f.Seq)
	return f.Seq, nil
}

func (r *recordingApplier) Kind() FrameKind { return FrameKindWAL }

func (r *recordingApplier) snapshot() []uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]uint64, len(r.applied))
	copy(out, r.applied)
	return out
}

// scriptedCapturer is a no-op Capturer: the test injects frames via the
// scriptedTransport instead, so the capturer returns immediately.
type scriptedCapturer struct{}

func (scriptedCapturer) Start(context.Context, uint64, chan<- Frame) error { return nil }
func (scriptedCapturer) Kind() FrameKind                                   { return FrameKindWAL }
func (scriptedCapturer) Close() error                                      { return nil }

type ackingScriptedCapturer struct {
	mu   sync.Mutex
	acks []string
}

func (a *ackingScriptedCapturer) Start(context.Context, uint64, chan<- Frame) error {
	return nil
}

func (a *ackingScriptedCapturer) Kind() FrameKind { return FrameKindWAL }

func (a *ackingScriptedCapturer) Close() error { return nil }

func (a *ackingScriptedCapturer) AckSourceLSN(_ context.Context, sourceLSN string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.acks = append(a.acks, sourceLSN)
	return nil
}

func (a *ackingScriptedCapturer) snapshotAcks() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]string, len(a.acks))
	copy(out, a.acks)
	return out
}

// scriptedTransport feeds a fixed sequence of frames into Receive, ignoring
// Send. It lets a test deliver frames out of order and with duplicates to
// exercise the pipeline's reorder buffer and de-dup logic. After the script is
// exhausted it closes the frame channel, signalling end-of-stream.
type scriptedTransport struct {
	script []Frame
	acks   []uint64
	mu     sync.Mutex
}

func (s *scriptedTransport) Send(_ context.Context, frames <-chan Frame) (<-chan uint64, <-chan error, error) {
	acked := make(chan uint64)
	errs := make(chan error)
	go func() {
		defer close(acked)
		defer close(errs)
		for range frames { // drain so the capturer side never blocks
		}
	}()
	return acked, errs, nil
}

func (s *scriptedTransport) Receive(ctx context.Context) (<-chan Frame, func(uint64), <-chan error, error) {
	out := make(chan Frame)
	errs := make(chan error, 1)
	go func() {
		defer close(out)
		defer close(errs)
		for _, f := range s.script {
			select {
			case <-ctx.Done():
				errs <- ctx.Err()
				return
			case out <- f:
			}
		}
	}()
	ack := func(seq uint64) {
		s.mu.Lock()
		s.acks = append(s.acks, seq)
		s.mu.Unlock()
	}
	return out, ack, errs, nil
}

func (s *scriptedTransport) maxAck() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var m uint64
	for _, a := range s.acks {
		if a > m {
			m = a
		}
	}
	return m
}

// TestPipeline_OutOfOrderAndDuplicates is the §3.2 acceptance criterion: inject
// out-of-order and duplicate frames; the Applier must receive each Seq exactly
// once in contiguous order, and the checkpoint must never skip a gap.
func TestPipeline_OutOfOrderAndDuplicates(t *testing.T) {
	t.Parallel()

	frame := func(seq uint64) Frame {
		return Frame{
			StreamID:  "stream-x",
			Seq:       seq,
			Kind:      FrameKindWAL,
			Payload:   []byte{byte(seq)},
			SourceLSN: "lsn-" + itoa(int(seq)),
			EmittedAt: time.Now().Add(-time.Second),
		}
	}
	// Shuffled delivery with duplicates; the contiguous in-order set is 1..8.
	script := []Frame{
		frame(3), // ahead — buffered, gap holds checkpoint at 0
		frame(1), // front advances to 1
		frame(2), // front advances to 2, then 3 from buffer -> 3
		frame(2), // duplicate of already-applied -> no-op
		frame(5), // ahead — buffered
		frame(4), // front advances to 4, then 5 -> 5
		frame(5), // duplicate -> no-op
		frame(7), // ahead — buffered
		frame(6), // front advances to 6, then 7 -> 7
		frame(8), // front advances to 8
		frame(3), // stale duplicate -> no-op
	}

	applier := &recordingApplier{}
	tr := &scriptedTransport{script: script}
	cp := NewMemoryCheckpointer()
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 1, EmitInterval: time.Hour}, NewMetrics(nil))

	emit := func(Progress) {}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	runDone := make(chan error, 1)
	go func() {
		runDone <- p.Run(ctx, "stream-x", scriptedCapturer{}, tr, applier, cp, emit)
	}()

	if err := <-runDone; err != nil {
		t.Fatalf("Run: %v", err)
	}

	// 1. Applier saw each Seq exactly once, in strict contiguous order 1..8.
	got := applier.snapshot()
	want := []uint64{1, 2, 3, 4, 5, 6, 7, 8}
	if len(got) != len(want) {
		t.Fatalf("applier applied %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("apply order = %v, want %v (out of order or duplicate applied)", got, want)
		}
	}

	// 2. The checkpoint advanced to 8 and the transport ack reached 8.
	final, err := cp.Load(context.Background(), "stream-x")
	if err != nil {
		t.Fatal(err)
	}
	if final.AppliedSeq != 8 {
		t.Fatalf("final checkpoint AppliedSeq = %d, want 8", final.AppliedSeq)
	}
	if final.SourceLSN != "lsn-8" {
		t.Errorf("final checkpoint SourceLSN = %q, want lsn-8", final.SourceLSN)
	}
	if tr.maxAck() != 8 {
		t.Errorf("max transport ack = %d, want 8", tr.maxAck())
	}
}

// TestPipeline_GapHoldsCheckpoint verifies a missing Seq stalls the checkpoint:
// frames {1,2,4,5} (missing 3) apply only 1,2 and the checkpoint stays at 2 —
// never skipping the gap. The stream closes with a gap -> ErrNonContiguousStream.
func TestPipeline_GapHoldsCheckpoint(t *testing.T) {
	t.Parallel()

	mk := func(seq uint64) Frame {
		return Frame{StreamID: "g", Seq: seq, Kind: FrameKindWAL, Payload: []byte{byte(seq)}, SourceLSN: "l" + itoa(int(seq)), EmittedAt: time.Now()}
	}
	tr := &scriptedTransportClosing{script: []Frame{mk(1), mk(2), mk(4), mk(5)}} // 3 is missing
	applier := &recordingApplier{}
	cp := NewMemoryCheckpointer()
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 1, EmitInterval: time.Hour}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := p.Run(ctx, "g", scriptedCapturer{}, tr, applier, cp, nil)
	if !errors.Is(err, ErrNonContiguousStream) {
		t.Fatalf("Run error = %v, want ErrNonContiguousStream", err)
	}

	got := applier.snapshot()
	if len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("expected only seqs [1 2] applied (gap at 3), got %v", got)
	}
	final, _ := cp.Load(context.Background(), "g")
	if final.AppliedSeq != 2 {
		t.Fatalf("checkpoint AppliedSeq = %d, want 2 (gap at 3 must hold it)", final.AppliedSeq)
	}
}

// TestPipeline_ResumeFromCheckpoint verifies the pipeline ignores frames at or
// below an existing checkpoint (idempotent resume) and never re-applies them.
func TestPipeline_ResumeFromCheckpoint(t *testing.T) {
	t.Parallel()

	mk := func(seq uint64) Frame {
		return Frame{StreamID: "r", Seq: seq, Kind: FrameKindWAL, Payload: []byte{byte(seq)}, SourceLSN: "l" + itoa(int(seq)), EmittedAt: time.Now()}
	}
	// Pre-seed a checkpoint at Seq 3; the transport replays 1..5 then closes.
	cp := NewMemoryCheckpointer()
	_ = cp.Save(context.Background(), Checkpoint{StreamID: "r", AppliedSeq: 3, SourceLSN: "l3", AppliedAt: time.Now()})

	tr := &scriptedTransportClosing{script: []Frame{mk(1), mk(2), mk(3), mk(4), mk(5)}}
	applier := &recordingApplier{}
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 1, EmitInterval: time.Hour}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := p.Run(ctx, "r", scriptedCapturer{}, tr, applier, cp, nil); err != nil {
		t.Fatalf("Run: %v", err)
	}

	got := applier.snapshot()
	want := []uint64{4, 5} // only 4,5; 1,2,3 are at/below the checkpoint.
	if len(got) != len(want) || got[0] != 4 || got[1] != 5 {
		t.Fatalf("resume replay applied %v, want %v (must skip <= checkpoint)", got, want)
	}
}

func TestPipeline_AcksSourceLSNAfterCheckpoint(t *testing.T) {
	t.Parallel()

	mk := func(seq uint64, lsn string) Frame {
		return Frame{StreamID: "ack", Seq: seq, Kind: FrameKindWAL, Payload: []byte{byte(seq)}, SourceLSN: lsn, EmittedAt: time.Now()}
	}
	cap := &ackingScriptedCapturer{}
	tr := &scriptedTransportClosing{script: []Frame{mk(1, "0/10"), mk(2, "0/20")}}
	applier := &recordingApplier{}
	cp := NewMemoryCheckpointer()
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 1, EmitInterval: time.Hour}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := p.Run(ctx, "ack", cap, tr, applier, cp, nil); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := cap.snapshotAcks(); len(got) != 2 || got[0] != "0/10" || got[1] != "0/20" {
		t.Fatalf("source LSN acks = %v, want [0/10 0/20]", got)
	}
	final, err := cp.Load(context.Background(), "ack")
	if err != nil {
		t.Fatal(err)
	}
	if final.AppliedSeq != 2 || final.SourceLSN != "0/20" {
		t.Fatalf("checkpoint = %#v, want seq=2 sourceLSN=0/20", final)
	}
}

// TestPipeline_EndToEndThroughMemoryTransport wires a real Capturer-style feed
// through the MemoryTransport (compress+encrypt) into the pipeline, asserting
// the full stage chain applies every frame contiguously and checkpoints.
func TestPipeline_EndToEndThroughMemoryTransport(t *testing.T) {
	t.Parallel()

	const total = 100
	frames := makeFrames("e2e", total)
	tr, err := NewMemoryTransport(newTestKey(t))
	if err != nil {
		t.Fatal(err)
	}
	defer tr.Close()

	applier := &recordingApplier{}
	cp := NewMemoryCheckpointer()
	p := NewPipeline(PipelineConfig{EmitEveryFrames: 10, EmitInterval: time.Hour}, NewMetrics(nil))

	cap := &sliceCapturer{frames: frames}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	runDone := make(chan error, 1)
	go func() { runDone <- p.Run(ctx, "e2e", cap, tr, applier, cp, func(Progress) {}) }()

	if err := <-runDone; err != nil {
		t.Fatalf("Run: %v", err)
	}

	got := applier.snapshot()
	if len(got) != total {
		t.Fatalf("applied %d frames, want %d", len(got), total)
	}
	for i, s := range got {
		if s != uint64(i+1) {
			t.Fatalf("apply position %d = seq %d, want %d", i, s, i+1)
		}
	}
}

// scriptedTransportClosing is like scriptedTransport but closes the frame
// channel after the script, so the pipeline observes end-of-stream and returns.
type scriptedTransportClosing struct {
	script []Frame
	acks   []uint64
	mu     sync.Mutex
}

func (s *scriptedTransportClosing) Send(_ context.Context, frames <-chan Frame) (<-chan uint64, <-chan error, error) {
	acked := make(chan uint64)
	errs := make(chan error)
	go func() {
		defer close(acked)
		defer close(errs)
		for range frames {
		}
	}()
	return acked, errs, nil
}

func (s *scriptedTransportClosing) Receive(ctx context.Context) (<-chan Frame, func(uint64), <-chan error, error) {
	out := make(chan Frame)
	errs := make(chan error, 1)
	go func() {
		defer close(out)
		defer close(errs)
		for _, f := range s.script {
			select {
			case <-ctx.Done():
				errs <- ctx.Err()
				return
			case out <- f:
			}
		}
	}()
	ack := func(seq uint64) {
		s.mu.Lock()
		s.acks = append(s.acks, seq)
		s.mu.Unlock()
	}
	return out, ack, errs, nil
}

// sliceCapturer emits a fixed slice of frames (seq > resumeFrom) then blocks.
type sliceCapturer struct {
	frames []Frame
}

func (c *sliceCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error {
	for _, f := range c.frames {
		if f.Seq <= resumeFrom {
			continue
		}
		select {
		case <-ctx.Done():
			return nil
		case out <- f:
		}
	}
	return nil
}
func (c *sliceCapturer) Kind() FrameKind { return FrameKindWAL }
func (c *sliceCapturer) Close() error    { return nil }
