package byok

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// loopDriver is the subset of *Service the RotationLoop drives. Declared as an
// interface so the loop's claim/dispatch logic is unit-tested without a DB.
type loopDriver interface {
	ResumeRotation(ctx context.Context, tenantID uuid.UUID) error
}

// loopStore is the claim surface the loop reads through (satisfied by *Store).
type loopStore interface {
	RotatingTenantsSystem(ctx context.Context, db repository.DBTX, limit int) ([]uuid.UUID, error)
}

// loopSystemRunner runs the cross-tenant scan on the system (RLS-bypass) path.
type loopSystemRunner interface {
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// RotationLoop is the leader-singleton background loop that completes rotations
// left stuck mid-flight. A rotation that crashed after creating the new
// 'rotating' KEK but before the atomic flip leaves the tenant with the OLD
// version still active (correct, sovereign default) and a 'rotating' successor.
// On each tick the loop finds such tenants (across tenants, on the system path)
// and calls ResumeRotation, which rewraps any remaining DEKs and performs the
// atomic flip. Launch it from the leader-election OnAcquire callback so exactly
// one process runs it, mirroring the storageoffload OffloadLoop.
type RotationLoop struct {
	driver   loopDriver
	store    loopStore
	system   loopSystemRunner
	logger   zerolog.Logger
	interval time.Duration
	batch    int
}

// RotationLoopConfig wires a RotationLoop.
type RotationLoopConfig struct {
	Driver   loopDriver
	Store    loopStore
	System   loopSystemRunner
	Logger   zerolog.Logger
	Interval time.Duration // tick cadence; <= 0 defaults to defaultLoopInterval
	Batch    int           // tenants resumed per tick; <= 0 defaults to defaultLoopBatch
}

const (
	defaultLoopInterval = 5 * time.Second
	defaultLoopBatch    = 8
)

// NewRotationLoop constructs the rotation-recovery loop.
func NewRotationLoop(cfg RotationLoopConfig) (*RotationLoop, error) {
	if cfg.Driver == nil {
		return nil, errors.New("byok loop: driver is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("byok loop: store is required")
	}
	if cfg.System == nil {
		return nil, errors.New("byok loop: system runner is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = defaultLoopInterval
	}
	if cfg.Batch <= 0 {
		cfg.Batch = defaultLoopBatch
	}
	return &RotationLoop{
		driver:   cfg.Driver,
		store:    cfg.Store,
		system:   cfg.System,
		logger:   cfg.Logger.With().Str("component", "dr_byok_loop").Logger(),
		interval: cfg.Interval,
		batch:    cfg.Batch,
	}, nil
}

// Run blocks until ctx is cancelled, ticking every interval. Launch it from the
// leader-election OnAcquire callback so a single instance completes rotations.
func (l *RotationLoop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := l.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("byok rotation tick failed")
		}
		timer.Reset(l.interval)
	}
}

// Tick finds tenants with a stuck 'rotating' KEK and resumes each. Per-tenant
// errors are isolated: one tenant failing to resume does not block the rest. Tick
// is exported so tests drive it deterministically.
func (l *RotationLoop) Tick(ctx context.Context) error {
	var tenants []uuid.UUID
	if err := l.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var serr error
		tenants, serr = l.store.RotatingTenantsSystem(ctx, db, l.batch)
		return serr
	}); err != nil {
		return err
	}
	for _, tenantID := range tenants {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := l.driver.ResumeRotation(ctx, tenantID); err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			l.logger.Warn().Err(err).Str("tenant_id", tenantID.String()).Msg("byok rotation resume failed; will retry")
		}
	}
	return nil
}
