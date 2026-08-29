package instant

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestFinalizeCopy_AssemblesFullDataset(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const total = 7
	base := newSequentialBase(total, 16)
	store := newMemStore()
	tenantID := uuid.New()
	sess := startTestSession(t, store, tenantID, total, 16)
	overlay := NewOverlayStore(store, base, nil, tenantID, sess.ID, total)

	// Workload overwrote chunk 2; hydrate the rest.
	override := []byte("FINAL-OVERRIDE-2")
	if err := overlay.WriteChunk(ctx, 2, override); err != nil {
		t.Fatalf("WriteChunk(2): %v", err)
	}
	hyd, _ := NewHydrator(HydratorConfig{Store: store, RatePerSec: 0, Burst: 1})
	if _, err := hyd.HydrateSession(ctx, nil, overlay, sess.ID); err != nil {
		t.Fatalf("HydrateSession: %v", err)
	}

	sink := newMemSink("worm://finalized/test")
	written, err := FinalizeCopy(ctx, overlay, sink)
	if err != nil {
		t.Fatalf("FinalizeCopy: %v", err)
	}
	if !sink.closed {
		t.Fatalf("sink must be closed after FinalizeCopy")
	}

	var wantBytes int64
	for i := 0; i < total; i++ {
		want := baseChunkBytes(i)
		if i == 2 {
			want = override
		}
		if !bytes.Equal(sink.chunks[i], want) {
			t.Fatalf("finalized chunk %d = %q, want %q", i, sink.chunks[i], want)
		}
		wantBytes += int64(len(want))
	}
	if written != wantBytes {
		t.Fatalf("written = %d bytes, want %d", written, wantBytes)
	}

	// The base recovery point is still pristine after finalize.
	for i, c := range base.snapshot() {
		if !bytes.Equal(c, baseChunkBytes(i)) {
			t.Fatalf("base chunk %d mutated to %q during finalize", i, c)
		}
	}
}
