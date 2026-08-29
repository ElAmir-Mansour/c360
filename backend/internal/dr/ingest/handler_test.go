package ingest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/model"
)

func TestHandleConnAppliesFramesAndCheckpoints(t *testing.T) {
	t.Parallel()
	dek := testDEK()
	applier := &recordingApplier{}
	checkpointer := &recordingCheckpointer{cp: core.Checkpoint{StreamID: "stream-1"}}
	ledger := &recordingLedger{}
	handler := NewHandler(Dependencies{
		DEKProvider: fixedDEKProvider{dek: dek},
		Appliers:    fixedApplierFactory{applier: applier},
		Checkpoints: fixedCheckpointerFactory{checkpointer: checkpointer},
		Ledger:      ledger,
		Now: func() time.Time {
			return time.Unix(1234, 0).UTC()
		},
	})
	identity := Identity{AgentID: uuid.New(), TenantID: uuid.New()}
	sender, receiver := core.NewPipeConnPair()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sendErr := make(chan error, 1)
	go func() {
		defer sender.Close()
		sendT, err := core.NewStreamTransport(dek)
		if err != nil {
			sendErr <- err
			return
		}
		frames := make(chan core.Frame)
		go func() {
			defer close(frames)
			for i := 1; i <= 3; i++ {
				frames <- core.Frame{
					StreamID:  "stream-1",
					Seq:       uint64(i),
					Kind:      core.FrameKindWAL,
					Payload:   []byte{byte(i)},
					SourceLSN: "lsn",
					EmittedAt: time.Unix(int64(i), 0).UTC(),
				}
			}
		}()
		sendErr <- sendT.SendOver(ctx, sender, frames)
	}()

	result, err := handler.HandleConn(ctx, identity, "stream-1", receiver)
	require.NoError(t, err)
	require.NoError(t, <-sendErr)

	require.Equal(t, 3, result.FramesApplied)
	require.Equal(t, uint64(3), result.AppliedSeq)
	require.Equal(t, []uint64{1, 2, 3}, applier.snapshot())
	cp := checkpointer.snapshot()
	require.Equal(t, "stream-1", cp.StreamID)
	require.Equal(t, uint64(3), cp.AppliedSeq)
	require.Equal(t, time.Unix(1234, 0).UTC(), cp.AppliedAt)
	require.Equal(t, []uint64{1, 2, 3}, ledger.snapshot())
}

func TestHandleConnStopsActiveSessionWhenAuthorizationRevoked(t *testing.T) {
	t.Parallel()
	dek := testDEK()
	applier := &recordingApplier{}
	checkpointer := &recordingCheckpointer{cp: core.Checkpoint{StreamID: "stream-1"}}
	handler := NewHandler(Dependencies{
		DEKProvider: fixedDEKProvider{dek: dek},
		Appliers:    fixedApplierFactory{applier: applier},
		Checkpoints: fixedCheckpointerFactory{checkpointer: checkpointer},
		Authorizer:  &revokingAuthorizer{failAfter: 2},
		Now: func() time.Time {
			return time.Unix(1234, 0).UTC()
		},
	})
	identity := Identity{AgentID: uuid.New(), TenantID: uuid.New()}
	sender, receiver := core.NewPipeConnPair()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sendErr := make(chan error, 1)
	go func() {
		defer sender.Close()
		sendT, err := core.NewStreamTransport(dek)
		if err != nil {
			sendErr <- err
			return
		}
		frames := make(chan core.Frame)
		go func() {
			defer close(frames)
			for i := 1; i <= 3; i++ {
				frames <- core.Frame{
					StreamID:  "stream-1",
					Seq:       uint64(i),
					Kind:      core.FrameKindWAL,
					Payload:   []byte{byte(i)},
					SourceLSN: "lsn",
					EmittedAt: time.Unix(int64(i), 0).UTC(),
				}
			}
		}()
		sendErr <- sendT.SendOver(ctx, sender, frames)
	}()

	result, err := handler.HandleConn(ctx, identity, "stream-1", receiver)
	require.ErrorIs(t, err, ErrUnauthorized)
	require.Equal(t, 1, result.FramesApplied)
	require.Equal(t, uint64(1), result.AppliedSeq)
	require.Equal(t, []uint64{1}, applier.snapshot())
	<-sendErr
}

type fixedDEKProvider struct {
	dek []byte
}

func (f fixedDEKProvider) DEK(context.Context, Identity, string) ([]byte, error) {
	return f.dek, nil
}

type fixedApplierFactory struct {
	applier core.Applier
}

func (f fixedApplierFactory) ApplierFor(context.Context, Identity, string) (core.Applier, error) {
	return f.applier, nil
}

type fixedCheckpointerFactory struct {
	checkpointer core.Checkpointer
}

func (f fixedCheckpointerFactory) CheckpointerFor(context.Context, Identity, string) (core.Checkpointer, error) {
	return f.checkpointer, nil
}

type recordingApplier struct {
	mu   sync.Mutex
	seqs []uint64
}

func (r *recordingApplier) Apply(_ context.Context, f core.Frame) (uint64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seqs = append(r.seqs, f.Seq)
	return f.Seq, nil
}

func (r *recordingApplier) Kind() core.FrameKind { return core.FrameKindWAL }

func (r *recordingApplier) snapshot() []uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]uint64, len(r.seqs))
	copy(out, r.seqs)
	return out
}

type recordingCheckpointer struct {
	mu sync.Mutex
	cp core.Checkpoint
}

func (r *recordingCheckpointer) Save(_ context.Context, cp core.Checkpoint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cp = cp
	return nil
}

func (r *recordingCheckpointer) Load(_ context.Context, streamID string) (core.Checkpoint, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cp.StreamID == "" {
		r.cp.StreamID = streamID
	}
	return r.cp, nil
}

func (r *recordingCheckpointer) snapshot() core.Checkpoint {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cp
}

type recordingLedger struct {
	mu   sync.Mutex
	seqs []uint64
}

func (r *recordingLedger) RecordApply(_ context.Context, _ Identity, cp core.Checkpoint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seqs = append(r.seqs, cp.AppliedSeq)
	return nil
}

func (r *recordingLedger) snapshot() []uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]uint64, len(r.seqs))
	copy(out, r.seqs)
	return out
}

type revokingAuthorizer struct {
	mu        sync.Mutex
	calls     int
	failAfter int
}

func (a *revokingAuthorizer) AuthorizeStream(context.Context, Identity, string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls++
	if a.calls > a.failAfter {
		return model.ErrInvalidState
	}
	return nil
}

func testDEK() []byte {
	k := make([]byte, core.AESKeySize256)
	for i := range k {
		k[i] = byte(i + 1)
	}
	return k
}
