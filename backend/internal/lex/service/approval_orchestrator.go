package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

// approval_orchestrator.go is the REUSABLE, subject-agnostic approval engine. It
// is a generalised mirror of the contract-bound WorkflowService.DecideTask
// pattern, but it has NO hard dependency on contracts: the subject (the domain
// row that an approval is gating) is described abstractly by an
// ApprovalSubjectSpec — a table name, an id, a status-transition hook, and an
// event-emitter. The same orchestrator therefore drives requester/provider
// approval over a legal_request today and can drive cases, consultations,
// investigations, fatwas, or settlements tomorrow without modification.
//
// It mirrors WorkflowService.DecideTask's transactional semantics exactly:
//
//   - lock the subject row AND the workflow task FOR UPDATE in one transaction;
//   - validate the deciding actor (claim / assignee / assignee-role via
//     auth.UserFromContext) — identical rules to validateWorkflowDecisionActor;
//   - validate the submitted form data against the task's required form schema;
//   - validate optional X.509 Delegation-of-Authority evidence (reusing the
//     WorkflowService PKI seam when wired);
//   - resolve the quorum/chain outcome via executor.ResolveApproval +
//     ParseApprovalConfig (advance / reject / wait), creating the next sequential
//     approver task or cancelling siblings exactly like the contract path;
//   - advance the subject's FSM via the spec's StatusHook and emit a CloudEvent.

