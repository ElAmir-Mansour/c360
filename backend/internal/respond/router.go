package respond

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

type respondService interface {
	Product(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductResponse, error)
	ActorForIncident(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (Actor, error)
	DeclareIncident(ctx context.Context, tenantID uuid.UUID, in DeclareIncidentInput) (*Incident, error)
	GetIncident(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*Incident, error)
	ListIncidents(ctx context.Context, tenantID uuid.UUID, actor Actor, status *Status, severity *Severity, limit, offset int) ([]*Incident, int, error)
	UpdateIncident(ctx context.Context, tenantID uuid.UUID, in UpdateIncidentInput) (*Incident, error)
	ChangeSeverity(ctx context.Context, tenantID uuid.UUID, in ChangeSeverityInput) (*Incident, error)
	TransitionIncident(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentInput) (*Incident, error)
	TransitionIncidentWithClosureGate(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentInput) (*Incident, error)
	RecordTimelineEvent(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, eventType string, payload map[string]any) (*TimelineEvent, error)
	ListTimelineEvents(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, filter TimelineFilter) ([]TimelineEvent, error)
	Cockpit(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*CockpitResponse, error)
	CreateStakeholderToken(ctx context.Context, tenantID uuid.UUID, in CreateStakeholderTokenInput) (*StakeholderTokenResponse, error)
	StakeholderStatusByToken(ctx context.Context, token string) (*StakeholderStatus, error)
	TriageIncident(ctx context.Context, tenantID uuid.UUID, in TriageIncidentInput) (*TriageResult, error)
	ListTaskTemplates(ctx context.Context, tenantID uuid.UUID, actor Actor) ([]IncidentTaskTemplate, error)
	InstantiateTaskTemplate(ctx context.Context, tenantID uuid.UUID, in InstantiateTaskTemplateInput) (*IncidentTaskGraph, error)
	ListIncidentTasks(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*IncidentTaskGraph, error)
	AddIncidentTask(ctx context.Context, tenantID uuid.UUID, in AddIncidentTaskInput) (*IncidentTaskGraph, error)
	ReorderIncidentTask(ctx context.Context, tenantID uuid.UUID, in ReorderIncidentTaskInput) (*IncidentTaskGraph, error)
	AssignIncidentTask(ctx context.Context, tenantID uuid.UUID, in AssignIncidentTaskInput) (*IncidentTaskGraph, error)
	RescopeIncidentTask(ctx context.Context, tenantID uuid.UUID, in RescopeIncidentTaskInput) (*IncidentTaskGraph, error)
	TransitionIncidentTaskStatus(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentTaskStatusInput) (*IncidentTaskGraph, error)
	ConvertCommunicationToTask(ctx context.Context, tenantID uuid.UUID, in ConvertCommunicationToTaskInput) (*IncidentTaskGraph, error)
	ListIncidentRoles(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) ([]RoleAssignment, error)
	AssignRole(ctx context.Context, tenantID uuid.UUID, actor Actor, in AssignRoleInput) (*RoleAssignment, error)
	ReleaseRole(ctx context.Context, tenantID uuid.UUID, actor Actor, in ReleaseRoleInput) (*RoleAssignment, error)
	MobilizeRole(ctx context.Context, tenantID uuid.UUID, in MobilizeRoleInput) (*RoleMobilizationResult, error)
	AcknowledgeMobilization(ctx context.Context, tenantID uuid.UUID, in AcknowledgeMobilizationInput) (*NotificationDispatch, error)
	ProcessDueNotificationEscalations(ctx context.Context, tenantID uuid.UUID, actor Actor, limit int) ([]NotificationDispatch, error)
	ListIncidentNotificationDispatches(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]NotificationDispatch, error)
	GenerateStakeholderUpdate(ctx context.Context, tenantID uuid.UUID, in GenerateStakeholderUpdateInput) (*StakeholderUpdateContent, error)
	DispatchStakeholderUpdate(ctx context.Context, tenantID uuid.UUID, in DispatchStakeholderUpdateInput) (*StakeholderUpdateDispatch, error)
	ListStakeholderUpdates(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]StakeholderUpdateDispatch, error)
	RequestApproval(ctx context.Context, tenantID uuid.UUID, in RequestApprovalInput) (*IncidentApproval, error)
	DecideApproval(ctx context.Context, tenantID uuid.UUID, in DecideApprovalInput) (*IncidentApproval, error)
	ListApprovals(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) ([]IncidentApproval, error)
	GetPIR(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*IncidentPIR, error)
	GeneratePIR(ctx context.Context, tenantID uuid.UUID, in GeneratePIRInput) (*IncidentPIR, error)
	SignOffPIR(ctx context.Context, tenantID uuid.UUID, in SignOffPIRInput) (*IncidentPIR, error)
	UpdatePIRActionItemStatus(ctx context.Context, tenantID uuid.UUID, in UpdatePIRActionItemInput) (*PIRActionItem, error)
	ExportIncidentEvidence(ctx context.Context, tenantID uuid.UUID, in EvidenceExportInput) (*EvidenceExport, error)
	ListEvidenceExports(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]EvidenceExport, error)
}

