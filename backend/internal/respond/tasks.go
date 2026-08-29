package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

var (
	ErrTaskNotFound          = errors.New("respond incident task not found")
	ErrTaskAlreadyExists     = errors.New("respond incident task already exists")
	ErrTaskTemplateNotFound  = errors.New("respond task template not found")
	ErrTaskDependencyCycle   = errors.New("respond task dependencies contain a cycle")
	ErrTaskDependencyUnknown = errors.New("respond task dependency is unknown")
	ErrTaskDependencyBlocked = errors.New("respond task dependencies are incomplete")
	ErrTaskInvalidType       = errors.New("invalid respond task type")
	ErrTaskInvalidStatus     = errors.New("invalid respond task status")
	ErrTaskInvalidTransition = errors.New("respond task status transition is not allowed")
)

type IncidentTaskType string

const (
	TaskTypeManual       IncidentTaskType = runbookstudio.TaskTypeManual
	TaskTypeAutomated    IncidentTaskType = runbookstudio.TaskTypeAutomated
	TaskTypeApprovalGate IncidentTaskType = runbookstudio.TaskTypeApprovalGate
	TaskTypeComms        IncidentTaskType = runbookstudio.TaskTypeComms
	TaskTypeMilestone    IncidentTaskType = runbookstudio.TaskTypeMilestone
)

func (t IncidentTaskType) Valid() bool {
	return runbookstudio.ValidTaskType(string(t))
}

type IncidentTaskStatus string

const (
	TaskStatusPending  IncidentTaskStatus = runbookstudio.TaskRunPending
	TaskStatusRunnable IncidentTaskStatus = runbookstudio.TaskRunRunnable
	TaskStatusRunning  IncidentTaskStatus = runbookstudio.TaskRunRunning
	TaskStatusComplete IncidentTaskStatus = runbookstudio.TaskRunComplete
	TaskStatusSkipped  IncidentTaskStatus = runbookstudio.TaskRunSkipped
	TaskStatusFailed   IncidentTaskStatus = runbookstudio.TaskRunFailed
	TaskStatusBlocked  IncidentTaskStatus = runbookstudio.TaskRunBlocked
)

func (s IncidentTaskStatus) Valid() bool {
	switch s {
	case TaskStatusPending, TaskStatusRunnable, TaskStatusRunning, TaskStatusComplete, TaskStatusSkipped, TaskStatusFailed, TaskStatusBlocked:
		return true
	default:
		return false
	}
}

func taskStatusDone(s IncidentTaskStatus) bool {
	return runbookstudio.TaskRunDone(string(s))
}

func taskStatusTerminal(s IncidentTaskStatus) bool {
	return runbookstudio.TaskRunTerminal(string(s))
}

type IncidentTask struct {
	ID                     uuid.UUID          `json:"id"`
	TenantID               uuid.UUID          `json:"tenant_id"`
	IncidentID             uuid.UUID          `json:"incident_id"`
	TemplateStepID         *uuid.UUID         `json:"template_step_id,omitempty"`
	TaskKey                string             `json:"task_key"`
	Title                  string             `json:"title"`
	Description            string             `json:"description"`
	TaskType               IncidentTaskType   `json:"task_type"`
	Status                 IncidentTaskStatus `json:"status"`
	Required               bool               `json:"required"`
	Position               int                `json:"position"`
	OwnerID                *uuid.UUID         `json:"owner_id,omitempty"`
	OwnerRole              IncidentRole       `json:"owner_role,omitempty"`
	Team                   string             `json:"team"`
	DueAt                  *time.Time         `json:"due_at,omitempty"`
	PlannedDurationSeconds int                `json:"planned_duration_seconds"`
	AutomationAction       string             `json:"automation_action,omitempty"`
	Params                 map[string]any     `json:"params,omitempty"`
	Scope                  map[string]any     `json:"scope,omitempty"`
	Dependencies           []uuid.UUID        `json:"dependencies"`
	StartedAt              *time.Time         `json:"started_at,omitempty"`
	FinishedAt             *time.Time         `json:"finished_at,omitempty"`
	ActualDurationSeconds  *int               `json:"actual_duration_seconds,omitempty"`
	ActedBy                *uuid.UUID         `json:"acted_by,omitempty"`
	CreatedBy              uuid.UUID          `json:"created_by"`
	RowVersion             int                `json:"row_version"`
	CreatedAt              time.Time          `json:"created_at"`
	UpdatedAt              time.Time          `json:"updated_at"`
}

func (t IncidentTask) toRunbookTask() runbookstudio.Task {
	return runbookstudio.Task{
		ID:                     t.ID.String(),
		TenantID:               t.TenantID.String(),
		RunbookID:              t.IncidentID.String(),
		TaskKey:                t.TaskKey,
		Name:                   t.Title,
		TaskType:               string(t.TaskType),
		Required:               t.Required,
		Owner:                  t.ownerReference(),
		Team:                   t.Team,
		Instructions:           t.Description,
		PlannedDurationSeconds: t.PlannedDurationSeconds,
		AutomationAction:       t.AutomationAction,
		Predecessors:           uuidStrings(t.Dependencies),
		Params:                 t.Params,
		CreatedAt:              t.CreatedAt,
		UpdatedAt:              t.UpdatedAt,
	}
}

func (t IncidentTask) ownerReference() string {
	if t.OwnerID != nil && *t.OwnerID != uuid.Nil {
		return t.OwnerID.String()
	}
	if t.OwnerRole != "" {
		return string(t.OwnerRole)
	}
	return ""
}

type IncidentTaskAssignment struct {
	ID           uuid.UUID    `json:"id"`
	TenantID     uuid.UUID    `json:"tenant_id"`
	IncidentID   uuid.UUID    `json:"incident_id"`
	TaskID       uuid.UUID    `json:"task_id"`
	AssigneeID   *uuid.UUID   `json:"assignee_id,omitempty"`
	AssigneeRole IncidentRole `json:"assignee_role,omitempty"`
	Team         string       `json:"team,omitempty"`
	AssignedBy   uuid.UUID    `json:"assigned_by"`
	AssignedAt   time.Time    `json:"assigned_at"`
	Note         string       `json:"note,omitempty"`
}

