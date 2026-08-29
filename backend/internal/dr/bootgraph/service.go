package bootgraph

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// Lifecycle event types this package stages on the existing datastream.dr.events
// topic (DESIGN §8). They are this package's OWN types so the registry/topology
// reconcile consumers (which filter by their own types) ignore them.
const (
	eventServicesDefined = "com.clario360.datastream.dr.bootgraph.services.defined"
	eventRunCompleted    = "com.clario360.datastream.dr.bootgraph.run.completed"
	eventRunFailed       = "com.clario360.datastream.dr.bootgraph.run.failed"
)

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's tier planning, cycle
// rejection, and run orchestration are exercised without a database.
type storeAPI interface {
	GroupName(ctx context.Context, db DBTX, groupID string) (string, error)
	UpsertService(ctx context.Context, db DBTX, svc *Service) (*Service, error)
	InsertDependency(ctx context.Context, db DBTX, d *Dependency) error
	LoadServices(ctx context.Context, db DBTX, groupID string) ([]Service, error)
	LoadDependencies(ctx context.Context, db DBTX, groupID string) ([]Dependency, error)
	LoadServicesForLock(ctx context.Context, db DBTX, groupID string) ([]Service, error)
	CreateRun(ctx context.Context, db DBTX, run *BootRun, plan BootPlan) (*BootRun, error)
	SetRunStatus(ctx context.Context, db DBTX, runID, status string, tiersBooted int, lastErr *string) error
	GetRun(ctx context.Context, db DBTX, runID string) (*BootRun, error)
	ListRunStatuses(ctx context.Context, db DBTX, runID string) ([]BootServiceStatus, error)
	MarkServiceBooting(ctx context.Context, db DBTX, runID, serviceID string, tier, attempt int) error
	MarkServiceHealthy(ctx context.Context, db DBTX, runID, serviceID string, attempts int, at time.Time) error
	MarkServiceUnhealthy(ctx context.Context, db DBTX, runID, serviceID string, attempts int, lastErr string) error
	MarkServiceRolledBack(ctx context.Context, db DBTX, runID, serviceID string) error
}

// txRunner runs a function inside a tenant-scoped transaction.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant
// transaction helpers.
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

// eventStager stages a lifecycle event in the caller's transaction. The default
// implementation writes to the transactional outbox so the event commits
// atomically with the boot definition write.
type eventStager interface {
	Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error
}

type outboxStager struct{}

func (outboxStager) Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("bootgraph: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, evt)
}

// Manager is the dependency-aware boot orchestration service: it manages the
// application-service dependency DAG of a consistency group, computes the boot
// PLAN (tiers via longest-path levelisation), and executes boot RUNS tier by
// tier with health-gated barriers. It owns no algorithms itself — the planner
// (planner.go) and orchestrator (orchestrator.go) are pure engines — it wires
// persistence, transactions, events, and those engines.
type Manager struct {
	store   storeAPI
	runner  txRunner
	stager  eventStager
	planner Planner
	metrics *Metrics
	// newOrchestrator builds the orchestrator for a run; overridable in tests to
	// inject a scripted Booter/CheckerFor. Defaults to the production probes.
	newOrchestrator func(sink statusSink) (*Orchestrator, error)
	now             func() time.Time
	logger          zerolog.Logger
}

