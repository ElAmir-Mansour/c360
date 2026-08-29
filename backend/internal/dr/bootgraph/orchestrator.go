package bootgraph

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// Booter issues the boot (start/restore) of a single recoverable service at the
// recovery site and returns once the boot COMMAND has been accepted (not once
// the service is healthy — that is what the HealthChecker gates). It is the seam
// the §6.3 recovery executor / a RecoveryTargetDriver plugs into; a unit test
// substitutes a scripted Booter. TearDown stops a previously-booted service
// during a rollback. Both are context-bounded.
type Booter interface {
	Boot(ctx context.Context, svc Service) error
	TearDown(ctx context.Context, svc Service) error
}

// NoopBooter is a Booter that does nothing (the boot is performed out-of-band by
// the recovery target; the orchestrator's job is then purely to health-gate and
// order). It is a REAL default, not a stub: a deployment whose services are
// already started by an external restore step uses it so the orchestrator
// becomes a pure dependency-ordered health barrier.
type NoopBooter struct{}

// Boot implements Booter.
func (NoopBooter) Boot(context.Context, Service) error { return nil }

// TearDown implements Booter.
func (NoopBooter) TearDown(context.Context, Service) error { return nil }

// statusSink persists per-service boot status transitions during a run. *Store
// satisfies it; the orchestrator unit tests inject an in-memory recorder so the
// tier-by-tier sequencing is asserted without a database.
type statusSink interface {
	MarkServiceBooting(ctx context.Context, runID, serviceID string, tier, attempt int) error
	MarkServiceHealthy(ctx context.Context, runID, serviceID string, attempts int, at time.Time) error
	MarkServiceUnhealthy(ctx context.Context, runID, serviceID string, attempts int, lastErr string) error
	MarkServiceRolledBack(ctx context.Context, runID, serviceID string) error
}

// tierResult is the outcome of booting one tier.
type tierResult struct {
	tier     int
	healthy  bool
	failed   []string // service names that never went healthy
	firstErr error
}

// Orchestrator executes a BootPlan tier by tier: it boots every service in a
// tier in PARALLEL, probes each for health (with per-service timeout + retry),
// and only advances to the next tier once the WHOLE tier is healthy. On a tier
// that never goes healthy within its budget it applies the run's failure policy:
// HALT (stop, leave booted tiers up) or ROLLBACK (tear down already-booted tiers
// in REVERSE order). It is pure orchestration over the injected Booter,
// CheckerFactory and statusSink — no database access of its own — so the
// sequencing is unit-tested directly with scripted fakes and a real TCP probe.
type Orchestrator struct {
	booter Booter
	// checkerFor returns the HealthChecker for a service. Defaults to CheckerFor
	// (the real HTTP/TCP/script probes); tests inject a scripted factory.
	checkerFor func(Service) HealthChecker
	sink       statusSink
	metrics    *Metrics
	logger     zerolog.Logger
	now        func() time.Time
	// retryBackoff is the wait between health-probe attempts. Injected so tests do
	// not sleep; defaults to 500ms.
	retryBackoff time.Duration
}

// OrchestratorConfig wires an Orchestrator.
type OrchestratorConfig struct {
	Booter Booter
	// CheckerFor is optional; defaults to the real CheckerFor factory.
	CheckerFor func(Service) HealthChecker
	Sink       statusSink
	Metrics    *Metrics
	Logger     zerolog.Logger
	// Now is optional; defaults to time.Now (UTC).
	Now func() time.Time
	// RetryBackoff is optional; defaults to 500ms.
	RetryBackoff time.Duration
}

