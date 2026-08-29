package respond

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

type integrationHTTPService interface {
	CreateIntegrationConnector(ctx context.Context, tenantID uuid.UUID, actor Actor, in CreateIntegrationConnectorInput) (*IntegrationConnectorResponse, error)
	ListIntegrationConnectors(ctx context.Context, tenantID uuid.UUID, actor Actor, kind *IntegrationKind, provider *IntegrationProvider) ([]IntegrationConnectorResponse, error)
	GetIntegrationConnector(ctx context.Context, tenantID, connectorID uuid.UUID, actor Actor) (*IntegrationConnectorResponse, error)
	SyncIncidentToITSM(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, action string) (*IntegrationExternalLink, error)
	CreateCommsChannel(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, name string) (*CommsChannel, error)
	PostCommsMessage(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, message CommsMessage) (*CommsMessageReceipt, error)
	IngestITSMWebhook(ctx context.Context, tenantID, connectorID uuid.UUID, headers http.Header, body []byte) (*InboundWebhookResult, error)
}

type IntegrationRouter struct {
	svc    integrationHTTPService
	logger zerolog.Logger
}

func NewIntegrationRouter(svc *RespondIntegrationService, logger zerolog.Logger) *IntegrationRouter {
	return &IntegrationRouter{svc: svc, logger: logger.With().Str("handler", "respond-integrations").Logger()}
}

func (h *IntegrationRouter) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondRead))
		r.Get("/integrations/connectors", h.listConnectors)
		r.Get("/integrations/connectors/{connectorID}", h.getConnector)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondAdmin))
		r.Post("/integrations/connectors", h.createConnector)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermRespondUpdate))
		r.Post("/incidents/{incidentID}/integrations/{connectorID}/sync", h.syncIncident)
		r.Post("/incidents/{incidentID}/integrations/{connectorID}/channels", h.createChannel)
		r.Post("/incidents/{incidentID}/integrations/{connectorID}/messages", h.postMessage)
	})
	return r
}

func (h *IntegrationRouter) PublicRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/integrations/webhooks/{tenantID}/{connectorID}", h.ingestWebhook)
	return r
}

type createIntegrationConnectorRequest struct {
	Kind              IntegrationKind            `json:"kind"`
	Provider          IntegrationProvider        `json:"provider"`
	Name              string                     `json:"name"`
	Enabled           *bool                      `json:"enabled,omitempty"`
	EndpointURL       string                     `json:"endpoint_url,omitempty"`
	Config            map[string]any             `json:"config,omitempty"`
	FieldMapping      map[string]string          `json:"field_mapping,omitempty"`
	WebhookAuthType   IntegrationWebhookAuthType `json:"webhook_auth_type,omitempty"`
	WebhookSecretName string                     `json:"webhook_secret_name,omitempty"`
	Secrets           []integrationSecretRequest `json:"secrets,omitempty"`
}

type integrationSecretRequest struct {
	Name      string `json:"name"`
	Plaintext string `json:"plaintext,omitempty"`
	Value     string `json:"value,omitempty"`
	SecretRef string `json:"secret_ref,omitempty"`
}

type syncIncidentRequest struct {
	Action string `json:"action,omitempty"`
}

type createCommsChannelRequest struct {
	Name string `json:"name,omitempty"`
}

type postCommsMessageRequest struct {
	ChannelID string           `json:"channel_id,omitempty"`
	Text      string           `json:"text,omitempty"`
	Blocks    []map[string]any `json:"blocks,omitempty"`
	ThreadTS  string           `json:"thread_ts,omitempty"`
}

