package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const maxSupportBusinessDays = 366

type SupportRequestService struct {
	db        *pgxpool.Pool
	repo      *repository.SupportRequestRepository
	orgs      CaseAssignmentOrgDirectory
	validator *CaseAssignmentValidator
	calendars SLACalendarProvider
	users     WorkforceUserDirectory
	publisher Publisher
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewSupportRequestService(
	db *pgxpool.Pool,
	repo *repository.SupportRequestRepository,
	orgs CaseAssignmentOrgDirectory,
	validator *CaseAssignmentValidator,
	calendars SLACalendarProvider,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *SupportRequestService {
	return &SupportRequestService{
		db: db, repo: repo, orgs: orgs, validator: validator, calendars: calendars,
		publisher: publisherOrNoop(publisher), topic: topic,
		logger: logger.With().Str("service", "lex-support-requests").Logger(), now: time.Now,
	}
}

// SetUserDirectory installs the tenant-scoped platform_core batch resolver.
// Without it user-facing support reads and the member picker fail closed rather
// than exposing UUIDs as names or trusting stale membership rows.
func (s *SupportRequestService) SetUserDirectory(users WorkforceUserDirectory) {
	if s != nil && users != nil {
		s.users = users
	}
}

func (s *SupportRequestService) Create(ctx context.Context, tenantID, actorID uuid.UUID, req dto.CreateSupportRequest) (*model.SupportRequest, error) {
	req.Normalize()
	if err := validateSupportCreate(req); err != nil {
		return nil, err
	}
	if req.AssigneeID == actorID {
		return nil, validationError("assignee_id must identify another legal colleague", map[string]string{"assignee_id": "cannot assign support to yourself"})
	}
	if s.validator == nil {
		return nil, internalError("support assignment validator is not configured", nil)
	}
	if err := s.validator.ValidateSupportAssignee(ctx, tenantID, req.TargetEntityID, req.AssigneeID); err != nil {
		return nil, err
	}

	requesterEntityID, err := s.repo.RequesterEntity(ctx, tenantID, actorID)
	if err != nil {
		return nil, internalError("resolve support requester entity", err)
	}
	// The approver is resolved HERE and frozen on the row. Resolving it lazily
	// at approval time would let an org-chart edit silently reassign in-flight
	// requests.
	candidate, err := s.repo.ResolveApprover(ctx, tenantID, actorID, requesterEntityID)
	if err != nil {
		return nil, internalError("resolve support approver", err)
	}
	gate := decideSupportApprovalGate(candidate, actorID)

	now := s.now().UTC()
	// Section 4.3: the validity window is materialised when the request is
	// routed to the colleague, not when it is submitted. An auto-approved
	// request is routed immediately, so its clock starts now; a gated one has no
	// clock at all until the approver acts.
	var expiresAt *time.Time
	if gate.AutoApproved && req.BusinessDays != nil {
		expiresAt, err = calculateSupportExpiry(ctx, s.calendars, tenantID, now, *req.BusinessDays)
		if err != nil {
			return nil, err
		}
	}
	var decidedAt *time.Time
	if gate.AutoApproved {
		decidedAt = &now
	}

	item := &model.SupportRequest{
		ID: uuid.New(), TenantID: tenantID, RequesterID: actorID,
		RequesterEntityID: requesterEntityID, TargetEntityID: req.TargetEntityID,
		AssigneeID: req.AssigneeID, Subject: req.Subject, Body: req.Body,
		Priority: req.Priority, SubjectType: req.SubjectType, SubjectID: req.SubjectID,
		Status: gate.Status, ResolutionNote: "", ExpiresAt: expiresAt,
		ApproverUserID: gate.ApproverUserID, ApprovalRoute: gate.Route,
		ApprovalDecidedAt: decidedAt, BusinessDays: req.BusinessDays,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start support request transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set support request tenant context", err)
	}
	if err := s.repo.Create(ctx, tx, item); err != nil {
		return nil, internalError("create support request", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit support request", err)
	}
	if gate.AutoApproved {
		// `.created` means "routed to the colleague" -- it is what the
		// notification layer fans out to the assignee. On the gated path it is
		// emitted at approval instead, so the colleague is told about the
		// request exactly when it becomes theirs.
		s.publish(ctx, supportEventCreated, item, actorID)
	} else {
		s.publish(ctx, supportEventSubmittedForApproval, item, actorID)
	}
	return s.enrichAfterCommit(ctx, tenantID, item), nil
}

const (
	supportEventCreated              = "com.clario360.lex.support_request.created"
	supportEventSubmittedForApproval = "com.clario360.lex.support_request.submitted_for_approval"
	supportEventApproved             = "com.clario360.lex.support_request.approved"
	supportEventRejected             = "com.clario360.lex.support_request.rejected"
)

// supportApprovalGate is the creation-time verdict: who approves, by what route,
// and whether the request is routed immediately.
type supportApprovalGate struct {
	ApproverUserID *uuid.UUID
	Route          model.SupportApprovalRoute
	Status         model.SupportRequestStatus
	AutoApproved   bool
}

// decideSupportApprovalGate turns the org-data answer into one of the four
// routes. The two automatic routes exist so a request is never silently stuck:
// auto_no_manager covers the requester nobody sits above (3 of 19 active
// memberships in the live demo tenant), auto_self covers the requester who is
// their own approver, where a self-approval click would be a four-eyes breach
// and blocking would strand them. Both record that no human approved.
func decideSupportApprovalGate(candidate *repository.SupportApproverCandidate, requesterID uuid.UUID) supportApprovalGate {
	if candidate == nil || candidate.UserID == uuid.Nil {
		return supportApprovalGate{
			Route: model.SupportRouteAutoNoManager, Status: model.SupportStatusOpen, AutoApproved: true,
		}
	}
	approver := candidate.UserID
	if approver == requesterID {
		return supportApprovalGate{
			ApproverUserID: &approver, Route: model.SupportRouteAutoSelf,
			Status: model.SupportStatusOpen, AutoApproved: true,
		}
	}
	route := candidate.Route
	if !route.Valid() || route.Automatic() {
		route = model.SupportRouteManager
	}
	return supportApprovalGate{
		ApproverUserID: &approver, Route: route,
		Status: model.SupportStatusPendingManagerApproval, AutoApproved: false,
	}
}

func calculateSupportExpiry(ctx context.Context, calendars SLACalendarProvider, tenantID uuid.UUID, now time.Time, businessDays int) (*time.Time, error) {
	if calendars == nil {
		return nil, internalError("support business calendar is not configured", nil)
	}
	calc, err := calendars.DefaultCalculator(ctx, tenantID)
	if err != nil {
		return nil, internalError("resolve support business calendar", err)
	}
	value := calc.AddWorkingDays(now, businessDays).UTC()
	return &value, nil
}

func (s *SupportRequestService) PreviewExpiry(ctx context.Context, tenantID uuid.UUID, businessDays int) (*model.SupportExpiryPreview, error) {
	if businessDays < 1 || businessDays > maxSupportBusinessDays {
		return nil, validationError("business_days must be between 1 and 366", map[string]string{"business_days": "must be between 1 and 366"})
	}
	expiresAt, err := calculateSupportExpiry(ctx, s.calendars, tenantID, s.now().UTC(), businessDays)
	if err != nil {
		return nil, err
	}
	return &model.SupportExpiryPreview{BusinessDays: businessDays, ExpiresAt: *expiresAt}, nil
}

func (s *SupportRequestService) Get(ctx context.Context, tenantID, actorID, id uuid.UUID, oversee bool) (*model.SupportRequest, error) {
	item, err := s.repo.GetVisible(ctx, tenantID, actorID, id, oversee)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("support request not found")
		}
		return nil, internalError("load support request", err)
	}
	return s.enrichOne(ctx, tenantID, item)
}

func (s *SupportRequestService) List(ctx context.Context, tenantID, actorID uuid.UUID, oversee bool, filters model.SupportRequestListFilters) ([]model.SupportRequest, int, error) {
	if filters.Box == "" {
		filters.Box = model.SupportBoxInbox
	}
	if !filters.Box.Valid() {
		return nil, 0, validationError("box must be inbox, sent, approvals, or all", map[string]string{"box": "invalid"})
	}
	for _, status := range filters.Statuses {
		if !status.Valid() {
			return nil, 0, validationError("invalid support request status", map[string]string{"status": "invalid"})
		}
	}
	items, total, err := s.repo.List(ctx, tenantID, actorID, oversee, filters)
	if err != nil {
		return nil, 0, internalError("list support requests", err)
	}
	if err := s.enrich(ctx, tenantID, items); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *SupportRequestService) Directory(ctx context.Context, tenantID, actorID uuid.UUID, entityID *uuid.UUID) (*model.SupportDirectory, error) {
	entities, err := s.repo.DirectoryEntities(ctx, tenantID)
	if err != nil {
		return nil, internalError("list support directory entities", err)
	}
	result := &model.SupportDirectory{Entities: entities, Members: []model.SupportDirectoryMember{}}
	if entityID == nil {
		return result, nil
	}
	entity, err := s.orgs.Get(ctx, tenantID, *entityID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, validationError("entity_id must reference an active entity in this tenant", map[string]string{"entity_id": "unknown entity"})
		}
		return nil, internalError("load support directory entity", err)
	}
	if entity == nil || entity.TenantID != tenantID || !entity.Active || entity.DeletedAt != nil {
		return nil, validationError("entity_id must reference an active entity in this tenant", map[string]string{"entity_id": "inactive or unknown entity"})
	}
	memberships, err := s.orgs.ListActiveMemberships(ctx, tenantID, *entityID)
	if err != nil {
		return nil, internalError("list support directory memberships", err)
	}
	if s.users == nil {
		return nil, internalError("support user directory is not configured", nil)
	}
	ids := supportDirectoryUserIDs(memberships, actorID)
	users, err := s.users.ResolveUsers(ctx, tenantID, ids)
	if err != nil {
		return nil, internalError("resolve support directory users", err)
	}
	result.Members = supportDirectoryMembers(memberships, users, actorID)
	result.SelectedEntityID = entityID
	return result, nil
}

