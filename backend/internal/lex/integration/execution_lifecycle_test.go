//go:build integration

package integration

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// WS6 — Execution-Rules lifecycle integration coverage (CAP-022..029).
//
// These tests drive the execution engine end-to-end over the wired app
// (eventbus + SLA bridge + requirement catalog all live): the completeness gate,
// the clock-start happy path + already-started conflict, return-incomplete review
// rounds with the two-round auto-close + clone (and clone suppression on the
// clone's own auto-close), the delivery-confirmation confirm/deny/24h-auto-close
// handshake, and the row-lock that makes a concurrent double ConfirmCompleteness
// resolve to exactly one winner.
// =============================================================================

// newRoutedRequest creates a legal request that requires no approvals (so Submit
// auto-routes it to `routed`) and returns the routed request. The execution
// engine hangs off the routed request's id; ConfirmCompleteness drives the
// routed → in_execution spine edge.
func (h *lexHarness) newRoutedRequest(t *testing.T, requestType, serviceCode string) model.LegalRequest {
	return h.newRoutedRequestFor(t, requestType, serviceCode, h.userID)
}

func (h *lexHarness) newRoutedRequestFor(t *testing.T, requestType, serviceCode string, requesterUserID uuid.UUID) model.LegalRequest {
	t.Helper()
	metadata := map[string]any{}
	if serviceCode != "" {
		metadata["service_code"] = serviceCode
	}
	createReq := dto.CreateLegalRequestRequest{
		RequestType:     requestType,
		Title:           forms.LocalizedText{EN: "Execution Lifecycle Request", AR: "طلب دورة التنفيذ"},
		Description:     "Execution lifecycle integration fixture.",
		RequesterUserID: &requesterUserID,
		RequesterName:   "Integration Requester",
		Priority:        model.RequestPriorityNormal,
		Metadata:        metadata,
	}
	created := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", createReq), http.StatusCreated)
	if created.Status != model.RequestStatusDraft {
		t.Fatalf("created request status = %s, want %s", created.Status, model.RequestStatusDraft)
	}
	// No-approval submit auto-advances approved → routed (see LegalRequestService.Submit).
	routed := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-requests/%s/submit", created.ID), dto.SubmitLegalRequestRequest{}), http.StatusOK)
	if routed.Status != model.RequestStatusRouted {
		t.Fatalf("submitted request status = %s, want %s (no-approval auto-route)", routed.Status, model.RequestStatusRouted)
	}
	return routed
}

// executionState fetches the aggregate execution read model via the GET endpoint.
func (h *lexHarness) executionState(t *testing.T, requestID uuid.UUID) dto.ExecutionStateView {
	t.Helper()
	return mustData[dto.ExecutionStateView](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/requests/%s/execution", requestID), nil), http.StatusOK)
}

func TestExecutionStateReadBeforeExecutionOpensReturnsEmptyView(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
		RequestType:   fmt.Sprintf("empty_exec_%s", uuid.NewString()[:8]),
		Title:         forms.LocalizedText{EN: "Draft execution read", AR: "قراءة تنفيذ مسودة"},
		Description:   "Draft request has no execution state yet.",
		RequesterName: "Integration Requester",
		Priority:      model.RequestPriorityNormal,
	}), http.StatusCreated)

	view := h.executionState(t, request.ID)
	if view.State != nil {
		t.Fatalf("execution state before first execution write = %+v, want nil", view.State)
	}
	if len(view.Requirements) != 0 || len(view.ReviewRounds) != 0 || len(view.DeliveryConfirmations) != 0 {
		t.Fatalf("empty execution view has rows: requirements=%d review_rounds=%d delivery_confirmations=%d", len(view.Requirements), len(view.ReviewRounds), len(view.DeliveryConfirmations))
	}
}

func TestSLAClockReadBeforeStartReturnsNull(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
		RequestType:   fmt.Sprintf("empty_sla_%s", uuid.NewString()[:8]),
		Title:         forms.LocalizedText{EN: "Draft SLA read", AR: "قراءة اتفاقية مستوى خدمة لمسودة"},
		Description:   "Draft request has no SLA clock yet.",
		RequesterName: "Integration Requester",
		Priority:      model.RequestPriorityNormal,
	}), http.StatusCreated)

	clock := mustData[*model.SLAClock](t,
		h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/sla/requests/%s/clock", request.ID), nil),
		http.StatusOK,
	)
	if clock != nil {
		t.Fatalf("sla clock before completeness confirmation = %+v, want nil", clock)
	}
}

