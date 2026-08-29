// service.go assembles the AutomationService — the single object that ties the
// Automation engine's four work packages together (DESIGN_Workflow_Forms_
// Automation.md §4):
//
//   - WP-8 model + repository: the durable domain (automations, runbooks, rules,
//     runs, run steps, approval gates) and its persistence.
//   - WP-9 trigger sources: event / schedule / threshold / manual / webhook,
//     each emitting a normalized trigger.FiredTrigger through a Dispatcher's
//     exactly-once gate to a trigger.TriggerSink — which is THIS service.
//   - WP-10 rule engine: given a fired trigger's payload and an automation's
//     priority-ordered rules, decide which action(s) to run.
//   - WP-11 runbook orchestrator + leader loop + gate service: the durable,
//     restart-safe FSM that drives a run step by step and resolves approval
//     gates.
//
// The trigger -> rule -> run handoff (the heart of this assembly) is implemented
// by Dispatch: a FiredTrigger arrives (already deduped by the Dispatcher), the
// service loads the automation + its rules, evaluates the rules against the
// trigger payload, and — when a rule matches — creates a durable Run bound to the
// automation's runbook. The leader loop's orchestrator then picks the run up and
// advances it.
//
// The five action executors (WP-12) and the cmd/automation-service binary +
// platform rollout (Batch 4) are deliberately NOT built here. The orchestrator's
// ActionExecutor is a clean interface (orchestrator.go) that Batch 4 implements;
// this assembly accepts it as a constructor dependency so the wiring is complete
// and the trigger->rule->run path is exercisable end-to-end with a fake executor.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
	"github.com/clario360/platform/internal/automation/rule"
	"github.com/clario360/platform/internal/automation/trigger"
	"github.com/clario360/platform/internal/database"
)

// ServiceRepository is the full durable surface the AutomationService needs to
// resolve a fired trigger into a run and to back the trigger-source read paths.
// *repository.Repository satisfies it directly; unit tests substitute an
// in-memory fake so the trigger->rule->run handoff is exercised without a
// database. Every method takes a repository.DBTX so the service owns the
// transaction boundary (one tenant tx per dispatched trigger, so the run insert
// commits with its outbox event under RLS).
type ServiceRepository interface {
	// Trigger -> run handoff.
	GetAutomation(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Automation, error)
	ListAutomationRules(ctx context.Context, db repository.DBTX, tenantID, automationID string) ([]model.Rule, error)
	CreateRun(ctx context.Context, db repository.DBTX, run *model.Run) error

	// Trigger-source read paths (WP-9 listers/resolver).
	ListEnabledByTopic(ctx context.Context, db repository.DBTX, tenantID, triggerType, topic string) ([]*model.Automation, error)
	SystemListEnabledSchedules(ctx context.Context, db repository.DBTX) ([]*model.Automation, error)
	SystemResolveWebhook(ctx context.Context, db repository.DBTX, token string) (*model.Automation, error)

	// Request-path CRUD (WP-13 handler). The handler drives these through the
	// service's tenant transaction runners so a write commits atomically (the
	// automation/runbook rows are RLS-scoped to the caller's tenant).
	CreateAutomation(ctx context.Context, db repository.DBTX, a *model.Automation) error
	ListAutomations(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.Automation, error)
	UpdateAutomation(ctx context.Context, db repository.DBTX, a *model.Automation) error
	DeleteAutomation(ctx context.Context, db repository.DBTX, tenantID, id string) error

	CreateRunbook(ctx context.Context, db repository.DBTX, rb *model.Runbook) error
	GetRunbook(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Runbook, error)

	// Run history + append-only execution log (WP-13 §4.7).
	GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Run, error)
	ListRuns(ctx context.Context, db repository.DBTX, tenantID string, limit, offset int) ([]*model.Run, error)
	ListRunSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.RunStep, error)
}

// txRunners are the transaction boundaries the service runs its repository calls
// inside. They are abstracted (rather than calling database.RunWithTenant /
// RunSystemRead directly) so unit tests inject in-memory runners and exercise the
// trigger->rule->run path with no live database. Production wiring uses the
// pool-backed runners NewService installs.
//
//   - tenantTx: a read-write transaction scoped to one tenant under RLS, used to
//     create a run (the run insert + its outbox event commit atomically).
//   - tenantRead: a read-only tenant-scoped transaction, used by the per-tenant
//     bus listers.
//   - systemRead: a cross-tenant read under app.bypass_rls = on, used by the
//     leader cron lister and the tenant-less webhook resolver (SYSTEM PATH).
type tenantTxFn func(ctx context.Context, tenantID string, fn func(db repository.DBTX) error) error
type systemReadFn func(ctx context.Context, fn func(db repository.DBTX) error) error

