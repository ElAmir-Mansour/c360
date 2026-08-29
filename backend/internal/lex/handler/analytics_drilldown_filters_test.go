package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestParseLegalCaseListFiltersSupportsAnalyticsDrilldowns(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/legal-cases?status=intake%2Copen%2Con_hold&case_type_unassigned=true&handling_officer_unassigned=true",
		nil,
	)

	filters, err := parseLegalCaseListFilters(req)
	if err != nil {
		t.Fatalf("parseLegalCaseListFilters() error = %v", err)
	}
	wantStatuses := []model.CaseStatus{"intake", "open", "on_hold"}
	if len(filters.Statuses) != len(wantStatuses) {
		t.Fatalf("Statuses = %v, want %v", filters.Statuses, wantStatuses)
	}
	for index, want := range wantStatuses {
		if filters.Statuses[index] != want {
			t.Fatalf("Statuses[%d] = %q, want %q", index, filters.Statuses[index], want)
		}
	}
	if !filters.CaseTypeUnassigned || !filters.HandlingOfficerUnassigned {
		t.Fatalf("unassigned flags = (%t, %t), want (true, true)", filters.CaseTypeUnassigned, filters.HandlingOfficerUnassigned)
	}
}

func TestParseLegalCaseListFiltersSupportsExpectedResolutionWindow(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/legal-cases?expected_resolution_from=2026-08-01&expected_resolution_to=2026-08-31&sort=expected_resolution_date&order=asc",
		nil,
	)

	filters, err := parseLegalCaseListFilters(req)
	if err != nil {
		t.Fatalf("parseLegalCaseListFilters() error = %v", err)
	}
	if filters.ExpectedResolutionFrom == nil || filters.ExpectedResolutionFrom.Format("2006-01-02") != "2026-08-01" {
		t.Fatalf("ExpectedResolutionFrom = %v", filters.ExpectedResolutionFrom)
	}
	if filters.ExpectedResolutionTo == nil || filters.ExpectedResolutionTo.Format("2006-01-02") != "2026-08-31" {
		t.Fatalf("ExpectedResolutionTo = %v", filters.ExpectedResolutionTo)
	}
	if filters.SortColumn != "lc.expected_resolution_date" || filters.SortDirection != "asc" {
		t.Fatalf("sort = (%q, %q)", filters.SortColumn, filters.SortDirection)
	}
}

func TestParseContractListFiltersSupportsAnalyticsStatusGroups(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/contracts?status=active%2Crenewed%2Cpending_signature",
		nil,
	)

	filters, err := parseContractListFilters(req)
	if err != nil {
		t.Fatalf("parseContractListFilters() error = %v", err)
	}
	wantStatuses := []model.ContractStatus{"active", "renewed", "pending_signature"}
	if len(filters.Statuses) != len(wantStatuses) {
		t.Fatalf("Statuses = %v, want %v", filters.Statuses, wantStatuses)
	}
	for index, want := range wantStatuses {
		if filters.Statuses[index] != want {
			t.Fatalf("Statuses[%d] = %q, want %q", index, filters.Statuses[index], want)
		}
	}
}

func TestParseContractListFiltersSupportsAnalyticsBucketGroupsAndExpiry(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/contracts?type=nda%2Cvendor&department=Legal%2Cunspecified&expiry_from=2026-08-01&expiry_to=2026-09-01",
		nil,
	)

	filters, err := parseContractListFilters(req)
	if err != nil {
		t.Fatalf("parseContractListFilters() error = %v", err)
	}
	if len(filters.Types) != 2 || filters.Types[0] != "nda" || filters.Types[1] != "vendor" {
		t.Fatalf("Types = %v, want [nda vendor]", filters.Types)
	}
	if len(filters.Departments) != 2 || filters.Departments[0] != "Legal" || filters.Departments[1] != "unspecified" {
		t.Fatalf("Departments = %v, want [Legal unspecified]", filters.Departments)
	}
	if filters.ExpiryFrom == nil || filters.ExpiryTo == nil {
		t.Fatalf("expiry range = (%v, %v), want both bounds", filters.ExpiryFrom, filters.ExpiryTo)
	}
}

func TestParseContractListFiltersSupportsMonthlyActivityDrilldowns(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/contracts?created_from=2026-07-01&created_to=2026-08-01&status_changed_from=2026-06-01&status_changed_to=2026-07-01",
		nil,
	)

	filters, err := parseContractListFilters(req)
	if err != nil {
		t.Fatalf("parseContractListFilters() error = %v", err)
	}
	if filters.CreatedFrom == nil || filters.CreatedFrom.Format("2006-01-02") != "2026-07-01" {
		t.Fatalf("CreatedFrom = %v", filters.CreatedFrom)
	}
	if filters.CreatedTo == nil || filters.CreatedTo.Format("2006-01-02") != "2026-08-01" {
		t.Fatalf("CreatedTo = %v", filters.CreatedTo)
	}
	if filters.StatusFrom == nil || filters.StatusFrom.Format("2006-01-02") != "2026-06-01" {
		t.Fatalf("StatusFrom = %v", filters.StatusFrom)
	}
	if filters.StatusTo == nil || filters.StatusTo.Format("2006-01-02") != "2026-07-01" {
		t.Fatalf("StatusTo = %v", filters.StatusTo)
	}
}
