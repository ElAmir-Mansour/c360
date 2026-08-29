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
	cyberrecovery "github.com/clario360/platform/internal/recover/cyberrecovery"
	"github.com/clario360/platform/internal/suiteapi"
)

// productService is the surface the router needs; *Service satisfies it. The
// interface keeps the router unit-testable without a database or live
// licensing engine.
type productService interface {
	GetProducts(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductView, error)
	SetActivation(ctx context.Context, tenantID uuid.UUID, subSolution string, activated bool) (*Activation, error)
}

// Router serves the Recover product HTTP surface. It is mounted under
// /api/recover behind the same Auth+Tenant middleware as the rest of the DR
// API, and self-gates each route with RequirePermission:
//
//	GET  /api/recover/products                  (dr:read)
//	POST /api/recover/sub-solutions/{id}/activate   (dr:admin)
type Router struct {
	svc    productService
	logger zerolog.Logger
	// ITDR, when set, registers the IT Disaster Recovery sub-solution workspace
	// surface (GET /api/recover/it-dr/overview) onto the same Auth+Tenant group.
	// It is optional so the product router stays usable without the IT DR plane;
	// cmd wires it via configureRecoverPlane.
	ITDR *ITDRHandler
	// CloudDR, when set, registers the Cloud Disaster Recovery sub-solution
	// workspace surface (overview + region/AZ failover view) onto the same
	// Auth+Tenant group. It is optional so the product router stays usable without
	// the Cloud DR plane; cmd wires it via configureRecoverPlane.
	CloudDR *CloudDRRouter
	// CyberRecovery, when set, registers the Cyber Recovery sub-solution
	// workspace (clean-room recovery flow + mandatory integrity gate) under
	// /cyber-recovery. Optional; cmd wires it via configureRecoverPlane.
	CyberRecovery *cyberrecovery.Router
	// Analytics, when set, registers the cross-sub-solution RTO/RTA & recovery
	// analytics surface (GET /api/recover/analytics) onto the same Auth+Tenant
	// group. Optional; cmd wires it via configureRecoverPlane.
	Analytics *AnalyticsHandler
	// Onboarding, when set, registers the onboarding sub-solution selection +
	// demo-seed surface (POST /onboarding/activate, DELETE /onboarding/demo-data)
	// onto the same Auth+Tenant group. Optional; cmd wires it via
	// configureRecoverPlane.
	Onboarding *OnboardingHandler
	// Evidence, when set, registers the regulatory evidence / "Prove" surface
	// (GET /api/recover/evidence[/{eventId}[/export]]) onto the same Auth+Tenant
	// group. Optional; cmd wires it via configureRecoverPlane.
	Evidence *EvidenceHandler
}

// NewRouter constructs the Recover HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "recover").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc productService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the Recover product surface. Reads require
// dr:read; activation (entitlement-state mutation) requires dr:admin, matching
// the rest of the DR API's admin-gated configuration actions.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/products", h.getProducts)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/sub-solutions/{id}/activate", h.activate)
	})

	// IT Disaster Recovery sub-solution workspace overview. Registered as a
	// concrete route (not a sub-Mount) so chi never double-mounts at "/"; the
	// handler self-gates on dr:read and the service enforces the recover.it_dr
	// entitlement server-side before returning data.
	if h.ITDR != nil {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequirePermission(auth.PermDRRead))
			r.Get("/it-dr/overview", h.ITDR.GetOverview)
		})
	}

	// Cloud Disaster Recovery sub-solution workspace: overview + region/AZ
	// failover view (real bootgraph boot-plan, visualised before execution).
	// Mounted as a sub-router under /cloud-dr; the CloudDRRouter self-gates every
	// route on dr:read and the service composes the existing dr/* read surfaces.
	if h.CloudDR != nil {
		r.Mount("/cloud-dr", h.CloudDR.Routes())
	}

	// Cyber Recovery sub-solution workspace: clean-room recovery flow with the
	// MANDATORY server-side integrity gate (return-to-production blocked until the
	// clean-room scan passes AND an authorized approver signs off). Mounted as a
	// sub-router under /cyber-recovery; the CyberRecovery router self-gates every
	// route (dr:read reads, dr:write actions, dr:admin approval, dr:failover
	// return-to-production) and composes the existing dr/* cleanroom + ransomware
	// services.
	if h.CyberRecovery != nil {
		r.Mount("/cyber-recovery", h.CyberRecovery.Routes())
	}

	// Cross-sub-solution RTO/RTA & recovery analytics (Prompt 8): the REAL
	// portfolio endpoint the landing page and every sub-solution overview consume.
	// Registered as a concrete route (not a sub-Mount) so chi never double-mounts
	// at "/"; the handler self-gates on dr:read and the service enforces a Recover
	// entitlement server-side (any of the three sub-solution keys) before returning
	// data. It composes the Metastore RTO seam + the existing execution records;
	// it owns no recovery logic.
	if h.Analytics != nil {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequirePermission(auth.PermDRRead))
			r.Get("/analytics", h.Analytics.GetAnalytics)
		})
	}

	// Onboarding sub-solution selection + demo templates (Prompt 9): a tenant
	// selects which sub-solutions to activate; the handler records the activation
	// (the Prompt 1 entitlement model) and seeds real demo content per
	// sub-solution so the product lands populated. Registered onto this same
	// Auth+Tenant group; the handler self-gates on dr:admin (it mutates activation
	// state and seeds/removes content). Optional so the product router stays usable
	// without the onboarding plane.
	if h.Onboarding != nil {
		h.Onboarding.Register(r)
	}

	// Audit trail & regulatory evidence export (Prompt 10): the "Prove" surface.
	// Registered as concrete routes (not a sub-Mount) so chi never double-mounts at
	// "/"; the handler self-gates on dr:read and the service enforces a Recover
	// entitlement server-side (any of the three sub-solution keys) before returning
	// any data. It composes the Metastore RTO seam + the EXISTING runbookstudio /
	// cyber-recovery execution records + the append-only audit log; it owns no
	// recovery logic and writes nothing on the read paths.
	if h.Evidence != nil {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequirePermission(auth.PermDRRead))
			r.Get("/evidence", h.Evidence.listEvents)
			r.Get("/evidence/{eventId}", h.Evidence.getReport)
			r.Get("/evidence/{eventId}/export", h.Evidence.export)
		})
	}

	return r
}

// getProducts returns the Recover product with per-sub-solution entitlement
// state and the underlying capabilities for the calling tenant.
func (h *Router) getProducts(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}

	view, err := h.svc.GetProducts(r.Context(), tenantID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, view)
}

// activateRequest toggles a sub-solution's activation for the tenant.
type activateRequest struct {
	Activated bool `json:"activated"`
}

// activate persists whether the tenant has activated a sub-solution.
func (h *Router) activate(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "sub-solution id is required", nil)
		return
	}

	var req activateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}

	act, err := h.svc.SetActivation(r.Context(), tenantID, id, req.Activated)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, act)
}

// writeError maps recover sentinel errors to HTTP statuses; an unexpected error
// is logged and returned as a generic 500 with no stack trace leaked.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnknownSubSolution):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable", "unable to verify license entitlement", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
