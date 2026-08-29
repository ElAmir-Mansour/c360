package drillsched

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
)

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's validation and diff
// orchestration is exercised without a database, while the store's own SQL is
// covered in the integrate phase.
type storeAPI interface {
	GroupExists(ctx context.Context, db DBTX, groupID string) (string, bool, error)
	CreateSchedule(ctx context.Context, db DBTX, sc *Schedule) error
	GetSchedule(ctx context.Context, db DBTX, tenantID, id string) (*Schedule, error)
	ListSchedules(ctx context.Context, db DBTX, tenantID string) ([]*Schedule, error)
	DeleteSchedule(ctx context.Context, db DBTX, tenantID, id string) error
	CreateResult(ctx context.Context, db DBTX, res *DrillResult) error
	GetResult(ctx context.Context, db DBTX, tenantID, id string) (*DrillResult, error)
	ListResultsByGroup(ctx context.Context, db DBTX, tenantID, groupID string) ([]*DrillResult, error)
	PreviousResult(ctx context.Context, db DBTX, tenantID string, ref *DrillResult) (*DrillResult, error)
}

// txRunner runs a function inside a tenant-scoped transaction. A request-path
// schedule create commits its row under the caller's tenant; a read uses the
// read-only path so RLS filters by tenant.
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

// Service is the request-path orchestration for scheduled drills: it validates
// and persists schedules (parsing the cron to compute the first next_run),
// computes the next N fire times (proving the cron engine), ingests the outcome
// the failover DRILL path produced, lists results, and diffs a result against
// its predecessor. The scheduler loop (scheduler.go) owns the firing; this owns
// the human-facing surface. It holds no algorithms itself beyond wiring — the
// cron engine (cron.go) and the diff engine (diff.go) are pure functions it calls.
type Service struct {
	store   storeAPI
	runner  txRunner
	metrics *Metrics
	now     func() time.Time
	logger  zerolog.Logger
}

// Config wires a Service.
type Config struct {
	Store   storeAPI
	Runner  txRunner
	Metrics *Metrics
	// Now is optional; defaults to time.Now (UTC). Injected for deterministic tests.
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a drillsched service.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("drillsched service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("drillsched service: runner is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:   cfg.Store,
		runner:  cfg.Runner,
		metrics: cfg.Metrics,
		now:     now,
		logger:  cfg.Logger.With().Str("service", "dr-drillsched").Logger(),
	}, nil
}

// validationError carries a field-scoped reason and wraps ErrValidation.
func invalid(field, message string) error {
	return fmt.Errorf("%w: %s: %s", ErrValidation, field, message)
}

// CreateScheduleInput is the request-path payload for a new drill schedule.
type CreateScheduleInput struct {
	GroupID             uuid.UUID
	Name                string
	CronExpr            string
	Profile             string
	RTOObjectiveSeconds int
	Enabled             *bool // nil = enabled by default
}

// CreateSchedule validates the input (group exists, cron parses, profile valid),
// computes the first next_run from the cron expression, and persists the
// schedule. The cron is parsed BEFORE the write so an invalid expression is a
// clean 400, never a stored time bomb the scheduler would later trip over.
func (s *Service) CreateSchedule(ctx context.Context, tenantID uuid.UUID, in CreateScheduleInput) (*Schedule, error) {
	if in.GroupID == uuid.Nil {
		return nil, invalid("group_id", "group id is required")
	}
	if in.Name == "" {
		return nil, invalid("name", "name is required")
	}
	cron, err := ParseCron(in.CronExpr)
	if err != nil {
		return nil, fmt.Errorf("%w: cron_expr: %v", ErrValidation, err)
	}
	profile := in.Profile
	if profile == "" {
		profile = ProfileIsolated // a scheduled drill is non-disruptive by default.
	}
	if profile != ProfileIsolated && profile != ProfileProduction {
		return nil, invalid("profile", "profile must be isolated or production")
	}
	if in.RTOObjectiveSeconds < 0 {
		return nil, invalid("rto_objective_seconds", "must not be negative")
	}
	rto := in.RTOObjectiveSeconds
	if rto == 0 {
		rto = 900 // GA default; the integration phase may refine to the group's strictest member.
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	next := cron.NextAfter(s.now())
	if next.IsZero() {
		return nil, invalid("cron_expr", "expression has no future fire time")
	}

	sc := &Schedule{
		TenantID:            tenantID.String(),
		GroupID:             in.GroupID.String(),
		Name:                in.Name,
		CronExpr:            cron.Expr(),
		Profile:             profile,
		RTOObjectiveSeconds: rto,
		Enabled:             enabled,
		NextRun:             next,
	}
	err = s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		_, exists, gerr := s.store.GroupExists(ctx, db, in.GroupID.String())
		if gerr != nil {
			return gerr
		}
		if !exists {
			return fmt.Errorf("group %s: %w", in.GroupID, ErrGroupNotFound)
		}
		return s.store.CreateSchedule(ctx, db, sc)
	})
	if err != nil {
		return nil, err
	}
	return sc, nil
}

