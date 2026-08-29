package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// NajizSignatureProviderDispatcher integrates lex e-signature with Najiz, the
// Saudi Ministry of Justice (MOJ) e-sign portal named in FR-WATHEEQ-004. It is a
// configurable-endpoint HTTP adapter that maps the lex signature envelope onto a
// Najiz "signing request" and maps the Najiz acknowledgement back onto the lex
// provider-dispatch proof (provider envelope id, per-recipient signatory ids,
// delivery status, evidence hash). It plugs into the existing
// SignatureProviderDispatcher seam exactly like the generic HTTP dispatcher; the
// deterministic default remains unchanged when Najiz is not configured.
//
// PRODUCTION NOTE: live operation requires real MOJ-issued Najiz credentials
// (client id/secret + signed-callback HMAC secret) provisioned per deployment
// region. The endpoints and field mapping below follow the Najiz signing-request
// contract; the credentials and the production base URL are supplied via the
// LEX_NAJIZ_* configuration and are NOT bundled with the binary.
type NajizSignatureProviderDispatcher struct {
	endpoint     string
	clientID     string
	clientSecret string
	callbackURL  string
	client       *http.Client
}

// NajizSignatureProviderDispatcherConfig configures the Najiz adapter. Endpoint
// is the absolute Najiz signing-request URL; ClientID/ClientSecret are the
// MOJ-issued portal credentials; CallbackURL (optional) is the lex provider-event
// webhook Najiz should call back. All of these come from env-gated config and are
// validated by the lex config loader before this is constructed.
type NajizSignatureProviderDispatcherConfig struct {
	Endpoint     string
	ClientID     string
	ClientSecret string
	CallbackURL  string
	Timeout      time.Duration
	Client       *http.Client
}

const najizSignatureAdapter = "najiz"

// NewNajizSignatureProviderDispatcher builds the Najiz adapter. It fails closed
// when the MOJ credentials are absent so a misconfigured deployment never
// silently falls back to a different transport.
func NewNajizSignatureProviderDispatcher(cfg NajizSignatureProviderDispatcherConfig) (*NajizSignatureProviderDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("najiz signing endpoint is required", map[string]string{"endpoint": "required"})
	}
	clientID := strings.TrimSpace(cfg.ClientID)
	if clientID == "" {
		return nil, validationError("najiz client id is required", map[string]string{"client_id": "required"})
	}
	clientSecret := strings.TrimSpace(cfg.ClientSecret)
	if clientSecret == "" {
		return nil, validationError("najiz client secret is required", map[string]string{"client_secret": "required"})
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copy := *client
		copy.Timeout = timeout
		client = &copy
	}
	return &NajizSignatureProviderDispatcher{
		endpoint:     endpoint,
		clientID:     clientID,
		clientSecret: clientSecret,
		callbackURL:  strings.TrimSpace(cfg.CallbackURL),
		client:       client,
	}, nil
}

