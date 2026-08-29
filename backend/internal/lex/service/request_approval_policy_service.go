package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/middleware"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

// RequestApprovalPolicyService owns the subject-agnostic request-approval policy
// stack (CAP-006, CAP-007): CRUD, scope-based recommendation, scope-conflict
// detection, and the governance trio (immutable versions, append-only audit,
// reusable templates). It mirrors the contract WorkflowService approval-policy
// surface but routes approvals for legal *requests* (request_type / service /
// stage) rather than contracts.
type RequestApprovalPolicyService struct {
	db        *pgxpool.Pool
	repo      *repository.RequestApprovalPolicyRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

// NewRequestApprovalPolicyService mirrors the NewMatterService constructor shape
// (db, repo, publisher, appMetrics, topic, logger).
func NewRequestApprovalPolicyService(db *pgxpool.Pool, repo *repository.RequestApprovalPolicyRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *RequestApprovalPolicyService {
	return &RequestApprovalPolicyService{
		db:        db,
		repo:      repo,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger,
		now:       time.Now,
	}
}

const requestApprovalEventEntity = "com.clario360.lex.request_approval_policies"

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Create persists a new request-approval policy. Identical-scope duplicates
// hard-fail; overlapping scopes only warn (the warning is surfaced by
// CreateWithConflicts).
func (s *RequestApprovalPolicyService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateRequestApprovalPolicyRequest) (*model.RequestApprovalPolicy, error) {
	policy, err := requestApprovalPolicyFromCreateRequest(tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	if conflicts, cerr := s.ConflictCheck(ctx, tenantID, policy, nil); cerr == nil {
		if hasRequestIdenticalConflict(conflicts) {
			return nil, conflictError("an active request approval policy already targets the identical scope")
		}
	} else {
		return nil, cerr
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin create request approval policy", err)
	}
	defer tx.Rollback(ctx)

	if err := s.repo.Create(ctx, tx, policy); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a request approval policy with this name already exists")
		}
		return nil, internalError("create request approval policy", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, policy.ID, model.RequestApprovalPolicyAuditCreated, userID, nil, policy); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit create request approval policy", err)
	}
	s.writeLifecycleEvent(ctx, "created", tenantID, userID, policy)
	return policy, nil
}

// Get loads a single policy by id.
func (s *RequestApprovalPolicyService) Get(ctx context.Context, tenantID, policyID uuid.UUID) (*model.RequestApprovalPolicy, error) {
	if policyID == uuid.Nil {
		return nil, validationError("request approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	policy, err := s.repo.Get(ctx, tenantID, policyID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy not found")
		}
		return nil, internalError("load request approval policy", err)
	}
	return policy, nil
}

// List returns a paginated page of policies.
func (s *RequestApprovalPolicyService) List(ctx context.Context, tenantID uuid.UUID, filters model.RequestApprovalPolicyListFilters) ([]model.RequestApprovalPolicy, int, error) {
	filters.Page, filters.PerPage = serviceNormalizePage(filters.Page, filters.PerPage)
	items, total, err := s.repo.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list request approval policies", err)
	}
	return items, total, nil
}

// Update applies a patch over the existing policy and persists the new state
// with an incremented version, snapshotting the prior state into history.
func (s *RequestApprovalPolicyService) Update(ctx context.Context, tenantID, userID, policyID uuid.UUID, req dto.UpdateRequestApprovalPolicyRequest) (*model.RequestApprovalPolicy, error) {
	existing, err := s.Get(ctx, tenantID, policyID)
	if err != nil {
		return nil, err
	}
	createReq := requestApprovalPolicyCreateRequestFromModel(existing)
	applyRequestApprovalPolicyUpdateRequest(&createReq, req)
	desired, err := requestApprovalPolicyFromCreateRequest(tenantID, existing.CreatedBy, createReq)
	if err != nil {
		return nil, err
	}

	if conflicts, cerr := s.ConflictCheck(ctx, tenantID, desired, &policyID); cerr == nil {
		if hasRequestIdenticalConflict(conflicts) {
			return nil, conflictError("another active request approval policy already targets the identical scope")
		}
	} else {
		return nil, cerr
	}

	updated, err := s.updateTx(ctx, tenantID, userID, policyID, existing, desired, model.RequestApprovalPolicyAuditUpdated)
	if err != nil {
		return nil, err
	}
	s.writeLifecycleEvent(ctx, "updated", tenantID, userID, updated)
	return updated, nil
}

