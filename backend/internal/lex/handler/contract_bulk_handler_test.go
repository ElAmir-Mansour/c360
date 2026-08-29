package handler

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// The bulk filter object must resolve through parseContractListFilters — the
// SAME query-builder behind GET /contracts and the GET /reports/contracts CSV
// export — so a bulk-by-filter mutation selects exactly what the list showed.
func TestContractFiltersFromBulkFilterMapsListParams(t *testing.T) {
	owner := uuid.New()
	filters, err := contractFiltersFromBulkFilter(map[string]any{
		"search":           "  renewal  ",
		"status":           "active",
		"type":             "nda",
		"risk_level":       "high",
		"owner_user_id":    owner.String(),
		"department":       "Legal",
		"tag":              "vendor",
		"expiring_in_days": float64(30), // JSON numbers decode as float64
	})
	if err != nil {
		t.Fatalf("contractFiltersFromBulkFilter() error = %v", err)
	}
	if filters.Search != "renewal" {
		t.Fatalf("Search = %q, want %q", filters.Search, "renewal")
	}
	if filters.Status == nil || *filters.Status != model.ContractStatusActive {
		t.Fatalf("Status = %v, want active", filters.Status)
	}
	if filters.Type == nil || *filters.Type != model.ContractTypeNDA {
		t.Fatalf("Type = %v, want nda", filters.Type)
	}
	if filters.RiskLevel == nil || string(*filters.RiskLevel) != "high" {
		t.Fatalf("RiskLevel = %v, want high", filters.RiskLevel)
	}
	if filters.OwnerUserID == nil || *filters.OwnerUserID != owner {
		t.Fatalf("OwnerUserID = %v, want %s", filters.OwnerUserID, owner)
	}
	if filters.Department != "Legal" {
		t.Fatalf("Department = %q, want %q", filters.Department, "Legal")
	}
	if filters.Tag != "vendor" {
		t.Fatalf("Tag = %q, want %q", filters.Tag, "vendor")
	}
	if filters.ExpiringInDays == nil || *filters.ExpiringInDays != 30 {
		t.Fatalf("ExpiringInDays = %v, want 30", filters.ExpiringInDays)
	}
}

func TestContractFiltersFromBulkFilterIgnoresPresentationKeys(t *testing.T) {
	filters, err := contractFiltersFromBulkFilter(map[string]any{
		"status":   "draft",
		"page":     float64(7),
		"per_page": float64(5),
		"sort":     "title",
		"order":    "asc",
	})
	if err != nil {
		t.Fatalf("contractFiltersFromBulkFilter() error = %v", err)
	}
	if filters.Status == nil || *filters.Status != model.ContractStatusDraft {
		t.Fatalf("Status = %v, want draft", filters.Status)
	}
	// page/per_page from the posted list state must never shrink the mutation
	// set: the parser falls back to its defaults and the bulk service repages.
	if filters.Page != 1 {
		t.Fatalf("Page = %d, want default 1 (posted page ignored)", filters.Page)
	}
}

func TestContractFiltersFromBulkFilterRejectsUnknownKey(t *testing.T) {
	_, err := contractFiltersFromBulkFilter(map[string]any{"statuz": "active"})
	if err == nil || !strings.Contains(err.Error(), `unsupported filter key "statuz"`) {
		t.Fatalf("error = %v, want unsupported-filter-key rejection", err)
	}
}

func TestContractFiltersFromBulkFilterRejectsInvalidValues(t *testing.T) {
	if _, err := contractFiltersFromBulkFilter(map[string]any{"owner_user_id": "not-a-uuid"}); err == nil {
		t.Fatal("expected invalid owner_user_id to be rejected by the reused query-builder")
	}
	if _, err := contractFiltersFromBulkFilter(map[string]any{"expiring_in_days": 1.5}); err == nil {
		t.Fatal("expected fractional expiring_in_days to be rejected")
	}
	if _, err := contractFiltersFromBulkFilter(map[string]any{"status": []any{"active"}}); err == nil {
		t.Fatal("expected non-scalar filter value to be rejected")
	}
}

func TestContractFiltersFromBulkFilterEmptyMeansUnfiltered(t *testing.T) {
	filters, err := contractFiltersFromBulkFilter(map[string]any{
		"status": "",  // blank -> not filtered
		"search": nil, // null -> not filtered
	})
	if err != nil {
		t.Fatalf("contractFiltersFromBulkFilter() error = %v", err)
	}
	if filters.Status != nil || filters.Search != "" {
		t.Fatalf("blank/null values must resolve as unfiltered, got %+v", filters)
	}
}
