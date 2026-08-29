package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

const (
	// redisTimerKey is the sorted set key for pending workflow timers.
	// Scores are Unix milliseconds when the timer should fire.
	redisTimerKey = "workflow:timers"

	// timerBatchSize is the maximum number of timers to process per poll cycle.
	timerBatchSize = 100
)

// SLAPolicyResolver resolves the tiered SLA policy and the business calendar
// that apply to a given task (WP-5). It is optional: when no resolver is
// installed, or when it returns ok=false for a task, the scheduler falls back to
// the legacy single-tier breach behavior (deadline already on the task row). The
// resolver is the seam the INTEGRATE phase wires to the workflow_sla_policies /
// workflow_calendars tables; keeping it an interface lets the SLA loop be driven
// deterministically in tests without a database.
type SLAPolicyResolver interface {
	// ResolvePolicy returns the SLA policy and calendar for a task. ok=false
	// means "no tiered policy applies" and the caller uses the single-tier path.
	ResolvePolicy(ctx context.Context, task *model.HumanTask) (policy SLAPolicy, calendar Calendar, ok bool)
}

// atRiskTaskRepo is an OPTIONAL capability the wired task repository may
// implement to make pre-breach SLA reminders work end to end (WP-5 human-scale).
// The core taskRepo interface (engine_service.go) is intentionally NOT widened —
// this narrow interface is type-asserted at the scheduler's use sites, so a test
// double that embeds taskRepo but does not implement these methods falls back to
// the legacy behavior (log-only reminders, overdue-only candidate set) with no
// change. The production *repository.TaskRepository satisfies it (methods live in
// repository/task_sla_repo.go).
//
//   - GetApproachingTasks surfaces still-open tasks whose deadline is APPROACHING
//     (or already flagged at_risk), so the pre-breach reminder tiers are reachable
//     BEFORE the flat overdue query would ever see them.
//   - ReconcileSLADeadline persists the tiered policy's calendar-adjusted breach
//     deadline onto the flat sla_deadline column, so the candidate query and the
//     evaluator AGREE about when the task breaches.
//   - MarkAtRisk stamps the row-level approaching-breach marker so approaching
//     work is queryable (inbox at-risk KPI, GetAtRiskTasks).
type atRiskTaskRepo interface {
	GetApproachingTasks(ctx context.Context, lookahead time.Duration, limit int) ([]*model.HumanTask, error)
	ReconcileSLADeadline(ctx context.Context, taskID string, breachDeadline time.Time) error
	MarkAtRisk(ctx context.Context, taskID string) error
}

// atRiskLookahead is how far ahead of now the approaching-task scan looks for
// tasks whose flat deadline is near. It is generous (a full day) so a reminder
// tier configured well before breach still enters the loop; EvaluateSLA is the
// authority on which tiers are actually due, so a wide lookahead only widens the
// candidate set, it never fires a reminder early.
const atRiskLookahead = 24 * time.Hour

// SchedulerService is a background service that polls for timer expirations
// and monitors SLA compliance for human tasks.
type SchedulerService struct {
	rdb           *redis.Client
	taskRepo      taskRepo
	engine        *EngineService
	producer      eventPublisher
	slaResolver   SLAPolicyResolver
	now           func() time.Time
	logger        zerolog.Logger
	timerInterval time.Duration
	slaInterval   time.Duration
	stopCh        chan struct{}
	done          chan struct{}
}

// NewSchedulerService creates a new SchedulerService with configurable poll intervals.
func NewSchedulerService(
	rdb *redis.Client,
	taskRepo taskRepo,
	engine *EngineService,
	producer eventPublisher,
	logger zerolog.Logger,
	timerIntervalSec, slaIntervalSec int,
) *SchedulerService {
	if timerIntervalSec <= 0 {
		timerIntervalSec = 5
	}
	if slaIntervalSec <= 0 {
		slaIntervalSec = 60
	}

	return &SchedulerService{
		rdb:           rdb,
		taskRepo:      taskRepo,
		engine:        engine,
		producer:      producer,
		now:           time.Now,
		logger:        logger.With().Str("service", "workflow-scheduler").Logger(),
		timerInterval: time.Duration(timerIntervalSec) * time.Second,
		slaInterval:   time.Duration(slaIntervalSec) * time.Second,
		stopCh:        make(chan struct{}),
		done:          make(chan struct{}),
	}
}

