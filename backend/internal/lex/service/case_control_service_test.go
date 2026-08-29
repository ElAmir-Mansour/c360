package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestBuildCaseControlDashboardUsesLifecycleAndFullPortfolioCounts(t *testing.T) {
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	from := now.Add(-7 * 24 * time.Hour)
	nextHearing := now.Add(48 * time.Hour)
	department := "Legal"
	lawyer := "A. Counsel"

	dashboard := buildCaseControlDashboard(
		now,
		from,
		&model.CaseReport{
			Total: 20,
			ByType: []model.CountBucket{
				{Key: "commercial", Count: 12},
				{Key: "labor", Count: 8},
			},
			ByStatus: []model.CountBucket{
				{Key: "open", Count: 5},
				{Key: "phase1", Count: 3},
				{Key: "phase2", Count: 2},
				{Key: "on_hold", Count: 3},
				{Key: "closed", Count: 5},
				{Key: "cancelled", Count: 2},
			},
			ByCompanyRole: []model.CountBucket{
				{Key: "plaintiff", Count: 11},
				{Key: "defendant", Count: 9},
			},
		},
		4,
		3,
		[]model.CountBucket{
			{Key: "registered", Count: 2},
			{Key: "in_progress", Count: 2},
			{Key: "rejected", Count: 2},
			{Key: "approved", Count: 3},
			{Key: "closed", Count: 1},
		},
		[]model.CountBucket{
			{Key: "commercial", Count: 6},
			{Key: "labor", Count: 4},
		},
		[]dto.LegalCaseListItem{{
			LegalCase: model.LegalCase{
				ID:                uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				CaseNumber:        "CASE-001",
				Title:             forms.LocalizedText{EN: "Supplier dispute", AR: "نزاع مورد"},
				CaseType:          "commercial",
				CompanyStatus:     model.CaseCompanyStatusPlaintiff,
				Status:            model.CaseStatusOpen,
				Priority:          model.LegalPriorityHigh,
				ResponsibleLawyer: &lawyer,
				Department:        &department,
				UpdatedAt:         now.Add(-time.Hour),
			},
			NextHearingDate: &nextHearing,
			PartyCount:      2,
		}},
		[]model.LegalInvestigation{{
			ID:                  uuid.MustParse("22222222-2222-2222-2222-222222222222"),
			InvestigationNumber: "INV-001",
			Subject:             "Sensitive subject",
			LeadInvestigator:    "Lead",
			Status:              model.InvestigationStatusInProgress,
			Priority:            model.LegalPriorityCritical,
			Department:          &department,
			Findings:            "Finding",
			Recommendations:     "Recommendation",
			CreatedAt:           now.Add(-48 * time.Hour),
			UpdatedAt:           now.Add(-time.Hour),
		}},
		[]model.LegalInvestigation{{
			ID:                  uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			InvestigationNumber: "INV-RECENT",
			Subject:             "Recently closed subject",
			LeadInvestigator:    "Lead",
			Status:              model.InvestigationStatusClosed,
			Priority:            model.LegalPriorityMedium,
			CreatedAt:           now.Add(-72 * time.Hour),
			UpdatedAt:           now.Add(-30 * time.Minute),
		}},
		map[uuid.UUID]string{
			uuid.MustParse("33333333-3333-3333-3333-333333333333"): "commercial",
		},
	)

	if dashboard.Cases.Total != 20 || dashboard.Cases.Active != 13 {
		t.Fatalf("case totals = total %d active %d, want 20/13", dashboard.Cases.Total, dashboard.Cases.Active)
	}
	if dashboard.Cases.ResolvedLast7Days != 4 {
		t.Fatalf("resolved_last_7_days = %d, want lifecycle count 4", dashboard.Cases.ResolvedLast7Days)
	}
	if dashboard.Cases.UnderReview != 5 || dashboard.Cases.DueIn30Days != 3 {
		t.Fatalf("case manager KPIs = under_review %d due_in_30_days %d, want 5/3", dashboard.Cases.UnderReview, dashboard.Cases.DueIn30Days)
	}
	if dashboard.Investigations.Total != 10 || dashboard.Investigations.Ongoing != 6 {
		t.Fatalf("investigation totals = total %d ongoing %d, want 10/6", dashboard.Investigations.Total, dashboard.Investigations.Ongoing)
	}
	if len(dashboard.Cases.Recent) != 1 || dashboard.Cases.Recent[0].PartyCount != 2 {
		t.Fatalf("recent cases = %+v, want one compact summary", dashboard.Cases.Recent)
	}
	if len(dashboard.Investigations.Active) != 1 || dashboard.Investigations.Active[0].Subject != "Sensitive subject" {
		t.Fatalf("active investigations = %+v, want decrypted compact summary", dashboard.Investigations.Active)
	}
	if len(dashboard.Investigations.Recent) != 1 ||
		dashboard.Investigations.Recent[0].Status != model.InvestigationStatusClosed ||
		dashboard.Investigations.Recent[0].CaseType == nil ||
		*dashboard.Investigations.Recent[0].CaseType != "commercial" {
		t.Fatalf("recent investigations = %+v, want terminal work in the recent feed", dashboard.Investigations.Recent)
	}
	recentJSON, err := json.Marshal(dashboard.Investigations.Recent[0])
	if err != nil {
		t.Fatalf("marshal recent investigation: %v", err)
	}
	var recentFields map[string]any
	if err := json.Unmarshal(recentJSON, &recentFields); err != nil {
		t.Fatalf("decode recent investigation: %v", err)
	}
	for _, forbidden := range []string{"subject", "findings", "recommendations", "department"} {
		if _, exposed := recentFields[forbidden]; exposed {
			t.Fatalf("recent investigation exposes sensitive field %q: %s", forbidden, recentJSON)
		}
	}
	if len(dashboard.Investigations.ByCaseType) != 2 || dashboard.Investigations.ByCaseType[0].Key != "commercial" {
		t.Fatalf("investigations by case type = %+v, want full distribution", dashboard.Investigations.ByCaseType)
	}
	if !dashboard.ResolutionWindow.From.Equal(from) || !dashboard.ResolutionWindow.To.Equal(now) {
		t.Fatalf("resolution window = %+v, want [%s,%s)", dashboard.ResolutionWindow, from, now)
	}
}

func TestBuildCaseControlDashboardUsesStableEmptyArrays(t *testing.T) {
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	dashboard := buildCaseControlDashboard(now, now.Add(-7*24*time.Hour), nil, 0, 0, nil, nil, nil, nil, nil, nil)

	body, err := json.Marshal(dashboard)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	cases := decoded["cases"].(map[string]any)
	investigations := decoded["investigations"].(map[string]any)
	for name, value := range map[string]any{
		"cases.by_type":               cases["by_type"],
		"cases.by_status":             cases["by_status"],
		"cases.by_company_role":       cases["by_company_role"],
		"cases.recent":                cases["recent"],
		"investigations.by_status":    investigations["by_status"],
		"investigations.by_case_type": investigations["by_case_type"],
		"investigations.active":       investigations["active"],
		"investigations.recent":       investigations["recent"],
	} {
		if rows, ok := value.([]any); !ok || len(rows) != 0 {
			t.Fatalf("%s = %#v, want []", name, value)
		}
	}
}
