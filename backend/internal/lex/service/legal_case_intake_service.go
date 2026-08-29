package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const (
	caseIntakeWorkflowName = "Lex Legal Case Intake Directive"
	caseIntakeStepID       = "case_directive_approval"
)

type caseIntakeTaskRepository interface {
	ListForUserMatchingMetadata(
		ctx context.Context,
		tenantID, userID string,
		roles, statuses []string,
		matches []workflowrepo.TaskMetadataMatch,
		sortBy, sortOrder string,
		limit, offset int,
	) ([]*workflowmodel.HumanTask, int, error)
}

// LegalCaseIntakeService drives the two-phase litigation-case intake pipeline
// (CAP-032..036) over the FIRST-CLASS legal_case aggregate. It is the
// case-specific shell over the reusable approval engine, mirroring
// RequestApprovalService:
//
//	Phase 1 (CAP-032/033/034): administrative directive/approval chain up the org
//	hierarchy with the DoA-to-CEO X.509 authority evidence (validated by the SAME
//	crypto seam wired into the shared ApprovalOrchestrator) + the case-strength
//	assessment. The case moves intake → phase1 while the chain runs and
//	phase1 → phase2 on approval (or back to intake on rejection).
//
//	Phase 2 (CAP-035/036): the Legal Director → Section Manager handoff — task
//	estimation + officer/supervisor assignment — moving the case phase2 → open.
//
// The per-task decision transaction (locking, quorum, authority evidence,
// CloudEvents) is owned by the shared engine via CaseApprovalOrchestrator; this
// service owns the phase sequencing + the durable CaseIntake state row.
type LegalCaseIntakeService struct {
	db           *pgxpool.Pool
	cases        *repository.LegalCaseRepository
	intakes      *repository.CaseIntakeRepository
	orchestrator *CaseApprovalOrchestrator
	defRepo      *workflowrepo.DefinitionRepository
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     caseIntakeTaskRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	assignment   *CaseAssignmentValidator
	users        WorkforceUserDirectory
}

// SetAssignmentValidator installs the shared IAM + legal-org validator used by
// the phase-2 manager/supervisor/officer handoff.
func (s *LegalCaseIntakeService) SetAssignmentValidator(validator *CaseAssignmentValidator) {
	if validator != nil {
		s.assignment = validator
	}
}

// SetUserDirectory installs the tenant-scoped IAM resolver used to stamp the
// true intake initiator display name into workflow task metadata.
func (s *LegalCaseIntakeService) SetUserDirectory(users WorkforceUserDirectory) {
	if users != nil {
		s.users = users
	}
}

