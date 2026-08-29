package failback

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func newTestDriver(t *testing.T, store *memStore, sink *recordingSink, prober ReverseStreamProber) (*Driver, *fakeStarter, *fakeCutback) {
	t.Helper()
	tracker, err := NewDeltaTracker(prober)
	if err != nil {
		t.Fatalf("NewDeltaTracker: %v", err)
	}
	starter := &fakeStarter{}
	cutback := &fakeCutback{detail: map[string]any{"flipped": true}}
	drv, err := New(Config{
		Store:   store,
		Starter: starter,
		Tracker: tracker,
		Cutback: cutback,
		Events:  sink,
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New driver: %v", err)
	}
	return drv, starter, cutback
}

// convergedProbe drives the tracker to declare convergence on the first measure.
var convergedProbe = ReverseStreamProbe{
	HeadSeq: 100, AppliedSeq: 100,
	HeadLSN: "0/A00", AppliedLSN: "0/A00",
	BytesPending: 0, CutoverWindowOpen: true,
}

func TestDriverAdvance_HappyPath_PlanningToCompleted(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	sink := &recordingSink{}
	run := store.seed(&FailbackRun{
		TenantID:               "tenant-1",
		GroupID:                "group-1",
		FromSite:               "dr-site",
		ToSite:                 "primary-site",
		Status:                 StatusPlanning,
		ConvergeThresholdBytes: 0,
		InitiatedBy:            "user-1",
	})
	drv, starter, cutback := newTestDriver(t, store, sink, fakeProber{probe: convergedProbe})

	// PLANNING -> REVERSE_SYNCING (reverse stream established).
	if err := drv.Advance(ctx, nil, run); err != nil {
		t.Fatalf("advance plan: %v", err)
	}
	if run.Status != StatusReverseSyncing {
		t.Fatalf("after plan status = %s, want %s", run.Status, StatusReverseSyncing)
	}
	if starter.calls != 1 {
		t.Fatalf("reverse starter calls = %d, want 1", starter.calls)
	}
	if run.ReverseStreamID == nil || *run.ReverseStreamID == "" {
		t.Fatalf("reverse stream not recorded")
	}

	// REVERSE_SYNCING -> DELTA_CONVERGED (converged on first measure).
	if err := drv.Advance(ctx, nil, run); err != nil {
		t.Fatalf("advance reverse sync: %v", err)
	}
	if run.Status != StatusDeltaConverged {
		t.Fatalf("after reverse sync status = %s, want %s", run.Status, StatusDeltaConverged)
	}
	if run.LastConvergedAt == nil {
		t.Fatalf("last_converged_at not stamped on convergence")
	}

	// DELTA_CONVERGED -> AWAITING_CUTBACK_APPROVAL.
	if err := drv.Advance(ctx, nil, run); err != nil {
		t.Fatalf("advance await approval: %v", err)
	}
	if run.Status != StatusAwaitingCutbackApproval {
		t.Fatalf("after await status = %s, want %s", run.Status, StatusAwaitingCutbackApproval)
	}

	// The cutback gate: advancing WITHOUT approval is rejected (never auto-cuts).
	err := drv.Advance(ctx, nil, run)
	if err == nil {
		t.Fatalf("expected cutback gate to reject advance without approval")
	}
	if !errors.Is(err, ErrNotApproved) {
		t.Fatalf("gate error = %v, want ErrNotApproved", err)
	}
	if cutback.calls != 0 {
		t.Fatalf("cutback executed before approval (calls=%d)", cutback.calls)
	}
	if run.Status != StatusAwaitingCutbackApproval {
		t.Fatalf("run advanced past gate without approval: %s", run.Status)
	}

	// Explicit approval (the only way past the gate) -> CUTTING_BACK.
	if err := store.ApproveCutback(ctx, nil, run.TenantID, run.ID, "approver-1"); err != nil {
		t.Fatalf("approve cutback: %v", err)
	}
	approved := store.get(run.ID)
	if approved.Status != StatusCuttingBack {
		t.Fatalf("after approval status = %s, want %s", approved.Status, StatusCuttingBack)
	}

	// CUTTING_BACK -> COMPLETED (cutback executes, new direction recorded).
	if err := drv.Advance(ctx, nil, approved); err != nil {
		t.Fatalf("advance cutback: %v", err)
	}
	if approved.Status != StatusCompleted {
		t.Fatalf("final status = %s, want %s", approved.Status, StatusCompleted)
	}
	if cutback.calls != 1 {
		t.Fatalf("cutback executor calls = %d, want 1", cutback.calls)
	}
	if approved.NewDirection == nil || *approved.NewDirection != DirectionPrimaryToDR {
		t.Fatalf("new direction = %v, want %s", approved.NewDirection, DirectionPrimaryToDR)
	}

	wantEvents := []string{
		"datastream.dr.failback.reverse_syncing",
		"datastream.dr.failback.delta_converged",
		"datastream.dr.failback.cutback_approval.required",
		"datastream.dr.failback.completed",
	}
	if got := sink.eventTypes(); !reflect.DeepEqual(got, wantEvents) {
		t.Fatalf("events = %#v, want %#v", got, wantEvents)
	}
}

func TestDriverAdvance_ReverseSyncStaysUntilConverged(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	sink := &recordingSink{}
	run := store.seed(&FailbackRun{
		TenantID:               "tenant-1",
		GroupID:                "group-1",
		FromSite:               "dr-site",
		ToSite:                 "primary-site",
		Status:                 StatusReverseSyncing,
		ReverseStreamID:        strPtr("reverse-1"),
		ConvergeThresholdBytes: 1024,
		InitiatedBy:            "user-1",
	})
	// Over threshold: must NOT converge, stays in REVERSE_SYNCING, persists delta.
	notYet := ReverseStreamProbe{HeadSeq: 200, AppliedSeq: 10, BytesPending: 8192, CutoverWindowOpen: true}
	drv, _, _ := newTestDriver(t, store, sink, fakeProber{probe: notYet})

	if err := drv.Advance(ctx, nil, run); err != nil {
		t.Fatalf("advance reverse sync (not converged): %v", err)
	}
	if run.Status != StatusReverseSyncing {
		t.Fatalf("status advanced past REVERSE_SYNCING before convergence: %s", run.Status)
	}
	if run.DeltaBytesRemaining != 8192 {
		t.Fatalf("delta not persisted: %d", run.DeltaBytesRemaining)
	}
	if got := sink.eventTypes(); !reflect.DeepEqual(got, []string{"datastream.dr.failback.reverse_progress"}) {
		t.Fatalf("events = %#v, want a single reverse_progress", got)
	}
	// No converged step should exist yet.
	for _, name := range store.stepNames(run.ID) {
		if name == StepDeltaConverged {
			t.Fatalf("delta.converged step written before convergence")
		}
	}
}

func TestDriverAdvance_ReverseSyncWithoutStreamIsInvalid(t *testing.T) {
	store := newMemStore()
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusReverseSyncing, InitiatedBy: "u",
	})
	drv, _, _ := newTestDriver(t, store, &recordingSink{}, fakeProber{probe: convergedProbe})
	err := drv.Advance(context.Background(), nil, run)
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("error = %v, want ErrInvalidState for missing reverse stream", err)
	}
}

