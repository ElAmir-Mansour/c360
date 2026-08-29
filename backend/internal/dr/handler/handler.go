// Package handler exposes the ClarioDR tenant API.
package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/journal"
	"github.com/clario360/platform/internal/dr/model"
	drservice "github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// Service is the DR service contract used by the HTTP adapter.
type Service interface {
	CreateSite(ctx context.Context, tenantID uuid.UUID, in drservice.CreateSiteInput) (*model.ProtectedSite, error)
	GetSite(ctx context.Context, tenantID, siteID uuid.UUID) (*model.ProtectedSite, error)
	ListSites(ctx context.Context, tenantID uuid.UUID) ([]*model.ProtectedSite, error)

	CreateGroup(ctx context.Context, tenantID uuid.UUID, in drservice.CreateGroupInput) (*model.ConsistencyGroup, error)
	GetGroup(ctx context.Context, tenantID, groupID uuid.UUID) (*model.ConsistencyGroup, error)
	ListGroups(ctx context.Context, tenantID uuid.UUID) ([]*model.ConsistencyGroup, error)
	AddGroupMember(ctx context.Context, tenantID, groupID uuid.UUID, in drservice.AddGroupMemberInput) (*model.ConsistencyGroupMember, error)
	ListGroupMembers(ctx context.Context, tenantID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error)

	CreateStream(ctx context.Context, tenantID uuid.UUID, in drservice.CreateStreamInput) (*model.ReplicationStream, error)
	GetStream(ctx context.Context, tenantID, streamID uuid.UUID) (*model.ReplicationStream, error)
	ListStreams(ctx context.Context, tenantID uuid.UUID) ([]*model.ReplicationStream, error)
	PauseStream(ctx context.Context, tenantID, streamID uuid.UUID) error
	ResumeStream(ctx context.Context, tenantID, streamID uuid.UUID) error
	GetStreamRPO(ctx context.Context, tenantID, streamID uuid.UUID) (*model.StreamRPO, error)

	GetRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error)
	ListRecoveryPoints(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.RecoveryPoint, error)
	SealRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in drservice.SealRecoveryPointInput) (*model.RecoveryPoint, error)
	MaterializeJournalRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in drservice.MaterializeJournalRecoveryPointInput) (*model.RecoveryPoint, error)
	ValidateRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error)

	CreateNetworkMapping(ctx context.Context, tenantID, groupID uuid.UUID, in drservice.CreateNetworkMappingInput) (*model.NetworkMapping, error)
	ListNetworkMappings(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.NetworkMapping, error)

	CreateAgent(ctx context.Context, tenantID uuid.UUID, in drservice.CreateAgentInput) (*model.DRAgent, error)
	GetAgent(ctx context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error)
	ListAgents(ctx context.Context, tenantID uuid.UUID) ([]*model.DRAgent, error)

	CreateFailoverRun(ctx context.Context, tenantID uuid.UUID, in drservice.CreateFailoverRunInput) (*model.FailoverRun, error)
	GetFailoverRun(ctx context.Context, tenantID, runID uuid.UUID) (*model.FailoverRun, error)
	ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]*model.FailoverRun, error)
	ApproveFailoverRun(ctx context.Context, tenantID, runID, approvedBy uuid.UUID, in ...drservice.ApproveFailoverRunInput) (*model.FailoverRun, error)
	CancelFailoverRun(ctx context.Context, tenantID, runID, cancelledBy uuid.UUID) (*model.FailoverRun, error)
	ListFailoverSteps(ctx context.Context, tenantID, runID uuid.UUID) ([]*model.FailoverStep, error)
	GetAttestationByRun(ctx context.Context, tenantID, runID uuid.UUID) (*model.Attestation, error)
}

// Handler maps HTTP to the DR service.
type Handler struct {
	svc    Service
	logger zerolog.Logger
}

// New constructs a DR HTTP handler.
func New(svc Service, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr").Logger()}
}