func supportDirectoryUserIDs(memberships []model.OrgMembership, actorID uuid.UUID) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(memberships))
	for _, membership := range memberships {
		if membership.UserID != actorID {
			ids = append(ids, membership.UserID)
		}
	}
	return ids
}

func supportDirectoryMembers(memberships []model.OrgMembership, users map[uuid.UUID]UserRef, actorID uuid.UUID) []model.SupportDirectoryMember {
	members := make([]model.SupportDirectoryMember, 0, len(memberships))
	for _, membership := range memberships {
		if membership.UserID == actorID {
			continue
		}
		user, ok := users[membership.UserID]
		if !ok || !strings.EqualFold(strings.TrimSpace(user.Status), "active") {
			continue
		}
		members = append(members, model.SupportDirectoryMember{
			UserID: user.ID, FirstName: user.FirstName, LastName: user.LastName,
			AvatarURL: user.AvatarURL, EmployeeCode: membership.EmployeeCode,
			Title:         forms.LocalizedText{EN: membership.Title["en"], AR: membership.Title["ar"]},
			ManagerUserID: membership.ManagerUserID,
		})
	}
	return members
}

func (s *SupportRequestService) Accept(ctx context.Context, tenantID, actorID, id uuid.UUID) (*model.SupportRequest, error) {
	return s.transition(ctx, tenantID, actorID, id, "accept", "")
}

