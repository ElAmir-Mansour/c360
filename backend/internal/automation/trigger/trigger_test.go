package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// =============================================================================
// Test doubles
// =============================================================================

// recordingSink captures every FiredTrigger the dispatcher forwards. It can be
// configured to return model.ErrAlreadyExists (DB backstop) or a transient error
// to exercise the dispatcher's branches.
type recordingSink struct {
	mu    sync.Mutex
	fired []FiredTrigger
	// errFor maps a dispatchKey to an error the sink returns for it (once).
	errFor map[string]error
}

func newRecordingSink() *recordingSink {
	return &recordingSink{errFor: map[string]error{}}
}

func (s *recordingSink) Dispatch(_ context.Context, ft FiredTrigger) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err, ok := s.errFor[dispatchKey(ft)]; ok {
		delete(s.errFor, dispatchKey(ft))
		return err
	}
	s.fired = append(s.fired, ft)
	return nil
}

func (s *recordingSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.fired)
}

func (s *recordingSink) snapshot() []FiredTrigger {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]FiredTrigger, len(s.fired))
	copy(out, s.fired)
	return out
}

// fakeLister is an in-memory AutomationLister + ScheduleLister.
type fakeLister struct {
	// byKey indexes automations by tenant|type|topic for ListEnabledByTopic.
	byKey map[string][]*model.Automation
	// schedules is the all-tenant enabled schedule list.
	schedules []*model.Automation
	err       error
}

func (l *fakeLister) ListEnabledByTopic(_ context.Context, tenantID, triggerType, topic string) ([]*model.Automation, error) {
	if l.err != nil {
		return nil, l.err
	}
	return l.byKey[listerKey(tenantID, triggerType, topic)], nil
}

func (l *fakeLister) SystemListEnabledSchedules(_ context.Context) ([]*model.Automation, error) {
	if l.err != nil {
		return nil, l.err
	}
	return l.schedules, nil
}

func listerKey(tenantID, triggerType, topic string) string {
	return tenantID + "|" + triggerType + "|" + topic
}

func (l *fakeLister) add(a *model.Automation, topic string) {
	if l.byKey == nil {
		l.byKey = map[string][]*model.Automation{}
	}
	k := listerKey(a.TenantID, a.Trigger.Type, topic)
	l.byKey[k] = append(l.byKey[k], a)
}

// fakeResolver is an in-memory WebhookResolver keyed by token.
type fakeResolver struct {
	byToken map[string]*model.Automation
}

func (r *fakeResolver) ResolveWebhook(_ context.Context, token string) (*model.Automation, error) {
	a, ok := r.byToken[token]
	if !ok {
		return nil, fmt.Errorf("token: %w", model.ErrNotFound)
	}
	return a, nil
}

// helpers ---------------------------------------------------------------------

const (
	tenantA = "11111111-1111-1111-1111-111111111111"
	autoA   = "22222222-2222-2222-2222-222222222222"
)

func testLogger() zerolog.Logger { return zerolog.Nop() }

// guardedDispatcher builds a Dispatcher backed by a real IdempotencyGuard over
// miniredis, so the exactly-once path is exercised end-to-end (not mocked).
func guardedDispatcher(t *testing.T, sink TriggerSink) (*Dispatcher, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	guard := events.NewIdempotencyGuard(client, time.Hour)
	return NewDispatcher(sink, guard, testLogger()), server
}

func mustEvent(t *testing.T, eventType, tenantID, topic string, data map[string]any) *events.Event {
	t.Helper()
	evt, err := events.NewEvent(eventType, "test", tenantID, data)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	evt.Metadata = map[string]string{"kafka.topic": topic}
	return evt
}

func eventAutomation(filter map[string]any) *model.Automation {
	return &model.Automation{
		ID:       autoA,
		TenantID: tenantA,
		Name:     "event-auto",
		Enabled:  true,
		Trigger: model.TriggerConfig{
			Type:   model.TriggerTypeEvent,
			Topic:  events.Topics.AlertEvents,
			Filter: filter,
		},
	}
}

// =============================================================================
// Dispatcher exactly-once
// =============================================================================

