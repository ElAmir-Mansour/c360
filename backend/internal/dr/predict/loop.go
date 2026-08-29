package predict

import (
	"context"
	"time"

	"github.com/rs/zerolog"
)

// Scanner is the surface the loop drives. *Service implements it; tests can
// substitute a counter to assert the loop's scheduling without a forecaster.
type Scanner interface {
	RunOnce(ctx context.Context) (*Result, error)
}

// Loop runs the forecaster on a fixed interval. It is intended to be started in
// a leadership Elector's OnAcquire (so only the leader forecasts) and stopped
// in OnLose / on shutdown via Stop. Start is safe to call once per acquired
// leadership; a second Start while running is ignored.
type Loop struct {
	scanner  Scanner
	interval time.Duration
	logger   zerolog.Logger

	cancel context.CancelFunc
	done   chan struct{}
}

// LoopConfig configures the forecaster loop. Interval <= 0 defaults to 30s.
type LoopConfig struct {
	Interval time.Duration
	Logger   zerolog.Logger
}

// NewLoop builds a forecaster loop.
func NewLoop(scanner Scanner, cfg LoopConfig) *Loop {
	interval := cfg.Interval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Loop{scanner: scanner, interval: interval, logger: cfg.Logger}
}

// Start runs the loop in a goroutine bound to ctx. It runs one scan
// immediately, then on each tick, until ctx is cancelled or Stop is called.
// Calling Start while already running is a no-op.
func (l *Loop) Start(ctx context.Context) {
	if l == nil || l.scanner == nil || l.cancel != nil {
		return
	}
	runCtx, cancel := context.WithCancel(ctx)
	l.cancel = cancel
	l.done = make(chan struct{})

	go func() {
		defer close(l.done)
		ticker := time.NewTicker(l.interval)
		defer ticker.Stop()

		l.scanOnce(runCtx)
		for {
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
				l.scanOnce(runCtx)
			}
		}
	}()
}

func (l *Loop) scanOnce(ctx context.Context) {
	res, err := l.scanner.RunOnce(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		l.logger.Error().Err(err).Msg("dr failure-prediction scan failed")
		return
	}
	if res == nil {
		return
	}
	if res.BreachForecasts > 0 || res.CollapseDetected > 0 || res.BreachCleared > 0 {
		l.logger.Info().
			Int("scanned", res.Scanned).
			Int("breach_forecasts", res.BreachForecasts).
			Int("breach_cleared", res.BreachCleared).
			Int("collapse_detected", res.CollapseDetected).
			Msg("dr failure-prediction scan staged alerts")
	} else {
		l.logger.Debug().Int("scanned", res.Scanned).Msg("dr failure-prediction scan complete")
	}
}

// Stop cancels the loop and waits for the goroutine to exit. Safe to call when
// not running and safe to call multiple times.
func (l *Loop) Stop() {
	if l == nil || l.cancel == nil {
		return
	}
	l.cancel()
	if l.done != nil {
		<-l.done
	}
	l.cancel = nil
	l.done = nil
}
