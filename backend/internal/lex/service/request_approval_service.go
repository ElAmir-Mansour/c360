package service

import (
	"context"
	"fmt"
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

const requestApprovalWorkflowName = "Lex Legal Request Approval"

// RequestApprovalService drives the two-stage requester→provider approval chain
// for a legal request (CAP-030, CAP-031). It is the subject-specific shell over
// the reusable ApprovalOrchestrator: it resolves the routing policy via
// RequestApprovalPolicyService.Recommend, starts a workflow instance + step +
// approver task(s) over the subject-agnostic workflow primitives, and advances
// legal_requests.status through:
//
//	submitted → pending_requester_approval → pending_provider_approval → approved
//
// The orchestrator owns the per-task decision transaction (locking, quorum,
// authority evidence, events); this service owns stage sequencing and the
// subject-FSM hooks the orchestrator calls back into.
type RequestApprovalService struct {
	db           *pgxpool.Pool
	requests     *repository.LegalRequestRepository
	policies     *RequestApprovalPolicyService
	orchestrator *ApprovalOrchestrator
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     *workflowrepo.TaskRepository
	defRepo      *workflowrepo.DefinitionRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	router       requestRouter
	attachments  *LegalRequestAttachmentService
}

// requestRouter advances an approved request to routed and auto-spawns the
// downstream subject. Satisfied by *LegalRequestService.Route. Optional seam:
// when unset, approval completion does not auto-route (the manual POST
// /legal-requests/{id}/route endpoint remains the entrypoint).
type requestRouter interface {
	Route(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.LegalRequest, error)
}

// SetRouter installs the auto-route bridge fired when the final approval resolves
// a request to approved. Wired in app.go after LegalRequestService exists; nil is
// tolerated so the constructor default (no auto-route) is never clobbered.
func (s *RequestApprovalService) SetRouter(router requestRouter) {
	if router != nil {
		s.router = router
	}
}

func (s *RequestApprovalService) SetRequestAttachments(attachments *LegalRequestAttachmentService) {
	s.attachments = attachments
}

// NewRequestApprovalService mirrors the NewMatterService constructor shape and
// then takes the workflow primitives + orchestrator + policy resolver this stage
// engine composes.
func NewRequestApprovalService(
	db *pgxpool.Pool,
	requests *repository.LegalRequestRepository,
	policies *RequestApprovalPolicyService,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *RequestApprovalService {
	return &RequestApprovalService{
		db:           db,
		requests:     requests,
		policies:     policies,
		orchestrator: orchestrator,
		instRepo:     instRepo,
		taskRepo:     taskRepo,
		defRepo:      defRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-request-approval").Logger(),
		now:          time.Now,
	}
}

const requestApprovalStepID = "request_approval"

// StartApproval opens the approval pipeline for a submitted legal request. It
// also tolerates an approval-required request that is already in the matching
// pending status but has no workflow link, so rows created before the submit
// checkpoint fix can still be recovered. It resolves the requester-stage policy
// (falling back to provider when no requester approval is required), creates a
// workflow instance + approval-chain step + approver task(s), links the instance
// onto the request, and moves the request into its first pending-approval
// status.
func (s *RequestApprovalService) StartApproval(ctx context.Context, tenantID, userID, requestID uuid.UUID) (*model.LegalRequest, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("request approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if request.WorkflowInstanceID != nil {
		// Idempotent start: submit now auto-opens the approval pipeline, so an
		// explicit POST /approval/start on a request already parked in a
		// pending-approval stage returns the current state instead of conflicting
		// (keeps the UI fallback button and any pre-existing callers safe). A
		// workflow attached at any other status (already approved/routed) is still a
		// real conflict.
		if request.Status == model.RequestStatusPendingRequesterApproval || request.Status == model.RequestStatusPendingProviderApproval {
			return s.Get(ctx, tenantID, requestID)
		}
		return nil, conflictError("legal request already has an active approval workflow")
	}
	stage, target := s.firstApprovalStage(request)
	if stage == "" {
		return nil, conflictError("legal request requires no approvals; submit moves it straight to approved")
	}
	if !approvalStartStatusAllowed(request.Status, target) {
		return nil, conflictError("only submitted or unstarted pending-approval requests can enter approval")
	}

	rec, err := s.recommendForStage(ctx, tenantID, request, stage)
	if err != nil {
		return nil, err
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
		CurrentStepID: ptrString(requestApprovalStepID),
		Variables: map[string]any{
			"request_id":     request.ID.String(),
			"request_number": request.RequestNumber,
			"request_type":   request.RequestType,
			"stage":          string(stage),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     requestApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create approval step execution", err)
	}

	cfg, approvers := approvalConfigFromRecommendation(rec)
	tasks := s.buildStageTasks(tenantID, request, instance, stepExec, stage, cfg, approvers, now)

	workflowID := uuid.MustParse(instance.ID)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start approval transaction", err)
	}
	defer tx.Rollback(ctx)
	for _, task := range tasks {
		if err := insertWorkflowTask(ctx, tx, task); err != nil {
			return nil, internalError("create approval task", err)
		}
	}
	if err := s.requests.UpdateStatus(ctx, tx, tenantID, requestID, target, &workflowID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("move legal request into approval", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit approval start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.approval_started", tenantID, &userID, map[string]any{
		"id":                   request.ID,
		"workflow_instance_id": workflowID,
		"stage":                string(stage),
		"status":               target,
		"approver_tasks":       len(tasks),
		"policy_matched":       rec != nil && rec.Matched,
	}, s.logger)

	return s.Get(ctx, tenantID, requestID)
}

// DecideTask records one approver decision via the reusable orchestrator. When
// the requester stage advances and a provider stage is still required, a fresh
// provider-stage workflow is started automatically.
func (s *RequestApprovalService) DecideTask(ctx context.Context, tenantID, userID, requestID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if request.WorkflowInstanceID == nil || *request.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this legal request")
	}
	// Dynamic-SoD (design v2 §4.2): the requester who AUTHORED this request may not
	// render the DOA approve/reject verdict on it, regardless of the capability key
	// they hold. The decision route is gated by lex:request:approve (no coarse
	// fallback, no URL-keyed RequireDistinctActor middleware), so this is its
	// instance-guard equivalent. Fails CLOSED on an unresolved author.
	if err := requireDistinctDecisionAuthor("legal request", request.CreatedBy, userID); err != nil {
		return nil, err
	}

	// A REJECT at the approval gate must carry a structured PRD return-reason code
	// (Al Othaim PRD 7.0 / Diagram B), reusing the execution "return incomplete"
	// vocabulary. The validated code is stamped into the decision metadata.
	req, err = applyRejectReturnReason(req)
	if err != nil {
		return nil, err
	}
	if s.attachments != nil {
		snapshot, listErr := s.attachments.ApprovalSnapshot(ctx, tenantID, requestID)
		if listErr != nil {
			// Preserve the attachment service's fail-closed status (notably 409
			// for changed evidence and 502 for unavailable file verification).
			return nil, listErr
		}
		if req.FormData == nil {
			req.FormData = map[string]any{}
		}
		// Reserved server-owned field: a client-supplied value is intentionally
		// overwritten so the decision record cannot misstate reviewed evidence.
		req.FormData["reviewed_attachments"] = snapshot
	}

	spec := s.subjectSpec(requestID)
	outcome, err := s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
	if err != nil {
		return nil, err
	}

	// When the requester stage approved a request that ALSO requires provider
	// approval, AdvanceSubject set status to pending_provider_approval and cleared
	// the workflow link; kick off the provider stage automatically.
	if outcome.Status == string(model.RequestStatusPendingProviderApproval) && outcome.Resolution == workflowexec.ResolutionAdvance {
		if _, serr := s.startProviderStage(ctx, tenantID, userID, requestID); serr != nil {
			s.logger.Error().Err(serr).Str("request_id", requestID.String()).Msg("failed to auto-start provider approval stage")
		}
	}

	// When the final approval resolves the request to approved, auto-advance the
	// spine to routed and spawn the downstream subject (case/consultation). Route
	// is idempotent and opens its own transaction AFTER the orchestrator commit, so
	// it cannot deadlock on the row the orchestrator just locked. Failure is
	// non-fatal: the request stays approved and the manual POST /route endpoint (or
	// the next decision retry) can complete routing.
	if outcome.Status == string(model.RequestStatusApproved) && s.router != nil {
		if _, rerr := s.router.Route(ctx, tenantID, userID, requestID); rerr != nil {
			s.logger.Error().Err(rerr).Str("request_id", requestID.String()).Msg("auto-route after approval failed; request remains approved")
		}
	}
	return outcome, nil
}

// ListTasks returns the approval tasks for a request's current workflow and
// annotates each task with actor-specific decision eligibility. Task history
// remains visible, while clients can no longer mistake a tenant-visible task
// assigned to another approver (or authored by this actor) for an actionable one.
func (s *RequestApprovalService) ListTasks(ctx context.Context, tenantID, userID, requestID uuid.UUID) ([]dto.RequestApprovalTaskResponse, error) {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	if request.WorkflowInstanceID == nil {
		return []dto.RequestApprovalTaskResponse{}, nil
	}
	tasks, err := s.taskRepo.ListByInstanceStep(ctx, tenantID.String(), request.WorkflowInstanceID.String(), requestApprovalStepID)
	if err != nil {
		return nil, internalError("list approval tasks", err)
	}
	items := make([]dto.RequestApprovalTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		if task == nil {
			continue
		}
		items = append(items, dto.RequestApprovalTaskResponse{
			HumanTask: *task,
			CanDecide: requestApprovalTaskCanBeDecided(ctx, request, userID, task),
		})
	}
	return items, nil
}

func requestApprovalTaskCanBeDecided(ctx context.Context, request *model.LegalRequest, userID uuid.UUID, task *workflowmodel.HumanTask) bool {
	if request == nil || task == nil || userID == uuid.Nil {
		return false
	}
	contextUser := auth.UserFromContext(ctx)
	if contextUser == nil || contextUser.ID != userID.String() || !auth.HasPermissionCtx(ctx, contextUser.Roles, auth.PermLexRequestApprove) {
		return false
	}
	if requireDistinctDecisionAuthor("legal request", request.CreatedBy, userID) != nil {
		return false
	}
	if !workflowTaskCanBeDecided(task.Status) {
		return false
	}
	target := orchestratorTarget{
		taskStatus:   task.Status,
		assigneeID:   task.AssigneeID,
		assigneeRole: task.AssigneeRole,
		claimedBy:    task.ClaimedBy,
	}
	return validateOrchestratorActor(ctx, userID, target) == nil
}

// ActorCanReviewAttachments applies the same live task assignment, claim,
// capability and separation-of-duties rules as the approval decision command.
// It is used by the request-attachment service so knowing a request/file UUID
// never grants an unrelated tenant user access to supporting evidence.
func (s *RequestApprovalService) ActorCanReviewAttachments(ctx context.Context, tenantID, userID uuid.UUID, request *model.LegalRequest) (bool, error) {
	if request == nil || request.WorkflowInstanceID == nil {
		return false, nil
	}
	tasks, err := s.taskRepo.ListByInstanceStep(ctx, tenantID.String(), request.WorkflowInstanceID.String(), requestApprovalStepID)
	if err != nil {
		return false, internalError("list approval tasks for attachment access", err)
	}
	for _, task := range tasks {
		if requestApprovalTaskCanBeDecided(ctx, request, userID, task) {
			return true, nil
		}
	}
	return false, nil
}

// Get returns the current request row.
func (s *RequestApprovalService) Get(ctx context.Context, tenantID, requestID uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	return request, nil
}

// subjectSpec builds the orchestrator hook set for a legal request: it locks the
// request row FOR UPDATE and advances its FSM as each chain stage resolves.
func (s *RequestApprovalService) subjectSpec(requestID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_request",
		SubjectID:   requestID,
		EventEntity: "request",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			var status string
			err := tx.QueryRow(ctx, `
				SELECT status
				FROM legal_requests
				WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
				FOR UPDATE`,
				tenantID, subjectID,
			).Scan(&status)
			return status, err
		},
		AdvanceSubject: s.advanceRequestStatus,
	}
}

