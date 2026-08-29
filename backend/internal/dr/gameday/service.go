package gameday

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

// serviceStore is the persistence surface the request-path service needs. *Store
// satisfies it; tests substitute a fake.
type serviceStore interface {
	GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error)
	CreateScenario(ctx context.Context, db DBTX, sc *Scenario) error
	GetScenario(ctx context.Context, db DBTX, tenantID, id string) (*Scenario, error)
	SystemGetScenario(ctx context.Context, db DBTX, id string) (*Scenario, error)
	ListScenarios(ctx context.Context, db DBTX, tenantID string) ([]*Scenario, error)
	CreateRun(ctx context.Context, db DBTX, run *Run) error
	GetRun(ctx context.Context, db DBTX, tenantID, id string) (*Run, error)
	ListStepResults(ctx context.Context, db DBTX, tenantID, runID string) ([]*StepResult, error)
}

// txRunner runs a function inside a tenant-scoped or system transaction. A
// request-path scenario create commits the scenario row and its outbox event
// atomically under the caller's tenant; the orchestrator uses RunSystem.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunSystem(ctx context.Context, fn func(DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant and
// system transaction helpers (the single, clearly-named system path the design
// reserves for background loops, §7).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystem runs fn in a read-write system transaction (RLS bypassed).
func (r PGXRunner) RunSystem(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystemRead runs fn in a read-only system transaction (RLS bypassed).
func (r PGXRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemRead(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// Service is the request-path game-day service: it manages scenario definitions
// (tenant-scoped CRUD with outbox lifecycle events) and executes runs by handing
// them to the Orchestrator (which owns the safety guard, fault injection,
// observation/scoring, and the revert guarantee). It assembles the scorecard a
// run produces.
type Service struct {
	store        serviceStore
	runner       txRunner
	orchestrator *Orchestrator
	stager       eventEmitter
	now          func() time.Time
	logger       zerolog.Logger
}

// ServiceConfig wires a Service.
type ServiceConfig struct {
	Store        serviceStore
	Runner       txRunner
	Orchestrator *Orchestrator
	// Stager is optional; defaults to the transactional-outbox emitter.
	Stager eventEmitter
	// Now is optional; defaults to time.Now (UTC). Injected for deterministic tests.
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a Service. Store, Runner and Orchestrator are required.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("gameday service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("gameday service: runner is required")
	}
	if cfg.Orchestrator == nil {
		return nil, errors.New("gameday service: orchestrator is required")
	}
	var stager eventEmitter = cfg.Stager
	if stager == nil {
		stager = outboxEmitter{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:        cfg.Store,
		runner:       cfg.Runner,
		orchestrator: cfg.Orchestrator,
		stager:       stager,
		now:          now,
		logger:       cfg.Logger,
	}, nil
}

// CreateScenarioInput is the request to define a game-day scenario.
type CreateScenarioInput struct {
	GroupID     string
	Name        string
	Description string
	Scope       string
	Steps       []Step
}

// CreateScenario validates and persists a scenario under the tenant, staging a
// lifecycle event in the same transaction. The safety guard is enforced at
// definition time too: a production scope is rejected with ErrProductionScope so
// a prod scenario can never be stored (the orchestrator re-checks at run time).
func (s *Service) CreateScenario(ctx context.Context, tenantID uuid.UUID, in CreateScenarioInput) (*Scenario, error) {
	sc := &Scenario{
		TenantID:    tenantID.String(),
		GroupID:     in.GroupID,
		Name:        strings.TrimSpace(in.Name),
		Description: in.Description,
		Scope:       in.Scope,
		Steps:       in.Steps,
	}
	if sc.Name == "" {
		return nil, errors.New("gameday: scenario name is required")
	}
	if _, err := uuid.Parse(in.GroupID); err != nil {
		return nil, fmt.Errorf("gameday: group_id must be a UUID: %w", err)
	}
	if err := sc.Validate(); err != nil {
		return nil, err
	}

	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		exists, gerr := s.store.GroupExists(ctx, tx, in.GroupID)
		if gerr != nil {
			return gerr
		}
		if !exists {
			return fmt.Errorf("group %s: %w", in.GroupID, ErrScenarioNotFound)
		}
		if cerr := s.store.CreateScenario(ctx, tx, sc); cerr != nil {
			return cerr
		}
		return s.stager.Emit(ctx, tx, tenantID.String(), eventScenarioCreated, map[string]any{
			"scenario_id": sc.ID,
			"group_id":    sc.GroupID,
			"name":        sc.Name,
			"scope":       sc.Scope,
			"steps":       len(sc.Steps),
		})
	})
	if err != nil {
		return nil, err
	}
	return sc, nil
}

// ListScenarios returns the tenant's scenarios.
func (s *Service) ListScenarios(ctx context.Context, tenantID uuid.UUID) ([]*Scenario, error) {
	var out []*Scenario
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var lerr error
		out, lerr = s.store.ListScenarios(ctx, tx, tenantID.String())
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ExecuteScenario creates a run for a scenario and executes it synchronously
// through the Orchestrator. The run row is created under the tenant; execution
// then runs on the system path (the orchestrator claims/advances across tenants
// like the failover driver). The completed run's scorecard is returned.
//
// The safety guard lives in the orchestrator: a production-scope scenario yields
// an aborted run with the rejected-production verdict and ErrProductionScope.
func (s *Service) ExecuteScenario(ctx context.Context, tenantID uuid.UUID, scenarioID string, initiatedBy *uuid.UUID) (*Scorecard, error) {
	if _, err := uuid.Parse(scenarioID); err != nil {
		return nil, fmt.Errorf("gameday: scenario_id must be a UUID: %w", err)
	}

	var sc *Scenario
	run := &Run{}
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		loaded, gerr := s.store.GetScenario(ctx, tx, tenantID.String(), scenarioID)
		if gerr != nil {
			return gerr
		}
		sc = loaded
		run.TenantID = tenantID.String()
		run.ScenarioID = sc.ID
		run.GroupID = sc.GroupID
		run.Scope = sc.Scope
		run.Status = RunStatusPending
		run.SafetyVerdict = SafetyPending
		run.StepsTotal = len(sc.Steps)
		if initiatedBy != nil {
			id := initiatedBy.String()
			run.InitiatedBy = &id
		}
		return s.store.CreateRun(ctx, tx, run)
	})
	if err != nil {
		return nil, err
	}

	// Execute the run through the orchestrator (system path). A production-scope
	// scenario is rejected here with ErrProductionScope; the run row is already
	// updated to aborted/rejected_production by the orchestrator, so we still
	// return the durable scorecard alongside the error.
	_, execErr := s.orchestrator.Execute(ctx, run, sc)

	card, cardErr := s.GetScorecard(ctx, tenantID, run.ID)
	if cardErr != nil {
		if execErr != nil {
			return nil, execErr
		}
		return nil, cardErr
	}
	if execErr != nil {
		return card, execErr
	}
	return card, nil
}

// GetScorecard loads a run and its ordered step results for the tenant.
func (s *Service) GetScorecard(ctx context.Context, tenantID uuid.UUID, runID string) (*Scorecard, error) {
	if _, err := uuid.Parse(runID); err != nil {
		return nil, fmt.Errorf("gameday: run_id must be a UUID: %w", err)
	}
	var card Scorecard
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		run, rerr := s.store.GetRun(ctx, tx, tenantID.String(), runID)
		if rerr != nil {
			return rerr
		}
		steps, serr := s.store.ListStepResults(ctx, tx, tenantID.String(), runID)
		if serr != nil {
			return serr
		}
		card.Run = run
		card.Steps = steps
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &card, nil
}

// eventScenarioCreated is emitted when a scenario is defined.
const eventScenarioCreated = "com.clario360.datastream.dr.gameday.scenario.created"

// compile-time checks.
var (
	_ serviceStore = (*Store)(nil)
	_ txRunner     = PGXRunner{}
	_ systemRunner = PGXRunner{}
)