// Config wires a Manager.
type Config struct {
	Store  storeAPI
	Runner txRunner
	// Stager is optional; defaults to the transactional-outbox stager.
	Stager  eventStager
	Metrics *Metrics
	// Booter is optional; defaults to NoopBooter (boot performed out-of-band by
	// the recovery target — the orchestrator becomes a pure health barrier).
	Booter Booter
	// CheckerFor is optional; defaults to the real CheckerFor probe factory.
	CheckerFor func(Service) HealthChecker
	// RetryBackoff is optional; defaults to the orchestrator's own default.
	RetryBackoff time.Duration
	// Now is optional; defaults to time.Now (UTC).
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a Manager. Store and Runner are required.
func NewService(cfg Config) (*Manager, error) {
	if cfg.Store == nil {
		return nil, errors.New("bootgraph service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("bootgraph service: runner is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = outboxStager{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	s := &Manager{
		store:   cfg.Store,
		runner:  cfg.Runner,
		stager:  stager,
		metrics: cfg.Metrics,
		now:     now,
		logger:  cfg.Logger,
	}
	s.newOrchestrator = func(sink statusSink) (*Orchestrator, error) {
		return NewOrchestrator(OrchestratorConfig{
			Booter:       cfg.Booter,
			CheckerFor:   cfg.CheckerFor,
			Sink:         sink,
			Metrics:      cfg.Metrics,
			Logger:       cfg.Logger,
			Now:          now,
			RetryBackoff: cfg.RetryBackoff,
		})
	}
	return s, nil
}

// ServiceSpec is one service definition in a DefineServices request.
type ServiceSpec struct {
	Name string
	Kind string
	// BootAction is how the orchestrator issues this service's boot ("cmd:<argv>",
	// "http(s)://...", or empty for out-of-band). See Service.BootAction.
	BootAction string
	// SiteID optionally links this service to the recovery_target site it
	// represents, enabling dependency-tiered recovery boot. See Service.SiteID.
	SiteID             string
	ProbeKind          string
	ProbeTarget        string
	ProbeExpectStatus  int
	BootTimeoutSeconds int
	HealthRetries      int
	// DependsOn names the services this one depends on (must also be in the request
	// or already defined for the group). Cycles are rejected.
	DependsOn []string
}

// DefineServices upserts a group's boot services and their depends_on edges in
// ONE tenant transaction, rejecting the whole definition if it would introduce a
// cycle (nothing is written). It returns the freshly computed boot plan so the
// caller immediately sees the tiers. The cycle check runs over the full service
// set (existing + just-upserted) with the locked rows, so two concurrent edits
// cannot each pass against a graph missing the other's edge.
func (s *Manager) DefineServices(ctx context.Context, tenantID uuid.UUID, groupID string, specs []ServiceSpec) (BootPlan, error) {
	if len(specs) == 0 {
		return BootPlan{}, ErrNoServices
	}
	for _, sp := range specs {
		if sp.Name == "" {
			return BootPlan{}, fmt.Errorf("service name is required: %w", ErrInvalidProbe)
		}
		if !ValidProbeKind(sp.ProbeKind) {
			return BootPlan{}, fmt.Errorf("service %q: %q: %w", sp.Name, sp.ProbeKind, ErrInvalidProbe)
		}
	}

	var plan BootPlan
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, gerr := s.store.GroupName(ctx, tx, groupID); gerr != nil {
			return gerr
		}
		// Lock the group's existing services so the cycle check + insert serialise.
		if _, lerr := s.store.LoadServicesForLock(ctx, tx, groupID); lerr != nil {
			return lerr
		}

		// Upsert every service first so dependency edges can reference them by ID.
		byName := make(map[string]Service, len(specs))
		for _, sp := range specs {
			stored, uerr := s.store.UpsertService(ctx, tx, &Service{
				TenantID:           tenantID.String(),
				GroupID:            groupID,
				Name:               sp.Name,
				Kind:               sp.Kind,
				BootAction:         sp.BootAction,
				SiteID:             sp.SiteID,
				ProbeKind:          sp.ProbeKind,
				ProbeTarget:        sp.ProbeTarget,
				ProbeExpectStatus:  sp.ProbeExpectStatus,
				BootTimeoutSeconds: sp.BootTimeoutSeconds,
				HealthRetries:      sp.HealthRetries,
			})
			if uerr != nil {
				return uerr
			}
			byName[stored.Name] = *stored
		}

		// Reload the full service set (existing + upserted) for name->ID resolution
		// of dependencies that may reference a previously-defined service.
		allServices, serr := s.store.LoadServices(ctx, tx, groupID)
		if serr != nil {
			return serr
		}
		idByName := make(map[string]string, len(allServices))
		for _, svc := range allServices {
			idByName[svc.Name] = svc.ID
		}

		// Resolve and stage every depends_on edge.
		var newDeps []Dependency
		for _, sp := range specs {
			svcID := idByName[sp.Name]
			for _, depName := range sp.DependsOn {
				depID, ok := idByName[depName]
				if !ok {
					return fmt.Errorf("service %q depends on unknown %q: %w", sp.Name, depName, ErrUnknownDependency)
				}
				if depID == svcID {
					return ErrSelfDependency
				}
				newDeps = append(newDeps, Dependency{
					TenantID:    tenantID.String(),
					GroupID:     groupID,
					ServiceID:   svcID,
					DependsOnID: depID,
				})
			}
		}

		// Validate acyclicity over the COMBINED edge set (existing + new) BEFORE
		// writing, so a cycle is rejected with the transaction rolled back.
		existingDeps, derr := s.store.LoadDependencies(ctx, tx, groupID)
		if derr != nil {
			return derr
		}
		combined := append(append([]Dependency{}, existingDeps...), newDeps...)
		cyclic, cerr := s.planner.HasCycle(allServices, combined)
		if cerr != nil {
			return cerr
		}
		if cyclic {
			s.metrics.observeCycleRejected()
			return ErrCycle
		}

		for i := range newDeps {
			if ierr := s.store.InsertDependency(ctx, tx, &newDeps[i]); ierr != nil {
				return ierr
			}
		}

		var perr error
		plan, perr = s.planner.Plan(groupID, allServices, combined)
		if perr != nil {
			return perr
		}

		return s.stager.Stage(ctx, tx, eventServicesDefined, tenantID.String(), map[string]any{
			"group_id":      groupID,
			"service_count": len(allServices),
			"tier_count":    len(plan.Tiers),
		})
	})
	if err != nil {
		return BootPlan{}, err
	}
	s.metrics.observeServicesDefined(len(specs))
	return plan, nil
}

// GetPlan loads a group's services + dependencies and returns the computed boot
// plan (tiers) under a read-only tenant transaction. ErrCycle if the stored
// graph is somehow cyclic (it cannot be, given DefineServices rejects cycles),
// ErrGroupNotFound when the group is absent.
func (s *Manager) GetPlan(ctx context.Context, tenantID uuid.UUID, groupID string) (BootPlan, error) {
	var services []Service
	var deps []Dependency
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var lerr error
		services, lerr = s.store.LoadServices(ctx, tx, groupID)
		if lerr != nil {
			return lerr
		}
		deps, lerr = s.store.LoadDependencies(ctx, tx, groupID)
		return lerr
	})
	if err != nil {
		return BootPlan{}, err
	}
	return s.planner.Plan(groupID, services, deps)
}

