package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	llmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

const pleadingApprovalWorkflowName = "Lex Litigation Pleading Approval"
const pleadingApprovalStepID = "pleading_approval"

// LitigationPleadingService owns the plaintiff litigation flows (CAP-052..062):
// pleadings (statement-of-claim drafting via the AID engine, versioned drafts,
// attachments, approval via the shared ApprovalOrchestrator), hearing reports /
// minutes (ضبط الجلسة), and court-expert assignments (ندب خبير) with furnished
// documents. Every mutation runs in a transaction, emits a CloudEvent on
// events.Topics.LexEvents, and applies the LegalHold guard on the parent case so a
// held case's pleadings/judgments are preserved.
type LitigationPleadingService struct {
	db           *pgxpool.Pool
	pleadings    *repository.LegalPleadingRepository
	experts      *repository.LegalExpertRepository
	cases        *repository.LegalCaseRepository
	drafter      *drafting.Drafter
	orchestrator *ApprovalOrchestrator
	defRepo      *workflowrepo.DefinitionRepository
	instRepo     *workflowrepo.InstanceRepository
	taskRepo     *workflowrepo.TaskRepository
	publisher    Publisher
	metrics      *metrics.Metrics
	topic        string
	logger       zerolog.Logger
	now          func() time.Time
	legalHolds   LegalHoldGuard
	audit        *LexAuditEmitter

	generationMu sync.Mutex
	generations  map[uuid.UUID]*pleadingGenerationRuntime
}

