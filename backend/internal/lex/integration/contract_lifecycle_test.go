//go:build integration

package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	lexconsumer "github.com/clario360/platform/internal/lex/consumer"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestContractFullLifecycle(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Managed Services Lifecycle", model.ContractTypeServiceAgreement, 1_250_000, lifecycleContractText())
	if contract.Status != model.ContractStatusDraft {
		t.Fatalf("created contract status = %s, want %s", contract.Status, model.ContractStatusDraft)
	}

	revisedText := lifecycleContractText() + "\n\n" + clauseSection(11, "Assignment", "Neither party may assign this agreement without prior written consent except for internal reorganizations.")
	uploadedVersions := h.uploadContractDocument(t, contract.ID, "managed-services-lifecycle-v2.txt", revisedText, "Updated negotiation draft.")
	if len(uploadedVersions) != 2 {
		t.Fatalf("uploaded versions = %d, want 2", len(uploadedVersions))
	}
	if uploadedVersions[0].Version != 2 {
		t.Fatalf("latest version after upload = %d, want 2", uploadedVersions[0].Version)
	}

	result := h.analyzeContract(t, contract.ID)
	if result.Analysis == nil {
		t.Fatal("expected analysis payload")
	}
	if len(result.Clauses) < 10 {
		t.Fatalf("analysis clauses = %d, want at least 10", len(result.Clauses))
	}

	workflow := h.startReview(t, contract.ID, "Internal legal review for lifecycle coverage.")
	if workflow.ContractStatus != model.ContractStatusInternalReview {
		t.Fatalf("workflow contract status = %s, want %s", workflow.ContractStatus, model.ContractStatusInternalReview)
	}

	workflows := mustPaginated[model.LegalWorkflowSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflows?page=1&per_page=10", nil), http.StatusOK)
	if workflows.Pagination.Total == 0 {
		t.Fatal("expected at least one active workflow")
	}
	foundWorkflow := false
	for _, item := range workflows.Data {
		if item.ContractID == contract.ID {
			foundWorkflow = true
			break
		}
	}
	if !foundWorkflow {
		t.Fatalf("workflow for contract %s not found in %+v", contract.ID, workflows.Data)
	}

	completedEvent, err := events.NewEvent("workflow.instance.completed", "workflow-engine", h.tenantID.String(), map[string]string{
		"instance_id": workflow.WorkflowInstanceID.String(),
	})
	if err != nil {
		t.Fatalf("build workflow completion event: %v", err)
	}
	consumer := lexconsumer.NewLexConsumer(nil, h.env.app.WorkflowService, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), completedEvent); err != nil {
		t.Fatalf("handle workflow completion: %v", err)
	}
	contract = *mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if contract.Status != model.ContractStatusPendingSignature {
		t.Fatalf("contract status after workflow completion = %s, want %s", contract.Status, model.ContractStatusPendingSignature)
	}

	signerName := "Lifecycle Signer"
	signerEmail := "lifecycle.signer@example.test"
	envelope := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/signatures", dto.CreateSignatureEnvelopeRequest{
		ContractID: &contract.ID,
		Title:      "Lifecycle signature pack",
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		Recipients: []dto.CreateSignatureRecipientRequest{{
			Name:         signerName,
			Email:        &signerEmail,
			Role:         model.SignatureRecipientSigner,
			SigningOrder: 1,
		}},
	}), http.StatusCreated)
	mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/send", envelope.ID), dto.SendSignatureEnvelopeRequest{}), http.StatusOK)
	mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/recipients/%s/actions", envelope.ID, envelope.Recipients[0].ID), dto.SignatureRecipientActionRequest{
		Action:     dto.SignatureRecipientActionSign,
		ActorName:  &signerName,
		ActorEmail: &signerEmail,
	}), http.StatusOK)
	contract = *mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if contract.Status != model.ContractStatusActive {
		t.Fatalf("final contract status = %s, want %s", contract.Status, model.ContractStatusActive)
	}

	analysis := mustData[model.ContractRiskAnalysis](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/analysis", contract.ID), nil), http.StatusOK)
	if analysis.ClauseCount != len(result.Clauses) {
		t.Fatalf("analysis clause count = %d, want %d", analysis.ClauseCount, len(result.Clauses))
	}

	detail := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK)
	if detail.Contract.Status != model.ContractStatusActive {
		t.Fatalf("detail status = %s, want %s", detail.Contract.Status, model.ContractStatusActive)
	}
	if detail.VersionCount != 2 {
		t.Fatalf("detail version count = %d, want 2", detail.VersionCount)
	}
	if detail.LatestAnalysis == nil {
		t.Fatal("expected latest analysis in contract detail")
	}
	if len(detail.Clauses) != len(result.Clauses) {
		t.Fatalf("detail clauses = %d, want %d", len(detail.Clauses), len(result.Clauses))
	}

	versions := mustData[[]model.ContractVersion](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/versions", contract.ID), nil), http.StatusOK)
	if len(versions) != 2 {
		t.Fatalf("listed versions = %d, want 2", len(versions))
	}
}

