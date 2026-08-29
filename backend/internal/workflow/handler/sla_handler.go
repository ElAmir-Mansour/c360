package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/repository"
)

// WP-5 INTEGRATE — HTTP CRUD for SLA policies + business calendars. The routes
// mount under /api/v1/workflows (/sla-policies, /calendars) and are gated by the
// existing slaRBAC classifier (workflow:read for GET, workflow:write for
// authoring) in cmd/workflow-engine. The handler is transport-only: it decodes
// the request, calls the tenant-scoped SLA service, and maps domain errors via
// handleServiceError (so a UNIQUE name collision -> 409, validation -> 400, a
// missing row -> 404).

// slaPolicyService is the policy operations the handler needs. The concrete
// *service.SLAService satisfies it; the handler depends on the interface so it
// does not import the service package's concrete type.
type slaPolicyService interface {
	CreatePolicy(ctx context.Context, tenantID, userID string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error)
	GetPolicy(ctx context.Context, tenantID, id string) (*repository.SLAPolicyRecord, error)
	ListPolicies(ctx context.Context, tenantID string) ([]*repository.SLAPolicyRecord, error)
	UpdatePolicy(ctx context.Context, tenantID, id string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error)
	DeletePolicy(ctx context.Context, tenantID, id string) error
}

// slaCalendarService is the calendar operations the handler needs.
type slaCalendarService interface {
	CreateCalendar(ctx context.Context, tenantID, userID string, c *repository.CalendarRecord) (*repository.CalendarRecord, error)
	GetCalendar(ctx context.Context, tenantID, id string) (*repository.CalendarRecord, error)
	ListCalendars(ctx context.Context, tenantID string) ([]*repository.CalendarRecord, error)
	UpdateCalendar(ctx context.Context, tenantID, id string, c *repository.CalendarRecord) (*repository.CalendarRecord, error)
	DeleteCalendar(ctx context.Context, tenantID, id string) error
}

// SLAHandler serves SLA policy + calendar CRUD.
type SLAHandler struct {
	policies  slaPolicyService
	calendars slaCalendarService
	logger    zerolog.Logger
}

// NewSLAHandler creates an SLAHandler.
func NewSLAHandler(policies slaPolicyService, calendars slaCalendarService, logger zerolog.Logger) *SLAHandler {
	return &SLAHandler{
		policies:  policies,
		calendars: calendars,
		logger:    logger.With().Str("handler", "workflow_sla").Logger(),
	}
}

// PolicyRoutes returns the chi router for /sla-policies.
func (h *SLAHandler) PolicyRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListPolicies)
	r.Post("/", h.CreatePolicy)
	r.Get("/{id}", h.GetPolicy)
	r.Put("/{id}", h.UpdatePolicy)
	r.Delete("/{id}", h.DeletePolicy)
	return r
}

// CalendarRoutes returns the chi router for /calendars.
func (h *SLAHandler) CalendarRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListCalendars)
	r.Post("/", h.CreateCalendar)
	r.Get("/{id}", h.GetCalendar)
	r.Put("/{id}", h.UpdateCalendar)
	r.Delete("/{id}", h.DeleteCalendar)
	return r
}

// ---------------------------------------------------------------------------
// SLA policy handlers.
// ---------------------------------------------------------------------------

// slaTierDTO is the API form of one tier.
type slaTierDTO struct {
	AfterSeconds int64  `json:"after_seconds"`
	Notify       string `json:"notify"`
	Action       string `json:"action"`
}

// slaPolicyRequest is the create/update body for an SLA policy.
type slaPolicyRequest struct {
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	DefinitionID *string      `json:"definition_id,omitempty"`
	Tiers        []slaTierDTO `json:"tiers"`
	RemindBefore []int64      `json:"remind_before"`
	CalendarID   *string      `json:"calendar_id,omitempty"`
}

// slaPolicyResponse is the API form of a persisted SLA policy.
type slaPolicyResponse struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	DefinitionID *string      `json:"definition_id,omitempty"`
	Tiers        []slaTierDTO `json:"tiers"`
	RemindBefore []int64      `json:"remind_before"`
	CalendarID   *string      `json:"calendar_id,omitempty"`
	CreatedBy    string       `json:"created_by"`
	CreatedAt    string       `json:"created_at"`
	UpdatedAt    string       `json:"updated_at"`
}

func (r slaPolicyRequest) toRecord() *repository.SLAPolicyRecord {
	rec := &repository.SLAPolicyRecord{
		Name:         r.Name,
		Description:  r.Description,
		DefinitionID: r.DefinitionID,
		CalendarID:   r.CalendarID,
		RemindBefore: r.RemindBefore,
	}
	if rec.RemindBefore == nil {
		rec.RemindBefore = []int64{}
	}
	for _, t := range r.Tiers {
		rec.Tiers = append(rec.Tiers, repository.SLATierJSON{
			AfterSeconds: t.AfterSeconds,
			Notify:       t.Notify,
			Action:       t.Action,
		})
	}
	return rec
}