// NewLitigationPleadingService mirrors NewMatterService then takes the case repo,
// drafting engine, approval orchestrator and workflow primitives this module
// composes.
func NewLitigationPleadingService(
	db *pgxpool.Pool,
	pleadings *repository.LegalPleadingRepository,
	experts *repository.LegalExpertRepository,
	cases *repository.LegalCaseRepository,
	drafter *drafting.Drafter,
	orchestrator *ApprovalOrchestrator,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	taskRepo *workflowrepo.TaskRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LitigationPleadingService {
	return &LitigationPleadingService{
		db:           db,
		pleadings:    pleadings,
		experts:      experts,
		cases:        cases,
		drafter:      drafter,
		orchestrator: orchestrator,
		defRepo:      defRepo,
		instRepo:     instRepo,
		taskRepo:     taskRepo,
		publisher:    publisherOrNoop(publisher),
		metrics:      appMetrics,
		topic:        topic,
		logger:       logger.With().Str("service", "lex-litigation-pleadings").Logger(),
		now:          time.Now,
		generations:  make(map[uuid.UUID]*pleadingGenerationRuntime),
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard (chainable).
func (s *LitigationPleadingService) WithLegalHoldGuard(guard LegalHoldGuard) *LitigationPleadingService {
	s.legalHolds = guard
	return s
}

// SetAuditEmitter wires the immutable audit_db ledger emitter (chainable). When set,
// pleading transitions Emit() a tamper-evident audit record in addition to the in-tx
// append-only legal_litigation_audit_log row. Safe to leave nil.
func (s *LitigationPleadingService) SetAuditEmitter(audit *LexAuditEmitter) *LitigationPleadingService {
	s.audit = audit
	return s
}

// ============================================================================
// Pleadings (CAP-052..055)
// ============================================================================

// CreatePleading materialises a plaintiff pleading on a case (CAP-053). When
// GenerateBody is set and no body is supplied, the AID drafting engine drafts the
// statement-of-claim body (CAP-052, Arabic supported). The insert + first version
// snapshot commit in one transaction.
func (s *LitigationPleadingService) CreatePleading(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreatePleadingRequest) (*model.LegalPleading, error) {
	req.Normalize()
	if !req.Type.Valid() {
		return nil, validationError("invalid pleading type", map[string]string{"type": "invalid"})
	}
	if !req.Direction.Valid() {
		return nil, validationError("invalid pleading direction", map[string]string{"direction": "invalid"})
	}
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	c, err := s.loadCase(ctx, tenantID, caseID)
	if err != nil {
		return nil, err
	}

	body := req.Body
	aiGenerated := false
	if body == "" && req.GenerateBody {
		drafted, derr := s.draftStatementOfClaim(ctx, tenantID, c, req)
		if derr != nil {
			return nil, derr
		}
		body = drafted
		aiGenerated = true
	}
	// Empty bodies are valid for a persisted draft. The interactive UI creates
	// this record first, then starts a detachable AI generation job. Submission
	// still rejects an empty body, so an incomplete draft cannot enter approval.

	p := &model.LegalPleading{
		ID:               uuid.New(),
		TenantID:         tenantID,
		CaseID:           caseID,
		PleadingNumber:   fmt.Sprintf("PLD-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8])),
		Type:             req.Type,
		Direction:        req.Direction,
		Title:            req.Title,
		Body:             body,
		Recipient:        req.Recipient,
		CourtReference:   req.CourtReference,
		ResponseDeadline: req.ResponseDeadline,
		ResponseOwnerID:  req.ResponseOwnerID,
		Status:           model.PleadingStatusDraft,
		AIGenerated:      aiGenerated,
		CurrentVersion:   1,
		Metadata:         req.Metadata,
		CreatedBy:        userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start pleading create transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.pleadings.Create(ctx, tx, p); err != nil {
		return nil, internalError("create pleading", err)
	}
	version := &model.LegalPleadingVersion{
		ID:           uuid.New(),
		TenantID:     tenantID,
		PleadingID:   p.ID,
		Title:        p.Title,
		Body:         p.Body,
		AIGenerated:  aiGenerated,
		ChangeReason: "created",
		CreatedBy:    &userID,
	}
	if err := s.pleadings.AppendVersion(ctx, tx, version); err != nil {
		return nil, internalError("append pleading version", err)
	}
	if err := s.appendPleadingAudit(ctx, tx, p, userID, "pleading.created", nil, ptrString(string(p.Status)), nil, nil, pleadingAuditState(p), map[string]any{
		"type":         string(p.Type),
		"ai_generated": aiGenerated,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit pleading create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.created", tenantID, &userID, map[string]any{
		"id": p.ID, "case_id": caseID, "type": p.Type, "ai_generated": aiGenerated,
	}, s.logger)
	s.emitPleadingAudit(ctx, p, &userID, "pleading.created", "info", nil, pleadingAuditState(p), nil)
	return s.GetPleading(ctx, tenantID, caseID, p.ID)
}

func (s *LitigationPleadingService) ListPleadings(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalPleadingListFilters) ([]model.LegalPleading, int, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, 0, err
	}
	return s.pleadings.List(ctx, tenantID, caseID, filters)
}

func (s *LitigationPleadingService) GetPleading(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalPleading, error) {
	p, err := s.pleadings.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	if p.Attachments, err = s.pleadings.ListAttachments(ctx, tenantID, id); err != nil {
		return nil, internalError("load pleading attachments", err)
	}
	if p.Versions, err = s.pleadings.ListVersions(ctx, tenantID, id); err != nil {
		return nil, internalError("load pleading versions", err)
	}
	return p, nil
}

// UpdatePleadingDraft edits a draft pleading body/title and appends a version
// snapshot (CAP-054). Only draft / rejected pleadings are editable.
func (s *LitigationPleadingService) UpdatePleadingDraft(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.UpdatePleadingRequest) (*model.LegalPleading, error) {
	req.Normalize()
	p, err := s.pleadings.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	if p.Status != model.PleadingStatusDraft && p.Status != model.PleadingStatusRejected {
		return nil, conflictError("only draft or rejected pleadings can be edited")
	}
	if req.Title != nil {
		p.Title = *req.Title
	}
	if req.Type != nil {
		if !req.Type.Valid() {
			return nil, validationError("invalid pleading type", map[string]string{"type": "invalid"})
		}
		p.Type = *req.Type
	}
	if req.Direction != nil {
		if !req.Direction.Valid() {
			return nil, validationError("invalid pleading direction", map[string]string{"direction": "invalid"})
		}
		p.Direction = *req.Direction
	}
	if req.Recipient != nil {
		p.Recipient = req.Recipient
	}
	if req.CourtReference != nil {
		p.CourtReference = req.CourtReference
	}
	if req.ResponseDeadline != nil {
		p.ResponseDeadline = req.ResponseDeadline
	}
	if req.ResponseOwnerID != nil {
		p.ResponseOwnerID = req.ResponseOwnerID
	}
	if req.Body != nil {
		p.Body = *req.Body
		p.AIGenerated = false
	}
	if req.Metadata != nil {
		p.Metadata = req.Metadata
	}
	if strings.TrimSpace(p.Title) == "" || strings.TrimSpace(p.Body) == "" {
		return nil, validationError("title and body are required", map[string]string{"body": "required"})
	}
	p.CurrentVersion++

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start pleading update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.pleadings.UpdateDraft(ctx, tx, p); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("update pleading", err)
	}
	reason := req.ChangeReason
	if reason == "" {
		reason = "edited"
	}
	version := &model.LegalPleadingVersion{
		ID:           uuid.New(),
		TenantID:     tenantID,
		PleadingID:   p.ID,
		Title:        p.Title,
		Body:         p.Body,
		AIGenerated:  p.AIGenerated,
		ChangeReason: reason,
		CreatedBy:    &userID,
	}
	if err := s.pleadings.AppendVersion(ctx, tx, version); err != nil {
		return nil, internalError("append pleading version", err)
	}
	if err := s.appendPleadingAudit(ctx, tx, p, userID, "pleading.draft_updated", nil, nil, optionalReason(reason), nil, pleadingAuditState(p), map[string]any{
		"version": p.CurrentVersion,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit pleading update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.updated", tenantID, &userID, map[string]any{
		"id": p.ID, "case_id": caseID, "version": p.CurrentVersion,
	}, s.logger)
	return s.GetPleading(ctx, tenantID, caseID, id)
}

func (s *LitigationPleadingService) DeletePleading(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	if err := s.pleadings.SoftDelete(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("pleading not found")
		}
		return internalError("delete pleading", err)
	}
	return nil
}

func (s *LitigationPleadingService) AddPleadingAttachment(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.AddPleadingAttachmentRequest) (*model.LegalPleadingAttachment, error) {
	req.Normalize()
	if req.FileName == "" {
		return nil, validationError("file_name is required", map[string]string{"file_name": "required"})
	}
	if _, err := s.pleadings.Get(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	a := &model.LegalPleadingAttachment{
		ID:         uuid.New(),
		TenantID:   tenantID,
		PleadingID: id,
		FileID:     req.FileID,
		FileName:   req.FileName,
		Caption:    req.Caption,
		CreatedBy:  userID,
	}
	if err := s.pleadings.AddAttachment(ctx, s.db, a); err != nil {
		return nil, internalError("add pleading attachment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.attachment_added", tenantID, &userID, map[string]any{
		"id": id, "case_id": caseID, "file_id": req.FileID,
	}, s.logger)
	return a, nil
}

// SubmitPleadingForApproval opens the approval pipeline over the shared
// ApprovalOrchestrator (CAP-055). It starts a workflow instance + approval-chain
// step + a section-manager-addressed approver task, links the instance onto the
// pleading and moves it to in_approval.
func (s *LitigationPleadingService) SubmitPleadingForApproval(ctx context.Context, tenantID, userID, caseID, id uuid.UUID) (*model.LegalPleading, error) {
	if s.instRepo == nil || s.taskRepo == nil || s.orchestrator == nil {
		return nil, internalError("pleading approval workflow repositories are not configured", fmt.Errorf("missing workflow dependencies"))
	}
	p, err := s.pleadings.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	if p.Status != model.PleadingStatusDraft && p.Status != model.PleadingStatusRejected {
		return nil, conflictError("only draft or rejected pleadings can be submitted for approval")
	}
	if strings.TrimSpace(p.Body) == "" {
		return nil, validationError("pleading body is required before submission", map[string]string{"body": "required"})
	}
	if p.WorkflowInstanceID != nil {
		return nil, conflictError("pleading already has an active approval workflow")
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
		CurrentStepID: ptrString(pleadingApprovalStepID),
		Variables: map[string]any{
			"pleading_id": p.ID.String(),
			"case_id":     caseID.String(),
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}
	if err := s.instRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create pleading approval instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     pleadingApprovalStepID,
		StepType:   workflowexec.StepTypeApprovalChain,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.instRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create pleading approval step", err)
	}
	workflowID := uuid.MustParse(instance.ID)
	task := s.buildApproverTask(tenantID, p, instance.ID, stepExec.ID, now)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start pleading approval transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create pleading approval task", err)
	}
	if err := s.pleadings.UpdateStatusTx(ctx, tx, tenantID, id, model.PleadingStatusInApproval, &workflowID, nil, nil); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("move pleading into approval", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit pleading approval start", err)
	}
	if s.metrics != nil {
		s.metrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.approval_started", tenantID, &userID, map[string]any{
		"id": p.ID, "case_id": caseID, "workflow_instance_id": workflowID,
	}, s.logger)
	return s.GetPleading(ctx, tenantID, caseID, id)
}

// DecidePleadingApproval records one approver decision through the reusable
// orchestrator (CAP-055).
func (s *LitigationPleadingService) DecidePleadingApproval(ctx context.Context, tenantID, userID, caseID, id, workflowInstanceID, taskID uuid.UUID, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	p, err := s.pleadings.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	if p.WorkflowInstanceID == nil || *p.WorkflowInstanceID != workflowInstanceID {
		return nil, conflictError("workflow instance does not belong to this pleading")
	}
	spec := s.pleadingSubjectSpec(userID, id)
	return s.orchestrator.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
}

// FilePleading marks an approved pleading as filed with the court.
func (s *LitigationPleadingService) FilePleading(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.FilePleadingRequest) (*model.LegalPleading, error) {
	req.Normalize()
	p, err := s.pleadings.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("load pleading", err)
	}
	if p.Status != model.PleadingStatusApproved {
		return nil, conflictError("only approved pleadings can be filed")
	}
	filedAt := s.now().UTC()
	if req.FiledAt != nil {
		filedAt = req.FiledAt.UTC()
	}
	before := pleadingAuditState(p)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start pleading file transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.pleadings.MarkFiled(ctx, tx, tenantID, id, filedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("pleading not found")
		}
		return nil, internalError("file pleading", err)
	}
	p.Status = model.PleadingStatusFiled
	p.FiledAt = &filedAt
	// C-2: pleading-filing turnaround fact (pleading.created -> filed), in-tx.
	if err := s.pleadings.UpsertDurationFact(ctx, tx, &repository.LitigationDurationFact{
		TenantID:   tenantID,
		Kind:       pleadingFilingDurationKind,
		SubjectID:  p.ID,
		Category:   ptrString(string(p.Type)),
		StartedAt:  p.CreatedAt,
		EndedAt:    filedAt,
		OccurredAt: filedAt,
	}); err != nil {
		return nil, internalError("record pleading filing duration fact", err)
	}
	if err := s.appendPleadingAudit(ctx, tx, p, userID, "pleading.filed", ptrString(string(model.PleadingStatusApproved)), ptrString(string(model.PleadingStatusFiled)), nil, before, pleadingAuditState(p), map[string]any{
		"filed_at": filedAt.Format(time.RFC3339),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit pleading file", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.pleading.filed", tenantID, &userID, map[string]any{
		"id": id, "case_id": caseID, "filed_at": filedAt,
	}, s.logger)
	s.emitPleadingAudit(ctx, p, &userID, "pleading.filed", "info", before, pleadingAuditState(p), nil)
	return s.GetPleading(ctx, tenantID, caseID, id)
}

// pleadingSubjectSpec builds the orchestrator hook set: lock the pleading row and
// advance its FSM (approved on advance, rejected on reject) inside the orchestrator
// transaction.
func (s *LitigationPleadingService) pleadingSubjectSpec(userID, pleadingID uuid.UUID) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_pleading",
		SubjectID:   pleadingID,
		EventEntity: "pleading",
		LockSubject: s.pleadings.LockStatus,
		AdvanceSubject: func(ctx context.Context, tx pgx.Tx, tenantID, uid, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
			target := model.PleadingStatusInApproval
			var approvedBy *uuid.UUID
			var approvedAt *time.Time
			switch resolution {
			case workflowexec.ResolutionAdvance:
				target = model.PleadingStatusApproved
				approvedBy = &uid
				approvedAt = &now
			case workflowexec.ResolutionReject:
				target = model.PleadingStatusRejected
			default:
				return string(model.PleadingStatusInApproval), nil
			}
			if err := s.pleadings.UpdateStatusTx(ctx, tx, tenantID, subjectID, target, nil, approvedBy, approvedAt); err != nil {
				return "", internalError("advance pleading status", err)
			}
			// Clear the workflow link on terminal resolution so a rejected pleading can
			// be re-submitted.
			if _, err := tx.Exec(ctx, `UPDATE legal_pleadings SET workflow_instance_id = NULL WHERE tenant_id = $1 AND id = $2`, tenantID, subjectID); err != nil {
				return "", internalError("clear pleading workflow link", err)
			}
			// Append-only audit of the approval-driven transition, inside the
			// orchestrator's transaction so the row commits atomically with the FSM move.
			action := "pleading.approved"
			if resolution == workflowexec.ResolutionReject {
				action = "pleading.rejected"
			}
			auditEntry := &repository.LitigationAuditEntry{
				ID:          uuid.New(),
				TenantID:    tenantID,
				SubjectType: "legal_pleading",
				SubjectID:   subjectID,
				Action:      action,
				FromStatus:  ptrString(string(model.PleadingStatusInApproval)),
				ToStatus:    ptrString(string(target)),
				Reason:      optionalReason(decision),
				After:       map[string]any{"status": string(target), "approved_by": uuidPtrDetail(approvedBy)},
				ActorUserID: uid,
			}
			if err := s.pleadings.AppendAudit(ctx, tx, auditEntry); err != nil {
				return "", internalError("append pleading approval audit", err)
			}
			return string(target), nil
		},
	}
}

