package dto

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

func makeRequest(params map[string]string) *http.Request {
	u := &url.URL{Path: "/api/v1/audit/logs"}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return &http.Request{URL: u}
}

func recentDateFrom() string {
	return time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
}

func TestQueryParams_Validate_MissingDateFrom(t *testing.T) {
	r := makeRequest(map[string]string{})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for missing date_from")
	}
}

func TestQueryParams_Validate_ExcessiveDateRange(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": "2025-01-01T00:00:00Z",
		"date_to":   "2025-06-01T00:00:00Z", // > 93 days
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for date range > 93 days")
	}
}

func TestQueryParams_Validate_InvalidSortField(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": "2026-03-01T00:00:00Z",
		"sort":      "DROP TABLE",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for invalid sort field")
	}
}

func TestQueryParams_Validate_ValidSortFields(t *testing.T) {
	validFields := []string{"created_at", "action", "severity", "service"}
	for _, field := range validFields {
		r := makeRequest(map[string]string{
			"date_from": recentDateFrom(),
			"sort":      field,
		})
		qp, err := ParseQueryParams(r)
		if err != nil {
			t.Errorf("expected valid sort field %q to be accepted, got error: %v", field, err)
		}
		if qp.Sort != field {
			t.Errorf("expected sort %q, got %q", field, qp.Sort)
		}
	}
}

func TestQueryParams_Validate_WildcardAction(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"action":    "user.login.*",
	})
	qp, err := ParseQueryParams(r)
	if err != nil {
		t.Fatalf("expected wildcard action to be accepted: %v", err)
	}
	if qp.Action != "user.login.*" {
		t.Errorf("expected action user.login.*, got %s", qp.Action)
	}
}

func TestQueryParams_Validate_InvalidWildcard(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"action":    "user.*.login",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for mid-string wildcard")
	}
}

func TestQueryParams_Validate_PerPageClamped(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"per_page":  "999",
	})
	qp, err := ParseQueryParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qp.PerPage != 200 {
		t.Errorf("expected per_page clamped to 200, got %d", qp.PerPage)
	}
}

func TestQueryParams_Validate_DefaultValues(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
	})
	qp, err := ParseQueryParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qp.Sort != "created_at" {
		t.Errorf("expected default sort 'created_at', got %s", qp.Sort)
	}
	if qp.Order != "desc" {
		t.Errorf("expected default order 'desc', got %s", qp.Order)
	}
	if qp.Page != 1 {
		t.Errorf("expected default page 1, got %d", qp.Page)
	}
	if qp.PerPage != 50 {
		t.Errorf("expected default per_page 50, got %d", qp.PerPage)
	}
}

func TestQueryParams_Validate_InvalidOrder(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"order":     "random",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for invalid order")
	}
}

func TestQueryParams_Validate_InvalidSeverity(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"severity":  "extreme",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for invalid severity")
	}
}

func TestQueryParams_Validate_InvalidUserID(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"user_id":   "not-a-uuid",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error for invalid user_id")
	}
}

func TestQueryParams_Validate_OffsetTimestampAndUserID(t *testing.T) {
	dateFrom := time.Now().Add(-time.Hour).In(time.FixedZone("WAT", 60*60)).Format(time.RFC3339)
	r := makeRequest(map[string]string{
		"date_from": dateFrom,
		"user_id":   "bbbbbbbb-0000-0000-0000-000000000001",
	})
	qp, err := ParseQueryParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qp.UserID != "bbbbbbbb-0000-0000-0000-000000000001" {
		t.Errorf("expected user_id to round-trip, got %q", qp.UserID)
	}
}

func TestQueryParams_Offset(t *testing.T) {
	qp := &QueryParams{Page: 3, PerPage: 50}
	if qp.Offset() != 100 {
		t.Errorf("expected offset 100, got %d", qp.Offset())
	}
}

func TestNewPagination(t *testing.T) {
	p := NewPagination(2, 50, 150)
	if p.Page != 2 {
		t.Errorf("expected page 2, got %d", p.Page)
	}
	if p.PerPage != 50 {
		t.Errorf("expected per_page 50, got %d", p.PerPage)
	}
	if p.Total != 150 {
		t.Errorf("expected total 150, got %d", p.Total)
	}
	if p.TotalPages != 3 {
		t.Errorf("expected last_page 3, got %d", p.TotalPages)
	}
}

func TestQueryParams_Validate_DateToBeforeDateFrom(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": "2026-03-06T00:00:00Z",
		"date_to":   "2026-03-01T00:00:00Z",
	})
	_, err := ParseQueryParams(r)
	if err == nil {
		t.Fatal("expected error when date_to is before date_from")
	}
}

func TestQueryParams_SearchSanitization(t *testing.T) {
	r := makeRequest(map[string]string{
		"date_from": recentDateFrom(),
		"search":    "john'; DROP TABLE--",
	})
	qp, err := ParseQueryParams(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should have removed dangerous characters
	if qp.Search == "john'; DROP TABLE--" {
		t.Error("search should be sanitized")
	}
}
