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
	apperrors "github.com/clario360/platform/internal/errors"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexpression "github.com/clario360/platform/internal/workflow/expression"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const legalReviewWorkflowName = "Lex Contract Review"
const maxBulkWorkflowDecisionItems = 50

type WorkflowService struct {
	db        *pgxpool.Pool
	defRepo   *workflowrepo.DefinitionRepository
	instRepo  *workflowrepo.InstanceRepository
	taskRepo  *workflowrepo.TaskRepository
	contracts *repository.ContractRepository
	policyGov *repository.ApprovalPolicyGovernanceRepository
	// authorityValidator cryptographically validates Delegation-of-Authority
	// evidence (cert chain + detached signature + validity + bound amount) when
	// configured. Nil => no PKI validation (plain-text fallback, Feature 3).
	authorityValidator AuthorityEvidenceValidator
	// authorityRootsConfigured records whether trusted roots were supplied so the
	// service can require cryptographic evidence strictly (vs. logging a warning
	// and accepting plain-text when no roots exist).
	authorityRootsConfigured bool
	publisher                Publisher
	metrics                  *metrics.Metrics
	topic                    string
	logger                   zerolog.Logger
	now                      func() time.Time
}

// AuthorityEvidenceValidator is the seam over the lex/crypto DoA evidence
// validator. It is an interface (not the concrete type) so the workflow service
// can be unit-tested with a stub and remains decoupled from crypto wiring.
type AuthorityEvidenceValidator interface {
	Validate(ctx context.Context, in lexcrypto.AuthorityEvidenceInput) (*lexcrypto.VerifiedAuthority, error)
}

// WithAuthorityEvidenceValidator wires the PKI authority-evidence validator into
// the service. rootsConfigured indicates whether trusted roots were supplied;
// when true the service validates cryptographic evidence strictly, when false it
// falls back to plain-text acceptance (the caller is expected to have logged a
// warning). It is additive and chainable so existing call sites are unaffected.
func (s *WorkflowService) WithAuthorityEvidenceValidator(v AuthorityEvidenceValidator, rootsConfigured bool) *WorkflowService {
	s.authorityValidator = v
	s.authorityRootsConfigured = rootsConfigured
	return s
}

// errPolicyGovUnconfigured is returned when an approval-policy governance
// surface (versioning/audit/templates/conflict) is exercised before the
// governance repository has been wired in via WithPolicyGov.
var errPolicyGovUnconfigured = errors.New("approval policy governance repository not configured")

// WithPolicyGov wires the approval-policy governance repository (version
// history, append-only audit log, templates, conflict detection) into the
// service. It is additive and chainable so existing constructor call sites
// remain unchanged.
func (s *WorkflowService) WithPolicyGov(policyGov *repository.ApprovalPolicyGovernanceRepository) *WorkflowService {
	s.policyGov = policyGov
	return s
}

type workflowDecisionTarget struct {
	workflowInstanceID uuid.UUID
	workflowStatus     string
	stepID             string
	stepExecID         uuid.UUID
	taskStatus         string
	assigneeID         *uuid.UUID
	assigneeRole       *string
	claimedBy          *uuid.UUID
	formSchema         []workflowmodel.FormField
	taskMetadata       map[string]any
	slaDeadline        *time.Time
	contractID         uuid.UUID
	contractTitle      string
	contractStatus     model.ContractStatus
	contractValue      *float64
	contractCurrency   string
	contractCreatedBy  uuid.UUID
}

type watheeqApprovalPolicy struct {
	PolicyID                 string
	Name                     string
	RequiredRole             string
	RequiredAuthorityAmount  *float64
	Currency                 string
	RequireAuthorityEvidence bool
	RequiredFormFields       []string
	Mode                     string
	Quorum                   string
	QuorumN                  *int
	Approvers                []approvalPolicyApprover
	Source                   string
}

type approvalPolicyApprover struct {
	Type  string
	Ref   string
	Label string
}

