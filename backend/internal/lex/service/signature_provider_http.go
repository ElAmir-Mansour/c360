package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// signatureDispatchMaxAttempts bounds how many times an outbound signature
// dispatch (DocuSign/Adobe/generic/Najiz/emdha) is tried before failing. The
// first try plus up to two retries on transient faults (connection reset,
// timeout, HTTP 429/5xx) — a deterministic, bounded backoff that never blocks a
// request unboundedly.
const signatureDispatchMaxAttempts = 3

// signatureDispatchBackoff is the base inter-attempt delay; attempt n waits
// base*2^(n-1). Kept small so a request-scoped dispatch stays responsive.
var signatureDispatchBackoff = 200 * time.Millisecond

// doSignatureDispatchWithRetry performs an idempotent-by-RequestRef POST with
// bounded exponential backoff on transient failures. send returns the raw
// response body, the HTTP status, and a transport error. A non-nil transport
// error or a retryable status (429 / 5xx) triggers a retry until attempts are
// exhausted or ctx is done; 4xx (except 429) and 2xx return immediately. The
// final error is the last observed failure, mapped to an operator-safe message
// by the caller (no provider internals leaked beyond the status line).
func doSignatureDispatchWithRetry(ctx context.Context, attempts int, newReq func(context.Context) (*http.Request, error), client *http.Client) (body []byte, status int, err error) {
	if attempts < 1 {
		attempts = 1
	}
	for attempt := 1; attempt <= attempts; attempt++ {
		if ctxErr := ctx.Err(); ctxErr != nil {
			if err == nil {
				err = ctxErr
			}
			return body, status, err
		}
		var req *http.Request
		req, err = newReq(ctx)
		if err != nil {
			return nil, 0, err
		}
		var resp *http.Response
		resp, err = client.Do(req)
		if err != nil {
			status = 0
			if !isRetryableTransportErr(err) || attempt == attempts {
				return nil, 0, err
			}
			if !sleepBackoff(ctx, attempt) {
				return nil, 0, ctx.Err()
			}
			continue
		}
		body, err = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		status = resp.StatusCode
		_ = resp.Body.Close()
		if err != nil {
			if attempt == attempts {
				return body, status, err
			}
			if !sleepBackoff(ctx, attempt) {
				return body, status, ctx.Err()
			}
			continue
		}
		if isRetryableStatus(status) && attempt < attempts {
			err = fmt.Errorf("status %d", status)
			if !sleepBackoff(ctx, attempt) {
				return body, status, ctx.Err()
			}
			continue
		}
		return body, status, nil
	}
	return body, status, err
}

// isRetryableStatus reports whether an HTTP status warrants a retry. 429 (rate
// limit) and 5xx (provider-side transient) are retryable; everything else is a
// terminal answer.
func isRetryableStatus(status int) bool {
	return status == http.StatusTooManyRequests || (status >= 500 && status <= 599)
}

// isRetryableTransportErr reports whether a transport-level error is transient.
// Context cancellation/deadline are NOT retried (the caller's budget is spent).
func isRetryableTransportErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	// net/url and net.OpError timeouts implement Timeout(); treat them and any
	// other dial/reset/EOF condition as transient.
	var timeoutErr interface{ Timeout() bool }
	if errors.As(err, &timeoutErr) && timeoutErr.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, token := range []string{"connection reset", "connection refused", "broken pipe", "eof", "no such host", "timeout", "i/o timeout", "tls handshake"} {
		if strings.Contains(msg, token) {
			return true
		}
	}
	return false
}