// ApprovalSubjectSpec describes the domain row an approval gates, decoupling the
// orchestrator from any concrete subject. A caller (e.g. RequestApprovalService)
// supplies one per decision.
type ApprovalSubjectSpec struct {
	// SubjectType is the logical subject kind ("legal_request", "case", ...),
	// recorded on events and task metadata so consumers can correlate.
	SubjectType string
	// SubjectID is the id of the domain row being approved.
	SubjectID uuid.UUID
	// EventEntity is the CloudEvent entity segment, e.g. "request" yields
	// "com.clario360.lex.request.<verb>".
	EventEntity string
	// LockSubject loads + row-locks the subject (FOR UPDATE) inside tx and returns
	// its current FSM status. It MUST select the row with `FOR UPDATE` and scope by
	// tenant; pgx.ErrNoRows is translated to a 404 by the orchestrator.
	LockSubject func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (status string, err error)
	// AdvanceSubject is invoked inside tx once the chain resolves to advance the
	// subject's status. resolution is one of executor.ResolutionAdvance/Reject.
	// nextStage is the next pending approval stage when the resolution advances the
	// workflow to another stage rather than completing it (empty when terminal).
	AdvanceSubject func(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (newStatus string, err error)
}

// ApprovalDecisionOutcome is the orchestrator's result for a single task
// decision: the resolved chain outcome plus the subject's status transition.
type ApprovalDecisionOutcome struct {
	SubjectType        string                  `json:"subject_type"`
	SubjectID          uuid.UUID               `json:"subject_id"`
	WorkflowInstanceID uuid.UUID               `json:"workflow_instance_id"`
	TaskID             uuid.UUID               `json:"task_id"`
	Decision           string                  `json:"decision"`
	Resolution         workflowexec.Resolution `json:"resolution"`
	TaskStatus         string                  `json:"task_status"`
	WorkflowStatus     string                  `json:"workflow_status"`
	PreviousStatus     string                  `json:"previous_status"`
	Status             string                  `json:"status"`
	NextTaskID         *uuid.UUID              `json:"next_task_id,omitempty"`
	DecidedBy          uuid.UUID               `json:"decided_by"`
	DecidedAt          time.Time               `json:"decided_at"`
	Notes              *string                 `json:"notes,omitempty"`
	AuthorityEvidence  map[string]any          `json:"authority_evidence,omitempty"`
}

// ApprovalOrchestrator is the subject-agnostic engine. It is stateless beyond its
// repositories + clock and is safe to embed in any per-subject service.
type ApprovalOrchestrator struct {
	db        *pgxpool.Pool
	instRepo  *workflowrepo.InstanceRepository
	taskRepo  *workflowrepo.TaskRepository
	authority AuthorityEvidenceValidator
	// authorityRootsConfigured mirrors WorkflowService: when true, cryptographic
	// evidence is validated strictly; when false, plain-text evidence is accepted
	// (with a warning logged once material is present).
	authorityRootsConfigured bool
	publisher                Publisher
	metrics                  *metrics.Metrics
	topic                    string
	logger                   zerolog.Logger
	now                      func() time.Time
}

// NewApprovalOrchestrator constructs the engine. defRepo is intentionally not
// required: starting an instance/step is the per-subject service's job (mirroring
// StartContractReview), the orchestrator only decides tasks. instRepo/taskRepo
// are the subject-agnostic workflow primitives already injected via
// lexapp.Dependencies.
func NewApprovalOrchestrator(db *pgxpool.Pool, instRepo *workflowrepo.InstanceRepository, taskRepo *workflowrepo.TaskRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *ApprovalOrchestrator {
	return &ApprovalOrchestrator{
		db:        db,
		instRepo:  instRepo,
		taskRepo:  taskRepo,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-approval-orchestrator").Logger(),
		now:       time.Now,
	}
}

// WithAuthorityEvidenceValidator wires the PKI Delegation-of-Authority validator
// into the orchestrator (additive, chainable) so cases/consultations reuse the
// SAME crypto seam as the contract path.
func (o *ApprovalOrchestrator) WithAuthorityEvidenceValidator(v AuthorityEvidenceValidator, rootsConfigured bool) *ApprovalOrchestrator {
	o.authority = v
	o.authorityRootsConfigured = rootsConfigured
	return o
}

// orchestratorTarget is the locked task + workflow snapshot for a decision.
type orchestratorTarget struct {
	workflowInstanceID uuid.UUID
	workflowStatus     string
	stepID             string
	stepExecID         string
	taskStatus         string
	assigneeID         *string
	assigneeRole       *string
	claimedBy          *string
	formSchema         []workflowmodel.FormField
	taskMetadata       map[string]any
	slaDeadline        *time.Time
}

// DecideTask is the subject-agnostic generalisation of
// WorkflowService.DecideTask. Given a subject spec, a workflow instance + task,
// and a decision request, it locks the subject + task, validates the actor and
// payload, advances the quorum/chain, drives the subject FSM via the spec hook,
// and emits a CloudEvent — all in one transaction.
func (o *ApprovalOrchestrator) DecideTask(ctx context.Context, spec ApprovalSubjectSpec, tenantID, userID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	if o.instRepo == nil || o.taskRepo == nil {
		return nil, internalError("approval orchestrator workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	if spec.LockSubject == nil || spec.AdvanceSubject == nil {
		return nil, internalError("approval subject spec is incomplete", fmt.Errorf("LockSubject and AdvanceSubject are required"))
	}
	req = normalizeWorkflowDecisionRequest(req)
	if err := validateWorkflowDecisionRequest(req); err != nil {
		return nil, err
	}

	tx, err := o.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start approval decision transaction", err)
	}
	defer tx.Rollback(ctx)

	// 1. Lock the subject row (FOR UPDATE) and read its current FSM status.
	previousStatus, err := spec.LockSubject(ctx, tx, tenantID, spec.SubjectID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError(spec.SubjectType + " not found")
		}
		return nil, internalError("lock approval subject", err)
	}

	// 2. Lock the workflow task + instance FOR UPDATE.
	target, err := o.lockTarget(ctx, tx, tenantID, workflowInstanceID, taskID)
	if err != nil {
		return nil, err
	}
	if target.workflowStatus != workflowmodel.InstanceStatusRunning {
		return nil, conflictError("workflow is not running")
	}
	if !workflowTaskCanBeDecided(target.taskStatus) {
		return nil, conflictError("workflow task has already been decided")
	}

	// 3. Validate the deciding actor (claim / assignee / assignee-role).
	if err := validateOrchestratorActor(ctx, userID, target); err != nil {
		return nil, err
	}
	now := o.now().UTC()
	lateJustification, err := validateLateJustification(target.slaDeadline, now, req.LateJustification)
	if err != nil {
		return nil, err
	}

	// 4. Validate required form data against the task's schema.
	if err := validateWorkflowDecisionFormData(req, target.formSchema); err != nil {
		return nil, err
	}

	// 5. Validate the (optional) X.509 Delegation-of-Authority evidence.
	policy := approvalPolicyFromMetadata(target.taskMetadata)
	if err := validateOrchestratorAuthorityEvidence(req, policy); err != nil {
		return nil, err
	}
	if err := o.validateAuthorityEvidencePKI(ctx, req, policy); err != nil {
		return nil, err
	}

	verb := approvalChainDecisionVerb(req.Decision)
	taskStatus := workflowmodel.TaskStatusCompleted
	stepStatus := workflowmodel.StepStatusCompleted
	if verb == workflowexec.DecisionReject {
		taskStatus = workflowmodel.TaskStatusRejected
	}

	// 6. Resolve the quorum/chain outcome over this step's recorded decisions.
	cfg, decisions, err := o.collectChainDecisions(ctx, tx, tenantID, target, taskID, verb, userID)
	if err != nil {
		return nil, err
	}
	// Separation-of-duties: when the chain opted into distinct approvers (e.g. the
	// defendant two-tier memo review, CAP Defendant §5.4), reject a decision by an
	// actor who already decided another tier of THIS chain instance. No-op for chains
	// that did not opt in (RequireDistinctApprovers defaults false).
	if actor, conflict := workflowexec.DistinctApproverConflict(cfg, decisions); conflict {
		return nil, conflictError(fmt.Sprintf("%s (actor %s)", workflowexec.ErrDistinctApproverConflict.Error(), actor))
	}
	resolution := workflowexec.ResolveApproval(cfg, decisions)

	// 7. Persist the task decision.
	formData := workflowDecisionFormData(req, userID, now)
	formData["subject_type"] = spec.SubjectType
	formData["subject_id"] = spec.SubjectID.String()
	formData["previous_status"] = previousStatus
	formDataJSON, err := json.Marshal(formData)
	if err != nil {
		return nil, internalError("marshal approval decision form data", err)
	}
	metadataPatch := o.decisionMetadata(spec, req, userID, now, previousStatus, resolution)
	metadataJSON, err := json.Marshal(metadataPatch)
	if err != nil {
		return nil, internalError("marshal approval decision metadata", err)
	}
	managerRole := lateJustificationManagerRole(spec.SubjectType, "")
	if err := o.updateTaskDecision(ctx, tx, tenantID, taskID, userID, taskStatus, formDataJSON, metadataJSON, now, lateJustification, managerRole); err != nil {
		return nil, err
	}

	// 8. Drive the chain: advance / reject / wait.
	workflowStatus := workflowmodel.InstanceStatusRunning
	currentStepID := &target.stepID
	newStatus := previousStatus
	var nextTaskID *uuid.UUID

	switch resolution {
	case workflowexec.ResolutionWait:
		// Sequential chains create the next approver task; parallel chains wait for
		// the remaining sibling tasks already created up front.
		if next, idx, ok := workflowexec.NextSequentialApprover(cfg, decisions); ok {
			task := o.buildNextApproverTask(tenantID, target, next, idx, len(cfg.Approvers), now)
			if err := insertWorkflowTask(ctx, tx, task); err != nil {
				return nil, internalError("create next sequential approval task", err)
			}
			parsed := uuid.MustParse(task.ID)
			nextTaskID = &parsed
		}
	case workflowexec.ResolutionAdvance:
		workflowStatus = workflowmodel.InstanceStatusCompleted
		currentStepID = ptrString("end")
		if err := cancelPendingApprovalTasks(ctx, tx, tenantID, workflowInstanceID, target.stepID, taskID, now); err != nil {
			return nil, err
		}
		newStatus, err = spec.AdvanceSubject(ctx, tx, tenantID, userID, spec.SubjectID, workflowexec.ResolutionAdvance, req.Decision, now)
		if err != nil {
			return nil, err
		}
	case workflowexec.ResolutionReject:
		workflowStatus = workflowmodel.InstanceStatusFailed
		stepStatus = workflowmodel.StepStatusFailed
		if err := cancelPendingApprovalTasks(ctx, tx, tenantID, workflowInstanceID, target.stepID, taskID, now); err != nil {
			return nil, err
		}
		newStatus, err = spec.AdvanceSubject(ctx, tx, tenantID, userID, spec.SubjectID, workflowexec.ResolutionReject, req.Decision, now)
		if err != nil {
			return nil, err
		}
	}

	// 9. Update the step execution + workflow instance.
	var errorMessage *string
	if resolution == workflowexec.ResolutionReject {
		msg := spec.SubjectType + " approval rejected"
		errorMessage = &msg
	}
	if err := o.updateStepDecision(ctx, tx, workflowInstanceID, target.stepExecID, stepStatus, formDataJSON, errorMessage, now, resolution); err != nil {
		return nil, err
	}
	if resolution != workflowexec.ResolutionWait {
		if err := o.updateInstanceDecision(ctx, tx, tenantID, workflowInstanceID, target.stepID, workflowStatus, currentStepID, formDataJSON, errorMessage, now); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit approval decision transaction", err)
	}

	outcome := &ApprovalDecisionOutcome{
		SubjectType:        spec.SubjectType,
		SubjectID:          spec.SubjectID,
		WorkflowInstanceID: workflowInstanceID,
		TaskID:             taskID,
		Decision:           req.Decision,
		Resolution:         resolution,
		TaskStatus:         taskStatus,
		WorkflowStatus:     workflowStatus,
		PreviousStatus:     previousStatus,
		Status:             newStatus,
		NextTaskID:         nextTaskID,
		DecidedBy:          userID,
		DecidedAt:          now,
		Notes:              req.Notes,
		AuthorityEvidence:  workflowAuthorityEvidenceMetadata(req.AuthorityEvidence),
	}

	writeEvent(ctx, o.publisher, "lex-service", o.topic, "com.clario360.lex."+spec.EventEntity+".approval_decided", tenantID, &userID, map[string]any{
		"id":                   spec.SubjectID,
		"subject_type":         spec.SubjectType,
		"workflow_instance_id": workflowInstanceID,
		"task_id":              taskID,
		"decision":             req.Decision,
		"resolution":           string(resolution),
		"previous_status":      previousStatus,
		"status":               newStatus,
		"workflow_status":      workflowStatus,
		"task_status":          taskStatus,
		"decided_by":           userID,
		"decided_at":           now,
	}, o.logger)

	return outcome, nil
}

// lockTarget locks the workflow task + instance FOR UPDATE. Unlike the
// contract-bound lockWorkflowDecisionTarget it does NOT join a subject table —
// the subject is locked separately via the spec hook so any subject works.
func (o *ApprovalOrchestrator) lockTarget(ctx context.Context, tx pgx.Tx, tenantID, workflowInstanceID, taskID uuid.UUID) (orchestratorTarget, error) {
	var target orchestratorTarget
	var formSchemaJSON []byte
	var taskMetadataJSON []byte
	err := tx.QueryRow(ctx, `
		SELECT wi.id, wi.status, wt.step_id, wt.step_exec_id, wt.status,
		       wt.assignee_id, wt.assignee_role, wt.claimed_by,
		       wt.form_schema, wt.metadata, wt.sla_deadline
		FROM workflow_instances wi
		JOIN workflow_tasks wt ON wt.instance_id = wi.id
		WHERE wi.id = $1
		  AND wt.id = $2
		  AND wi.tenant_id = $3
		  AND wt.tenant_id = $3
		FOR UPDATE OF wi, wt`,
		workflowInstanceID, taskID, tenantID,
	).Scan(
		&target.workflowInstanceID,
		&target.workflowStatus,
		&target.stepID,
		&target.stepExecID,
		&target.taskStatus,
		&target.assigneeID,
		&target.assigneeRole,
		&target.claimedBy,
		&formSchemaJSON,
		&taskMetadataJSON,
		&target.slaDeadline,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return orchestratorTarget{}, notFoundError("workflow task not found")
		}
		return orchestratorTarget{}, internalError("load workflow task", err)
	}
	if len(formSchemaJSON) > 0 {
		if err := json.Unmarshal(formSchemaJSON, &target.formSchema); err != nil {
			return orchestratorTarget{}, internalError("decode workflow task form schema", err)
		}
	}
	target.taskMetadata = map[string]any{}
	if len(taskMetadataJSON) > 0 {
		if err := json.Unmarshal(taskMetadataJSON, &target.taskMetadata); err != nil {
			return orchestratorTarget{}, internalError("decode workflow task metadata", err)
		}
	}
	return target, nil
}

