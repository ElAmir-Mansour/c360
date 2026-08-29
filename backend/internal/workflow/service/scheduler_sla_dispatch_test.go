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

// These tests close the WP-5 dispatch-seam coverage gap: they drive an overdue
// task set through SchedulerService.checkSLABreaches and prove the live branch
// (resolveSLAPolicy -> processTieredSLA | processSingleTierSLA) routes correctly
// — the tiered path when a resolver returns a policy with tiers, and the legacy
// single-tier path otherwise (no resolver, resolver ok=false, or no tiers).
// The two paths are distinguished by the event type each publishes:
//   - tiered      -> "com.clario360.workflow.task.sla_escalated" (publishSLATierEvent)
//   - single-tier -> "com.clario360.workflow.task.sla_breached"  (publishSLAEvent)

// dispatchTaskRepo is a minimal taskRepo for the SLA loop. It embeds the
// (unexported, same-package) taskRepo interface so only the three methods the
// SLA path uses need real bodies; any other call would panic, which is the
// desired signal that the loop touched something it should not.
type dispatchTaskRepo struct {
	taskRepo
	mu        sync.Mutex
	overdue   []*model.HumanTask
	breached  []string
	escalated map[string]string // taskID -> target role
}

func newDispatchTaskRepo(tasks ...*model.HumanTask) *dispatchTaskRepo {
	return &dispatchTaskRepo{overdue: tasks, escalated: map[string]string{}}
}

func (r *dispatchTaskRepo) GetOverdueTasks(_ context.Context, _ int) ([]*model.HumanTask, error) {
	return r.overdue, nil
}

func (r *dispatchTaskRepo) MarkSLABreached(_ context.Context, taskID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.breached = append(r.breached, taskID)
	return nil
}

func (r *dispatchTaskRepo) EscalateTask(_ context.Context, taskID, role string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.escalated[taskID] = role
	return nil
}

// dispatchProducer records published events by type.
type dispatchProducer struct {
	mu     sync.Mutex
	byType map[string]int
}

func newDispatchProducer() *dispatchProducer { return &dispatchProducer{byType: map[string]int{}} }

func (p *dispatchProducer) Publish(_ context.Context, _ string, evt *events.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.byType[evt.Type]++
	return nil
}

func (p *dispatchProducer) count(eventType string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.byType[eventType]
}

// dispatchResolver is a fake SLAPolicyResolver returning a fixed policy/ok.
type dispatchResolver struct {
	policy   SLAPolicy
	calendar Calendar
	ok       bool
	calls    int
}

func (d *dispatchResolver) ResolvePolicy(_ context.Context, _ *model.HumanTask) (SLAPolicy, Calendar, bool) {
	d.calls++
	return d.policy, d.calendar, d.ok
}

func newDispatchScheduler(repo taskRepo, prod eventPublisher, now time.Time) *SchedulerService {
	s := NewSchedulerService(nil, repo, nil, prod, zerolog.Nop(), 0, 0)
	s.now = func() time.Time { return now }
	return s
}

func TestCheckSLABreaches_TieredPath_WhenPolicyResolves(t *testing.T) {
	created := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	now := created.Add(10 * time.Hour) // past an 8h escalate tier -> due + breach
	task := &model.HumanTask{
		ID: "task-tiered", TenantID: "tenant-1", InstanceID: "inst-1",
		Status: model.TaskStatusPending, CreatedAt: created,
	}
	repo := newDispatchTaskRepo(task)
	prod := newDispatchProducer()
	resolver := &dispatchResolver{
		ok:       true,
		calendar: Default24x7Calendar(),
		policy: SLAPolicy{Tiers: []SLATier{
			{After: 4 * time.Hour, Notify: "role:lead", Action: SLAActionNotify},
			{After: 8 * time.Hour, Notify: "role:manager", Action: SLAActionEscalate},
		}},
	}
	s := newDispatchScheduler(repo, prod, now)
	s.SetSLAPolicyResolver(resolver)

	s.checkSLABreaches(context.Background())

	if resolver.calls != 1 {
		t.Fatalf("resolver should be consulted once, got %d", resolver.calls)
	}
	if got := prod.count("com.clario360.workflow.task.sla_escalated"); got == 0 {
		t.Fatalf("tiered path must publish workflow.task.sla_escalated, got 0 (events=%v)", prod.byType)
	}
	// The breach (final) tier is due, so the tiered path also marks breached and
	// escalates to the manager tier target.
	if len(repo.breached) != 1 || repo.breached[0] != task.ID {
		t.Fatalf("expected breach tier to mark task breached, got %v", repo.breached)
	}
	// escalationTarget strips the "role:" prefix before EscalateTask.
	if repo.escalated[task.ID] != "manager" {
		t.Fatalf("expected escalate to manager (role: prefix stripped), got %q", repo.escalated[task.ID])
	}
}

