package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// triggerExecutionReader reads trigger execution logs.
type triggerExecutionReader interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.TriggerExecution, error)
	List(ctx context.Context, tenantID, status, definitionID, eventID, topic string, dateFrom, dateTo *time.Time, limit, offset int) ([]*model.TriggerExecution, int, error)
}

// triggerExecutionReplayer replays a persisted trigger execution.
type triggerExecutionReplayer interface {
	Replay(ctx context.Context, tenantID, userID, triggerExecutionID string) (*model.WorkflowInstance, error)
}

// TriggerExecutionHandler exposes trigger execution logs and replay actions.
type TriggerExecutionHandler struct {
	reader   triggerExecutionReader
	replayer triggerExecutionReplayer
	logger   zerolog.Logger
}

// NewTriggerExecutionHandler creates a trigger execution handler.
func NewTriggerExecutionHandler(reader triggerExecutionReader, replayer triggerExecutionReplayer, logger zerolog.Logger) *TriggerExecutionHandler {
	return &TriggerExecutionHandler{
		reader:   reader,
		replayer: replayer,
		logger:   logger.With().Str("handler", "workflow_trigger_execution").Logger(),
	}
}

// Routes returns all trigger execution routes.
func (h *TriggerExecutionHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/", h.List)
	r.Get("/{id}", h.GetByID)
	r.Post("/{id}/replay", h.Replay)

	return r
}

// List handles GET / — lists trigger execution logs.
func (h *TriggerExecutionHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	status := r.URL.Query().Get("status")
	if status != "" && !model.ValidTriggerExecutionStatuses[status] {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "status must be one of: matched, skipped, duplicate, started, failed")
		return
	}

	var dateFrom, dateTo *time.Time
	if df := r.URL.Query().Get("date_from"); df != "" {
		t, err := time.Parse(time.RFC3339, df)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DATE", "date_from must be in RFC3339 format")
			return
		}
		dateFrom = &t
	}
	if dt := r.URL.Query().Get("date_to"); dt != "" {
		t, err := time.Parse(time.RFC3339, dt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DATE", "date_to must be in RFC3339 format")
			return
		}
		dateTo = &t
	}

	page, pageSize := parsePagination(r)
	offset := (page - 1) * pageSize

	executions, total, err := h.reader.List(
		r.Context(),
		user.TenantID,
		status,
		r.URL.Query().Get("definition_id"),
		r.URL.Query().Get("event_id"),
		r.URL.Query().Get("topic"),
		dateFrom,
		dateTo,
		pageSize,
		offset,
	)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to list trigger executions")
		handleServiceError(w, err)
		return
	}

	items := make([]dto.TriggerExecutionResponse, 0, len(executions))
	for _, exec := range executions {
		items = append(items, dto.TriggerExecutionToResponse(exec))
	}

	writeJSON(w, http.StatusOK, dto.ListTriggerExecutionsResponse{
		Data: items,
		Meta: dto.NewPaginationMeta(page, pageSize, total),
	})
}

// GetByID handles GET /{id} — retrieves one trigger execution log.
func (h *TriggerExecutionHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "trigger execution id is required")
		return
	}

	exec, err := h.reader.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("trigger_execution_id", id).
			Msg("failed to get trigger execution")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.TriggerExecutionToResponse(exec))
}

// Replay handles POST /{id}/replay — starts a new instance from a trigger log.
func (h *TriggerExecutionHandler) Replay(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if h.replayer == nil {
		writeError(w, http.StatusServiceUnavailable, "REPLAY_UNAVAILABLE", "trigger replay is not configured")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "trigger execution id is required")
		return
	}

	instance, err := h.replayer.Replay(r.Context(), user.TenantID, user.ID, id)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("trigger_execution_id", id).
			Msg("failed to replay trigger execution")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, dto.ReplayTriggerExecutionResponse{
		SourceTriggerExecutionID: id,
		Instance:                 dto.InstanceToResponse(instance),
	})
}