// DispatchSignatureEnvelope maps the lex envelope onto a Najiz signing request,
// posts it to the configured MOJ endpoint, and translates the Najiz
// acknowledgement back into a SignatureProviderDispatch the signature service
// persists as outbound proof. It enforces that the envelope is a Najiz envelope
// (or unset, in which case Najiz is assumed) so a mis-routed envelope is rejected
// rather than silently sent to the wrong portal.
func (d *NajizSignatureProviderDispatcher) DispatchSignatureEnvelope(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	if envelope == nil {
		return nil, validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	if envelope.Provider != "" && envelope.Provider != model.SignatureProviderNajiz {
		return nil, validationError("najiz dispatcher requires a najiz signature envelope", map[string]string{"provider": "must be najiz"})
	}
	payload := najizSigningRequest{
		ClientID:    d.clientID,
		TenantID:    envelope.TenantID.String(),
		RequestRef:  envelope.ID.String(),
		TargetType:  string(envelope.TargetType),
		ContractID:  uuidPtrString(envelope.ContractID),
		DocumentID:  uuidPtrString(envelope.DocumentID),
		Title:       envelope.Title,
		Subject:     najizFirstNonEmpty(envelope.Subject, envelope.Title),
		Message:     najizSendMessage(envelope, req),
		Language:    najizLanguageCode(envelope.Language),
		CallbackURL: d.callbackURL,
		DueAt:       envelope.DueAt,
		ExpiresAt:   envelope.ExpiresAt,
		RequestedAt: now.UTC(),
		Signatories: make([]najizSignatory, 0, len(envelope.Recipients)),
	}
	for _, recipient := range envelope.Recipients {
		payload.Signatories = append(payload.Signatories, najizSignatory{
			SignatoryRef: recipient.ID.String(),
			FullName:     recipient.Name,
			Email:        recipient.Email,
			MobileNumber: recipient.Phone,
			Role:         najizRole(recipient.Role),
			SignMethod:   najizMethod(recipient.Method),
			SignOrder:    recipient.SigningOrder,
		})
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal najiz signing request", err)
	}
	// request_ref (the lex envelope id) is the Najiz-side idempotency correlator,
	// so a retried POST after a transient MOJ-side fault re-references the same
	// signing request rather than creating a duplicate.
	newReq := func(reqCtx context.Context) (*http.Request, error) {
		httpReq, reqErr := http.NewRequestWithContext(reqCtx, http.MethodPost, d.endpoint, bytes.NewReader(body))
		if reqErr != nil {
			return nil, validationError("najiz signing endpoint is invalid", map[string]string{"endpoint": "invalid"})
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")
		// Najiz authenticates portal callers with the MOJ-issued client id/secret.
		httpReq.Header.Set("X-Najiz-Client-Id", d.clientID)
		httpReq.Header.Set("X-Najiz-Client-Secret", d.clientSecret)
		httpReq.Header.Set("X-Clario360-Tenant-ID", envelope.TenantID.String())
		httpReq.Header.Set("X-Clario360-Signature-Provider", string(model.SignatureProviderNajiz))
		httpReq.Header.Set("X-Idempotency-Key", envelope.ID.String())
		return httpReq, nil
	}

	respBody, status, err := doSignatureDispatchWithRetry(ctx, signatureDispatchMaxAttempts, newReq, d.client)
	if err != nil {
		return nil, internalError("dispatch signature envelope to najiz", err)
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, internalError("najiz rejected signing request", fmt.Errorf("status %d: %s", status, strings.TrimSpace(string(respBody))))
	}
	var najizResp najizSigningResponse
	if err := json.Unmarshal(respBody, &najizResp); err != nil {
		return nil, internalError("decode najiz signing response", err)
	}

	providerEnvelopeID := strings.TrimSpace(najizResp.RequestID)
	if providerEnvelopeID == "" {
		return nil, internalError("najiz signing response missing request id", fmt.Errorf("najiz returned empty request_id"))
	}

	dispatch := &SignatureProviderDispatch{
		Provider:             model.SignatureProviderNajiz,
		Adapter:              najizSignatureAdapter,
		ProviderStatus:       najizFirstNonEmpty(najizResp.Status, "sent"),
		DeliveryStatus:       najizFirstNonEmpty(najizResp.DeliveryStatus, "accepted"),
		ProviderEnvelopeID:   providerEnvelopeID,
		ProviderRecipientIDs: map[uuid.UUID]string{},
		EvidenceMetadata: mergeMetadata(najizResp.Metadata, map[string]any{
			"provider_adapter":       najizSignatureAdapter,
			"provider_portal":        "najiz_moj",
			"provider_endpoint":      d.endpoint,
			"provider_dispatched_at": now.UTC().Format(time.RFC3339Nano),
		}),
	}
	if eventID := strings.TrimSpace(najizResp.EventID); eventID != "" {
		dispatch.ProviderEventID = &eventID
	}
	if hash := strings.TrimSpace(najizResp.EvidenceHash); hash != "" {
		dispatch.EvidenceHash = &hash
	}
	for _, signatory := range najizResp.Signatories {
		recipientID, err := uuid.Parse(strings.TrimSpace(signatory.SignatoryRef))
		if err != nil {
			return nil, validationError("najiz returned invalid signatory reference", map[string]string{"signatory_ref": "invalid"})
		}
		najizSignatoryID := strings.TrimSpace(signatory.NajizSignatoryID)
		if najizSignatoryID == "" {
			return nil, validationError("najiz returned empty signatory id", map[string]string{"najiz_signatory_id": "required"})
		}
		dispatch.ProviderRecipientIDs[recipientID] = najizSignatoryID
	}
	return dispatch, nil
}

// TranslateNajizCallback maps an inbound Najiz signed-callback payload onto the
// lex SignatureProviderEventRequest consumed by SignatureService.ProviderEvent.
// The raw callback bytes and the transport HMAC headers are carried straight
// through to the envelope's webhook validation (validateSignatureProviderWebhook),
// so the existing HMAC-SHA256 verification guards every Najiz callback before any
// recipient/provider/custody state changes. Only fields that exist on the lex
// provider-event model are populated; no envelope/event field is invented.
func TranslateNajizCallback(raw []byte, signature, timestamp string) (dto.SignatureProviderEventRequest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return dto.SignatureProviderEventRequest{}, validationError("najiz callback payload is required", map[string]string{"payload": "required"})
	}
	var callback najizCallback
	if err := json.Unmarshal(raw, &callback); err != nil {
		return dto.SignatureProviderEventRequest{}, validationError("najiz callback payload is invalid", map[string]string{"payload": "invalid"})
	}

	status := strings.TrimSpace(callback.Status)
	if status == "" {
		return dto.SignatureProviderEventRequest{}, validationError("najiz callback status is required", map[string]string{"status": "required"})
	}

	payloadString := string(raw)
	event := dto.SignatureProviderEventRequest{
		Provider:         model.SignatureProviderNajiz,
		ProviderStatus:   status,
		EvidenceMetadata: mergeMetadata(callback.Metadata),
		WebhookPayload:   &payloadString,
		RawPayload:       raw,
	}
	event.EvidenceMetadata["provider_adapter"] = najizSignatureAdapter
	event.EvidenceMetadata["provider_portal"] = "najiz_moj"

	if requestID := strings.TrimSpace(callback.RequestID); requestID != "" {
		event.ProviderEnvelopeID = &requestID
	}
	if eventID := strings.TrimSpace(callback.EventID); eventID != "" {
		event.ProviderEventID = &eventID
	}
	if signatoryID := strings.TrimSpace(callback.NajizSignatoryID); signatoryID != "" {
		event.ProviderRecipientID = &signatoryID
	}
	if ref := strings.TrimSpace(callback.SignatoryRef); ref != "" {
		if recipientID, err := uuid.Parse(ref); err == nil {
			event.RecipientID = &recipientID
		}
	}
	if name := strings.TrimSpace(callback.SignatoryName); name != "" {
		event.ActorName = &name
	}
	if email := strings.TrimSpace(callback.SignatoryEmail); email != "" {
		event.ActorEmail = &email
	}
	if hash := strings.TrimSpace(callback.EvidenceHash); hash != "" {
		event.EvidenceHash = &hash
	}
	if reason := strings.TrimSpace(callback.Reason); reason != "" {
		event.Reason = &reason
		event.DeclineReason = &reason
	}
	if occurred := najizCallbackTime(callback.OccurredAt); occurred != nil {
		event.OccurredAt = occurred
	}
	if sig := strings.TrimSpace(signature); sig != "" {
		event.WebhookSignature = &sig
	}
	if ts := strings.TrimSpace(timestamp); ts != "" {
		event.WebhookTimestamp = &ts
	}
	return event, nil
}

// najizSigningRequest is the lex→Najiz signing-request body. Every field maps to
// an existing envelope/recipient attribute; no synthetic fields are added.
type najizSigningRequest struct {
	ClientID    string           `json:"client_id"`
	TenantID    string           `json:"tenant_id"`
	RequestRef  string           `json:"request_ref"`
	TargetType  string           `json:"target_type"`
	ContractID  *string          `json:"contract_id,omitempty"`
	DocumentID  *string          `json:"document_id,omitempty"`
	Title       string           `json:"title"`
	Subject     string           `json:"subject"`
	Message     string           `json:"message"`
	Language    string           `json:"language"`
	CallbackURL string           `json:"callback_url,omitempty"`
	DueAt       *time.Time       `json:"due_at,omitempty"`
	ExpiresAt   *time.Time       `json:"expires_at,omitempty"`
	RequestedAt time.Time        `json:"requested_at"`
	Signatories []najizSignatory `json:"signatories"`
}

type najizSignatory struct {
	SignatoryRef string  `json:"signatory_ref"`
	FullName     string  `json:"full_name"`
	Email        *string `json:"email,omitempty"`
	MobileNumber *string `json:"mobile_number,omitempty"`
	Role         string  `json:"role"`
	SignMethod   string  `json:"sign_method"`
	SignOrder    int     `json:"sign_order"`
}

// najizSigningResponse is the Najiz acknowledgement of a signing request. request_id
// is the Najiz-side envelope identifier persisted as the lex provider_envelope_id.
type najizSigningResponse struct {
	RequestID      string              `json:"request_id"`
	Status         string              `json:"status"`
	DeliveryStatus string              `json:"delivery_status"`
	EventID        string              `json:"event_id"`
	EvidenceHash   string              `json:"evidence_hash"`
	Metadata       map[string]any      `json:"metadata"`
	Signatories    []najizSignatoryAck `json:"signatories"`
}

type najizSignatoryAck struct {
	SignatoryRef     string `json:"signatory_ref"`
	NajizSignatoryID string `json:"najiz_signatory_id"`
}

// najizCallback is the inbound Najiz status notification (webhook) payload.
type najizCallback struct {
	RequestID        string         `json:"request_id"`
	EventID          string         `json:"event_id"`
	Status           string         `json:"status"`
	NajizSignatoryID string         `json:"najiz_signatory_id"`
	SignatoryRef     string         `json:"signatory_ref"`
	SignatoryName    string         `json:"signatory_name"`
	SignatoryEmail   string         `json:"signatory_email"`
	EvidenceHash     string         `json:"evidence_hash"`
	Reason           string         `json:"reason"`
	OccurredAt       string         `json:"occurred_at"`
	Metadata         map[string]any `json:"metadata"`
}

func najizSendMessage(envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest) string {
	if req.Message != nil {
		if trimmed := strings.TrimSpace(*req.Message); trimmed != "" {
			return trimmed
		}
	}
	return envelope.Message
}

func najizLanguageCode(language model.SignatureLanguage) string {
	switch language {
	case model.SignatureLanguageAR:
		return "ar"
	case model.SignatureLanguageBilingual:
		return "ar-en"
	case model.SignatureLanguageEN:
		return "en"
	default:
		return "ar"
	}
}

func najizRole(role model.SignatureRecipientRole) string {
	switch role {
	case model.SignatureRecipientApprover:
		return "approver"
	case model.SignatureRecipientCarbonCopy:
		return "viewer"
	default:
		return "signer"
	}
}

func najizMethod(method model.SignatureMethod) string {
	switch method {
	case model.SignatureMethodNafath:
		return "nafath"
	case model.SignatureMethodCertificate:
		return "certificate"
	case model.SignatureMethodWetSignature:
		return "wet_signature"
	default:
		return "otp"
	}
}

func najizFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func najizCallbackTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			normalized := parsed.UTC()
			return &normalized
		}
	}
	return nil
}