// AutomationService is the assembled Automation engine. It is the
// trigger.TriggerSink (Dispatch creates a run for a matched automation), the
// trigger.AutomationLister + trigger.ScheduleLister (the bus/cron sources' read
// paths), and the trigger.WebhookResolver (the webhook source's read path). It
// owns the rule engine, the runbook orchestrator, the leader loop, and the gate
// service, so a caller (the Batch 4 binary) constructs ONE service and reads the
// wired collaborators off it.
type AutomationService struct {
	repo   ServiceRepository
	engine *rule.Engine

	orchestrator *RunbookOrchestrator
	gates        *GateService
	loop         *Loop

	tenantTx   tenantTxFn
	tenantRead tenantTxFn
	systemRead systemReadFn

	now      func() time.Time
	newRunID func() string
	logger   zerolog.Logger
}

// Config wires an AutomationService. The required fields are the durable
// repository, the rule engine, the action executor (the WP-12 seam — a fake in
// tests), and either a Pool (production) or the three tx-runner overrides
// (tests). The orchestrator, gate service, and leader loop are built internally
// from these.
type Config struct {
	// Repository is the durable state surface (required).
	Repository ServiceRepository

	// Engine is the rule engine (required). Construct it once with rule.NewEngine
	// and share it — it is stateless and concurrency-safe.
	Engine *rule.Engine

	// Executor performs action side effects (required). Batch 4 supplies the real
	// five-target executor; tests supply a fake. This is the documented
	// unimplemented-by-design seam for this batch.
	Executor ActionExecutor

	// Pool is the database pool the default tx runners use. Required in production;
	// unit tests may instead supply TenantTx / TenantRead / SystemRead so the
	// trigger->rule->run path runs without a live database.
	Pool *pgxpool.Pool

	// Logger is the base logger; a component field is attached.
	Logger zerolog.Logger

	// --- Orchestrator / loop tuning (sensible defaults applied when zero) ---

	// StepMaxAttempts caps action retries before a step (and the run) FAILs.
	StepMaxAttempts int
	// DriverPollInterval is how often the leader driver polls for runnable runs.
	DriverPollInterval time.Duration
	// DriverBatchSize bounds how many runs the driver claims per poll.
	DriverBatchSize int
	// GateSweepInterval is how often the leader sweeps for timed-out gates.
	GateSweepInterval time.Duration

	// Now is the clock, injectable for deterministic tests. Defaults to
	// time.Now().UTC().
	Now func() time.Time

	// NewRunID generates a run's source_event_id fallback when a trigger carries
	// none (it always should). Defaults to a UUID generator. Injectable so a test
	// can assert a deterministic id.
	NewRunID func() string

	// Test-only transaction-runner overrides. Production leaves these nil and the
	// pool-backed runners are installed. When TenantTx is supplied, TenantRead and
	// SystemRead must be too (NewService validates this).
	TenantTx   tenantTxFn
	TenantRead tenantTxFn
	SystemRead systemReadFn

	// LoopTxRunner / LoopReadRunner are test-only overrides for the leader loop's
	// own system transactions (the claim/advance and gate-sweep boundaries).
	// Production leaves them nil and the loop builds pool-backed runners from Pool;
	// unit tests with no pool supply in-memory runners so the assembled loop is
	// constructible (and its claim/advance discipline exercisable) without a
	// database. They mirror loop.LoopConfig.TxRunner / ReadRunner.
	LoopTxRunner   txRunner
	LoopReadRunner readRunner

	// Events stages lifecycle events in the orchestrator/gate transactions.
	// Defaults to the production OutboxSink when nil.
	Events EventSink
}

