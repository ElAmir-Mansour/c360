package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const consultationApprovalWorkflowName = "Lex Consultation Response Approval"
const consultationApprovalStepID = "consultation_response_approval"

// ConsultationApprovalService drives the CAP-131 response sign-off. It is the
// subject-specific shell over the reusable, subject-agnostic ApprovalOrchestrator
// (the SAME engine used by legal requests, cases, investigations and
// settlements): StartApproval creates a workflow instance + approval-chain step +
// a single approver task addressed to the supervising legal role, links it onto
// the consultation, and DecideTask records the decision via the orchestrator,
// whose AdvanceSubject hook moves the consultation responded → approved on
// approve (or back to routed on reject so the advisor can re-answer).
type ConsultationApprovalService struct {
	db            *pgxpool.Pool
	consultations *repository.ConsultationRepository
	orchestrator  *ApprovalOrchestrator
	defRepo       *workflowrepo.DefinitionRepository
	instRepo      *workflowrepo.InstanceRepository
	taskRepo      *workflowrepo.TaskRepository
	publisher     Publisher
	metrics       *metrics.Metrics
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
	// approverRole is the role the single approval task is addressed to when the
	// caller does not specify an approver. Defaults to "legal-director" — the only
	// role granted lex:consultation:approve in the SoD matrix, so the addressed
	// approver can clear the consultation-decision route gate.
	approverRole string
	// WS4: immutable audit_db ledger emitter for the approval decision.
	auditEmitter *LexAuditEmitter
}

func NewConsultationApprovalService(
	db *pgxpool.Pool,
	consultations *repository.ConsultationRepository,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *ConsultationApprovalService {
	return &ConsultationApprovalService{
		db:            db,
		consultations: consultations,
		orchestrator:  orchestrator,
		defRepo:       defRepo,
		instRepo:      instRepo,
		taskRepo:      taskRepo,
		publisher:     publisherOrNoop(publisher),
		metrics:       appMetrics,
		topic:         topic,
		logger:        logger.With().Str("service", "lex-consultation-approval").Logger(),
		now:           time.Now,
		approverRole:  "legal-director",
	}
}

// SetAuditEmitter wires the immutable audit_db ledger emitter (WS4). Once set, a
// resolved approval decision (approve/reject) emits a tamper-evident audit_db record
// in addition to the in-tx governance audit row appended by advanceStatus. A nil
// emitter is a no-op.
func (s *ConsultationApprovalService) SetAuditEmitter(emitter *LexAuditEmitter) *ConsultationApprovalService {
	s.auditEmitter = emitter
	return s
}

// StartApproval opens the response-approval pipeline for a responded
// consultation (CAP-131). It creates a workflow instance + step + a single
// role-addressed approval task and links the instance onto the consultation. The
// consultation stays in 'responded' until the decision resolves.
func (s *ConsultationApprovalService) StartApproval(ctx context.Context, tenantID, userID, consultationID uuid.UUID) (*model.Consultation, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("consultation approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	c, err := s.consultations.Get(ctx, tenantID, consultationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if c.Status != model.ConsultationStatusResponded {
		return nil, conflictError("only responded consultations can enter response approval")
	}
	if c.WorkflowInstanceID != nil {
		return nil, conflictError("consultation already has an active approval workflow")
	}

	definition, err := s.ensureDefinition(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	instance := &workflowmodel.WorkflowInstance{
		TenantID:      tenantID.String(),
		DefinitionID:  definition.ID,
		DefinitionVer: definition.Version,
		Status:        workflowmodel.InstanceStatusRunning,
		CurrentStepID: ptrString(consultationApprovalStepID),
		Variables: map[string]any{
			"consultation_id":     c.ID.String(),
			"consultation_number": c.ConsultationNumber,
			"type":                string(c.Type),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create consultation approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     consultationApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create consultation approval step execution", err)
	}

	task := s.buildApprovalTask(tenantID, c, instance, stepExec, now)
	workflowID := uuid.MustParse(instance.ID)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start consultation approval transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create consultation approval task", err)
	}
	if err := s.consultations.SetWorkflowInstance(ctx, tx, tenantID, consultationID, &workflowID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("link consultation approval workflow", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit consultation approval start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.approval_started", tenantID, &userID, map[string]any{
		"id":                   consultationID,
		"workflow_instance_id": workflowID,
		"status":               c.Status,
	}, s.logger)
	return s.get(ctx, tenantID, consultationID)
}

// DecideTask records one approver decision via the reusable orchestrator (CAP-131).
func (s *ConsultationApprovalService) DecideTask(ctx context.Context, tenantID, userID, consultationID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	c, err := s.consultations.Get(ctx, tenantID, consultationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if c.WorkflowInstanceID == nil || *c.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this consultation")
	}
	spec := s.subjectSpec(consultationID)
	outcome, err := s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
	if err != nil {
		return nil, err
	}
	if outcome != nil && outcome.Resolution == workflowexec.ResolutionAdvance && outcome.Status == string(model.ConsultationStatusApproved) {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.approved", tenantID, &userID, consultationApprovedEventPayload(c, outcome), s.logger)
	}
	return outcome, nil
}

// ListTasks returns the open approver tasks for a consultation's workflow.
func (s *ConsultationApprovalService) ListTasks(ctx context.Context, tenantID, consultationID uuid.UUID) ([]*workflowmodel.HumanTask, error) {
	c, err := s.consultations.Get(ctx, tenantID, consultationID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if c.WorkflowInstanceID == nil {
		return []*workflowmodel.HumanTask{}, nil
	}
	tasks, err := s.taskRepo.ListByInstanceStep(ctx, tenantID.String(), c.WorkflowInstanceID.String(), consultationApprovalStepID)
	if err != nil {
		return nil, internalError("list consultation approval tasks", err)
	}
	return tasks, nil
}

func (s *ConsultationApprovalService) get(ctx context.Context, tenantID, id uuid.UUID) (*model.Consultation, error) {
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("consultation not found")
		}
		return nil, internalError("load consultation", err)
	}
	if c.Documents, err = s.consultations.ListDocuments(ctx, tenantID, id); err != nil {
		return nil, internalError("load consultation documents", err)
	}
	return c, nil
}

// subjectSpec builds the orchestrator hook set for a consultation: it locks the
// consultation row FOR UPDATE and advances its FSM as the chain resolves.
func (s *ConsultationApprovalService) subjectSpec(consultationID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "consultation",
		SubjectID:   consultationID,
		EventEntity: "consultation",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			var status string
			err := tx.QueryRow(ctx, `
				SELECT status
				FROM legal_consultations
				WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
				FOR UPDATE`,
				tenantID, subjectID,
			).Scan(&status)
			return status, err
		},
		AdvanceSubject: s.advanceStatus,
	}
}

