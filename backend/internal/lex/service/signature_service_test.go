package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateCreateSignatureEnvelopeRequestRequiresSingleTargetAndRecipient(t *testing.T) {
	req := dto.CreateSignatureEnvelopeRequest{
		Title:      "Signature pack",
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		Recipients: []dto.CreateSignatureRecipientRequest{{Name: "Signer"}},
	}
	req.Normalize()

	err := validateCreateSignatureEnvelopeRequest(req)
	if err == nil {
		t.Fatal("validateCreateSignatureEnvelopeRequest() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["target"] == "" || appErr.Fields["recipients.contact"] == "" {
		t.Fatalf("fields = %#v, want target and contact errors", appErr.Fields)
	}

	contractID := uuid.New()
	email := "signer@example.com"
	req.ContractID = &contractID
	req.Recipients[0].Email = &email
	req.Normalize()
	if err := validateCreateSignatureEnvelopeRequest(req); err != nil {
		t.Fatalf("validateCreateSignatureEnvelopeRequest() error = %v", err)
	}

	internalUserID := uuid.New()
	req.Recipients[0] = dto.CreateSignatureRecipientRequest{UserID: &internalUserID}
	req.Normalize()
	if err := validateCreateSignatureEnvelopeRequest(req); err != nil {
		t.Fatalf("internal recipient should receive its canonical name from IAM: %v", err)
	}
}

type stubSignatureUserDirectory struct {
	identity *SignatureUserIdentity
	err      error
	tenantID uuid.UUID
	userID   uuid.UUID
}

func (s *stubSignatureUserDirectory) ResolveSignatureUser(_ context.Context, tenantID, userID uuid.UUID) (*SignatureUserIdentity, error) {
	s.tenantID = tenantID
	s.userID = userID
	return s.identity, s.err
}

func TestCanonicalizeInternalSignatureRecipientsUsesActiveTenantIAMIdentity(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	directory := &stubSignatureUserDirectory{identity: &SignatureUserIdentity{
		ID:       userID,
		TenantID: tenantID,
		Name:     "  AlMashura   Legal Director ",
		Email:    "Director@AlMashura.Demo ",
		Status:   "active",
	}}
	svc := NewSignatureService(nil, nil, nil, nil, nil, "", zerolog.Nop())
	svc.SetUserDirectory(directory)
	req := dto.CreateSignatureEnvelopeRequest{Recipients: []dto.CreateSignatureRecipientRequest{{
		UserID: &userID,
	}}}

	if err := svc.canonicalizeInternalSignatureRecipients(context.Background(), tenantID, &req); err != nil {
		t.Fatalf("canonicalizeInternalSignatureRecipients() error = %v", err)
	}
	if directory.tenantID != tenantID || directory.userID != userID {
		t.Fatalf("directory lookup = tenant %s user %s, want %s/%s", directory.tenantID, directory.userID, tenantID, userID)
	}
	recipient := req.Recipients[0]
	if recipient.Name != "AlMashura Legal Director" {
		t.Fatalf("canonical name = %q", recipient.Name)
	}
	if recipient.Email == nil || *recipient.Email != "director@almashura.demo" {
		t.Fatalf("canonical email = %v", recipient.Email)
	}
	proof, ok := recipient.EvidenceMetadata["internal_identity"].(map[string]any)
	if !ok || proof["validated"] != true || proof["user_id"] != userID.String() || proof["tenant_id"] != tenantID.String() {
		t.Fatalf("identity proof = %#v", recipient.EvidenceMetadata["internal_identity"])
	}
}

func TestCanonicalizeInternalSignatureRecipientsRejectsUntrustedIdentity(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	tests := []struct {
		name      string
		directory SignatureUserDirectory
		recipient dto.CreateSignatureRecipientRequest
		field     string
	}{
		{
			name: "unknown user",
			directory: &stubSignatureUserDirectory{
				err: pgx.ErrNoRows,
			},
			recipient: dto.CreateSignatureRecipientRequest{UserID: &userID},
			field:     "recipients.user_id",
		},
		{
			name: "other tenant",
			directory: &stubSignatureUserDirectory{identity: &SignatureUserIdentity{
				ID: userID, TenantID: uuid.New(), Name: "Legal Director", Email: "director@almashura.demo", Status: "active",
			}},
			recipient: dto.CreateSignatureRecipientRequest{UserID: &userID},
			field:     "recipients.user_id",
		},
		{
			name: "inactive user",
			directory: &stubSignatureUserDirectory{identity: &SignatureUserIdentity{
				ID: userID, TenantID: tenantID, Name: "Legal Director", Email: "director@almashura.demo", Status: "suspended",
			}},
			recipient: dto.CreateSignatureRecipientRequest{UserID: &userID},
			field:     "recipients.user_id",
		},
		{
			name: "mismatched name",
			directory: &stubSignatureUserDirectory{identity: &SignatureUserIdentity{
				ID: userID, TenantID: tenantID, Name: "Legal Director", Email: "director@almashura.demo", Status: "active",
			}},
			recipient: dto.CreateSignatureRecipientRequest{UserID: &userID, Name: "Different Person"},
			field:     "recipients.name",
		},
		{
			name: "mismatched email",
			directory: &stubSignatureUserDirectory{identity: &SignatureUserIdentity{
				ID: userID, TenantID: tenantID, Name: "Legal Director", Email: "director@almashura.demo", Status: "active",
			}},
			recipient: dto.CreateSignatureRecipientRequest{UserID: &userID, Name: "Legal Director", Email: ptrString("attacker@example.test")},
			field:     "recipients.email",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewSignatureService(nil, nil, nil, nil, nil, "", zerolog.Nop())
			svc.SetUserDirectory(tc.directory)
			req := dto.CreateSignatureEnvelopeRequest{Recipients: []dto.CreateSignatureRecipientRequest{tc.recipient}}
			err := svc.canonicalizeInternalSignatureRecipients(context.Background(), tenantID, &req)
			if err == nil {
				t.Fatal("canonicalizeInternalSignatureRecipients() error = nil")
			}
			var appErr *apperrors.AppError
			if !errors.As(err, &appErr) || appErr.Fields[tc.field] == "" {
				t.Fatalf("error = %#v, want validation field %s", err, tc.field)
			}
		})
	}
}

