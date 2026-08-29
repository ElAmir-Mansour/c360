package drillsched

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// DrillRequestedEventType is the outbox event a fired schedule emits. The
// integration phase consumes it and creates a DRILL failover_run via the
// EXISTING failover service (CreateFailoverRun with Mode=drill) — this package
// does NOT re-implement the failover driver, it only REQUESTS the drill.
const DrillRequestedEventType = "datastream.dr.drill.scheduled"

// eventSource is the CloudEvents source for events this package emits.
const eventSource = "clario-dr-service"

// systemActor is the initiated_by recorded on a scheduler-fired drill. It is the
// well-known nil UUID, signalling "the scheduler, not a human" to the failover
// service's audit trail (a real human-initiated drill carries the operator's id).
const systemActor = "00000000-0000-0000-0000-000000000000"

// scheduleClaimer is the system-path surface the scheduler drives. *Store
// satisfies it via SystemClaimDueSchedules; an interface keeps the loop
// unit-testable with an in-memory fake (no database).
type scheduleClaimer interface {
	SystemClaimDueSchedules(ctx context.Context, db DBTX, now time.Time, limit int) ([]*Schedule, error)
	AdvanceSchedule(ctx context.Context, db DBTX, tenantID, id string, nextRun, firedAt time.Time) error
}

// drillRequest is the dr.drill.scheduled payload. It carries everything the
// failover service needs to start the DRILL run: which group, which network
// profile, the RTO objective to attest against, and provenance (schedule id +
// the materialised fire time). mode is always "drill".
type drillRequest struct {
	ScheduleID          string    `json:"schedule_id"`
	GroupID             string    `json:"group_id"`
	Mode                string    `json:"mode"`
	Profile             string    `json:"profile"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds"`
	InitiatedBy         string    `json:"initiated_by"`
	ScheduledFor        time.Time `json:"scheduled_for"`
	FiredAt             time.Time `json:"fired_at"`
}

// systemTxRunner runs fn inside a system (RLS-bypassing) transaction. Each call
// is a distinct transaction boundary. *pgxpool.Pool is adapted via
// poolSystemTxRunner; tests inject a fake that records boundaries and shares an
// in-memory store.
type systemTxRunner interface {
	RunSystemTx(ctx context.Context, fn func(db DBTX) error) error
}

type poolSystemTxRunner struct {
	pool *pgxpool.Pool
}

func (r poolSystemTxRunner) RunSystemTx(ctx context.Context, fn func(db DBTX) error) error {
	return database.RunSystemTx(ctx, r.pool, func(tx pgx.Tx) error { return fn(tx) })
}

// eventSink stages a drill-request event. The production sink writes to the
// outbox in the SAME transaction as the next_run advance, so requesting a drill
// and advancing the schedule commit atomically (exactly-once, no double-fire).
type eventSink interface {
	emit(ctx context.Context, db DBTX, tenantID string, payload drillRequest) error
}

// outboxSink is the production event sink: it stages dr.drill.scheduled in the
// event outbox transactionally with the schedule advance.
type outboxSink struct{}

func (outboxSink) emit(ctx context.Context, db DBTX, tenantID string, payload drillRequest) error {
	event, err := events.NewEvent(DrillRequestedEventType, eventSource, tenantID, payload)
	if err != nil {
		return fmt.Errorf("drillsched: building drill-request event: %w", err)
	}
	return outbox.Write(ctx, db, events.Topics.DREvents, event)
}

// Scheduler is the leader-singleton loop that fires due drill schedules. Each
// tick claims a batch of due schedules (next_run <= now) across all tenants and,
// for each, in ONE system transaction: stages a dr.drill.scheduled outbox event
// (requesting the DRILL via the existing failover path) and advances the
// schedule's next_run to its next cron fire time + stamps last_fired_at. Because
// the claim, the outbox write, and the advance share a transaction, a schedule
// is requested exactly once per due window even across overlapping ticks or a
// crash mid-tick.
//
// It is started in the leader-election OnAcquire callback and stopped in OnLose,
// mirroring the RPO monitor and the failover/failback drivers.
type Scheduler struct {
	runner    systemTxRunner
	claimer   scheduleClaimer
	sink      eventSink
	metrics   *Metrics
	logger    zerolog.Logger
	now       func() time.Time
	interval  time.Duration
	batchSize int
}

// SchedulerConfig wires a Scheduler.
type SchedulerConfig struct {
	Pool      *pgxpool.Pool
	Store     *Store
	Metrics   *Metrics
	Logger    zerolog.Logger
	Interval  time.Duration
	BatchSize int
	// Now is optional; defaults to time.Now (UTC). Injected for deterministic tests.
	Now func() time.Time

	// runner/claimer/sink override the production wiring; set ONLY in tests to
	// drive the loop without a database/bus.
	runner  systemTxRunner
	claimer scheduleClaimer
	sink    eventSink
}

