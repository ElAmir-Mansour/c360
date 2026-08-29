package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

// draftReviewWorkflowName is the shared-engine workflow definition that backs AI
// draft human reviews (Feature 4). It is a minimal single human-task workflow
// (draft_review -> end) ensured per-tenant, mirroring the contract-review
// definition pattern so draft reviews are first-class engine instances rather
// than ad-hoc forms.
const draftReviewWorkflowName = "Lex Draft Review"

const draftReviewStepID = "draft_review"

// WithReviewEngine wires the shared workflow engine repositories and the
// draft-review projection repository into the drafting service, enabling the
// SubmitDraftForReview / GetDraftReview / CompleteDraftReview surface (Feature 4).
// It is additive and chainable; when unset those methods return 503 while every
// existing AID-* endpoint is unaffected.
func (s *DraftingService) WithReviewEngine(
	db *pgxpool.Pool,
	defRepo *workflowrepo.DefinitionRepository,
	instRepo *workflowrepo.InstanceRepository,
	reviews *repository.DraftReviewRepository,
	appMetrics *metrics.Metrics,
	publisher Publisher,
	topic string,
) *DraftingService {
	s.db = db
	s.reviewDefRepo = defRepo
	s.reviewInstRepo = instRepo
	s.reviews = reviews
	s.reviewMetrics = appMetrics
	s.reviewPublisher = publisherOrNoop(publisher)
	s.reviewTopic = topic
	if s.now == nil {
		s.now = time.Now
	}
	return s
}

func (s *DraftingService) reviewEngineReady() error {
	if s.db == nil || s.reviewDefRepo == nil || s.reviewInstRepo == nil || s.reviews == nil {
		return draftingUnavailable()
	}
	return nil
}

// SubmitDraftForReview creates an engine-tracked HumanTask carrying the supplied
// AI-draft content as task form data and persists the lex-side review projection
// linking the draft to the engine instance/task. The whole operation is one
// transaction: instance + step execution + human task + draft-review row commit
// atomically. draftID is a stable, caller-supplied identifier for the draft (AI
// outputs are not otherwise persisted by the drafting engine).
func (s *DraftingService) SubmitDraftForReview(ctx context.Context, tenantID, userID, draftID uuid.UUID, req dto.SubmitDraftForReviewRequest) (*model.DraftReview, error) {
	if err := s.reviewEngineReady(); err != nil {
		return nil, err
	}
	if draftID == uuid.Nil {
		return nil, validationError("draft id is required", map[string]string{"id": "required"})
	}
	req.Normalize()
	if req.Title == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if len(req.Content) == 0 {
		return nil, validationError("content is required", map[string]string{"content": "required"})
	}
	if req.SLAHours < 0 {
		return nil, validationError("sla_hours must be non-negative", map[string]string{"sla_hours": "invalid"})
	}

	formSchema, err := buildDraftReviewFormSchema(req.FormFields)
	if err != nil {
		return nil, err
	}

	definition, err := s.ensureDraftReviewDefinition(ctx, tenantID, userID)
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
		CurrentStepID: ptrString(draftReviewStepID),
		Variables: map[string]any{
			"draft_id":   draftID.String(),
			"draft_kind": req.DraftKind,
			"title":      req.Title,
			"source":     "lex_draft_review",
		},
		StepOutputs: map[string]any{},
		StartedBy:   ptrString(userID.String()),
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start draft review transaction", err)
	}
	defer tx.Rollback(ctx)

	// Guard against a duplicate open review for the same draft. The partial unique
	// index also enforces this at the DB level; checking first yields a clean 409.
	if existing, gErr := s.reviews.GetOpenByDraft(ctx, tx, tenantID, draftID); gErr == nil && existing != nil {
		return nil, conflictError("draft already has an open review")
	} else if gErr != nil && gErr != pgx.ErrNoRows {
		return nil, internalError("check existing draft review", gErr)
	}

	if err := s.reviewInstRepo.Create(ctx, instance); err != nil {
		return nil, internalError("create draft review workflow instance", err)
	}
	stepExec := &workflowmodel.StepExecution{
		InstanceID: instance.ID,
		StepID:     draftReviewStepID,
		StepType:   workflowmodel.StepTypeHumanTask,
		Status:     workflowmodel.StepStatusPending,
		Attempt:    1,
		CreatedAt:  now,
	}
	if err := s.reviewInstRepo.CreateStepExecution(ctx, stepExec); err != nil {
		return nil, internalError("create draft review step execution", err)
	}

	taskMetadata := map[string]any{
		"draft_id":   draftID.String(),
		"draft_kind": req.DraftKind,
		"title":      req.Title,
		"source":     "lex_draft_review",
	}
	for key, value := range req.Metadata {
		if _, exists := taskMetadata[key]; !exists {
			taskMetadata[key] = value
		}
	}
	task := &workflowmodel.HumanTask{
		TenantID:     tenantID.String(),
		InstanceID:   instance.ID,
		StepID:       draftReviewStepID,
		StepExecID:   stepExec.ID,
		Name:         "Review AI draft: " + req.Title,
		Description:  "Human review of an AI-generated draft.",
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: req.AssigneeRole,
		FormSchema:   formSchema,
		FormData:     map[string]any{"draft": req.Content},
		Metadata:     taskMetadata,
	}
	if req.AssigneeID != nil && *req.AssigneeID != uuid.Nil {
		assignee := req.AssigneeID.String()
		task.AssigneeID = &assignee
	}
	var slaDeadline *time.Time
	if req.SLAHours > 0 {
		deadline := now.Add(time.Duration(req.SLAHours) * time.Hour)
		task.SLADeadline = &deadline
		slaDeadline = &deadline
	}
	if err := insertWorkflowTask(ctx, tx, task); err != nil {
		return nil, internalError("create draft review task", err)
	}

	taskID, err := uuid.Parse(task.ID)
	if err != nil {
		return nil, internalError("parse draft review task id", err)
	}
	instanceID := uuid.MustParse(instance.ID)
	review := &model.DraftReview{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		DraftID:            draftID,
		Title:              req.Title,
		DraftKind:          req.DraftKind,
		Content:            req.Content,
		ReviewStatus:       model.DraftReviewStatusPending,
		ReviewTaskID:       &taskID,
		WorkflowInstanceID: &instanceID,
		AssigneeID:         req.AssigneeID,
		AssigneeRole:       req.AssigneeRole,
		SLADeadline:        slaDeadline,
		SubmittedBy:        &userID,
		Metadata:           req.Metadata,
	}
	if err := s.reviews.Create(ctx, tx, review); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("draft already has an open review")
		}
		return nil, internalError("persist draft review", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit draft review transaction", err)
	}

	if s.reviewMetrics != nil {
		s.reviewMetrics.WorkflowActive.Inc()
	}
	writeEvent(ctx, s.reviewPublisher, "lex-service", s.reviewTopic, "com.clario360.lex.draft.review_submitted", tenantID, &userID, map[string]any{
		"id":                   review.ID,
		"draft_id":             draftID,
		"task_id":              taskID,
		"workflow_instance_id": instanceID,
		"draft_kind":           req.DraftKind,
	}, s.logger)

	return review, nil
}