type IncidentTaskStatusHistory struct {
	ID         uuid.UUID           `json:"id"`
	TenantID   uuid.UUID           `json:"tenant_id"`
	IncidentID uuid.UUID           `json:"incident_id"`
	TaskID     uuid.UUID           `json:"task_id"`
	FromStatus *IncidentTaskStatus `json:"from_status,omitempty"`
	ToStatus   IncidentTaskStatus  `json:"to_status"`
	ChangedBy  uuid.UUID           `json:"changed_by"`
	ChangedAt  time.Time           `json:"changed_at"`
	Note       string              `json:"note,omitempty"`
	Detail     map[string]any      `json:"detail,omitempty"`
}

type IncidentTaskGraph struct {
	IncidentID uuid.UUID            `json:"incident_id"`
	Tasks      []IncidentTask       `json:"tasks"`
	Progress   IncidentTaskProgress `json:"progress"`
}

type IncidentTaskProgress struct {
	Total                      int         `json:"total"`
	Pending                    int         `json:"pending"`
	Runnable                   int         `json:"runnable"`
	Running                    int         `json:"running"`
	Complete                   int         `json:"complete"`
	Skipped                    int         `json:"skipped"`
	Failed                     int         `json:"failed"`
	Blocked                    int         `json:"blocked"`
	RequiredTotal              int         `json:"required_total"`
	RequiredComplete           int         `json:"required_complete"`
	RequiredCompletePercent    float64     `json:"required_complete_percent"`
	PlannedCriticalPathSeconds int         `json:"planned_critical_path_seconds"`
	Frontier                   []uuid.UUID `json:"frontier"`
	BlockedTasks               []uuid.UUID `json:"blocked_tasks"`
}

type taskStore interface {
	GetIncident(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*Incident, error)
	GetTaskTemplateByKey(ctx context.Context, db DBTX, tenantID uuid.UUID, templateKey string) (*IncidentTaskTemplate, error)
	ListTaskTemplateSteps(ctx context.Context, db DBTX, templateID uuid.UUID) ([]IncidentTaskTemplateStep, error)
	ListIncidentTasks(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error)
	ListIncidentTasksForUpdate(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error)
	CreateIncidentTask(ctx context.Context, db DBTX, task *IncidentTask) error
	ReplaceIncidentTaskDependencies(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, dependencies []uuid.UUID) error
	UpdateIncidentTaskPosition(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, position int) (*IncidentTask, error)
	UpdateIncidentTaskAssignment(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, ownerID *uuid.UUID, ownerRole IncidentRole, team string) (*IncidentTask, error)
	UpdateIncidentTaskScope(ctx context.Context, db DBTX, task IncidentTask) (*IncidentTask, error)
	UpdateIncidentTaskStatus(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, status IncidentTaskStatus, actedBy *uuid.UUID, startedAt, finishedAt *time.Time, actualDuration *int) (*IncidentTask, error)
	AppendTaskAssignment(ctx context.Context, db DBTX, assignment *IncidentTaskAssignment) error
	AppendTaskStatusHistory(ctx context.Context, db DBTX, history *IncidentTaskStatusHistory) error
}

type taskTimelineSink interface {
	AppendTimelineEvent(ctx context.Context, db DBTX, ev *TimelineEvent) error
}

type taskCoordinator struct {
	tx       tenantRunner
	store    taskStore
	timeline taskTimelineSink
	feed     *TimelineFeed
	now      func() time.Time
}

func newTaskCoordinator(tx tenantRunner, store taskStore, timeline taskTimelineSink, feed *TimelineFeed, now func() time.Time) *taskCoordinator {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &taskCoordinator{tx: tx, store: store, timeline: timeline, feed: feed, now: now}
}

func (s *Service) taskCoordinator() *taskCoordinator {
	return newTaskCoordinator(s.tx, s.repo, s.repo, s.feed, s.now)
}

type InstantiateTaskTemplateInput struct {
	IncidentID  uuid.UUID
	TemplateKey string
	Actor       Actor
}

type AddIncidentTaskInput struct {
	IncidentID             uuid.UUID
	TaskKey                string
	Title                  string
	Description            string
	TaskType               IncidentTaskType
	Required               *bool
	Position               *int
	OwnerID                *uuid.UUID
	OwnerRole              IncidentRole
	Team                   string
	DueAt                  *time.Time
	PlannedDurationSeconds int
	AutomationAction       string
	Dependencies           []uuid.UUID
	Params                 map[string]any
	Scope                  map[string]any
	Actor                  Actor
}

type ReorderIncidentTaskInput struct {
	IncidentID uuid.UUID
	TaskID     uuid.UUID
	Position   int
	Actor      Actor
}

type AssignIncidentTaskInput struct {
	IncidentID uuid.UUID
	TaskID     uuid.UUID
	OwnerID    *uuid.UUID
	OwnerRole  IncidentRole
	Team       string
	Note       string
	Actor      Actor
}

type RescopeIncidentTaskInput struct {
	IncidentID             uuid.UUID
	TaskID                 uuid.UUID
	Title                  string
	Description            string
	Required               *bool
	DueAt                  *time.Time
	ClearDueAt             bool
	PlannedDurationSeconds *int
	AutomationAction       *string
	Params                 map[string]any
	Scope                  map[string]any
	Dependencies           *[]uuid.UUID
	Actor                  Actor
}

type TransitionIncidentTaskStatusInput struct {
	IncidentID uuid.UUID
	TaskID     uuid.UUID
	To         IncidentTaskStatus
	Note       string
	Actor      Actor
}

type ConvertCommunicationToTaskInput struct {
	IncidentID    uuid.UUID
	SourceEventID *uuid.UUID
	SourceType    string
	Summary       string
	Body          string
	OwnerID       *uuid.UUID
	OwnerRole     IncidentRole
	Team          string
	DueAt         *time.Time
	Actor         Actor
}

