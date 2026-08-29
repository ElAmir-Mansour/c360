package storageoffload

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// loopDriver is the subset of *Service the OffloadLoop drives. Declared as an
// interface so the loop's claim/dispatch logic is unit-tested without a DB.
type loopDriver interface {
	DriveSnapshot(ctx context.Context, snap *Snapshot) error
	ApplyRetention(ctx context.Context, volumeID uuid.UUID) (int, error)
}

// loopStore is the claim surface the loop reads through (satisfied by *Store).
type loopStore interface {
	ClaimActiveSnapshots(ctx context.Context, db repository.DBTX, limit int) ([]*Snapshot, error)
}

// loopSystemRunner runs the cross-tenant claim on the system (RLS-bypass) path.
type loopSystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
}

// OffloadLoop is the leader-singleton background loop that drives storage-offload
// snapshots forward and applies retention. On each tick it claims the snapshots
// still PENDING/CREATING/REPLICATING (across tenants, on the system path) and
// advances each: creating ones are polled to READY and catalogued; replicating
// ones are shipped to their target. After advancing, it applies retention to the
// distinct volumes it touched. It mirrors the instant HydrateLoop and the
// failover Driver: launch it from the leader-election OnAcquire callback so
// exactly one process runs it.
type OffloadLoop struct {
	driver   loopDriver
	store    loopStore
	system   loopSystemRunner
	logger   zerolog.Logger
	interval time.Duration
	batch    int
}

// OffloadLoopConfig wires an OffloadLoop.
type OffloadLoopConfig struct {
	Driver   loopDriver
	Store    loopStore
	System   loopSystemRunner
	Logger   zerolog.Logger
	Interval time.Duration // tick cadence; <= 0 defaults to defaultLoopInterval
	Batch    int           // snapshots advanced per tick; <= 0 defaults to defaultLoopBatch
}

const (
	defaultLoopInterval = 2 * time.Second
	defaultLoopBatch    = 16
)

// NewOffloadLoop constructs the offload loop.
func NewOffloadLoop(cfg OffloadLoopConfig) (*OffloadLoop, error) {
	if cfg.Driver == nil {
		return nil, errors.New("storageoffload loop: driver is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("storageoffload loop: store is required")
	}
	if cfg.System == nil {
		return nil, errors.New("storageoffload loop: system runner is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = defaultLoopInterval
	}
	if cfg.Batch <= 0 {
		cfg.Batch = defaultLoopBatch
	}
	return &OffloadLoop{
		driver:   cfg.Driver,
		store:    cfg.Store,
		system:   cfg.System,
		logger:   cfg.Logger.With().Str("component", "dr_storageoffload_loop").Logger(),
		interval: cfg.Interval,
		batch:    cfg.Batch,
	}, nil
}

// Run blocks until ctx is cancelled, ticking every interval. Launch it from the
// leader-election OnAcquire callback so a single instance drives offload.
func (l *OffloadLoop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := l.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("storage offload tick failed")
		}
		timer.Reset(l.interval)
	}
}

// Tick advances one batch of active snapshots, then applies retention to the
// volumes it touched. It claims the snapshots on the system write path, then
// advances each one outside the claim (drive manages its own transactions), so a
// slow snapshot does not hold the claim lock. Per-snapshot errors are isolated:
// one failing snapshot is marked FAILED by the driver and the rest still
// progress. Tick is exported so tests drive it deterministically.
func (l *OffloadLoop) Tick(ctx context.Context) error {
	var snapshots []*Snapshot
	if err := l.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		var cerr error
		snapshots, cerr = l.store.ClaimActiveSnapshots(ctx, db, l.batch)
		return cerr
	}); err != nil {
		return err
	}

	touchedVolumes := make(map[uuid.UUID]struct{})
	for _, snap := range snapshots {
		if err := ctx.Err(); err != nil {
			return err
		}
		touchedVolumes[snap.VolumeID] = struct{}{}
		if err := l.driver.DriveSnapshot(ctx, snap); err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			// DriveSnapshot already catalogued FAILED; log and continue the batch.
			l.logger.Warn().Err(err).Str("snapshot_id", snap.ID.String()).Msg("storage offload snapshot advance failed")
		}
	}

	for volumeID := range touchedVolumes {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := l.driver.ApplyRetention(ctx, volumeID); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Warn().Err(err).Str("volume_id", volumeID.String()).Msg("storage offload retention failed")
		}
	}
	return nil
}