// advanceRequestStatus is the subject FSM hook the orchestrator calls when a
// stage resolves. On approve it moves to the next pending stage (or approved); on
// reject it returns the request. It runs inside the orchestrator's transaction.
func (s *RequestApprovalService) advanceRequestStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	request, err := s.requests.Get(ctx, tenantID, subjectID)
	if err != nil {
		return "", internalError("reload legal request for advance", err)
	}
	plan := requestApprovalAdvancePlanFor(request, resolution)
	if !plan.changed {
		return string(request.Status), nil
	}

	var workflowArg *uuid.UUID
	if err := s.updateRequestStatusTx(ctx, tx, tenantID, subjectID, plan.target, plan.clearWorkflow, workflowArg); err != nil {
		return "", err
	}
	return string(plan.target), nil
}

// updateRequestStatusTx updates legal_requests.status inside tx, optionally
// nulling workflow_instance_id so the next stage (or a resubmit) can attach a new
// workflow.
func (s *RequestApprovalService) updateRequestStatusTx(ctx context.Context, tx pgx.Tx, tenantID, requestID uuid.UUID, status model.RequestStatus, clearWorkflow bool, workflowInstanceID *uuid.UUID) error {
	var ct int64
	if clearWorkflow {
		tag, err := tx.Exec(ctx, `
			UPDATE legal_requests
			SET status = $3, workflow_instance_id = NULL, updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, requestID, status,
		)
		if err != nil {
			return internalError("update legal request status", err)
		}
		ct = tag.RowsAffected()
	} else {
		tag, err := tx.Exec(ctx, `
			UPDATE legal_requests
			SET status = $3,
			    workflow_instance_id = COALESCE($4, workflow_instance_id),
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, requestID, status, workflowInstanceID,
		)
		if err != nil {
			return internalError("update legal request status", err)
		}
		ct = tag.RowsAffected()
	}
	if ct == 0 {
		return notFoundError("legal request not found")
	}
	return nil
}

