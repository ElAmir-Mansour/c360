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
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestNewNajizSignatureProviderDispatcherValidatesCredentials(t *testing.T) {
	cases := []struct {
		name string
		cfg  NajizSignatureProviderDispatcherConfig
		want string
	}{
		{name: "missing endpoint", cfg: NajizSignatureProviderDispatcherConfig{ClientID: "c", ClientSecret: "s"}, want: "endpoint"},
		{name: "missing client id", cfg: NajizSignatureProviderDispatcherConfig{Endpoint: "https://najiz.test", ClientSecret: "s"}, want: "client_id"},
		{name: "missing client secret", cfg: NajizSignatureProviderDispatcherConfig{Endpoint: "https://najiz.test", ClientID: "c"}, want: "client_secret"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewNajizSignatureProviderDispatcher(tc.cfg)
			if err == nil {
				t.Fatalf("NewNajizSignatureProviderDispatcher() error = nil, want %s", tc.want)
			}
			var appErr *apperrors.AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("error type = %T, want AppError", err)
			}
			if appErr.Fields[tc.want] == "" {
				t.Fatalf("fields = %#v, want %s", appErr.Fields, tc.want)
			}
		})
	}

	if _, err := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
		Endpoint:     "https://najiz.moj.gov.sa/sign",
		ClientID:     "client-1",
		ClientSecret: "secret-1",
	}); err != nil {
		t.Fatalf("NewNajizSignatureProviderDispatcher() error = %v, want nil", err)
	}
}