func TestDriverAdvance_AwaitingApprovalWithoutApprovalIsRejected(t *testing.T) {
	store := newMemStore()
	cutbackRun := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusAwaitingCutbackApproval, InitiatedBy: "u",
	})
	drv, _, cutback := newTestDriver(t, store, &recordingSink{}, fakeProber{probe: convergedProbe})

	err := drv.Advance(context.Background(), nil, cutbackRun)
	if !errors.Is(err, ErrNotApproved) {
		t.Fatalf("error = %v, want ErrNotApproved", err)
	}
	if cutback.calls != 0 {
		t.Fatalf("cutback ran without approval")
	}
}

func TestDriverAdvance_CuttingBackWithoutApprovalFailsRun(t *testing.T) {
	// Defence in depth: a run somehow in CUTTING_BACK with no approver must fail,
	// never silently cut back.
	store := newMemStore()
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusCuttingBack, InitiatedBy: "u",
	})
	drv, _, cutback := newTestDriver(t, store, &recordingSink{}, fakeProber{probe: convergedProbe})

	err := drv.Advance(context.Background(), nil, run)
	if !IsRecordedFailure(err) {
		t.Fatalf("error = %T %v, want recorded failure", err, err)
	}
	if !errors.Is(err, ErrNotApproved) {
		t.Fatalf("cause = %v, want ErrNotApproved", err)
	}
	if cutback.calls != 0 {
		t.Fatalf("cutback executed despite missing approval")
	}
	if run.Status != StatusFailed {
		t.Fatalf("status = %s, want FAILED", run.Status)
	}
}

func TestDriverAdvance_TerminalIsNoOp(t *testing.T) {
	store := newMemStore()
	drv, _, _ := newTestDriver(t, store, &recordingSink{}, fakeProber{probe: convergedProbe})
	for _, status := range []string{StatusCompleted, StatusFailed} {
		run := &FailbackRun{TenantID: "t", GroupID: "g", FromSite: "a", ToSite: "b", Status: status}
		if err := drv.Advance(context.Background(), nil, run); err != nil {
			t.Fatalf("terminal advance %s: %v", status, err)
		}
		if run.Status != status {
			t.Fatalf("terminal run mutated: %s -> %s", status, run.Status)
		}
	}
}

