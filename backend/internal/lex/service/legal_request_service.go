package service

import (
	"context"
	"errors"
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
)

// requestStatusTransitions is the allowed FSM edge set for the spine. Downstream
// domain services drive most edges; the spine enforces that only legal moves
// happen and owns the draft→submitted→approval edges directly.
var requestStatusTransitions = map[model.RequestStatus]map[model.RequestStatus]struct{}{
	model.RequestStatusDraft: {
		model.RequestStatusSubmitted: {},
		model.RequestStatusCancelled: {},
	},
	model.RequestStatusSubmitted: {
		model.RequestStatusPendingRequesterApproval: {},
		model.RequestStatusPendingProviderApproval:  {},
		model.RequestStatusApproved:                 {},
		model.RequestStatusReturned:                 {},
		model.RequestStatusCancelled:                {},
	},
	model.RequestStatusPendingRequesterApproval: {
		model.RequestStatusPendingProviderApproval: {},
		model.RequestStatusApproved:                {},
		model.RequestStatusReturned:                {},
		model.RequestStatusCancelled:               {},
	},
	model.RequestStatusPendingProviderApproval: {
		model.RequestStatusApproved:  {},
		model.RequestStatusReturned:  {},
		model.RequestStatusCancelled: {},
	},
	model.RequestStatusApproved: {
		model.RequestStatusRouted:    {},
		model.RequestStatusReturned:  {},
		model.RequestStatusCancelled: {},
	},
	model.RequestStatusRouted: {
		model.RequestStatusInExecution: {},
		model.RequestStatusReturned:    {},
		model.RequestStatusCancelled:   {},
	},
	model.RequestStatusInExecution: {
		model.RequestStatusDelivered: {},
		model.RequestStatusReturned:  {},
		model.RequestStatusCancelled: {},
	},
	model.RequestStatusDelivered: {
		model.RequestStatusClosed:   {},
		model.RequestStatusReturned: {},
	},
	model.RequestStatusReturned: {
		model.RequestStatusSubmitted: {},
		model.RequestStatusCancelled: {},
	},
}

// LegalRequestService owns the canonical request spine (CAP-009): CRUD, the
// draft→submitted→approval-routing FSM, and audited priority reclassification
// (CAP-010/CAP-011). It is deliberately decoupled from the service-catalog and
// org-entity modules — service_id/beneficiary_entity_id are opaque uuids.
type LegalRequestService struct {
	db                  *pgxpool.Pool
	requests            *repository.LegalRequestRepository
	publisher           Publisher
	metrics             *metrics.Metrics
	topic               string
	logger              zerolog.Logger
	now                 func() time.Time
	execution           *ExecutionRuleService
	attachments         *LegalRequestAttachmentService
	caseSpawner         CaseSpawner
	consultationSpawner ConsultationSpawner
	contractSpawner     ContractSpawner
	approvalStarter     approvalStarter
	slaStopper          slaClockStopper
	auditEmitter        materialAuditEmitter
	users               WorkforceUserDirectory
}

// slaClockStopper halts the running SLA cycle when a request is returned to the
// requester (client feedback, Requests Page: "The SLA stops if the request is
// returned to the requestor"). Satisfied as-is by *SLAService.StopClockForRequest.
// Same-package seam wired in app.go after both services exist, mirroring
// approvalStarter.
//
// Nil-tolerant: when unset a return leaves the clock running, i.e. the
// pre-000110 behaviour, so a partially-wired deployment degrades to the old
// semantics rather than failing the transition.
type slaClockStopper interface {
	StopClockForRequest(ctx context.Context, tenantID, userID, legalRequestID uuid.UUID, stoppedAt time.Time) (*model.SLAClock, error)
}

// SetSLAStopper wires the return→SLA-stop bridge.
func (s *LegalRequestService) SetSLAStopper(stopper slaClockStopper) {
	s.slaStopper = stopper
}

// materialAuditEmitter is the narrow seam the spine + SLA services use to route a
// material governance event to the immutable audit_db ledger (WS4). It is
// satisfied as-is by *LexAuditEmitter (same package). Nil-tolerant: when unset the
// in-tx append-only *_audit_log row is still written; only the ledger relay is
// skipped.
type materialAuditEmitter interface {
	Emit(ctx context.Context, record LexAuditRecord)
}

// SetAuditEmitter wires the LexAuditEmitter so material spine status transitions
// are relayed to the immutable audit_db ledger in addition to the in-tx
// append-only legal_request_audit_log row. Nil-tolerant (ledger relay skipped).
func (s *LegalRequestService) SetAuditEmitter(emitter materialAuditEmitter) {
	s.auditEmitter = emitter
}

// SetUserDirectory wires the workforce directory used to resolve audit actor
// UUIDs to display names in the request activity feed. Nil-safe: unset leaves
// audit actors as UUIDs (the FE falls back), matching embedded deployments.
func (s *LegalRequestService) SetUserDirectory(users WorkforceUserDirectory) {
	s.users = users
}

// emitSpineAudit relays a spine status transition to the immutable ledger. The
// append-only legal_request_audit_log row is the source of truth; this is a
// best-effort relay (never blocks/fails the mutation, mirroring writeEvent).
func (s *LegalRequestService) emitSpineAudit(ctx context.Context, tenantID uuid.UUID, actor *uuid.UUID, requestID uuid.UUID, action, from, to, reason string) {
	if s.auditEmitter == nil {
		return
	}
	detail := map[string]any{}
	if from != "" {
		detail["from_status"] = from
	}
	if to != "" {
		detail["to_status"] = to
	}
	if reason != "" {
		detail["reason"] = reason
	}
	s.auditEmitter.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		ActorUserID:  actor,
		Action:       action,
		ResourceType: "legal_request",
		ResourceID:   requestID.String(),
		Severity:     "info",
		Detail:       detail,
	})
}

// auditReason returns a pointer to reason, or nil when empty, for the nullable
// reason column on the append-only audit row.
func auditReason(reason string) *string {
	if reason == "" {
		return nil
	}
	r := reason
	return &r
}

// newSpineAuditEntry builds an append-only spine audit row for a status
// transition. from/to are stringified statuses (empty -> null column).
func newSpineAuditEntry(tenantID, requestID uuid.UUID, actor *uuid.UUID, action, from, to, reason string, detail map[string]any) *model.LegalRequestAuditEntry {
	entry := &model.LegalRequestAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		RequestID:   requestID,
		Action:      action,
		Reason:      auditReason(reason),
		Detail:      detail,
		ActorUserID: actor,
	}
	if from != "" {
		f := from
		entry.FromStatus = &f
	}
	if to != "" {
		t := to
		entry.ToStatus = &t
	}
	return entry
}