func TestCanonicalizeInternalSignatureRecipientsFailsClosedWithoutIAM(t *testing.T) {
	userID := uuid.New()
	svc := NewSignatureService(nil, nil, nil, nil, nil, "", zerolog.Nop())
	req := dto.CreateSignatureEnvelopeRequest{Recipients: []dto.CreateSignatureRecipientRequest{{UserID: &userID}}}

	if err := svc.canonicalizeInternalSignatureRecipients(context.Background(), uuid.New(), &req); err == nil {
		t.Fatal("canonicalizeInternalSignatureRecipients() error = nil, want unavailable IAM error")
	}
}

func TestValidateContractReadyForSignatureFailClosed(t *testing.T) {
	contract := &model.Contract{ID: uuid.New(), Status: model.ContractStatusLegalReview}
	if err := validateContractReadyForSignature(contract, 0); err == nil {
		t.Fatal("validateContractReadyForSignature() error = nil, want status conflict")
	}

	contract.Status = model.ContractStatusPendingSignature
	if err := validateContractReadyForSignature(contract, 1); err == nil {
		t.Fatal("validateContractReadyForSignature() error = nil, want compliance conflict")
	}
	if err := validateContractReadyForSignature(contract, 0); err != nil {
		t.Fatalf("validateContractReadyForSignature() error = %v", err)
	}
}

func TestAllRequiredRecipientsSignedIgnoresCarbonCopies(t *testing.T) {
	recipients := []model.SignatureRecipient{
		{ID: uuid.New(), Role: model.SignatureRecipientSigner, Status: model.SignatureRecipientSigned},
		{ID: uuid.New(), Role: model.SignatureRecipientApprover, Status: model.SignatureRecipientSigned},
		{ID: uuid.New(), Role: model.SignatureRecipientCarbonCopy, Status: model.SignatureRecipientSent},
	}
	if !allRequiredRecipientsSigned(recipients) {
		t.Fatal("allRequiredRecipientsSigned() = false, want true")
	}
	recipients[1].Status = model.SignatureRecipientViewed
	if allRequiredRecipientsSigned(recipients) {
		t.Fatal("allRequiredRecipientsSigned() = true, want false")
	}
}

