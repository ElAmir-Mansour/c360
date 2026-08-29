package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/audit/dto"
	"github.com/clario360/platform/internal/audit/repository"
	"github.com/clario360/platform/internal/audit/service"
	"github.com/clario360/platform/internal/auth"
)

// PlatformAuditHandler serves the platform-console (cross-tenant) audit
// endpoints: G14 cross-tenant log query, G15 cross-tenant integrity verify +
// status, and G16 async export jobs. Each route is gated by RequirePermission
// in main.go; this handler additionally enforces tenant scoping where the
// caller is NOT cleared for all-tenants access.
type PlatformAuditHandler struct {
	repo         *repository.AuditRepository
	integritySvc *service.IntegrityService
	exportSvc    *service.ExportService
	jobs         *service.ExportJobStore
	runner       *service.IntegrityRunner
	logger       zerolog.Logger
}

// NewPlatformAuditHandler wires the cross-tenant handler. runner may be nil if
// the periodic integrity runner is disabled; the status endpoint then reports
// an empty (never-run) result.
func NewPlatformAuditHandler(
	repo *repository.AuditRepository,
	integritySvc *service.IntegrityService,
	exportSvc *service.ExportService,
	jobs *service.ExportJobStore,
	runner *service.IntegrityRunner,
	logger zerolog.Logger,
) *PlatformAuditHandler {
	return &PlatformAuditHandler{
		repo:         repo,
		integritySvc: integritySvc,
		exportSvc:    exportSvc,
		jobs:         jobs,
		runner:       runner,
		logger:       logger,
	}
}

// ── G14: cross-tenant log query ─────────────────────────────────────────────

// ListLogs handles GET /api/v1/audit/admin/logs — cross-tenant audit query.
//
// Tenant-guard handling: the forced single-tenant predicate of the normal
// /logs path is dropped ONLY when the caller holds audit:read:all AND requests
// all_tenants=true. Otherwise the query is constrained to the explicit
// tenant_id set the caller supplied, and if none is supplied it falls back to
// the caller's own tenant from the JWT — so a caller who reaches this route via
// a coarser grant can never read another tenant's rows by omitting filters.
func (h *PlatformAuditHandler) ListLogs(w http.ResponseWriter, r *http.Request) {
	params, err := dto.ParseAdminQueryParams(r)
	if err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), r)
		return
	}

	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "authentication required", r)
		return
	}
	canReadAll := auth.HasPermission(user.Roles, auth.PermAuditReadAll)

	filter := repository.AdminQueryFilter{
		UserID:       params.UserID,
		Service:      params.Service,
		Action:       params.Action,
		ResourceType: params.ResourceType,
		ResourceID:   params.ResourceID,
		Severity:     params.Severity,
		Search:       params.Search,
		DateFrom:     params.DateFrom,
		DateTo:       params.DateTo,
		Sort:         params.Sort,
		Order:        params.Order,
		Limit:        params.PerPage,
		Offset:       params.Offset(),
	}

	switch {
	case params.AllTenants && canReadAll:
		// Genuine all-tenants sweep — drop the tenant predicate entirely.
		filter.AllTenants = true
	case len(params.TenantIDs) > 0:
		// Explicit tenant set. Honour it as-is for an all-tenants-capable caller;
		// for a tenant-scoped caller, ignore the requested set and pin to their
		// own tenant so they cannot pivot to arbitrary tenants.
		if canReadAll {
			filter.TenantIDs = params.TenantIDs
		} else {
			filter.TenantIDs = []string{tenantOf(user)}
		}
	default:
		// No explicit scope: default to the caller's own tenant.
		filter.TenantIDs = []string{tenantOf(user)}
	}

	entries, total, err := h.repo.AdminQuery(r.Context(), filter)
	if err != nil {
		h.logger.Error().Err(err).Msg("admin audit query failed")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to query audit logs", r)
		return
	}

	// Resolve tenant display names best-effort for the tenant column.
	ids := make([]string, 0, len(entries))
	for i := range entries {
		ids = append(ids, entries[i].TenantID)
	}
	names := h.repo.ResolveTenantNames(r.Context(), ids)

	rows := make([]dto.AdminAuditRow, 0, len(entries))
	for i := range entries {
		e := &entries[i]
		rows = append(rows, dto.AdminAuditRow{
			ID:            e.ID,
			TenantID:      e.TenantID,
			TenantName:    names[e.TenantID],
			UserID:        e.UserID,
			UserEmail:     e.UserEmail,
			Service:       e.Service,
			Action:        e.Action,
			Severity:      e.Severity,
			ResourceType:  e.ResourceType,
			ResourceID:    e.ResourceID,
			IPAddress:     e.IPAddress,
			UserAgent:     e.UserAgent,
			EventID:       e.EventID,
			CorrelationID: e.CorrelationID,
			PreviousHash:  e.PreviousHash,
			EntryHash:     e.EntryHash,
			CreatedAt:     e.CreatedAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":     rows,
		"total":    total,
		"page":     params.Page,
		"per_page": params.PerPage,
	})
}

// ── G15: cross-tenant integrity verify + status ─────────────────────────────

