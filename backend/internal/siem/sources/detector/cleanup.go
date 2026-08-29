package detector

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/sources/repo"
)

// CleanupJob prunes siem.source_eps_samples older than the retention
// window. Runs on its own ticker (default 6h) so the high-frequency
// detector loop is not blocked by occasional long DELETEs.
type CleanupJob struct {
	eps       *repo.EPSRepo
	retention time.Duration
	interval  time.Duration
	logger    zerolog.Logger
}

// NewCleanupJob constructs the job.
func NewCleanupJob(eps *repo.EPSRepo, retention, interval time.Duration, logger zerolog.Logger) *CleanupJob {
	if retention <= 0 {
		retention = 7 * 24 * time.Hour
	}
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	return &CleanupJob{
		eps: eps, retention: retention, interval: interval,
		logger: logger.With().Str("component", "siem-eps-cleanup").Logger(),
	}
}

// Start runs the cleanup ticker until ctx is done.
func (c *CleanupJob) Start(ctx context.Context) error {
	t := time.NewTicker(c.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			c.runOnce(ctx)
		}
	}
}

func (c *CleanupJob) runOnce(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-c.retention)
	n, err := c.eps.PruneOlderThan(ctx, cutoff)
	if err != nil {
		c.logger.Warn().Err(err).Msg("eps prune")
		return
	}
	if n > 0 {
		c.logger.Info().Int64("pruned", n).Time("cutoff", cutoff).Msg("eps samples pruned")
	}
}