// SetSLAPolicyResolver installs the optional tiered SLA policy resolver (WP-5).
// When set, the SLA loop evaluates the tiered policy + business calendar for each
// overdue task; when unset (or when the resolver returns ok=false for a task),
// the loop uses the legacy single-tier breach behavior unchanged.
func (s *SchedulerService) SetSLAPolicyResolver(r SLAPolicyResolver) {
	s.slaResolver = r
}

// Start begins the scheduler's background loops for timer polling and SLA monitoring.
// This method returns immediately; the loops run in separate goroutines.
// Call Stop() to gracefully shut down.
func (s *SchedulerService) Start(ctx context.Context) {
	s.logger.Info().
		Dur("timer_interval", s.timerInterval).
		Dur("sla_interval", s.slaInterval).
		Msg("scheduler service starting")

	go s.timerLoop(ctx)
	go s.slaLoop(ctx)
}

// Stop signals the scheduler to stop and waits for both loops to finish.
func (s *SchedulerService) Stop() {
	s.logger.Info().Msg("scheduler service stopping")
	close(s.stopCh)

	// Wait for both goroutines to signal completion. Each sends one value to done.
	<-s.done
	<-s.done

	s.logger.Info().Msg("scheduler service stopped")
}

// RunLeader runs the timer-poll and SLA-monitor loops driven purely by ctx
// cancellation (no stopCh/done coupling), so it is safe to invoke as a
// leader-election singleton (WP-7): each leadership acquisition starts a fresh
// invocation and each loss cancels ctx, returning RunLeader. It blocks until ctx
// is cancelled. Unlike Start/Stop (which close a one-shot stopCh), RunLeader is
// re-entrant across leadership flaps because both pollers are stateless and key
// only off ctx. The actual unit-of-work (pollTimers / checkSLABreaches) is
// identical to Start's loops.
func (s *SchedulerService) RunLeader(ctx context.Context) {
	s.logger.Info().
		Dur("timer_interval", s.timerInterval).
		Dur("sla_interval", s.slaInterval).
		Msg("scheduler (leader) starting")

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		ticker := time.NewTicker(s.timerInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.pollTimers(ctx)
			}
		}
	}()

	go func() {
		defer wg.Done()
		ticker := time.NewTicker(s.slaInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.checkSLABreaches(ctx)
				s.checkAtRiskTasks(ctx)
			}
		}
	}()

	wg.Wait()
	s.logger.Info().Msg("scheduler (leader) stopped")
}

// RegisterBoundaryTimer registers a DURABLE timer for a boundary event / an
// event-based gateway TIMER arm. It reuses the SAME Redis sorted set as ordinary
// timer steps, but encodes the arm id into the member so pollTimers routes a
// boundary timer to FireBoundaryEvent (interrupt + route) rather than
// AdvanceWorkflow (normal advance). This is the executor.BoundaryRegistrar seam.
func (s *SchedulerService) RegisterBoundaryTimer(ctx context.Context, instanceID, stepID, armID string, fireAt time.Time) error {
	member := encodeBoundaryTimerMember(instanceID, stepID, armID)
	if err := s.rdb.ZAdd(ctx, redisTimerKey, redis.Z{
		Score:  float64(fireAt.UnixMilli()),
		Member: member,
	}).Err(); err != nil {
		return fmt.Errorf("registering boundary timer in Redis: %w", err)
	}
	s.logger.Debug().
		Str("instance_id", instanceID).Str("step_id", stepID).Str("arm_id", armID).
		Time("fire_at", fireAt).Msg("boundary timer registered")
	return nil
}

// CancelBoundaryTimer removes a boundary/gateway timer arm from Redis (called
// when a sibling arm wins or the step completes normally). Best-effort.
func (s *SchedulerService) CancelBoundaryTimer(ctx context.Context, instanceID, stepID, armID string) error {
	member := encodeBoundaryTimerMember(instanceID, stepID, armID)
	if err := s.rdb.ZRem(ctx, redisTimerKey, member).Err(); err != nil {
		return fmt.Errorf("cancelling boundary timer: %w", err)
	}
	return nil
}