// NewService assembles the AutomationService: it builds the runbook
// orchestrator, the gate service, and the leader loop from the shared
// repository/executor/clock, and installs the transaction runners (pool-backed in
// production, injected in tests). It returns an error if a required dependency is
// missing so misconfiguration fails at construction, not at the first trigger.
func NewService(cfg Config) (*AutomationService, error) {
	if cfg.Repository == nil {
		return nil, errors.New("automation: service repository is required")
	}
	if cfg.Engine == nil {
		return nil, errors.New("automation: service rule engine is required")
	}
	if cfg.Executor == nil {
		return nil, errors.New("automation: service action executor is required")
	}
	// Either a pool (production) or the full set of tx-runner overrides (tests).
	haveOverrides := cfg.TenantTx != nil && cfg.TenantRead != nil && cfg.SystemRead != nil
	if cfg.Pool == nil && !haveOverrides {
		return nil, errors.New("automation: service requires a pool (or all of TenantTx, TenantRead, SystemRead)")
	}

	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.NewRunID == nil {
		cfg.NewRunID = func() string { return "auto:" + uuid.NewString() }
	}
	events := cfg.Events
	if events == nil {
		events = OutboxSink{}
	}
	logger := cfg.Logger.With().Str("component", "automation-service").Logger()

	// The orchestrator, gate service, and loop need the concrete repository's
	// run/step/gate methods. The service repository must expose them — in
	// production *repository.Repository does; in tests the in-memory fake does.
	orchRepo, ok := cfg.Repository.(Repository)
	if !ok {
		return nil, errors.New("automation: repository does not satisfy the orchestrator Repository surface")
	}
	gateRepo, ok := cfg.Repository.(GateRepository)
	if !ok {
		return nil, errors.New("automation: repository does not satisfy the gate Repository surface")
	}

	orchestrator, err := NewRunbookOrchestrator(OrchestratorConfig{
		Repository:  orchRepo,
		Executor:    cfg.Executor,
		Events:      events,
		Now:         cfg.Now,
		MaxAttempts: cfg.StepMaxAttempts,
	})
	if err != nil {
		return nil, fmt.Errorf("automation: building orchestrator: %w", err)
	}

	gates, err := NewGateService(GateServiceConfig{
		Repository: gateRepo,
		Events:     events,
		Now:        cfg.Now,
	})
	if err != nil {
		return nil, fmt.Errorf("automation: building gate service: %w", err)
	}

	// The leader loop drives runnable runs and sweeps gates. It needs the
	// cross-tenant claimer/lister/reader surfaces, which the concrete repository
	// (and the test fake) provide.
	claimer, ok := cfg.Repository.(Claimer)
	if !ok {
		return nil, errors.New("automation: repository does not satisfy the loop Claimer surface")
	}
	gateLister, ok := cfg.Repository.(GateLister)
	if !ok {
		return nil, errors.New("automation: repository does not satisfy the loop GateLister surface")
	}
	runbookReader, ok := cfg.Repository.(RunbookReader)
	if !ok {
		return nil, errors.New("automation: repository does not satisfy the loop RunbookReader surface")
	}

	loop, err := NewLoop(LoopConfig{
		Pool:          cfg.Pool,
		Claimer:       claimer,
		Driver:        orchestrator,
		Gates:         gateLister,
		Runbooks:      runbookReader,
		GateApplier:   gates,
		Logger:        logger,
		PollInterval:  cfg.DriverPollInterval,
		BatchSize:     cfg.DriverBatchSize,
		SweepInterval: cfg.GateSweepInterval,
		TxRunner:      cfg.LoopTxRunner,
		ReadRunner:    cfg.LoopReadRunner,
	})
	if err != nil {
		return nil, fmt.Errorf("automation: building leader loop: %w", err)
	}

	svc := &AutomationService{
		repo:         cfg.Repository,
		engine:       cfg.Engine,
		orchestrator: orchestrator,
		gates:        gates,
		loop:         loop,
		now:          cfg.Now,
		newRunID:     cfg.NewRunID,
		logger:       logger,
	}

	// Install transaction runners: pool-backed in production, injected in tests.
	if haveOverrides {
		svc.tenantTx = cfg.TenantTx
		svc.tenantRead = cfg.TenantRead
		svc.systemRead = cfg.SystemRead
	} else {
		pool := cfg.Pool
		svc.tenantTx = func(ctx context.Context, tenantID string, fn func(db repository.DBTX) error) error {
			tid, perr := uuid.Parse(tenantID)
			if perr != nil {
				return fmt.Errorf("automation: invalid tenant id %q: %w", tenantID, perr)
			}
			return database.RunWithTenant(ctx, pool, tid, func(tx pgx.Tx) error { return fn(tx) })
		}
		svc.tenantRead = func(ctx context.Context, tenantID string, fn func(db repository.DBTX) error) error {
			tid, perr := uuid.Parse(tenantID)
			if perr != nil {
				return fmt.Errorf("automation: invalid tenant id %q: %w", tenantID, perr)
			}
			return database.RunReadWithTenant(ctx, pool, tid, func(tx pgx.Tx) error { return fn(tx) })
		}
		svc.systemRead = func(ctx context.Context, fn func(db repository.DBTX) error) error {
			return database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error { return fn(tx) })
		}
	}

	return svc, nil
}