func TestDispatcher_Idempotency(t *testing.T) {
	tests := []struct {
		name      string
		ft        FiredTrigger
		dispatch  int // how many times to dispatch the same ft
		wantFired int
		wantErr   bool
	}{
		{
			name: "single dispatch fires once",
			ft: FiredTrigger{
				AutomationID: autoA, TenantID: tenantA, EventID: "evt-1",
				TriggerType: model.TriggerTypeEvent, Payload: map[string]any{},
			},
			dispatch: 1, wantFired: 1,
		},
		{
			name: "duplicate event id suppressed",
			ft: FiredTrigger{
				AutomationID: autoA, TenantID: tenantA, EventID: "evt-dup",
				TriggerType: model.TriggerTypeEvent, Payload: map[string]any{},
			},
			dispatch: 3, wantFired: 1,
		},
		{
			name: "missing fields rejected",
			ft: FiredTrigger{
				AutomationID: "", TenantID: tenantA, EventID: "evt-x",
			},
			dispatch: 1, wantFired: 0, wantErr: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sink := newRecordingSink()
			d, _ := guardedDispatcher(t, sink)
			var lastErr error
			for i := 0; i < tc.dispatch; i++ {
				lastErr = d.Dispatch(context.Background(), tc.ft)
			}
			if tc.wantErr && lastErr == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tc.wantErr && lastErr != nil {
				t.Fatalf("unexpected error: %v", lastErr)
			}
			if got := sink.count(); got != tc.wantFired {
				t.Fatalf("fired = %d, want %d", got, tc.wantFired)
			}
		})
	}
}

func TestDispatcher_DistinctAutomationsSameEvent(t *testing.T) {
	// Two automations matching one source event must EACH fire once: the dedupe
	// key combines automation id + event id, so they don't suppress each other.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	base := FiredTrigger{TenantID: tenantA, EventID: "shared-evt", TriggerType: model.TriggerTypeEvent, Payload: map[string]any{}}

	ft1 := base
	ft1.AutomationID = "auto-1"
	ft2 := base
	ft2.AutomationID = "auto-2"

	for _, ft := range []FiredTrigger{ft1, ft1, ft2, ft2} { // each twice
		if err := d.Dispatch(context.Background(), ft); err != nil {
			t.Fatalf("dispatch: %v", err)
		}
	}
	if got := sink.count(); got != 2 {
		t.Fatalf("fired = %d, want 2 (one per automation)", got)
	}
}

func TestDispatcher_DBBackstopSuppresses(t *testing.T) {
	// When the sink returns ErrAlreadyExists (the unique backstop), the
	// dispatcher treats it as a benign suppression: no error, marks processed.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	ft := FiredTrigger{AutomationID: autoA, TenantID: tenantA, EventID: "evt-backstop", TriggerType: model.TriggerTypeEvent, Payload: map[string]any{}}
	sink.errFor[dispatchKey(ft)] = fmt.Errorf("run: %w", model.ErrAlreadyExists)

	if err := d.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("backstop dispatch should not error, got %v", err)
	}
	if got := sink.count(); got != 0 {
		t.Fatalf("sink recorded %d, want 0 (backstop rejected the row)", got)
	}
	// A subsequent dispatch is suppressed by the now-marked guard key.
	if err := d.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("second dispatch: %v", err)
	}
	if got := sink.count(); got != 0 {
		t.Fatalf("sink recorded %d after retry, want 0", got)
	}
}

func TestDispatcher_TransientErrorReleasesLock(t *testing.T) {
	// A transient sink error must release the lock so a redelivery retries and
	// succeeds (not be wrongly suppressed).
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	ft := FiredTrigger{AutomationID: autoA, TenantID: tenantA, EventID: "evt-transient", TriggerType: model.TriggerTypeEvent, Payload: map[string]any{}}
	sink.errFor[dispatchKey(ft)] = fmt.Errorf("temporary db outage")

	if err := d.Dispatch(context.Background(), ft); err == nil {
		t.Fatalf("expected transient error to propagate")
	}
	// Redelivery: the lock was released, so it now goes through and fires.
	if err := d.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("retry after transient failure: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1 after retry", got)
	}
}

func TestDispatcher_NoGuard(t *testing.T) {
	// With a nil guard the dispatcher still forwards to the sink (relying on the
	// DB backstop for exactly-once) — air-gapped / Redis-less deployments.
	sink := newRecordingSink()
	d := NewDispatcher(sink, nil, testLogger())
	ft := FiredTrigger{AutomationID: autoA, TenantID: tenantA, EventID: "evt-noguard", TriggerType: model.TriggerTypeEvent, Payload: map[string]any{}}
	if err := d.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1", got)
	}
}