func (s *SupportRequestService) Decline(ctx context.Context, tenantID, actorID, id uuid.UUID, note string) (*model.SupportRequest, error) {
	return s.transition(ctx, tenantID, actorID, id, "decline", strings.TrimSpace(note))
}

func (s *SupportRequestService) Resolve(ctx context.Context, tenantID, actorID, id uuid.UUID, note string) (*model.SupportRequest, error) {
	return s.transition(ctx, tenantID, actorID, id, "resolve", strings.TrimSpace(note))
}

func (s *SupportRequestService) Cancel(ctx context.Context, tenantID, actorID, id uuid.UUID) (*model.SupportRequest, error) {
	return s.transition(ctx, tenantID, actorID, id, "cancel", "")
}

// Approve clears the gate and routes the request to the colleague. Authorization
// is being the approver frozen on the row -- no separate permission exists,
// because the org chart, not RBAC, decides who approves for whom.
func (s *SupportRequestService) Approve(ctx context.Context, tenantID, actorID, id uuid.UUID, note string) (*model.SupportRequest, error) {
	return s.decide(ctx, tenantID, actorID, id, true, strings.TrimSpace(note))
}

// Reject is terminal. The note is the requester's only explanation, so it is
// carried on the event for the notification layer.
func (s *SupportRequestService) Reject(ctx context.Context, tenantID, actorID, id uuid.UUID, note string) (*model.SupportRequest, error) {
	return s.decide(ctx, tenantID, actorID, id, false, strings.TrimSpace(note))
}