func TestSLAClockReadForMissingRequestReturnsNotFound(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	missingRequestID := uuid.New()

	env := mustError(t,
		h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/sla/requests/%s/clock", missingRequestID), nil),
		http.StatusNotFound,
	)
	if env.Error.Code != "NOT_FOUND" {
		t.Fatalf("error code = %q, want NOT_FOUND", env.Error.Code)
	}
}

func TestRouteOpensExecutionState(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("route_exec_%s", uuid.NewString()[:8]), "")

	view := h.executionState(t, request.ID)
	if view.State == nil {
		t.Fatal("routed request execution state is nil")
	}
	if view.State.Status != model.ExecutionStatusAwaitingCompleteness {
		t.Fatalf("routed execution status = %s, want %s", view.State.Status, model.ExecutionStatusAwaitingCompleteness)
	}
}

// seedMandatingPolicy installs an active attachment policy with one REQUIRED slot
// keyed on the request type. This makes the routed service MANDATE supporting
// items, so the completeness gate must reject a confirmation while no required
// requirement is satisfied (CAP-022 zero-requirement-bypass closure).
func (h *lexHarness) seedMandatingPolicy(t *testing.T, requestType string) {
	t.Helper()
	active := true
	policyReq := dto.CreateAttachmentPolicyRequest{
		RequestType:        requestType,
		Name:               forms.LocalizedText{EN: "Execution Mandate Policy", AR: "سياسة المرفقات الإلزامية"},
		MinAttachmentCount: 0,
		Slots: []dto.AttachmentSlotRequest{
			{
				Key:      "power_of_attorney",
				Label:    forms.LocalizedText{EN: "Power of Attorney", AR: "توكيل"},
				Required: true,
			},
		},
		Active: &active,
	}
	mustData[model.AttachmentPolicy](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/attachment-policies", policyReq), http.StatusCreated)
}

// TestExecutionCompletenessGateRejectsWhenServiceMandatesRequirements proves the
// CAP-022 completeness gate: a routed request whose service mandates supporting
// items cannot be confirmed complete while its checklist carries no satisfied
// required requirement. The reject is a 422 (validation). Satisfying the seeded
// requirement then lets the clock start.
func TestExecutionCompletenessGateRejectsWhenServiceMandatesRequirements(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	requestType := fmt.Sprintf("mandate_%s", uuid.NewString()[:8])
	request := h.newRoutedRequest(t, requestType, "")

	// Intake now enforces attachment policies before submission. Route the
	// request first, then install the execution mandate and its unsatisfied
	// checklist item so this test remains focused on the execution completeness
	// gate instead of being rejected earlier by the intake attachment gate.
	h.seedMandatingPolicy(t, requestType)
	required := true
	mustData[model.RequirementItem](t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/requirements", request.ID),
		dto.CreateRequirementItemRequest{
			Code:     "power_of_attorney",
			Label:    forms.LocalizedText{EN: "Power of Attorney", AR: "توكيل"},
			Kind:     model.RequirementKindAttachment,
			Required: &required,
		}), http.StatusCreated)

	// Routing materialises the execution state (and seeds the policy-derived
	// requirement). Completeness must reject because the mandated item is
	// unsatisfied, and the read model below observes the seeded row.
	rejected := mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{
		Notes: "attempting to confirm before attaching the mandated item",
	}), http.StatusUnprocessableEntity)
	if rejected.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("reject error code = %q, want VALIDATION_ERROR", rejected.Error.Code)
	}

	view := h.executionState(t, request.ID)
	if view.State.Status != model.ExecutionStatusAwaitingCompleteness {
		t.Fatalf("seeded execution status = %s, want %s", view.State.Status, model.ExecutionStatusAwaitingCompleteness)
	}
	if len(view.Requirements) == 0 {
		t.Fatalf("expected the mandating policy to seed at least one requirement, got %d", len(view.Requirements))
	}
	var seededReqID uuid.UUID
	foundRequired := false
	for _, item := range view.Requirements {
		if item.Required {
			foundRequired = true
			seededReqID = item.ID
			break
		}
	}
	if !foundRequired {
		t.Fatalf("expected a seeded REQUIRED requirement in %+v", view.Requirements)
	}

	// Satisfy the seeded requirement; the gate now passes and the clock starts.
	fileID := uuid.New()
	mustData[model.RequirementItem](t, h.doJSON(t, http.MethodPatch, fmt.Sprintf("/api/v1/lex/requests/%s/execution/requirements/%s", request.ID, seededReqID), dto.UpdateRequirementItemRequest{
		FileID: &fileID,
	}), http.StatusOK)

	started := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{
		Notes: "all mandated items satisfied",
	}), http.StatusOK)
	if started.Status != model.ExecutionStatusInProgress {
		t.Fatalf("execution status after satisfied confirm = %s, want %s", started.Status, model.ExecutionStatusInProgress)
	}
	if started.ClockStartedAt == nil {
		t.Fatal("expected clock_started_at to be set after the gate passes")
	}
}

