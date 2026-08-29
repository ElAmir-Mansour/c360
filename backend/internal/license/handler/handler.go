// Package handler exposes the licensing HTTP API.
//
// Enforcement routes (authenticated tenant context — called by the gateway
// and by apps):
//
//	GET  /check?key=...        one entitlement decision
//	GET  /entitlements         the tenant's full resolved entitlement set
//	POST /usage                consume metered usage {key, amount}
//
// Admin routes (licensing:admin permission — platform operators):
//
//	POST /admin/plans                              create a plan
//	GET  /admin/plans                              list the catalog
//	GET  /admin/tenants                            fleet license rows (paginated)
//	GET  /admin/licenses/expiring                  licenses expiring within N days
//	GET  /admin/usage/rollup                       cross-tenant seat/usage rollup
//	GET  /admin/entitlement-keys                   canonical entitlement-key registry
//	GET  /admin/tenants/{tenantID}/overrides       a tenant's overrides
//	GET  /admin/tenants/{tenantID}/entitlements    a tenant's resolved entitlements
//	GET  /admin/tenants/{tenantID}/usage           a tenant's metered usage
//	GET  /admin/plans/{key}                        one plan
//	PUT  /admin/plans/{key}                        update plan metadata
//	POST /admin/plans/{key}/retire                 retire a plan
//	POST /admin/plans/{key}/reactivate             reactivate a plan
//	PUT  /admin/plans/{key}/entitlements           replace entitlement set
//	POST /admin/tenants/{tenantID}/license         assign / change plan
//	GET  /admin/tenants/{tenantID}/license         inspect a tenant's license
//	POST /admin/tenants/{tenantID}/license/suspend
//	POST /admin/tenants/{tenantID}/license/resume
//	PUT  /admin/tenants/{tenantID}/overrides/{key} set an override
//	DELETE /admin/tenants/{tenantID}/overrides/{key}
//	POST /admin/tenants/{tenantID}/offline-license issue a signed license file
//	POST /offline-license/activate                 activate a license file
package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/license/model"
	"github.com/clario360/platform/internal/license/service"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// AdminPermission gates plan catalog and license lifecycle routes.
const AdminPermission = "licensing:admin"

// Handler wires the licensing service to HTTP.
type Handler struct {
	svc      *service.Service
	signer   *service.OfflineSigner   // nil on deployments that cannot issue
	verifier *service.OfflineVerifier // nil on deployments that cannot activate
	logger   zerolog.Logger
}

// New constructs the handler. signer and verifier may be nil; the related
// endpoints then respond 501 Not Implemented.
func New(svc *service.Service, signer *service.OfflineSigner, verifier *service.OfflineVerifier, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, signer: signer, verifier: verifier, logger: logger}
}

// Routes returns the licensing router, to be mounted under an authenticated
// route group (middleware.Auth + middleware.Tenant applied by the caller).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	// Enforcement API — tenant scope from JWT.
	r.Get("/check", h.check)
	r.Get("/entitlements", h.entitlements)
	r.Post("/usage", h.consumeUsage)
	r.Post("/offline-license/activate", h.activateOffline)

	// Admin API.
	r.Route("/admin", func(r chi.Router) {
		r.Use(middleware.RequirePermission(AdminPermission))

		r.Post("/plans", h.createPlan)
		r.Get("/plans", h.listPlans)
		r.Get("/plans/{key}", h.getPlan)
		r.Put("/plans/{key}", h.updatePlan)
		r.Post("/plans/{key}/retire", h.retirePlan)
		r.Post("/plans/{key}/reactivate", h.reactivatePlan)
		r.Put("/plans/{key}/entitlements", h.setPlanEntitlements)

		// Cross-tenant fleet reads.
		r.Get("/tenants", h.listTenantLicenses)             // G7
		r.Get("/licenses/expiring", h.listExpiringLicenses) // G8
		r.Get("/usage/rollup", h.usageRollup)               // G11
		r.Get("/entitlement-keys", h.listEntitlementKeys)   // G12

		r.Route("/tenants/{tenantID}", func(r chi.Router) {
			r.Post("/license", h.assignLicense)
			r.Get("/license", h.getLicense)
			r.Post("/license/suspend", h.suspendLicense)
			r.Post("/license/resume", h.resumeLicense)
			r.Get("/overrides", h.listOverrides) // G9
			r.Put("/overrides/{key}", h.setOverride)
			r.Delete("/overrides/{key}", h.removeOverride)
			r.Get("/entitlements", h.adminEntitlements) // G10
			r.Get("/usage", h.adminUsage)               // G10
			r.Post("/offline-license", h.issueOffline)
		})
	})

	return r
}