// startProviderStage opens a fresh provider-stage workflow once the requester
// stage has advanced the request into pending_provider_approval.
func (s *RequestApprovalService) startProviderStage(ctx context.Context, tenantID, userID, requestID uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		return nil, internalError("load legal request for provider stage", err)
	}
	if request.Status != model.RequestStatusPendingProviderApproval || request.WorkflowInstanceID != nil {
		return s.Get(ctx, tenantID, requestID)
	}
	rec, err := s.recommendForStage(ctx, tenantID, request, model.RequestApprovalStageProvider)
	if err != nil {
		return nil, err
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
		CurrentStepID: ptrString(requestApprovalStepID),
		Variables: map[string]any{
			"request_id":     request.ID.String(),
			"request_number": request.RequestNumber,
			"request_type":   request.RequestType,
			"stage":          string(model.RequestApprovalStageProvider),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create provider approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     requestApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create provider approval step execution", err)
	}
	cfg, approvers := approvalConfigFromRecommendation(rec)
	tasks := s.buildStageTasks(tenantID, request, instance, stepExec, model.RequestApprovalStageProvider, cfg, approvers, now)
	workflowID := uuid.MustParse(instance.ID)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start provider approval transaction", err)
	}
	defer tx.Rollback(ctx)
	for _, task := range tasks {
		if err := insertWorkflowTask(ctx, tx, task); err != nil {
			return nil, internalError("create provider approval task", err)
		}
	}
	if err := s.requests.UpdateStatus(ctx, tx, tenantID, requestID, model.RequestStatusPendingProviderApproval, &workflowID); err != nil {
		return nil, internalError("link provider approval workflow", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit provider approval start", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.approval_started", tenantID, &userID, map[string]any{
		"id":                   request.ID,
		"workflow_instance_id": workflowID,
		"stage":                string(model.RequestApprovalStageProvider),
		"status":               model.RequestStatusPendingProviderApproval,
		"approver_tasks":       len(tasks),
	}, s.logger)
	return s.Get(ctx, tenantID, requestID)
}

