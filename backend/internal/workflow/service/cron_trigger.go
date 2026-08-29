package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cron"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// EngineStarter starts a new workflow instance. It is the subset of
// EngineService the cron trigger scheduler needs, injected as an interface so
// the scheduler can be wired to the real engine without this file importing or
// editing it. *EngineService already satisfies this contract.
type EngineStarter interface {
	StartInstance(ctx context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error)
}

// DefinitionLister lists every active workflow definition across all tenants.
// *repository.DefinitionRepository.ListActive satisfies this contract.
type DefinitionLister interface {
	ListActive(ctx context.Context) ([]*model.WorkflowDefinition, error)
}

const (
	// cronTriggerStartUser is the synthetic actor recorded as the starter of an
	// instance launched by the cron scheduler (mirrors the "system" actor the
	// event-trigger consumer uses).
	cronTriggerStartUser = "system"

	// cronDedupeTTL is how long a fired-marker survives in Redis. A schedule can
	// fire at most once per matching minute, so any TTL comfortably longer than
	// the poll interval guarantees a restart within the window cannot re-fire an
	// already-fired tick, while old markers self-expire and never accumulate.
	cronDedupeTTL = 6 * time.Hour
)

// CronTriggerScheduler periodically scans active workflow definitions whose
// trigger is a cron schedule and starts an instance once for each fire time
// that has come due since the last scan. It is designed to run as a leader
// singleton (wrap it with RunLeaderSingleton): the in-memory per-definition
// cursor provides exactly-once firing within a single leader, and a Redis
// SETNX fired-marker keyed by definition + fire-time provides cross-replica /
// restart idempotency so a failover or a second tick in the same minute never
// double-fires.
type CronTriggerScheduler struct {
	defs     DefinitionLister
	engine   EngineStarter
	rdb      *redis.Client
	logger   zerolog.Logger
	interval time.Duration

	// now is the injected clock (defaults to time.Now). Tests advance it to
	// drive deterministic firing without sleeping.
	now func() time.Time

	// mu guards lastScan and the parse cache, both mutated only from Tick which
	// the Run loop calls serially, but also readable by tests.
	mu sync.Mutex
	// lastScan is the upper bound of the previous scan window. The next scan
	// considers fire times in (lastScan, now]. Zero until the first tick, where
	// it is seeded to now so the scheduler never fires schedules that were due
	// before it started (avoids a thundering herd of historical fires on boot).
	lastScan time.Time
	// parsed caches compiled cron schedules keyed by the raw expression so a
	// large fleet of definitions is not re-parsed every interval.
	parsed map[string]*cron.CronSchedule
}

// CronTriggerConfig configures a CronTriggerScheduler.
type CronTriggerConfig struct {
	// Defs lists active definitions. Required.
	Defs DefinitionLister
	// Engine starts instances. Required.
	Engine EngineStarter
	// RDB is the Redis client used for the fired-marker dedupe. Optional: when
	// nil the scheduler still fires (relying on the in-memory cursor) but loses
	// cross-replica / restart idempotency, so a Redis client is strongly
	// recommended in production.
	RDB *redis.Client
	// Logger is the base logger. A Nop logger is used when zero.
	Logger zerolog.Logger
	// Interval is the poll cadence. Defaults to 30s when non-positive. It should
	// be well under one minute so no matching minute is skipped (cron resolution
	// is one minute).
	Interval time.Duration
	// Now overrides the clock for tests. Defaults to time.Now (UTC-normalised
	// internally).
	Now func() time.Time
}

// NewCronTriggerScheduler builds a CronTriggerScheduler. It returns an error if
// a required dependency is missing.
func NewCronTriggerScheduler(cfg CronTriggerConfig) (*CronTriggerScheduler, error) {
	if cfg.Defs == nil {
		return nil, fmt.Errorf("cron trigger scheduler: definition lister is required")
	}
	if cfg.Engine == nil {
		return nil, fmt.Errorf("cron trigger scheduler: engine starter is required")
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now() }
	}
	return &CronTriggerScheduler{
		defs:     cfg.Defs,
		engine:   cfg.Engine,
		rdb:      cfg.RDB,
		logger:   cfg.Logger.With().Str("service", "workflow-cron-trigger").Logger(),
		interval: interval,
		now:      now,
		parsed:   make(map[string]*cron.CronSchedule),
	}, nil
}

// Run blocks until ctx is cancelled, firing due cron-schedule definitions on
// each interval tick. Launch it from a leader-election OnAcquire callback (see
// RunLeaderSingleton) so only one replica drives schedules at a time.
func (s *CronTriggerScheduler) Run(ctx context.Context) {
	s.logger.Info().Dur("interval", s.interval).Msg("cron trigger scheduler started")

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Info().Msg("cron trigger scheduler stopping")
			return
		case <-ticker.C:
			if err := s.Tick(ctx); err != nil {
				s.logger.Error().Err(err).Msg("cron trigger scan failed")
			}
		}
	}
}