func (s *LitigationPleadingService) buildApproverTask(tenantID uuid.UUID, p *model.LegalPleading, instanceID, stepExecID string, now time.Time) *workflowmodel.HumanTask {
	metadata := map[string]any{
		"pleading_id":     p.ID.String(),
		"case_id":         p.CaseID.String(),
		"subject_type":    "legal_pleading",
		"approval_mode":   workflowexec.ApprovalModeSequential,
		"approval_quorum": workflowexec.QuorumAll,
		"approver_total":  1,
		"approver_index":  0,
		"approver_type":   "role",
		"approver_ref":    "legal-cases-manager",
		"source":          "lex_litigation_pleading",
	}
	return &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instanceID,
		StepID:       pleadingApprovalStepID,
		StepExecID:   stepExecID,
		Name:         "Approve pleading",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: ptrString("legal-cases-manager"),
		FormSchema:   pleadingApprovalFormSchema(),
		FormData:     map[string]any{},
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

func (s *LitigationPleadingService) ensureDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, pleadingApprovalWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load pleading approval definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        pleadingApprovalWorkflowName,
		Description: "Litigation pleading (statement-of-claim) approval workflow for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"pleading_id": {Type: "string"},
			"case_id":     {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: pleadingApprovalStepID, Type: workflowexec.StepTypeApprovalChain, Name: "Pleading Approval", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.defRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create pleading approval definition", err)
	}
	return definition, nil
}