func NewLegalCaseIntakeService(
	db *pgxpool.Pool,
	cases *repository.LegalCaseRepository,
	intakes *repository.CaseIntakeRepository,
	orchestrator *CaseApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LegalCaseIntakeService {
	var intakeTaskRepo caseIntakeTaskRepository
	if taskRepo != nil {
		intakeTaskRepo = taskRepo
	}
	return &LegalCaseIntakeService{
		db:           db,
		cases:        cases,
		intakes:      intakes,
		orchestrator: orchestrator,
		defRepo:      defRepo,
		instRepo:     instRepo,
		taskRepo:     intakeTaskRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-legal-case-intake").Logger(),
		now:          time.Now,
	}
}

// ListCurrentTasks returns the active Phase-1 case-directive tasks visible to
// the authenticated actor. The repository applies tenant RLS and the standard
// assignee/role/claim predicates before metadata filtering and pagination.
func (s *LegalCaseIntakeService) ListCurrentTasks(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	roles []string,
	page, perPage int,
) ([]*workflowmodel.HumanTask, int, error) {
	if s.taskRepo == nil {
		return nil, 0, internalError("case intake task repository is not configured", fmt.Errorf("missing workflow task repository"))
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 100 {
		perPage = 100
	}

	statuses := []string{
		workflowmodel.TaskStatusPending,
		workflowmodel.TaskStatusClaimed,
		workflowmodel.TaskStatusEscalated,
	}
	matches := []workflowrepo.TaskMetadataMatch{
		{Key: "subject_type", Value: "legal_case"},
		{Key: "source", Value: "lex_case_intake"},
	}
	tasks, total, err := s.taskRepo.ListForUserMatchingMetadata(
		ctx,
		tenantID.String(),
		userID.String(),
		caseIntakeVisibilityRoles(ctx, roles),
		statuses,
		matches,
		"created_at",
		"asc",
		perPage,
		(page-1)*perPage,
	)
	if err != nil {
		return nil, 0, internalError("list current case intake tasks", err)
	}
	return tasks, total, nil
}

// caseIntakeVisibilityRoles preserves normal task-recipient visibility. The
// platform break-glass administrators are given the two case-intake queue roles
// for LISTING only because admin:* can satisfy either decision gate but is not a
// workflow assignee-role slug. Tenant administrators are intentionally not
// broadened: legal task visibility requires an assigned legal role.
func caseIntakeVisibilityRoles(ctx context.Context, roles []string) []string {
	seen := make(map[string]struct{}, len(roles)+2)
	out := make([]string, 0, len(roles)+2)
	add := func(role string) {
		role = strings.TrimSpace(role)
		if role == "" {
			return
		}
		if _, exists := seen[role]; exists {
			return
		}
		seen[role] = struct{}{}
		out = append(out, role)
	}

	platformAdmin := false
	for _, role := range roles {
		add(role)
		canonical := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(role)), "_", "-")
		add(canonical)
		if canonical == "super-admin" {
			platformAdmin = true
		}
	}
	if platformAdmin && auth.HasPermissionCtx(ctx, roles, auth.PermLexCaseApprove) {
		for _, approver := range caseIntakeDirectiveApprovers() {
			if approver.IsRole() {
				add(approver.Ref)
			}
		}
	}
	return out
}

// Get returns the case-intake tracking record (CAP-032..036).
func (s *LegalCaseIntakeService) Get(ctx context.Context, tenantID, caseID uuid.UUID) (*model.CaseIntake, error) {
	if err := s.ensureCase(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	intake, err := s.intakes.GetByCase(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, internalError("load case intake", err)
	}
	return intake, nil
}

// StartPhase1 opens the Phase-1 administrative directive chain over a case
// (CAP-032/033/034). It records the CEO directive + DoA authority-evidence
// references and the case-strength assessment, creates a directive-approval
// workflow instance + step + approver task, links the instance onto the case and
// the intake row, and moves the case intake → phase1. Approver decisions are then
// recorded via Decide, which drives the case FSM through the shared engine.
func (s *LegalCaseIntakeService) StartPhase1(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.StartCaseIntakeRequest) (*model.CaseIntake, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("case intake workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	req.Normalize()
	if err := validateCaseIntakePhase1Start(req); err != nil {
		return nil, err
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	if c.Status != model.CaseStatusIntake {
		return nil, conflictError("only a case in intake can start the phase-1 directive chain")
	}
	if existing, err := s.intakes.GetByCase(ctx, tenantID, caseID); err == nil && existing != nil && existing.WorkflowInstanceID != nil {
		return nil, conflictError("case intake already has an active directive workflow")
	} else if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load case intake", err)
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
		CurrentStepID: ptrString(caseIntakeStepID),
		Variables: map[string]any{
			"case_id":     c.ID.String(),
			"case_number": c.CaseNumber,
			"phase":       string(model.CaseIntakePhasePhase1),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create case directive workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     caseIntakeStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create case directive step execution", err)
	}
	submittedByName := s.resolveSubmittedByName(ctx, tenantID, userID)
	task := s.buildDirectiveTask(tenantID, userID, submittedByName, c, instance, stepExec, req, now)
	workflowID := uuid.MustParse(instance.ID)

	intake := s.buildOrMergeIntake(ctx, tenantID, userID, caseID, req, &workflowID, now)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case intake transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create case directive task", err)
	}
	if err := s.cases.UpdateStatusTx(ctx, tx, tenantID, caseID, model.CaseStatusPhase1, &workflowID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("move case into phase1", err)
	}
	if err := s.persistIntake(ctx, tx, intake); err != nil {
		return nil, err
	}
	if req.StrengthAssessment != nil {
		if err := s.cases.UpdateStrength(ctx, tx, tenantID, caseID, *req.StrengthAssessment); err != nil {
			return nil, internalError("record case strength", err)
		}
	}
	previous := string(model.CaseStatusIntake)
	to := string(model.CaseStatusPhase1)
	auditEntry := &model.LegalCaseAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		CaseID:      caseID,
		Action:      "case.intake.phase1_started",
		FromStatus:  &previous,
		ToStatus:    &to,
		Detail:      map[string]any{"workflow_instance_id": workflowID.String(), "ceo_directive_ref": req.CEODirectiveRef, "doa_authority_ref": req.DoAAuthorityRef},
		ActorUserID: userID,
	}
	if err := s.cases.AppendAudit(ctx, tx, auditEntry); err != nil {
		return nil, internalError("append case intake audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case intake start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.intake_started", tenantID, &userID, map[string]any{
		"id":                   caseID,
		"workflow_instance_id": workflowID,
		"phase":                string(model.CaseIntakePhasePhase1),
		"status":               model.CaseStatusPhase1,
	}, s.logger)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.status_changed", tenantID, &userID, map[string]any{
		"id":                caseID,
		"case_id":           caseID,
		"previous_status":   model.CaseStatusIntake,
		"status":            model.CaseStatusPhase1,
		"status_changed_at": now,
		"created_at":        c.CreatedAt,
		"request_id":        c.RequestID,
	}, s.logger)
	return s.Get(ctx, tenantID, caseID)
}