// Tick performs a single scan: it lists active definitions, and for every one
// whose trigger is a valid cron schedule, fires an instance for each matching
// fire time in the window (lastScan, now]. It returns the number of instances
// started and the first scan-level error (definition listing). Per-definition
// errors are logged and skipped so one bad schedule never stalls the rest.
//
// Tick is safe to call directly in tests with an injected clock. It is NOT safe
// for concurrent invocation on the same scheduler — Run calls it serially.
func (s *CronTriggerScheduler) Tick(ctx context.Context) error {
	now := s.now().UTC().Truncate(time.Minute)

	s.mu.Lock()
	prev := s.lastScan
	if prev.IsZero() {
		// First tick: seed the window upper bound to now so we do not replay
		// schedules whose fire times are in the past relative to start-up. The
		// window for THIS tick is therefore empty (nothing fires on the first
		// tick); subsequent ticks fire normally.
		s.lastScan = now
		s.mu.Unlock()
		s.logger.Debug().Time("seeded_at", now).Msg("cron scheduler seeded; no firing on first tick")
		return nil
	}
	if !now.After(prev) {
		// Clock has not advanced into a new minute since the last scan — a second
		// tick within the same minute. Nothing new can be due; do not double-fire.
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	defs, err := s.defs.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("cron trigger scheduler: listing active definitions: %w", err)
	}

	fired := 0
	for _, def := range defs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n := s.processDefinition(ctx, def, prev, now)
		fired += n
	}

	// Advance the window only after a successful scan so a transient listing
	// failure (handled above by returning early) does not skip a window.
	s.mu.Lock()
	if now.After(s.lastScan) {
		s.lastScan = now
	}
	s.mu.Unlock()

	if fired > 0 {
		s.logger.Info().Int("fired", fired).Time("through", now).Msg("cron trigger scan fired instances")
	}
	return nil
}

// processDefinition fires all due instances for one definition in the window
// (prev, now]. It returns how many instances it started.
func (s *CronTriggerScheduler) processDefinition(ctx context.Context, def *model.WorkflowDefinition, prev, now time.Time) int {
	if def == nil {
		return 0
	}
	if def.TriggerConfig.Type != model.TriggerTypeSchedule {
		return 0
	}
	expr := def.TriggerConfig.Cron
	if expr == "" {
		return 0
	}

	sched, err := s.schedule(expr)
	if err != nil {
		// A definition that passed validation at write time but is unparseable
		// here is logged once per scan and skipped; it must not stall the batch.
		s.logger.Warn().Err(err).
			Str("definition_id", def.ID).
			Str("tenant_id", def.TenantID).
			Str("cron", expr).
			Msg("skipping definition with invalid cron expression")
		return 0
	}

	fired := 0
	// Walk every fire time strictly after prev, up to and including now. With a
	// sub-minute poll interval at most a handful of fire times can appear in one
	// window; the loop is bounded by NextAfter returning a time past now (or the
	// zero value for an unsatisfiable expression).
	cursor := prev
	for {
		next := sched.NextAfter(cursor)
		if next.IsZero() || next.After(now) {
			break
		}
		if s.fireDue(ctx, def, next) {
			fired++
		}
		cursor = next
	}
	return fired
}

// fireDue starts one instance for a definition's fire time, deduping on the
// fired-marker so the same (definition, fire-time) pair fires at most once
// across replicas and restarts. It returns true only when this call actually
// started an instance.
func (s *CronTriggerScheduler) fireDue(ctx context.Context, def *model.WorkflowDefinition, fireAt time.Time) bool {
	logger := s.logger.With().
		Str("definition_id", def.ID).
		Str("tenant_id", def.TenantID).
		Time("fire_at", fireAt).
		Logger()

	// Cross-replica / restart dedupe: claim the fire with SET NX. Only the
	// winner proceeds to start an instance.
	if s.rdb != nil {
		key := cronFiredMarkerKey(def.ID, fireAt)
		won, err := s.rdb.SetNX(ctx, key, "1", cronDedupeTTL).Result()
		if err != nil {
			logger.Error().Err(err).Str("marker_key", key).Msg("cron fired-marker dedupe check failed; skipping fire to avoid duplicate")
			return false
		}
		if !won {
			logger.Debug().Str("marker_key", key).Msg("cron fire already claimed; skipping")
			return false
		}
	}

	req := dto.StartInstanceRequest{
		DefinitionID:   def.ID,
		InputVariables: cronInputVariables(def),
	}

	instance, err := s.engine.StartInstance(ctx, def.TenantID, cronTriggerStartUser, req)
	if err != nil {
		logger.Error().Err(err).Msg("failed to start workflow instance from cron schedule")
		// Release the marker so the next scan/replica can retry this fire.
		if s.rdb != nil {
			_ = s.rdb.Del(ctx, cronFiredMarkerKey(def.ID, fireAt)).Err()
		}
		return false
	}

	logger.Info().Str("instance_id", instance.ID).Msg("workflow instance started from cron schedule")
	return true
}

// schedule returns a parsed cron schedule for expr, caching the result.
func (s *CronTriggerScheduler) schedule(expr string) (*cron.CronSchedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sched, ok := s.parsed[expr]; ok {
		return sched, nil
	}
	sched, err := cron.ParseCron(expr)
	if err != nil {
		return nil, err
	}
	s.parsed[expr] = sched
	return sched, nil
}

// cronInputVariables builds the initial variable map for a cron-started
// instance from the definition's variable defaults. Schedule triggers carry no
// event payload, so only declared defaults seed the instance.
func cronInputVariables(def *model.WorkflowDefinition) map[string]interface{} {
	vars := make(map[string]interface{}, len(def.Variables))
	for name, varDef := range def.Variables {
		if varDef.Default != nil {
			vars[name] = varDef.Default
		}
	}
	return vars
}

// cronFiredMarkerKey is the Redis key for a (definition, fire-time) fired
// marker. The fire time is UTC at minute precision (the cron resolution), so a
// given definition fires at most once per matching minute.
func cronFiredMarkerKey(definitionID string, fireAt time.Time) string {
	return fmt.Sprintf("workflow:cron:fired:%s:%d", definitionID, fireAt.UTC().Unix())
}