// NewOrchestrator constructs an Orchestrator. Sink is required so per-service
// status is durable; Booter defaults to NoopBooter when nil.
func NewOrchestrator(cfg OrchestratorConfig) (*Orchestrator, error) {
	if cfg.Sink == nil {
		return nil, errors.New("bootgraph orchestrator: status sink is required")
	}
	booter := cfg.Booter
	if booter == nil {
		booter = NoopBooter{}
	}
	checker := cfg.CheckerFor
	if checker == nil {
		checker = CheckerFor
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	backoff := cfg.RetryBackoff
	if backoff <= 0 {
		backoff = 500 * time.Millisecond
	}
	return &Orchestrator{
		booter:       booter,
		checkerFor:   checker,
		sink:         cfg.Sink,
		metrics:      cfg.Metrics,
		logger:       cfg.Logger,
		now:          now,
		retryBackoff: backoff,
	}, nil
}

// RunOutcome is the terminal result of executing a plan.
type RunOutcome struct {
	// Status is RunStatusCompleted, RunStatusFailed (halt) or RunStatusRolledBack.
	Status string
	// TiersBooted is how many tiers went fully healthy before completion/failure.
	TiersBooted int
	// FailedTier is the index of the tier that failed (-1 when the run completed).
	FailedTier int
	// FailedServices are the names in FailedTier that never went healthy.
	FailedServices []string
	// Err carries the first underlying probe/boot error of the failed tier.
	Err error
}

// Execute runs the plan tier-by-tier under the given failure policy and records
// every per-service transition through the sink. It returns the terminal
// outcome. ctx cancellation aborts the run (treated as a failure of the current
// tier). On completion (every tier healthy) Status == RunStatusCompleted.
func (o *Orchestrator) Execute(ctx context.Context, runID string, plan BootPlan, policy string) (RunOutcome, error) {
	if !ValidPolicy(policy) {
		return RunOutcome{}, fmt.Errorf("%q: %w", policy, ErrInvalidPolicy)
	}

	for i, tier := range plan.Tiers {
		res := o.bootTier(ctx, runID, i, tier)
		if res.healthy {
			o.metrics.observeTierHealthy()
			o.logger.Info().Str("run_id", runID).Int("tier", i).Int("services", len(tier)).Msg("boot tier healthy")
			continue
		}

		// Tier failed its budget. Apply the failure policy.
		o.metrics.observeTierFailed()
		o.logger.Warn().Str("run_id", runID).Int("tier", i).Strs("failed", res.failed).Msg("boot tier failed health gate")

		outcome := RunOutcome{
			TiersBooted:    i, // tiers 0..i-1 were healthy
			FailedTier:     i,
			FailedServices: res.failed,
			Err:            res.firstErr,
		}
		switch policy {
		case PolicyRollback:
			o.rollback(ctx, runID, plan, i)
			outcome.Status = RunStatusRolledBack
			o.metrics.observeRunRolledBack()
		default: // PolicyHalt
			outcome.Status = RunStatusFailed
			o.metrics.observeRunFailed()
		}
		return outcome, nil
	}

	o.metrics.observeRunCompleted()
	return RunOutcome{
		Status:      RunStatusCompleted,
		TiersBooted: len(plan.Tiers),
		FailedTier:  -1,
	}, nil
}

// bootTier boots every service in a tier in parallel and waits for the WHOLE
// tier to go healthy. A tier is healthy only when every service's health probe
// passes (within its per-service boot timeout, after up to HealthRetries extra
// attempts). The boots run concurrently; the result is collected deterministically.
func (o *Orchestrator) bootTier(ctx context.Context, runID string, tier int, services []Service) tierResult {
	type svcResult struct {
		name string
		err  error
	}
	results := make([]svcResult, len(services))
	var wg sync.WaitGroup
	wg.Add(len(services))
	for idx, svc := range services {
		go func(idx int, svc Service) {
			defer wg.Done()
			err := o.bootAndProbe(ctx, runID, tier, svc)
			results[idx] = svcResult{name: svc.Name, err: err}
		}(idx, svc)
	}
	wg.Wait()

	res := tierResult{tier: tier, healthy: true}
	for _, r := range results {
		if r.err != nil {
			res.healthy = false
			res.failed = append(res.failed, r.name)
			if res.firstErr == nil {
				res.firstErr = r.err
			}
		}
	}
	return res
}

// bootAndProbe issues a service's boot then polls its health probe until it
// passes or the attempt budget (1 + HealthRetries) is exhausted, recording the
// status transitions through the sink. Each probe attempt is bounded by the
// service's boot timeout via a child context. Returns nil when the service goes
// healthy, else the last probe/boot error.
func (o *Orchestrator) bootAndProbe(ctx context.Context, runID string, tier int, svc Service) error {
	checker := o.checkerFor(svc)
	attempts := 0
	maxAttempts := 1 + svc.retries()
	var lastErr error

	for attempts < maxAttempts {
		attempts++
		if err := o.sink.MarkServiceBooting(ctx, runID, svc.ID, tier, attempts); err != nil {
			return fmt.Errorf("bootgraph: marking %q booting: %w", svc.Name, err)
		}

		attemptCtx, cancel := context.WithTimeout(ctx, svc.bootTimeout())
		bootErr := o.booter.Boot(attemptCtx, svc)
		if bootErr != nil {
			cancel()
			lastErr = fmt.Errorf("booting %q: %w", svc.Name, bootErr)
			o.metrics.observeBootError()
			if !o.waitBeforeRetry(ctx, attempts, maxAttempts) {
				break
			}
			continue
		}

		probeErr := checker.Check(attemptCtx, svc)
		cancel()
		if probeErr == nil {
			if err := o.sink.MarkServiceHealthy(ctx, runID, svc.ID, attempts, o.now()); err != nil {
				return fmt.Errorf("bootgraph: marking %q healthy: %w", svc.Name, err)
			}
			o.metrics.observeServiceHealthy()
			return nil
		}
		lastErr = probeErr
		o.metrics.observeProbeFailure()
		if !o.waitBeforeRetry(ctx, attempts, maxAttempts) {
			break
		}
	}

	msg := "health probe never passed"
	if lastErr != nil {
		msg = lastErr.Error()
	}
	if err := o.sink.MarkServiceUnhealthy(ctx, runID, svc.ID, attempts, msg); err != nil {
		return fmt.Errorf("bootgraph: marking %q unhealthy: %w", svc.Name, err)
	}
	if lastErr == nil {
		lastErr = errors.New(msg)
	}
	return lastErr
}

// waitBeforeRetry sleeps the retry backoff between attempts, honouring ctx. It
// returns false when ctx is cancelled (the caller should stop) or when no
// further attempt remains.
func (o *Orchestrator) waitBeforeRetry(ctx context.Context, attempt, maxAttempts int) bool {
	if attempt >= maxAttempts {
		return false
	}
	if o.retryBackoff <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(o.retryBackoff)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// rollback tears down every service in tiers [0, failedTier) in REVERSE order
// (the last successfully-booted tier first, and within a tier in reverse name
// order), recording each as rolled-back. The tier that failed was never marked
// healthy, so its partially-booted services are also torn down (best effort).
func (o *Orchestrator) rollback(ctx context.Context, runID string, plan BootPlan, failedTier int) {
	// Include the failed tier in teardown (its services may be partially up).
	last := failedTier
	if last >= len(plan.Tiers) {
		last = len(plan.Tiers) - 1
	}
	for i := last; i >= 0; i-- {
		tier := plan.Tiers[i]
		for j := len(tier) - 1; j >= 0; j-- {
			svc := tier[j]
			tdCtx, cancel := context.WithTimeout(ctx, svc.bootTimeout())
			if err := o.booter.TearDown(tdCtx, svc); err != nil {
				o.logger.Warn().Err(err).Str("run_id", runID).Str("service", svc.Name).Msg("teardown during rollback failed")
			}
			cancel()
			if err := o.sink.MarkServiceRolledBack(ctx, runID, svc.ID); err != nil {
				o.logger.Warn().Err(err).Str("run_id", runID).Str("service", svc.Name).Msg("recording rollback status failed")
			}
			o.metrics.observeServiceRolledBack()
		}
	}
}

// compile-time checks.
var _ Booter = NoopBooter{}