func pleadingApprovalFormSchema() []workflowmodel.FormField {
	return []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Approval notes", Required: false},
	}
}

// draftStatementOfClaim drives the AID drafting engine to produce a statement-of-claim
// body (CAP-052). Arabic is the default output language. When the engine is disabled
// the caller surfaces a 503.
func (s *LitigationPleadingService) draftStatementOfClaim(ctx context.Context, tenantID uuid.UUID, c *model.LegalCase, req dto.CreatePleadingRequest) (string, error) {
	if s.drafter == nil || !s.drafter.Enabled() {
		return "", draftingUnavailable()
	}
	lang := req.Language
	if lang == "" {
		lang = "ar"
	}
	out, err := s.drafter.DraftPleading(ctx, tenantID, drafting.PleadingDraftRequest{
		PleadingType:    string(req.Type),
		Direction:       string(req.Direction),
		PleadingTitle:   req.Title,
		CaseNumber:      c.CaseNumber,
		CaseType:        c.CaseType,
		CompanyStatus:   string(c.CompanyStatus),
		CaseTitleAR:     c.Title.AR,
		CaseTitleEN:     c.Title.EN,
		CaseDescription: c.Description,
		Recipient:       pleadingOptionalString(req.Recipient),
		CourtReference:  pleadingOptionalString(req.CourtReference),
		Instructions:    req.DraftPrompt,
		Language:        lang,
	})
	if err != nil {
		return "", mapDraftingError(err)
	}
	return out.Body, nil
}

