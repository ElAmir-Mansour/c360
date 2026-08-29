//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

func TestWatheeqWorkflowApprovalPolicyFormsAuthorityAndOutOfOffice(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq DoA Approval Contract", model.ContractTypeServiceAgreement, 500_000, lifecycleContractText())
	approverID := uuid.New()
	delegateID := uuid.New()
	requiredAmount := 500_000.0
	requireEvidence := true
	start := time.Now().UTC().Add(-1 * time.Hour)
	end := start.Add(24 * time.Hour)

	workflow := mustData[model.LegalWorkflowSummary](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/review", contract.ID), dto.ReviewContractRequest{
		ApproverUserID: &approverID,
		ApproverRole:   ptrStringTest("legal_approver"),
		Description:    "Watheeq approval route with DoA, form, and out-of-office coverage.",
		SLAHours:       24,
		ApprovalPolicy: &dto.ApprovalPolicyRequest{
			PolicyID:                 "DOA-KSA-LEGAL-001",
			Name:                     "Saudi contract approval matrix",
			RequiredRole:             "finance_director",
			RequiredAuthorityAmount:  &requiredAmount,
			Currency:                 "SAR",
			RequireAuthorityEvidence: &requireEvidence,
		},
		FormFields: []dto.ApprovalFormFieldRequest{
			{Name: "business_justification", Type: "textarea", Label: "Business justification", Required: true},
			{Name: "risk_acceptance", Type: "boolean", Label: "Risk accepted", Required: true},
		},
		OutOfOffice: &dto.OutOfOfficeDelegationInput{
			Active:                 true,
			OriginalApproverUserID: &approverID,
			DelegatedTo:            &delegateID,
			Reason:                 "Approver is out of office during the SLA window.",
			EvidenceID:             "OOO-CALENDAR-123",
			StartsAt:               &start,
			EndsAt:                 &end,
		},
	}), http.StatusAccepted)
	if workflow.TaskID == nil {
		t.Fatal("start review did not return task_id")
	}
	if workflow.ApprovalPolicy["required_role"] != "finance_director" {
		t.Fatalf("approval policy = %+v, want required_role finance_director", workflow.ApprovalPolicy)
	}
	if workflow.Delegation["delegated_to"] != delegateID.String() {
		t.Fatalf("delegation = %+v, want delegated_to %s", workflow.Delegation, delegateID)
	}
	listed := mustPaginated[model.LegalWorkflowSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflows", nil), http.StatusOK)
	if len(listed.Data) == 0 {
		t.Fatal("list workflows returned no active workflow")
	}
	if listed.Data[0].ApprovalPolicy["required_role"] != "finance_director" {
		t.Fatalf("listed approval policy = %+v, want required_role finance_director", listed.Data[0].ApprovalPolicy)
	}
	if listed.Data[0].Delegation["delegated_to"] != delegateID.String() {
		t.Fatalf("listed delegation = %+v, want delegated_to %s", listed.Data[0].Delegation, delegateID)
	}

	var assigneeID string
	var rawSchema []byte
	var rawMetadata []byte
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.env.db.QueryRow(ctx, `
		SELECT assignee_id::text, form_schema, metadata
		FROM workflow_tasks
		WHERE id = $1 AND tenant_id = $2`,
		*workflow.TaskID, h.tenantID,
	).Scan(&assigneeID, &rawSchema, &rawMetadata); err != nil {
		t.Fatalf("load Watheeq workflow task: %v", err)
	}
	if assigneeID != delegateID.String() {
		t.Fatalf("task assignee_id = %s, want delegated assignee %s", assigneeID, delegateID)
	}

	var formSchema []workflowmodel.FormField
	if err := json.Unmarshal(rawSchema, &formSchema); err != nil {
		t.Fatalf("decode form schema: %v", err)
	}
	requiredFields := map[string]bool{}
	for _, field := range formSchema {
		if field.Required {
			requiredFields[field.Name] = true
		}
	}
	for _, name := range []string{"decision", "authority_role", "authority_amount", "authority_currency", "authority_evidence_ref", "business_justification", "risk_acceptance"} {
		if !requiredFields[name] {
			t.Fatalf("required form field %q missing from schema %+v", name, formSchema)
		}
	}

	var taskMetadata map[string]any
	if err := json.Unmarshal(rawMetadata, &taskMetadata); err != nil {
		t.Fatalf("decode task metadata: %v", err)
	}
	if taskMetadata["source"] != "watheeq_contract_review" {
		t.Fatalf("task metadata source = %v, want watheeq_contract_review", taskMetadata["source"])
	}
	policyMetadata, ok := taskMetadata["approval_policy"].(map[string]any)
	if !ok || policyMetadata["required_role"] != "finance_director" {
		t.Fatalf("task approval policy metadata = %+v", taskMetadata["approval_policy"])
	}
	delegationMetadata, ok := taskMetadata["delegation"].(map[string]any)
	if !ok || delegationMetadata["delegated_to"] != delegateID.String() || delegationMetadata["evidence_id"] != "OOO-CALENDAR-123" {
		t.Fatalf("task delegation metadata = %+v", taskMetadata["delegation"])
	}

	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"business_justification": "Critical managed-services renewal.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        "DOA-KSA-LEGAL-001",
			Role:            "finance_director",
			AuthorityAmount: 750_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-BOARD-MINUTES-001",
			Source:          "authority_matrix",
		},
	}), http.StatusForbidden)

	delegatedApprover := h.withToken(h.env.mustToken(t, h.tenantID, delegateID, "tenant_admin", "legal_approver", "legal-contracts-manager"))

	mustError(t, delegatedApprover.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"risk_acceptance": true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        "DOA-KSA-LEGAL-001",
			Role:            "finance_director",
			AuthorityAmount: 500_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-BOARD-MINUTES-001",
			Source:          "authority_matrix",
		},
	}), http.StatusUnprocessableEntity)

	mustError(t, delegatedApprover.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"business_justification": "Critical managed-services renewal.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        "DOA-KSA-LEGAL-001",
			Role:            "finance_director",
			AuthorityAmount: 100_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-BOARD-MINUTES-001",
			Source:          "authority_matrix",
		},
	}), http.StatusUnprocessableEntity)

	notes := "Approved with Watheeq DoA evidence."
	result := mustData[model.LegalWorkflowDecisionResult](t, delegatedApprover.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, *workflow.TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    &notes,
		FormData: map[string]any{
			"business_justification": "Critical managed-services renewal.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        "DOA-KSA-LEGAL-001",
			Role:            "finance_director",
			AuthorityAmount: 750_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-BOARD-MINUTES-001",
			Source:          "authority_matrix",
		},
	}), http.StatusOK)
	if result.ContractStatus != model.ContractStatusPendingSignature {
		t.Fatalf("decision contract status = %s, want %s", result.ContractStatus, model.ContractStatusPendingSignature)
	}
	if result.AuthorityEvidence["authority_amount"] != float64(750_000) || result.AuthorityEvidence["evidence_id"] != "DOA-BOARD-MINUTES-001" {
		t.Fatalf("authority evidence response = %+v", result.AuthorityEvidence)
	}

	var rawFormData []byte
	if err := h.env.db.QueryRow(ctx, `
		SELECT form_data
		FROM workflow_tasks
		WHERE id = $1 AND tenant_id = $2`,
		*workflow.TaskID, h.tenantID,
	).Scan(&rawFormData); err != nil {
		t.Fatalf("load Watheeq workflow decision form data: %v", err)
	}
	var formData map[string]any
	if err := json.Unmarshal(rawFormData, &formData); err != nil {
		t.Fatalf("decode decision form data: %v", err)
	}
	if formData["business_justification"] != "Critical managed-services renewal." || formData["authority_evidence_ref"] != "DOA-BOARD-MINUTES-001" {
		t.Fatalf("stored decision form data missing Watheeq evidence: %+v", formData)
	}
}