func sleepBackoff(ctx context.Context, attempt int) bool {
	delay := signatureDispatchBackoff << (attempt - 1)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

type HTTPSignatureProviderDispatcherConfig struct {
	Endpoint string
	APIKey   string
	Timeout  time.Duration
	Client   *http.Client
}

type HTTPSignatureProviderDispatcher struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

func NewHTTPSignatureProviderDispatcher(cfg HTTPSignatureProviderDispatcherConfig) (*HTTPSignatureProviderDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("signature provider endpoint is required", map[string]string{"endpoint": "required"})
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, validationError("signature provider API key is required", map[string]string{"api_key": "required"})
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
	return &HTTPSignatureProviderDispatcher{
		endpoint: endpoint,
		apiKey:   apiKey,
		client:   client,
	}, nil
}

func (d *HTTPSignatureProviderDispatcher) DispatchSignatureEnvelope(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	if envelope == nil {
		return nil, validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	payload := httpSignatureProviderDispatchRequest{
		TenantID:         envelope.TenantID.String(),
		EnvelopeID:       envelope.ID.String(),
		Provider:         envelope.Provider,
		TargetType:       envelope.TargetType,
		ContractID:       uuidPtrString(envelope.ContractID),
		DocumentID:       uuidPtrString(envelope.DocumentID),
		Title:            envelope.Title,
		Subject:          envelope.Subject,
		Message:          envelope.Message,
		SendMessage:      req.Message,
		DueAt:            envelope.DueAt,
		ExpiresAt:        envelope.ExpiresAt,
		EvidenceHash:     req.EvidenceHash,
		EvidenceMetadata: req.EvidenceMetadata,
		RequestedAt:      now,
		Recipients:       make([]httpSignatureProviderRecipient, 0, len(envelope.Recipients)),
	}
	for _, recipient := range envelope.Recipients {
		payload.Recipients = append(payload.Recipients, httpSignatureProviderRecipient{
			ID:           recipient.ID.String(),
			UserID:       uuidPtrString(recipient.UserID),
			Name:         recipient.Name,
			Email:        recipient.Email,
			Phone:        recipient.Phone,
			Role:         recipient.Role,
			Method:       recipient.Method,
			SigningOrder: recipient.SigningOrder,
		})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal signature provider dispatch", err)
	}
	// The dispatch is idempotent on the provider side: envelope_id is carried as
	// the dispatch correlation ref, so a retried POST after a transient fault
	// re-references the same envelope rather than creating a duplicate.
	newReq := func(reqCtx context.Context) (*http.Request, error) {
		httpReq, reqErr := http.NewRequestWithContext(reqCtx, http.MethodPost, d.endpoint, bytes.NewReader(body))
		if reqErr != nil {
			return nil, validationError("signature provider endpoint is invalid", map[string]string{"endpoint": "invalid"})
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+d.apiKey)
		httpReq.Header.Set("X-Clario360-Tenant-ID", envelope.TenantID.String())
		httpReq.Header.Set("X-Clario360-Signature-Provider", string(envelope.Provider))
		httpReq.Header.Set("X-Idempotency-Key", envelope.ID.String())
		return httpReq, nil
	}

	respBody, status, err := doSignatureDispatchWithRetry(ctx, signatureDispatchMaxAttempts, newReq, d.client)
	if err != nil {
		return nil, internalError("dispatch signature envelope to HTTP provider", err)
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, internalError("signature provider rejected dispatch", fmt.Errorf("status %d: %s", status, strings.TrimSpace(string(respBody))))
	}
	var providerResp httpSignatureProviderDispatchResponse
	if err := json.Unmarshal(respBody, &providerResp); err != nil {
		return nil, internalError("decode signature provider response", err)
	}
	dispatch := &SignatureProviderDispatch{
		Provider:             envelope.Provider,
		Adapter:              "http",
		ProviderStatus:       providerResp.ProviderStatus,
		DeliveryStatus:       providerResp.DeliveryStatus,
		ProviderEnvelopeID:   strings.TrimSpace(providerResp.ProviderEnvelopeID),
		ProviderRecipientIDs: map[uuid.UUID]string{},
		EvidenceMetadata: mergeMetadata(providerResp.EvidenceMetadata, map[string]any{
			"provider_adapter":       "http",
			"provider_endpoint":      d.endpoint,
			"provider_dispatched_at": now.Format(time.RFC3339Nano),
		}),
	}
	if providerResp.ProviderEventID != "" {
		value := strings.TrimSpace(providerResp.ProviderEventID)
		dispatch.ProviderEventID = &value
	}
	if providerResp.EvidenceHash != "" {
		value := strings.TrimSpace(providerResp.EvidenceHash)
		dispatch.EvidenceHash = &value
	}
	for _, recipient := range providerResp.Recipients {
		recipientID, err := uuid.Parse(strings.TrimSpace(recipient.RecipientID))
		if err != nil {
			return nil, validationError("signature provider returned invalid recipient id", map[string]string{"recipient_id": "invalid"})
		}
		dispatch.ProviderRecipientIDs[recipientID] = strings.TrimSpace(recipient.ProviderRecipientID)
	}
	return dispatch, nil
}

type httpSignatureProviderDispatchRequest struct {
	TenantID         string                           `json:"tenant_id"`
	EnvelopeID       string                           `json:"envelope_id"`
	Provider         model.SignatureProvider          `json:"provider"`
	TargetType       model.SignatureTargetType        `json:"target_type"`
	ContractID       *string                          `json:"contract_id,omitempty"`
	DocumentID       *string                          `json:"document_id,omitempty"`
	Title            string                           `json:"title"`
	Subject          string                           `json:"subject"`
	Message          string                           `json:"message"`
	SendMessage      *string                          `json:"send_message,omitempty"`
	DueAt            *time.Time                       `json:"due_at,omitempty"`
	ExpiresAt        *time.Time                       `json:"expires_at,omitempty"`
	EvidenceHash     *string                          `json:"evidence_hash,omitempty"`
	EvidenceMetadata map[string]any                   `json:"evidence_metadata,omitempty"`
	RequestedAt      time.Time                        `json:"requested_at"`
	Recipients       []httpSignatureProviderRecipient `json:"recipients"`
}

type httpSignatureProviderRecipient struct {
	ID           string                       `json:"id"`
	UserID       *string                      `json:"user_id,omitempty"`
	Name         string                       `json:"name"`
	Email        *string                      `json:"email,omitempty"`
	Phone        *string                      `json:"phone,omitempty"`
	Role         model.SignatureRecipientRole `json:"role"`
	Method       model.SignatureMethod        `json:"method"`
	SigningOrder int                          `json:"signing_order"`
}

type httpSignatureProviderDispatchResponse struct {
	ProviderStatus     string                                      `json:"provider_status"`
	DeliveryStatus     string                                      `json:"delivery_status"`
	ProviderEventID    string                                      `json:"provider_event_id"`
	ProviderEnvelopeID string                                      `json:"provider_envelope_id"`
	EvidenceHash       string                                      `json:"evidence_hash"`
	EvidenceMetadata   map[string]any                              `json:"evidence_metadata"`
	Recipients         []httpSignatureProviderDispatchRecipientAck `json:"recipients"`
}

type httpSignatureProviderDispatchRecipientAck struct {
	RecipientID         string `json:"recipient_id"`
	ProviderRecipientID string `json:"provider_recipient_id"`
}

func uuidPtrString(id *uuid.UUID) *string {
	if id == nil {
		return nil
	}
	value := id.String()
	return &value
}

// =============================================================================
// DocuSign Connect + Adobe Sign callback translators (Integration Platform
// Phase 2 / e-signature connector). These map an inbound provider callback onto
// the lex SignatureProviderEventRequest consumed by SignatureService.ProviderEvent,
// exactly like TranslateNajizCallback. The raw callback bytes and the transport
// HMAC headers are carried straight through to the envelope's webhook validation
// (validateSignatureProviderWebhook), so the existing HMAC-SHA256 verification
// guards every callback before any recipient/provider/custody state changes.
// Only fields that exist on the lex provider-event model are populated; no
// envelope/event field is invented, and no secret is logged or echoed.
//
// Both providers map onto the EXTERNAL provider so they reuse the existing
// envelope provider-match validation; the originating provider connector
// (docusign|adobe) is annotated in evidence metadata for audit.
// =============================================================================

// TranslateDocuSignConnectCallback maps a DocuSign Connect message onto a lex
// provider-event request. DocuSign Connect signs the body with an HMAC-SHA256
// key whose hex/base64 digest arrives in the X-DocuSign-Signature-1 header; the
// caller passes that header value as signature so the shared HMAC verifier can
// confirm it against the endpoint's webhook_secret.
func TranslateDocuSignConnectCallback(raw []byte, signature string) (dto.SignatureProviderEventRequest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return dto.SignatureProviderEventRequest{}, validationError("docusign callback payload is required", map[string]string{"payload": "required"})
	}
	var cb docuSignConnectCallback
	if err := json.Unmarshal(raw, &cb); err != nil {
		return dto.SignatureProviderEventRequest{}, validationError("docusign callback payload is invalid", map[string]string{"payload": "invalid"})
	}

	envelopeStatus := strings.TrimSpace(firstNonEmptyString(cb.Data.EnvelopeSummary.Status, cb.Status))
	recipientStatus := ""
	var recipient *docuSignRecipient
	if len(cb.Data.EnvelopeSummary.Recipients.Signers) > 0 {
		recipient = &cb.Data.EnvelopeSummary.Recipients.Signers[0]
		recipientStatus = strings.TrimSpace(recipient.Status)
	}
	// Prefer the recipient-level status when present (per-signer events), else the
	// envelope status (completion/void). signatureEventTypeForProviderStatus maps
	// docusign verbs (completed/declined/voided/delivered) onto lex event types.
	providerStatus := firstNonEmptyString(recipientStatus, envelopeStatus)
	if providerStatus == "" {
		return dto.SignatureProviderEventRequest{}, validationError("docusign callback status is required", map[string]string{"status": "required"})
	}

	payloadString := string(raw)
	event := dto.SignatureProviderEventRequest{
		Provider:         model.SignatureProviderExternal,
		ProviderStatus:   providerStatus,
		EvidenceMetadata: map[string]any{"provider_adapter": "docusign", "provider_portal": "docusign_connect"},
		WebhookPayload:   &payloadString,
		RawPayload:       raw,
	}
	if envelopeID := strings.TrimSpace(firstNonEmptyString(cb.Data.EnvelopeID, cb.Data.EnvelopeSummary.EnvelopeID)); envelopeID != "" {
		event.ProviderEnvelopeID = &envelopeID
	}
	if recipient != nil {
		if rid := strings.TrimSpace(recipient.RecipientIDGUID); rid != "" {
			event.ProviderRecipientID = &rid
		} else if rid := strings.TrimSpace(recipient.RecipientID); rid != "" {
			event.ProviderRecipientID = &rid
		}
		if name := strings.TrimSpace(recipient.Name); name != "" {
			event.ActorName = &name
		}
		if email := strings.TrimSpace(recipient.Email); email != "" {
			event.ActorEmail = &email
		}
		if reason := strings.TrimSpace(recipient.DeclinedReason); reason != "" {
			event.Reason = &reason
			event.DeclineReason = &reason
		}
		if occurred := docuSignCallbackTime(firstNonEmptyString(recipient.SignedDateTime, recipient.DeliveredDateTime, recipient.DeclinedDateTime)); occurred != nil {
			event.OccurredAt = occurred
		}
	}
	if event.OccurredAt == nil {
		if occurred := docuSignCallbackTime(firstNonEmptyString(cb.Data.EnvelopeSummary.CompletedDateTime, cb.Data.EnvelopeSummary.VoidedDateTime, cb.Data.EnvelopeSummary.StatusChangedDateTime)); occurred != nil {
			event.OccurredAt = occurred
		}
	}
	if reason := strings.TrimSpace(cb.Data.EnvelopeSummary.VoidedReason); reason != "" && event.Reason == nil {
		event.Reason = &reason
	}
	if sig := strings.TrimSpace(signature); sig != "" {
		event.WebhookSignature = &sig
	}
	return event, nil
}

// TranslateAdobeSignCallback maps an Adobe Acrobat Sign webhook onto a lex
// provider-event request. Adobe signs the body with HMAC-SHA256 and delivers the
// digest in the X-AdobeSign-ClientId / X-Adobe-Signature header; the caller
// passes that as signature for the shared HMAC verifier.
func TranslateAdobeSignCallback(raw []byte, signature string) (dto.SignatureProviderEventRequest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return dto.SignatureProviderEventRequest{}, validationError("adobe sign callback payload is required", map[string]string{"payload": "required"})
	}
	var cb adobeSignCallback
	if err := json.Unmarshal(raw, &cb); err != nil {
		return dto.SignatureProviderEventRequest{}, validationError("adobe sign callback payload is invalid", map[string]string{"payload": "invalid"})
	}

	// Adobe delivers an event verb (AGREEMENT_ACTION_COMPLETED / _REJECTED /
	// _EXPIRED / AGREEMENT_WORKFLOW_COMPLETED) plus an agreement status; normalise
	// to a lex-recognised status token via adobeStatusToken.
	providerStatus := adobeStatusToken(firstNonEmptyString(cb.Event, cb.Agreement.Status))
	if providerStatus == "" {
		return dto.SignatureProviderEventRequest{}, validationError("adobe sign callback event is required", map[string]string{"event": "required"})
	}

	payloadString := string(raw)
	event := dto.SignatureProviderEventRequest{
		Provider:         model.SignatureProviderExternal,
		ProviderStatus:   providerStatus,
		EvidenceMetadata: map[string]any{"provider_adapter": "adobe", "provider_portal": "adobe_acrobat_sign"},
		WebhookPayload:   &payloadString,
		RawPayload:       raw,
	}
	if agreementID := strings.TrimSpace(firstNonEmptyString(cb.Agreement.ID, cb.AgreementID)); agreementID != "" {
		event.ProviderEnvelopeID = &agreementID
	}
	if pid := strings.TrimSpace(cb.ParticipantUserID); pid != "" {
		event.ProviderRecipientID = &pid
	}
	if name := strings.TrimSpace(cb.ParticipantUserName); name != "" {
		event.ActorName = &name
	}
	if email := strings.TrimSpace(cb.ParticipantUserEmail); email != "" {
		event.ActorEmail = &email
	}
	if reason := strings.TrimSpace(cb.Event); strings.Contains(strings.ToUpper(reason), "REJECT") {
		if note := strings.TrimSpace(cb.Agreement.Message); note != "" {
			event.Reason = &note
			event.DeclineReason = &note
		}
	}
	if occurred := docuSignCallbackTime(firstNonEmptyString(cb.EventDate, cb.Agreement.StatusUpdateDate)); occurred != nil {
		event.OccurredAt = occurred
	}
	if sig := strings.TrimSpace(signature); sig != "" {
		event.WebhookSignature = &sig
	}
	return event, nil
}