// InternalRoutes returns the service-to-service router for trusted backend
// callers (e.g. the onboarding provisioner's "Assign Default License" step). It
// reuses the same handlers as the admin API but is mounted under a ServiceToken
// guard (by the caller) instead of the human "licensing:admin" JWT permission.
// Tenant scope comes from the {tenantID} URL param, so no tenant JWT is needed.
func (h *Handler) InternalRoutes() chi.Router {
	r := chi.NewRouter()
	r.Route("/tenants/{tenantID}", func(r chi.Router) {
		r.Post("/license", h.assignLicense)            // assign / change plan
		r.Put("/overrides/{key}", h.setOverride)       // scope a trial: Limit=0 revokes
		r.Delete("/overrides/{key}", h.removeOverride) // re-grant a key on re-scope
	})
	return r
}

// writeServiceError maps domain errors to HTTP statuses.
func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, model.ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("licensing request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// --- Enforcement -----------------------------------------------------------

func (h *Handler) check(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "missing_key", "query parameter 'key' is required", nil)
		return
	}
	decision, err := h.svc.Check(r.Context(), tenantID.String(), key)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, decision)
}

func (h *Handler) entitlements(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return
	}
	decisions, state, err := h.svc.Entitlements(r.Context(), tenantID.String())
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			suiteapi.WriteData(w, http.StatusOK, map[string]any{"license_state": model.StateExpired, "entitlements": []model.Decision{}})
			return
		}
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"license_state": state, "entitlements": decisions})
}

type usageRequest struct {
	Key    string `json:"key"`
	Amount int64  `json:"amount"`
}

func (h *Handler) consumeUsage(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return
	}
	var req usageRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.Key == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "missing_key", "'key' is required", nil)
		return
	}
	if req.Amount <= 0 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_amount", "'amount' must be positive", nil)
		return
	}

	decision, err := h.svc.Consume(r.Context(), tenantID.String(), req.Key, req.Amount, true)
	if err != nil {
		if errors.Is(err, model.ErrLimitExceeded) {
			suiteapi.WriteJSON(w, http.StatusTooManyRequests, map[string]any{"data": decision})
			return
		}
		h.writeServiceError(w, r, err)
		return
	}
	if !decision.Allowed {
		suiteapi.WriteJSON(w, http.StatusForbidden, map[string]any{"data": decision})
		return
	}
	suiteapi.WriteData(w, http.StatusOK, decision)
}

// --- Admin: plans ------------------------------------------------------------

type createPlanRequest struct {
	Key          string              `json:"key"`
	Name         string              `json:"name"`
	Description  string              `json:"description"`
	Entitlements []model.Entitlement `json:"entitlements"`
}

func (h *Handler) createPlan(w http.ResponseWriter, r *http.Request) {
	var req createPlanRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.Key == "" || req.Name == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'key' and 'name' are required", nil)
		return
	}
	plan, err := h.svc.CreatePlan(r.Context(), &model.Plan{
		Key:          req.Key,
		Name:         req.Name,
		Description:  req.Description,
		Entitlements: req.Entitlements,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, plan)
}

func (h *Handler) listPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.svc.ListPlans(r.Context())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if plans == nil {
		plans = []*model.Plan{}
	}
	suiteapi.WriteData(w, http.StatusOK, plans)
}