func (s *SupportRequestService) decide(ctx context.Context, tenantID, actorID, id uuid.UUID, approve bool, note string) (*model.SupportRequest, error) {
	if utf8.RuneCountInString(note) > 10000 {
		return nil, validationError("note is too long", map[string]string{"note": "maximum 10000 characters"})
	}
	// The tenant calendar is fetched before the row lock: it depends only on the
	// tenant, and holding a row lock across an unrelated read is needless.
	var calc calendar.Calculator
	if approve {
		if s.calendars == nil {
			return nil, internalError("support business calendar is not configured", nil)
		}
		resolved, err := s.calendars.DefaultCalculator(ctx, tenantID)
		if err != nil {
			return nil, internalError("resolve support business calendar", err)
		}
		calc = resolved
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start support approval transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set support approval tenant context", err)
	}
	item, err := s.repo.Lock(ctx, tx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("support request not found")
		}
		return nil, internalError("lock support request", err)
	}
	now := s.now().UTC()
	if err := applySupportApprovalDecision(item, actorID, approve, note, now, calc); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateState(ctx, tx, item); err != nil {
		return nil, internalError("update support request approval", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit support approval", err)
	}
	if approve {
		s.publish(ctx, supportEventApproved, item, actorID)
		// The request only now reaches the colleague; `.created` is the routing
		// event the notification layer already fans out to the assignee.
		s.publish(ctx, supportEventCreated, item, actorID)
	} else {
		s.publish(ctx, supportEventRejected, item, actorID)
	}
	return s.enrichAfterCommit(ctx, tenantID, item), nil
}

// applySupportApprovalDecision is the gate's whole state machine, kept pure so
// it is table-testable without a database.
//
// On approve, the validity window is materialised HERE from the requested
// business days. Computing it at creation would let a slow approver eat the
// colleague's entire window -- a 2-day request approved on day 2 would arrive
// already expired.
func applySupportApprovalDecision(item *model.SupportRequest, actorID uuid.UUID, approve bool, note string, now time.Time, calc calendar.Calculator) error {
	if item == nil {
		return notFoundError("support request not found")
	}
	if item.Status != model.SupportStatusPendingManagerApproval {
		return conflictError("only support requests awaiting approval can be approved or rejected")
	}
	if item.ApproverUserID == nil || *item.ApproverUserID != actorID {
		return forbiddenError("only the assigned approver may decide this support request")
	}
	item.ApprovalDecidedAt, item.ApprovalNote = &now, note
	if !approve {
		item.Status, item.ClosedAt = model.SupportStatusRejected, &now
		return nil
	}
	item.Status = model.SupportStatusOpen
	if item.BusinessDays != nil {
		if calc == nil {
			return internalError("support business calendar is not configured", nil)
		}
		expiresAt := calc.AddWorkingDays(now, *item.BusinessDays).UTC()
		item.ExpiresAt = &expiresAt
	}
	return nil
}

