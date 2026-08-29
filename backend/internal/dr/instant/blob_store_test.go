package instant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/google/uuid"
)

func TestFileOverlayBlobStorePutGet(t *testing.T) {
	t.Parallel()
	store, err := NewFileOverlayBlobStore(t.TempDir())
	if err != nil {
		t.Fatalf("new file store: %v", err)
	}
	data := []byte("overlay payload")
	sum := sha256.Sum256(data)

	ref, err := store.Put(context.Background(), uuid.New(), uuid.New(), 7, OriginWrite, data, hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	got, err := store.Get(context.Background(), ref)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("payload = %q, want %q", string(got), string(data))
	}
}

func TestFileOverlayBlobStoreRejectsEscapingRef(t *testing.T) {
	t.Parallel()
	store, err := NewFileOverlayBlobStore(t.TempDir())
	if err != nil {
		t.Fatalf("new file store: %v", err)
	}
	if _, err := store.Get(context.Background(), "../outside"); err == nil {
		t.Fatal("expected escaping ref to be rejected")
	}
}
