package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestParseInvestigationListFiltersSupportsKPIStatusGroups(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/investigations?status=in_progress%2Cresults_recorded",
		nil,
	)

	filters, err := parseInvestigationListFilters(req)
	if err != nil {
		t.Fatalf("parseInvestigationListFilters() error = %v", err)
	}
	wantStatuses := []model.InvestigationStatus{
		model.InvestigationStatusInProgress,
		model.InvestigationStatusResults,
	}
	if len(filters.Statuses) != len(wantStatuses) {
		t.Fatalf("Statuses = %v, want %v", filters.Statuses, wantStatuses)
	}
	for index, want := range wantStatuses {
		if filters.Statuses[index] != want {
			t.Fatalf("Statuses[%d] = %q, want %q", index, filters.Statuses[index], want)
		}
	}
}

func TestParseInvestigationListFiltersSupportsCaseTypeDrilldown(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/investigations?case_type=commercial_litigation",
		nil,
	)

	filters, err := parseInvestigationListFilters(req)
	if err != nil {
		t.Fatalf("parseInvestigationListFilters() error = %v", err)
	}
	if filters.CaseType != "commercial_litigation" {
		t.Fatalf("CaseType = %q, want %q", filters.CaseType, "commercial_litigation")
	}
}
