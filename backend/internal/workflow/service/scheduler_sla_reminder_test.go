package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// These tests close the pre-breach SLA reminder gap: they prove that an
// APPROACHING task (past a lower reminder tier but before the breach tier) emits
// workflow.task.sla_reminder + workflow.task.at_risk BEFORE breach, that the
// at-risk candidate query surfaces approaching work, and that the row-level
// sla_deadline is reconciled to the tiered policy's breach deadline so the flat
// overdue query and the evaluator AGREE.
//
// Distinct from scheduler_sla_dispatch_test.go, whose dispatchTaskRepo does NOT
// implement the optional atRiskTaskRepo seam (it exercises the legacy fallback).
// reminderTaskRepo below DOES implement the seam, so the reminder/reconcile/
// at-risk path is driven end to end.

// reminderTaskRepo is a taskRepo that also satisfies the optional atRiskTaskRepo
// seam. It records the reminder-path side effects (reconciled deadlines, at-risk
// marks) plus the breach-path side effects it inherits from the SLA loop.
type reminderTaskRepo struct {
	taskRepo
	mu sync.Mutex

	overdue     []*model.HumanTask
	approaching []*model.HumanTask

	breached   []string
	escalated  map[string]string
	atRisk     []string
	reconciled map[string]time.Time
}

func newReminderTaskRepo() *reminderTaskRepo {
	return &reminderTaskRepo{
		escalated:  map[string]string{},
		reconciled: map[string]time.Time{},
	}
}

func (r *reminderTaskRepo) GetOverdueTasks(_ context.Context, _ int) ([]*model.HumanTask, error) {
	return r.overdue, nil
}

func (r *reminderTaskRepo) MarkSLABreached(_ context.Context, taskID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.breached = append(r.breached, taskID)
	return nil
}

func (r *reminderTaskRepo) EscalateTask(_ context.Context, taskID, role string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.escalated[taskID] = role
	return nil
}

// --- optional atRiskTaskRepo seam ---

func (r *reminderTaskRepo) GetApproachingTasks(_ context.Context, _ time.Duration, _ int) ([]*model.HumanTask, error) {
	return r.approaching, nil
}

func (r *reminderTaskRepo) ReconcileSLADeadline(_ context.Context, taskID string, breachDeadline time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reconciled[taskID] = breachDeadline
	return nil
}

func (r *reminderTaskRepo) MarkAtRisk(_ context.Context, taskID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.atRisk = append(r.atRisk, taskID)
	return nil
}

func (r *reminderTaskRepo) reconciledDeadline(taskID string) (time.Time, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.reconciled[taskID]
	return t, ok
}

func newReminderScheduler(repo taskRepo, prod eventPublisher, now time.Time) *SchedulerService {
	s := NewSchedulerService(nil, repo, nil, prod, zerolog.Nop(), 0, 0)
	s.now = func() time.Time { return now }
	return s
}

// reminderPolicy is a 24x7 policy that breaches at 8h and reminds 2h + 1h before
// breach. At now = created+6h30m, the 6h and 7h reminder fire-times have passed
// (breach-2h = 6h, breach-1h = 7h... only the 6h one has passed) but the 8h
// breach tier has NOT.
func reminderPolicy() SLAPolicy {
	return SLAPolicy{
		Tiers: []SLATier{
			{After: 8 * time.Hour, Notify: "role:manager", Action: SLAActionEscalate},
		},
		RemindBefore: []time.Duration{2 * time.Hour, 1 * time.Hour},
	}
}

func TestApproachingTask_EmitsReminderBeforeBreach(t *testing.T) {
	created := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	// breach = created + 8h = 17:00. remind_before 2h -> fire 15:00, 1h -> 16:00.
	// now = 15:30 -> only the 2h reminder has fired; NOT breached.
	now := created.Add(6*time.Hour + 30*time.Minute)

	task := &model.HumanTask{
		ID: "task-approaching", TenantID: "tenant-1", InstanceID: "inst-1",
		Name: "Review", Status: model.TaskStatusClaimed, CreatedAt: created,
	}
	repo := newReminderTaskRepo()
	repo.approaching = []*model.HumanTask{task}
	prod := newDispatchProducer()
	resolver := &dispatchResolver{ok: true, calendar: Default24x7Calendar(), policy: reminderPolicy()}

	s := newReminderScheduler(repo, prod, now)
	s.SetSLAPolicyResolver(resolver)

	// The at-risk scan (approaching candidates) is the pre-breach path.
	s.checkAtRiskTasks(context.Background())

	if got := prod.count("com.clario360.workflow.task.sla_reminder"); got == 0 {
		t.Fatalf("approaching task must emit sla_reminder BEFORE breach, got 0 (events=%v)", prod.byType)
	}
	if got := prod.count("com.clario360.workflow.task.at_risk"); got != 1 {
		t.Fatalf("approaching task must emit exactly one at_risk summary, got %d (events=%v)", got, prod.byType)
	}
	// It must NOT breach or emit a breach event on the pre-breach path.
	if got := prod.count("com.clario360.workflow.task.sla_breached"); got != 0 {
		t.Fatalf("pre-breach path must NOT emit sla_breached, got %d", got)
	}
	if len(repo.breached) != 0 {
		t.Fatalf("pre-breach path must NOT mark breached, got %v", repo.breached)
	}
	// The task must be marked at risk so it is queryable as approaching.
	if len(repo.atRisk) != 1 || repo.atRisk[0] != task.ID {
		t.Fatalf("approaching task must be marked at risk, got %v", repo.atRisk)
	}
}

