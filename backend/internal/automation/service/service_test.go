package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
	"github.com/clario360/platform/internal/automation/rule"
	"github.com/clario360/platform/internal/automation/trigger"
)

// =============================================================================
// Extend the shared memStore (orchestrator_test.go) with the automation/rule/run
// surfaces the AutomationService needs, so one in-memory fake backs the whole
// trigger->rule->run->orchestrate path end to end with no database and no bus.
// =============================================================================

type fakeServiceStore struct {
	*memStore
	mu          sync.Mutex
	automations map[string]*model.Automation // id -> automation
	rules       map[string][]model.Rule      // automation_id -> rules
	webhooks    map[string]string            // token -> automation_id
	createdRuns []*model.Run                 // runs created via CreateRun, in order
}

func newFakeServiceStore() *fakeServiceStore {
	return &fakeServiceStore{
		memStore:    newMemStore(),
		automations: map[string]*model.Automation{},
		rules:       map[string][]model.Rule{},
		webhooks:    map[string]string{},
	}
}

func (f *fakeServiceStore) putAutomation(a *model.Automation, rules []model.Rule) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *a
	f.automations[a.ID] = &cp
	f.rules[a.ID] = append([]model.Rule(nil), rules...)
	if a.Trigger.Type == model.TriggerTypeWebhook && a.Trigger.WebhookToken != "" {
		f.webhooks[a.Trigger.WebhookToken] = a.ID
	}
}

func (f *fakeServiceStore) GetAutomation(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.automations[id]
	if !ok || a.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	cp := *a
	// Model production: GetAutomation eager-loads rules.
	cp.Rules = append([]model.Rule(nil), f.rules[id]...)
	return &cp, nil
}

func (f *fakeServiceStore) ListAutomationRules(_ context.Context, _ repository.DBTX, tenantID, automationID string) ([]model.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]model.Rule(nil), f.rules[automationID]...), nil
}

func (f *fakeServiceStore) CreateRun(_ context.Context, _ repository.DBTX, run *model.Run) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Enforce the (tenant_id, source_event_id) UNIQUE backstop.
	for _, existing := range f.createdRuns {
		if existing.TenantID == run.TenantID && existing.SourceEventID == run.SourceEventID {
			return model.ErrAlreadyExists
		}
	}
	run.ID = "run-" + run.SourceEventID
	run.StartedAt = time.Now().UTC()
	run.UpdatedAt = run.StartedAt
	cp := *run
	f.createdRuns = append(f.createdRuns, &cp)
	// Also register in the memStore so the orchestrator can claim/advance it.
	f.memStore.putRun(&cp)
	return nil
}

