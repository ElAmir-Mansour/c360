package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/forms"
	"github.com/clario360/platform/internal/workflow/model"
)

// FormSubmissionValidator re-validates a submitted form payload against a stored
// form definition (WP-3, "never trust the client"). It is the seam the INTEGRATE
// phase wires to internal/forms via main.go; when unset, CompleteTask keeps using
// only the inline schema check (existing behavior). Returns a non-nil error
// describing the first violation when the submission is invalid.
type FormSubmissionValidator interface {
	ValidateSubmission(ctx context.Context, tenantID, formID string, formVersion int, locale string, data map[string]interface{}) error
}

// TaskService manages human task operations including listing, claiming,
// completing, delegating, and rejecting tasks.
type TaskService struct {
	taskRepo      taskRepo
	engine        *EngineService
	formValidator FormSubmissionValidator
	logger        zerolog.Logger

	// auditPublisher is the OPTIONAL emitter for task-lifecycle audit events
	// (claim/complete/reject/delegate). GAP B: these transitions previously only
	// LOGGED, producing no immutable audit entry. When wired (the workflow-engine
	// injects the same producer the engine uses), each transition emits an event
	// to platform.workflow.events, where the platform hash-chain audit subsystem
	// records it as a tamper-evident entry — no new audit system is introduced.
	// nil == unchanged legacy behaviour (log only), so every existing caller/test
	// compiles and behaves identically.
	auditPublisher eventPublisher
	now            func() time.Time
}

// NewTaskService creates a new TaskService. The form validator is optional and
// installed separately via SetFormValidator so this constructor's signature (and
// its callers/tests) stays unchanged.
func NewTaskService(taskRepo taskRepo, engine *EngineService, logger zerolog.Logger) *TaskService {
	return &TaskService{
		taskRepo: taskRepo,
		engine:   engine,
		now:      time.Now,
		logger:   logger.With().Str("service", "workflow-task").Logger(),
	}
}

// SetFormValidator installs the optional by-ref form submission validator (WP-3).
func (s *TaskService) SetFormValidator(v FormSubmissionValidator) {
	s.formValidator = v
}

// WithAuditPublisher wires the OPTIONAL task-lifecycle audit emitter (GAP B) and
// returns the receiver for chaining. A nil publisher is a no-op (log-only legacy
// behaviour). It is separate from NewTaskService so existing callers/tests are
// unchanged.
func (s *TaskService) WithAuditPublisher(p eventPublisher) *TaskService {
	s.auditPublisher = p
	return s
}

// emitAudit publishes a task-lifecycle audit event when a publisher is wired.
// Best-effort: an emit failure is logged but never fails the operation (the state
// transition already committed; the audit trail is downstream of it).
func (s *TaskService) emitAudit(ctx context.Context, eventType, tenantID string, data map[string]interface{}) {
	if s.auditPublisher == nil {
		return
	}
	evt, err := events.NewEvent(eventType, "workflow-engine", tenantID, data)
	if err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to build task audit event")
		return
	}
	if err := s.auditPublisher.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to publish task audit event")
	}
}

// ListTasks returns a paginated list of tasks visible to the specified user,
// filtered by role assignments and optional status filter.
func (s *TaskService) ListTasks(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, page, pageSize int) ([]*model.HumanTask, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	limit := pageSize
	offset := (page - 1) * pageSize

	tasks, total, err := s.taskRepo.ListForUser(ctx, tenantID, userID, roles, statuses, sortBy, sortOrder, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tasks: %w", err)
	}
	return tasks, total, nil
}

// GetTask retrieves a single human task by ID.
func (s *TaskService) GetTask(ctx context.Context, tenantID, taskID string) (*model.HumanTask, error) {
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return nil, fmt.Errorf("getting task: %w", err)
	}
	return task, nil
}