// TestExecutionConfirmCompletenessStartsClockAndConflictsOnSecond proves the
// clock-start happy path (no mandated requirements → trivially complete) and that
// a second confirmation conflicts because the clock has already started.
func TestExecutionConfirmCompletenessStartsClockAndConflictsOnSecond(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("clockstart_%s", uuid.NewString()[:8]), "")

	state := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{
		Notes: "request is complete",
	}), http.StatusOK)
	if state.Status != model.ExecutionStatusInProgress {
		t.Fatalf("execution status = %s, want %s", state.Status, model.ExecutionStatusInProgress)
	}
	if state.ClockStartedAt == nil {
		t.Fatal("expected clock_started_at to be set")
	}
	if state.CompletenessConfirmed == nil {
		t.Fatal("expected completeness_confirmed_at to be set")
	}
	if state.SLATargetSeconds == nil || *state.SLATargetSeconds <= 0 {
		t.Fatalf("expected a positive sla_target_seconds, got %v", state.SLATargetSeconds)
	}

	// The spine advanced routed → in_execution as a side effect.
	spine := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil), http.StatusOK)
	if spine.Status != model.RequestStatusInExecution {
		t.Fatalf("spine status after confirm = %s, want %s", spine.Status, model.RequestStatusInExecution)
	}

	// A second confirmation conflicts: the clock is already running.
	conflict := mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{
		Notes: "double confirm",
	}), http.StatusConflict)
	if conflict.Error.Code != "CONFLICT" {
		t.Fatalf("conflict error code = %q, want CONFLICT", conflict.Error.Code)
	}
}

// TestExecutionReturnIncompleteOpensReviewRound proves a single return-incomplete
// opens a review round, returns the state (and spine) to a re-workable state, and
// pauses the clock.
func TestExecutionReturnIncompleteOpensReviewRound(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("return_%s", uuid.NewString()[:8]), "")

	// Start the clock first so the return demonstrably pauses it.
	mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{}), http.StatusOK)

	returned := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/return-incomplete", request.ID), dto.ReturnIncompleteRequest{
		ReasonCode: model.ReturnReasonMissingInformation,
		Reason:     "Supporting evidence is missing.",
	}), http.StatusOK)
	if returned.Status != model.ExecutionStatusReturned {
		t.Fatalf("execution status after first return = %s, want %s", returned.Status, model.ExecutionStatusReturned)
	}
	if returned.ReviewRoundCount != 1 {
		t.Fatalf("review round count = %d, want 1", returned.ReviewRoundCount)
	}
	if returned.ClockStartedAt != nil {
		t.Fatal("expected the clock to pause (clock_started_at nil) after a return")
	}

	view := h.executionState(t, request.ID)
	if len(view.ReviewRounds) != 1 {
		t.Fatalf("review rounds = %d, want 1", len(view.ReviewRounds))
	}
	if view.ReviewRounds[0].Outcome == nil || *view.ReviewRounds[0].Outcome != model.ReviewRoundOutcomeReturned {
		t.Fatalf("first review round outcome = %v, want %s", view.ReviewRounds[0].Outcome, model.ReviewRoundOutcomeReturned)
	}
	if got := view.ReviewRounds[0].Metadata["reason_code"]; got != string(model.ReturnReasonMissingInformation) {
		t.Fatalf("first review round reason_code = %v, want %s", got, model.ReturnReasonMissingInformation)
	}

	// The spine returns to `returned` so the requester can resubmit.
	spine := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil), http.StatusOK)
	if spine.Status != model.RequestStatusReturned {
		t.Fatalf("spine status after return = %s, want %s", spine.Status, model.RequestStatusReturned)
	}
}

