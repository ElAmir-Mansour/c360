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
	"github.com/clario360/platform/internal/recover/metastore"
	"github.com/clario360/platform/internal/suiteapi"
)

// onboardingService is the surface the onboarding handler needs; *Onboarding
// Service satisfies it. The interface keeps the handler unit-testable without a
// database, the Metastore seam, or Runbook Studio.
type onboardingService interface {
	Onboard(ctx context.Context, tenantID uuid.UUID, selected []string, createdBy *string) (*OnboardResult, error)
	RemoveDemoData(ctx context.Context, tenantID uuid.UUID) (*RemoveDemoResult, error)
}

// OnboardingHandler serves the Recover onboarding surface: the sub-solution
// selection + demo-seed step and the one-click demo-data removal. It is mounted
// onto the same /api/recover Auth+Tenant group as the rest of the product and
// self-gates each route with RequirePermission (dr:admin — onboarding mutates
// activation/entitlement state and seeds/removes content):
//
//	POST   /api/recover/onboarding/activate     (dr:admin)
//	DELETE /api/recover/onboarding/demo-data     (dr:admin)
//
// It composes the OnboardingService; it owns no recovery or seeding logic.
type OnboardingHandler struct {
	svc    onboardingService
	logger zerolog.Logger
}

// NewOnboardingHandler constructs the onboarding handler over an Onboarding
// Service.
func NewOnboardingHandler(svc *OnboardingService, logger zerolog.Logger) *OnboardingHandler {
	return &OnboardingHandler{svc: svc, logger: logger.With().Str("handler", "recover-onboarding").Logger()}
}

// newOnboardingHandler is the internal constructor accepting the service
// interface (tests).
func newOnboardingHandler(svc onboardingService, logger zerolog.Logger) *OnboardingHandler {
	return &OnboardingHandler{svc: svc, logger: logger}
}

// Register wires the onboarding routes onto an existing Auth+Tenant chi group.
// The recover Router calls this from Routes() when an OnboardingHandler is set,
// so the routes share the product's middleware and chi never double-mounts.
func (h *OnboardingHandler) Register(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/onboarding/activate", h.activate)
		r.Delete("/onboarding/demo-data", h.removeDemoData)
	})
}

// onboardRequest is the onboarding activation payload: the sub-solution slugs
// the tenant chose to activate. seed_demo defaults to true (the onboarding flow
// lands a populated product); a caller can set it false to activate without
// seeding, but the demo content is what makes the product discoverable, so the
// default seeds.
type onboardRequest struct {
	SubSolutions []string `json:"sub_solutions"`
}

// activate records the tenant's sub-solution activation choice and seeds demo
// content per selected sub-solution.
func (h *OnboardingHandler) activate(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}

	var req onboardRequest
	if derr := suiteapi.DecodeJSON(r, &req); derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	if len(req.SubSolutions) == 0 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "at least one sub_solution must be selected", nil)
		return
	}

	createdBy := actingUser(r)
	result, err := h.svc.Onboard(r.Context(), tenantID, req.SubSolutions, createdBy)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// removeDemoData removes all demo content the onboarding flow seeded for the
// tenant. It is idempotent: a tenant with no demo content yields a zero result.
func (h *OnboardingHandler) removeDemoData(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}

	result, err := h.svc.RemoveDemoData(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// actingUser resolves the calling user id from the request (recorded as the demo
// runbooks' author). A missing/invalid user id yields nil — the runbook author
// is optional — rather than failing the request, which is already authenticated.
func actingUser(r *http.Request) *string {
	uid, err := suiteapi.UserID(r)
	if err != nil || uid == nil {
		return nil
	}
	s := uid.String()
	return &s
}

// writeError maps onboarding errors to HTTP statuses; an unexpected error is
// logged and returned as a generic 500 with no stack trace leaked.
func (h *OnboardingHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNoSubSolutionsSelected):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrUnknownSubSolution):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, metastore.ErrInvalid):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover onboarding request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
