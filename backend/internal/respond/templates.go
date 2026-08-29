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

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

type IncidentTaskTemplateScope string

const (
	TaskTemplateScopeGlobal IncidentTaskTemplateScope = "global"
	TaskTemplateScopeTenant IncidentTaskTemplateScope = "tenant"
)

type IncidentTaskTemplate struct {
	ID           uuid.UUID                 `json:"id"`
	TenantID     *uuid.UUID                `json:"tenant_id,omitempty"`
	Scope        IncidentTaskTemplateScope `json:"scope"`
	TemplateKey  string                    `json:"template_key"`
	IncidentType string                    `json:"incident_type"`
	Name         string                    `json:"name"`
	Description  string                    `json:"description"`
	Version      int                       `json:"version"`
	Active       bool                      `json:"active"`
	CreatedAt    time.Time                 `json:"created_at"`
	UpdatedAt    time.Time                 `json:"updated_at"`
}

type IncidentTaskTemplateStep struct {
	ID                     uuid.UUID        `json:"id"`
	TemplateID             uuid.UUID        `json:"template_id"`
	TemplateKey            string           `json:"template_key"`
	StepKey                string           `json:"step_key"`
	Position               int              `json:"position"`
	Title                  string           `json:"title"`
	Description            string           `json:"description"`
	TaskType               IncidentTaskType `json:"task_type"`
	Required               bool             `json:"required"`
	OwnerRole              IncidentRole     `json:"owner_role,omitempty"`
	Team                   string           `json:"team,omitempty"`
	DueOffsetSeconds       int              `json:"due_offset_seconds"`
	PlannedDurationSeconds int              `json:"planned_duration_seconds"`
	AutomationAction       string           `json:"automation_action,omitempty"`
	Params                 map[string]any   `json:"params,omitempty"`
	Predecessors           []string         `json:"predecessors"`
	CreatedAt              time.Time        `json:"created_at"`
}

func (s *Service) ListTaskTemplates(ctx context.Context, tenantID uuid.UUID, actor Actor) ([]IncidentTaskTemplate, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var templates []IncidentTaskTemplate
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		templates, err = s.repo.ListTaskTemplates(ctx, tx, tenantID)
		return err
	})
	return templates, err
}

func validateTemplateSteps(steps []IncidentTaskTemplateStep) error {
	seen := make(map[string]bool, len(steps))
	planTasks := make([]runbookstudio.Task, 0, len(steps))
	for _, step := range steps {
		stepKey := strings.TrimSpace(step.StepKey)
		title := strings.TrimSpace(step.Title)
		if stepKey == "" || title == "" {
			return fmt.Errorf("template step key and title are required: %w", ErrValidation)
		}
		if seen[stepKey] {
			return fmt.Errorf("template step %q is duplicated: %w", stepKey, ErrTaskAlreadyExists)
		}
		seen[stepKey] = true
		taskType := step.TaskType
		if taskType == "" {
			taskType = TaskTypeManual
		}
		if !taskType.Valid() {
			return fmt.Errorf("template step %q: %w", stepKey, ErrTaskInvalidType)
		}
		if step.Position < 0 || step.DueOffsetSeconds < 0 || step.PlannedDurationSeconds < 0 {
			return fmt.Errorf("template step %q has negative scheduling values: %w", stepKey, ErrValidation)
		}
		planTasks = append(planTasks, runbookstudio.Task{
			ID:                     stepKey,
			TaskKey:                stepKey,
			Name:                   title,
			TaskType:               string(taskType),
			Required:               step.Required,
			PlannedDurationSeconds: step.PlannedDurationSeconds,
			Predecessors:           append([]string(nil), step.Predecessors...),
		})
	}
	for _, step := range steps {
		for _, predecessor := range step.Predecessors {
			if !seen[predecessor] {
				return fmt.Errorf("template step %q predecessor %q: %w", step.StepKey, predecessor, ErrTaskDependencyUnknown)
			}
		}
	}
	plan := runbookstudio.Plan{Tasks: planTasks}
	if err := plan.Validate(); err != nil {
		return mapRunbookGraphError(err)
	}
	return nil
}

const taskTemplateColumns = `id, tenant_id, scope, template_key, incident_type, name, description, version, active, created_at, updated_at`

