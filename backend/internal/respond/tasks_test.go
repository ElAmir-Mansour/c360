package respond

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

type taskTestRunner struct{}

func (taskTestRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

func (taskTestRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

func (taskTestRunner) RunSystemRead(_ context.Context, fn func(DBTX) error) error {
	return fn(nil)
}

type taskMemoryStore struct {
	incidents   map[uuid.UUID]*Incident
	templates   map[string]IncidentTaskTemplate
	steps       map[uuid.UUID][]IncidentTaskTemplateStep
	tasks       map[uuid.UUID][]IncidentTask
	assignments []IncidentTaskAssignment
	histories   []IncidentTaskStatusHistory
	events      []TimelineEvent
	now         time.Time
}

func newTaskMemoryStore(now time.Time) *taskMemoryStore {
	return &taskMemoryStore{
		incidents: map[uuid.UUID]*Incident{},
		templates: map[string]IncidentTaskTemplate{},
		steps:     map[uuid.UUID][]IncidentTaskTemplateStep{},
		tasks:     map[uuid.UUID][]IncidentTask{},
		now:       now,
	}
}

func (s *taskMemoryStore) GetIncident(_ context.Context, _ DBTX, tenantID, id uuid.UUID) (*Incident, error) {
	incident, ok := s.incidents[id]
	if !ok || incident.TenantID != tenantID {
		return nil, ErrIncidentNotFound
	}
	copy := *incident
	return &copy, nil
}

func (s *taskMemoryStore) GetTaskTemplateByKey(_ context.Context, _ DBTX, _ uuid.UUID, templateKey string) (*IncidentTaskTemplate, error) {
	template, ok := s.templates[templateKey]
	if !ok {
		return nil, ErrTaskTemplateNotFound
	}
	copy := template
	return &copy, nil
}

func (s *taskMemoryStore) ListTaskTemplateSteps(_ context.Context, _ DBTX, templateID uuid.UUID) ([]IncidentTaskTemplateStep, error) {
	steps := append([]IncidentTaskTemplateStep(nil), s.steps[templateID]...)
	sort.SliceStable(steps, func(i, j int) bool { return steps[i].Position < steps[j].Position })
	return steps, nil
}

func (s *taskMemoryStore) ListIncidentTasks(_ context.Context, _ DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error) {
	return s.copyIncidentTasks(tenantID, incidentID), nil
}

func (s *taskMemoryStore) ListIncidentTasksForUpdate(_ context.Context, _ DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error) {
	return s.copyIncidentTasks(tenantID, incidentID), nil
}

func (s *taskMemoryStore) copyIncidentTasks(tenantID, incidentID uuid.UUID) []IncidentTask {
	tasks := append([]IncidentTask(nil), s.tasks[incidentID]...)
	out := tasks[:0]
	for _, task := range tasks {
		if task.TenantID != tenantID {
			continue
		}
		task.Dependencies = append([]uuid.UUID(nil), task.Dependencies...)
		task.Params = copyMap(task.Params)
		task.Scope = copyMap(task.Scope)
		out = append(out, task)
	}
	sortIncidentTasks(out)
	return out
}

func (s *taskMemoryStore) CreateIncidentTask(_ context.Context, _ DBTX, task *IncidentTask) error {
	for _, existing := range s.tasks[task.IncidentID] {
		if existing.TaskKey == task.TaskKey {
			return ErrTaskAlreadyExists
		}
	}
	if task.ID == uuid.Nil {
		task.ID = uuid.New()
	}
	if task.CreatedAt.IsZero() {
		task.CreatedAt = s.now
	}
	task.UpdatedAt = task.CreatedAt
	task.RowVersion = 1
	task.Dependencies = append([]uuid.UUID(nil), task.Dependencies...)
	s.tasks[task.IncidentID] = append(s.tasks[task.IncidentID], *task)
	return nil
}

func (s *taskMemoryStore) ReplaceIncidentTaskDependencies(_ context.Context, _ DBTX, _ uuid.UUID, incidentID, taskID uuid.UUID, dependencies []uuid.UUID) error {
	idx := s.taskIndex(incidentID, taskID)
	if idx < 0 {
		return ErrTaskNotFound
	}
	for _, dependency := range dependencies {
		if s.taskIndex(incidentID, dependency) < 0 {
			return ErrTaskDependencyUnknown
		}
	}
	s.tasks[incidentID][idx].Dependencies = append([]uuid.UUID(nil), dependencies...)
	return nil
}

func (s *taskMemoryStore) UpdateIncidentTaskPosition(_ context.Context, _ DBTX, _ uuid.UUID, incidentID, taskID uuid.UUID, position int) (*IncidentTask, error) {
	idx := s.taskIndex(incidentID, taskID)
	if idx < 0 {
		return nil, ErrTaskNotFound
	}
	s.tasks[incidentID][idx].Position = position
	s.tasks[incidentID][idx].RowVersion++
	s.tasks[incidentID][idx].UpdatedAt = s.now
	task := s.tasks[incidentID][idx]
	return &task, nil
}

func (s *taskMemoryStore) UpdateIncidentTaskAssignment(_ context.Context, _ DBTX, _ uuid.UUID, incidentID, taskID uuid.UUID, ownerID *uuid.UUID, ownerRole IncidentRole, team string) (*IncidentTask, error) {
	idx := s.taskIndex(incidentID, taskID)
	if idx < 0 {
		return nil, ErrTaskNotFound
	}
	s.tasks[incidentID][idx].OwnerID = cloneUUIDPtr(ownerID)
	s.tasks[incidentID][idx].OwnerRole = ownerRole
	s.tasks[incidentID][idx].Team = team
	s.tasks[incidentID][idx].RowVersion++
	s.tasks[incidentID][idx].UpdatedAt = s.now
	task := s.tasks[incidentID][idx]
	return &task, nil
}

func (s *taskMemoryStore) UpdateIncidentTaskScope(_ context.Context, _ DBTX, task IncidentTask) (*IncidentTask, error) {
	idx := s.taskIndex(task.IncidentID, task.ID)
	if idx < 0 {
		return nil, ErrTaskNotFound
	}
	current := s.tasks[task.IncidentID][idx]
	current.Title = task.Title
	current.Description = task.Description
	current.Required = task.Required
	current.DueAt = cloneTimePtr(task.DueAt)
	current.PlannedDurationSeconds = task.PlannedDurationSeconds
	current.AutomationAction = task.AutomationAction
	current.Params = copyMap(task.Params)
	current.Scope = copyMap(task.Scope)
	current.Dependencies = append([]uuid.UUID(nil), task.Dependencies...)
	current.RowVersion++
	current.UpdatedAt = s.now
	s.tasks[task.IncidentID][idx] = current
	return &current, nil
}

func (s *taskMemoryStore) UpdateIncidentTaskStatus(_ context.Context, _ DBTX, _ uuid.UUID, incidentID, taskID uuid.UUID, status IncidentTaskStatus, actedBy *uuid.UUID, startedAt, finishedAt *time.Time, actualDuration *int) (*IncidentTask, error) {
	idx := s.taskIndex(incidentID, taskID)
	if idx < 0 {
		return nil, ErrTaskNotFound
	}
	task := s.tasks[incidentID][idx]
	task.Status = status
	if actedBy != nil {
		task.ActedBy = cloneUUIDPtr(actedBy)
	}
	if startedAt != nil && task.StartedAt == nil {
		task.StartedAt = cloneTimePtr(startedAt)
	}
	if finishedAt != nil {
		task.FinishedAt = cloneTimePtr(finishedAt)
	}
	if actualDuration != nil {
		duration := *actualDuration
		task.ActualDurationSeconds = &duration
	}
	task.RowVersion++
	task.UpdatedAt = s.now
	s.tasks[incidentID][idx] = task
	return &task, nil
}

func (s *taskMemoryStore) AppendTaskAssignment(_ context.Context, _ DBTX, assignment *IncidentTaskAssignment) error {
	if assignment.ID == uuid.Nil {
		assignment.ID = uuid.New()
	}
	s.assignments = append(s.assignments, *assignment)
	return nil
}

func (s *taskMemoryStore) AppendTaskStatusHistory(_ context.Context, _ DBTX, history *IncidentTaskStatusHistory) error {
	if history.ID == uuid.Nil {
		history.ID = uuid.New()
	}
	s.histories = append(s.histories, *history)
	return nil
}

func (s *taskMemoryStore) AppendTimelineEvent(_ context.Context, _ DBTX, ev *TimelineEvent) error {
	if ev.ID == uuid.Nil {
		ev.ID = uuid.New()
	}
	if ev.OccurredAt.IsZero() {
		ev.OccurredAt = s.now
	}
	s.events = append(s.events, *ev)
	return nil
}

func (s *taskMemoryStore) taskIndex(incidentID, taskID uuid.UUID) int {
	for i, task := range s.tasks[incidentID] {
		if task.ID == taskID {
			return i
		}
	}
	return -1
}

func newTaskCoordinatorFixture(t *testing.T) (*taskCoordinator, *taskMemoryStore, uuid.UUID, uuid.UUID, Actor) {
	t.Helper()
	now := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	incidentID := uuid.New()
	commander := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleCommander}}
	store := newTaskMemoryStore(now)
	store.incidents[incidentID] = &Incident{
		ID:         incidentID,
		TenantID:   tenantID,
		Reference:  "INC-2026-0001",
		Title:      "payments unavailable",
		Severity:   SeveritySEV1,
		Status:     StatusInvestigating,
		DeclaredBy: commander.UserID,
		DeclaredAt: now,
	}
	seedTaskTemplate(store, now)
	coordinator := newTaskCoordinator(taskTestRunner{}, store, store, nil, func() time.Time { return now })
	return coordinator, store, tenantID, incidentID, commander
}