func TestDeterministicSignatureProviderDispatcherProducesOutboundProof(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	recipientID := uuid.New()
	envelope := &model.SignatureEnvelope{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Provider: model.SignatureProviderExternal,
		Recipients: []model.SignatureRecipient{
			{ID: recipientID, Provider: model.SignatureProviderExternal},
		},
	}
	dispatcher := DeterministicSignatureProviderDispatcher{}

	dispatch, err := dispatcher.DispatchSignatureEnvelope(context.Background(), envelope, dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("DispatchSignatureEnvelope() error = %v", err)
	}
	if dispatch.Provider != model.SignatureProviderExternal {
		t.Fatalf("provider = %s, want external", dispatch.Provider)
	}
	if dispatch.ProviderEnvelopeID == "" || dispatch.ProviderRecipientIDs[recipientID] == "" {
		t.Fatalf("dispatch ids = envelope %q recipients %#v, want provider ids", dispatch.ProviderEnvelopeID, dispatch.ProviderRecipientIDs)
	}
	if dispatch.DeliveryStatus != "accepted" || dispatch.ProviderStatus != "sent" {
		t.Fatalf("statuses = delivery %q provider %q, want accepted/sent", dispatch.DeliveryStatus, dispatch.ProviderStatus)
	}
	if dispatch.EvidenceHash == nil || *dispatch.EvidenceHash == "" {
		t.Fatalf("evidence hash = %v, want deterministic hash", dispatch.EvidenceHash)
	}
	if dispatch.EvidenceMetadata["provider_envelope_id"] != dispatch.ProviderEnvelopeID {
		t.Fatalf("metadata provider envelope id = %#v, want %s", dispatch.EvidenceMetadata["provider_envelope_id"], dispatch.ProviderEnvelopeID)
	}
	if dispatch.EvidenceMetadata["provider_dispatch_mode"] != "deterministic_local" {
		t.Fatalf("dispatch mode = %#v, want deterministic_local", dispatch.EvidenceMetadata["provider_dispatch_mode"])
	}

	repeated, err := dispatcher.DispatchSignatureEnvelope(context.Background(), envelope, dto.SendSignatureEnvelopeRequest{}, now)
	if err != nil {
		t.Fatalf("repeated DispatchSignatureEnvelope() error = %v", err)
	}
	if repeated.ProviderEnvelopeID != dispatch.ProviderEnvelopeID || *repeated.EvidenceHash != *dispatch.EvidenceHash {
		t.Fatalf("repeated dispatch = id %q hash %q, want id %q hash %q", repeated.ProviderEnvelopeID, *repeated.EvidenceHash, dispatch.ProviderEnvelopeID, *dispatch.EvidenceHash)
	}
}

func TestSignatureServiceSetProviderDispatcherResetsToDefault(t *testing.T) {
	service := NewSignatureService(nil, nil, nil, nil, nil, "", zerolog.Nop())
	service.SetProviderDispatcher(nil)

	if _, ok := service.dispatcher.(DeterministicSignatureProviderDispatcher); !ok {
		t.Fatalf("dispatcher = %T, want DeterministicSignatureProviderDispatcher", service.dispatcher)
	}
}

