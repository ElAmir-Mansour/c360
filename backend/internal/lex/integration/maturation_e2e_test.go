//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

// =============================================================================
// WS6 — end-to-end maturation chain integration coverage.
//
// These tests prove the full Rounds 1+2 runtime chain over the wired app
// (in-process eventbus + ConfirmCompleteness→SLAService.StartClock bridge +
// resolve-on-delivery + auto-route/spawn + duration-fact recorder + SLA KPI),
// rather than exercising each seam in isolation:
//
//   * no-approval submit auto-advances approved→routed AND spawns + back-links a
//     downstream subject (consultation);
//   * ConfirmCompleteness materialises an SLA clock with ack/turnaround/escalation
//     deadlines via the auto-start bridge;
//   * a confirmed delivery resolves the SLA clock to a terminal on_time/breached
//     outcome AND (via the in-process reporting consumer) writes a request_processing
//     duration fact, so the flagship SLA-compliance KPI reflects the request
//     (received>0) instead of being structurally zero;
//   * an approval-required service drives StartApproval → DecideTask(approve)
//     through every stage, and the final approval fires the same auto-route+spawn.
// =============================================================================

// seedNormalSLATarget installs an active SLA target keyed on (service_code, normal)
// so the ConfirmCompleteness → StartClock bridge can resolve a target and
// materialise the per-request clock. The execution bridge derives service_code from
// the request's metadata service_code (falling back to request_type), so callers
// pass the same code they create the request with.
func (h *lexHarness) seedNormalSLATarget(t *testing.T, serviceCode string) model.SLATarget {
	t.Helper()
	active := true
	req := dto.CreateSLATargetRequest{
		ServiceCode:           serviceCode,
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 5,
		AckWindowValue:        1,
		AckWindowUnit:         model.SLAAckUnitWorkingDays,
		Active:                &active,
		Metadata:              map[string]any{"source": "maturation-e2e"},
	}
	return mustData[model.SLATarget](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/sla/targets", req), http.StatusCreated)
}

// slaClockForRequest fetches the materialised SLA clock for a request via the
// GET /sla/requests/{requestId}/clock read endpoint.
func (h *lexHarness) slaClockForRequest(t *testing.T, requestID uuid.UUID) model.SLAClock {
	t.Helper()
	return mustData[model.SLAClock](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/sla/requests/%s/clock", requestID), nil), http.StatusOK)
}

// TestMaturationNoApprovalChainEndToEnd proves the no-approval runtime chain end
// to end: a no-approval service routes + spawns its subject on submit, the SLA
// clock auto-starts on completeness with concrete deadlines, a confirmed delivery
// resolves the clock to a terminal outcome and writes the request_processing
// duration fact, and the SLA-compliance KPI reflects the request (not a structural
// zero).
func TestMaturationNoApprovalChainEndToEnd(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	slaAdmin := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "legal-director"))
	// request_type carries a consultation routing token so Route spawns a
	// consultation and back-links it; the SLA target shares the same service_code.
	serviceCode := fmt.Sprintf("consultation_e2e_%s", uuid.NewString()[:8])
	target := slaAdmin.seedNormalSLATarget(t, serviceCode)
	if target.ID == uuid.Nil {
		t.Fatalf("seeded sla target has nil id: %+v", target)
	}

	created := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
		RequestType:   serviceCode,
		Title:         forms.LocalizedText{EN: "Maturation E2E Consultation", AR: "استشارة دورة النضج"},
		Description:   "End-to-end maturation chain fixture.",
		RequesterName: "Integration Requester",
		Priority:      model.RequestPriorityNormal,
	}), http.StatusCreated)
	if created.Status != model.RequestStatusDraft {
		t.Fatalf("created request status = %s, want %s", created.Status, model.RequestStatusDraft)
	}

	// --- submit → routed + downstream subject spawned and back-linked ---
	routed := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-requests/%s/submit", created.ID), dto.SubmitLegalRequestRequest{}), http.StatusOK)
	if routed.Status != model.RequestStatusRouted {
		t.Fatalf("submitted no-approval request status = %s, want %s (auto-route)", routed.Status, model.RequestStatusRouted)
	}
	if routed.SubjectType == nil || *routed.SubjectType != "consultation" {
		t.Fatalf("routed subject_type = %v, want consultation", routed.SubjectType)
	}
	if routed.SubjectID == nil || *routed.SubjectID == uuid.Nil {
		t.Fatalf("routed subject_id = %v, want a spawned consultation id", routed.SubjectID)
	}
	// The spawned consultation back-links to this request (closes the loop).
	consultation := mustData[model.Consultation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/consultations/%s", *routed.SubjectID), nil), http.StatusOK)
	if consultation.LegalRequestID == nil || *consultation.LegalRequestID != created.ID {
		t.Fatalf("spawned consultation legal_request_id = %v, want back-link to %s", consultation.LegalRequestID, created.ID)
	}

	// --- ConfirmCompleteness → SLA clock auto-started with deadlines ---
	state := mustData[model.ExecutionState](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/confirm-completeness", created.ID), dto.ConfirmCompletenessRequest{
		Notes: "request is complete",
	}), http.StatusOK)
	if state.Status != model.ExecutionStatusInProgress || state.ClockStartedAt == nil {
		t.Fatalf("execution state after confirm = %+v, want in_progress with a started clock", state)
	}

	clock := h.slaClockForRequest(t, created.ID)
	if clock.LegalRequestID != created.ID {
		t.Fatalf("sla clock legal_request_id = %s, want %s", clock.LegalRequestID, created.ID)
	}
	if clock.SLATargetID == nil || *clock.SLATargetID != target.ID {
		t.Fatalf("sla clock resolved target = %v, want %s", clock.SLATargetID, target.ID)
	}
	if clock.ServiceCode != serviceCode || clock.Priority != model.SLATargetPriorityNormal {
		t.Fatalf("sla clock service/priority = %s/%s, want %s/normal", clock.ServiceCode, clock.Priority, serviceCode)
	}
	// Concrete ack / turnaround / escalation deadlines materialised on auto-start.
	if !clock.AckDueAt.After(clock.ClockStartedAt) {
		t.Fatalf("ack_due_at %s must be after clock_started_at %s", clock.AckDueAt, clock.ClockStartedAt)
	}
	if !clock.TurnaroundDueAt.After(clock.AckDueAt) {
		t.Fatalf("turnaround_due_at %s must be after ack_due_at %s", clock.TurnaroundDueAt, clock.AckDueAt)
	}
	if !clock.EscalationL1DueAt.After(clock.TurnaroundDueAt) ||
		!clock.EscalationL2DueAt.After(clock.EscalationL1DueAt) ||
		!clock.EscalationL3DueAt.After(clock.EscalationL2DueAt) {
		t.Fatalf("escalation ladder not strictly increasing: l1=%s l2=%s l3=%s (turnaround=%s)",
			clock.EscalationL1DueAt, clock.EscalationL2DueAt, clock.EscalationL3DueAt, clock.TurnaroundDueAt)
	}
	if clock.Outcome != model.SLAClockOutcomePending || clock.ResolvedAt != nil {
		t.Fatalf("freshly started clock = outcome %s resolved %v, want pending/unresolved", clock.Outcome, clock.ResolvedAt)
	}

	// --- deliver (request + confirm) → clock resolved + duration fact written ---
	dc := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation", created.ID), dto.RequestDeliveryConfirmationRequest{
		RecipientName: "Integration Requester",
		Notes:         "Work delivered; please confirm.",
	}), http.StatusCreated)
	confirmed := mustData[model.DeliveryConfirmation](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/execution/delivery-confirmation/%s/respond", created.ID, dc.ID), dto.RespondDeliveryConfirmationRequest{
		Confirm: true,
	}), http.StatusOK)
	if confirmed.Status != model.DeliveryConfirmationStatusConfirmed {
		t.Fatalf("delivery confirmation status = %s, want %s", confirmed.Status, model.DeliveryConfirmationStatusConfirmed)
	}

	resolved := h.slaClockForRequest(t, created.ID)
	if resolved.ResolvedAt == nil {
		t.Fatal("expected the SLA clock to be resolved after a confirmed delivery")
	}
	if resolved.Outcome != model.SLAClockOutcomeOnTime && resolved.Outcome != model.SLAClockOutcomeBreached {
		t.Fatalf("resolved sla clock outcome = %s, want a terminal on_time/breached verdict", resolved.Outcome)
	}

	// The in-process reporting consumer wrote a request_processing duration fact for
	// this request; the flagship SLA-compliance KPI must reflect it (received>0),
	// proving the chain is not structurally zero.
	report := mustData[model.SLAComplianceReport](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/kpis/sla-compliance?quarters=12", nil), http.StatusOK)
	totalReceived := 0
	totalResolved := 0
	for _, q := range report.Quarters {
		totalReceived += q.Received
		totalResolved += q.OnTime + q.Breached
	}
	if totalReceived == 0 {
		t.Fatalf("sla-compliance KPI is structurally zero: %+v", report.Quarters)
	}
	if totalResolved == 0 {
		t.Fatalf("sla-compliance KPI recorded no resolved (on_time/breached) request: %+v", report.Quarters)
	}
}