// updateTx snapshots the current state into immutable history, persists the
// desired state (version + 1), and appends an audit entry — all in one
// transaction. `existing` is the pre-update state.
func (s *RequestApprovalPolicyService) updateTx(ctx context.Context, tenantID, userID, policyID uuid.UUID, existing, desired *model.RequestApprovalPolicy, action model.RequestApprovalPolicyAuditAction) (*model.RequestApprovalPolicy, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin update request approval policy", err)
	}
	defer tx.Rollback(ctx)

	// 1. Snapshot the current policy into immutable history under its version.
	snapshot := *existing
	version := &model.RequestApprovalPolicyVersion{
		PolicyID:     policyID,
		TenantID:     tenantID,
		Version:      existing.Version,
		Snapshot:     snapshot,
		ChangeReason: string(action),
		CreatedBy:    actorPtr(userID),
	}
	if err := s.repo.SaveVersion(ctx, tx, version); err != nil {
		return nil, internalError("snapshot request approval policy version", err)
	}

	// 2. Persist the new state with an incremented version.
	desired.ID = policyID
	desired.TenantID = tenantID
	desired.UpdatedBy = actorPtr(userID)
	if err := s.repo.Update(ctx, tx, desired); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy not found")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("a request approval policy with this name already exists")
		}
		return nil, internalError("update request approval policy", err)
	}

	// 3. Append the audit entry (before = pre-update, after = new state).
	if err := s.appendAudit(ctx, tx, tenantID, policyID, action, userID, existing, desired); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit update request approval policy", err)
	}
	return desired, nil
}

// Archive flips a policy to archived (snapshotting + auditing in one tx) and
// emits an archived event.
func (s *RequestApprovalPolicyService) Archive(ctx context.Context, tenantID, userID, policyID uuid.UUID) error {
	existing, err := s.Get(ctx, tenantID, policyID)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("begin archive request approval policy", err)
	}
	defer tx.Rollback(ctx)

	snapshot := *existing
	version := &model.RequestApprovalPolicyVersion{
		PolicyID:     policyID,
		TenantID:     tenantID,
		Version:      existing.Version,
		Snapshot:     snapshot,
		ChangeReason: string(model.RequestApprovalPolicyAuditArchived),
		CreatedBy:    actorPtr(userID),
	}
	if err := s.repo.SaveVersion(ctx, tx, version); err != nil {
		return internalError("snapshot request approval policy version", err)
	}
	archived, err := s.repo.Archive(ctx, tx, tenantID, policyID, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundError("request approval policy not found")
		}
		return internalError("archive request approval policy", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, policyID, model.RequestApprovalPolicyAuditArchived, userID, existing, archived); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit archive request approval policy", err)
	}
	s.writeLifecycleEvent(ctx, "archived", tenantID, userID, archived)
	return nil
}

