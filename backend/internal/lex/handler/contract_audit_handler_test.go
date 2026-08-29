package handler

import (
	"bytes"
	"encoding/csv"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestWriteContractAuditCSVShape(t *testing.T) {
	before := "draft"
	after := "active"
	actor := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	occurredAt := time.Date(2026, 7, 1, 9, 30, 0, 0, time.UTC)

	rr := httptest.NewRecorder()
	writeContractAuditCSV(rr, []model.ContractAuditEvent{{
		ID:            "11111111-1111-1111-1111-111111111111:status:active",
		TenantID:      uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001"),
		ContractID:    uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		ContractTitle: "Master Services Agreement",
		EventType:     model.ContractAuditEventStatusChanged,
		Field:         "status",
		Before:        &before,
		After:         &after,
		ActorUserID:   &actor,
		OccurredAt:    occurredAt,
		Source:        "contracts.status_changed_at",
		Detail:        map[string]any{},
	}})

	if got := rr.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want csv", got)
	}
	body := rr.Body.Bytes()
	if !bytes.HasPrefix(body, utf8BOM) {
		t.Fatalf("csv body missing UTF-8 BOM prefix, got %v", body[:3])
	}
	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(body, utf8BOM))).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	wantHeader := []string{"occurred_at", "contract_id", "contract_title", "event_type", "field", "before", "after", "actor_user_id", "source", "detail"}
	if !reflect.DeepEqual(records[0], wantHeader) {
		t.Fatalf("header = %#v, want %#v", records[0], wantHeader)
	}
	wantRow := []string{
		"2026-07-01T09:30:00Z",
		"11111111-1111-1111-1111-111111111111",
		"Master Services Agreement",
		"status_changed",
		"status",
		"draft",
		"active",
		"22222222-2222-2222-2222-222222222222",
		"contracts.status_changed_at",
		"",
	}
	if !reflect.DeepEqual(records[1], wantRow) {
		t.Fatalf("row = %#v, want %#v", records[1], wantRow)
	}
}

func TestParseContractAuditFiltersWindowAndRiskAlias(t *testing.T) {
	r := httptest.NewRequest("GET", "/contracts/audit?status=active&type=vendor&risk=high&department=Legal&tag=strategic&search=msa&from=2026-06-01&to=2026-06-30", nil)
	filters, err := parseContractAuditFilters(r)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if filters.Status == nil || *filters.Status != model.ContractStatusActive {
		t.Fatalf("status = %v, want active", filters.Status)
	}
	if filters.Type == nil || *filters.Type != model.ContractTypeVendor {
		t.Fatalf("type = %v, want vendor", filters.Type)
	}
	if filters.RiskLevel == nil || string(*filters.RiskLevel) != "high" {
		t.Fatalf("risk alias not applied: %v", filters.RiskLevel)
	}
	if filters.Department != "Legal" || filters.Tag != "strategic" || filters.Search != "msa" {
		t.Fatalf("list filters not carried: %+v", filters.ContractListFilters)
	}
	wantFrom := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	if filters.From == nil || !filters.From.Equal(wantFrom) {
		t.Fatalf("from = %v, want %v", filters.From, wantFrom)
	}
	// Date-only 'to' is inclusive end-of-day: exclusive bound at next midnight.
	wantTo := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	if filters.To == nil || !filters.To.Equal(wantTo) {
		t.Fatalf("to = %v, want %v", filters.To, wantTo)
	}
}

func TestParseContractAuditFiltersRiskLevelWinsOverAlias(t *testing.T) {
	r := httptest.NewRequest("GET", "/contracts/audit?risk_level=medium&risk=high", nil)
	filters, err := parseContractAuditFilters(r)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if filters.RiskLevel == nil || string(*filters.RiskLevel) != "medium" {
		t.Fatalf("risk_level = %v, want medium (explicit param wins over alias)", filters.RiskLevel)
	}
}

func TestParseContractAuditFiltersInvalidDates(t *testing.T) {
	for _, target := range []string{"/contracts/audit?from=not-a-date", "/contracts/audit?to=2026-13-99"} {
		r := httptest.NewRequest("GET", target, nil)
		if _, err := parseContractAuditFilters(r); err == nil {
			t.Fatalf("expected error for %s", target)
		}
	}
}
