package agent

import (
	"path/filepath"
	"testing"
)

func TestFileCheckpointStore_SaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("NewFileCheckpointStore: %v", err)
	}

	// Unknown stream -> zero checkpoint, ship from scratch.
	cp, err := store.Load("stream-1")
	if err != nil {
		t.Fatalf("Load unknown: %v", err)
	}
	if cp.AckedSeq != 0 || cp.StreamID != "stream-1" {
		t.Fatalf("unknown stream checkpoint = %+v, want zero seq with stream id set", cp)
	}

	if err := store.Save(Checkpoint{StreamID: "stream-1", AckedSeq: 5, SourceLSN: "0/AB"}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := store.Load("stream-1")
	if err != nil {
		t.Fatalf("Load after save: %v", err)
	}
	if got.AckedSeq != 5 || got.SourceLSN != "0/AB" {
		t.Fatalf("loaded checkpoint = %+v, want seq 5 lsn 0/AB", got)
	}
	if got.UpdatedAt.IsZero() {
		t.Fatal("UpdatedAt should be set on save")
	}
}

func TestFileCheckpointStore_Monotonic(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("NewFileCheckpointStore: %v", err)
	}
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 10}); err != nil {
		t.Fatalf("save 10: %v", err)
	}
	// A lower/equal ack must NOT rewind the cursor (idempotent resume safety).
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 7}); err != nil {
		t.Fatalf("save 7: %v", err)
	}
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 10}); err != nil {
		t.Fatalf("save 10 again: %v", err)
	}
	got, err := store.Load("s")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.AckedSeq != 10 {
		t.Fatalf("AckedSeq = %d after non-monotonic saves, want 10", got.AckedSeq)
	}
	// A higher ack advances it.
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 12}); err != nil {
		t.Fatalf("save 12: %v", err)
	}
	got, _ = store.Load("s")
	if got.AckedSeq != 12 {
		t.Fatalf("AckedSeq = %d, want 12", got.AckedSeq)
	}
}

func TestFileCheckpointStore_SurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("NewFileCheckpointStore: %v", err)
	}
	if err := store.Save(Checkpoint{StreamID: "alpha", AckedSeq: 42, SourceLSN: "lsn-42"}); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Simulate a process restart: a brand new store over the same directory must
	// resume from the persisted cursor.
	reopened, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got, err := reopened.Load("alpha")
	if err != nil {
		t.Fatalf("load after reopen: %v", err)
	}
	if got.AckedSeq != 42 || got.SourceLSN != "lsn-42" {
		t.Fatalf("after reopen checkpoint = %+v, want seq 42 lsn lsn-42", got)
	}

	// Monotonicity is preserved across reopen: a stale ack does not rewind.
	if err := reopened.Save(Checkpoint{StreamID: "alpha", AckedSeq: 1}); err != nil {
		t.Fatalf("save stale after reopen: %v", err)
	}
	got, _ = reopened.Load("alpha")
	if got.AckedSeq != 42 {
		t.Fatalf("stale ack rewound cursor to %d, want 42", got.AckedSeq)
	}
}

func TestFileCheckpointStore_List(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("NewFileCheckpointStore: %v", err)
	}
	_ = store.Save(Checkpoint{StreamID: "b-stream", AckedSeq: 2})
	_ = store.Save(Checkpoint{StreamID: "a-stream", AckedSeq: 1})
	list, err := store.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List len = %d, want 2", len(list))
	}
	if list[0].StreamID != "a-stream" || list[1].StreamID != "b-stream" {
		t.Fatalf("List not sorted by stream id: %+v", list)
	}
}

func TestFileCheckpointStore_SanitizesStreamID(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileCheckpointStore(dir)
	if err != nil {
		t.Fatalf("NewFileCheckpointStore: %v", err)
	}
	// A path-traversal-shaped stream id must not escape the cache directory.
	evil := "../../etc/passwd"
	if err := store.Save(Checkpoint{StreamID: evil, AckedSeq: 1}); err != nil {
		t.Fatalf("save evil id: %v", err)
	}
	got, err := store.Load(evil)
	if err != nil {
		t.Fatalf("load evil id: %v", err)
	}
	if got.AckedSeq != 1 {
		t.Fatalf("evil id round-trip seq = %d, want 1", got.AckedSeq)
	}
	// The file must live inside the checkpoints subdir.
	matches, _ := filepath.Glob(filepath.Join(dir, "checkpoints", "*.json"))
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 sanitized checkpoint file in cache dir, got %v", matches)
	}
}

func TestMemoryCheckpointStore_Monotonic(t *testing.T) {
	store := NewMemoryCheckpointStore()
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 5}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := store.Save(Checkpoint{StreamID: "s", AckedSeq: 3}); err != nil {
		t.Fatalf("save lower: %v", err)
	}
	got, _ := store.Load("s")
	if got.AckedSeq != 5 {
		t.Fatalf("AckedSeq = %d, want 5 (no rewind)", got.AckedSeq)
	}
}