func NewWorkflowService(db *pgxpool.Pool, defRepo *workflowrepo.DefinitionRepository, instRepo *workflowrepo.InstanceRepository, taskRepo *workflowrepo.TaskRepository, contracts *repository.ContractRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *WorkflowService {
	return &WorkflowService{
		db:        db,
		defRepo:   defRepo,
		instRepo:  instRepo,
		taskRepo:  taskRepo,
		contracts: contracts,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-workflows").Logger(),
		now:       time.Now,
	}
}

func (s *WorkflowService) StartContractReview(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.ReviewContractRequest) (*model.LegalWorkflowSummary, error) {
	if s.defRepo == nil || s.instRepo == nil || s.taskRepo == nil {
		return nil, internalError("workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	if contract.WorkflowInstanceID != nil {
		return nil, conflictError("contract already has an active workflow instance")
	}
	req = normalizeReviewContractRequest(req)
	persistentPolicy, err := s.resolveReviewApprovalPolicy(ctx, tenantID, contract, req)
	if err != nil {
		return nil, err
	}
	var approvalPolicy *watheeqApprovalPolicy
	if persistentPolicy != nil {
		approvalPolicy = approvalPolicyToWatheeqPolicy(persistentPolicy, contract)
		req.FormFields = append(workflowFormFieldsFromApprovalPolicy(persistentPolicy), req.FormFields...)
	} else {
		approvalPolicy, err = buildWatheeqApprovalPolicy(req.ApprovalPolicy, contract)
		if err != nil {
			return nil, err
		}
	}
	formSchema, requiredFormFields, err := buildWatheeqApprovalFormSchema(req.FormFields, approvalPolicy)
	if err != nil {
		return nil, err
	}
	delegation, err := buildOutOfOfficeDelegationMetadata(req.OutOfOffice, req.ApproverUserID)
	if err != nil {
		return nil, err
	}

	definition, err := s.ensureReviewDefinition(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	instance := &workflowmodel.WorkflowInstance{
		ID:            uuid.NewString(),
		TenantID:      tenantID.String(),
		DefinitionID:  definition.ID,
		DefinitionVer: definition.Version,
		Status:        workflowmodel.InstanceStatusRunning,
		CurrentStepID: ptrString("legal_review"),
		Variables: map[string]any{
			"contract_id":       contract.ID.String(),
			"contract_title":    contract.Title,
			"contract_type":     string(contract.Type),
			"contract_value":    contract.TotalValue,
			"contract_currency": contract.Currency,
			"approval_policy":   approvalPolicyMetadata(approvalPolicy),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start workflow transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create workflow instance", err)
	}
	stepType := workflowmodel.StepTypeHumanTask
	if approvalPolicyHasApprovers(approvalPolicy) {
		stepType = workflowmodel.StepTypeApprovalChain
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     "legal_review",
		StepType:   stepType,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create workflow step execution", err)
	}
	tasks, err := s.buildReviewTasks(tenantID, contract, instance, stepExec, req, approvalPolicy, formSchema, requiredFormFields, delegation, now)
	if err != nil {
		return nil, err
	}
	for _, task := range tasks {
		if err := insertWorkflowTask(ctx, tx, task); err != nil {
			return nil, internalError("create workflow task", err)
		}
	}
	task := tasks[0]
	workflowID := uuid.MustParse(instance.ID)
	if err := s.contracts.SetWorkflowInstance(ctx, tx, tenantID, contract.ID, &workflowID); err != nil {
		return nil, internalError("link workflow to contract", err)
	}
	if contract.Status == model.ContractStatusDraft {
		prev := contract.Status
		if err := s.contracts.UpdateStatus(ctx, tx, tenantID, contract.ID, &prev, model.ContractStatusInternalReview, &userID, now, nil); err != nil {
			return nil, internalError("move contract to internal review", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit workflow transaction", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.review_started", tenantID, &userID, map[string]any{
		"id":                   contract.ID,
		"workflow_instance_id": workflowID,
		"approval_policy_id":   approvalPolicyID(approvalPolicy),
		"approval_mode":        approvalPolicyMode(approvalPolicy),
		"approval_quorum":      approvalPolicyQuorum(approvalPolicy),
		"approver_tasks":       len(tasks),
	}, s.logger)
	return &model.LegalWorkflowSummary{
		WorkflowInstanceID: workflowID,
		TaskID:             ptrUUID(uuid.MustParse(task.ID)),
		ContractID:         contract.ID,
		ContractTitle:      contract.Title,
		ContractStatus:     model.ContractStatusInternalReview,
		WorkflowStatus:     instance.Status,
		CurrentStepID:      instance.CurrentStepID,
		StartedAt:          now,
		TaskStatus:         &task.Status,
		ApprovalPolicy:     approvalPolicyMetadata(approvalPolicy),
		Delegation:         delegation,
	}, nil
}

func (s *WorkflowService) buildReviewTasks(tenantID uuid.UUID, contract *model.Contract, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, req dto.ReviewContractRequest, approvalPolicy *watheeqApprovalPolicy, formSchema []workflowmodel.FormField, requiredFormFields []string, delegation map[string]any, now time.Time) ([]*workflowmodel.HumanTask, error) {
	baseMetadata := map[string]any{
		"contract_id":          contract.ID.String(),
		"contract_title":       contract.Title,
		"contract_value":       contract.TotalValue,
		"contract_currency":    contract.Currency,
		"approval_policy":      approvalPolicyMetadata(approvalPolicy),
		"required_form_fields": requiredFormFields,
		"authority_evidence":   approvalAuthorityRequirementMetadata(approvalPolicy),
		"watheeq_controls":     []string{"WTQ-004", "WTQ-INT", "WTQ-WFL-02", "WTQ-WFL-03", "WTQ-SEC-10"},
		"source":               "watheeq_contract_review",
	}
	if delegation != nil {
		baseMetadata["delegation"] = delegation
	}

	approvers := approvalPolicyApproversForStart(approvalPolicy)
	if len(approvers) == 0 {
		task := &workflowmodel.HumanTask{
			TenantID:     tenantID.String(),
			InstanceID:   instance.ID,
			StepID:       "legal_review",
			StepExecID:   stepExec.ID,
			Name:         "Review contract",
			Description:  req.Description,
			Status:       workflowmodel.TaskStatusPending,
			AssigneeRole: normalizeOptionalString(req.ApproverRole),
			FormSchema:   formSchema,
			Metadata:     cloneAnyMap(baseMetadata),
		}
		if req.ApproverUserID != nil {
			assignee := req.ApproverUserID.String()
			task.AssigneeID = &assignee
		}
		if delegation != nil {
			if delegatedTo, ok := delegation["delegated_to"].(string); ok && delegatedTo != "" {
				task.AssigneeID = &delegatedTo
			}
		}
		if req.SLAHours > 0 {
			deadline := now.Add(time.Duration(req.SLAHours) * time.Hour)
			task.SLADeadline = &deadline
		}
		return []*workflowmodel.HumanTask{task}, nil
	}

	chainConfig := approvalChainConfig(approvalPolicy)
	tasks := make([]*workflowmodel.HumanTask, 0, len(approvers))
	for index, approver := range approvers {
		task := &workflowmodel.HumanTask{
			TenantID:    tenantID.String(),
			InstanceID:  instance.ID,
			StepID:      "legal_review",
			StepExecID:  stepExec.ID,
			Name:        "Review contract",
			Description: req.Description,
			Status:      workflowmodel.TaskStatusPending,
			FormSchema:  formSchema,
			Metadata:    cloneAnyMap(baseMetadata),
		}
		task.Metadata["approval_chain"] = true
		task.Metadata["approval_chain_config"] = chainConfig
		task.Metadata["approval_mode"] = approvalPolicy.Mode
		task.Metadata["approval_quorum"] = approvalPolicy.Quorum
		if approvalPolicy.QuorumN != nil {
			task.Metadata["approval_quorum_n"] = *approvalPolicy.QuorumN
		}
		task.Metadata["approver_index"] = index
		task.Metadata["approver_total"] = len(approvalPolicy.Approvers)
		task.Metadata["approver_type"] = approver.Type
		task.Metadata["approver_ref"] = approver.Ref
		if approver.Label != "" {
			task.Metadata["approver_label"] = approver.Label
		}
		switch approver.Type {
		case "user":
			assignee := approver.Ref
			task.AssigneeID = &assignee
		case "role":
			role := approver.Ref
			task.AssigneeRole = &role
		default:
			return nil, validationError("approval policy approver type must be user or role", map[string]string{"approvers.type": "invalid"})
		}
		if req.SLAHours > 0 {
			deadline := now.Add(time.Duration(req.SLAHours) * time.Hour)
			task.SLADeadline = &deadline
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

// ListActive returns the tenant-wide active contract-review queue. It is kept
// for portfolio/reporting consumers that intentionally need the whole queue.
func (s *WorkflowService) ListActive(ctx context.Context, tenantID uuid.UUID, page, perPage int) ([]model.LegalWorkflowSummary, int, error) {
	return s.listActive(ctx, tenantID, nil, nil, false, page, perPage)
}

// ListActiveForActor returns only tasks the actor can actually decide. This is
// the queue contract used by "Awaiting me": assignment, claim, role, capability,
// and contract-author separation-of-duties are applied before COUNT/pagination.
// The final decision endpoint repeats the same checks under row locks; this read
// filter improves correctness and UX without becoming an authorization bypass.
func (s *WorkflowService) ListActiveForActor(ctx context.Context, tenantID, userID uuid.UUID, roles []string, page, perPage int) ([]model.LegalWorkflowSummary, int, error) {
	if !auth.HasAnyPermissionCtx(ctx, roles, auth.PermLexContractApprove, auth.PermLexContractEdit) {
		return []model.LegalWorkflowSummary{}, 0, nil
	}
	normalizedRoles := make([]string, 0, len(roles))
	seen := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		normalized := normalizeWorkflowRole(role)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		normalizedRoles = append(normalizedRoles, normalized)
	}
	return s.listActive(
		ctx,
		tenantID,
		&userID,
		normalizedRoles,
		auth.HasPermission(roles, auth.PermAdminAll),
		page,
		perPage,
	)
}

func (s *WorkflowService) listActive(ctx context.Context, tenantID uuid.UUID, actorID *uuid.UUID, actorRoles []string, bypassRole bool, page, perPage int) ([]model.LegalWorkflowSummary, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	var total int
	if err := s.db.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM workflow_instances wi
			JOIN contracts c ON c.workflow_instance_id = wi.id
			JOIN workflow_tasks wt ON wt.instance_id = wi.id AND wt.tenant_id = wi.tenant_id
			WHERE wi.tenant_id = $1
			  AND wi.status = 'running'
			  AND wt.status IN ('pending','claimed','escalated')
			  AND c.deleted_at IS NULL
			  AND (
			    $2::uuid IS NULL
			    OR (
			      (wt.claimed_by IS NULL OR wt.claimed_by = $2)
			      AND (wt.assignee_id IS NULL OR wt.assignee_id = $2)
			      AND (
			        $4
			        OR NULLIF(BTRIM(wt.assignee_role), '') IS NULL
			        OR REPLACE(LOWER(BTRIM(wt.assignee_role)), '-', '_') = ANY($3::text[])
			      )
			      AND c.created_by IS NOT NULL
			      AND c.created_by <> $2
			    )
			  )`,
		tenantID, actorID, actorRoles, bypassRole,
	).Scan(&total); err != nil {
		return nil, 0, internalError("count workflows", err)
	}
	if total == 0 {
		return []model.LegalWorkflowSummary{}, 0, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT wi.id, wt.id::text, c.id, c.title, c.status, wi.status, wi.current_step_id, wi.started_at,
		       wt.assignee_id, wt.assignee_role, wt.status, wt.sla_deadline, wt.metadata
		FROM workflow_instances wi
		JOIN contracts c ON c.workflow_instance_id = wi.id
		JOIN workflow_tasks wt ON wt.instance_id = wi.id AND wt.tenant_id = wi.tenant_id
		WHERE wi.tenant_id = $1
		  AND wi.status = 'running'
		  AND wt.status IN ('pending','claimed','escalated')
		  AND c.deleted_at IS NULL
		  AND (
		    $2::uuid IS NULL
		    OR (
		      (wt.claimed_by IS NULL OR wt.claimed_by = $2)
		      AND (wt.assignee_id IS NULL OR wt.assignee_id = $2)
		      AND (
		        $4
		        OR NULLIF(BTRIM(wt.assignee_role), '') IS NULL
		        OR REPLACE(LOWER(BTRIM(wt.assignee_role)), '-', '_') = ANY($3::text[])
		      )
		      AND c.created_by IS NOT NULL
		      AND c.created_by <> $2
		    )
		  )
		ORDER BY wi.started_at DESC, wt.created_at ASC
		LIMIT $5 OFFSET $6`,
		tenantID, actorID, actorRoles, bypassRole, perPage, (page-1)*perPage,
	)
	if err != nil {
		return nil, 0, internalError("list workflows", err)
	}
	defer rows.Close()
	items := make([]model.LegalWorkflowSummary, 0)
	for rows.Next() {
		var item model.LegalWorkflowSummary
		var taskID *string
		var assigneeID *string
		var taskMetadataJSON []byte
		if err := rows.Scan(&item.WorkflowInstanceID, &taskID, &item.ContractID, &item.ContractTitle, &item.ContractStatus, &item.WorkflowStatus, &item.CurrentStepID, &item.StartedAt, &assigneeID, &item.AssigneeRole, &item.TaskStatus, &item.SLADeadline, &taskMetadataJSON); err != nil {
			return nil, 0, internalError("scan workflows", err)
		}
		if taskID != nil {
			parsed := uuid.MustParse(*taskID)
			item.TaskID = &parsed
		}
		if assigneeID != nil {
			parsed := uuid.MustParse(*assigneeID)
			item.AssigneeID = &parsed
		}
		if len(taskMetadataJSON) > 0 {
			var taskMetadata map[string]any
			if err := json.Unmarshal(taskMetadataJSON, &taskMetadata); err != nil {
				return nil, 0, internalError("decode workflow task metadata", err)
			}
			item.ApprovalPolicy = mapFromAny(taskMetadata["approval_policy"])
			item.Delegation = mapFromAny(taskMetadata["delegation"])
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (s *WorkflowService) DecideTask(ctx context.Context, tenantID, userID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*model.LegalWorkflowDecisionResult, error) {
	req = normalizeWorkflowDecisionRequest(req)
	if err := validateWorkflowDecisionRequest(req); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start workflow decision transaction", err)
	}
	defer tx.Rollback(ctx)

	target, err := s.lockWorkflowDecisionTarget(ctx, tx, tenantID, workflowInstanceID, taskID)
	if err != nil {
		return nil, err
	}
	if target.workflowStatus != workflowmodel.InstanceStatusRunning {
		return nil, conflictError("workflow is not running")
	}
	if !workflowTaskCanBeDecided(target.taskStatus) {
		return nil, conflictError("workflow task has already been decided")
	}
	if err := validateWorkflowDecisionActor(ctx, userID, target); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	lateJustification, err := validateLateJustification(target.slaDeadline, now, req.LateJustification)
	if err != nil {
		return nil, err
	}
	// Dynamic-SoD parity (design v2 §4.2): the actor who AUTHORED the contract may
	// not render the approve/reject verdict on their own contract, regardless of the
	// capability key they hold. This is the route-level lexmw.RequireDistinctActor
	// guard's equivalent for the workflow-decision path, where the contract id is not
	// a URL param (the route keys off {workflowInstanceID}/{taskID}) so the URL-keyed
	// middleware cannot be wired. The contract row is already locked above, so its
	// created_by is authoritative. Fails CLOSED when the author cannot be resolved.
	if err := validateWorkflowDecisionDistinctAuthor(userID, target); err != nil {
		return nil, err
	}
	if err := validateWorkflowDecisionFormData(req, target.formSchema); err != nil {
		return nil, err
	}
	approvalPolicy := approvalPolicyFromMetadata(target.taskMetadata)
	if err := validateWorkflowAuthorityEvidence(req, target, approvalPolicy); err != nil {
		return nil, err
	}
	if err := s.validateAuthorityEvidencePKI(ctx, req, target, approvalPolicy); err != nil {
		return nil, err
	}
	delegation, err := workflowDecisionDelegationMetadata(req, userID)
	if err != nil {
		return nil, err
	}

	nextContractStatus := target.contractStatus
	workflowStatus := workflowmodel.InstanceStatusCompleted
	taskStatus := workflowmodel.TaskStatusCompleted
	stepStatus := workflowmodel.StepStatusCompleted
	currentStepID := ptrString("end")
	var errorMessage *string

	switch req.Decision {
	case "approve":
		if err := validateContractWorkflowTransition(string(target.contractStatus), string(model.ContractStatusPendingSignature)); err != nil {
			return nil, conflictError("contract status does not allow approval")
		}
		// A completed manager approval is the legal sign-off gate. Move the
		// contract directly into the only state from which SignatureService.Send
		// is allowed, so the approval and signing steps form one uninterrupted
		// workflow. Manual legal-review/negotiation transitions remain available
		// for contracts that are not using this approval workflow.
		nextContractStatus = model.ContractStatusPendingSignature
	case "request_changes":
		if target.contractStatus != model.ContractStatusDraft {
			if err := ValidateContractTransition(string(target.contractStatus), string(model.ContractStatusDraft)); err != nil {
				return nil, conflictError("contract status does not allow request_changes")
			}
			nextContractStatus = model.ContractStatusDraft
		}
	case "reject":
		workflowStatus = workflowmodel.InstanceStatusFailed
		taskStatus = workflowmodel.TaskStatusRejected
		stepStatus = workflowmodel.StepStatusFailed
		currentStepID = &target.stepID
		msg := "contract review rejected"
		errorMessage = &msg
		if target.contractStatus != model.ContractStatusDraft {
			if err := ValidateContractTransition(string(target.contractStatus), string(model.ContractStatusDraft)); err != nil {
				return nil, conflictError("contract status does not allow rejection")
			}
			nextContractStatus = model.ContractStatusDraft
		}
	}
	plan, err := s.planApprovalChainDecision(ctx, tx, tenantID, userID, taskID, target, req, workflowDecisionPlan{
		nextContractStatus: nextContractStatus,
		workflowStatus:     workflowStatus,
		stepStatus:         stepStatus,
		currentStepID:      currentStepID,
		errorMessage:       errorMessage,
	}, now)
	if err != nil {
		return nil, err
	}
	nextContractStatus = plan.nextContractStatus
	workflowStatus = plan.workflowStatus
	stepStatus = plan.stepStatus
	currentStepID = plan.currentStepID
	errorMessage = plan.errorMessage
	releaseContractWorkflowLink :=
		(req.Decision == "request_changes" && workflowStatus == workflowmodel.InstanceStatusCompleted) ||
			(req.Decision == "reject" && workflowStatus == workflowmodel.InstanceStatusFailed)

	formData := workflowDecisionFormData(req, userID, now)
	formData["previous_contract_status"] = string(target.contractStatus)
	formData["contract_status"] = string(nextContractStatus)
	formData["workflow_status"] = workflowStatus
	formData["task_status"] = taskStatus
	formData["contract_workflow_link_released"] = releaseContractWorkflowLink

	formDataJSON, err := json.Marshal(formData)
	if err != nil {
		return nil, internalError("marshal workflow decision form data", err)
	}
	metadataPatch := workflowDecisionMetadata(req, target, userID, now, nextContractStatus, workflowStatus, taskStatus)
	metadataPatch["contract_workflow_link_released"] = releaseContractWorkflowLink
	if delegation != nil {
		metadataPatch["delegation"] = delegation
	}
	metadataJSON, err := json.Marshal(metadataPatch)
	if err != nil {
		return nil, internalError("marshal workflow decision metadata", err)
	}

	if err := s.updateWorkflowTaskDecision(ctx, tx, tenantID, taskID, userID, taskStatus, formDataJSON, metadataJSON, now, lateJustification, legalContractsManagerRole); err != nil {
		return nil, err
	}
	if plan.cancelPendingTasks {
		if err := cancelPendingApprovalTasks(ctx, tx, tenantID, workflowInstanceID, target.stepID, taskID, now); err != nil {
			return nil, err
		}
	}
	if plan.nextTask != nil {
		if err := insertWorkflowTask(ctx, tx, plan.nextTask); err != nil {
			return nil, internalError("create next sequential approval task", err)
		}
	}
	if err := s.updateWorkflowStepDecision(ctx, tx, workflowInstanceID, target.stepExecID, stepStatus, formDataJSON, errorMessage, now); err != nil {
		return nil, err
	}
	if nextContractStatus != target.contractStatus {
		prev := target.contractStatus
		if err := s.contracts.UpdateStatus(ctx, tx, tenantID, target.contractID, &prev, nextContractStatus, &userID, now, nil); err != nil {
			return nil, internalError("update contract status from workflow decision", err)
		}
	}
	if releaseContractWorkflowLink {
		// Only detach the contract's active pointer. The completed/failed workflow,
		// task, step execution, decision form data, and metadata remain intact as
		// immutable audit history and still carry the contract ID.
		if err := s.contracts.SetWorkflowInstance(ctx, tx, tenantID, target.contractID, nil); err != nil {
			return nil, internalError("release terminal contract review workflow", err)
		}
	}
	if err := s.updateWorkflowInstanceDecision(ctx, tx, tenantID, workflowInstanceID, target.stepID, workflowStatus, currentStepID, formDataJSON, errorMessage, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit workflow decision transaction", err)
	}

	result := &model.LegalWorkflowDecisionResult{
		WorkflowInstanceID:     workflowInstanceID,
		TaskID:                 taskID,
		ContractID:             target.contractID,
		PreviousContractStatus: target.contractStatus,
		ContractStatus:         nextContractStatus,
		WorkflowStatus:         workflowStatus,
		TaskStatus:             taskStatus,
		Decision:               req.Decision,
		DecidedBy:              userID,
		DecidedAt:              now,
		Notes:                  req.Notes,
		Metadata:               metadataPatch,
		AuthorityEvidence:      workflowAuthorityEvidenceMetadata(req.AuthorityEvidence),
		Delegation:             delegation,
	}

	if nextContractStatus != target.contractStatus {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.status_changed", tenantID, &userID, map[string]any{
			"id":                   target.contractID,
			"old_status":           target.contractStatus,
			"new_status":           nextContractStatus,
			"changed_by":           userID,
			"workflow_instance_id": workflowInstanceID,
			"task_id":              taskID,
			"source":               "workflow_decision",
		}, s.logger)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.workflow_decided", tenantID, &userID, map[string]any{
		"id":                       target.contractID,
		"workflow_instance_id":     workflowInstanceID,
		"task_id":                  taskID,
		"decision":                 req.Decision,
		"decided_by":               userID,
		"decided_at":               now,
		"previous_contract_status": target.contractStatus,
		"contract_status":          nextContractStatus,
		"contract_status_changed":  nextContractStatus != target.contractStatus,
		"workflow_status":          workflowStatus,
		"task_status":              taskStatus,
		"metadata":                 req.Metadata,
	}, s.logger)

	return result, nil
}

func (s *WorkflowService) BulkDecideTasks(ctx context.Context, tenantID, userID uuid.UUID, req dto.WorkflowBulkDecisionRequest) (*model.LegalWorkflowBulkDecisionResult, error) {
	if len(req.Items) == 0 {
		return nil, validationError("at least one workflow task is required", map[string]string{"items": "required"})
	}
	if len(req.Items) > maxBulkWorkflowDecisionItems {
		return nil, validationError("bulk workflow decisions are limited to 50 tasks", map[string]string{"items": "too_many"})
	}

	baseReq := normalizeWorkflowDecisionRequest(dto.WorkflowDecisionRequest{
		Decision:          req.Decision,
		Notes:             req.Notes,
		Metadata:          cloneAnyMap(req.Metadata),
		FormData:          cloneAnyMap(req.FormData),
		AuthorityEvidence: req.AuthorityEvidence,
		LateJustification: req.LateJustification,
	})
	if err := validateWorkflowDecisionRequest(baseReq); err != nil {
		return nil, err
	}

	aggregate := &model.LegalWorkflowBulkDecisionResult{
		Decision:  baseReq.Decision,
		Requested: len(req.Items),
		DecidedBy: userID,
		DecidedAt: s.now().UTC(),
		Results:   []model.LegalWorkflowDecisionResult{},
		Errors:    []model.LegalWorkflowBulkDecisionError{},
	}
	seen := make(map[string]struct{}, len(req.Items))
	for index, item := range req.Items {
		if item.WorkflowInstanceID == uuid.Nil || item.TaskID == uuid.Nil {
			aggregate.Errors = append(aggregate.Errors, model.LegalWorkflowBulkDecisionError{
				WorkflowInstanceID: item.WorkflowInstanceID,
				TaskID:             item.TaskID,
				Code:               "VALIDATION_ERROR",
				Message:            "workflow_instance_id and task_id are required",
			})
			continue
		}
		key := item.WorkflowInstanceID.String() + ":" + item.TaskID.String()
		if _, exists := seen[key]; exists {
			aggregate.Errors = append(aggregate.Errors, model.LegalWorkflowBulkDecisionError{
				WorkflowInstanceID: item.WorkflowInstanceID,
				TaskID:             item.TaskID,
				Code:               "VALIDATION_ERROR",
				Message:            "duplicate workflow task in bulk decision request",
			})
			continue
		}
		seen[key] = struct{}{}

		itemReq := workflowDecisionRequestForBulkItem(baseReq, item, index)
		result, err := s.DecideTask(ctx, tenantID, userID, item.WorkflowInstanceID, item.TaskID, itemReq)
		if err != nil {
			code, message := workflowBulkDecisionError(err)
			aggregate.Errors = append(aggregate.Errors, model.LegalWorkflowBulkDecisionError{
				WorkflowInstanceID: item.WorkflowInstanceID,
				TaskID:             item.TaskID,
				Code:               code,
				Message:            message,
			})
			continue
		}
		aggregate.Results = append(aggregate.Results, *result)
	}
	aggregate.Succeeded = len(aggregate.Results)
	aggregate.Failed = len(aggregate.Errors)

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.workflow_bulk_decided", tenantID, &userID, map[string]any{
		"decision":   aggregate.Decision,
		"requested":  aggregate.Requested,
		"succeeded":  aggregate.Succeeded,
		"failed":     aggregate.Failed,
		"decided_by": userID,
		"decided_at": aggregate.DecidedAt,
	}, s.logger)

	return aggregate, nil
}

func (s *WorkflowService) AdvanceOnWorkflowCompletion(ctx context.Context, workflowInstanceID uuid.UUID) error {
	contract, err := s.contracts.GetByWorkflowInstance(ctx, workflowInstanceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return internalError("load workflow contract", err)
	}
	if contract.Status != model.ContractStatusInternalReview {
		return nil
	}
	if err := validateContractWorkflowTransition(string(contract.Status), string(model.ContractStatusPendingSignature)); err != nil {
		return conflictError("contract status does not allow workflow completion")
	}
	now := s.now().UTC()
	prev := contract.Status
	if err := s.contracts.UpdateStatus(ctx, s.db, contract.TenantID, contract.ID, &prev, model.ContractStatusPendingSignature, nil, now, nil); err != nil {
		return internalError("advance contract after workflow completion", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.status_changed", contract.TenantID, nil, map[string]any{
		"id":                   contract.ID,
		"old_status":           prev,
		"new_status":           model.ContractStatusPendingSignature,
		"workflow_instance_id": workflowInstanceID,
		"source":               "workflow_instance_completed",
	}, s.logger)
	return nil
}

func (s *WorkflowService) ensureReviewDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, legalReviewWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load workflow definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        legalReviewWorkflowName,
		Description: "Legal contract review workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"contract_id":    {Type: "string"},
			"contract_title": {Type: "string"},
			"contract_type":  {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: "legal_review", Type: workflowmodel.StepTypeHumanTask, Name: "Legal Review", Config: map[string]any{"role": "legal"}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create workflow definition", err)
	}
	return definition, nil
}

func (s *WorkflowService) lockWorkflowDecisionTarget(ctx context.Context, tx pgx.Tx, tenantID, workflowInstanceID, taskID uuid.UUID) (workflowDecisionTarget, error) {
	var target workflowDecisionTarget
	var formSchemaJSON []byte
	var taskMetadataJSON []byte
	err := tx.QueryRow(ctx, `
		SELECT wi.id, wi.status, wt.step_id, wt.step_exec_id, wt.status,
		       wt.assignee_id, wt.assignee_role, wt.claimed_by,
		       wt.form_schema, wt.metadata, wt.sla_deadline,
		       c.id, c.title, c.status, c.total_value, c.currency, c.created_by
		FROM workflow_instances wi
		JOIN workflow_tasks wt ON wt.instance_id = wi.id
		JOIN contracts c ON c.workflow_instance_id = wi.id
		WHERE wi.id = $1
		  AND wt.id = $2
		  AND wi.tenant_id = $3
		  AND wt.tenant_id = $3
		  AND c.tenant_id = $3
		  AND c.deleted_at IS NULL
		FOR UPDATE OF wi, wt, c`,
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
		&target.contractID,
		&target.contractTitle,
		&target.contractStatus,
		&target.contractValue,
		&target.contractCurrency,
		&target.contractCreatedBy,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return workflowDecisionTarget{}, notFoundError("workflow task not found")
		}
		return workflowDecisionTarget{}, internalError("load workflow task", err)
	}
	if len(formSchemaJSON) > 0 {
		if err := json.Unmarshal(formSchemaJSON, &target.formSchema); err != nil {
			return workflowDecisionTarget{}, internalError("decode workflow task form schema", err)
		}
	}
	target.taskMetadata = map[string]any{}
	if len(taskMetadataJSON) > 0 {
		if err := json.Unmarshal(taskMetadataJSON, &target.taskMetadata); err != nil {
			return workflowDecisionTarget{}, internalError("decode workflow task metadata", err)
		}
	}
	return target, nil
}

func (s *WorkflowService) updateWorkflowTaskDecision(ctx context.Context, tx pgx.Tx, tenantID, taskID, userID uuid.UUID, status string, formDataJSON, metadataJSON []byte, decidedAt time.Time, lateJustification *string, managerRole string) error {
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
		return internalError("update workflow task decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow task not found")
	}
	return nil
}

func (s *WorkflowService) updateWorkflowStepDecision(ctx context.Context, tx pgx.Tx, workflowInstanceID, stepExecID uuid.UUID, status string, outputJSON []byte, errorMessage *string, completedAt time.Time) error {
	ct, err := tx.Exec(ctx, `
		UPDATE workflow_step_executions
		SET status = $3,
		    output_data = $4::jsonb,
		    error_message = $5,
		    started_at = COALESCE(started_at, $6),
		    completed_at = CASE WHEN $3 IN ('completed','failed','skipped','cancelled') THEN $6 ELSE completed_at END
		WHERE id = $1 AND instance_id = $2`,
		stepExecID, workflowInstanceID, status, outputJSON, errorMessage, completedAt,
	)
	if err != nil {
		return internalError("update workflow step decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow step execution not found")
	}
	return nil
}

func (s *WorkflowService) updateWorkflowInstanceDecision(ctx context.Context, tx pgx.Tx, tenantID, workflowInstanceID uuid.UUID, stepID, status string, currentStepID *string, outputJSON []byte, errorMessage *string, completedAt time.Time) error {
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
		return internalError("update workflow instance decision", err)
	}
	if ct.RowsAffected() == 0 {
		return notFoundError("workflow instance not found")
	}
	return nil
}