func TestApplySignatureProviderDispatchPersistsProofAndRecipientIDs(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 15, 0, 0, time.UTC)
	recipientID := uuid.New()
	providerEventID := "external-event-1"
	evidenceHash := "sha256:provider-dispatch"
	envelope := &model.SignatureEnvelope{
		ID:               uuid.New(),
		TenantID:         uuid.New(),
		Status:           model.SignatureEnvelopeSent,
		Provider:         model.SignatureProviderExternal,
		EvidenceMetadata: map[string]any{"existing": "envelope"},
		Recipients: []model.SignatureRecipient{
			{
				ID:               recipientID,
				Role:             model.SignatureRecipientSigner,
				Status:           model.SignatureRecipientDraft,
				Provider:         model.SignatureProviderExternal,
				EvidenceMetadata: map[string]any{"existing": "recipient"},
			},
		},
	}
	dispatch := &SignatureProviderDispatch{
		Provider:             model.SignatureProviderExternal,
		Adapter:              "external.test",
		ProviderStatus:       "sent",
		DeliveryStatus:       "accepted",
		ProviderEventID:      &providerEventID,
		ProviderEnvelopeID:   "external-env-1",
		ProviderRecipientIDs: map[uuid.UUID]string{recipientID: "external-recipient-1"},
		EvidenceHash:         &evidenceHash,
		EvidenceMetadata:     map[string]any{"proof": "adapter"},
	}

	if err := applySignatureProviderDispatch(envelope, dispatch, now); err != nil {
		t.Fatalf("applySignatureProviderDispatch() error = %v", err)
	}
	if envelope.EvidenceHash == nil || *envelope.EvidenceHash != evidenceHash {
		t.Fatalf("envelope evidence hash = %v, want %s", envelope.EvidenceHash, evidenceHash)
	}
	if envelope.EvidenceMetadata["provider_envelope_id"] != "external-env-1" ||
		envelope.EvidenceMetadata["provider_delivery_status"] != "accepted" ||
		envelope.EvidenceMetadata["provider_event_id"] != providerEventID {
		t.Fatalf("envelope metadata = %#v, want provider dispatch proof", envelope.EvidenceMetadata)
	}
	recipient := envelope.Recipients[0]
	if recipient.Status != model.SignatureRecipientSent {
		t.Fatalf("recipient status = %s, want sent", recipient.Status)
	}
	if recipient.ProviderRecipientID == nil || *recipient.ProviderRecipientID != "external-recipient-1" {
		t.Fatalf("recipient provider id = %v, want external-recipient-1", recipient.ProviderRecipientID)
	}
	if recipient.EvidenceMetadata["provider_delivery_status"] != "accepted" {
		t.Fatalf("recipient metadata = %#v, want delivery status", recipient.EvidenceMetadata)
	}
}

func TestApplySignatureProviderDispatchRequiresRecipientProof(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 30, 0, 0, time.UTC)
	envelope := &model.SignatureEnvelope{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Status:   model.SignatureEnvelopeSent,
		Provider: model.SignatureProviderNafath,
		Recipients: []model.SignatureRecipient{
			{ID: uuid.New(), Role: model.SignatureRecipientSigner, Status: model.SignatureRecipientDraft, Provider: model.SignatureProviderNafath},
		},
	}
	dispatch := &SignatureProviderDispatch{
		Provider:           model.SignatureProviderNafath,
		ProviderEnvelopeID: "nafath-env-1",
		DeliveryStatus:     "accepted",
	}

	err := applySignatureProviderDispatch(envelope, dispatch, now)
	if err == nil {
		t.Fatal("applySignatureProviderDispatch() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["recipients.0.provider_recipient_id"] == "" {
		t.Fatalf("fields = %#v, want missing provider recipient id", appErr.Fields)
	}
}

