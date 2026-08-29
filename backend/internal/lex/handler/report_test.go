package handler

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestWriteMatterReportCSVShape(t *testing.T) {
	department := "Legal"
	dueDate := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	openedAt := time.Date(2026, 6, 1, 12, 30, 0, 0, time.UTC)
	createdAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	rr := httptest.NewRecorder()
	writeMatterReportCSV(rr, &model.MatterReport{
		Matters: []model.MatterSummary{{
			ID:           uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			MatterNumber: "MAT-20260614-AAAA1111",
			Title:        "Vendor dispute",
			Type:         model.MatterTypeLitigation,
			Status:       model.MatterStatusOpen,
			Priority:     model.LegalPriorityHigh,
			OwnerUserID:  uuid.MustParse("22222222-2222-2222-2222-222222222222"),
			OwnerName:    "Legal Owner",
			Department:   &department,
			OpenedAt:     openedAt,
			DueDate:      &dueDate,
			CreatedAt:    createdAt,
		}},
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want csv", got)
	}
	records, err := csv.NewReader(rr.Body).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	wantHeader := []string{"id", "matter_number", "title", "type", "status", "priority", "owner_user_id", "owner_name", "department", "opened_at", "due_date", "closed_at", "created_at"}
	if !reflect.DeepEqual(records[0], wantHeader) {
		t.Fatalf("header = %#v, want %#v", records[0], wantHeader)
	}
	wantRow := []string{
		"11111111-1111-1111-1111-111111111111",
		"MAT-20260614-AAAA1111",
		"Vendor dispute",
		"litigation",
		"open",
		"high",
		"22222222-2222-2222-2222-222222222222",
		"Legal Owner",
		"Legal",
		"2026-06-01T12:30:00Z",
		"2026-07-01",
		"",
		"2026-06-01T12:00:00Z",
	}
	if !reflect.DeepEqual(records[1], wantRow) {
		t.Fatalf("row = %#v, want %#v", records[1], wantRow)
	}
}

// NOTE: the contract report CSV shape test moved to
// contract_report_export_test.go — the export is now hardened (UTF-8 BOM,
// watermark record, verb-gated financial redaction) and is written by
// writeContractReportCSVHardened.

func TestWriteObligationReportCSVShape(t *testing.T) {
	contractTitle := "Managed Services Agreement"
	matterTitle := "Renewal matter"
	completedAt := time.Date(2026, 6, 14, 10, 30, 0, 0, time.UTC)
	dueDate := time.Date(2026, 6, 21, 0, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)

	rr := httptest.NewRecorder()
	writeObligationReportCSV(rr, &model.ObligationReport{
		Obligations: []model.ObligationSummary{{
			ID:            uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			Title:         "Submit renewal notice",
			Type:          model.ObligationTypeRenewal,
			Status:        model.ObligationStatusCompleted,
			Priority:      model.LegalPriorityMedium,
			OwnerUserID:   uuid.MustParse("44444444-4444-4444-4444-444444444444"),
			OwnerName:     "Contract Owner",
			ContractID:    uuidPtr("55555555-5555-5555-5555-555555555555"),
			ContractTitle: &contractTitle,
			MatterID:      uuidPtr("66666666-6666-6666-6666-666666666666"),
			MatterTitle:   &matterTitle,
			DueDate:       dueDate,
			DaysUntilDue:  7,
			CompletedAt:   &completedAt,
			CreatedAt:     createdAt,
		}},
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	records, err := csv.NewReader(rr.Body).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	wantHeader := []string{"id", "title", "type", "status", "priority", "owner_user_id", "owner_name", "contract_id", "contract_title", "matter_id", "matter_title", "due_date", "days_until_due", "completed_at", "created_at"}
	if !reflect.DeepEqual(records[0], wantHeader) {
		t.Fatalf("header = %#v, want %#v", records[0], wantHeader)
	}
	wantRow := []string{
		"33333333-3333-3333-3333-333333333333",
		"Submit renewal notice",
		"renewal",
		"completed",
		"medium",
		"44444444-4444-4444-4444-444444444444",
		"Contract Owner",
		"55555555-5555-5555-5555-555555555555",
		"Managed Services Agreement",
		"66666666-6666-6666-6666-666666666666",
		"Renewal matter",
		"2026-06-21",
		"7",
		"2026-06-14T10:30:00Z",
		"2026-06-01T09:00:00Z",
	}
	if !reflect.DeepEqual(records[1], wantRow) {
		t.Fatalf("row = %#v, want %#v", records[1], wantRow)
	}
}

func TestWritePerformanceKPIsCSVShape(t *testing.T) {
	from := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC)
	department := "Legal"
	status := "closed"
	typ := "litigation"

	rr := httptest.NewRecorder()
	writePerformanceKPIsCSV(rr, &model.PerformanceKPIs{
		GeneratedAt:                time.Date(2026, 6, 14, 11, 45, 0, 0, time.UTC),
		Filters:                    model.ReportFilters{From: &from, To: &to, Department: &department, Status: &status, Type: &typ},
		AvgRequestProcessingHours:  18.756,
		RequestProcessingSample:    12,
		ClosedCaseRatio:            0.625,
		TotalCases:                 40,
		ClosedCases:                25,
		ApprovedContractRatio:      0.8125,
		TotalContracts:             32,
		ApprovedContracts:          26,
		OverdueRequests:            3,
		EstimatedDurationAdherence: 0.9167,
		ResolvedClocks:             24,
		OnTimeClocks:               22,
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want csv", got)
	}
	if got := rr.Header().Get("Content-Disposition"); got != `attachment; filename="lex-performance-kpis.csv"` {
		t.Fatalf("Content-Disposition = %q, want performance csv attachment", got)
	}
	records, err := csv.NewReader(rr.Body).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	wantHeader := []string{"generated_at", "filter_from", "filter_to", "filter_department", "filter_status", "filter_type", "avg_request_processing_hours", "request_processing_sample", "closed_case_ratio", "total_cases", "closed_cases", "approved_contract_ratio", "total_contracts", "approved_contracts", "overdue_requests", "estimated_duration_adherence", "resolved_clocks", "on_time_clocks"}
	if !reflect.DeepEqual(records[0], wantHeader) {
		t.Fatalf("header = %#v, want %#v", records[0], wantHeader)
	}
	wantRow := []string{
		"2026-06-14T11:45:00Z",
		"2026-04-01T00:00:00Z",
		"2026-06-30T23:59:59Z",
		"Legal",
		"closed",
		"litigation",
		"18.76",
		"12",
		"0.6250",
		"40",
		"25",
		"0.8125",
		"32",
		"26",
		"3",
		"0.9167",
		"24",
		"22",
	}
	if !reflect.DeepEqual(records[1], wantRow) {
		t.Fatalf("row = %#v, want %#v", records[1], wantRow)
	}
}

func TestWritePerformanceKPIsXLSXShape(t *testing.T) {
	rr := httptest.NewRecorder()
	writePerformanceKPIsXLSX(rr, &model.PerformanceKPIs{
		GeneratedAt:               time.Date(2026, 6, 14, 11, 45, 0, 0, time.UTC),
		AvgRequestProcessingHours: 18.756,
		RequestProcessingSample:   12,
		TotalCases:                40,
		ClosedCases:               25,
	})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Fatalf("Content-Type = %q, want xlsx", got)
	}
	if got := rr.Header().Get("Content-Disposition"); got != `attachment; filename="lex-performance-kpis.xlsx"` {
		t.Fatalf("Content-Disposition = %q, want performance xlsx attachment", got)
	}

	zr, err := zip.NewReader(bytes.NewReader(rr.Body.Bytes()), int64(rr.Body.Len()))
	if err != nil {
		t.Fatalf("open xlsx zip: %v", err)
	}
	var worksheet string
	for _, file := range zr.File {
		if file.Name != "xl/worksheets/sheet1.xml" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			t.Fatalf("open worksheet: %v", err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read worksheet: %v", err)
		}
		worksheet = string(body)
		break
	}
	if worksheet == "" {
		t.Fatal("worksheet not found in xlsx")
	}
	for _, want := range []string{"avg_request_processing_hours", "18.76", "request_processing_sample", "12"} {
		if !strings.Contains(worksheet, want) {
			t.Fatalf("worksheet missing %q: %s", want, worksheet)
		}
	}
}

func TestParseDetailedAnalyticsQuery(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet,
		"/reports/detailed-analytics?from=2026-01-01&to=2026-07-22&department=Legal&priority=urgent&type=consultation&compare=false",
		nil,
	)
	filters, compare, err := parseDetailedAnalyticsQuery(req)
	if err != nil {
		t.Fatalf("parse query: %v", err)
	}
	if compare {
		t.Fatal("compare = true, want false")
	}
	if got := filters.From.Format("2006-01-02"); got != "2026-01-01" {
		t.Fatalf("from = %q", got)
	}
	if got := filters.To.Format("2006-01-02"); got != "2026-07-22" {
		t.Fatalf("to = %q", got)
	}
	if filters.Department == nil || *filters.Department != "Legal" ||
		filters.Priority == nil || *filters.Priority != "urgent" ||
		filters.Type == nil || *filters.Type != "consultation" {
		t.Fatalf("filters were not preserved: %#v", filters)
	}
}

func TestParseDetailedAnalyticsQueryRejectsInvalidCompare(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/reports/detailed-analytics?compare=sometimes", nil)
	if _, _, err := parseDetailedAnalyticsQuery(req); err == nil {
		t.Fatal("expected invalid compare value to fail")
	}
}

func TestWriteDetailedAnalyticsCSVDoesNotInventUnavailableValue(t *testing.T) {
	previous := 4.75
	rr := httptest.NewRecorder()
	writeDetailedAnalyticsCSV(rr, &model.DetailedAnalyticsDashboard{
		GeneratedAt: time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC),
		Period: model.AnalyticsPeriod{
			From: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
			To:   time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC),
		},
		Summary: model.DetailedAnalyticsSummary{
			SatisfactionScore: model.AnalyticsMetric{
				Available:         false,
				SampleSize:        0,
				PreviousValue:     &previous,
				PreviousAvailable: true,
			},
		},
	})
	records, err := csv.NewReader(rr.Body).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	var satisfaction []string
	for _, record := range records {
		if len(record) > 1 && record[0] == "summary" && record[1] == "satisfaction_score" {
			satisfaction = record
			break
		}
	}
	if satisfaction == nil {
		t.Fatal("satisfaction row not found")
	}
	if satisfaction[2] != "" || satisfaction[3] != "0" || satisfaction[4] != "4.75" {
		t.Fatalf("satisfaction row = %#v, want empty current value and real previous value", satisfaction)
	}
}

func uuidPtr(raw string) *uuid.UUID {
	value := uuid.MustParse(raw)
	return &value
}

func float64Ptr(value float64) *float64 {
	return &value
}
