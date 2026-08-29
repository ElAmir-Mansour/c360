package handler

import (
	"bytes"
	"context"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

func hardenedExportFixtureReport() *model.ContractReport {
	expiryDate := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 6, 14, 8, 30, 0, 0, time.UTC)
	return &model.ContractReport{
		Contracts: []model.ContractSummary{{
			ID:             uuid.MustParse("77777777-7777-7777-7777-777777777777"),
			Title:          "Managed Services Agreement",
			Type:           model.ContractTypeServiceAgreement,
			Status:         model.ContractStatusActive,
			PartyBName:     "Vendor LLC",
			TotalValue:     float64Ptr(1500000),
			Currency:       "SAR",
			RiskLevel:      model.RiskLevelHigh,
			RiskScore:      float64Ptr(72.25),
			ExpiryDate:     &expiryDate,
			CurrentVersion: 3,
			CreatedAt:      createdAt,
		}},
	}
}

func hardenedExportFixtureContext(showFinancials bool) contractReportExportContext {
	return contractReportExportContext{
		Tenant:         "aaaaaaaa-0000-0000-0000-000000000001",
		RequestedBy:    "ada@apexbank.demo",
		GeneratedAt:    time.Date(2026, 7, 9, 10, 15, 0, 0, time.UTC),
		ShowFinancials: showFinancials,
	}
}

func TestWriteContractReportCSVHardenedBOMAndWatermark(t *testing.T) {
	rr := httptest.NewRecorder()
	writeContractReportCSVHardened(rr, hardenedExportFixtureReport(), hardenedExportFixtureContext(true))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want csv", got)
	}
	if got := rr.Header().Get("Content-Disposition"); got != `attachment; filename="lex-contract-report.csv"` {
		t.Fatalf("Content-Disposition = %q, want contract csv attachment", got)
	}

	body := rr.Body.Bytes()
	if !bytes.HasPrefix(body, utf8BOM) {
		t.Fatalf("body does not start with UTF-8 BOM: % x", body[:3])
	}

	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(body, utf8BOM))).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("records = %d, want watermark + header + 1 row", len(records))
	}

	watermark := records[0]
	if watermark[0] != "# EXPORT WATERMARK" {
		t.Fatalf("watermark[0] = %q, want marker cell", watermark[0])
	}
	if watermark[1] != "tenant=aaaaaaaa-0000-0000-0000-000000000001" {
		t.Fatalf("watermark tenant = %q", watermark[1])
	}
	if watermark[2] != "requested_by=ada@apexbank.demo" {
		t.Fatalf("watermark requested_by = %q", watermark[2])
	}
	if watermark[3] != "generated_at=2026-07-09T10:15:00Z" {
		t.Fatalf("watermark generated_at = %q", watermark[3])
	}
	if watermark[4] != "PDPL — in-Kingdom data" {
		t.Fatalf("watermark notice = %q", watermark[4])
	}
	// Watermark record must be padded to the header width so strict csv
	// readers keep parsing the file.
	if len(watermark) != len(records[1]) {
		t.Fatalf("watermark width = %d, header width = %d", len(watermark), len(records[1]))
	}

	wantHeader := []string{"id", "title", "type", "status", "party_b_name", "total_value", "currency", "risk_level", "risk_score", "expiry_date", "current_version", "created_at"}
	if !reflect.DeepEqual(records[1], wantHeader) {
		t.Fatalf("header = %#v, want %#v", records[1], wantHeader)
	}
	wantRow := []string{
		"77777777-7777-7777-7777-777777777777",
		"Managed Services Agreement",
		"service_agreement",
		"active",
		"Vendor LLC",
		"1500000.00",
		"SAR",
		"high",
		"72.25",
		"2026-12-31",
		"3",
		"2026-06-14T08:30:00Z",
	}
	if !reflect.DeepEqual(records[2], wantRow) {
		t.Fatalf("row = %#v, want %#v", records[2], wantRow)
	}
}

func TestWriteContractReportCSVHardenedRedactsFinancials(t *testing.T) {
	rr := httptest.NewRecorder()
	writeContractReportCSVHardened(rr, hardenedExportFixtureReport(), hardenedExportFixtureContext(false))

	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(rr.Body.Bytes(), utf8BOM))).ReadAll()
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	row := records[2]
	// Column set stays identical; only the financial CELLS are masked.
	if row[5] != contractExportRedactedCell || row[6] != contractExportRedactedCell {
		t.Fatalf("financial cells = %q/%q, want masked", row[5], row[6])
	}
	for i, cell := range row {
		if i == 5 || i == 6 {
			continue
		}
		if cell == contractExportRedactedCell {
			t.Fatalf("non-financial cell %d unexpectedly masked", i)
		}
	}
	if strings.Contains(rr.Body.String(), "1500000") {
		t.Fatal("redacted export leaks the contract value")
	}
}

func TestRedactContractReportFinancialsStripsInPlace(t *testing.T) {
	report := hardenedExportFixtureReport()
	redactContractReportFinancials(report)
	if report.Contracts[0].TotalValue != nil {
		t.Fatal("TotalValue not stripped")
	}
	if report.Contracts[0].Currency != "" {
		t.Fatal("Currency not stripped")
	}
}

func TestNewContractReportExportContextVerbGate(t *testing.T) {
	tenantID := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")

	request := func(roles []string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/reports/contracts?format=csv", nil)
		ctx := auth.WithUser(context.Background(), &auth.ContextUser{
			ID:       "11111111-1111-1111-1111-111111111111",
			TenantID: tenantID.String(),
			Email:    "user@example.sa",
			Roles:    roles,
		})
		return r.WithContext(ctx)
	}

	// legal-contracts-manager holds lex:contract:approve (see legal_roles.go);
	// legal-contracts-supervisor deliberately does not.
	approver := newContractReportExportContext(request([]string{"legal-contracts-manager"}), tenantID)
	if !approver.ShowFinancials {
		t.Fatal("legal-contracts-manager (lex:contract:approve) should see financials")
	}
	reader := newContractReportExportContext(request([]string{"legal-contracts-supervisor"}), tenantID)
	if reader.ShowFinancials {
		t.Fatal("legal-contracts-supervisor must NOT see financials")
	}
	if reader.Tenant != tenantID.String() {
		t.Fatalf("tenant = %q, want %q", reader.Tenant, tenantID)
	}
	if reader.RequestedBy != "user@example.sa" {
		t.Fatalf("requested_by = %q, want claim email", reader.RequestedBy)
	}

	// Unauthenticated context (defensive; the route gate normally rejects
	// earlier): financials stay hidden and the watermark degrades gracefully.
	anonymous := newContractReportExportContext(httptest.NewRequest(http.MethodGet, "/reports/contracts", nil), tenantID)
	if anonymous.ShowFinancials {
		t.Fatal("anonymous caller must not see financials")
	}
	if anonymous.RequestedBy != "unknown" {
		t.Fatalf("anonymous requested_by = %q, want unknown", anonymous.RequestedBy)
	}
}