const (
	EventTaskTemplateInstantiated = "respond.task.template_instantiated"
	EventTaskAdded                = "respond.task.added"
	EventTaskReordered            = "respond.task.reordered"
	EventTaskAssigned             = "respond.task.assigned"
	EventTaskRescoped             = "respond.task.rescoped"
	EventTaskStatusChanged        = "respond.task.status_changed"
	EventCommunicationTaskCreated = "respond.task.communication_converted"
)

func (s *Service) InstantiateTaskTemplate(ctx context.Context, tenantID uuid.UUID, in InstantiateTaskTemplateInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().InstantiateTemplate(ctx, tenantID, in)
}

func (s *Service) ListIncidentTasks(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().ListTasks(ctx, tenantID, incidentID, actor)
}

func (s *Service) AddIncidentTask(ctx context.Context, tenantID uuid.UUID, in AddIncidentTaskInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().AddTask(ctx, tenantID, in)
}

func (s *Service) ReorderIncidentTask(ctx context.Context, tenantID uuid.UUID, in ReorderIncidentTaskInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().ReorderTask(ctx, tenantID, in)
}

func (s *Service) AssignIncidentTask(ctx context.Context, tenantID uuid.UUID, in AssignIncidentTaskInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().AssignTask(ctx, tenantID, in)
}

func (s *Service) RescopeIncidentTask(ctx context.Context, tenantID uuid.UUID, in RescopeIncidentTaskInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().RescopeTask(ctx, tenantID, in)
}

func (s *Service) TransitionIncidentTaskStatus(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentTaskStatusInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().TransitionTaskStatus(ctx, tenantID, in)
}

func (s *Service) ConvertCommunicationToTask(ctx context.Context, tenantID uuid.UUID, in ConvertCommunicationToTaskInput) (*IncidentTaskGraph, error) {
	return s.taskCoordinator().ConvertCommunicationToTask(ctx, tenantID, in)
}