func TestWatheeqWorkflowPersistedApprovalPolicyRoutesAndReview(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contractType := model.ContractTypeServiceAgreement
	department := "Legal Operations"
	requiredRole := "finance_director"
	requiredAmount := 250_000.0
	requireEvidence := true
	quorumN := 2
	approverOne := uuid.New()
	approverTwo := uuid.New()

	policy := mustData[model.ApprovalPolicy](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/workflow-policies/approval", dto.CreateApprovalPolicyRequest{
		Name:        "Draft service agreement approvals",
		Description: "Draft approval matrix before lifecycle update.",
		Status:      model.ApprovalPolicyStatusDraft,
		Priority:    10,
		Currency:    "SAR",
		Mode:        "sequential",
		Quorum:      "all",
		Approvers: []dto.ApprovalPolicyApprover{
			{Type: "role", Ref: "legal_approver", Label: "Legal approver"},
		},
		Metadata: map[string]any{"source": "integration-draft"},
	}), http.StatusCreated)
	if policy.ID == uuid.Nil {
		t.Fatalf("created approval policy has nil id: %+v", policy)
	}

	updatedName := "Service agreement DoA approvals"
	updatedDescription := "Approval matrix for service agreements."
	activeStatus := model.ApprovalPolicyStatusActive
	priority := 50
	currency := "SAR"
	mode := "parallel"
	quorum := "n_of_m"
	policy = mustData[model.ApprovalPolicy](t, h.doJSON(t, http.MethodPatch, fmt.Sprintf("/api/v1/lex/workflow-policies/approval/%s", policy.ID), dto.UpdateApprovalPolicyRequest{
		Name:         &updatedName,
		Description:  &updatedDescription,
		Status:       &activeStatus,
		Priority:     &priority,
		ContractType: &contractType,
		Department:   &department,
		Currency:     &currency,
		Mode:         &mode,
		Quorum:       &quorum,
		QuorumN:      &quorumN,
		Approvers: []dto.ApprovalPolicyApprover{
			{Type: "user", Ref: approverOne.String(), Label: "Finance Director"},
			{Type: "user", Ref: approverTwo.String(), Label: "Legal Director"},
		},
		FormFields: []dto.ApprovalFormFieldRequest{
			{Name: "business_justification", Type: "textarea", Label: "Business justification", Required: true},
			{Name: "risk_acceptance", Type: "boolean", Label: "Risk accepted", Required: true},
		},
		RequireAuthorityEvidence: &requireEvidence,
		RequiredRole:             &requiredRole,
		RequiredAuthorityAmount:  &requiredAmount,
		Metadata:                 map[string]any{"source": "integration-updated", "route": "patch"},
	}), http.StatusOK)
	if policy.Name != updatedName || policy.Status != model.ApprovalPolicyStatusActive || policy.ContractType == nil || *policy.ContractType != contractType || policy.Department == nil || *policy.Department != department {
		t.Fatalf("updated approval policy scope/status = %+v", policy)
	}
	if policy.Mode != "parallel" || policy.Quorum != "n_of_m" || policy.QuorumN == nil || *policy.QuorumN != quorumN || len(policy.Approvers) != 2 {
		t.Fatalf("updated approval policy routing = %+v", policy)
	}
	if len(policy.FormFields) != 2 || policy.Metadata["source"] != "integration-updated" {
		t.Fatalf("updated approval policy form fields/metadata = %+v", policy)
	}

	policies := mustData[[]model.ApprovalPolicy](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflow-policies/approval", nil), http.StatusOK)
	found := false
	for _, item := range policies {
		if item.ID == policy.ID && item.Name == updatedName && item.Status == model.ApprovalPolicyStatusActive {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("updated approval policy %s missing from list: %+v", policy.ID, policies)
	}

	contract := h.createContractWithText(t, "Watheeq Persisted Policy Contract", contractType, 250_000, lifecycleContractText())
	recommendation := mustData[model.ApprovalPolicyRecommendation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/workflow-policies/approval/recommend?contract_id=%s", contract.ID), nil), http.StatusOK)
	if !recommendation.Matched || recommendation.Policy == nil || recommendation.Policy.ID != policy.ID {
		t.Fatalf("recommendation = %+v, want policy %s", recommendation, policy.ID)
	}

	workflow := mustData[model.LegalWorkflowSummary](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/review", contract.ID), dto.ReviewContractRequest{
		ApprovalPolicyID: &policy.ID,
		Description:      "Persisted approval policy review.",
		SLAHours:         24,
	}), http.StatusAccepted)
	if workflow.TaskID == nil {
		t.Fatal("start review did not return task_id")
	}
	if workflow.ApprovalPolicy["policy_id"] != policy.ID.String() || workflow.ApprovalPolicy["source"] != "persistent_policy" {
		t.Fatalf("workflow approval policy metadata = %+v, want persisted policy %s", workflow.ApprovalPolicy, policy.ID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var rawSchema []byte
	var rawMetadata []byte
	if err := h.env.db.QueryRow(ctx, `
		SELECT form_schema, metadata
		FROM workflow_tasks
		WHERE id = $1 AND tenant_id = $2`,
		*workflow.TaskID, h.tenantID,
	).Scan(&rawSchema, &rawMetadata); err != nil {
		t.Fatalf("load persisted policy workflow task: %v", err)
	}
	var formSchema []workflowmodel.FormField
	if err := json.Unmarshal(rawSchema, &formSchema); err != nil {
		t.Fatalf("decode form schema: %v", err)
	}
	requiredFields := map[string]bool{}
	for _, field := range formSchema {
		if field.Required {
			requiredFields[field.Name] = true
		}
	}
	for _, name := range []string{"decision", "authority_role", "authority_amount", "authority_currency", "authority_evidence_ref", "business_justification", "risk_acceptance"} {
		if !requiredFields[name] {
			t.Fatalf("required persisted-policy form field %q missing from schema %+v", name, formSchema)
		}
	}

	var taskMetadata map[string]any
	if err := json.Unmarshal(rawMetadata, &taskMetadata); err != nil {
		t.Fatalf("decode task metadata: %v", err)
	}
	if taskMetadata["approval_chain"] != true || taskMetadata["approval_quorum"] != "n_of_m" || taskMetadata["approver_ref"] != approverOne.String() {
		t.Fatalf("task metadata missing approval chain routing: %+v", taskMetadata)
	}

	rows, err := h.env.db.Query(ctx, `
		SELECT id
		FROM workflow_tasks
		WHERE tenant_id = $1 AND instance_id = $2
		ORDER BY created_at ASC`,
		h.tenantID, workflow.WorkflowInstanceID,
	)
	if err != nil {
		t.Fatalf("list approval-chain tasks: %v", err)
	}
	defer rows.Close()
	var taskIDs []uuid.UUID
	for rows.Next() {
		var taskID uuid.UUID
		if err := rows.Scan(&taskID); err != nil {
			t.Fatalf("scan approval-chain task: %v", err)
		}
		taskIDs = append(taskIDs, taskID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate approval-chain tasks: %v", err)
	}
	if len(taskIDs) != 2 {
		t.Fatalf("approval-chain task count = %d, want 2", len(taskIDs))
	}

	analytics := mustData[model.ApprovalPolicyAnalytics](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflow-policies/approval/analytics", nil), http.StatusOK)
	policyAnalytics := approvalPolicyAnalyticsFor(t, analytics, policy.ID)
	if analytics.TotalPolicies == 0 || analytics.TotalRoutedTasks != 2 || analytics.ActiveTasks != 2 || analytics.AwaitingQuorumTasks != 2 {
		t.Fatalf("initial approval analytics = %+v, want two routed active quorum tasks", analytics)
	}
	if policyAnalytics.TotalTasks != 2 || policyAnalytics.ActiveTasks != 2 || policyAnalytics.AwaitingQuorumTasks != 2 {
		t.Fatalf("initial policy analytics = %+v, want two active quorum tasks", policyAnalytics)
	}

	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, taskIDs[0]), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"business_justification": "Required for a strategic renewal.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        policy.ID.String(),
			Role:            requiredRole,
			AuthorityAmount: 300_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-PERSISTED-001",
			Source:          "authority_matrix",
		},
	}), http.StatusForbidden)

	approverOneHarness := h.withToken(h.env.mustToken(t, h.tenantID, approverOne, "tenant_admin", "legal-contracts-manager"))
	approverTwoHarness := h.withToken(h.env.mustToken(t, h.tenantID, approverTwo, "tenant_admin", "legal-contracts-manager"))

	firstResult := mustData[model.LegalWorkflowDecisionResult](t, approverOneHarness.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, taskIDs[0]), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"business_justification": "Required for a strategic renewal.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        policy.ID.String(),
			Role:            requiredRole,
			AuthorityAmount: 300_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-PERSISTED-001",
			Source:          "authority_matrix",
		},
	}), http.StatusOK)
	if firstResult.ContractStatus != model.ContractStatusInternalReview || firstResult.WorkflowStatus != workflowmodel.InstanceStatusRunning {
		t.Fatalf("first approval result = %+v, want internal_review/running until quorum is met", firstResult)
	}

	activeAfterFirst := mustPaginated[model.LegalWorkflowSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflows", nil), http.StatusOK)
	if len(activeAfterFirst.Data) != 1 || activeAfterFirst.Data[0].TaskID == nil || *activeAfterFirst.Data[0].TaskID != taskIDs[1] {
		t.Fatalf("active workflow tasks after first approval = %+v, want only second approval task", activeAfterFirst.Data)
	}

	analyticsAfterFirst := mustData[model.ApprovalPolicyAnalytics](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflow-policies/approval/analytics", nil), http.StatusOK)
	policyAnalyticsAfterFirst := approvalPolicyAnalyticsFor(t, analyticsAfterFirst, policy.ID)
	if analyticsAfterFirst.TotalRoutedTasks != 2 || analyticsAfterFirst.ActiveTasks != 1 || analyticsAfterFirst.CompletedTasks != 1 || analyticsAfterFirst.AwaitingQuorumTasks != 1 {
		t.Fatalf("analytics after first approval = %+v, want one complete and one awaiting quorum", analyticsAfterFirst)
	}
	if policyAnalyticsAfterFirst.ActiveTasks != 1 || policyAnalyticsAfterFirst.CompletedTasks != 1 || policyAnalyticsAfterFirst.AwaitingQuorumTasks != 1 {
		t.Fatalf("policy analytics after first approval = %+v, want one complete and one awaiting quorum", policyAnalyticsAfterFirst)
	}

	result := mustData[model.LegalWorkflowDecisionResult](t, approverTwoHarness.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/workflows/%s/tasks/%s/decision", workflow.WorkflowInstanceID, taskIDs[1]), dto.WorkflowDecisionRequest{
		Decision: "approve",
		FormData: map[string]any{
			"business_justification": "Second approval satisfies the persisted DoA quorum.",
			"risk_acceptance":        true,
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        policy.ID.String(),
			Role:            requiredRole,
			AuthorityAmount: 300_000,
			Currency:        "SAR",
			EvidenceID:      "DOA-PERSISTED-002",
			Source:          "authority_matrix",
		},
	}), http.StatusOK)
	if result.ContractStatus != model.ContractStatusPendingSignature || result.WorkflowStatus != workflowmodel.InstanceStatusCompleted {
		t.Fatalf("final approval result = %+v, want pending_signature/completed", result)
	}

	finalAnalytics := mustData[model.ApprovalPolicyAnalytics](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflow-policies/approval/analytics", nil), http.StatusOK)
	finalPolicyAnalytics := approvalPolicyAnalyticsFor(t, finalAnalytics, policy.ID)
	if finalAnalytics.TotalRoutedTasks != 2 || finalAnalytics.ActiveTasks != 0 || finalAnalytics.CompletedTasks != 2 || finalAnalytics.AwaitingQuorumTasks != 0 || finalAnalytics.AverageDecisionHours == nil {
		t.Fatalf("final approval analytics = %+v, want completed quorum route with decision timing", finalAnalytics)
	}
	if finalPolicyAnalytics.TotalTasks != 2 || finalPolicyAnalytics.CompletedTasks != 2 || finalPolicyAnalytics.AverageDecisionHours == nil || finalPolicyAnalytics.LastTaskAt == nil {
		t.Fatalf("final policy analytics = %+v, want completed policy timing", finalPolicyAnalytics)
	}

	expectStatus(t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/workflow-policies/approval/%s", policy.ID), nil), http.StatusNoContent)
	archivedPolicies := mustData[[]model.ApprovalPolicy](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/workflow-policies/approval", nil), http.StatusOK)
	archivedFound := false
	for _, item := range archivedPolicies {
		if item.ID == policy.ID {
			archivedFound = true
			if item.Status != model.ApprovalPolicyStatusArchived {
				t.Fatalf("archived approval policy status = %s, want archived", item.Status)
			}
			break
		}
	}
	if !archivedFound {
		t.Fatalf("archived approval policy %s missing from list: %+v", policy.ID, archivedPolicies)
	}

	archivedContract := h.createContractWithText(t, "Watheeq Archived Policy Contract", contractType, 250_000, lifecycleContractText())
	archivedRecommendation := mustData[model.ApprovalPolicyRecommendation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/workflow-policies/approval/recommend?contract_id=%s", archivedContract.ID), nil), http.StatusOK)
	if archivedRecommendation.Matched || archivedRecommendation.Policy != nil {
		t.Fatalf("archived recommendation = %+v, want no active match", archivedRecommendation)
	}
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/review", archivedContract.ID), dto.ReviewContractRequest{
		ApprovalPolicyID: &policy.ID,
		Description:      "Archived approval policy review should be rejected.",
		SLAHours:         24,
	}), http.StatusUnprocessableEntity)
}

