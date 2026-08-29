package respond

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/suiteapi"
)

type impactAssessmentRequest struct {
	UserScope                  string   `json:"user_scope"`
	UserBaseScope              string   `json:"user_base_scope"`
	BusinessCriticality        string   `json:"business_criticality"`
	BusinessProcessCriticality string   `json:"business_process_criticality"`
	RevenueImpact              string   `json:"revenue_impact"`
	RegulatoryExposure         string   `json:"regulatory_exposure"`
	AffectedServiceKeys        []string `json:"affected_service_keys"`
	Notes                      string   `json:"notes"`
}

type triageRequest struct {
	Severity         Severity                `json:"severity"`
	ChosenSeverity   Severity                `json:"chosen_severity"`
	ImpactAssessment impactAssessmentRequest `json:"impact_assessment"`
	ExpectedVersion  int                     `json:"expected_version"`
	OverrideReason   string                  `json:"override_reason"`
}

type severityRecommendationResponse struct {
	RecommendedSeverity Severity                `json:"recommended_severity"`
	Rationale           []string                `json:"rationale"`
	Inputs              impactAssessmentRequest `json:"inputs"`
	ComputedAt          time.Time               `json:"computed_at"`
	Severity            Severity                `json:"severity"`
	RuleVersion         string                  `json:"rule_version"`
}

type roleRequest struct {
	Role            IncidentRole   `json:"role"`
	UserID          string         `json:"user_id"`
	ResponderID     string         `json:"responder_id"`
	ResponderSource string         `json:"responder_source"`
	Source          string         `json:"source"`
	Metadata        map[string]any `json:"metadata"`
}

type releaseRoleRequest struct {
	Reason   string         `json:"reason"`
	Metadata map[string]any `json:"metadata"`
}

type mobilizeRoleRequest struct {
	Channel           NotificationChannel   `json:"channel"`
	Channels          []NotificationChannel `json:"channels"`
	RequiresAck       *bool                 `json:"requires_ack"`
	AckTimeoutSeconds int                   `json:"ack_timeout_seconds"`
	ActionURL         string                `json:"action_url"`
}

type processEscalationsRequest struct {
	Limit int `json:"limit"`
}

type instantiateTaskTemplateRequest struct {
	TemplateKey string `json:"template_key"`
}

type createTaskRequest struct {
	TaskKey                string           `json:"task_key"`
	Title                  string           `json:"title"`
	Description            string           `json:"description"`
	TaskType               IncidentTaskType `json:"task_type"`
	Required               *bool            `json:"required"`
	Position               *int             `json:"position"`
	OwnerID                string           `json:"owner_id"`
	OwnerRole              IncidentRole     `json:"owner_role"`
	Team                   string           `json:"team"`
	DueAt                  *time.Time       `json:"due_at"`
	PlannedDurationSeconds int              `json:"planned_duration_seconds"`
	AutomationAction       string           `json:"automation_action"`
	DependsOn              []string         `json:"depends_on"`
	Dependencies           []string         `json:"dependencies"`
	Params                 map[string]any   `json:"params"`
	Scope                  map[string]any   `json:"scope"`
}

type reorderTasksRequest struct {
	TaskIDs []string `json:"task_ids"`
}

type rescopeTaskRequest struct {
	Title                  string         `json:"title"`
	Description            string         `json:"description"`
	Required               *bool          `json:"required"`
	DueAt                  *time.Time     `json:"due_at"`
	ClearDueAt             bool           `json:"clear_due_at"`
	PlannedDurationSeconds *int           `json:"planned_duration_seconds"`
	AutomationAction       *string        `json:"automation_action"`
	Params                 map[string]any `json:"params"`
	Scope                  map[string]any `json:"scope"`
	Dependencies           *[]string      `json:"dependencies"`
}

type taskStatusRequest struct {
	Status IncidentTaskStatus `json:"status"`
	To     IncidentTaskStatus `json:"to"`
	Note   string             `json:"note"`
}