// TestExecutionTwoReturnsAutoCloseAndClone proves CAP-026: a second return
// auto-closes the request and spawns a clone treated as a brand-new request. The
// clone itself, after its own two returns, auto-closes WITHOUT spawning a further
// clone (clone suppression — a clone cannot re-clone).
func TestExecutionTwoReturnsAutoCloseAndClone(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("autoclose_%s", uuid.NewString()[:8]), "")

	// Round 1: ordinary return. PRD 6.3 requires a controlled reason code.
	first := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/return-incomplete", request.ID), dto.ReturnIncompleteRequest{
		ReasonCode: model.ReturnReasonMissingInformation,
		Reason:     "Round one: missing evidence.",
	}), http.StatusOK)
	if first.Status != model.ExecutionStatusReturned {
		t.Fatalf("status after round 1 = %s, want %s", first.Status, model.ExecutionStatusReturned)
	}

	// Round 2: auto-close + clone.
	second := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/return-incomplete", request.ID), dto.ReturnIncompleteRequest{
		ReasonCode: model.ReturnReasonMissingInformation,
		Reason:     "Round two: still missing evidence.",
	}), http.StatusOK)
	if second.Status != model.ExecutionStatusAutoClosed {
		t.Fatalf("status after round 2 = %s, want %s", second.Status, model.ExecutionStatusAutoClosed)
	}
	if second.ReviewRoundCount != 2 {
		t.Fatalf("review round count = %d, want 2", second.ReviewRoundCount)
	}
	if second.CloneRequestID == nil {
		t.Fatal("expected a clone request id after the two-round auto-close")
	}
	cloneID := *second.CloneRequestID

	// The clone is a fresh draft request linked back to the original.
	clone := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", cloneID), nil), http.StatusOK)
	if clone.Status != model.RequestStatusDraft {
		t.Fatalf("clone status = %s, want %s", clone.Status, model.RequestStatusDraft)
	}
	if clone.ID == request.ID {
		t.Fatal("clone id must differ from the original request id")
	}

	// The second review round is recorded as the auto-close outcome.
	view := h.executionState(t, request.ID)
	if len(view.ReviewRounds) != 2 {
		t.Fatalf("review rounds = %d, want 2", len(view.ReviewRounds))
	}
	if view.ReviewRounds[len(view.ReviewRounds)-1].Outcome == nil ||
		*view.ReviewRounds[len(view.ReviewRounds)-1].Outcome != model.ReviewRoundOutcomeAutoClosed {
		t.Fatalf("final review round outcome = %v, want %s", view.ReviewRounds[len(view.ReviewRounds)-1].Outcome, model.ReviewRoundOutcomeAutoClosed)
	}

	// Drive the CLONE through its own two returns. Because the clone carries
	// cloned_from_request_id metadata, its auto-close must NOT spawn a further
	// clone (suppression on the clone's own auto-close).
	mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/return-incomplete", cloneID), dto.ReturnIncompleteRequest{
		ReasonCode: model.ReturnReasonMissingInformation,
		Reason:     "Clone round one.",
	}), http.StatusOK)
	cloneFinal := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/return-incomplete", cloneID), dto.ReturnIncompleteRequest{
		ReasonCode: model.ReturnReasonMissingInformation,
		Reason:     "Clone round two.",
	}), http.StatusOK)
	if cloneFinal.Status != model.ExecutionStatusAutoClosed {
		t.Fatalf("clone status after its round 2 = %s, want %s", cloneFinal.Status, model.ExecutionStatusAutoClosed)
	}
	if cloneFinal.CloneRequestID != nil {
		t.Fatalf("expected clone suppression: a clone must not re-clone, got clone_request_id %s", cloneFinal.CloneRequestID)
	}
}