func normalizeWorkflowDecisionRequest(req dto.WorkflowDecisionRequest) dto.WorkflowDecisionRequest {
	req.Decision = strings.ToLower(strings.TrimSpace(req.Decision))
	req.Notes = normalizeOptionalString(req.Notes)
	req.DelegationReason = normalizeOptionalString(req.DelegationReason)
	req.LateJustification = normalizeOptionalString(req.LateJustification)
	if req.Metadata == nil {
		req.Metadata = map[string]any{}
	}
	if req.FormData == nil {
		req.FormData = map[string]any{}
	}
	if req.AuthorityEvidence != nil {
		req.AuthorityEvidence.PolicyID = strings.TrimSpace(req.AuthorityEvidence.PolicyID)
		req.AuthorityEvidence.Role = normalizeWorkflowRole(req.AuthorityEvidence.Role)
		req.AuthorityEvidence.Currency = normalizeWorkflowCurrency(req.AuthorityEvidence.Currency)
		req.AuthorityEvidence.EvidenceID = strings.TrimSpace(req.AuthorityEvidence.EvidenceID)
		req.AuthorityEvidence.Source = strings.TrimSpace(req.AuthorityEvidence.Source)
	}
	if req.OutOfOffice != nil {
		req.OutOfOffice.Reason = strings.TrimSpace(req.OutOfOffice.Reason)
		req.OutOfOffice.EvidenceID = strings.TrimSpace(req.OutOfOffice.EvidenceID)
	}
	return req
}

