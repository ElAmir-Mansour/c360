// Package handler exposes the pricing & quoting HTTP API.
//
// Routes (mounted under an authenticated group by license-service main):
//
//	POST /compute                          the calculator (masked tiers)
//	POST /compute?include_internal=true    internal margin tiers — ONLY if the
//	                                       caller holds pricing:admin; the flag
//	                                       alone never unlocks margin
//	GET  /admin/config                     list all versions (metadata + payload)
//	GET  /admin/config/active              current active version + payload
//	GET  /admin/config/{version}           one version
//	POST /admin/config                     create a DRAFT (validated) -> 201
//	PUT  /admin/config/{version}           edit a DRAFT (active/archived -> 409)
//	POST /admin/config/{version}/publish   draft -> active (archives prior, audited)
//	POST /admin/config/{version}/archive   active -> archived (audited)
//
// MARGIN MASKING IS STRUCTURAL: internal_cost / gross_profit / realized_margin /
// guardrail live only on model.InternalTier, and the handler serializes that type
// ONLY for pricing:admin callers. A non-admin (or the compute route without the
// admin verb) serializes model.ClientTier, which has no such fields — so the
// internal block cannot appear in a client-facing response even if the flag is set.
package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// RBAC verbs (also registered in internal/auth/rbac.go).
const (
	PermPricingRead  = "pricing:read"
	PermPricingWrite = "pricing:write"
	PermPricingAdmin = "pricing:admin"
)

// Handler wires the pricing service to HTTP.
type Handler struct {
	svc    *service.Service
	logger zerolog.Logger
}

// New constructs the handler.
func New(svc *service.Service, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger}
}

// Routes returns the pricing router, mounted under an authenticated group
// (middleware.Auth + middleware.Tenant applied by the caller).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	// Compute: any pricing verb may run the calculator. Whether the internal
	// margin block is returned is decided per-request by the admin verb, not by
	// route gating, so a read/write user still gets masked tiers.
	r.With(middleware.RequireAnyPermission(PermPricingRead, PermPricingWrite, PermPricingAdmin)).
		Post("/compute", h.compute)

	r.Route("/admin/config", func(r chi.Router) {
		// Reads: any pricing verb.
		r.With(middleware.RequireAnyPermission(PermPricingRead, PermPricingWrite, PermPricingAdmin)).
			Get("/", h.listConfig)
		r.With(middleware.RequireAnyPermission(PermPricingRead, PermPricingWrite, PermPricingAdmin)).
			Get("/active", h.getActiveConfig)
		r.With(middleware.RequireAnyPermission(PermPricingRead, PermPricingWrite, PermPricingAdmin)).
			Get("/{version}", h.getConfigVersion)

		// Draft authoring: pricing:write.
		r.With(middleware.RequirePermission(PermPricingWrite)).Post("/", h.createDraft)
		r.With(middleware.RequirePermission(PermPricingWrite)).Put("/{version}", h.updateDraft)

		// Governance transitions: pricing:admin only.
		r.With(middleware.RequirePermission(PermPricingAdmin)).Post("/{version}/publish", h.publishConfig)
		r.With(middleware.RequirePermission(PermPricingAdmin)).Post("/{version}/archive", h.archiveConfig)
	})

	// Quotes (Phase 2): persist/list/get, status machine, floor override, export.
	// Route gating is defined in quoteRoutes (pricing:read/write/admin per verb).
	h.quoteRoutes(r)

	return r
}

// callerIsPricingAdmin reports whether the authenticated caller holds
// pricing:admin. This is the ONLY gate that unlocks the internal margin block.
func callerIsPricingAdmin(r *http.Request) bool {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		return false
	}
	return auth.HasPermission(user.Roles, PermPricingAdmin)
}