func (h *Handler) getPlan(w http.ResponseWriter, r *http.Request) {
	plan, err := h.svc.GetPlan(r.Context(), chi.URLParam(r, "key"))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

type updatePlanRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (h *Handler) updatePlan(w http.ResponseWriter, r *http.Request) {
	var req updatePlanRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.Name == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'name' is required", nil)
		return
	}
	plan, err := h.svc.UpdatePlan(r.Context(), service.UpdatePlanInput{
		Key:         chi.URLParam(r, "key"),
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *Handler) retirePlan(w http.ResponseWriter, r *http.Request) {
	h.setPlanLifecycle(w, r, h.svc.RetirePlan)
}

func (h *Handler) reactivatePlan(w http.ResponseWriter, r *http.Request) {
	h.setPlanLifecycle(w, r, h.svc.ReactivatePlan)
}

func (h *Handler) setPlanLifecycle(w http.ResponseWriter, r *http.Request, op func(ctx context.Context, key string) (*model.Plan, error)) {
	plan, err := op(r.Context(), chi.URLParam(r, "key"))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

type entitlementsRequest struct {
	Entitlements []model.Entitlement `json:"entitlements"`
}

func (h *Handler) setPlanEntitlements(w http.ResponseWriter, r *http.Request) {
	var req entitlementsRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	plan, err := h.svc.UpdatePlanEntitlements(r.Context(), chi.URLParam(r, "key"), req.Entitlements)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

// --- Admin: tenant licenses ---------------------------------------------------

type assignLicenseRequest struct {
	PlanKey   string    `json:"plan_key"`
	Seats     int64     `json:"seats"`
	ExpiresAt time.Time `json:"expires_at"`
	GraceDays *int      `json:"grace_days,omitempty"`
}

func (h *Handler) assignLicense(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	var req assignLicenseRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	graceDays := 14
	if req.GraceDays != nil {
		graceDays = *req.GraceDays
	}
	lic, err := h.svc.AssignLicense(r.Context(), service.AssignLicenseInput{
		TenantID:  tenantID.String(),
		PlanKey:   req.PlanKey,
		Seats:     req.Seats,
		ExpiresAt: req.ExpiresAt,
		GraceDays: graceDays,
	})
	if err != nil {
		if errors.Is(err, model.ErrNotFound) || errors.Is(err, model.ErrAlreadyExists) {
			h.writeServiceError(w, r, err)
			return
		}
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, lic)
}

func (h *Handler) getLicense(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	lic, state, err := h.svc.GetLicense(r.Context(), tenantID.String())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"license": lic, "state": state})
}

func (h *Handler) suspendLicense(w http.ResponseWriter, r *http.Request) {
	h.setLicenseStatus(w, r, h.svc.SuspendLicense)
}

func (h *Handler) resumeLicense(w http.ResponseWriter, r *http.Request) {
	h.setLicenseStatus(w, r, h.svc.ResumeLicense)
}

func (h *Handler) setLicenseStatus(w http.ResponseWriter, r *http.Request, op func(ctx context.Context, tenantID string) error) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	if err := op(r.Context(), tenantID.String()); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Admin: overrides --------------------------------------------------------

type overrideRequest struct {
	Limit  *int64 `json:"limit,omitempty"`
	Reason string `json:"reason"`
}

func (h *Handler) setOverride(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	var req overrideRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	override := &model.Override{
		TenantID: tenantID.String(),
		Key:      chi.URLParam(r, "key"),
		Limit:    req.Limit,
		Reason:   req.Reason,
	}
	if err := h.svc.SetOverride(r.Context(), override); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, override)
}

func (h *Handler) removeOverride(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	if err := h.svc.RemoveOverride(r.Context(), tenantID.String(), chi.URLParam(r, "key")); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Admin: cross-tenant fleet reads -----------------------------------------

// listTenantLicenses serves G7: a paginated fleet view of every tenant's
// license with current-period seat usage. Filters: ?status, &plan_key,
// &expiring_within_days, &page, &per_page.
func (h *Handler) listTenantLicenses(w http.ResponseWriter, r *http.Request) {
	page, perPage := suiteapi.ParsePagination(r)
	filter := model.TenantLicenseFilter{
		Status:  r.URL.Query().Get("status"),
		PlanKey: r.URL.Query().Get("plan_key"),
		Page:    page,
		PerPage: perPage,
	}
	if raw := r.URL.Query().Get("expiring_within_days"); raw != "" {
		days, err := strconv.Atoi(raw)
		if err != nil || days < 0 {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'expiring_within_days' must be a non-negative integer", nil)
			return
		}
		filter.ExpiringWithinDays = &days
	}
	rows, total, err := h.svc.ListTenantLicenses(r.Context(), filter)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if rows == nil {
		rows = []model.TenantLicenseRow{}
	}
	suiteapi.WritePaginated(w, http.StatusOK, rows, page, perPage, total)
}

// listExpiringLicenses serves G8: active licenses expiring within ?within_days
// (default 30), ordered by expires_at.
func (h *Handler) listExpiringLicenses(w http.ResponseWriter, r *http.Request) {
	withinDays := 30
	if raw := r.URL.Query().Get("within_days"); raw != "" {
		days, err := strconv.Atoi(raw)
		if err != nil || days < 0 {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'within_days' must be a non-negative integer", nil)
			return
		}
		withinDays = days
	}
	rows, err := h.svc.ListExpiringLicenses(r.Context(), withinDays)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if rows == nil {
		rows = []model.TenantLicenseRow{}
	}
	suiteapi.WriteData(w, http.StatusOK, rows)
}

// listOverrides serves G9: a tenant's entitlement overrides.
func (h *Handler) listOverrides(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	overrides, err := h.svc.ListOverrides(r.Context(), tenantID.String())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if overrides == nil {
		overrides = []model.Override{}
	}
	suiteapi.WriteData(w, http.StatusOK, overrides)
}

// adminEntitlements serves G10: a tenant's resolved entitlement set and
// computed license state, scoped by path param rather than the JWT.
func (h *Handler) adminEntitlements(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	decisions, state, err := h.svc.Entitlements(r.Context(), tenantID.String())
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			suiteapi.WriteData(w, http.StatusOK, map[string]any{"license_state": model.StateExpired, "entitlements": []model.Decision{}})
			return
		}
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"license_state": state, "entitlements": decisions})
}