func validateWorkflowDecisionRequest(req dto.WorkflowDecisionRequest) error {
	switch req.Decision {
	case "approve", "request_changes", "reject":
	default:
		return validationError("decision must be one of approve, request_changes, reject", map[string]string{"decision": "invalid"})
	}
	if req.DelegatedTo != nil && *req.DelegatedTo == uuid.Nil {
		return validationError("delegated_to must be a valid user id", map[string]string{"delegated_to": "invalid"})
	}
	if req.DelegatedTo != nil && req.DelegationReason == nil {
		return validationError("delegation_reason is required when delegated_to is provided", map[string]string{"delegation_reason": "required"})
	}
	if req.OutOfOffice != nil {
		if err := validateOutOfOfficeDelegation(*req.OutOfOffice, nil); err != nil {
			return err
		}
	}
	return nil
}

func workflowTaskCanBeDecided(status string) bool {
	switch status {
	case workflowmodel.TaskStatusPending, workflowmodel.TaskStatusClaimed, workflowmodel.TaskStatusEscalated:
		return true
	default:
		return false
	}
}

func validateWorkflowDecisionActor(ctx context.Context, userID uuid.UUID, target workflowDecisionTarget) error {
	if target.claimedBy != nil && *target.claimedBy != userID {
		return forbiddenError("workflow task is claimed by another user")
	}
	if target.assigneeID != nil && *target.assigneeID != userID {
		return forbiddenError("workflow task is assigned to another user")
	}
	if target.assigneeRole != nil && strings.TrimSpace(*target.assigneeRole) != "" {
		roles := workflowDecisionActorRoles(ctx, userID)
		if !workflowActorHasRole(roles, *target.assigneeRole) {
			return forbiddenError("workflow task requires the assigned approval role")
		}
	}
	return nil
}

