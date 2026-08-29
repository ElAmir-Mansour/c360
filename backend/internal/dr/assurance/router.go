package assurance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// assuranceService is the surface the HTTP router needs. *Service satisfies it;
// an interface keeps the router unit-testable without a database.
type assuranceService interface {
	ListControls() []ControlInfo
	Evaluate(ctx context.Context, tenantID, groupID, actor uuid.UUID) (*StoredAssessment, *AssuranceAssessment, error)
	GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error)
	GetLatest(ctx context.Context, tenantID, groupID uuid.UUID) (*AssessmentReport, error)
}

// Router serves the recovery-assurance HTTP surface. It is mounted by the
// integration phase under /api/v1/dr (alongside the main DR handler) so the
// endpoints become:
//
//	GET  /api/v1/dr/assurance/controls                     (dr:read)  — control catalog
//	POST /api/v1/dr/assurance/groups/{group}/evaluate      (dr:write|dr:admin) — run an evaluation
//	GET  /api/v1/dr/assurance/groups/{group}/latest        (dr:read)  — latest report
//	GET  /api/v1/dr/assurance/assessments/{id}             (dr:read)  — report + findings
type Router struct {
	svc    assuranceService
	logger zerolog.Logger
}

// NewRouter constructs the router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-assurance").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc assuranceService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the assurance endpoints, permission-gated to
// match the rest of the DR API: reads require dr:read, running an evaluation
// requires dr:write or dr:admin.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/assurance/controls", h.listControls)
		r.Get("/assurance/groups/{group}/latest", h.getLatest)
		r.Get("/assurance/assessments/{id}", h.getAssessment)
	})

	r.Group(func(r chi.Router) {
		r.Use(requireAnyPermission(auth.PermDRWrite, auth.PermDRAdmin))
		r.Post("/assurance/groups/{group}/evaluate", h.evaluate)
	})

	return r
}

func requireAnyPermission(permissions ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := auth.UserFromContext(r.Context())
			if user == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":  401,
					"code":    "UNAUTHENTICATED",
					"message": "authentication required",
				})
				return
			}
			if !auth.HasAnyPermission(user.Roles, permissions...) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":  403,
					"code":    "FORBIDDEN",
					"message": "you do not have permission to perform this action",
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (h *Router) listControls(w http.ResponseWriter, r *http.Request) {
	suiteapi.WriteData(w, http.StatusOK, h.svc.ListControls())
}

// evaluate runs an assurance evaluation against the group named by the {group}
// path parameter and returns the scored result (header + score + findings).
func (h *Router) evaluate(w http.ResponseWriter, r *http.Request) {
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

	groupID, perr := suiteapi.UUIDParam(r, "group")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}

	hdr, scored, aerr := h.svc.Evaluate(r.Context(), tenantID, groupID, actor)
	if aerr != nil {
		h.writeError(w, r, aerr)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, map[string]any{
		"assessment":      hdr,
		"score":           scored.Score,
		"verdict":         scored.Verdict,
		"results":         scored.Results,
		"findings":        scored.Findings,
		"recommendations": scored.Recommendations,
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

func (h *Router) getLatest(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	groupID, perr := suiteapi.UUIDParam(r, "group")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	report, gerr := h.svc.GetLatest(r.Context(), tenantID, groupID)
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
	case errors.Is(err, ErrAssessmentNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "assessment_not_found", "assurance assessment not found", nil)
	case errors.Is(err, ErrGroupNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "group_not_found", "consistency group not found", nil)
	case errors.Is(err, ErrServiceUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "service_unavailable", "assurance service is not fully configured", nil)
	default:
		h.logger.Error().Err(err).Msg("assurance request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error", nil)
	}
}
