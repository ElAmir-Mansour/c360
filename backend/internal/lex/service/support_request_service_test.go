package service

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type supportCalendarProvider struct{ calc calendar.Calculator }

type supportUserDirectory map[uuid.UUID]UserRef

func (d supportUserDirectory) ResolveUsers(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]UserRef, error) {
	out := make(map[uuid.UUID]UserRef, len(ids))
	for _, id := range ids {
		if user, ok := d[id]; ok {
			out[id] = user
		}
	}
	return out, nil
}

func (p supportCalendarProvider) DefaultCalculator(context.Context, uuid.UUID) (calendar.Calculator, error) {
	return p.calc, nil
}

func (p supportCalendarProvider) CalculatorFor(context.Context, uuid.UUID, uuid.UUID) (calendar.Calculator, error) {
	return p.calc, nil
}

func TestSupportExpiryUsesWorkingDaysAndPersistsResolvedInstant(t *testing.T) {
	// Thursday +2 KSA working days skips Friday/Saturday and lands Monday.
	start := time.Date(2026, 8, 6, 9, 30, 0, 0, time.FixedZone("UTC+3", 3*60*60))
	got, err := calculateSupportExpiry(context.Background(), supportCalendarProvider{calc: calendar.DefaultCalculator()}, uuid.New(), start, 2)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	if got == nil || !got.Equal(want) {
		t.Fatalf("expiry = %v, want %v", got, want)
	}
}

func TestSupportExpiryPreviewUsesTheCreateCalendarAndClock(t *testing.T) {
	start := time.Date(2026, 8, 6, 6, 30, 0, 0, time.UTC)
	svc := &SupportRequestService{
		calendars: supportCalendarProvider{calc: calendar.DefaultCalculator()},
		now:       func() time.Time { return start },
	}
	preview, err := svc.PreviewExpiry(context.Background(), uuid.New(), 2)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	if preview.BusinessDays != 2 || !preview.ExpiresAt.Equal(want) {
		t.Fatalf("preview = %+v, want business_days=2 expires_at=%v", preview, want)
	}
	for _, invalid := range []int{0, 367} {
		if status := httpStatus(func() error { _, err := svc.PreviewExpiry(context.Background(), uuid.New(), invalid); return err }()); status != http.StatusUnprocessableEntity {
			t.Fatalf("business_days=%d status=%d, want 422", invalid, status)
		}
	}
}

func TestSupportStateMachineEnforcesActorsTerminalityAndAcceptedExpiry(t *testing.T) {
	requester, assignee, outsider := uuid.New(), uuid.New(), uuid.New()
	expires := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	item := &model.SupportRequest{
		RequesterID: requester, AssigneeID: assignee, Status: model.SupportStatusOpen, ExpiresAt: &expires,
	}
	before := expires.Add(-time.Minute)
	if status := httpStatus(applySupportTransition(item, outsider, "accept", "", before)); status != http.StatusForbidden {
		t.Fatalf("outsider accept status = %d, want 403", status)
	}
	if err := applySupportTransition(item, assignee, "accept", "", before); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if item.Status != model.SupportStatusAccepted || item.AcceptedAt == nil || item.ClosedAt != nil {
		t.Fatalf("accepted item = %+v", item)
	}
	if status := httpStatus(applySupportTransition(item, assignee, "resolve", "done", expires)); status != http.StatusConflict {
		t.Fatalf("resolve at half-open expiry boundary status = %d, want 409", status)
	}
	if err := applySupportTransition(item, assignee, "resolve", "done", before); err != nil {
		t.Fatalf("resolve before expiry: %v", err)
	}
	if item.Status != model.SupportStatusResolved || item.ClosedAt == nil || item.ResolutionNote != "done" {
		t.Fatalf("resolved item = %+v", item)
	}
	if status := httpStatus(applySupportTransition(item, requester, "cancel", "", before)); status != http.StatusConflict {
		t.Fatalf("terminal cancel status = %d, want 409", status)
	}
}