// ListSchedules returns the tenant's drill schedules.
func (s *Service) ListSchedules(ctx context.Context, tenantID uuid.UUID) ([]*Schedule, error) {
	var out []*Schedule
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var lerr error
		out, lerr = s.store.ListSchedules(ctx, db, tenantID.String())
		return lerr
	})
	if out == nil {
		out = []*Schedule{}
	}
	return out, err
}

// GetSchedule returns one schedule scoped to the tenant.
func (s *Service) GetSchedule(ctx context.Context, tenantID, id uuid.UUID) (*Schedule, error) {
	var sc *Schedule
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var gerr error
		sc, gerr = s.store.GetSchedule(ctx, db, tenantID.String(), id.String())
		return gerr
	})
	return sc, err
}

// DeleteSchedule removes one schedule scoped to the tenant.
func (s *Service) DeleteSchedule(ctx context.Context, tenantID, id uuid.UUID) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		return s.store.DeleteSchedule(ctx, db, tenantID.String(), id.String())
	})
}

// NextRuns computes the next n fire times for a schedule, strictly after the
// service clock. It loads the schedule (tenant-scoped), re-parses its cron, and
// runs the engine — this is the endpoint that proves the cron evaluator end to
// end. n is clamped to [1, 100].
func (s *Service) NextRuns(ctx context.Context, tenantID, id uuid.UUID, n int) ([]time.Time, error) {
	if n <= 0 {
		n = 5
	}
	if n > 100 {
		n = 100
	}
	sc, err := s.GetSchedule(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	cron, err := ParseCron(sc.CronExpr)
	if err != nil {
		// A stored schedule's cron is validated on create, so this is an internal
		// inconsistency rather than a user error.
		return nil, fmt.Errorf("drillsched: stored cron %q for schedule %s is invalid: %w", sc.CronExpr, id, err)
	}
	return cron.NextN(s.now(), n), nil
}

// IngestResultInput records the outcome the failover DRILL path produced. The
// integration phase calls this from the attestation/teardown consumer once a
// DRILL run reaches a terminal state; the run is the source of truth for the
// achieved RTO/RPO, the step timeline, the pinned recovery point and the
// validation outcome.
type IngestResultInput struct {
	GroupID             uuid.UUID
	ScheduleID          *uuid.UUID
	RunID               string
	Passed              bool
	RTOAchievedSeconds  int
	RPOAchievedSeconds  int
	RTOObjectiveSeconds int
	RecoveryPointID     *uuid.UUID
	ValidationRatio     *float64
	ValidationOutcome   string
	Steps               []DrillStep
	AssetFingerprint    AssetFingerprint
	ObservedAt          time.Time
}

// IngestResult persists a drill result and returns it together with its diff
// against the previous result for the same schedule/group. Recording the result
// and computing the diff happen in ONE tenant transaction so the diff reflects
// exactly the just-committed result. When there is no predecessor, the diff is
// computed against nil (a first-result diff) so the caller always gets a
// structured DrillDiff.
func (s *Service) IngestResult(ctx context.Context, tenantID uuid.UUID, in IngestResultInput) (*DrillResult, DrillDiff, error) {
	if in.GroupID == uuid.Nil {
		return nil, DrillDiff{}, invalid("group_id", "group id is required")
	}
	if in.RunID == "" {
		return nil, DrillDiff{}, invalid("run_id", "run id is required")
	}
	if in.RTOAchievedSeconds < 0 || in.RPOAchievedSeconds < 0 {
		return nil, DrillDiff{}, invalid("rto/rpo", "achieved seconds must not be negative")
	}

	res := &DrillResult{
		TenantID:            tenantID.String(),
		GroupID:             in.GroupID.String(),
		RunID:               in.RunID,
		Passed:              in.Passed,
		RTOAchievedSeconds:  in.RTOAchievedSeconds,
		RPOAchievedSeconds:  in.RPOAchievedSeconds,
		RTOObjectiveSeconds: in.RTOObjectiveSeconds,
		ValidationOutcome:   in.ValidationOutcome,
		Steps:               in.Steps,
		AssetFingerprint:    in.AssetFingerprint,
		ObservedAt:          in.ObservedAt,
	}
	if in.ScheduleID != nil && *in.ScheduleID != uuid.Nil {
		sid := in.ScheduleID.String()
		res.ScheduleID = &sid
	}
	if in.RecoveryPointID != nil && *in.RecoveryPointID != uuid.Nil {
		rp := in.RecoveryPointID.String()
		res.RecoveryPointID = &rp
	}
	res.ValidationRatio = in.ValidationRatio
	if res.ObservedAt.IsZero() {
		res.ObservedAt = s.now()
	}

	var diff DrillDiff
	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		_, exists, gerr := s.store.GroupExists(ctx, db, in.GroupID.String())
		if gerr != nil {
			return gerr
		}
		if !exists {
			return fmt.Errorf("group %s: %w", in.GroupID, ErrGroupNotFound)
		}
		if cerr := s.store.CreateResult(ctx, db, res); cerr != nil {
			return cerr
		}
		previous, perr := s.store.PreviousResult(ctx, db, tenantID.String(), res)
		switch {
		case perr == nil:
			diff = DiffResults(previous, res, 0)
		case errors.Is(perr, ErrNoPrevious):
			diff = DiffResults(nil, res, 0)
		default:
			return perr
		}
		return nil
	})
	if err != nil {
		return nil, DrillDiff{}, err
	}

	s.metrics.IncResultIngested(res.GroupID, res.Passed)
	s.metrics.ObserveDiff(res.GroupID, diff)
	return res, diff, nil
}