// ============================================================================
// Hearing reports / minutes (ضبط الجلسة, CAP-056..059)
// ============================================================================

func (s *LitigationPleadingService) CreateHearingReport(ctx context.Context, tenantID, userID, caseID, hearingID uuid.UUID, req dto.CreateHearingReportRequest) (*model.LegalHearingReport, error) {
	req.Normalize()
	if !req.Type.Valid() {
		return nil, validationError("invalid hearing report type", map[string]string{"type": "invalid"})
	}
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	exists, err := s.experts.HearingExists(ctx, tenantID, caseID, hearingID)
	if err != nil {
		return nil, internalError("check hearing", err)
	}
	if !exists {
		return nil, notFoundError("case hearing not found")
	}
	recordedAt := s.now().UTC()
	if req.RecordedAt != nil {
		recordedAt = req.RecordedAt.UTC()
	}
	hr := &model.LegalHearingReport{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CaseID:     caseID,
		HearingID:  hearingID,
		Type:       req.Type,
		Title:      req.Title,
		Body:       req.Body,
		Decision:   req.Decision,
		RecordedAt: recordedAt,
		FileID:     req.FileID,
		Metadata:   req.Metadata,
		CreatedBy:  userID,
	}
	if err := s.experts.CreateHearingReport(ctx, s.db, hr); err != nil {
		return nil, internalError("create hearing report", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.hearing_report.created", tenantID, &userID, map[string]any{
		"id": hr.ID, "case_id": caseID, "hearing_id": hearingID, "type": hr.Type,
	}, s.logger)
	return hr, nil
}

