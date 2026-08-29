package service

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// fakeStalePendingStore models the idempotency ledger's reconciliation surface.
// It records ExpireStalePending calls and honours the CAS guard (a key already
// expired returns false on a second attempt).
type fakeStalePendingStore struct {
	pending  []*model.ActivityExecution
	expired  map[string]string // idempotency_key -> reason
	listErr  error
	failKeys map[string]bool // keys whose ExpireStalePending returns an error
}

func newFakeStalePendingStore(pending ...*model.ActivityExecution) *fakeStalePendingStore {
	return &fakeStalePendingStore{
		pending:  pending,
		expired:  map[string]string{},
		failKeys: map[string]bool{},
	}
}

func (f *fakeStalePendingStore) ListStalePending(_ context.Context, _ time.Duration, _ int) ([]*model.ActivityExecution, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	// Return only rows still pending (not yet expired), modelling the SQL filter.
	var out []*model.ActivityExecution
	for _, a := range f.pending {
		if _, done := f.expired[a.IdempotencyKey]; !done {
			out = append(out, a)
		}
	}
	return out, nil
}

func (f *fakeStalePendingStore) ExpireStalePending(_ context.Context, key string, _ time.Duration, reason string) (bool, error) {
	if f.failKeys[key] {
		return false, context.DeadlineExceeded
	}
	if _, done := f.expired[key]; done {
		// CAS guard: already expired → no row affected.
		return false, nil
	}
	f.expired[key] = reason
	return true, nil
}

func staleAct(key string) *model.ActivityExecution {
	return &model.ActivityExecution{
		IdempotencyKey: key,
		InstanceID:     "inst-" + key,
		StepID:         "step-" + key,
		Attempt:        1,
		Status:         model.ActivityStatusPending,
		CreatedAt:      time.Now().Add(-time.Hour),
		UpdatedAt:      time.Now().Add(-time.Hour),
	}
}

// TestActivityReconciler_ExpiresStalePending proves the sweep expires every stale
// pending row exactly once and reports the count.
func TestActivityReconciler_ExpiresStalePending(t *testing.T) {
	store := newFakeStalePendingStore(staleAct("a"), staleAct("b"), staleAct("c"))
	r := NewActivityReconciler(ActivityReconcilerConfig{Store: store, Logger: zerolog.Nop()})

	n := r.Sweep(context.Background())
	if n != 3 {
		t.Fatalf("expired = %d, want 3", n)
	}
	for _, k := range []string{"a", "b", "c"} {
		if _, ok := store.expired[k]; !ok {
			t.Fatalf("key %q was not expired", k)
		}
	}

	// A second sweep finds nothing left (idempotent — no double expiry).
	if n := r.Sweep(context.Background()); n != 0 {
		t.Fatalf("second sweep expired = %d, want 0", n)
	}
}

// TestActivityReconciler_PerRowErrorDoesNotStallBatch proves one failing row is
// skipped and the rest still expire.
func TestActivityReconciler_PerRowErrorDoesNotStallBatch(t *testing.T) {
	store := newFakeStalePendingStore(staleAct("a"), staleAct("bad"), staleAct("c"))
	store.failKeys["bad"] = true
	r := NewActivityReconciler(ActivityReconcilerConfig{Store: store, Logger: zerolog.Nop()})

	n := r.Sweep(context.Background())
	if n != 2 {
		t.Fatalf("expired = %d, want 2 (bad row skipped)", n)
	}
	if _, ok := store.expired["bad"]; ok {
		t.Fatal("failing row must not be recorded as expired")
	}
}

// TestActivityReconciler_NilStoreIsNoReconciler proves a missing ledger yields a
// nil reconciler that no-ops safely (so wiring stays optional).
func TestActivityReconciler_NilStoreIsNoReconciler(t *testing.T) {
	r := NewActivityReconciler(ActivityReconcilerConfig{Store: nil, Logger: zerolog.Nop()})
	if r != nil {
		t.Fatalf("expected nil reconciler when no store is wired, got %v", r)
	}
	// A nil reconciler's Sweep/Run are safe no-ops.
	if n := r.Sweep(context.Background()); n != 0 {
		t.Fatalf("nil reconciler Sweep = %d, want 0", n)
	}
	r.Run(context.Background()) // returns immediately
}

// TestActivityReconciler_Defaults proves the constructor applies sane defaults.
func TestActivityReconciler_Defaults(t *testing.T) {
	store := newFakeStalePendingStore()
	r := NewActivityReconciler(ActivityReconcilerConfig{Store: store, Logger: zerolog.Nop()})
	if r.interval != time.Minute {
		t.Fatalf("default interval = %v, want 1m", r.interval)
	}
	if r.staleAfter != 15*time.Minute {
		t.Fatalf("default staleAfter = %v, want 15m", r.staleAfter)
	}
	if r.batchLimit != 100 {
		t.Fatalf("default batchLimit = %d, want 100", r.batchLimit)
	}
}