// Delete soft-deletes a policy.
func (s *RequestApprovalPolicyService) Delete(ctx context.Context, tenantID, userID, policyID uuid.UUID) error {
	if policyID == uuid.Nil {
		return validationError("request approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	if err := s.repo.SoftDelete(ctx, tenantID, policyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundError("request approval policy not found")
		}
		return internalError("delete request approval policy", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, requestApprovalEventEntity+".deleted", tenantID, &userID, map[string]any{
		"id": policyID,
	}, s.logger)
	return nil
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

// RecommendInput carries the concrete request attributes used to resolve the
// best-match active policy.
type RecommendInput struct {
	RequestType  *string
	ServiceID    *uuid.UUID
	Stage        *model.RequestApprovalStage
	Department   *string
	PriorityTier *string
	Value        *float64
	Currency     string
}

// Recommend resolves the single best-match active, in-window policy for a
// concrete request.
func (s *RequestApprovalPolicyService) Recommend(ctx context.Context, tenantID uuid.UUID, in RecommendInput) (*model.RequestApprovalPolicyRecommendation, error) {
	value := float64(0)
	if in.Value != nil {
		value = *in.Value
	}
	candidate := repository.RecommendCandidate{
		RequestType:  normalizeOptionalString(in.RequestType),
		ServiceID:    in.ServiceID,
		Stage:        in.Stage,
		Department:   normalizeOptionalString(in.Department),
		PriorityTier: normalizeOptionalString(in.PriorityTier),
		Value:        value,
		Currency:     in.Currency,
		At:           s.now().UTC(),
	}
	policy, err := s.repo.Recommend(ctx, tenantID, candidate)
	if err != nil {
		return nil, internalError("recommend request approval policy", err)
	}
	if policy == nil {
		return &model.RequestApprovalPolicyRecommendation{Matched: false, Reason: "no active request approval policy matched this request"}, nil
	}
	return &model.RequestApprovalPolicyRecommendation{Policy: policy, Matched: true, Reason: "matched by request type, service, stage, department, priority tier, currency, value range, and priority"}, nil
}

// ---------------------------------------------------------------------------
// Conflict-aware mutation wrappers
// ---------------------------------------------------------------------------

// RequestApprovalPolicyMutationResult bundles a created/updated policy with any
// advisory (non-fatal) scope conflicts detected against it.
type RequestApprovalPolicyMutationResult struct {
	Policy    *model.RequestApprovalPolicy    `json:"policy"`
	Conflicts []RequestApprovalPolicyConflict `json:"conflicts,omitempty"`
}

// CreateWithConflicts creates a policy and returns overlapping (non-identical)
// active policies as warnings.
func (s *RequestApprovalPolicyService) CreateWithConflicts(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateRequestApprovalPolicyRequest) (*RequestApprovalPolicyMutationResult, error) {
	conflicts, err := s.PreviewConflicts(ctx, tenantID, userID, req, nil)
	if err != nil {
		return nil, err
	}
	policy, err := s.Create(ctx, tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	return &RequestApprovalPolicyMutationResult{Policy: policy, Conflicts: conflicts}, nil
}

// UpdateWithConflicts updates a policy and returns overlapping (non-identical)
// active policies as warnings.
func (s *RequestApprovalPolicyService) UpdateWithConflicts(ctx context.Context, tenantID, userID, policyID uuid.UUID, req dto.UpdateRequestApprovalPolicyRequest) (*RequestApprovalPolicyMutationResult, error) {
	updated, err := s.Update(ctx, tenantID, userID, policyID, req)
	if err != nil {
		return nil, err
	}
	conflicts, cerr := s.ConflictCheck(ctx, tenantID, updated, &policyID)
	if cerr != nil {
		return nil, cerr
	}
	return &RequestApprovalPolicyMutationResult{Policy: updated, Conflicts: conflicts}, nil
}

// ---------------------------------------------------------------------------
// Governance: version history
// ---------------------------------------------------------------------------

// ListVersions returns the immutable version history for a policy, newest first.
func (s *RequestApprovalPolicyService) ListVersions(ctx context.Context, tenantID, policyID uuid.UUID) ([]model.RequestApprovalPolicyVersion, error) {
	if _, err := s.Get(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	versions, err := s.repo.ListVersions(ctx, tenantID, policyID)
	if err != nil {
		return nil, internalError("list request approval policy versions", err)
	}
	return versions, nil
}

// GetVersion returns a single immutable version snapshot.
func (s *RequestApprovalPolicyService) GetVersion(ctx context.Context, tenantID, policyID uuid.UUID, version int) (*model.RequestApprovalPolicyVersion, error) {
	if version < 1 {
		return nil, validationError("version must be a positive integer", map[string]string{"version": "invalid"})
	}
	if _, err := s.Get(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	snapshot, err := s.repo.GetVersion(ctx, tenantID, policyID, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy version not found")
		}
		return nil, internalError("load request approval policy version", err)
	}
	return snapshot, nil
}

// RestoreVersion re-applies a historical snapshot as a NEW current version.
func (s *RequestApprovalPolicyService) RestoreVersion(ctx context.Context, tenantID, userID, policyID uuid.UUID, version int) (*model.RequestApprovalPolicy, error) {
	if version < 1 {
		return nil, validationError("version must be a positive integer", map[string]string{"version": "invalid"})
	}
	existing, err := s.Get(ctx, tenantID, policyID)
	if err != nil {
		return nil, err
	}
	snapshotRow, err := s.repo.GetVersion(ctx, tenantID, policyID, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy version not found")
		}
		return nil, internalError("load request approval policy version", err)
	}
	desired := snapshotRow.Snapshot
	desired.ID = existing.ID
	desired.TenantID = tenantID
	desired.CreatedBy = existing.CreatedBy
	desired.CreatedAt = existing.CreatedAt
	desired.Version = existing.Version
	if err := validateApprovalPolicyWindow(desired.ValidFrom, desired.ValidUntil); err != nil {
		return nil, err
	}
	restored, err := s.updateTx(ctx, tenantID, userID, policyID, existing, &desired, model.RequestApprovalPolicyAuditRestored)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, requestApprovalEventEntity+".restored", tenantID, &userID, map[string]any{
		"id":               restored.ID,
		"name":             restored.Name,
		"restored_version": version,
		"new_version":      restored.Version,
	}, s.logger)
	return restored, nil
}

// ---------------------------------------------------------------------------
// Governance: audit log
// ---------------------------------------------------------------------------

// ListAudit returns paginated audit entries for a policy, newest first.
func (s *RequestApprovalPolicyService) ListAudit(ctx context.Context, tenantID, policyID uuid.UUID, page, perPage int) ([]model.RequestApprovalPolicyAuditEntry, error) {
	if _, err := s.Get(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	page, perPage = serviceNormalizePage(page, perPage)
	entries, err := s.repo.ListAudit(ctx, tenantID, policyID, perPage, (page-1)*perPage)
	if err != nil {
		return nil, internalError("list request approval policy audit", err)
	}
	return entries, nil
}

// appendAudit writes a single append-only audit entry inside the supplied
// transaction. before/after may be nil (before is nil on create).
func (s *RequestApprovalPolicyService) appendAudit(ctx context.Context, q repository.Queryer, tenantID, policyID uuid.UUID, action model.RequestApprovalPolicyAuditAction, actorID uuid.UUID, before, after *model.RequestApprovalPolicy) error {
	entry := &model.RequestApprovalPolicyAuditEntry{
		TenantID:  tenantID,
		PolicyID:  policyID,
		Action:    action,
		ActorID:   actorPtr(actorID),
		Before:    cloneRequestApprovalPolicyPtr(before),
		After:     cloneRequestApprovalPolicyPtr(after),
		RequestID: middleware.GetRequestID(ctx),
	}
	if err := s.repo.AppendAudit(ctx, q, entry); err != nil {
		return internalError("append request approval policy audit", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Governance: templates
// ---------------------------------------------------------------------------

// CreateTemplate persists a new reusable template after validating its
// definition materialises into a valid policy request.
func (s *RequestApprovalPolicyService) CreateTemplate(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateRequestApprovalPolicyTemplateRequest) (*model.RequestApprovalPolicyTemplate, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, validationError("request approval policy template name is required", map[string]string{"name": "required"})
	}
	definition := cloneAnyMap(req.Definition)
	if _, err := requestApprovalPolicyRequestFromDefinition(definition); err != nil {
		return nil, err
	}
	actor := actorPtr(userID)
	tmpl := &model.RequestApprovalPolicyTemplate{
		TenantID:    tenantID,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		Category:    strings.TrimSpace(req.Category),
		Definition:  definition,
		CreatedBy:   actor,
		UpdatedBy:   actor,
	}
	if err := s.repo.CreateTemplate(ctx, s.db, tmpl); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a request approval policy template with this name already exists")
		}
		return nil, internalError("create request approval policy template", err)
	}
	return tmpl, nil
}

// ListTemplates returns all templates for a tenant.
func (s *RequestApprovalPolicyService) ListTemplates(ctx context.Context, tenantID uuid.UUID) ([]model.RequestApprovalPolicyTemplate, error) {
	templates, err := s.repo.ListTemplates(ctx, tenantID)
	if err != nil {
		return nil, internalError("list request approval policy templates", err)
	}
	return templates, nil
}

// GetTemplate loads a single template.
func (s *RequestApprovalPolicyService) GetTemplate(ctx context.Context, tenantID, templateID uuid.UUID) (*model.RequestApprovalPolicyTemplate, error) {
	if templateID == uuid.Nil {
		return nil, validationError("request approval policy template id is invalid", map[string]string{"id": "invalid"})
	}
	tmpl, err := s.repo.GetTemplate(ctx, tenantID, templateID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy template not found")
		}
		return nil, internalError("load request approval policy template", err)
	}
	return tmpl, nil
}

// UpdateTemplate patches a template in place.
func (s *RequestApprovalPolicyService) UpdateTemplate(ctx context.Context, tenantID, userID, templateID uuid.UUID, req dto.UpdateRequestApprovalPolicyTemplateRequest) (*model.RequestApprovalPolicyTemplate, error) {
	tmpl, err := s.GetTemplate(ctx, tenantID, templateID)
	if err != nil {
		return nil, err
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, validationError("request approval policy template name is required", map[string]string{"name": "required"})
		}
		tmpl.Name = name
	}
	if req.Description != nil {
		tmpl.Description = strings.TrimSpace(*req.Description)
	}
	if req.Category != nil {
		tmpl.Category = strings.TrimSpace(*req.Category)
	}
	if req.Definition != nil {
		definition := cloneAnyMap(req.Definition)
		if _, derr := requestApprovalPolicyRequestFromDefinition(definition); derr != nil {
			return nil, derr
		}
		tmpl.Definition = definition
	}
	tmpl.UpdatedBy = actorPtr(userID)
	if err := s.repo.UpdateTemplate(ctx, s.db, tmpl); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("request approval policy template not found")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("a request approval policy template with this name already exists")
		}
		return nil, internalError("update request approval policy template", err)
	}
	return tmpl, nil
}

