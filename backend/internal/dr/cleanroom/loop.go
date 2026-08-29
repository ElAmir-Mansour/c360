package cleanroom

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// PendingPoint identifies a validated recovery point that still needs a
// clean-room scan before it can be promoted to recoverable. The PendingSource
// resolves these across tenants (system path) for the leader-singleton loop.
type PendingPoint struct {
	TenantID        uuid.UUID
	RecoveryPointID uuid.UUID
	GroupID         uuid.UUID
}

// PendingSource yields recovery points that are validated but not yet
// clean-room-scanned. The integration phase supplies a DB-backed implementation
// (a system query joining recovery_point LEFT JOIN dr_cleanroom_scan); this
// package defines only the seam so the loop is unit-testable with an in-memory
// list and so this package never edits the shared repository.
type PendingSource interface {
	PendingCleanroomScans(ctx context.Context, limit int) ([]PendingPoint, error)
}

// Scanner-facing service surface the loop drives. *Service satisfies it.
type loopService interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*Scan, error)
}

// Loop is the leader-singleton background validator: each tick it pulls the next
// batch of validated-but-unscanned recovery points and runs a clean-room scan on
// each, so a freshly sealed-and-validated point becomes promotable without a
// human pressing "scan". It mirrors the RPO monitor / failover loop lifecycle:
// started in the leader-election OnAcquire callback, stopped on OnLose.
type Loop struct {
	source   PendingSource
	svc      loopService
	logger   zerolog.Logger
	interval time.Duration
	batch    int
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	Source   PendingSource
	Service  loopService
	Logger   zerolog.Logger
	Interval time.Duration
	// Batch caps how many points are scanned per tick (clean-room scans are I/O
	// heavy). Defaults to 4.
	Batch int
}

// NewLoop constructs the background validator loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Source == nil {
		return nil, errors.New("cleanroom loop: pending source is required")
	}
	if cfg.Service == nil {
		return nil, errors.New("cleanroom loop: service is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 15 * time.Second
	}
	if cfg.Batch <= 0 {
		cfg.Batch = 4
	}
	return &Loop{
		source:   cfg.Source,
		svc:      cfg.Service,
		logger:   cfg.Logger.With().Str("loop", "dr-cleanroom").Logger(),
		interval: cfg.Interval,
		batch:    cfg.Batch,
	}, nil
}

// Run blocks until ctx is cancelled, scanning pending recovery points each tick.
// It is intended to be launched in a goroutine from the leader-election
// OnAcquire callback. When a tick scanned a full batch it retries immediately so
// a backlog drains promptly; otherwise it idle-polls at the interval.
func (l *Loop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		scanned, err := l.tick(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("clean-room loop tick failed")
		}
		if scanned >= l.batch {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}

// tick pulls one batch and scans each point. It returns how many points were
// scanned (so Run can drain a backlog without waiting a full interval). A scan
// failure on one point is logged and the loop continues with the next — one bad
// point must not stall the queue.
func (l *Loop) tick(ctx context.Context) (int, error) {
	points, err := l.source.PendingCleanroomScans(ctx, l.batch)
	if err != nil {
		return 0, err
	}
	scanned := 0
	for _, p := range points {
		if ctx.Err() != nil {
			return scanned, ctx.Err()
		}
		scan, err := l.svc.ScanRecoveryPoint(ctx, p.TenantID, p.RecoveryPointID)
		if err != nil {
			l.logger.Error().Err(err).
				Str("tenant_id", p.TenantID.String()).
				Str("recovery_point_id", p.RecoveryPointID.String()).
				Msg("clean-room scan failed")
			continue
		}
		scanned++
		l.logger.Debug().
			Str("recovery_point_id", p.RecoveryPointID.String()).
			Str("verdict", scan.Verdict).
			Msg("clean-room scan recorded")
	}
	return scanned, nil
}