// StartRun creates a durable boot run for a group and executes it synchronously,
// tier by tier, returning the completed run detail. The plan is computed inside
// the create transaction so the per-service status rows are seeded at their
// planned tier; the orchestration then runs outside that transaction (each
// per-service status transition and the final run status are their OWN short
// transactions, so progress is durably observable and a control-plane restart
// does not lose committed status). The failure policy (halt|rollback) governs a
// tier that never goes healthy.
func (s *Manager) StartRun(ctx context.Context, tenantID uuid.UUID, groupID, policy string, initiatedBy *string) (RunDetail, error) {
	if policy == "" {
		policy = PolicyHalt
	}
	if !ValidPolicy(policy) {
		return RunDetail{}, fmt.Errorf("%q: %w", policy, ErrInvalidPolicy)
	}

	// 1. Compute the plan and create the run + seeded statuses atomically.
	var plan BootPlan
	var run *BootRun
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		services, lerr := s.store.LoadServices(ctx, tx, groupID)
		if lerr != nil {
			return lerr
		}
		if len(services) == 0 {
			return ErrNoServices
		}
		deps, derr := s.store.LoadDependencies(ctx, tx, groupID)
		if derr != nil {
			return derr
		}
		var perr error
		plan, perr = s.planner.Plan(groupID, services, deps)
		if perr != nil {
			return perr
		}
		var cerr error
		run, cerr = s.store.CreateRun(ctx, tx, &BootRun{
			TenantID:    tenantID.String(),
			GroupID:     groupID,
			Policy:      policy,
			InitiatedBy: initiatedBy,
		}, plan)
		return cerr
	})
	if err != nil {
		return RunDetail{}, err
	}
	s.metrics.observeRunStarted()

	// 2. Mark running, then orchestrate tier by tier.
	runID := run.ID
	if serr := s.setRunStatus(ctx, tenantID, runID, RunStatusRunning, 0, nil); serr != nil {
		return RunDetail{}, serr
	}

	orch, oerr := s.newOrchestrator(&sinkAdapter{svc: s, tenantID: tenantID})
	if oerr != nil {
		return RunDetail{}, oerr
	}
	outcome, exErr := orch.Execute(ctx, runID, plan, policy)
	if exErr != nil {
		msg := exErr.Error()
		_ = s.setRunStatus(ctx, tenantID, runID, RunStatusFailed, outcome.TiersBooted, &msg)
		return RunDetail{}, exErr
	}

	// 3. Persist the terminal run status + emit the lifecycle event.
	var lastErr *string
	if outcome.Err != nil {
		m := outcome.Err.Error()
		lastErr = &m
	}
	if serr := s.finishRun(ctx, tenantID, runID, outcome, lastErr); serr != nil {
		return RunDetail{}, serr
	}

	return s.GetRun(ctx, tenantID, runID)
}