// =============================================================================
// Event source: filter matching pass + fail
// =============================================================================

func TestEventSource_FilterMatching(t *testing.T) {
	tests := []struct {
		name      string
		filter    map[string]any
		eventData map[string]any
		wantFired bool
	}{
		{
			name:      "empty filter matches any event",
			filter:    nil,
			eventData: map[string]any{"severity": "low"},
			wantFired: true,
		},
		{
			name:      "exact string match fires",
			filter:    map[string]any{"severity": "critical"},
			eventData: map[string]any{"severity": "critical", "asset": "db-1"},
			wantFired: true,
		},
		{
			name:      "non-matching value does not fire",
			filter:    map[string]any{"severity": "critical"},
			eventData: map[string]any{"severity": "low"},
			wantFired: false,
		},
		{
			name:      "missing field does not fire",
			filter:    map[string]any{"severity": "critical"},
			eventData: map[string]any{"asset": "db-1"},
			wantFired: false,
		},
		{
			name:      "numeric coercion across int filter / float event",
			filter:    map[string]any{"count": 5},
			eventData: map[string]any{"count": 5.0},
			wantFired: true,
		},
		{
			name:      "dotted path filter matches nested field",
			filter:    map[string]any{"meta.region": "ksa"},
			eventData: map[string]any{"meta": map[string]any{"region": "ksa"}},
			wantFired: true,
		},
		{
			name:      "all-of: one mismatch fails the whole filter",
			filter:    map[string]any{"severity": "critical", "env": "prod"},
			eventData: map[string]any{"severity": "critical", "env": "staging"},
			wantFired: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sink := newRecordingSink()
			d, _ := guardedDispatcher(t, sink)
			lister := &fakeLister{}
			lister.add(eventAutomation(tc.filter), events.Topics.AlertEvents)

			// NewEventSource requires a live Consumer (for Start); these tests
			// exercise the handler path directly, so construct the struct with the
			// handler dependencies only.
			src := &EventSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

			evt := mustEvent(t, "com.clario360.cyber.alert.raised", tenantA, events.Topics.AlertEvents, tc.eventData)
			if err := src.HandleEvent(context.Background(), evt); err != nil {
				t.Fatalf("HandleEvent: %v", err)
			}
			fired := sink.count() == 1
			if fired != tc.wantFired {
				t.Fatalf("fired = %v, want %v", fired, tc.wantFired)
			}
			if tc.wantFired {
				ft := sink.snapshot()[0]
				if ft.AutomationID != autoA || ft.TenantID != tenantA || ft.EventID != evt.ID {
					t.Fatalf("FiredTrigger mismatch: %+v", ft)
				}
				if ft.TriggerType != model.TriggerTypeEvent {
					t.Fatalf("trigger type = %q", ft.TriggerType)
				}
				// payload carries the trigger.data shape for the rule engine.
				trig, _ := ft.Payload["trigger"].(map[string]any)
				if trig == nil || trig["data"] == nil {
					t.Fatalf("payload missing trigger.data: %+v", ft.Payload)
				}
			}
		})
	}
}

func TestEventSource_NoTenantSkipped(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{}
	lister.add(eventAutomation(nil), events.Topics.AlertEvents)
	src := &EventSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

	evt := mustEvent(t, "com.clario360.cyber.alert.raised", tenantA, events.Topics.AlertEvents, map[string]any{})
	evt.TenantID = "" // strip tenant
	if err := src.HandleEvent(context.Background(), evt); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := sink.count(); got != 0 {
		t.Fatalf("fired = %d, want 0 (no tenant)", got)
	}
}

func TestEventSource_ListerErrorPropagates(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{err: fmt.Errorf("db down")}
	src := &EventSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

	evt := mustEvent(t, "com.clario360.cyber.alert.raised", tenantA, events.Topics.AlertEvents, map[string]any{})
	if err := src.HandleEvent(context.Background(), evt); err == nil {
		t.Fatalf("expected lister error to propagate so the consumer retries")
	}
}