// collectChainDecisions reconstructs the approval chain config from the locked
// task's metadata and reads every sibling task's decision for this step
// (including the one being decided now), so ResolveApproval sees the full
// quorum picture. The current decision is overlaid because its row update is
// inside the same uncommitted tx.
func (o *ApprovalOrchestrator) collectChainDecisions(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, target orchestratorTarget, decidedTaskID uuid.UUID, currentVerb string, currentActor uuid.UUID) (workflowexec.ApprovalConfig, []workflowexec.ApproverDecision, error) {
	cfg := orchestratorChainConfig(target.taskMetadata)

	rows, err := tx.Query(ctx, `
		SELECT wt.id, wt.status, wt.metadata, wt.form_data, wt.claimed_by
		FROM workflow_tasks wt
		WHERE wt.tenant_id = $1
		  AND wt.instance_id = $2
		  AND wt.step_id = $3
		ORDER BY wt.created_at ASC`,
		tenantID, target.workflowInstanceID, target.stepID,
	)
	if err != nil {
		return cfg, nil, internalError("load approval chain tasks", err)
	}
	defer rows.Close()

	decisions := make([]workflowexec.ApproverDecision, 0)
	for rows.Next() {
		var id, status string
		var metaJSON, formJSON []byte
		var claimedBy *uuid.UUID
		if err := rows.Scan(&id, &status, &metaJSON, &formJSON, &claimedBy); err != nil {
			return cfg, nil, internalError("scan approval chain task", err)
		}
		meta := map[string]any{}
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &meta)
		}
		idx := intFromAnyDefault(meta["approver_index"], len(decisions))
		approver := approvalChainApproverFromMetadata(meta, cfg, idx)

		var verb string
		var decidedBy string
		if id == decidedTaskID.String() {
			// Overlay the in-flight decision: this task's row update is inside the
			// same uncommitted tx, so the SELECT still saw its pre-decision status.
			verb = currentVerb
			if currentActor != uuid.Nil {
				decidedBy = currentActor.String()
			}
		} else {
			verb = orchestratorDecisionVerbFromTaskStatus(status)
			if verb == "" && len(formJSON) > 0 {
				form := map[string]any{}
				if json.Unmarshal(formJSON, &form) == nil {
					verb = approvalChainDecisionVerb(stringFromAny(form["decision"]))
				}
			}
			// The actor who decided a prior step: prefer the recorded decided_by, fall
			// back to claimed_by — fed to DistinctApproverConflict (separation of duties).
			decidedBy = stringFromAny(meta["decided_by"])
			if decidedBy == "" && claimedBy != nil {
				decidedBy = claimedBy.String()
			}
		}
		decisions = append(decisions, workflowexec.ApproverDecision{Approver: approver, Decision: verb, DecidedBy: decidedBy})
	}
	if err := rows.Err(); err != nil {
		return cfg, nil, internalError("iterate approval chain tasks", err)
	}
	return cfg, decisions, nil
}

