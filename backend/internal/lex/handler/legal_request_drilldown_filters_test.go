package handler

import (
	"net/http/httptest"
	"testing"
)

func TestParseLegalRequestListFiltersSupportsKPIStatusGroupsAndUpdatedRange(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/legal-requests?status=pending_requester_approval%2Cpending_provider_approval&updated_from=2026-08-01&updated_to=2026-08-02",
		nil,
	)

	filters, err := parseLegalRequestListFilters(req)
	if err != nil {
		t.Fatalf("parseLegalRequestListFilters() error = %v", err)
	}
	if len(filters.Statuses) != 2 || filters.Statuses[0] != "pending_requester_approval" || filters.Statuses[1] != "pending_provider_approval" {
		t.Fatalf("Statuses = %v, want pending requester/provider", filters.Statuses)
	}
	if filters.UpdatedFrom == nil || filters.UpdatedTo == nil {
		t.Fatalf("updated range = (%v, %v), want both bounds", filters.UpdatedFrom, filters.UpdatedTo)
	}
}