// docuSignConnectCallback is the subset of a DocuSign Connect message the lex
// provider-event consumes. DocuSign Connect can deliver REST (data) or legacy
// (top-level) shapes; both are tolerated.
type docuSignConnectCallback struct {
	Status string `json:"status"`
	Data   struct {
		EnvelopeID      string `json:"envelopeId"`
		EnvelopeSummary struct {
			EnvelopeID            string `json:"envelopeId"`
			Status                string `json:"status"`
			CompletedDateTime     string `json:"completedDateTime"`
			VoidedDateTime        string `json:"voidedDateTime"`
			VoidedReason          string `json:"voidedReason"`
			StatusChangedDateTime string `json:"statusChangedDateTime"`
			Recipients            struct {
				Signers []docuSignRecipient `json:"signers"`
			} `json:"recipients"`
		} `json:"envelopeSummary"`
	} `json:"data"`
}

type docuSignRecipient struct {
	RecipientID       string `json:"recipientId"`
	RecipientIDGUID   string `json:"recipientIdGuid"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Status            string `json:"status"`
	SignedDateTime    string `json:"signedDateTime"`
	DeliveredDateTime string `json:"deliveredDateTime"`
	DeclinedDateTime  string `json:"declinedDateTime"`
	DeclinedReason    string `json:"declinedReason"`
}

// adobeSignCallback is the subset of an Adobe Acrobat Sign webhook payload the
// lex provider-event consumes.
type adobeSignCallback struct {
	Event       string `json:"event"`
	EventDate   string `json:"eventDate"`
	AgreementID string `json:"agreementId"`
	Agreement   struct {
		ID               string `json:"id"`
		Status           string `json:"status"`
		Message          string `json:"message"`
		StatusUpdateDate string `json:"statusUpdateDate"`
	} `json:"agreement"`
	ParticipantUserID    string `json:"participantUserId"`
	ParticipantUserName  string `json:"participantUserName"`
	ParticipantUserEmail string `json:"participantUserEmail"`
}

// adobeStatusToken normalises an Adobe event verb / agreement status onto a token
// signatureEventTypeForProviderStatus already recognises.
func adobeStatusToken(raw string) string {
	up := strings.ToUpper(strings.TrimSpace(raw))
	switch {
	case up == "":
		return ""
	case strings.Contains(up, "COMPLETE") || up == "SIGNED":
		return "completed"
	case strings.Contains(up, "REJECT") || strings.Contains(up, "DECLINE"):
		return "declined"
	case strings.Contains(up, "EXPIRE"):
		return "expired"
	case strings.Contains(up, "CANCEL") || strings.Contains(up, "ABORT"):
		return "cancelled"
	case strings.Contains(up, "VIEW") || strings.Contains(up, "DELIVER") || strings.Contains(up, "EMAIL_VIEWED"):
		return "viewed"
	default:
		// Pass through; signatureEventTypeForProviderStatus rejects unknowns.
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func docuSignCallbackTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.0000000Z07:00"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			normalized := parsed.UTC()
			return &normalized
		}
	}
	return nil
}