func (o *ApprovalOrchestrator) buildNextApproverTask(tenantID uuid.UUID, target orchestratorTarget, approver workflowexec.Approver, idx, total int, now time.Time) *workflowmodel.HumanTask {
	metadata := cloneAnyMap(target.taskMetadata)
	metadata["approver_index"] = idx
	metadata["approver_total"] = total
	metadata["approver_type"] = approver.Type
	metadata["approver_ref"] = approver.Ref
	task := &workflowmodel.HumanTask{
		TenantID:    tenantID.String(),
		InstanceID:  target.workflowInstanceID.String(),
		StepID:      target.stepID,
		StepExecID:  target.stepExecID,
		Name:        "Approve request",
		Status:      workflowmodel.TaskStatusPending,
		FormSchema:  target.formSchema,
		FormData:    map[string]any{},
		Metadata:    metadata,
		SLADeadline: target.slaDeadline,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	switch {
	case approver.IsRole():
		role := approver.Ref
		task.AssigneeRole = &role
	default:
		assignee := approver.Ref
		task.AssigneeID = &assignee
	}
	return task
}

func (o *ApprovalOrchestrator) updateTaskDecision(ctx context.Context, tx pgx.Tx, tenantID, taskID, userID uuid.UUID, status string, formDataJSON, metadataJSON []byte, decidedAt time.Time, lateJustification *string, managerRole string) error {
	ct, err := tx.Exec(ctx, `
		UPDATE workflow_tasks
		SET status = $3,
		    claimed_by = COALESCE(claimed_by, $4),
		    claimed_at = COALESCE(claimed_at, $5),
		    form_data = $6::jsonb,
		    metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
		    completed_at = $5,
		    late_justification = $8,
		    late_justification_submitted_by = CASE WHEN $8::text IS NULL THEN NULL ELSE $4 END,
		    late_justification_submitted_at = CASE WHEN $8::text IS NULL THEN NULL ELSE $5 END,
		    late_justification_manager_role = CASE WHEN $8::text IS NULL THEN NULL ELSE $9 END,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2`,
		taskID, tenantID, status, userID, decidedAt, formDataJSON, metadataJSON, lateJustification, managerRole,
	)
	if err != nil {
		return internalError("update approval task decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow task not found")
	}
	return nil
}

func (o *ApprovalOrchestrator) updateStepDecision(ctx context.Context, tx pgx.Tx, workflowInstanceID uuid.UUID, stepExecID, status string, outputJSON []byte, errorMessage *string, completedAt time.Time, resolution workflowexec.Resolution) error {
	// While the chain is still waiting the step stays running; only resolve it
	// (completed/failed) once the quorum is decided.
	if resolution == workflowexec.ResolutionWait {
		return nil
	}
	ct, err := tx.Exec(ctx, `
		UPDATE workflow_step_executions
		SET status = $3,
		    output_data = $4::jsonb,
		    error_message = $5,
		    started_at = COALESCE(started_at, $6),
		    completed_at = CASE WHEN $3 IN ('completed','failed','skipped','cancelled') THEN $6 ELSE completed_at END
		WHERE id = $1 AND instance_id = $2`,
		stepExecID, workflowInstanceID.String(), status, outputJSON, errorMessage, completedAt,
	)
	if err != nil {
		return internalError("update approval step decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow step execution not found")
	}
	return nil
}

func (o *ApprovalOrchestrator) updateInstanceDecision(ctx context.Context, tx pgx.Tx, tenantID, workflowInstanceID uuid.UUID, stepID, status string, currentStepID *string, outputJSON []byte, errorMessage *string, completedAt time.Time) error {
	ct, err := tx.Exec(ctx, `
		UPDATE workflow_instances
		SET status = $3,
		    current_step_id = $4,
		    step_outputs = COALESCE(step_outputs, '{}'::jsonb) || jsonb_build_object($5::text, jsonb_build_object('output', $6::jsonb)),
		    error_message = $7,
		    completed_at = CASE WHEN $3 IN ('completed','failed','cancelled') THEN $8 ELSE completed_at END,
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2`,
		workflowInstanceID, tenantID, status, currentStepID, stepID, outputJSON, errorMessage, completedAt,
	)
	if err != nil {
		return internalError("update approval instance decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow instance not found")
	}
	return nil
}

func (o *ApprovalOrchestrator) decisionMetadata(spec ApprovalSubjectSpec, req dto.WorkflowDecisionRequest, userID uuid.UUID, decidedAt time.Time, previousStatus string, resolution workflowexec.Resolution) map[string]any {
	metadata := map[string]any{
		"subject_type":    spec.SubjectType,
		"subject_id":      spec.SubjectID.String(),
		"decision":        req.Decision,
		"resolution":      string(resolution),
		"decided_by":      userID.String(),
		"decided_at":      decidedAt.Format(time.RFC3339Nano),
		"previous_status": previousStatus,
		"source":          "lex_approval_orchestrator",
	}
	if req.Notes != nil {
		metadata["notes"] = *req.Notes
	}
	if len(req.Metadata) > 0 {
		metadata["request_metadata"] = req.Metadata
	}
	if req.AuthorityEvidence != nil {
		metadata["authority_evidence"] = workflowAuthorityEvidenceMetadata(req.AuthorityEvidence)
	}
	return metadata
}

// validateAuthorityEvidencePKI mirrors WorkflowService.validateAuthorityEvidencePKI
// without the contract-value prong (subject-agnostic): it runs only for an
// "approve" decision against a policy that requires evidence; strict mode is
// active only when a validator AND trusted roots are configured.
func (o *ApprovalOrchestrator) validateAuthorityEvidencePKI(ctx context.Context, req dto.WorkflowDecisionRequest, policy *watheeqApprovalPolicy) error {
	if req.Decision != "approve" {
		return nil
	}
	if policy == nil || !policy.RequireAuthorityEvidence {
		return nil
	}
	evidence := req.AuthorityEvidence
	if evidence == nil {
		return nil
	}
	strict := o.authority != nil && o.authorityRootsConfigured
	if !strict {
		if evidence.HasCryptographicEvidence() {
			o.logger.Warn().
				Str("policy_id", policy.PolicyID).
				Bool("validator_configured", o.authority != nil).
				Bool("roots_configured", o.authorityRootsConfigured).
				Msg("approval authority evidence carried cryptographic material but no trusted roots are configured; accepting un-verified")
		}
		return nil
	}
	if !evidence.HasCryptographicEvidence() {
		return validationError("cryptographic authority evidence is required (certificate_pem, signature_b64, signature_alg)", map[string]string{"authority_evidence.certificate_pem": "required"})
	}
	input, err := authorityEvidenceInputFromRequest(evidence)
	if err != nil {
		return err
	}
	verified, err := o.authority.Validate(ctx, input)
	if err != nil {
		return mapAuthorityEvidenceError(err)
	}
	if verified != nil && verified.AuthorityAmount != nil && policy.RequiredAuthorityAmount != nil && *verified.AuthorityAmount < *policy.RequiredAuthorityAmount {
		return validationError("authority evidence bound amount is below the required approval authority", map[string]string{"authority_evidence.authority_amount": "insufficient"})
	}
	return nil
}

// validateOrchestratorActor mirrors validateWorkflowDecisionActor: claim,
// assignee, and assignee-role checks against auth.UserFromContext.
func validateOrchestratorActor(ctx context.Context, userID uuid.UUID, target orchestratorTarget) error {
	if target.claimedBy != nil && *target.claimedBy != userID.String() {
		return forbiddenError("workflow task is claimed by another user")
	}
	if target.assigneeID != nil && *target.assigneeID != userID.String() {
		return forbiddenError("workflow task is assigned to another user")
	}
	if target.assigneeRole != nil && strings.TrimSpace(*target.assigneeRole) != "" {
		roles := orchestratorActorRoles(ctx, userID)
		if !workflowActorHasRole(roles, *target.assigneeRole) {
			return forbiddenError("workflow task requires the assigned approval role")
		}
	}
	return nil
}

func orchestratorActorRoles(ctx context.Context, userID uuid.UUID) []string {
	user := auth.UserFromContext(ctx)
	if user == nil || user.ID != userID.String() {
		return nil
	}
	return user.Roles
}

// validateOrchestratorAuthorityEvidence enforces the plain-text DoA rules for an
// approve decision against a policy that requires evidence (subject-agnostic
// subset of validateWorkflowAuthorityEvidence — no contract-value coupling).
func validateOrchestratorAuthorityEvidence(req dto.WorkflowDecisionRequest, policy *watheeqApprovalPolicy) error {
	if req.Decision != "approve" {
		return validateOptionalAuthorityEvidence(req.AuthorityEvidence)
	}
	if policy == nil || !policy.RequireAuthorityEvidence {
		return validateOptionalAuthorityEvidence(req.AuthorityEvidence)
	}
	if req.AuthorityEvidence == nil {
		return validationError("authority_evidence is required for approval", map[string]string{"authority_evidence": "required"})
	}
	if err := validateOptionalAuthorityEvidence(req.AuthorityEvidence); err != nil {
		return err
	}
	if policy.RequiredRole != "" && !strings.EqualFold(policy.RequiredRole, req.AuthorityEvidence.Role) {
		return validationError("authority_evidence.role does not satisfy the approval policy", map[string]string{"authority_evidence.role": "invalid"})
	}
	if policy.Currency != "" && !strings.EqualFold(policy.Currency, req.AuthorityEvidence.Currency) {
		return validationError("authority_evidence.currency does not satisfy the approval policy", map[string]string{"authority_evidence.currency": "invalid"})
	}
	if policy.RequiredAuthorityAmount != nil && req.AuthorityEvidence.AuthorityAmount < *policy.RequiredAuthorityAmount {
		return validationError("authority_evidence.authority_amount is below the required approval authority", map[string]string{"authority_evidence.authority_amount": "insufficient"})
	}
	return nil
}

// orchestratorChainConfig reconstructs the executor.ApprovalConfig from a task's
// approval metadata so ResolveApproval can be re-run on resume. It falls back to
// a single-approver "all" chain when no chain metadata is present (a lone
// human-task approval still resolves on the first decision).
func orchestratorChainConfig(metadata map[string]any) workflowexec.ApprovalConfig {
	mode := strings.ToLower(stringFromAny(metadata["approval_mode"]))
	if mode != workflowexec.ApprovalModeSequential && mode != workflowexec.ApprovalModeParallel {
		mode = workflowexec.ApprovalModeSequential
	}
	quorum := strings.ToLower(stringFromAny(metadata["approval_quorum"]))
	switch quorum {
	case workflowexec.QuorumAll, workflowexec.QuorumAny, workflowexec.QuorumNofM:
	default:
		quorum = workflowexec.QuorumAll
	}
	total := intFromAnyDefault(metadata["approver_total"], 1)
	if total < 1 {
		total = 1
	}
	approvers := make([]workflowexec.Approver, 0, total)
	// requireDistinct opts the chain into the engine's separation-of-duties
	// constraint (no single actor may decide more than one tier). Defaults false so
	// every existing chain is unchanged; carried on the stamped chain config map.
	requireDistinct := false
	if raw, ok := metadata["approval_chain_config"].(map[string]any); ok {
		if list, ok := raw["approvers"].([]any); ok {
			for _, item := range list {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				approvers = append(approvers, workflowexec.Approver{
					Type: strings.ToLower(stringFromAny(m["type"])),
					Ref:  stringFromAny(m["ref"]),
				})
			}
		}
		requireDistinct = boolFromAny(raw["require_distinct_approvers"])
	}
	for len(approvers) < total {
		approvers = append(approvers, workflowexec.Approver{Type: "role", Ref: stringFromAny(metadata["approver_ref"])})
	}
	cfg := workflowexec.ApprovalConfig{Approvers: approvers, Mode: mode, Quorum: quorum, RequireDistinctApprovers: requireDistinct}
	if quorum == workflowexec.QuorumNofM {
		cfg.QuorumN = intFromAnyDefault(metadata["approval_quorum_n"], 1)
		if cfg.QuorumN < 1 {
			cfg.QuorumN = 1
		}
		if cfg.QuorumN > len(cfg.Approvers) {
			cfg.QuorumN = len(cfg.Approvers)
		}
	}
	return cfg
}

func orchestratorDecisionVerbFromTaskStatus(status string) string {
	switch status {
	case workflowmodel.TaskStatusCompleted:
		return workflowexec.DecisionApprove
	case workflowmodel.TaskStatusRejected:
		return workflowexec.DecisionReject
	default:
		return ""
	}
}

// authorityEvidenceInputFromRequest maps the DTO evidence onto the lex/crypto
// validator input, decoding the optional signed payload (mirrors the contract
// path in WorkflowService.validateAuthorityEvidencePKI).
func authorityEvidenceInputFromRequest(evidence *dto.ApprovalAuthorityEvidence) (lexcrypto.AuthorityEvidenceInput, error) {
	var payload []byte
	if strings.TrimSpace(evidence.SignedPayloadB64) != "" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(evidence.SignedPayloadB64))
		if err != nil {
			return lexcrypto.AuthorityEvidenceInput{}, validationError("authority_evidence.signed_payload_b64 must be valid base64", map[string]string{"authority_evidence.signed_payload_b64": "invalid"})
		}
		payload = decoded
	}
	return lexcrypto.AuthorityEvidenceInput{
		CertificatePEM:  evidence.CertificatePEM,
		Payload:         payload,
		SignatureB64:    evidence.SignatureB64,
		SignatureAlg:    evidence.SignatureAlg,
		TrustedRootsPEM: evidence.TrustedRootsPEM,
	}, nil
}

