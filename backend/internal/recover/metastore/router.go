package metastore

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

// registryAPI is the registry surface the router needs; *DefaultRegistry
// satisfies it. The interface keeps the router unit-testable without a database.
type registryAPI interface {
	ResolveApplication(ctx context.Context, tenantID uuid.UUID, id string) (*Application, error)
	ListApplications(ctx context.Context, tenantID uuid.UUID, limit, offset int) (ListPage, error)
	CreateApplication(ctx context.Context, tenantID uuid.UUID, in ApplicationInput) (*Application, error)
	UpdateApplication(ctx context.Context, tenantID uuid.UUID, id string, in ApplicationInput) (*Application, error)
	DeleteApplication(ctx context.Context, tenantID uuid.UUID, id string) error
}

// populatorAPI is the populate/sync surface the router needs; *Populator
// satisfies it.
type populatorAPI interface {
	Populate(ctx context.Context, tenantID uuid.UUID, appID string, createdBy *string) (*PopulateResult, error)
	Sync(ctx context.Context, tenantID uuid.UUID, appID, runbookID string) (*SyncResult, error)
}

// Router serves the Application Metastore HTTP surface. It is mounted under
// /api/recover (so the routes are /api/recover/metastore/...) behind the same
// Auth+Tenant middleware as the rest of the Recover API, and self-gates each
// route with RequirePermission:
//
//	GET    /api/recover/metastore/applications                         (dr:read)
//	POST   /api/recover/metastore/applications                         (dr:admin)
//	GET    /api/recover/metastore/applications/{id}                    (dr:read)
//	PUT    /api/recover/metastore/applications/{id}                    (dr:admin)
//	DELETE /api/recover/metastore/applications/{id}                    (dr:admin)
//	POST   /api/recover/metastore/applications/{id}/populate           (dr:write)
//	POST   /api/recover/metastore/applications/{id}/runbooks/{rid}/sync (dr:read)
type Router struct {
	registry  registryAPI
	populator populatorAPI
	logger    zerolog.Logger
}

// NewRouter constructs the Metastore HTTP router over a registry + populator.
func NewRouter(registry *DefaultRegistry, populator *Populator, logger zerolog.Logger) *Router {
	return &Router{
		registry:  registry,
		populator: populator,
		logger:    logger.With().Str("handler", "metastore").Logger(),
	}
}

// newRouter is the internal constructor accepting the interfaces (tests).
func newRouter(registry registryAPI, populator populatorAPI, logger zerolog.Logger) *Router {
	return &Router{registry: registry, populator: populator, logger: logger}
}

// Routes returns the chi.Router for the Metastore surface. Reads require
// dr:read; populate (authoring a runbook) requires dr:write, matching the
// Runbook Studio authoring permission; registry mutation requires dr:admin,
// matching the rest of the Recover/DR admin-gated configuration actions.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/metastore/applications", h.listApplications)
		r.Get("/metastore/applications/{id}", h.getApplication)
		r.Post("/metastore/applications/{id}/runbooks/{runbookID}/sync", h.sync)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/metastore/applications/{id}/populate", h.populate)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/metastore/applications", h.createApplication)
		r.Put("/metastore/applications/{id}", h.updateApplication)
		r.Delete("/metastore/applications/{id}", h.deleteApplication)
	})

	return r
}

// applicationRequest is the create/update payload.
type applicationRequest struct {
	AppKey           string            `json:"app_key"`
	Name             string            `json:"name"`
	Description      string            `json:"description"`
	RecoveryTier     string            `json:"recovery_tier"`
	RTOTargetSeconds int               `json:"rto_target_seconds"`
	Owners           []ownerRequest    `json:"owners"`
	Environments     []environmentReq  `json:"environments"`
	Dependencies     []dependencyReq   `json:"dependencies"`
	CloudAccounts    []cloudAccountReq `json:"cloud_accounts"`
}

type ownerRequest struct {
	Role    string `json:"role"`
	Name    string `json:"name"`
	Contact string `json:"contact"`
}

type environmentReq struct {
	Key              string `json:"key"`
	Kind             string `json:"kind"`
	Region           string `json:"region"`
	IsRecoveryTarget bool   `json:"is_recovery_target"`
}

type dependencyReq struct {
	DependsOnAppKey string `json:"depends_on_app_key"`
	Criticality     string `json:"criticality"`
}

type cloudAccountReq struct {
	Provider   string `json:"provider"`
	AccountRef string `json:"account_ref"`
	Region     string `json:"region"`
}

func (req applicationRequest) toInput() ApplicationInput {
	in := ApplicationInput{
		AppKey:           req.AppKey,
		Name:             req.Name,
		Description:      req.Description,
		RecoveryTier:     req.RecoveryTier,
		RTOTargetSeconds: req.RTOTargetSeconds,
	}
	for _, o := range req.Owners {
		in.Owners = append(in.Owners, Owner{Role: o.Role, Name: o.Name, Contact: o.Contact})
	}
	for _, e := range req.Environments {
		in.Environments = append(in.Environments, Environment{Key: e.Key, Kind: e.Kind, Region: e.Region, IsRecoveryTarget: e.IsRecoveryTarget})
	}
	for _, d := range req.Dependencies {
		in.Dependencies = append(in.Dependencies, Dependency{DependsOnAppKey: d.DependsOnAppKey, Criticality: d.Criticality})
	}
	for _, a := range req.CloudAccounts {
		in.CloudAccounts = append(in.CloudAccounts, CloudAccount{Provider: a.Provider, AccountRef: a.AccountRef, Region: a.Region})
	}
	return in
}

func (h *Router) listApplications(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	offset := (page - 1) * perPage

	res, err := h.registry.ListApplications(r.Context(), tenantID, perPage, offset)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, res.Applications, page, perPage, res.Total)
}

func (h *Router) getApplication(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	app, err := h.registry.ResolveApplication(r.Context(), tenantID, chi.URLParam(r, "id"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, app)
}

func (h *Router) createApplication(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	var req applicationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	app, err := h.registry.CreateApplication(r.Context(), tenantID, req.toInput())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, app)
}

func (h *Router) updateApplication(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	var req applicationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	app, err := h.registry.UpdateApplication(r.Context(), tenantID, chi.URLParam(r, "id"), req.toInput())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, app)
}

func (h *Router) deleteApplication(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	if err := h.registry.DeleteApplication(r.Context(), tenantID, chi.URLParam(r, "id")); err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"deleted": true})
}

func (h *Router) populate(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	var createdBy *string
	if userID, uerr := suiteapi.UserID(r); uerr == nil && userID != nil {
		s := userID.String()
		createdBy = &s
	}
	res, err := h.populator.Populate(r.Context(), tenantID, chi.URLParam(r, "id"), createdBy)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, res)
}

func (h *Router) sync(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	res, err := h.populator.Sync(r.Context(), tenantID, chi.URLParam(r, "id"), chi.URLParam(r, "runbookID"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, res)
}

// writeError maps metastore sentinel errors to HTTP statuses; an unexpected
// error is logged and returned as a generic 500 with no stack trace leaked.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrRunbookNotLinked):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalid):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrNoRecoveryTarget):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "no_recovery_target", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("metastore request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