func (s *SupportRequestService) transition(ctx context.Context, tenantID, actorID, id uuid.UUID, action, note string) (*model.SupportRequest, error) {
	if utf8.RuneCountInString(note) > 10000 {
		return nil, validationError("note is too long", map[string]string{"note": "maximum 10000 characters"})
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start support transition transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set support transition tenant context", err)
	}
	item, err := s.repo.Lock(ctx, tx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("support request not found")
		}
		return nil, internalError("lock support request", err)
	}
	now := s.now().UTC()
	if err := applySupportTransition(item, actorID, action, note, now); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateState(ctx, tx, item); err != nil {
		return nil, internalError("update support request", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit support transition", err)
	}
	eventSuffix := map[string]string{
		"accept": "accepted", "decline": "declined",
		"resolve": "resolved", "cancel": "cancelled",
	}[action]
	s.publish(ctx, "com.clario360.lex.support_request."+eventSuffix, item, actorID)
	return s.enrichAfterCommit(ctx, tenantID, item), nil
}

func applySupportTransition(item *model.SupportRequest, actorID uuid.UUID, action, note string, now time.Time) error {
	if item == nil {
		return notFoundError("support request not found")
	}
	if item.Status.Terminal() {
		return conflictError("terminal support requests cannot be changed")
	}
	if item.ExpiresAt != nil && !item.ExpiresAt.After(now) {
		return conflictError("support request has reached its expiry time")
	}
	switch action {
	case "accept":
		if item.AssigneeID != actorID {
			return forbiddenError("only the assignee may accept this support request")
		}
		if item.Status != model.SupportStatusOpen {
			return conflictError("only open support requests can be accepted")
		}
		item.Status, item.AcceptedAt = model.SupportStatusAccepted, &now
	case "decline":
		if item.AssigneeID != actorID {
			return forbiddenError("only the assignee may decline this support request")
		}
		if item.Status != model.SupportStatusOpen {
			return conflictError("only open support requests can be declined")
		}
		item.Status, item.ResolutionNote, item.ClosedAt = model.SupportStatusDeclined, note, &now
	case "resolve":
		if item.AssigneeID != actorID {
			return forbiddenError("only the assignee may resolve this support request")
		}
		if item.Status != model.SupportStatusAccepted {
			return conflictError("support request must be accepted before it can be resolved")
		}
		item.Status, item.ResolutionNote, item.ClosedAt = model.SupportStatusResolved, note, &now
	case "cancel":
		if item.RequesterID != actorID {
			return forbiddenError("only the requester may cancel this support request")
		}
		item.Status, item.ClosedAt = model.SupportStatusCancelled, &now
	default:
		return validationError("unsupported support request action", map[string]string{"action": "invalid"})
	}
	return nil
}

func validateSupportCreate(req dto.CreateSupportRequest) error {
	fields := map[string]string{}
	if req.TargetEntityID == uuid.Nil {
		fields["target_entity_id"] = "required"
	}
	if req.AssigneeID == uuid.Nil {
		fields["assignee_id"] = "required"
	}
	if req.Subject == "" {
		fields["subject"] = "required"
	} else if utf8.RuneCountInString(req.Subject) > 200 {
		fields["subject"] = "maximum 200 characters"
	}
	if utf8.RuneCountInString(req.Body) > 10000 {
		fields["body"] = "maximum 10000 characters"
	}
	if !req.Priority.Valid() {
		fields["priority"] = "must be low, normal, or high"
	}
	if (req.SubjectType == nil) != (req.SubjectID == nil) {
		fields["subject_type"] = "subject_type and subject_id must be supplied together"
		fields["subject_id"] = "subject_type and subject_id must be supplied together"
	} else if req.SubjectType != nil && !req.SubjectType.Valid() {
		fields["subject_type"] = "invalid"
	}
	if req.BusinessDays != nil && (*req.BusinessDays < 1 || *req.BusinessDays > maxSupportBusinessDays) {
		fields["business_days"] = "must be between 1 and 366"
	}
	if len(fields) > 0 {
		return validationError("invalid support request", fields)
	}
	return nil
}

