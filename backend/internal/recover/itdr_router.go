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

// itdrService is the surface the IT DR handler needs; *ITDRService satisfies it.
// The interface keeps the handler unit-testable without a database or live
// licensing engine.
type itdrService interface {
	Overview(ctx context.Context, tenantID uuid.UUID, authorization string, page, perPage int) (*ITDROverview, error)
}

// ITDRHandler serves the Recover IT Disaster Recovery sub-solution workspace
// surface. It is mounted under /api/recover/it-dr behind the same Auth+Tenant
// middleware as the rest of the Recover product, self-gates on dr:read, and the
// service additionally enforces the recover.it_dr entitlement before returning
// any data:
//
//	GET /api/recover/it-dr/overview   (dr:read + recover.it_dr entitlement)
//
// It composes the EXISTING dr/* runbook-studio and drill-scheduler state into
// one aggregated overview (runbook inventory, readiness score computed from real
// state, last/upcoming rehearsal, open approval gates). It owns no recovery
// logic — the live runbook editing, rehearsal execution, and approval sign-off
// all remain in their owning dr/* routers, which stay mounted so a runbook stays
// editable mid-event without this surface halting it.
type ITDRHandler struct {
	svc    itdrService
	logger zerolog.Logger
}

// NewITDRHandler constructs the IT DR workspace handler over an ITDRService.
func NewITDRHandler(svc *ITDRService, logger zerolog.Logger) *ITDRHandler {
	return &ITDRHandler{svc: svc, logger: logger.With().Str("handler", "recover-it-dr").Logger()}
}

// newITDRHandler is the internal constructor accepting the service interface (tests).
func newITDRHandler(svc itdrService, logger zerolog.Logger) *ITDRHandler {
	return &ITDRHandler{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the IT DR workspace surface as a standalone
// router (used by the handler's own tests). In the running service the recover
// Router registers GetOverview directly onto its existing Auth+Tenant group (see
// router.go) so chi never double-mounts at "/".
func (h *ITDRHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/it-dr/overview", h.GetOverview)
	})
	return r
}

// GetOverview returns the IT DR sub-solution overview for the calling tenant:
// runbook inventory, readiness score (computed from real persisted state), the
// last and upcoming rehearsal, and the open approval gates blocking active runs.
func (h *ITDRHandler) GetOverview(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)

	view, err := h.svc.Overview(r.Context(), tenantID, r.Header.Get("Authorization"), page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, view)
}

// writeError maps IT DR sentinel errors to HTTP statuses; an unexpected error is
// logged and returned as a generic 500 with no stack trace leaked.
func (h *ITDRHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrITDRNotEntitled):
		suiteapi.WriteError(w, r, http.StatusPaymentRequired, "not_entitled",
			"IT Disaster Recovery is not enabled for this tenant", map[string]string{
				"upgrade_url": "/register?suites=recover&plan=trial",
			})
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable",
			"unable to verify license entitlement", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover it-dr request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