func (s *LitigationPleadingService) ListHearingReports(ctx context.Context, tenantID, hearingID uuid.UUID) ([]model.LegalHearingReport, error) {
	items, err := s.experts.ListHearingReports(ctx, tenantID, hearingID)
	if err != nil {
		return nil, internalError("list hearing reports", err)
	}
	return items, nil
}

func (s *LitigationPleadingService) UpdateHearingReport(ctx context.Context, tenantID, userID, hearingID, id uuid.UUID, req dto.UpdateHearingReportRequest) (*model.LegalHearingReport, error) {
	hr, err := s.experts.GetHearingReport(ctx, tenantID, hearingID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("hearing report not found")
		}
		return nil, internalError("load hearing report", err)
	}
	if req.Type != nil {
		if !req.Type.Valid() {
			return nil, validationError("invalid hearing report type", map[string]string{"type": "invalid"})
		}
		hr.Type = *req.Type
	}
	if req.Title != nil {
		hr.Title = strings.TrimSpace(*req.Title)
	}
	if req.Body != nil {
		hr.Body = strings.TrimSpace(*req.Body)
	}
	if req.Decision != nil {
		hr.Decision = strings.TrimSpace(*req.Decision)
	}
	if req.FileID != nil {
		hr.FileID = req.FileID
	}
	if req.Metadata != nil {
		hr.Metadata = req.Metadata
	}
	if strings.TrimSpace(hr.Title) == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if err := s.experts.UpdateHearingReport(ctx, s.db, hr); err != nil {
		return nil, internalError("update hearing report", err)
	}
	return hr, nil
}

func (s *LitigationPleadingService) DeleteHearingReport(ctx context.Context, tenantID, hearingID, id uuid.UUID) error {
	if err := s.experts.DeleteHearingReport(ctx, tenantID, hearingID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("hearing report not found")
		}
		return internalError("delete hearing report", err)
	}
	return nil
}

// ============================================================================
// Experts (ندب خبير, CAP-060..062)
// ============================================================================

func (s *LitigationPleadingService) CreateExpertAssignment(ctx context.Context, tenantID, userID, caseID uuid.UUID, req dto.CreateExpertAssignmentRequest) (*model.LegalExpertAssignment, error) {
	req.Normalize()
	if req.ExpertName == "" {
		return nil, validationError("expert_name is required", map[string]string{"expert_name": "required"})
	}
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, err
	}
	a := &model.LegalExpertAssignment{
		ID:             uuid.New(),
		TenantID:       tenantID,
		CaseID:         caseID,
		ExpertName:     req.ExpertName,
		Specialization: req.Specialization,
		ContactInfo:    normalizeOptionalString(req.ContactInfo),
		Mandate:        req.Mandate,
		Status:         model.ExpertAssignmentStatusRequested,
		ReportDueDate:  req.ReportDueDate,
		Metadata:       req.Metadata,
		CreatedBy:      userID,
	}
	if err := s.experts.Create(ctx, s.db, a); err != nil {
		return nil, internalError("create expert assignment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.expert.assigned", tenantID, &userID, map[string]any{
		"id": a.ID, "case_id": caseID, "expert_name": a.ExpertName,
	}, s.logger)
	return a, nil
}

func (s *LitigationPleadingService) ListExpertAssignments(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalExpertAssignmentListFilters) ([]model.LegalExpertAssignment, int, error) {
	if err := s.ensureCaseExists(ctx, tenantID, caseID); err != nil {
		return nil, 0, err
	}
	return s.experts.List(ctx, tenantID, caseID, filters)
}

