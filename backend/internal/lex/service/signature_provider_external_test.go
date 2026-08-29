package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
)

// signBodyOnlyHMAC signs the raw body with HMAC-SHA256 (no timestamp prefix),
// matching how DocuSign Connect / Adobe Acrobat Sign sign their webhook bodies.
func signBodyOnlyHMAC(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestTranslateDocuSignConnectCallbackMapsCompletedSigner(t *testing.T) {
	raw := []byte(`{"data":{"envelopeId":"ds-env-1","envelopeSummary":{"envelopeId":"ds-env-1","status":"completed","completedDateTime":"2026-06-20T12:00:00Z","recipients":{"signers":[{"recipientIdGuid":"rg-1","name":"Signer","email":"s@example.com","status":"completed","signedDateTime":"2026-06-20T12:00:00Z"}]}}}}`)
	event, err := TranslateDocuSignConnectCallback(raw, "sha256=abc")
	if err != nil {
		t.Fatalf("TranslateDocuSignConnectCallback() error = %v", err)
	}
	if event.Provider != model.SignatureProviderExternal {
		t.Fatalf("provider = %s", event.Provider)
	}
	if event.ProviderEnvelopeID == nil || *event.ProviderEnvelopeID != "ds-env-1" {
		t.Fatalf("provider envelope id = %v", event.ProviderEnvelopeID)
	}
	if event.ProviderRecipientID == nil || *event.ProviderRecipientID != "rg-1" {
		t.Fatalf("provider recipient id = %v", event.ProviderRecipientID)
	}
	if et, err := signatureEventTypeForProviderStatus(event.ProviderStatus); err != nil || et != model.SignatureEventSigned {
		t.Fatalf("mapped event type = %v (err=%v), want signed", et, err)
	}
	if event.EvidenceMetadata["provider_adapter"] != "docusign" {
		t.Fatalf("adapter metadata = %v", event.EvidenceMetadata["provider_adapter"])
	}
	if event.RawPayload == nil {
		t.Fatal("raw payload not carried for HMAC verification")
	}
}

func TestDocuSignCallbackHMACAcceptsValidRejectsTampered(t *testing.T) {
	secret := "docusign-connect-secret"
	payload := `{"data":{"envelopeId":"ds-env-1","envelopeSummary":{"status":"completed","recipients":{"signers":[{"recipientIdGuid":"rg-1","status":"completed"}]}}}}`
	signature := signBodyOnlyHMAC(secret, payload)

	event, err := TranslateDocuSignConnectCallback([]byte(payload), signature)
	if err != nil {
		t.Fatalf("TranslateDocuSignConnectCallback() error = %v", err)
	}
	event.Normalize()
	envelope := &model.SignatureEnvelope{EvidenceMetadata: map[string]any{"webhook_secret": secret}}

	validated, err := validateSignatureProviderWebhook(envelope, &event)
	if err != nil {
		t.Fatalf("valid docusign callback error = %v", err)
	}
	if !validated {
		t.Fatal("valid docusign callback not validated")
	}

	// Tamper: same signature, mutated body -> must reject fail-closed.
	tampered := `{"data":{"envelopeId":"ds-env-1","envelopeSummary":{"status":"declined","recipients":{"signers":[{"recipientIdGuid":"rg-1","status":"declined","declinedReason":"forged"}]}}}}`
	tamperedEvent, err := TranslateDocuSignConnectCallback([]byte(tampered), signature)
	if err != nil {
		t.Fatalf("TranslateDocuSignConnectCallback(tampered) error = %v", err)
	}
	tamperedEvent.Normalize()
	validated, err = validateSignatureProviderWebhook(envelope, &tamperedEvent)
	if err == nil {
		t.Fatal("tampered docusign callback accepted, want rejection")
	}
	if validated {
		t.Fatal("tampered docusign callback validated=true, want false")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
		t.Fatalf("error = %v, want 403 forbidden", err)
	}
}

func TestDocuSignCallbackRejectsMissingSignatureWhenSecretConfigured(t *testing.T) {
	secret := "docusign-connect-secret"
	payload := `{"data":{"envelopeId":"ds-env-1","envelopeSummary":{"status":"completed","recipients":{"signers":[{"recipientIdGuid":"rg-1","status":"completed"}]}}}}`
	// No signature supplied, but a secret is configured AND a payload is present
	// -> validation is requested and must fail closed (no signature).
	event, err := TranslateDocuSignConnectCallback([]byte(payload), "")
	if err != nil {
		t.Fatalf("translate error = %v", err)
	}
	event.Normalize()
	// Force validation-requested by carrying the request secret too.
	reqSecret := secret
	event.WebhookSecret = &reqSecret
	envelope := &model.SignatureEnvelope{EvidenceMetadata: map[string]any{"webhook_secret": secret}}
	if _, err := validateSignatureProviderWebhook(envelope, &event); err == nil {
		t.Fatal("expected missing-signature callback to be rejected fail-closed")
	}
}

func TestTranslateAdobeSignCallbackMapsRejection(t *testing.T) {
	raw := []byte(`{"event":"AGREEMENT_ACTION_REJECTED","eventDate":"2026-06-20T12:00:00Z","agreement":{"id":"ad-1","status":"REJECTED","message":"not approved"},"participantUserId":"p-1","participantUserName":"Signer","participantUserEmail":"s@example.com"}`)
	event, err := TranslateAdobeSignCallback(raw, "sha256=abc")
	if err != nil {
		t.Fatalf("TranslateAdobeSignCallback() error = %v", err)
	}
	if event.ProviderEnvelopeID == nil || *event.ProviderEnvelopeID != "ad-1" {
		t.Fatalf("provider envelope id = %v", event.ProviderEnvelopeID)
	}
	if et, err := signatureEventTypeForProviderStatus(event.ProviderStatus); err != nil || et != model.SignatureEventDeclined {
		t.Fatalf("mapped event type = %v (err=%v), want declined", et, err)
	}
	if event.DeclineReason == nil || *event.DeclineReason != "not approved" {
		t.Fatalf("decline reason = %v", event.DeclineReason)
	}
	if event.EvidenceMetadata["provider_adapter"] != "adobe" {
		t.Fatalf("adapter metadata = %v", event.EvidenceMetadata["provider_adapter"])
	}
}

func TestAdobeSignCallbackHMACAcceptsValidRejectsTampered(t *testing.T) {
	secret := "adobe-sign-secret"
	payload := `{"event":"AGREEMENT_ACTION_COMPLETED","agreement":{"id":"ad-1","status":"SIGNED"},"participantUserId":"p-1"}`
	signature := signBodyOnlyHMAC(secret, payload)

	event, err := TranslateAdobeSignCallback([]byte(payload), signature)
	if err != nil {
		t.Fatalf("TranslateAdobeSignCallback() error = %v", err)
	}
	event.Normalize()
	envelope := &model.SignatureEnvelope{EvidenceMetadata: map[string]any{"webhook_secret": secret}}

	validated, err := validateSignatureProviderWebhook(envelope, &event)
	if err != nil {
		t.Fatalf("valid adobe callback error = %v", err)
	}
	if !validated {
		t.Fatal("valid adobe callback not validated")
	}

	tampered := `{"event":"AGREEMENT_ACTION_REJECTED","agreement":{"id":"ad-1","status":"REJECTED","message":"forged"},"participantUserId":"p-1"}`
	tamperedEvent, err := TranslateAdobeSignCallback([]byte(tampered), signature)
	if err != nil {
		t.Fatalf("TranslateAdobeSignCallback(tampered) error = %v", err)
	}
	tamperedEvent.Normalize()
	validated, err = validateSignatureProviderWebhook(envelope, &tamperedEvent)
	if err == nil {
		t.Fatal("tampered adobe callback accepted, want rejection")
	}
	if validated {
		t.Fatal("tampered adobe callback validated=true, want false")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
		t.Fatalf("error = %v, want 403 forbidden", err)
	}
}

func TestAdobeStatusTokenNormalisation(t *testing.T) {
	cases := map[string]string{
		"AGREEMENT_ACTION_COMPLETED":   "completed",
		"AGREEMENT_WORKFLOW_COMPLETED": "completed",
		"AGREEMENT_ACTION_REJECTED":    "declined",
		"AGREEMENT_EXPIRED":            "expired",
		"AGREEMENT_ACTION_DELEGATED":   "agreement_action_delegated",
		"EMAIL_VIEWED":                 "viewed",
		"":                             "",
	}
	for in, want := range cases {
		if got := adobeStatusToken(in); got != want {
			t.Fatalf("adobeStatusToken(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDocuSignAndAdobeTranslatorsRejectEmptyPayload(t *testing.T) {
	if _, err := TranslateDocuSignConnectCallback([]byte("  "), ""); err == nil {
		t.Fatal("expected empty docusign payload rejection")
	}
	if _, err := TranslateAdobeSignCallback([]byte("  "), ""); err == nil {
		t.Fatal("expected empty adobe payload rejection")
	}
	if _, err := TranslateDocuSignConnectCallback([]byte(`{"data":{}}`), ""); err == nil {
		t.Fatal("expected docusign no-status payload rejection")
	}
}

func TestExternalProviderSignBodyOnlyBaseDefaults(t *testing.T) {
	// Confirms that with no timestamp, the shared verifier defaults to body-only
	// base — the exact contract DocuSign/Adobe rely on.
	secret := "s"
	payload := []byte(`{"event":"x"}`)
	sig := signBodyOnlyHMAC(secret, string(payload))
	if !validHMACSHA256Signature(secret, payload, "", "", sig) {
		t.Fatal("body-only HMAC did not validate under default base")
	}
	// A wrong secret must not validate.
	if validHMACSHA256Signature("wrong", payload, "", "", sig) {
		t.Fatal("HMAC validated under wrong secret")
	}
	_ = uuid.New()
}
