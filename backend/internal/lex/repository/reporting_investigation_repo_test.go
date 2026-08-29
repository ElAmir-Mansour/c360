package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

func TestInvestigationReportSummaryScopesTenantAndEveryFilter(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	asOf := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC)
	department := "Compliance"
	status := "approved"
	category := "fraud"
	rf := NewReportFilter(model.ReportFilters{
		From:       &from,
		To:         &to,
		Department: &department,
		Status:     &status,
		Type:       &category,
	})

	mock.ExpectQuery(`(?s)FROM legal_investigations i.*f.kind = 'investigation_resolution'.*WHERE i.tenant_id = \$1.*i.deleted_at IS NULL.*i.created_at >= \$3.*i.created_at <= \$4.*i.department = \$5.*i.status = \$6.*COALESCE\(NULLIF\(BTRIM\(i.metadata->>'category'\), ''\), NULLIF\(BTRIM\(c.case_type\), ''\), 'unspecified'\) = \$7`).
		WithArgs(tenantID, asOf, from, to, department, status, category).
		WillReturnRows(pgxmock.NewRows([]string{"total", "closed", "avg_age", "avg_approved", "sample"}).
			AddRow(8, 8, 0.0, 17.25, 6))

	got, err := investigationReportSummary(context.Background(), mock, tenantID, asOf, rf)
	if err != nil {
		t.Fatalf("investigationReportSummary: %v", err)
	}
	if got.Total != 8 || got.Closed != 8 || got.AvgRegisterToApprovedHours != 17.25 || got.ApprovalSampleSize != 6 {
		t.Fatalf("summary = %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestInvestigationReportItemsUsesSameTenantAndPeriodScope(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	investigationID := uuid.New()
	asOf := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	from := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 7, 31, 23, 59, 59, 0, time.UTC)
	rf := NewReportFilter(model.ReportFilters{From: &from, To: &to})

	mock.ExpectQuery(`(?s)SELECT i.id,.*i.investigation_number,.*latest.outcome.*FROM legal_investigations i.*clock.service_code = 'legal_investigation'.*WHERE i.tenant_id = \$1.*i.deleted_at IS NULL.*i.created_at >= \$3.*i.created_at <= \$4.*LIMIT \$5`).
		WithArgs(tenantID, asOf, from, to, 200).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "investigation_number", "status", "category", "priority", "department",
			"created_at", "resolved_at", "age_days", "outcome",
		}).AddRow(
			investigationID, "INV-2026-001", "in_progress", "fraud", "high", "Compliance",
			from.Add(24*time.Hour), nil, 30.0, "pending",
		))

	items, err := investigationReportItems(context.Background(), mock, tenantID, asOf, 200, rf)
	if err != nil {
		t.Fatalf("investigationReportItems: %v", err)
	}
	if len(items) != 1 || items[0].ID != investigationID || items[0].Category != "fraud" {
		t.Fatalf("items = %+v", items)
	}
	if items[0].SLAOutcome == nil || *items[0].SLAOutcome != model.SLAClockOutcomePending {
		t.Fatalf("sla outcome = %v", items[0].SLAOutcome)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