func TestNajizSignatureProviderDispatcherMapsEnvelopeAndProof(t *testing.T) {
	now := time.Date(2026, 6, 16, 9, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	envelopeID := uuid.New()
	signerID := uuid.New()
	ccID := uuid.New()
	najizRequestID := "NJZ-REQ-7788"
	signerNajizID := "NJZ-SIG-001"
	ccNajizID := "NJZ-SIG-002"
	email := "signer@example.sa"
	phone := "+966500000000"
	callbackURL := "https://lex.clario360.test/api/v1/lex/signatures/x/najiz/callback"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("X-Najiz-Client-Id") != "client-1" || r.Header.Get("X-Najiz-Client-Secret") != "secret-1" {
			t.Fatalf("credential headers = %q/%q", r.Header.Get("X-Najiz-Client-Id"), r.Header.Get("X-Najiz-Client-Secret"))
		}
		if r.Header.Get("X-Clario360-Tenant-ID") != tenantID.String() {
			t.Fatalf("tenant header = %q", r.Header.Get("X-Clario360-Tenant-ID"))
		}
		if got := r.Header.Get("X-Clario360-Signature-Provider"); got != string(model.SignatureProviderNajiz) {
			t.Fatalf("provider header = %q, want najiz", got)
		}
		var req najizSigningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode signing request: %v", err)
		}
		if req.ClientID != "client-1" || req.RequestRef != envelopeID.String() || req.TenantID != tenantID.String() {
			t.Fatalf("request envelope mapping = %#v", req)
		}
		if req.CallbackURL != callbackURL {
			t.Fatalf("callback url = %q, want %q", req.CallbackURL, callbackURL)
		}
		if req.Language != "ar" {
			t.Fatalf("language = %q, want ar", req.Language)
		}
		if len(req.Signatories) != 2 {
			t.Fatalf("signatories = %#v, want 2", req.Signatories)
		}
		signer := req.Signatories[0]
		if signer.SignatoryRef != signerID.String() || signer.Role != "signer" || signer.SignMethod != "nafath" {
			t.Fatalf("signer mapping = %#v", signer)
		}
		if signer.Email == nil || *signer.Email != email || signer.MobileNumber == nil || *signer.MobileNumber != phone {
			t.Fatalf("signer contact = %#v", signer)
		}
		if req.Signatories[1].SignatoryRef != ccID.String() || req.Signatories[1].Role != "viewer" {
			t.Fatalf("cc mapping = %#v", req.Signatories[1])
		}
		_ = json.NewEncoder(w).Encode(najizSigningResponse{
			RequestID:      najizRequestID,
			Status:         "sent",
			DeliveryStatus: "accepted",
			EventID:        "NJZ-EVT-1",
			EvidenceHash:   "sha256:najiz-proof",
			Metadata:       map[string]any{"najiz_reference": "1445-7788"},
			Signatories: []najizSignatoryAck{
				{SignatoryRef: signerID.String(), NajizSignatoryID: signerNajizID},
				{SignatoryRef: ccID.String(), NajizSignatoryID: ccNajizID},
			},
		})
	}))
	defer server.Close()

	dispatcher, err := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
		Endpoint:     server.URL,
		ClientID:     "client-1",
		ClientSecret: "secret-1",
		CallbackURL:  callbackURL,
		Timeout:      time.Second,
	})
	if err != nil {
		t.Fatalf("NewNajizSignatureProviderDispatcher() error = %v", err)
	}

	envelope := &model.SignatureEnvelope{
		ID:       envelopeID,
		TenantID: tenantID,
		Provider: model.SignatureProviderNajiz,
		Title:    "MOJ filing",
		Subject:  "Sign the filing",
		Message:  "Please sign",
		Language: model.SignatureLanguageAR,
		Recipients: []model.SignatureRecipient{
			{ID: signerID, TenantID: tenantID, EnvelopeID: envelopeID, Name: "Signer", Email: &email, Phone: &phone, Role: model.SignatureRecipientSigner, Method: model.SignatureMethodNafath, SigningOrder: 1},
			{ID: ccID, TenantID: tenantID, EnvelopeID: envelopeID, Name: "Observer", Email: &email, Role: model.SignatureRecipientCarbonCopy, Method: model.SignatureMethodOTP, SigningOrder: 2},
		},
	}

	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), envelope, dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if dispatch.Provider != model.SignatureProviderNajiz || dispatch.Adapter != "najiz" {
		t.Fatalf("dispatch provider/adapter = %s/%s", dispatch.Provider, dispatch.Adapter)
	}
	if dispatch.ProviderEnvelopeID != najizRequestID {
		t.Fatalf("provider envelope id = %q, want %q", dispatch.ProviderEnvelopeID, najizRequestID)
	}
	if dispatch.ProviderRecipientIDs[signerID] != signerNajizID || dispatch.ProviderRecipientIDs[ccID] != ccNajizID {
		t.Fatalf("provider recipient ids = %#v", dispatch.ProviderRecipientIDs)
	}
	if dispatch.EvidenceHash == nil || *dispatch.EvidenceHash != "sha256:najiz-proof" {
		t.Fatalf("evidence hash = %v", dispatch.EvidenceHash)
	}
	if dispatch.ProviderEventID == nil || *dispatch.ProviderEventID != "NJZ-EVT-1" {
		t.Fatalf("provider event id = %v", dispatch.ProviderEventID)
	}
	if dispatch.EvidenceMetadata["provider_adapter"] != "najiz" ||
		dispatch.EvidenceMetadata["provider_portal"] != "najiz_moj" ||
		dispatch.EvidenceMetadata["najiz_reference"] != "1445-7788" {
		t.Fatalf("evidence metadata = %#v", dispatch.EvidenceMetadata)
	}

	// The mapped dispatch must satisfy the shared persistence/validation seam.
	if err := applySignatureProviderDispatch(envelope, dispatch, now); err != nil {
		t.Fatalf("applySignatureProviderDispatch() error = %v", err)
	}
	if envelope.Recipients[0].ProviderRecipientID == nil || *envelope.Recipients[0].ProviderRecipientID != signerNajizID {
		t.Fatalf("recipient provider id = %v", envelope.Recipients[0].ProviderRecipientID)
	}
	if envelope.Recipients[0].Status != model.SignatureRecipientSent {
		t.Fatalf("recipient status = %s, want sent", envelope.Recipients[0].Status)
	}
}

