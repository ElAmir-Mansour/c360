package handler

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	"github.com/clario360/platform/internal/suiteapi"
)

// nafathWebhookMaxBody caps the inbound Nafath callback body to blunt abuse on
// the unauthenticated (HMAC-authenticated) public surface.
const nafathWebhookMaxBody = 1 << 20 // 1 MiB

// esignWebhookMaxBody caps the inbound e-signature provider callback body
// (DocuSign Connect / Adobe Sign / emdha). Same rationale as nafathWebhookMaxBody:
// the surface is pre-auth (HMAC-authenticated), so the body must be bounded before
// it is read for HMAC verification.
const esignWebhookMaxBody = 1 << 20 // 1 MiB

// IntegrationWebhookHandler serves the PUBLIC, pre-auth integration webhooks that
// carry NO bearer token and NO tenant context — authentication is the per-endpoint
// HMAC signature, verified inside the handler against the endpoint's DECRYPTED
// webhook secret. The tenant is taken from the path and the active endpoint is
// resolved via the FieldCrypto-wired repository (an RLS-bypass system read keyed on
// the tenant + kind). Mounted OUTSIDE the JWT/TenantGuard chain in RegisterRoutes,
// exactly like the CAP-002 email webhook. Nil-safe (no routes when Endpoints unset).
type IntegrationWebhookHandler struct {
	baseHandler
	endpoints *repository.IntegrationEndpointRepository
	// registry is an OPTIONAL seam (feature 8): on a verified inbound event the
	// handler stamps metadata.last_received_event_at via RecordInboundEvent so the
	// console can show "last event received". Nil-safe: the webhook ack never depends
	// on it. Injected via WithRegistry at wiring time.
	registry *service.IntegrationRegistryService
	// signatures is the e-signature service consumed by the esign provider webhook
	// (DocuSign / Adobe / emdha). It applies the translated provider event onto the
	// envelope; the HMAC over the raw callback body is verified INSIDE its
	// ProviderEvent path (fail-closed 403). Nil-safe: no esign routes when unset.
	signatures *service.SignatureService
}

// esignSignatureHeaders lists, per provider, the header(s) carrying the HMAC
// digest over the raw callback body. The handler picks the first present value
// and hands it to the translator, which places it on WebhookSignature so the
// shared HMAC-SHA256 verifier in SignatureService.ProviderEvent can confirm it
// against the endpoint's decrypted webhook_secret. A generic fallback set covers
// deployments that front the provider with a normalising gateway.
var esignSignatureHeaders = map[string][]string{
	"docusign": {"X-DocuSign-Signature-1", "X-Authorization-Digest", "X-DocuSign-Signature"},
	"adobe":    {"X-AdobeSign-ClientId", "X-Adobe-Signature", "X-Adobe-Sign-ClientId"},
	"emdha":    {"X-Emdha-Signature", "X-Signature", "X-Clario360-Signature"},
}

// esignSignatureFallbackHeaders are tried when no provider-specific header is
// present, covering gateways that re-emit the digest under a normalised name.
var esignSignatureFallbackHeaders = []string{"X-Clario360-Signature", "X-Signature", "X-Webhook-Signature", "X-Hub-Signature-256"}

// NewIntegrationWebhookHandler wires the FieldCrypto-enabled endpoint repository so
// the handler reads the plaintext webhook secret (the najiz_court_adapter pattern,
// never the redacting registry service).
func NewIntegrationWebhookHandler(endpoints *repository.IntegrationEndpointRepository, logger zerolog.Logger) *IntegrationWebhookHandler {
	return &IntegrationWebhookHandler{baseHandler: baseHandler{logger: logger}, endpoints: endpoints}
}

// WithRegistry injects the registry service so verified inbound events stamp
// metadata.last_received_event_at (feature 8). Nil-safe and best-effort: passing
// nil (or a stamp failure) never affects the webhook ack. Returns the receiver for
// chaining at wiring time.
func (h *IntegrationWebhookHandler) WithRegistry(registry *service.IntegrationRegistryService) *IntegrationWebhookHandler {
	h.registry = registry
	return h
}

