package failback

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// ValidationError marks a caller-correctable request problem (mirrors
// drservice.ValidationError so the handler maps it to 400).
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return e.Field + ": " + e.Message
}

// IsValidation reports whether err is a service validation error.
func IsValidation(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

func invalid(field, message string) error {
	return &ValidationError{Field: field, Message: message}
}

// TenantRunner executes a function under a tenant-scoped transaction (RLS
// backstop via SET LOCAL app.current_tenant_id), mirroring drservice.TenantRunner.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

type pgxTenantRunner struct {
	pool *pgxpool.Pool
}

func (r pgxTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r pgxTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// EventStager stages lifecycle events in the caller's transaction so a state
// change and its event commit atomically (mirrors drservice.EventStager).
type EventStager interface {
	Stage(ctx context.Context, tx repository.DBTX, eventType, tenantID string, data map[string]any) error
}

// OutboxStager writes failback events to the transactional outbox
// (datastream.dr.events).
type OutboxStager struct{}

// Stage writes a failback lifecycle event to event_outbox in the caller's tx.
func (OutboxStager) Stage(ctx context.Context, tx repository.DBTX, eventType, tenantID string, data map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, event)
}

type noopStager struct{}

func (noopStager) Stage(context.Context, repository.DBTX, string, string, map[string]any) error {
	return nil
}

// FailbackStore is the persistence contract the service depends on. *Store
// satisfies it; tests substitute an in-memory store.
type FailbackStore interface {
	CreateRun(ctx context.Context, db repository.DBTX, r *FailbackRun) error
	GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*FailbackRun, error)
	ListRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*FailbackRun, error)
	ApproveCutback(ctx context.Context, db repository.DBTX, tenantID, id, approvedBy string) error
	UpdateRunStatus(ctx context.Context, db repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error
	ListSteps(ctx context.Context, db repository.DBTX, runID string) ([]*FailbackStep, error)
}

// Service orchestrates the failback control API: plan a failback (create the run
// in PLANNING), read it, approve the gated cutback, and (for operator-driven
// stepping / tests) advance the FSM one state. The leader-singleton Loop is what
// normally advances runs; Advance here lets an operator force one deterministic
// step and is the same gated path.
type Service struct {
	tx     TenantRunner
	store  FailbackStore
	events EventStager
	driver *Driver
}

// ServiceConfig wires the failback service.
type ServiceConfig struct {
	Pool   *pgxpool.Pool
	Tx     TenantRunner
	Store  FailbackStore
	Events EventStager
	// Driver advances a run one state in Advance. Optional: when nil, Advance is
	// unavailable and returns ErrInvalidState (the Loop still drives runs).
	Driver *Driver
}

// NewService constructs the failback service. When Tx is nil a pool-backed runner
// is built from Pool.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("failback service: store is required")
	}
	if cfg.Tx == nil {
		if cfg.Pool == nil {
			return nil, errors.New("failback service: pool or tx runner is required")
		}
		cfg.Tx = pgxTenantRunner{pool: cfg.Pool}
	}
	if cfg.Events == nil {
		cfg.Events = noopStager{}
	}
	return &Service{
		tx:     cfg.Tx,
		store:  cfg.Store,
		events: cfg.Events,
		driver: cfg.Driver,
	}, nil
}

// PlanFailbackInput is the request to plan (create) a failback run.
type PlanFailbackInput struct {
	GroupID  uuid.UUID
	FromSite uuid.UUID // DR site currently authoritative
	ToSite   uuid.UUID // original/restored primary
	// FailoverRunID optionally links the failover this failback reverses.
	FailoverRunID *uuid.UUID
	// ConvergeThresholdBytes is the backlog at/under which the reverse stream is
	// considered converged (with the cutover window open). Zero = drain fully.
	ConvergeThresholdBytes int64
	InitiatedBy            uuid.UUID
}

