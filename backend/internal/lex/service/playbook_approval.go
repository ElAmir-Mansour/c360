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

// playbook_approval.go is the subject-specific shell that binds the REUSABLE,
// subject-agnostic ApprovalOrchestrator to a clause playbook (WTQ-RSK-02 #9): a
// DRAFT playbook must be approved before it becomes active. It mirrors
// ConsultationApprovalService exactly — StartApproval creates a workflow instance +
// approval-chain step + a single role-addressed approver task and links it onto the
// playbook (via metadata.workflow_instance_id); DecideTask records the decision via
// the SAME orchestrator, whose AdvanceSubject hook flips the playbook draft → active
// on approve (superseding the prior active playbook of that type to preserve the
// one-active-per-type invariant) or leaves it draft on reject.

const playbookApprovalWorkflowName = "Lex Playbook Approval"
const playbookApprovalStepID = "playbook_approval"

// PlaybookApprovalService drives the playbook activation sign-off.
type PlaybookApprovalService struct {
	db           *pgxpool.Pool
	playbooks    *repository.PlaybookRepository
	orchestrator *ApprovalOrchestrator
	defRepo      *workflowrepo.DefinitionRepository
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     *workflowrepo.TaskRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	approverRole string
}

func NewPlaybookApprovalService(
	db *pgxpool.Pool,
	playbooks *repository.PlaybookRepository,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *PlaybookApprovalService {
	return &PlaybookApprovalService{
		db:           db,
		playbooks:    playbooks,
		orchestrator: orchestrator,
		defRepo:      defRepo,
		instRepo:     instRepo,
		taskRepo:     taskRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-playbook-approval").Logger(),
		now:          time.Now,
		approverRole: "legal-director",
	}
}

// StartApproval opens the activation-approval pipeline for a DRAFT playbook. It
// creates a workflow instance + step + a single role-addressed approval task and
// links the instance id onto the playbook metadata. The playbook stays draft until
// the decision resolves.
func (s *PlaybookApprovalService) StartApproval(ctx context.Context, tenantID, userID, playbookID uuid.UUID) (*model.ClausePlaybook, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("playbook approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	pb, err := s.playbooks.Get(ctx, tenantID, playbookID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load clause playbook", err)
	}
	if pb.Status != model.PlaybookStatusDraft {
		return nil, conflictError("only draft playbooks can enter approval")
	}
	if _, ok := workflowInstanceFromMetadata(pb.Metadata); ok {
		return nil, conflictError("playbook already has an active approval workflow")
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
		CurrentStepID: ptrString(playbookApprovalStepID),
		Variables: map[string]any{
			"playbook_id":   pb.ID.String(),
			"playbook_name": pb.Name,
			"contract_type": string(pb.ContractType),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create playbook approval workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     playbookApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create playbook approval step execution", err)
	}

	task := s.buildApprovalTask(tenantID, pb, instance, stepExec, now)
	workflowID := uuid.MustParse(instance.ID)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start playbook approval transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create playbook approval task", err)
	}
	// Link the workflow instance onto the playbook metadata in the same tx.
	if err := s.setWorkflowInstanceTx(ctx, tx, tenantID, pb, &workflowID, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit playbook approval start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.approval_started", tenantID, &userID, map[string]any{
		"id":                   playbookID,
		"playbook_id":          playbookID,
		"workflow_instance_id": workflowID,
		"status":               pb.Status,
	}, s.logger)
	return s.playbooks.Get(ctx, tenantID, playbookID)
}

// DecideTask records one approver decision via the reusable orchestrator. On
// approve the playbook is flipped to active (superseding the prior active of its
// type); on reject it stays draft (the workflow link is cleared either way).
func (s *PlaybookApprovalService) DecideTask(ctx context.Context, tenantID, userID, playbookID, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	pb, err := s.playbooks.Get(ctx, tenantID, playbookID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load clause playbook", err)
	}
	linked, ok := workflowInstanceFromMetadata(pb.Metadata)
	if !ok || linked != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this playbook")
	}
	spec := s.subjectSpec(playbookID)
	outcome, err := s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
	if err != nil {
		return nil, err
	}
	if outcome != nil && outcome.Resolution == workflowexec.ResolutionAdvance && outcome.Status == string(model.PlaybookStatusActive) {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.activated", tenantID, &userID, map[string]any{
			"id":                   playbookID,
			"playbook_id":          playbookID,
			"workflow_instance_id": workflowInstanceID,
			"contract_type":        string(pb.ContractType),
			"status":               outcome.Status,
		}, s.logger)
	}
	return outcome, nil
}

// ListTasks returns the open approver tasks for a playbook's workflow.
func (s *PlaybookApprovalService) ListTasks(ctx context.Context, tenantID, playbookID uuid.UUID) ([]*workflowmodel.HumanTask, error) {
	pb, err := s.playbooks.Get(ctx, tenantID, playbookID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load clause playbook", err)
	}
	linked, ok := workflowInstanceFromMetadata(pb.Metadata)
	if !ok {
		return []*workflowmodel.HumanTask{}, nil
	}
	tasks, err := s.taskRepo.ListByInstanceStep(ctx, tenantID.String(), linked.String(), playbookApprovalStepID)
	if err != nil {
		return nil, internalError("list playbook approval tasks", err)
	}
	return tasks, nil
}

