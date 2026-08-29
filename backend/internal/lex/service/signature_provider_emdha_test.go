package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func emdhaTestEnvelope(tenantID, envelopeID, recipientID uuid.UUID) *model.SignatureEnvelope {
	return &model.SignatureEnvelope{
		ID:       envelopeID,
		TenantID: tenantID,
		Provider: model.SignatureProviderExternal,
		Title:    "Service agreement",
		Subject:  "Please sign",
		Message:  "Qualified TSP signature required",
		Language: model.SignatureLanguageAR,
		Recipients: []model.SignatureRecipient{
			{ID: recipientID, TenantID: tenantID, EnvelopeID: envelopeID, Name: "Signer", Role: model.SignatureRecipientSigner, Method: model.SignatureMethodCertificate, SigningOrder: 1},
		},
	}
}

func TestNewEmdhaDispatcherFailsClosedWithoutLiveCredentials(t *testing.T) {
	// LIVE mode (sandbox=false) must fail closed when integrator creds are absent.
	if _, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint: "https://api.emdha.sa/sign",
	}); err == nil {
		t.Fatal("expected live-mode constructor to fail without client id/secret")
	}
	// SANDBOX mode only needs an endpoint label.
	if _, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint:        "emdha-sandbox",
		SandboxDispatch: true,
	}); err != nil {
		t.Fatalf("sandbox constructor error = %v", err)
	}
	// Empty endpoint is always invalid.
	if _, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{SandboxDispatch: true}); err == nil {
		t.Fatal("expected empty-endpoint constructor to fail")
	}
}

func TestEmdhaSandboxDispatchHappyPathIsHonestlyNonLive(t *testing.T) {
	now := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)
	tenantID, envelopeID, recipientID := uuid.New(), uuid.New(), uuid.New()
	dispatcher, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint:        "emdha-sandbox",
		SandboxDispatch: true,
		Now:             func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("constructor error = %v", err)
	}
	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), emdhaTestEnvelope(tenantID, envelopeID, recipientID), dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if dispatch.Provider != model.SignatureProviderExternal {
		t.Fatalf("provider = %s, want external", dispatch.Provider)
	}
	if dispatch.Adapter != emdhaSignatureAdapter {
		t.Fatalf("adapter = %s", dispatch.Adapter)
	}
	if dispatch.ProviderEnvelopeID == "" || dispatch.ProviderRecipientIDs[recipientID] == "" {
		t.Fatalf("missing provider ids: %#v", dispatch)
	}
	// HONESTY: sandbox dispatch must be flagged non-live and TSP-distinct.
	if live, _ := dispatch.EvidenceMetadata["live"].(bool); live {
		t.Fatal("sandbox dispatch metadata live=true, want false")
	}
	if dispatch.EvidenceMetadata["signature_kind"] != "qualified_tsp" {
		t.Fatalf("signature_kind = %v, want qualified_tsp", dispatch.EvidenceMetadata["signature_kind"])
	}
	if dispatch.EvidenceMetadata["dispatch_mode"] != "sandbox_mock" {
		t.Fatalf("dispatch_mode = %v, want sandbox_mock", dispatch.EvidenceMetadata["dispatch_mode"])
	}
}

func TestEmdhaDispatcherRejectsMisRoutedProvider(t *testing.T) {
	dispatcher, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint:        "emdha-sandbox",
		SandboxDispatch: true,
	})
	if err != nil {
		t.Fatalf("constructor error = %v", err)
	}
	env := emdhaTestEnvelope(uuid.New(), uuid.New(), uuid.New())
	env.Provider = model.SignatureProviderNafath // identity rail, not TSP
	if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), env, dto.SendSignatureEnvelopeRequest{}, time.Now()); err == nil {
		t.Fatal("expected mis-routed (nafath) envelope to be rejected by emdha dispatcher")
	}
}