// finishRun writes the terminal run status and stages the completion/failure
// event atomically.
func (s *Manager) finishRun(ctx context.Context, tenantID uuid.UUID, runID string, outcome RunOutcome, lastErr *string) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.SetRunStatus(ctx, tx, runID, outcome.Status, outcome.TiersBooted, lastErr); err != nil {
			return err
		}
		eventType := eventRunCompleted
		if outcome.Status != RunStatusCompleted {
			eventType = eventRunFailed
		}
		return s.stager.Stage(ctx, tx, eventType, tenantID.String(), map[string]any{
			"run_id":          runID,
			"status":          outcome.Status,
			"tiers_booted":    outcome.TiersBooted,
			"failed_tier":     outcome.FailedTier,
			"failed_services": outcome.FailedServices,
		})
	})
}

// setRunStatus updates a run's status in its own short tenant transaction.
func (s *Manager) setRunStatus(ctx context.Context, tenantID uuid.UUID, runID, status string, tiersBooted int, lastErr *string) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		return s.store.SetRunStatus(ctx, tx, runID, status, tiersBooted, lastErr)
	})
}

// GetRun returns a run plus its per-service statuses under a read-only tenant tx.
func (s *Manager) GetRun(ctx context.Context, tenantID uuid.UUID, runID string) (RunDetail, error) {
	var detail RunDetail
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		run, rerr := s.store.GetRun(ctx, tx, runID)
		if rerr != nil {
			return rerr
		}
		statuses, serr := s.store.ListRunStatuses(ctx, tx, runID)
		if serr != nil {
			return serr
		}
		detail = RunDetail{Run: *run, Services: statuses}
		return nil
	})
	if err != nil {
		return RunDetail{}, err
	}
	return detail, nil
}

// sinkAdapter bridges the Orchestrator's statusSink (no DBTX — each call is its
// own transaction) to the Store's DBTX-scoped status writes, running each in a
// short tenant transaction so per-service progress is durably observable as the
// run advances.
type sinkAdapter struct {
	svc      *Manager
	tenantID uuid.UUID
}

func (a *sinkAdapter) MarkServiceBooting(ctx context.Context, runID, serviceID string, tier, attempt int) error {
	return a.svc.runner.RunWithTenant(ctx, a.tenantID, func(tx DBTX) error {
		return a.svc.store.MarkServiceBooting(ctx, tx, runID, serviceID, tier, attempt)
	})
}

func (a *sinkAdapter) MarkServiceHealthy(ctx context.Context, runID, serviceID string, attempts int, at time.Time) error {
	return a.svc.runner.RunWithTenant(ctx, a.tenantID, func(tx DBTX) error {
		return a.svc.store.MarkServiceHealthy(ctx, tx, runID, serviceID, attempts, at)
	})
}

func (a *sinkAdapter) MarkServiceUnhealthy(ctx context.Context, runID, serviceID string, attempts int, lastErr string) error {
	return a.svc.runner.RunWithTenant(ctx, a.tenantID, func(tx DBTX) error {
		return a.svc.store.MarkServiceUnhealthy(ctx, tx, runID, serviceID, attempts, lastErr)
	})
}

func (a *sinkAdapter) MarkServiceRolledBack(ctx context.Context, runID, serviceID string) error {
	return a.svc.runner.RunWithTenant(ctx, a.tenantID, func(tx DBTX) error {
		return a.svc.store.MarkServiceRolledBack(ctx, tx, runID, serviceID)
	})
}

// compile-time checks.
var (
	_ storeAPI    = (*Store)(nil)
	_ txRunner    = PGXRunner{}
	_ eventStager = outboxStager{}
	_ statusSink  = (*sinkAdapter)(nil)
	_ repository.DBTX
)