func TestCheckSLABreaches_SingleTierFallback_WhenResolverReturnsNotOK(t *testing.T) {
	task := &model.HumanTask{
		ID: "task-single", TenantID: "tenant-1", InstanceID: "inst-1",
		Status: model.TaskStatusPending, CreatedAt: time.Now().UTC().Add(-2 * time.Hour),
		EscalationRole: strptr("role:lead"),
	}
	repo := newDispatchTaskRepo(task)
	prod := newDispatchProducer()
	resolver := &dispatchResolver{ok: false} // no tiered policy applies
	s := newDispatchScheduler(repo, prod, time.Now().UTC())
	s.SetSLAPolicyResolver(resolver)

	s.checkSLABreaches(context.Background())

	if got := prod.count("com.clario360.workflow.task.sla_breached"); got != 1 {
		t.Fatalf("single-tier path must publish exactly one workflow.task.sla_breached, got %d (events=%v)", got, prod.byType)
	}
	if got := prod.count("com.clario360.workflow.task.sla_escalated"); got != 0 {
		t.Fatalf("single-tier path must NOT publish sla_escalated, got %d", got)
	}
	if len(repo.breached) != 1 || repo.breached[0] != task.ID {
		t.Fatalf("single-tier path must mark the task breached, got %v", repo.breached)
	}
	if repo.escalated[task.ID] != "role:lead" {
		t.Fatalf("single-tier path must escalate to the task EscalationRole, got %q", repo.escalated[task.ID])
	}
}

func TestCheckSLABreaches_SingleTierFallback_WhenNoResolverInstalled(t *testing.T) {
	task := &model.HumanTask{
		ID: "task-noresolver", TenantID: "tenant-1", InstanceID: "inst-1",
		Status: model.TaskStatusPending, CreatedAt: time.Now().UTC().Add(-2 * time.Hour),
	}
	repo := newDispatchTaskRepo(task)
	prod := newDispatchProducer()
	s := newDispatchScheduler(repo, prod, time.Now().UTC()) // no SetSLAPolicyResolver

	s.checkSLABreaches(context.Background())

	if got := prod.count("com.clario360.workflow.task.sla_breached"); got != 1 {
		t.Fatalf("no-resolver path must use single-tier (one sla_breached), got %d", got)
	}
	if got := prod.count("com.clario360.workflow.task.sla_escalated"); got != 0 {
		t.Fatalf("no-resolver path must not publish sla_escalated, got %d", got)
	}
	if len(repo.breached) != 1 {
		t.Fatalf("no-resolver path must mark the task breached, got %v", repo.breached)
	}
}

func TestCheckSLABreaches_SingleTierFallback_WhenPolicyHasNoTiers(t *testing.T) {
	task := &model.HumanTask{
		ID: "task-notiers", TenantID: "tenant-1", InstanceID: "inst-1",
		Status: model.TaskStatusPending, CreatedAt: time.Now().UTC().Add(-2 * time.Hour),
	}
	repo := newDispatchTaskRepo(task)
	prod := newDispatchProducer()
	// resolver returns ok=true but a policy with NO tiers -> resolveSLAPolicy
	// treats it as "no tiered policy" and the single-tier path runs.
	resolver := &dispatchResolver{ok: true, calendar: Default24x7Calendar(), policy: SLAPolicy{}}
	s := newDispatchScheduler(repo, prod, time.Now().UTC())
	s.SetSLAPolicyResolver(resolver)

	s.checkSLABreaches(context.Background())

	if got := prod.count("com.clario360.workflow.task.sla_breached"); got != 1 {
		t.Fatalf("empty-policy must fall back to single-tier, got %d sla_breached", got)
	}
	if got := prod.count("com.clario360.workflow.task.sla_escalated"); got != 0 {
		t.Fatalf("empty-policy must not take the tiered path, got %d sla_escalated", got)
	}
}
