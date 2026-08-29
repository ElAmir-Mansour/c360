package handler

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateInvestigationReportQueryRejectsInvalidStatusAndRange(t *testing.T) {
	invalidStatus := "not-a-state"
	if err := validateInvestigationReportQuery(dto.ReportQuery{Status: &invalidStatus}); err == nil {
		t.Fatal("expected invalid status to be rejected")
	}

	from := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	to := from.Add(-24 * time.Hour)
	if err := validateInvestigationReportQuery(dto.ReportQuery{From: &from, To: &to}); err == nil {
		t.Fatal("expected inverted report period to be rejected")
	}

	validStatus := "pending_approval"
	if err := validateInvestigationReportQuery(dto.ReportQuery{From: &to, To: &from, Status: &validStatus}); err != nil {
		t.Fatalf("valid query rejected: %v", err)
	}
}

func TestInvestigationExportRowsCarryResolvedFilters(t *testing.T) {
	generatedAt := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	from := generatedAt.AddDate(0, -1, 0)
	to := generatedAt
	department := "Compliance"
	status := "closed"
	category := "fraud"
	report := &model.InvestigationReport{
		GeneratedAt: generatedAt,
		Filters: model.ReportFilters{
			From: &from, To: &to, Department: &department, Status: &status, Type: &category,
		},
		Items: []model.InvestigationReportItem{{InvestigationNumber: "INV-001"}},
	}
	rows := investigationReportRows(report)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0][1] != from.Format(time.RFC3339) || rows[0][2] != to.Format(time.RFC3339) || rows[0][3] != department || rows[0][4] != status || rows[0][5] != category {
		t.Fatalf("export filters missing from row: %+v", rows[0])
	}
}