func scanTaskTemplate(row rowScanner) (*IncidentTaskTemplate, error) {
	var template IncidentTaskTemplate
	var scope string
	if err := row.Scan(
		&template.ID, &template.TenantID, &scope, &template.TemplateKey, &template.IncidentType,
		&template.Name, &template.Description, &template.Version, &template.Active,
		&template.CreatedAt, &template.UpdatedAt,
	); err != nil {
		return nil, err
	}
	template.Scope = IncidentTaskTemplateScope(scope)
	return &template, nil
}

func (s *Store) ListTaskTemplates(ctx context.Context, db DBTX, tenantID uuid.UUID) ([]IncidentTaskTemplate, error) {
	rows, err := db.Query(ctx, `SELECT `+taskTemplateColumns+`
FROM respond_task_template
WHERE active = true
  AND (scope = 'global' OR tenant_id = $1)
ORDER BY incident_type ASC, name ASC, version DESC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("respond: list task templates: %w", err)
	}
	defer rows.Close()

	templates := []IncidentTaskTemplate{}
	for rows.Next() {
		template, err := scanTaskTemplate(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan task template: %w", err)
		}
		templates = append(templates, *template)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read task templates: %w", err)
	}
	return templates, nil
}

func (s *Store) GetTaskTemplateByKey(ctx context.Context, db DBTX, tenantID uuid.UUID, templateKey string) (*IncidentTaskTemplate, error) {
	template, err := scanTaskTemplate(db.QueryRow(ctx, `SELECT `+taskTemplateColumns+`
FROM respond_task_template
WHERE template_key = $2
  AND active = true
  AND (scope = 'global' OR tenant_id = $1)
ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END, version DESC
LIMIT 1`, tenantID, strings.TrimSpace(templateKey)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTaskTemplateNotFound
		}
		return nil, fmt.Errorf("respond: get task template %q: %w", templateKey, err)
	}
	return template, nil
}

const taskTemplateStepColumns = `s.id, s.template_id, t.template_key, s.step_key, s.position, s.title,
s.description, s.task_type, s.required, s.owner_role, s.team, s.due_offset_seconds,
s.planned_duration_seconds, s.automation_action, s.params, s.predecessors, s.created_at`

func scanTaskTemplateStep(row rowScanner) (*IncidentTaskTemplateStep, error) {
	var step IncidentTaskTemplateStep
	var taskType, ownerRole string
	var paramsJSON []byte
	if err := row.Scan(
		&step.ID, &step.TemplateID, &step.TemplateKey, &step.StepKey, &step.Position,
		&step.Title, &step.Description, &taskType, &step.Required, &ownerRole, &step.Team,
		&step.DueOffsetSeconds, &step.PlannedDurationSeconds, &step.AutomationAction,
		&paramsJSON, &step.Predecessors, &step.CreatedAt,
	); err != nil {
		return nil, err
	}
	step.TaskType = IncidentTaskType(taskType)
	step.OwnerRole = IncidentRole(ownerRole)
	if step.Predecessors == nil {
		step.Predecessors = []string{}
	}
	if len(paramsJSON) > 0 {
		if err := json.Unmarshal(paramsJSON, &step.Params); err != nil {
			return nil, fmt.Errorf("respond: unmarshal task template step params: %w", err)
		}
	}
	return &step, nil
}

func (s *Store) ListTaskTemplateSteps(ctx context.Context, db DBTX, templateID uuid.UUID) ([]IncidentTaskTemplateStep, error) {
	rows, err := db.Query(ctx, `SELECT `+taskTemplateStepColumns+`
FROM respond_task_template_step s
JOIN respond_task_template t ON t.id = s.template_id
WHERE s.template_id = $1
ORDER BY s.position ASC, s.step_key ASC`, templateID)
	if err != nil {
		return nil, fmt.Errorf("respond: list task template steps: %w", err)
	}
	defer rows.Close()

	steps := []IncidentTaskTemplateStep{}
	for rows.Next() {
		step, err := scanTaskTemplateStep(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, *step)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read task template steps: %w", err)
	}
	sort.SliceStable(steps, func(i, j int) bool {
		if steps[i].Position != steps[j].Position {
			return steps[i].Position < steps[j].Position
		}
		return steps[i].StepKey < steps[j].StepKey
	})
	return steps, nil
}