// Decide records one approver decision on the Phase-1 directive chain through the
// shared engine. On approval the case advances phase1 → phase2 and the intake row
// is marked phase-1 complete; on rejection the case returns to intake.
func (s *LegalCaseIntakeService) Decide(ctx context.Context, tenantID, userID, caseID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	if c.WorkflowInstanceID == nil || *c.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this legal case")
	}
	// A REJECT on the lawsuit intake/approval directive must carry a structured
	// PRD return-reason code (Al Othaim PRD 7.0 / Diagram B), reusing the execution
	// "return incomplete" vocabulary. The validated code is stamped into metadata.
	req, err = applyRejectReturnReason(req)
	if err != nil {
		return nil, err
	}
	outcome, err := s.orchestrator.DecideTask(ctx, tenantID, userID, caseID, workflowInstanceID, taskID, s.advanceCaseStatus, req)
	if err != nil {
		return nil, err
	}
	return outcome, nil
}

// advanceCaseStatus is the case-FSM hook the shared engine calls when the
// directive chain resolves. It runs INSIDE the engine's transaction: it moves the
// case phase1 → phase2 (approve) or → intake (reject), clears the workflow link,
// and stamps the intake row's phase-1 completion.
func (s *LegalCaseIntakeService) advanceCaseStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, caseID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		return "", internalError("reload legal case for advance", err)
	}
	plan := caseDirectiveAdvancePlanFor(c.Status, resolution)
	if !plan.changed {
		return string(c.Status), nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE legal_cases
		SET status = $3, workflow_instance_id = NULL, lock_version = lock_version + 1, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, caseID, plan.target,
	); err != nil {
		return "", internalError("advance case status", err)
	}

	intake, err := s.intakes.GetByCase(ctx, tenantID, caseID)
	if err == nil && intake != nil {
		intake.WorkflowInstanceID = nil
		if resolution == workflowexec.ResolutionAdvance {
			intake.Phase = model.CaseIntakePhasePhase2
			intake.Phase1CompletedAt = &now
			intake.Phase2StartedAt = &now
		} else {
			intake.Phase = model.CaseIntakePhasePhase1
			intake.Phase1StartedAt = &now
		}
		if err := s.intakes.Update(ctx, tx, intake); err != nil {
			return "", internalError("update case intake on advance", err)
		}
	} else if err != nil && err != pgx.ErrNoRows {
		return "", internalError("load case intake on advance", err)
	}
	return string(plan.target), nil
}

