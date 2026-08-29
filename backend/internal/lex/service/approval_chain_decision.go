package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

type workflowDecisionPlan struct {
	nextContractStatus model.ContractStatus
	workflowStatus     string
	stepStatus         string
	currentStepID      *string
	errorMessage       *string
	cancelPendingTasks bool
	nextTask           *workflowmodel.HumanTask
}

func (s *WorkflowService) planApprovalChainDecision(ctx context.Context, tx pgx.Tx, tenantID, userID, taskID uuid.UUID, target workflowDecisionTarget, req dto.WorkflowDecisionRequest, plan workflowDecisionPlan, now time.Time) (workflowDecisionPlan, error) {
	if !boolFromAny(target.taskMetadata["approval_chain"]) {
		return plan, nil
	}
	if req.Decision == "request_changes" {
		plan.cancelPendingTasks = true
		return plan, nil
	}
	rawConfig := mapFromAny(target.taskMetadata["approval_chain_config"])
	if rawConfig == nil {
		return plan, internalError("approval chain config missing from workflow task", fmt.Errorf("workflow task %s missing approval_chain_config", taskID))
	}
	cfg, err := workflowexec.ParseApprovalConfig(rawConfig)
	if err != nil {
		return plan, internalError("parse approval chain config", err)
	}
	decisions, existingIndexes, err := s.loadApprovalChainDecisions(ctx, tx, tenantID, target, taskID, userID, req.Decision, now, cfg)
	if err != nil {
		return plan, err
	}
	switch workflowexec.ResolveApproval(cfg, decisions) {
	case workflowexec.ResolutionAdvance:
		plan.nextContractStatus = model.ContractStatusPendingSignature
		plan.workflowStatus = workflowmodel.InstanceStatusCompleted
		plan.stepStatus = workflowmodel.StepStatusCompleted
		plan.currentStepID = ptrString("end")
		plan.errorMessage = nil
		plan.cancelPendingTasks = true
	case workflowexec.ResolutionReject:
		plan.workflowStatus = workflowmodel.InstanceStatusFailed
		plan.stepStatus = workflowmodel.StepStatusFailed
		plan.currentStepID = &target.stepID
		msg := "contract approval quorum rejected"
		plan.errorMessage = &msg
		plan.cancelPendingTasks = true
		if target.contractStatus != model.ContractStatusDraft {
			if err := ValidateContractTransition(string(target.contractStatus), string(model.ContractStatusDraft)); err != nil {
				return plan, conflictError("contract status does not allow approval rejection")
			}
			plan.nextContractStatus = model.ContractStatusDraft
		}
	default:
		plan.nextContractStatus = target.contractStatus
		plan.workflowStatus = workflowmodel.InstanceStatusRunning
		plan.stepStatus = workflowmodel.StepStatusPending
		plan.currentStepID = &target.stepID
		plan.errorMessage = nil
		if next, index, ok := workflowexec.NextSequentialApprover(cfg, decisions); ok && !existingIndexes[index] {
			plan.nextTask = s.buildSequentialApprovalTask(tenantID, target, cfg, next, index, now)
		}
	}
	return plan, nil
}

