package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/integration/connector"
	intdto "github.com/clario360/platform/internal/integration/dto"
	intmodel "github.com/clario360/platform/internal/integration/model"
	intsvc "github.com/clario360/platform/internal/integration/service"
)

type IntegrationHandler struct {
	service   *intsvc.IntegrationService
	providers []ProviderStatus
	logger    zerolog.Logger
}

type ProviderStatus struct {
	Type             intmodel.IntegrationType `json:"type"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	SetupMode        string                   `json:"setup_mode"`
	Configured       bool                     `json:"configured"`
	OAuthEnabled     bool                     `json:"oauth_enabled"`
	OAuthStartURL    string                   `json:"oauth_start_url,omitempty"`
	MissingConfig    []string                 `json:"missing_config,omitempty"`
	SupportsInbound  bool                     `json:"supports_inbound"`
	SupportsOutbound bool                     `json:"supports_outbound"`
	// Capabilities / AuthKind / ConfigSchema are projected from the connector's
	// registry Manifest so the admin UI can render the config form and present
	// the new connectors (email/pagerduty/rest) as available providers.
	Capabilities string                `json:"capabilities,omitempty"`
	AuthKind     string                `json:"auth_kind,omitempty"`
	ConfigSchema []connector.FieldSpec `json:"config_schema,omitempty"`
}

// NewIntegrationHandler builds the integration handler. registry, when non-nil,
// is the single source of truth for the providers endpoint: ListProviders is the
// merge of every registered connector's Manifest with the curated OAuth/config
// status metadata in providers (keyed by type). Connectors present in the
// registry but absent from the curated list (the new email/pagerduty/rest
// connectors) still surface — with their manifest and outbound capability —
// rather than being dropped, so "config not code" connectors are reachable
// without editing this handler.
func NewIntegrationHandler(service *intsvc.IntegrationService, providers []ProviderStatus, registry *connector.Registry, logger zerolog.Logger) *IntegrationHandler {
	return &IntegrationHandler{
		service:   service,
		providers: mergeProviders(providers, registry),
		logger:    logger.With().Str("component", "integration_handler").Logger(),
	}
}

// mergeProviders projects each registry Manifest onto the providers list. For a
// type that already has curated metadata (slack/teams/jira/servicenow/webhook),
// the manifest fields (capabilities, auth kind, config schema) are layered onto
// the existing entry, preserving its OAuth/config status. For a type that has no
// curated entry (email/pagerduty/rest), a new ProviderStatus is synthesized from
// the manifest: it is outbound-capable, manually configured, and carries the
// schema so the admin form can render it. The result is sorted by type for
// deterministic output, matching Registry.List().
func mergeProviders(curated []ProviderStatus, registry *connector.Registry) []ProviderStatus {
	if registry == nil {
		return curated
	}
	byType := make(map[string]ProviderStatus, len(curated))
	for _, p := range curated {
		byType[string(p.Type)] = p
	}
	for _, m := range registry.List() {
		entry, ok := byType[m.Type]
		if !ok {
			entry = ProviderStatus{
				Type:             intmodel.IntegrationType(m.Type),
				Name:             m.DisplayName,
				Description:      "Config-driven connector delivered via the connector registry.",
				SetupMode:        "manual",
				Configured:       true,
				SupportsInbound:  false,
				SupportsOutbound: m.Capabilities.CanNotify() || m.Capabilities.CanTicket(),
			}
		}
		entry.Capabilities = string(m.Capabilities)
		entry.AuthKind = string(m.AuthKind)
		entry.ConfigSchema = m.ConfigSchema
		byType[m.Type] = entry
	}

	out := make([]ProviderStatus, 0, len(byType))
	for _, p := range byType {
		out = append(out, p)
	}
	sortProvidersByType(out)
	return out
}

// sortProvidersByType orders providers by their type string so the endpoint is
// deterministic and aligned with Registry.List()'s ordering.
func sortProvidersByType(providers []ProviderStatus) {
	for i := 1; i < len(providers); i++ {
		for j := i; j > 0 && providers[j-1].Type > providers[j].Type; j-- {
			providers[j-1], providers[j] = providers[j], providers[j-1]
		}
	}
}

func (h *IntegrationHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	user, _ := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": h.providers})
}

func (h *IntegrationHandler) List(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	query, err := intdto.ParseListQuery(r)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_PARAMS", err.Error())
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, query)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "INTEGRATION_LIST_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": intdto.NewPagination(query.Page, query.PerPage, total),
	})
}

func (h *IntegrationHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, r, http.StatusNotFound, "NOT_FOUND", "integration not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (h *IntegrationHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if !auth.HasPermission(user.Roles, "tenant:write") {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "tenant:write permission is required")
		return
	}
	var req intdto.CreateIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_BODY", "invalid json body")
		return
	}
	if err := req.Validate(); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, user.ID, &req, actorFromRequest(r))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "INTEGRATION_CREATE_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (h *IntegrationHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if !auth.HasPermission(user.Roles, "tenant:write") {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "tenant:write permission is required")
		return
	}
	var req intdto.UpdateIntegrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_BODY", "invalid json body")
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, chi.URLParam(r, "id"), &req, actorFromRequest(r))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "INTEGRATION_UPDATE_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (h *IntegrationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if !auth.HasPermission(user.Roles, "tenant:write") {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "tenant:write permission is required")
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, chi.URLParam(r, "id"), actorFromRequest(r)); err != nil {
		writeError(w, r, http.StatusBadRequest, "INTEGRATION_DELETE_FAILED", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *IntegrationHandler) Test(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	code, body, err := h.service.Test(r.Context(), tenantID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "INTEGRATION_TEST_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"success":       err == nil,
			"response_code": code,
			"response_body": body,
		},
	})
}

func (h *IntegrationHandler) Deliveries(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	query, err := intdto.ParseDeliveryQuery(r)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_PARAMS", err.Error())
		return
	}
	items, total, err := h.service.ListDeliveries(r.Context(), tenantID, chi.URLParam(r, "id"), query)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "DELIVERY_LIST_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": items,
		"meta": intdto.NewPagination(query.Page, query.PerPage, total),
	})
}

func (h *IntegrationHandler) RetryFailed(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	count, err := h.service.RetryFailed(r.Context(), tenantID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "RETRY_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]int{"retried_count": count}})
}

func (h *IntegrationHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	var req intdto.UpdateStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_BODY", "invalid json body")
		return
	}
	if err := req.Validate(); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.service.UpdateStatus(r.Context(), tenantID, chi.URLParam(r, "id"), req.Status, actorFromRequest(r)); err != nil {
		writeError(w, r, http.StatusBadRequest, "STATUS_UPDATE_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"status": string(req.Status)}})
}

func (h *IntegrationHandler) ListTicketLinks(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	query := &intdto.TicketLinkQuery{
		IntegrationID:  r.URL.Query().Get("integration_id"),
		EntityType:     r.URL.Query().Get("entity_type"),
		EntityID:       r.URL.Query().Get("entity_id"),
		ExternalSystem: r.URL.Query().Get("external_system"),
	}
	items, err := h.service.ListTicketLinks(r.Context(), tenantID, query)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "TICKET_LINK_LIST_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": items})
}

func (h *IntegrationHandler) GetTicketLink(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	item, err := h.service.GetTicketLink(r.Context(), tenantID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, r, http.StatusNotFound, "NOT_FOUND", "ticket link not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (h *IntegrationHandler) SyncTicketLink(w http.ResponseWriter, r *http.Request) {
	user, tenantID := requireAuth(r)
	if user == nil {
		writeError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if err := h.service.ForceSync(r.Context(), tenantID, chi.URLParam(r, "id")); err != nil {
		writeError(w, r, http.StatusBadRequest, "TICKET_SYNC_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"status": "synced"}})
}

func (h *IntegrationHandler) allowedTypes() []intmodel.IntegrationType {
	return []intmodel.IntegrationType{
		intmodel.IntegrationTypeSlack,
		intmodel.IntegrationTypeTeams,
		intmodel.IntegrationTypeJira,
		intmodel.IntegrationTypeServiceNow,
		intmodel.IntegrationTypeWebhook,
	}
}