func TestEmdhaLiveDispatchMapsProofAndSendsCredentials(t *testing.T) {
	now := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)
	tenantID, envelopeID, recipientID := uuid.New(), uuid.New(), uuid.New()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emdha-Client-Id") != "emdha-client" {
			t.Fatalf("client id header = %q", r.Header.Get("X-Emdha-Client-Id"))
		}
		if r.Header.Get("X-Idempotency-Key") != envelopeID.String() {
			t.Fatalf("idempotency key = %q, want %s", r.Header.Get("X-Idempotency-Key"), envelopeID)
		}
		var req emdhaSigningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if req.SignatureLevel != "qualified" {
			t.Fatalf("signature_level = %q, want qualified", req.SignatureLevel)
		}
		_ = json.NewEncoder(w).Encode(emdhaSigningResponse{
			RequestID:      "emdha-req-1",
			Status:         "sent",
			DeliveryStatus: "accepted",
			EventID:        "emdha-evt-1",
			EvidenceHash:   "sha256:emdha-proof",
			Signatories:    []emdhaSignatoryAck{{SignatoryRef: recipientID.String(), EmdhaSignatoryID: "emdha-sig-1"}},
		})
	}))
	defer server.Close()

	dispatcher, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint:     server.URL,
		ClientID:     "emdha-client",
		ClientSecret: "emdha-secret",
		Timeout:      2 * time.Second,
	})
	if err != nil {
		t.Fatalf("constructor error = %v", err)
	}
	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), emdhaTestEnvelope(tenantID, envelopeID, recipientID), dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if dispatch.ProviderEnvelopeID != "emdha-req-1" || dispatch.ProviderRecipientIDs[recipientID] != "emdha-sig-1" {
		t.Fatalf("unexpected proof mapping: %#v", dispatch)
	}
	if live, _ := dispatch.EvidenceMetadata["live"].(bool); !live {
		t.Fatal("live dispatch metadata live=false, want true")
	}
	if dispatch.EvidenceMetadata["signature_kind"] != "qualified_tsp" {
		t.Fatalf("signature_kind = %v", dispatch.EvidenceMetadata["signature_kind"])
	}
}

func TestEmdhaLiveDispatchRetriesTransientThenSucceeds(t *testing.T) {
	prevBackoff := signatureDispatchBackoff
	signatureDispatchBackoff = time.Millisecond
	defer func() { signatureDispatchBackoff = prevBackoff }()

	recipientID := uuid.New()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			http.Error(w, "temporary upstream failure", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(emdhaSigningResponse{
			RequestID:   "emdha-req-retry",
			Status:      "sent",
			Signatories: []emdhaSignatoryAck{{SignatoryRef: recipientID.String(), EmdhaSignatoryID: "emdha-sig-retry"}},
		})
	}))
	defer server.Close()

	dispatcher, err := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("constructor error = %v", err)
	}
	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), emdhaTestEnvelope(uuid.New(), uuid.New(), recipientID), dto.SendSignatureEnvelopeRequest{}, time.Now())
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v after retries", err)
	}
	if dispatch.ProviderEnvelopeID != "emdha-req-retry" {
		t.Fatalf("provider envelope id = %q", dispatch.ProviderEnvelopeID)
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Fatalf("server calls = %d, want 3 (two transient + success)", got)
	}
}

func TestEmdhaLiveDispatchExhaustsRetriesOn5xx(t *testing.T) {
	prevBackoff := signatureDispatchBackoff
	signatureDispatchBackoff = time.Millisecond
	defer func() { signatureDispatchBackoff = prevBackoff }()

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		http.Error(w, "still down", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	dispatcher, _ := NewEmdhaSignatureProviderDispatcher(EmdhaSignatureProviderDispatcherConfig{
		Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: 2 * time.Second,
	})
	if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), emdhaTestEnvelope(uuid.New(), uuid.New(), uuid.New()), dto.SendSignatureEnvelopeRequest{}, time.Now()); err == nil {
		t.Fatal("expected error after exhausting retries")
	}
	if got := atomic.LoadInt32(&calls); got != signatureDispatchMaxAttempts {
		t.Fatalf("server calls = %d, want %d", got, signatureDispatchMaxAttempts)
	}
}