// DeleteTemplate removes a template (referencing policies keep their template_id
// nulled by the FK).
func (s *RequestApprovalPolicyService) DeleteTemplate(ctx context.Context, tenantID, templateID uuid.UUID) error {
	if templateID == uuid.Nil {
		return validationError("request approval policy template id is invalid", map[string]string{"id": "invalid"})
	}
	if err := s.repo.DeleteTemplate(ctx, s.db, tenantID, templateID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundError("request approval policy template not found")
		}
		return internalError("delete request approval policy template", err)
	}
	return nil
}

// InstantiateTemplate materialises a new policy from a template's definition,
// applies overrides, stamps template_id, persists it, and records a
// template_applied audit entry.
func (s *RequestApprovalPolicyService) InstantiateTemplate(ctx context.Context, tenantID, userID, templateID uuid.UUID, overrides *dto.UpdateRequestApprovalPolicyRequest) (*model.RequestApprovalPolicy, error) {
	tmpl, err := s.GetTemplate(ctx, tenantID, templateID)
	if err != nil {
		return nil, err
	}
	createReq, err := requestApprovalPolicyRequestFromDefinition(tmpl.Definition)
	if err != nil {
		return nil, err
	}
	if overrides != nil {
		applyRequestApprovalPolicyUpdateRequest(&createReq, *overrides)
	}
	createReq.TemplateID = &tmpl.ID
	if strings.TrimSpace(createReq.Name) == "" {
		createReq.Name = tmpl.Name
	}
	policy, err := requestApprovalPolicyFromCreateRequest(tenantID, userID, createReq)
	if err != nil {
		return nil, err
	}
	if conflicts, cerr := s.ConflictCheck(ctx, tenantID, policy, nil); cerr == nil {
		if hasRequestIdenticalConflict(conflicts) {
			return nil, conflictError("an active request approval policy already targets the identical scope")
		}
	} else {
		return nil, cerr
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin instantiate request approval policy", err)
	}
	defer tx.Rollback(ctx)

	if err := s.repo.Create(ctx, tx, policy); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a request approval policy with this name already exists")
		}
		return nil, internalError("instantiate request approval policy", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, policy.ID, model.RequestApprovalPolicyAuditTemplateApplied, userID, nil, policy); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit instantiate request approval policy", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, requestApprovalEventEntity+".created", tenantID, &userID, map[string]any{
		"id":          policy.ID,
		"name":        policy.Name,
		"status":      policy.Status,
		"template_id": tmpl.ID,
	}, s.logger)
	return policy, nil
}