// RegisterBoundaryMessageWait registers a correlated message wait for a boundary
// event / an event-based gateway MESSAGE arm. It reuses the SAME event-wait Redis
// key the event_task WAIT uses, but encodes the arm id into the stored value so
// the event-wait consumer routes a boundary message to FireBoundaryEvent rather
// than AdvanceWorkflow. This is the executor.BoundaryRegistrar seam.
func (s *SchedulerService) RegisterBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string, ttl time.Duration) error {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	key := eventWaitKey(topic, correlationValue)
	val := encodeBoundaryWaitValue(instanceID, stepID, armID)
	if err := s.rdb.Set(ctx, key, val, ttl).Err(); err != nil {
		return fmt.Errorf("registering boundary message wait in Redis: %w", err)
	}
	s.logger.Debug().
		Str("instance_id", instanceID).Str("step_id", stepID).Str("arm_id", armID).
		Str("topic", topic).Str("correlation_value", correlationValue).
		Msg("boundary message wait registered")
	return nil
}

// CancelBoundaryMessageWait removes a boundary/gateway message-wait arm. It only
// deletes the key when its stored value still matches this arm, so it never
// clobbers a wait a different instance/step registered on the same
// topic+correlation (best-effort; a mismatch is a no-op).
func (s *SchedulerService) CancelBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string) error {
	key := eventWaitKey(topic, correlationValue)
	want := encodeBoundaryWaitValue(instanceID, stepID, armID)
	cur, err := s.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading boundary message wait for cancel: %w", err)
	}
	if cur == want {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return fmt.Errorf("cancelling boundary message wait: %w", err)
		}
	}
	return nil
}

// RegisterTimer registers a timer in Redis for a workflow step.
// The timer will fire at the specified time, triggering AdvanceWorkflow.
func (s *SchedulerService) RegisterTimer(ctx context.Context, instanceID, stepID string, fireAt time.Time) error {
	member := instanceID + ":" + stepID
	score := float64(fireAt.UnixMilli())

	if err := s.rdb.ZAdd(ctx, redisTimerKey, redis.Z{
		Score:  score,
		Member: member,
	}).Err(); err != nil {
		return fmt.Errorf("registering timer in Redis: %w", err)
	}

	s.logger.Debug().
		Str("instance_id", instanceID).
		Str("step_id", stepID).
		Time("fire_at", fireAt).
		Msg("timer registered")

	return nil
}

// RemoveTimer removes a timer from Redis (e.g., when an instance is cancelled).
func (s *SchedulerService) RemoveTimer(ctx context.Context, instanceID, stepID string) error {
	member := instanceID + ":" + stepID
	if err := s.rdb.ZRem(ctx, redisTimerKey, member).Err(); err != nil {
		return fmt.Errorf("removing timer from Redis: %w", err)
	}
	return nil
}

// RemoveEventWait removes the UNMARKED (ordinary event_task WAIT) registration for
// (instance, step). It is called when an interrupting boundary fires on an
// event_task WAIT step: the step's own ordinary wait key must be torn down so a
// late correlated event does not spuriously resume the already-interrupted step.
// Like CancelBoundaryMessageWait it only deletes the key when the stored value
// still matches this instance/step, so it never clobbers a wait a different
// instance/step registered on the same topic+correlation (best-effort).
func (s *SchedulerService) RemoveEventWait(ctx context.Context, topic, correlationValue, instanceID, stepID string) error {
	key := eventWaitKey(topic, correlationValue)
	want := instanceID + ":" + stepID
	cur, err := s.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading event wait for removal: %w", err)
	}
	if cur == want {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return fmt.Errorf("removing event wait: %w", err)
		}
	}
	return nil
}

// timerLoop periodically polls Redis for expired timers and fires them.
func (s *SchedulerService) timerLoop(ctx context.Context) {
	defer func() {
		s.done <- struct{}{}
	}()

	ticker := time.NewTicker(s.timerInterval)
	defer ticker.Stop()

	s.logger.Info().Msg("timer poller started")

	for {
		select {
		case <-s.stopCh:
			s.logger.Info().Msg("timer poller stopping")
			return
		case <-ctx.Done():
			s.logger.Info().Msg("timer poller context cancelled")
			return
		case <-ticker.C:
			s.pollTimers(ctx)
		}
	}
}

