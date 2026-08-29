package instant

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestService_FullLifecycle_HydrateReadyFinalize(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 12
	base := newSequentialBase(total, 32)
	store := newMemStore()
	sink := newMemSink("worm://dr-recovery-points/finalized/session-copy")
	svc := newTestService(t, store, base, sink, 0)
	tenantID := uuid.New()
	pointID := uuid.New()

	// Start: session is created HYDRATING, sized to the base.
	sess, err := svc.StartSession(ctx, tenantID, pointID, nil)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	if sess.State != StateHydrating {
		t.Fatalf("started state = %q, want %q", sess.State, StateHydrating)
	}
	if sess.ChunksTotal != total {
		t.Fatalf("ChunksTotal = %d, want %d", sess.ChunksTotal, total)
	}

	// The workload writes chunk 7 immediately (instant): redirect-on-write.
	wrote := []byte("WORKLOAD-WRITE-7")
	if err := svc.WriteChunk(ctx, tenantID, sess.ID, 7, wrote); err != nil {
		t.Fatalf("WriteChunk(7): %v", err)
	}

	// Finalize before READY is rejected (illegal transition).
	if _, err := svc.BeginFinalize(ctx, tenantID, sess.ID); !errors.Is(err, ErrNotReady) {
		t.Fatalf("BeginFinalize before READY err = %v, want ErrNotReady", err)
	}

	// Drive hydration to completion via the loop.
	loop := newTestLoop(t, svc, store)
	if err := loop.Tick(ctx); err != nil {
		t.Fatalf("loop.Tick (hydrate): %v", err)
	}

	prog, err := svc.GetProgress(ctx, tenantID, sess.ID)
	if err != nil {
		t.Fatalf("GetProgress: %v", err)
	}
	if prog.Session.State != StateReady {
		t.Fatalf("after hydration state = %q, want READY", prog.Session.State)
	}
	if prog.PercentComplete != 100 {
		t.Fatalf("PercentComplete = %v, want 100", prog.PercentComplete)
	}
	// chunks_hydrated counts the 11 genuine base copies (index 7 was a write).
	if prog.Session.ChunksHydrated != total-1 {
		t.Fatalf("ChunksHydrated = %d, want %d (one index was written, not hydrated)", prog.Session.ChunksHydrated, total-1)
	}

	// Begin finalize: READY -> FINALIZING.
	fin, err := svc.BeginFinalize(ctx, tenantID, sess.ID)
	if err != nil {
		t.Fatalf("BeginFinalize: %v", err)
	}
	if fin.State != StateFinalizing {
		t.Fatalf("after BeginFinalize state = %q, want FINALIZING", fin.State)
	}

	// The loop completes the standalone copy: FINALIZING -> FINALIZED.
	if err := loop.Tick(ctx); err != nil {
		t.Fatalf("loop.Tick (finalize): %v", err)
	}
	got, err := svc.GetProgress(ctx, tenantID, sess.ID)
	if err != nil {
		t.Fatalf("GetProgress after finalize: %v", err)
	}
	if got.Session.State != StateFinalized {
		t.Fatalf("final state = %q, want FINALIZED", got.Session.State)
	}
	if got.Session.FinalizedLocation == nil || *got.Session.FinalizedLocation != sink.Location() {
		t.Fatalf("FinalizedLocation = %v, want %q", got.Session.FinalizedLocation, sink.Location())
	}

	// The standalone copy holds the whole dataset: base content for every index
	// except 7, which holds the workload write (write overrides base in the copy).
	if !sink.closed {
		t.Fatalf("finalize sink was not closed")
	}
	for i := 0; i < total; i++ {
		want := baseChunkBytes(i)
		if i == 7 {
			want = wrote
		}
		if !bytes.Equal(sink.chunks[i], want) {
			t.Fatalf("standalone copy chunk %d = %q, want %q", i, sink.chunks[i], want)
		}
	}

	// The base recovery point was never mutated through the whole lifecycle.
	for i, c := range base.snapshot() {
		if !bytes.Equal(c, baseChunkBytes(i)) {
			t.Fatalf("base chunk %d mutated to %q over the lifecycle; recovery point must stay immutable", i, c)
		}
	}
}

func TestService_ReadServedDuringPartialHydration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 6
	base := newSequentialBase(total, 16)
	store := newMemStore()
	sink := newMemSink("loc")
	// Throttle hydration so a single tick does not complete; then read mid-flight.
	svc := newTestService(t, store, base, sink, 1)
	tenantID := uuid.New()

	sess, err := svc.StartSession(ctx, tenantID, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	// Read every chunk while HYDRATING (the overlay is empty): all must
	// read-through to the correct base value, and the session stays HYDRATING.
	for i := 0; i < total; i++ {
		got, rerr := svc.ReadChunk(ctx, tenantID, sess.ID, i)
		if rerr != nil {
			t.Fatalf("ReadChunk(%d) during hydration: %v", i, rerr)
		}
		if !bytes.Equal(got, baseChunkBytes(i)) {
			t.Fatalf("ReadChunk(%d) = %q, want base %q", i, got, baseChunkBytes(i))
		}
	}
	prog, _ := svc.GetProgress(ctx, tenantID, sess.ID)
	if prog.Session.State != StateHydrating {
		t.Fatalf("state during partial hydration = %q, want HYDRATING", prog.Session.State)
	}
}

func TestService_StartRejectsEmptyRecoveryPoint(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	base := newMemBase(nil, 16) // zero chunks
	store := newMemStore()
	svc := newTestService(t, store, base, newMemSink("x"), 0)

	if _, err := svc.StartSession(ctx, uuid.New(), uuid.New(), nil); !errors.Is(err, ErrNoBaseChunks) {
		t.Fatalf("StartSession on empty recovery point err = %v, want ErrNoBaseChunks", err)
	}
}

func TestService_GetProgressNotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc := newTestService(t, newMemStore(), newSequentialBase(3, 8), newMemSink("x"), 0)
	if _, err := svc.GetProgress(ctx, uuid.New(), uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetProgress unknown session err = %v, want ErrNotFound", err)
	}
}

func TestService_TenantIsolation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, newSequentialBase(4, 8), newMemSink("x"), 0)
	owner := uuid.New()
	other := uuid.New()

	sess, err := svc.StartSession(ctx, owner, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	// Another tenant cannot read the session (the store filters by tenant, like RLS).
	if _, err := svc.GetProgress(ctx, other, sess.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant GetProgress err = %v, want ErrNotFound", err)
	}
}

func TestService_FinalizeIsIdempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 5
	store := newMemStore()
	sink := newMemSink("loc-x")
	svc := newTestService(t, store, newSequentialBase(total, 8), sink, 0)
	tenantID := uuid.New()

	sess, err := svc.StartSession(ctx, tenantID, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	loop := newTestLoop(t, svc, store)
	if err := loop.Tick(ctx); err != nil { // hydrate -> READY
		t.Fatalf("hydrate tick: %v", err)
	}
	if _, err := svc.BeginFinalize(ctx, tenantID, sess.ID); err != nil {
		t.Fatalf("BeginFinalize: %v", err)
	}
	// Calling BeginFinalize again while FINALIZING is a no-op that returns the
	// session, not an error.
	again, err := svc.BeginFinalize(ctx, tenantID, sess.ID)
	if err != nil {
		t.Fatalf("BeginFinalize (again) err = %v, want nil (idempotent)", err)
	}
	if again.State != StateFinalizing {
		t.Fatalf("idempotent BeginFinalize state = %q, want FINALIZING", again.State)
	}
}