// NewScheduler constructs the due-schedule firing loop.
func NewScheduler(cfg SchedulerConfig) (*Scheduler, error) {
	runner := cfg.runner
	if runner == nil {
		if cfg.Pool == nil {
			return nil, errors.New("drillsched scheduler: pool is required")
		}
		runner = poolSystemTxRunner{pool: cfg.Pool}
	}
	claimer := cfg.claimer
	if claimer == nil {
		if cfg.Store == nil {
			return nil, errors.New("drillsched scheduler: store is required")
		}
		claimer = cfg.Store
	}
	sink := cfg.sink
	if sink == nil {
		sink = outboxSink{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 30 * time.Second
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 16
	}
	return &Scheduler{
		runner:    runner,
		claimer:   claimer,
		sink:      sink,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger.With().Str("component", "dr-drill-scheduler").Logger(),
		now:       now,
		interval:  cfg.Interval,
		batchSize: cfg.BatchSize,
	}, nil
}

// Run blocks until ctx is cancelled, firing due schedules. Launch it in a
// goroutine from the leader-election OnAcquire callback.
func (s *Scheduler) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		fired, err := s.tick(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			s.logger.Error().Err(err).Msg("drill scheduler tick failed")
		}
		// When a full batch fired there may be more due schedules; retry
		// immediately so a backlog drains without an interval wait. Otherwise
		// idle-poll.
		if fired >= s.batchSize {
			timer.Reset(0)
		} else {
			timer.Reset(s.interval)
		}
	}
}

// tick claims and fires up to batchSize due schedules. It returns the number
// fired so the caller can drain a backlog. Each schedule is fired in its OWN
// system transaction so one malformed schedule's failure does not roll back the
// others' successful fires.
func (s *Scheduler) tick(ctx context.Context) (int, error) {
	now := s.now().UTC()

	var due []*Schedule
	if err := s.runner.RunSystemTx(ctx, func(db DBTX) error {
		var cerr error
		due, cerr = s.claimer.SystemClaimDueSchedules(ctx, db, now, s.batchSize)
		return cerr
	}); err != nil {
		return 0, fmt.Errorf("drillsched: claiming due schedules: %w", err)
	}
	if len(due) == 0 {
		return 0, nil
	}

	fired := 0
	for _, sc := range due {
		if err := s.fireOne(ctx, sc, now); err != nil {
			// Record and continue: a single bad schedule (e.g. an expression that
			// became unsatisfiable) must not stall the rest of the batch.
			s.logger.Error().Err(err).Str("schedule_id", sc.ID).Str("group_id", sc.GroupID).Msg("firing drill schedule failed")
			continue
		}
		fired++
	}
	return fired, nil
}

// fireOne requests a drill for one due schedule and advances its next_run, in a
// single system transaction so the outbox event and the advance commit together.
// The next fire time is computed by re-parsing and evaluating the schedule's
// cron expression from the claim instant, so a transient backlog never skips
// occurrences ahead of where the schedule actually is.
func (s *Scheduler) fireOne(ctx context.Context, sc *Schedule, now time.Time) error {
	cron, err := ParseCron(sc.CronExpr)
	if err != nil {
		// An invalid expression should never have been stored (the service
		// validates on create), but if one is, disabling it would require a write;
		// here we surface the error and skip — the operator must fix or delete it.
		return fmt.Errorf("schedule %s has invalid cron %q: %w", sc.ID, sc.CronExpr, err)
	}
	next := cron.NextAfter(now)
	if next.IsZero() {
		return fmt.Errorf("schedule %s cron %q has no future fire time within horizon", sc.ID, sc.CronExpr)
	}

	scheduledFor := sc.NextRun
	payload := drillRequest{
		ScheduleID:          sc.ID,
		GroupID:             sc.GroupID,
		Mode:                "drill",
		Profile:             sc.Profile,
		RTOObjectiveSeconds: sc.RTOObjectiveSeconds,
		InitiatedBy:         systemActor,
		ScheduledFor:        scheduledFor,
		FiredAt:             now,
	}

	if err := s.runner.RunSystemTx(ctx, func(db DBTX) error {
		if err := s.sink.emit(ctx, db, sc.TenantID, payload); err != nil {
			return err
		}
		return s.claimer.AdvanceSchedule(ctx, db, sc.TenantID, sc.ID, next, now)
	}); err != nil {
		return fmt.Errorf("requesting drill for schedule %s: %w", sc.ID, err)
	}

	// reflect the advance on the in-memory copy for the caller/logging.
	sc.NextRun = next
	sc.LastFiredAt = &now

	s.metrics.IncDrillRequested(sc.GroupID, sc.Profile)
	s.logger.Info().
		Str("schedule_id", sc.ID).
		Str("group_id", sc.GroupID).
		Str("profile", sc.Profile).
		Time("scheduled_for", scheduledFor).
		Time("next_run", next).
		Msg("drill requested from schedule")
	return nil
}