func TestSupportStateMachineDeclineAndCancelActorRules(t *testing.T) {
	requester, assignee := uuid.New(), uuid.New()
	now := time.Now().UTC()
	declined := &model.SupportRequest{RequesterID: requester, AssigneeID: assignee, Status: model.SupportStatusOpen}
	if status := httpStatus(applySupportTransition(declined, requester, "decline", "", now)); status != http.StatusForbidden {
		t.Fatalf("requester decline status = %d, want 403", status)
	}
	if err := applySupportTransition(declined, assignee, "decline", "busy", now); err != nil {
		t.Fatal(err)
	}
	if declined.Status != model.SupportStatusDeclined || declined.ClosedAt == nil {
		t.Fatalf("declined = %+v", declined)
	}
	cancelled := &model.SupportRequest{RequesterID: requester, AssigneeID: assignee, Status: model.SupportStatusAccepted}
	if status := httpStatus(applySupportTransition(cancelled, assignee, "cancel", "", now)); status != http.StatusForbidden {
		t.Fatalf("assignee cancel status = %d, want 403", status)
	}
	if err := applySupportTransition(cancelled, requester, "cancel", "", now); err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != model.SupportStatusCancelled || cancelled.ClosedAt == nil {
		t.Fatalf("cancelled = %+v", cancelled)
	}
}

func TestValidateSupportCreateRejectsUnboundedAndMismatchedInput(t *testing.T) {
	entityID, assigneeID, subjectID := uuid.New(), uuid.New(), uuid.New()
	typeCase := model.SupportSubjectCase
	valid := dto.CreateSupportRequest{TargetEntityID: entityID, AssigneeID: assigneeID, Subject: "Need help", Priority: model.SupportPriorityNormal}
	if err := validateSupportCreate(valid); err != nil {
		t.Fatalf("valid request: %v", err)
	}
	zero, tooLong := 0, 367
	for _, req := range []dto.CreateSupportRequest{
		{TargetEntityID: entityID, AssigneeID: assigneeID, Subject: "Need help", Priority: model.SupportPriorityNormal, BusinessDays: &zero},
		{TargetEntityID: entityID, AssigneeID: assigneeID, Subject: "Need help", Priority: model.SupportPriorityNormal, BusinessDays: &tooLong},
		{TargetEntityID: entityID, AssigneeID: assigneeID, Subject: "Need help", Priority: model.SupportPriorityNormal, SubjectType: &typeCase},
		{TargetEntityID: entityID, AssigneeID: assigneeID, Subject: "Need help", Priority: model.SupportPriorityNormal, SubjectID: &subjectID},
	} {
		if status := httpStatus(validateSupportCreate(req)); status != http.StatusUnprocessableEntity {
			t.Fatalf("invalid request %+v status = %d, want 422", req, status)
		}
	}
}

func TestValidateSupportCreateCountsArabicCharactersNotUTF8Bytes(t *testing.T) {
	base := dto.CreateSupportRequest{
		TargetEntityID: uuid.New(), AssigneeID: uuid.New(),
		Priority: model.SupportPriorityNormal,
	}
	base.Subject = strings.Repeat("ق", 200)
	if err := validateSupportCreate(base); err != nil {
		t.Fatalf("200 Arabic characters must fit: %v", err)
	}
	base.Subject += "ض"
	if status := httpStatus(validateSupportCreate(base)); status != http.StatusUnprocessableEntity {
		t.Fatalf("201 Arabic characters status = %d, want 422", status)
	}
}

func TestSupportHistoryEnrichmentRetainsInactiveUserNames(t *testing.T) {
	tenantID, requesterID, assigneeID := uuid.New(), uuid.New(), uuid.New()
	svc := &SupportRequestService{users: supportUserDirectory{
		requesterID: {ID: requesterID, FirstName: "Former", LastName: "Requester", Status: "inactive"},
		assigneeID:  {ID: assigneeID, FirstName: "Active", LastName: "Helper", Status: "active"},
	}}
	items := []model.SupportRequest{{RequesterID: requesterID, AssigneeID: assigneeID, Status: model.SupportStatusResolved}}
	if err := svc.enrich(context.Background(), tenantID, items); err != nil {
		t.Fatal(err)
	}
	if items[0].Requester == nil || items[0].Requester.FirstName != "Former" || items[0].Assignee == nil {
		t.Fatalf("historical enrichment = %+v", items[0])
	}
}