type Router struct {
	svc    respondService
	feed   *TimelineFeed
	logger zerolog.Logger
}

func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, feed: svc.feed, logger: logger.With().Str("handler", "respond").Logger()}
}

func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/incidents/{incidentID}/notifications/{dispatchID}/ack", h.ackMobilization)
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondRead))
		r.Get("/product", h.product)
		r.Get("/incidents", h.listIncidents)
		r.Get("/incidents/{incidentID}", h.getIncident)
		r.Get("/incidents/{incidentID}/cockpit", h.cockpit)
		r.Get("/incidents/{incidentID}/timeline", h.listTimeline)
		r.Get("/incidents/{incidentID}/timeline/stream", h.streamTimeline)
		r.Get("/task-templates", h.listTaskTemplates)
		r.Get("/incidents/{incidentID}/tasks", h.listTasks)
		r.Get("/incidents/{incidentID}/roles", h.listRoles)
		r.Get("/incidents/{incidentID}/notifications", h.listNotificationDispatches)
		r.Get("/incidents/{incidentID}/stakeholder-updates", h.listStakeholderUpdates)
		r.Get("/incidents/{incidentID}/approvals", h.listApprovals)
		r.Get("/incidents/{incidentID}/pir", h.getPIR)
		r.Get("/incidents/{incidentID}/evidence-exports", h.listEvidenceExports)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondDeclare))
		r.Post("/incidents", h.declareIncident)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondUpdate))
		r.Patch("/incidents/{incidentID}", h.updateIncident)
		r.Post("/incidents/{incidentID}/roles", h.assignRole)
		r.Post("/incidents/{incidentID}/roles/{assignmentID}/mobilize", h.mobilizeRole)
		r.Delete("/incidents/{incidentID}/roles/{assignmentID}", h.releaseRole)
		r.Post("/notifications/escalations/process", h.processNotificationEscalations)
		r.Post("/incidents/{incidentID}/tasks", h.createTask)
		r.Post("/incidents/{incidentID}/tasks/from-communication", h.convertCommunicationToTask)
		r.Post("/incidents/{incidentID}/task-templates", h.instantiateTaskTemplate)
		r.Put("/incidents/{incidentID}/tasks/order", h.reorderTasks)
		r.Patch("/incidents/{incidentID}/tasks/{taskID}", h.rescopeTask)
		r.Patch("/incidents/{incidentID}/tasks/{taskID}/status", h.transitionTaskStatus)
		r.Post("/incidents/{incidentID}/stakeholder-updates", h.dispatchStakeholderUpdate)
		r.Post("/incidents/{incidentID}/approvals", h.requestApproval)
		r.Post("/incidents/{incidentID}/approvals/{approvalID}/decision", h.decideApproval)
		r.Patch("/incidents/{incidentID}/pir", h.generatePIR)
		r.Post("/incidents/{incidentID}/pir", h.generatePIR)
		r.Post("/incidents/{incidentID}/pir/sign-off", h.signOffPIR)
		r.Patch("/incidents/{incidentID}/pir/action-items/{actionItemID}", h.updatePIRActionItem)
		r.Post("/incidents/{incidentID}/evidence-exports", h.exportEvidence)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondTransition))
		r.Post("/incidents/{incidentID}/transitions", h.transitionIncident)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondSeverity))
		r.Post("/incidents/{incidentID}/severity", h.changeSeverity)
		r.Post("/incidents/{incidentID}/triage/recommendation", h.recommendSeverity)
		r.Post("/incidents/{incidentID}/triage", h.triageIncident)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondTimeline))
		r.Post("/incidents/{incidentID}/timeline", h.recordTimeline)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondUpdate))
		r.Post("/incidents/{incidentID}/stakeholder-tokens", h.createStakeholderToken)
	})
	return r
}

