package selfdr

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// selfdrService is the surface the HTTP router needs. *Service satisfies it; an
// interface keeps the router unit-testable without a database.
type selfdrService interface {
	RequiredComponents() []ComponentKind
	SealingEnabled() bool
	Assess(ctx context.Context, tenantID, actor uuid.UUID, profile *SelfDRProfile) (*StoredAssessment, *ReadinessAssessment, error)
	GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error)
	GetLatest(ctx context.Context, tenantID uuid.UUID) (*AssessmentReport, error)
	CaptureBackup(ctx context.Context, tenantID, actor uuid.UUID, req BackupRequest) (*StoredArtifact, error)
	GenerateBundle(ctx context.Context, tenantID, actor uuid.UUID, req OfflineBundleRequest) (*StoredArtifact, error)
	ListArtifacts(ctx context.Context, tenantID uuid.UUID, limit int) ([]StoredArtifact, error)
}

// Router serves the control-plane self-DR HTTP surface, mounted under /api/v1/dr:
//
//	GET  /api/v1/dr/selfdr/components             (dr:read)  — required component baseline
//	POST /api/v1/dr/selfdr/assess                 (dr:write) — evaluate readiness (optional profile body)
//	GET  /api/v1/dr/selfdr/assessments/latest     (dr:read)  — latest report
//	GET  /api/v1/dr/selfdr/assessments/{id}       (dr:read)  — report + artifacts
//	GET  /api/v1/dr/selfdr/artifacts              (dr:read)  — sealed artifacts
//	POST /api/v1/dr/selfdr/backups                (dr:admin) — capture+seal a control-plane backup
//	POST /api/v1/dr/selfdr/offline-bundle         (dr:admin) — generate+seal an offline restore bundle
type Router struct {
	svc    selfdrService
	logger zerolog.Logger
}

// NewRouter constructs the router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-selfdr").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc selfdrService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the self-DR endpoints. Reads require dr:read,
// running an assessment requires dr:write, and the operational seal paths
// (backup, offline bundle) require dr:admin.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/selfdr/components", h.listComponents)
		r.Get("/selfdr/assessments/latest", h.getLatest)
		r.Get("/selfdr/assessments/{id}", h.getAssessment)
		r.Get("/selfdr/artifacts", h.listArtifacts)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/selfdr/assess", h.assess)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/selfdr/backups", h.captureBackup)
		r.Post("/selfdr/offline-bundle", h.generateBundle)
	})

	return r
}

func (h *Router) listComponents(w http.ResponseWriter, r *http.Request) {
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"required_components": h.svc.RequiredComponents(),
		"sealing_enabled":     h.svc.SealingEnabled(),
	})
}