type communicationTaskRequest struct {
	SourceEventID *uuid.UUID   `json:"source_event_id"`
	SourceType    string       `json:"source_type"`
	Summary       string       `json:"summary"`
	Body          string       `json:"body"`
	OwnerID       string       `json:"owner_id"`
	OwnerRole     IncidentRole `json:"owner_role"`
	Team          string       `json:"team"`
	DueAt         *time.Time   `json:"due_at"`
}

type stakeholderUpdateRequest struct {
	Reason       StakeholderUpdateReason `json:"reason"`
	Channel      string                  `json:"channel"`
	Channels     []string                `json:"channels"`
	RecipientRef string                  `json:"recipient_ref"`
	NextUpdateAt *time.Time              `json:"next_update_at"`
	ReceiptRef   string                  `json:"receipt_ref"`
}

type approvalRequest struct {
	Action       ApprovalAction      `json:"action"`
	ActionKey    string              `json:"action_key"`
	Title        string              `json:"title"`
	Reason       string              `json:"reason"`
	ApproverRole string              `json:"approver_role"`
	RequiredRole string              `json:"required_role"`
	WorkflowRef  WorkflowApprovalRef `json:"workflow_ref"`
	Metadata     map[string]any      `json:"metadata"`
}

type approvalDecisionRequest struct {
	Decision ApprovalDecision `json:"decision"`
	Reason   string           `json:"reason"`
}

type pirRequest struct {
	ContributingFactors any                    `json:"contributing_factors"`
	LessonsLearned      any                    `json:"lessons_learned"`
	ActionItems         []pirActionItemRequest `json:"action_items"`
}

type pirActionItemRequest struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	OwnerID     string     `json:"owner_id"`
	DueAt       *time.Time `json:"due_at"`
}

type pirActionItemStatusRequest struct {
	Status PIRActionItemStatus `json:"status"`
}

type evidenceExportRequest struct {
	Format EvidenceFormat `json:"format"`
}

func (h *Router) recommendSeverity(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.tenantAndIncident(w, r); !ok {
		return
	}
	var req impactAssessmentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	assessment := impactAssessmentFromRequest(req)
	recommendation, err := RecommendSeverity(assessment)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, severityRecommendationResponse{
		RecommendedSeverity: recommendation.Severity,
		Rationale:           recommendation.Reasons,
		Inputs:              req,
		ComputedAt:          time.Now().UTC(),
		Severity:            recommendation.Severity,
		RuleVersion:         recommendation.RuleVersion,
	})
}

func (h *Router) triageIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req triageRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	chosen := req.ChosenSeverity
	if chosen == "" {
		chosen = req.Severity
	}
	result, err := h.svc.TriageIncident(r.Context(), tenantID, TriageIncidentInput{
		IncidentID:      incidentID,
		Assessment:      impactAssessmentFromRequest(req.ImpactAssessment),
		ChosenSeverity:  chosen,
		OverrideReason:  req.OverrideReason,
		ExpectedVersion: req.ExpectedVersion,
		Actor:           actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *Router) listTaskTemplates(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	templates, err := h.svc.ListTaskTemplates(r.Context(), tenantID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if templates == nil {
		templates = []IncidentTaskTemplate{}
	}
	suiteapi.WriteData(w, http.StatusOK, templates)
}

func (h *Router) instantiateTaskTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req instantiateTaskTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	graph, err := h.svc.InstantiateTaskTemplate(r.Context(), tenantID, InstantiateTaskTemplateInput{
		IncidentID:  incidentID,
		TemplateKey: req.TemplateKey,
		Actor:       actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, graph)
}

func (h *Router) listTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	graph, err := h.svc.ListIncidentTasks(r.Context(), tenantID, incidentID, actor)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, graph)
}