func (h *Router) PublicRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/stakeholder/{token}", h.getStakeholderStatus)
	return r
}

type declareIncidentRequest struct {
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Severity         Severity   `json:"severity"`
	DetectedAt       *time.Time `json:"detected_at,omitempty"`
	ImpactedServices []string   `json:"impacted_services"`
}

type updateIncidentRequest struct {
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	ImpactedServices []string `json:"impacted_services"`
	ExpectedVersion  int      `json:"expected_version"`
}

type transitionIncidentRequest struct {
	To              Status `json:"to"`
	ExpectedVersion int    `json:"expected_version"`
}

type changeSeverityRequest struct {
	Severity        Severity `json:"severity"`
	ExpectedVersion int      `json:"expected_version"`
}

type recordTimelineRequest struct {
	EventType string         `json:"event_type"`
	Payload   map[string]any `json:"payload"`
}

type createStakeholderTokenRequest struct {
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	NextUpdateAt *time.Time `json:"next_update_at,omitempty"`
}

type incidentListResponse struct {
	Incidents []*Incident `json:"incidents"`
	Total     int         `json:"total"`
	Page      int         `json:"page"`
	PerPage   int         `json:"per_page"`
}

func (h *Router) product(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	product, err := h.svc.Product(r.Context(), tenantID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, product)
}

func (h *Router) declareIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req declareIncidentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	inc, err := h.svc.DeclareIncident(r.Context(), tenantID, DeclareIncidentInput{
		Title:            req.Title,
		Description:      req.Description,
		Severity:         req.Severity,
		DetectedAt:       req.DetectedAt,
		ImpactedServices: req.ImpactedServices,
		Actor:            h.actor(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, inc)
}

func (h *Router) listIncidents(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	offset := (page - 1) * perPage
	var status *Status
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		s := Status(raw)
		status = &s
	}
	var severity *Severity
	if raw := strings.TrimSpace(r.URL.Query().Get("severity")); raw != "" {
		s := Severity(raw)
		severity = &s
	}
	incidents, total, err := h.svc.ListIncidents(r.Context(), tenantID, h.actor(r), status, severity, perPage, offset)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if incidents == nil {
		incidents = []*Incident{}
	}
	suiteapi.WriteData(w, http.StatusOK, incidentListResponse{
		Incidents: incidents,
		Total:     total,
		Page:      page,
		PerPage:   perPage,
	})
}

func (h *Router) getIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	inc, err := h.svc.GetIncident(r.Context(), tenantID, incidentID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inc)
}

func (h *Router) cockpit(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	cockpit, err := h.svc.Cockpit(r.Context(), tenantID, incidentID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpit)
}