func (s *SupportRequestService) enrichOne(ctx context.Context, tenantID uuid.UUID, item *model.SupportRequest) (*model.SupportRequest, error) {
	if item == nil {
		return nil, nil
	}
	items := []model.SupportRequest{*item}
	if err := s.enrich(ctx, tenantID, items); err != nil {
		return nil, err
	}
	return &items[0], nil
}

// enrichAfterCommit never turns a committed mutation into an apparent failure.
// User summaries are a read-model convenience and explicitly optional in the
// response contract; returning 500 after commit would invite a duplicate create
// or a misleading retry of an already-final transition.
func (s *SupportRequestService) enrichAfterCommit(ctx context.Context, tenantID uuid.UUID, item *model.SupportRequest) *model.SupportRequest {
	enriched, err := s.enrichOne(ctx, tenantID, item)
	if err != nil {
		s.logger.Warn().Err(err).Str("support_request_id", item.ID.String()).Msg("support request committed; user-summary enrichment unavailable")
		return item
	}
	return enriched
}

func (s *SupportRequestService) enrich(ctx context.Context, tenantID uuid.UUID, items []model.SupportRequest) error {
	if len(items) == 0 {
		return nil
	}
	if s.users == nil {
		return internalError("support user directory is not configured", nil)
	}
	seen := map[uuid.UUID]struct{}{}
	ids := make([]uuid.UUID, 0, len(items)*3)
	for _, item := range items {
		parties := []uuid.UUID{item.RequesterID, item.AssigneeID}
		// The requester must be able to see WHO their request is waiting on,
		// otherwise "awaiting approval" is indistinguishable from vanished.
		if item.ApproverUserID != nil {
			parties = append(parties, *item.ApproverUserID)
		}
		for _, id := range parties {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
		}
	}
	users, err := s.users.ResolveUsers(ctx, tenantID, ids)
	if err != nil {
		return internalError("resolve support request users", err)
	}
	for i := range items {
		if user, ok := users[items[i].RequesterID]; ok {
			items[i].Requester = supportUserSummary(user)
		}
		if user, ok := users[items[i].AssigneeID]; ok {
			items[i].Assignee = supportUserSummary(user)
		}
		if items[i].ApproverUserID != nil {
			if user, ok := users[*items[i].ApproverUserID]; ok {
				items[i].Approver = supportUserSummary(user)
			}
		}
	}
	return nil
}

func supportUserSummary(user UserRef) *model.SupportUserSummary {
	return &model.SupportUserSummary{ID: user.ID, FirstName: user.FirstName, LastName: user.LastName, AvatarURL: user.AvatarURL}
}

func (s *SupportRequestService) publish(ctx context.Context, eventType string, item *model.SupportRequest, actorID uuid.UUID) {
	payload := map[string]any{
		"id": item.ID, "requester_id": item.RequesterID, "assignee_id": item.AssigneeID,
		"target_entity_id": item.TargetEntityID, "subject": item.Subject,
		"status": item.Status, "expires_at": item.ExpiresAt,
		// The approval leg travels on every support event so the notification
		// layer can address the approver, and so a consumer can tell an
		// auto-cleared request from one a person actually approved.
		"approver_user_id": item.ApproverUserID,
		"approval_route":   item.ApprovalRoute,
		"approval_note":    item.ApprovalNote,
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, item.TenantID, &actorID, payload, s.logger)
}

func (s *SupportRequestService) ListTenantIDs(ctx context.Context, now time.Time) ([]uuid.UUID, error) {
	return s.repo.ListTenantIDs(ctx, now.UTC())
}

func (s *SupportRequestService) ExpireDue(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]model.SupportRequest, error) {
	items, err := s.repo.ExpireDue(ctx, tenantID, now.UTC(), limit)
	if err != nil {
		return nil, internalError("expire due support requests", err)
	}
	return items, nil
}