func TestNajizSignatureProviderDispatcherUsesSendMessageOverride(t *testing.T) {
	now := time.Date(2026, 6, 16, 9, 30, 0, 0, time.UTC)
	override := "Override message"
	var captured najizSigningRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_ = json.NewEncoder(w).Encode(najizSigningResponse{RequestID: "NJZ-1", Status: "sent"})
	}))
	defer server.Close()
	dispatcher, err := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
		Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: time.Second,
	})
	if err != nil {
		t.Fatalf("NewNajizSignatureProviderDispatcher() error = %v", err)
	}
	envelope := &model.SignatureEnvelope{
		ID: uuid.New(), TenantID: uuid.New(), Provider: model.SignatureProviderNajiz, Message: "envelope message",
	}
	if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), envelope, dto.SendSignatureEnvelopeRequest{Message: &override}, now); err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if captured.Message != override {
		t.Fatalf("message = %q, want %q", captured.Message, override)
	}
}

func TestNajizSignatureProviderDispatcherFailsClosed(t *testing.T) {
	t.Run("provider rejection", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "invalid client credential", http.StatusUnauthorized)
		}))
		defer server.Close()
		dispatcher, _ := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
			Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: time.Second,
		})
		if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), &model.SignatureEnvelope{ID: uuid.New(), TenantID: uuid.New(), Provider: model.SignatureProviderNajiz}, dto.SendSignatureEnvelopeRequest{}, time.Now()); err == nil {
			t.Fatal("DispatchSignatureEnvelope() error = nil, want provider rejection")
		}
	})

	t.Run("empty request id", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(najizSigningResponse{Status: "sent"})
		}))
		defer server.Close()
		dispatcher, _ := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
			Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: time.Second,
		})
		if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), &model.SignatureEnvelope{ID: uuid.New(), TenantID: uuid.New(), Provider: model.SignatureProviderNajiz}, dto.SendSignatureEnvelopeRequest{}, time.Now()); err == nil {
			t.Fatal("DispatchSignatureEnvelope() error = nil, want missing request id")
		}
	})

	t.Run("empty signatory id", func(t *testing.T) {
		signerID := uuid.New()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(najizSigningResponse{
				RequestID:   "NJZ-1",
				Status:      "sent",
				Signatories: []najizSignatoryAck{{SignatoryRef: signerID.String(), NajizSignatoryID: ""}},
			})
		}))
		defer server.Close()
		dispatcher, _ := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
			Endpoint: server.URL, ClientID: "c", ClientSecret: "s", Timeout: time.Second,
		})
		if _, err := dispatcher.DispatchSignatureEnvelope(context.Background(), &model.SignatureEnvelope{ID: uuid.New(), TenantID: uuid.New(), Provider: model.SignatureProviderNajiz}, dto.SendSignatureEnvelopeRequest{}, time.Now()); err == nil {
			t.Fatal("DispatchSignatureEnvelope() error = nil, want missing signatory id")
		}
	})

	t.Run("wrong provider envelope", func(t *testing.T) {
		dispatcher, _ := NewNajizSignatureProviderDispatcher(NajizSignatureProviderDispatcherConfig{
			Endpoint: "https://najiz.test", ClientID: "c", ClientSecret: "s", Timeout: time.Second,
		})
		_, err := dispatcher.DispatchSignatureEnvelope(context.Background(), &model.SignatureEnvelope{ID: uuid.New(), TenantID: uuid.New(), Provider: model.SignatureProviderExternal}, dto.SendSignatureEnvelopeRequest{}, time.Now())
		if err == nil {
			t.Fatal("DispatchSignatureEnvelope() error = nil, want provider mismatch")
		}
		var appErr *apperrors.AppError
		if !errors.As(err, &appErr) || appErr.Fields["provider"] == "" {
			t.Fatalf("error = %v, want provider field validation", err)
		}
	})
}

