package tenants

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
)

// Permission constants for the platform tenant admin surface (doc §H).
const (
	PermRead        = "platform:tenants:read"
	PermWrite       = "platform:tenants:write"
	PermImpersonate = "platform:tenants:impersonate"
)

// Handler exposes the cross-tenant admin tenant endpoints (gaps G2–G5).
type Handler struct {
	svc    *Service
	logger zerolog.Logger
}

// NewHandler constructs the HTTP handler over a Service.
func NewHandler(svc *Service, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger}
}

// Mount registers all routes on the supplied router. The parent is expected to
// be the authenticated API surface; routes are individually permission-gated.
//
// Admin routes mirror the existing /api/v1/admin group; the overview summary
// lives under /api/v1/platform. Mount on the router already scoped to /api/v1
// (i.e. call svc-router.Route("/api/v1", func(r){ handler.Mount(r) }) or mount
// at the service root and pass the /api/v1 sub-router):
//
//	r.Route("/admin/tenants", ...)        // G2, G4, G5
//	r.Route("/admin/impersonation", ...)  // G5 stop
//	r.Route("/platform/tenants", ...)     // G3 summary
func (h *Handler) Mount(r chi.Router) {
	// G2 + G4 + G5 — admin tenant operations.
	r.Route("/admin/tenants", func(ar chi.Router) {
		ar.With(middleware.RequirePermission(PermRead)).Get("/", h.List)
		ar.With(middleware.RequirePermission(PermRead)).Get("/{id}", h.Get)
		ar.With(middleware.RequirePermission(PermWrite)).Post("/{id}/suspend", h.Suspend)
		ar.With(middleware.RequirePermission(PermWrite)).Post("/{id}/unsuspend", h.Unsuspend)
		ar.With(middleware.RequirePermission(PermImpersonate)).Post("/{id}/impersonate", h.Impersonate)
	})

	// G5 — stop impersonation (best-effort audit).
	r.Route("/admin/impersonation", func(ar chi.Router) {
		ar.With(middleware.RequirePermission(PermImpersonate)).Post("/stop", h.StopImpersonation)
	})

	// G3 — platform overview rollup.
	r.Route("/platform/tenants", func(pr chi.Router) {
		pr.With(middleware.RequirePermission(PermRead)).Get("/summary", h.Summary)
	})
}

// List handles GET /admin/tenants (gap G2).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p := ListParams{
		Search:   q.Get("search"),
		Statuses: q["status"],
		Tiers:    q["tier"],
		Sort:     q.Get("sort"),
		Order:    q.Get("order"),
		Page:     atoiDefault(q.Get("page"), 1),
		PerPage:  atoiDefault(q.Get("per_page"), 20),
	}
	items, total, err := h.svc.List(r.Context(), p)
	if err != nil {
		h.fail(w, err)
		return
	}
	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	totalPages := total / perPage
	if total%perPage != 0 {
		totalPages++
	}
	if totalPages < 1 {
		totalPages = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": map[string]any{
			"page":        page,
			"per_page":    perPage,
			"total":       total,
			"total_pages": totalPages,
		},
	})
}

// Get handles GET /admin/tenants/{id} (gap G2 detail). It returns the SAME
// AdminTenantSummary shape as a single row of the List response, and 404s when the
// tenant does not exist.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "id")
	item, err := h.svc.Get(r.Context(), tenantID)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

// Summary handles GET /platform/tenants/summary (gap G3).
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.svc.Summary(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

type suspendRequest struct {
	Reason string `json:"reason"`
}

// Suspend handles POST /admin/tenants/{id}/suspend (gap G4).
func (h *Handler) Suspend(w http.ResponseWriter, r *http.Request) {
	adminID := actorID(r)
	tenantID := chi.URLParam(r, "id")
	var req suspendRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.svc.Suspend(r.Context(), tenantID, adminID, req.Reason); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "suspended", "tenant_id": tenantID})
}

// Unsuspend handles POST /admin/tenants/{id}/unsuspend (gap G4).
func (h *Handler) Unsuspend(w http.ResponseWriter, r *http.Request) {
	adminID := actorID(r)
	tenantID := chi.URLParam(r, "id")
	if err := h.svc.Unsuspend(r.Context(), tenantID, adminID); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "active", "tenant_id": tenantID})
}

type impersonateRequest struct {
	TargetUserID string `json:"target_user_id"`
	Reason       string `json:"reason"`
	TTLSeconds   int    `json:"ttl_seconds"`
}

// Impersonate handles POST /admin/tenants/{id}/impersonate (gap G5).
func (h *Handler) Impersonate(w http.ResponseWriter, r *http.Request) {
	adminID := actorID(r)
	tenantID := chi.URLParam(r, "id")
	var req impersonateRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	res, err := h.svc.Impersonate(r.Context(), tenantID, adminID, req.TargetUserID, req.Reason, req.TTLSeconds)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type stopImpersonationRequest struct {
	TenantID     string `json:"tenant_id"`
	TargetUserID string `json:"target_user_id"`
	Reason       string `json:"reason"`
}

// StopImpersonation handles POST /admin/impersonation/stop (gap G5).
func (h *Handler) StopImpersonation(w http.ResponseWriter, r *http.Request) {
	adminID := actorID(r)
	var req stopImpersonationRequest
	// Body is optional for stop; ignore decode errors on an empty body.
	_ = decodeBody(r, &req)
	if err := h.svc.StopImpersonation(r.Context(), adminID, req.TenantID, req.TargetUserID, req.Reason); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "stopped"})
}

// ---- helpers -------------------------------------------------------------

func actorID(r *http.Request) string {
	if u := auth.UserFromContext(r.Context()); u != nil {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
	case errors.Is(err, ErrValidation):
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
	case errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, "CONFLICT", err.Error())
	default:
		h.logger.Error().Err(err).Msg("platform tenants handler error")
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error")
	}
}

func decodeBody(r *http.Request, dst any) error {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  status,
		"code":    code,
		"message": message,
	})
}

func atoiDefault(s string, def int) int {
	if strings.TrimSpace(s) == "" {
		return def
	}
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}