func TestContractWorkflowDecisionApproveAdvancesContract(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Workflow Approval Contract", model.ContractTypeServiceAgreement, 125_000, lifecycleContractText())
	workflow := h.startReview(t, contract.ID, "Approve through Lex workflow decision endpoint.")
	if workflow.TaskID == nil {
		t.Fatal("start review did not return task_id")
	}

	approver := h.contractApprover(t)
	notes := "Approved for legal review."
	result := mustData[model.LegalWorkflowDecisionResult](t, approver.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    &notes,
		Metadata: map[string]any{"control": "WTQ-004"},
	}), http.StatusOK)

	if result.ContractStatus != model.ContractStatusPendingSignature {
		t.Fatalf("decision contract status = %s, want %s", result.ContractStatus, model.ContractStatusPendingSignature)
	}
	if result.WorkflowStatus != "completed" {
		t.Fatalf("workflow status = %s, want completed", result.WorkflowStatus)
	}
	if result.TaskStatus != "completed" {
		t.Fatalf("task status = %s, want completed", result.TaskStatus)
	}

	contract = *mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if contract.Status != model.ContractStatusPendingSignature {
		t.Fatalf("contract status after decision = %s, want %s", contract.Status, model.ContractStatusPendingSignature)
	}

	var workflowStatus, taskStatus string
	var formData map[string]any
	var taskMetadata map[string]any
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.env.db.QueryRow(ctx, `
		SELECT wi.status, wt.status, wt.form_data, wt.metadata
		FROM workflow_instances wi
		JOIN workflow_tasks wt ON wt.instance_id = wi.id
		WHERE wi.id = $1 AND wt.id = $2`,
		workflow.WorkflowInstanceID, *workflow.TaskID,
	).Scan(&workflowStatus, &taskStatus, &formData, &taskMetadata); err != nil {
		t.Fatalf("load workflow evidence: %v", err)
	}
	if workflowStatus != "completed" || taskStatus != "completed" {
		t.Fatalf("stored workflow/task statuses = %s/%s, want completed/completed", workflowStatus, taskStatus)
	}
	if formData["decision"] != "approve" {
		t.Fatalf("form_data decision = %v, want approve in %+v", formData["decision"], formData)
	}
	if taskMetadata["decision"] != "approve" || taskMetadata["contract_status"] != string(model.ContractStatusPendingSignature) {
		t.Fatalf("task metadata missing decision evidence: %+v", taskMetadata)
	}

	// The approval result must be immediately signable: no manual legal_review ->
	// negotiation -> pending_signature clicks are allowed in this demo path.
	signerName := "Lifecycle Manager"
	signerEmail := "lifecycle.manager@example.test"
	envelope := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/signatures", dto.CreateSignatureEnvelopeRequest{
		ContractID: &contract.ID,
		Title:      "Approved contract signature pack",
		Subject:    "Manager-approved contract",
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		Recipients: []dto.CreateSignatureRecipientRequest{{
			Name:         signerName,
			Email:        &signerEmail,
			Role:         model.SignatureRecipientSigner,
			SigningOrder: 1,
		}},
	}), http.StatusCreated)
	if len(envelope.Recipients) != 1 {
		t.Fatalf("signature recipients = %d, want 1", len(envelope.Recipients))
	}
	sent := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/send", envelope.ID), dto.SendSignatureEnvelopeRequest{}), http.StatusOK)
	if sent.Status != model.SignatureEnvelopeSent {
		t.Fatalf("signature status after immediate send = %s, want sent", sent.Status)
	}
	signed := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/recipients/%s/actions", envelope.ID, envelope.Recipients[0].ID), dto.SignatureRecipientActionRequest{
		Action:     dto.SignatureRecipientActionSign,
		ActorName:  &signerName,
		ActorEmail: &signerEmail,
	}), http.StatusOK)
	if signed.Status != model.SignatureEnvelopeSigned {
		t.Fatalf("signature status after manager sign = %s, want signed", signed.Status)
	}
	contract = *mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if contract.Status != model.ContractStatusActive || contract.SignedDate == nil {
		t.Fatalf("signed contract = status %s signed_date %v, want active with signed date", contract.Status, contract.SignedDate)
	}
}

