package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestHTTPSignatureProviderDispatcherDispatchesAndMapsProof(t *testing.T) {
	now := time.Date(2026, 6, 14, 15, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	envelopeID := uuid.New()
	recipientID := uuid.New()
	providerEnvelopeID := "nafath-envelope-123"
	providerRecipientID := "nafath-recipient-456"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer provider-secret" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Clario360-Tenant-ID") != tenantID.String() {
			t.Fatalf("tenant header = %q, want %s", r.Header.Get("X-Clario360-Tenant-ID"), tenantID)
		}
		var req httpSignatureProviderDispatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.EnvelopeID != envelopeID.String() || req.Provider != model.SignatureProviderNafath {
			t.Fatalf("request envelope/provider = %s/%s", req.EnvelopeID, req.Provider)
		}
		if len(req.Recipients) != 1 || req.Recipients[0].ID != recipientID.String() {
			t.Fatalf("request recipients = %#v", req.Recipients)
		}
		_ = json.NewEncoder(w).Encode(httpSignatureProviderDispatchResponse{
			ProviderStatus:     "sent",
			DeliveryStatus:     "accepted",
			ProviderEventID:    "nafath-event-789",
			ProviderEnvelopeID: providerEnvelopeID,
			EvidenceHash:       "sha256:http-provider-proof",
			EvidenceMetadata:   map[string]any{"provider_trace_id": "trace-1"},
			Recipients: []httpSignatureProviderDispatchRecipientAck{
				{RecipientID: recipientID.String(), ProviderRecipientID: providerRecipientID},
			},
		})
	}))
	defer server.Close()

	dispatcher, err := NewHTTPSignatureProviderDispatcher(HTTPSignatureProviderDispatcherConfig{
		Endpoint: server.URL,
		APIKey:   "provider-secret",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPSignatureProviderDispatcher() error = %v", err)
	}
	envelope := &model.SignatureEnvelope{
		ID:       envelopeID,
		TenantID: tenantID,
		Provider: model.SignatureProviderNafath,
		Title:    "Board approval",
		Subject:  "Please sign",
		Message:  "Review and sign",
		Recipients: []model.SignatureRecipient{
			{ID: recipientID, TenantID: tenantID, EnvelopeID: envelopeID, Name: "Signer", Role: model.SignatureRecipientSigner, Method: model.SignatureMethodNafath, SigningOrder: 1},
		},
	}

	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), envelope, dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if dispatch.ProviderEnvelopeID != providerEnvelopeID {
		t.Fatalf("provider envelope id = %q, want %q", dispatch.ProviderEnvelopeID, providerEnvelopeID)
	}
	if dispatch.ProviderRecipientIDs[recipientID] != providerRecipientID {
		t.Fatalf("provider recipient ids = %#v", dispatch.ProviderRecipientIDs)
	}
	if dispatch.EvidenceHash == nil || *dispatch.EvidenceHash != "sha256:http-provider-proof" {
		t.Fatalf("evidence hash = %v", dispatch.EvidenceHash)
	}
	if dispatch.EvidenceMetadata["provider_adapter"] != "http" || dispatch.EvidenceMetadata["provider_trace_id"] != "trace-1" {
		t.Fatalf("evidence metadata = %#v", dispatch.EvidenceMetadata)
	}
}

func TestHTTPSignatureProviderDispatcherFailsOnProviderRejection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "missing provider credential", http.StatusUnauthorized)
	}))
	defer server.Close()
	dispatcher, err := NewHTTPSignatureProviderDispatcher(HTTPSignatureProviderDispatcherConfig{
		Endpoint: server.URL,
		APIKey:   "provider-secret",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPSignatureProviderDispatcher() error = %v", err)
	}

	_, err = dispatcher.DispatchSignatureEnvelope(context.Background(), &model.SignatureEnvelope{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Provider: model.SignatureProviderExternal,
	}, dto.SendSignatureEnvelopeRequest{}, time.Now())
	if err == nil {
		t.Fatal("DispatchSignatureEnvelope() error = nil, want provider rejection")
	}
}