// firstApprovalStage reports which approval stage a submitted request enters
// first and the matching pending status.
func (s *RequestApprovalService) firstApprovalStage(request *model.LegalRequest) (model.RequestApprovalStage, model.RequestStatus) {
	switch {
	case request.RequesterApprovalReqd:
		return model.RequestApprovalStageRequester, model.RequestStatusPendingRequesterApproval
	case request.ProviderApprovalReqd:
		return model.RequestApprovalStageProvider, model.RequestStatusPendingProviderApproval
	default:
		return "", ""
	}
}

func approvalStartStatusAllowed(status, target model.RequestStatus) bool {
	return status == model.RequestStatusSubmitted || status == target
}

type requestApprovalAdvancePlan struct {
	target        model.RequestStatus
	clearWorkflow bool
	changed       bool
}

func requestApprovalAdvancePlanFor(request *model.LegalRequest, resolution workflowexec.Resolution) requestApprovalAdvancePlan {
	switch resolution {
	case workflowexec.ResolutionReject:
		return requestApprovalAdvancePlan{
			target:        model.RequestStatusReturned,
			clearWorkflow: true,
			changed:       true,
		}
	case workflowexec.ResolutionAdvance:
		switch request.Status {
		case model.RequestStatusPendingRequesterApproval:
			if request.ProviderApprovalReqd {
				return requestApprovalAdvancePlan{
					target:        model.RequestStatusPendingProviderApproval,
					clearWorkflow: true,
					changed:       true,
				}
			}
			return requestApprovalAdvancePlan{
				target:  model.RequestStatusApproved,
				changed: true,
			}
		case model.RequestStatusPendingProviderApproval:
			return requestApprovalAdvancePlan{
				target:  model.RequestStatusApproved,
				changed: true,
			}
		default:
			return requestApprovalAdvancePlan{target: request.Status}
		}
	default:
		return requestApprovalAdvancePlan{target: request.Status}
	}
}

