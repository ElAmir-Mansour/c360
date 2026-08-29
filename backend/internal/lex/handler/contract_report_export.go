package handler

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

// This file hardens the GET /reports/contracts export (see
// contract_handler.ContractReport — part of the reports surface):
//
//  1. UTF-8 BOM prefix so Excel — the dominant consumer in KSA back offices —
//     detects the encoding and renders Arabic titles/party names correctly.
//  2. A leading watermark record naming the tenant, the requesting user and
//     the export timestamp, plus the PDPL residency notice, so any file that
//     leaves the platform is traceable to who exported it and carries its
//     data classification.
//  3. Verb-gated financial redaction: total_value/currency cells are masked
//     unless the caller holds lex:contract:approve (admin passes implicitly
//     via auth.HasPermission's admin:*/wildcard short-circuits). Rationale:
//     contract approvers are exactly the persona that must see financial
//     exposure to exercise their delegation of authority, while plain report
//     readers (lex:report:read / lex:read) get the full operational dataset
//     with the money columns masked. The column set is IDENTICAL either way
//     so downstream parsers stay stable and entitlement is not inferable
//     from the schema.

// contractExportRedactedCell is the mask emitted for financial cells the
// caller is not entitled to see.
const contractExportRedactedCell = "[REDACTED]"

// contractExportWatermarkNotice is the fixed PDPL residency/classification
// notice stamped on every export.
const contractExportWatermarkNotice = "PDPL — in-Kingdom data"

// contractReportExportContext carries the watermark identity and the
// redaction verdict for one export request.
type contractReportExportContext struct {
	Tenant         string
	RequestedBy    string
	GeneratedAt    time.Time
	ShowFinancials bool
}

// newContractReportExportContext resolves the watermark/redaction inputs from
// the authenticated request. Financial columns require lex:contract:approve
// (the DoA/approver verb); everything else about the report stays readable
// under the route's lex:report:read / lex:read gate.
func newContractReportExportContext(r *http.Request, tenantID uuid.UUID) contractReportExportContext {
	ec := contractReportExportContext{
		Tenant:      tenantID.String(),
		RequestedBy: "unknown",
		GeneratedAt: time.Now().UTC(),
	}
	if user := auth.UserFromContext(r.Context()); user != nil {
		if user.Email != "" {
			ec.RequestedBy = user.Email
		} else if user.ID != "" {
			ec.RequestedBy = user.ID
		}
		ec.ShowFinancials = auth.HasAnyPermissionCtx(r.Context(), user.Roles, auth.PermLexContractApprove)
	}
	return ec
}

// writeContractReportCSVHardened emits the hardened CSV export: UTF-8 BOM,
// then the watermark record, then the header row and data rows. The watermark
// record is padded to the header width so strict csv readers
// (FieldsPerRecord) keep parsing the file.
func writeContractReportCSVHardened(w http.ResponseWriter, report *model.ContractReport, ec contractReportExportContext) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-contract-report.csv"`)
	w.WriteHeader(http.StatusOK)

	// UTF-8 BOM (shared utf8BOM): Excel needs it to detect the encoding
	// (Arabic-safe).
	_, _ = w.Write(utf8BOM)

	writer := csv.NewWriter(w)
	headers := contractReportExportHeaders()
	_ = writer.Write(contractReportWatermarkRow(ec, len(headers)))
	_ = writer.Write(headers)
	for _, row := range contractReportExportRows(report, ec.ShowFinancials) {
		_ = writer.Write(row)
	}
	writer.Flush()
}

// contractReportWatermarkRow builds the leading watermark record, padded to
// the given width so every record in the file has the same field count.
func contractReportWatermarkRow(ec contractReportExportContext, width int) []string {
	row := make([]string, width)
	row[0] = "# EXPORT WATERMARK"
	row[1] = "tenant=" + ec.Tenant
	row[2] = "requested_by=" + ec.RequestedBy
	row[3] = "generated_at=" + ec.GeneratedAt.UTC().Format(time.RFC3339)
	row[4] = contractExportWatermarkNotice
	return row
}

// contractReportExportHeaders is the legacy contractReportHeaders column set
// plus the verb-gated financial columns (total_value, currency) inserted
// after party_b_name. The legacy list is kept as-is for the xlsx path.
func contractReportExportHeaders() []string {
	return []string{"id", "title", "type", "status", "party_b_name", "total_value", "currency", "risk_level", "risk_score", "expiry_date", "current_version", "created_at"}
}

// contractReportExportRows renders the data rows. Financial cells are masked
// with contractExportRedactedCell when showFinancials is false; all other
// cells match the legacy contractReportRows formatting exactly.
func contractReportExportRows(report *model.ContractReport, showFinancials bool) [][]string {
	rows := make([][]string, 0, len(report.Contracts))
	for _, item := range report.Contracts {
		totalValue := contractExportRedactedCell
		currency := contractExportRedactedCell
		if showFinancials {
			totalValue = ""
			if item.TotalValue != nil {
				totalValue = fmt.Sprintf("%.2f", *item.TotalValue)
			}
			currency = item.Currency
		}
		riskScore := ""
		if item.RiskScore != nil {
			riskScore = fmt.Sprintf("%.2f", *item.RiskScore)
		}
		expiryDate := ""
		if item.ExpiryDate != nil {
			expiryDate = item.ExpiryDate.Format("2006-01-02")
		}
		rows = append(rows, []string{
			item.ID.String(),
			item.Title,
			string(item.Type),
			string(item.Status),
			item.PartyBName,
			totalValue,
			currency,
			string(item.RiskLevel),
			riskScore,
			expiryDate,
			fmt.Sprintf("%d", item.CurrentVersion),
			item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return rows
}

// redactContractReportFinancials strips the financial fields in place for
// callers without the finance verb. It runs BEFORE any serialization (JSON,
// xlsx) so no response format leaks what the CSV masks; with omitempty the
// redacted JSON payload is byte-identical to the pre-upgrade one.
func redactContractReportFinancials(report *model.ContractReport) {
	for i := range report.Contracts {
		report.Contracts[i].TotalValue = nil
		report.Contracts[i].Currency = ""
	}
}
