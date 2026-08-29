package recover

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// evidenceService is the surface the evidence handler needs; *EvidenceService
// satisfies it. The interface keeps the handler unit-testable without a database,
// the Metastore seam, or a live licensing engine.
type evidenceService interface {
	ListEvents(ctx context.Context, tenantID uuid.UUID, authorization string, limit int) ([]AuditEventSummary, error)
	Report(ctx context.Context, tenantID, eventID uuid.UUID, authorization string) (*EvidenceReport, error)
}

// EvidenceHandler serves the regulatory evidence / "Prove" surface. It is mounted
// under /api/recover behind the same Auth+Tenant middleware as the rest of the
// Recover product, self-gates every route on dr:read, and the service additionally
// enforces a Recover entitlement (any of the three sub-solution keys) before
// returning any data:
//
//	GET /api/recover/evidence                 list recovery events  (dr:read + recover.*)
//	GET /api/recover/evidence/{eventId}       the JSON report       (dr:read + recover.*)
//	GET /api/recover/evidence/{eventId}/export?format=csv|pdf       (dr:read + recover.*)
//
// It composes the Metastore seam (RTO target), the EXISTING runbookstudio +
// cyber-recovery execution records (runbook executed, RTA, approvals, integrity
// checks), and the append-only audit log (the full timeline). It owns no recovery
// logic.
type EvidenceHandler struct {
	svc    evidenceService
	logger zerolog.Logger
}

// NewEvidenceHandler constructs the evidence handler over an EvidenceService.
func NewEvidenceHandler(svc *EvidenceService, logger zerolog.Logger) *EvidenceHandler {
	return &EvidenceHandler{svc: svc, logger: logger.With().Str("handler", "recover-evidence").Logger()}
}

// newEvidenceHandler is the internal constructor accepting the service interface
// (tests).
func newEvidenceHandler(svc evidenceService, logger zerolog.Logger) *EvidenceHandler {
	return &EvidenceHandler{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the evidence surface as a standalone router
// (used by the handler's own tests). In the running service the recover Router
// registers these handlers directly onto its existing Auth+Tenant group (see
// router.go) so chi never double-mounts at "/".
func (h *EvidenceHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/evidence", h.listEvents)
		r.Get("/evidence/{eventId}", h.getReport)
		r.Get("/evidence/{eventId}/export", h.export)
	})
	return r
}

// listEvents returns the tenant's audited recovery events, newest first — the
// "Prove" event list with the one-click compliance export.
func (h *EvidenceHandler) listEvents(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	_, perPage := suiteapi.ParsePagination(r)
	events, err := h.svc.ListEvents(r.Context(), tenantID, r.Header.Get("Authorization"), perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, events)
}

// getReport returns the full JSON evidence report for one recovery event.
func (h *EvidenceHandler) getReport(w http.ResponseWriter, r *http.Request) {
	tenantID, eventID, ok := h.tenantAndEvent(w, r)
	if !ok {
		return
	}
	report, err := h.svc.Report(r.Context(), tenantID, eventID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.metricsExport(FormatJSON)
	suiteapi.WriteData(w, http.StatusOK, report)
}

// export produces the regulator-ready CSV or PDF document for one recovery event.
func (h *EvidenceHandler) export(w http.ResponseWriter, r *http.Request) {
	tenantID, eventID, ok := h.tenantAndEvent(w, r)
	if !ok {
		return
	}
	format := EvidenceFormat(r.URL.Query().Get("format"))
	if format == "" {
		format = FormatPDF
	}
	if format != FormatCSV && format != FormatPDF {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request",
			"format must be csv or pdf", nil)
		return
	}

	report, err := h.svc.Report(r.Context(), tenantID, eventID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}

	var (
		body        []byte
		contentType string
		filename    string
	)
	switch format {
	case FormatCSV:
		body, err = RenderEvidenceCSV(report)
		contentType = "text/csv; charset=utf-8"
		filename = "recover-evidence-" + eventID.String() + ".csv"
	case FormatPDF:
		body, err = RenderEvidencePDF(report)
		contentType = "application/pdf"
		filename = "recover-evidence-" + eventID.String() + ".pdf"
	}
	if err != nil {
		h.logger.Error().Err(err).Str("event_id", eventID.String()).Str("format", string(format)).
			Msg("rendering evidence export failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
		return
	}

	h.metricsExport(format)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(body); werr != nil {
		h.logger.Warn().Err(werr).Msg("writing evidence export body failed")
	}
}

// tenantAndEvent resolves the tenant and the {eventId} path param, writing the
// appropriate error and returning ok=false on failure.
func (h *EvidenceHandler) tenantAndEvent(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	eventID, err := uuid.Parse(chi.URLParam(r, "eventId"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "eventId must be a valid uuid", nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, eventID, true
}

// metricsExport is a no-op shim so the handler can record export metrics without
// reaching into the service's private metrics; the service records the report
// metric, the handler records the export-format metric via the service's exposed
// recorder when present.
func (h *EvidenceHandler) metricsExport(format EvidenceFormat) {
	if rec, ok := h.svc.(interface{ recordExport(EvidenceFormat) }); ok {
		rec.recordExport(format)
	}
}

// writeError maps evidence sentinel errors to HTTP statuses; an unexpected error
// is logged and returned as a generic 500 with no stack trace leaked.
func (h *EvidenceHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrEvidenceNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", "no evidence found for this event", nil)
	case errors.Is(err, ErrAnalyticsNotEntitled):
		suiteapi.WriteError(w, r, http.StatusPaymentRequired, "not_entitled",
			"Clario Recover is not enabled for this tenant", map[string]string{
				"upgrade_url": "/register?suites=recover&plan=trial",
			})
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable",
			"unable to verify license entitlement", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover evidence request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// recordExport lets the handler record an export-format metric on the service.
// The EvidenceService implements it; the test fake may omit it.
func (s *EvidenceService) recordExport(format EvidenceFormat) {
	s.metrics.observeExport(format)
}