// Routes returns a router mounted by cmd/clario-dr-service under /api/v1/dr.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))

		r.Get("/sites", h.listSites)
		r.Get("/sites/{siteID}", h.getSite)

		r.Get("/groups", h.listGroups)
		r.Get("/groups/{groupID}", h.getGroup)
		r.Get("/groups/{groupID}/members", h.listGroupMembers)
		r.Get("/groups/{groupID}/recovery-points", h.listRecoveryPoints)
		r.Get("/groups/{groupID}/network-mappings", h.listNetworkMappings)

		r.Get("/streams", h.listStreams)
		r.Get("/streams/{streamID}", h.getStream)
		r.Get("/streams/{streamID}/rpo", h.getStreamRPO)

		r.Get("/recovery-points/{recoveryPointID}", h.getRecoveryPoint)

		r.Get("/agents", h.listAgents)
		r.Get("/agents/{agentID}", h.getAgent)

		r.Get("/failover-runs", h.listFailoverRuns)
		r.Get("/failover-runs/{runID}", h.getFailoverRun)
		r.Get("/failover-runs/{runID}/steps", h.listFailoverSteps)
		r.Get("/failover-runs/{runID}/attestation", h.getAttestation)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))

		r.Post("/sites", h.createSite)
		r.Post("/groups", h.createGroup)
		r.Post("/groups/{groupID}/members", h.addGroupMember)
		r.Post("/groups/{groupID}/network-mappings", h.createNetworkMapping)
		r.Post("/groups/{groupID}/recovery-points", h.sealRecoveryPoint)
		r.Post("/streams", h.createStream)
		r.Post("/streams/{streamID}/pause", h.pauseStream)
		r.Post("/streams/{streamID}/resume", h.resumeStream)
		r.Post("/recovery-points/{recoveryPointID}/validate", h.validateRecoveryPoint)
		r.Post("/agents", h.createAgent)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))

		r.Post("/failover-runs", h.createFailoverRun)
		r.Post("/failover-runs/{runID}/approve", h.approveFailoverRun)
		r.Post("/failover-runs/{runID}/cancel", h.cancelFailoverRun)
		r.Post("/failover/{id}/cancel", h.cancelFailoverRun)
		r.Post("/groups/{groupID}/journal/materialize", h.materializeJournalRecoveryPoint)
	})

	return r
}

func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var validation *drservice.ValidationError
	switch {
	case errors.As(err, &validation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", validation.Error(), validation)
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, model.ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	case errors.Is(err, model.ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, drservice.ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "dependency_not_configured", err.Error(), nil)
	case errors.Is(err, journal.ErrPruned):
		suiteapi.WriteError(w, r, http.StatusGone, "beyond_retention", err.Error(), nil)
	case errors.Is(err, journal.ErrNoCoverage):
		suiteapi.WriteError(w, r, http.StatusNotFound, "no_coverage", err.Error(), nil)
	case errors.Is(err, journal.ErrInvalid):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func tenantID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func uuidParam(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, name)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, false
	}
	return id, true
}

func uuidParamAny(w http.ResponseWriter, r *http.Request, names ...string) (uuid.UUID, bool) {
	for _, name := range names {
		raw := chi.URLParam(r, name)
		if raw == "" {
			continue
		}
		id, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid "+name, nil)
			return uuid.Nil, false
		}
		return id, true
	}

	message := "missing parameter"
	if len(names) == 1 {
		message = "missing " + names[0] + " parameter"
	} else if len(names) > 1 {
		message = "missing " + names[0] + " or " + names[1] + " parameter"
	}
	suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", message, nil)
	return uuid.Nil, false
}

func currentUserID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, err := suiteapi.UserID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "bad_user", err.Error(), nil)
		return uuid.Nil, false
	}
	if userID == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_user", "authenticated user context required", nil)
		return uuid.Nil, false
	}
	return *userID, true
}

func parseOptionalUUID(raw *string, field string) (*uuid.UUID, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return nil, &drservice.ValidationError{Field: field, Message: "must be a UUID"}
	}
	return &id, nil
}

type createSiteRequest struct {
	Name                string `json:"name"`
	Kind                string `json:"kind"`
	PrimaryEndpoint     string `json:"primary_endpoint"`
	RTOObjectiveSeconds int    `json:"rto_objective_seconds"`
	RPOObjectiveSeconds int    `json:"rpo_objective_seconds"`
}

func (h *Handler) createSite(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	var req createSiteRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	site, err := h.svc.CreateSite(r.Context(), tenantID, drservice.CreateSiteInput(req))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, site)
}

func (h *Handler) getSite(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	siteID, ok := uuidParam(w, r, "siteID")
	if !ok {
		return
	}
	site, err := h.svc.GetSite(r.Context(), tenantID, siteID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, site)
}

func (h *Handler) listSites(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	sites, err := h.svc.ListSites(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, sites)
}

type createGroupRequest struct {
	Name string `json:"name"`
}

func (h *Handler) createGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	var req createGroupRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	group, err := h.svc.CreateGroup(r.Context(), tenantID, drservice.CreateGroupInput(req))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, group)
}

func (h *Handler) getGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	group, err := h.svc.GetGroup(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, group)
}

func (h *Handler) listGroups(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groups, err := h.svc.ListGroups(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, groups)
}

type addGroupMemberRequest struct {
	SiteID    string `json:"site_id"`
	BootOrder int    `json:"boot_order"`
}