func TestContractGenericStatusCannotBypassLinkedReview(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Workflow Authority Guard Contract", model.ContractTypeServiceAgreement, 75_000, lifecycleContractText())
	workflow := h.startReview(t, contract.ID, "The linked workflow must own the review status.")
	if workflow.TaskID == nil {
		t.Fatal("start review did not return task_id")
	}

	approver := h.contractApprover(t)
	for _, status := range []model.ContractStatus{
		model.ContractStatusPendingSignature,
		model.ContractStatusLegalReview,
	} {
		mustError(t, approver.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
			Status: status,
		}), http.StatusConflict)
	}

	stored := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if stored.Status != model.ContractStatusInternalReview {
		t.Fatalf("contract status after bypass attempts = %s, want %s", stored.Status, model.ContractStatusInternalReview)
	}
	if stored.WorkflowInstanceID == nil || *stored.WorkflowInstanceID != workflow.WorkflowInstanceID {
		t.Fatalf("contract workflow link after bypass attempts = %v, want %s", stored.WorkflowInstanceID, workflow.WorkflowInstanceID)
	}
}

func TestContractGenericStatusCannotManufactureSignature(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Signature Evidence Guard Contract", model.ContractTypeServiceAgreement, 90_000, lifecycleContractText())
	approver := h.contractApprover(t)
	for _, status := range []model.ContractStatus{
		model.ContractStatusInternalReview,
		model.ContractStatusLegalReview,
		model.ContractStatusNegotiation,
		model.ContractStatusPendingSignature,
	} {
		mustData[model.Contract](t, approver.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
			Status: status,
		}), http.StatusOK)
	}

	mustError(t, approver.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
		Status: model.ContractStatusActive,
	}), http.StatusUnprocessableEntity)

	stored := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if stored.Status != model.ContractStatusPendingSignature || stored.SignedDate != nil {
		t.Fatalf("contract after generic activation attempt = status %s signed_date %v, want pending_signature with no signed date", stored.Status, stored.SignedDate)
	}
}