// validateWorkflowDecisionDistinctAuthor enforces the dynamic-SoD invariant
// (author != decider, design v2 §4.2) on the contract-review workflow-decision
// path. The contract drafter may not render the approve/reject verdict on the
// contract they authored, mirroring lexmw.RequireDistinctActor on the dedicated
// /status (sign-off) and DELETE (close) routes. Fails CLOSED: if the contract's
// created_by could not be resolved (zero UUID) the decision is rejected, so an
// unresolved author can never silently bypass the check.
func validateWorkflowDecisionDistinctAuthor(userID uuid.UUID, target workflowDecisionTarget) error {
	if target.contractCreatedBy == uuid.Nil {
		return forbiddenError("contract author could not be resolved for separation-of-duties check")
	}
	if target.contractCreatedBy == userID {
		return forbiddenError("you authored this contract and cannot decide its review (separation of duties)")
	}
	return nil
}

func workflowDecisionActorRoles(ctx context.Context, userID uuid.UUID) []string {
	user := auth.UserFromContext(ctx)
	if user == nil || user.ID != userID.String() {
		return nil
	}
	return user.Roles
}

func workflowActorHasRole(roles []string, requiredRole string) bool {
	required := normalizeWorkflowRole(requiredRole)
	if required == "" {
		return true
	}
	if auth.HasPermission(roles, auth.PermAdminAll) {
		return true
	}
	for _, role := range roles {
		if normalizeWorkflowRole(role) == required {
			return true
		}
	}
	return false
}

func workflowDecisionFormData(req dto.WorkflowDecisionRequest, userID uuid.UUID, decidedAt time.Time) map[string]any {
	formData := make(map[string]any, len(req.FormData)+8)
	for key, value := range req.FormData {
		formData[key] = value
	}
	formData["decision"] = req.Decision
	formData["decided_by"] = userID.String()
	formData["decided_at"] = decidedAt.Format(time.RFC3339Nano)
	formData["metadata"] = req.Metadata
	if req.AuthorityEvidence != nil {
		formData["authority_role"] = req.AuthorityEvidence.Role
		formData["authority_amount"] = req.AuthorityEvidence.AuthorityAmount
		formData["authority_currency"] = req.AuthorityEvidence.Currency
		formData["authority_evidence_ref"] = req.AuthorityEvidence.EvidenceID
		formData["authority_evidence"] = workflowAuthorityEvidenceMetadata(req.AuthorityEvidence)
	}
	if req.Notes != nil {
		formData["notes"] = *req.Notes
	}
	if req.DelegatedTo != nil {
		formData["delegated_to"] = req.DelegatedTo.String()
	}
	if req.DelegationReason != nil {
		formData["delegation_reason"] = *req.DelegationReason
	}
	if req.OutOfOffice != nil && req.OutOfOffice.Active {
		formData["out_of_office"] = outOfOfficeDelegationMetadata(*req.OutOfOffice, nil)
	}
	return formData
}

