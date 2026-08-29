package cybervault

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

// cyberVaultService is the HTTP-facing service surface. *Service satisfies it;
// tests use a stub so router behavior is isolated from persistence.
type cyberVaultService interface {
	UpsertVaultPosture(ctx context.Context, tenantID, groupID uuid.UUID, posture VaultPosture) (RegisteredVault, error)
	UpdateVaultPosture(ctx context.Context, tenantID, groupID, vaultID uuid.UUID, posture VaultPosture) (RegisteredVault, error)
	ListVaultPostures(ctx context.Context, tenantID, groupID uuid.UUID) ([]RegisteredVault, error)
	EvaluateVault(ctx context.Context, tenantID, groupID, vaultID uuid.UUID) (*StoredPostureAssessment, error)
	ListLatestAssessments(ctx context.Context, tenantID, groupID uuid.UUID) ([]StoredPostureAssessment, error)
	LatestAssessmentByVault(ctx context.Context, tenantID, vaultID uuid.UUID) (*StoredPostureAssessment, error)
	PlanSync(ctx context.Context, tenantID, groupID, vaultID uuid.UUID, window SyncWindow, request SyncRequest) (SyncPlan, error)
}

// Router serves the cyber-vault HTTP surface. It is mounted by the integration
// phase under /api/v1/dr, giving:
//
//	POST /api/v1/dr/cyber-vaults?group=                       (dr:write) register/upsert posture
//	PUT  /api/v1/dr/cyber-vaults/{vaultID}?group=             (dr:write) update posture for an id
//	GET  /api/v1/dr/cyber-vaults?group=                       (dr:read)  list vaults
//	POST /api/v1/dr/cyber-vaults/{vaultID}/evaluate?group=    (dr:write) evaluate and record assessment
//	POST /api/v1/dr/cyber-vaults/{vaultID}/sync/plan?group=   (dr:write) plan a controlled sync window (policy gate)
//	GET  /api/v1/dr/cyber-vaults/assessments?group=           (dr:read)  list latest assessments
//	GET  /api/v1/dr/cyber-vaults/{vaultID}/assessments/latest (dr:read)  latest assessment for a vault
type Router struct {
	svc    cyberVaultService
	logger zerolog.Logger
}

// NewRouter constructs the cyber-vault HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-cybervault").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc cyberVaultService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with cyber-vault endpoints, permission-gated to
// match the rest of the DR API.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/cyber-vaults", h.listVaults)
		r.Get("/cyber-vaults/assessments", h.listAssessments)
		r.Get("/cyber-vaults/{vaultID}/assessments/latest", h.latestAssessment)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/cyber-vaults", h.upsertVault)
		r.Put("/cyber-vaults/{vaultID}", h.upsertVaultByID)
		r.Post("/cyber-vaults/{vaultID}/evaluate", h.evaluateVault)
		r.Post("/cyber-vaults/{vaultID}/sync/plan", h.planSync)
	})

	return r
}

type upsertVaultRequest struct {
	VaultPosture
	Posture *VaultPosture `json:"posture,omitempty"`
}

func (h *Router) upsertVault(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.scope(w, r)
	if !ok {
		return
	}
	posture, ok := h.decodePosture(w, r)
	if !ok {
		return
	}
	out, err := h.svc.UpsertVaultPosture(r.Context(), tenantID, groupID, posture)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

func (h *Router) upsertVaultByID(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, vaultID, ok := h.scopedVaultParams(w, r)
	if !ok {
		return
	}
	posture, ok := h.decodePosture(w, r)
	if !ok {
		return
	}
	out, err := h.svc.UpdateVaultPosture(r.Context(), tenantID, groupID, vaultID, posture)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) listVaults(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.scope(w, r)
	if !ok {
		return
	}
	vaults, err := h.svc.ListVaultPostures(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if vaults == nil {
		vaults = []RegisteredVault{}
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"vaults": vaults, "count": len(vaults)})
}

func (h *Router) evaluateVault(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, vaultID, ok := h.scopedVaultParams(w, r)
	if !ok {
		return
	}
	assessment, err := h.svc.EvaluateVault(r.Context(), tenantID, groupID, vaultID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, assessment)
}

// planSyncRequest is the JSON body of POST /cyber-vaults/{vaultID}/sync/plan: the
// approved window and the operator's requested plan context.
type planSyncRequest struct {
	Window  SyncWindow  `json:"window"`
	Request SyncRequest `json:"request"`
}

// planSync evaluates a controlled cyber-vault sync request against an approved
// window and returns the deterministic policy decision (allowed or blocked with
// findings). It records nothing — it is the policy gate operators consult before
// running an operation — so it returns 200, not 201.
func (h *Router) planSync(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, vaultID, ok := h.scopedVaultParams(w, r)
	if !ok {
		return
	}
	var body planSyncRequest
	if err := suiteapi.DecodeJSON(r, &body); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	plan, err := h.svc.PlanSync(r.Context(), tenantID, groupID, vaultID, body.Window, body.Request)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *Router) listAssessments(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.scope(w, r)
	if !ok {
		return
	}
	assessments, err := h.svc.ListLatestAssessments(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if assessments == nil {
		assessments = []StoredPostureAssessment{}
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"assessments": assessments, "count": len(assessments)})
}

func (h *Router) latestAssessment(w http.ResponseWriter, r *http.Request) {
	tenantID, vaultID, ok := h.vaultParams(w, r)
	if !ok {
		return
	}
	assessment, err := h.svc.LatestAssessmentByVault(r.Context(), tenantID, vaultID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, assessment)
}

func (h *Router) decodePosture(w http.ResponseWriter, r *http.Request) (VaultPosture, bool) {
	var req upsertVaultRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return VaultPosture{}, false
	}
	if req.Posture != nil {
		return *req.Posture, true
	}
	return req.VaultPosture, true
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) vaultParams(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	vaultID, err := suiteapi.UUIDParam(r, "vaultID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, vaultID, true
}

func (h *Router) scope(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	groupID, ok := h.group(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, groupID, true
}

func (h *Router) scopedVaultParams(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	tenantID, vaultID, ok := h.vaultParams(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	groupID, ok := h.group(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return tenantID, groupID, vaultID, true
}

func (h *Router) group(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	groupRaw := r.URL.Query().Get("group")
	if groupRaw == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group query parameter is required", nil)
		return uuid.Nil, false
	}
	groupID, err := uuid.Parse(groupRaw)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group must be a valid UUID", nil)
		return uuid.Nil, false
	}
	return groupID, true
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrVaultNotFound), errors.Is(err, ErrAssessmentNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrInvalidRequest):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrSourceUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "source_unavailable", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr cybervault request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ cyberVaultService = (*Service)(nil)