func TestLateSignatureCannotReactivateCancelledContract(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Late Signature Guard Contract", model.ContractTypeNDA, 15_000, lifecycleContractText())
	approver := h.contractApprover(t)
	for _, status := range []model.ContractStatus{
		model.ContractStatusInternalReview,
		model.ContractStatusLegalReview,
		model.ContractStatusNegotiation,
		model.ContractStatusPendingSignature,
	} {
		mustData[model.Contract](t, approver.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
			Status: status,
		}), http.StatusOK)
	}

	signerName := "Late Signer"
	signerEmail := "late.signer@example.test"
	envelope := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/signatures", dto.CreateSignatureEnvelopeRequest{
		ContractID: &contract.ID,
		Title:      "Late signature guard envelope",
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		Recipients: []dto.CreateSignatureRecipientRequest{{
			Name:         signerName,
			Email:        &signerEmail,
			Role:         model.SignatureRecipientSigner,
			SigningOrder: 1,
		}},
	}), http.StatusCreated)
	mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/send", envelope.ID), dto.SendSignatureEnvelopeRequest{}), http.StatusOK)
	mustData[model.Contract](t, approver.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
		Status: model.ContractStatusCancelled,
	}), http.StatusOK)

	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/signatures/%s/recipients/%s/actions", envelope.ID, envelope.Recipients[0].ID), dto.SignatureRecipientActionRequest{
		Action:     dto.SignatureRecipientActionSign,
		ActorName:  &signerName,
		ActorEmail: &signerEmail,
	}), http.StatusConflict)

	stored := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK).Contract
	if stored.Status != model.ContractStatusCancelled || stored.SignedDate != nil {
		t.Fatalf("contract after late signature = status %s signed_date %v, want cancelled with no signed date", stored.Status, stored.SignedDate)
	}
	storedEnvelope := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/signatures/%s", envelope.ID), nil), http.StatusOK)
	if storedEnvelope.Status != model.SignatureEnvelopeSent || storedEnvelope.Recipients[0].Status != model.SignatureRecipientSent {
		t.Fatalf("late signature transaction was not rolled back: envelope %s recipient %s", storedEnvelope.Status, storedEnvelope.Recipients[0].Status)
	}
}

func TestContractReviewChangeAndRejectOutcomesCanBeResubmitted(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Resubmittable Review Contract", model.ContractTypeNDA, 25_000, lifecycleContractText())
	approver := h.contractApprover(t)

	requestChangesWorkflow := h.startReview(t, contract.ID, "First review requests author changes.")
	if requestChangesWorkflow.TaskID == nil {
		t.Fatal("request-changes review did not return task_id")
	}
	requestChanges := mustData[model.LegalWorkflowDecisionResult](t, approver.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", requestChangesWorkflow.WorkflowInstanceID, *requestChangesWorkflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "request_changes",
	}), http.StatusOK)
	if requestChanges.ContractStatus != model.ContractStatusDraft || requestChanges.WorkflowStatus != "completed" || requestChanges.TaskStatus != "completed" {
		t.Fatalf("request_changes result = contract %s workflow %s task %s, want draft/completed/completed", requestChanges.ContractStatus, requestChanges.WorkflowStatus, requestChanges.TaskStatus)
	}
	assertTerminalContractReviewAudit(t, h, contract.ID, requestChangesWorkflow.WorkflowInstanceID, *requestChangesWorkflow.TaskID, "completed", "completed", "request_changes")

	rejectWorkflow := h.startReview(t, contract.ID, "Second review records a rejection.")
	if rejectWorkflow.TaskID == nil {
		t.Fatal("reject review did not return task_id")
	}
	if rejectWorkflow.WorkflowInstanceID == requestChangesWorkflow.WorkflowInstanceID {
		t.Fatal("resubmission reused the completed request-changes workflow")
	}
	rejected := mustData[model.LegalWorkflowDecisionResult](t, approver.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", rejectWorkflow.WorkflowInstanceID, *rejectWorkflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "reject",
	}), http.StatusOK)
	if rejected.ContractStatus != model.ContractStatusDraft || rejected.WorkflowStatus != "failed" || rejected.TaskStatus != "rejected" {
		t.Fatalf("reject result = contract %s workflow %s task %s, want draft/failed/rejected", rejected.ContractStatus, rejected.WorkflowStatus, rejected.TaskStatus)
	}
	assertTerminalContractReviewAudit(t, h, contract.ID, rejectWorkflow.WorkflowInstanceID, *rejectWorkflow.TaskID, "failed", "rejected", "reject")

	resubmitted := h.startReview(t, contract.ID, "Third review proves rejection is resubmittable.")
	if resubmitted.WorkflowInstanceID == requestChangesWorkflow.WorkflowInstanceID || resubmitted.WorkflowInstanceID == rejectWorkflow.WorkflowInstanceID {
		t.Fatalf("resubmission workflow %s reused terminal workflow history", resubmitted.WorkflowInstanceID)
	}
}

