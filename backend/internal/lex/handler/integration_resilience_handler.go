package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	"github.com/clario360/platform/internal/suiteapi"
)

// IntegrationResilienceHandler exposes the integration RELIABILITY surfaces
// (reliability features #11 DLQ + #12 circuit breaker) over the registry service:
//   - the per-endpoint and cross-tenant dead-letter queue list,
//   - single + batch DLQ replay,
//   - the per-endpoint breaker state read + manual reset.
//
// Reads are gated read (lex:integration:read OR coarse lex:read/write); replays and
// the breaker reset are gated manage. It mirrors IntegrationHandler's shape: a thin
// handler over service.IntegrationRegistryService that resolves tenant/user from
// context and writes secret-free, sanitized DTOs. The DLQ payload is already
// redacted at write time, so nothing here can leak a secret.
type IntegrationResilienceHandler struct {
	baseHandler
	service *service.IntegrationRegistryService
}

// NewIntegrationResilienceHandler wires the registry service (which owns the DLQ
// service + breaker controller via WithDLQ / WithBreaker).
func NewIntegrationResilienceHandler(svc *service.IntegrationRegistryService, logger zerolog.Logger) *IntegrationResilienceHandler {
	return &IntegrationResilienceHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// DLQList returns the dead-letter rows for ONE endpoint
// (GET /integrations/{id}/dlq?status=&limit=). Read tier.
func (h *IntegrationResilienceHandler) DLQList(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListDeadLetters(
		r.Context(), tenantID, id,
		strings.TrimSpace(r.URL.Query().Get("status")),
		dlqLimit(r),
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, deadLetterList(items))
}

// DLQListAll returns the dead-letter rows ACROSS every endpoint for the tenant
// (GET /integrations/dlq?status=&limit=). Read tier.
func (h *IntegrationResilienceHandler) DLQListAll(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListAllDeadLetters(
		r.Context(), tenantID,
		strings.TrimSpace(r.URL.Query().Get("status")),
		dlqLimit(r),
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, deadLetterList(items))
}

// DLQReplay re-runs ONE failed dead-letter row's original operation
// (POST /integrations/dlq/{dlqId}/replay). Returns {ok,result}. Manage tier.
func (h *IntegrationResilienceHandler) DLQReplay(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	dlqID, err := suiteapi.UUIDParam(r, "dlqId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.ReplayDeadLetter(r.Context(), tenantID, userID, dlqID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"ok":     result.OK,
		"result": dlqReplayResponse(result),
	})
}

// DLQReplayFailed batch-replays EVERY failed dead-letter row for an endpoint
// (POST /integrations/{id}/dlq/replay-failed). Returns {replayed,failed}. Manage.
func (h *IntegrationResilienceHandler) DLQReplayFailed(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.ReplayFailedDeadLetters(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"replayed": result.Replayed,
		"failed":   result.Failed,
	})
}

// BreakerGet returns the endpoint's circuit-breaker state
// (GET /integrations/{id}/breaker). Read tier.
func (h *IntegrationResilienceHandler) BreakerGet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	state, err := h.service.BreakerState(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// BreakerReset manually closes the breaker + clears quarantine
// (POST /integrations/{id}/breaker/reset). Returns the post-reset state. Manage.
func (h *IntegrationResilienceHandler) BreakerReset(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	state, err := h.service.ResetBreaker(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// dlqLimit reads the optional ?limit= query param (defaulted by the service).
func dlqLimit(r *http.Request) int {
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}

// deadLetterList maps service DeadLetters to the pinned API response shape. The
// stored payload is already redacted; this is a field copy.
func deadLetterList(items []integration.DeadLetter) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for i := range items {
		dl := items[i]
		var lastAttempt any
		if dl.LastAttemptAt != nil {
			lastAttempt = dl.LastAttemptAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		out = append(out, map[string]any{
			"id":               dl.ID.String(),
			"endpoint_id":      dl.EndpointID.String(),
			"source":           string(dl.Source),
			"summary":          dl.Summary,
			"error":            dl.Error,
			"attempts":         dl.Attempts,
			"status":           dl.Status,
			"payload_redacted": dl.PayloadRedacted,
			"created_at":       dl.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
			"last_attempt_at":  lastAttempt,
		})
	}
	return out
}

func dlqReplayResponse(result *integration.ReplayResult) map[string]any {
	if result == nil {
		return map[string]any{}
	}
	return map[string]any{
		"id":     result.ID.String(),
		"ok":     result.OK,
		"status": result.Status,
		"detail": result.Detail,
	}
}