// pollTimers queries Redis for all timers whose fire time has passed,
// removes them atomically, and dispatches AdvanceWorkflow for each.
func (s *SchedulerService) pollTimers(ctx context.Context) {
	nowMs := strconv.FormatInt(time.Now().UnixMilli(), 10)

	// ZRANGEBYSCORE "workflow:timers" -inf {now_ms} LIMIT 0 100
	members, err := s.rdb.ZRangeByScore(ctx, redisTimerKey, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    nowMs,
		Offset: 0,
		Count:  timerBatchSize,
	}).Result()
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to poll timers from Redis")
		return
	}

	if len(members) == 0 {
		return
	}

	s.logger.Debug().
		Int("count", len(members)).
		Msg("processing expired timers")

	for _, member := range members {
		// Atomically remove the timer to prevent duplicate processing.
		removed, err := s.rdb.ZRem(ctx, redisTimerKey, member).Result()
		if err != nil {
			s.logger.Error().Err(err).
				Str("member", member).
				Msg("failed to remove timer from Redis")
			continue
		}
		if removed == 0 {
			// Another instance already processed this timer.
			continue
		}

		// Parse instanceID:stepID.
		parts := strings.SplitN(member, ":", 2)
		if len(parts) != 2 {
			s.logger.Error().
				Str("member", member).
				Msg("invalid timer member format, expected instanceID:stepID")
			continue
		}

		instanceID := parts[0]
		stepID := parts[1]

		// BOUNDARY / EVENT-GATEWAY TIMER: a boundary timer's member encodes an arm
		// id after the step id. Route it to the boundary-fire entry point (interrupt
		// + route to handler) instead of a normal advance. Everything else advances
		// exactly as before.
		if attachedStepID, armID, ok := decodeBoundaryTimerStep(stepID); ok {
			s.logger.Info().
				Str("instance_id", instanceID).Str("step_id", attachedStepID).Str("arm_id", armID).
				Msg("boundary timer fired, firing boundary event")
			if err := s.engine.FireBoundaryEvent(ctx, instanceID, attachedStepID, armID); err != nil {
				s.logger.Error().Err(err).
					Str("instance_id", instanceID).Str("step_id", attachedStepID).Str("arm_id", armID).
					Msg("failed to fire boundary event from timer")
			}
			continue
		}

		s.logger.Info().
			Str("instance_id", instanceID).
			Str("step_id", stepID).
			Msg("timer fired, advancing workflow")

		if err := s.engine.AdvanceWorkflow(ctx, instanceID, stepID); err != nil {
			s.logger.Error().Err(err).
				Str("instance_id", instanceID).
				Str("step_id", stepID).
				Msg("failed to advance workflow from timer")
		}
	}
}

// slaLoop periodically checks for overdue human tasks and processes SLA breaches.
func (s *SchedulerService) slaLoop(ctx context.Context) {
	defer func() {
		s.done <- struct{}{}
	}()

	ticker := time.NewTicker(s.slaInterval)
	defer ticker.Stop()

	s.logger.Info().Msg("SLA monitor started")

	for {
		select {
		case <-s.stopCh:
			s.logger.Info().Msg("SLA monitor stopping")
			return
		case <-ctx.Done():
			s.logger.Info().Msg("SLA monitor context cancelled")
			return
		case <-ticker.C:
			s.checkSLABreaches(ctx)
			s.checkAtRiskTasks(ctx)
		}
	}
}

// checkAtRiskTasks scans APPROACHING (not-yet-overdue) tasks and evaluates them
// against their tiered SLA policy so pre-breach reminder tiers fire BEFORE the
// deadline. It is a no-op unless a tiered SLA resolver is installed AND the wired
// task repository implements the atRiskTaskRepo seam (the production repo does;
// legacy test doubles do not, so this degrades to nothing and existing behavior
// is unchanged). The overdue path (checkSLABreaches) still owns breach handling;
// this path never marks a task breached — an approaching task's breach tier is
// not due yet, so EvaluateSLA reports only its lower reminder/notify tiers.
func (s *SchedulerService) checkAtRiskTasks(ctx context.Context) {
	if s.slaResolver == nil {
		return
	}
	ar, ok := s.taskRepo.(atRiskTaskRepo)
	if !ok {
		return
	}

	approaching, err := ar.GetApproachingTasks(ctx, atRiskLookahead, timerBatchSize)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to query approaching tasks")
		return
	}
	if len(approaching) == 0 {
		return
	}

	s.logger.Debug().Int("count", len(approaching)).Msg("evaluating approaching tasks for pre-breach reminders")

	for _, task := range approaching {
		policy, calendar, ok := s.resolveSLAPolicy(ctx, task)
		if !ok {
			continue
		}
		s.processTieredSLA(ctx, task, policy, calendar)
	}
}

