package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeStreamStore is an in-memory StreamCheckpointStore that records the last
// persisted ledger position, so the DBCheckpointer's mapping and monotonicity
// can be asserted without a database. The integration test exercises the real
// repository adapter against PostgreSQL.
type fakeStreamStore struct {
	seq      int64
	lsn      string
	at       time.Time
	status   string
	writes   int
	failNext bool
}

func (f *fakeStreamStore) UpdateStreamCheckpoint(_ context.Context, _ string, appliedSeq int64, sourceLSN string, appliedAt time.Time, status string) error {
	if f.failNext {
		f.failNext = false
		return errors.New("boom")
	}
	f.seq = appliedSeq
	f.lsn = sourceLSN
	f.at = appliedAt
	f.status = status
	f.writes++
	return nil
}

func (f *fakeStreamStore) LoadStreamCheckpoint(_ context.Context, _ string) (int64, string, time.Time, error) {
	return f.seq, f.lsn, f.at, nil
}

func TestDBCheckpointer_SaveLoadMapping(t *testing.T) {
	t.Parallel()
	store := &fakeStreamStore{seq: 5, lsn: "0/100", at: time.Unix(1000, 0).UTC()}
	cp, err := NewDBCheckpointer(store, "stream-1")
	if err != nil {
		t.Fatalf("NewDBCheckpointer: %v", err)
	}

	loaded, err := cp.Load(context.Background(), "stream-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.AppliedSeq != 5 || loaded.SourceLSN != "0/100" {
		t.Fatalf("Load mapped wrong: %+v", loaded)
	}

	now := time.Unix(2000, 0).UTC()
	if err := cp.Save(context.Background(), Checkpoint{StreamID: "stream-1", AppliedSeq: 7, SourceLSN: "0/200", AppliedAt: now}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if store.seq != 7 || store.lsn != "0/200" || !store.at.Equal(now) {
		t.Fatalf("Save mapped wrong: seq=%d lsn=%s at=%v", store.seq, store.lsn, store.at)
	}
	if store.status != "streaming" {
		t.Fatalf("default status = %q, want streaming", store.status)
	}
}

func TestDBCheckpointer_MonotonicNoRewind(t *testing.T) {
	t.Parallel()
	store := &fakeStreamStore{}
	cp, err := NewDBCheckpointer(store, "stream-1", WithStreamStatus("seeding"))
	if err != nil {
		t.Fatalf("NewDBCheckpointer: %v", err)
	}
	if _, err := cp.Load(context.Background(), "stream-1"); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if err := cp.Save(context.Background(), Checkpoint{StreamID: "stream-1", AppliedSeq: 10}); err != nil {
		t.Fatalf("Save 10: %v", err)
	}
	if store.status != "seeding" {
		t.Fatalf("status = %q, want seeding", store.status)
	}
	writes := store.writes
	// A stale or duplicate checkpoint (<= last) must be a no-op: no write.
	if err := cp.Save(context.Background(), Checkpoint{StreamID: "stream-1", AppliedSeq: 10}); err != nil {
		t.Fatalf("Save dup 10: %v", err)
	}
	if err := cp.Save(context.Background(), Checkpoint{StreamID: "stream-1", AppliedSeq: 4}); err != nil {
		t.Fatalf("Save older 4: %v", err)
	}
	if store.writes != writes {
		t.Fatalf("stale/duplicate Save wrote to store (%d -> %d)", writes, store.writes)
	}
	if store.seq != 10 {
		t.Fatalf("ledger rewound to %d, want 10", store.seq)
	}
}

func TestDBCheckpointer_StreamMismatch(t *testing.T) {
	t.Parallel()
	cp, err := NewDBCheckpointer(&fakeStreamStore{}, "stream-1")
	if err != nil {
		t.Fatalf("NewDBCheckpointer: %v", err)
	}
	err = cp.Save(context.Background(), Checkpoint{StreamID: "other", AppliedSeq: 1})
	if !errors.Is(err, ErrCheckpointStreamMismatch) {
		t.Fatalf("Save mismatch err = %v, want ErrCheckpointStreamMismatch", err)
	}
	_, err = cp.Load(context.Background(), "other")
	if !errors.Is(err, ErrCheckpointStreamMismatch) {
		t.Fatalf("Load mismatch err = %v, want ErrCheckpointStreamMismatch", err)
	}
}