// CaseSpawner is the minimal seam the spine uses to materialise a litigation case
// when a litigation/case-type request reaches `routed`. It is satisfied as-is by
// *LegalCaseService (same package, so no import cycle); only Create is needed.
// Wired post-construction via SetCaseSpawner because LegalCaseService is built
// after the spine in app.go.
type CaseSpawner interface {
	Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateLegalCaseRequest) (*model.LegalCase, error)
}

// ConsultationSpawner is the minimal seam the spine uses to materialise a legal
// consultation when an opinion-type request reaches `routed`. Satisfied as-is by
// *ConsultationService (same package); only Submit (its create verb) is needed.
type ConsultationSpawner interface {
	Submit(ctx context.Context, tenantID, userID uuid.UUID, req dto.SubmitConsultationRequest) (*model.Consultation, error)
}

// ContractSpawner is the minimal seam the spine uses to materialise a contract
// draft when a contract review/drafting request reaches `routed`.
type ContractSpawner interface {
	CreateContract(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateContractRequest) (*model.Contract, error)
}

// SetCaseSpawner wires the litigation-case factory used by Route's auto-spawn.
// Nil-tolerant: a litigation/case-type request then routes WITHOUT spawning (the
// edge still advances) and logs that the spawner is absent.
func (s *LegalRequestService) SetCaseSpawner(spawner CaseSpawner) {
	s.caseSpawner = spawner
}

// SetConsultationSpawner wires the consultation factory used by Route's
// auto-spawn for opinion-type requests. Nil-tolerant in the same way.
func (s *LegalRequestService) SetConsultationSpawner(spawner ConsultationSpawner) {
	s.consultationSpawner = spawner
}

// SetContractSpawner wires the contract factory used by Route's auto-spawn.
// Nil-tolerant in the same way as the case and consultation spawners.
func (s *LegalRequestService) SetContractSpawner(spawner ContractSpawner) {
	s.contractSpawner = spawner
}

// approvalStarter opens the approval pipeline for a submitted request, attaching a
// workflow instance + approver task(s) and moving it to its first pending-approval
// stage. Satisfied by *RequestApprovalService.StartApproval. Same-package seam
// wired in app.go after both services exist (avoids a constructor ordering cycle).
// Nil-tolerant: submit then leaves an approval-required request parked at
// `submitted`, and the manual POST /requests/{id}/approval/start endpoint remains
// the entrypoint (pre-fix behavior).
type approvalStarter interface {
	StartApproval(ctx context.Context, tenantID, userID, requestID uuid.UUID) (*model.LegalRequest, error)
}

// SetApprovalStarter wires the submit→approval bridge so a submitted request that
// requires approval immediately enters its first pending-approval stage under the
// submitter's own permission, instead of dead-ending at `submitted` until a
// separate, more-privileged start call. Nil-tolerant (see approvalStarter).
func (s *LegalRequestService) SetApprovalStarter(starter approvalStarter) {
	if starter != nil {
		s.approvalStarter = starter
	}
}

// SetExecutionRuleService wires the execution engine so Revise can run the
// CAP-024 substantial-edit re-evaluation. Same-package seam; constructed in
// app.go after both services exist (avoids a constructor ordering cycle). Nil is
// tolerated: Revise then performs the edit without re-evaluation.
func (s *LegalRequestService) SetExecutionRuleService(execution *ExecutionRuleService) {
	s.execution = execution
}

// SetAttachmentService wires the request/file relationship owner. Request
// creation then persists the spine row and every verified attachment in one DB
// transaction; no request can be created with only opaque metadata references.
func (s *LegalRequestService) SetAttachmentService(attachments *LegalRequestAttachmentService) {
	s.attachments = attachments
}

// requestRevisable reports whether a request is in an execution phase
// (post-approval, pre-delivery) where a substantial edit must trigger CAP-024
// re-evaluation rather than the draft/returned free-edit path of Update.
func requestRevisable(status model.RequestStatus) bool {
	switch status {
	case model.RequestStatusApproved, model.RequestStatusRouted, model.RequestStatusInExecution:
		return true
	default:
		return false
	}
}

// Revise applies a substantive edit to a request that has already entered
// execution and runs the CAP-024 re-evaluation: a material change (service,
// priority tier, request type, or scope) re-opens the completeness gate via the
// execution engine so the provider must re-confirm before the SLA clock
// restarts. Non-substantial edits persist with no execution side-effect. Draft /
// returned requests use Update (free edit, no execution state yet).
func (s *LegalRequestService) Revise(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateLegalRequestRequest) (*model.LegalRequest, *ChangeDecision, error) {
	req.Normalize()
	before, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, notFoundError("legal request not found")
		}
		return nil, nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, before); err != nil {
		return nil, nil, err
	}
	if !requestRevisable(before.Status) {
		return nil, nil, conflictError("only approved, routed, or in-execution requests can be revised; use update for draft/returned")
	}

	// Capture the pre-edit requirement set (unchanged by a spine-field edit) for
	// the detector, then mutate an independent copy so `before` stays pristine.
	var beforeReqs []model.RequirementItem
	if s.execution != nil {
		if reqs, rErr := s.execution.RequirementsFor(ctx, tenantID, id); rErr == nil {
			beforeReqs = reqs
		}
	}
	working, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		return nil, nil, internalError("load legal request", err)
	}
	applyLegalRequestUpdate(working, req)
	if err := validateLegalRequest(working); err != nil {
		return nil, nil, err
	}
	if err := s.requests.Update(ctx, s.db, working); err != nil {
		return nil, nil, internalError("update legal request", err)
	}

	var decision *ChangeDecision
	if s.execution != nil {
		decision, err = s.execution.EvaluateSubstantialEdit(ctx, tenantID, userID, id, before, working, beforeReqs)
		if err != nil {
			return nil, nil, err
		}
	}
	substantial := decision != nil && decision.Substantial
	revisedPayload := legalRequestEventPayload(working)
	revisedPayload["substantial"] = substantial
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.revised", tenantID, &userID, revisedPayload, s.logger)

	updated, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, nil, err
	}
	return updated, decision, nil
}