func (s *LitigationPleadingService) GetExpertAssignment(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalExpertAssignment, error) {
	a, err := s.experts.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("expert assignment not found")
		}
		return nil, internalError("load expert assignment", err)
	}
	if a.Documents, err = s.experts.ListDocuments(ctx, tenantID, id); err != nil {
		return nil, internalError("load expert documents", err)
	}
	return a, nil
}

func (s *LitigationPleadingService) UpdateExpertAssignment(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.UpdateExpertAssignmentRequest) (*model.LegalExpertAssignment, error) {
	a, err := s.experts.Get(ctx, tenantID, caseID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("expert assignment not found")
		}
		return nil, internalError("load expert assignment", err)
	}
	if req.ExpertName != nil {
		a.ExpertName = strings.TrimSpace(*req.ExpertName)
	}
	if req.Specialization != nil {
		a.Specialization = strings.TrimSpace(*req.Specialization)
	}
	if req.ContactInfo != nil {
		a.ContactInfo = normalizeOptionalString(req.ContactInfo)
	}
	if req.Mandate != nil {
		a.Mandate = strings.TrimSpace(*req.Mandate)
	}
	if req.Status != nil {
		if !req.Status.Valid() {
			return nil, validationError("invalid expert assignment status", map[string]string{"status": "invalid"})
		}
		a.Status = *req.Status
	}
	if req.AppointedAt != nil {
		a.AppointedAt = req.AppointedAt
	}
	if req.ReportDueDate != nil {
		a.ReportDueDate = req.ReportDueDate
	}
	if req.ReportReceivedAt != nil {
		a.ReportReceivedAt = req.ReportReceivedAt
	}
	if req.Metadata != nil {
		a.Metadata = req.Metadata
	}
	if strings.TrimSpace(a.ExpertName) == "" {
		return nil, validationError("expert_name is required", map[string]string{"expert_name": "required"})
	}
	if err := s.experts.Update(ctx, s.db, a); err != nil {
		return nil, internalError("update expert assignment", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.expert.updated", tenantID, &userID, map[string]any{
		"id": a.ID, "case_id": caseID, "status": a.Status,
	}, s.logger)
	return s.GetExpertAssignment(ctx, tenantID, caseID, id)
}

func (s *LitigationPleadingService) DeleteExpertAssignment(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	if err := s.experts.SoftDelete(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("expert assignment not found")
		}
		return internalError("delete expert assignment", err)
	}
	return nil
}

func (s *LitigationPleadingService) AddExpertDocument(ctx context.Context, tenantID, userID, caseID, id uuid.UUID, req dto.AddExpertDocumentRequest) (*model.LegalExpertDocument, error) {
	req.Normalize()
	if req.FileName == "" {
		return nil, validationError("file_name is required", map[string]string{"file_name": "required"})
	}
	if _, err := s.experts.Get(ctx, tenantID, caseID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("expert assignment not found")
		}
		return nil, internalError("load expert assignment", err)
	}
	d := &model.LegalExpertDocument{
		ID:           uuid.New(),
		TenantID:     tenantID,
		AssignmentID: id,
		FileID:       req.FileID,
		FileName:     req.FileName,
		Caption:      req.Caption,
		CreatedBy:    userID,
	}
	if err := s.experts.AddDocument(ctx, s.db, d); err != nil {
		return nil, internalError("add expert document", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.expert.document_added", tenantID, &userID, map[string]any{
		"id": id, "case_id": caseID, "file_id": req.FileID,
	}, s.logger)
	return d, nil
}

// ============================================================================
// internals
// ============================================================================

func (s *LitigationPleadingService) loadCase(ctx context.Context, tenantID, caseID uuid.UUID) (*model.LegalCase, error) {
	c, err := s.cases.Get(ctx, tenantID, caseID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal case not found")
		}
		return nil, internalError("load legal case", err)
	}
	return c, nil
}

func (s *LitigationPleadingService) ensureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	_, err := s.loadCase(ctx, tenantID, caseID)
	return err
}

// pleadingFilingDurationKind is the C-2 duration-fact kind for the
// pleading.created -> pleading.filed turnaround (widened in the staged migration).
const pleadingFilingDurationKind = "pleading_filing"