func assertTerminalContractReviewAudit(
	t *testing.T,
	h *lexHarness,
	contractID, workflowID, taskID uuid.UUID,
	wantWorkflowStatus, wantTaskStatus, wantDecision string,
) {
	t.Helper()

	stored := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contractID), nil), http.StatusOK).Contract
	if stored.Status != model.ContractStatusDraft || stored.WorkflowInstanceID != nil {
		t.Fatalf("terminal review contract = status %s workflow %v, want draft with no active workflow link", stored.Status, stored.WorkflowInstanceID)
	}

	var workflowStatus, taskStatus string
	var formData, taskMetadata map[string]any
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.env.db.QueryRow(ctx, `
		SELECT wi.status, wt.status, wt.form_data, wt.metadata
		FROM workflow_instances wi
		JOIN workflow_tasks wt ON wt.instance_id = wi.id
		WHERE wi.id = $1 AND wt.id = $2`, workflowID, taskID,
	).Scan(&workflowStatus, &taskStatus, &formData, &taskMetadata); err != nil {
		t.Fatalf("load retained terminal workflow audit: %v", err)
	}
	if workflowStatus != wantWorkflowStatus || taskStatus != wantTaskStatus {
		t.Fatalf("retained workflow/task statuses = %s/%s, want %s/%s", workflowStatus, taskStatus, wantWorkflowStatus, wantTaskStatus)
	}
	if formData["decision"] != wantDecision || formData["contract_workflow_link_released"] != true {
		t.Fatalf("retained form data missing terminal decision/link evidence: %+v", formData)
	}
	if taskMetadata["decision"] != wantDecision || taskMetadata["contract_workflow_link_released"] != true {
		t.Fatalf("retained task metadata missing terminal decision/link evidence: %+v", taskMetadata)
	}
}

func TestContractWorkflowDecisionRejectsWrongTenantAndAlreadyDecided(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Workflow Decision Guard Contract", model.ContractTypeNDA, 10_000, lifecycleContractText())
	workflow := h.startReview(t, contract.ID, "Guard tenant and duplicate decisions.")
	if workflow.TaskID == nil {
		t.Fatal("start review did not return task_id")
	}

	otherTenantToken := h.env.mustToken(t, uuid.New(), h.userID, "tenant_admin", "legal-contracts-manager")
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, h.env.server.URL+fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), strings.NewReader(`{"decision":"approve"}`))
	if err != nil {
		t.Fatalf("build wrong-tenant request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+otherTenantToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("wrong-tenant decision request: %v", err)
	}
	mustError(t, resp, http.StatusNotFound)

	approver := h.contractApprover(t)
	mustData[model.LegalWorkflowDecisionResult](t, approver.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
	}), http.StatusOK)

	mustError(t, approver.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
	}), http.StatusConflict)
}