// ClaimTask assigns a task to the requesting user. The task must be in pending
// status and the user must be eligible: either it is assigned to them, or it is
// role/candidate-claimable and they hold a matching role / are a named candidate
// user. roles carries the caller's roles (== groups) so a candidate-group /
// work-queue (pool) task can be claimed by any member of its groups. Passing an
// empty roles slice preserves the legacy single-assignee behaviour.
//
// The atomic single-winner guarantee lives in the repository's FOR UPDATE SKIP
// LOCKED claim; this method authorises WHO may attempt the claim before racing
// for it, so an ineligible user is rejected up front rather than by the lock.
func (s *TaskService) ClaimTask(ctx context.Context, tenantID, taskID, userID string, roles ...string) error {
	// Load the task to validate assignment rules.
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("loading task for claim: %w", err)
	}

	// Task must be claimable (pending status).
	if !task.IsClaimable() {
		return fmt.Errorf("task %s is not in a claimable state (status: %s)", taskID, task.Status)
	}

	// If the task is assigned to a specific user, only that user can claim it.
	if task.AssigneeID != nil && *task.AssigneeID != "" {
		if *task.AssigneeID != userID {
			return fmt.Errorf("task %s is assigned to a specific user and cannot be claimed by %s", taskID, userID)
		}
	} else if task.IsGroupTask() {
		// A candidate-group / work-queue task with no specific assignee may only be
		// claimed by a member of its candidate groups or a named candidate user.
		if !task.UserIsCandidate(userID, roles) {
			return fmt.Errorf("task %s is a group task and user %s is not a candidate", taskID, userID)
		}
	}

	if err := s.taskRepo.ClaimTask(ctx, tenantID, taskID, userID); err != nil {
		return fmt.Errorf("claiming task: %w", err)
	}

	s.logger.Info().
		Str("task_id", taskID).
		Str("claimed_by", userID).
		Str("tenant_id", tenantID).
		Msg("task claimed")

	s.emitAudit(ctx, "workflow.task.claimed", tenantID, map[string]interface{}{
		"task_id":     taskID,
		"instance_id": task.InstanceID,
		"step_id":     task.StepID,
		"claimed_by":  userID,
	})

	return nil
}

// UnclaimTask returns a task the user currently owns back to its shared pool so
// any candidate can claim it again (the inverse of claim-from-pool). Only the
// current claimant may unclaim, and only a POOL task (candidate groups/users)
// can be released — a legacy single-assignee task has no pool to return to. The
// repository enforces both guards atomically.
func (s *TaskService) UnclaimTask(ctx context.Context, tenantID, taskID, userID string) error {
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("loading task for unclaim: %w", err)
	}

	if task.Status != model.TaskStatusClaimed {
		return fmt.Errorf("only a claimed task can be unclaimed, current status: %s", task.Status)
	}
	if task.ClaimedBy == nil || *task.ClaimedBy != userID {
		return fmt.Errorf("task %s is not claimed by user %s", taskID, userID)
	}
	if !task.IsGroupTask() {
		return fmt.Errorf("task %s has no candidate pool to return to (not a group task)", taskID)
	}

	if err := s.taskRepo.UnclaimTask(ctx, tenantID, taskID, userID); err != nil {
		return fmt.Errorf("unclaiming task: %w", err)
	}

	s.logger.Info().
		Str("task_id", taskID).
		Str("unclaimed_by", userID).
		Str("tenant_id", tenantID).
		Msg("task returned to pool")

	s.emitAudit(ctx, "workflow.task.unclaimed", tenantID, map[string]interface{}{
		"task_id":      taskID,
		"instance_id":  task.InstanceID,
		"step_id":      task.StepID,
		"unclaimed_by": userID,
	})

	return nil
}

// ListMyQueues returns the paginated group-inbox: the UNCLAIMED pool tasks the
// user is eligible to claim from their candidate groups / as a named candidate
// user (never their already-owned work). Empty roles yields only candidate-user
// pool tasks.
func (s *TaskService) ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, page, pageSize int) ([]*model.HumanTask, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	limit := pageSize
	offset := (page - 1) * pageSize

	tasks, total, err := s.taskRepo.ListMyQueues(ctx, tenantID, userID, roles, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing my queues: %w", err)
	}
	return tasks, total, nil
}

