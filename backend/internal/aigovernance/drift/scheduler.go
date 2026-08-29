package drift

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

type DriftRunner interface {
	RunAllProductionModels(ctx context.Context) error
}

type Scheduler struct {
	runner   DriftRunner
	interval time.Duration
	logger   zerolog.Logger
}

func NewScheduler(runner DriftRunner, interval time.Duration, logger zerolog.Logger) *Scheduler {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	return &Scheduler{
		runner:   runner,
		interval: interval,
		logger:   logger.With().Str("component", "ai_drift_scheduler").Logger(),
	}
}

func (s *Scheduler) Run(ctx context.Context) error {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := s.runner.RunAllProductionModels(ctx); err != nil {
			if isShutdownError(err) {
				return canceledOrContextErr(ctx)
			}
			s.logger.Error().Err(err).Msg("drift calculation run failed")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func isShutdownError(err error) bool {
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "closed pool")
}

func canceledOrContextErr(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return context.Canceled
}
