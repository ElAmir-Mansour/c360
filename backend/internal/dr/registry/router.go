package registry

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

// runbookService is the Generator surface the HTTP router needs. *Generator
// satisfies it; an interface keeps the router unit-testable without a database.
type runbookService interface {
	GetOrGenerate(ctx context.Context, tenantID uuid.UUID, groupID, profile string) (*RunbookVersion, error)
	ListVersions(ctx context.Context, tenantID uuid.UUID, groupID string) ([]*RunbookVersion, error)
	Regenerate(ctx context.Context, tenantID uuid.UUID, groupID, profile, trigger string) (RegenerateResult, error)
}

// Router serves the Recovery Asset Registry's HTTP surface. It is mounted by
// the integration phase under /api/v1/dr (alongside the main DR handler) so the
// three endpoints become:
//
//	GET  /api/v1/dr/groups/{groupID}/runbook            (dr:read)
//	GET  /api/v1/dr/groups/{groupID}/runbook/versions   (dr:read)
//	POST /api/v1/dr/groups/{groupID}/runbook/regenerate (dr:write)
type Router struct {
	svc    runbookService
	logger zerolog.Logger
}

// NewRouter constructs the registry HTTP router over a Generator.
func NewRouter(gen *Generator, logger zerolog.Logger) *Router {
	return &Router{svc: gen, logger: logger.With().Str("handler", "dr-runbook").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc runbookService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the registry endpoints, permission-gated to
// match the rest of the DR API: reads require dr:read, the regenerate action
// requires dr:write.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/groups/{groupID}/runbook", h.getRunbook)
		r.Get("/groups/{groupID}/runbook/versions", h.listVersions)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/groups/{groupID}/runbook/regenerate", h.regenerate)
	})

	return r
}

// getRunbook returns the current runbook version for a group, generating the
// first version on demand if none exists yet. ?profile=isolated selects the
// drill runbook.
func (h *Router) getRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	profile := normalizeProfile(r.URL.Query().Get("profile"))

	ver, err := h.svc.GetOrGenerate(r.Context(), tenantID, groupID.String(), profile)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, ver)
}

// listVersions returns the full version history of a group's runbook, newest
// first. Returns 404 when no runbook has ever been generated.
func (h *Router) listVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	versions, err := h.svc.ListVersions(r.Context(), tenantID, groupID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, versions)
}

// regenerate forces a regeneration of a group's runbook from its current assets.
// It returns the resulting version and whether a new version was stored (a no-op
// regeneration returns the current version with changed=false). ?profile=
// selects production (default) or isolated.
func (h *Router) regenerate(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	profile := normalizeProfile(r.URL.Query().Get("profile"))

	res, err := h.svc.Regenerate(r.Context(), tenantID, groupID.String(), profile, TriggerManual)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"version": res.Version,
		"changed": res.Changed,
		"diff":    res.Diff,
	})
}

// params extracts the tenant from context and the group ID from the path,
// writing the appropriate error response and returning ok=false on failure.
func (h *Router) params(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	groupID, err := suiteapi.UUIDParam(r, "groupID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, groupID, true
}

// writeError maps registry sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrGroupNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNoAssets):
		suiteapi.WriteError(w, r, http.StatusConflict, "no_assets", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr runbook request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// normalizeProfile maps a query value to a valid network profile; anything
// other than "isolated" is treated as production.
func normalizeProfile(v string) string {
	if v == "isolated" {
		return "isolated"
	}
	return "production"
}

var _ runbookService = (*Generator)(nil)