// checkSLABreaches queries for overdue tasks, marks them as SLA-breached,
// escalates if configured, and publishes breach events.
func (s *SchedulerService) checkSLABreaches(ctx context.Context) {
	overdueTasks, err := s.taskRepo.GetOverdueTasks(ctx, timerBatchSize)
	if err != nil {
		s.logger.Error().Err(err).Msg("failed to query overdue tasks")
		return
	}

	if len(overdueTasks) == 0 {
		return
	}

	s.logger.Info().
		Int("count", len(overdueTasks)).
		Msg("processing SLA breaches")

	for _, task := range overdueTasks {
		// WP-5: when a tiered policy applies to this task, evaluate it against the
		// tenant business calendar and act on the due tiers; otherwise fall back
		// to the legacy single-tier breach behavior.
		if policy, calendar, ok := s.resolveSLAPolicy(ctx, task); ok {
			s.processTieredSLA(ctx, task, policy, calendar)
			continue
		}
		s.processSingleTierSLA(ctx, task)
	}
}

// resolveSLAPolicy returns the tiered policy + calendar for a task, or ok=false
// when no resolver is installed or no policy applies. A resolver that returns a
// policy with no tiers is treated as "no tiered policy" so the single-tier path
// runs (the existing behavior).
func (s *SchedulerService) resolveSLAPolicy(ctx context.Context, task *model.HumanTask) (SLAPolicy, Calendar, bool) {
	if s.slaResolver == nil {
		return SLAPolicy{}, Calendar{}, false
	}
	policy, calendar, ok := s.slaResolver.ResolvePolicy(ctx, task)
	if !ok || !policy.HasTiers() {
		return SLAPolicy{}, Calendar{}, false
	}
	return policy, calendar, true
}

// processSingleTierSLA is the legacy single-tier breach behavior, preserved
// verbatim: mark the task breached, escalate if an escalation role is set, and
// publish a breach event.
func (s *SchedulerService) processSingleTierSLA(ctx context.Context, task *model.HumanTask) {
	// Mark the task as SLA breached.
	if err := s.taskRepo.MarkSLABreached(ctx, task.ID); err != nil {
		s.logger.Error().Err(err).
			Str("task_id", task.ID).
			Msg("failed to mark task as SLA breached")
		return
	}

	s.logger.Warn().
		Str("task_id", task.ID).
		Str("instance_id", task.InstanceID).
		Str("tenant_id", task.TenantID).
		Msg("SLA breached for task")

	// Escalate if an escalation role is configured.
	if task.EscalationRole != nil && *task.EscalationRole != "" {
		if err := s.taskRepo.EscalateTask(ctx, task.ID, *task.EscalationRole); err != nil {
			s.logger.Error().Err(err).
				Str("task_id", task.ID).
				Str("escalation_role", *task.EscalationRole).
				Msg("failed to escalate task")
		} else {
			s.logger.Info().
				Str("task_id", task.ID).
				Str("escalation_role", *task.EscalationRole).
				Msg("task escalated due to SLA breach")
		}
	}

	// Publish SLA breach event.
	s.publishSLAEvent(ctx, task)
}