// TestExecutionDeliveryConfirmAndDeny proves the CAP-027 handshake: a requested
// delivery confirmation that is CONFIRMED closes the request, and a separate
// request whose confirmation is DENIED reopens it as returned.
func TestExecutionDeliveryConfirmAndDeny(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)

	// --- confirm path ---
	confirmReq := h.newRoutedRequest(t, fmt.Sprintf("deliver_ok_%s", uuid.NewString()[:8]), "")
	mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", confirmReq.ID), dto.ConfirmCompletenessRequest{}), http.StatusOK)
	dc := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", confirmReq.ID), dto.RequestDeliveryConfirmationRequest{
		RecipientName: "Integration Requester",
		Notes:         "Work delivered; please confirm.",
	}), http.StatusCreated)
	if dc.Status != model.DeliveryConfirmationStatusRequested {
		t.Fatalf("delivery confirmation status = %s, want %s", dc.Status, model.DeliveryConfirmationStatusRequested)
	}

	confirmed := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", confirmReq.ID, dc.ID), dto.RespondDeliveryConfirmationRequest{
		Confirm: true,
	}), http.StatusOK)
	if confirmed.Status != model.DeliveryConfirmationStatusConfirmed {
		t.Fatalf("responded status = %s, want %s", confirmed.Status, model.DeliveryConfirmationStatusConfirmed)
	}
	confirmView := h.executionState(t, confirmReq.ID)
	if confirmView.State.Status != model.ExecutionStatusClosed {
		t.Fatalf("execution status after confirm = %s, want %s", confirmView.State.Status, model.ExecutionStatusClosed)
	}
	confirmSpine := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", confirmReq.ID), nil), http.StatusOK)
	if confirmSpine.Status != model.RequestStatusClosed {
		t.Fatalf("spine status after confirm = %s, want %s", confirmSpine.Status, model.RequestStatusClosed)
	}

	// A second response to the now-resolved confirmation conflicts.
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", confirmReq.ID, dc.ID), dto.RespondDeliveryConfirmationRequest{
		Confirm: true,
	}), http.StatusConflict)

	// --- deny path ---
	denyReq := h.newRoutedRequest(t, fmt.Sprintf("deliver_deny_%s", uuid.NewString()[:8]), "")
	mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", denyReq.ID), dto.ConfirmCompletenessRequest{}), http.StatusOK)
	denyDC := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", denyReq.ID), dto.RequestDeliveryConfirmationRequest{
		RecipientName: "Integration Requester",
	}), http.StatusCreated)
	note := "The deliverable does not match the request."
	denied := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", denyReq.ID, denyDC.ID), dto.RespondDeliveryConfirmationRequest{
		Confirm: false,
		Note:    &note,
	}), http.StatusOK)
	if denied.Status != model.DeliveryConfirmationStatusDenied {
		t.Fatalf("denied status = %s, want %s", denied.Status, model.DeliveryConfirmationStatusDenied)
	}
	denyView := h.executionState(t, denyReq.ID)
	if denyView.State.Status != model.ExecutionStatusReturned {
		t.Fatalf("execution status after deny = %s, want %s", denyView.State.Status, model.ExecutionStatusReturned)
	}
	denySpine := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", denyReq.ID), nil), http.StatusOK)
	if denySpine.Status != model.RequestStatusReturned {
		t.Fatalf("spine status after deny = %s, want %s", denySpine.Status, model.RequestStatusReturned)
	}
}

