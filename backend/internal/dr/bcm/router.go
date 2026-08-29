package bcm

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

// bcmService is the surface the HTTP router needs. *Service satisfies it; an
// interface keeps the router unit-testable without a database.
type bcmService interface {
	ListPacks() []Pack
	GetPack(key string) (Pack, error)
	Assess(ctx context.Context, tenantID, groupID, actor uuid.UUID, packKey string) (*StoredAssessment, *Assessment, error)
	GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error)
}

// Router serves the BCM compliance-pack HTTP surface. It is mounted by the
// integration phase under /api/v1/dr (alongside the main DR handler) so the
// endpoints become:
//
//	GET  /api/v1/dr/bcm/packs                      (dr:read)  — catalog
//	GET  /api/v1/dr/bcm/packs/{key}                (dr:read)  — one pack + controls
//	POST /api/v1/dr/bcm/packs/{key}/assess?group=  (dr:write) — run an assessment
//	GET  /api/v1/dr/bcm/assessments/{id}           (dr:read)  — report + gaps
type Router struct {
	svc    bcmService
	logger zerolog.Logger
}

// NewRouter constructs the router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-bcm").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc bcmService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the BCM endpoints, permission-gated to match
// the rest of the DR API: reads require dr:read, running an assessment requires
// dr:write.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/bcm/packs", h.listPacks)
		r.Get("/bcm/packs/{key}", h.getPack)
		r.Get("/bcm/assessments/{id}", h.getAssessment)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/bcm/packs/{key}/assess", h.assess)
	})

	return r
}

func (h *Router) listPacks(w http.ResponseWriter, r *http.Request) {
	suiteapi.WriteData(w, http.StatusOK, h.svc.ListPacks())
}

func (h *Router) getPack(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	pack, err := h.svc.GetPack(key)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, pack)
}

// assess runs an assessment of the pack against the group named by the required
// ?group=<uuid> query parameter and returns the scored result (header + score +
// gaps).
func (h *Router) assess(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	actorPtr, uerr := suiteapi.UserID(r)
	if uerr != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", uerr.Error(), nil)
		return
	}
	var actor uuid.UUID
	if actorPtr != nil {
		actor = *actorPtr
	}

	key := chi.URLParam(r, "key")
	groupRaw := r.URL.Query().Get("group")
	if groupRaw == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group query parameter is required", nil)
		return
	}
	groupID, perr := uuid.Parse(groupRaw)
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group must be a valid UUID", nil)
		return
	}

	hdr, scored, aerr := h.svc.Assess(r.Context(), tenantID, groupID, actor, key)
	if aerr != nil {
		h.writeError(w, r, aerr)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, map[string]any{
		"assessment": hdr,
		"score":      scored.Score,
		"compliant":  scored.Compliant,
		"controls":   scored.ControlResults,
		"gaps":       scored.Gaps,
	})
}

func (h *Router) getAssessment(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	id, perr := suiteapi.UUIDParam(r, "id")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	report, gerr := h.svc.GetReport(r.Context(), tenantID, id)
	if gerr != nil {
		h.writeError(w, r, gerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// writeError maps domain errors to HTTP status codes; anything unrecognised is a
// 500 with the error logged (not leaked to the client).
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrPackNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "pack_not_found", "compliance pack not found", nil)
	case errors.Is(err, ErrAssessmentNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "assessment_not_found", "assessment not found", nil)
	case errors.Is(err, ErrGroupNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "group_not_found", "consistency group not found", nil)
	default:
		h.logger.Error().Err(err).Msg("bcm request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error", nil)
	}
}