func (f *fakeServiceStore) ListEnabledByTopic(_ context.Context, _ repository.DBTX, tenantID, triggerType, topic string) ([]*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*model.Automation
	for _, a := range f.automations {
		if a.TenantID == tenantID && a.Enabled && a.Trigger.Type == triggerType && a.Trigger.Topic == topic {
			cp := *a
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (f *fakeServiceStore) SystemListEnabledSchedules(_ context.Context, _ repository.DBTX) ([]*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*model.Automation
	for _, a := range f.automations {
		if a.Enabled && a.Trigger.Type == model.TriggerTypeSchedule {
			cp := *a
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (f *fakeServiceStore) SystemResolveWebhook(_ context.Context, _ repository.DBTX, token string) (*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.webhooks[token]
	if !ok {
		return nil, model.ErrNotFound
	}
	a, ok := f.automations[id]
	if !ok || !a.Enabled {
		return nil, model.ErrNotFound
	}
	cp := *a
	return &cp, nil
}

func (f *fakeServiceStore) runCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.createdRuns)
}

func (f *fakeServiceStore) lastRun() *model.Run {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.createdRuns) == 0 {
		return nil
	}
	return f.createdRuns[len(f.createdRuns)-1]
}

// orchestratorBridge wraps the fake store so its EnsureRunStep (which takes no
// DBTX in the memStore) satisfies the orchestrator's DBTX-taking Repository, the
// same trick repoAdapter uses.
type orchestratorBridge struct{ *fakeServiceStore }

func (b orchestratorBridge) EnsureRunStep(ctx context.Context, db repository.DBTX, tenantID string, s *model.RunStep) error {
	return b.memStore.EnsureRunStep(ctx, tenantID, s)
}

// Compile-time proof the bridge satisfies every surface NewService demands.
var (
	_ ServiceRepository = orchestratorBridge{}
	_ Repository        = orchestratorBridge{}
	_ GateRepository    = orchestratorBridge{}
	_ Claimer           = orchestratorBridge{}
	_ GateLister        = orchestratorBridge{}
	_ RunbookReader     = orchestratorBridge{}
)

// inMemRunners builds the three transaction runners NewService needs, all backed
// by the same store with no real database. tenantTx/tenantRead pass the tenant id
// through and run fn directly; systemRead runs fn directly (cross-tenant).
func inMemRunners() (tenantTxFn, tenantTxFn, systemReadFn) {
	tx := func(_ context.Context, _ string, fn func(db repository.DBTX) error) error { return fn(nil) }
	read := func(_ context.Context, _ string, fn func(db repository.DBTX) error) error { return fn(nil) }
	sys := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }
	return tx, read, sys
}

// inMemLoopRunners builds the leader loop's own system tx/read runners against
// the store with no database, so the assembled loop is constructible in tests.
func inMemLoopRunners() (txRunner, readRunner) {
	tx := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }
	read := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }
	return tx, read
}