// CompleteTask marks a task as completed with the provided form data and
// resumes the workflow from the task's step.
func (s *TaskService) CompleteTask(ctx context.Context, tenantID, taskID, userID string, formData map[string]interface{}, lateJustification *string) error {
	// 1. Load and validate the task.
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("loading task for completion: %w", err)
	}

	// Task must be completable (claimed status).
	if !task.IsCompletable() {
		return fmt.Errorf("task %s is not in a completable state (status: %s)", taskID, task.Status)
	}

	// Verify the claiming user is the one completing it.
	if task.ClaimedBy == nil || *task.ClaimedBy != userID {
		return fmt.Errorf("task %s is not claimed by user %s", taskID, userID)
	}

	// 2. Validate form data against form schema (inline shape check) and, when
	// the task was created from a by-ref form definition, re-validate the full
	// submission against the canonical forms definition (WP-3).
	if err := s.validateFormData(task.FormSchema, formData); err != nil {
		return fmt.Errorf("form validation failed: %w", err)
	}
	// Drop values for fields hidden by their visible_when condition so a hidden
	// field's value is neither persisted nor passed downstream to the engine.
	formData, err = forms.PruneHiddenValues(task.FormSchema, formData)
	if err != nil {
		return fmt.Errorf("form validation failed: %w", err)
	}
	if err := s.revalidateReferencedForm(ctx, task, formData); err != nil {
		return fmt.Errorf("form validation failed: %w", err)
	}

	// 3. A materialised deadline is authoritative even if the asynchronous SLA
	// monitor has not flipped sla_breached yet. Late terminal actions must carry a
	// private explanation in the same transaction.
	now := s.now().UTC()
	justification, managerRole, err := validateTaskLateJustification(task, lateJustification, now)
	if err != nil {
		return err
	}

	// 4. Complete the task in the repository.
	// Derive the classified form-field names from the task's own schema so the
	// repository encrypts exactly those submitted values at rest (when a codec is
	// wired). Empty for an unclassified form — the exact plaintext path.
	classified := model.SensitiveFormFieldKeys(task.FormSchema)
	if justification != "" {
		writer, ok := s.taskRepo.(interface {
			CompleteTaskWithLateJustification(context.Context, string, string, map[string]interface{}, map[string]bool, string, string, string, time.Time) error
		})
		if !ok {
			return fmt.Errorf("late-justification persistence is not configured")
		}
		err = writer.CompleteTaskWithLateJustification(ctx, tenantID, taskID, formData, classified, justification, userID, managerRole, now)
	} else {
		err = s.taskRepo.CompleteTask(ctx, tenantID, taskID, formData, classified)
	}
	if err != nil {
		return fmt.Errorf("completing task: %w", err)
	}

	s.logger.Info().
		Str("task_id", taskID).
		Str("completed_by", userID).
		Str("tenant_id", tenantID).
		Str("instance_id", task.InstanceID).
		Msg("task completed")

	s.emitAudit(ctx, "workflow.task.completed", tenantID, map[string]interface{}{
		"task_id":                         taskID,
		"instance_id":                     task.InstanceID,
		"step_id":                         task.StepID,
		"completed_by":                    userID,
		"late_justification_recorded":     justification != "",
		"late_justification_manager_role": managerRole,
	})

	// 4. Resume the workflow engine.
	// Reload the task to get the updated form_data.
	task.FormData = formData
	task.Status = model.TaskStatusCompleted

	if err := s.engine.ResumeFromTask(ctx, task); err != nil {
		s.logger.Error().Err(err).
			Str("task_id", taskID).
			Str("instance_id", task.InstanceID).
			Msg("failed to resume workflow from task")
		return fmt.Errorf("resuming workflow from task: %w", err)
	}

	return nil
}

// DelegateTask transfers a task from one user to another.
func (s *TaskService) DelegateTask(ctx context.Context, tenantID, taskID, fromUserID, toUserID, reason string) error {
	// Validate the task exists and the delegating user owns it.
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("loading task for delegation: %w", err)
	}

	// Task must be in pending or claimed status to delegate.
	if task.Status != model.TaskStatusPending && task.Status != model.TaskStatusClaimed {
		return fmt.Errorf("task %s cannot be delegated in status: %s", taskID, task.Status)
	}

	// If claimed, only the claiming user can delegate.
	if task.Status == model.TaskStatusClaimed {
		if task.ClaimedBy == nil || *task.ClaimedBy != fromUserID {
			return fmt.Errorf("task %s is claimed by another user and cannot be delegated by %s", taskID, fromUserID)
		}
	}
	if task.Status == model.TaskStatusPending {
		if task.AssigneeID == nil || *task.AssigneeID == "" {
			return fmt.Errorf("task %s must be claimed before a role-assigned pending task can be delegated", taskID)
		}
		if *task.AssigneeID != fromUserID {
			return fmt.Errorf("task %s is assigned to another user and cannot be delegated by %s", taskID, fromUserID)
		}
	}

	if fromUserID == toUserID {
		return fmt.Errorf("cannot delegate task to the same user")
	}

	if err := s.taskRepo.DelegateTask(ctx, tenantID, taskID, fromUserID, toUserID, reason); err != nil {
		return fmt.Errorf("delegating task: %w", err)
	}

	s.logger.Info().
		Str("task_id", taskID).
		Str("from_user", fromUserID).
		Str("to_user", toUserID).
		Str("tenant_id", tenantID).
		Msg("task delegated")

	s.emitAudit(ctx, "workflow.task.delegated", tenantID, map[string]interface{}{
		"task_id":     taskID,
		"instance_id": task.InstanceID,
		"step_id":     task.StepID,
		"from_user":   fromUserID,
		"to_user":     toUserID,
		"reason":      reason,
	})

	return nil
}

