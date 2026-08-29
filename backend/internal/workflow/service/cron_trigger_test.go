package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cron"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// --- test doubles ------------------------------------------------------------

// fakeStarter records every StartInstance call. It is safe for concurrent use.
type fakeStarter struct {
	mu    sync.Mutex
	calls []startCall
	err   error
	seq   int
}

type startCall struct {
	tenantID string
	userID   string
	req      dto.StartInstanceRequest
}

func (f *fakeStarter) StartInstance(_ context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	f.calls = append(f.calls, startCall{tenantID: tenantID, userID: userID, req: req})
	f.seq++
	return &model.WorkflowInstance{ID: "inst-" + itoa(f.seq), TenantID: tenantID, DefinitionID: req.DefinitionID}, nil
}

func (f *fakeStarter) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeStarter) snapshot() []startCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]startCall, len(f.calls))
	copy(out, f.calls)
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// fakeLister returns a fixed set of definitions.
type fakeLister struct {
	defs []*model.WorkflowDefinition
	err  error
}

func (f *fakeLister) ListActive(_ context.Context) ([]*model.WorkflowDefinition, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.defs, nil
}

// --- helpers -----------------------------------------------------------------

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func scheduleDef(id, tenant, cronExpr string) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:       id,
		TenantID: tenant,
		Name:     "sched-" + id,
		Status:   model.DefinitionStatusActive,
		TriggerConfig: model.TriggerConfig{
			Type: model.TriggerTypeSchedule,
			Cron: cronExpr,
		},
	}
}

// clockAt returns a now-func backed by a mutable pointer so tests can advance
// the clock between ticks.
func clockAt(t *time.Time) func() time.Time {
	return func() time.Time { return *t }
}

// --- tests -------------------------------------------------------------------

func TestCronTrigger_FiresDueScheduleExactlyOnce(t *testing.T) {
	t.Parallel()

	// "*/5 * * * *" fires at minutes 0,5,10,... We seed the scheduler before a
	// fire, advance the clock past one fire, and assert exactly one start; a
	// second tick in the same minute must not double-fire.
	clock := time.Date(2026, 6, 13, 10, 3, 0, 0, time.UTC) // 10:03 — between fires
	starter := &fakeStarter{}
	lister := &fakeLister{defs: []*model.WorkflowDefinition{scheduleDef("def-1", "tenant-a", "*/5 * * * *")}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs:   lister,
		Engine: starter,
		RDB:    newTestRedis(t),
		Logger: zerolog.Nop(),
		Now:    clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()

	// First tick at 10:03 seeds the window; nothing fires.
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("seed tick: %v", err)
	}
	if got := starter.count(); got != 0 {
		t.Fatalf("seed tick fired %d instances, want 0", got)
	}

	// Advance to 10:05 — exactly one fire (the 10:05 cron tick) is now due.
	clock = time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("fire tick: %v", err)
	}
	if got := starter.count(); got != 1 {
		t.Fatalf("after 10:05 tick fired %d instances, want 1", got)
	}

	// A second tick in the SAME minute (10:05) must not double-fire.
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("same-minute tick: %v", err)
	}
	if got := starter.count(); got != 1 {
		t.Fatalf("same-minute tick double-fired: %d instances, want 1", got)
	}

	// Verify the start carried the right tenant/definition/actor.
	calls := starter.snapshot()
	if calls[0].tenantID != "tenant-a" {
		t.Errorf("start tenant = %q, want tenant-a", calls[0].tenantID)
	}
	if calls[0].userID != cronTriggerStartUser {
		t.Errorf("start user = %q, want %q", calls[0].userID, cronTriggerStartUser)
	}
	if calls[0].req.DefinitionID != "def-1" {
		t.Errorf("start definition = %q, want def-1", calls[0].req.DefinitionID)
	}
}

func TestCronTrigger_NotYetDueDoesNotFire(t *testing.T) {
	t.Parallel()

	// Daily at midnight. We seed at 10:00 and advance only to 10:00:30 (well
	// before the next midnight), so nothing should fire.
	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	starter := &fakeStarter{}
	lister := &fakeLister{defs: []*model.WorkflowDefinition{scheduleDef("def-daily", "tenant-b", "0 0 * * *")}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs:     lister,
		Engine:   starter,
		RDB:      newTestRedis(t),
		Logger:   zerolog.Nop(),
		Interval: 30 * time.Second,
		Now:      clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed
		t.Fatalf("seed tick: %v", err)
	}

	// Advance well within the same minute / day — no midnight crossed.
	clock = clock.Add(45 * time.Second)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := starter.count(); got != 0 {
		t.Fatalf("not-yet-due schedule fired %d instances, want 0", got)
	}

	// Advance several minutes — still before midnight, still nothing.
	clock = clock.Add(10 * time.Minute)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("tick2: %v", err)
	}
	if got := starter.count(); got != 0 {
		t.Fatalf("schedule fired %d instances before its time, want 0", got)
	}
}