func newTestService(t *testing.T, store *fakeServiceStore, exec ActionExecutor) *AutomationService {
	t.Helper()
	bridge := orchestratorBridge{store}
	txn, read, sys := inMemRunners()
	loopTx, loopRead := inMemLoopRunners()
	svc, err := NewService(Config{
		Repository:     bridge,
		Engine:         rule.NewEngine(zerolog.Nop(), rule.Options{}),
		Executor:       exec,
		Events:         &recordingSink{}, // avoid the production OutboxSink (needs a real tx)
		TenantTx:       txn,
		TenantRead:     read,
		SystemRead:     sys,
		LoopTxRunner:   loopTx,
		LoopReadRunner: loopRead,
		Logger:         zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

// =============================================================================
// Builders
// =============================================================================

func seedEventAutomation(store *fakeServiceStore, id, topic string, rules []model.Rule) *model.Automation {
	a := &model.Automation{
		ID:        id,
		TenantID:  tnt,
		Name:      id,
		Enabled:   true,
		RunbookID: "rb-" + id,
		Trigger:   model.TriggerConfig{Type: model.TriggerTypeEvent, Topic: topic},
	}
	store.putAutomation(a, rules)
	// Seed a one-action runbook so the orchestrator has something to drive.
	store.putRunbook(&model.Runbook{
		ID:       a.RunbookID,
		TenantID: tnt,
		Name:     "rb-" + id,
		Steps: []model.RunbookStep{
			{ID: "s0", RunbookID: a.RunbookID, Index: 0, Type: model.StepTypeAction,
				Action: model.ActionRef{Kind: model.ActionNotification, Config: map[string]any{"to": "soc"}}},
		},
	})
	return a
}

func critRule() model.Rule {
	return model.Rule{
		ID:       "r-crit",
		Priority: 10,
		When:     []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
		ActionRef: model.ActionRef{
			Kind:   model.ActionNotification,
			Config: map[string]any{"to": "soc"},
		},
	}
}

func eventTriggerFired(automationID, eventID, severity string) trigger.FiredTrigger {
	return trigger.FiredTrigger{
		AutomationID: automationID,
		TenantID:     tnt,
		EventID:      eventID,
		TriggerType:  model.TriggerTypeEvent,
		Payload: map[string]any{
			"trigger": map[string]any{
				"type": model.TriggerTypeEvent,
				"data": map[string]any{"severity": severity},
			},
		},
	}
}

// =============================================================================
// Trigger -> rule -> run handoff tests
// =============================================================================

func TestDispatch_MatchingRuleCreatesRun(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-1", "cyber.alert.events", []model.Rule{critRule()})
	svc := newTestService(t, store, newFakeExecutor())

	ft := eventTriggerFired("auto-1", "evt-1", "critical")
	if err := svc.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}

	if store.runCount() != 1 {
		t.Fatalf("expected exactly 1 run created, got %d", store.runCount())
	}
	run := store.lastRun()
	if run.AutomationID != "auto-1" {
		t.Errorf("run.AutomationID = %q, want auto-1", run.AutomationID)
	}
	if run.RunbookID != "rb-auto-1" {
		t.Errorf("run.RunbookID = %q, want rb-auto-1", run.RunbookID)
	}
	if run.SourceEventID != "evt-1" {
		t.Errorf("run.SourceEventID = %q, want evt-1 (the exactly-once key)", run.SourceEventID)
	}
	if run.Status != model.RunStatusPending {
		t.Errorf("run.Status = %q, want PENDING", run.Status)
	}
	// The full trigger payload must be recorded for replay (§4.7).
	wrapper, _ := run.Trigger["trigger"].(map[string]any)
	if wrapper == nil {
		t.Fatalf("run.Trigger missing the recorded trigger payload: %#v", run.Trigger)
	}
}

func TestDispatch_NonMatchingRuleCreatesNoRun(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-1", "cyber.alert.events", []model.Rule{critRule()})
	svc := newTestService(t, store, newFakeExecutor())

	// severity=low does not satisfy the critical rule → no action selected.
	ft := eventTriggerFired("auto-1", "evt-low", "low")
	if err := svc.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if store.runCount() != 0 {
		t.Fatalf("expected no run when no rule matched, got %d", store.runCount())
	}
}

func TestDispatch_EmptyRulesAlwaysMatch(t *testing.T) {
	store := newFakeServiceStore()
	// A rule with no conditions always matches (model.Rule semantics).
	always := model.Rule{
		ID:        "r-always",
		Priority:  100,
		ActionRef: model.ActionRef{Kind: model.ActionNotification, Config: map[string]any{"to": "ops"}},
	}
	seedEventAutomation(store, "auto-2", "platform.workflow.events", []model.Rule{always})
	svc := newTestService(t, store, newFakeExecutor())

	if err := svc.Dispatch(context.Background(), eventTriggerFired("auto-2", "evt-2", "anything")); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if store.runCount() != 1 {
		t.Fatalf("expected 1 run from an always-matching rule, got %d", store.runCount())
	}
}

func TestDispatch_DuplicateEventIsSuppressed(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-1", "cyber.alert.events", []model.Rule{critRule()})
	svc := newTestService(t, store, newFakeExecutor())

	ft := eventTriggerFired("auto-1", "evt-dup", "critical")
	if err := svc.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("first Dispatch: %v", err)
	}
	// Re-dispatch the SAME occurrence: the DB backstop must reject it as
	// ErrAlreadyExists (exactly-once), and the service must surface that error so
	// the trigger.Dispatcher treats it as a benign suppression.
	err := svc.Dispatch(context.Background(), ft)
	if err == nil {
		t.Fatalf("expected ErrAlreadyExists on duplicate dispatch, got nil")
	}
	if !isDuplicateErr(err) {
		t.Fatalf("expected ErrAlreadyExists, got %v", err)
	}
	if store.runCount() != 1 {
		t.Fatalf("duplicate must not create a second run, got %d", store.runCount())
	}
}

func TestDispatch_DisabledAutomationIsSkipped(t *testing.T) {
	store := newFakeServiceStore()
	a := seedEventAutomation(store, "auto-off", "cyber.alert.events", []model.Rule{critRule()})
	a.Enabled = false
	store.putAutomation(a, []model.Rule{critRule()})
	svc := newTestService(t, store, newFakeExecutor())

	if err := svc.Dispatch(context.Background(), eventTriggerFired("auto-off", "evt-x", "critical")); err != nil {
		t.Fatalf("Dispatch on disabled automation should be a silent no-op, got %v", err)
	}
	if store.runCount() != 0 {
		t.Fatalf("disabled automation must not create a run, got %d", store.runCount())
	}
}

func TestDispatch_UnknownAutomationErrors(t *testing.T) {
	store := newFakeServiceStore()
	svc := newTestService(t, store, newFakeExecutor())
	err := svc.Dispatch(context.Background(), eventTriggerFired("nope", "evt-y", "critical"))
	if err == nil {
		t.Fatalf("expected error dispatching to an unknown automation")
	}
}

// =============================================================================
// End-to-end: a dispatched trigger's run is driven to completion by the wired
// orchestrator through the assembled leader loop — trigger -> rule -> run ->
// orchestrate, all with fakes.
// =============================================================================

func TestService_TriggerToRunToCompletion(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-e2e", "cyber.alert.events", []model.Rule{critRule()})
	exec := newFakeExecutor()
	svc := newTestService(t, store, exec)

	// 1) A trigger fires and matches a rule → a PENDING run is created.
	if err := svc.Dispatch(context.Background(), eventTriggerFired("auto-e2e", "evt-e2e", "critical")); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	run := store.lastRun()
	if run == nil {
		t.Fatalf("expected a run to be created")
	}

	// 2) The wired orchestrator advances the run (PENDING -> RUNNING -> step 0 ->
	//    COMPLETED), exactly as the leader loop would on a claim. We drive it one
	//    step per tick (the orchestrator owns its own sub-transactions through the
	//    in-memory runner) to keep the test deterministic.
	orch := svc.Orchestrator()
	advTxRun := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }
	for i := 0; i < 10; i++ {
		cur := store.memStore.run(run.ID)
		if cur.IsTerminal() {
			break
		}
		if _, err := orch.Advance(context.Background(), cur, advTxRun); err != nil && !IsRecordedFailure(err) {
			t.Fatalf("Advance: %v", err)
		}
	}

	final := store.memStore.run(run.ID)
	if final.Status != model.RunStatusCompleted {
		t.Fatalf("run final status = %q, want COMPLETED", final.Status)
	}
	if exec.callCount(0) != 1 {
		t.Fatalf("action step 0 should have executed exactly once, got %d", exec.callCount(0))
	}
}