func NewLegalRequestService(db *pgxpool.Pool, requests *repository.LegalRequestRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *LegalRequestService {
	return &LegalRequestService{
		db:        db,
		requests:  requests,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-legal-requests").Logger(),
		now:       time.Now,
	}
}

func (s *LegalRequestService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateLegalRequestRequest) (*model.LegalRequest, error) {
	req.Normalize()
	if err := validateLegalRequestCreate(req); err != nil {
		return nil, err
	}
	// CAP-010: an urgent intake must carry a structured, non-delay justification.
	if err := validateUrgencyJustification(req.Priority, req.UrgencyJustification, "urgency_justification"); err != nil {
		return nil, err
	}

	requesterUserID := userID
	if req.RequesterUserID != nil && *req.RequesterUserID != uuid.Nil {
		requesterUserID = *req.RequesterUserID
	}

	requestNumber := normalizeOptionalString(req.RequestNumber)
	if requestNumber == nil {
		generated := fmt.Sprintf("REQ-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		requestNumber = &generated
	}

	request := &model.LegalRequest{
		ID:                    uuid.New(),
		TenantID:              tenantID,
		RequestNumber:         *requestNumber,
		RequestType:           req.RequestType,
		ServiceID:             req.ServiceID,
		Title:                 req.Title,
		Description:           req.Description,
		RequesterUserID:       requesterUserID,
		RequesterName:         req.RequesterName,
		BeneficiaryEntityID:   req.BeneficiaryEntityID,
		Department:            req.Department,
		Priority:              req.Priority,
		Status:                model.RequestStatusDraft,
		UrgencyJustification:  req.UrgencyJustification,
		RequesterApprovalReqd: req.RequesterApprovalReqd,
		ProviderApprovalReqd:  req.ProviderApprovalReqd,
		SubjectType:           req.SubjectType,
		SubjectID:             req.SubjectID,
		Metadata:              req.Metadata,
		CreatedBy:             userID,
	}

	var preparedAttachments []*model.LegalRequestAttachment
	if len(req.Attachments) > 0 {
		if s.attachments == nil {
			return nil, internalError("create legal request attachments", errors.New("attachment service is not configured"))
		}
		var err error
		preparedAttachments, err = s.attachments.Prepare(ctx, tenantID, userID, request.ID, req.Attachments)
		if err != nil {
			return nil, err
		}
	}
	if s.attachments != nil {
		if err := s.attachments.ValidatePolicy(ctx, tenantID, req.RequestType, req.ServiceID, preparedAttachments); err != nil {
			return nil, err
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start legal request create transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.requests.Create(ctx, tx, request); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("request_number already exists")
		}
		return nil, internalError("create legal request", err)
	}
	if len(preparedAttachments) > 0 {
		if err := s.attachments.Persist(ctx, tx, preparedAttachments); err != nil {
			if isUniqueViolation(err) {
				return nil, conflictError("duplicate legal request attachment or slot")
			}
			return nil, internalError("persist legal request attachments", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit legal request create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.created", tenantID, &userID, legalRequestEventPayload(request), s.logger)
	return request, nil
}

func (s *LegalRequestService) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalRequestListFilters) ([]model.LegalRequest, int, error) {
	return s.requests.List(ctx, tenantID, filters)
}

// ListForActor applies the mandatory self-service visibility boundary for the
// base requester persona. The actor predicate is independent of any public
// requester filter, so removing or tampering with the frontend's "My requests"
// filter can never widen the result set. A request belongs to the actor when
// they raised it (created_by) or are its named requester (requester_user_id).
// Legal operational, audit, and admin personas keep tenant-level visibility.
func (s *LegalRequestService) ListForActor(ctx context.Context, tenantID, userID uuid.UUID, roles []string, filters model.LegalRequestListFilters) ([]model.LegalRequest, int, error) {
	if baseRequesterOwnScope(ctx, roles) {
		filters.VisibilityActorID = &userID
	}
	return s.requests.List(ctx, tenantID, filters)
}

// GetForActor mirrors ListForActor for direct links. A base requester probing a
// different request receives 404 so the endpoint does not disclose whether the
// tenant-scoped identifier exists.
func (s *LegalRequestService) GetForActor(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if baseRequesterOwnScope(ctx, roles) && request.CreatedBy != userID && request.RequesterUserID != userID {
		return nil, notFoundError("legal request not found")
	}
	return request, nil
}

// baseRequesterOwnScope is deliberately role-based rather than query-based.
// Combining legal-requester with any other named legal persona or an admin/write
// role preserves the broader persona's visibility; unknown auxiliary roles do
// not silently widen a requester's access.
func baseRequesterOwnScope(ctx context.Context, roles []string) bool {
	hasBaseRequester := false
	for _, role := range roles {
		if def := auth.LegalRoleDefBySlug(role); def != nil {
			if def.Slug == "legal-requester" {
				hasBaseRequester = true
				continue
			}
			return false
		}
		if auth.HasAnyPermissionCtx(ctx, []string{role}, auth.PermAdminAll, auth.PermLexWrite) {
			return false
		}
	}
	return hasBaseRequester
}

// enforceBaseRequesterOwnRequest is the shared object-level authorization
// boundary for request sub-resources and mutations. HTTP permission middleware
// answers whether an actor may use a verb in general; this check answers whether
// the base requester may use it on this particular row. Internal service calls
// without an authenticated actor and broader legal personas are intentionally
// unaffected.
func enforceBaseRequesterOwnRequest(ctx context.Context, request *model.LegalRequest) error {
	actor := auth.UserFromContext(ctx)
	if actor == nil || !baseRequesterOwnScope(ctx, actor.Roles) {
		return nil
	}
	actorID, err := uuid.Parse(strings.TrimSpace(actor.ID))
	if err != nil || actorID == uuid.Nil || request == nil || (request.CreatedBy != actorID && request.RequesterUserID != actorID) {
		// Keep cross-owner UUIDs opaque to self-service requesters.
		return notFoundError("legal request not found")
	}
	return nil
}

// ListForApprovalActor scopes the request list to open approval work the actor
// can actually decide. The command endpoint repeats these checks under lock.
func (s *LegalRequestService) ListForApprovalActor(ctx context.Context, tenantID, userID uuid.UUID, roles []string, filters model.LegalRequestListFilters) ([]model.LegalRequest, int, error) {
	if !auth.HasPermissionCtx(ctx, roles, auth.PermLexRequestApprove) {
		return []model.LegalRequest{}, 0, nil
	}
	filters.ApprovalActorID = &userID
	filters.ApprovalActorRoles = normalizeApprovalActorRoles(roles)
	filters.ApprovalActorRoleBypass = auth.HasPermissionCtx(ctx, roles, auth.PermAdminAll)
	return s.requests.List(ctx, tenantID, filters)
}

func normalizeApprovalActorRoles(roles []string) []string {
	normalized := make([]string, 0, len(roles))
	seen := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		value := normalizeWorkflowRole(role)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func (s *LegalRequestService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	return request, nil
}

// GetFeedback returns the append-only requester satisfaction response. A valid
// request with no response is represented as (nil, nil), which lets the API
// distinguish "not submitted" from "request not found" without inventing a
// zero rating.
func (s *LegalRequestService) GetFeedback(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalRequestFeedback, error) {
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	feedback, err := s.requests.GetFeedback(ctx, tenantID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, internalError("load request feedback", err)
	}
	return feedback, nil
}

// SubmitFeedback records the requester's one-time satisfaction response after
// delivery or closure. Permission middleware establishes request-view access;
// this service-level ownership check is the authoritative row-level write rule.
func (s *LegalRequestService) SubmitFeedback(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SubmitLegalRequestFeedbackRequest) (*model.LegalRequestFeedback, error) {
	req.Normalize()
	if req.Rating < 1 || req.Rating > 5 {
		return nil, validationError("rating must be between 1 and 5", map[string]string{"rating": "must be between 1 and 5"})
	}
	if len([]rune(req.Comment)) > 2000 {
		return nil, validationError("comment is too long", map[string]string{"comment": "maximum 2000 characters"})
	}
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	if request.RequesterUserID != userID {
		return nil, forbiddenError("only the request owner can submit satisfaction feedback")
	}
	if request.Status != model.RequestStatusDelivered && request.Status != model.RequestStatusClosed {
		return nil, conflictError("feedback is available only after request delivery or closure")
	}
	feedback := &model.LegalRequestFeedback{
		ID:          uuid.New(),
		TenantID:    tenantID,
		RequestID:   id,
		Rating:      req.Rating,
		Comment:     req.Comment,
		SubmittedBy: userID,
	}
	if err := s.requests.CreateFeedback(ctx, feedback); err != nil {
		if errors.Is(err, repository.ErrRequestFeedbackExists) {
			return nil, conflictError("feedback has already been submitted for this request")
		}
		return nil, internalError("submit request feedback", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.feedback_submitted", tenantID, &userID, map[string]any{
		"legal_request_id": id,
		"feedback_id":      feedback.ID,
		"rating":           feedback.Rating,
		"submitted_at":     feedback.SubmittedAt,
	}, s.logger)
	return feedback, nil
}

func (s *LegalRequestService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateLegalRequestRequest) (*model.LegalRequest, error) {
	req.Normalize()
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	// Only a draft or returned request is editable; once it enters approval the
	// spine is locked except for FSM transitions and audited reclassification.
	if request.Status != model.RequestStatusDraft && request.Status != model.RequestStatusReturned {
		return nil, conflictError("only draft or returned requests can be edited")
	}
	applyLegalRequestUpdate(request, req)
	if err := validateLegalRequest(request); err != nil {
		return nil, err
	}
	if err := s.requests.Update(ctx, s.db, request); err != nil {
		return nil, internalError("update legal request", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.updated", tenantID, &userID, legalRequestEventPayload(request), s.logger)
	return s.Get(ctx, tenantID, id)
}

// Submit advances a draft/returned request to the submitted checkpoint. Requests
// that require approval stop at submitted so RequestApprovalService can attach
// the workflow and move them into the first pending stage. Requests that require
// no approval go straight to approved.
func (s *LegalRequestService) Submit(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SubmitLegalRequestRequest) (*model.LegalRequest, error) {
	req.Normalize()
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	if request.Status != model.RequestStatusDraft && request.Status != model.RequestStatusReturned {
		return nil, conflictError("only draft or returned requests can be submitted")
	}
	if request.Title.IsEmpty() {
		return nil, validationError("title is required before submission", map[string]string{"title": "required"})
	}

	target := requestSubmitTarget(request)
	fromStatus := request.Status

	// Flip the status AND append the append-only audit row in one transaction so
	// the transition and its immutable trail commit (or roll back) atomically.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start submit transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.requests.UpdateStatus(ctx, tx, tenantID, id, target, nil); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("submit legal request", err)
	}
	auditDetail := map[string]any{"request_number": request.RequestNumber}
	if notes := strings.TrimSpace(req.Notes); notes != "" {
		auditDetail["notes"] = notes
	}
	if err := s.requests.AppendAudit(ctx, tx, newSpineAuditEntry(tenantID, id, actorPtr(userID), "submitted", string(fromStatus), string(target), strings.TrimSpace(req.Notes), auditDetail)); err != nil {
		return nil, internalError("record legal request submit audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit legal request submit", err)
	}

	submittedPayload := legalRequestEventPayload(request)
	submittedPayload["previous_status"] = fromStatus
	submittedPayload["status"] = target
	submittedPayload["notes"] = req.Notes
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.submitted", tenantID, &userID, submittedPayload, s.logger)
	s.emitSpineAudit(ctx, tenantID, actorPtr(userID), id, "submitted", string(fromStatus), string(target), strings.TrimSpace(req.Notes))

	// A request that requires approval must not dead-end at `submitted`: open the
	// approval pipeline right here so it advances to its first pending-approval
	// stage with a workflow + approver task(s) attached, driven by the submitter's
	// own lex:request:add permission (no separate, more-privileged POST
	// /approval/start needed). Mirrors the no-approval auto-route below and is
	// best-effort: a failure leaves the request at `submitted`, where POST
	// /requests/{id}/approval/start remains the manual recovery entrypoint, so an
	// approval hiccup never fails an otherwise-valid submit.
	if target == model.RequestStatusSubmitted && s.approvalStarter != nil {
		if started, serr := s.approvalStarter.StartApproval(ctx, tenantID, userID, id); serr != nil {
			s.logger.Error().Err(serr).Str("request_id", id.String()).Msg("auto-start approval after submit failed; request remains submitted")
		} else if started != nil {
			return started, nil
		}
	}

	// A service that requires no approvals submits straight to approved; advance it
	// to routed and auto-spawn the downstream subject immediately. Route is
	// idempotent; failure is non-fatal (the request stays approved and POST /route
	// can complete it), so a routing hiccup never fails an otherwise-valid submit.
	if target == model.RequestStatusApproved {
		if routed, rerr := s.Route(ctx, tenantID, userID, id); rerr != nil {
			s.logger.Error().Err(rerr).Str("request_id", id.String()).Msg("auto-route after no-approval submit failed; request remains approved")
		} else {
			return routed, nil
		}
	}
	return s.Get(ctx, tenantID, id)
}

// Transition performs an arbitrary, guarded FSM edge. Downstream domain services
// (case/consultation/...) call this to move the spine as their own lifecycle
// advances; the allowed edge set is enforced here.
func (s *LegalRequestService) Transition(ctx context.Context, tenantID, userID, id uuid.UUID, target model.RequestStatus) (*model.LegalRequest, error) {
	if !target.Valid() {
		return nil, validationError("invalid status", map[string]string{"status": "invalid"})
	}
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if !requestTransitionAllowed(request.Status, target) {
		return nil, conflictError(fmt.Sprintf("illegal transition %s -> %s", request.Status, target))
	}
	fromStatus := request.Status

	// Optimistic-concurrency guard: the row must still be at the status we loaded
	// (status=expectedFrom). A concurrent writer that moved it surfaces as a 409
	// conflict, never a silent no-op. The guarded flip AND the append-only audit row
	// commit atomically in one transaction.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start transition transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.requests.UpdateStatusGuarded(ctx, tx, tenantID, id, fromStatus, target, nil, nil); err != nil {
		switch {
		case err == pgx.ErrNoRows:
			return nil, notFoundError("legal request not found")
		case errors.Is(err, repository.ErrStatusConflict):
			return nil, conflictError(fmt.Sprintf("legal request was concurrently modified; expected status %s", fromStatus))
		default:
			return nil, internalError("transition legal request", err)
		}
	}
	// Resubmission opens a new review round. The counter advances INSIDE the
	// guarded transaction so it can never diverge from the status: notes and
	// attachments stamp themselves from it, and a half-applied increment would
	// misattribute the whole next round.
	if fromStatus == model.RequestStatusReturned && target == model.RequestStatusSubmitted {
		if _, err := tx.Exec(ctx,
			`UPDATE legal_requests SET cycle = cycle + 1, updated_at = now()
			 WHERE tenant_id = $1 AND id = $2`, tenantID, id); err != nil {
			return nil, internalError("advance legal request review round", err)
		}
	}
	if err := s.requests.AppendAudit(ctx, tx, newSpineAuditEntry(tenantID, id, actorPtr(userID), "status_changed", string(fromStatus), string(target), "", map[string]any{"request_number": request.RequestNumber})); err != nil {
		return nil, internalError("record legal request transition audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit legal request transition", err)
	}

	statusPayload := legalRequestEventPayload(request)
	statusPayload["previous_status"] = fromStatus
	statusPayload["status"] = target
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.status_changed", tenantID, &userID, statusPayload, s.logger)
	s.emitSpineAudit(ctx, tenantID, actorPtr(userID), id, "status_changed", string(fromStatus), string(target), "")

	// Returning the request hands the ball back to the requester, so the running
	// SLA cycle stops here. The resubmission (returned→submitted) does NOT restart
	// it from this hook: the clock is re-materialised by the normal
	// completeness-confirmation path, which opens the next cycle because no live
	// clock remains. That keeps a single owner for clock creation.
	if target == model.RequestStatusReturned {
		s.stopSLAOnReturn(ctx, tenantID, userID, id)
	}
	return s.Get(ctx, tenantID, id)
}

// stopSLAOnReturn is best-effort and deliberately outside the transition
// transaction: the status flip is the authoritative act, and a transient SLA
// failure must not roll it back or surface as a transition error. A missed stop
// is self-correcting — the clock is stopped on the next return, and the monitor
// only ever escalates a cycle that is genuinely still live.
func (s *LegalRequestService) stopSLAOnReturn(ctx context.Context, tenantID, userID, requestID uuid.UUID) {
	if s.slaStopper == nil {
		return
	}
	if _, err := s.slaStopper.StopClockForRequest(ctx, tenantID, userID, requestID, s.now().UTC()); err != nil {
		s.logger.Warn().Err(err).
			Str("legal_request_id", requestID.String()).
			Msg("failed to stop sla clock on request return")
	}
}

// Route activates the (previously dead) approved→routed spine edge and performs
// the auto-spawn: when the request's type/service maps to a litigation/case flow
// it materialises a LegalCase; when it maps to an opinion flow it materialises a
// Consultation; non-matching types just route. The spawn is idempotent (a request
// already linked to a subject, or one that already has a spawned row by
// request_id, reuses it and does not create a duplicate) and the status flip is
// optimistic-concurrency guarded (approved→routed under lock_version) so a
// concurrent transition returns 409 rather than silently no-op'ing.
//
// Ordering note: the domain row is created first (through the subject service's
// own create verb, which emits case.created/consultation.created), then the spine
// is flipped to `routed` AND back-linked (subject_type/subject_id) atomically in a
// single guarded transaction. The idempotency probe makes a retry after a partial
// failure reuse the orphaned subject instead of spawning a second one.
func (s *LegalRequestService) Route(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if request.Status == model.RequestStatusRouted {
		// Already routed: idempotent no-op (return current row). Guards a duplicate
		// delivery of the same route command.
		s.ensureExecutionStateForRoute(ctx, tenantID, userID, id)
		return s.Get(ctx, tenantID, id)
	}
	if request.Status != model.RequestStatusApproved {
		return nil, conflictError(fmt.Sprintf("only approved requests can be routed; current status %s", request.Status))
	}

	subjectType, subjectID, spawnEvent, err := s.spawnSubjectForRoute(ctx, tenantID, userID, request)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start route transaction", err)
	}
	defer tx.Rollback(ctx)

	if err := s.requests.UpdateStatusGuarded(ctx, tx, tenantID, id, model.RequestStatusApproved, model.RequestStatusRouted, nil, nil); err != nil {
		switch {
		case err == pgx.ErrNoRows:
			return nil, notFoundError("legal request not found")
		case errors.Is(err, repository.ErrStatusConflict):
			return nil, conflictError("legal request was concurrently modified; expected status approved")
		default:
			return nil, internalError("route legal request", err)
		}
	}
	if subjectType != "" && subjectID != uuid.Nil {
		if err := s.requests.LinkSubject(ctx, tx, tenantID, id, subjectType, subjectID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("legal request not found")
			}
			return nil, internalError("link routed subject", err)
		}
	}
	routeAuditDetail := map[string]any{"request_number": request.RequestNumber, "request_type": request.RequestType}
	if subjectType != "" && subjectID != uuid.Nil {
		routeAuditDetail["subject_type"] = subjectType
		routeAuditDetail["subject_id"] = subjectID.String()
	}
	if err := s.requests.AppendAudit(ctx, tx, newSpineAuditEntry(tenantID, id, actorPtr(userID), "routed", string(model.RequestStatusApproved), string(model.RequestStatusRouted), "", routeAuditDetail)); err != nil {
		return nil, internalError("record legal request route audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit route", err)
	}

	routedPayload := legalRequestEventPayload(request)
	routedPayload["previous_status"] = request.Status
	routedPayload["status"] = model.RequestStatusRouted
	if subjectType != "" && subjectID != uuid.Nil {
		routedPayload["subject_type"] = subjectType
		routedPayload["subject_id"] = subjectID
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.routed", tenantID, &userID, routedPayload, s.logger)
	s.emitSpineAudit(ctx, tenantID, actorPtr(userID), id, "routed", string(model.RequestStatusApproved), string(model.RequestStatusRouted), "")
	// The subject service emits its own case.created/consultation.created; we relay
	// a spine-side correlation event so consumers can join the spawn to the request.
	if spawnEvent != "" {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, spawnEvent, tenantID, &userID, map[string]any{
			"request_id":   request.ID,
			"subject_type": subjectType,
			"subject_id":   subjectID,
			"request_type": request.RequestType,
		}, s.logger)
	}
	s.ensureExecutionStateForRoute(ctx, tenantID, userID, id)
	return s.Get(ctx, tenantID, id)
}

func (s *LegalRequestService) ensureExecutionStateForRoute(ctx context.Context, tenantID, userID, id uuid.UUID) {
	if s.execution == nil {
		return
	}
	if _, err := s.execution.EnsureState(ctx, tenantID, userID, id); err != nil {
		s.logger.Warn().Err(err).Str("request_id", id.String()).Msg("open execution state after route skipped")
	}
}

// routeSubjectKind classifies a request's type/service_code into the domain row
// the router should spawn on `routed`. Matching is case-insensitive on the
// request_type token (the canonical routing key; service_code, when modeled,
// would refine this). "" means "route without spawning".
type routeSubjectKind string

const (
	routeSubjectNone         routeSubjectKind = ""
	routeSubjectCase         routeSubjectKind = "legal_case"
	routeSubjectConsultation routeSubjectKind = "consultation"
	routeSubjectContract     routeSubjectKind = "contract"
)

// caseRouteTokens are the request_type substrings that route to a litigation case.
var caseRouteTokens = []string{"litigation", "case", "lawsuit", "dispute", "قضية", "تقاضي", "نزاع"}

// consultationRouteTokens are the request_type substrings that route to a legal
// opinion / consultation.
var consultationRouteTokens = []string{"opinion", "consultation", "advice", "advisory", "fatwa", "memo", "استشارة", "رأي", "فتوى"}

// contractRouteTokens cover the canonical service-desk types
// contract_review/contract_drafting plus common agreement labels.
var contractRouteTokens = []string{"contract", "agreement", "nda", "عقد", "اتفاقية"}

func classifyRouteSubject(requestType string) routeSubjectKind {
	t := strings.ToLower(strings.TrimSpace(requestType))
	if t == "" {
		return routeSubjectNone
	}
	for _, token := range caseRouteTokens {
		if strings.Contains(t, token) {
			return routeSubjectCase
		}
	}
	for _, token := range consultationRouteTokens {
		if strings.Contains(t, token) {
			return routeSubjectConsultation
		}
	}
	for _, token := range contractRouteTokens {
		if strings.Contains(t, token) {
			return routeSubjectContract
		}
	}
	return routeSubjectNone
}

// spawnSubjectForRoute resolves (idempotently) the domain row to back-link on
// route. It returns the subject_type, subject_id, and the spine correlation event
// to emit (empty when nothing is spawned). Idempotency: an already-linked subject
// on the request, or an existing row found by request_id, is reused; otherwise the
// subject service's create verb is invoked (which runs its own transaction and
// emits case.created/consultation.created). A nil spawner degrades to a plain
// route.
func (s *LegalRequestService) spawnSubjectForRoute(ctx context.Context, tenantID, userID uuid.UUID, request *model.LegalRequest) (string, uuid.UUID, string, error) {
	kind := classifyRouteSubject(request.RequestType)
	if kind == routeSubjectNone {
		return "", uuid.Nil, "", nil
	}

	// Already linked on a prior route attempt: reuse, never double-spawn.
	if request.SubjectType != nil && *request.SubjectType != "" && request.SubjectID != nil && *request.SubjectID != uuid.Nil {
		return *request.SubjectType, *request.SubjectID, "", nil
	}

	switch kind {
	case routeSubjectCase:
		if existing, err := s.requests.FindCaseByRequest(ctx, s.db, tenantID, request.ID); err == nil {
			return string(routeSubjectCase), existing, "", nil
		} else if err != pgx.ErrNoRows {
			return "", uuid.Nil, "", internalError("probe existing case for request", err)
		}
		if s.caseSpawner == nil {
			s.logger.Warn().Str("request_id", request.ID.String()).Msg("case spawner not wired; routing without spawning a case")
			return "", uuid.Nil, "", nil
		}
		created, err := s.caseSpawner.Create(ctx, tenantID, userID, s.caseSpawnRequest(request))
		if err != nil {
			return "", uuid.Nil, "", err
		}
		return string(routeSubjectCase), created.ID, "com.clario360.lex.case.spawned", nil
	case routeSubjectConsultation:
		if existing, err := s.requests.FindConsultationByRequest(ctx, s.db, tenantID, request.ID); err == nil {
			return string(routeSubjectConsultation), existing, "", nil
		} else if err != pgx.ErrNoRows {
			return "", uuid.Nil, "", internalError("probe existing consultation for request", err)
		}
		if s.consultationSpawner == nil {
			s.logger.Warn().Str("request_id", request.ID.String()).Msg("consultation spawner not wired; routing without spawning a consultation")
			return "", uuid.Nil, "", nil
		}
		created, err := s.consultationSpawner.Submit(ctx, tenantID, userID, s.consultationSpawnRequest(request))
		if err != nil {
			return "", uuid.Nil, "", err
		}
		return string(routeSubjectConsultation), created.ID, "com.clario360.lex.consultation.spawned", nil
	case routeSubjectContract:
		if existing, err := s.requests.FindContractByRequest(ctx, s.db, tenantID, request.ID); err == nil {
			return string(routeSubjectContract), existing, "", nil
		} else if err != pgx.ErrNoRows {
			return "", uuid.Nil, "", internalError("probe existing contract for request", err)
		}
		if s.contractSpawner == nil {
			s.logger.Warn().Str("request_id", request.ID.String()).Msg("contract spawner not wired; routing without spawning a contract")
			return "", uuid.Nil, "", nil
		}
		created, err := s.contractSpawner.CreateContract(ctx, tenantID, userID, s.contractSpawnRequest(request))
		if err != nil {
			return "", uuid.Nil, "", err
		}
		return string(routeSubjectContract), created.ID, "com.clario360.lex.contract.spawned", nil
	default:
		return "", uuid.Nil, "", nil
	}
}

// caseSpawnRequest builds the litigation-case create payload from the routed
// request, back-linking via request_id. The company is modeled as plaintiff by
// default (the company filed the request); intake is the initial case status.
func (s *LegalRequestService) caseSpawnRequest(request *model.LegalRequest) dto.CreateLegalCaseRequest {
	requestID := request.ID
	metadata := map[string]any{"spawned_from_request": request.RequestNumber}
	if request.BeneficiaryEntityID != nil && *request.BeneficiaryEntityID != uuid.Nil {
		// LegalCase currently carries its owning organisational unit in metadata.
		// Preserve the request's typed beneficiary when spawning the downstream
		// case so assignment/SLA escalation can resolve against the same entity.
		metadata["beneficiary_entity_id"] = request.BeneficiaryEntityID.String()
	}
	return dto.CreateLegalCaseRequest{
		CaseType:      request.RequestType,
		CompanyStatus: model.CaseCompanyStatusPlaintiff,
		Title:         request.Title,
		Description:   request.Description,
		Status:        model.CaseStatusIntake,
		Priority:      legalPriorityFromRequest(request.Priority),
		Department:    request.Department,
		RequestID:     &requestID,
		Metadata:      metadata,
	}
}

// consultationSpawnRequest builds the consultation submit payload from the routed
// request, back-linking via legal_request_id.
func (s *LegalRequestService) consultationSpawnRequest(request *model.LegalRequest) dto.SubmitConsultationRequest {
	requestID := request.ID
	question := strings.TrimSpace(request.Description)
	if question == "" {
		question = request.Title.Localize("en")
	}
	if strings.TrimSpace(question) == "" {
		question = request.RequestNumber
	}
	return dto.SubmitConsultationRequest{
		Type:            model.ConsultationTypeGeneral,
		Title:           request.Title,
		Priority:        legalPriorityFromRequest(request.Priority),
		LegalRequestID:  &requestID,
		RequesterUserID: &request.RequesterUserID,
		RequesterName:   request.RequesterName,
		Department:      request.Department,
		Question:        question,
		Metadata:        map[string]any{"spawned_from_request": request.RequestNumber},
	}
}

// contractSpawnRequest creates the assignment-ready draft that appears in the
// request owner's control-panel backlog. Intake does not yet have structured
// counterparty fields, so safe placeholders remain visibly incomplete for the
// assigned reviewer to fill instead of inventing legal party data.
func (s *LegalRequestService) contractSpawnRequest(request *model.LegalRequest) dto.CreateContractRequest {
	title := strings.TrimSpace(request.Title.Localize("en"))
	if title == "" {
		title = request.RequestNumber
	}
	ownerName := strings.TrimSpace(request.RequesterName)
	if ownerName == "" {
		ownerName = "Request owner"
	}
	partyAName := ownerName
	if request.Department != nil && strings.TrimSpace(*request.Department) != "" {
		partyAName = strings.TrimSpace(*request.Department)
	}
	return dto.CreateContractRequest{
		Title:       title,
		Type:        contractTypeFromRequest(request.RequestType),
		Description: request.Description,
		PartyAName:  partyAName,
		PartyBName:  "To be confirmed",
		Currency:    "SAR",
		OwnerUserID: request.RequesterUserID,
		OwnerName:   ownerName,
		Department:  request.Department,
		Metadata: map[string]any{
			"spawned_from_request": request.RequestNumber,
			"legal_request_id":     request.ID.String(),
			"intake_request_type":  request.RequestType,
		},
	}
}

func contractTypeFromRequest(requestType string) model.ContractType {
	t := strings.ToLower(strings.TrimSpace(requestType))
	candidates := []struct {
		contractType model.ContractType
		tokens       []string
	}{
		{model.ContractTypeNDA, []string{"nda", "non-disclosure", "confidentiality"}},
		{model.ContractTypeEmployment, []string{"employment"}},
		{model.ContractTypeLicense, []string{"license", "licence"}},
		{model.ContractTypeLease, []string{"lease"}},
		{model.ContractTypeConsulting, []string{"consulting"}},
		{model.ContractTypeProcurement, []string{"procurement", "purchase"}},
		{model.ContractTypeSLA, []string{"service_level", "service level", "sla"}},
		{model.ContractTypeMOU, []string{"mou", "memorandum"}},
		{model.ContractTypeAmendment, []string{"amendment", "addendum"}},
		{model.ContractTypeRenewal, []string{"renewal"}},
		{model.ContractTypeVendor, []string{"vendor", "supplier"}},
	}
	for _, candidate := range candidates {
		for _, token := range candidate.tokens {
			if strings.Contains(t, token) {
				return candidate.contractType
			}
		}
	}
	return model.ContractTypeOther
}

// legalPriorityFromRequest maps the two-tier request priority onto the four-tier
// legal priority used by cases/consultations: urgent→high, normal→medium.
func legalPriorityFromRequest(p model.RequestPriority) model.LegalPriority {
	if p == model.RequestPriorityUrgent {
		return model.LegalPriorityHigh
	}
	return model.LegalPriorityMedium
}

// ReclassifyPriority performs the CAP-011 audited priority change. A move to
// urgent re-runs the CAP-010 justification rule; every change appends an
// immutable history row in the same transaction as the request-row update.
func (s *LegalRequestService) ReclassifyPriority(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.ReclassifyPriorityRequest) (*model.LegalRequest, error) {
	req.Normalize()
	if !req.Priority.Valid() {
		return nil, validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	if req.Reason == "" {
		return nil, validationError("reclassification reason is required", map[string]string{"reason": "required"})
	}
	// PRD 4.0/5.0: priority reclassification is a PROVIDER governance action, not a
	// requester self-service edit. Routing the endpoint on the generic
	// lex:request:edit verb let a base legal-requester — who legitimately holds
	// :edit to author/revise their OWN request — self-escalate that request to
	// Urgent and jump the SLA queue. Enforce the provider-side lex:request:approve
	// verb here (held by the legal reviewers/section managers and the DOA
	// approvers, and NOT by the base requester, who is edit-only), so a requester
	// can never reclassify their own priority. Fails CLOSED: an unresolved role set
	// is denied.
	if err := requireReclassifyAuthority(ctx); err != nil {
		return nil, err
	}
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	urgencyJustification, err := reclassifiedUrgencyJustification(request, req)
	if err != nil {
		return nil, err
	}

	change := newLegalRequestPriorityChange(tenantID, id, userID, request.Priority, req.Priority, req.Reason)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start reclassify transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.requests.UpdatePriority(ctx, tx, tenantID, id, req.Priority, urgencyJustification); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("update request priority", err)
	}
	if err := s.requests.InsertPriorityChange(ctx, tx, change); err != nil {
		return nil, internalError("record priority change", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit reclassify", err)
	}
	priorityPayload := legalRequestEventPayload(request)
	priorityPayload["from_priority"] = change.FromPriority
	priorityPayload["to_priority"] = change.ToPriority
	priorityPayload["priority"] = change.ToPriority
	priorityPayload["reason"] = change.Reason
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.request.priority_changed", tenantID, &userID, priorityPayload, s.logger)
	return s.Get(ctx, tenantID, id)
}

// requireReclassifyAuthority enforces the PRD 4.0/5.0 provider-only gate on
// priority reclassification. Reclassification is a provider-review capability;
// gating only on the generic lex:request:edit verb (which the base requester
// holds for their own request) allowed requester self-escalation. The caller
// must hold the provider-side lex:request:approve verb. Fails CLOSED — an
// unresolved/empty role set (no authenticated caller in context) is denied.
func requireReclassifyAuthority(ctx context.Context) error {
	var roles []string
	if user := auth.UserFromContext(ctx); user != nil {
		roles = user.Roles
	}
	if !auth.HasPermissionCtx(ctx, roles, auth.PermLexRequestApprove) {
		return forbiddenError("reclassifying request priority requires provider review authority (lex:request:approve); a requester cannot self-escalate their own request (PRD 4.0/5.0)")
	}
	return nil
}

// PriorityHistory returns the audited reclassification trail (CAP-011).
func (s *LegalRequestService) PriorityHistory(ctx context.Context, tenantID, id uuid.UUID) ([]model.LegalRequestPriorityChange, error) {
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	changes, err := s.requests.ListPriorityChanges(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load priority history", err)
	}
	return changes, nil
}

// RequestAudit returns the append-only spine governance trail for a request,
// newest-first, for the read-only activity timeline (feature #8).
func (s *LegalRequestService) RequestAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.LegalRequestAuditEntry, error) {
	request, err := s.requests.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request", err)
	}
	if err := enforceBaseRequesterOwnRequest(ctx, request); err != nil {
		return nil, err
	}
	entries, err := s.requests.ListAuditEntries(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load request audit", err)
	}
	s.enrichAuditActorNames(ctx, tenantID, entries)
	return entries, nil
}

// enrichAuditActorNames resolves each DISTINCT audit actor UUID to a display
// name via the workforce directory so the activity feed reads "by Ada Okafor"
// instead of a raw UUID. Best-effort + nil-tolerant: an unwired directory or a
// resolve error leaves ActorName nil and the FE falls back to the UUID. Actors
// absent from platform_core.users (e.g. system actors) also keep their UUID.
func (s *LegalRequestService) enrichAuditActorNames(ctx context.Context, tenantID uuid.UUID, entries []model.LegalRequestAuditEntry) {
	if s.users == nil || len(entries) == 0 {
		return
	}
	seen := make(map[uuid.UUID]struct{}, len(entries))
	ids := make([]uuid.UUID, 0, len(entries))
	for _, entry := range entries {
		if entry.ActorUserID == nil {
			continue
		}
		if _, ok := seen[*entry.ActorUserID]; ok {
			continue
		}
		seen[*entry.ActorUserID] = struct{}{}
		ids = append(ids, *entry.ActorUserID)
	}
	if len(ids) == 0 {
		return
	}
	resolved, err := s.users.ResolveUsers(ctx, tenantID, ids)
	if err != nil {
		s.logger.Warn().Err(err).Msg("request audit actor names could not be resolved")
		return
	}
	for i := range entries {
		if entries[i].ActorUserID == nil {
			continue
		}
		user, ok := resolved[*entries[i].ActorUserID]
		if !ok {
			continue
		}
		name := strings.Join(strings.Fields(user.FirstName+" "+user.LastName), " ")
		if name != "" {
			entries[i].ActorName = &name
		}
	}
}

func (s *LegalRequestService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.requests.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("legal request not found")
		}
		return internalError("delete legal request", err)
	}
	return nil
}