// ---------------------------------------------------------------------------
// builders / helpers
// ---------------------------------------------------------------------------

func (s *RequestApprovalPolicyService) writeLifecycleEvent(ctx context.Context, verb string, tenantID, userID uuid.UUID, policy *model.RequestApprovalPolicy) {
	writeEvent(ctx, s.publisher, "lex-service", s.topic, requestApprovalEventEntity+"."+verb, tenantID, &userID, map[string]any{
		"id":     policy.ID,
		"name":   policy.Name,
		"status": policy.Status,
	}, s.logger)
}

func actorPtr(userID uuid.UUID) *uuid.UUID {
	if userID == uuid.Nil {
		return nil
	}
	out := userID
	return &out
}

func cloneRequestApprovalPolicyPtr(p *model.RequestApprovalPolicy) *model.RequestApprovalPolicy {
	if p == nil {
		return nil
	}
	out := *p
	return &out
}

// requestApprovalPolicyFromCreateRequest validates a create request and builds a
// concrete policy model (with a fresh id). It mirrors approvalPolicyFromCreateRequest
// but for the request scope dimensions.
func requestApprovalPolicyFromCreateRequest(tenantID, userID uuid.UUID, req dto.CreateRequestApprovalPolicyRequest) (*model.RequestApprovalPolicy, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, validationError("request approval policy name is required", map[string]string{"name": "required"})
	}
	status := req.Status
	if status == "" {
		status = model.RequestApprovalPolicyStatusActive
	}
	switch status {
	case model.RequestApprovalPolicyStatusDraft, model.RequestApprovalPolicyStatusActive, model.RequestApprovalPolicyStatusArchived:
	default:
		return nil, validationError("request approval policy status is invalid", map[string]string{"status": "invalid"})
	}
	stage, err := normalizeRequestStage(req.Stage)
	if err != nil {
		return nil, err
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = workflowexec.ApprovalModeParallel
	}
	quorum := strings.ToLower(strings.TrimSpace(req.Quorum))
	if quorum == "" {
		quorum = workflowexec.QuorumAll
	}
	if quorum != workflowexec.QuorumNofM && req.QuorumN != nil {
		return nil, validationError("quorum_n is only allowed when quorum is n_of_m", map[string]string{"quorum_n": "invalid"})
	}
	approvers := make([]model.ApprovalPolicyApprover, 0, len(req.Approvers))
	configApprovers := make([]any, 0, len(req.Approvers))
	for idx, approver := range req.Approvers {
		typ := strings.ToLower(strings.TrimSpace(approver.Type))
		ref := strings.TrimSpace(approver.Ref)
		if typ != "user" && typ != "role" {
			return nil, validationError("request approval policy approver type must be user or role", map[string]string{fmt.Sprintf("approvers.%d.type", idx): "invalid"})
		}
		if ref == "" {
			return nil, validationError("request approval policy approver ref is required", map[string]string{fmt.Sprintf("approvers.%d.ref", idx): "required"})
		}
		approvers = append(approvers, model.ApprovalPolicyApprover{Type: typ, Ref: ref, Label: strings.TrimSpace(approver.Label)})
		configApprovers = append(configApprovers, map[string]any{"type": typ, "ref": ref})
	}
	cfgMap := map[string]any{"approvers": configApprovers, "mode": mode, "quorum": quorum}
	if req.QuorumN != nil {
		cfgMap["quorum_n"] = *req.QuorumN
	}
	if _, err := workflowexec.ParseApprovalConfig(cfgMap); err != nil {
		return nil, validationError("request approval policy routing is invalid", map[string]string{"approvers": err.Error()})
	}
	formFields, err := requestApprovalPolicyFormFields(req.FormFields)
	if err != nil {
		return nil, err
	}
	if req.MinValue != nil && *req.MinValue < 0 {
		return nil, validationError("min_value must be non-negative", map[string]string{"min_value": "invalid"})
	}
	if req.MaxValue != nil && *req.MaxValue < 0 {
		return nil, validationError("max_value must be non-negative", map[string]string{"max_value": "invalid"})
	}
	if req.MinValue != nil && req.MaxValue != nil && *req.MinValue > *req.MaxValue {
		return nil, validationError("min_value cannot exceed max_value", map[string]string{"min_value": "invalid"})
	}
	if req.RequiredAuthorityAmount != nil && *req.RequiredAuthorityAmount < 0 {
		return nil, validationError("required_authority_amount must be non-negative", map[string]string{"required_authority_amount": "invalid"})
	}
	requireEvidence := true
	if req.RequireAuthorityEvidence != nil {
		requireEvidence = *req.RequireAuthorityEvidence
	}
	requiredRole := normalizeOptionalString(req.RequiredRole)
	if requiredRole != nil {
		normalized := normalizeWorkflowRole(*requiredRole)
		requiredRole = &normalized
	}
	if err := validateApprovalPolicyWindow(req.ValidFrom, req.ValidUntil); err != nil {
		return nil, err
	}
	return &model.RequestApprovalPolicy{
		ID:                       uuid.New(),
		TenantID:                 tenantID,
		Name:                     name,
		Description:              strings.TrimSpace(req.Description),
		Status:                   status,
		Priority:                 req.Priority,
		RequestType:              normalizeOptionalString(req.RequestType),
		ServiceID:                cloneUUIDPtr(req.ServiceID),
		Stage:                    stage,
		Department:               normalizeOptionalString(req.Department),
		PriorityTier:             normalizeOptionalString(req.PriorityTier),
		MinValue:                 cloneFloat64Ptr(req.MinValue),
		MaxValue:                 cloneFloat64Ptr(req.MaxValue),
		Currency:                 normalizeWorkflowCurrency(req.Currency),
		Mode:                     mode,
		Quorum:                   quorum,
		QuorumN:                  cloneIntPtr(req.QuorumN),
		Approvers:                approvers,
		FormFields:               formFields,
		RequireAuthorityEvidence: requireEvidence,
		RequiredRole:             requiredRole,
		RequiredAuthorityAmount:  cloneFloat64Ptr(req.RequiredAuthorityAmount),
		Metadata:                 cloneAnyMap(req.Metadata),
		ValidFrom:                cloneTimePtr(req.ValidFrom),
		ValidUntil:               cloneTimePtr(req.ValidUntil),
		TemplateID:               cloneUUIDPtr(req.TemplateID),
		CreatedBy:                userID,
	}, nil
}