// Orchestrator returns the wired runbook orchestrator (the Driver the leader loop
// advances). The Batch 4 binary reads it to expose run-step replay / admin paths.
func (s *AutomationService) Orchestrator() *RunbookOrchestrator { return s.orchestrator }

// Gates returns the wired gate-decision service (ApproveGate / RejectGate from
// the request path; ApplyTimeout from the sweeper).
func (s *AutomationService) Gates() *GateService { return s.gates }

// Loop returns the leader-singleton driver/sweeper loop. The Batch 4 binary
// launches it from the leadership-election OnAcquire callback.
func (s *AutomationService) Loop() *Loop { return s.loop }

// =============================================================================
// trigger.TriggerSink — the trigger -> rule -> run handoff (the heart of WP-8..11)
// =============================================================================

// Dispatch is the TriggerSink the trigger sources (via their Dispatcher's
// exactly-once gate) hand a matched FiredTrigger to. It:
//
//  1. loads the automation and its priority-ordered rules in a tenant tx;
//  2. evaluates the rules against the trigger payload with the rule engine;
//  3. when at least one rule matches, creates a durable Run bound to the
//     automation's runbook, recording the FULL trigger payload (replay input,
//     §4.7) and the dedupe key (source_event_id) so the (tenant_id,
//     source_event_id) UNIQUE backstop makes a duplicate occurrence a no-op.
//
// When NO rule matches, no run is created and the dispatch succeeds (a fired
// trigger whose rules all skipped is a legitimate "nothing to do", not an error).
// The leader loop's orchestrator then claims the created run and advances it.
//
// Dispatch returns model.ErrAlreadyExists when the DB backstop rejects a
// duplicate the Redis guard missed; the Dispatcher treats that as a benign
// suppression (see trigger.Dispatcher.Dispatch).
func (s *AutomationService) Dispatch(ctx context.Context, ft trigger.FiredTrigger) error {
	if ft.AutomationID == "" || ft.TenantID == "" {
		return fmt.Errorf("%w: fired trigger missing automation_id/tenant_id", model.ErrInvalidConfig)
	}

	return s.tenantTx(ctx, ft.TenantID, func(db repository.DBTX) error {
		automation, err := s.repo.GetAutomation(ctx, db, ft.TenantID, ft.AutomationID)
		if err != nil {
			return fmt.Errorf("loading automation %s for trigger: %w", ft.AutomationID, err)
		}
		if !automation.Enabled {
			// The automation was disabled between matching and dispatch. Drop the
			// occurrence silently — a disabled automation never fires (§4.2).
			s.logger.Debug().
				Str("automation_id", ft.AutomationID).
				Str("tenant_id", ft.TenantID).
				Msg("automation disabled before dispatch; skipping")
			return nil
		}
		if automation.RunbookID == "" {
			return fmt.Errorf("%w: automation %s has no runbook", model.ErrInvalidConfig, ft.AutomationID)
		}

		// GetAutomation eager-loads rules in production, but the in-memory fake (and
		// a future repo split) may not; load them explicitly so Dispatch never
		// depends on eager loading.
		rules := automation.Rules
		if rules == nil {
			rules, err = s.repo.ListAutomationRules(ctx, db, ft.TenantID, ft.AutomationID)
			if err != nil {
				return fmt.Errorf("loading rules for automation %s: %w", ft.AutomationID, err)
			}
		}

		decision := s.engine.Evaluate(firedFromTrigger(ft), rules)
		if !decision.HasActions() {
			s.logger.Debug().
				Str("automation_id", ft.AutomationID).
				Str("tenant_id", ft.TenantID).
				Str("trigger_type", ft.TriggerType).
				Int("matched", len(decision.Matched)).
				Int("skipped", len(decision.Skipped)).
				Msg("trigger fired but no rule selected an action; no run created")
			return nil
		}

		sourceEventID := ft.EventID
		if sourceEventID == "" {
			sourceEventID = s.newRunID()
		}
		run := &model.Run{
			TenantID:      ft.TenantID,
			AutomationID:  automation.ID,
			RunbookID:     automation.RunbookID,
			Status:        model.RunStatusPending,
			SourceEventID: sourceEventID,
			CurrentStep:   0,
			Trigger:       ft.Payload,
			Variables:     map[string]any{},
		}
		if err := s.repo.CreateRun(ctx, db, run); err != nil {
			// ErrAlreadyExists (the (tenant_id, source_event_id) backstop) is the
			// exactly-once guarantee working; surface it for the Dispatcher to treat
			// as a benign suppression.
			return err
		}

		s.logger.Info().
			Str("automation_id", automation.ID).
			Str("tenant_id", ft.TenantID).
			Str("run_id", run.ID).
			Str("runbook_id", automation.RunbookID).
			Str("trigger_type", ft.TriggerType).
			Int("actions", len(decision.Actions)).
			Msg("automation run created from trigger")
		return nil
	})
}