// TestMaturationApprovalChainEndToEnd proves the approval-required runtime chain:
// a service that requires requester AND provider approval is driven through
// StartApproval → DecideTask(approve) at every stage, and the final approval fires
// the same auto-route + downstream subject spawn as the no-approval path.
func TestMaturationApprovalChainEndToEnd(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	// A litigation routing token so the final approval spawns + back-links a case.
	serviceCode := fmt.Sprintf("litigation_case_e2e_%s", uuid.NewString()[:8])

	// The no-policy approval fallback assigns each stage task to the stage role
	// ("requester"/"provider"); grant the actor both so it can decide each stage.
	// Use a distinct user so the request-author vs approver SoD guard is exercised.
	approver := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "legal-dept-manager", "requester", "provider"))

	created := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
		RequestType:           serviceCode,
		Title:                 forms.LocalizedText{EN: "Maturation E2E Litigation", AR: "تقاضي دورة النضج"},
		Description:           "End-to-end approval chain fixture.",
		RequesterName:         "Integration Requester",
		Priority:              model.RequestPriorityNormal,
		RequesterApprovalReqd: true,
		ProviderApprovalReqd:  true,
	}), http.StatusCreated)

	// Approvals required → submit now auto-opens the approval pipeline (no separate
	// POST /approval/start needed): the request lands directly on its first pending
	// stage with a workflow attached, driven by the submitter's own permission.
	submitted := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-requests/%s/submit", created.ID), dto.SubmitLegalRequestRequest{}), http.StatusOK)
	if submitted.Status != model.RequestStatusPendingRequesterApproval {
		t.Fatalf("submitted approval-required request status = %s, want %s (submit auto-starts approval)", submitted.Status, model.RequestStatusPendingRequesterApproval)
	}
	if submitted.WorkflowInstanceID == nil {
		t.Fatal("submit did not auto-start the approval workflow")
	}

	// --- StartApproval is idempotent: an explicit start on the already-open
	// requester stage returns the current pending state rather than conflicting ---
	pending := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/requests/%s/approval/start", created.ID), nil), http.StatusOK)
	if pending.Status != model.RequestStatusPendingRequesterApproval {
		t.Fatalf("status after idempotent StartApproval = %s, want %s", pending.Status, model.RequestStatusPendingRequesterApproval)
	}
	if pending.WorkflowInstanceID == nil {
		t.Fatal("StartApproval did not retain a workflow instance on the request")
	}

	// --- DecideTask(approve) through the requester stage ---
	requesterTask := h.singleOpenApprovalTask(t, created.ID)
	h.decideApprovalTask(t, approver, created.ID, requesterTask)
	afterRequester := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", created.ID), nil), http.StatusOK)
	if afterRequester.Status != model.RequestStatusPendingProviderApproval {
		t.Fatalf("status after requester approval = %s, want %s (provider stage auto-start)", afterRequester.Status, model.RequestStatusPendingProviderApproval)
	}

	// --- DecideTask(approve) through the provider stage → final approval ---
	providerTask := h.singleOpenApprovalTask(t, created.ID)
	if providerTask.ID == requesterTask.ID {
		t.Fatalf("provider stage task %s must differ from the requester task", providerTask.ID)
	}
	h.decideApprovalTask(t, approver, created.ID, providerTask)

	// Final approval fired the auto-route + spawn: the request is routed and a case
	// was spawned + back-linked.
	final := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", created.ID), nil), http.StatusOK)
	if final.Status != model.RequestStatusRouted {
		t.Fatalf("status after final approval = %s, want %s (auto-route on approval)", final.Status, model.RequestStatusRouted)
	}
	if final.SubjectType == nil || *final.SubjectType != "legal_case" {
		t.Fatalf("routed subject_type = %v, want legal_case", final.SubjectType)
	}
	if final.SubjectID == nil || *final.SubjectID == uuid.Nil {
		t.Fatalf("routed subject_id = %v, want a spawned case id", final.SubjectID)
	}
	spawnedCase := mustData[model.LegalCase](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s", *final.SubjectID), nil), http.StatusOK)
	if spawnedCase.RequestID == nil || *spawnedCase.RequestID != created.ID {
		t.Fatalf("spawned case request_id = %v, want back-link to %s", spawnedCase.RequestID, created.ID)
	}
}