func normalizeRequestStage(stage *model.RequestApprovalStage) (*model.RequestApprovalStage, error) {
	if stage == nil {
		return nil, nil
	}
	normalized := model.RequestApprovalStage(strings.ToLower(strings.TrimSpace(string(*stage))))
	if normalized == "" {
		return nil, nil
	}
	switch normalized {
	case model.RequestApprovalStageRequester, model.RequestApprovalStageProvider:
		return &normalized, nil
	default:
		return nil, validationError("stage must be requester or provider", map[string]string{"stage": "invalid"})
	}
}

func requestApprovalPolicyFormFields(fields []dto.ApprovalFormFieldRequest) ([]model.ApprovalPolicyFormField, error) {
	out := make([]model.ApprovalPolicyFormField, 0, len(fields))
	seen := map[string]struct{}{}
	for _, reqField := range fields {
		name := strings.TrimSpace(reqField.Name)
		if name == "" {
			return nil, validationError("request approval policy form field name is required", map[string]string{"form_fields.name": "required"})
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			return nil, validationError("request approval policy form field names must be unique", map[string]string{"form_fields.name": "duplicate"})
		}
		seen[key] = struct{}{}
		out = append(out, model.ApprovalPolicyFormField{
			Name:        name,
			Type:        strings.TrimSpace(reqField.Type),
			Label:       strings.TrimSpace(reqField.Label),
			Required:    reqField.Required,
			Options:     append([]string(nil), reqField.Options...),
			Placeholder: reqField.Placeholder,
			Description: reqField.Description,
			VisibleWhen: reqField.VisibleWhen,
		})
	}
	return out, nil
}

