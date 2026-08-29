package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestParseConsultationListFiltersSupportsKPIStatusGroups(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/api/v1/lex/consultations?status=submitted%2Cclassified%2Crouted",
		nil,
	)

	filters, err := parseConsultationListFilters(req)
	if err != nil {
		t.Fatalf("parseConsultationListFilters() error = %v", err)
	}
	wantStatuses := []model.ConsultationStatus{
		model.ConsultationStatusSubmitted,
		model.ConsultationStatusClassified,
		model.ConsultationStatusRouted,
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
