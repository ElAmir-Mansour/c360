package cleanroom

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

// Event types emitted to the DR events topic on a terminal verdict.
const (
	EventTypeCleanroomPassed = "dr.cleanroom.passed"
	EventTypeCleanroomFailed = "dr.cleanroom.failed"

	eventSource = "clario-dr-service/cleanroom"
)

// ErrNotConfigured is returned when a dependency required for a clean-room scan
// is not wired (e.g. the engine has no object-store-backed chunk reader).
var ErrNotConfigured = errors.New("cleanroom: dependency not configured")

// RecoveryPointInfo is the recovery-point metadata the service needs to drive a
// scan: which chunks to restore (object keys), the sealed content hash to check
// integrity against, and the group for the metric label / event subject.
type RecoveryPointInfo struct {
	ID          uuid.UUID
	GroupID     uuid.UUID
	ContentHash string
	ObjectKeys  map[string]string
}

// RecoveryPointLookup loads a recovery point's clean-room-relevant metadata for
// a tenant. It is satisfied by an adapter over the DR repository / service so
// this package does not import the shared service. Returning the model row's
// object_keys + content_hash is what lets the engine restore and integrity-check
// the exact sealed bytes.
type RecoveryPointLookup interface {
	LookupRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (RecoveryPointInfo, error)
}

// EventStager stages a clean-room event in the caller's transaction. OutboxStager
// is the production implementation; tests can supply a recorder.
type EventStager interface {
	Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error
}

// OutboxStager writes clean-room events to the transactional outbox on the DR
// events topic.
type OutboxStager struct{}

// Stage builds a CloudEvent and writes it to the outbox in the caller's tx.
func (OutboxStager) Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, db, events.Topics.DREvents, event)
}

// TenantRunner runs a function inside a tenant-scoped read or read-write
// transaction (RLS set). *pgxpool.Pool is adapted to it by PGXRunner; tests
// supply an in-memory fake.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant-context
// helpers (SET LOCAL app.current_tenant_id so RLS applies).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a tenant-scoped read-write transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("cleanroom: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("cleanroom: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// ScanStore is the persistence surface the service uses (CreateScan in the
// verdict tx, reads for the GET endpoint).
type ScanStore interface {
	CreateScan(ctx context.Context, db repository.DBTX, s *Scan) error
	LatestScan(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) (*Scan, error)
	ListScans(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) ([]*Scan, error)
}

// Service orchestrates clean-room recovery validation: look up a recovery point,
// run the Engine (restore + integrity + malware scan in a sandbox), then persist
// the verdict and emit the lifecycle event atomically, and update the SLO metric.
type Service struct {
	tx      TenantRunner
	store   ScanStore
	lookup  RecoveryPointLookup
	engine  *Engine
	stager  EventStager
	metrics *Metrics
	logger  zerolog.Logger
	now     func() time.Time
}

// Config wires a Service.
type Config struct {
	TX      TenantRunner
	Store   ScanStore
	Lookup  RecoveryPointLookup
	Engine  *Engine
	Stager  EventStager
	Metrics *Metrics
	Logger  zerolog.Logger
	Now     func() time.Time
}

// NewService constructs the clean-room service. The runner, store, lookup, and
// engine are required; a nil stager falls back to OutboxStager and a nil metrics
// is a no-op.
func NewService(cfg Config) (*Service, error) {
	if cfg.TX == nil {
		return nil, errors.New("cleanroom service: tenant runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("cleanroom service: scan store is required")
	}
	if cfg.Lookup == nil {
		return nil, errors.New("cleanroom service: recovery-point lookup is required")
	}
	if cfg.Engine == nil {
		return nil, errors.New("cleanroom service: engine is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = OutboxStager{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		tx:      cfg.TX,
		store:   cfg.Store,
		lookup:  cfg.Lookup,
		engine:  cfg.Engine,
		stager:  stager,
		metrics: cfg.Metrics,
		logger:  cfg.Logger.With().Str("service", "dr-cleanroom").Logger(),
		now:     now,
	}, nil
}

// ScanRecoveryPoint runs a full clean-room validation for a recovery point and
// records the verdict. It restores + scans OUTSIDE any DB transaction (sandbox
// I/O + scanning can be slow and must not hold a transaction open), then
// persists the verdict row and stages the dr.cleanroom.passed / failed event in
// one tenant-scoped transaction so the audit row and the event commit together.
// Returns the recorded Scan.
func (s *Service) ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*Scan, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrNotConfigured)
	}
	if pointID == uuid.Nil {
		return nil, fmt.Errorf("%w: recovery point id is required", ErrNotConfigured)
	}

	// Phase 1: resolve the recovery point's chunks + sealed hash (tenant read).
	var info RecoveryPointInfo
	var lookupErr error
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(repository.DBTX) error {
		info, lookupErr = s.lookup.LookupRecoveryPoint(ctx, tenantID, pointID)
		return lookupErr
	}); err != nil {
		return nil, err
	}

	// Phase 2: restore into the sandbox and run integrity + malware scanning. The
	// engine never returns a transport error for a dirty point — a failed restore
	// or scanner outage becomes a VerdictError scan — so an unverifiable point is
	// recorded and blocked rather than silently lost.
	scan, err := s.engine.Validate(ctx, tenantID, RecoveryPointRef{
		ID:          info.ID,
		GroupID:     info.GroupID,
		ContentHash: info.ContentHash,
		ObjectKeys:  info.ObjectKeys,
	})
	if err != nil {
		return nil, fmt.Errorf("running clean-room validation: %w", err)
	}

	// Phase 3: persist the verdict + emit the lifecycle event atomically.
	eventType := EventTypeCleanroomFailed
	if scan.Clean() {
		eventType = EventTypeCleanroomPassed
	}
	if err := s.tx.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.store.CreateScan(ctx, tx, scan); err != nil {
			return err
		}
		return s.stager.Stage(ctx, tx, eventType, tenantID.String(), map[string]any{
			"recovery_point_id": scan.RecoveryPointID,
			"group_id":          scan.GroupID,
			"verdict":           scan.Verdict,
			"scanner":           scan.Scanner,
			"chunks_scanned":    scan.ChunksScanned,
			"bytes_scanned":     scan.BytesScanned,
			"detail":            scan.Detail,
		})
	}); err != nil {
		return nil, err
	}

	// SLO board: count the verdict and the work done. The group label lets the DR
	// dashboard alert on a per-group dirty rate.
	s.metrics.IncVerdict(scan.GroupID, scan.Verdict)
	s.metrics.AddChunksScanned(scan.ChunksScanned)

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("recovery_point_id", scan.RecoveryPointID).
		Str("group_id", scan.GroupID).
		Str("verdict", scan.Verdict).
		Str("scanner", scan.Scanner).
		Int("chunks_scanned", scan.ChunksScanned).
		Msg("clean-room recovery validation completed")

	return scan, nil
}

// LatestScan returns the most recent clean-room scan for a recovery point.
func (s *Service) LatestScan(ctx context.Context, tenantID, pointID uuid.UUID) (*Scan, error) {
	var scan *Scan
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		scan, err = s.store.LatestScan(ctx, tx, tenantID.String(), pointID.String())
		return err
	}); err != nil {
		return nil, err
	}
	return scan, nil
}

// ListScans returns a recovery point's clean-room scan history, newest first.
func (s *Service) ListScans(ctx context.Context, tenantID, pointID uuid.UUID) ([]*Scan, error) {
	var scans []*Scan
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		scans, err = s.store.ListScans(ctx, tx, tenantID.String(), pointID.String())
		return err
	}); err != nil {
		return nil, err
	}
	return scans, nil
}