// recommendForStage resolves the best-match active policy for a request + stage.
func (s *RequestApprovalService) recommendForStage(ctx context.Context, tenantID uuid.UUID, request *model.LegalRequest, stage model.RequestApprovalStage) (*model.RequestApprovalPolicyRecommendation, error) {
	if s.policies == nil {
		return nil, nil
	}
	stageCopy := stage
	priorityTier := string(request.Priority)
	in := RecommendInput{
		RequestType:  &request.RequestType,
		ServiceID:    request.ServiceID,
		Stage:        &stageCopy,
		Department:   request.Department,
		PriorityTier: &priorityTier,
	}
	return s.policies.Recommend(ctx, tenantID, in)
}

// buildStageTasks materialises the approver tasks for a stage. When the policy
// yields approvers it builds an approval_chain (one task for sequential, all for
// parallel); otherwise it falls back to a single role-addressed human task keyed
// to the stage so the orchestrator still resolves on the first decision.
func (s *RequestApprovalService) buildStageTasks(tenantID uuid.UUID, request *model.LegalRequest, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, stage model.RequestApprovalStage, cfg workflowexec.ApprovalConfig, approvers []model.ApprovalPolicyApprover, now time.Time) []*workflowmodel.HumanTask {
	baseMetadata := map[string]any{
		"request_id":      request.ID.String(),
		"request_number":  request.RequestNumber,
		"request_type":    request.RequestType,
		"stage":           string(stage),
		"subject_type":    "legal_request",
		"approval_mode":   cfg.Mode,
		"approval_quorum": cfg.Quorum,
		"approver_total":  len(cfg.Approvers),
		"source":          "lex_request_approval",
	}
	if cfg.Quorum == workflowexec.QuorumNofM {
		baseMetadata["approval_quorum_n"] = cfg.QuorumN
	}
	if len(cfg.Approvers) > 0 {
		chainCfg := map[string]any{"approvers": approverConfigList(cfg.Approvers), "mode": cfg.Mode, "quorum": cfg.Quorum}
		if cfg.Quorum == workflowexec.QuorumNofM {
			chainCfg["quorum_n"] = cfg.QuorumN
		}
		baseMetadata["approval_chain_config"] = chainCfg
		baseMetadata["approval_chain"] = true
	}

	formSchema := requestApprovalFormSchema()

	pending := cfg.Approvers
	if cfg.Mode == workflowexec.ApprovalModeSequential && len(pending) > 0 {
		pending = pending[:1]
	}
	if len(pending) == 0 {
		// No policy approvers (the default path when only templates, never live
		// policies, are seeded): a single unassigned approval task. Deliberately
		// leave AssigneeRole empty — the stage name ("requester"/"provider") is a
		// workflow stage, NOT a role any user holds, so addressing the task to it
		// makes validateOrchestratorActor reject every decider (only admin:* would
		// escape) and the request stalls permanently. The stage is still recorded
		// in metadata for display/audit. With no assignee-role the controls are the
		// route gate (RequirePermission lex:request:approve) plus the service-level
		// requireDistinctDecisionAuthor (decider != request author) — the same gate
		// the Approve button uses, so every legitimate approver can clear the task.
		task := &workflowmodel.HumanTask{
			TenantID:   tenantID.String(),
			InstanceID: instance.ID,
			StepID:     requestApprovalStepID,
			StepExecID: stepExec.ID,
			Name:       "Approve request",
			Status:     workflowmodel.TaskStatusPending,
			FormSchema: formSchema,
			FormData:   map[string]any{},
			Metadata:   cloneAnyMap(baseMetadata),
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		return []*workflowmodel.HumanTask{task}
	}

	tasks := make([]*workflowmodel.HumanTask, 0, len(pending))
	for idx, approver := range pending {
		meta := cloneAnyMap(baseMetadata)
		meta["approver_index"] = idx
		meta["approver_type"] = approver.Type
		meta["approver_ref"] = approver.Ref
		task := &workflowmodel.HumanTask{
			TenantID:   tenantID.String(),
			InstanceID: instance.ID,
			StepID:     requestApprovalStepID,
			StepExecID: stepExec.ID,
			Name:       "Approve request",
			Status:     workflowmodel.TaskStatusPending,
			FormSchema: formSchema,
			FormData:   map[string]any{},
			Metadata:   meta,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		switch approver.Type {
		case "role":
			role := approver.Ref
			task.AssigneeRole = &role
		default:
			assignee := approver.Ref
			task.AssigneeID = &assignee
		}
		tasks = append(tasks, task)
	}
	return tasks
}

// ensureDefinition lazily creates (once per tenant) the shared request-approval
// workflow definition. Mirrors WorkflowService.ensureReviewDefinition.
func (s *RequestApprovalService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, requestApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load request approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        requestApprovalWorkflowName,
		Description: "Subject-agnostic legal request approval workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"request_id":     {Type: "string"},
			"request_number": {Type: "string"},
			"request_type":   {Type: "string"},
			"stage":          {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: requestApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Request Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create request approval definition", err)
	}
	return definition, nil
}

func requestApprovalFormSchema() []workflowmodel.FormField {
	return []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
}

// approvalConfigFromRecommendation derives the executor ApprovalConfig + the
// approver list from a resolved policy recommendation. A nil/unmatched
// recommendation yields an empty config (the caller falls back to a single
// stage-addressed task).
func approvalConfigFromRecommendation(rec *model.RequestApprovalPolicyRecommendation) (workflowexec.ApprovalConfig, []model.ApprovalPolicyApprover) {
	cfg := workflowexec.ApprovalConfig{Mode: workflowexec.ApprovalModeSequential, Quorum: workflowexec.QuorumAll}
	if rec == nil || !rec.Matched || rec.Policy == nil {
		return cfg, nil
	}
	policy := rec.Policy
	if policy.Mode == workflowexec.ApprovalModeParallel {
		cfg.Mode = workflowexec.ApprovalModeParallel
	}
	switch policy.Quorum {
	case workflowexec.QuorumAny, workflowexec.QuorumNofM:
		cfg.Quorum = policy.Quorum
	}
	for _, approver := range policy.Approvers {
		cfg.Approvers = append(cfg.Approvers, workflowexec.Approver{Type: approver.Type, Ref: approver.Ref})
	}
	if cfg.Quorum == workflowexec.QuorumNofM && policy.QuorumN != nil {
		cfg.QuorumN = *policy.QuorumN
		if cfg.QuorumN > len(cfg.Approvers) {
			cfg.QuorumN = len(cfg.Approvers)
		}
	}
	return cfg, policy.Approvers
}

func approverConfigList(approvers []workflowexec.Approver) []any {
	out := make([]any, 0, len(approvers))
	for _, approver := range approvers {
		out = append(out, map[string]any{"type": approver.Type, "ref": approver.Ref})
	}
	return out
}