func requestSubmitTarget(request *model.LegalRequest) model.RequestStatus {
	if request.RequesterApprovalReqd || request.ProviderApprovalReqd {
		return model.RequestStatusSubmitted
	}
	return model.RequestStatusApproved
}

func legalRequestEventPayload(request *model.LegalRequest) map[string]any {
	return map[string]any{
		"id":                request.ID,
		"request_number":    request.RequestNumber,
		"request_type":      request.RequestType,
		"requester_user_id": request.RequesterUserID.String(),
		"requester_name":    request.RequesterName,
		"priority":          request.Priority,
		"status":            request.Status,
	}
}

func reclassifiedUrgencyJustification(request *model.LegalRequest, req dto.ReclassifyPriorityRequest) (*string, error) {
	if request.Priority == req.Priority {
		return nil, conflictError("request is already at the requested priority")
	}
	if req.Priority == model.RequestPriorityUrgent {
		if err := validateUrgencyJustification(req.Priority, req.UrgencyJustification, "urgency_justification"); err != nil {
			return nil, err
		}
		return req.UrgencyJustification, nil
	}
	return nil, nil
}

func newLegalRequestPriorityChange(tenantID, requestID, changedBy uuid.UUID, from, to model.RequestPriority, reason string) *model.LegalRequestPriorityChange {
	return &model.LegalRequestPriorityChange{
		ID:           uuid.New(),
		TenantID:     tenantID,
		RequestID:    requestID,
		FromPriority: from,
		ToPriority:   to,
		Reason:       reason,
		ChangedBy:    changedBy,
	}
}