// The four approver-resolution routes. The two automatic ones exist so a request
// is never silently stuck: in the live demo tenant 19 active memberships carry
// only 16 managers, so three people would otherwise sit in
// pending_manager_approval forever.
func TestSupportApprovalGateCoversAllFourResolutionRoutes(t *testing.T) {
	requesterID, managerID, headID := uuid.New(), uuid.New(), uuid.New()
	for _, tc := range []struct {
		name         string
		candidate    *repository.SupportApproverCandidate
		wantApprover *uuid.UUID
		wantRoute    model.SupportApprovalRoute
		wantStatus   model.SupportRequestStatus
	}{
		{
			name:         "manager edge on the membership",
			candidate:    &repository.SupportApproverCandidate{UserID: managerID, Route: model.SupportRouteManager},
			wantApprover: &managerID, wantRoute: model.SupportRouteManager,
			wantStatus: model.SupportStatusPendingManagerApproval,
		},
		{
			name:         "unit head found up the entity tree",
			candidate:    &repository.SupportApproverCandidate{UserID: headID, Route: model.SupportRouteUnitHead},
			wantApprover: &headID, wantRoute: model.SupportRouteUnitHead,
			wantStatus: model.SupportStatusPendingManagerApproval,
		},
		{
			name:         "nobody above the requester auto-approves rather than stranding them",
			candidate:    nil,
			wantApprover: nil, wantRoute: model.SupportRouteAutoNoManager,
			wantStatus: model.SupportStatusOpen,
		},
		{
			name:         "requester is their own approver, so no four-eyes breach is offered",
			candidate:    &repository.SupportApproverCandidate{UserID: requesterID, Route: model.SupportRouteManager},
			wantApprover: &requesterID, wantRoute: model.SupportRouteAutoSelf,
			wantStatus: model.SupportStatusOpen,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := decideSupportApprovalGate(tc.candidate, requesterID)
			if got.Route != tc.wantRoute || got.Status != tc.wantStatus {
				t.Fatalf("gate = %+v, want route=%s status=%s", got, tc.wantRoute, tc.wantStatus)
			}
			if got.AutoApproved != tc.wantRoute.Automatic() {
				t.Fatalf("gate %+v: AutoApproved must agree with the route being automatic", got)
			}
			if tc.wantApprover == nil {
				if got.ApproverUserID != nil {
					t.Fatalf("gate approver = %v, want none", got.ApproverUserID)
				}
			} else if got.ApproverUserID == nil || *got.ApproverUserID != *tc.wantApprover {
				t.Fatalf("gate approver = %v, want %s", got.ApproverUserID, *tc.wantApprover)
			}
			// Every route is recorded: a request that skipped human approval
			// must say so on its face.
			if !got.Route.Valid() {
				t.Fatalf("gate route %q is not a recorded route", got.Route)
			}
		})
	}
}

