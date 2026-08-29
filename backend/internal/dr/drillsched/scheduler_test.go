package drillsched

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"
)

// fakeScheduleStore is an in-memory schedule store implementing scheduleClaimer.
// It models the real SystemClaimDueSchedules contract: it returns only enabled
// schedules whose next_run <= now, ordered by next_run, and "claims" them (so a
// second concurrent claim within the same now does not return them again) by
// recording which ids are currently claimed. AdvanceSchedule moves next_run and
// stamps last_fired_at, releasing the claim.
type fakeScheduleStore struct {
	mu        sync.Mutex
	schedules map[string]*Schedule
	claimed   map[string]bool
	// advanceErrFor forces AdvanceSchedule to fail for a given schedule id, to
	// prove a single failure does not stall the batch.
	advanceErrFor map[string]error
}

func newFakeScheduleStore(schedules ...*Schedule) *fakeScheduleStore {
	m := make(map[string]*Schedule, len(schedules))
	for _, s := range schedules {
		cp := *s
		m[s.ID] = &cp
	}
	return &fakeScheduleStore{
		schedules:     m,
		claimed:       map[string]bool{},
		advanceErrFor: map[string]error{},
	}
}

func (f *fakeScheduleStore) SystemClaimDueSchedules(_ context.Context, _ DBTX, now time.Time, limit int) ([]*Schedule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var due []*Schedule
	for _, s := range f.schedules {
		if !s.Enabled || f.claimed[s.ID] {
			continue
		}
		if !s.NextRun.After(now) { // next_run <= now
			cp := *s
			due = append(due, &cp)
		}
	}
	sort.Slice(due, func(i, j int) bool { return due[i].NextRun.Before(due[j].NextRun) })
	if limit > 0 && len(due) > limit {
		due = due[:limit]
	}
	for _, s := range due {
		f.claimed[s.ID] = true
	}
	return due, nil
}

func (f *fakeScheduleStore) AdvanceSchedule(_ context.Context, _ DBTX, _, id string, nextRun, firedAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.advanceErrFor[id]; err != nil {
		delete(f.claimed, id)
		return err
	}
	s, ok := f.schedules[id]
	if !ok {
		return ErrNotFound
	}
	s.NextRun = nextRun
	ft := firedAt
	s.LastFiredAt = &ft
	delete(f.claimed, id)
	return nil
}

func (f *fakeScheduleStore) get(id string) *Schedule {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.schedules[id]
	cp := *s
	return &cp
}

// fakeRunner runs fn immediately with a nil DBTX, recording the number of
// transaction boundaries opened (to prove claim and advance use SEPARATE
// transactions per fired schedule).
type fakeRunner struct {
	mu    sync.Mutex
	txOps int
}

func (r *fakeRunner) RunSystemTx(ctx context.Context, fn func(db DBTX) error) error {
	r.mu.Lock()
	r.txOps++
	r.mu.Unlock()
	return fn(nil)
}

// fakeSink records the drill-request payloads emitted, transactionally with the
// advance (here just appended).
type fakeSink struct {
	mu       sync.Mutex
	requests []drillRequest
}

func (s *fakeSink) emit(_ context.Context, _ DBTX, _ string, payload drillRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, payload)
	return nil
}

func (s *fakeSink) all() []drillRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]drillRequest, len(s.requests))
	copy(out, s.requests)
	return out
}