// TestExecutionDeliveryResponseEnforcesPersistedRecipient proves the complete
// requester-facing boundary with distinct JWT actors: the base requester role
// reaches the request:edit route and may respond to its persisted confirmation,
// while an unrelated requester and the provider that opened the confirmation
// are both rejected by the service's record-level ownership check. A second
// response by the rightful recipient remains an idempotency conflict.
func TestExecutionDeliveryResponseEnforcesPersistedRecipient(t *testing.T) {
	t.Parallel()

	provider := newLexHarness(t)
	requesterID := uuid.New()
	unrelatedID := uuid.New()
	requester := provider.withToken(provider.env.mustToken(t, provider.tenantID, requesterID, "legal-requester"))
	unrelated := provider.withToken(provider.env.mustToken(t, provider.tenantID, unrelatedID, "legal-requester"))

	request := provider.newRoutedRequestFor(t, fmt.Sprintf("recipient_dc_%s", uuid.NewString()[:8]), "", requesterID)
	mustData[model.ExecutionState](t, provider.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID),
		dto.ConfirmCompletenessRequest{},
	), http.StatusOK)
	dc := mustData[model.DeliveryConfirmation](t, provider.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", request.ID),
		dto.RequestDeliveryConfirmationRequest{RecipientName: "Request owner"},
	), http.StatusCreated)
	if dc.RecipientUserID != requesterID {
		t.Fatalf("persisted recipient_user_id = %s, want requester %s", dc.RecipientUserID, requesterID)
	}

	for name, actor := range map[string]*lexHarness{
		"unrelated requester": unrelated,
		"provider":            provider,
	} {
		t.Run(name+" is forbidden", func(t *testing.T) {
			errEnvelope := mustError(t, actor.doJSON(t, http.MethodPost,
				fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
				dto.RespondDeliveryConfirmationRequest{Confirm: true},
			), http.StatusForbidden)
			if errEnvelope.Error.Code != "FORBIDDEN" {
				t.Fatalf("error code = %q, want FORBIDDEN", errEnvelope.Error.Code)
			}
		})
	}

	confirmed := mustData[model.DeliveryConfirmation](t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true},
	), http.StatusOK)
	if confirmed.Status != model.DeliveryConfirmationStatusConfirmed || confirmed.RespondedBy == nil || *confirmed.RespondedBy != requesterID {
		t.Fatalf("requester response = status %s, responded_by %v; want confirmed by %s", confirmed.Status, confirmed.RespondedBy, requesterID)
	}

	duplicate := mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true},
	), http.StatusConflict)
	if duplicate.Error.Code != "CONFLICT" {
		t.Fatalf("duplicate error code = %q, want CONFLICT", duplicate.Error.Code)
	}

	spine := mustData[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil,
	), http.StatusOK)
	if spine.Status != model.RequestStatusClosed {
		t.Fatalf("spine status after requester confirmation = %s, want %s", spine.Status, model.RequestStatusClosed)
	}
}

// TestExecutionDeliveryResponseHonorsExplicitRecipient proves that the existing
// delegated-recipient option is persisted and enforced instead of silently
// falling back to the request owner.
func TestExecutionDeliveryResponseHonorsExplicitRecipient(t *testing.T) {
	t.Parallel()

	provider := newLexHarness(t)
	requesterID := uuid.New()
	delegateID := uuid.New()
	requester := provider.withToken(provider.env.mustToken(t, provider.tenantID, requesterID, "legal-requester"))
	delegate := provider.withToken(provider.env.mustToken(t, provider.tenantID, delegateID, "legal-requester"))

	request := provider.newRoutedRequestFor(t, fmt.Sprintf("delegate_dc_%s", uuid.NewString()[:8]), "", requesterID)
	mustData[model.ExecutionState](t, provider.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID),
		dto.ConfirmCompletenessRequest{},
	), http.StatusOK)
	dc := mustData[model.DeliveryConfirmation](t, provider.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", request.ID),
		dto.RequestDeliveryConfirmationRequest{
			RecipientUserID: &delegateID,
			RecipientName:   "Delegated recipient",
		},
	), http.StatusCreated)
	if dc.RecipientUserID != delegateID {
		t.Fatalf("persisted recipient_user_id = %s, want delegate %s", dc.RecipientUserID, delegateID)
	}

	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true},
	), http.StatusForbidden)

	confirmed := mustData[model.DeliveryConfirmation](t, delegate.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true},
	), http.StatusOK)
	if confirmed.RespondedBy == nil || *confirmed.RespondedBy != delegateID {
		t.Fatalf("responded_by = %v, want delegate %s", confirmed.RespondedBy, delegateID)
	}
}