func TestCronTrigger_FiresEveryMatchingMinuteAcrossWindow(t *testing.T) {
	t.Parallel()

	// Every minute. Seed at 10:00, then jump straight to 10:03: three matching
	// minutes (10:01, 10:02, 10:03) elapsed in the window, so three fires.
	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	starter := &fakeStarter{}
	lister := &fakeLister{defs: []*model.WorkflowDefinition{scheduleDef("def-min", "tenant-c", "* * * * *")}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs:   lister,
		Engine: starter,
		RDB:    newTestRedis(t),
		Logger: zerolog.Nop(),
		Now:    clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed at 10:00
		t.Fatalf("seed tick: %v", err)
	}

	clock = time.Date(2026, 6, 13, 10, 3, 0, 0, time.UTC)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("window tick: %v", err)
	}
	if got := starter.count(); got != 3 {
		t.Fatalf("window (10:00,10:03] fired %d instances, want 3", got)
	}
}

func TestCronTrigger_DedupeAcrossSchedulerInstances(t *testing.T) {
	t.Parallel()

	// Two independent scheduler instances (e.g. a failover where both briefly
	// run) sharing one Redis must fire a given (definition, fire-time) only once.
	rdb := newTestRedis(t)
	starter := &fakeStarter{}
	def := scheduleDef("def-shared", "tenant-d", "*/5 * * * *")
	lister := &fakeLister{defs: []*model.WorkflowDefinition{def}}

	clockA := time.Date(2026, 6, 13, 10, 3, 0, 0, time.UTC)
	clockB := time.Date(2026, 6, 13, 10, 3, 0, 0, time.UTC)

	mk := func(c *time.Time) *CronTriggerScheduler {
		s, err := NewCronTriggerScheduler(CronTriggerConfig{
			Defs:   lister,
			Engine: starter,
			RDB:    rdb,
			Logger: zerolog.Nop(),
			Now:    clockAt(c),
		})
		if err != nil {
			t.Fatalf("NewCronTriggerScheduler: %v", err)
		}
		return s
	}
	a := mk(&clockA)
	b := mk(&clockB)

	ctx := context.Background()
	// Seed both before the 10:05 fire.
	if err := a.Tick(ctx); err != nil {
		t.Fatalf("seed a: %v", err)
	}
	if err := b.Tick(ctx); err != nil {
		t.Fatalf("seed b: %v", err)
	}

	// Both advance past the same fire time and tick.
	clockA = time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)
	clockB = time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)
	if err := a.Tick(ctx); err != nil {
		t.Fatalf("fire a: %v", err)
	}
	if err := b.Tick(ctx); err != nil {
		t.Fatalf("fire b: %v", err)
	}

	if got := starter.count(); got != 1 {
		t.Fatalf("two schedulers fired %d instances for one fire-time, want 1 (Redis dedupe)", got)
	}
}

func TestCronTrigger_NonScheduleDefinitionsIgnored(t *testing.T) {
	t.Parallel()

	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	starter := &fakeStarter{}

	eventDef := &model.WorkflowDefinition{
		ID: "ev", TenantID: "t", Status: model.DefinitionStatusActive,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeEvent, Topic: "x"},
	}
	manualDef := &model.WorkflowDefinition{
		ID: "man", TenantID: "t", Status: model.DefinitionStatusActive,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
	}
	// A schedule trigger with an empty cron must be skipped, not fired or panic.
	emptyCron := &model.WorkflowDefinition{
		ID: "empty", TenantID: "t", Status: model.DefinitionStatusActive,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeSchedule, Cron: ""},
	}
	lister := &fakeLister{defs: []*model.WorkflowDefinition{eventDef, manualDef, emptyCron}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs: lister, Engine: starter, RDB: newTestRedis(t), Logger: zerolog.Nop(), Now: clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed
		t.Fatalf("seed: %v", err)
	}
	clock = clock.Add(time.Hour)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := starter.count(); got != 0 {
		t.Fatalf("non-schedule definitions fired %d instances, want 0", got)
	}
}