func TestApplySignatureProviderEventSignsFinalRecipientAndCompletesEnvelope(t *testing.T) {
	now := time.Date(2026, 6, 14, 10, 30, 0, 0, time.UTC)
	recipientID := uuid.New()
	providerRecipientID := "nafath-recipient-1"
	evidenceHash := "provider-proof-hash"
	recipient := &model.SignatureRecipient{
		ID:               recipientID,
		Role:             model.SignatureRecipientSigner,
		Status:           model.SignatureRecipientSent,
		Provider:         model.SignatureProviderNafath,
		EvidenceMetadata: map[string]any{"existing": "recipient"},
	}
	envelope := &model.SignatureEnvelope{
		ID:               uuid.New(),
		Status:           model.SignatureEnvelopeSent,
		Provider:         model.SignatureProviderNafath,
		EvidenceMetadata: map[string]any{"existing": "envelope"},
		Recipients:       []model.SignatureRecipient{*recipient},
	}
	req := dto.SignatureProviderEventRequest{
		Provider:            model.SignatureProviderNafath,
		ProviderStatus:      "signed",
		ProviderRecipientID: &providerRecipientID,
		EvidenceHash:        &evidenceHash,
		EvidenceMetadata:    map[string]any{"proof": "nafath"},
	}

	eventType, err := signatureEventTypeForProviderStatus(req.ProviderStatus)
	if err != nil {
		t.Fatalf("signatureEventTypeForProviderStatus() error = %v", err)
	}
	if err := applySignatureProviderEvent(envelope, recipient, req, eventType, uuid.New(), now); err != nil {
		t.Fatalf("applySignatureProviderEvent() error = %v", err)
	}

	if recipient.Status != model.SignatureRecipientSigned {
		t.Fatalf("recipient status = %s, want signed", recipient.Status)
	}
	if recipient.SignedAt == nil || !recipient.SignedAt.Equal(now) {
		t.Fatalf("recipient signed_at = %v, want %v", recipient.SignedAt, now)
	}
	if recipient.ProviderRecipientID == nil || *recipient.ProviderRecipientID != providerRecipientID {
		t.Fatalf("recipient provider id = %v, want %s", recipient.ProviderRecipientID, providerRecipientID)
	}
	if recipient.EvidenceHash == nil || *recipient.EvidenceHash != evidenceHash {
		t.Fatalf("recipient evidence hash = %v, want %s", recipient.EvidenceHash, evidenceHash)
	}
	if envelope.Status != model.SignatureEnvelopeSigned {
		t.Fatalf("envelope status = %s, want signed", envelope.Status)
	}
	if envelope.CompletedAt == nil || !envelope.CompletedAt.Equal(now) {
		t.Fatalf("envelope completed_at = %v, want %v", envelope.CompletedAt, now)
	}
	if envelope.EvidenceMetadata["proof"] != "nafath" {
		t.Fatalf("envelope evidence metadata = %#v, want proof metadata", envelope.EvidenceMetadata)
	}
}