func seedTaskTemplate(store *taskMemoryStore, now time.Time) {
	templateID := uuid.New()
	store.templates["payment-outage"] = IncidentTaskTemplate{
		ID:           templateID,
		Scope:        TaskTemplateScopeGlobal,
		TemplateKey:  "payment-outage",
		IncidentType: "payment-outage",
		Name:         "Payment outage response",
		Version:      1,
		Active:       true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	store.steps[templateID] = []IncidentTaskTemplateStep{
		{
			ID:                     uuid.New(),
			TemplateID:             templateID,
			TemplateKey:            "payment-outage",
			StepKey:                "open-bridge",
			Position:               10,
			Title:                  "Open bridge",
			Description:            "Open the command bridge.",
			TaskType:               TaskTypeManual,
			Required:               true,
			OwnerRole:              RoleCommander,
			Team:                   "incident-command",
			DueOffsetSeconds:       300,
			PlannedDurationSeconds: 300,
		},
		{
			ID:                     uuid.New(),
			TemplateID:             templateID,
			TemplateKey:            "payment-outage",
			StepKey:                "assess-impact",
			Position:               20,
			Title:                  "Assess impact",
			Description:            "Quantify affected payments.",
			TaskType:               TaskTypeManual,
			Required:               true,
			OwnerRole:              RoleTechnicalLead,
			Team:                   "payments",
			DueOffsetSeconds:       900,
			PlannedDurationSeconds: 600,
			Predecessors:           []string{"open-bridge"},
		},
		{
			ID:                     uuid.New(),
			TemplateID:             templateID,
			TemplateKey:            "payment-outage",
			StepKey:                "send-update",
			Position:               30,
			Title:                  "Send update",
			Description:            "Send stakeholder update.",
			TaskType:               TaskTypeComms,
			Required:               false,
			OwnerRole:              RoleCommunicationsLead,
			Team:                   "communications",
			DueOffsetSeconds:       1200,
			PlannedDurationSeconds: 300,
			Predecessors:           []string{"assess-impact"},
		},
	}
}

func TestTaskTemplateInstantiationCreatesPersistedGraph(t *testing.T) {
	ctx := context.Background()
	coordinator, store, tenantID, incidentID, commander := newTaskCoordinatorFixture(t)

	graph, err := coordinator.InstantiateTemplate(ctx, tenantID, InstantiateTaskTemplateInput{
		IncidentID:  incidentID,
		TemplateKey: "payment-outage",
		Actor:       commander,
	})
	if err != nil {
		t.Fatalf("InstantiateTemplate: %v", err)
	}
	if len(graph.Tasks) != 3 {
		t.Fatalf("tasks = %d, want 3", len(graph.Tasks))
	}
	byKey := tasksByKey(graph.Tasks)
	if byKey["open-bridge"].Status != TaskStatusRunnable {
		t.Fatalf("open-bridge status = %s, want runnable", byKey["open-bridge"].Status)
	}
	if byKey["assess-impact"].Status != TaskStatusPending {
		t.Fatalf("assess-impact status = %s, want pending", byKey["assess-impact"].Status)
	}
	if got := byKey["assess-impact"].Dependencies; len(got) != 1 || got[0] != byKey["open-bridge"].ID {
		t.Fatalf("assess-impact dependencies = %v, want open-bridge", got)
	}
	if byKey["open-bridge"].DueAt == nil || !byKey["open-bridge"].DueAt.Equal(store.now.Add(5*time.Minute)) {
		t.Fatalf("open-bridge due_at = %v", byKey["open-bridge"].DueAt)
	}
	if graph.Progress.Total != 3 || graph.Progress.RequiredTotal != 2 || len(graph.Progress.Frontier) != 1 {
		t.Fatalf("progress = %+v, want total 3 required 2 frontier 1", graph.Progress)
	}
	if len(store.assignments) != 3 {
		t.Fatalf("assignments = %d, want one per templated owner", len(store.assignments))
	}
	if !historyContains(store.histories, nil, TaskStatusPending) || !historyContains(store.histories, statusPtr(TaskStatusPending), TaskStatusRunnable) {
		t.Fatalf("status history did not capture creation and derived runnable transitions: %+v", store.histories)
	}
	if len(store.events) != 1 || store.events[0].EventType != EventTaskTemplateInstantiated {
		t.Fatalf("events = %+v, want template instantiation event", store.events)
	}
}

func TestTaskDependencyEnforcementBlocksOutOfOrderCompletion(t *testing.T) {
	ctx := context.Background()
	coordinator, _, tenantID, incidentID, commander := newTaskCoordinatorFixture(t)
	graph, err := coordinator.InstantiateTemplate(ctx, tenantID, InstantiateTaskTemplateInput{
		IncidentID:  incidentID,
		TemplateKey: "payment-outage",
		Actor:       commander,
	})
	if err != nil {
		t.Fatalf("InstantiateTemplate: %v", err)
	}
	byKey := tasksByKey(graph.Tasks)
	technicalLead := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleTechnicalLead}}

	if _, err := coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     byKey["assess-impact"].ID,
		To:         TaskStatusComplete,
		Actor:      technicalLead,
	}); !errors.Is(err, ErrTaskDependencyBlocked) {
		t.Fatalf("complete dependent task error = %v, want ErrTaskDependencyBlocked", err)
	}

	graph, err = coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     byKey["open-bridge"].ID,
		To:         TaskStatusComplete,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("complete open-bridge: %v", err)
	}
	if got := tasksByKey(graph.Tasks)["assess-impact"].Status; got != TaskStatusRunnable {
		t.Fatalf("assess-impact status = %s, want runnable after predecessor completion", got)
	}
}