func TestSupportApprovalDecisionRequiresTheFrozenApproverAndPendingStatus(t *testing.T) {
	requester, assignee, approver, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	now := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	pending := func() *model.SupportRequest {
		return &model.SupportRequest{
			RequesterID: requester, AssigneeID: assignee, ApproverUserID: &approver,
			ApprovalRoute: model.SupportRouteManager, Status: model.SupportStatusPendingManagerApproval,
		}
	}

	if status := httpStatus(applySupportApprovalDecision(pending(), outsider, true, "", now, nil)); status != http.StatusForbidden {
		t.Fatalf("outsider approve status = %d, want 403", status)
	}
	if status := httpStatus(applySupportApprovalDecision(pending(), requester, true, "", now, nil)); status != http.StatusForbidden {
		t.Fatalf("requester self-approve status = %d, want 403", status)
	}
	if status := httpStatus(applySupportApprovalDecision(pending(), assignee, true, "", now, nil)); status != http.StatusForbidden {
		t.Fatalf("colleague approve status = %d, want 403", status)
	}

	// A request that already cleared the gate cannot be decided again, whichever
	// side of the gate it is on now.
	for _, status := range []model.SupportRequestStatus{
		model.SupportStatusOpen, model.SupportStatusAccepted, model.SupportStatusResolved,
		model.SupportStatusRejected, model.SupportStatusCancelled,
	} {
		item := pending()
		item.Status = status
		if got := httpStatus(applySupportApprovalDecision(item, approver, true, "", now, nil)); got != http.StatusConflict {
			t.Fatalf("approve from %s status = %d, want 409", status, got)
		}
	}

	// An auto-cleared request has no approver to act, and nobody may invent one.
	auto := pending()
	auto.ApproverUserID, auto.ApprovalRoute, auto.Status = nil, model.SupportRouteAutoNoManager, model.SupportStatusPendingManagerApproval
	if got := httpStatus(applySupportApprovalDecision(auto, approver, true, "", now, nil)); got != http.StatusForbidden {
		t.Fatalf("approve without a frozen approver status = %d, want 403", got)
	}

	approved := pending()
	if err := applySupportApprovalDecision(approved, approver, true, "looks fine", now, nil); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.Status != model.SupportStatusOpen || approved.ClosedAt != nil ||
		approved.ApprovalNote != "looks fine" || approved.ApprovalDecidedAt == nil ||
		approved.ApprovalRoute != model.SupportRouteManager {
		t.Fatalf("approved = %+v, want open with the decision recorded", approved)
	}

	rejected := pending()
	if err := applySupportApprovalDecision(rejected, approver, false, "raise it with the vendor first", now, nil); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if rejected.Status != model.SupportStatusRejected || rejected.ClosedAt == nil ||
		rejected.ApprovalNote != "raise it with the vendor first" || rejected.ExpiresAt != nil {
		t.Fatalf("rejected = %+v, want terminal with the note recorded and no clock", rejected)
	}
	if !rejected.Status.Terminal() {
		t.Fatal("rejected must be terminal like the other closed states")
	}
}

// Section 4.3, the load-bearing one. The validity window is materialised at
// APPROVAL. Computed at creation, a 2-day request approved on day 2 would arrive
// at the colleague already expired.
func TestSupportExpiryWindowStartsAtApprovalNotAtCreation(t *testing.T) {
	// Thursday, the request is raised with a 2-working-day window.
	createdAt := time.Date(2026, 8, 6, 6, 30, 0, 0, time.UTC)
	calc := calendar.DefaultCalculator()
	windowFromCreation, err := calculateSupportExpiry(context.Background(), supportCalendarProvider{calc: calc}, uuid.New(), createdAt, 2)
	if err != nil {
		t.Fatal(err)
	}

	// The approver sits on it until exactly the instant the creation-based
	// window would have run out.
	approvedAt := *windowFromCreation
	businessDays := 2
	approver := uuid.New()
	item := &model.SupportRequest{
		RequesterID: uuid.New(), AssigneeID: uuid.New(), ApproverUserID: &approver,
		ApprovalRoute: model.SupportRouteManager, Status: model.SupportStatusPendingManagerApproval,
		BusinessDays: &businessDays, CreatedAt: createdAt,
	}
	if item.ExpiresAt != nil {
		t.Fatal("a request behind the gate must carry no expiry clock")
	}
	if err := applySupportApprovalDecision(item, approver, true, "", approvedAt, calc); err != nil {
		t.Fatal(err)
	}
	if item.ExpiresAt == nil {
		t.Fatal("approval must materialise the validity window")
	}
	if !item.ExpiresAt.After(approvedAt) {
		t.Fatalf("expires_at = %v at approval %v: the colleague received an already-expired request", item.ExpiresAt, approvedAt)
	}
	// Two working days from Monday lands on Wednesday, not back on the creation
	// window's Monday.
	want := time.Date(2026, 8, 12, 6, 30, 0, 0, time.UTC)
	if !item.ExpiresAt.Equal(want) {
		t.Fatalf("expires_at = %v, want %v (2 working days from approval)", item.ExpiresAt, want)
	}

	// No requested window means no clock, before or after approval.
	openEnded := &model.SupportRequest{
		ApproverUserID: &approver, ApprovalRoute: model.SupportRouteManager,
		Status: model.SupportStatusPendingManagerApproval,
	}
	if err := applySupportApprovalDecision(openEnded, approver, true, "", approvedAt, calc); err != nil {
		t.Fatal(err)
	}
	if openEnded.ExpiresAt != nil {
		t.Fatalf("open-ended request gained an expiry at approval: %v", openEnded.ExpiresAt)
	}
}