// firedFromTrigger bridges the trigger source's trigger.FiredTrigger (carrying
// the recorded {trigger:{type,data,...}} replay payload) into the rule engine's
// rule.FiredTrigger (carrying the flat data map the expression DSL evaluates as
// `trigger.data.<path>`). It extracts the inner trigger.data map so a rule
// authored as `trigger.data.severity == "critical"` resolves against the same
// payload the source recorded for replay.
func firedFromTrigger(ft trigger.FiredTrigger) rule.FiredTrigger {
	return rule.FiredTrigger{
		TenantID:      ft.TenantID,
		AutomationID:  ft.AutomationID,
		SourceEventID: ft.EventID,
		Type:          ft.TriggerType,
		Data:          triggerData(ft.Payload),
		Variables:     map[string]any{},
	}
}

// triggerData extracts the inner data map every trigger source records under
// payload["trigger"]["data"] (event_source.buildEventPayload,
// threshold_source.buildThresholdPayload, manual_source, webhook_source). When
// the shape is absent (a hand-built payload without the wrapper), it falls back
// to the payload itself so a rule can still resolve `trigger.data.<path>`.
func triggerData(payload map[string]any) map[string]any {
	if payload == nil {
		return map[string]any{}
	}
	if wrapper, ok := payload["trigger"].(map[string]any); ok {
		if data, ok := wrapper["data"].(map[string]any); ok {
			return data
		}
	}
	return payload
}

// =============================================================================
// trigger.AutomationLister / ScheduleLister / WebhookResolver — the read paths
// =============================================================================

// ListEnabledByTopic satisfies trigger.AutomationLister for the event and
// threshold bus sources: it returns the tenant's enabled automations of
// triggerType subscribed to topic. It runs in a read-only tenant transaction so
// RLS scopes the result to the event's tenant.
func (s *AutomationService) ListEnabledByTopic(ctx context.Context, tenantID, triggerType, topic string) ([]*model.Automation, error) {
	var out []*model.Automation
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.repo.ListEnabledByTopic(ctx, db, tenantID, triggerType, topic)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SystemListEnabledSchedules satisfies trigger.ScheduleLister for the cron
// source: it returns every enabled schedule-trigger automation across all
// tenants. SYSTEM PATH — the leader cron clock fires every tenant's schedules, so
// this runs under app.bypass_rls = on.
func (s *AutomationService) SystemListEnabledSchedules(ctx context.Context) ([]*model.Automation, error) {
	var out []*model.Automation
	err := s.systemRead(ctx, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.repo.SystemListEnabledSchedules(ctx, db)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ResolveWebhook satisfies trigger.WebhookResolver for the webhook source: it
// resolves an opaque path token to its enabled automation, or model.ErrNotFound.
// SYSTEM PATH — the inbound webhook carries no tenant context (the token is the
// credential), so this runs under app.bypass_rls = on.
func (s *AutomationService) ResolveWebhook(ctx context.Context, token string) (*model.Automation, error) {
	var out *model.Automation
	err := s.systemRead(ctx, func(db repository.DBTX) error {
		var rerr error
		out, rerr = s.repo.SystemResolveWebhook(ctx, db, token)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Compile-time assertions that the assembled service satisfies the trigger-side
// seams it is wired into. If a trigger interface changes, this fails to compile
// here (at the assembly point) rather than at a distant call site.
var (
	_ trigger.TriggerSink      = (*AutomationService)(nil)
	_ trigger.AutomationLister = (*AutomationService)(nil)
	_ trigger.ScheduleLister   = (*AutomationService)(nil)
	_ trigger.WebhookResolver  = (*AutomationService)(nil)
)