func (h *Handler) addGroupMember(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	var req addGroupMemberRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	siteID, err := uuid.Parse(req.SiteID)
	if err != nil {
		h.writeServiceError(w, r, &drservice.ValidationError{Field: "site_id", Message: "must be a UUID"})
		return
	}
	member, err := h.svc.AddGroupMember(r.Context(), tenantID, groupID, drservice.AddGroupMemberInput{
		SiteID:    siteID,
		BootOrder: req.BootOrder,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, member)
}

func (h *Handler) listGroupMembers(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	members, err := h.svc.ListGroupMembers(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, members)
}

type createStreamRequest struct {
	SiteID string `json:"site_id"`
	Status string `json:"status"`
}

func (h *Handler) createStream(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	var req createStreamRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	siteID, err := uuid.Parse(req.SiteID)
	if err != nil {
		h.writeServiceError(w, r, &drservice.ValidationError{Field: "site_id", Message: "must be a UUID"})
		return
	}
	stream, err := h.svc.CreateStream(r.Context(), tenantID, drservice.CreateStreamInput{SiteID: siteID, Status: req.Status})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, stream)
}

func (h *Handler) getStream(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	streamID, ok := uuidParam(w, r, "streamID")
	if !ok {
		return
	}
	stream, err := h.svc.GetStream(r.Context(), tenantID, streamID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, stream)
}

func (h *Handler) listStreams(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	streams, err := h.svc.ListStreams(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, streams)
}

func (h *Handler) pauseStream(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	streamID, ok := uuidParam(w, r, "streamID")
	if !ok {
		return
	}
	if err := h.svc.PauseStream(r.Context(), tenantID, streamID); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) resumeStream(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	streamID, ok := uuidParam(w, r, "streamID")
	if !ok {
		return
	}
	if err := h.svc.ResumeStream(r.Context(), tenantID, streamID); err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) getStreamRPO(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	streamID, ok := uuidParam(w, r, "streamID")
	if !ok {
		return
	}
	rpo, err := h.svc.GetStreamRPO(r.Context(), tenantID, streamID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rpo)
}

func (h *Handler) getRecoveryPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	pointID, ok := uuidParam(w, r, "recoveryPointID")
	if !ok {
		return
	}
	point, err := h.svc.GetRecoveryPoint(r.Context(), tenantID, pointID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, point)
}

func (h *Handler) listRecoveryPoints(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	points, err := h.svc.ListRecoveryPoints(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, points)
}

type sealRecoveryPointRequest struct {
	RetentionUntil time.Time `json:"retention_until"`
}

type journalTargetRequest struct {
	At  *time.Time `json:"at,omitempty"`
	LSN string     `json:"lsn,omitempty"`
	Seq *int64     `json:"seq,omitempty"`
}

type materializeJournalRecoveryPointRequest struct {
	journalTargetRequest
	RetentionUntil time.Time `json:"retention_until"`
}

// sealRecoveryPoint drives the real WP-4 path: seal a consistency-wide recovery
// point to the WORM bucket (object-lock GOVERNANCE + per-tenant DEK) for the
// group's member streams.
func (h *Handler) sealRecoveryPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	var req sealRecoveryPointRequest
	// Body is optional: an empty body uses the WORM default retain-until.
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	point, err := h.svc.SealRecoveryPoint(r.Context(), tenantID, groupID, drservice.SealRecoveryPointInput{
		RetentionUntil: req.RetentionUntil,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, point)
}

// materializeJournalRecoveryPoint seals a synthetic recovery point by replaying
// the CDP journal to a requested point in time/LSN/Seq.
func (h *Handler) materializeJournalRecoveryPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	var req materializeJournalRecoveryPointRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	point, err := h.svc.MaterializeJournalRecoveryPoint(r.Context(), tenantID, groupID, drservice.MaterializeJournalRecoveryPointInput{
		Target:         drservice.JournalTargetInput{At: req.At, LSN: req.LSN, Seq: req.Seq},
		RetentionUntil: req.RetentionUntil,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, point)
}

// validateRecoveryPoint re-runs the data-fidelity validator against a sealed
// recovery point and records the match ratio + legal-hold floor.
func (h *Handler) validateRecoveryPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	pointID, ok := uuidParam(w, r, "recoveryPointID")
	if !ok {
		return
	}
	point, err := h.svc.ValidateRecoveryPoint(r.Context(), tenantID, pointID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, point)
}

type createNetworkMappingRequest struct {
	Profile      string `json:"profile"`
	PrimaryCIDR  string `json:"primary_cidr"`
	RecoveryCIDR string `json:"recovery_cidr"`
}