// singleOpenApprovalTask returns the single open approver task for a request's
// current workflow stage, failing if there is not exactly one.
func (h *lexHarness) singleOpenApprovalTask(t *testing.T, requestID uuid.UUID) *workflowmodel.HumanTask {
	t.Helper()
	tasks := mustData[[]*workflowmodel.HumanTask](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/requests/%s/approval/tasks", requestID), nil), http.StatusOK)
	if len(tasks) != 1 {
		t.Fatalf("open approval tasks = %d, want exactly 1: %+v", len(tasks), tasks)
	}
	return tasks[0]
}

// decideApprovalTask records an approve decision on a request's approval task via
// the orchestrated decision endpoint.
func (h *lexHarness) decideApprovalTask(t *testing.T, actor *lexHarness, requestID uuid.UUID, task *workflowmodel.HumanTask) {
	t.Helper()
	mustData[maturationDecisionOutcome](t, actor.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/requests/%s/approval/%s/tasks/%s/decision", requestID, task.InstanceID, task.ID),
		dto.WorkflowDecisionRequest{Decision: "approve"},
	), http.StatusOK)
}

// maturationDecisionOutcome is the decode target for the orchestrated approval
// decision response. Only the fields asserted on the flow are read; the rest of
// the rich outcome is ignored so the test stays decoupled from its full shape.
type maturationDecisionOutcome struct {
	Status         string `json:"status"`
	WorkflowStatus string `json:"workflow_status"`
	TaskStatus     string `json:"task_status"`
}
