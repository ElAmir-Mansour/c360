package trigger

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/cron"
)

// ScheduleSource is the cron trigger source (model.TriggerTypeSchedule, §4.3 row
// "schedule"). It is a LEADER-SINGLETON loop: only the elected instance runs it,
// so a schedule fires once per due window across the fleet (started in the
// leadership OnAcquire callback, mirroring drillsched.Scheduler).
//
// Each tick it (re)loads every enabled schedule-trigger automation across all
// tenants, parses each cron expression with the shared internal/cron parser, and
// tracks the next fire time per automation in memory. When wall-clock reaches an
// automation's next fire time it emits a FiredTrigger whose EventID is derived
// from the automation id and the materialised fire minute — so an overlapping
// tick, a restart within the same minute, or a brief two-leader overlap during
// failover all resolve to the SAME EventID and the Dispatcher's idempotency guard
// (plus the automation_runs unique backstop) fire it exactly once.
type ScheduleSource struct {
	lister     ScheduleLister
	dispatcher *Dispatcher
	interval   time.Duration
	now        func() time.Time
	logger     zerolog.Logger

	// nextFire tracks the next scheduled fire time per automation id, advanced
	// after each fire. It is rebuilt for new automations and pruned of removed
	// ones every tick; only the leader goroutine touches it, so no lock needed.
	nextFire map[string]time.Time
}

// ScheduleSourceConfig wires a ScheduleSource.
type ScheduleSourceConfig struct {
	// Lister enumerates enabled schedule automations across all tenants.
	Lister ScheduleLister
	// Dispatcher applies the exactly-once gate.
	Dispatcher *Dispatcher
	// Interval is the tick cadence (how often the loop wakes to check for due
	// schedules). Defaults to 30s when non-positive.
	Interval time.Duration
	// Now is injected for deterministic tests; defaults to time.Now (UTC).
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewScheduleSource constructs a ScheduleSource.
func NewScheduleSource(cfg ScheduleSourceConfig) (*ScheduleSource, error) {
	if cfg.Lister == nil {
		return nil, fmt.Errorf("schedule source: lister is required")
	}
	if cfg.Dispatcher == nil {
		return nil, fmt.Errorf("schedule source: dispatcher is required")
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &ScheduleSource{
		lister:     cfg.Lister,
		dispatcher: cfg.Dispatcher,
		interval:   interval,
		now:        now,
		logger:     cfg.Logger.With().Str("component", "automation_schedule_source").Logger(),
		nextFire:   make(map[string]time.Time),
	}, nil
}

// Type identifies this source.
func (s *ScheduleSource) Type() string { return model.TriggerTypeSchedule }

// Run blocks until ctx is cancelled, firing due schedules every Interval. Launch
// it in a goroutine from the leader-election OnAcquire callback so exactly one
// instance drives the cron clock.
func (s *ScheduleSource) Run(ctx context.Context) error {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
		if err := s.Tick(ctx); err != nil && ctx.Err() == nil {
			s.logger.Error().Err(err).Msg("schedule source tick failed")
		}
		timer.Reset(s.interval)
	}
}

// Tick performs one pass: reload enabled schedules, fire any that are due, and
// advance their next fire time. Exported so tests can drive a single, fully
// deterministic pass without the timer loop. Returns the first dispatch error (a
// transient sink failure) so the caller can decide; per-automation parse errors
// are logged and skipped so one bad cron never stalls the others.
func (s *ScheduleSource) Tick(ctx context.Context) error {
	now := s.now().UTC()

	automations, err := s.lister.SystemListEnabledSchedules(ctx)
	if err != nil {
		return fmt.Errorf("listing schedule automations: %w", err)
	}

	// Track which ids are still present so removed/disabled schedules are pruned.
	present := make(map[string]struct{}, len(automations))

	for _, a := range automations {
		if a.Trigger.Type != model.TriggerTypeSchedule || a.Trigger.Cron == "" {
			continue
		}
		present[a.ID] = struct{}{}

		schedule, err := cron.ParseCron(a.Trigger.Cron)
		if err != nil {
			// The service validates cron on create, but a stored-bad expression
			// must not crash the loop — skip it (operator must fix/delete).
			s.logger.Error().Err(err).Str("automation_id", a.ID).Str("cron", a.Trigger.Cron).Msg("invalid stored cron; skipping")
			continue
		}

		next, seeded := s.nextFire[a.ID]
		if !seeded {
			// First sight of this automation: schedule its next fire from now. We
			// do NOT fire immediately on adoption — only on a real future
			// boundary — so adopting leadership never replays a missed window.
			s.nextFire[a.ID] = schedule.NextAfter(now)
			continue
		}
		if next.IsZero() {
			// The expression has no future fire within the horizon (e.g. an
			// impossible date); leave it parked at zero and skip.
			continue
		}
		if now.Before(next) {
			continue // not due yet
		}

		// Due: fire for the scheduled minute, then advance to the next boundary.
		if err := s.fire(ctx, a, next); err != nil {
			return err
		}
		s.nextFire[a.ID] = schedule.NextAfter(next)
	}

	// Prune schedules that are no longer enabled/present so the map doesn't grow
	// unbounded and a re-enabled automation re-seeds cleanly.
	for id := range s.nextFire {
		if _, ok := present[id]; !ok {
			delete(s.nextFire, id)
		}
	}
	return nil
}

// fire emits a FiredTrigger for one due schedule occurrence. The EventID encodes
// the automation id and the scheduled fire minute (RFC3339 at minute precision),
// giving every occurrence a stable, content-derived identity for exactly-once.
func (s *ScheduleSource) fire(ctx context.Context, a *model.Automation, scheduledFor time.Time) error {
	scheduledMinute := scheduledFor.UTC().Truncate(time.Minute)
	eventID := fmt.Sprintf("schedule:%s:%s", a.ID, scheduledMinute.Format(time.RFC3339))
	ft := FiredTrigger{
		AutomationID: a.ID,
		TenantID:     a.TenantID,
		EventID:      eventID,
		TriggerType:  model.TriggerTypeSchedule,
		Payload: map[string]any{
			"trigger": map[string]any{
				"type":          model.TriggerTypeSchedule,
				"cron":          a.Trigger.Cron,
				"scheduled_for": scheduledMinute.Format(time.RFC3339),
				"fired_at":      s.now().UTC().Format(time.RFC3339),
			},
		},
	}
	if err := s.dispatcher.Dispatch(ctx, ft); err != nil {
		return fmt.Errorf("dispatching schedule trigger (automation %s): %w", a.ID, err)
	}
	s.logger.Info().
		Str("automation_id", a.ID).
		Str("tenant_id", a.TenantID).
		Time("scheduled_for", scheduledMinute).
		Msg("schedule fired")
	return nil
}