func TestDriverAdvance_PlanReverseStreamFailureFailsRun(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	sink := &recordingSink{}
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, InitiatedBy: "u",
	})
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{err: errBoom},
		Tracker: tracker,
		Cutback: &fakeCutback{},
		Events:  sink,
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	advErr := drv.Advance(ctx, nil, run)
	if !IsRecordedFailure(advErr) {
		t.Fatalf("error = %T %v, want recorded failure", advErr, advErr)
	}
	if run.Status != StatusFailed {
		t.Fatalf("status = %s, want FAILED", run.Status)
	}
	wantEvents := []string{"datastream.dr.failback.failed"}
	if got := sink.eventTypes(); !reflect.DeepEqual(got, wantEvents) {
		t.Fatalf("events = %#v, want %#v", got, wantEvents)
	}
}

func TestDriverAdvance_CutbackExecutorFailureFailsRun(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	sink := &recordingSink{}
	approver := "approver-1"
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusCuttingBack, InitiatedBy: "u", ApprovedBy: &approver,
	})
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{},
		Tracker: tracker,
		Cutback: &fakeCutback{err: errBoom},
		Events:  sink,
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	advErr := drv.Advance(ctx, nil, run)
	if !IsRecordedFailure(advErr) {
		t.Fatalf("error = %T %v, want recorded failure", advErr, advErr)
	}
	if run.Status != StatusFailed {
		t.Fatalf("status = %s, want FAILED", run.Status)
	}
}

func TestDriverAdvance_FailureRecordingErrorIsNotRecordedFailure(t *testing.T) {
	// When recording the failure itself fails (persistence error), Advance must
	// return a PLAIN error so the loop rolls back and retries — not a recorded one.
	store := newMemStore()
	store.failRunErr = errors.New("db down")
	sink := &recordingSink{}
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, InitiatedBy: "u",
	})
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{err: errBoom},
		Tracker: tracker,
		Cutback: &fakeCutback{},
		Events:  sink,
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	advErr := drv.Advance(context.Background(), nil, run)
	if advErr == nil {
		t.Fatal("expected persistence error")
	}
	if IsRecordedFailure(advErr) {
		t.Fatalf("persistence failure must not be recorded: %T %v", advErr, advErr)
	}
}

func TestNew_RequiredCollaborators(t *testing.T) {
	tracker, _ := NewDeltaTracker(fakeProber{})
	tests := []struct {
		name string
		cfg  Config
	}{
		{"no store", Config{Starter: &fakeStarter{}, Tracker: tracker, Cutback: &fakeCutback{}}},
		{"no starter", Config{Store: newMemStore(), Tracker: tracker, Cutback: &fakeCutback{}}},
		{"no tracker", Config{Store: newMemStore(), Starter: &fakeStarter{}, Cutback: &fakeCutback{}}},
		{"no cutback", Config{Store: newMemStore(), Starter: &fakeStarter{}, Tracker: tracker}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.cfg); err == nil {
				t.Fatal("expected error for missing collaborator")
			}
		})
	}
}

func TestNextStatus_LegalTransitions(t *testing.T) {
	tests := []struct {
		from   string
		want   string
		wantOK bool
	}{
		{StatusPlanning, StatusReverseSyncing, true},
		{StatusReverseSyncing, StatusDeltaConverged, true},
		{StatusDeltaConverged, StatusAwaitingCutbackApproval, true},
		{StatusCuttingBack, StatusCompleted, true},
		// Human-gated and terminal states have no driver-forward transition.
		{StatusAwaitingCutbackApproval, "", false},
		{StatusCompleted, "", false},
		{StatusFailed, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.from, func(t *testing.T) {
			got, ok := NextStatus(tc.from)
			if got != tc.want || ok != tc.wantOK {
				t.Fatalf("NextStatus(%s) = (%q,%v), want (%q,%v)", tc.from, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestFailbackRun_Helpers(t *testing.T) {
	now := time.Now()
	approver := "u"
	r := &FailbackRun{
		Status: StatusDeltaConverged, CutoverWindowOpen: true,
		DeltaBytesRemaining: 10, ConvergeThresholdBytes: 10,
		ApprovedBy: &approver, ApprovedAt: &now,
	}
	if !r.DeltaConverged() {
		t.Fatal("at-threshold with window open should be converged")
	}
	r.CutoverWindowOpen = false
	if r.DeltaConverged() {
		t.Fatal("window closed must not be converged")
	}
	if !r.IsApproved() {
		t.Fatal("approved run should report approved")
	}
	r.ApprovedBy = nil
	if r.IsApproved() {
		t.Fatal("unapproved run should not report approved")
	}
}