func (h *IntegrationRouter) createConnector(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := integrationTenant(w, r)
	if !ok {
		return
	}
	var req createIntegrationConnectorRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.CreateIntegrationConnector(r.Context(), tenantID, h.actor(r), CreateIntegrationConnectorInput{
		Kind:              req.Kind,
		Provider:          req.Provider,
		Name:              req.Name,
		Enabled:           req.Enabled,
		EndpointURL:       req.EndpointURL,
		Config:            req.Config,
		FieldMapping:      req.FieldMapping,
		WebhookAuthType:   req.WebhookAuthType,
		WebhookSecretName: req.WebhookSecretName,
		Secrets:           integrationSecretInputs(req.Secrets),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

func (h *IntegrationRouter) listConnectors(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := integrationTenant(w, r)
	if !ok {
		return
	}
	var kind *IntegrationKind
	if raw := strings.TrimSpace(r.URL.Query().Get("kind")); raw != "" {
		parsed := IntegrationKind(raw)
		kind = &parsed
	}
	var provider *IntegrationProvider
	if raw := strings.TrimSpace(r.URL.Query().Get("provider")); raw != "" {
		parsed := IntegrationProvider(raw)
		provider = &parsed
	}
	out, err := h.svc.ListIntegrationConnectors(r.Context(), tenantID, h.actor(r), kind, provider)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if out == nil {
		out = []IntegrationConnectorResponse{}
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *IntegrationRouter) getConnector(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := integrationTenant(w, r)
	if !ok {
		return
	}
	connectorID, ok := integrationUUIDParam(w, r, "connectorID")
	if !ok {
		return
	}
	out, err := h.svc.GetIntegrationConnector(r.Context(), tenantID, connectorID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *IntegrationRouter) syncIncident(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, connectorID, ok := h.integrationRouteIDs(w, r)
	if !ok {
		return
	}
	var req syncIncidentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	link, err := h.svc.SyncIncidentToITSM(r.Context(), tenantID, connectorID, incidentID, strings.TrimSpace(req.Action))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, link)
}

func (h *IntegrationRouter) createChannel(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, connectorID, ok := h.integrationRouteIDs(w, r)
	if !ok {
		return
	}
	var req createCommsChannelRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	channel, err := h.svc.CreateCommsChannel(r.Context(), tenantID, connectorID, incidentID, strings.TrimSpace(req.Name))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, channel)
}

func (h *IntegrationRouter) postMessage(w http.ResponseWriter, r *http.Request) {
	tenantID, incidentID, connectorID, ok := h.integrationRouteIDs(w, r)
	if !ok {
		return
	}
	var req postCommsMessageRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	receipt, err := h.svc.PostCommsMessage(r.Context(), tenantID, connectorID, incidentID, CommsMessage{
		ChannelID: strings.TrimSpace(req.ChannelID),
		Text:      strings.TrimSpace(req.Text),
		Blocks:    req.Blocks,
		ThreadTS:  strings.TrimSpace(req.ThreadTS),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, receipt)
}

func (h *IntegrationRouter) ingestWebhook(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := integrationUUIDParam(w, r, "tenantID")
	if !ok {
		return
	}
	connectorID, ok := integrationUUIDParam(w, r, "connectorID")
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_ = r.Body.Close()
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "unable to read webhook body", nil)
		return
	}
	result, err := h.svc.IngestITSMWebhook(r.Context(), tenantID, connectorID, r.Header, body)
	if errors.Is(err, ErrIntegrationDuplicateWebhook) && result != nil {
		suiteapi.WriteData(w, http.StatusAccepted, result)
		return
	}
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, result)
}

func (h *IntegrationRouter) integrationRouteIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := integrationTenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	incidentID, ok := integrationUUIDParam(w, r, "incidentID")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	connectorID, ok := integrationUUIDParam(w, r, "connectorID")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return tenantID, incidentID, connectorID, true
}

func integrationTenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func integrationUUIDParam(w http.ResponseWriter, r *http.Request, key string) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, key)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *IntegrationRouter) actor(r *http.Request) Actor {
	userID, _ := suiteapi.UserID(r)
	if userID == nil {
		return Actor{}
	}
	user := auth.UserFromContext(r.Context())
	permissions := make([]string, 0, 4)
	for _, permission := range []string{PermRespondRead, PermRespondUpdate, PermRespondAdmin, "respond:*"} {
		if user != nil && auth.HasPermission(user.Roles, permission) {
			permissions = append(permissions, permission)
		}
	}
	return Actor{UserID: *userID, GlobalPermissions: permissions}
}

func (h *IntegrationRouter) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		suiteapi.WriteError(w, r, http.StatusForbidden, "forbidden", err.Error(), nil)
	case errors.Is(err, ErrIncidentNotFound), errors.Is(err, ErrIntegrationConnectorNotFound), errors.Is(err, ErrIntegrationLinkNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrIntegrationConfig), errors.Is(err, ErrIntegrationUnsupported), errors.Is(err, ErrIntegrationWebhookAuth), errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrIntegrationSecretUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "integration_secret_unavailable", err.Error(), nil)
	case errors.Is(err, ErrIntegrationDuplicateWebhook):
		suiteapi.WriteError(w, r, http.StatusConflict, "duplicate_webhook", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("respond integration request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func integrationSecretInputs(in []integrationSecretRequest) []IntegrationSecretInput {
	out := make([]IntegrationSecretInput, 0, len(in))
	for _, secret := range in {
		out = append(out, IntegrationSecretInput{
			Name:      strings.TrimSpace(secret.Name),
			Plaintext: firstNonEmptyString(strings.TrimSpace(secret.Plaintext), strings.TrimSpace(secret.Value)),
			SecretRef: strings.TrimSpace(secret.SecretRef),
		})
	}
	return out
}

var _ integrationHTTPService = (*RespondIntegrationService)(nil)
