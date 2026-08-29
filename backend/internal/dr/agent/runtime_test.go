package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	dringest "github.com/clario360/platform/internal/dr/ingest"
)

// scriptedCapturer emits WAL frames seq = resumeFrom+1 .. total deterministically.
// It honours resumeFrom (the durable checkpoint) so a resumed session never
// re-emits an already-acked frame — exactly like a real Capturer reading from a
// persisted source cursor. Between emits it optionally pauses on a gate so a test
// can deterministically interrupt the agent mid-stream.
type scriptedCapturer struct {
	streamID string
	total    uint64
	gate     chan struct{} // if non-nil, wait on it before emitting each frame
}

func (c *scriptedCapturer) Kind() core.FrameKind { return core.FrameKindWAL }
func (c *scriptedCapturer) Close() error         { return nil }

func (c *scriptedCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- core.Frame) error {
	for seq := resumeFrom + 1; seq <= c.total; seq++ {
		if c.gate != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.gate:
			}
		}
		f := core.Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      core.FrameKindWAL,
			Payload:   []byte{byte(seq)},
			SourceLSN: "lsn-" + itoa(seq),
			EmittedAt: time.Now().UTC(),
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
		}
	}
	return nil
}

type sourceAckRecord struct {
	lsn        string
	checkpoint Checkpoint
}

type lsnAckingCapturer struct {
	streamID    string
	total       uint64
	checkpoints CheckpointStore

	mu   sync.Mutex
	acks []sourceAckRecord
}

func (c *lsnAckingCapturer) Kind() core.FrameKind { return core.FrameKindWAL }
func (c *lsnAckingCapturer) Close() error         { return nil }

func (c *lsnAckingCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- core.Frame) error {
	for seq := resumeFrom + 1; seq <= c.total; seq++ {
		f := core.Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      core.FrameKindWAL,
			Payload:   []byte{byte(seq)},
			SourceLSN: "lsn-" + itoa(seq),
			EmittedAt: time.Now().UTC(),
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
		}
	}
	return nil
}

func (c *lsnAckingCapturer) AckSourceLSN(_ context.Context, sourceLSN string) error {
	cp, err := c.checkpoints.Load(c.streamID)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.acks = append(c.acks, sourceAckRecord{lsn: sourceLSN, checkpoint: cp})
	return nil
}

func (c *lsnAckingCapturer) snapshotAcks() []sourceAckRecord {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]sourceAckRecord, len(c.acks))
	copy(out, c.acks)
	return out
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// sharedCheckpointerFactory adapts the ingest CheckpointerFactory to a single
// shared MemoryCheckpointer so the control plane's applied cursor SURVIVES the
// agent restart in the test (modelling the durable replication_stream ledger).
type sharedCheckpointerFactory struct{ cp core.Checkpointer }

func (f sharedCheckpointerFactory) CheckpointerFor(context.Context, dringest.Identity, string) (core.Checkpointer, error) {
	return f.cp, nil
}