// PlanFailback creates a failback run in PLANNING and stages a lifecycle event,
// atomically. The leader-singleton Loop then drives REVERSE_SYNCING onward.
func (s *Service) PlanFailback(ctx context.Context, tenantID uuid.UUID, in PlanFailbackInput) (*FailbackRun, error) {
	if in.GroupID == uuid.Nil {
		return nil, invalid("group_id", "is required")
	}
	if in.FromSite == uuid.Nil {
		return nil, invalid("from_site", "is required")
	}
	if in.ToSite == uuid.Nil {
		return nil, invalid("to_site", "is required")
	}
	if in.FromSite == in.ToSite {
		return nil, invalid("to_site", "must differ from from_site")
	}
	if in.InitiatedBy == uuid.Nil {
		return nil, invalid("initiated_by", "is required")
	}
	if in.ConvergeThresholdBytes < 0 {
		return nil, invalid("converge_threshold_bytes", "must not be negative")
	}

	run := &FailbackRun{
		TenantID:               tenantID.String(),
		GroupID:                in.GroupID.String(),
		FromSite:               in.FromSite.String(),
		ToSite:                 in.ToSite.String(),
		ConvergeThresholdBytes: in.ConvergeThresholdBytes,
		InitiatedBy:            in.InitiatedBy.String(),
	}
	if in.FailoverRunID != nil {
		run.FailoverRunID = strPtr(in.FailoverRunID.String())
	}

	err := s.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		if err := s.store.CreateRun(ctx, db, run); err != nil {
			return err
		}
		return s.events.Stage(ctx, db, "datastream.dr.failback.planned", run.TenantID, map[string]any{
			"run_id":                   run.ID,
			"group_id":                 run.GroupID,
			"from_site":                run.FromSite,
			"to_site":                  run.ToSite,
			"converge_threshold_bytes": run.ConvergeThresholdBytes,
			"direction":                DirectionDRToPrimary,
		})
	})
	if err != nil {
		return nil, err
	}
	return run, nil
}

// GetFailback loads one failback run scoped to the tenant.
func (s *Service) GetFailback(ctx context.Context, tenantID, id uuid.UUID) (*FailbackRun, error) {
	var run *FailbackRun
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		run, rerr = s.store.GetRun(ctx, db, tenantID.String(), id.String())
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return run, nil
}

// ListFailbacks returns a tenant's failback runs, newest first.
func (s *Service) ListFailbacks(ctx context.Context, tenantID uuid.UUID) ([]*FailbackRun, error) {
	var runs []*FailbackRun
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		runs, rerr = s.store.ListRuns(ctx, db, tenantID.String())
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return runs, nil
}

// ListSteps returns a run's step timeline.
func (s *Service) ListSteps(ctx context.Context, tenantID, id uuid.UUID) ([]*FailbackStep, error) {
	var steps []*FailbackStep
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		// Confirm the run is the tenant's before reading its steps (RLS also
		// backstops the step read via the parent-run policy).
		if _, gerr := s.store.GetRun(ctx, db, tenantID.String(), id.String()); gerr != nil {
			return gerr
		}
		var rerr error
		steps, rerr = s.store.ListSteps(ctx, db, id.String())
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return steps, nil
}

// ApproveCutback records the explicit human cutback approval and transitions the
// run AWAITING_CUTBACK_APPROVAL -> CUTTING_BACK, atomically with its event. This
// is the ONLY way past the cutback gate: the driver never auto-advances it. A run
// not awaiting approval (wrong state, or already approved) yields ErrInvalidState
// (mapped to 409). The leader-singleton Loop then picks the run up in
// CUTTING_BACK and executes the cutback.
func (s *Service) ApproveCutback(ctx context.Context, tenantID, id, approvedBy uuid.UUID) (*FailbackRun, error) {
	if approvedBy == uuid.Nil {
		return nil, invalid("approved_by", "is required")
	}
	var run *FailbackRun
	err := s.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		if err := s.store.ApproveCutback(ctx, db, tenantID.String(), id.String(), approvedBy.String()); err != nil {
			return err
		}
		var rerr error
		run, rerr = s.store.GetRun(ctx, db, tenantID.String(), id.String())
		if rerr != nil {
			return rerr
		}
		return s.events.Stage(ctx, db, "datastream.dr.failback.cutback_approved", run.TenantID, map[string]any{
			"run_id":      run.ID,
			"group_id":    run.GroupID,
			"approved_by": approvedBy.String(),
			"to_site":     run.ToSite,
		})
	})
	if err != nil {
		return nil, err
	}
	return run, nil
}

// Advance drives the run one durable state forward through the gated driver, in a
// single tenant transaction so the step, status, and outbox event commit
// atomically — the same path the Loop uses. It is the operator-driven /advance
// endpoint and is gated identically: a run in AWAITING_CUTBACK_APPROVAL without an
// approval does not advance (the driver returns ErrNotApproved / no-op), and an
// already-terminal run is a no-op.
func (s *Service) Advance(ctx context.Context, tenantID, id uuid.UUID) (*FailbackRun, error) {
	if s.driver == nil {
		return nil, fmt.Errorf("failback advance is not configured: %w", ErrInvalidState)
	}
	var run *FailbackRun
	err := s.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		loaded, gerr := s.store.GetRun(ctx, db, tenantID.String(), id.String())
		if gerr != nil {
			return gerr
		}
		run = loaded
		if aerr := s.driver.Advance(ctx, db, run); aerr != nil {
			if IsRecordedFailure(aerr) {
				// Failure already recorded durably in this tx; commit it.
				return nil
			}
			return aerr
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return run, nil
}