func (s *WorkflowService) loadApprovalChainDecisions(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, target workflowDecisionTarget, selectedTaskID, userID uuid.UUID, selectedDecision string, decidedAt time.Time, cfg workflowexec.ApprovalConfig) ([]workflowexec.ApproverDecision, map[int]bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, status, form_data, metadata
		FROM workflow_tasks
		WHERE tenant_id = $1 AND instance_id = $2 AND step_id = $3
		ORDER BY created_at ASC`,
		tenantID, target.workflowInstanceID, target.stepID,
	)
	if err != nil {
		return nil, nil, internalError("load approval chain decisions", err)
	}
	defer rows.Close()

	decisions := make([]workflowexec.ApproverDecision, 0)
	existingIndexes := map[int]bool{}
	for rows.Next() {
		var rawTaskID string
		var status string
		var formDataJSON []byte
		var metadataJSON []byte
		if err := rows.Scan(&rawTaskID, &status, &formDataJSON, &metadataJSON); err != nil {
			return nil, nil, internalError("scan approval chain decisions", err)
		}
		metadata := map[string]any{}
		if len(metadataJSON) > 0 {
			if err := json.Unmarshal(metadataJSON, &metadata); err != nil {
				return nil, nil, internalError("decode approval chain task metadata", err)
			}
		}
		index := intFromAnyDefault(metadata["approver_index"], len(decisions))
		existingIndexes[index] = true
		approver := approvalChainApproverFromMetadata(metadata, cfg, index)
		decision := ""
		decidedBy := ""
		var when time.Time
		if parsedTaskID, err := uuid.Parse(rawTaskID); err == nil && parsedTaskID == selectedTaskID {
			decision = approvalChainDecisionVerb(selectedDecision)
			decidedBy = userID.String()
			when = decidedAt
		} else if status == workflowmodel.TaskStatusCompleted || status == workflowmodel.TaskStatusRejected {
			formData := map[string]any{}
			if len(formDataJSON) > 0 {
				if err := json.Unmarshal(formDataJSON, &formData); err != nil {
					return nil, nil, internalError("decode approval chain form data", err)
				}
			}
			decision = approvalChainDecisionVerb(stringFromAny(formData["decision"]))
			decidedBy = stringFromAny(formData["decided_by"])
		}
		decisions = append(decisions, workflowexec.ApproverDecision{
			Approver:  approver,
			Decision:  decision,
			DecidedBy: decidedBy,
			DecidedAt: when,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, internalError("iterate approval chain decisions", err)
	}
	return decisions, existingIndexes, nil
}

func (s *WorkflowService) buildSequentialApprovalTask(tenantID uuid.UUID, target workflowDecisionTarget, cfg workflowexec.ApprovalConfig, approver workflowexec.Approver, index int, now time.Time) *workflowmodel.HumanTask {
	metadata := cloneAnyMap(target.taskMetadata)
	metadata["approval_chain"] = true
	metadata["approval_mode"] = cfg.Mode
	metadata["approval_quorum"] = cfg.Quorum
	if cfg.Quorum == workflowexec.QuorumNofM {
		metadata["approval_quorum_n"] = cfg.QuorumN
	}
	metadata["approver_index"] = index
	metadata["approver_total"] = len(cfg.Approvers)
	metadata["approver_type"] = approver.Type
	metadata["approver_ref"] = approver.Ref

	task := &workflowmodel.HumanTask{
		TenantID:    tenantID.String(),
		InstanceID:  target.workflowInstanceID.String(),
		StepID:      target.stepID,
		StepExecID:  target.stepExecID.String(),
		Name:        "Review contract",
		Description: "Sequential contract approval",
		Status:      workflowmodel.TaskStatusPending,
		FormSchema:  target.formSchema,
		SLADeadline: target.slaDeadline,
		Metadata:    metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if approver.IsUser() {
		assignee := approver.Ref
		task.AssigneeID = &assignee
	} else {
		role := approver.Ref
		task.AssigneeRole = &role
	}
	return task
}

func cancelPendingApprovalTasks(ctx context.Context, tx pgx.Tx, tenantID, workflowInstanceID uuid.UUID, stepID string, decidedTaskID uuid.UUID, cancelledAt time.Time) error {
	_, err := tx.Exec(ctx, `
		UPDATE workflow_tasks
		SET status = 'cancelled',
		    completed_at = $5,
		    updated_at = now(),
		    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancelled_by_quorum_resolution', true)
		WHERE tenant_id = $1
		  AND instance_id = $2
		  AND step_id = $3
		  AND id <> $4
		  AND status IN ('pending','claimed','escalated')`,
		tenantID, workflowInstanceID, stepID, decidedTaskID, cancelledAt,
	)
	if err != nil {
		return internalError("cancel unresolved approval tasks", err)
	}
	return nil
}

func insertWorkflowTask(ctx context.Context, tx pgx.Tx, task *workflowmodel.HumanTask) error {
	formSchemaJSON, err := json.Marshal(task.FormSchema)
	if err != nil {
		return fmt.Errorf("marshal workflow task form schema: %w", err)
	}
	var formDataJSON []byte
	if task.FormData != nil {
		formDataJSON, err = json.Marshal(task.FormData)
		if err != nil {
			return fmt.Errorf("marshal workflow task form data: %w", err)
		}
	}
	metadataJSON, err := json.Marshal(task.Metadata)
	if err != nil {
		return fmt.Errorf("marshal workflow task metadata: %w", err)
	}
	return tx.QueryRow(ctx, `
		INSERT INTO workflow_tasks (
			tenant_id, instance_id, step_id, step_exec_id,
			name, description, status,
			assignee_id, assignee_role,
			form_schema, form_data,
			sla_deadline, priority, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id, created_at, updated_at`,
		task.TenantID,
		task.InstanceID,
		task.StepID,
		task.StepExecID,
		task.Name,
		task.Description,
		task.Status,
		task.AssigneeID,
		task.AssigneeRole,
		formSchemaJSON,
		formDataJSON,
		task.SLADeadline,
		task.Priority,
		metadataJSON,
	).Scan(&task.ID, &task.CreatedAt, &task.UpdatedAt)
}

func approvalChainApproverFromMetadata(metadata map[string]any, cfg workflowexec.ApprovalConfig, index int) workflowexec.Approver {
	if index >= 0 && index < len(cfg.Approvers) {
		return cfg.Approvers[index]
	}
	return workflowexec.Approver{
		Type: strings.ToLower(stringFromAny(metadata["approver_type"])),
		Ref:  stringFromAny(metadata["approver_ref"]),
	}
}

func approvalChainDecisionVerb(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "approve":
		return workflowexec.DecisionApprove
	case "reject", "request_changes":
		return workflowexec.DecisionReject
	default:
		return ""
	}
}

func intFromAnyDefault(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		if parsed, err := v.Int64(); err == nil {
			return int(parsed)
		}
	}
	return fallback
}