// TestContractDeliveryRequiresAssociateAchievementThenRequesterFinalClose
// proves the contracts-only completion rule: there is no auto-close deadline,
// the contracts associate's achievement leaves the spine delivered/open, and
// only the requester can add final notes and perform the closing transition.
func TestContractDeliveryRequiresAssociateAchievementThenRequesterFinalClose(t *testing.T) {
	t.Parallel()

	base := newLexHarness(t)
	requesterID := uuid.New()
	associateID := uuid.New()
	requester := base.withToken(base.env.mustToken(t, base.tenantID, requesterID, "legal-requester"))
	associate := base.withToken(base.env.mustToken(t, base.tenantID, associateID, "legal-advisor"))

	request := associate.newRoutedRequestFor(t, "contract_review", "CONTRACT_REVIEW", requesterID)
	mustData[model.ExecutionState](t, associate.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID),
		dto.ConfirmCompletenessRequest{},
	), http.StatusOK)
	dc := mustData[model.DeliveryConfirmation](t, associate.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", request.ID),
		dto.RequestDeliveryConfirmationRequest{RecipientName: "Contract requester"},
	), http.StatusCreated)
	if dc.AutoCloseAt != nil {
		t.Fatalf("contract auto_close_at = %v, want nil", dc.AutoCloseAt)
	}

	finalNote := "The contract is signed and the final delivery is accepted."

	// The requester cannot close the request before the contracts associate has
	// marked the legal work achieved.
	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true, Note: &finalNote},
	), http.StatusConflict)

	// A requester cannot reach the contract-edit achievement route.
	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/achieve", request.ID, dc.ID), nil,
	), http.StatusForbidden)

	achieved := mustData[model.DeliveryConfirmation](t, associate.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/achieve", request.ID, dc.ID), nil,
	), http.StatusOK)
	if achieved.Status != model.DeliveryConfirmationStatusAchieved {
		t.Fatalf("achieved confirmation status = %s, want achieved", achieved.Status)
	}
	openView := associate.executionState(t, request.ID)
	if openView.State.Status != model.ExecutionStatusDelivered || openView.State.ClosedAt != nil {
		t.Fatalf("execution after achievement = %+v, want delivered and open", openView.State)
	}
	openSpine := mustData[model.LegalRequest](t, associate.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil,
	), http.StatusOK)
	if openSpine.Status != model.RequestStatusDelivered {
		t.Fatalf("spine after achievement = %s, want delivered", openSpine.Status)
	}

	// The requester owns the final click, and contract confirmation cannot be
	// completed without a non-empty final delivery note.
	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true},
	), http.StatusUnprocessableEntity)
	confirmed := mustData[model.DeliveryConfirmation](t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", request.ID, dc.ID),
		dto.RespondDeliveryConfirmationRequest{Confirm: true, Note: &finalNote},
	), http.StatusOK)
	if confirmed.Status != model.DeliveryConfirmationStatusConfirmed || confirmed.ResponseNote == nil || *confirmed.ResponseNote != finalNote {
		t.Fatalf("requester response = status %s note %v, want confirmed with final note", confirmed.Status, confirmed.ResponseNote)
	}
	closedView := requester.executionState(t, request.ID)
	if closedView.State.Status != model.ExecutionStatusClosed || closedView.State.ClosedAt == nil {
		t.Fatalf("execution after requester final close = %+v, want closed", closedView.State)
	}
	closedSpine := mustData[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil,
	), http.StatusOK)
	if closedSpine.Status != model.RequestStatusClosed {
		t.Fatalf("spine after requester final close = %s, want closed", closedSpine.Status)
	}
}