func (h *Router) updateIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	var req updateIncidentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	inc, err := h.svc.UpdateIncident(r.Context(), tenantID, UpdateIncidentInput{
		IncidentID:       incidentID,
		Title:            req.Title,
		Description:      req.Description,
		ImpactedServices: req.ImpactedServices,
		ExpectedVersion:  req.ExpectedVersion,
		Actor:            h.actor(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inc)
}

func (h *Router) transitionIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	var req transitionIncidentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	inc, err := h.svc.TransitionIncidentWithClosureGate(r.Context(), tenantID, TransitionIncidentInput{
		IncidentID:      incidentID,
		To:              req.To,
		ExpectedVersion: req.ExpectedVersion,
		Actor:           h.actor(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inc)
}

func (h *Router) changeSeverity(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	var req changeSeverityRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	inc, err := h.svc.ChangeSeverity(r.Context(), tenantID, ChangeSeverityInput{
		IncidentID:      incidentID,
		Severity:        req.Severity,
		ExpectedVersion: req.ExpectedVersion,
		Actor:           h.actor(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inc)
}

func (h *Router) recordTimeline(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	var req recordTimelineRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ev, err := h.svc.RecordTimelineEvent(r.Context(), tenantID, incidentID, h.actor(r), req.EventType, req.Payload)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, ev)
}

func (h *Router) createStakeholderToken(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	var req createStakeholderTokenRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	token, err := h.svc.CreateStakeholderToken(r.Context(), tenantID, CreateStakeholderTokenInput{
		IncidentID:   incidentID,
		ExpiresAt:    req.ExpiresAt,
		NextUpdateAt: req.NextUpdateAt,
		Actor:        h.actor(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, token)
}

func (h *Router) getStakeholderStatus(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	status, err := h.svc.StakeholderStatusByToken(r.Context(), token)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, status)
}

func (h *Router) listTimeline(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	filter, ok := h.timelineFilter(w, r)
	if !ok {
		return
	}
	events, err := h.svc.ListTimelineEvents(r.Context(), tenantID, incidentID, h.actor(r), filter)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if events == nil {
		events = []TimelineEvent{}
	}
	suiteapi.WriteData(w, http.StatusOK, events)
}

func (h *Router) streamTimeline(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "stream_unavailable", "response streaming is unavailable", nil)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	filter, ok := h.timelineFilter(w, r)
	if !ok {
		return
	}
	backfill, err := h.svc.ListTimelineEvents(r.Context(), tenantID, incidentID, h.actor(r), filter)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	for _, ev := range backfill {
		if err := writeSSE(w, ev); err != nil {
			return
		}
	}
	flusher.Flush()

	ch := h.feed.Subscribe(r.Context(), incidentID)
	for ev := range ch {
		if err := writeSSE(w, ev); err != nil {
			return
		}
		flusher.Flush()
	}
}

func writeSSE(w http.ResponseWriter, ev TimelineEvent) error {
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = w.Write([]byte("id: " + ev.ID.String() + "\n" + "data: " + string(b) + "\n\n"))
	return err
}

func (h *Router) timelineFilter(w http.ResponseWriter, r *http.Request) (TimelineFilter, bool) {
	filter := TimelineFilter{
		EventTypes: suiteapi.ParseCSVParam(r, "type"),
		Limit:      parseLimit(r),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("actor_id")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "actor_id must be a UUID", nil)
			return TimelineFilter{}, false
		}
		filter.ActorID = &id
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("from")); raw != "" {
		at, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "from must be an RFC3339 timestamp", nil)
			return TimelineFilter{}, false
		}
		filter.From = &at
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("to")); raw != "" {
		at, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "to must be an RFC3339 timestamp", nil)
			return TimelineFilter{}, false
		}
		filter.To = &at
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("after_id")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "after_id must be a UUID", nil)
			return TimelineFilter{}, false
		}
		filter.AfterID = &id
	}
	return filter, true
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) tenantAndIncident(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	incidentID, err := suiteapi.UUIDParam(r, "incidentID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, incidentID, true
}

func (h *Router) actor(r *http.Request) Actor {
	userID, _ := suiteapi.UserID(r)
	if userID == nil {
		return Actor{}
	}
	user := auth.UserFromContext(r.Context())
	permissions := make([]string, 0, 7)
	for _, permission := range []string{
		PermRespondRead, PermRespondDeclare, PermRespondUpdate,
		PermRespondTransition, PermRespondSeverity, PermRespondTimeline, PermRespondAdmin,
	} {
		if user != nil && auth.HasPermission(user.Roles, permission) {
			permissions = append(permissions, permission)
		}
	}
	return Actor{UserID: *userID, GlobalPermissions: permissions}
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		suiteapi.WriteError(w, r, http.StatusForbidden, "forbidden", err.Error(), nil)
	case errors.Is(err, ErrIncidentNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrStakeholderNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrTaskNotFound), errors.Is(err, ErrTaskTemplateNotFound), errors.Is(err, ErrRoleAssignmentNotFound), errors.Is(err, ErrNotificationDispatchNotFound), errors.Is(err, ErrApprovalNotFound), errors.Is(err, ErrPIRNotFound), errors.Is(err, ErrPIRActionItemNotFound), errors.Is(err, ErrIntegrationConnectorNotFound), errors.Is(err, ErrIntegrationLinkNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable", "unable to verify license entitlement", nil)
	case errors.Is(err, ErrVersionConflict), errors.Is(err, ErrRoleAssignmentConflict), errors.Is(err, ErrCommanderAlreadyAssigned), errors.Is(err, ErrTaskDependencyBlocked), errors.Is(err, ErrTaskInvalidTransition), errors.Is(err, ErrApprovalAlreadyPending), errors.Is(err, ErrApprovalAlreadyDecided), errors.Is(err, ErrApprovalRequired), errors.Is(err, ErrApprovalSelfDecision), errors.Is(err, ErrPIRSignedOff), errors.Is(err, ErrPIRNotComplete), errors.Is(err, ErrPIRIncidentNotResolved), errors.Is(err, ErrIntegrationDuplicateWebhook):
		suiteapi.WriteError(w, r, http.StatusConflict, "version_conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalidTransition):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_transition", err.Error(), nil)
	case errors.Is(err, ErrInvalidSeverity), errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrValidation), errors.Is(err, ErrTimelineEventEmpty), errors.Is(err, ErrInvalidIncidentRole), errors.Is(err, ErrRoleAssignmentInactive), errors.Is(err, ErrRoleAssignmentActorMissing), errors.Is(err, ErrTaskAlreadyExists), errors.Is(err, ErrTaskDependencyCycle), errors.Is(err, ErrTaskDependencyUnknown), errors.Is(err, ErrTaskInvalidType), errors.Is(err, ErrTaskInvalidStatus), errors.Is(err, ErrNotificationDispatchInvalid), errors.Is(err, ErrNotificationChannelUnsupported), errors.Is(err, ErrResponderDirectoryInvalid), errors.Is(err, ErrMobilizationNoChannels), errors.Is(err, ErrInvalidApproval), errors.Is(err, ErrIntegrationConfig), errors.Is(err, ErrIntegrationUnsupported), errors.Is(err, ErrIntegrationWebhookAuth):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrMobilizationNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "mobilization_not_configured", err.Error(), nil)
	case errors.Is(err, ErrNotificationHTTPDelivery):
		suiteapi.WriteError(w, r, http.StatusBadGateway, "notification_delivery_failed", err.Error(), nil)
	case errors.Is(err, ErrIntegrationSecretUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "integration_secret_unavailable", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("respond request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func parseLimit(r *http.Request) int {
	_, perPage := suiteapi.ParsePagination(r)
	return perPage
}

var _ respondService = (*Service)(nil)
