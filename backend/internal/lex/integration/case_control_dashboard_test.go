//go:build integration

package integration

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestCaseControlDashboardContract exercises the real route, repositories and
// response envelope. A controlled audit fixture represents a genuine historical
// close transition so the test can prove the KPI reads lifecycle time rather
// than case creation time without traversing the full case-intake approval FSM.
func TestCaseControlDashboardContract(t *testing.T) {
	h := newLexHarness(t)
	h.token = h.env.mustToken(t, h.tenantID, h.userID, "legal-director")

	department := "Legal"
	legalCase := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", dto.CreateLegalCaseRequest{
		CaseType:      "commercial",
		CompanyStatus: model.CaseCompanyStatusDefendant,
		Title:         forms.LocalizedText{EN: "Control panel case", AR: "قضية لوحة التحكم"},
		Description:   "Integration contract case",
		Priority:      model.LegalPriorityHigh,
		Department:    &department,
	}), http.StatusCreated)
	expectedResolution := time.Now().UTC().Add(5 * 24 * time.Hour)
	reviewCase := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", dto.CreateLegalCaseRequest{
		CaseType:      "labor",
		CompanyStatus: model.CaseCompanyStatusPlaintiff,
		Title:         forms.LocalizedText{EN: "Due review case", AR: "قضية مراجعة مستحقة"},
		Description:   "Forward-looking case manager KPI fixture",
		Priority:      model.LegalPriorityMedium,
		Department:    &department,
	}), http.StatusCreated)

	investigation := mustData[model.LegalInvestigation](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/investigations", dto.CreateInvestigationRequest{
		Subject:          "Encrypted integration subject",
		LeadInvestigator: "Integration Lead",
		Priority:         model.LegalPriorityCritical,
		CaseID:           &legalCase.ID,
		Department:       &department,
	}), http.StatusCreated)

	resolvedAt := time.Now().UTC().Add(-2 * time.Hour)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := h.env.db.Exec(ctx, `
		UPDATE legal_cases
		SET status = 'phase1', expected_resolution_date = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		h.tenantID, reviewCase.ID, expectedResolution,
	); err != nil {
		t.Fatalf("move controlled review fixture to phase1: %v", err)
	}
	if _, err := h.env.db.Exec(ctx, `
		UPDATE legal_cases
		SET status = 'closed', updated_at = $3
		WHERE tenant_id = $1 AND id = $2`,
		h.tenantID, legalCase.ID, resolvedAt,
	); err != nil {
		t.Fatalf("close controlled case fixture: %v", err)
	}
	if _, err := h.env.db.Exec(ctx, `
		INSERT INTO legal_case_audit_log (
			id, tenant_id, case_id, action, from_status, to_status,
			detail, actor_user_id, created_at
		) VALUES ($1,$2,$3,'case.status_changed','intake','closed','{}'::jsonb,$4,$5)`,
		uuid.New(), h.tenantID, legalCase.ID, h.userID, resolvedAt,
	); err != nil {
		t.Fatalf("insert controlled close transition: %v", err)
	}

	dashboard := mustData[model.CaseControlDashboard](t, h.doJSON(
		t,
		http.MethodGet,
		"/api/v1/lex/dashboard/cases-control",
		nil,
	), http.StatusOK)

	if dashboard.Cases.Total != 2 || dashboard.Cases.Closed != 1 || dashboard.Cases.Active != 1 {
		t.Fatalf("case metrics = %+v, want total=2 closed=1 active=1", dashboard.Cases)
	}
	if dashboard.Cases.UnderReview != 1 || dashboard.Cases.DueIn30Days != 1 {
		t.Fatalf("case-manager KPIs = %+v, want under_review=1 due_in_30_days=1", dashboard.Cases)
	}
	if dashboard.Cases.ResolvedLast7Days != 1 {
		t.Fatalf("resolved_last_7_days = %d, want audit-transition count 1", dashboard.Cases.ResolvedLast7Days)
	}
	if len(dashboard.Cases.Recent) != 2 {
		t.Fatalf("recent cases = %+v, want both created cases", dashboard.Cases.Recent)
	}
	if dashboard.Investigations.Total != 1 || dashboard.Investigations.Ongoing != 1 {
		t.Fatalf("investigation metrics = %+v, want total=1 ongoing=1", dashboard.Investigations)
	}
	if len(dashboard.Investigations.Active) != 1 ||
		dashboard.Investigations.Active[0].ID != investigation.ID ||
		dashboard.Investigations.Active[0].Subject != "Encrypted integration subject" {
		t.Fatalf("active investigations = %+v, want decrypted created investigation", dashboard.Investigations.Active)
	}
	if len(dashboard.Investigations.Recent) != 1 ||
		dashboard.Investigations.Recent[0].ID != investigation.ID ||
		dashboard.Investigations.Recent[0].CaseType == nil ||
		*dashboard.Investigations.Recent[0].CaseType != "commercial" {
		t.Fatalf("recent investigations = %+v, want created investigation", dashboard.Investigations.Recent)
	}
	if len(dashboard.Investigations.ByCaseType) != 1 ||
		dashboard.Investigations.ByCaseType[0].Key != "commercial" ||
		dashboard.Investigations.ByCaseType[0].Count != 1 {
		t.Fatalf("investigations by case type = %+v, want commercial=1", dashboard.Investigations.ByCaseType)
	}
	if dashboard.ResolutionWindow.To.Sub(dashboard.ResolutionWindow.From) != 7*24*time.Hour {
		t.Fatalf("resolution window = %+v, want trailing 7 days", dashboard.ResolutionWindow)
	}
}