// mapAuthorityEvidenceError translates a lex/crypto validation sentinel into the
// appropriate 4xx validation error (same mapping as the contract path).
func mapAuthorityEvidenceError(err error) error {
	switch {
	case errors.Is(err, lexcrypto.ErrExpired):
		return validationError("authority evidence certificate is outside its validity window", map[string]string{"authority_evidence.certificate_pem": "expired"})
	case errors.Is(err, lexcrypto.ErrChainInvalid):
		return validationError("authority evidence certificate is not trusted", map[string]string{"authority_evidence.certificate_pem": "untrusted"})
	case errors.Is(err, lexcrypto.ErrSignatureInvalid):
		return validationError("authority evidence signature is invalid", map[string]string{"authority_evidence.signature_b64": "invalid"})
	case errors.Is(err, lexcrypto.ErrUnsupportedAlg):
		return validationError("authority evidence signature algorithm is unsupported", map[string]string{"authority_evidence.signature_alg": "invalid"})
	case errors.Is(err, lexcrypto.ErrRevoked):
		return validationError("authority evidence certificate is revoked", map[string]string{"authority_evidence.certificate_pem": "revoked"})
	case errors.Is(err, lexcrypto.ErrInvalidEvidence):
		return validationError("authority evidence is malformed", map[string]string{"authority_evidence.certificate_pem": "invalid"})
	default:
		return internalError("validate authority evidence", err)
	}
}