// GetDraftReview returns the most recent review projection for a draft.
func (s *DraftingService) GetDraftReview(ctx context.Context, tenantID, draftID uuid.UUID) (*model.DraftReview, error) {
	if err := s.reviewEngineReady(); err != nil {
		return nil, err
	}
	review, err := s.reviews.GetByDraft(ctx, tenantID, draftID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("draft review not found")
		}
		return nil, internalError("get draft review", err)
	}
	return review, nil
}

// CompleteDraftReview projects an engine task outcome back onto the draft-review
// row. It is the lex-side completion handler for the draft_review workflow: when
// the engine HumanTask is decided (approve/reject/request_changes) this maps the
// decision to a terminal review_status and records the reviewer + notes. It is
// idempotent — completing an already-terminal review is a no-op.
//
// NOTE: this is invoked by the engine task-completion path (see deferred wiring
// note in the L4 report). It can also be called directly by a lex completion
// endpoint should one be added.
func (s *DraftingService) CompleteDraftReview(ctx context.Context, tenantID, taskID, reviewerID uuid.UUID, decision, notes string) (*model.DraftReview, error) {
	if err := s.reviewEngineReady(); err != nil {
		return nil, err
	}
	status, err := draftReviewStatusForDecision(decision)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start draft review completion transaction", err)
	}
	defer tx.Rollback(ctx)

	review, err := s.reviews.GetByTask(ctx, tx, tenantID, taskID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("draft review not found for task")
		}
		return nil, internalError("load draft review for completion", err)
	}
	if review.ReviewStatus != model.DraftReviewStatusPending {
		// Already terminal: idempotent no-op, return current state.
		return review, nil
	}

	now := s.now().UTC()
	var reviewer *uuid.UUID
	if reviewerID != uuid.Nil {
		reviewer = &reviewerID
	}
	outcome := model.DraftReviewOutcome{
		ID:           review.ID,
		TenantID:     tenantID,
		ReviewStatus: status,
		ReviewNotes:  notes,
		ReviewedBy:   reviewer,
		ReviewedAt:   now,
	}
	if err := s.reviews.MarkReviewed(ctx, tx, outcome); err != nil {
		if err == pgx.ErrNoRows {
			// Lost a race to another completion; reload and return the row.
			current, gErr := s.reviews.GetByTask(ctx, tx, tenantID, taskID)
			if gErr != nil {
				return nil, internalError("reload draft review after race", gErr)
			}
			return current, nil
		}
		return nil, internalError("mark draft review reviewed", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit draft review completion transaction", err)
	}

	review.ReviewStatus = status
	review.ReviewNotes = notes
	review.ReviewedBy = reviewer
	review.ReviewedAt = &now

	writeEvent(ctx, s.reviewPublisher, "lex-service", s.reviewTopic, "com.clario360.lex.draft.review_completed", tenantID, reviewer, map[string]any{
		"id":            review.ID,
		"draft_id":      review.DraftID,
		"task_id":       taskID,
		"review_status": status,
		"decision":      decision,
	}, s.logger)

	return review, nil
}