func (h *Handler) createNetworkMapping(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	var req createNetworkMappingRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	mapping, err := h.svc.CreateNetworkMapping(r.Context(), tenantID, groupID, drservice.CreateNetworkMappingInput(req))
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, mapping)
}

func (h *Handler) listNetworkMappings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	groupID, ok := uuidParam(w, r, "groupID")
	if !ok {
		return
	}
	mappings, err := h.svc.ListNetworkMappings(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, mappings)
}

type createAgentRequest struct {
	SiteID *string `json:"site_id"`
}

func (h *Handler) createAgent(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	var req createAgentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	siteID, err := parseOptionalUUID(req.SiteID, "site_id")
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	agent, err := h.svc.CreateAgent(r.Context(), tenantID, drservice.CreateAgentInput{SiteID: siteID})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, agent)
}

func (h *Handler) getAgent(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	agentID, ok := uuidParam(w, r, "agentID")
	if !ok {
		return
	}
	agent, err := h.svc.GetAgent(r.Context(), tenantID, agentID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, agent)
}

func (h *Handler) listAgents(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	agents, err := h.svc.ListAgents(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, agents)
}

type createFailoverRunRequest struct {
	GroupID             string                `json:"group_id"`
	Mode                string                `json:"mode"`
	RecoveryPointID     *string               `json:"recovery_point_id"`
	JournalTarget       *journalTargetRequest `json:"journal_target,omitempty"`
	RTOObjectiveSeconds int                   `json:"rto_objective_seconds"`
}

type approveFailoverRunRequest struct {
	Decision         string     `json:"decision"`
	Reason           string     `json:"reason"`
	BreakGlass       bool       `json:"break_glass"`
	StepUpVerifiedAt *time.Time `json:"step_up_verified_at"`
}

func (h *Handler) createFailoverRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	userID, ok := currentUserID(w, r)
	if !ok {
		return
	}
	var req createFailoverRunRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	groupID, err := uuid.Parse(req.GroupID)
	if err != nil {
		h.writeServiceError(w, r, &drservice.ValidationError{Field: "group_id", Message: "must be a UUID"})
		return
	}
	recoveryPointID, err := parseOptionalUUID(req.RecoveryPointID, "recovery_point_id")
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	run, err := h.svc.CreateFailoverRun(r.Context(), tenantID, drservice.CreateFailoverRunInput{
		GroupID:             groupID,
		Mode:                req.Mode,
		RecoveryPointID:     recoveryPointID,
		JournalTarget:       journalTargetInput(req.JournalTarget),
		RTOObjectiveSeconds: req.RTOObjectiveSeconds,
		InitiatedBy:         userID,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, run)
}

func journalTargetInput(req *journalTargetRequest) *drservice.JournalTargetInput {
	if req == nil {
		return nil
	}
	return &drservice.JournalTargetInput{At: req.At, LSN: req.LSN, Seq: req.Seq}
}

func (h *Handler) getFailoverRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	runID, ok := uuidParamAny(w, r, "runID", "id")
	if !ok {
		return
	}
	run, err := h.svc.GetFailoverRun(r.Context(), tenantID, runID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}

func (h *Handler) listFailoverRuns(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	runs, err := h.svc.ListFailoverRuns(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, runs)
}

func (h *Handler) approveFailoverRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	userID, ok := currentUserID(w, r)
	if !ok {
		return
	}
	runID, ok := uuidParam(w, r, "runID")
	if !ok {
		return
	}
	var req approveFailoverRunRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	run, err := h.svc.ApproveFailoverRun(r.Context(), tenantID, runID, userID, drservice.ApproveFailoverRunInput{
		Decision:         req.Decision,
		Reason:           req.Reason,
		BreakGlass:       req.BreakGlass,
		StepUpVerifiedAt: req.StepUpVerifiedAt,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}

func (h *Handler) cancelFailoverRun(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	userID, ok := currentUserID(w, r)
	if !ok {
		return
	}
	runID, ok := uuidParamAny(w, r, "runID", "id")
	if !ok {
		return
	}
	run, err := h.svc.CancelFailoverRun(r.Context(), tenantID, runID, userID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}

func (h *Handler) listFailoverSteps(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	runID, ok := uuidParam(w, r, "runID")
	if !ok {
		return
	}
	steps, err := h.svc.ListFailoverSteps(r.Context(), tenantID, runID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, steps)
}

func (h *Handler) getAttestation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantID(w, r)
	if !ok {
		return
	}
	runID, ok := uuidParam(w, r, "runID")
	if !ok {
		return
	}
	attestation, err := h.svc.GetAttestationByRun(r.Context(), tenantID, runID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, attestation)
}