func (c *taskCoordinator) InstantiateTemplate(ctx context.Context, tenantID uuid.UUID, in InstantiateTaskTemplateInput) (*IncidentTaskGraph, error) {
	if err := requireTaskGraphEditor(in.Actor); err != nil {
		return nil, err
	}
	templateKey := strings.TrimSpace(in.TemplateKey)
	if templateKey == "" {
		return nil, fmt.Errorf("template_key is required: %w", ErrValidation)
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err := c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		template, err := c.store.GetTaskTemplateByKey(ctx, tx, tenantID, templateKey)
		if err != nil {
			return err
		}
		steps, err := c.store.ListTaskTemplateSteps(ctx, tx, template.ID)
		if err != nil {
			return err
		}
		if len(steps) == 0 {
			return fmt.Errorf("template %s has no steps: %w", templateKey, ErrValidation)
		}
		if err := validateTemplateSteps(steps); err != nil {
			return err
		}

		createdByKey := make(map[string]uuid.UUID, len(steps))
		for _, step := range steps {
			task := taskFromTemplateStep(tenantID, in.IncidentID, step, in.Actor.UserID, c.now())
			if err := c.store.CreateIncidentTask(ctx, tx, &task); err != nil {
				return err
			}
			createdByKey[step.StepKey] = task.ID
			if err := c.appendStatusHistory(ctx, tx, tenantID, in.IncidentID, task.ID, nil, task.Status, in.Actor.UserID, "template instantiated", nil); err != nil {
				return err
			}
			if task.OwnerID != nil || task.OwnerRole != "" || task.Team != "" {
				if err := c.appendAssignment(ctx, tx, tenantID, in.IncidentID, task.ID, task.OwnerID, task.OwnerRole, task.Team, in.Actor.UserID, c.now(), "template owner"); err != nil {
					return err
				}
			}
		}
		for _, step := range steps {
			taskID := createdByKey[step.StepKey]
			deps := make([]uuid.UUID, 0, len(step.Predecessors))
			for _, predecessorKey := range step.Predecessors {
				deps = append(deps, createdByKey[predecessorKey])
			}
			if err := c.store.ReplaceIncidentTaskDependencies(ctx, tx, tenantID, in.IncidentID, taskID, deps); err != nil {
				return err
			}
		}

		tasks, err := c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		if err := validateIncidentTaskGraph(in.IncidentID, tasks); err != nil {
			return err
		}
		tasks, err = c.applyDerivedStatuses(ctx, tx, tenantID, in.IncidentID, tasks, in.Actor.UserID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskTemplateInstantiated, map[string]any{
			"template_key": template.TemplateKey,
			"template_id":  template.ID.String(),
			"task_count":   len(steps),
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) ListTasks(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*IncidentTaskGraph, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var tasks []IncidentTask
	err := c.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, incidentID); err != nil {
			return err
		}
		var err error
		tasks, err = c.store.ListIncidentTasks(ctx, tx, tenantID, incidentID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return graphFromTasks(incidentID, tasks), nil
}

func (c *taskCoordinator) AddTask(ctx context.Context, tenantID uuid.UUID, in AddIncidentTaskInput) (*IncidentTaskGraph, error) {
	if err := requireTaskGraphEditor(in.Actor); err != nil {
		return nil, err
	}
	task, err := taskFromAddInput(tenantID, in, c.now())
	if err != nil {
		return nil, err
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err = c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		existing, err := c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		proposed := append(append([]IncidentTask(nil), existing...), task)
		if err := validateIncidentTaskGraph(in.IncidentID, proposed); err != nil {
			return err
		}
		if err := c.store.CreateIncidentTask(ctx, tx, &task); err != nil {
			return err
		}
		if err := c.store.ReplaceIncidentTaskDependencies(ctx, tx, tenantID, in.IncidentID, task.ID, in.Dependencies); err != nil {
			return err
		}
		if err := c.appendStatusHistory(ctx, tx, tenantID, in.IncidentID, task.ID, nil, task.Status, in.Actor.UserID, "task added", nil); err != nil {
			return err
		}
		if task.OwnerID != nil || task.OwnerRole != "" || task.Team != "" {
			if err := c.appendAssignment(ctx, tx, tenantID, in.IncidentID, task.ID, task.OwnerID, task.OwnerRole, task.Team, in.Actor.UserID, c.now(), "task added"); err != nil {
				return err
			}
		}
		tasks, err := c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		tasks, err = c.applyDerivedStatuses(ctx, tx, tenantID, in.IncidentID, tasks, in.Actor.UserID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskAdded, map[string]any{
			"task_id":  task.ID.String(),
			"task_key": task.TaskKey,
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) ReorderTask(ctx context.Context, tenantID uuid.UUID, in ReorderIncidentTaskInput) (*IncidentTaskGraph, error) {
	if err := requireTaskGraphEditor(in.Actor); err != nil {
		return nil, err
	}
	if in.Position < 0 {
		return nil, fmt.Errorf("position must be >= 0: %w", ErrValidation)
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err := c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		task, err := c.store.UpdateIncidentTaskPosition(ctx, tx, tenantID, in.IncidentID, in.TaskID, in.Position)
		if err != nil {
			return err
		}
		tasks, err := c.store.ListIncidentTasks(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskReordered, map[string]any{
			"task_id":  task.ID.String(),
			"position": task.Position,
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) AssignTask(ctx context.Context, tenantID uuid.UUID, in AssignIncidentTaskInput) (*IncidentTaskGraph, error) {
	if err := requireTaskGraphEditor(in.Actor); err != nil {
		return nil, err
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err := c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		task, err := c.store.UpdateIncidentTaskAssignment(ctx, tx, tenantID, in.IncidentID, in.TaskID, in.OwnerID, in.OwnerRole, strings.TrimSpace(in.Team))
		if err != nil {
			return err
		}
		if err := c.appendAssignment(ctx, tx, tenantID, in.IncidentID, in.TaskID, in.OwnerID, in.OwnerRole, task.Team, in.Actor.UserID, c.now(), in.Note); err != nil {
			return err
		}
		tasks, err := c.store.ListIncidentTasks(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskAssigned, map[string]any{
			"task_id":       in.TaskID.String(),
			"assignee_id":   uuidStringPtr(in.OwnerID),
			"assignee_role": string(in.OwnerRole),
			"team":          task.Team,
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) RescopeTask(ctx context.Context, tenantID uuid.UUID, in RescopeIncidentTaskInput) (*IncidentTaskGraph, error) {
	if err := requireTaskGraphEditor(in.Actor); err != nil {
		return nil, err
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err := c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		tasks, err := c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		idx := incidentTaskIndex(tasks, in.TaskID)
		if idx < 0 {
			return ErrTaskNotFound
		}
		task := tasks[idx]
		if strings.TrimSpace(in.Title) != "" {
			task.Title = strings.TrimSpace(in.Title)
		}
		if in.Description != "" {
			task.Description = strings.TrimSpace(in.Description)
		}
		if in.Required != nil {
			task.Required = *in.Required
		}
		if in.ClearDueAt {
			task.DueAt = nil
		} else if in.DueAt != nil {
			task.DueAt = in.DueAt
		}
		if in.PlannedDurationSeconds != nil {
			if *in.PlannedDurationSeconds < 0 {
				return fmt.Errorf("planned_duration_seconds must be >= 0: %w", ErrValidation)
			}
			task.PlannedDurationSeconds = *in.PlannedDurationSeconds
		}
		if in.AutomationAction != nil {
			task.AutomationAction = strings.TrimSpace(*in.AutomationAction)
		}
		if in.Params != nil {
			task.Params = copyMap(in.Params)
		}
		if in.Scope != nil {
			task.Scope = copyMap(in.Scope)
		}
		if in.Dependencies != nil {
			task.Dependencies = append([]uuid.UUID(nil), (*in.Dependencies)...)
		}
		tasks[idx] = task
		if err := validateIncidentTaskGraph(in.IncidentID, tasks); err != nil {
			return err
		}
		updated, err := c.store.UpdateIncidentTaskScope(ctx, tx, task)
		if err != nil {
			return err
		}
		if in.Dependencies != nil {
			if err := c.store.ReplaceIncidentTaskDependencies(ctx, tx, tenantID, in.IncidentID, in.TaskID, task.Dependencies); err != nil {
				return err
			}
		}
		tasks[idx] = *updated
		tasks, err = c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		tasks, err = c.applyDerivedStatuses(ctx, tx, tenantID, in.IncidentID, tasks, in.Actor.UserID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskRescoped, map[string]any{
			"task_id": in.TaskID.String(),
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) TransitionTaskStatus(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentTaskStatusInput) (*IncidentTaskGraph, error) {
	if !in.To.Valid() || in.To == TaskStatusPending || in.To == TaskStatusRunnable || in.To == TaskStatusBlocked {
		return nil, ErrTaskInvalidStatus
	}

	var graph *IncidentTaskGraph
	var event TimelineEvent
	err := c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := c.store.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		tasks, err := c.store.ListIncidentTasksForUpdate(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		idx := incidentTaskIndex(tasks, in.TaskID)
		if idx < 0 {
			return ErrTaskNotFound
		}
		task := tasks[idx]
		if err := requireTaskActor(in.Actor, task); err != nil {
			return err
		}
		if taskStatusTerminal(task.Status) {
			return ErrTaskInvalidTransition
		}
		if task.Status != TaskStatusRunning && !taskOnFrontier(tasks, task.ID) {
			return ErrTaskDependencyBlocked
		}
		if err := validateOperatorStatusTransition(task.Status, in.To); err != nil {
			return err
		}

		now := c.now()
		var startedAt *time.Time
		var finishedAt *time.Time
		var duration *int
		if in.To == TaskStatusRunning && task.StartedAt == nil {
			startedAt = &now
		}
		if taskStatusTerminal(in.To) {
			finishedAt = &now
			if task.StartedAt == nil {
				startedAt = &now
				zero := 0
				duration = &zero
			} else {
				seconds := int(now.Sub(*task.StartedAt).Seconds())
				if seconds < 0 {
					seconds = 0
				}
				duration = &seconds
			}
		}
		from := task.Status
		updated, err := c.store.UpdateIncidentTaskStatus(ctx, tx, tenantID, in.IncidentID, task.ID, in.To, &in.Actor.UserID, startedAt, finishedAt, duration)
		if err != nil {
			return err
		}
		tasks[idx] = *updated
		if err := c.appendStatusHistory(ctx, tx, tenantID, in.IncidentID, task.ID, &from, in.To, in.Actor.UserID, in.Note, nil); err != nil {
			return err
		}
		tasks, err = c.applyDerivedStatuses(ctx, tx, tenantID, in.IncidentID, tasks, in.Actor.UserID)
		if err != nil {
			return err
		}
		graph = graphFromTasks(in.IncidentID, tasks)
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventTaskStatusChanged, map[string]any{
			"task_id": task.ID.String(),
			"from":    string(from),
			"to":      string(in.To),
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func (c *taskCoordinator) ConvertCommunicationToTask(ctx context.Context, tenantID uuid.UUID, in ConvertCommunicationToTaskInput) (*IncidentTaskGraph, error) {
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		return nil, fmt.Errorf("summary is required: %w", ErrValidation)
	}
	params := map[string]any{
		"source_type": strings.TrimSpace(in.SourceType),
		"body":        strings.TrimSpace(in.Body),
	}
	if in.SourceEventID != nil {
		params["source_event_id"] = in.SourceEventID.String()
	}
	key := "communication-" + uuid.NewString()
	graph, err := c.AddTask(ctx, tenantID, AddIncidentTaskInput{
		IncidentID:  in.IncidentID,
		TaskKey:     key,
		Title:       summary,
		Description: strings.TrimSpace(in.Body),
		TaskType:    TaskTypeComms,
		Required:    taskBoolPtr(false),
		OwnerID:     in.OwnerID,
		OwnerRole:   in.OwnerRole,
		Team:        in.Team,
		DueAt:       in.DueAt,
		Params:      params,
		Actor:       in.Actor,
	})
	if err != nil {
		return nil, err
	}
	var event TimelineEvent
	err = c.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		event = c.timelineEvent(tenantID, in.IncidentID, in.Actor.UserID, EventCommunicationTaskCreated, map[string]any{
			"task_key":    key,
			"source_type": params["source_type"],
		})
		return c.timeline.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	c.publish(event)
	return graph, nil
}

func taskFromAddInput(tenantID uuid.UUID, in AddIncidentTaskInput, now time.Time) (IncidentTask, error) {
	taskKey := strings.TrimSpace(in.TaskKey)
	title := strings.TrimSpace(in.Title)
	if taskKey == "" || title == "" {
		return IncidentTask{}, fmt.Errorf("task_key and title are required: %w", ErrValidation)
	}
	taskType := in.TaskType
	if taskType == "" {
		taskType = TaskTypeManual
	}
	if !taskType.Valid() {
		return IncidentTask{}, ErrTaskInvalidType
	}
	if in.PlannedDurationSeconds < 0 {
		return IncidentTask{}, fmt.Errorf("planned_duration_seconds must be >= 0: %w", ErrValidation)
	}
	required := true
	if in.Required != nil {
		required = *in.Required
	}
	position := 0
	if in.Position != nil {
		if *in.Position < 0 {
			return IncidentTask{}, fmt.Errorf("position must be >= 0: %w", ErrValidation)
		}
		position = *in.Position
	}
	return IncidentTask{
		ID:                     uuid.New(),
		TenantID:               tenantID,
		IncidentID:             in.IncidentID,
		TaskKey:                taskKey,
		Title:                  title,
		Description:            strings.TrimSpace(in.Description),
		TaskType:               taskType,
		Status:                 TaskStatusPending,
		Required:               required,
		Position:               position,
		OwnerID:                cloneUUIDPtr(in.OwnerID),
		OwnerRole:              in.OwnerRole,
		Team:                   strings.TrimSpace(in.Team),
		DueAt:                  cloneTimePtr(in.DueAt),
		PlannedDurationSeconds: in.PlannedDurationSeconds,
		AutomationAction:       strings.TrimSpace(in.AutomationAction),
		Dependencies:           append([]uuid.UUID(nil), in.Dependencies...),
		Params:                 copyMap(in.Params),
		Scope:                  copyMap(in.Scope),
		CreatedBy:              in.Actor.UserID,
		CreatedAt:              now,
		UpdatedAt:              now,
	}, nil
}

func taskFromTemplateStep(tenantID, incidentID uuid.UUID, step IncidentTaskTemplateStep, actorID uuid.UUID, now time.Time) IncidentTask {
	required := step.Required
	dueAt := now.Add(time.Duration(step.DueOffsetSeconds) * time.Second)
	return IncidentTask{
		ID:                     uuid.New(),
		TenantID:               tenantID,
		IncidentID:             incidentID,
		TemplateStepID:         &step.ID,
		TaskKey:                step.StepKey,
		Title:                  step.Title,
		Description:            step.Description,
		TaskType:               step.TaskType,
		Status:                 TaskStatusPending,
		Required:               required,
		Position:               step.Position,
		OwnerRole:              step.OwnerRole,
		Team:                   step.Team,
		DueAt:                  &dueAt,
		PlannedDurationSeconds: step.PlannedDurationSeconds,
		AutomationAction:       step.AutomationAction,
		Params:                 copyMap(step.Params),
		Scope: map[string]any{
			"template_key":  step.TemplateKey,
			"template_step": step.StepKey,
		},
		CreatedBy: actorID,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func (c *taskCoordinator) applyDerivedStatuses(ctx context.Context, tx DBTX, tenantID, incidentID uuid.UUID, tasks []IncidentTask, actorID uuid.UUID) ([]IncidentTask, error) {
	derived := recomputeDerivedTaskStatuses(tasks)
	for i := range tasks {
		next := derived[tasks[i].ID]
		if next == "" || next == tasks[i].Status {
			continue
		}
		from := tasks[i].Status
		updated, err := c.store.UpdateIncidentTaskStatus(ctx, tx, tenantID, incidentID, tasks[i].ID, next, nil, nil, nil, nil)
		if err != nil {
			return nil, err
		}
		tasks[i] = *updated
		if err := c.appendStatusHistory(ctx, tx, tenantID, incidentID, tasks[i].ID, &from, next, actorID, "dependency frontier updated", nil); err != nil {
			return nil, err
		}
	}
	sortIncidentTasks(tasks)
	return tasks, nil
}

func (c *taskCoordinator) appendStatusHistory(ctx context.Context, tx DBTX, tenantID, incidentID, taskID uuid.UUID, from *IncidentTaskStatus, to IncidentTaskStatus, actorID uuid.UUID, note string, detail map[string]any) error {
	history := &IncidentTaskStatusHistory{
		TenantID:   tenantID,
		IncidentID: incidentID,
		TaskID:     taskID,
		FromStatus: from,
		ToStatus:   to,
		ChangedBy:  actorID,
		ChangedAt:  c.now(),
		Note:       strings.TrimSpace(note),
		Detail:     copyMap(detail),
	}
	return c.store.AppendTaskStatusHistory(ctx, tx, history)
}

func (c *taskCoordinator) appendAssignment(ctx context.Context, tx DBTX, tenantID, incidentID, taskID uuid.UUID, assigneeID *uuid.UUID, assigneeRole IncidentRole, team string, assignedBy uuid.UUID, assignedAt time.Time, note string) error {
	assignment := &IncidentTaskAssignment{
		TenantID:     tenantID,
		IncidentID:   incidentID,
		TaskID:       taskID,
		AssigneeID:   cloneUUIDPtr(assigneeID),
		AssigneeRole: assigneeRole,
		Team:         strings.TrimSpace(team),
		AssignedBy:   assignedBy,
		AssignedAt:   assignedAt,
		Note:         strings.TrimSpace(note),
	}
	return c.store.AppendTaskAssignment(ctx, tx, assignment)
}

func (c *taskCoordinator) timelineEvent(tenantID, incidentID, actorID uuid.UUID, eventType string, payload map[string]any) TimelineEvent {
	return TimelineEvent{
		TenantID:   tenantID,
		IncidentID: incidentID,
		ActorID:    actorID,
		OccurredAt: c.now(),
		EventType:  eventType,
		Payload:    payload,
	}
}

func (c *taskCoordinator) publish(event TimelineEvent) {
	if c.feed != nil && event.ID != uuid.Nil {
		c.feed.Publish(event)
	}
}

func graphFromTasks(incidentID uuid.UUID, tasks []IncidentTask) *IncidentTaskGraph {
	sortIncidentTasks(tasks)
	return &IncidentTaskGraph{
		IncidentID: incidentID,
		Tasks:      tasks,
		Progress:   taskProgress(tasks),
	}
}

func validateOperatorStatusTransition(from, to IncidentTaskStatus) error {
	if !from.Valid() || !to.Valid() {
		return ErrTaskInvalidStatus
	}
	switch to {
	case TaskStatusRunning:
		if from == TaskStatusRunnable {
			return nil
		}
	case TaskStatusComplete:
		if from == TaskStatusRunnable || from == TaskStatusRunning {
			return nil
		}
	case TaskStatusSkipped, TaskStatusFailed:
		if from == TaskStatusRunnable || from == TaskStatusRunning {
			return nil
		}
	}
	return ErrTaskInvalidTransition
}

func taskOnFrontier(tasks []IncidentTask, taskID uuid.UUID) bool {
	state := runbookstudio.NewRunState(incidentTaskPlan(uuid.Nil, tasks), taskStatusMap(tasks))
	for _, id := range state.Frontier() {
		if id == taskID.String() {
			return true
		}
	}
	return false
}

func requireTaskGraphEditor(actor Actor) error {
	if actor.UserID == uuid.Nil {
		return ErrUnauthorized
	}
	if actorIsCommander(actor) || actor.Can(PermRespondUpdate) {
		return nil
	}
	return ErrUnauthorized
}

func requireTaskActor(actor Actor, task IncidentTask) error {
	if actor.UserID == uuid.Nil {
		return ErrUnauthorized
	}
	if actorIsCommander(actor) || taskAssignedToActor(task, actor) {
		return nil
	}
	return ErrUnauthorized
}

func actorIsCommander(actor Actor) bool {
	if actor.Can(PermRespondAdmin) {
		return true
	}
	for _, role := range actor.IncidentRoles {
		if role == RoleCommander {
			return true
		}
	}
	return false
}

func taskAssignedToActor(task IncidentTask, actor Actor) bool {
	if task.OwnerID != nil && *task.OwnerID == actor.UserID {
		return true
	}
	if task.OwnerRole == "" {
		return false
	}
	for _, role := range actor.IncidentRoles {
		if role == task.OwnerRole {
			return true
		}
	}
	return false
}

func incidentTaskIndex(tasks []IncidentTask, taskID uuid.UUID) int {
	for i, task := range tasks {
		if task.ID == taskID {
			return i
		}
	}
	return -1
}

func sortIncidentTasks(tasks []IncidentTask) {
	sort.SliceStable(tasks, func(i, j int) bool {
		if tasks[i].Position != tasks[j].Position {
			return tasks[i].Position < tasks[j].Position
		}
		if !tasks[i].CreatedAt.Equal(tasks[j].CreatedAt) {
			return tasks[i].CreatedAt.Before(tasks[j].CreatedAt)
		}
		return tasks[i].ID.String() < tasks[j].ID.String()
	})
}

func cloneUUIDPtr(in *uuid.UUID) *uuid.UUID {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func cloneTimePtr(in *time.Time) *time.Time {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func copyMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func uuidStringPtr(id *uuid.UUID) string {
	if id == nil || *id == uuid.Nil {
		return ""
	}
	return id.String()
}

func taskBoolPtr(v bool) *bool {
	return &v
}

const incidentTaskColumns = `id, tenant_id, incident_id, template_step_id, task_key, title, description,
task_type, status, required, position, owner_id, owner_role, team, due_at, planned_duration_seconds,
automation_action, params, scope, started_at, finished_at, actual_duration_seconds, acted_by,
created_by, row_version, created_at, updated_at`

func scanIncidentTask(row rowScanner) (*IncidentTask, error) {
	var task IncidentTask
	var taskType, status, ownerRole string
	var paramsJSON, scopeJSON []byte
	if err := row.Scan(
		&task.ID, &task.TenantID, &task.IncidentID, &task.TemplateStepID, &task.TaskKey,
		&task.Title, &task.Description, &taskType, &status, &task.Required, &task.Position,
		&task.OwnerID, &ownerRole, &task.Team, &task.DueAt, &task.PlannedDurationSeconds,
		&task.AutomationAction, &paramsJSON, &scopeJSON, &task.StartedAt, &task.FinishedAt,
		&task.ActualDurationSeconds, &task.ActedBy, &task.CreatedBy, &task.RowVersion,
		&task.CreatedAt, &task.UpdatedAt,
	); err != nil {
		return nil, err
	}
	task.TaskType = IncidentTaskType(taskType)
	task.Status = IncidentTaskStatus(status)
	task.OwnerRole = IncidentRole(ownerRole)
	task.Dependencies = []uuid.UUID{}
	if len(paramsJSON) > 0 {
		if err := json.Unmarshal(paramsJSON, &task.Params); err != nil {
			return nil, fmt.Errorf("respond: unmarshal task params: %w", err)
		}
	}
	if len(scopeJSON) > 0 {
		if err := json.Unmarshal(scopeJSON, &task.Scope); err != nil {
			return nil, fmt.Errorf("respond: unmarshal task scope: %w", err)
		}
	}
	return &task, nil
}

func (s *Store) CreateIncidentTask(ctx context.Context, db DBTX, task *IncidentTask) error {
	paramsJSON, err := json.Marshal(emptyMap(task.Params))
	if err != nil {
		return fmt.Errorf("respond: marshal task params: %w", err)
	}
	scopeJSON, err := json.Marshal(emptyMap(task.Scope))
	if err != nil {
		return fmt.Errorf("respond: marshal task scope: %w", err)
	}
	if task.ID == uuid.Nil {
		task.ID = uuid.New()
	}
	if task.Status == "" {
		task.Status = TaskStatusPending
	}
	if task.TaskType == "" {
		task.TaskType = TaskTypeManual
	}
	created, err := scanIncidentTask(db.QueryRow(ctx, `
INSERT INTO respond_incident_task (
    id, tenant_id, incident_id, template_step_id, task_key, title, description,
    task_type, status, required, position, owner_id, owner_role, team, due_at,
    planned_duration_seconds, automation_action, params, scope, created_by, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
RETURNING `+incidentTaskColumns,
		task.ID, task.TenantID, task.IncidentID, task.TemplateStepID, task.TaskKey, task.Title,
		task.Description, task.TaskType, task.Status, task.Required, task.Position, task.OwnerID,
		task.OwnerRole, task.Team, task.DueAt, task.PlannedDurationSeconds, task.AutomationAction,
		paramsJSON, scopeJSON, task.CreatedBy, task.CreatedAt,
	))
	if err != nil {
		if respondUniqueViolation(err) {
			return ErrTaskAlreadyExists
		}
		return fmt.Errorf("respond: create incident task %q: %w", task.TaskKey, err)
	}
	*task = *created
	return nil
}

func (s *Store) ListIncidentTasks(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error) {
	return s.listIncidentTasks(ctx, db, tenantID, incidentID, false)
}

func (s *Store) ListIncidentTasksForUpdate(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]IncidentTask, error) {
	return s.listIncidentTasks(ctx, db, tenantID, incidentID, true)
}

func (s *Store) listIncidentTasks(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, forUpdate bool) ([]IncidentTask, error) {
	q := `SELECT ` + incidentTaskColumns + `
FROM respond_incident_task
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY position ASC, created_at ASC, id ASC`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	rows, err := db.Query(ctx, q, tenantID, incidentID)
	if err != nil {
		return nil, fmt.Errorf("respond: list incident tasks: %w", err)
	}
	defer rows.Close()

	tasks := []IncidentTask{}
	for rows.Next() {
		task, err := scanIncidentTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, *task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read incident tasks: %w", err)
	}
	if err := s.loadTaskDependencies(ctx, db, tenantID, incidentID, tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

func (s *Store) loadTaskDependencies(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, tasks []IncidentTask) error {
	if len(tasks) == 0 {
		return nil
	}
	byID := make(map[uuid.UUID]int, len(tasks))
	for i := range tasks {
		tasks[i].Dependencies = []uuid.UUID{}
		byID[tasks[i].ID] = i
	}
	rows, err := db.Query(ctx, `
SELECT task_id, depends_on_task_id
FROM respond_incident_task_dependency
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY task_id, depends_on_task_id`, tenantID, incidentID)
	if err != nil {
		return fmt.Errorf("respond: list task dependencies: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, dependsOn uuid.UUID
		if err := rows.Scan(&taskID, &dependsOn); err != nil {
			return fmt.Errorf("respond: scan task dependency: %w", err)
		}
		if idx, ok := byID[taskID]; ok {
			tasks[idx].Dependencies = append(tasks[idx].Dependencies, dependsOn)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("respond: read task dependencies: %w", err)
	}
	return nil
}

func (s *Store) ReplaceIncidentTaskDependencies(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, dependencies []uuid.UUID) error {
	if _, err := db.Exec(ctx, `
DELETE FROM respond_incident_task_dependency
WHERE tenant_id = $1 AND incident_id = $2 AND task_id = $3`, tenantID, incidentID, taskID); err != nil {
		return fmt.Errorf("respond: clear task dependencies: %w", err)
	}
	for _, dependency := range dependencies {
		if dependency == uuid.Nil {
			return ErrTaskDependencyUnknown
		}
		if _, err := db.Exec(ctx, `
INSERT INTO respond_incident_task_dependency (tenant_id, incident_id, task_id, depends_on_task_id)
VALUES ($1, $2, $3, $4)`, tenantID, incidentID, taskID, dependency); err != nil {
			if respondForeignKeyViolation(err) {
				return ErrTaskDependencyUnknown
			}
			if respondUniqueViolation(err) {
				continue
			}
			return fmt.Errorf("respond: add task dependency: %w", err)
		}
	}
	return nil
}

func (s *Store) UpdateIncidentTaskPosition(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, position int) (*IncidentTask, error) {
	task, err := scanIncidentTask(db.QueryRow(ctx, `
UPDATE respond_incident_task
   SET position = $4, row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND incident_id = $2 AND id = $3
RETURNING `+incidentTaskColumns, tenantID, incidentID, taskID, position))
	if err != nil {
		return nil, mapTaskRowError("update task position", err)
	}
	return task, nil
}

func (s *Store) UpdateIncidentTaskAssignment(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, ownerID *uuid.UUID, ownerRole IncidentRole, team string) (*IncidentTask, error) {
	task, err := scanIncidentTask(db.QueryRow(ctx, `
UPDATE respond_incident_task
   SET owner_id = $4, owner_role = $5, team = $6, row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND incident_id = $2 AND id = $3
RETURNING `+incidentTaskColumns, tenantID, incidentID, taskID, ownerID, ownerRole, team))
	if err != nil {
		return nil, mapTaskRowError("update task assignment", err)
	}
	return task, nil
}

func (s *Store) UpdateIncidentTaskScope(ctx context.Context, db DBTX, task IncidentTask) (*IncidentTask, error) {
	paramsJSON, err := json.Marshal(emptyMap(task.Params))
	if err != nil {
		return nil, fmt.Errorf("respond: marshal task params: %w", err)
	}
	scopeJSON, err := json.Marshal(emptyMap(task.Scope))
	if err != nil {
		return nil, fmt.Errorf("respond: marshal task scope: %w", err)
	}
	updated, err := scanIncidentTask(db.QueryRow(ctx, `
UPDATE respond_incident_task
   SET title = $4,
       description = $5,
       required = $6,
       due_at = $7,
       planned_duration_seconds = $8,
       automation_action = $9,
       params = $10,
       scope = $11,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND incident_id = $2 AND id = $3
RETURNING `+incidentTaskColumns,
		task.TenantID, task.IncidentID, task.ID, task.Title, task.Description, task.Required,
		task.DueAt, task.PlannedDurationSeconds, task.AutomationAction, paramsJSON, scopeJSON,
	))
	if err != nil {
		return nil, mapTaskRowError("update task scope", err)
	}
	return updated, nil
}

func (s *Store) UpdateIncidentTaskStatus(ctx context.Context, db DBTX, tenantID, incidentID, taskID uuid.UUID, status IncidentTaskStatus, actedBy *uuid.UUID, startedAt, finishedAt *time.Time, actualDuration *int) (*IncidentTask, error) {
	task, err := scanIncidentTask(db.QueryRow(ctx, `
UPDATE respond_incident_task
   SET status = $4,
       acted_by = CASE WHEN $5::uuid IS NULL THEN acted_by ELSE $5 END,
       started_at = CASE WHEN $6::timestamptz IS NULL THEN started_at ELSE COALESCE(started_at, $6) END,
       finished_at = CASE WHEN $7::timestamptz IS NULL THEN finished_at ELSE $7 END,
       actual_duration_seconds = CASE WHEN $8::int IS NULL THEN actual_duration_seconds ELSE $8 END,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND incident_id = $2 AND id = $3
RETURNING `+incidentTaskColumns,
		tenantID, incidentID, taskID, status, actedBy, startedAt, finishedAt, actualDuration,
	))
	if err != nil {
		return nil, mapTaskRowError("update task status", err)
	}
	return task, nil
}

func (s *Store) AppendTaskAssignment(ctx context.Context, db DBTX, assignment *IncidentTaskAssignment) error {
	if assignment.AssignedAt.IsZero() {
		assignment.AssignedAt = time.Now().UTC()
	}
	err := db.QueryRow(ctx, `
INSERT INTO respond_incident_task_assignment (
    tenant_id, incident_id, task_id, assignee_id, assignee_role, team, assigned_by, assigned_at, note
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id`,
		assignment.TenantID, assignment.IncidentID, assignment.TaskID, assignment.AssigneeID,
		assignment.AssigneeRole, assignment.Team, assignment.AssignedBy, assignment.AssignedAt,
		assignment.Note,
	).Scan(&assignment.ID)
	if err != nil {
		return fmt.Errorf("respond: append task assignment: %w", err)
	}
	return nil
}

func (s *Store) AppendTaskStatusHistory(ctx context.Context, db DBTX, history *IncidentTaskStatusHistory) error {
	detailJSON, err := json.Marshal(emptyMap(history.Detail))
	if err != nil {
		return fmt.Errorf("respond: marshal task status detail: %w", err)
	}
	if history.ChangedAt.IsZero() {
		history.ChangedAt = time.Now().UTC()
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_incident_task_status_history (
    tenant_id, incident_id, task_id, from_status, to_status, changed_by, changed_at, note, detail
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id`,
		history.TenantID, history.IncidentID, history.TaskID, history.FromStatus,
		history.ToStatus, history.ChangedBy, history.ChangedAt, history.Note, detailJSON,
	).Scan(&history.ID)
	if err != nil {
		return fmt.Errorf("respond: append task status history: %w", err)
	}
	return nil
}

func mapTaskRowError(action string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTaskNotFound
	}
	return fmt.Errorf("respond: %s: %w", action, err)
}

func emptyMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	return in
}

func respondUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func respondForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