// subjectSpec builds the orchestrator hook set for a playbook: it locks the playbook
// row FOR UPDATE and advances its FSM as the chain resolves.
func (s *PlaybookApprovalService) subjectSpec(playbookID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "playbook",
		SubjectID:   playbookID,
		EventEntity: "playbook",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			return s.playbooks.LockStatus(ctx, tx, tenantID, subjectID)
		},
		AdvanceSubject: s.advanceStatus,
	}
}

// advanceStatus is the subject FSM hook the orchestrator calls when the chain
// resolves. On approve it supersedes the prior active playbook of the same type and
// flips this one draft → active, clearing the workflow link; on reject it leaves the
// playbook draft (and clears the workflow link so it can be re-submitted). It runs
// inside the orchestrator's transaction.
func (s *PlaybookApprovalService) advanceStatus(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
	pb, err := s.playbooks.GetTx(ctx, tx, tenantID, subjectID)
	if err != nil {
		return "", internalError("reload playbook for advance", err)
	}
	if pb.Status != model.PlaybookStatusDraft {
		return string(pb.Status), nil
	}
	// Clear the workflow link regardless of outcome.
	if err := s.clearWorkflowInstanceTx(ctx, tx, tenantID, pb, userID); err != nil {
		return "", err
	}
	switch resolution {
	case workflowexec.ResolutionAdvance:
		// Supersede the existing active playbook of this contract type so the
		// one-active-per-type unique index is not violated, then activate this one.
		if _, err := s.playbooks.ArchiveActiveOfTypeTx(ctx, tx, tenantID, pb.ContractType, pb.ID, userID); err != nil {
			return "", internalError("supersede active playbook", err)
		}
		if err := s.playbooks.SetStatusTx(ctx, tx, tenantID, subjectID, model.PlaybookStatusActive, userID); err != nil {
			if err == pgx.ErrNoRows {
				return "", notFoundError("clause playbook not found")
			}
			return "", internalError("activate playbook", err)
		}
		return string(model.PlaybookStatusActive), nil
	case workflowexec.ResolutionReject:
		// Stays draft; workflow link already cleared so it can be re-submitted.
		return string(model.PlaybookStatusDraft), nil
	default:
		return string(pb.Status), nil
	}
}

// buildApprovalTask materialises the single role-addressed approval task.
func (s *PlaybookApprovalService) buildApprovalTask(tenantID uuid.UUID, pb *model.ClausePlaybook, instance *workflowmodel.WorkflowInstance, stepExec *workflowmodel.StepExecution, now time.Time) *workflowmodel.HumanTask {
	metadata := map[string]any{
		"playbook_id":     pb.ID.String(),
		"playbook_name":   pb.Name,
		"subject_type":    "playbook",
		"approval_mode":   workflowexec.ApprovalModeSequential,
		"approval_quorum": workflowexec.QuorumAll,
		"approver_total":  1,
		"approver_index":  0,
		"approver_type":   "role",
		"approver_ref":    s.approverRole,
		"source":          "lex_playbook_approval",
	}
	role := s.approverRole
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       playbookApprovalStepID,
		StepExecID:   stepExec.ID,
		Name:         "Approve playbook activation",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: &role,
		FormSchema:   playbookApprovalFormSchema(),
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

// ensureDefinition lazily creates (once per tenant) the playbook approval workflow
// definition. Mirrors ConsultationApprovalService.ensureDefinition.
func (s *PlaybookApprovalService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, playbookApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load playbook approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        playbookApprovalWorkflowName,
		Description: "Subject-agnostic clause playbook activation approval workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"playbook_id":   {Type: "string"},
			"playbook_name": {Type: "string"},
			"contract_type": {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: playbookApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Playbook Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create playbook approval definition", err)
	}
	return definition, nil
}

func playbookApprovalFormSchema() []workflowmodel.FormField {
	return []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
}

// setWorkflowInstanceTx stamps the workflow instance id onto the playbook metadata
// within a transaction (the playbook table has no dedicated workflow column, so the
// link lives in metadata.workflow_instance_id).
func (s *PlaybookApprovalService) setWorkflowInstanceTx(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, pb *model.ClausePlaybook, workflowID *uuid.UUID, userID uuid.UUID) error {
	metadata := map[string]any{}
	for k, v := range pb.Metadata {
		metadata[k] = v
	}
	if workflowID != nil {
		metadata["workflow_instance_id"] = workflowID.String()
	} else {
		delete(metadata, "workflow_instance_id")
	}
	updated := *pb
	updated.Metadata = metadata
	if err := s.playbooks.Update(ctx, tx, &updated, userID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("clause playbook not found")
		}
		return internalError("link playbook approval workflow", err)
	}
	return nil
}

func (s *PlaybookApprovalService) clearWorkflowInstanceTx(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, pb *model.ClausePlaybook, userID uuid.UUID) error {
	return s.setWorkflowInstanceTx(ctx, tx, tenantID, pb, nil, userID)
}

// workflowInstanceFromMetadata extracts the linked workflow instance id from a
// playbook's metadata, if present and parseable.
func workflowInstanceFromMetadata(metadata map[string]any) (uuid.UUID, bool) {
	if metadata == nil {
		return uuid.Nil, false
	}
	raw, ok := metadata["workflow_instance_id"]
	if !ok {
		return uuid.Nil, false
	}
	s, ok := raw.(string)
	if !ok || s == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}