func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, model.ErrNotFound), errors.Is(err, model.ErrNoActive):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, model.ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	case errors.Is(err, model.ErrImmutable):
		suiteapi.WriteError(w, r, http.StatusConflict, "immutable", err.Error(), nil)
	case errors.Is(err, model.ErrInvalidConfig):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "invalid", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("pricing request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// --- Compute -----------------------------------------------------------------

type computeRequest struct {
	Model         model.Model      `json:"model"`
	Deployment    model.Deployment `json:"deployment"`
	TermMonths    int              `json:"term_months"`
	Users         int64            `json:"users"`
	Cores         int64            `json:"cores"`
	VMs           int64            `json:"vms"`
	HotStorageGB  float64          `json:"hot_storage_gb"`
	ColdStorageGB float64          `json:"cold_storage_gb"`
	SalesDiscount *float64         `json:"sales_discount,omitempty"`
	// Version optionally prices against a specific (draft/historical) version
	// rather than the active one. Ignored for non-admin callers.
	Version *int `json:"version,omitempty"`
}

func (h *Handler) compute(w http.ResponseWriter, r *http.Request) {
	var req computeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	in := model.Inputs{
		Model:         req.Model,
		Deployment:    req.Deployment,
		TermMonths:    req.TermMonths,
		Users:         req.Users,
		Cores:         req.Cores,
		VMs:           req.VMs,
		HotStorageGB:  req.HotStorageGB,
		ColdStorageGB: req.ColdStorageGB,
		SalesDiscount: req.SalesDiscount,
	}

	admin := callerIsPricingAdmin(r)

	var (
		quote *model.Quote
		err   error
	)
	// Pricing against an explicit version is an admin-only capability (draft
	// preview / historical); non-admins always price the active version.
	if req.Version != nil && admin {
		quote, err = h.svc.ComputeWith(r.Context(), in, *req.Version)
	} else {
		quote, err = h.svc.Compute(r.Context(), in)
	}
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	// STRUCTURAL MASKING: serialize InternalTier only for pricing:admin;
	// otherwise ClientTier, which physically lacks the internal block. The
	// include_internal flag is honoured ONLY when the caller is already an admin.
	includeInternal := admin && r.URL.Query().Get("include_internal") == "true"
	if includeInternal {
		suiteapi.WriteData(w, http.StatusOK, map[string]any{
			"pricing_version": quote.PricingVersion,
			"currency":        quote.Currency,
			"model":           quote.Model,
			"tiers":           quote.Tiers, // []InternalTier
		})
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"pricing_version": quote.PricingVersion,
		"currency":        quote.Currency,
		"model":           quote.Model,
		"tiers":           quote.ClientTiers(), // []ClientTier — margin block absent
	})
}

// --- Config CRUD -------------------------------------------------------------

func (h *Handler) listConfig(w http.ResponseWriter, r *http.Request) {
	configs, err := h.svc.ListConfigs(r.Context())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if configs == nil {
		configs = []*model.PricingConfig{}
	}
	suiteapi.WriteData(w, http.StatusOK, configs)
}

func (h *Handler) getActiveConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.svc.GetActiveConfig(r.Context())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

func (h *Handler) getConfigVersion(w http.ResponseWriter, r *http.Request) {
	version, err := parseVersion(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_version", err.Error(), nil)
		return
	}
	cfg, err := h.svc.GetConfigVersion(r.Context(), version)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

type draftRequest struct {
	Rates model.PricingRates `json:"rates"`
	Notes string             `json:"notes"`
}

func (h *Handler) createDraft(w http.ResponseWriter, r *http.Request) {
	var req draftRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	cfg, err := h.svc.CreateDraft(r.Context(), service.CreateDraftInput{
		Rates:     req.Rates,
		Notes:     req.Notes,
		CreatedBy: callerID(r),
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, cfg)
}

func (h *Handler) updateDraft(w http.ResponseWriter, r *http.Request) {
	version, err := parseVersion(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_version", err.Error(), nil)
		return
	}
	var req draftRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	cfg, err := h.svc.UpdateDraft(r.Context(), service.UpdateDraftInput{
		Version: version,
		Rates:   req.Rates,
		Notes:   req.Notes,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

func (h *Handler) publishConfig(w http.ResponseWriter, r *http.Request) {
	version, err := parseVersion(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_version", err.Error(), nil)
		return
	}
	cfg, err := h.svc.Publish(r.Context(), version, callerID(r))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

func (h *Handler) archiveConfig(w http.ResponseWriter, r *http.Request) {
	version, err := parseVersion(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_version", err.Error(), nil)
		return
	}
	cfg, err := h.svc.Archive(r.Context(), version, callerID(r))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

func parseVersion(r *http.Request) (int, error) {
	raw := chi.URLParam(r, "version")
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return 0, errors.New("version must be a positive integer")
	}
	return v, nil
}

// callerID returns the authenticated user's IAM id (JWT sub) for created_by /
// published_by audit fields, or "" if unavailable.
func callerID(r *http.Request) string {
	if user := auth.UserFromContext(r.Context()); user != nil {
		return user.ID
	}
	return ""
}
