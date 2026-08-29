package handler

import (
	"net/http/httptest"
	"testing"
)

func TestParseServiceCatalogListFiltersPreservesRepeatedChannels(t *testing.T) {
	req := httptest.NewRequest("GET", "/service-catalog?channel=email&channel=both", nil)

	filters, err := parseServiceCatalogListFilters(req)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if got := len(filters.Channels); got != 2 {
		t.Fatalf("channels length = %d, want 2", got)
	}
	if filters.Channels[0] != "email" || filters.Channels[1] != "both" {
		t.Fatalf("channels = %#v, want [email both]", filters.Channels)
	}
}