func TestApproachingTask_ReconciledDeadlineMatchesTieredPolicy(t *testing.T) {
	created := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	now := created.Add(6*time.Hour + 30*time.Minute)
	policy := reminderPolicy()
	cal := Default24x7Calendar()

	task := &model.HumanTask{
		ID: "task-reconcile", TenantID: "tenant-1", InstanceID: "inst-1",
		Name: "Review", Status: model.TaskStatusPending, CreatedAt: created,
	}
	repo := newReminderTaskRepo()
	repo.approaching = []*model.HumanTask{task}
	prod := newDispatchProducer()
	resolver := &dispatchResolver{ok: true, calendar: cal, policy: policy}

	s := newReminderScheduler(repo, prod, now)
	s.SetSLAPolicyResolver(resolver)

	s.checkAtRiskTasks(context.Background())

	// The reconciled deadline must equal the evaluator's breach deadline for the
	// SAME (now, task, policy, calendar) — i.e. the flat column and the tiered
	// evaluator AGREE. Compute the expected value directly from EvaluateSLA.
	want := EvaluateSLA(now, task, policy, cal).BreachDeadline
	if want.IsZero() {
		t.Fatalf("test setup: expected a non-zero breach deadline")
	}
	got, ok := repo.reconciledDeadline(task.ID)
	if !ok {
		t.Fatalf("expected the row-level sla_deadline to be reconciled, but it was not")
	}
	if !got.Equal(want) {
		t.Fatalf("reconciled deadline %s does not match tiered policy breach deadline %s", got, want)
	}
	// Sanity: breach is created + 8h = 17:00 UTC on a 24x7 calendar.
	if wantWall := created.Add(8 * time.Hour); !want.Equal(wantWall) {
		t.Fatalf("expected breach at %s (created+8h), got %s", wantWall, want)
	}
}

func TestCheckAtRiskTasks_NoResolver_IsNoOp(t *testing.T) {
	task := &model.HumanTask{
		ID: "task-x", TenantID: "tenant-1", InstanceID: "inst-1",
		Status: model.TaskStatusPending, CreatedAt: time.Now().UTC(),
	}
	repo := newReminderTaskRepo()
	repo.approaching = []*model.HumanTask{task}
	prod := newDispatchProducer()

	// No resolver installed -> the pre-breach scan is a no-op.
	s := newReminderScheduler(repo, prod, time.Now().UTC())
	s.checkAtRiskTasks(context.Background())

	if len(prod.byType) != 0 {
		t.Fatalf("no-resolver at-risk scan must emit nothing, got %v", prod.byType)
	}
	if len(repo.atRisk) != 0 {
		t.Fatalf("no-resolver at-risk scan must not mark anything at risk, got %v", repo.atRisk)
	}
}

func TestCheckAtRiskTasks_LegacyRepoWithoutSeam_IsNoOp(t *testing.T) {
	// dispatchTaskRepo (from scheduler_sla_dispatch_test.go) does NOT implement
	// atRiskTaskRepo, so even with a resolver installed the pre-breach scan must
	// degrade to nothing (backward-compat: the type assertion fails).
	repo := newDispatchTaskRepo()
	prod := newDispatchProducer()
	resolver := &dispatchResolver{ok: true, calendar: Default24x7Calendar(), policy: reminderPolicy()}

	s := newReminderScheduler(repo, prod, time.Now().UTC())
	s.SetSLAPolicyResolver(resolver)
	s.checkAtRiskTasks(context.Background())

	if len(prod.byType) != 0 {
		t.Fatalf("legacy repo (no seam) at-risk scan must emit nothing, got %v", prod.byType)
	}
}

func TestEvaluateSLA_AtRiskFlag_SetBeforeBreach(t *testing.T) {
	created := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	policy := reminderPolicy()
	cal := Default24x7Calendar()
	task := &model.HumanTask{Status: model.TaskStatusPending, CreatedAt: created}

	// Before any reminder fires (now = created+5h, breach at +8h, first reminder
	// at +6h): not at risk yet.
	eval := EvaluateSLA(created.Add(5*time.Hour), task, policy, cal)
	if eval.AtRisk || eval.Breached {
		t.Fatalf("at 5h: expected neither at-risk nor breached, got at_risk=%v breached=%v", eval.AtRisk, eval.Breached)
	}

	// After the 2h-before reminder fires (now = created+6h30m): at risk, not breached.
	eval = EvaluateSLA(created.Add(6*time.Hour+30*time.Minute), task, policy, cal)
	if !eval.AtRisk || eval.Breached {
		t.Fatalf("at 6h30m: expected at-risk and not breached, got at_risk=%v breached=%v", eval.AtRisk, eval.Breached)
	}
	if len(eval.DueReminders) == 0 {
		t.Fatalf("at 6h30m: expected at least one due reminder")
	}

	// After breach (now = created+9h): breached, and AtRisk is false (mutually
	// exclusive — reminders are not collected once breached).
	eval = EvaluateSLA(created.Add(9*time.Hour), task, policy, cal)
	if !eval.Breached || eval.AtRisk {
		t.Fatalf("at 9h: expected breached and not at-risk, got at_risk=%v breached=%v", eval.AtRisk, eval.Breached)
	}
}

// compile-time assertion the reminder repo satisfies both the core taskRepo and
// the optional at-risk seam.
var (
	_ taskRepo       = (*reminderTaskRepo)(nil)
	_ atRiskTaskRepo = (*reminderTaskRepo)(nil)
)

// silence unused import when the events package is only referenced transitively.
var _ = events.Topics.WorkflowEvents
