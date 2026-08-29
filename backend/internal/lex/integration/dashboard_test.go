//go:build integration

package integration

import (
	"context"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestDashboard(t *testing.T) {
	h := newDemoHarness(t)

	first := mustData[model.LexDashboard](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/dashboard", nil), http.StatusOK)
	second := mustData[model.LexDashboard](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/dashboard", nil), http.StatusOK)

	if first.KPIs.ActiveContracts == 0 {
		t.Fatal("expected dashboard active contracts KPI to be populated")
	}
	if first.KPIs.ExpiringIn30Days == 0 || first.KPIs.ExpiringIn7Days == 0 {
		t.Fatalf("expected expiring KPIs to be populated: %+v", first.KPIs)
	}
	if first.KPIs.HighRiskContracts == 0 {
		t.Fatalf("expected high risk KPI to be populated: %+v", first.KPIs)
	}
	if first.KPIs.ComplianceScore <= 0 {
		t.Fatalf("expected compliance score > 0, got %+v", first.KPIs)
	}
	if len(first.ContractsByType) == 0 || len(first.ContractsByStatus) == 0 {
		t.Fatalf("expected dashboard contract distributions, got %+v %+v", first.ContractsByType, first.ContractsByStatus)
	}
	if len(first.ExpiringContracts) == 0 || len(first.HighRiskContracts) == 0 || len(first.RecentContracts) == 0 {
		t.Fatalf("expected populated dashboard lists, got %+v %+v %+v", first.ExpiringContracts, first.HighRiskContracts, first.RecentContracts)
	}
	if len(first.ComplianceAlertsByStatus) == 0 {
		t.Fatal("expected compliance alerts by status to be populated")
	}
	if len(first.TotalContractValue.ByType) == 0 || len(first.TotalContractValue.ByCurrency) == 0 {
		t.Fatalf("expected total contract value breakdowns, got %+v", first.TotalContractValue)
	}
	if len(first.MonthlyActivity) != 12 {
		t.Fatalf("monthly activity size = %d, want 12", len(first.MonthlyActivity))
	}
	if !first.CalculatedAt.Equal(second.CalculatedAt) {
		t.Fatalf("expected cached dashboard timestamp to remain stable, first=%s second=%s", first.CalculatedAt, second.CalculatedAt)
	}

	complianceDashboard := mustData[model.ComplianceDashboard](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/compliance/dashboard", nil), http.StatusOK)
	if complianceDashboard.OpenAlerts == 0 {
		t.Fatalf("expected compliance dashboard open alerts > 0, got %+v", complianceDashboard)
	}
	if complianceDashboard.ComplianceScore <= 0 {
		t.Fatalf("expected compliance dashboard score > 0, got %+v", complianceDashboard)
	}

	score := mustData[model.ComplianceScore](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/compliance/score", nil), http.StatusOK)
	if score.Score <= 0 {
		t.Fatalf("expected compliance score > 0, got %+v", score)
	}
}

func TestDashboardKPIAcceptanceFixture(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC()
	expiringInFive := now.AddDate(0, 0, 5)
	expiringInTwenty := now.AddDate(0, 0, 20)
	expiringFuture := now.AddDate(0, 0, 90)
	activeCritical := h.insertDashboardContractFixture(t, ctx, dashboardContractFixture{
		Title:      "Dashboard Critical Active Contract",
		Type:       model.ContractTypeVendor,
		Status:     model.ContractStatusActive,
		RiskLevel:  model.RiskLevelCritical,
		RiskScore:  91,
		Value:      1000,
		ExpiryDate: &expiringInFive,
	})
	activeHigh := h.insertDashboardContractFixture(t, ctx, dashboardContractFixture{
		Title:      "Dashboard High Active Contract",
		Type:       model.ContractTypeServiceAgreement,
		Status:     model.ContractStatusActive,
		RiskLevel:  model.RiskLevelHigh,
		RiskScore:  76,
		Value:      2000,
		ExpiryDate: &expiringInTwenty,
	})
	activeLow := h.insertDashboardContractFixture(t, ctx, dashboardContractFixture{
		Title:      "Dashboard Low Active Contract",
		Type:       model.ContractTypeNDA,
		Status:     model.ContractStatusActive,
		RiskLevel:  model.RiskLevelLow,
		RiskScore:  20,
		Value:      3000,
		ExpiryDate: &expiringFuture,
	})
	h.insertDashboardContractFixture(t, ctx, dashboardContractFixture{
		Title:     "Dashboard Internal Review Contract",
		Type:      model.ContractTypeLicense,
		Status:    model.ContractStatusInternalReview,
		RiskLevel: model.RiskLevelNone,
		Value:     4000,
	})
	h.insertDashboardContractFixture(t, ctx, dashboardContractFixture{
		Title:     "Dashboard Legal Review Contract",
		Type:      model.ContractTypeLease,
		Status:    model.ContractStatusLegalReview,
		RiskLevel: model.RiskLevelNone,
		Value:     5000,
	})
	h.insertDashboardAlertFixture(t, ctx, activeCritical, model.ComplianceAlertOpen)
	h.insertDashboardAlertFixture(t, ctx, activeCritical, model.ComplianceAlertAcknowledged)
	h.insertDashboardAlertFixture(t, ctx, activeHigh, model.ComplianceAlertInvestigating)
	h.insertDashboardAlertFixture(t, ctx, activeLow, model.ComplianceAlertResolved)

	dashboard := mustData[model.LexDashboard](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/dashboard", nil), http.StatusOK)
	if dashboard.KPIs.ActiveContracts != 3 ||
		dashboard.KPIs.ExpiringIn30Days != 2 ||
		dashboard.KPIs.ExpiringIn7Days != 1 ||
		dashboard.KPIs.HighRiskContracts != 2 ||
		dashboard.KPIs.PendingReview != 2 ||
		dashboard.KPIs.OpenAlerts != 3 {
		t.Fatalf("dashboard KPIs = %+v, want active=3 expiring30=2 expiring7=1 highRisk=2 pending=2 openAlerts=3", dashboard.KPIs)
	}
	if math.Abs(dashboard.KPIs.TotalValue-6000) > 0.01 {
		t.Fatalf("dashboard total active value = %.2f, want 6000", dashboard.KPIs.TotalValue)
	}
	// Three active high-severity alerts cost 3*5 points against five contracts'
	// 5*10 exposure denominator: 100 * (1 - 15/50) = 70. The resolved alert is
	// intentionally excluded from current exposure.
	if math.Abs(dashboard.KPIs.ComplianceScore-70) > 0.01 {
		t.Fatalf("dashboard compliance score = %.2f, want 70", dashboard.KPIs.ComplianceScore)
	}
	if dashboard.ContractsByStatus[string(model.ContractStatusActive)] != 3 ||
		dashboard.ContractsByStatus[string(model.ContractStatusInternalReview)] != 1 ||
		dashboard.ContractsByStatus[string(model.ContractStatusLegalReview)] != 1 {
		t.Fatalf("contracts_by_status = %+v, want active/internal/legal = 3/1/1", dashboard.ContractsByStatus)
	}
	if dashboard.ContractsByType[string(model.ContractTypeVendor)] != 1 ||
		dashboard.ContractsByType[string(model.ContractTypeServiceAgreement)] != 1 ||
		dashboard.ContractsByType[string(model.ContractTypeNDA)] != 1 {
		t.Fatalf("contracts_by_type = %+v, want explicit fixture counts", dashboard.ContractsByType)
	}
	if dashboard.ComplianceAlertsByStatus[string(model.ComplianceAlertOpen)] != 1 ||
		dashboard.ComplianceAlertsByStatus[string(model.ComplianceAlertAcknowledged)] != 1 ||
		dashboard.ComplianceAlertsByStatus[string(model.ComplianceAlertInvestigating)] != 1 ||
		dashboard.ComplianceAlertsByStatus[string(model.ComplianceAlertResolved)] != 1 {
		t.Fatalf("compliance alert status counts = %+v, want one per fixture status", dashboard.ComplianceAlertsByStatus)
	}
	if len(dashboard.ExpiringContracts) != 2 || !expiringDashboardContains(dashboard.ExpiringContracts, activeCritical) || !expiringDashboardContains(dashboard.ExpiringContracts, activeHigh) {
		t.Fatalf("expiring contracts = %+v, want active critical/high fixtures", dashboard.ExpiringContracts)
	}
	if len(dashboard.HighRiskContracts) != 2 || !riskDashboardContains(dashboard.HighRiskContracts, activeCritical) || !riskDashboardContains(dashboard.HighRiskContracts, activeHigh) {
		t.Fatalf("high risk contracts = %+v, want critical/high fixtures", dashboard.HighRiskContracts)
	}
	if math.Abs(dashboard.TotalContractValue.ByCurrency["SAR"]-6000) > 0.01 ||
		math.Abs(dashboard.TotalContractValue.ByType[string(model.ContractTypeVendor)]-1000) > 0.01 ||
		math.Abs(dashboard.TotalContractValue.ByType[string(model.ContractTypeServiceAgreement)]-2000) > 0.01 ||
		math.Abs(dashboard.TotalContractValue.ByType[string(model.ContractTypeNDA)]-3000) > 0.01 {
		t.Fatalf("total contract value breakdown = %+v, want active fixture values", dashboard.TotalContractValue)
	}
	if len(dashboard.RecentContracts) < 5 {
		t.Fatalf("recent contracts = %d, want all five fixture contracts", len(dashboard.RecentContracts))
	}
	if len(dashboard.MonthlyActivity) != 12 {
		t.Fatalf("monthly activity size = %d, want 12", len(dashboard.MonthlyActivity))
	}

	stats := mustData[model.ContractStats](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/contracts/stats", nil), http.StatusOK)
	if stats.Expiring30Days != dashboard.KPIs.ExpiringIn30Days || stats.Expiring7Days != dashboard.KPIs.ExpiringIn7Days {
		t.Fatalf("contract stats expiring = %d/%d, want dashboard %d/%d", stats.Expiring30Days, stats.Expiring7Days, dashboard.KPIs.ExpiringIn30Days, dashboard.KPIs.ExpiringIn7Days)
	}
}

type dashboardContractFixture struct {
	Title      string
	Type       model.ContractType
	Status     model.ContractStatus
	RiskLevel  model.RiskLevel
	RiskScore  float64
	Value      float64
	ExpiryDate *time.Time
}

func (h *lexHarness) insertDashboardContractFixture(t *testing.T, ctx context.Context, fixture dashboardContractFixture) uuid.UUID {
	t.Helper()

	contractID := uuid.New()
	if fixture.RiskLevel == "" {
		fixture.RiskLevel = model.RiskLevelNone
	}
	if _, err := h.env.db.Exec(ctx, `
		INSERT INTO contracts (
			id, tenant_id, title, type, description, party_a_name, party_b_name,
			total_value, currency, effective_date, expiry_date, auto_renew,
			renewal_notice_days, status, status_changed_at, owner_user_id,
			owner_name, risk_level, risk_score, analysis_status, current_version,
			tags, metadata, created_by
		) VALUES (
			$1, $2, $3, $4, 'Dashboard KPI fixture', 'Clario Holdings Limited', $5,
			$6, 'SAR', CURRENT_DATE - 30, $7, false,
			30, $8, now(), $9,
			'Dashboard Owner', $10, NULLIF($11, 0), 'completed', 1,
			ARRAY['dashboard-fixture'], '{}'::jsonb, $9
		)`,
		contractID, h.tenantID, fixture.Title, fixture.Type, "Counterparty "+fixture.Title,
		fixture.Value, dateArg(fixture.ExpiryDate), fixture.Status, h.userID, fixture.RiskLevel, fixture.RiskScore,
	); err != nil {
		t.Fatalf("insert dashboard contract fixture: %v", err)
	}
	return contractID
}

func (h *lexHarness) insertDashboardAlertFixture(t *testing.T, ctx context.Context, contractID uuid.UUID, status model.ComplianceAlertStatus) {
	t.Helper()

	if _, err := h.env.db.Exec(ctx, `
		INSERT INTO compliance_alerts (
			id, tenant_id, contract_id, title, description, severity, status, evidence
		) VALUES (
			$1, $2, $3, $4, 'Dashboard KPI compliance fixture', 'high', $5, '{}'::jsonb
		)`,
		uuid.New(), h.tenantID, contractID, "Dashboard alert "+string(status), status,
	); err != nil {
		t.Fatalf("insert dashboard alert fixture: %v", err)
	}
}

func expiringDashboardContains(items []model.ExpiringContractSummary, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func riskDashboardContains(items []model.ContractRiskSummary, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}