// processTieredSLA evaluates the tiered policy for a task as of now (business
// time, via the calendar) and acts on every due tier: a reassign/escalate tier
// reassigns the task, the breach (final) tier marks the task breached, and every
// due tier publishes an escalation event so downstream notifications fire. It is
// idempotent at the breach boundary — MarkSLABreached is only called for the
// breach tier, and the GetOverdueTasks candidate set already filters completed
// tasks, so a still-pending task that has not reached its breach tier yet
// receives only its lower notify/reassign tiers.
func (s *SchedulerService) processTieredSLA(ctx context.Context, task *model.HumanTask, policy SLAPolicy, calendar Calendar) {
	eval := EvaluateSLA(s.clock(), task, policy, calendar)

	// Reconcile the row-level sla_deadline to the tiered policy's computed breach
	// deadline so the flat candidate query (GetOverdueTasks, which gates on
	// sla_deadline < now) and this evaluator AGREE about the breach point. Done
	// even when nothing is due yet, so an approaching task's deadline is correct
	// the first time the monitor sees it. Best-effort via the optional seam.
	if !eval.BreachDeadline.IsZero() && !eval.Breached {
		if ar, ok := s.taskRepo.(atRiskTaskRepo); ok {
			if err := ar.ReconcileSLADeadline(ctx, task.ID, eval.BreachDeadline); err != nil {
				s.logger.Debug().Err(err).Str("task_id", task.ID).Msg("failed to reconcile sla deadline (tiered)")
			}
		}
	}

	if len(eval.DueActions) == 0 && len(eval.DueReminders) == 0 {
		return
	}

	for _, action := range eval.DueActions {
		switch action.Action {
		case SLAActionReassign, SLAActionEscalate:
			if role := escalationTarget(action.Notify); role != "" {
				if err := s.taskRepo.EscalateTask(ctx, task.ID, role); err != nil {
					s.logger.Error().Err(err).
						Str("task_id", task.ID).
						Str("target", role).
						Int("tier", action.TierIndex).
						Msg("failed to apply SLA tier escalation")
				} else {
					s.logger.Info().
						Str("task_id", task.ID).
						Str("target", role).
						Int("tier", action.TierIndex).
						Str("action", action.Action).
						Msg("SLA tier action applied")
				}
			}
		default: // SLAActionNotify — notification fires via the published event.
			s.logger.Info().
				Str("task_id", task.ID).
				Str("target", action.Notify).
				Int("tier", action.TierIndex).
				Msg("SLA tier notify due")
		}
		s.publishSLATierEvent(ctx, task, action)
	}

	if eval.Breached {
		if err := s.taskRepo.MarkSLABreached(ctx, task.ID); err != nil {
			s.logger.Error().Err(err).
				Str("task_id", task.ID).
				Msg("failed to mark task as SLA breached (tiered)")
			return
		}
		s.logger.Warn().
			Str("task_id", task.ID).
			Str("instance_id", task.InstanceID).
			Str("tenant_id", task.TenantID).
			Msg("SLA breached for task (final tier)")
		// Keep the legacy breach event so existing consumers still fire.
		s.publishSLAEvent(ctx, task)
	}

	// Pre-breach reminders. Previously this branch only LOGGED, so approaching-
	// deadline tiers never reached users — they only learned AFTER breach. Now
	// each due reminder emits a workflow.task.sla_reminder event so the
	// notification rule engine fans it out to email/in-app BEFORE the deadline.
	// The most-severe (nearest-breach) reminder additionally drives the at_risk
	// marker + at_risk event, so the task is queryable as "approaching" and the
	// user gets a single escalated warning rather than one per tier.
	if len(eval.DueReminders) > 0 && !eval.Breached {
		for _, rem := range eval.DueReminders {
			s.logger.Info().
				Str("task_id", task.ID).
				Dur("before_breach", rem.Before).
				Msg("SLA reminder due")
			s.publishSLAReminderEvent(ctx, task, rem, eval.BreachDeadline)
		}
		s.markAndPublishAtRisk(ctx, task, eval)
	}
}

// markAndPublishAtRisk stamps the row-level at_risk marker (via the optional
// seam) and emits a single workflow.task.at_risk event summarising the
// approaching breach. Called once per evaluation when the task is at risk but not
// yet breached, so downstream consumers get one "at risk" signal (not one per
// reminder tier). Best-effort throughout.
func (s *SchedulerService) markAndPublishAtRisk(ctx context.Context, task *model.HumanTask, eval SLAEvaluation) {
	if !eval.AtRisk {
		return
	}
	if ar, ok := s.taskRepo.(atRiskTaskRepo); ok {
		if err := ar.MarkAtRisk(ctx, task.ID); err != nil {
			s.logger.Debug().Err(err).Str("task_id", task.ID).Msg("failed to mark task at risk")
		}
	}
	s.publishAtRiskEvent(ctx, task, eval)
}

// clock returns the scheduler's current time (injected for tests), in UTC.
func (s *SchedulerService) clock() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

// escalationTarget extracts the role/user portion of a tier target like
// "role:lead" or "user:<id>", returning the bare value the task escalation path
// expects. A target with no prefix is returned as-is.
func escalationTarget(notify string) string {
	if i := strings.IndexByte(notify, ':'); i >= 0 {
		return notify[i+1:]
	}
	return notify
}