// advanceStatus is the subject FSM hook the orchestrator calls when the chain
// resolves. On approve it stamps approved_by/at and moves responded → approved,
// clearing the workflow link; on reject it returns the consultation to routed so
// the advisor can re-answer. It runs inside the orchestrator's transaction and
// appends a governance audit row in the same tx.
func (s *ConsultationApprovalService) advanceStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	c, err := s.consultations.Get(ctx, tenantID, subjectID)
	if err != nil {
		return "", internalError("reload consultation for advance", err)
	}
	if c.Status != model.ConsultationStatusResponded {
		return string(c.Status), nil
	}
	var target model.ConsultationStatus
	var approvedBy *uuid.UUID
	var approvedAt *time.Time
	switch resolution {
	case workflowexec.ResolutionAdvance:
		target = model.ConsultationStatusApproved
		approvedBy = &userID
		approvedAt = &now
	case workflowexec.ResolutionReject:
		target = model.ConsultationStatusRouted
	default:
		return string(c.Status), nil
	}
	if err := s.consultations.UpdateStatus(ctx, tx, tenantID, subjectID, target, approvedBy, approvedAt, true); err != nil {
		if err == pgx.ErrNoRows {
			return "", notFoundError("consultation not found")
		}
		return "", internalError("advance consultation status", err)
	}
	previous := string(c.Status)
	to := string(target)
	entry := &model.ConsultationAuditEntry{
		ID:             uuid.New(),
		TenantID:       tenantID,
		ConsultationID: subjectID,
		Action:         "consultation.response_approval_decided",
		FromStatus:     &previous,
		ToStatus:       &to,
		Detail: map[string]any{
			"resolution": string(resolution),
			"decision":   decision,
		},
		ActorUserID: userID,
	}
	if err := s.consultations.AppendAudit(ctx, tx, entry); err != nil {
		return "", internalError("append consultation approval audit", err)
	}
	// WS3: response-approval is the SLA-resolving transition. When the chain
	// advances responded → approved, stamp the terminal on_time/breached verdict on
	// the consultation's self-contained SLA clock IN THE SAME orchestrator tx, so the
	// answer and its SLA outcome commit atomically. The verdict compares the recorded
	// response instant against the materialised response deadline. Idempotent (the
	// repository guards on sla_outcome = 'pending') and non-fatal — a missing clock or
	// guard miss is a no-op so the approval still commits.
	if resolution == workflowexec.ResolutionAdvance && target == model.ConsultationStatusApproved {
		s.resolveSLAOutcomeTx(ctx, tx, tenantID, userID, c, now)
	}
	return to, nil
}