func TestTranslateNajizCallbackMapsSignedEvent(t *testing.T) {
	recipientID := uuid.New()
	occurred := "2026-06-16T10:15:00Z"
	payload := `{` +
		`"request_id":"NJZ-REQ-7788",` +
		`"event_id":"NJZ-EVT-9",` +
		`"status":"completed",` +
		`"najiz_signatory_id":"NJZ-SIG-001",` +
		`"signatory_ref":"` + recipientID.String() + `",` +
		`"signatory_name":"Signer",` +
		`"signatory_email":"signer@example.sa",` +
		`"evidence_hash":"sha256:najiz-callback",` +
		`"occurred_at":"` + occurred + `",` +
		`"metadata":{"najiz_seal":"seal-1"}` +
		`}`
	signature := "sha256=abc123"
	timestamp := "2026-06-16T10:15:01Z"

	req, err := TranslateNajizCallback([]byte(payload), signature, timestamp)
	if err != nil {
		t.Fatalf("TranslateNajizCallback() error = %v", err)
	}
	req.Normalize()
	if req.Provider != model.SignatureProviderNajiz {
		t.Fatalf("provider = %s, want najiz", req.Provider)
	}
	// "completed" must map to the signed event type via the shared mapper.
	eventType, err := signatureEventTypeForProviderStatus(req.ProviderStatus)
	if err != nil {
		t.Fatalf("signatureEventTypeForProviderStatus(%q) error = %v", req.ProviderStatus, err)
	}
	if eventType != model.SignatureEventSigned {
		t.Fatalf("event type = %s, want signed", eventType)
	}
	if req.ProviderEnvelopeID == nil || *req.ProviderEnvelopeID != "NJZ-REQ-7788" {
		t.Fatalf("provider envelope id = %v", req.ProviderEnvelopeID)
	}
	if req.ProviderRecipientID == nil || *req.ProviderRecipientID != "NJZ-SIG-001" {
		t.Fatalf("provider recipient id = %v", req.ProviderRecipientID)
	}
	if req.RecipientID == nil || *req.RecipientID != recipientID {
		t.Fatalf("recipient id = %v, want %s", req.RecipientID, recipientID)
	}
	if req.EvidenceHash == nil || *req.EvidenceHash != "sha256:najiz-callback" {
		t.Fatalf("evidence hash = %v", req.EvidenceHash)
	}
	if req.OccurredAt == nil || !req.OccurredAt.Equal(time.Date(2026, 6, 16, 10, 15, 0, 0, time.UTC)) {
		t.Fatalf("occurred_at = %v", req.OccurredAt)
	}
	if req.WebhookSignature == nil || *req.WebhookSignature != signature {
		t.Fatalf("webhook signature = %v", req.WebhookSignature)
	}
	if req.WebhookPayload == nil || *req.WebhookPayload != payload {
		t.Fatalf("webhook payload not carried through")
	}
	if len(req.RawPayload) != len(payload) {
		t.Fatalf("raw payload length = %d, want %d", len(req.RawPayload), len(payload))
	}
	if req.EvidenceMetadata["provider_adapter"] != "najiz" ||
		req.EvidenceMetadata["provider_portal"] != "najiz_moj" ||
		req.EvidenceMetadata["najiz_seal"] != "seal-1" {
		t.Fatalf("evidence metadata = %#v", req.EvidenceMetadata)
	}
}

func TestTranslateNajizCallbackMapsDeclineReason(t *testing.T) {
	payload := `{"request_id":"NJZ-1","status":"declined","reason":"signer rejected terms"}`
	req, err := TranslateNajizCallback([]byte(payload), "", "")
	if err != nil {
		t.Fatalf("TranslateNajizCallback() error = %v", err)
	}
	req.Normalize()
	eventType, err := signatureEventTypeForProviderStatus(req.ProviderStatus)
	if err != nil {
		t.Fatalf("signatureEventTypeForProviderStatus() error = %v", err)
	}
	if eventType != model.SignatureEventDeclined {
		t.Fatalf("event type = %s, want declined", eventType)
	}
	if req.DeclineReason == nil || *req.DeclineReason != "signer rejected terms" {
		t.Fatalf("decline reason = %v", req.DeclineReason)
	}
	if req.Reason == nil || *req.Reason != "signer rejected terms" {
		t.Fatalf("reason = %v", req.Reason)
	}
}