// CompletePhase2 performs the Phase-2 Legal Director → Section Manager handoff
// (CAP-035/036): records the task estimate, assigns section-manager / supervisor /
// officer, marks the intake complete, and moves the case phase2 → open. All in one
// transaction with the governance audit row.
func (s *LegalCaseIntakeService) CompletePhase2(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.HandoffCaseIntakeRequest) (*model.CaseIntake, error) {
	req.Normalize()
	if req.SectionManagerID == uuid.Nil {
		return nil, validationError("section_manager_id is required", map[string]string{"section_manager_id": "required"})
	}
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	if c.Status != model.CaseStatusPhase2 {
		return nil, conflictError("only a case in phase2 can complete the handoff")
	}
	if s.assignment == nil {
		return nil, internalError("case assignment validator is not configured", fmt.Errorf("missing case assignment validator"))
	}
	targets := []caseAssignmentTarget{{field: "section_manager_id", userID: req.SectionManagerID}}
	if req.SupervisorID != nil && *req.SupervisorID != uuid.Nil {
		targets = append(targets, caseAssignmentTarget{field: "supervisor_id", userID: *req.SupervisorID})
	}
	if req.HandlingOfficerID != nil && *req.HandlingOfficerID != uuid.Nil {
		targets = append(targets, caseAssignmentTarget{field: "handling_officer_id", userID: *req.HandlingOfficerID})
	}
	if err := s.assignment.validateTargets(ctx, tenantID, c.Metadata, targets); err != nil {
		return nil, err
	}
	intake, err := s.intakes.GetByCase(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("case intake has not started")
		}
		return nil, internalError("load case intake", err)
	}
	now := s.now().UTC()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start case handoff transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.cases.UpdateAssignment(ctx, tx, tenantID, caseID, "section_manager_id", req.SectionManagerID); err != nil {
		return nil, internalError("assign section manager", err)
	}
	if req.SupervisorID != nil && *req.SupervisorID != uuid.Nil {
		if err := s.cases.UpdateAssignment(ctx, tx, tenantID, caseID, "supervisor_id", *req.SupervisorID); err != nil {
			return nil, internalError("assign supervisor", err)
		}
	}
	if req.HandlingOfficerID != nil && *req.HandlingOfficerID != uuid.Nil {
		if err := s.cases.UpdateAssignment(ctx, tx, tenantID, caseID, "handling_officer_id", *req.HandlingOfficerID); err != nil {
			return nil, internalError("assign handling officer", err)
		}
	}
	if err := s.cases.UpdateStatusTx(ctx, tx, tenantID, caseID, model.CaseStatusOpen, nil); err != nil {
		return nil, internalError("open case after handoff", err)
	}
	// WS3/C-2: stamp the SLA-clock-start instant the first time the case opens (the
	// phase2 -> open path). Idempotent: only stamps when currently NULL. The
	// in-process SLA clock itself is materialised by the case service's open path /
	// the out-of-process subscriber to the status_changed event below.
	if _, err := tx.Exec(ctx, `
		UPDATE legal_cases
		SET clock_started_at = COALESCE(clock_started_at, $3), updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, caseID, now,
	); err != nil {
		return nil, internalError("stamp case clock start", err)
	}
	intake.Phase = model.CaseIntakePhaseComplete
	intake.Phase2CompletedAt = &now
	intake.TaskEstimate = req.TaskEstimate
	if err := s.intakes.Update(ctx, tx, intake); err != nil {
		return nil, internalError("complete case intake", err)
	}
	previous := string(model.CaseStatusPhase2)
	to := string(model.CaseStatusOpen)
	auditEntry := &model.LegalCaseAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		CaseID:      caseID,
		Action:      "case.intake.phase2_completed",
		FromStatus:  &previous,
		ToStatus:    &to,
		Detail:      map[string]any{"section_manager_id": req.SectionManagerID.String(), "task_estimate": req.TaskEstimate, "reason": req.Reason},
		ActorUserID: userID,
	}
	if err := s.cases.AppendAudit(ctx, tx, auditEntry); err != nil {
		return nil, internalError("append case handoff audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit case handoff", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.intake_completed", tenantID, &userID, map[string]any{
		"id":                 caseID,
		"phase":              string(model.CaseIntakePhaseComplete),
		"status":             model.CaseStatusOpen,
		"section_manager_id": req.SectionManagerID,
	}, s.logger)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.case.status_changed", tenantID, &userID, map[string]any{
		"id":                caseID,
		"case_id":           caseID,
		"previous_status":   model.CaseStatusPhase2,
		"status":            model.CaseStatusOpen,
		"status_changed_at": now,
		"created_at":        c.CreatedAt,
		"request_id":        c.RequestID,
	}, s.logger)
	return s.Get(ctx, tenantID, caseID)
}

// --- internals --------------------------------------------------------------

func (s *LegalCaseIntakeService) buildOrMergeIntake(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.StartCaseIntakeRequest, workflowID *uuid.UUID, now time.Time) *model.CaseIntake {
	existing, err := s.intakes.GetByCase(ctx, tenantID, caseID)
	if err == nil && existing != nil {
		existing.Phase = model.CaseIntakePhasePhase1
		existing.Phase1StartedAt = &now
		existing.CEODirectiveRef = req.CEODirectiveRef
		existing.DoAAuthorityRef = req.DoAAuthorityRef
		existing.StrengthAssessment = req.StrengthAssessment
		existing.WorkflowInstanceID = workflowID
		if req.Metadata != nil {
			existing.Metadata = req.Metadata
		}
		return existing
	}
	return &model.CaseIntake{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		CaseID:             caseID,
		Phase:              model.CaseIntakePhasePhase1,
		Phase1StartedAt:    &now,
		CEODirectiveRef:    req.CEODirectiveRef,
		DoAAuthorityRef:    req.DoAAuthorityRef,
		StrengthAssessment: req.StrengthAssessment,
		WorkflowInstanceID: workflowID,
		Metadata:           req.Metadata,
		CreatedBy:          userID,
	}
}

// persistIntake upserts the intake row inside tx (Create when new, Update when it
// already carries timestamps).
func (s *LegalCaseIntakeService) persistIntake(ctx context.Context, tx pgx.Tx, intake *model.CaseIntake) error {
	if intake.CreatedAt.IsZero() {
		if err := s.intakes.Create(ctx, tx, intake); err != nil {
			return internalError("create case intake", err)
		}
		return nil
	}
	if err := s.intakes.Update(ctx, tx, intake); err != nil {
		return internalError("update case intake", err)
	}
	return nil
}

func (s *LegalCaseIntakeService) buildDirectiveTask(tenantID, submittedBy uuid.UUID, submittedByName string, c *model.LegalCase, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, req dto.StartCaseIntakeRequest, now time.Time) *workflowmodel.HumanTask {
	approvers := caseIntakeDirectiveApprovers()
	chainCfg := map[string]any{
		"approvers":                  approverConfigList(approvers),
		"mode":                       workflowexec.ApprovalModeSequential,
		"quorum":                     workflowexec.QuorumAll,
		"require_distinct_approvers": true,
	}
	metadata := map[string]any{
		"case_id":               c.ID.String(),
		"case_number":           c.CaseNumber,
		"phase":                 string(model.CaseIntakePhasePhase1),
		"subject_type":          "legal_case",
		"approval_mode":         workflowexec.ApprovalModeSequential,
		"approval_quorum":       workflowexec.QuorumAll,
		"approval_chain":        true,
		"approval_chain_config": chainCfg,
		"approver_total":        len(approvers),
		"approver_index":        0,
		"approver_type":         approvers[0].Type,
		"approver_ref":          approvers[0].Ref,
		"source":                "lex_case_intake",
		"submitted_by":          submittedBy.String(),
		// The Phase-1 directive chain requires DoA-to-CEO authority evidence
		// (CAP-032/033). The shared orchestrator reads this from task metadata and
		// validates it against the X.509 seam wired in app.go.
		"require_authority_evidence": true,
		"approval_policy": map[string]any{
			"policy_id":                  "case-intake-doa",
			"currency":                   "SAR",
			"require_authority_evidence": true,
			"source":                     "case_intake",
		},
	}
	if submittedByName = strings.TrimSpace(submittedByName); submittedByName != "" {
		metadata["submitted_by_name"] = submittedByName
	}
	if req.DoAAuthorityRef != nil {
		metadata["doa_authority_ref"] = *req.DoAAuthorityRef
	}
	formSchema := []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Directive decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Directive notes", Required: false},
	}
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       caseIntakeStepID,
		StepExecID:   stepExec.ID,
		Name:         "Approve case directive",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: ptrString(approvers[0].Ref),
		FormSchema:   formSchema,
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

func (s *LegalCaseIntakeService) resolveSubmittedByName(ctx context.Context, tenantID, userID uuid.UUID) string {
	if s.users == nil {
		return ""
	}
	users, err := s.users.ResolveUsers(ctx, tenantID, []uuid.UUID{userID})
	if err != nil {
		s.logger.Warn().Err(err).Str("user_id", userID.String()).Msg("case intake initiator name could not be resolved")
		return ""
	}
	user, ok := users[userID]
	if !ok {
		return ""
	}
	return strings.Join(strings.Fields(user.FirstName+" "+user.LastName), " ")
}

func validateCaseIntakePhase1Start(req dto.StartCaseIntakeRequest) error {
	if req.CEODirectiveRef == nil {
		return validationError("ceo_directive_ref is required", map[string]string{"ceo_directive_ref": "required"})
	}
	if req.DoAAuthorityRef == nil {
		return validationError("doa_authority_ref is required", map[string]string{"doa_authority_ref": "required"})
	}
	if req.StrengthAssessment == nil {
		return validationError("strength_assessment is required", map[string]string{"strength_assessment": "required"})
	}
	if !req.StrengthAssessment.Valid() {
		return validationError("invalid strength_assessment", map[string]string{"strength_assessment": "invalid"})
	}
	return nil
}

func caseIntakeDirectiveApprovers() []workflowexec.Approver {
	// Two-tier legal approval within the case-approval authority. Both roles hold
	// lex:case:approve (the case-decision route gate): the cases manager reviews
	// first, then the legal director renders the final verdict — two distinct
	// actors, satisfying the dynamic-SoD guard. The CEO is intentionally NOT an
	// approver tier: the SoD matrix scopes legal-ceo to lex:request:approve only
	// (auth/legal_roles_test.go), so a task addressed to legal-ceo could never
	// clear the lex:case:approve gate. The CEO's authority enters upstream as the
	// required ceo_directive_ref input — the CEO issues the directive, the legal
	// chain approves acting on it.
	return []workflowexec.Approver{
		{Type: "role", Ref: "legal-cases-manager"},
		{Type: "role", Ref: "legal-director"},
	}
}

// ensureDefinition lazily creates (once per tenant) the shared case-directive
// workflow definition. Mirrors RequestApprovalService.ensureDefinition.
func (s *LegalCaseIntakeService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, caseIntakeWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load case intake definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        caseIntakeWorkflowName,
		Description: "Phase-1 administrative directive approval chain for Clario Lex litigation cases.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"case_id":     {Type: "string"},
			"case_number": {Type: "string"},
			"phase":       {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: caseIntakeStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Case Directive Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create case intake definition", err)
	}
	return definition, nil
}

func (s *LegalCaseIntakeService) ensureCase(ctx context.Context, tenantID, caseID uuid.UUID) error {
	if _, err := s.cases.Get(ctx, tenantID, caseID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal case not found")
		}
		return internalError("load legal case", err)
	}
	return nil
}