// RejectTask rejects a task with a reason. The task must be claimed by the rejecting user.
func (s *TaskService) RejectTask(ctx context.Context, tenantID, taskID, userID, reason string, lateJustification *string) error {
	task, err := s.taskRepo.GetByID(ctx, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("loading task for rejection: %w", err)
	}

	if task.Status != model.TaskStatusClaimed {
		return fmt.Errorf("only claimed tasks can be rejected, current status: %s", task.Status)
	}

	if task.ClaimedBy == nil || *task.ClaimedBy != userID {
		return fmt.Errorf("task %s is not claimed by user %s", taskID, userID)
	}

	if reason == "" {
		return fmt.Errorf("rejection reason is required")
	}

	now := s.now().UTC()
	justification, managerRole, err := validateTaskLateJustification(task, lateJustification, now)
	if err != nil {
		return err
	}
	if justification != "" {
		writer, ok := s.taskRepo.(interface {
			RejectTaskWithLateJustification(context.Context, string, string, string, string, string, string, time.Time) error
		})
		if !ok {
			return fmt.Errorf("late-justification persistence is not configured")
		}
		err = writer.RejectTaskWithLateJustification(ctx, tenantID, taskID, userID, reason, justification, managerRole, now)
	} else {
		err = s.taskRepo.RejectTask(ctx, tenantID, taskID, userID, reason)
	}
	if err != nil {
		return fmt.Errorf("rejecting task: %w", err)
	}

	s.logger.Info().
		Str("task_id", taskID).
		Str("rejected_by", userID).
		Str("reason", reason).
		Str("tenant_id", tenantID).
		Msg("task rejected")

	s.emitAudit(ctx, "workflow.task.rejected", tenantID, map[string]interface{}{
		"task_id":                         taskID,
		"instance_id":                     task.InstanceID,
		"step_id":                         task.StepID,
		"rejected_by":                     userID,
		"reason":                          reason,
		"late_justification_recorded":     justification != "",
		"late_justification_manager_role": managerRole,
	})

	return nil
}

func validateTaskLateJustification(task *model.HumanTask, raw *string, now time.Time) (string, string, error) {
	justification := ""
	if raw != nil {
		justification = strings.TrimSpace(*raw)
	}
	late := task != nil && task.SLADeadline != nil && now.After(task.SLADeadline.UTC())
	if late && justification == "" {
		return "", "", fmt.Errorf("late justification is required because the task ended after its SLA deadline")
	}
	if !late {
		return "", "", nil
	}
	return justification, taskLateJustificationManagerRole(task), nil
}

func taskLateJustificationManagerRole(task *model.HumanTask) string {
	values := []string{}
	if task != nil {
		for _, key := range []string{"subject_type", "service_code", "request_type", "entity_type"} {
			if value, ok := task.Metadata[key].(string); ok {
				values = append(values, strings.ToLower(strings.TrimSpace(value)))
			}
		}
		if task.AssigneeRole != nil {
			values = append(values, strings.ToLower(strings.TrimSpace(*task.AssigneeRole)))
		}
	}
	joined := strings.Join(values, " ")
	switch {
	case strings.Contains(joined, "contract"), strings.Contains(joined, "consultation"), strings.Contains(joined, "legal_opinion"), strings.Contains(joined, "playbook"), strings.Contains(joined, "clause"):
		return "legal-contracts-manager"
	case strings.Contains(joined, "case"), strings.Contains(joined, "litigation"), strings.Contains(joined, "investigation"), strings.Contains(joined, "settlement"), strings.Contains(joined, "enforcement"), strings.Contains(joined, "violation"), strings.Contains(joined, "field_inspection"):
		return "legal-cases-manager"
	case strings.Contains(joined, "legal-dept-manager"):
		return "legal-dept-manager"
	default:
		return "legal-shared-services-manager"
	}
}