// ListResultsByGroup returns a group's drill results, newest first.
func (s *Service) ListResultsByGroup(ctx context.Context, tenantID, groupID uuid.UUID) ([]*DrillResult, error) {
	var out []*DrillResult
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var lerr error
		out, lerr = s.store.ListResultsByGroup(ctx, db, tenantID.String(), groupID.String())
		return lerr
	})
	if out == nil {
		out = []*DrillResult{}
	}
	return out, err
}

// DiffResult loads a result and the one immediately preceding it (same schedule
// when set, else the group's ad-hoc results) and returns the structured diff. It
// returns ErrNoPrevious when the result is the first for its scope, so the
// router can answer 404/empty rather than fabricating a baseline.
func (s *Service) DiffResult(ctx context.Context, tenantID, resultID uuid.UUID) (DrillDiff, error) {
	var diff DrillDiff
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		res, gerr := s.store.GetResult(ctx, db, tenantID.String(), resultID.String())
		if gerr != nil {
			return gerr
		}
		previous, perr := s.store.PreviousResult(ctx, db, tenantID.String(), res)
		if perr != nil {
			return perr
		}
		diff = DiffResults(previous, res, 0)
		return nil
	})
	if err != nil {
		return DrillDiff{}, err
	}
	s.metrics.ObserveDiff(diff.GroupID, diff)
	return diff, nil
}