func TestContractAnalysis(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Targeted Analysis Contract", model.ContractTypeServiceAgreement, 2_400_000, targetedAnalysisText())
	result := h.analyzeContract(t, contract.ID)

	if result.Analysis == nil {
		t.Fatal("expected analysis result")
	}
	if result.Analysis.RiskScore <= 55 {
		t.Fatalf("risk score = %.2f, want > 55", result.Analysis.RiskScore)
	}
	if len(result.Analysis.Recommendations) == 0 {
		t.Fatal("expected recommendations in analysis result")
	}

	foundHighValueFlag := false
	for _, flag := range result.Analysis.ComplianceFlags {
		if flag.Code == "high_value_without_insurance" {
			foundHighValueFlag = true
			break
		}
	}
	if !foundHighValueFlag {
		t.Fatalf("expected high_value_without_insurance flag in %+v", result.Analysis.ComplianceFlags)
	}

	foundCriticalLimitation := false
	for _, clause := range result.Clauses {
		if clause.ClauseType == model.ClauseTypeLimitationOfLiability && clause.RiskLevel == model.RiskLevelCritical {
			foundCriticalLimitation = true
			if len(clause.Recommendations) == 0 {
				t.Fatal("expected limitation clause recommendations")
			}
			if clause.SectionReference == "" {
				t.Fatal("expected limitation clause section reference")
			}
		}
	}
	if !foundCriticalLimitation {
		t.Fatalf("expected critical limitation_of_liability clause in %+v", result.Clauses)
	}

	clauses := mustData[[]model.Clause](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses", contract.ID), nil), http.StatusOK)
	if len(clauses) < 4 {
		t.Fatalf("persisted clauses = %d, want at least 4", len(clauses))
	}
}

func TestContractRenewal(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	original := createActiveContractForMonitor(t, h, "Renewal Coverage Contract", time.Now().UTC().Add(20*24*time.Hour), false)
	newValue := 375000.0
	newExpiry := time.Now().UTC().AddDate(1, 0, 0)

	renewed := mustData[model.Contract](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/renew", original.ID), dto.RenewContractRequest{
		NewExpiryDate: newExpiry,
		NewValue:      &newValue,
		ChangeSummary: "Renewed for an additional annual term.",
	}), http.StatusCreated)

	if renewed.Status != model.ContractStatusDraft {
		t.Fatalf("renewed contract status = %s, want %s", renewed.Status, model.ContractStatusDraft)
	}
	if renewed.ParentContractID == nil || *renewed.ParentContractID != original.ID {
		t.Fatalf("renewed parent contract id = %v, want %s", renewed.ParentContractID, original.ID)
	}
	if !strings.Contains(renewed.Title, "(Renewal)") {
		t.Fatalf("renewed title = %q, want renewal suffix", renewed.Title)
	}
	if renewed.TotalValue == nil || *renewed.TotalValue != newValue {
		t.Fatalf("renewed total value = %v, want %.2f", renewed.TotalValue, newValue)
	}

	versions := mustData[[]model.ContractVersion](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/versions", renewed.ID), nil), http.StatusOK)
	if len(versions) != 1 {
		t.Fatalf("renewed contract versions = %d, want 1", len(versions))
	}

	updatedOriginal := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", original.ID), nil), http.StatusOK)
	if updatedOriginal.Contract.Status != model.ContractStatusRenewed {
		t.Fatalf("original contract status = %s, want %s", updatedOriginal.Contract.Status, model.ContractStatusRenewed)
	}
}

func TestContractSearch(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	created := make(map[string]struct{}, 5)
	for idx := 0; idx < 5; idx++ {
		title := fmt.Sprintf("Vendor Search Contract %d", idx+1)
		contract := h.createContract(t, h.baseContractRequest(title, model.ContractTypeVendor, 120000+float64(idx*1000), ""))
		created[contract.ID.String()] = struct{}{}
	}

	search := mustPaginated[model.ContractSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/contracts/search?q=vendor&page=1&per_page=10", nil), http.StatusOK)
	if search.Pagination.Total < 5 {
		t.Fatalf("search total = %d, want at least 5", search.Pagination.Total)
	}

	found := 0
	for _, item := range search.Data {
		if _, ok := created[item.ID.String()]; ok {
			found++
		}
	}
	if found != 5 {
		t.Fatalf("found created search contracts = %d, want 5 in %+v", found, search.Data)
	}
}

func TestAnalysis_Under3s(t *testing.T) {
	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Performance Analysis Contract", model.ContractTypeServiceAgreement, 4_500_000, largeContractText())

	startedAt := time.Now()
	result := h.analyzeContract(t, contract.ID)
	elapsed := time.Since(startedAt)

	limit := 3 * time.Second
	if raceEnabled {
		limit = 6 * time.Second
	}
	if elapsed >= limit {
		t.Fatalf("analysis duration = %s, want < %s", elapsed, limit)
	}
	if result.Analysis == nil {
		t.Fatal("expected analysis result")
	}
	if len(result.Clauses) == 0 {
		t.Fatal("expected extracted clauses from large contract text")
	}
}
