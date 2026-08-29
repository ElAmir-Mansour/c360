package service

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// stalePendingStore is the OPTIONAL persistence capability the activity
// idempotency reconciler needs. The production
// *repository.ActivityExecutionRepository satisfies it. It is an interface so the
// reconciler is unit-testable without a database, and so wiring it is optional —
// a deployment that has not wired an activity ledger simply does not construct a
// reconciler, and nothing else changes.
type stalePendingStore interface {
	// ListStalePending returns ledger rows stuck in 'pending' older than
	// olderThan (an outbound call CLAIMED but never resolved before a crash).
	ListStalePending(ctx context.Context, olderThan time.Duration, limit int) ([]*model.ActivityExecution, error)
	// ExpireStalePending CAS-flips one stale pending row to 'failed'. It returns
	// true only when it performed the expiry (the row was still pending + stale).
	ExpireStalePending(ctx context.Context, idempotencyKey string, olderThan time.Duration, reason string) (bool, error)
}

// ActivityReconcilerConfig configures the stale-pending idempotency reconciler.
type ActivityReconcilerConfig struct {
	// Store is the idempotency ledger. Required.
	Store stalePendingStore
	// Logger is the base logger. A Nop logger is used when zero.
	Logger zerolog.Logger
	// Interval is the sweep cadence. Defaults to 1 minute when non-positive.
	Interval time.Duration
	// StaleAfter is how long a ledger row may sit in 'pending' before it is
	// presumed abandoned (the process died between Claim and Mark*). It should be
	// comfortably longer than the longest legitimate outbound call + retry budget
	// so an in-flight call is never expired out from under itself. Defaults to
	// 15 minutes when non-positive.
	StaleAfter time.Duration
	// BatchLimit caps how many stale rows are examined per sweep. Defaults to 100.
	BatchLimit int
}

// ActivityReconciler periodically sweeps the outbound-activity idempotency ledger
// for rows stuck in 'pending' past a configurable age and re-drives them by
// expiring the stale claim to 'failed'.
//
// WHY THIS EXISTS (WAVE-2 durability nit). The service-task executor records a
// 'pending' ledger row BEFORE issuing an outbound call, then flips it to
// 'completed'/'failed' after. A crash BETWEEN those two writes leaves a 'pending'
// row that can never replay: on re-execution the executor sees the existing
// pending row for the same idempotency key and (correctly, since it cannot tell a
// genuinely in-flight call from an abandoned one) REFUSES to re-fire, so the step
// hangs forever. This reconciler is the safety net: after StaleAfter, it expires
// the abandoned claim to 'failed', which lets the engine's normal retry path
// re-drive the step under a fresh attempt key (or, when retries are exhausted,
// escalate to a governed incident) instead of silently stalling.
//
// It is designed to run as a leader-elected singleton (wrap Run with
// RunLeaderSingleton) so a fleet does not expire the same rows from multiple
// replicas; the ExpireStalePending CAS guard makes concurrent expiry harmless
// even if two replicas race.
type ActivityReconciler struct {
	store      stalePendingStore
	logger     zerolog.Logger
	interval   time.Duration
	staleAfter time.Duration
	batchLimit int
}

// NewActivityReconciler builds an ActivityReconciler from cfg, applying defaults.
// It returns nil when no store is supplied so callers can treat "no ledger wired"
// as "no reconciler" without a nil-check cascade.
func NewActivityReconciler(cfg ActivityReconcilerConfig) *ActivityReconciler {
	if cfg.Store == nil {
		return nil
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = time.Minute
	}
	staleAfter := cfg.StaleAfter
	if staleAfter <= 0 {
		staleAfter = 15 * time.Minute
	}
	batchLimit := cfg.BatchLimit
	if batchLimit <= 0 {
		batchLimit = 100
	}
	return &ActivityReconciler{
		store:      cfg.Store,
		logger:     cfg.Logger.With().Str("service", "workflow-activity-reconciler").Logger(),
		interval:   interval,
		staleAfter: staleAfter,
		batchLimit: batchLimit,
	}
}

// Run blocks until ctx is cancelled, sweeping stale pending activities each
// interval tick. Launch it from a leader-election OnAcquire callback so only one
// replica drives the sweep at a time.
func (r *ActivityReconciler) Run(ctx context.Context) {
	if r == nil {
		return
	}
	r.logger.Info().
		Dur("interval", r.interval).
		Dur("stale_after", r.staleAfter).
		Msg("activity idempotency reconciler started")

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.logger.Info().Msg("activity idempotency reconciler stopping")
			return
		case <-ticker.C:
			if n := r.Sweep(ctx); n > 0 {
				r.logger.Warn().Int("expired", n).Msg("reconciled stale pending activities")
			}
		}
	}
}

// Sweep performs a single reconciliation pass: it lists stale pending ledger rows
// and expires each one. It returns how many rows it actually expired. Safe to
// call directly in tests. Per-row errors are logged and skipped so one bad row
// never stalls the batch.
func (r *ActivityReconciler) Sweep(ctx context.Context) int {
	if r == nil {
		return 0
	}
	stale, err := r.store.ListStalePending(ctx, r.staleAfter, r.batchLimit)
	if err != nil {
		r.logger.Error().Err(err).Msg("failed to list stale pending activities")
		return 0
	}
	if len(stale) == 0 {
		return 0
	}

	const reason = "reconciled: stale pending activity claim presumed abandoned (crash between claim and completion); expired so the step can be re-driven or escalated"
	expired := 0
	for _, act := range stale {
		select {
		case <-ctx.Done():
			return expired
		default:
		}
		ok, err := r.store.ExpireStalePending(ctx, act.IdempotencyKey, r.staleAfter, reason)
		if err != nil {
			r.logger.Error().Err(err).
				Str("idempotency_key", act.IdempotencyKey).
				Str("instance_id", act.InstanceID).
				Str("step_id", act.StepID).
				Msg("failed to expire stale pending activity")
			continue
		}
		if ok {
			expired++
			r.logger.Warn().
				Str("idempotency_key", act.IdempotencyKey).
				Str("instance_id", act.InstanceID).
				Str("step_id", act.StepID).
				Int("attempt", act.Attempt).
				Time("claimed_at", act.CreatedAt).
				Msg("expired stale pending activity claim (surfaced for re-drive/escalation)")
		}
	}
	return expired
}