// appendPleadingAudit writes the in-tx append-only governance audit row for a
// pleading transition. Immutable: legal_litigation_audit_log has no UPDATE/DELETE.
func (s *LitigationPleadingService) appendPleadingAudit(ctx context.Context, tx pgx.Tx, p *model.LegalPleading, actorID uuid.UUID, action string, from, to, reason *string, before, after, detail map[string]any) error {
	caseID := p.CaseID
	entry := &repository.LitigationAuditEntry{
		ID:          uuid.New(),
		TenantID:    p.TenantID,
		SubjectType: "legal_pleading",
		SubjectID:   p.ID,
		CaseID:      &caseID,
		Action:      action,
		FromStatus:  from,
		ToStatus:    to,
		Reason:      reason,
		Before:      before,
		After:       after,
		Detail:      detail,
		ActorUserID: actorID,
	}
	if err := s.pleadings.AppendAudit(ctx, tx, entry); err != nil {
		return internalError("append pleading audit", err)
	}
	return nil
}

// emitPleadingAudit routes a tamper-evident record to the immutable audit_db ledger
// (best-effort; never blocks the business operation).
func (s *LitigationPleadingService) emitPleadingAudit(ctx context.Context, p *model.LegalPleading, actorID *uuid.UUID, action, severity string, before, after, detail map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     p.TenantID,
		ActorUserID:  actorID,
		Action:       action,
		ResourceType: "legal_pleading",
		ResourceID:   p.ID.String(),
		Severity:     severity,
		OldValue:     before,
		NewValue:     after,
		Detail:       detail,
	})
}

// pleadingAuditState is the before/after snapshot recorded in the audit trail.
func pleadingAuditState(p *model.LegalPleading) map[string]any {
	return map[string]any{
		"pleading_number":   p.PleadingNumber,
		"type":              string(p.Type),
		"direction":         string(p.Direction),
		"recipient":         p.Recipient,
		"court_reference":   p.CourtReference,
		"response_deadline": dateDetail(p.ResponseDeadline),
		"response_owner_id": uuidPtrDetail(p.ResponseOwnerID),
		"status":            string(p.Status),
		"current_version":   p.CurrentVersion,
		"ai_generated":      p.AIGenerated,
		"approved_by":       uuidPtrDetail(p.ApprovedBy),
		"filed_at":          dateDetail(p.FiledAt),
	}
}

// mapDraftingError maps the drafting engine sentinels to app errors. It mirrors
// DraftingService.mapDraftErr but is shared across the litigation modules so they do
// not need the DraftingService shell.
func mapDraftingError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, drafting.ErrDraftingDisabled):
		return draftingUnavailable()
	case errors.Is(err, llmprovider.ErrNotConfigured):
		return draftingUnavailable()
	case errors.Is(err, context.DeadlineExceeded):
		return &apperrors.AppError{
			Status: http.StatusGatewayTimeout,
			Code:   "DRAFTING_TIMEOUT",
			Err:    err,
		}
	case errors.Is(err, drafting.ErrNoToolCall), errors.Is(err, drafting.ErrInvalidOutput):
		return &apperrors.AppError{Status: http.StatusBadGateway, Code: "DRAFTING_NO_OUTPUT"}
	default:
		var appErr *apperrors.AppError
		if errors.As(err, &appErr) {
			return appErr
		}
		return &apperrors.AppError{
			Status: http.StatusBadGateway,
			Code:   "DRAFTING_PROVIDER_ERROR",
			Err:    err,
		}
	}
}

// assembleDraftSections flattens an AID ContractDraft (title + ordered sections +
// summary) into a single body string for a litigation pleading / memo.
func assembleDraftSections(title string, sections []drafting.DraftSection, summary string) string {
	var b strings.Builder
	if strings.TrimSpace(title) != "" {
		b.WriteString(strings.TrimSpace(title))
		b.WriteString("\n\n")
	}
	for _, sec := range sections {
		if strings.TrimSpace(sec.Heading) != "" {
			b.WriteString(strings.TrimSpace(sec.Heading))
			b.WriteString("\n")
		}
		if strings.TrimSpace(sec.Body) != "" {
			b.WriteString(strings.TrimSpace(sec.Body))
			b.WriteString("\n\n")
		}
	}
	if strings.TrimSpace(summary) != "" {
		b.WriteString(strings.TrimSpace(summary))
	}
	return strings.TrimSpace(b.String())
}