func workflowDecisionMetadata(req dto.WorkflowDecisionRequest, target workflowDecisionTarget, userID uuid.UUID, decidedAt time.Time, nextContractStatus model.ContractStatus, workflowStatus, taskStatus string) map[string]any {
	metadata := map[string]any{
		"contract_id":              target.contractID.String(),
		"contract_title":           target.contractTitle,
		"workflow_instance_id":     target.workflowInstanceID.String(),
		"decision":                 req.Decision,
		"decided_by":               userID.String(),
		"decided_at":               decidedAt.Format(time.RFC3339Nano),
		"previous_contract_status": string(target.contractStatus),
		"contract_status":          string(nextContractStatus),
		"contract_status_changed":  nextContractStatus != target.contractStatus,
		"workflow_status":          workflowStatus,
		"task_status":              taskStatus,
		"source":                   "lex_workflow_decision",
	}
	if req.Notes != nil {
		metadata["notes"] = *req.Notes
	}
	if len(req.Metadata) > 0 {
		metadata["request_metadata"] = req.Metadata
		for key, value := range req.Metadata {
			if _, exists := metadata[key]; !exists {
				metadata[key] = value
			}
		}
	}
	if req.AuthorityEvidence != nil {
		metadata["authority_evidence"] = workflowAuthorityEvidenceMetadata(req.AuthorityEvidence)
	}
	if req.DelegatedTo != nil {
		metadata["delegated_to"] = req.DelegatedTo.String()
	}
	if req.DelegationReason != nil {
		metadata["delegation_reason"] = *req.DelegationReason
	}
	return metadata
}

func workflowDecisionRequestForBulkItem(base dto.WorkflowDecisionRequest, item dto.WorkflowBulkDecisionTarget, index int) dto.WorkflowDecisionRequest {
	req := dto.WorkflowDecisionRequest{
		Decision:          base.Decision,
		Notes:             base.Notes,
		Metadata:          mergeAnyMaps(base.Metadata, item.Metadata),
		FormData:          mergeAnyMaps(base.FormData, item.FormData),
		AuthorityEvidence: base.AuthorityEvidence,
		LateJustification: base.LateJustification,
	}
	req.Metadata["bulk_decision"] = true
	req.Metadata["bulk_item_index"] = index
	if item.Notes != nil {
		req.Notes = item.Notes
	}
	if item.AuthorityEvidence != nil {
		req.AuthorityEvidence = item.AuthorityEvidence
	}
	if item.LateJustification != nil {
		req.LateJustification = item.LateJustification
	}
	return req
}

func cloneAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func mergeAnyMaps(base, overlay map[string]any) map[string]any {
	out := cloneAnyMap(base)
	for key, value := range overlay {
		out[key] = value
	}
	return out
}

func workflowBulkDecisionError(err error) (string, string) {
	var appErr *apperrors.AppError
	if errors.As(err, &appErr) {
		return appErr.Code, appErr.Message
	}
	return "INTERNAL_ERROR", "workflow task decision failed"
}

func normalizeReviewContractRequest(req dto.ReviewContractRequest) dto.ReviewContractRequest {
	req.Description = strings.TrimSpace(req.Description)
	req.ApproverRole = normalizeOptionalString(req.ApproverRole)
	if req.ApprovalPolicy != nil {
		req.ApprovalPolicy.PolicyID = strings.TrimSpace(req.ApprovalPolicy.PolicyID)
		req.ApprovalPolicy.Name = strings.TrimSpace(req.ApprovalPolicy.Name)
		req.ApprovalPolicy.RequiredRole = normalizeWorkflowRole(req.ApprovalPolicy.RequiredRole)
		req.ApprovalPolicy.Currency = normalizeWorkflowCurrency(req.ApprovalPolicy.Currency)
	}
	if req.OutOfOffice != nil {
		req.OutOfOffice.Reason = strings.TrimSpace(req.OutOfOffice.Reason)
		req.OutOfOffice.EvidenceID = strings.TrimSpace(req.OutOfOffice.EvidenceID)
	}
	return req
}

func buildWatheeqApprovalPolicy(req *dto.ApprovalPolicyRequest, contract *model.Contract) (*watheeqApprovalPolicy, error) {
	if req == nil {
		return nil, nil
	}
	if req.RequiredAuthorityAmount != nil && *req.RequiredAuthorityAmount < 0 {
		return nil, validationError("required_authority_amount must be non-negative", map[string]string{"approval_policy.required_authority_amount": "invalid"})
	}
	requireEvidence := true
	if req.RequireAuthorityEvidence != nil {
		requireEvidence = *req.RequireAuthorityEvidence
	}
	currency := req.Currency
	if strings.TrimSpace(currency) == "" {
		currency = contract.Currency
	}
	policy := &watheeqApprovalPolicy{
		PolicyID:                 req.PolicyID,
		Name:                     req.Name,
		RequiredRole:             req.RequiredRole,
		RequiredAuthorityAmount:  req.RequiredAuthorityAmount,
		Currency:                 normalizeWorkflowCurrency(currency),
		RequireAuthorityEvidence: requireEvidence,
		Source:                   "review_request",
	}
	if policy.RequiredAuthorityAmount == nil && contract.TotalValue != nil {
		amount := *contract.TotalValue
		policy.RequiredAuthorityAmount = &amount
	}
	return policy, nil
}

func buildWatheeqApprovalFormSchema(reqFields []dto.ApprovalFormFieldRequest, policy *watheeqApprovalPolicy) ([]workflowmodel.FormField, []string, error) {
	schema := []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Review notes", Required: false},
	}
	requiredNames := []string{"decision"}
	seen := map[string]struct{}{"decision": {}, "notes": {}}

	if policy != nil && policy.RequireAuthorityEvidence {
		authorityFields := []workflowmodel.FormField{
			{Name: "authority_role", Type: "text", Label: "Approval authority role", Required: true},
			{Name: "authority_amount", Type: "number", Label: "Approval authority amount", Required: true},
			{Name: "authority_currency", Type: "text", Label: "Approval authority currency", Required: true},
			{Name: "authority_evidence_ref", Type: "text", Label: "Approval authority evidence reference", Required: true},
		}
		for _, field := range authorityFields {
			schema = append(schema, field)
			requiredNames = append(requiredNames, field.Name)
			seen[field.Name] = struct{}{}
		}
	}

	for _, reqField := range reqFields {
		field, err := approvalFormField(reqField)
		if err != nil {
			return nil, nil, err
		}
		if _, exists := seen[field.Name]; exists {
			return nil, nil, validationError("approval form field names must be unique and cannot use reserved workflow fields", map[string]string{"form_fields.name": "duplicate"})
		}
		seen[field.Name] = struct{}{}
		schema = append(schema, field)
		if field.Required {
			requiredNames = append(requiredNames, field.Name)
		}
	}

	if policy != nil {
		policy.RequiredFormFields = append([]string(nil), requiredNames...)
	}
	return schema, requiredNames, nil
}

func approvalFormField(req dto.ApprovalFormFieldRequest) (workflowmodel.FormField, error) {
	name := strings.TrimSpace(req.Name)
	fieldType := strings.ToLower(strings.TrimSpace(req.Type))
	label := strings.TrimSpace(req.Label)
	if !validWorkflowFieldName(name) {
		return workflowmodel.FormField{}, validationError("approval form field name must use letters, numbers, or underscore", map[string]string{"form_fields.name": "invalid"})
	}
	if !workflowmodel.ValidFormFieldTypes[fieldType] {
		return workflowmodel.FormField{}, validationError("approval form field type is invalid", map[string]string{"form_fields.type": "invalid"})
	}
	if label == "" {
		return workflowmodel.FormField{}, validationError("approval form field label is required", map[string]string{"form_fields.label": "required"})
	}
	options := normalizeStringOptions(req.Options)
	if fieldType == "select" && len(options) == 0 {
		return workflowmodel.FormField{}, validationError("select approval form fields require options", map[string]string{"form_fields.options": "required"})
	}
	visibleWhen := strings.TrimSpace(req.VisibleWhen)
	if err := validateFormFieldVisibleWhen(visibleWhen); err != nil {
		return workflowmodel.FormField{}, err
	}
	return workflowmodel.FormField{
		Name:        name,
		Type:        fieldType,
		Label:       label,
		Required:    req.Required,
		Options:     options,
		Placeholder: strings.TrimSpace(req.Placeholder),
		Description: strings.TrimSpace(req.Description),
		VisibleWhen: visibleWhen,
	}, nil
}