func newTestScheduler(t *testing.T, store scheduleClaimer, sink eventSink, now time.Time) (*Scheduler, *fakeRunner) {
	t.Helper()
	runner := &fakeRunner{}
	sch, err := NewScheduler(SchedulerConfig{
		runner:    runner,
		claimer:   store,
		sink:      sink,
		BatchSize: 16,
		Now:       func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}
	return sch, runner
}

// TestScheduler_FiresOnlyDueAndAdvances asserts the loop fires only the schedules
// whose next_run is due, requests a drill for each, and advances next_run to the
// next cron fire time — leaving not-yet-due and disabled schedules untouched.
func TestScheduler_FiresOnlyDueAndAdvances(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:20:00Z")

	due := &Schedule{
		ID: "sched-due", TenantID: "t1", GroupID: "g1", Name: "due",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-13T10:15:00Z"), // <= now : due
	}
	future := &Schedule{
		ID: "sched-future", TenantID: "t1", GroupID: "g2", Name: "future",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-13T10:30:00Z"), // > now : not due
	}
	disabled := &Schedule{
		ID: "sched-disabled", TenantID: "t1", GroupID: "g3", Name: "disabled",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: false, NextRun: mustTime(t, "2026-06-13T10:00:00Z"), // overdue but disabled
	}

	store := newFakeScheduleStore(due, future, disabled)
	sink := &fakeSink{}
	sch, _ := newTestScheduler(t, store, sink, now)

	fired, err := sch.tick(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if fired != 1 {
		t.Fatalf("fired = %d, want 1 (only the due schedule)", fired)
	}

	reqs := sink.all()
	if len(reqs) != 1 {
		t.Fatalf("emitted %d drill requests, want 1", len(reqs))
	}
	req := reqs[0]
	if req.ScheduleID != "sched-due" || req.GroupID != "g1" || req.Mode != "drill" ||
		req.Profile != ProfileIsolated || req.RTOObjectiveSeconds != 600 || req.InitiatedBy != systemActor {
		t.Fatalf("drill request = %+v, want the due schedule's drill", req)
	}
	if !req.ScheduledFor.Equal(mustTime(t, "2026-06-13T10:15:00Z")) {
		t.Fatalf("scheduled_for = %s, want the due next_run 10:15", req.ScheduledFor.Format(time.RFC3339))
	}

	// The due schedule's next_run advanced to the next */15 fire AFTER now (10:20)
	// = 10:30; the others are untouched.
	if got := store.get("sched-due").NextRun; !got.Equal(mustTime(t, "2026-06-13T10:30:00Z")) {
		t.Fatalf("due next_run = %s, want 10:30", got.Format(time.RFC3339))
	}
	if got := store.get("sched-due").LastFiredAt; got == nil || !got.Equal(now) {
		t.Fatalf("due last_fired_at = %v, want %s", got, now.Format(time.RFC3339))
	}
	if got := store.get("sched-future").NextRun; !got.Equal(mustTime(t, "2026-06-13T10:30:00Z")) {
		t.Fatalf("future next_run = %s, want unchanged 10:30", got.Format(time.RFC3339))
	}
	if store.get("sched-future").LastFiredAt != nil {
		t.Fatal("future schedule should not have fired")
	}
	if store.get("sched-disabled").LastFiredAt != nil {
		t.Fatal("disabled schedule should not have fired")
	}
}

// TestScheduler_SecondTickNoDoubleFire asserts that after a schedule fires and
// advances, an immediate second tick at the same clock does NOT re-fire it
// (next_run is now in the future).
func TestScheduler_SecondTickNoDoubleFire(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:20:00Z")
	due := &Schedule{
		ID: "s1", TenantID: "t1", GroupID: "g1", Name: "due",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-13T10:15:00Z"),
	}
	store := newFakeScheduleStore(due)
	sink := &fakeSink{}
	sch, _ := newTestScheduler(t, store, sink, now)

	if fired, _ := sch.tick(context.Background()); fired != 1 {
		t.Fatalf("first tick fired %d, want 1", fired)
	}
	if fired, _ := sch.tick(context.Background()); fired != 0 {
		t.Fatalf("second tick fired %d, want 0 (no double-fire)", fired)
	}
	if len(sink.all()) != 1 {
		t.Fatalf("emitted %d requests across two ticks, want 1", len(sink.all()))
	}
}

// TestScheduler_OneBadScheduleDoesNotStallBatch asserts a single schedule whose
// advance fails does not prevent the others in the batch from firing.
func TestScheduler_OneBadScheduleDoesNotStallBatch(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:20:00Z")
	good := &Schedule{
		ID: "good", TenantID: "t1", GroupID: "g1", Name: "good",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-13T10:10:00Z"),
	}
	bad := &Schedule{
		ID: "bad", TenantID: "t1", GroupID: "g2", Name: "bad",
		CronExpr: "*/15 * * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-13T10:11:00Z"),
	}
	store := newFakeScheduleStore(good, bad)
	store.advanceErrFor["bad"] = ErrNotFound
	sink := &fakeSink{}
	sch, _ := newTestScheduler(t, store, sink, now)

	fired, err := sch.tick(context.Background())
	if err != nil {
		t.Fatalf("tick returned error %v; a per-schedule failure must be swallowed", err)
	}
	if fired != 1 {
		t.Fatalf("fired = %d, want 1 (good fired, bad failed)", fired)
	}
	if got := store.get("good").NextRun; !got.Equal(mustTime(t, "2026-06-13T10:30:00Z")) {
		t.Fatalf("good next_run = %s, want advanced to 10:30", got.Format(time.RFC3339))
	}
}

// TestScheduler_NothingDue asserts an empty due set fires nothing and opens only
// the single claim transaction.
func TestScheduler_NothingDue(t *testing.T) {
	now := mustTime(t, "2026-06-13T10:00:00Z")
	notDue := &Schedule{
		ID: "s", TenantID: "t1", GroupID: "g1", Name: "s",
		CronExpr: "0 0 * * *", Profile: ProfileIsolated, RTOObjectiveSeconds: 600,
		Enabled: true, NextRun: mustTime(t, "2026-06-14T00:00:00Z"),
	}
	store := newFakeScheduleStore(notDue)
	sink := &fakeSink{}
	sch, runner := newTestScheduler(t, store, sink, now)

	fired, err := sch.tick(context.Background())
	if err != nil || fired != 0 {
		t.Fatalf("tick = (%d, %v), want (0, nil)", fired, err)
	}
	if len(sink.all()) != 0 {
		t.Fatal("no drill should have been requested")
	}
	if runner.txOps != 1 {
		t.Fatalf("opened %d transactions, want 1 (the claim only)", runner.txOps)
	}
}

func TestNewScheduler_Validation(t *testing.T) {
	if _, err := NewScheduler(SchedulerConfig{claimer: newFakeScheduleStore(), sink: &fakeSink{}}); err == nil {
		t.Fatal("expected error when neither Pool nor runner is provided")
	}
	if _, err := NewScheduler(SchedulerConfig{runner: &fakeRunner{}, sink: &fakeSink{}}); err == nil {
		t.Fatal("expected error when neither Store nor claimer is provided")
	}
}