func TestEventSource_IdempotencySuppressesDuplicate(t *testing.T) {
	// Delivering the SAME event twice (a Kafka redelivery) fires the automation
	// once — the exactly-once guarantee at the source level.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{}
	lister.add(eventAutomation(map[string]any{"severity": "critical"}), events.Topics.AlertEvents)
	src := &EventSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

	evt := mustEvent(t, "com.clario360.cyber.alert.raised", tenantA, events.Topics.AlertEvents, map[string]any{"severity": "critical"})
	for i := 0; i < 3; i++ {
		if err := src.HandleEvent(context.Background(), evt); err != nil {
			t.Fatalf("HandleEvent #%d: %v", i, err)
		}
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1 (duplicate event id suppressed)", got)
	}
}

// =============================================================================
// Threshold source: crossing pass + fail
// =============================================================================

func thresholdAutomation(field, op string, value float64) *model.Automation {
	return &model.Automation{
		ID:       autoA,
		TenantID: tenantA,
		Name:     "threshold-auto",
		Enabled:  true,
		Trigger: model.TriggerConfig{
			Type:           model.TriggerTypeThreshold,
			Topic:          events.Topics.AlertEvents,
			ThresholdField: field,
			ThresholdOp:    op,
			ThresholdValue: value,
		},
	}
}

func TestThresholdSource_Crossing(t *testing.T) {
	tests := []struct {
		name      string
		field     string
		op        string
		value     float64
		eventData map[string]any
		wantFired bool
	}{
		{"gt fires above bound", "risk_score", model.ThresholdOpGT, 80, map[string]any{"risk_score": 90.0}, true},
		{"gt does not fire at bound", "risk_score", model.ThresholdOpGT, 80, map[string]any{"risk_score": 80.0}, false},
		{"gte fires at bound", "risk_score", model.ThresholdOpGTE, 80, map[string]any{"risk_score": 80.0}, true},
		{"lt fires below bound", "lag_seconds", model.ThresholdOpLT, 5, map[string]any{"lag_seconds": 2.0}, true},
		{"lte fires at bound", "lag_seconds", model.ThresholdOpLTE, 5, map[string]any{"lag_seconds": 5.0}, true},
		{"eq fires on equal", "count", model.ThresholdOpEQ, 3, map[string]any{"count": 3.0}, true},
		{"neq fires on different", "count", model.ThresholdOpNEQ, 3, map[string]any{"count": 4.0}, true},
		{"below gt does not fire", "risk_score", model.ThresholdOpGT, 80, map[string]any{"risk_score": 50.0}, false},
		{"absent field does not fire", "risk_score", model.ThresholdOpGT, 80, map[string]any{"other": 99.0}, false},
		{"non-numeric field does not fire", "risk_score", model.ThresholdOpGT, 80, map[string]any{"risk_score": "high"}, false},
		{"dotted path field", "metrics.cpu", model.ThresholdOpGT, 0.9, map[string]any{"metrics": map[string]any{"cpu": 0.95}}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sink := newRecordingSink()
			d, _ := guardedDispatcher(t, sink)
			lister := &fakeLister{}
			lister.add(thresholdAutomation(tc.field, tc.op, tc.value), events.Topics.AlertEvents)
			src := &ThresholdSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

			evt := mustEvent(t, "com.clario360.cyber.alert.raised", tenantA, events.Topics.AlertEvents, tc.eventData)
			if err := src.HandleEvent(context.Background(), evt); err != nil {
				t.Fatalf("HandleEvent: %v", err)
			}
			fired := sink.count() == 1
			if fired != tc.wantFired {
				t.Fatalf("fired = %v, want %v", fired, tc.wantFired)
			}
			if tc.wantFired {
				ft := sink.snapshot()[0]
				if ft.TriggerType != model.TriggerTypeThreshold {
					t.Fatalf("trigger type = %q", ft.TriggerType)
				}
				trig, _ := ft.Payload["trigger"].(map[string]any)
				th, _ := trig["threshold"].(map[string]any)
				if th == nil || th["field"] != tc.field {
					t.Fatalf("payload missing threshold context: %+v", ft.Payload)
				}
			}
		})
	}
}

// =============================================================================
// Schedule source: cron loop fires once when due
// =============================================================================

func scheduleAutomation(id, cron string) *model.Automation {
	return &model.Automation{
		ID:       id,
		TenantID: tenantA,
		Name:     "schedule-" + id,
		Enabled:  true,
		Trigger:  model.TriggerConfig{Type: model.TriggerTypeSchedule, Cron: cron},
	}
}