// =============================================================================
// Read-path tests: the assembled service satisfies the trigger sources' lister /
// resolver seams.
// =============================================================================

func TestService_ListEnabledByTopic(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-a", "cyber.alert.events", nil)
	seedEventAutomation(store, "auto-b", "cyber.alert.events", nil)
	seedEventAutomation(store, "auto-c", "platform.workflow.events", nil)
	svc := newTestService(t, store, newFakeExecutor())

	got, err := svc.ListEnabledByTopic(context.Background(), tnt, model.TriggerTypeEvent, "cyber.alert.events")
	if err != nil {
		t.Fatalf("ListEnabledByTopic: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 automations on cyber.alert.events, got %d", len(got))
	}
}

func TestService_SystemListEnabledSchedules(t *testing.T) {
	store := newFakeServiceStore()
	sched := &model.Automation{
		ID: "auto-sched", TenantID: tnt, Name: "auto-sched", Enabled: true, RunbookID: "rb-s",
		Trigger: model.TriggerConfig{Type: model.TriggerTypeSchedule, Cron: "0 * * * *"},
	}
	store.putAutomation(sched, nil)
	seedEventAutomation(store, "auto-evt", "cyber.alert.events", nil) // must be excluded
	svc := newTestService(t, store, newFakeExecutor())

	got, err := svc.SystemListEnabledSchedules(context.Background())
	if err != nil {
		t.Fatalf("SystemListEnabledSchedules: %v", err)
	}
	if len(got) != 1 || got[0].ID != "auto-sched" {
		t.Fatalf("expected only the schedule automation, got %#v", got)
	}
}