func TestBuildSignatureCustodyEvidenceRequiresCompletedEnvelope(t *testing.T) {
	now := time.Date(2026, 6, 14, 11, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	userID := uuid.New()
	evidenceHash := "custody-proof-hash"
	req := dto.RecordSignatureCustodyRequest{
		FileID:        "file-1",
		FileName:      "signed-contract.pdf",
		FileSizeBytes: 128_000,
		ContentHash:   "sha256:content",
		EvidenceHash:  &evidenceHash,
	}
	envelope := &model.SignatureEnvelope{
		ID:       uuid.New(),
		Status:   model.SignatureEnvelopeSent,
		Provider: model.SignatureProviderNative,
	}

	_, _, err := buildSignatureCustodyEvidence(tenantID, userID, envelope, req, now)
	if err == nil {
		t.Fatal("buildSignatureCustodyEvidence() error = nil, want conflict")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusConflict {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusConflict)
	}
}

func TestBuildSignatureCustodyEvidenceForCompletedEnvelope(t *testing.T) {
	now := time.Date(2026, 6, 14, 11, 0, 0, 0, time.UTC)
	completedAt := now.Add(-10 * time.Minute)
	tenantID := uuid.New()
	userID := uuid.New()
	sealHash := "seal-hash"
	req := dto.RecordSignatureCustodyRequest{
		FileID:            "file-1",
		FileName:          "signed-contract.pdf",
		FileSizeBytes:     128_000,
		ContentHash:       "sha256:content",
		SealHash:          &sealHash,
		RetentionMetadata: map[string]any{"retain_until": "2033-01-01"},
		CustodyMetadata:   map[string]any{"vault": "local"},
	}
	envelope := &model.SignatureEnvelope{
		ID:          uuid.New(),
		Status:      model.SignatureEnvelopeSigned,
		Provider:    model.SignatureProviderNafath,
		CompletedAt: &completedAt,
	}

	custody, eventEvidenceHash, err := buildSignatureCustodyEvidence(tenantID, userID, envelope, req, now)
	if err != nil {
		t.Fatalf("buildSignatureCustodyEvidence() error = %v", err)
	}
	if custody.TenantID != tenantID || custody.EnvelopeID != envelope.ID || custody.CreatedBy != userID {
		t.Fatalf("custody ownership = tenant %s envelope %s created_by %s", custody.TenantID, custody.EnvelopeID, custody.CreatedBy)
	}
	if custody.Provider != model.SignatureProviderNafath {
		t.Fatalf("provider = %s, want envelope provider", custody.Provider)
	}
	if !custody.SignedAt.Equal(completedAt) {
		t.Fatalf("signed_at = %v, want %v", custody.SignedAt, completedAt)
	}
	if eventEvidenceHash == nil || *eventEvidenceHash != sealHash {
		t.Fatalf("event evidence hash = %v, want seal hash", eventEvidenceHash)
	}
	metadata := signatureCustodyEventMetadata(custody)
	if metadata["content_hash"] != "sha256:content" || metadata["seal_hash"] != sealHash {
		t.Fatalf("custody event metadata = %#v, want hashes", metadata)
	}
}

func TestSignatureProviderWebhookValidationHMAC(t *testing.T) {
	secret := "local-signature-secret"
	timestamp := "2026-06-14T11:00:00Z"
	payload := `{"provider":"nafath","provider_status":"signed"}`
	signature := signSignatureWebhookTestPayload(secret, timestamp, payload)
	envelope := &model.SignatureEnvelope{
		EvidenceMetadata: map[string]any{"webhook_secret": secret},
	}
	req := dto.SignatureProviderEventRequest{
		Provider:         model.SignatureProviderNafath,
		ProviderStatus:   "signed",
		WebhookTimestamp: &timestamp,
		WebhookPayload:   &payload,
		WebhookSignature: &signature,
		EvidenceMetadata: map[string]any{},
	}
	req.Normalize()

	validated, err := validateSignatureProviderWebhook(envelope, &req)
	if err != nil {
		t.Fatalf("validateSignatureProviderWebhook() error = %v", err)
	}
	if !validated {
		t.Fatal("validateSignatureProviderWebhook() validated = false, want true")
	}

	badSignature := "sha256=deadbeef"
	req.WebhookSignature = &badSignature
	validated, err = validateSignatureProviderWebhook(envelope, &req)
	if err == nil {
		t.Fatal("validateSignatureProviderWebhook() error = nil, want invalid signature")
	}
	if validated {
		t.Fatal("validateSignatureProviderWebhook() validated = true, want false")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusForbidden)
	}
}

func TestSignatureProviderEventValidationFailClosed(t *testing.T) {
	envelope := &model.SignatureEnvelope{
		Provider:         model.SignatureProviderNafath,
		EvidenceMetadata: map[string]any{"provider_envelope_id": "nafath-env-1"},
	}

	mismatchReq := dto.SignatureProviderEventRequest{
		Provider:       model.SignatureProviderExternal,
		ProviderStatus: "signed",
	}
	mismatchReq.Normalize()
	err := validateSignatureProviderEnvelope(envelope, mismatchReq)
	if err == nil {
		t.Fatal("validateSignatureProviderEnvelope() error = nil, want provider mismatch")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusConflict {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusConflict)
	}

	invalidStatus := "queued"
	if _, err := signatureEventTypeForProviderStatus(invalidStatus); err == nil {
		t.Fatalf("signatureEventTypeForProviderStatus(%q) error = nil, want validation error", invalidStatus)
	}

	providerEnvelopeID := "other-env"
	envelopeMismatchReq := dto.SignatureProviderEventRequest{
		Provider:           model.SignatureProviderNafath,
		ProviderStatus:     "signed",
		ProviderEnvelopeID: &providerEnvelopeID,
	}
	envelopeMismatchReq.Normalize()
	err = validateSignatureProviderEnvelope(envelope, envelopeMismatchReq)
	if err == nil {
		t.Fatal("validateSignatureProviderEnvelope() error = nil, want provider envelope mismatch")
	}
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusConflict {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusConflict)
	}
}

func signSignatureWebhookTestPayload(secret, timestamp, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(payload))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
