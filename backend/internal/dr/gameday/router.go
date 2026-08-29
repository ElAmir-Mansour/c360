package gameday

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

// gamedayService is the surface the HTTP router needs. *Service satisfies it; an
// interface keeps the router unit-testable without a database.
type gamedayService interface {
	CreateScenario(ctx context.Context, tenantID uuid.UUID, in CreateScenarioInput) (*Scenario, error)
	ListScenarios(ctx context.Context, tenantID uuid.UUID) ([]*Scenario, error)
	ExecuteScenario(ctx context.Context, tenantID uuid.UUID, scenarioID string, initiatedBy *uuid.UUID) (*Scorecard, error)
	GetScorecard(ctx context.Context, tenantID uuid.UUID, runID string) (*Scorecard, error)
}

// Router serves the game-day HTTP surface. It is mounted by the integration phase
// under /api/v1/dr (alongside the main DR handler) so the four endpoints become:
//
//	POST /api/v1/dr/gameday/scenarios               (dr:write)  define a scenario
//	GET  /api/v1/dr/gameday/scenarios               (dr:read)   list scenarios
//	POST /api/v1/dr/gameday/scenarios/{id}/runs     (dr:failover) execute (gated)
//	GET  /api/v1/dr/gameday/runs/{id}               (dr:read)   scorecard
//
// Executing a game-day exercise injects controlled faults, so it carries the same
// dr:failover step-up permission as initiating a failover.
type Router struct {
	svc    gamedayService
	logger zerolog.Logger
}

// NewRouter constructs the game-day HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-gameday").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc gamedayService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the game-day endpoints, permission-gated to
// match the rest of the DR API.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/gameday/scenarios", h.listScenarios)
		r.Get("/gameday/runs/{runID}", h.getScorecard)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/gameday/scenarios", h.createScenario)
	})

	r.Group(func(r chi.Router) {
		// Executing an exercise injects faults — a step-up, gated action.
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/gameday/scenarios/{scenarioID}/runs", h.executeScenario)
	})

	return r
}

// createScenarioRequest is the POST body for defining a scenario.
type createScenarioRequest struct {
	GroupID     string `json:"group_id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Scope       string `json:"scope"`
	Steps       []Step `json:"steps"`
}

// createScenario defines a new game-day scenario. A production scope is rejected
// 422 (the safety guard at definition time).
func (h *Router) createScenario(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req createScenarioRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	sc, err := h.svc.CreateScenario(r.Context(), tenantID, CreateScenarioInput{
		GroupID:     req.GroupID,
		Name:        req.Name,
		Description: req.Description,
		Scope:       req.Scope,
		Steps:       req.Steps,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, sc)
}

// listScenarios returns the tenant's scenarios.
func (h *Router) listScenarios(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	scenarios, err := h.svc.ListScenarios(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if scenarios == nil {
		scenarios = []*Scenario{}
	}
	suiteapi.WriteData(w, http.StatusOK, scenarios)
}

// executeScenario runs a scenario and returns its scorecard. A production-scope
// scenario is refused 422 by the safety guard; the aborted run's scorecard is
// still returned so the caller sees the rejection verdict.
func (h *Router) executeScenario(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	scenarioID, err := suiteapi.UUIDParam(r, "scenarioID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	initiatedBy, _ := suiteapi.UserID(r)

	card, execErr := h.svc.ExecuteScenario(r.Context(), tenantID, scenarioID.String(), initiatedBy)
	if execErr != nil {
		if errors.Is(execErr, ErrProductionScope) {
			// The run was aborted with the rejected-production verdict; surface the
			// scorecard alongside the 422 so the rejection is auditable.
			suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "production_scope", execErr.Error(), card)
			return
		}
		h.writeError(w, r, execErr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, card)
}

// getScorecard returns a run's scorecard.
func (h *Router) getScorecard(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	card, err := h.svc.GetScorecard(r.Context(), tenantID, runID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, card)
}

// tenant extracts the tenant from the request context.
func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// writeError maps game-day sentinel errors to HTTP statuses. The production-scope
// guard is the load-bearing one: it is 422 so a client distinguishes "refused for
// safety" from a generic bad request.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrProductionScope):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "production_scope", err.Error(), nil)
	case errors.Is(err, ErrScenarioExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "scenario_exists", err.Error(), nil)
	case errors.Is(err, ErrScenarioNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrRunNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNoSteps), errors.Is(err, ErrInvalidScope), errors.Is(err, ErrInvalidAction):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr gameday request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ gamedayService = (*Service)(nil)