// resolveSLAOutcomeTx stamps the terminal SLA verdict for a consultation inside the
// orchestrator's transaction and appends a governance audit row in the same tx.
// Best-effort: failures are logged, not returned, so the approval is never blocked
// on the reporting-side SLA resolution.
func (s *ConsultationApprovalService) resolveSLAOutcomeTx(ctx context.Context, tx pgx.Tx, tenantID, userID uuid.UUID, c *model.Consultation, now time.Time) {
	snap, err := s.consultations.GetSLASnapshot(ctx, tx, tenantID, c.ID)
	if err != nil {
		if err != pgx.ErrNoRows {
			s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation approval sla resolve skipped: snapshot")
		}
		return
	}
	if snap.StartedAt == nil || snap.Outcome != model.SLAClockOutcomePending {
		return
	}
	completedAt := now
	if c.RespondedAt != nil {
		completedAt = c.RespondedAt.UTC()
	}
	outcome := model.SLAClockOutcomeOnTime
	if snap.ResponseDueAt != nil && completedAt.After(*snap.ResponseDueAt) {
		outcome = model.SLAClockOutcomeBreached
	}
	if err := s.consultations.ResolveSLAOutcome(ctx, tx, tenantID, c.ID, outcome, now); err != nil {
		if err == pgx.ErrNoRows {
			return
		}
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation approval sla resolve skipped")
		return
	}
	entry := &model.ConsultationAuditEntry{
		ID:             uuid.New(),
		TenantID:       tenantID,
		ConsultationID: c.ID,
		Action:         "consultation.sla_resolved",
		Detail: map[string]any{
			"sla_outcome":     string(outcome),
			"sla_resolved_at": now.Format(time.RFC3339Nano),
			"trigger":         "approval",
		},
		ActorUserID: userID,
	}
	if err := s.consultations.AppendAudit(ctx, tx, entry); err != nil {
		s.logger.Warn().Err(err).Str("consultation_id", c.ID.String()).Msg("consultation approval sla resolve audit skipped")
	}
}

// buildApprovalTask materialises the single role-addressed approval task. The
// orchestrator resolves a lone-approver chain on the first decision.
func (s *ConsultationApprovalService) buildApprovalTask(tenantID uuid.UUID, c *model.Consultation, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, now time.Time) *workflowmodel.HumanTask {
	metadata := map[string]any{
		"consultation_id":     c.ID.String(),
		"consultation_number": c.ConsultationNumber,
		"subject_type":        "consultation",
		"approval_mode":       workflowexec.ApprovalModeSequential,
		"approval_quorum":     workflowexec.QuorumAll,
		"approver_total":      1,
		"approver_index":      0,
		"approver_type":       "role",
		"approver_ref":        s.approverRole,
		"source":              "lex_consultation_approval",
	}
	role := s.approverRole
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       consultationApprovalStepID,
		StepExecID:   stepExec.ID,
		Name:         "Approve consultation response",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: &role,
		FormSchema:   consultationApprovalFormSchema(),
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

// ensureDefinition lazily creates (once per tenant) the consultation
// response-approval workflow definition. Mirrors RequestApprovalService.ensureDefinition.
func (s *ConsultationApprovalService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, consultationApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load consultation approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        consultationApprovalWorkflowName,
		Description: "Subject-agnostic legal consultation response approval workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"consultation_id":     {Type: "string"},
			"consultation_number": {Type: "string"},
			"type":                {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: consultationApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Response Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create consultation approval definition", err)
	}
	return definition, nil
}

func consultationApprovalFormSchema() []workflowmodel.FormField {
	return []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
}

func consultationApprovedEventPayload(c *model.Consultation, outcome *ApprovalDecisionOutcome) map[string]any {
	payload := map[string]any{
		"id":                   outcome.SubjectID,
		"consultation_id":      outcome.SubjectID,
		"workflow_instance_id": outcome.WorkflowInstanceID,
		"task_id":              outcome.TaskID,
		"previous_status":      outcome.PreviousStatus,
		"status":               outcome.Status,
		"decision":             outcome.Decision,
		"approved_by":          outcome.DecidedBy,
		"approved_at":          outcome.DecidedAt,
		"completed_at":         outcome.DecidedAt,
		"status_changed_at":    outcome.DecidedAt,
	}
	if c != nil {
		payload["consultation_number"] = c.ConsultationNumber
		payload["created_at"] = c.CreatedAt
		payload["started_at"] = c.CreatedAt
		payload["department"] = c.Department
		payload["type"] = c.Type
		payload["legal_request_id"] = c.LegalRequestID
	}
	return payload
}