func (h *Router) createTask(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req createTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ownerID, err := optionalUUID(req.OwnerID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "owner_id must be a UUID", nil)
		return
	}
	deps, err := uuidList(firstNonEmptyList(req.DependsOn, req.Dependencies))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "dependencies must be UUIDs", nil)
		return
	}
	taskKey := strings.TrimSpace(req.TaskKey)
	if taskKey == "" {
		taskKey = taskKeyFromTitle(req.Title)
	}
	graph, err := h.svc.AddIncidentTask(r.Context(), tenantID, AddIncidentTaskInput{
		IncidentID:             incidentID,
		TaskKey:                taskKey,
		Title:                  req.Title,
		Description:            req.Description,
		TaskType:               req.TaskType,
		Required:               req.Required,
		Position:               req.Position,
		OwnerID:                ownerID,
		OwnerRole:              req.OwnerRole,
		Team:                   req.Team,
		DueAt:                  req.DueAt,
		PlannedDurationSeconds: req.PlannedDurationSeconds,
		AutomationAction:       req.AutomationAction,
		Dependencies:           deps,
		Params:                 req.Params,
		Scope:                  req.Scope,
		Actor:                  actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, graph)
}

func (h *Router) reorderTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req reorderTasksRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ids, err := uuidList(req.TaskIDs)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "task_ids must be UUIDs", nil)
		return
	}
	var graph *IncidentTaskGraph
	for position, taskID := range ids {
		graph, err = h.svc.ReorderIncidentTask(r.Context(), tenantID, ReorderIncidentTaskInput{
			IncidentID: incidentID,
			TaskID:     taskID,
			Position:   position,
			Actor:      actor,
		})
		if err != nil {
			h.writeError(w, r, err)
			return
		}
	}
	if graph == nil {
		graph, err = h.svc.ListIncidentTasks(r.Context(), tenantID, incidentID, actor)
		if err != nil {
			h.writeError(w, r, err)
			return
		}
	}
	suiteapi.WriteData(w, http.StatusOK, graph)
}

func (h *Router) rescopeTask(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, taskID, ok := h.tenantIncidentTask(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req rescopeTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var deps *[]uuid.UUID
	if req.Dependencies != nil {
		parsed, err := uuidList(*req.Dependencies)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "dependencies must be UUIDs", nil)
			return
		}
		deps = &parsed
	}
	graph, err := h.svc.RescopeIncidentTask(r.Context(), tenantID, RescopeIncidentTaskInput{
		IncidentID:             incidentID,
		TaskID:                 taskID,
		Title:                  req.Title,
		Description:            req.Description,
		Required:               req.Required,
		DueAt:                  req.DueAt,
		ClearDueAt:             req.ClearDueAt,
		PlannedDurationSeconds: req.PlannedDurationSeconds,
		AutomationAction:       req.AutomationAction,
		Params:                 req.Params,
		Scope:                  req.Scope,
		Dependencies:           deps,
		Actor:                  actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, graph)
}

func (h *Router) transitionTaskStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, taskID, ok := h.tenantIncidentTask(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req taskStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	status := req.To
	if status == "" {
		status = req.Status
	}
	graph, err := h.svc.TransitionIncidentTaskStatus(r.Context(), tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incidentID,
		TaskID:     taskID,
		To:         normalizeTaskStatus(status),
		Note:       req.Note,
		Actor:      actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, graph)
}

func (h *Router) convertCommunicationToTask(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req communicationTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ownerID, err := optionalUUID(req.OwnerID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "owner_id must be a UUID", nil)
		return
	}
	graph, err := h.svc.ConvertCommunicationToTask(r.Context(), tenantID, ConvertCommunicationToTaskInput{
		IncidentID:    incidentID,
		SourceEventID: req.SourceEventID,
		SourceType:    req.SourceType,
		Summary:       req.Summary,
		Body:          req.Body,
		OwnerID:       ownerID,
		OwnerRole:     req.OwnerRole,
		Team:          req.Team,
		DueAt:         req.DueAt,
		Actor:         actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, graph)
}

func (h *Router) listRoles(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	roles, err := h.svc.ListIncidentRoles(r.Context(), tenantID, incidentID, actor)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if roles == nil {
		roles = []RoleAssignment{}
	}
	suiteapi.WriteData(w, http.StatusOK, roles)
}