// validateFormFieldVisibleWhen rejects a malformed conditional-visibility
// expression at write time so an invalid expression can never be persisted onto a
// policy. An empty expression is always valid (field always visible). The
// expression is parsed with the engine's evaluator against an empty data context;
// a parse error is surfaced as a validation error while a successful parse (even
// one that errors only at evaluate time due to missing data) is accepted.
func validateFormFieldVisibleWhen(expr string) error {
	if expr == "" {
		return nil
	}
	_, err := workflowexpression.NewEvaluator().Evaluate(expr, map[string]any{})
	if err == nil {
		return nil
	}
	msg := err.Error()
	// Tokenize/parse failures are structural and must be rejected. Evaluation
	// failures caused by referencing not-yet-present form values are expected
	// against an empty context and must NOT fail validation.
	if strings.Contains(msg, "tokenize error") || strings.Contains(msg, "parse error") ||
		strings.Contains(msg, "unexpected token") || strings.Contains(msg, "maximum length") {
		return validationError("approval form field visible_when expression is invalid", map[string]string{"form_fields.visible_when": "invalid"})
	}
	return nil
}

func buildOutOfOfficeDelegationMetadata(input *dto.OutOfOfficeDelegationInput, approverUserID *uuid.UUID) (map[string]any, error) {
	if input == nil || !input.Active {
		return nil, nil
	}
	if err := validateOutOfOfficeDelegation(*input, approverUserID); err != nil {
		return nil, err
	}
	original := approverUserID
	if input.OriginalApproverUserID != nil {
		original = input.OriginalApproverUserID
	}
	return outOfOfficeDelegationMetadata(*input, original), nil
}

func validateOutOfOfficeDelegation(input dto.OutOfOfficeDelegationInput, approverUserID *uuid.UUID) error {
	if !input.Active {
		return nil
	}
	if input.DelegatedTo == nil || *input.DelegatedTo == uuid.Nil {
		return validationError("out_of_office.delegated_to is required", map[string]string{"out_of_office.delegated_to": "required"})
	}
	if strings.TrimSpace(input.Reason) == "" {
		return validationError("out_of_office.reason is required", map[string]string{"out_of_office.reason": "required"})
	}
	original := approverUserID
	if input.OriginalApproverUserID != nil {
		original = input.OriginalApproverUserID
	}
	if original != nil && *original == *input.DelegatedTo {
		return validationError("out_of_office.delegated_to must differ from the original approver", map[string]string{"out_of_office.delegated_to": "invalid"})
	}
	if input.StartsAt != nil && input.EndsAt != nil && !input.StartsAt.Before(*input.EndsAt) {
		return validationError("out_of_office.starts_at must be before ends_at", map[string]string{"out_of_office.starts_at": "invalid"})
	}
	return nil
}

func outOfOfficeDelegationMetadata(input dto.OutOfOfficeDelegationInput, originalApproverUserID *uuid.UUID) map[string]any {
	metadata := map[string]any{
		"active":               input.Active,
		"reason":               strings.TrimSpace(input.Reason),
		"source":               "out_of_office",
		"delegation_validated": true,
	}
	if originalApproverUserID != nil {
		metadata["original_approver_user_id"] = originalApproverUserID.String()
	}
	if input.DelegatedTo != nil {
		metadata["delegated_to"] = input.DelegatedTo.String()
	}
	if input.EvidenceID != "" {
		metadata["evidence_id"] = strings.TrimSpace(input.EvidenceID)
	}
	if input.StartsAt != nil {
		metadata["starts_at"] = input.StartsAt.UTC().Format(time.RFC3339Nano)
	}
	if input.EndsAt != nil {
		metadata["ends_at"] = input.EndsAt.UTC().Format(time.RFC3339Nano)
	}
	return metadata
}

func validateWorkflowDecisionFormData(req dto.WorkflowDecisionRequest, schema []workflowmodel.FormField) error {
	formData := workflowDecisionFormData(req, uuid.Nil, time.Time{})
	for _, field := range schema {
		if !field.Required {
			continue
		}
		value, exists := formData[field.Name]
		if !exists || blankWorkflowFormValue(value) {
			return validationError("required approval form field is missing", map[string]string{field.Name: "required"})
		}
	}
	return nil
}

