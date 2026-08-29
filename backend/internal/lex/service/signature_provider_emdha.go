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

// =============================================================================
// emdha-TSP e-signature provider (Saudi E-Transactions Law).
//
// emdha (https://www.emdha.sa) is a Trust Service Provider (TSP) licensed by the
// Saudi National Digital Certification Center (NCDC). Unlike Nafath — which is an
// IDENTITY confirmation service and is NOT a certificate authority — emdha issues
// a qualified/advanced electronic signature backed by a PKI certificate. In the
// lex model the two are kept STRICTLY DISTINCT:
//
//   - Nafath  -> identity_confirmed   (a person proved who they are)
//   - emdha   -> signed (TSP)         (a qualified electronic signature was made)
//
// A legally-binding Saudi e-signature workflow typically pairs BOTH: Nafath
// confirms the signer's identity, then emdha applies the qualified signature.
// This dispatcher owns ONLY the TSP signing leg; it never collapses identity into
// signature. Every event it produces is method=certificate and carries
// evidence_metadata.signature_kind="qualified_tsp" so downstream consumers can
// tell a TSP signature apart from a Nafath identity confirmation or a basic OTP
// signature.
//
// HONESTY (gov-gated): emdha onboarding requires an NCDC/emdha-issued integrator
// credential (client id/secret) + a signed-callback HMAC secret provisioned per
// deployment. This adapter is CODE-COMPLETE, hardened (timeouts, bounded retry,
// fail-closed config, HMAC-verified callbacks via the shared validator) and
// CONFIG-READY, but it is NOT wired to a live emdha tenant in this build. A
// dedicated sandbox/UAT transport (SandboxDispatch) lets demos and tests exercise
// the full happy path WITHOUT fabricating live TSP success. The integration
// connector grades an emdha endpoint not_configured/planned until real creds
// land — see esign_connector.go isGovGated().
//
// Live flip-to-go requires (reported, NOT done here):
//   - emdha/NCDC integrator credential (EMDHA_CLIENT_ID / EMDHA_CLIENT_SECRET)
//   - emdha signing-API base URL for the deployment region (in-Kingdom)
//   - emdha signed-callback HMAC secret (EMDHA_WEBHOOK_SECRET)
//   - a registered callback URL on the emdha tenant pointing at
//     /webhooks/lex/esign/emdha/{tenantID}/{id}
// =============================================================================

const emdhaSignatureAdapter = "emdha"

// EmdhaSignatureProviderDispatcher signs a lex envelope through the emdha TSP.
// When SandboxDispatch is true it produces a deterministic, locally-computed
// signing acknowledgement (no network call) for UAT/demo/tests — explicitly
// flagged in evidence so it can never be mistaken for a live TSP signature.
type EmdhaSignatureProviderDispatcher struct {
	endpoint     string
	clientID     string
	clientSecret string
	callbackURL  string
	sandbox      bool
	client       *http.Client
	now          func() time.Time
}

// EmdhaSignatureProviderDispatcherConfig configures the emdha adapter. In sandbox
// mode only Endpoint is required (it labels the mock); in live mode the NCDC/emdha
// integrator credentials are mandatory and the constructor fails closed without
// them, so a misconfigured deployment never silently degrades to an unsigned send.
type EmdhaSignatureProviderDispatcherConfig struct {
	Endpoint        string
	ClientID        string
	ClientSecret    string
	CallbackURL     string
	SandboxDispatch bool
	Timeout         time.Duration
	Client          *http.Client
	Now             func() time.Time
}

// NewEmdhaSignatureProviderDispatcher builds the emdha adapter. In LIVE mode it
// requires endpoint + client id/secret (fail-closed). In SANDBOX mode it requires
// only a non-empty endpoint label and performs no network I/O.
func NewEmdhaSignatureProviderDispatcher(cfg EmdhaSignatureProviderDispatcherConfig) (*EmdhaSignatureProviderDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("emdha signing endpoint is required", map[string]string{"endpoint": "required"})
	}
	if !cfg.SandboxDispatch {
		if strings.TrimSpace(cfg.ClientID) == "" {
			return nil, validationError("emdha client id is required for live dispatch", map[string]string{"client_id": "required"})
		}
		if strings.TrimSpace(cfg.ClientSecret) == "" {
			return nil, validationError("emdha client secret is required for live dispatch", map[string]string{"client_secret": "required"})
		}
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	nowFn := cfg.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	return &EmdhaSignatureProviderDispatcher{
		endpoint:     endpoint,
		clientID:     strings.TrimSpace(cfg.ClientID),
		clientSecret: strings.TrimSpace(cfg.ClientSecret),
		callbackURL:  strings.TrimSpace(cfg.CallbackURL),
		sandbox:      cfg.SandboxDispatch,
		client:       client,
		now:          nowFn,
	}, nil
}