// publishSLATierEvent emits a tier-level escalation event so notification
// consumers can act on notify/reassign/escalate tiers (not only the final
// breach). Best-effort, mirroring publishSLAEvent.
func (s *SchedulerService) publishSLATierEvent(ctx context.Context, task *model.HumanTask, action SLAAction) {
	if s.producer == nil {
		return
	}
	evt, err := events.NewEvent("workflow.task.sla_escalated", "workflow-scheduler", task.TenantID, map[string]interface{}{
		"task_id":     task.ID,
		"instance_id": task.InstanceID,
		"step_id":     task.StepID,
		"task_name":   task.Name,
		"tier_index":  action.TierIndex,
		"action":      action.Action,
		"target":      action.Notify,
		"due_at":      action.DueAt,
		"breach":      action.Breach,
	})
	if err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to create SLA tier event")
		return
	}
	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to publish SLA tier event")
	}
}

// publishSLAReminderEvent emits a pre-breach reminder for one due reminder tier.
// It mirrors publishSLAEvent (the breach emit) so the notification rule engine
// can fan a workflow.task.sla_reminder out to email/in-app — the difference is
// that this fires BEFORE the deadline (remind_before ahead of breach), which is
// the whole point of the reminder cadence. Best-effort.
func (s *SchedulerService) publishSLAReminderEvent(ctx context.Context, task *model.HumanTask, rem SLAReminder, breachDeadline time.Time) {
	if s.producer == nil {
		return
	}
	evt, err := events.NewEvent("workflow.task.sla_reminder", "workflow-scheduler", task.TenantID, map[string]interface{}{
		"task_id":          task.ID,
		"instance_id":      task.InstanceID,
		"step_id":          task.StepID,
		"task_name":        task.Name,
		"assignee_id":      task.AssigneeID,
		"assignee_role":    task.AssigneeRole,
		"claimed_by":       task.ClaimedBy,
		"escalation_role":  task.EscalationRole,
		"remind_before":    rem.Before.String(),
		"reminder_fire_at": rem.FireAt,
		"breach_deadline":  breachDeadline,
	})
	if err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to create SLA reminder event")
		return
	}
	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to publish SLA reminder event")
	}
}

// publishAtRiskEvent emits a single workflow.task.at_risk summary when a task is
// approaching (but has not yet reached) its SLA breach. Mirrors the breach emit's
// recipient fields so the same email/in-app fan-out applies, but carries the
// approaching-breach framing so the UI/notification can present it as a warning.
func (s *SchedulerService) publishAtRiskEvent(ctx context.Context, task *model.HumanTask, eval SLAEvaluation) {
	if s.producer == nil {
		return
	}
	var nearest time.Duration
	if len(eval.DueReminders) > 0 {
		// DueReminders are fire-time ordered; the LAST is the nearest to breach.
		nearest = eval.DueReminders[len(eval.DueReminders)-1].Before
	}
	evt, err := events.NewEvent("workflow.task.at_risk", "workflow-scheduler", task.TenantID, map[string]interface{}{
		"task_id":               task.ID,
		"instance_id":           task.InstanceID,
		"step_id":               task.StepID,
		"task_name":             task.Name,
		"assignee_id":           task.AssigneeID,
		"assignee_role":         task.AssigneeRole,
		"claimed_by":            task.ClaimedBy,
		"escalation_role":       task.EscalationRole,
		"breach_deadline":       eval.BreachDeadline,
		"nearest_remind_before": nearest.String(),
	})
	if err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to create at-risk event")
		return
	}
	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("task_id", task.ID).Msg("failed to publish at-risk event")
	}
}

// publishSLAEvent publishes an event when a task's SLA is breached.
func (s *SchedulerService) publishSLAEvent(ctx context.Context, task *model.HumanTask) {
	if s.producer == nil {
		return
	}

	evt, err := events.NewEvent("workflow.task.sla_breached", "workflow-scheduler", task.TenantID, map[string]interface{}{
		"task_id":         task.ID,
		"instance_id":     task.InstanceID,
		"step_id":         task.StepID,
		"task_name":       task.Name,
		"assignee_id":     task.AssigneeID,
		"assignee_role":   task.AssigneeRole,
		"claimed_by":      task.ClaimedBy,
		"escalation_role": task.EscalationRole,
	})
	if err != nil {
		s.logger.Error().Err(err).
			Str("task_id", task.ID).
			Msg("failed to create SLA breach event")
		return
	}

	if err := s.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).
			Str("task_id", task.ID).
			Msg("failed to publish SLA breach event")
	}
}