// The colleague's own transitions must not reach across the gate either.
func TestSupportColleagueTransitionsAreBlockedWhilePendingApproval(t *testing.T) {
	requester, assignee, approver := uuid.New(), uuid.New(), uuid.New()
	now := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	pending := func() *model.SupportRequest {
		return &model.SupportRequest{
			RequesterID: requester, AssigneeID: assignee, ApproverUserID: &approver,
			ApprovalRoute: model.SupportRouteManager, Status: model.SupportStatusPendingManagerApproval,
		}
	}
	for _, action := range []string{"accept", "decline", "resolve"} {
		if status := httpStatus(applySupportTransition(pending(), assignee, action, "", now)); status != http.StatusConflict {
			t.Fatalf("colleague %s while pending status = %d, want 409", action, status)
		}
	}
	// The requester can always withdraw: the gate must not trap them either.
	cancelled := pending()
	if err := applySupportTransition(cancelled, requester, "cancel", "", now); err != nil {
		t.Fatalf("cancel while pending: %v", err)
	}
	if cancelled.Status != model.SupportStatusCancelled || cancelled.ClosedAt == nil {
		t.Fatalf("cancelled = %+v", cancelled)
	}
}

func TestSupportEnrichmentNamesTheApproverTheRequesterIsWaitingOn(t *testing.T) {
	tenantID, requesterID, assigneeID, approverID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	svc := &SupportRequestService{users: supportUserDirectory{
		requesterID: {ID: requesterID, FirstName: "Nora", LastName: "Al-Harbi", Status: "active"},
		assigneeID:  {ID: assigneeID, FirstName: "Aisha", LastName: "Saleh", Status: "active"},
		approverID:  {ID: approverID, FirstName: "Faisal", LastName: "Al-Qahtani", Status: "active"},
	}}
	items := []model.SupportRequest{{
		RequesterID: requesterID, AssigneeID: assigneeID, ApproverUserID: &approverID,
		Status: model.SupportStatusPendingManagerApproval, ApprovalRoute: model.SupportRouteManager,
	}}
	if err := svc.enrich(context.Background(), tenantID, items); err != nil {
		t.Fatal(err)
	}
	if items[0].Approver == nil || items[0].Approver.FirstName != "Faisal" {
		t.Fatalf("approver summary = %+v; awaiting approval is useless without naming who", items[0].Approver)
	}

	// auto_no_manager has no approver at all, and enrichment must not invent one.
	auto := []model.SupportRequest{{RequesterID: requesterID, AssigneeID: assigneeID, Status: model.SupportStatusOpen, ApprovalRoute: model.SupportRouteAutoNoManager}}
	if err := svc.enrich(context.Background(), tenantID, auto); err != nil {
		t.Fatal(err)
	}
	if auto[0].Approver != nil {
		t.Fatalf("auto-approved request named an approver: %+v", auto[0].Approver)
	}
}

func TestSupportDirectoryExcludesTheCallerAndInactiveColleagues(t *testing.T) {
	actorID, colleagueID, inactiveID := uuid.New(), uuid.New(), uuid.New()
	memberships := []model.OrgMembership{
		{UserID: actorID, Active: true, EmployeeCode: "SELF"},
		{UserID: colleagueID, Active: true, EmployeeCode: "COLLEAGUE", Title: map[string]string{"en": "Counsel", "ar": "مستشار"}},
		{UserID: inactiveID, Active: true, EmployeeCode: "INACTIVE"},
	}
	users := map[uuid.UUID]UserRef{
		actorID:     {ID: actorID, FirstName: "Current", LastName: "User", Status: "active"},
		colleagueID: {ID: colleagueID, FirstName: "Aisha", LastName: "Saleh", Status: "active"},
		inactiveID:  {ID: inactiveID, FirstName: "Former", LastName: "User", Status: "inactive"},
	}

	ids := supportDirectoryUserIDs(memberships, actorID)
	if len(ids) != 2 || ids[0] == actorID || ids[1] == actorID {
		t.Fatalf("resolver ids = %v, caller must be excluded", ids)
	}
	members := supportDirectoryMembers(memberships, users, actorID)
	if len(members) != 1 || members[0].UserID != colleagueID || members[0].Title.EN != "Counsel" {
		t.Fatalf("directory members = %+v, want only active colleague", members)
	}
}