func requestTransitionAllowed(from, to model.RequestStatus) bool {
	targets, ok := requestStatusTransitions[from]
	if !ok {
		return false
	}
	_, ok = targets[to]
	return ok
}

func validateLegalRequestCreate(req dto.CreateLegalRequestRequest) error {
	if req.RequestType == "" {
		return validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if req.Title.IsEmpty() {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if req.RequesterName == "" {
		return validationError("requester_name is required", map[string]string{"requester_name": "required"})
	}
	if !req.Priority.Valid() {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func validateLegalRequest(request *model.LegalRequest) error {
	if strings.TrimSpace(request.RequestType) == "" {
		return validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if request.Title.IsEmpty() {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if strings.TrimSpace(request.RequesterName) == "" {
		return validationError("requester_name is required", map[string]string{"requester_name": "required"})
	}
	if !request.Priority.Valid() {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func applyLegalRequestUpdate(request *model.LegalRequest, req dto.UpdateLegalRequestRequest) {
	if req.RequestType != nil {
		request.RequestType = *req.RequestType
	}
	if req.ServiceID != nil {
		request.ServiceID = req.ServiceID
	}
	if req.Title != nil {
		request.Title = *req.Title
	}
	if req.Description != nil {
		request.Description = *req.Description
	}
	if req.RequesterName != nil {
		request.RequesterName = *req.RequesterName
	}
	if req.BeneficiaryEntityID != nil {
		request.BeneficiaryEntityID = req.BeneficiaryEntityID
	}
	if req.Department != nil {
		request.Department = req.Department
	}
	if req.RequesterApprovalReqd != nil {
		request.RequesterApprovalReqd = *req.RequesterApprovalReqd
	}
	if req.ProviderApprovalReqd != nil {
		request.ProviderApprovalReqd = *req.ProviderApprovalReqd
	}
	if req.SubjectType != nil {
		request.SubjectType = req.SubjectType
	}
	if req.SubjectID != nil {
		request.SubjectID = req.SubjectID
	}
	if req.Metadata != nil {
		request.Metadata = req.Metadata
	}
}