func toPolicyResponse(rec *repository.SLAPolicyRecord) slaPolicyResponse {
	resp := slaPolicyResponse{
		ID:           rec.ID,
		Name:         rec.Name,
		Description:  rec.Description,
		DefinitionID: rec.DefinitionID,
		CalendarID:   rec.CalendarID,
		RemindBefore: rec.RemindBefore,
		CreatedBy:    rec.CreatedBy,
		CreatedAt:    rec.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:    rec.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if resp.RemindBefore == nil {
		resp.RemindBefore = []int64{}
	}
	resp.Tiers = make([]slaTierDTO, 0, len(rec.Tiers))
	for _, t := range rec.Tiers {
		resp.Tiers = append(resp.Tiers, slaTierDTO{
			AfterSeconds: t.AfterSeconds,
			Notify:       t.Notify,
			Action:       t.Action,
		})
	}
	return resp
}

// ListPolicies handles GET /sla-policies.
func (h *SLAHandler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	recs, err := h.policies.ListPolicies(r.Context(), user.TenantID)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to list sla policies")
		handleServiceError(w, err)
		return
	}
	items := make([]slaPolicyResponse, 0, len(recs))
	for _, rec := range recs {
		items = append(items, toPolicyResponse(rec))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sla_policies": items, "total": len(items)})
}

// CreatePolicy handles POST /sla-policies.
func (h *SLAHandler) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	var req slaPolicyRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	rec, err := h.policies.CreatePolicy(r.Context(), user.TenantID, user.ID, req.toRecord())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to create sla policy")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toPolicyResponse(rec))
}

// GetPolicy handles GET /sla-policies/{id}.
func (h *SLAHandler) GetPolicy(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "sla policy id is required")
		return
	}
	rec, err := h.policies.GetPolicy(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPolicyResponse(rec))
}

// UpdatePolicy handles PUT /sla-policies/{id}.
func (h *SLAHandler) UpdatePolicy(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "sla policy id is required")
		return
	}
	var req slaPolicyRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	rec, err := h.policies.UpdatePolicy(r.Context(), user.TenantID, id, req.toRecord())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("policy_id", id).Msg("failed to update sla policy")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPolicyResponse(rec))
}

// DeletePolicy handles DELETE /sla-policies/{id}.
func (h *SLAHandler) DeletePolicy(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "sla policy id is required")
		return
	}
	if err := h.policies.DeletePolicy(r.Context(), user.TenantID, id); err != nil {
		handleServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Calendar handlers.
// ---------------------------------------------------------------------------

// workingDayDTO is the API form of one weekday window.
type workingDayDTO struct {
	StartMinute int `json:"start_minute"`
	EndMinute   int `json:"end_minute"`
}

// calendarRequest is the create/update body for a business calendar.
type calendarRequest struct {
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Timezone    string                   `json:"timezone"`
	WorkingDays map[string]workingDayDTO `json:"working_days"`
	Holidays    []string                 `json:"holidays"`
	IsDefault   bool                     `json:"is_default"`
}

// calendarResponse is the API form of a persisted calendar.
type calendarResponse struct {
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Timezone    string                   `json:"timezone"`
	WorkingDays map[string]workingDayDTO `json:"working_days"`
	Holidays    []string                 `json:"holidays"`
	IsDefault   bool                     `json:"is_default"`
	CreatedBy   string                   `json:"created_by"`
	CreatedAt   string                   `json:"created_at"`
	UpdatedAt   string                   `json:"updated_at"`
}

func (r calendarRequest) toRecord() *repository.CalendarRecord {
	rec := &repository.CalendarRecord{
		Name:        r.Name,
		Description: r.Description,
		Timezone:    r.Timezone,
		IsDefault:   r.IsDefault,
		Holidays:    r.Holidays,
		WorkingDays: map[string]repository.WorkingDayJSON{},
	}
	if rec.Holidays == nil {
		rec.Holidays = []string{}
	}
	for k, v := range r.WorkingDays {
		rec.WorkingDays[k] = repository.WorkingDayJSON{StartMinute: v.StartMinute, EndMinute: v.EndMinute}
	}
	return rec
}

func toCalendarResponse(rec *repository.CalendarRecord) calendarResponse {
	resp := calendarResponse{
		ID:          rec.ID,
		Name:        rec.Name,
		Description: rec.Description,
		Timezone:    rec.Timezone,
		IsDefault:   rec.IsDefault,
		Holidays:    rec.Holidays,
		CreatedBy:   rec.CreatedBy,
		CreatedAt:   rec.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   rec.UpdatedAt.UTC().Format(time.RFC3339),
		WorkingDays: map[string]workingDayDTO{},
	}
	if resp.Holidays == nil {
		resp.Holidays = []string{}
	}
	for k, v := range rec.WorkingDays {
		resp.WorkingDays[k] = workingDayDTO{StartMinute: v.StartMinute, EndMinute: v.EndMinute}
	}
	return resp
}

// ListCalendars handles GET /calendars.
func (h *SLAHandler) ListCalendars(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	recs, err := h.calendars.ListCalendars(r.Context(), user.TenantID)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to list calendars")
		handleServiceError(w, err)
		return
	}
	items := make([]calendarResponse, 0, len(recs))
	for _, rec := range recs {
		items = append(items, toCalendarResponse(rec))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"calendars": items, "total": len(items)})
}

// CreateCalendar handles POST /calendars.
func (h *SLAHandler) CreateCalendar(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	var req calendarRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	rec, err := h.calendars.CreateCalendar(r.Context(), user.TenantID, user.ID, req.toRecord())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to create calendar")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toCalendarResponse(rec))
}

// GetCalendar handles GET /calendars/{id}.
func (h *SLAHandler) GetCalendar(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "calendar id is required")
		return
	}
	rec, err := h.calendars.GetCalendar(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCalendarResponse(rec))
}

// UpdateCalendar handles PUT /calendars/{id}.
func (h *SLAHandler) UpdateCalendar(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "calendar id is required")
		return
	}
	var req calendarRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	rec, err := h.calendars.UpdateCalendar(r.Context(), user.TenantID, id, req.toRecord())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("calendar_id", id).Msg("failed to update calendar")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCalendarResponse(rec))
}

// DeleteCalendar handles DELETE /calendars/{id}.
func (h *SLAHandler) DeleteCalendar(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "calendar id is required")
		return
	}
	if err := h.calendars.DeleteCalendar(r.Context(), user.TenantID, id); err != nil {
		handleServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