func TestTaskLiveEditOperations(t *testing.T) {
	ctx := context.Background()
	coordinator, store, tenantID, incidentID, commander := newTaskCoordinatorFixture(t)
	graph, err := coordinator.InstantiateTemplate(ctx, tenantID, InstantiateTaskTemplateInput{
		IncidentID:  incidentID,
		TemplateKey: "payment-outage",
		Actor:       commander,
	})
	if err != nil {
		t.Fatalf("InstantiateTemplate: %v", err)
	}
	openBridge := tasksByKey(graph.Tasks)["open-bridge"]

	position := 40
	graph, err = coordinator.AddTask(ctx, tenantID, AddIncidentTaskInput{
		IncidentID: incidentID,
		TaskKey:    "collect-ledger-evidence",
		Title:      "Collect ledger evidence",
		TaskType:   TaskTypeManual,
		Position:   &position,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("AddTask: %v", err)
	}
	added := tasksByKey(graph.Tasks)["collect-ledger-evidence"]
	if added.Status != TaskStatusRunnable {
		t.Fatalf("added task status = %s, want runnable", added.Status)
	}

	graph, err = coordinator.ReorderTask(ctx, tenantID, ReorderIncidentTaskInput{
		IncidentID: incidentID,
		TaskID:     added.ID,
		Position:   5,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("ReorderTask: %v", err)
	}
	if got := tasksByKey(graph.Tasks)["collect-ledger-evidence"].Position; got != 5 {
		t.Fatalf("position = %d, want 5", got)
	}

	assignee := uuid.New()
	graph, err = coordinator.AssignTask(ctx, tenantID, AssignIncidentTaskInput{
		IncidentID: incidentID,
		TaskID:     added.ID,
		OwnerID:    &assignee,
		Team:       "finance-ops",
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("AssignTask: %v", err)
	}
	assigned := tasksByKey(graph.Tasks)["collect-ledger-evidence"]
	if assigned.OwnerID == nil || *assigned.OwnerID != assignee || assigned.Team != "finance-ops" {
		t.Fatalf("assigned task = %+v", assigned)
	}

	deps := []uuid.UUID{openBridge.ID}
	duration := 120
	graph, err = coordinator.RescopeTask(ctx, tenantID, RescopeIncidentTaskInput{
		IncidentID:             incidentID,
		TaskID:                 added.ID,
		Title:                  "Collect ledger and PSP evidence",
		PlannedDurationSeconds: &duration,
		Dependencies:           &deps,
		Actor:                  commander,
	})
	if err != nil {
		t.Fatalf("RescopeTask: %v", err)
	}
	rescoped := tasksByKey(graph.Tasks)["collect-ledger-evidence"]
	if rescoped.Status != TaskStatusPending || rescoped.Title != "Collect ledger and PSP evidence" || rescoped.PlannedDurationSeconds != 120 {
		t.Fatalf("rescoped task = %+v", rescoped)
	}

	graph, err = coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     openBridge.ID,
		To:         TaskStatusComplete,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("complete open-bridge: %v", err)
	}
	if got := tasksByKey(graph.Tasks)["collect-ledger-evidence"].Status; got != TaskStatusRunnable {
		t.Fatalf("rescoped task status = %s, want runnable after dependency completion", got)
	}

	eventTypes := eventTypes(store.events)
	for _, want := range []string{EventTaskAdded, EventTaskReordered, EventTaskAssigned, EventTaskRescoped, EventTaskStatusChanged} {
		if !containsString(eventTypes, want) {
			t.Fatalf("events = %v, missing %s", eventTypes, want)
		}
	}
}

func TestTaskAssignmentStatusTransitions(t *testing.T) {
	ctx := context.Background()
	coordinator, store, tenantID, incidentID, commander := newTaskCoordinatorFixture(t)
	owner := uuid.New()
	graph, err := coordinator.AddTask(ctx, tenantID, AddIncidentTaskInput{
		IncidentID: incidentID,
		TaskKey:    "restart-worker-pool",
		Title:      "Restart worker pool",
		TaskType:   TaskTypeManual,
		OwnerID:    &owner,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("AddTask: %v", err)
	}
	task := tasksByKey(graph.Tasks)["restart-worker-pool"]
	ownerActor := Actor{UserID: owner}

	graph, err = coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     task.ID,
		To:         TaskStatusRunning,
		Actor:      ownerActor,
	})
	if err != nil {
		t.Fatalf("start task: %v", err)
	}
	if got := tasksByKey(graph.Tasks)["restart-worker-pool"].Status; got != TaskStatusRunning {
		t.Fatalf("status = %s, want running", got)
	}

	graph, err = coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     task.ID,
		To:         TaskStatusComplete,
		Actor:      ownerActor,
	})
	if err != nil {
		t.Fatalf("complete task: %v", err)
	}
	completed := tasksByKey(graph.Tasks)["restart-worker-pool"]
	if completed.Status != TaskStatusComplete || completed.ActualDurationSeconds == nil {
		t.Fatalf("completed task = %+v", completed)
	}
	if !historyContains(store.histories, statusPtr(TaskStatusRunnable), TaskStatusRunning) ||
		!historyContains(store.histories, statusPtr(TaskStatusRunning), TaskStatusComplete) {
		t.Fatalf("status transition history = %+v", store.histories)
	}
}