// UpdateMetadata persists updated metadata for a task.
func (s *TaskService) UpdateMetadata(ctx context.Context, tenantID, taskID string, metadata map[string]interface{}) error {
	if err := s.taskRepo.UpdateMetadata(ctx, tenantID, taskID, metadata); err != nil {
		return fmt.Errorf("updating task metadata: %w", err)
	}
	return nil
}

// CountTasks returns task counts bucketed by status for the user's dashboard.
func (s *TaskService) CountTasks(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error) {
	counts, err := s.taskRepo.CountByStatus(ctx, tenantID, userID, roles)
	if err != nil {
		return nil, fmt.Errorf("counting tasks by status: %w", err)
	}
	return counts, nil
}

// DailyCreatedCounts returns tenant-wide creation volume for analytics. It must
// not be presented as history for the current user's pending-task count.
func (s *TaskService) DailyCreatedCounts(ctx context.Context, tenantID string, days int) ([]int, error) {
	return s.taskRepo.DailyCreatedCounts(ctx, tenantID, days)
}

// revalidateReferencedForm re-validates the submission against the canonical form
// definition the task was created from, when (a) a form validator is installed
// and (b) the task metadata carries a form_id stamped by the by-ref human-task
// path (WP-3). For inline-schema tasks (no form ref) it is a no-op, preserving
// the existing completion behavior.
func (s *TaskService) revalidateReferencedForm(ctx context.Context, task *model.HumanTask, formData map[string]interface{}) error {
	if s.formValidator == nil || task.Metadata == nil {
		return nil
	}
	formID, _ := task.Metadata["form_id"].(string)
	if formID == "" {
		return nil
	}
	version := metadataInt(task.Metadata["form_version"])
	locale, _ := task.Metadata["form_locale"].(string)
	return s.formValidator.ValidateSubmission(ctx, task.TenantID, formID, version, locale, formData)
}

// metadataInt coerces a JSON-decoded metadata value (which may arrive as
// float64, json.Number, int, or int64) into an int. Unknown shapes yield 0,
// which the validator treats as "resolve the latest version".
func metadataInt(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}

// validateFormData validates the submitted form data against the task's form schema.
// It checks that all required fields are present and that field types match.
func (s *TaskService) validateFormData(schema []model.FormField, formData map[string]interface{}) error {
	if len(schema) == 0 {
		return nil
	}

	for _, field := range schema {
		// A field hidden by its visible_when condition is excluded from both
		// required validation and type/option validation: its value (if any) is
		// pruned before persistence. Visibility is evaluated against the raw
		// submitted values. A malformed expression is a validation error.
		visible, err := forms.FormFieldVisible(field, formData)
		if err != nil {
			return err
		}
		if !visible {
			continue
		}

		val, exists := formData[field.Name]

		// Check required fields.
		if field.Required && (!exists || val == nil) {
			return fmt.Errorf("required field '%s' is missing", field.Name)
		}

		if !exists || val == nil {
			continue
		}

		// Validate field types.
		if err := validateFieldType(field.Name, field.Type, val); err != nil {
			return err
		}

		// Validate select options if applicable.
		if field.Type == "select" && len(field.Options) > 0 {
			strVal, ok := val.(string)
			if ok {
				valid := false
				for _, opt := range field.Options {
					if opt == strVal {
						valid = true
						break
					}
				}
				if !valid {
					return fmt.Errorf("field '%s' value '%s' is not a valid option", field.Name, strVal)
				}
			}
		}
	}

	return nil
}

// validateFieldType checks that a form field value matches its declared type.
func validateFieldType(fieldName, fieldType string, value interface{}) error {
	switch fieldType {
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("field '%s' must be a boolean", fieldName)
		}
	case "text", "textarea", "date":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("field '%s' must be a string", fieldName)
		}
	case "select":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("field '%s' must be a string", fieldName)
		}
	case "number":
		switch value.(type) {
		case float64, int, int64, float32:
			// Valid number types.
		default:
			return fmt.Errorf("field '%s' must be a number", fieldName)
		}
	}
	return nil
}