func TestCronTrigger_InvalidCronSkippedNotFatal(t *testing.T) {
	t.Parallel()

	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	starter := &fakeStarter{}
	bad := scheduleDef("bad", "t", "not a cron")
	good := scheduleDef("good", "t", "* * * * *")
	lister := &fakeLister{defs: []*model.WorkflowDefinition{bad, good}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs: lister, Engine: starter, RDB: newTestRedis(t), Logger: zerolog.Nop(), Now: clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed
		t.Fatalf("seed: %v", err)
	}
	clock = clock.Add(2 * time.Minute)
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("tick: %v", err)
	}
	// The bad one is skipped; the good one fires for both elapsed minutes.
	if got := starter.count(); got != 2 {
		t.Fatalf("good schedule fired %d, want 2 (bad one skipped, not fatal)", got)
	}
}

func TestCronTrigger_ListErrorReturnedWindowNotAdvanced(t *testing.T) {
	t.Parallel()

	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	starter := &fakeStarter{}
	lister := &fakeLister{defs: []*model.WorkflowDefinition{scheduleDef("d", "t", "* * * * *")}}

	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs: lister, Engine: starter, RDB: newTestRedis(t), Logger: zerolog.Nop(), Now: clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed at 10:00
		t.Fatalf("seed: %v", err)
	}

	// Inject a listing error and advance; Tick must return the error and NOT
	// advance the window, so the next (successful) tick still covers the minute.
	lister.err = errors.New("db down")
	clock = clock.Add(2 * time.Minute) // 10:02
	if err := sched.Tick(ctx); err == nil {
		t.Fatal("expected error when listing fails")
	}
	if got := starter.count(); got != 0 {
		t.Fatalf("fired %d on failed listing, want 0", got)
	}

	// Recover: same clock (10:02). Window is still (10:00,10:02] → two fires.
	lister.err = nil
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("recovery tick: %v", err)
	}
	if got := starter.count(); got != 2 {
		t.Fatalf("after recovery fired %d, want 2 (window not lost)", got)
	}
}

func TestCronTrigger_NextAfterIntegration(t *testing.T) {
	t.Parallel()

	// Independent sanity check that the scheduler's firing aligns with the shared
	// cron package's NextAfter: the fire-time the scheduler dedupes on must be a
	// real NextAfter result.
	expr := "*/5 * * * *"
	s := cron.MustParseCron(expr)
	base := time.Date(2026, 6, 13, 10, 3, 0, 0, time.UTC)
	next := s.NextAfter(base)
	want := time.Date(2026, 6, 13, 10, 5, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("NextAfter(%v) = %v, want %v", base, next, want)
	}

	starter := &fakeStarter{}
	rdb := newTestRedis(t)
	clock := base
	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs:   &fakeLister{defs: []*model.WorkflowDefinition{scheduleDef("d", "t", expr)}},
		Engine: starter, RDB: rdb, Logger: zerolog.Nop(), Now: clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}
	ctx := context.Background()
	if err := sched.Tick(ctx); err != nil { // seed at 10:03
		t.Fatalf("seed: %v", err)
	}
	clock = next // 10:05
	if err := sched.Tick(ctx); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := starter.count(); got != 1 {
		t.Fatalf("fired %d at NextAfter time, want 1", got)
	}
	// The dedupe marker for exactly that fire-time must now exist.
	key := cronFiredMarkerKey("d", want)
	if n, _ := rdb.Exists(ctx, key).Result(); n != 1 {
		t.Fatalf("expected fired-marker %q to exist", key)
	}
}

func TestNewCronTriggerScheduler_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewCronTriggerScheduler(CronTriggerConfig{Engine: &fakeStarter{}}); err == nil {
		t.Error("expected error when Defs is nil")
	}
	if _, err := NewCronTriggerScheduler(CronTriggerConfig{Defs: &fakeLister{}}); err == nil {
		t.Error("expected error when Engine is nil")
	}
	// Defaults applied for interval and clock.
	s, err := NewCronTriggerScheduler(CronTriggerConfig{Defs: &fakeLister{}, Engine: &fakeStarter{}})
	if err != nil {
		t.Fatalf("valid config: %v", err)
	}
	if s.interval != 30*time.Second {
		t.Errorf("default interval = %v, want 30s", s.interval)
	}
	if s.now == nil {
		t.Error("default clock not set")
	}
}

func TestCronTrigger_RunStopsOnContextCancel(t *testing.T) {
	t.Parallel()

	clock := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	sched, err := NewCronTriggerScheduler(CronTriggerConfig{
		Defs:     &fakeLister{},
		Engine:   &fakeStarter{},
		RDB:      newTestRedis(t),
		Logger:   zerolog.Nop(),
		Interval: 10 * time.Millisecond,
		Now:      clockAt(&clock),
	})
	if err != nil {
		t.Fatalf("NewCronTriggerScheduler: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		sched.Run(ctx)
		close(done)
	}()

	// Let it tick a few times then cancel.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
}
