package handler

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ReportingHandler serves the Phase-4 analytics endpoints (CAP-133..151). The
// report routes are gated on report-read; sensitive consolidated dashboards can
// carry stricter domain-view intersections at route composition. CSV export is
// offered via ?format=csv on the tabular reports.
type ReportingHandler struct {
	baseHandler
	service *service.ReportingService
}

func NewReportingHandler(reporting *service.ReportingService, logger zerolog.Logger) *ReportingHandler {
	return &ReportingHandler{baseHandler: baseHandler{logger: logger}, service: reporting}
}

// CaseReport GET /reports/cases (CAP-133..138).
func (h *ReportingHandler) CaseReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.CaseReport(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeCountBucketsCSV(w, "lex-case-report.csv", "case", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	if wantsXLSX(r) {
		writeCountBucketsXLSX(w, "lex-case-report.xlsx", "case", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func validateInvestigationReportQuery(q dto.ReportQuery) error {
	if q.From != nil && q.To != nil && q.From.After(*q.To) {
		return fmt.Errorf("'from' date must not be after 'to' date")
	}
	if q.Status != nil && !model.InvestigationStatus(*q.Status).Valid() {
		return fmt.Errorf("invalid investigation 'status'")
	}
	return nil
}

// InvestigationReport GET /reports/investigations. Its item projection is
// intentionally non-sensitive because this route is available to report readers
// without granting investigation-record access.
func (h *ReportingHandler) InvestigationReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := validateInvestigationReportQuery(q); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.InvestigationReport(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeInvestigationReportCSV(w, report)
		return
	}
	if wantsXLSX(r) {
		writeInvestigationReportXLSX(w, report)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// CaseControlDashboard GET /dashboard/cases-control.
//
// The payload includes decrypted investigation subject/findings, so route
// composition requires BOTH case-view and investigation-view permissions. The
// handler deliberately has no alternate report-reader mount.
func (h *ReportingHandler) CaseControlDashboard(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	dashboard, err := h.service.CaseControlDashboard(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dashboard)
}

// ContractReport GET /reports/contracts (CAP-139..142).
func (h *ReportingHandler) ContractReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.ContractReport(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeCountBucketsCSV(w, "lex-contract-analytics.csv", "contract", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	if wantsXLSX(r) {
		writeCountBucketsXLSX(w, "lex-contract-analytics.xlsx", "contract", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// ConsultationReport GET /reports/consultations (CAP-143..145).
func (h *ReportingHandler) ConsultationReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.ConsultationReport(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeCountBucketsCSV(w, "lex-consultation-report.csv", "consultation", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	if wantsXLSX(r) {
		writeCountBucketsXLSX(w, "lex-consultation-report.xlsx", "consultation", report.ByStatus, report.ByType, report.ByDepartment)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// PerformanceKPIs GET /reports/performance (CAP-146..150).
func (h *ReportingHandler) PerformanceKPIs(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	kpis, err := h.service.PerformanceKPIs(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writePerformanceKPIsCSV(w, kpis)
		return
	}
	if wantsXLSX(r) {
		writePerformanceKPIsXLSX(w, kpis)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, kpis)
}

// SLACompliance GET /kpis/sla-compliance (CAP-151, flagship).
func (h *ReportingHandler) SLACompliance(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.SLACompliance(r.Context(), tenantID, q.AsModelFilters(), q.Quarters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeSLAComplianceCSV(w, report)
		return
	}
	if wantsXLSX(r) {
		writeSLAComplianceXLSX(w, report)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// LegalAffairsDashboard GET /dashboard/legal-affairs (consolidated).
func (h *ReportingHandler) LegalAffairsDashboard(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	q, err := parseReportQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dashboard, err := h.service.LegalAffairsDashboard(r.Context(), tenantID, q.AsModelFilters())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsXLSX(r) {
		writeLegalAffairsDashboardXLSX(w, dashboard)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dashboard)
}

// DetailedAnalytics GET /reports/detailed-analytics is the request-grain
// Director Legal dashboard and governed export surface.
func (h *ReportingHandler) DetailedAnalytics(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, compare, err := parseDetailedAnalyticsQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dashboard, err := h.service.DetailedAnalytics(r.Context(), tenantID, filters, compare)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if wantsCSV(r) {
		writeDetailedAnalyticsCSV(w, dashboard)
		return
	}
	if wantsXLSX(r) {
		writeDetailedAnalyticsXLSX(w, dashboard)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dashboard)
}

// DetailedAnalyticsContributors GET /reports/detailed-analytics/contributors
// returns the paginated source observations behind a selected KPI/chart bucket.
func (h *ReportingHandler) DetailedAnalyticsContributors(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, _, err := parseDetailedAnalyticsQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	query := r.URL.Query()
	items, total, err := h.service.DetailedAnalyticsContributors(
		r.Context(),
		tenantID,
		filters,
		query.Get("dimension"),
		query.Get("key"),
		query.Get("keys"),
		page,
		perPage,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

// --- query parsing & CSV helpers -------------------------------------------

func parseReportQuery(r *http.Request) (dto.ReportQuery, error) {
	query := r.URL.Query()
	q := dto.ReportQuery{Quarters: 4}

	from, err := parseOptionalDate(query.Get("from"))
	if err != nil {
		return q, fmt.Errorf("invalid 'from' date")
	}
	q.From = from

	to, err := parseOptionalDate(query.Get("to"))
	if err != nil {
		return q, fmt.Errorf("invalid 'to' date")
	}
	// Treat 'to' as inclusive end-of-day so a date-only bound includes that day.
	if to != nil {
		eod := to.Add(24*time.Hour - time.Nanosecond)
		q.To = &eod
	}

	q.Department = optionalTrim(query.Get("department"))
	q.Status = optionalTrim(query.Get("status"))
	q.Type = optionalTrim(query.Get("type"))

	if raw := strings.TrimSpace(query.Get("quarters")); raw != "" {
		n, perr := strconv.Atoi(raw)
		if perr != nil {
			return q, fmt.Errorf("invalid 'quarters' value")
		}
		q.Quarters = n
	}
	if q.Quarters < 1 {
		q.Quarters = 1
	}
	if q.Quarters > 12 {
		q.Quarters = 12
	}
	return q, nil
}

func parseDetailedAnalyticsQuery(r *http.Request) (model.DetailedAnalyticsFilters, bool, error) {
	query := r.URL.Query()
	filters := model.DetailedAnalyticsFilters{}
	from, err := parseOptionalDate(query.Get("from"))
	if err != nil {
		return filters, false, fmt.Errorf("invalid 'from' date")
	}
	if from != nil {
		filters.From = *from
	}
	to, err := parseOptionalDate(query.Get("to"))
	if err != nil {
		return filters, false, fmt.Errorf("invalid 'to' date")
	}
	if to != nil {
		filters.To = *to
	}
	filters.Department = optionalTrim(query.Get("department"))
	filters.Priority = optionalTrim(query.Get("priority"))
	filters.Type = optionalTrim(query.Get("type"))
	compare := true
	if raw := strings.TrimSpace(query.Get("compare")); raw != "" {
		parsed, parseErr := strconv.ParseBool(raw)
		if parseErr != nil {
			return filters, false, fmt.Errorf("invalid 'compare' value")
		}
		compare = parsed
	}
	return filters, compare, nil
}

func optionalTrim(raw string) *string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func wantsCSV(r *http.Request) bool {
	return strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "csv")
}

func wantsXLSX(r *http.Request) bool {
	return strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "xlsx")
}

// writeCountBucketsCSV emits a flat dimension/key/count CSV for the three core
// breakdowns of a tabular report (status, type, department).
func writeCountBucketsCSV(w http.ResponseWriter, filename, subject string, byStatus, byType, byDept []model.CountBucket) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"subject", "dimension", "key", "count"})
	emit := func(dimension string, buckets []model.CountBucket) {
		for _, b := range buckets {
			_ = writer.Write([]string{subject, dimension, b.Key, strconv.Itoa(b.Count)})
		}
	}
	emit("status", byStatus)
	emit("type", byType)
	emit("department", byDept)
	writer.Flush()
}

func writeCountBucketsXLSX(w http.ResponseWriter, filename, subject string, byStatus, byType, byDept []model.CountBucket) {
	rows := make([][]string, 0, len(byStatus)+len(byType)+len(byDept))
	emit := func(dimension string, buckets []model.CountBucket) {
		for _, b := range buckets {
			rows = append(rows, []string{subject, dimension, b.Key, strconv.Itoa(b.Count)})
		}
	}
	emit("status", byStatus)
	emit("type", byType)
	emit("department", byDept)
	writeSimpleXLSX(w, filename, "Report", []string{"subject", "dimension", "key", "count"}, rows)
}

func writeInvestigationReportCSV(w http.ResponseWriter, report *model.InvestigationReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-investigation-report.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write(investigationReportHeaders())
	for _, row := range investigationReportRows(report) {
		_ = writer.Write(row)
	}
	writer.Flush()
}

func writeInvestigationReportXLSX(w http.ResponseWriter, report *model.InvestigationReport) {
	writeSimpleXLSX(
		w,
		"lex-investigation-report.xlsx",
		"Investigations",
		investigationReportHeaders(),
		investigationReportRows(report),
	)
}

func investigationReportHeaders() []string {
	return []string{
		"generated_at",
		"filter_from",
		"filter_to",
		"filter_department",
		"filter_status",
		"filter_type",
		"investigation_number",
		"status",
		"category",
		"priority",
		"department",
		"created_at",
		"resolved_at",
		"age_days",
		"sla_outcome",
	}
}

func investigationReportRows(report *model.InvestigationReport) [][]string {
	rows := make([][]string, 0, len(report.Items))
	for _, item := range report.Items {
		resolvedAt := ""
		if item.ResolvedAt != nil {
			resolvedAt = item.ResolvedAt.UTC().Format(time.RFC3339)
		}
		slaOutcome := ""
		if item.SLAOutcome != nil {
			slaOutcome = string(*item.SLAOutcome)
		}
		rows = append(rows, []string{
			report.GeneratedAt.UTC().Format(time.RFC3339),
			reportTime(report.Filters.From),
			reportTime(report.Filters.To),
			reportString(report.Filters.Department),
			reportString(report.Filters.Status),
			reportString(report.Filters.Type),
			item.InvestigationNumber,
			string(item.Status),
			item.Category,
			string(item.Priority),
			reportString(item.Department),
			item.CreatedAt.UTC().Format(time.RFC3339),
			resolvedAt,
			fmt.Sprintf("%.2f", item.AgeDays),
			slaOutcome,
		})
	}
	return rows
}

func writePerformanceKPIsCSV(w http.ResponseWriter, kpis *model.PerformanceKPIs) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-performance-kpis.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	headers, row := performanceKPIRow(kpis)
	_ = writer.Write(headers)
	_ = writer.Write(row)
	writer.Flush()
}

func writePerformanceKPIsXLSX(w http.ResponseWriter, kpis *model.PerformanceKPIs) {
	headers, row := performanceKPIRow(kpis)
	writeSimpleXLSX(w, "lex-performance-kpis.xlsx", "Performance", headers, [][]string{row})
}

func performanceKPIRow(kpis *model.PerformanceKPIs) ([]string, []string) {
	return []string{
			"generated_at",
			"filter_from",
			"filter_to",
			"filter_department",
			"filter_status",
			"filter_type",
			"avg_request_processing_hours",
			"request_processing_sample",
			"closed_case_ratio",
			"total_cases",
			"closed_cases",
			"approved_contract_ratio",
			"total_contracts",
			"approved_contracts",
			"overdue_requests",
			"estimated_duration_adherence",
			"resolved_clocks",
			"on_time_clocks",
		}, []string{
			kpis.GeneratedAt.UTC().Format(time.RFC3339),
			reportTime(kpis.Filters.From),
			reportTime(kpis.Filters.To),
			reportString(kpis.Filters.Department),
			reportString(kpis.Filters.Status),
			reportString(kpis.Filters.Type),
			fmt.Sprintf("%.2f", kpis.AvgRequestProcessingHours),
			strconv.Itoa(kpis.RequestProcessingSample),
			fmt.Sprintf("%.4f", kpis.ClosedCaseRatio),
			strconv.Itoa(kpis.TotalCases),
			strconv.Itoa(kpis.ClosedCases),
			fmt.Sprintf("%.4f", kpis.ApprovedContractRatio),
			strconv.Itoa(kpis.TotalContracts),
			strconv.Itoa(kpis.ApprovedContracts),
			strconv.Itoa(kpis.OverdueRequests),
			fmt.Sprintf("%.4f", kpis.EstimatedDurationAdherence),
			strconv.Itoa(kpis.ResolvedClocks),
			strconv.Itoa(kpis.OnTimeClocks),
		}
}

func writeSLAComplianceCSV(w http.ResponseWriter, report *model.SLAComplianceReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-sla-compliance.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"quarter", "received", "on_time", "breached", "pending", "rate_pct", "target_pct", "meets_target"})
	for _, q := range report.Quarters {
		_ = writer.Write([]string{
			q.Quarter,
			strconv.Itoa(q.Received),
			strconv.Itoa(q.OnTime),
			strconv.Itoa(q.Breached),
			strconv.Itoa(q.Pending),
			fmt.Sprintf("%.1f", q.RatePct),
			fmt.Sprintf("%.1f", q.TargetPct),
			strconv.FormatBool(q.MeetsTarget),
		})
	}
	writer.Flush()
}

func writeSLAComplianceXLSX(w http.ResponseWriter, report *model.SLAComplianceReport) {
	rows := make([][]string, 0, len(report.Quarters))
	for _, q := range report.Quarters {
		rows = append(rows, []string{
			q.Quarter,
			strconv.Itoa(q.Received),
			strconv.Itoa(q.OnTime),
			strconv.Itoa(q.Breached),
			strconv.Itoa(q.Pending),
			fmt.Sprintf("%.1f", q.RatePct),
			fmt.Sprintf("%.1f", q.TargetPct),
			strconv.FormatBool(q.MeetsTarget),
		})
	}
	writeSimpleXLSX(w, "lex-sla-compliance.xlsx", "SLA", []string{"quarter", "received", "on_time", "breached", "pending", "rate_pct", "target_pct", "meets_target"}, rows)
}

func writeDetailedAnalyticsCSV(w http.ResponseWriter, dashboard *model.DetailedAnalyticsDashboard) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-detailed-analytics.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"section", "key", "value", "sample_size", "previous_value"})
	for _, row := range detailedAnalyticsRows(dashboard) {
		_ = writer.Write(row)
	}
	writer.Flush()
}

func writeDetailedAnalyticsXLSX(w http.ResponseWriter, dashboard *model.DetailedAnalyticsDashboard) {
	writeSimpleXLSX(w, "lex-detailed-analytics.xlsx", "Detailed Analytics",
		[]string{"section", "key", "value", "sample_size", "previous_value"},
		detailedAnalyticsRows(dashboard))
}

func detailedAnalyticsRows(dashboard *model.DetailedAnalyticsDashboard) [][]string {
	rows := [][]string{
		{"meta", "generated_at", dashboard.GeneratedAt.UTC().Format(time.RFC3339), "", ""},
		{"meta", "period", dashboard.Period.From.Format("2006-01-02") + "/" + dashboard.Period.To.Format("2006-01-02"), "", ""},
	}
	metrics := []struct {
		key    string
		metric model.AnalyticsMetric
	}{
		{"total_requests", dashboard.Summary.TotalRequests},
		{"completion_rate_pct", dashboard.Summary.CompletionRate},
		{"avg_processing_hours", dashboard.Summary.AvgProcessingHours},
		{"satisfaction_score", dashboard.Summary.SatisfactionScore},
		{"sla_compliance_pct", dashboard.Summary.SLACompliance},
		{"pending_requests", dashboard.Summary.PendingRequests},
	}
	for _, item := range metrics {
		previous := ""
		if item.metric.PreviousValue != nil {
			previous = fmt.Sprintf("%.2f", *item.metric.PreviousValue)
		}
		value := ""
		if item.metric.Available {
			value = fmt.Sprintf("%.2f", item.metric.Value)
		}
		rows = append(rows, []string{"summary", item.key, value, strconv.Itoa(item.metric.SampleSize), previous})
	}
	for _, point := range dashboard.MonthlyTrend {
		previous := ""
		if point.PreviousCount != nil {
			previous = strconv.Itoa(*point.PreviousCount)
		}
		rows = append(rows, []string{"monthly_trend", point.PeriodStart.Format("2006-01"), strconv.Itoa(point.Count), "", previous})
	}
	for _, bucket := range dashboard.ByDepartment {
		rows = append(rows, []string{"department", bucket.Key, strconv.Itoa(bucket.Count), "", ""})
	}
	for _, bucket := range dashboard.ByServiceType {
		rows = append(rows, []string{"service_type", bucket.Key, strconv.Itoa(bucket.Count), "", ""})
	}
	for _, advisor := range dashboard.AdvisorPerformance {
		rating := ""
		if advisor.AverageRating != nil {
			rating = fmt.Sprintf("%.2f", *advisor.AverageRating)
		}
		rows = append(rows, []string{"advisor", advisor.AdvisorName, strconv.Itoa(advisor.Completed), strconv.Itoa(advisor.TotalRequests), rating})
	}
	return rows
}

func writeLegalAffairsDashboardXLSX(w http.ResponseWriter, dashboard *model.LegalAffairsDashboard) {
	rows := [][]string{
		{"dashboard", "generated_at", dashboard.GeneratedAt.UTC().Format(time.RFC3339)},
		{"sla", "current_quarter_rate_pct", fmt.Sprintf("%.1f", dashboard.CurrentQuarterRate)},
	}
	if dashboard.Cases != nil {
		rows = append(rows,
			[]string{"cases", "total", strconv.Itoa(dashboard.Cases.Total)},
			[]string{"cases", "closed", strconv.Itoa(dashboard.Cases.Closed)},
			[]string{"cases", "under_procedure", strconv.Itoa(dashboard.Cases.UnderProcedure)},
		)
	}
	if dashboard.Contracts != nil {
		rows = append(rows,
			[]string{"contracts", "total", strconv.Itoa(dashboard.Contracts.Total)},
			[]string{"contracts", "avg_review_duration_hours", fmt.Sprintf("%.2f", dashboard.Contracts.AvgReviewDurationHours)},
		)
	}
	if dashboard.Consultations != nil {
		rows = append(rows,
			[]string{"consultations", "total", strconv.Itoa(dashboard.Consultations.Total)},
			[]string{"consultations", "avg_completion_time_hours", fmt.Sprintf("%.2f", dashboard.Consultations.AvgCompletionTimeHours)},
		)
	}
	if dashboard.Performance != nil {
		rows = append(rows,
			[]string{"performance", "avg_request_processing_hours", fmt.Sprintf("%.2f", dashboard.Performance.AvgRequestProcessingHours)},
			[]string{"performance", "overdue_requests", strconv.Itoa(dashboard.Performance.OverdueRequests)},
			[]string{"performance", "duration_adherence", fmt.Sprintf("%.4f", dashboard.Performance.EstimatedDurationAdherence)},
		)
	}
	if dashboard.SLACompliance != nil {
		rows = append(rows,
			[]string{"sla", "overall_rate_pct", fmt.Sprintf("%.1f", dashboard.SLACompliance.OverallRatePct)},
			[]string{"sla", "overall_meets_target", strconv.FormatBool(dashboard.SLACompliance.OverallMeets)},
		)
	}
	writeSimpleXLSX(w, "lex-legal-affairs-dashboard.xlsx", "Overview", []string{"section", "metric", "value"}, rows)
}

func reportTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func reportString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func writeSimpleXLSX(w http.ResponseWriter, filename, sheetName string, headers []string, rows [][]string) {
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)

	zw := zip.NewWriter(w)
	writeZipFile(zw, "[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
	writeZipFile(zw, "_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
	writeZipFile(zw, "xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
	writeZipFile(zw, "xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="`+xlsxEscapeAttr(sheetName)+`" sheetId="1" r:id="rId1"/></sheets></workbook>`)
	writeZipFile(zw, "xl/worksheets/sheet1.xml", buildWorksheetXML(headers, rows))
	_ = zw.Close()
}

func writeZipFile(zw *zip.Writer, name, body string) {
	f, err := zw.Create(name)
	if err != nil {
		return
	}
	_, _ = f.Write([]byte(body))
}

func buildWorksheetXML(headers []string, rows [][]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	writeXLSXRow(&b, 1, headers)
	for i, row := range rows {
		writeXLSXRow(&b, i+2, row)
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func writeXLSXRow(b *strings.Builder, rowNumber int, values []string) {
	b.WriteString(`<row r="`)
	b.WriteString(strconv.Itoa(rowNumber))
	b.WriteString(`">`)
	for i, value := range values {
		b.WriteString(`<c r="`)
		b.WriteString(xlsxColumnName(i + 1))
		b.WriteString(strconv.Itoa(rowNumber))
		b.WriteString(`" t="inlineStr"><is><t>`)
		b.WriteString(xlsxEscapeText(value))
		b.WriteString(`</t></is></c>`)
	}
	b.WriteString(`</row>`)
}

func xlsxColumnName(index int) string {
	name := ""
	for index > 0 {
		index--
		name = string(rune('A'+index%26)) + name
		index /= 26
	}
	return name
}

func xlsxEscapeText(value string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func xlsxEscapeAttr(value string) string {
	return strings.ReplaceAll(xlsxEscapeText(value), `"`, "&quot;")
}