func TestTranslateNajizCallbackRejectsInvalidPayload(t *testing.T) {
	cases := map[string]string{
		"empty body":     "",
		"invalid json":   "not-json",
		"missing status": `{"request_id":"NJZ-1"}`,
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := TranslateNajizCallback([]byte(payload), "", "")
			if err == nil {
				t.Fatalf("TranslateNajizCallback(%q) error = nil, want validation error", payload)
			}
			var appErr *apperrors.AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("error type = %T, want AppError", err)
			}
		})
	}
}

// TestNajizCallbackHMACValidationEndToEnd exercises the FULL inbound seam: a Najiz
// callback is translated, then run through the SAME validateSignatureProviderWebhook
// HMAC check used by every provider webhook. A genuine signature validates; a
// tampered one fails closed with 403.
func TestNajizCallbackHMACValidationEndToEnd(t *testing.T) {
	secret := "najiz-callback-secret"
	timestamp := "2026-06-16T11:00:00Z"
	recipientID := uuid.New()
	payload := `{"request_id":"NJZ-REQ-1","status":"completed","najiz_signatory_id":"NJZ-SIG-1","signatory_ref":"` + recipientID.String() + `"}`
	signature := signNajizCallbackTestPayload(secret, timestamp, payload)

	envelope := &model.SignatureEnvelope{
		Provider:         model.SignatureProviderNajiz,
		EvidenceMetadata: map[string]any{"webhook_secret": secret, "provider_envelope_id": "NJZ-REQ-1"},
	}

	req, err := TranslateNajizCallback([]byte(payload), signature, timestamp)
	if err != nil {
		t.Fatalf("TranslateNajizCallback() error = %v", err)
	}
	req.Normalize()

	validated, err := validateSignatureProviderWebhook(envelope, &req)
	if err != nil {
		t.Fatalf("validateSignatureProviderWebhook() error = %v", err)
	}
	if !validated {
		t.Fatal("validateSignatureProviderWebhook() validated = false, want true")
	}
	// Envelope validation must accept the matching najiz envelope.
	if err := validateSignatureProviderEnvelope(envelope, req); err != nil {
		t.Fatalf("validateSignatureProviderEnvelope() error = %v", err)
	}

	tampered, err := TranslateNajizCallback([]byte(payload), "sha256=deadbeef", timestamp)
	if err != nil {
		t.Fatalf("TranslateNajizCallback() error = %v", err)
	}
	tampered.Normalize()
	validated, err = validateSignatureProviderWebhook(envelope, &tampered)
	if err == nil {
		t.Fatal("validateSignatureProviderWebhook() error = nil, want invalid signature")
	}
	if validated {
		t.Fatal("validateSignatureProviderWebhook() validated = true, want false")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
		t.Fatalf("error = %v, want 403 forbidden", err)
	}
}

func TestBuildSignatureCustodyEvidenceAcceptsNajizProvider(t *testing.T) {
	now := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	completedAt := now.Add(-5 * time.Minute)
	sealHash := "sha256:najiz-seal"
	envelope := &model.SignatureEnvelope{
		ID:          uuid.New(),
		Status:      model.SignatureEnvelopeSigned,
		Provider:    model.SignatureProviderNajiz,
		CompletedAt: &completedAt,
	}
	req := dto.RecordSignatureCustodyRequest{
		FileID:      "najiz-file-1",
		FileName:    "signed-najiz.pdf",
		ContentHash: "sha256:content",
		SealHash:    &sealHash,
	}
	custody, _, err := buildSignatureCustodyEvidence(uuid.New(), uuid.New(), envelope, req, now)
	if err != nil {
		t.Fatalf("buildSignatureCustodyEvidence() error = %v", err)
	}
	if custody.Provider != model.SignatureProviderNajiz {
		t.Fatalf("custody provider = %s, want najiz", custody.Provider)
	}
}

func signNajizCallbackTestPayload(secret, timestamp, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(payload))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