// assess evaluates control-plane self-DR readiness. The request body is an
// optional SelfDRProfile; when absent, the built-in baseline profile is used. The
// service overlays the real sealed-artifact evidence before scoring.
func (h *Router) assess(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.identity(w, r)
	if !ok {
		return
	}
	profile, derr := decodeOptionalProfile(r.Body)
	if derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid self-DR profile body", nil)
		return
	}
	hdr, scored, err := h.svc.Assess(r.Context(), tenantID, actor, profile)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, map[string]any{
		"assessment":   hdr,
		"verdict":      scored.Verdict,
		"findings":     scored.Findings,
		"restore_plan": scored.RestorePlan,
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
	report, gerr := h.svc.GetLatest(r.Context(), tenantID)
	if gerr != nil {
		h.writeError(w, r, gerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func (h *Router) listArtifacts(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, perr := strconv.Atoi(raw); perr == nil {
			limit = n
		}
	}
	artifacts, aerr := h.svc.ListArtifacts(r.Context(), tenantID, limit)
	if aerr != nil {
		h.writeError(w, r, aerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, artifacts)
}

// backupRequestBody is the JSON body of POST /selfdr/backups.
type backupRequestBody struct {
	ComponentID   string            `json:"component_id"`
	ComponentKind string            `json:"component_kind"`
	LocationID    string            `json:"location_id,omitempty"`
	StreamID      string            `json:"stream_id,omitempty"`
	Marker        string            `json:"marker,omitempty"`
	MaxRPOSeconds int               `json:"max_rpo_seconds,omitempty"`
	RetainDays    int               `json:"retain_days,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

func (h *Router) captureBackup(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.identity(w, r)
	if !ok {
		return
	}
	var body backupRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid backup request body", nil)
		return
	}
	if body.ComponentID == "" || body.ComponentKind == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "component_id and component_kind are required", nil)
		return
	}
	req := BackupRequest{
		ComponentID:   body.ComponentID,
		ComponentKind: ComponentKind(body.ComponentKind),
		LocationID:    body.LocationID,
		StreamID:      body.StreamID,
		Marker:        body.Marker,
		MaxRPOSeconds: body.MaxRPOSeconds,
		RetainUntil:   retainUntil(body.RetainDays),
		Metadata:      body.Metadata,
	}
	art, err := h.svc.CaptureBackup(r.Context(), tenantID, actor, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, art)
}

// bundleRequestBody is the JSON body of POST /selfdr/offline-bundle.
type bundleRequestBody struct {
	Profile      *SelfDRProfile          `json:"profile,omitempty"`
	Runbook      OperatorRunbookMetadata `json:"runbook,omitempty"`
	Format       string                  `json:"format,omitempty"`
	LocationID   string                  `json:"location_id,omitempty"`
	StreamID     string                  `json:"stream_id,omitempty"`
	RetainDays   int                     `json:"retain_days,omitempty"`
	ManifestNote string                  `json:"manifest_note,omitempty"`
}

func (h *Router) generateBundle(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.identity(w, r)
	if !ok {
		return
	}
	var body bundleRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid offline-bundle request body", nil)
		return
	}
	req := OfflineBundleRequest{
		Runbook:      body.Runbook,
		Format:       OfflineBundleFormat(body.Format),
		LocationID:   body.LocationID,
		StreamID:     body.StreamID,
		RetainUntil:  retainUntil(body.RetainDays),
		ManifestNote: body.ManifestNote,
	}
	if body.Profile != nil {
		req.Profile = *body.Profile
	}
	art, err := h.svc.GenerateBundle(r.Context(), tenantID, actor, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, art)
}

// identity resolves the tenant and actor, writing a 401 and returning ok=false
// when either is missing.
func (h *Router) identity(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	actorPtr, uerr := suiteapi.UserID(r)
	if uerr != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", uerr.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	var actor uuid.UUID
	if actorPtr != nil {
		actor = *actorPtr
	}
	return tenantID, actor, true
}

// writeError maps domain errors to HTTP status codes; anything unrecognised is a
// 500 with the error logged (not leaked to the client).
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrAssessmentNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "assessment_not_found", "self-DR assessment not found", nil)
	case errors.Is(err, ErrSealingNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "sealing_not_configured", "self-DR immutable sealing (WORM) is not configured", nil)
	case errors.Is(err, ErrEmptyProfile):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "empty_profile", "self-DR profile has no components", nil)
	default:
		h.logger.Error().Err(err).Msg("selfdr request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error", nil)
	}
}

// decodeOptionalProfile decodes a SelfDRProfile from the body, returning nil for
// an empty body (the service then uses the baseline profile).
func decodeOptionalProfile(body io.Reader) (*SelfDRProfile, error) {
	if body == nil {
		return nil, nil
	}
	var p SelfDRProfile
	if err := json.NewDecoder(body).Decode(&p); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// retainUntil converts a retain-days window into an absolute timestamp, or zero
// when unset (the sealer then applies the WORM store's default retention).
func retainUntil(days int) time.Time {
	if days <= 0 {
		return time.Time{}
	}
	return time.Now().UTC().AddDate(0, 0, days)
}