// TestExecutionDeliveryAutoCloseAfter24WorkingHours proves the CAP-028 sweeper:
// an unanswered delivery confirmation past its working-calendar deadline is
// marked expired and the request is closed. The deadline is forced into the past
// (the harness postgres user bypasses RLS) so AutoClose acts without waiting the
// real 24 working hours.
func TestExecutionDeliveryAutoCloseAfter24WorkingHours(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("autoclose_dc_%s", uuid.NewString()[:8]), "")
	mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", request.ID), dto.ConfirmCompletenessRequest{}), http.StatusOK)
	dc := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", request.ID), dto.RequestDeliveryConfirmationRequest{
		RecipientName: "Integration Requester",
	}), http.StatusCreated)
	if dc.RecipientUserID != h.userID {
		t.Fatalf("auto-close confirmation recipient_user_id = %s, want requester %s", dc.RecipientUserID, h.userID)
	}
	if dc.AutoCloseAt == nil || !dc.AutoCloseAt.After(time.Now()) {
		t.Fatalf("expected a future auto_close_at, got %s", dc.AutoCloseAt)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Force the working-calendar deadline into the past so the row is sweepable now.
	if _, err := h.env.db.Exec(ctx,
		`UPDATE legal_request_delivery_confirmation SET auto_close_at = now() - interval '1 hour' WHERE tenant_id = $1 AND id = $2`,
		h.tenantID, dc.ID,
	); err != nil {
		t.Fatalf("force auto_close_at into the past: %v", err)
	}

	// The expired row is enumerated by the sweeper's ListExpired query...
	expired, err := h.env.app.DeliveryConfirmationService.ListExpired(ctx, h.tenantID, 50)
	if err != nil {
		t.Fatalf("list expired confirmations: %v", err)
	}
	foundExpired := false
	for i := range expired {
		if expired[i].ID == dc.ID {
			foundExpired = true
			break
		}
	}
	if !foundExpired {
		t.Fatalf("expected confirmation %s in the expired sweep set", dc.ID)
	}

	// ...and AutoClose marks it expired + closes the request.
	if err := h.env.app.DeliveryConfirmationService.AutoClose(ctx, &model.DeliveryConfirmation{ID: dc.ID, TenantID: h.tenantID}); err != nil {
		t.Fatalf("auto-close expired confirmation: %v", err)
	}

	view := h.executionState(t, request.ID)
	if view.State.Status != model.ExecutionStatusClosed {
		t.Fatalf("execution status after auto-close = %s, want %s", view.State.Status, model.ExecutionStatusClosed)
	}
	if len(view.DeliveryConfirmations) != 1 || view.DeliveryConfirmations[0].Status != model.DeliveryConfirmationStatusExpired {
		t.Fatalf("delivery confirmation status after auto-close = %+v, want a single expired row", view.DeliveryConfirmations)
	}
	spine := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", request.ID), nil), http.StatusOK)
	if spine.Status != model.RequestStatusClosed {
		t.Fatalf("spine status after auto-close = %s, want %s", spine.Status, model.RequestStatusClosed)
	}
}

// TestExecutionConcurrentConfirmCompletenessLock proves the row-lock guarantee:
// two concurrent ConfirmCompleteness calls for the same request resolve to
// exactly one started clock and one "already started" conflict — never two
// started clocks. The service is driven directly (the FOR UPDATE row lock is the
// unit under test, independent of HTTP).
func TestExecutionConcurrentConfirmCompletenessLock(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	request := h.newRoutedRequest(t, fmt.Sprintf("concurrent_%s", uuid.NewString()[:8]), "")

	// Materialise the execution state once up front so both racers contend on the
	// SAME existing state row rather than racing state creation.
	if _, err := h.env.app.ExecutionRuleService.EnsureState(context.Background(), h.tenantID, h.userID, request.ID); err != nil {
		t.Fatalf("ensure execution state: %v", err)
	}

	const racers = 2
	var (
		wg          sync.WaitGroup
		mu          sync.Mutex
		successes   int
		conflicts   int
		otherErrors []error
	)
	start := make(chan struct{})
	wg.Add(racers)
	for i := 0; i < racers; i++ {
		go func() {
			defer wg.Done()
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			state, err := h.env.app.ExecutionRuleService.ConfirmCompleteness(ctx, h.tenantID, h.userID, request.ID, dto.ConfirmCompletenessRequest{})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil && state != nil && state.ClockStartedAt != nil:
				successes++
			case err != nil && apperrors.IsConflict(err):
				conflicts++
			default:
				otherErrors = append(otherErrors, fmt.Errorf("unexpected outcome: state=%v err=%w", state, err))
			}
		}()
	}
	close(start)
	wg.Wait()

	if len(otherErrors) != 0 {
		t.Fatalf("concurrent confirm produced unexpected outcomes: %v", otherErrors)
	}
	if successes != 1 {
		t.Fatalf("concurrent confirm successes = %d, want exactly 1", successes)
	}
	if conflicts != racers-1 {
		t.Fatalf("concurrent confirm conflicts = %d, want %d", conflicts, racers-1)
	}

	// The persisted state reflects exactly one started clock.
	view := h.executionState(t, request.ID)
	if view.State.Status != model.ExecutionStatusInProgress {
		t.Fatalf("final execution status = %s, want %s", view.State.Status, model.ExecutionStatusInProgress)
	}
	if view.State.ClockStartedAt == nil {
		t.Fatal("expected a single started clock to persist")
	}
}