func TestScheduleSource_FiresWhenDue(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{schedules: []*model.Automation{scheduleAutomation("sched-1", "*/5 * * * *")}}

	// Control the clock. Start at 10:00:30 — the first tick SEEDS the next fire
	// (10:05) without firing.
	clock := time.Date(2026, 6, 13, 10, 0, 30, 0, time.UTC)
	src, err := NewScheduleSource(ScheduleSourceConfig{
		Lister: lister, Dispatcher: d, Interval: time.Second,
		Now:    func() time.Time { return clock },
		Logger: testLogger(),
	})
	if err != nil {
		t.Fatalf("NewScheduleSource: %v", err)
	}

	// Tick 1: seeds, fires nothing.
	if err := src.Tick(context.Background()); err != nil {
		t.Fatalf("tick 1: %v", err)
	}
	if got := sink.count(); got != 0 {
		t.Fatalf("after seed tick fired = %d, want 0", got)
	}

	// Advance past the next boundary (10:05). Tick 2 fires exactly once.
	clock = time.Date(2026, 6, 13, 10, 5, 10, 0, time.UTC)
	if err := src.Tick(context.Background()); err != nil {
		t.Fatalf("tick 2: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("after due tick fired = %d, want 1", got)
	}

	// Tick 3 at the same minute must NOT re-fire (next advanced to 10:10).
	if err := src.Tick(context.Background()); err != nil {
		t.Fatalf("tick 3: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("re-tick fired = %d, want still 1", got)
	}

	ft := sink.snapshot()[0]
	if ft.TriggerType != model.TriggerTypeSchedule || ft.AutomationID != "sched-1" {
		t.Fatalf("FiredTrigger mismatch: %+v", ft)
	}
	if !strings.HasPrefix(ft.EventID, "schedule:sched-1:") {
		t.Fatalf("schedule event id = %q, want stable schedule key", ft.EventID)
	}
}

func TestScheduleSource_OverlappingTickDeduped(t *testing.T) {
	// Two leaders (or a restart) firing the same due minute resolve to the same
	// EventID; the shared guard makes the run fire once. Simulate by running two
	// sources sharing ONE dispatcher (one guard) for the same due window.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{schedules: []*model.Automation{scheduleAutomation("sched-x", "*/5 * * * *")}}

	mk := func(seed time.Time) *ScheduleSource {
		clk := seed
		src, _ := NewScheduleSource(ScheduleSourceConfig{
			Lister: lister, Dispatcher: d, Now: func() time.Time { return clk }, Logger: testLogger(),
		})
		// seed each at 10:00, then push to fire the 10:05 window.
		_ = src.Tick(context.Background())
		clk = time.Date(2026, 6, 13, 10, 5, 10, 0, time.UTC)
		src.now = func() time.Time { return clk }
		return src
	}
	leaderA := mk(time.Date(2026, 6, 13, 10, 0, 30, 0, time.UTC))
	leaderB := mk(time.Date(2026, 6, 13, 10, 0, 45, 0, time.UTC))

	if err := leaderA.Tick(context.Background()); err != nil {
		t.Fatalf("leaderA: %v", err)
	}
	if err := leaderB.Tick(context.Background()); err != nil {
		t.Fatalf("leaderB: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("overlapping leaders fired = %d, want 1 (same schedule minute deduped)", got)
	}
}

func TestScheduleSource_RunStopsOnContextCancel(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{}
	src, err := NewScheduleSource(ScheduleSourceConfig{Lister: lister, Dispatcher: d, Interval: 10 * time.Millisecond, Logger: testLogger()})
	if err != nil {
		t.Fatalf("NewScheduleSource: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- src.Run(ctx) }()
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatalf("Run returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("Run did not stop on cancel")
	}
}

// =============================================================================
// Manual source
// =============================================================================

func TestManualSource_Invoke(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	src, err := NewManualSource(d, testLogger())
	if err != nil {
		t.Fatalf("NewManualSource: %v", err)
	}

	body := map[string]any{"reason": "manual run", "ticket": "INC-9"}
	if err := src.Invoke(context.Background(), tenantA, autoA, "user-7", body); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1", got)
	}
	ft := sink.snapshot()[0]
	if ft.TriggerType != model.TriggerTypeManual || ft.AutomationID != autoA || ft.TenantID != tenantA {
		t.Fatalf("FiredTrigger mismatch: %+v", ft)
	}
	trig, _ := ft.Payload["trigger"].(map[string]any)
	if trig["invoked_by"] != "user-7" {
		t.Fatalf("payload missing invoked_by: %+v", ft.Payload)
	}
	data, _ := trig["data"].(map[string]any)
	if data["ticket"] != "INC-9" {
		t.Fatalf("payload missing body data: %+v", ft.Payload)
	}
}

func TestManualSource_DistinctInvocationsAreDistinctRuns(t *testing.T) {
	// Each Invoke generates a fresh EventID, so two deliberate invocations are
	// two runs (operator re-run is allowed).
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	src, _ := NewManualSource(d, testLogger())
	for i := 0; i < 2; i++ {
		if err := src.Invoke(context.Background(), tenantA, autoA, "user-7", nil); err != nil {
			t.Fatalf("Invoke #%d: %v", i, err)
		}
	}
	if got := sink.count(); got != 2 {
		t.Fatalf("fired = %d, want 2 distinct runs", got)
	}
}

func TestManualSource_RetryWithSameEventIDSuppressed(t *testing.T) {
	// Re-invoking with the SAME caller-supplied EventID is idempotent.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	src, _ := NewManualSource(d, testLogger())
	for i := 0; i < 3; i++ {
		if err := src.InvokeWithEventID(context.Background(), tenantA, autoA, "user-7", "idem-key-1", nil); err != nil {
			t.Fatalf("InvokeWithEventID #%d: %v", i, err)
		}
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1 (same idempotency key)", got)
	}
}

func TestManualSource_RejectsMissingIDs(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	src, _ := NewManualSource(d, testLogger())
	if err := src.Invoke(context.Background(), "", autoA, "u", nil); err == nil {
		t.Fatalf("expected error for empty tenant")
	}
	if err := src.InvokeWithEventID(context.Background(), tenantA, autoA, "u", "", nil); err == nil {
		t.Fatalf("expected error for empty event id")
	}
}

// =============================================================================
// Webhook source: body parse + token resolution
// =============================================================================

func webhookAutomation(token string) *model.Automation {
	return &model.Automation{
		ID:       autoA,
		TenantID: tenantA,
		Name:     "webhook-auto",
		Enabled:  true,
		Trigger:  model.TriggerConfig{Type: model.TriggerTypeWebhook, WebhookToken: token},
	}
}

func TestWebhookSource_BodyParse(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantKey  string // a key expected in the parsed trigger.data
		wantVal  any
		rawValue bool // expect the "raw" fallback
	}{
		{name: "json object", body: `{"event":"push","count":3}`, wantKey: "event", wantVal: "push"},
		{name: "json array under value", body: `[1,2,3]`, wantKey: "value"},
		{name: "non-json raw text", body: `hello world`, wantKey: "raw", wantVal: "hello world", rawValue: true},
		{name: "empty body", body: ``, wantKey: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sink := newRecordingSink()
			d, _ := guardedDispatcher(t, sink)
			resolver := &fakeResolver{byToken: map[string]*model.Automation{"tok-1": webhookAutomation("tok-1")}}
			src, err := NewWebhookSource(resolver, d, testLogger())
			if err != nil {
				t.Fatalf("NewWebhookSource: %v", err)
			}

			eventID, ft, status, err := src.buildFiredTrigger(context.Background(), "tok-1", []byte(tc.body))
			if err != nil {
				t.Fatalf("buildFiredTrigger: %v", err)
			}
			if status != http.StatusAccepted {
				t.Fatalf("status = %d, want 202", status)
			}
			if ft.AutomationID != autoA || ft.TenantID != tenantA || ft.TriggerType != model.TriggerTypeWebhook {
				t.Fatalf("FiredTrigger mismatch: %+v", ft)
			}
			if eventID == "" || !strings.HasPrefix(eventID, "webhook:"+autoA+":") {
				t.Fatalf("event id = %q, want content-derived webhook key", eventID)
			}
			trig := ft.Payload["trigger"].(map[string]any)
			data := trig["data"].(map[string]any)
			if tc.wantKey != "" {
				v, ok := data[tc.wantKey]
				if !ok {
					t.Fatalf("parsed data missing key %q: %+v", tc.wantKey, data)
				}
				if tc.wantVal != nil && v != tc.wantVal {
					t.Fatalf("data[%q] = %v, want %v", tc.wantKey, v, tc.wantVal)
				}
			} else if len(data) != 0 {
				t.Fatalf("expected empty data for empty body, got %+v", data)
			}
		})
	}
}

func TestWebhookSource_UnknownToken404(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	resolver := &fakeResolver{byToken: map[string]*model.Automation{}}
	src, _ := NewWebhookSource(resolver, d, testLogger())

	_, _, status, err := src.buildFiredTrigger(context.Background(), "nope", []byte(`{}`))
	if err == nil {
		t.Fatalf("expected error for unknown token")
	}
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
}

func TestWebhookSource_HTTPHandlerFires(t *testing.T) {
	// End-to-end through the net/http handler: a POST with a JSON body fires the
	// automation once and returns 202.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	resolver := &fakeResolver{byToken: map[string]*model.Automation{"tok-http": webhookAutomation("tok-http")}}
	src, _ := NewWebhookSource(resolver, d, testLogger())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/automation/webhooks/tok-http", strings.NewReader(`{"event":"deploy"}`))
	rec := httptest.NewRecorder()
	src.HandleToken(rec, req, "tok-http")

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1", got)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not json: %v", err)
	}
	data, _ := resp["data"].(map[string]any)
	if data == nil || data["accepted"] != true {
		t.Fatalf("response missing accepted: %s", rec.Body.String())
	}
}