func TestTranslateEmdhaCallbackPreservesTSPDistinction(t *testing.T) {
	recipientID := uuid.New()
	raw := []byte(`{"request_id":"emdha-req-1","event_id":"emdha-evt-9","status":"signed","emdha_signatory_id":"emdha-sig-1","signatory_ref":"` + recipientID.String() + `","signatory_name":"Signer","evidence_hash":"sha256:tsp","occurred_at":"2026-06-20T10:00:00Z"}`)
	event, err := TranslateEmdhaCallback(raw, "sha256=abc", "2026-06-20T10:00:00Z")
	if err != nil {
		t.Fatalf("TranslateEmdhaCallback() error = %v", err)
	}
	if event.Provider != model.SignatureProviderExternal {
		t.Fatalf("provider = %s, want external (TSP, not nafath identity)", event.Provider)
	}
	if event.ProviderStatus != "signed" {
		t.Fatalf("status = %q", event.ProviderStatus)
	}
	if event.EvidenceMetadata["signature_kind"] != "qualified_tsp" {
		t.Fatalf("signature_kind = %v, want qualified_tsp", event.EvidenceMetadata["signature_kind"])
	}
	if event.RecipientID == nil || *event.RecipientID != recipientID {
		t.Fatalf("recipient id = %v", event.RecipientID)
	}
	if event.RawPayload == nil || event.WebhookSignature == nil {
		t.Fatal("raw payload / signature not carried through for HMAC verification")
	}
}

func TestTranslateEmdhaCallbackRejectsInvalidPayload(t *testing.T) {
	if _, err := TranslateEmdhaCallback([]byte("not-json"), "", ""); err == nil {
		t.Fatal("expected invalid payload to be rejected")
	}
	if _, err := TranslateEmdhaCallback([]byte(`{"request_id":"x"}`), "", ""); err == nil {
		t.Fatal("expected missing-status payload to be rejected")
	}
}

// TestEmdhaCallbackHMACValidationEndToEnd proves an emdha callback flows through
// the shared HMAC verifier: a correctly-signed body validates and a tampered body
// is rejected fail-closed.
func TestEmdhaCallbackHMACValidationEndToEnd(t *testing.T) {
	secret := "emdha-callback-secret"
	timestamp := "2026-06-20T10:00:00Z"
	recipientID := uuid.New()
	payload := `{"request_id":"emdha-req-1","status":"signed","signatory_ref":"` + recipientID.String() + `"}`
	signature := signEmdhaTestPayload(secret, timestamp, payload)

	event, err := TranslateEmdhaCallback([]byte(payload), signature, timestamp)
	if err != nil {
		t.Fatalf("TranslateEmdhaCallback() error = %v", err)
	}
	event.Normalize()
	envelope := &model.SignatureEnvelope{EvidenceMetadata: map[string]any{"webhook_secret": secret}}

	validated, err := validateSignatureProviderWebhook(envelope, &event)
	if err != nil {
		t.Fatalf("validateSignatureProviderWebhook() error = %v", err)
	}
	if !validated {
		t.Fatal("valid emdha callback was not validated")
	}

	// Tamper the body — signature must now be rejected fail-closed.
	tampered := `{"request_id":"emdha-req-1","status":"declined","signatory_ref":"` + recipientID.String() + `"}`
	tamperedEvent, err := TranslateEmdhaCallback([]byte(tampered), signature, timestamp)
	if err != nil {
		t.Fatalf("TranslateEmdhaCallback(tampered) error = %v", err)
	}
	tamperedEvent.Normalize()
	validated, err = validateSignatureProviderWebhook(envelope, &tamperedEvent)
	if err == nil {
		t.Fatal("tampered emdha callback was accepted, want rejection")
	}
	if validated {
		t.Fatal("tampered emdha callback validated = true, want false")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
		t.Fatalf("error = %v, want 403 forbidden", err)
	}
}

func signEmdhaTestPayload(secret, timestamp, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(payload))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
