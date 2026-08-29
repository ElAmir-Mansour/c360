package iacdr

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// iacService is the surface the HTTP router needs. *Service satisfies it; an
// interface keeps the router unit-testable without a database.
type iacService interface {
	Ingest(ctx context.Context, tenantID uuid.UUID, req IngestRequest) (*Snapshot, error)
	GetSnapshot(ctx context.Context, tenantID uuid.UUID, snapshotID string) (*Snapshot, error)
	ListSnapshots(ctx context.Context, tenantID uuid.UUID) ([]Snapshot, error)
	Diff(ctx context.Context, tenantID uuid.UUID, targetID, baseID string) (DiffResult, error)
	ReconstitutionPlan(ctx context.Context, tenantID uuid.UUID, snapshotID string) (ReconstitutionPlan, error)
}

// Router serves the Infrastructure-as-Code DR HTTP surface. It is mounted by the
// integration phase under /api/v1/dr so the endpoints become:
//
//	POST /api/v1/dr/iac-snapshots                              (dr:write)    — ingest + version
//	GET  /api/v1/dr/iac-snapshots                              (dr:read)     — list
//	GET  /api/v1/dr/iac-snapshots/{id}                         (dr:read)     — one snapshot + resources
//	GET  /api/v1/dr/iac-snapshots/{id}/diff?against={otherID}  (dr:read)     — structured drift diff
//	GET  /api/v1/dr/iac-snapshots/{id}/reconstitution-plan     (dr:read)     — topological apply plan
type Router struct {
	svc    iacService
	logger zerolog.Logger
}

// NewRouter constructs the IaC-DR HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-iacdr").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc iacService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the IaC-DR endpoints, permission-gated to
// match the rest of the DR API: reads require dr:read; ingesting (capturing and
// versioning the estate's IaC) requires dr:write.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/iac-snapshots", h.listSnapshots)
		r.Get("/iac-snapshots/{id}", h.getSnapshot)
		r.Get("/iac-snapshots/{id}/diff", h.diff)
		r.Get("/iac-snapshots/{id}/reconstitution-plan", h.reconstitutionPlan)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/iac-snapshots", h.ingest)
	})

	return r
}

// ingestRequest is the POST /iac-snapshots body. The artifact may be supplied
// either as raw text (artifact) or base64 (artifact_base64) — the latter is
// required for binary Helm release payloads.
type ingestRequest struct {
	Name           string `json:"name"`
	SourceKind     string `json:"source_kind"`
	GroupID        string `json:"group_id,omitempty"`
	Artifact       string `json:"artifact,omitempty"`
	ArtifactBase64 string `json:"artifact_base64,omitempty"`
}

// ingest parses, versions and persists an IaC snapshot. 400 on a malformed
// request / unparseable artifact / unsupported kind.
func (h *Router) ingest(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	var req ingestRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	artifact, derr := decodeArtifact(req)
	if derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	snap, err := h.svc.Ingest(r.Context(), tenantID, IngestRequest{
		Name:       req.Name,
		SourceKind: req.SourceKind,
		Artifact:   artifact,
		GroupID:    req.GroupID,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, snap)
}

// decodeArtifact resolves the request artifact from either the raw or base64
// field.
func decodeArtifact(req ingestRequest) ([]byte, error) {
	if b64 := strings.TrimSpace(req.ArtifactBase64); b64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, errors.New("artifact_base64 is not valid base64")
		}
		return decoded, nil
	}
	if req.Artifact != "" {
		return []byte(req.Artifact), nil
	}
	return nil, errors.New("artifact or artifact_base64 is required")
}

// listSnapshots returns the tenant's snapshot headers.
func (h *Router) listSnapshots(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	snaps, err := h.svc.ListSnapshots(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if snaps == nil {
		snaps = []Snapshot{}
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"snapshots": snaps, "count": len(snaps)})
}

// getSnapshot returns one snapshot with its resources.
func (h *Router) getSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, id, ok := h.snapshotParams(w, r)
	if !ok {
		return
	}
	snap, err := h.svc.GetSnapshot(r.Context(), tenantID, id.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, snap)
}

// diff returns the structured drift diff of this snapshot against another
// (?against={otherID}).
func (h *Router) diff(w http.ResponseWriter, r *http.Request) {
	tenantID, id, ok := h.snapshotParams(w, r)
	if !ok {
		return
	}
	against := strings.TrimSpace(r.URL.Query().Get("against"))
	if against == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "against query parameter is required", nil)
		return
	}
	baseID, perr := uuid.Parse(against)
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "against must be a valid snapshot id", nil)
		return
	}
	result, err := h.svc.Diff(r.Context(), tenantID, id.String(), baseID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// reconstitutionPlan returns the topologically-ordered apply plan for a snapshot.
func (h *Router) reconstitutionPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, id, ok := h.snapshotParams(w, r)
	if !ok {
		return
	}
	plan, err := h.svc.ReconstitutionPlan(r.Context(), tenantID, id.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

// snapshotParams extracts the tenant from context and the snapshot ID from path.
func (h *Router) snapshotParams(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, id, true
}

// writeError maps iacdr sentinel errors to HTTP statuses. A cycle is the
// load-bearing one: it must be 409 Conflict so a client distinguishes "this
// dependency graph loops, no apply order exists" from a generic bad request.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCycle):
		suiteapi.WriteError(w, r, http.StatusConflict, "cycle", err.Error(), nil)
	case errors.Is(err, ErrSnapshotNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrUnsupportedKind), errors.Is(err, ErrEmptyArtifact),
		errors.Is(err, ErrParse), errors.Is(err, ErrInvalidRequest):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr iacdr request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ iacService = (*Service)(nil)