// DispatchSignatureEnvelope maps the lex envelope onto an emdha TSP signing
// request. emdha envelopes map onto the EXTERNAL signature provider (a TSP
// signature, distinct from the nafath IDENTITY provider): the dispatcher rejects
// an envelope explicitly routed to a different provider so a mis-routed envelope
// fails fast rather than being signed by the wrong rail.
func (d *EmdhaSignatureProviderDispatcher) DispatchSignatureEnvelope(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	if envelope == nil {
		return nil, validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	switch envelope.Provider {
	case "", model.SignatureProviderExternal:
	default:
		return nil, validationError("emdha dispatcher requires an external (TSP) signature envelope", map[string]string{"provider": "must be external"})
	}

	if d.sandbox {
		return d.dispatchSandbox(envelope, now), nil
	}
	return d.dispatchLive(ctx, envelope, req, now)
}

// dispatchSandbox produces a deterministic UAT acknowledgement WITHOUT any
// network call. It is explicitly flagged sandbox/non-live so it can never be
// mistaken for a live qualified TSP signature.
func (d *EmdhaSignatureProviderDispatcher) dispatchSandbox(envelope *model.SignatureEnvelope, now time.Time) *SignatureProviderDispatch {
	providerEnvelopeID := "emdha-sbx-" + envelope.ID.String()
	eventID := providerEnvelopeID + ".dispatched"
	hash := deterministicSignatureDispatchHash(envelope, providerEnvelopeID, nil)
	recipientIDs := make(map[uuid.UUID]string, len(envelope.Recipients))
	for _, recipient := range envelope.Recipients {
		recipientIDs[recipient.ID] = "emdha-sbx-sig-" + recipient.ID.String()
	}
	return &SignatureProviderDispatch{
		Provider:             model.SignatureProviderExternal,
		Adapter:              emdhaSignatureAdapter,
		ProviderStatus:       "sent",
		DeliveryStatus:       "accepted",
		ProviderEventID:      &eventID,
		ProviderEnvelopeID:   providerEnvelopeID,
		ProviderRecipientIDs: recipientIDs,
		EvidenceHash:         &hash,
		EvidenceMetadata: map[string]any{
			"provider_adapter": emdhaSignatureAdapter,
			"provider_portal":  "emdha_tsp",
			"signature_kind":   "qualified_tsp",
			"signature_basis":  "saudi_e_transactions_law",
			"dispatch_mode":    "sandbox_mock",
			"live":             false,
			"note":             "emdha sandbox/UAT acknowledgement — NOT a live qualified TSP signature; awaiting NCDC/emdha onboarding",
			"dispatched_at":    now.UTC().Format(time.RFC3339Nano),
		},
	}
}

func (d *EmdhaSignatureProviderDispatcher) dispatchLive(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	payload := emdhaSigningRequest{
		ClientID:    d.clientID,
		TenantID:    envelope.TenantID.String(),
		RequestRef:  envelope.ID.String(),
		TargetType:  string(envelope.TargetType),
		ContractID:  uuidPtrString(envelope.ContractID),
		DocumentID:  uuidPtrString(envelope.DocumentID),
		Title:       envelope.Title,
		Subject:     firstNonEmptyString(envelope.Subject, envelope.Title),
		Message:     emdhaSendMessage(envelope, req),
		Language:    najizLanguageCode(envelope.Language),
		CallbackURL: d.callbackURL,
		// emdha applies a qualified electronic signature (E-Transactions Law).
		SignatureLevel: "qualified",
		DueAt:          envelope.DueAt,
		ExpiresAt:      envelope.ExpiresAt,
		RequestedAt:    now.UTC(),
		Signatories:    make([]emdhaSignatory, 0, len(envelope.Recipients)),
	}
	for _, recipient := range envelope.Recipients {
		payload.Signatories = append(payload.Signatories, emdhaSignatory{
			SignatoryRef: recipient.ID.String(),
			FullName:     recipient.Name,
			Email:        recipient.Email,
			MobileNumber: recipient.Phone,
			SignOrder:    recipient.SigningOrder,
		})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal emdha signing request", err)
	}
	newReq := func(reqCtx context.Context) (*http.Request, error) {
		httpReq, reqErr := http.NewRequestWithContext(reqCtx, http.MethodPost, d.endpoint, bytes.NewReader(body))
		if reqErr != nil {
			return nil, validationError("emdha signing endpoint is invalid", map[string]string{"endpoint": "invalid"})
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")
		httpReq.Header.Set("X-Emdha-Client-Id", d.clientID)
		httpReq.Header.Set("X-Emdha-Client-Secret", d.clientSecret)
		httpReq.Header.Set("X-Clario360-Tenant-ID", envelope.TenantID.String())
		httpReq.Header.Set("X-Clario360-Signature-Provider", string(model.SignatureProviderExternal))
		httpReq.Header.Set("X-Idempotency-Key", envelope.ID.String())
		return httpReq, nil
	}
	respBody, status, err := doSignatureDispatchWithRetry(ctx, signatureDispatchMaxAttempts, newReq, d.client)
	if err != nil {
		return nil, internalError("dispatch signature envelope to emdha", err)
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, internalError("emdha rejected signing request", fmt.Errorf("status %d: %s", status, strings.TrimSpace(string(respBody))))
	}
	var emdhaResp emdhaSigningResponse
	if err := json.Unmarshal(respBody, &emdhaResp); err != nil {
		return nil, internalError("decode emdha signing response", err)
	}
	providerEnvelopeID := strings.TrimSpace(emdhaResp.RequestID)
	if providerEnvelopeID == "" {
		return nil, internalError("emdha signing response missing request id", fmt.Errorf("emdha returned empty request_id"))
	}
	dispatch := &SignatureProviderDispatch{
		Provider:             model.SignatureProviderExternal,
		Adapter:              emdhaSignatureAdapter,
		ProviderStatus:       firstNonEmptyString(emdhaResp.Status, "sent"),
		DeliveryStatus:       firstNonEmptyString(emdhaResp.DeliveryStatus, "accepted"),
		ProviderEnvelopeID:   providerEnvelopeID,
		ProviderRecipientIDs: map[uuid.UUID]string{},
		EvidenceMetadata: mergeMetadata(emdhaResp.Metadata, map[string]any{
			"provider_adapter":  emdhaSignatureAdapter,
			"provider_portal":   "emdha_tsp",
			"signature_kind":    "qualified_tsp",
			"signature_basis":   "saudi_e_transactions_law",
			"dispatch_mode":     "live",
			"live":              true,
			"provider_endpoint": d.endpoint,
			"dispatched_at":     now.UTC().Format(time.RFC3339Nano),
		}),
	}
	if eventID := strings.TrimSpace(emdhaResp.EventID); eventID != "" {
		dispatch.ProviderEventID = &eventID
	}
	if hash := strings.TrimSpace(emdhaResp.EvidenceHash); hash != "" {
		dispatch.EvidenceHash = &hash
	}
	for _, sig := range emdhaResp.Signatories {
		recipientID, perr := uuid.Parse(strings.TrimSpace(sig.SignatoryRef))
		if perr != nil {
			return nil, validationError("emdha returned invalid signatory reference", map[string]string{"signatory_ref": "invalid"})
		}
		emdhaSigID := strings.TrimSpace(sig.EmdhaSignatoryID)
		if emdhaSigID == "" {
			return nil, validationError("emdha returned empty signatory id", map[string]string{"emdha_signatory_id": "required"})
		}
		dispatch.ProviderRecipientIDs[recipientID] = emdhaSigID
	}
	return dispatch, nil
}

// TranslateEmdhaCallback maps an inbound emdha signed-callback payload onto the
// lex SignatureProviderEventRequest consumed by SignatureService.ProviderEvent.
// The raw bytes + HMAC headers flow through to validateSignatureProviderWebhook
// so the shared HMAC-SHA256 verifier guards every callback before any state
// change. The event is annotated as a qualified TSP signature so it stays
// distinct from a nafath identity confirmation.
func TranslateEmdhaCallback(raw []byte, signature, timestamp string) (dto.SignatureProviderEventRequest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return dto.SignatureProviderEventRequest{}, validationError("emdha callback payload is required", map[string]string{"payload": "required"})
	}
	var cb emdhaCallback
	if err := json.Unmarshal(raw, &cb); err != nil {
		return dto.SignatureProviderEventRequest{}, validationError("emdha callback payload is invalid", map[string]string{"payload": "invalid"})
	}
	status := strings.TrimSpace(cb.Status)
	if status == "" {
		return dto.SignatureProviderEventRequest{}, validationError("emdha callback status is required", map[string]string{"status": "required"})
	}
	payloadString := string(raw)
	event := dto.SignatureProviderEventRequest{
		Provider:       model.SignatureProviderExternal,
		ProviderStatus: status,
		EvidenceMetadata: mergeMetadata(cb.Metadata, map[string]any{
			"provider_adapter": emdhaSignatureAdapter,
			"provider_portal":  "emdha_tsp",
			"signature_kind":   "qualified_tsp",
			"signature_basis":  "saudi_e_transactions_law",
		}),
		WebhookPayload: &payloadString,
		RawPayload:     raw,
	}
	if requestID := strings.TrimSpace(cb.RequestID); requestID != "" {
		event.ProviderEnvelopeID = &requestID
	}
	if eventID := strings.TrimSpace(cb.EventID); eventID != "" {
		event.ProviderEventID = &eventID
	}
	if sigID := strings.TrimSpace(cb.EmdhaSignatoryID); sigID != "" {
		event.ProviderRecipientID = &sigID
	}
	if ref := strings.TrimSpace(cb.SignatoryRef); ref != "" {
		if recipientID, err := uuid.Parse(ref); err == nil {
			event.RecipientID = &recipientID
		}
	}
	if name := strings.TrimSpace(cb.SignatoryName); name != "" {
		event.ActorName = &name
	}
	if email := strings.TrimSpace(cb.SignatoryEmail); email != "" {
		event.ActorEmail = &email
	}
	if hash := strings.TrimSpace(cb.EvidenceHash); hash != "" {
		event.EvidenceHash = &hash
	}
	if reason := strings.TrimSpace(cb.Reason); reason != "" {
		event.Reason = &reason
		event.DeclineReason = &reason
	}
	if occurred := najizCallbackTime(cb.OccurredAt); occurred != nil {
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

func emdhaSendMessage(envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest) string {
	if req.Message != nil {
		if trimmed := strings.TrimSpace(*req.Message); trimmed != "" {
			return trimmed
		}
	}
	return envelope.Message
}

type emdhaSigningRequest struct {
	ClientID       string           `json:"client_id"`
	TenantID       string           `json:"tenant_id"`
	RequestRef     string           `json:"request_ref"`
	TargetType     string           `json:"target_type"`
	ContractID     *string          `json:"contract_id,omitempty"`
	DocumentID     *string          `json:"document_id,omitempty"`
	Title          string           `json:"title"`
	Subject        string           `json:"subject"`
	Message        string           `json:"message"`
	Language       string           `json:"language"`
	CallbackURL    string           `json:"callback_url,omitempty"`
	SignatureLevel string           `json:"signature_level"`
	DueAt          *time.Time       `json:"due_at,omitempty"`
	ExpiresAt      *time.Time       `json:"expires_at,omitempty"`
	RequestedAt    time.Time        `json:"requested_at"`
	Signatories    []emdhaSignatory `json:"signatories"`
}

type emdhaSignatory struct {
	SignatoryRef string  `json:"signatory_ref"`
	FullName     string  `json:"full_name"`
	Email        *string `json:"email,omitempty"`
	MobileNumber *string `json:"mobile_number,omitempty"`
	SignOrder    int     `json:"sign_order"`
}

type emdhaSigningResponse struct {
	RequestID      string              `json:"request_id"`
	Status         string              `json:"status"`
	DeliveryStatus string              `json:"delivery_status"`
	EventID        string              `json:"event_id"`
	EvidenceHash   string              `json:"evidence_hash"`
	Metadata       map[string]any      `json:"metadata"`
	Signatories    []emdhaSignatoryAck `json:"signatories"`
}

type emdhaSignatoryAck struct {
	SignatoryRef     string `json:"signatory_ref"`
	EmdhaSignatoryID string `json:"emdha_signatory_id"`
}

type emdhaCallback struct {
	RequestID        string         `json:"request_id"`
	EventID          string         `json:"event_id"`
	Status           string         `json:"status"`
	EmdhaSignatoryID string         `json:"emdha_signatory_id"`
	SignatoryRef     string         `json:"signatory_ref"`
	SignatoryName    string         `json:"signatory_name"`
	SignatoryEmail   string         `json:"signatory_email"`
	EvidenceHash     string         `json:"evidence_hash"`
	Reason           string         `json:"reason"`
	OccurredAt       string         `json:"occurred_at"`
	Metadata         map[string]any `json:"metadata"`
}

// Compile-time assertion that emdha satisfies the dispatcher seam.
var _ SignatureProviderDispatcher = (*EmdhaSignatureProviderDispatcher)(nil)
