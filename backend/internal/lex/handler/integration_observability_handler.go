package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	"github.com/clario360/platform/internal/suiteapi"
)

// IntegrationObservabilityHandler exposes the integration OBSERVABILITY surfaces
// (observability features #16 per-connector metrics + SLOs, #17 inbound-event
// inspector + replay) over the registry service:
//   - the per-connector windowed ConnectorMetrics + the tenant overview rollup,
//   - the per-endpoint + cross-tenant inbound-event list (filterable),
//   - single inbound-event replay.
//
// Metrics + event lists are gated READ (lex:integration:read OR coarse
// lex:read/write); event replay is gated MANAGE. It mirrors
// IntegrationResilienceHandler's shape: a thin handler over
// service.IntegrationRegistryService that resolves tenant/user from context and
// writes secret-free, sanitized DTOs. Call metrics carry no payload and event
// payloads are redacted at write time, so nothing here can leak a secret.
type IntegrationObservabilityHandler struct {
	baseHandler
	service *service.IntegrationRegistryService
}

// NewIntegrationObservabilityHandler wires the registry service (which owns the
// call-metrics recorder + event log via WithCallMetrics / WithEventLog).
func NewIntegrationObservabilityHandler(svc *service.IntegrationRegistryService, logger zerolog.Logger) *IntegrationObservabilityHandler {
	return &IntegrationObservabilityHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// Metrics returns the windowed ConnectorMetrics for ONE endpoint
// (GET /integrations/{id}/metrics?window=24h). Read tier.
func (h *IntegrationObservabilityHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	window := integration.ParseWindow(r.URL.Query().Get("window"))
	metrics, err := h.service.Metrics(r.Context(), tenantID, id, window)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, metrics)
}

// Overview returns the tenant metrics rollup
// (GET /integrations/metrics?window=24h). Read tier.
func (h *IntegrationObservabilityHandler) Overview(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	window := integration.ParseWindow(r.URL.Query().Get("window"))
	rows, err := h.service.MetricsOverview(r.Context(), tenantID, window)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rows)
}

// Events returns the REDACTED inbound-event rows for ONE endpoint
// (GET /integrations/{id}/events?direction=&kind=&status=&limit=). Read tier.
func (h *IntegrationObservabilityHandler) Events(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListEvents(r.Context(), tenantID, id, eventFilter(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// EventsAll returns the REDACTED inbound-event rows ACROSS every endpoint for the
// tenant (GET /integrations/events?direction=&kind=&status=&limit=). Read tier.
func (h *IntegrationObservabilityHandler) EventsAll(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListAllEvents(r.Context(), tenantID, eventFilter(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// EventReplay re-dispatches ONE inbound event through the connector
// (POST /integrations/events/{eventId}/replay). Returns {ok,result}. Manage tier.
func (h *IntegrationObservabilityHandler) EventReplay(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	eventID, err := suiteapi.UUIDParam(r, "eventId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.ReplayEvent(r.Context(), tenantID, userID, eventID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"ok":     result.OK,
		"result": result,
	})
}

// eventFilter reads the optional direction/kind/status/limit query params into the
// repository event filter (empty fields are not applied).
func eventFilter(r *http.Request) repository.IntegrationEventFilter {
	q := r.URL.Query()
	limit := 0
	if v := strings.TrimSpace(q.Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	return repository.IntegrationEventFilter{
		Direction: strings.TrimSpace(q.Get("direction")),
		Kind:      strings.TrimSpace(q.Get("kind")),
		Status:    strings.TrimSpace(q.Get("status")),
		Limit:     limit,
	}
}