// requestApprovalPolicyCreateRequestFromModel projects a stored policy back into a
// create request so an update patch can be applied over it.
func requestApprovalPolicyCreateRequestFromModel(policy *model.RequestApprovalPolicy) dto.CreateRequestApprovalPolicyRequest {
	if policy == nil {
		return dto.CreateRequestApprovalPolicyRequest{}
	}
	approvers := make([]dto.ApprovalPolicyApprover, 0, len(policy.Approvers))
	for _, approver := range policy.Approvers {
		approvers = append(approvers, dto.ApprovalPolicyApprover{Type: approver.Type, Ref: approver.Ref, Label: approver.Label})
	}
	formFields := make([]dto.ApprovalFormFieldRequest, 0, len(policy.FormFields))
	for _, field := range policy.FormFields {
		formFields = append(formFields, dto.ApprovalFormFieldRequest{
			Name:        field.Name,
			Type:        field.Type,
			Label:       field.Label,
			Required:    field.Required,
			Options:     append([]string(nil), field.Options...),
			Placeholder: field.Placeholder,
			Description: field.Description,
			VisibleWhen: field.VisibleWhen,
		})
	}
	requireEvidence := policy.RequireAuthorityEvidence
	return dto.CreateRequestApprovalPolicyRequest{
		Name:                     policy.Name,
		Description:              policy.Description,
		Status:                   policy.Status,
		Priority:                 policy.Priority,
		RequestType:              cloneStringPtr(policy.RequestType),
		ServiceID:                cloneUUIDPtr(policy.ServiceID),
		Stage:                    cloneRequestStagePtr(policy.Stage),
		Department:               cloneStringPtr(policy.Department),
		PriorityTier:             cloneStringPtr(policy.PriorityTier),
		MinValue:                 cloneFloat64Ptr(policy.MinValue),
		MaxValue:                 cloneFloat64Ptr(policy.MaxValue),
		Currency:                 policy.Currency,
		Mode:                     policy.Mode,
		Quorum:                   policy.Quorum,
		QuorumN:                  cloneIntPtr(policy.QuorumN),
		Approvers:                approvers,
		FormFields:               formFields,
		RequireAuthorityEvidence: &requireEvidence,
		RequiredRole:             cloneStringPtr(policy.RequiredRole),
		RequiredAuthorityAmount:  cloneFloat64Ptr(policy.RequiredAuthorityAmount),
		Metadata:                 cloneAnyMap(policy.Metadata),
		ValidFrom:                cloneTimePtr(policy.ValidFrom),
		ValidUntil:               cloneTimePtr(policy.ValidUntil),
		TemplateID:               cloneUUIDPtr(policy.TemplateID),
	}
}

