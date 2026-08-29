package instant

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// startTestSession creates a HYDRATING session over the base directly in the
// store so overlay/hydrator units can run without the full service.
func startTestSession(t *testing.T, store *memStore, tenantID uuid.UUID, total, chunkSize int) *Session {
	t.Helper()
	sess := &Session{
		TenantID:        tenantID,
		RecoveryPointID: uuid.New(),
		ChunksTotal:     total,
		ChunkSize:       chunkSize,
		OverlayLocation: "db:dr_instant_overlay_chunk",
	}
	if err := store.CreateSession(context.Background(), nil, sess); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return sess
}

func TestOverlay_WriteRedirectReadThrough(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 10
	base := newSequentialBase(total, 32)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 32)

	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// Write chunk 5 (redirect-on-write).
	want5 := []byte("OVERLAY-WRITE-FOR-CHUNK-5")
	if err := overlay.WriteChunk(ctx, 5, want5); err != nil {
		t.Fatalf("WriteChunk(5): %v", err)
	}

	// Read 4, 5, 6: 4 and 6 read through to the base; 5 returns the overlay value.
	got4, err := overlay.ReadChunk(ctx, 4)
	if err != nil {
		t.Fatalf("ReadChunk(4): %v", err)
	}
	if !bytes.Equal(got4, baseChunkBytes(4)) {
		t.Fatalf("chunk 4 = %q, want base read-through %q", got4, baseChunkBytes(4))
	}

	got5, err := overlay.ReadChunk(ctx, 5)
	if err != nil {
		t.Fatalf("ReadChunk(5): %v", err)
	}
	if !bytes.Equal(got5, want5) {
		t.Fatalf("chunk 5 = %q, want overlay value %q", got5, want5)
	}
	if bytes.Equal(got5, baseChunkBytes(5)) {
		t.Fatalf("chunk 5 returned the BASE value; redirect-on-write did not take effect")
	}

	got6, err := overlay.ReadChunk(ctx, 6)
	if err != nil {
		t.Fatalf("ReadChunk(6): %v", err)
	}
	if !bytes.Equal(got6, baseChunkBytes(6)) {
		t.Fatalf("chunk 6 = %q, want base read-through %q", got6, baseChunkBytes(6))
	}

	// The base must NEVER be mutated by the write.
	for i, c := range base.snapshot() {
		if !bytes.Equal(c, baseChunkBytes(i)) {
			t.Fatalf("base chunk %d was mutated to %q; the immutable recovery point must not change", i, c)
		}
	}

	// 4 and 6 were served by read-through (base was read); 5 was served from the
	// overlay (base NOT read for 5).
	if base.readCount(4) == 0 || base.readCount(6) == 0 {
		t.Fatalf("expected base read-through for chunks 4 and 6, got reads 4=%d 6=%d", base.readCount(4), base.readCount(6))
	}
	if base.readCount(5) != 0 {
		t.Fatalf("chunk 5 should be served from the overlay without reading the base, got %d base reads", base.readCount(5))
	}
}

func TestOverlay_OverwriteWinsOverBaseAndIsStable(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 4
	base := newSequentialBase(total, 16)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 16)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// Two successive writes to the same index: the latest wins.
	if err := overlay.WriteChunk(ctx, 2, []byte("v1")); err != nil {
		t.Fatalf("WriteChunk v1: %v", err)
	}
	if err := overlay.WriteChunk(ctx, 2, []byte("v2-final")); err != nil {
		t.Fatalf("WriteChunk v2: %v", err)
	}
	got, err := overlay.ReadChunk(ctx, 2)
	if err != nil {
		t.Fatalf("ReadChunk(2): %v", err)
	}
	if string(got) != "v2-final" {
		t.Fatalf("chunk 2 = %q, want latest write %q", got, "v2-final")
	}
}

func TestOverlay_WriteCopiesCallerBuffer(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	base := newSequentialBase(3, 8)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, 3, 8)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, 3)

	buf := []byte("original")
	if err := overlay.WriteChunk(ctx, 1, buf); err != nil {
		t.Fatalf("WriteChunk: %v", err)
	}
	// Mutate the caller's buffer after the write; the stored value must not change.
	for i := range buf {
		buf[i] = 'X'
	}
	got, err := overlay.ReadChunk(ctx, 1)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if string(got) != "original" {
		t.Fatalf("stored chunk = %q, want a defensive copy %q", got, "original")
	}
}

func TestOverlay_OutOfRange(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	base := newSequentialBase(3, 8)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, 3, 8)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, 3)

	if _, err := overlay.ReadChunk(ctx, 3); !errors.Is(err, ErrChunkOutOfRange) {
		t.Fatalf("ReadChunk(3) err = %v, want ErrChunkOutOfRange", err)
	}
	if _, err := overlay.ReadChunk(ctx, -1); !errors.Is(err, ErrChunkOutOfRange) {
		t.Fatalf("ReadChunk(-1) err = %v, want ErrChunkOutOfRange", err)
	}
	if err := overlay.WriteChunk(ctx, 3, []byte("x")); !errors.Is(err, ErrChunkOutOfRange) {
		t.Fatalf("WriteChunk(3) err = %v, want ErrChunkOutOfRange", err)
	}
}

func TestOverlay_MissingIndicesSkipsWritten(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 6
	base := newSequentialBase(total, 8)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 8)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// Write chunks 1 and 4; they should be excluded from MissingIndices because a
	// redirect-on-write is authoritative — the base copy is unnecessary.
	if err := overlay.WriteChunk(ctx, 1, []byte("w1")); err != nil {
		t.Fatalf("WriteChunk(1): %v", err)
	}
	if err := overlay.WriteChunk(ctx, 4, []byte("w4")); err != nil {
		t.Fatalf("WriteChunk(4): %v", err)
	}

	missing, err := overlay.MissingIndices(ctx)
	if err != nil {
		t.Fatalf("MissingIndices: %v", err)
	}
	want := []int{0, 2, 3, 5}
	if len(missing) != len(want) {
		t.Fatalf("missing = %v, want %v", missing, want)
	}
	for i := range want {
		if missing[i] != want[i] {
			t.Fatalf("missing = %v, want %v", missing, want)
		}
	}
}