// newInjectedServer mounts the ingest handler behind a TLS test server that
// injects a fixed authenticated identity (the production mTLS middleware does
// this from the client cert). The runtime's own ShipTransport dials it with
// InsecureSkipVerify so the full HTTP/TLS ship path is exercised end to end.
func newInjectedServer(t *testing.T, handler *dringest.Handler, identity dringest.Identity) *httptest.Server {
	t.Helper()
	inject := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := dringest.WithIdentity(r.Context(), identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	srv := httptest.NewTLSServer(inject(handler.Routes()))
	t.Cleanup(srv.Close)
	return srv
}

// TestRuntime_ResumesFromLocalCheckpointAfterRestart proves the WP-7 resume
// guarantee end to end at the runtime level (no DB needed): the agent ships to a
// real ingest server, is killed mid-stream, and on restart resumes from its
// durable LOCAL checkpoint cache so the control plane applies every frame exactly
// once with no loss and no gaps.
func TestRuntime_ResumesFromLocalCheckpointAfterRestart(t *testing.T) {
	dek := testDEK()
	const streamID = "resume-stream"
	const total = 10

	// Control-plane side: a real ingest handler whose applier records every
	// applied Seq and whose checkpointer is durable across the simulated restart.
	applier := &recordingApplier{}
	cp := core.NewMemoryCheckpointer()
	identity := dringest.Identity{AgentID: uuid.New(), TenantID: uuid.New()}
	handler := dringest.NewHandler(dringest.Dependencies{
		DEKProvider: fixedDEKProvider{dek: dek},
		Appliers:    fixedApplierFactory{a: applier},
		Checkpoints: sharedCheckpointerFactory{cp: cp},
		Now:         time.Now,
	})
	srv := newInjectedServer(t, handler, identity)

	// Agent side: a durable on-disk checkpoint cache shared across both runs.
	cacheDir := t.TempDir()
	checkpoints, err := NewFileCheckpointStore(cacheDir)
	if err != nil {
		t.Fatalf("checkpoint store: %v", err)
	}

	identityForAgent := &Identity{} // unused fields; InsecureSkipVerify path
	gate := make(chan struct{})

	// --- Run 1: ship the first few frames, then kill the agent mid-stream. ---
	run1Ctx, cancel1 := context.WithCancel(context.Background())
	factory1 := func(_ context.Context, spec SourceSpec, c Checkpoint) (core.Capturer, error) {
		return &scriptedCapturer{streamID: spec.StreamID, total: total, gate: gate}, nil
	}
	rt1 := newTestRuntime(t, srv.URL, identityForAgent, dek, streamID, checkpoints, factory1)

	run1Done := make(chan error, 1)
	go func() { run1Done <- rt1.Run(run1Ctx) }()

	// Let exactly 4 frames flow and be acked, then cut the link.
	for i := 0; i < 4; i++ {
		gate <- struct{}{}
	}
	waitForCheckpoint(t, checkpoints, streamID, 4)
	waitForRuntimeStatus(t, rt1, streamID, func(st StreamRuntimeStatus) bool {
		return st.Phase == StreamPhaseShipping &&
			st.Running &&
			st.LastFrameSeq >= 4 &&
			st.LastAckSeq >= 4 &&
			!st.LastAckAt.IsZero()
	})
	cancel1()
	<-run1Done

	// The local checkpoint must have advanced to (at least) 4.
	cpAfter1, _ := checkpoints.Load(streamID)
	if cpAfter1.AckedSeq < 4 {
		t.Fatalf("local checkpoint after run1 = %d, want >= 4", cpAfter1.AckedSeq)
	}

	// --- Run 2: restart the agent; it must resume from the local checkpoint. ---
	gate2 := make(chan struct{})
	run2Ctx, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	var resumedFrom uint64
	var resumedOnce sync.Once
	factory2 := func(_ context.Context, spec SourceSpec, c Checkpoint) (core.Capturer, error) {
		resumedOnce.Do(func() { resumedFrom = c.AckedSeq })
		return &scriptedCapturer{streamID: spec.StreamID, total: total, gate: gate2}, nil
	}
	rt2 := newTestRuntime(t, srv.URL, identityForAgent, dek, streamID, checkpoints, factory2)

	run2Done := make(chan error, 1)
	go func() { run2Done <- rt2.Run(run2Ctx) }()

	// Release the remaining frames until the durable local checkpoint reaches
	// the end of the stream.
	for {
		cp, err := checkpoints.Load(streamID)
		if err != nil {
			t.Fatalf("load checkpoint: %v", err)
		}
		if cp.AckedSeq >= total {
			break
		}
		select {
		case gate2 <- struct{}{}:
		case <-time.After(500 * time.Millisecond):
			// Poll again: the scripted capturer may have already drained.
		}
	}
	waitForCheckpoint(t, checkpoints, streamID, total)
	cancel2()
	<-run2Done

	// The restart resumed from the persisted checkpoint, not from scratch.
	if resumedFrom < 4 {
		t.Fatalf("run2 resumed from %d, want >= 4 (must use the local checkpoint)", resumedFrom)
	}

	// The control plane applied every Seq 1..total exactly once: no loss, no gaps,
	// no duplicates.
	applied := applier.snapshot()
	seen := map[uint64]int{}
	for _, s := range applied {
		seen[s]++
	}
	for seq := uint64(1); seq <= total; seq++ {
		if seen[seq] != 1 {
			t.Fatalf("seq %d applied %d times, want exactly 1 (applied set: %v)", seq, seen[seq], applied)
		}
	}
	final, _ := cp.Load(context.Background(), streamID)
	if final.AppliedSeq != total {
		t.Fatalf("control-plane checkpoint = %d, want %d", final.AppliedSeq, total)
	}
}

func TestRuntime_AcksSourceLSNAfterDurableCheckpoint(t *testing.T) {
	dek := testDEK()
	const streamID = "source-lsn-stream"
	const total = 3

	applier := &recordingApplier{}
	controlPlaneCP := core.NewMemoryCheckpointer()
	identity := dringest.Identity{AgentID: uuid.New(), TenantID: uuid.New()}
	handler := dringest.NewHandler(dringest.Dependencies{
		DEKProvider: fixedDEKProvider{dek: dek},
		Appliers:    fixedApplierFactory{a: applier},
		Checkpoints: sharedCheckpointerFactory{cp: controlPlaneCP},
		Now:         time.Now,
	})
	srv := newInjectedServer(t, handler, identity)

	checkpoints := NewMemoryCheckpointStore()
	capturer := &lsnAckingCapturer{
		streamID:    streamID,
		total:       total,
		checkpoints: checkpoints,
	}
	factory := func(_ context.Context, _ SourceSpec, _ Checkpoint) (core.Capturer, error) {
		return capturer, nil
	}
	rt := newTestRuntime(t, srv.URL, &Identity{}, dek, streamID, checkpoints, factory)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := rt.Run(ctx); err != nil {
		t.Fatalf("Run: %v", err)
	}

	localCP, err := checkpoints.Load(streamID)
	if err != nil {
		t.Fatalf("load local checkpoint: %v", err)
	}
	if localCP.AckedSeq != total || localCP.SourceLSN != "lsn-3" {
		t.Fatalf("local checkpoint = %+v, want seq %d source_lsn lsn-3", localCP, total)
	}

	acks := capturer.snapshotAcks()
	if len(acks) == 0 {
		t.Fatal("source LSN was never acknowledged")
	}
	last := acks[len(acks)-1]
	if last.lsn != "lsn-3" {
		t.Fatalf("last source ack = %q, want lsn-3 (all acks: %+v)", last.lsn, acks)
	}
	if last.checkpoint.AckedSeq != total || last.checkpoint.SourceLSN != "lsn-3" {
		t.Fatalf("source ack observed checkpoint %+v, want durable seq %d source_lsn lsn-3", last.checkpoint, total)
	}
	for _, ack := range acks {
		if ack.checkpoint.SourceLSN != ack.lsn {
			t.Fatalf("source ack %q happened before matching local checkpoint was durable: %+v", ack.lsn, ack.checkpoint)
		}
	}
}

func newTestRuntime(t *testing.T, ingestURL string, id *Identity, dek []byte, streamID string, cps CheckpointStore, factory CapturerFactory) *Runtime {
	t.Helper()
	rt, err := NewRuntime(Config{
		IngestURL:   ingestURL,
		Identity:    id,
		Checkpoints: cps,
		Sources: []SourceSpec{{
			StreamID: streamID,
			Kind:     SourceFile, // kind is irrelevant: the injected factory builds the capturer
			Path:     t.TempDir(),
			DEK:      dek,
		}},
		CapturerFactory:    factory,
		ReconnectBackoff:   10 * time.Millisecond,
		InsecureSkipVerify: true,
		Logger:             zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewRuntime: %v", err)
	}
	// Use the plain-HTTP test client transport so the runtime's per-stream
	// ShipTransport reaches the httptest server (TLS handshake is exercised in the
	// integration test).
	return rt
}

func waitForCheckpoint(t *testing.T, cps CheckpointStore, streamID string, want uint64) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		cp, err := cps.Load(streamID)
		if err != nil {
			t.Fatalf("load checkpoint: %v", err)
		}
		if cp.AckedSeq >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	cp, _ := cps.Load(streamID)
	t.Fatalf("checkpoint did not reach %d in time (got %d)", want, cp.AckedSeq)
}

func waitForRuntimeStatus(t *testing.T, rt *Runtime, streamID string, match func(StreamRuntimeStatus) bool) StreamRuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, st := range rt.Status().Streams {
			if st.StreamID == streamID && match(st) {
				return st
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	var last StreamRuntimeStatus
	for _, st := range rt.Status().Streams {
		if st.StreamID == streamID {
			last = st
			break
		}
	}
	t.Fatalf("runtime status for %s did not match before deadline: %+v", streamID, last)
	return StreamRuntimeStatus{}
}
