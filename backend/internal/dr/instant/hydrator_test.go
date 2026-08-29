package instant

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHydrator_CopiesAllChunksReports100(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 25
	base := newSequentialBase(total, 64)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 64)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	hyd, err := NewHydrator(HydratorConfig{Store: store, RatePerSec: 0, Burst: 1})
	if err != nil {
		t.Fatalf("NewHydrator: %v", err)
	}

	res, err := hyd.HydrateSession(ctx, nil, overlay, sess.ID)
	if err != nil {
		t.Fatalf("HydrateSession: %v", err)
	}
	if !res.Complete {
		t.Fatalf("expected hydration complete, got %+v", res)
	}
	if res.Copied != total || res.TotalHydrated != total || res.Total != total {
		t.Fatalf("counts wrong: %+v (want copied=total=hydrated=%d)", res, total)
	}

	// The session's persisted accounting reports total and 100%.
	got, err := store.GetSessionSystem(ctx, nil, sess.ID)
	if err != nil {
		t.Fatalf("GetSessionSystem: %v", err)
	}
	if got.ChunksHydrated != total {
		t.Fatalf("ChunksHydrated = %d, want %d", got.ChunksHydrated, total)
	}
	if pct := got.PercentComplete(); pct != 100 {
		t.Fatalf("PercentComplete = %v, want 100", pct)
	}

	// Every overlay chunk equals the base content (verbatim copy).
	for i := 0; i < total; i++ {
		v, ok, gerr := store.GetOverlayChunk(ctx, nil, sess.ID, int64(i))
		if gerr != nil || !ok {
			t.Fatalf("overlay chunk %d missing after full hydration (ok=%v err=%v)", i, ok, gerr)
		}
		if !bytes.Equal(v, baseChunkBytes(i)) {
			t.Fatalf("hydrated chunk %d = %q, want base %q", i, v, baseChunkBytes(i))
		}
	}

	// Re-running is idempotent: nothing new copied, still 100%.
	res2, err := hyd.HydrateSession(ctx, nil, overlay, sess.ID)
	if err != nil {
		t.Fatalf("HydrateSession (rerun): %v", err)
	}
	if res2.Copied != 0 || res2.TotalHydrated != total || !res2.Complete {
		t.Fatalf("rerun should be a no-op at 100%%, got %+v", res2)
	}
}

func TestHydrator_PartialThenComplete_CorrectCounts(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 10
	base := newSequentialBase(total, 16)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 16)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// Throttle to 5 chunks/sec; cancel after enough time for only a few chunks.
	hyd, err := NewHydrator(HydratorConfig{Store: store, RatePerSec: 5, Burst: 1})
	if err != nil {
		t.Fatalf("NewHydrator: %v", err)
	}

	// Cap the first pass so only a partial set is copied: a short deadline lets a
	// couple of tokens through then cancels.
	cctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	res, err := hyd.HydrateSession(cctx, nil, overlay, sess.ID)
	cancel()
	if err != nil {
		t.Fatalf("partial HydrateSession: %v", err)
	}
	if res.Complete {
		t.Fatalf("did not expect complete after a throttled partial pass: %+v", res)
	}
	if res.TotalHydrated <= 0 || res.TotalHydrated >= total {
		t.Fatalf("expected a strictly partial count, got %d/%d", res.TotalHydrated, total)
	}
	// The persisted count matches what was actually copied (no over-count).
	got, _ := store.GetSessionSystem(ctx, nil, sess.ID)
	if got.ChunksHydrated != res.TotalHydrated {
		t.Fatalf("persisted count %d != reported %d", got.ChunksHydrated, res.TotalHydrated)
	}

	// Finish hydration unthrottled.
	hyd2, _ := NewHydrator(HydratorConfig{Store: store, RatePerSec: 0, Burst: 1})
	res2, err := hyd2.HydrateSession(ctx, nil, overlay, sess.ID)
	if err != nil {
		t.Fatalf("finishing HydrateSession: %v", err)
	}
	if !res2.Complete || res2.TotalHydrated != total {
		t.Fatalf("expected complete with %d hydrated, got %+v", total, res2)
	}
	// Copied on the second pass equals the remainder, not the whole set.
	if res2.Copied != total-res.TotalHydrated {
		t.Fatalf("second pass copied %d, want remainder %d", res2.Copied, total-res.TotalHydrated)
	}
}

func TestHydrator_ReadsServedCorrectlyDuringPartialHydration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 8
	base := newSequentialBase(total, 16)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 16)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// The workload writes chunk 3 before hydration runs (redirect-on-write).
	workloadWrite := []byte("WORKLOAD-WROTE-3")
	if err := overlay.WriteChunk(ctx, 3, workloadWrite); err != nil {
		t.Fatalf("WriteChunk(3): %v", err)
	}

	// Hydrate only the first half by directly hydrating indices 0..3 (3 is a
	// write, so HydrateChunk(3) must NOT overwrite it).
	for i := 0; i <= 3; i++ {
		if _, err := overlay.HydrateChunk(ctx, i); err != nil {
			t.Fatalf("HydrateChunk(%d): %v", i, err)
		}
	}

	// During partial hydration: hydrated chunk 0 reads its base value from the
	// overlay; not-yet-hydrated chunk 6 reads through to the base; written chunk 3
	// reads the workload value (write wins, never clobbered by hydrate).
	got0, _ := overlay.ReadChunk(ctx, 0)
	if !bytes.Equal(got0, baseChunkBytes(0)) {
		t.Fatalf("hydrated chunk 0 = %q, want base %q", got0, baseChunkBytes(0))
	}
	got6, _ := overlay.ReadChunk(ctx, 6)
	if !bytes.Equal(got6, baseChunkBytes(6)) {
		t.Fatalf("unhydrated chunk 6 = %q, want base read-through %q", got6, baseChunkBytes(6))
	}
	got3, _ := overlay.ReadChunk(ctx, 3)
	if !bytes.Equal(got3, workloadWrite) {
		t.Fatalf("written chunk 3 = %q, want workload write %q (hydrate must not clobber a write)", got3, workloadWrite)
	}

	// Chunk 3 origin remains 'write' even though HydrateChunk(3) ran.
	if origin, ok := store.overlayOrigin(sess.ID, 3); !ok || origin != OriginWrite {
		t.Fatalf("chunk 3 origin = %q (ok=%v), want %q", origin, ok, OriginWrite)
	}

	// Only the 3 genuine hydrates (0,1,2) count toward hydrated progress; the
	// write at index 3 is workload data, not hydration progress.
	n, _ := store.CountHydrated(ctx, nil, sess.ID)
	if n != 3 {
		t.Fatalf("CountHydrated = %d, want 3 (0,1,2; index 3 was a write)", n)
	}
}

func TestHydrator_RequiresStore(t *testing.T) {
	t.Parallel()
	if _, err := NewHydrator(HydratorConfig{}); err == nil {
		t.Fatal("expected error when store is nil")
	}
}