// adminUsage serves G10: a tenant's metered usage for ?period=YYYY-MM
// (default current month).
func (h *Handler) adminUsage(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	period, err := parsePeriod(r.URL.Query().Get("period"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	usage, err := h.svc.ListUsage(r.Context(), tenantID.String(), period)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	if usage == nil {
		usage = []model.Usage{}
	}
	suiteapi.WriteData(w, http.StatusOK, usage)
}

// usageRollup serves G11: a cross-tenant aggregate for ?key (default
// seats.users) in ?period=YYYY-MM (default current month).
func (h *Handler) usageRollup(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		key = model.SeatsKey
	}
	period, err := parsePeriod(r.URL.Query().Get("period"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	rollup, err := h.svc.SeatRollup(r.Context(), key, period)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rollup)
}

// listEntitlementKeys serves G12: the canonical entitlement-key registry.
func (h *Handler) listEntitlementKeys(w http.ResponseWriter, r *http.Request) {
	suiteapi.WriteData(w, http.StatusOK, h.svc.EntitlementKeys())
}

// parsePeriod parses a YYYY-MM period query value; empty returns the zero
// time, which the service treats as the current calendar month.
func parsePeriod(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse("2006-01", raw)
	if err != nil {
		return time.Time{}, errors.New("'period' must be in YYYY-MM format")
	}
	return t, nil
}

// --- Offline license -----------------------------------------------------------

func (h *Handler) issueOffline(w http.ResponseWriter, r *http.Request) {
	if h.signer == nil {
		suiteapi.WriteError(w, r, http.StatusNotImplemented, "not_configured", "offline license signing is not configured on this deployment", nil)
		return
	}
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant ID", nil)
		return
	}
	licenseFile, err := h.svc.IssueOfflineLicense(r.Context(), h.signer, tenantID.String())
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			h.writeServiceError(w, r, err)
			return
		}
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"license_file": licenseFile})
}

type activateRequest struct {
	LicenseFile string `json:"license_file"`
}

func (h *Handler) activateOffline(w http.ResponseWriter, r *http.Request) {
	if h.verifier == nil {
		suiteapi.WriteError(w, r, http.StatusNotImplemented, "not_configured", "offline license activation is not configured on this deployment", nil)
		return
	}
	var req activateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.LicenseFile == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'license_file' is required", nil)
		return
	}
	lic, err := h.svc.ActivateOfflineLicense(r.Context(), h.verifier, req.LicenseFile)
	if err != nil {
		if errors.Is(err, model.ErrAlreadyExists) {
			h.writeServiceError(w, r, err)
			return
		}
		suiteapi.WriteError(w, r, http.StatusBadRequest, "invalid_license", err.Error(), nil)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, lic)
}