// ensureDraftReviewDefinition loads (or creates) the per-tenant minimal
// draft-review workflow definition.
func (s *DraftingService) ensureDraftReviewDefinition(ctx context.Context, tenantID, userID uuid.UUID) (*workflowmodel.WorkflowDefinition, error) {
	var existing workflowmodel.WorkflowDefinition
	err := s.db.QueryRow(ctx, `
		SELECT id, version
		FROM workflow_definitions
		WHERE tenant_id = $1 AND name = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY version DESC
		LIMIT 1`,
		tenantID, draftReviewWorkflowName,
	).Scan(&existing.ID, &existing.Version)
	if err == nil {
		existing.TenantID = tenantID.String()
		return &existing, nil
	}
	if err != pgx.ErrNoRows {
		return nil, internalError("load draft review workflow definition", err)
	}
	definition := &workflowmodel.WorkflowDefinition{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		Name:        draftReviewWorkflowName,
		Description: "Human review of AI-generated drafts for Clario Lex.",
		Version:     1,
		Status:      workflowmodel.DefinitionStatusActive,
		TriggerConfig: workflowmodel.TriggerConfig{
			Type: workflowmodel.TriggerTypeManual,
		},
		Variables: map[string]workflowmodel.VariableDef{
			"draft_id":   {Type: "string"},
			"draft_kind": {Type: "string"},
			"title":      {Type: "string"},
		},
		Steps: []workflowmodel.StepDefinition{
			{ID: draftReviewStepID, Type: workflowmodel.StepTypeHumanTask, Name: "Draft Review", Config: map[string]any{}, Transitions: []workflowmodel.Transition{{Target: "end"}}},
			{ID: "end", Type: workflowmodel.StepTypeEnd, Name: "Completed", Config: map[string]any{}, Transitions: nil},
		},
		CreatedBy: userID.String(),
	}
	if err := s.reviewDefRepo.Create(ctx, definition); err != nil {
		return nil, internalError("create draft review workflow definition", err)
	}
	return definition, nil
}

// buildDraftReviewFormSchema assembles the reviewer form: a default decision +
// notes pair plus any caller-supplied additional fields. Field validation reuses
// the same approvalFormField helper (name/type/label/options/visible_when) used
// by contract reviews so conditional visibility is parsed with the engine
// expression evaluator at write time.
func buildDraftReviewFormSchema(reqFields []dto.ApprovalFormFieldRequest) ([]workflowmodel.FormField, error) {
	schema := []workflowmodel.FormField{
		{Name: "decision", Type: "select", Label: "Decision", Required: true, Options: []string{"approve", "request_changes", "reject"}},
		{Name: "notes", Type: "textarea", Label: "Review notes", Required: false},
	}
	seen := map[string]struct{}{"decision": {}, "notes": {}}
	for _, reqField := range reqFields {
		field, err := approvalFormField(reqField)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[field.Name]; exists {
			return nil, validationError("draft review form field names must be unique and cannot use reserved fields", map[string]string{"form_fields.name": "duplicate"})
		}
		seen[field.Name] = struct{}{}
		schema = append(schema, field)
	}
	return schema, nil
}

// draftReviewStatusForDecision maps an engine decision verb to a terminal
// draft-review status.
func draftReviewStatusForDecision(decision string) (string, error) {
	switch decision {
	case "approve", "approved":
		return model.DraftReviewStatusApproved, nil
	case "reject", "rejected":
		return model.DraftReviewStatusRejected, nil
	case "request_changes", "changes_requested":
		return model.DraftReviewStatusChangesRequested, nil
	default:
		return "", validationError("decision must be one of approve, request_changes, reject", map[string]string{"decision": "invalid"})
	}
}
