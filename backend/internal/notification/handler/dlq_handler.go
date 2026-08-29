package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/events"
)

// parseIntDefault parses s as an int, returning fallback when empty/invalid or
// non-positive is not enforced here (callers clamp as needed).
func parseIntDefault(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return fallback
}

// dlqStore is the durable dead-letter store the handler reads/mutates.
// repository.DeadLetterRepository satisfies it.
type dlqStore interface {
	List(ctx context.Context, tenantID, status string, limit, offset int) ([]*events.DeadLetterEntry, error)
	Get(ctx context.Context, id string) (*events.DeadLetterEntry, bool, error)
	Count(ctx context.Context, tenantID, status string) (int, error)
	MarkReplayed(ctx context.Context, tenantID, id string) (bool, error)
	Ack(ctx context.Context, tenantID, id string) (bool, error)
}

// dlqPublisher republishes a replayed event to the bus. *events.Producer
// satisfies it.
type dlqPublisher interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

// DLQHandler exposes durable dead-letter inspection, replay and acknowledge over
// HTTP (#14). All routes are tenant-scoped and gated by notifications:manage
// (the same Wave B permission as the rest of the control plane).
type DLQHandler struct {
	store     dlqStore
	publisher dlqPublisher
	logger    zerolog.Logger
}

// NewDLQHandler creates a DLQHandler. publisher may be nil, in which case replay
// returns 503 (nothing to publish to).
func NewDLQHandler(store dlqStore, publisher dlqPublisher, logger zerolog.Logger) *DLQHandler {
	return &DLQHandler{store: store, publisher: publisher, logger: logger.With().Str("component", "dlq_handler").Logger()}
}

// List handles GET /api/v1/notifications/dlq?status=&limit=&offset=. It returns
// only the caller tenant's dead-letter entries.
func (h *DLQHandler) List(w http.ResponseWriter, r *http.Request) {
	if !requireNotificationsManage(w, r) {
		return
	}
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}
	status := r.URL.Query().Get("status")
	limit := parseIntDefault(r.URL.Query().Get("limit"), 100)
	offset := parseIntDefault(r.URL.Query().Get("offset"), 0)

	entries, err := h.store.List(r.Context(), tenantID, status, limit, offset)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to list dead letters")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list dead letters", r)
		return
	}
	total, err := h.store.Count(r.Context(), tenantID, status)
	if err != nil {
		h.logger.Warn().Err(err).Msg("failed to count dead letters")
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries": entries,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// Replay handles POST /api/v1/notifications/dlq/{id}/replay. It re-publishes the
// failed event to its original topic and marks the entry replayed. Tenant-scoped:
// an entry belonging to another tenant returns 404.
func (h *DLQHandler) Replay(w http.ResponseWriter, r *http.Request) {
	if !requireNotificationsManage(w, r) {
		return
	}
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}
	if h.publisher == nil {
		writeErrorResponse(w, http.StatusServiceUnavailable, "UNAVAILABLE", "event bus unavailable; cannot replay", r)
		return
	}
	id := chi.URLParam(r, "id")

	entry, ok, err := h.store.Get(r.Context(), id)
	if err != nil {
		h.logger.Error().Err(err).Str("dlq_id", id).Msg("failed to load dead letter for replay")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load dead letter", r)
		return
	}
	if !ok || (entry.TenantID != "" && entry.TenantID != tenantID) {
		writeErrorResponse(w, http.StatusNotFound, "NOT_FOUND", "dead letter entry not found", r)
		return
	}
	if entry.OriginalTopic == "" {
		writeErrorResponse(w, http.StatusUnprocessableEntity, "UNPROCESSABLE", "original topic not recorded; cannot replay", r)
		return
	}

	replayEvent, buildErr := buildReplayEvent(entry)
	if buildErr != nil {
		writeErrorResponse(w, http.StatusUnprocessableEntity, "UNPROCESSABLE", buildErr.Error(), r)
		return
	}
	if pubErr := h.publisher.Publish(r.Context(), entry.OriginalTopic, replayEvent); pubErr != nil {
		h.logger.Error().Err(pubErr).Str("dlq_id", id).Str("topic", entry.OriginalTopic).Msg("failed to replay dead letter")
		writeErrorResponse(w, http.StatusBadGateway, "REPLAY_FAILED", "failed to replay event to bus", r)
		return
	}
	if _, err := h.store.MarkReplayed(r.Context(), tenantID, id); err != nil {
		h.logger.Warn().Err(err).Str("dlq_id", id).Msg("event replayed but failed to mark entry replayed")
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "replayed",
		"replay_event_id": replayEvent.ID,
		"topic":           entry.OriginalTopic,
	})
}

// Ack handles POST /api/v1/notifications/dlq/{id}/ack. It flips the entry to
// acknowledged (operator dismissed it). Tenant-scoped.
func (h *DLQHandler) Ack(w http.ResponseWriter, r *http.Request) {
	if !requireNotificationsManage(w, r) {
		return
	}
	tenantID := auth.TenantFromContext(r.Context())
	if tenantID == "" {
		writeErrorResponse(w, http.StatusForbidden, "FORBIDDEN", "tenant context required", r)
		return
	}
	id := chi.URLParam(r, "id")

	ok, err := h.store.Ack(r.Context(), tenantID, id)
	if err != nil {
		h.logger.Error().Err(err).Str("dlq_id", id).Msg("failed to acknowledge dead letter")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to acknowledge dead letter", r)
		return
	}
	if !ok {
		writeErrorResponse(w, http.StatusNotFound, "NOT_FOUND", "dead letter entry not found", r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "acknowledged"})
}

// buildReplayEvent reconstructs the event to republish from a stored entry,
// preferring the full embedded original event and falling back to the raw
// payload. It stamps a fresh id/time and links causation to the failed event.
func buildReplayEvent(entry *events.DeadLetterEntry) (*events.Event, error) {
	if len(entry.OriginalEvent) > 0 {
		var original events.Event
		if err := json.Unmarshal(entry.OriginalEvent, &original); err != nil {
			return nil, err
		}
		original.ID = events.GenerateUUID()
		original.Time = time.Now().UTC()
		original.Timestamp = original.Time
		original.CausationID = entry.OriginalEventID
		if original.Metadata == nil {
			original.Metadata = map[string]string{}
		}
		original.Metadata["dlq.replayed_from"] = entry.ID
		original.Metadata["dlq.replayed_at"] = time.Now().UTC().Format(time.RFC3339)
		return &original, nil
	}

	replayEvent := events.NewEventRaw(entry.OriginalType, "dead-letter-replay", entry.TenantID, entry.EventData)
	replayEvent.CausationID = entry.OriginalEventID
	replayEvent.Metadata = map[string]string{
		"dlq.replayed_from": entry.ID,
		"dlq.replayed_at":   time.Now().UTC().Format(time.RFC3339),
	}
	return replayEvent, nil
}