// WithSignatureService injects the e-signature service so the esign provider
// webhook (DocuSign / Adobe / emdha) can apply translated provider events. Nil
// disables the esign routes (they are registered only when this is set). Returns
// the receiver for chaining at wiring time.
func (h *IntegrationWebhookHandler) WithSignatureService(signatures *service.SignatureService) *IntegrationWebhookHandler {
	h.signatures = signatures
	return h
}

// EsignProviderEvent handles the inbound e-signature provider callback
// (POST /webhooks/lex/esign/{provider}/{tenantID}/{id}; provider in
// docusign|adobe|emdha). It mirrors NafathVerify's pre-auth shape: (1) resolves
// the provider + tenant + lex envelope id from the path; (2) reads the RAW body
// BEFORE any decode; (3) resolves the tenant's active esign endpoint via the
// DECRYPTED repo and extracts the plaintext webhook_secret; (4) calls the
// matching provider translator (DocuSign Connect / Adobe Sign / emdha) which
// packages the raw payload + provider signature header onto a lex provider-event
// request; (5) injects the endpoint's webhook secret so SignatureService's
// ProviderEvent verifies the HMAC over the raw body FAIL-CLOSED (a bad or missing
// signature is rejected 403 inside validateSignatureProviderWebhook before any
// FSM/state change); (6) applies the event idempotently. The translators do not
// invent envelope/recipient fields and no secret is logged or echoed.
func (h *IntegrationWebhookHandler) EsignProviderEvent(w http.ResponseWriter, r *http.Request) {
	if h.signatures == nil {
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "esign webhook not enabled", nil)
		return
	}
	provider := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "provider")))
	switch provider {
	case "docusign", "adobe", "emdha":
	default:
		// Unknown provider: a pre-signature shape check that leaks nothing about
		// configured endpoints; treat as a uniform authentication failure.
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	envelopeID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	rawBody, err := readWebhookBody(r, esignWebhookMaxBody)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	endpoint, ok := h.activeEndpoint(r, tenantID, string(model.IntegrationKindEsign))
	if !ok {
		// De-oracle: no active endpoint reads as an authentication failure, never a 404.
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	secret := integration.WebhookSecretFor(*endpoint)
	if strings.TrimSpace(secret) == "" {
		// An esign endpoint with no provisioned callback HMAC secret cannot
		// authenticate any inbound callback; fail closed rather than accept an
		// unverified event. De-oracle to a uniform authentication failure.
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	signature := firstHeaderValueString(r, esignProviderSignatureHeaders(provider)...)

	var event dto.SignatureProviderEventRequest
	switch provider {
	case "docusign":
		event, err = service.TranslateDocuSignConnectCallback(rawBody, signature)
	case "adobe":
		event, err = service.TranslateAdobeSignCallback(rawBody, signature)
	case "emdha":
		timestamp := firstHeaderValueString(r, "X-Emdha-Timestamp", "X-Webhook-Timestamp", "X-Timestamp", "X-Signature-Timestamp")
		event, err = service.TranslateEmdhaCallback(rawBody, signature, timestamp)
	}
	if err != nil {
		// Translation failures are payload-shape problems (bad JSON / missing
		// status); they carry no entity-existence signal. Surface as a validation
		// error — the HMAC check below would still reject an unauthenticated body.
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid webhook payload", nil)
		return
	}
	// Inject the endpoint's plaintext webhook secret so SignatureService's
	// ProviderEvent verifies the HMAC FAIL-CLOSED. The translators always set
	// WebhookPayload (the raw body), so validateSignatureProviderWebhook treats the
	// request as validation-requested and rejects a missing/bad signature (403).
	event.WebhookSecret = &secret
	// Ensure the raw body is the HMAC payload (defensive; translators set it too).
	event.RawPayload = rawBody

	ipAddress := requestIP(r)
	userAgent := optionalTrimmed(r.UserAgent())
	// userID is uuid.Nil: this is a system-actored, pre-auth callback (no bearer);
	// the actor identity rides the translated event's actor name/email, mirroring
	// the existing provider-event recording for external providers.
	item, err := h.signatures.ProviderEvent(r.Context(), tenantID, uuid.Nil, envelopeID, event, ipAddress, userAgent)
	if err != nil {
		// Maps the apperrors.AppError statuses verbatim: forbiddenError (bad/missing
		// HMAC signature, or wrong provider-secret) -> 403; not-found envelope -> 404;
		// validation -> 400. No gov success is faked: a verification failure is a 403.
		h.writeError(w, r, err)
		return
	}
	// Feature 8 + observability: the HMAC verified and the event applied; stamp
	// metadata.last_received_event_at + write a REDACTED inbound-event row on the
	// resolved endpoint. Best-effort, nil-safe; never blocks the ack.
	if h.registry != nil {
		payload := map[string]any{
			"provider_adapter":     provider,
			"provider_status":      event.ProviderStatus,
			"provider_envelope_id": optionalStringValue(event.ProviderEnvelopeID),
			"envelope_id":          envelopeID.String(),
			"envelope_status":      string(item.Status),
		}
		action := "signature_provider_event:" + event.ProviderStatus
		if rerr := h.registry.RecordInboundEventDetailed(r.Context(), tenantID, endpoint.ID,
			string(model.IntegrationKindEsign), payload, true, "processed", action); rerr != nil {
			h.logger.Warn().Err(rerr).Str("endpoint_id", endpoint.ID.String()).Msg("record esign integration inbound event")
			h.registry.RecordWebhookFailure(r.Context(), tenantID, endpoint.ID, payload, rerr)
		}
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// esignProviderSignatureHeaders returns the candidate HMAC-signature headers for
// a provider, ordered provider-specific first then the generic gateway fallbacks.
func esignProviderSignatureHeaders(provider string) []string {
	headers := append([]string{}, esignSignatureHeaders[provider]...)
	return append(headers, esignSignatureFallbackHeaders...)
}

// optionalStringValue returns the trimmed dereferenced string, or "" for nil.
func optionalStringValue(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

// NafathVerify handles the inbound Nafath NafathVerificationCompleted callback
// (POST /webhooks/lex/nafath/verify/{tenantID}). It (1) reads the RAW body before
// any decode; (2) resolves the tenant's active nafath_verify endpoint via the
// DECRYPTED repo; (3) extracts the plaintext webhook secret; (4) verifies the HMAC
// over the raw body; (5) on a bad signature returns a uniform 401 (de-oracle — an
// unverified caller cannot distinguish "no endpoint" from "bad signature"), else
// 200 with the normalised event. The verified event (Status verified/declined/...)
// is the seam the esign/DoA flow consumes to stamp identity_confirmed; that
// downstream stamping is owned by the consuming flow, so this handler acknowledges
// receipt and surfaces the normalised status for it.
func (h *IntegrationWebhookHandler) NafathVerify(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.UUIDParam(r, "tenantID")
	if err != nil {
		// A malformed tenant in the path leaks nothing and is a pre-signature shape
		// check; treat as a uniform authentication failure (no entity-existence signal).
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	rawBody, err := readWebhookBody(r, nafathWebhookMaxBody)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	endpoint, ok := h.activeEndpoint(r, tenantID, "nafath_verify")
	if !ok {
		// De-oracle: no active endpoint reads as an authentication failure, never a 404.
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		return
	}
	secret := integration.WebhookSecretFor(*endpoint)
	signature := firstHeaderValueString(r, "X-Clario360-Signature", "X-Signature", "X-Hub-Signature-256")
	minLoA := integration.MinimumLoAFor(*endpoint)
	event, err := integration.VerifyNafathWebhook(secret, rawBody, signature, minLoA, time.Now())
	if err != nil {
		if errors.Is(err, integration.ErrNafathWebhookSignature) {
			suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
			return
		}
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid webhook payload", nil)
		return
	}
	// Feature 8 + observability #17: the HMAC is verified, so stamp
	// metadata.last_received_event_at AND write a REDACTED inbound-event row (event
	// inspector + replay) on the resolved endpoint. Nil-safe and never blocks the ack;
	// a failure is logged only. The webhook is pre-auth (no tenant DB session), so this
	// runs under the endpoint's tenant resolved from the path. The event payload is
	// non-secret here, but RecordInboundEventDetailed redacts it on write defensively.
	if h.registry != nil {
		payload := map[string]any{
			"trans_id":          event.TransID,
			"status":            string(event.Status),
			"raw_status":        event.RawStatus,
			"loa":               string(event.LoA),
			"minimum_loa":       string(event.MinimumLoA),
			"loa_satisfied":     event.LoASatisfied,
			"valid_esign_basis": event.ValidEsignBasis,
		}
		// The resulting lex action the event drives (identity confirmation gating).
		action := "identity_status:" + string(event.Status)
		if err := h.registry.RecordInboundEventDetailed(r.Context(), tenantID, endpoint.ID,
			"nafath_verify", payload, true, "processed", action); err != nil {
			h.logger.Warn().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("record integration inbound event")
			// Reliability #11: the signature verified (the caller is authentic) but
			// handling the inbound event failed; dead-letter it (source=webhook) so the
			// operator can replay it. The normalised, secret-free event rides the payload
			// (the DLQ service redacts defensively). Best-effort — never blocks the ack.
			h.registry.RecordWebhookFailure(r.Context(), tenantID, endpoint.ID, payload, err)
		}
	}
	// The HMAC is verified; surface the normalised, secret-free event. The esign/DoA
	// flow consumes Status to gate identity_confirmed vs signed.
	suiteapi.WriteData(w, http.StatusOK, event)
}

// activeEndpoint resolves the first active endpoint of the given kind for the
// tenant via the DECRYPTED repo. Returns false when none is configured.
func (h *IntegrationWebhookHandler) activeEndpoint(r *http.Request, tenantID uuid.UUID, kind string) (*model.IntegrationEndpoint, bool) {
	if h.endpoints == nil {
		return nil, false
	}
	items, err := h.endpoints.List(r.Context(), tenantID, kind, "active")
	if err != nil || len(items) == 0 {
		return nil, false
	}
	return &items[0], true
}

// readWebhookBody reads the EXACT raw request body up to max bytes, rejecting an
// oversized body. The raw bytes are required for HMAC verification before any decode.
func readWebhookBody(r *http.Request, max int64) ([]byte, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, errors.New("request body too large")
	}
	return raw, nil
}

// SCIMTokenHandler issues + lists the per-tenant/per-endpoint inbound SCIM bearer
// tokens that authenticate the SCIM 2.0 server (mounted at /scim/v2). Issuing is
// gated lex:integration:manage; the raw token is shown EXACTLY ONCE. Nil-safe.
type SCIMTokenHandler struct {
	baseHandler
	scim  *integration.SCIMServer
	idMap *repository.HRIdentityMapRepository
	db    repository.Queryer
}

// NewSCIMTokenHandler wires the SCIM server (token mint/hash) + the HR identity-map
// repo (token list) over the shared pool.
func NewSCIMTokenHandler(scim *integration.SCIMServer, idMap *repository.HRIdentityMapRepository, db repository.Queryer, logger zerolog.Logger) *SCIMTokenHandler {
	return &SCIMTokenHandler{baseHandler: baseHandler{logger: logger}, scim: scim, idMap: idMap, db: db}
}

// Issue mints (or rotates) a SCIM bearer for an endpoint
// (POST /integrations/{id}/scim-token). Body: {label, rotate, expires_at?}. The
// RawToken in the response is the ONLY exposure of the cleartext bearer.
func (h *SCIMTokenHandler) Issue(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	endpointID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req struct {
		Label     string     `json:"label"`
		Rotate    bool       `json:"rotate"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	issued, err := h.scim.IssueSCIMToken(r.Context(), h.db, tenantID, endpointID, &userID, req.Label, req.Rotate, req.ExpiresAt)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, issued)
}

// List returns the non-secret SCIM-token rows (prefix/label/last_used/revoked) for
// an endpoint (GET /integrations/{id}/scim-tokens). Raw tokens are never returned.
func (h *SCIMTokenHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	endpointID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tokens, err := h.idMap.ListTokens(r.Context(), h.db, tenantID, endpointID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tokens)
}
