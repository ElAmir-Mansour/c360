//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestClauseExtraction(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Eight Clause Extraction Contract", model.ContractTypeServiceAgreement, 950000, eightClauseText())
	h.analyzeContract(t, contract.ID)

	clauses := mustData[[]model.Clause](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses", contract.ID), nil), http.StatusOK)
	if len(clauses) < 8 {
		t.Fatalf("clause count = %d, want at least 8", len(clauses))
	}

	expected := map[model.ClauseType]struct{}{
		model.ClauseTypeTermination:           {},
		model.ClauseTypeIndemnification:       {},
		model.ClauseTypeLimitationOfLiability: {},
		model.ClauseTypeConfidentiality:       {},
		model.ClauseTypeForceMajeure:          {},
		model.ClauseTypeDisputeResolution:     {},
		model.ClauseTypeDataProtection:        {},
		model.ClauseTypeAuditRights:           {},
	}
	for _, clause := range clauses {
		delete(expected, clause.ClauseType)
		if clause.SectionReference == nil || *clause.SectionReference == "" {
			t.Fatalf("expected section reference for clause %+v", clause)
		}
	}
	if len(expected) != 0 {
		t.Fatalf("missing expected clause types: %+v", expected)
	}
}

func TestClauseReview(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Clause Review Contract", model.ContractTypeServiceAgreement, 850000, eightClauseText())
	h.analyzeContract(t, contract.ID)

	clauses := mustData[[]model.Clause](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses", contract.ID), nil), http.StatusOK)
	if len(clauses) == 0 {
		t.Fatal("expected clauses for review")
	}

	reviewed := mustData[model.Clause](t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses/%s/review", contract.ID, clauses[0].ID), dto.UpdateClauseReviewRequest{
		Status: model.ClauseReviewFlagged,
		Notes:  "Escalate this clause for manual legal review.",
	}), http.StatusOK)
	if reviewed.ReviewStatus != model.ClauseReviewFlagged {
		t.Fatalf("review status = %s, want %s", reviewed.ReviewStatus, model.ClauseReviewFlagged)
	}
	if reviewed.ReviewNotes == nil || *reviewed.ReviewNotes != "Escalate this clause for manual legal review." {
		t.Fatalf("review notes = %v, want persisted notes", reviewed.ReviewNotes)
	}

	detail := mustData[model.Clause](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses/%s", contract.ID, clauses[0].ID), nil), http.StatusOK)
	if detail.ReviewStatus != model.ClauseReviewFlagged {
		t.Fatalf("clause detail review status = %s, want %s", detail.ReviewStatus, model.ClauseReviewFlagged)
	}
}

func TestHighRiskSummary(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "High Risk Clause Summary Contract", model.ContractTypeServiceAgreement, 1_900_000, highRiskClauseText())
	h.analyzeContract(t, contract.ID)

	summary := mustData[[]model.Clause](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/clauses/risks", contract.ID), nil), http.StatusOK)
	if len(summary) != 3 {
		t.Fatalf("high risk summary size = %d, want 3", len(summary))
	}

	foundCritical := false
	for _, clause := range summary {
		if clause.RiskLevel != model.RiskLevelHigh && clause.RiskLevel != model.RiskLevelCritical {
			t.Fatalf("unexpected risk level in summary: %+v", clause)
		}
		if clause.ClauseType == model.ClauseTypeLimitationOfLiability && clause.RiskLevel == model.RiskLevelCritical {
			foundCritical = true
		}
	}
	if !foundCritical {
		t.Fatalf("expected critical limitation_of_liability clause in %+v", summary)
	}
}

func TestLibraryGovernanceDecisionRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	suffix := uuid.NewString()
	clause := mustData[model.ClauseLibraryItem](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/clause-library", dto.CreateClauseLibraryItemRequest{
		Code:             "GOV-CLAUSE-" + suffix,
		TitleEN:          "Data Processing Approval Clause",
		TitleAR:          "بند اعتماد معالجة البيانات",
		TextEN:           "The processor shall protect personal data and notify controllers after a breach.",
		TextAR:           "يلتزم المعالج بحماية البيانات الشخصية وإخطار المراقب عند حدوث خرق.",
		ClauseType:       model.ClauseTypeDataProtection,
		Category:         "data_protection",
		Jurisdiction:     "SA",
		Source:           "Watheeq RTM",
		Version:          1,
		Status:           model.ClauseLibraryStatusDraft,
		GovernanceStatus: model.ClauseGovernancePendingReview,
		Tags:             []string{"pdpl", "approval"},
	}), http.StatusCreated)

	approvedClause := mustData[model.ClauseLibraryItem](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/clause-library/%s/governance", clause.ID), dto.LibraryGovernanceDecisionRequest{
		Decision: "approve",
		Activate: true,
		Notes:    "Approved by Watheeq legal library board.",
		Evidence: map[string]any{"approval_reference": "CLB-APPROVAL-1", "control_id": "WTQ-CLB-03"},
	}), http.StatusOK)
	if approvedClause.Status != model.ClauseLibraryStatusActive || approvedClause.GovernanceStatus != model.ClauseGovernanceApproved {
		t.Fatalf("approved clause statuses = %s/%s, want active/approved", approvedClause.Status, approvedClause.GovernanceStatus)
	}
	assertLibraryGovernanceMetadata(t, approvedClause.Metadata, "approve", "WTQ-CLB-03")

	invalid := h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/clause-library/%s/governance", clause.ID), dto.LibraryGovernanceDecisionRequest{
		Decision: "skip",
	})
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("invalid clause governance status = %d, want 422", invalid.StatusCode)
	}

	regulation := mustData[model.RegulationLibraryItem](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/regulations", dto.CreateRegulationLibraryItemRequest{
		Code:           "GOV-REG-" + suffix,
		TitleEN:        "Personal Data Protection Guidance",
		TitleAR:        "إرشادات حماية البيانات الشخصية",
		DescriptionEN:  "Guidance for processing personal data in Saudi Arabia.",
		DescriptionAR:  "إرشادات لمعالجة البيانات الشخصية في المملكة العربية السعودية.",
		Jurisdiction:   "SA",
		Authority:      "SDAIA",
		Source:         "Watheeq RTM",
		RegulationType: model.RegulationTypeGuidance,
		Version:        1,
		Status:         model.RegulationStatusDraft,
		Tags:           []string{"pdpl", "approval"},
	}), http.StatusCreated)

	approvedRegulation := mustData[model.RegulationLibraryItem](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/regulations/%s/governance", regulation.ID), dto.LibraryGovernanceDecisionRequest{
		Decision: "approve",
		Activate: true,
		Notes:    "Approved for Watheeq regulation library publication.",
		Evidence: map[string]any{"approval_reference": "REG-APPROVAL-1", "control_id": "WTQ-CLB-02"},
	}), http.StatusOK)
	if approvedRegulation.Status != model.RegulationStatusActive {
		t.Fatalf("approved regulation status = %s, want active", approvedRegulation.Status)
	}
	assertLibraryGovernanceMetadata(t, approvedRegulation.Metadata, "approve", "WTQ-CLB-02")
}

func assertLibraryGovernanceMetadata(t *testing.T, metadata map[string]any, decision, controlID string) {
	t.Helper()
	governance, ok := metadata["governance"].(map[string]any)
	if !ok {
		t.Fatalf("governance metadata = %#v, want object", metadata["governance"])
	}
	if governance["decision"] != decision {
		t.Fatalf("governance decision = %#v, want %s", governance["decision"], decision)
	}
	evidence, ok := governance["evidence"].(map[string]any)
	if !ok {
		t.Fatalf("governance evidence = %#v, want object", governance["evidence"])
	}
	if evidence["control_id"] != controlID {
		t.Fatalf("control_id = %#v, want %s", evidence["control_id"], controlID)
	}
	if _, ok := metadata["governance_history"].([]any); !ok {
		t.Fatalf("governance_history = %#v, want array", metadata["governance_history"])
	}
}
