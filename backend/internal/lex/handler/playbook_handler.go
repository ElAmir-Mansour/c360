package handler

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// PlaybookHandler exposes clause playbook CRUD and clause-level deviation
// detection (WTQ-RSK-02).
type PlaybookHandler struct {
	baseHandler
	service  *service.PlaybookService
	approval *service.PlaybookApprovalService
}

func NewPlaybookHandler(svc *service.PlaybookService, logger zerolog.Logger) *PlaybookHandler {
	return &PlaybookHandler{
		baseHandler: baseHandler{logger: logger},
		service:     svc,
	}
}

// WithApproval wires the playbook approval service (WTQ-RSK-02 #9). Chainable and
// nil-safe: when unset, the approval endpoints return 503.
func (h *PlaybookHandler) WithApproval(approval *service.PlaybookApprovalService) *PlaybookHandler {
	h.approval = approval
	return h
}

func (h *PlaybookHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	// sort/order are allowlist-validated against the playbook sort columns; an
	// unknown sort falls back to the default ordering inside the repository.
	sortCol, sortDir := suiteapi.ParseSort(r, repository.PlaybookSortColumns, "", "desc")
	filters := model.PlaybookListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("contract_type")); raw != "" {
		ct := model.ContractType(raw)
		filters.ContractType = &ct
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		st := model.PlaybookStatus(raw)
		filters.Status = &st
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *PlaybookHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreatePlaybookRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *PlaybookHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *PlaybookHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdatePlaybookRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *PlaybookHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Clone POST /playbooks/{id}/clone (lex:write). Clones any existing playbook into a
// new DRAFT. Optional body {name}.
func (h *PlaybookHandler) Clone(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.PlaybookCloneRequest
	_ = suiteapi.DecodeJSON(r, &req)
	item, err := h.service.ClonePlaybook(r.Context(), tenantID, userID, id, req.Name)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// ListTemplates GET /playbooks/templates (lex:read). The static template library.
func (h *PlaybookHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenantID(w, r); !ok {
		return
	}
	suiteapi.WriteData(w, http.StatusOK, h.service.ListTemplates())
}

// CloneTemplate POST /playbooks/templates/{key}/clone (lex:write). Creates a new
// DRAFT playbook from a static template. Optional body {name}.
func (h *PlaybookHandler) CloneTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(chi.URLParam(r, "key"))
	if key == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing key parameter", nil)
		return
	}
	var req dto.PlaybookCloneRequest
	_ = suiteapi.DecodeJSON(r, &req)
	item, err := h.service.CloneTemplate(r.Context(), tenantID, userID, key, req.Name)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// Portfolio GET /playbooks/portfolio (lex:read). Per-contract compliance against
// each contract's matched active playbook. Filters: contract_type, min_score,
// max_score; sort by compliance_score via order=asc|desc; paginated.
func (h *PlaybookHandler) Portfolio(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.PlaybookPortfolioFilters{
		Page:          page,
		PerPage:       perPage,
		SortDirection: strings.ToLower(strings.TrimSpace(r.URL.Query().Get("order"))),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("contract_type")); raw != "" {
		ct := model.ContractType(raw)
		filters.ContractType = &ct
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("min_score")); raw != "" {
		v, perr := strconv.ParseFloat(raw, 64)
		if perr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid min_score", nil)
			return
		}
		filters.MinScore = &v
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("max_score")); raw != "" {
		v, perr := strconv.ParseFloat(raw, 64)
		if perr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid max_score", nil)
			return
		}
		filters.MaxScore = &v
	}
	rows, total, truncated, err := h.service.Portfolio(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// Paginated envelope plus a `truncated` flag indicating the candidate scan was
	// capped (see service.PortfolioMaxScan) so the FE can warn / page the candidate set.
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"data":      rows,
		"page":      page,
		"per_page":  perPage,
		"total":     total,
		"truncated": truncated,
	})
}

// DryRun POST /playbooks/dry-run (lex:write). Tests a draft/edited (unsaved)
// playbook clause set, or a saved playbook by id, against a contract WITHOUT it
// being the active playbook. Returns a ClauseDeviationReport. Persists nothing.
func (h *PlaybookHandler) DryRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	var req dto.PlaybookDryRunRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	report, err := h.service.DryRunDeviations(r.Context(), tenantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// ContractClauseDeviations handles GET /contracts/{id}/clause-deviations,
// returning the deviation report of the contract against its active playbook. The
// returned deviations list is narrowed by the optional severity/kind/required_only
// filters; the whole-report counts/score stay representative of the full report.
func (h *PlaybookHandler) ContractClauseDeviations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	filters, ferr := parseDeviationReportFilters(r)
	if ferr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", ferr.Error(), nil)
		return
	}
	report, err := h.service.DetectClauseDeviations(r.Context(), tenantID, contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, service.FilterReportDeviations(report, filters))
}