// Verify handles POST /api/v1/audit/admin/verify — verify hash-chain integrity
// across one or more tenants. With no tenant_ids it verifies every tenant that
// has chain state (all-tenants sweep).
func (h *PlatformAuditHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req dto.AdminVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", r)
		return
	}
	if req.DateFrom == "" {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "date_from is required", r)
		return
	}
	dateFrom, err := time.Parse(time.RFC3339, req.DateFrom)
	if err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid date_from format", r)
		return
	}
	dateTo := time.Now().UTC()
	if req.DateTo != "" {
		dt, err := time.Parse(time.RFC3339, req.DateTo)
		if err != nil {
			writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid date_to format", r)
			return
		}
		dateTo = dt
	}

	results, err := h.integritySvc.VerifyChains(r.Context(), req.TenantIDs, dateFrom, dateTo)
	if err != nil {
		h.logger.Error().Err(err).Msg("cross-tenant integrity verification failed")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "verification failed", r)
		return
	}

	writeJSON(w, http.StatusOK, dto.AdminVerifyResponse{
		Results:   results,
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// IntegrityStatus handles GET /api/v1/audit/admin/integrity/status — return the
// most recent periodic integrity-runner pass. Reports an empty (never-run)
// result when the runner is disabled or has not completed a pass yet.
func (h *PlatformAuditHandler) IntegrityStatus(w http.ResponseWriter, r *http.Request) {
	if h.runner == nil {
		writeJSON(w, http.StatusOK, dto.IntegrityStatusResponse{Results: []dto.AdminVerifyResult{}})
		return
	}
	status := h.runner.LastStatus()
	if status == nil {
		writeJSON(w, http.StatusOK, dto.IntegrityStatusResponse{Results: []dto.AdminVerifyResult{}})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// ── G16: async export jobs ──────────────────────────────────────────────────

// CreateExport handles POST /api/v1/audit/exports — enqueue an async export job.
// Returns 202 with a job_id and a poll_url. The export is scoped to the caller's
// tenant (the audit:export grant is tenant-scoped; cross-tenant export would
// require audit:read:all and is intentionally not offered here).
func (h *PlatformAuditHandler) CreateExport(w http.ResponseWriter, r *http.Request) {
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}

	var body struct {
		Format       string `json:"format"`
		DateFrom     string `json:"date_from"`
		DateTo       string `json:"date_to"`
		UserID       string `json:"user_id"`
		Service      string `json:"service"`
		Action       string `json:"action"`
		ResourceType string `json:"resource_type"`
		Severity     string `json:"severity"`
		Search       string `json:"search"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", r)
		return
	}
	if body.DateFrom == "" {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "date_from is required", r)
		return
	}
	dateFrom, err := time.Parse(time.RFC3339, body.DateFrom)
	if err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid date_from format", r)
		return
	}

	cfg := &dto.ExportConfig{
		TenantID:     tenantID,
		Format:       dto.ExportFormat(body.Format),
		DateFrom:     dateFrom,
		UserID:       body.UserID,
		Service:      body.Service,
		Action:       body.Action,
		ResourceType: body.ResourceType,
		Severity:     body.Severity,
		Search:       body.Search,
	}
	if body.DateTo != "" {
		dt, err := time.Parse(time.RFC3339, body.DateTo)
		if err != nil {
			writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid date_to format", r)
			return
		}
		cfg.DateTo = dt
	}
	if err := cfg.Validate(); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), r)
		return
	}

	jobID := h.jobs.Enqueue(cfg, getRoles(r))
	writeJSON(w, http.StatusAccepted, dto.ExportJobStatus{
		JobID:   jobID,
		Status:  "processing",
		PollURL: "/api/v1/audit/exports/" + jobID,
	})
}

// GetExport handles GET /api/v1/audit/exports/{job_id} — poll job status.
func (h *PlatformAuditHandler) GetExport(w http.ResponseWriter, r *http.Request) {
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}
	jobID := chi.URLParam(r, "job_id")
	job, ok := h.jobs.Status(jobID, tenantID)
	if !ok {
		writeErrorResponse(w, http.StatusNotFound, "NOT_FOUND", "export job not found", r)
		return
	}

	resp := dto.ExportJobStatus{
		JobID:       job.JobID,
		Status:      job.Status,
		RecordCount: job.RecordCount,
		DownloadURL: job.DownloadURL,
		Error:       job.Error,
	}
	writeJSON(w, http.StatusOK, resp)
}

// DownloadExport handles GET /api/v1/audit/exports/{job_id}/download — stream
// the rendered export payload once the job has completed.
func (h *PlatformAuditHandler) DownloadExport(w http.ResponseWriter, r *http.Request) {
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}
	jobID := chi.URLParam(r, "job_id")
	payload, contentType, filename, ok := h.jobs.Download(jobID, tenantID)
	if !ok {
		writeErrorResponse(w, http.StatusNotFound, "NOT_FOUND", "export not available (missing, not yet complete, or failed)", r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

// tenantOf returns the tenant id carried on the context user.
func tenantOf(u *auth.ContextUser) string {
	if u == nil {
		return ""
	}
	return u.TenantID
}