func TestService_ResolveWebhook(t *testing.T) {
	store := newFakeServiceStore()
	wh := &model.Automation{
		ID: "auto-wh", TenantID: tnt, Name: "auto-wh", Enabled: true, RunbookID: "rb-w",
		Trigger: model.TriggerConfig{Type: model.TriggerTypeWebhook, WebhookToken: "tok-123"},
	}
	store.putAutomation(wh, nil)
	svc := newTestService(t, store, newFakeExecutor())

	got, err := svc.ResolveWebhook(context.Background(), "tok-123")
	if err != nil {
		t.Fatalf("ResolveWebhook: %v", err)
	}
	if got.ID != "auto-wh" {
		t.Fatalf("ResolveWebhook returned %q, want auto-wh", got.ID)
	}

	if _, err := svc.ResolveWebhook(context.Background(), "unknown"); err == nil {
		t.Fatalf("expected ErrNotFound for an unknown webhook token")
	}
}

// =============================================================================
// Wiring + integration with the trigger Dispatcher's exactly-once gate.
// =============================================================================

func TestService_DispatcherGate_DeduplicatesAtDBBackstop(t *testing.T) {
	store := newFakeServiceStore()
	seedEventAutomation(store, "auto-1", "cyber.alert.events", []model.Rule{critRule()})
	svc := newTestService(t, store, newFakeExecutor())

	// Wrap the service in the real trigger Dispatcher with NO Redis guard, so the
	// only dedupe is the DB backstop the service surfaces as ErrAlreadyExists. The
	// Dispatcher must convert that into a benign suppression (nil error), proving
	// the service's ErrAlreadyExists contract is honored by the real gate.
	disp := trigger.NewDispatcher(svc, nil, zerolog.Nop())
	ft := eventTriggerFired("auto-1", "evt-gate", "critical")

	if err := disp.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("first dispatch through gate: %v", err)
	}
	if err := disp.Dispatch(context.Background(), ft); err != nil {
		t.Fatalf("duplicate dispatch through gate should be suppressed to nil, got %v", err)
	}
	if store.runCount() != 1 {
		t.Fatalf("exactly-once: expected 1 run after a duplicate, got %d", store.runCount())
	}
}

func TestNewService_RequiresDependencies(t *testing.T) {
	store := newFakeServiceStore()
	bridge := orchestratorBridge{store}
	txn, read, sys := inMemRunners()
	loopTx, loopRead := inMemLoopRunners()
	base := Config{
		Repository: bridge,
		Engine:     rule.NewEngine(zerolog.Nop(), rule.Options{}),
		Executor:   newFakeExecutor(),
		Events:     &recordingSink{},
		TenantTx:   txn, TenantRead: read, SystemRead: sys,
		LoopTxRunner: loopTx, LoopReadRunner: loopRead,
		Logger: zerolog.Nop(),
	}

	cases := map[string]func(*Config){
		"no repository": func(c *Config) { c.Repository = nil },
		"no engine":     func(c *Config) { c.Engine = nil },
		"no executor":   func(c *Config) { c.Executor = nil },
		"no pool or runners": func(c *Config) {
			c.Pool = nil
			c.TenantTx = nil
			c.TenantRead = nil
			c.SystemRead = nil
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := base
			mutate(&cfg)
			if _, err := NewService(cfg); err == nil {
				t.Fatalf("expected NewService to reject config (%s)", name)
			}
		})
	}
}

// isDuplicateErr reports whether err is (or wraps) ErrAlreadyExists.
func isDuplicateErr(err error) bool {
	return errors.Is(err, model.ErrAlreadyExists)
}