// ExportClauseDeviations handles GET /contracts/{id}/clause-deviations/export.
// format=csv (default) streams a text/csv download of the deviation report,
// honouring the same severity/kind/required_only filters as the JSON endpoint so
// the export matches the on-screen view. format=pdf is intentionally unsupported
// (no server-side HTML/PDF render util exists; the frontend should use browser
// print) and returns 400.
func (h *PlaybookHandler) ExportClauseDeviations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "csv"
	}
	if format != "csv" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "UNSUPPORTED_FORMAT", "unsupported export format: "+format+" (only csv is supported; use browser print for pdf)", nil)
		return
	}
	filters, ferr := parseDeviationReportFilters(r)
	if ferr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", ferr.Error(), nil)
		return
	}
	report, err := h.service.DetectClauseDeviations(r.Context(), tenantID, contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	report = service.FilterReportDeviations(report, filters)
	writeClauseDeviationCSV(w, report)
}

func writeClauseDeviationCSV(w http.ResponseWriter, report *model.ClauseDeviationReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-clause-deviations.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{
		"clause_type", "title", "required", "kind", "severity",
		"similarity", "threshold", "risk_weight", "section_reference", "contract_clause_id", "message",
	})
	if report != nil {
		for _, d := range report.Deviations {
			similarity := ""
			if d.Similarity != nil {
				similarity = strconv.FormatFloat(*d.Similarity, 'f', 4, 64)
			}
			threshold := ""
			if d.Threshold != nil {
				threshold = strconv.FormatFloat(*d.Threshold, 'f', 4, 64)
			}
			section := ""
			if d.SectionReference != nil {
				section = *d.SectionReference
			}
			clauseID := ""
			if d.ContractClauseID != nil {
				clauseID = d.ContractClauseID.String()
			}
			_ = writer.Write([]string{
				string(d.ClauseType),
				d.Title,
				strconv.FormatBool(d.Required),
				string(d.Kind),
				string(d.Severity),
				similarity,
				threshold,
				strconv.FormatFloat(d.RiskWeight, 'f', 2, 64),
				section,
				clauseID,
				d.Message,
			})
		}
	}
	writer.Flush()
}

// ListDeviationReviews GET /contracts/{id}/clause-deviations/reviews (lex:read).
func (h *PlaybookHandler) ListDeviationReviews(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	reviews, err := h.service.ListDeviationReviews(r.Context(), tenantID, contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, reviews)
}

// UpsertDeviationReview PUT /contracts/{id}/clause-deviations/reviews/{clauseType}
// (lex:write). Upserts the triage disposition for a per-clause-type deviation.
func (h *PlaybookHandler) UpsertDeviationReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	clauseType := strings.TrimSpace(chi.URLParam(r, "clauseType"))
	if clauseType == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing clauseType parameter", nil)
		return
	}
	var req dto.DeviationReviewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	review, err := h.service.UpsertDeviationReview(r.Context(), tenantID, userID, contractID, clauseType, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, review)
}

// StartApproval POST /playbooks/{id}/approval/start (lex:approval:write). Opens the
// approval pipeline for a DRAFT playbook (WTQ-RSK-02 #9).
func (h *PlaybookHandler) StartApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	if h.approval == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "NOT_CONFIGURED", "", nil)
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.approval.StartApproval(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListApprovalTasks GET /playbooks/{id}/approval/tasks (lex:approval:read).
func (h *PlaybookHandler) ListApprovalTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	if h.approval == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "NOT_CONFIGURED", "", nil)
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tasks, err := h.approval.ListTasks(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tasks)
}

// DecideApprovalTask POST
// /playbooks/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision
// (lex:approval:write). On approve the playbook becomes active (WTQ-RSK-02 #9).
func (h *PlaybookHandler) DecideApprovalTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	if h.approval == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "NOT_CONFIGURED", "", nil)
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	workflowInstanceID, err := suiteapi.UUIDParam(r, "workflowInstanceId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.WorkflowDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	outcome, err := h.approval.DecideTask(r.Context(), tenantID, userID, id, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

// parseDeviationReportFilters reads the optional severity/kind/required_only query
// params for the clause-deviation report. severity and kind are CSV. An unknown
// token is a 400 so a typo is surfaced rather than silently dropping the filter.
func parseDeviationReportFilters(r *http.Request) (service.DeviationReportFilters, error) {
	var f service.DeviationReportFilters
	for _, raw := range suiteapi.ParseCSVParam(r, "severity") {
		sev := model.RiskLevel(strings.ToLower(raw))
		switch sev {
		case model.RiskLevelLow, model.RiskLevelMedium, model.RiskLevelHigh, model.RiskLevelCritical:
			f.Severities = append(f.Severities, sev)
		default:
			return f, errors.New("invalid severity filter value: " + raw)
		}
	}
	for _, raw := range suiteapi.ParseCSVParam(r, "kind") {
		kind := model.ClauseDeviationKind(strings.ToLower(raw))
		switch kind {
		case model.ClauseDeviationMissing, model.ClauseDeviationAltered, model.ClauseDeviationExtra:
			f.Kinds = append(f.Kinds, kind)
		default:
			return f, errors.New("invalid kind filter value: " + raw)
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("required_only")); raw != "" {
		switch strings.ToLower(raw) {
		case "true", "1", "yes":
			f.RequiredOnly = true
		case "false", "0", "no":
			f.RequiredOnly = false
		default:
			return f, errors.New("invalid required_only value: " + raw)
		}
	}
	return f, nil
}
