package attestledger

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog"
)

// anchorer is the surface the loop drives. *Recorder satisfies it.
type anchorer interface {
	AnchorAll(ctx context.Context, limit int) (int, error)
}

// Loop is the leader-singleton background anchoring job: each tick it seals a
// fresh Merkle checkpoint for every tenant that has accumulated unanchored
// ledger entries, so the WORM-anchored tamper-proof checkpoints advance without
// a human pressing "anchor". It mirrors the clean-room / RPO-monitor loop
// lifecycle: started in the leader-election OnAcquire callback, stopped on
// OnLose, so exactly one control-plane replica anchors at a time.
type Loop struct {
	svc      anchorer
	logger   zerolog.Logger
	interval time.Duration
	batch    int
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	Service  anchorer
	Logger   zerolog.Logger
	Interval time.Duration
	// Batch caps how many tenants are anchored per tick. Defaults to 16.
	Batch int
}

// NewLoop constructs the anchoring loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Service == nil {
		return nil, errors.New("attestledger loop: service is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 5 * time.Minute
	}
	if cfg.Batch <= 0 {
		cfg.Batch = 16
	}
	return &Loop{
		svc:      cfg.Service,
		logger:   cfg.Logger.With().Str("loop", "dr-attestledger-anchor").Logger(),
		interval: cfg.Interval,
		batch:    cfg.Batch,
	}, nil
}

// Run blocks until ctx is cancelled, anchoring pending tenants each tick. It is
// intended to be launched in a goroutine from the leader-election OnAcquire
// callback. When a tick anchored a full batch it retries immediately so a
// backlog drains promptly; otherwise it idle-polls at the interval.
func (l *Loop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		anchored, err := l.svc.AnchorAll(ctx, l.batch)
		if err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("attestation-ledger anchor tick failed")
		}
		if anchored >= l.batch {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}