func applyRequestApprovalPolicyUpdateRequest(req *dto.CreateRequestApprovalPolicyRequest, patch dto.UpdateRequestApprovalPolicyRequest) {
	if patch.Name != nil {
		req.Name = *patch.Name
	}
	if patch.Description != nil {
		req.Description = *patch.Description
	}
	if patch.Status != nil {
		req.Status = *patch.Status
	}
	if patch.Priority != nil {
		req.Priority = *patch.Priority
	}
	if patch.RequestType != nil {
		req.RequestType = cloneStringPtr(patch.RequestType)
	}
	if patch.ShouldClear("request_type") {
		req.RequestType = nil
	}
	if patch.ServiceID != nil {
		req.ServiceID = cloneUUIDPtr(patch.ServiceID)
	}
	if patch.ShouldClear("service_id") {
		req.ServiceID = nil
	}
	if patch.Stage != nil {
		req.Stage = cloneRequestStagePtr(patch.Stage)
	}
	if patch.ShouldClear("stage") {
		req.Stage = nil
	}
	if patch.Department != nil {
		req.Department = cloneStringPtr(patch.Department)
	}
	if patch.ShouldClear("department") {
		req.Department = nil
	}
	if patch.PriorityTier != nil {
		req.PriorityTier = cloneStringPtr(patch.PriorityTier)
	}
	if patch.ShouldClear("priority_tier") {
		req.PriorityTier = nil
	}
	if patch.MinValue != nil {
		req.MinValue = cloneFloat64Ptr(patch.MinValue)
	}
	if patch.ShouldClear("min_value") {
		req.MinValue = nil
	}
	if patch.MaxValue != nil {
		req.MaxValue = cloneFloat64Ptr(patch.MaxValue)
	}
	if patch.ShouldClear("max_value") {
		req.MaxValue = nil
	}
	if patch.Currency != nil {
		req.Currency = *patch.Currency
	}
	if patch.Mode != nil {
		req.Mode = *patch.Mode
	}
	if patch.Quorum != nil {
		req.Quorum = *patch.Quorum
		if strings.ToLower(strings.TrimSpace(*patch.Quorum)) != workflowexec.QuorumNofM && patch.QuorumN == nil {
			req.QuorumN = nil
		}
	}
	if patch.QuorumN != nil {
		req.QuorumN = cloneIntPtr(patch.QuorumN)
	}
	if patch.ShouldClear("quorum_n") {
		req.QuorumN = nil
	}
	if patch.Approvers != nil {
		req.Approvers = patch.Approvers
	}
	if patch.FormFields != nil {
		req.FormFields = patch.FormFields
	}
	if patch.RequireAuthorityEvidence != nil {
		req.RequireAuthorityEvidence = cloneBoolPtr(patch.RequireAuthorityEvidence)
	}
	if patch.RequiredRole != nil {
		req.RequiredRole = cloneStringPtr(patch.RequiredRole)
	}
	if patch.ShouldClear("required_role") {
		req.RequiredRole = nil
	}
	if patch.RequiredAuthorityAmount != nil {
		req.RequiredAuthorityAmount = cloneFloat64Ptr(patch.RequiredAuthorityAmount)
	}
	if patch.ShouldClear("required_authority_amount") {
		req.RequiredAuthorityAmount = nil
	}
	if patch.Metadata != nil {
		req.Metadata = cloneAnyMap(patch.Metadata)
	}
	if patch.ShouldClear("metadata") {
		req.Metadata = map[string]any{}
	}
	if patch.ValidFrom != nil {
		req.ValidFrom = cloneTimePtr(patch.ValidFrom)
	}
	if patch.ShouldClear("valid_from") {
		req.ValidFrom = nil
	}
	if patch.ValidUntil != nil {
		req.ValidUntil = cloneTimePtr(patch.ValidUntil)
	}
	if patch.ShouldClear("valid_until") {
		req.ValidUntil = nil
	}
}

func cloneRequestStagePtr(stage *model.RequestApprovalStage) *model.RequestApprovalStage {
	if stage == nil {
		return nil
	}
	out := *stage
	return &out
}

// requestApprovalPolicyRequestFromDefinition decodes a template definition into a
// CreateRequestApprovalPolicyRequest via a strict JSON round-trip.
func requestApprovalPolicyRequestFromDefinition(definition map[string]any) (dto.CreateRequestApprovalPolicyRequest, error) {
	var req dto.CreateRequestApprovalPolicyRequest
	if len(definition) == 0 {
		return req, nil
	}
	raw, err := json.Marshal(definition)
	if err != nil {
		return req, internalError("marshal request approval policy template definition", err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return dto.CreateRequestApprovalPolicyRequest{}, validationError("request approval policy template definition is invalid", map[string]string{"definition": err.Error()})
	}
	return req, nil
}