func TestWebhookSource_SameBodyRetryDeduped(t *testing.T) {
	// Webhook at-least-once delivery: the same token + same body retried fires
	// the automation once (content-derived EventID + guard).
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	resolver := &fakeResolver{byToken: map[string]*model.Automation{"tok-r": webhookAutomation("tok-r")}}
	src, _ := NewWebhookSource(resolver, d, testLogger())

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"id":"abc"}`))
		rec := httptest.NewRecorder()
		src.HandleToken(rec, req, "tok-r")
		if rec.Code != http.StatusAccepted {
			t.Fatalf("retry #%d status = %d", i, rec.Code)
		}
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1 (identical retried payload deduped)", got)
	}
}

func TestWebhookSource_DifferentBodyNewRun(t *testing.T) {
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	resolver := &fakeResolver{byToken: map[string]*model.Automation{"tok-d": webhookAutomation("tok-d")}}
	src, _ := NewWebhookSource(resolver, d, testLogger())

	for _, b := range []string{`{"id":"one"}`, `{"id":"two"}`} {
		req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(b))
		rec := httptest.NewRecorder()
		src.HandleToken(rec, req, "tok-d")
	}
	if got := sink.count(); got != 2 {
		t.Fatalf("fired = %d, want 2 (distinct payloads)", got)
	}
}

// =============================================================================
// topic mapping fallback (used when an event has no kafka.topic metadata)
// =============================================================================

func TestTopicForEventType(t *testing.T) {
	tests := []struct {
		eventType string
		want      string
	}{
		{"com.clario360.cyber.alert.raised", events.Topics.AlertEvents},
		{"com.clario360.cyber.risk.scored", events.Topics.RiskEvents},
		{"com.clario360.datastream.dr.rpo_breach", events.Topics.DREvents},
		{"com.clario360.workflow.instance.completed", events.Topics.WorkflowEvents},
		{"com.clario360.unknown.thing.happened", ""},
		{"not-a-clario-type", ""},
	}
	for _, tc := range tests {
		t.Run(tc.eventType, func(t *testing.T) {
			if got := topicForEventType(tc.eventType); got != tc.want {
				t.Fatalf("topicForEventType(%q) = %q, want %q", tc.eventType, got, tc.want)
			}
		})
	}
}

func TestEventSource_TopicFallbackFromType(t *testing.T) {
	// When kafka.topic metadata is absent, the source derives the topic from the
	// event type so a directly-handed event still resolves automations.
	sink := newRecordingSink()
	d, _ := guardedDispatcher(t, sink)
	lister := &fakeLister{}
	lister.add(eventAutomation(nil), events.Topics.AlertEvents)
	src := &EventSource{lister: lister, dispatcher: d, topics: []string{events.Topics.AlertEvents}, logger: testLogger()}

	evt, err := events.NewEvent("com.clario360.cyber.alert.raised", "test", tenantA, map[string]any{"severity": "high"})
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	evt.Metadata = nil // no kafka.topic
	if err := src.HandleEvent(context.Background(), evt); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	if got := sink.count(); got != 1 {
		t.Fatalf("fired = %d, want 1 (topic derived from type)", got)
	}
}