func TestTaskAuthorizationRules(t *testing.T) {
	ctx := context.Background()
	coordinator, _, tenantID, incidentID, commander := newTaskCoordinatorFixture(t)
	owner := uuid.New()
	graph, err := coordinator.AddTask(ctx, tenantID, AddIncidentTaskInput{
		IncidentID: incidentID,
		TaskKey:    "check-processor",
		Title:      "Check processor",
		TaskType:   TaskTypeManual,
		OwnerID:    &owner,
		Actor:      commander,
	})
	if err != nil {
		t.Fatalf("AddTask: %v", err)
	}
	task := tasksByKey(graph.Tasks)["check-processor"]

	stranger := Actor{UserID: uuid.New()}
	if _, err := coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     task.ID,
		To:         TaskStatusComplete,
		Actor:      stranger,
	}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("stranger status change error = %v, want ErrUnauthorized", err)
	}

	if _, err := coordinator.TransitionTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     task.ID,
		To:         TaskStatusComplete,
		Actor:      commander,
	}); err != nil {
		t.Fatalf("commander status change: %v", err)
	}

	scribe := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleScribe}}
	if _, err := coordinator.AddTask(ctx, tenantID, AddIncidentTaskInput{
		IncidentID: incidentID,
		TaskKey:    "unauthorized-add",
		Title:      "Unauthorized add",
		TaskType:   TaskTypeManual,
		Actor:      scribe,
	}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("scribe add task error = %v, want ErrUnauthorized", err)
	}
}

func tasksByKey(tasks []IncidentTask) map[string]IncidentTask {
	out := make(map[string]IncidentTask, len(tasks))
	for _, task := range tasks {
		out[task.TaskKey] = task
	}
	return out
}

func statusPtr(status IncidentTaskStatus) *IncidentTaskStatus {
	return &status
}

func historyContains(histories []IncidentTaskStatusHistory, from *IncidentTaskStatus, to IncidentTaskStatus) bool {
	for _, history := range histories {
		if history.ToStatus != to {
			continue
		}
		if from == nil {
			if history.FromStatus == nil {
				return true
			}
			continue
		}
		if history.FromStatus != nil && *history.FromStatus == *from {
			return true
		}
	}
	return false
}

func eventTypes(events []TimelineEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.EventType)
	}
	return out
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