func approvalPolicyAnalyticsFor(t *testing.T, analytics model.ApprovalPolicyAnalytics, policyID uuid.UUID) model.ApprovalPolicyAnalyticsPolicy {
	t.Helper()
	for _, item := range analytics.Policies {
		if item.PolicyID == policyID {
			return item
		}
	}
	t.Fatalf("policy analytics for %s missing from %+v", policyID, analytics.Policies)
	return model.ApprovalPolicyAnalyticsPolicy{}
}

func TestWatheeqWorkflowBulkDecisionAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contractOne := h.createContractWithText(t, "Watheeq Bulk Approval One", model.ContractTypeServiceAgreement, 120_000, lifecycleContractText())
	contractTwo := h.createContractWithText(t, "Watheeq Bulk Approval Two", model.ContractTypeVendor, 80_000, lifecycleContractText())
	workflowOne := h.startReview(t, contractOne.ID, "Bulk approval review one.")
	workflowTwo := h.startReview(t, contractTwo.ID, "Bulk approval review two.")
	if workflowOne.TaskID == nil || workflowTwo.TaskID == nil {
		t.Fatalf("bulk workflow fixtures missing task IDs: %+v %+v", workflowOne, workflowTwo)
	}

	approver := h.contractApprover(t)
	notes := "Bulk approved from Watheeq review queue."
	result := mustData[model.LegalWorkflowBulkDecisionResult](t, approver.doJSON(t, http.MethodPost, "/api/v1/lex/workflows/tasks/bulk-decision", dto.WorkflowBulkDecisionRequest{
		Decision: "approve",
		Notes:    &notes,
		Metadata: map[string]any{"batch_id": "BULK-WFL-04"},
		Items: []dto.WorkflowBulkDecisionTarget{
			{WorkflowInstanceID: workflowOne.WorkflowInstanceID, TaskID: *workflowOne.TaskID},
			{WorkflowInstanceID: workflowTwo.WorkflowInstanceID, TaskID: *workflowTwo.TaskID, Metadata: map[string]any{"queue": "legal"}},
		},
	}), http.StatusOK)
	if result.Requested != 2 || result.Succeeded != 2 || result.Failed != 0 {
		t.Fatalf("bulk decision summary = %+v, want 2 succeeded and 0 failed", result)
	}
	if len(result.Results) != 2 || len(result.Errors) != 0 {
		t.Fatalf("bulk decision result/errors = %d/%d", len(result.Results), len(result.Errors))
	}
	for _, item := range result.Results {
		if item.ContractStatus != model.ContractStatusPendingSignature || item.WorkflowStatus != "completed" || item.TaskStatus != "completed" {
			t.Fatalf("bulk decision item = %+v, want pending_signature/completed/completed", item)
		}
		if item.Metadata["bulk_decision"] != true {
			t.Fatalf("bulk decision metadata missing bulk marker: %+v", item.Metadata)
		}
	}

	repeated := mustData[model.LegalWorkflowBulkDecisionResult](t, approver.doJSON(t, http.MethodPost, "/api/v1/lex/workflows/tasks/bulk-decision", dto.WorkflowBulkDecisionRequest{
		Decision: "approve",
		Items: []dto.WorkflowBulkDecisionTarget{
			{WorkflowInstanceID: workflowOne.WorkflowInstanceID, TaskID: *workflowOne.TaskID},
			{WorkflowInstanceID: workflowTwo.WorkflowInstanceID, TaskID: *workflowTwo.TaskID},
		},
	}), http.StatusOK)
	if repeated.Succeeded != 0 || repeated.Failed != 2 || len(repeated.Errors) != 2 {
		t.Fatalf("repeated bulk decision = %+v, want two item-level failures", repeated)
	}
	for _, item := range repeated.Errors {
		if item.Code != "CONFLICT" {
			t.Fatalf("repeated bulk error = %+v, want CONFLICT", item)
		}
	}
}

func ptrStringTest(value string) *string {
	return &value
}