func (h *Router) assignRole(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req roleRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	responderID, err := requiredUUID(firstNonEmpty(req.UserID, req.ResponderID))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "user_id must be a UUID", nil)
		return
	}
	source := firstNonEmpty(req.Source, req.ResponderSource)
	assignment, err := h.svc.AssignRole(r.Context(), tenantID, actor, AssignRoleInput{
		IncidentID:  incidentID,
		Role:        req.Role,
		ResponderID: responderID,
		Source:      source,
		Metadata:    req.Metadata,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, assignment)
}

func (h *Router) releaseRole(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	assignmentID, err := suiteapi.UUIDParam(r, "assignmentID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req releaseRoleRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	assignment, err := h.svc.ReleaseRole(r.Context(), tenantID, actor, ReleaseRoleInput{
		IncidentID:    incidentID,
		AssignmentID:  assignmentID,
		ReleaseReason: req.Reason,
		Metadata:      req.Metadata,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, assignment)
}

func (h *Router) mobilizeRole(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	assignmentID, err := suiteapi.UUIDParam(r, "assignmentID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req mobilizeRoleRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	channels := req.Channels
	if req.Channel != "" {
		channels = append([]NotificationChannel{req.Channel}, channels...)
	}
	result, err := h.svc.MobilizeRole(r.Context(), tenantID, MobilizeRoleInput{
		IncidentID:   incidentID,
		AssignmentID: assignmentID,
		Channels:     channels,
		RequiresAck:  req.RequiresAck,
		AckTimeout:   time.Duration(req.AckTimeoutSeconds) * time.Second,
		ActionURL:    req.ActionURL,
		Actor:        actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

func (h *Router) listNotificationDispatches(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	dispatches, err := h.svc.ListIncidentNotificationDispatches(r.Context(), tenantID, incidentID, actor, parseLimit(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if dispatches == nil {
		dispatches = []NotificationDispatch{}
	}
	suiteapi.WriteData(w, http.StatusOK, dispatches)
}

func (h *Router) ackMobilization(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	dispatchID, err := suiteapi.UUIDParam(r, "dispatchID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	dispatch, err := h.svc.AcknowledgeMobilization(r.Context(), tenantID, AcknowledgeMobilizationInput{
		IncidentID: incidentID,
		DispatchID: dispatchID,
		Actor:      actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dispatch)
}

func (h *Router) processNotificationEscalations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	req := processEscalationsRequest{Limit: parseLimit(r)}
	if r.Body != nil && r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	if req.Limit <= 0 {
		req.Limit = parseLimit(r)
	}
	dispatches, err := h.svc.ProcessDueNotificationEscalations(r.Context(), tenantID, h.actor(r), req.Limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if dispatches == nil {
		dispatches = []NotificationDispatch{}
	}
	suiteapi.WriteData(w, http.StatusOK, dispatches)
}

func (h *Router) listStakeholderUpdates(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	updates, err := h.svc.ListStakeholderUpdates(r.Context(), tenantID, incidentID, actor, parseLimit(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if updates == nil {
		updates = []StakeholderUpdateDispatch{}
	}
	suiteapi.WriteData(w, http.StatusOK, updates)
}

func (h *Router) dispatchStakeholderUpdate(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req stakeholderUpdateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	channel := req.Channel
	if channel == "" && len(req.Channels) > 0 {
		channel = req.Channels[0]
	}
	dispatch, err := h.svc.DispatchStakeholderUpdate(r.Context(), tenantID, DispatchStakeholderUpdateInput{
		IncidentID:   incidentID,
		Reason:       req.Reason,
		Channel:      channel,
		RecipientRef: req.RecipientRef,
		NextUpdateAt: req.NextUpdateAt,
		ReceiptRef:   req.ReceiptRef,
		Actor:        actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, dispatch)
}

func (h *Router) listApprovals(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	approvals, err := h.svc.ListApprovals(r.Context(), tenantID, incidentID, actor)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitApprovalGates(approvals))
}

func (h *Router) requestApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req approvalRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	action := req.Action
	if action == "" {
		action = approvalActionFromKey(req.ActionKey)
	}
	requiredRole := optionalRole(firstNonEmpty(req.RequiredRole, req.ApproverRole))
	metadata := req.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	if strings.TrimSpace(req.Title) != "" {
		metadata["title"] = strings.TrimSpace(req.Title)
	}
	if strings.TrimSpace(req.Reason) != "" {
		metadata["reason"] = strings.TrimSpace(req.Reason)
	}
	approval, err := h.svc.RequestApproval(r.Context(), tenantID, RequestApprovalInput{
		IncidentID:   incidentID,
		Action:       action,
		ActionKey:    req.ActionKey,
		RequiredRole: requiredRole,
		WorkflowRef:  req.WorkflowRef,
		Metadata:     metadata,
		Actor:        actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, cockpitApprovalGates([]IncidentApproval{*approval})[0])
}

func (h *Router) decideApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	approvalID, err := suiteapi.UUIDParam(r, "approvalID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req approvalDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	approval, err := h.svc.DecideApproval(r.Context(), tenantID, DecideApprovalInput{
		ApprovalID: approvalID,
		Decision:   req.Decision,
		Reason:     req.Reason,
		Actor:      actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitApprovalGates([]IncidentApproval{*approval})[0])
}

func (h *Router) getPIR(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	pir, err := h.svc.GetPIR(r.Context(), tenantID, incidentID, actor)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitPIR(pir))
}

func (h *Router) generatePIR(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req pirRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	items, err := pirActionItemsFromRequest(req.ActionItems)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	pir, err := h.svc.GeneratePIR(r.Context(), tenantID, GeneratePIRInput{
		IncidentID:          incidentID,
		ContributingFactors: stringList(req.ContributingFactors),
		LessonsLearned:      stringList(req.LessonsLearned),
		ActionItems:         items,
		Actor:               actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitPIR(pir))
}

func (h *Router) signOffPIR(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	pir, err := h.svc.SignOffPIR(r.Context(), tenantID, SignOffPIRInput{
		IncidentID: incidentID,
		Actor:      actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitPIR(pir))
}

func (h *Router) updatePIRActionItem(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actionItemID, err := suiteapi.UUIDParam(r, "actionItemID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req pirActionItemStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	item, err := h.svc.UpdatePIRActionItemStatus(r.Context(), tenantID, UpdatePIRActionItemInput{
		ActionItemID: actionItemID,
		Status:       req.Status,
		Actor:        actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *Router) listEvidenceExports(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	exports, err := h.svc.ListEvidenceExports(r.Context(), tenantID, incidentID, actor, parseLimit(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cockpitEvidenceExports(exports))
}

func (h *Router) exportEvidence(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return
	}
	actor, ok := h.actorForIncident(w, r, tenantID, incidentID)
	if !ok {
		return
	}
	var req evidenceExportRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	export, err := h.svc.ExportIncidentEvidence(r.Context(), tenantID, EvidenceExportInput{
		IncidentID: incidentID,
		Format:     req.Format,
		Actor:      actor,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, cockpitEvidenceExports([]EvidenceExport{*export})[0])
}

func (h *Router) actorForIncident(w http.ResponseWriter, r *http.Request, tenantID, incidentID uuid.UUID) (Actor, bool) {
	actor, err := h.svc.ActorForIncident(r.Context(), tenantID, incidentID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return Actor{}, false
	}
	return actor, true
}

func (h *Router) tenantIncidentTask(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	tenantID, incidentID, ok := h.tenantAndIncident(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	taskID, err := suiteapi.UUIDParam(r, "taskID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return tenantID, incidentID, taskID, true
}

func impactAssessmentFromRequest(req impactAssessmentRequest) IncidentImpactAssessmentInput {
	return IncidentImpactAssessmentInput{
		UserScope:           mapUserScope(firstNonEmpty(req.UserScope, req.UserBaseScope)),
		BusinessCriticality: mapBusinessCriticality(firstNonEmpty(req.BusinessCriticality, req.BusinessProcessCriticality)),
		RevenueImpact:       mapRevenueImpact(req.RevenueImpact),
		RegulatoryExposure:  mapRegulatoryExposure(req.RegulatoryExposure),
		AffectedServiceKeys: req.AffectedServiceKeys,
		Notes:               req.Notes,
	}
}

func mapUserScope(raw string) UserImpactScope {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "none":
		return UserScopeNone
	case "individual", "individual_users":
		return UserScopeIndividual
	case "limited", "limited_user_group":
		return UserScopeLimited
	case "major", "large", "large_user_group":
		return UserScopeLarge
	case "critical", "all", "all_users":
		return UserScopeAll
	default:
		return UserImpactScope(raw)
	}
}

func mapBusinessCriticality(raw string) BusinessCriticality {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "none":
		return BusinessCriticalityNone
	case "non_critical":
		return BusinessCriticalityNonCritical
	case "limited", "important", "important_degraded":
		return BusinessCriticalityImportant
	case "major", "critical_degraded":
		return BusinessCriticalityCriticalDegraded
	case "critical", "critical_stopped":
		return BusinessCriticalityCriticalStopped
	default:
		return BusinessCriticality(raw)
	}
}

func mapRevenueImpact(raw string) RevenueImpact {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "none":
		return RevenueImpactNone
	case "limited", "low":
		return RevenueImpactLow
	case "major", "material":
		return RevenueImpactMaterial
	case "critical", "severe":
		return RevenueImpactSevere
	default:
		return RevenueImpact(raw)
	}
}

func mapRegulatoryExposure(raw string) RegulatoryExposure {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "none":
		return RegulatoryExposureNone
	case "limited", "unlikely":
		return RegulatoryExposureUnlikely
	case "major", "potential":
		return RegulatoryExposurePotential
	case "critical", "confirmed":
		return RegulatoryExposureConfirmed
	default:
		return RegulatoryExposure(raw)
	}
}

func normalizeTaskStatus(status IncidentTaskStatus) IncidentTaskStatus {
	switch strings.ToLower(strings.TrimSpace(string(status))) {
	case "ready":
		return TaskStatusRunnable
	case "in_progress":
		return TaskStatusRunning
	case "completed", "done":
		return TaskStatusComplete
	case "cancelled", "canceled":
		return TaskStatusSkipped
	default:
		return status
	}
}

func approvalActionFromKey(key string) ApprovalAction {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "authorize_failover":
		return ApprovalActionAuthorizeFailover
	case "major_business_impact", "declare_major_business_impact":
		return ApprovalActionDeclareMajorBusinessImpact
	case "close_incident":
		return ApprovalActionCloseIncident
	default:
		return ApprovalAction(key)
	}
}

func optionalRole(raw string) *IncidentRole {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	role := IncidentRole(raw)
	return &role
}

func pirActionItemsFromRequest(in []pirActionItemRequest) ([]CreatePIRActionItemInput, error) {
	out := make([]CreatePIRActionItemInput, 0, len(in))
	for _, item := range in {
		ownerID, err := optionalUUID(item.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("action item owner_id must be a UUID: %w", ErrValidation)
		}
		out = append(out, CreatePIRActionItemInput{
			Title:       item.Title,
			Description: item.Description,
			OwnerID:     ownerID,
			DueAt:       item.DueAt,
		})
	}
	return out, nil
}

func stringList(raw any) []string {
	switch v := raw.(type) {
	case nil:
		return nil
	case string:
		return splitTextList(v)
	case []string:
		return cleanStringList(v)
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return cleanStringList(out)
	default:
		return nil
	}
}

func splitTextList(raw string) []string {
	return cleanStringList(strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == ';'
	}))
}

func cleanStringList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, item := range in {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func optionalUUID(raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func requiredUUID(raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, ErrValidation
	}
	return uuid.Parse(raw)
}

func uuidList(raw []string) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(raw))
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		id, err := uuid.Parse(item)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyList(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func taskKeyFromTitle(title string) string {
	key := strings.ToLower(strings.TrimSpace(title))
	var b strings.Builder
	lastDash := false
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "task-" + uuid.NewString()
	}
	return out
}