func validateWorkflowAuthorityEvidence(req dto.WorkflowDecisionRequest, target workflowDecisionTarget, policy *watheeqApprovalPolicy) error {
	if req.Decision != "approve" {
		return nil
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
	if policy.PolicyID != "" && req.AuthorityEvidence.PolicyID != "" && !strings.EqualFold(policy.PolicyID, req.AuthorityEvidence.PolicyID) {
		return validationError("authority_evidence.policy_id does not match the approval policy", map[string]string{"authority_evidence.policy_id": "invalid"})
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
	if target.contractValue != nil && req.AuthorityEvidence.AuthorityAmount < *target.contractValue {
		return validationError("authority_evidence.authority_amount is below the contract value", map[string]string{"authority_evidence.authority_amount": "insufficient"})
	}
	return nil
}

// validateAuthorityEvidencePKI cryptographically validates Delegation-of-Authority
// evidence (Feature 3). It runs only for an "approve" decision against a policy
// that requires authority evidence. Behaviour:
//
//   - No validator wired OR no trusted roots configured: PKI is skipped. If the
//     caller nonetheless submitted cryptographic material, a warning is logged so
//     the operator knows the evidence was accepted un-verified.
//   - Validator wired AND roots configured: cryptographic material is REQUIRED.
//     The cert chain, validity window and detached signature are verified, and the
//     cryptographically-bound authority amount (when present in the signed payload)
//     must be >= the policy's RequiredAuthorityAmount and >= the contract value.
//
// The plain-text rules in validateWorkflowAuthorityEvidence already ran, so this
// only adds the cryptographic prong; it never relaxes the existing checks.
func (s *WorkflowService) validateAuthorityEvidencePKI(ctx context.Context, req dto.WorkflowDecisionRequest, target workflowDecisionTarget, policy *watheeqApprovalPolicy) error {
	if req.Decision != "approve" {
		return nil
	}
	if policy == nil || !policy.RequireAuthorityEvidence {
		return nil
	}
	evidence := req.AuthorityEvidence
	if evidence == nil {
		// validateWorkflowAuthorityEvidence already rejected a missing evidence for a
		// policy that requires it; defensive no-op here.
		return nil
	}

	strict := s.authorityValidator != nil && s.authorityRootsConfigured
	if !strict {
		if evidence.HasCryptographicEvidence() {
			s.logger.Warn().
				Str("policy_id", policy.PolicyID).
				Bool("validator_configured", s.authorityValidator != nil).
				Bool("roots_configured", s.authorityRootsConfigured).
				Msg("authority evidence carried cryptographic material but no trusted roots are configured; accepting un-verified (Feature 3 fallback)")
		}
		return nil
	}

	if !evidence.HasCryptographicEvidence() {
		return validationError("cryptographic authority evidence is required (certificate_pem, signature_b64, signature_alg)", map[string]string{"authority_evidence.certificate_pem": "required"})
	}

	var payload []byte
	if strings.TrimSpace(evidence.SignedPayloadB64) != "" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(evidence.SignedPayloadB64))
		if err != nil {
			return validationError("authority_evidence.signed_payload_b64 must be valid base64", map[string]string{"authority_evidence.signed_payload_b64": "invalid"})
		}
		payload = decoded
	}

	verified, err := s.authorityValidator.Validate(ctx, lexcrypto.AuthorityEvidenceInput{
		CertificatePEM:  evidence.CertificatePEM,
		Payload:         payload,
		SignatureB64:    evidence.SignatureB64,
		SignatureAlg:    evidence.SignatureAlg,
		TrustedRootsPEM: evidence.TrustedRootsPEM,
	})
	if err != nil {
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

	// The cryptographically-bound authority amount, when the signed payload carries
	// one, must cover the policy requirement and the contract value.
	if verified != nil && verified.AuthorityAmount != nil {
		bound := *verified.AuthorityAmount
		if policy.RequiredAuthorityAmount != nil && bound < *policy.RequiredAuthorityAmount {
			return validationError("authority evidence bound amount is below the required approval authority", map[string]string{"authority_evidence.authority_amount": "insufficient"})
		}
		if target.contractValue != nil && bound < *target.contractValue {
			return validationError("authority evidence bound amount is below the contract value", map[string]string{"authority_evidence.authority_amount": "insufficient"})
		}
	}
	return nil
}

func validateOptionalAuthorityEvidence(evidence *dto.ApprovalAuthorityEvidence) error {
	if evidence == nil {
		return nil
	}
	if strings.TrimSpace(evidence.Role) == "" {
		return validationError("authority_evidence.role is required", map[string]string{"authority_evidence.role": "required"})
	}
	if evidence.AuthorityAmount < 0 {
		return validationError("authority_evidence.authority_amount must be non-negative", map[string]string{"authority_evidence.authority_amount": "invalid"})
	}
	if strings.TrimSpace(evidence.Currency) == "" {
		return validationError("authority_evidence.currency is required", map[string]string{"authority_evidence.currency": "required"})
	}
	if strings.TrimSpace(evidence.EvidenceID) == "" {
		return validationError("authority_evidence.evidence_id is required", map[string]string{"authority_evidence.evidence_id": "required"})
	}
	return nil
}

func workflowDecisionDelegationMetadata(req dto.WorkflowDecisionRequest, userID uuid.UUID) (map[string]any, error) {
	if req.OutOfOffice != nil && req.OutOfOffice.Active {
		return outOfOfficeDelegationMetadata(*req.OutOfOffice, req.OutOfOffice.OriginalApproverUserID), nil
	}
	if req.DelegatedTo == nil {
		return nil, nil
	}
	if *req.DelegatedTo == userID {
		return nil, validationError("delegated_to must differ from the deciding user", map[string]string{"delegated_to": "invalid"})
	}
	metadata := map[string]any{
		"delegated_to":         req.DelegatedTo.String(),
		"delegated_by":         userID.String(),
		"delegation_reason":    "",
		"delegation_validated": true,
		"source":               "workflow_decision",
	}
	if req.DelegationReason != nil {
		metadata["delegation_reason"] = *req.DelegationReason
	}
	return metadata, nil
}

func approvalPolicyMetadata(policy *watheeqApprovalPolicy) map[string]any {
	if policy == nil {
		return nil
	}
	metadata := map[string]any{
		"policy_id":                  policy.PolicyID,
		"name":                       policy.Name,
		"required_role":              policy.RequiredRole,
		"currency":                   policy.Currency,
		"require_authority_evidence": policy.RequireAuthorityEvidence,
		"required_form_fields":       policy.RequiredFormFields,
	}
	if policy.Mode != "" {
		metadata["mode"] = policy.Mode
	}
	if policy.Quorum != "" {
		metadata["quorum"] = policy.Quorum
	}
	if policy.QuorumN != nil {
		metadata["quorum_n"] = *policy.QuorumN
	}
	if len(policy.Approvers) > 0 {
		approvers := make([]map[string]any, 0, len(policy.Approvers))
		for _, approver := range policy.Approvers {
			item := map[string]any{"type": approver.Type, "ref": approver.Ref}
			if approver.Label != "" {
				item["label"] = approver.Label
			}
			approvers = append(approvers, item)
		}
		metadata["approvers"] = approvers
	}
	if policy.Source != "" {
		metadata["source"] = policy.Source
	}
	if policy.RequiredAuthorityAmount != nil {
		metadata["required_authority_amount"] = *policy.RequiredAuthorityAmount
	}
	return metadata
}

func approvalAuthorityRequirementMetadata(policy *watheeqApprovalPolicy) map[string]any {
	if policy == nil || !policy.RequireAuthorityEvidence {
		return nil
	}
	metadata := map[string]any{
		"required":      true,
		"required_role": policy.RequiredRole,
		"currency":      policy.Currency,
	}
	if policy.RequiredAuthorityAmount != nil {
		metadata["required_authority_amount"] = *policy.RequiredAuthorityAmount
	}
	return metadata
}

func approvalPolicyFromMetadata(metadata map[string]any) *watheeqApprovalPolicy {
	raw, ok := metadata["approval_policy"].(map[string]any)
	if !ok || raw == nil {
		return nil
	}
	policy := &watheeqApprovalPolicy{
		PolicyID:                 stringFromAny(raw["policy_id"]),
		Name:                     stringFromAny(raw["name"]),
		RequiredRole:             normalizeWorkflowRole(stringFromAny(raw["required_role"])),
		Currency:                 normalizeWorkflowCurrency(stringFromAny(raw["currency"])),
		RequireAuthorityEvidence: boolFromAny(raw["require_authority_evidence"]),
		RequiredFormFields:       stringSliceFromAny(raw["required_form_fields"]),
		Mode:                     stringFromAny(raw["mode"]),
		Quorum:                   stringFromAny(raw["quorum"]),
		Source:                   stringFromAny(raw["source"]),
	}
	if amount, ok := floatFromAny(raw["required_authority_amount"]); ok {
		policy.RequiredAuthorityAmount = &amount
	}
	if quorumN := intFromAnyDefault(raw["quorum_n"], 0); quorumN > 0 {
		policy.QuorumN = &quorumN
	}
	if rawApprovers, ok := raw["approvers"].([]any); ok {
		for _, rawApprover := range rawApprovers {
			approverMap, ok := rawApprover.(map[string]any)
			if !ok {
				continue
			}
			typ := strings.ToLower(stringFromAny(approverMap["type"]))
			ref := stringFromAny(approverMap["ref"])
			if typ == "" || ref == "" {
				continue
			}
			policy.Approvers = append(policy.Approvers, approvalPolicyApprover{
				Type:  typ,
				Ref:   ref,
				Label: stringFromAny(approverMap["label"]),
			})
		}
	}
	return policy
}

func workflowAuthorityEvidenceMetadata(evidence *dto.ApprovalAuthorityEvidence) map[string]any {
	if evidence == nil {
		return nil
	}
	return map[string]any{
		"policy_id":        evidence.PolicyID,
		"role":             evidence.Role,
		"authority_amount": evidence.AuthorityAmount,
		"currency":         evidence.Currency,
		"evidence_id":      evidence.EvidenceID,
		"source":           evidence.Source,
	}
}

func validWorkflowFieldName(name string) bool {
	if name == "" {
		return false
	}
	for i, ch := range name {
		valid := ch == '_' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || i > 0 && ch >= '0' && ch <= '9'
		if !valid {
			return false
		}
	}
	return true
}

func blankWorkflowFormValue(value any) bool {
	if value == nil {
		return true
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v) == ""
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	default:
		return false
	}
}

func normalizeWorkflowRole(role string) string {
	// Mirror RBAC's normalizeRoleSlug (auth/rbac.go): hyphens and underscores are
	// interchangeable so a workflow approver ref "legal-director" matches a JWT role
	// slug "legal_director" (and vice-versa). Without this, workflow approval tasks
	// addressed to "legal_director" reject a user whose JWT carries "legal-director".
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(role)), "-", "_")
}

func normalizeWorkflowCurrency(currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		return "SAR"
	}
	return currency
}

func normalizeStringOptions(options []string) []string {
	out := make([]string, 0, len(options))
	seen := map[string]struct{}{}
	for _, option := range options {
		option = strings.TrimSpace(option)
		if option == "" {
			continue
		}
		key := strings.ToLower(option)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, option)
	}
	return out
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func boolFromAny(value any) bool {
	v, ok := value.(bool)
	return ok && v
}

func floatFromAny(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		parsed, err := v.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func stringSliceFromAny(value any) []string {
	switch v := value.(type) {
	case []string:
		return append([]string(nil), v...)
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := stringFromAny(item); s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func mapFromAny(value any) map[string]any {
	raw, ok := value.(map[string]any)
	if !ok || raw == nil {
		return nil
	}
	out := make(map[string]any, len(raw))
	for key, item := range raw {
		out[key] = item
	}
	return out
}

func ptrString(value string) *string {
	return &value
}

func ptrUUID(value uuid.UUID) *uuid.UUID {
	return &value
}
