package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedSignatureRecipientRoles = map[model.SignatureRecipientRole]struct{}{
	model.SignatureRecipientSigner:     {},
	model.SignatureRecipientApprover:   {},
	model.SignatureRecipientCarbonCopy: {},
}

var allowedSignatureProviders = map[model.SignatureProvider]struct{}{
	model.SignatureProviderNative:   {},
	model.SignatureProviderNafath:   {},
	model.SignatureProviderNajiz:    {},
	model.SignatureProviderExternal: {},
}

var allowedSignatureMethods = map[model.SignatureMethod]struct{}{
	model.SignatureMethodOTP:          {},
	model.SignatureMethodNafath:       {},
	model.SignatureMethodCertificate:  {},
	model.SignatureMethodWetSignature: {},
}

const maxSignatureAssetBytes = 512 * 1024
const signaturePlacementsMetadataKey = "native_signature_placements"
const signaturePlacementSchemaVersion = "native-placement-v1"

var allowedSignaturePlacementKinds = map[string]struct{}{
	"signature": {},
	"initials":  {},
	"name":      {},
	"date":      {},
}

type SignatureService struct {
	db            *pgxpool.Pool
	signatures    *repository.SignatureRepository
	contracts     *repository.ContractRepository
	documents     *repository.DocumentRepository
	userDirectory SignatureUserDirectory
	publisher     Publisher
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
	dispatcher    SignatureProviderDispatcher
}

func NewSignatureService(db *pgxpool.Pool, signatures *repository.SignatureRepository, contracts *repository.ContractRepository, documents *repository.DocumentRepository, publisher Publisher, topic string, logger zerolog.Logger) *SignatureService {
	return &SignatureService{
		db:         db,
		signatures: signatures,
		contracts:  contracts,
		documents:  documents,
		publisher:  publisherOrNoop(publisher),
		topic:      topic,
		logger:     logger.With().Str("service", "lex-signatures").Logger(),
		now:        time.Now,
		dispatcher: DeterministicSignatureProviderDispatcher{},
	}
}

func (s *SignatureService) SetProviderDispatcher(dispatcher SignatureProviderDispatcher) {
	if dispatcher == nil {
		s.dispatcher = DeterministicSignatureProviderDispatcher{}
		return
	}
	s.dispatcher = dispatcher
}

// SetUserDirectory wires the platform IAM identity source used for internal
// recipients. A recipient carrying user_id is rejected when this directory is
// unavailable, so an unverified UUID can never silently become a signer.
func (s *SignatureService) SetUserDirectory(directory SignatureUserDirectory) {
	s.userDirectory = directory
}

type SignatureProviderDispatcher interface {
	DispatchSignatureEnvelope(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error)
}

type SignatureProviderDispatch struct {
	Provider             model.SignatureProvider
	Adapter              string
	ProviderStatus       string
	DeliveryStatus       string
	ProviderEventID      *string
	ProviderEnvelopeID   string
	ProviderRecipientIDs map[uuid.UUID]string
	EvidenceHash         *string
	EvidenceMetadata     map[string]any
}

type DeterministicSignatureProviderDispatcher struct{}

func (DeterministicSignatureProviderDispatcher) DispatchSignatureEnvelope(_ context.Context, envelope *model.SignatureEnvelope, _ dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	if envelope == nil {
		return nil, validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	provider := envelope.Provider
	if provider == "" {
		provider = model.SignatureProviderNative
	}
	adapter := fmt.Sprintf("%s.deterministic", provider)
	providerEnvelopeID := deterministicProviderID(provider, "env", envelope.ID)
	providerEventID := providerEnvelopeID + ".sent"
	providerRecipientIDs := make(map[uuid.UUID]string, len(envelope.Recipients))
	for _, recipient := range envelope.Recipients {
		providerRecipientIDs[recipient.ID] = deterministicProviderID(provider, "rec", recipient.ID)
	}
	evidenceHash := deterministicSignatureDispatchHash(envelope, providerEnvelopeID, providerRecipientIDs)
	metadata := map[string]any{
		"provider_adapter":         adapter,
		"provider_dispatch_mode":   "deterministic_local",
		"provider_delivery_status": "accepted",
		"provider_dispatched_at":   now.Format(time.RFC3339Nano),
		"provider_envelope_id":     providerEnvelopeID,
		"provider_event_id":        providerEventID,
		"provider_outbound_proof": map[string]any{
			"adapter":              adapter,
			"delivery_status":      "accepted",
			"dispatch_mode":        "deterministic_local",
			"evidence_hash":        evidenceHash,
			"provider_envelope_id": providerEnvelopeID,
			"recipient_count":      len(envelope.Recipients),
		},
	}
	return &SignatureProviderDispatch{
		Provider:             provider,
		Adapter:              adapter,
		ProviderStatus:       "sent",
		DeliveryStatus:       "accepted",
		ProviderEventID:      &providerEventID,
		ProviderEnvelopeID:   providerEnvelopeID,
		ProviderRecipientIDs: providerRecipientIDs,
		EvidenceHash:         &evidenceHash,
		EvidenceMetadata:     metadata,
	}, nil
}

func (s *SignatureService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateSignatureEnvelopeRequest) (*model.SignatureEnvelope, error) {
	req.Normalize()
	if err := validateCreateSignatureEnvelopeRequest(req); err != nil {
		return nil, err
	}
	if err := s.canonicalizeInternalSignatureRecipients(ctx, tenantID, &req); err != nil {
		return nil, err
	}
	targetType, err := s.validateSignatureTarget(ctx, tenantID, req.ContractID, req.DocumentID)
	if err != nil {
		return nil, err
	}
	envelope := &model.SignatureEnvelope{
		ID:               uuid.New(),
		TenantID:         tenantID,
		TargetType:       targetType,
		ContractID:       req.ContractID,
		DocumentID:       req.DocumentID,
		Title:            req.Title,
		Subject:          req.Subject,
		Message:          req.Message,
		Language:         req.Language,
		SubjectAr:        req.SubjectAr,
		MessageAr:        req.MessageAr,
		LegalConsentEn:   req.LegalConsentEn,
		LegalConsentAr:   req.LegalConsentAr,
		Status:           model.SignatureEnvelopeDraft,
		Provider:         req.Provider,
		Method:           req.Method,
		DueAt:            req.DueAt,
		ExpiresAt:        req.ExpiresAt,
		EvidenceMetadata: req.EvidenceMetadata,
		CreatedBy:        userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.CreateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("create signature envelope", err)
	}
	for _, recipientReq := range req.Recipients {
		method := req.Method
		if recipientReq.Method != nil {
			method = *recipientReq.Method
		}
		recipient := &model.SignatureRecipient{
			ID:                  uuid.New(),
			TenantID:            tenantID,
			EnvelopeID:          envelope.ID,
			UserID:              recipientReq.UserID,
			Name:                recipientReq.Name,
			Email:               recipientReq.Email,
			Phone:               recipientReq.Phone,
			Role:                recipientReq.Role,
			Language:            recipientReq.Language,
			Status:              model.SignatureRecipientDraft,
			Provider:            req.Provider,
			Method:              method,
			SigningOrder:        recipientReq.SigningOrder,
			ProviderRecipientID: recipientReq.ProviderRecipientID,
			EvidenceMetadata:    recipientReq.EvidenceMetadata,
		}
		if err := s.signatures.CreateRecipient(ctx, tx, recipient); err != nil {
			return nil, internalError("create signature recipient", err)
		}
	}
	if err := s.signatures.AddEvent(ctx, tx, newSignatureEvent(tenantID, envelope.ID, nil, model.SignatureEventCreated, &userID, nil, nil, nil, nil, nil, req.EvidenceMetadata, s.now().UTC())); err != nil {
		return nil, internalError("record signature event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.created", tenantID, &userID, map[string]any{
		"id":          envelope.ID,
		"target_type": envelope.TargetType,
		"contract_id": envelope.ContractID,
		"document_id": envelope.DocumentID,
		"status":      envelope.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, envelope.ID)
}

func (s *SignatureService) List(ctx context.Context, tenantID uuid.UUID, filters model.SignatureEnvelopeListFilters) ([]model.SignatureEnvelope, int, error) {
	return s.signatures.ListEnvelopes(ctx, tenantID, filters)
}

func (s *SignatureService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.SignatureEnvelope, error) {
	envelope, err := s.signatures.GetEnvelope(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("signature envelope not found")
		}
		return nil, internalError("load signature envelope", err)
	}
	return envelope, nil
}

func (s *SignatureService) GetUserProfile(ctx context.Context, tenantID, userID uuid.UUID) (*model.SignatureUserProfile, error) {
	profile, err := s.signatures.GetUserProfile(ctx, tenantID, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, internalError("load signature profile", err)
	}
	return profile, nil
}

func (s *SignatureService) UpsertUserProfile(ctx context.Context, tenantID, userID uuid.UUID, req dto.UpsertSignatureUserProfileRequest) (*model.SignatureUserProfile, error) {
	req.Normalize()
	profile, err := buildSignatureUserProfile(tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	if err := s.signatures.UpsertUserProfile(ctx, s.db, profile); err != nil {
		return nil, internalError("save signature profile", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.profile_saved", tenantID, &userID, map[string]any{
		"user_id":                 userID,
		"signature_image_hash":    profile.SignatureImageHash,
		"initials_image_hash":     profile.InitialsImageHash,
		"signature_asset_present": profile.SignatureImageHash != nil,
		"initials_asset_present":  profile.InitialsImageHash != nil,
	}, s.logger)
	return s.GetUserProfile(ctx, tenantID, userID)
}

func (s *SignatureService) DeleteUserProfile(ctx context.Context, tenantID, userID uuid.UUID) error {
	if err := s.signatures.DeleteUserProfile(ctx, s.db, tenantID, userID); err != nil {
		return internalError("delete signature profile", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.profile_deleted", tenantID, &userID, map[string]any{
		"user_id": userID,
	}, s.logger)
	return nil
}

func (s *SignatureService) UpsertPlacements(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpsertSignaturePlacementsRequest) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if !canEditSignaturePlacements(envelope) {
		return nil, conflictError("signature placements cannot be changed after recipient action")
	}
	if err := validateSignaturePlacements(envelope, req.Placements); err != nil {
		return nil, err
	}
	metadata := mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
	metadata[signaturePlacementsMetadataKey] = signaturePlacementsMetadata(req.Placements)
	metadata["native_signature_placement_schema"] = signaturePlacementSchemaVersion
	metadata["native_signature_placements_updated_at"] = s.now().UTC().Format(time.RFC3339Nano)
	metadata["native_signature_placements_updated_by"] = userID.String()
	envelope.EvidenceMetadata = metadata

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature placements transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("save signature placements", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature placements", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.placements_saved", tenantID, &userID, map[string]any{
		"id":              id,
		"placement_count": len(req.Placements),
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

// RenderRecipientText returns the bilingual-aware signing content (subject,
// message, legal-consent notice) in the correct language for a recipient
// (WTQ-SIG-01). For en/ar it returns that locale; for bilingual it returns both
// Arabic (primary) and English (secondary).
func (s *SignatureService) RenderRecipientText(ctx context.Context, tenantID, envelopeID, recipientID uuid.UUID) (*model.RenderedSignatureText, error) {
	envelope, err := s.Get(ctx, tenantID, envelopeID)
	if err != nil {
		return nil, err
	}
	recipient, err := s.signatures.GetRecipient(ctx, tenantID, envelopeID, recipientID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("signature recipient not found")
		}
		return nil, internalError("load signature recipient", err)
	}
	rendered := envelope.RenderForRecipient(recipient)
	return &rendered, nil
}

func (s *SignatureService) Send(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.SendSignatureEnvelopeRequest) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if req.ExpiresAt != nil {
		envelope.ExpiresAt = req.ExpiresAt
	}
	if err := s.validateEnvelopeReadyForSend(ctx, tenantID, envelope); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	envelope.Status = model.SignatureEnvelopeSent
	envelope.SentAt = &now
	if req.Message != nil {
		envelope.Message = *req.Message
	}
	envelope.EvidenceHash = req.EvidenceHash
	envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
	dispatch, err := s.dispatchSignatureEnvelope(ctx, envelope, req, now)
	if err != nil {
		return nil, err
	}
	if err := applySignatureProviderDispatch(envelope, dispatch, now); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature send transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("send signature envelope", err)
	}
	for i := range envelope.Recipients {
		recipient := envelope.Recipients[i]
		if err := s.signatures.UpdateRecipient(ctx, tx, &recipient); err != nil {
			return nil, internalError("mark signature recipient sent", err)
		}
	}
	event := newSignatureEvent(tenantID, id, nil, model.SignatureEventSent, &userID, nil, nil, nil, nil, envelope.EvidenceHash, dispatchEventMetadata(dispatch), now)
	event.Provider = &envelope.Provider
	providerStatus := dispatch.ProviderStatus
	event.ProviderStatus = &providerStatus
	event.ProviderEventID = dispatch.ProviderEventID
	event.ProviderEnvelopeID = &dispatch.ProviderEnvelopeID
	if err := s.signatures.AddEvent(ctx, tx, event); err != nil {
		return nil, internalError("record signature sent event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature send", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.sent", tenantID, &userID, map[string]any{
		"id":                   id,
		"target_type":          envelope.TargetType,
		"contract_id":          envelope.ContractID,
		"document_id":          envelope.DocumentID,
		"provider":             envelope.Provider,
		"provider_envelope_id": dispatch.ProviderEnvelopeID,
		"delivery_status":      dispatch.DeliveryStatus,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *SignatureService) RecipientAction(ctx context.Context, tenantID, userID, envelopeID, recipientID uuid.UUID, req dto.SignatureRecipientActionRequest, ipAddress, userAgent *string) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, envelopeID)
	if err != nil {
		return nil, err
	}
	recipient, err := s.signatures.GetRecipient(ctx, tenantID, envelopeID, recipientID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("signature recipient not found")
		}
		return nil, internalError("load signature recipient", err)
	}
	now := s.now().UTC()
	if err := s.rejectExpiredEnvelope(ctx, tenantID, userID, envelope, now); err != nil {
		return nil, err
	}
	if err := validateRecipientAction(envelope, recipient, req.Action); err != nil {
		return nil, err
	}
	if req.Action == dto.SignatureRecipientActionDecline && req.DeclineReason == nil {
		return nil, validationError("decline reason is required", map[string]string{"decline_reason": "required"})
	}

	eventType := model.SignatureEventViewed
	switch req.Action {
	case dto.SignatureRecipientActionView:
		eventType = model.SignatureEventViewed
		recipient.Status = model.SignatureRecipientViewed
		if recipient.ViewedAt == nil {
			recipient.ViewedAt = &now
		}
		if envelope.Status == model.SignatureEnvelopeSent {
			envelope.Status = model.SignatureEnvelopeViewed
		}
	case dto.SignatureRecipientActionSign:
		eventType = model.SignatureEventSigned
		recipient.Status = model.SignatureRecipientSigned
		if recipient.ViewedAt == nil {
			recipient.ViewedAt = &now
		}
		recipient.SignedAt = &now
		recipient.EvidenceHash = req.EvidenceHash
		recipient.EvidenceMetadata = mergeMetadata(recipient.EvidenceMetadata, req.EvidenceMetadata)
		for i := range envelope.Recipients {
			if envelope.Recipients[i].ID == recipient.ID {
				envelope.Recipients[i] = *recipient
				break
			}
		}
		if allRequiredRecipientsSigned(envelope.Recipients) {
			envelope.Status = model.SignatureEnvelopeSigned
			envelope.CompletedAt = &now
			envelope.EvidenceHash = req.EvidenceHash
			envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
		}
	case dto.SignatureRecipientActionDecline:
		eventType = model.SignatureEventDeclined
		recipient.Status = model.SignatureRecipientDeclined
		recipient.DeclinedAt = &now
		recipient.DeclineReason = req.DeclineReason
		recipient.EvidenceHash = req.EvidenceHash
		recipient.EvidenceMetadata = mergeMetadata(recipient.EvidenceMetadata, req.EvidenceMetadata)
		envelope.Status = model.SignatureEnvelopeDeclined
		envelope.CompletedAt = &now
	default:
		return nil, validationError("invalid signature recipient action", map[string]string{"action": "invalid"})
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature action transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.UpdateRecipient(ctx, tx, recipient); err != nil {
		return nil, internalError("update signature recipient", err)
	}
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("update signature envelope", err)
	}
	if envelope.Status == model.SignatureEnvelopeSigned && envelope.ContractID != nil {
		if err := s.activateContractAfterSignature(ctx, tx, tenantID, *envelope.ContractID, userID, now); err != nil {
			return nil, err
		}
	}
	if err := s.signatures.AddEvent(ctx, tx, newSignatureEvent(tenantID, envelopeID, &recipientID, eventType, &userID, req.ActorName, req.ActorEmail, ipAddress, userAgent, req.EvidenceHash, req.EvidenceMetadata, now)); err != nil {
		return nil, internalError("record signature recipient event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature recipient action", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.recipient_action", tenantID, &userID, map[string]any{
		"id":           envelopeID,
		"recipient_id": recipientID,
		"action":       req.Action,
		"status":       envelope.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, envelopeID)
}

func (s *SignatureService) activateContractAfterSignature(
	ctx context.Context,
	tx pgx.Tx,
	tenantID, contractID, userID uuid.UUID,
	signedAt time.Time,
) error {
	// Lock and validate the actual contract state in the same transaction that
	// records the completed envelope/recipient evidence. A late native action or
	// provider callback must not reactivate a contract that was cancelled while
	// its envelope was open.
	var current model.ContractStatus
	if err := tx.QueryRow(ctx, `
		SELECT status
		FROM contracts
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`, tenantID, contractID).Scan(&current); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("signature contract not found")
		}
		return internalError("lock signature contract", err)
	}
	if err := validateContractSignatureTransition(string(current), string(model.ContractStatusActive)); err != nil {
		return conflictError("contract must remain pending_signature until signature completion")
	}
	if err := s.contracts.UpdateStatus(ctx, tx, tenantID, contractID, &current, model.ContractStatusActive, &userID, signedAt, &signedAt); err != nil {
		return internalError("activate signed contract", err)
	}
	return nil
}

func (s *SignatureService) SelfRecipientAction(ctx context.Context, tenantID, userID uuid.UUID, userEmail string, envelopeID, recipientID uuid.UUID, req dto.SignatureRecipientActionRequest, ipAddress, userAgent *string) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, envelopeID)
	if err != nil {
		return nil, err
	}
	recipient, err := s.signatures.GetRecipient(ctx, tenantID, envelopeID, recipientID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("signature recipient not found")
		}
		return nil, internalError("load signature recipient", err)
	}
	if !signatureRecipientBelongsToUser(recipient, userID, userEmail) {
		return nil, forbiddenError("you can only sign your own recipient record")
	}

	if req.ActorEmail == nil && strings.TrimSpace(userEmail) != "" {
		email := strings.ToLower(strings.TrimSpace(userEmail))
		req.ActorEmail = &email
	}
	if req.ActorName == nil {
		name := strings.TrimSpace(recipient.Name)
		if profile, err := s.signatures.GetUserProfile(ctx, tenantID, userID); err == nil && strings.TrimSpace(profile.TypedName) != "" {
			name = profile.TypedName
		} else if err != nil && err != pgx.ErrNoRows {
			return nil, internalError("load signature profile", err)
		}
		if name != "" {
			req.ActorName = &name
		}
	}
	if req.Action == dto.SignatureRecipientActionSign {
		profile, err := s.signatures.GetUserProfile(ctx, tenantID, userID)
		if err != nil && err != pgx.ErrNoRows {
			return nil, internalError("load signature profile", err)
		}
		req.EvidenceMetadata = mergeMetadata(req.EvidenceMetadata, signaturePlacementEvidence(envelope, recipientID))
		if profile != nil {
			req.EvidenceMetadata = mergeMetadata(req.EvidenceMetadata, signatureProfileEvidence(profile))
			if req.EvidenceHash == nil && profile.SignatureImageHash != nil {
				hash := "sha256:" + *profile.SignatureImageHash
				req.EvidenceHash = &hash
			}
		}
	}
	return s.RecipientAction(ctx, tenantID, userID, envelopeID, recipientID, req, ipAddress, userAgent)
}

func (s *SignatureService) ProviderEvent(ctx context.Context, tenantID, userID, envelopeID uuid.UUID, req dto.SignatureProviderEventRequest, ipAddress, userAgent *string) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, envelopeID)
	if err != nil {
		return nil, err
	}
	webhookValidated, err := validateSignatureProviderWebhook(envelope, &req)
	if err != nil {
		return nil, err
	}
	scrubSignatureWebhookMetadata(req.EvidenceMetadata)
	if webhookValidated {
		req.EvidenceMetadata["webhook_signature_validated"] = true
	}
	if err := validateSignatureProviderEnvelope(envelope, req); err != nil {
		return nil, err
	}
	// Idempotent provider-event handling. Providers (DocuSign Connect, Adobe Sign,
	// Najiz, emdha) retry callback delivery; a duplicate carrying a provider event
	// id we have already recorded must be a safe no-op — never re-run the FSM or
	// re-emit a domain event. The dedup check runs AFTER signature verification so
	// an unverified replay is still rejected (fail-closed) before this point.
	if req.ProviderEventID != nil {
		seen, err := s.signatures.ProviderEventExists(ctx, s.db, tenantID, req.Provider, *req.ProviderEventID)
		if err != nil {
			return nil, internalError("check signature provider event idempotency", err)
		}
		if seen {
			s.logger.Debug().
				Str("envelope_id", envelopeID.String()).
				Str("provider", string(req.Provider)).
				Str("provider_event_id", *req.ProviderEventID).
				Msg("duplicate signature provider event ignored (idempotent)")
			return s.Get(ctx, tenantID, envelopeID)
		}
	}
	eventType, err := signatureEventTypeForProviderStatus(req.ProviderStatus)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	eventTime := now
	if req.OccurredAt != nil {
		eventTime = req.OccurredAt.UTC()
		if eventTime.After(now.Add(5 * time.Minute)) {
			return nil, validationError("provider event occurred_at cannot be in the future", map[string]string{"occurred_at": "must not be in the future"})
		}
	}
	if eventType != model.SignatureEventExpired {
		if err := s.rejectExpiredEnvelope(ctx, tenantID, userID, envelope, now); err != nil {
			return nil, err
		}
	}

	recipient, err := s.resolveSignatureProviderRecipient(ctx, tenantID, envelopeID, req, providerEventRequiresRecipient(eventType))
	if err != nil {
		return nil, err
	}
	if err := applySignatureProviderEvent(envelope, recipient, req, eventType, userID, eventTime); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature provider event transaction", err)
	}
	defer tx.Rollback(ctx)
	if recipient != nil && providerEventRequiresRecipient(eventType) {
		if err := s.signatures.UpdateRecipient(ctx, tx, recipient); err != nil {
			return nil, internalError("update signature provider recipient", err)
		}
	}
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("update signature provider envelope", err)
	}
	if envelope.Status == model.SignatureEnvelopeSigned && envelope.ContractID != nil {
		if err := s.activateContractAfterSignature(ctx, tx, tenantID, *envelope.ContractID, userID, eventTime); err != nil {
			return nil, err
		}
	}
	switch eventType {
	case model.SignatureEventCancelled:
		if err := s.signatures.CancelOpenRecipients(ctx, tx, tenantID, envelopeID); err != nil {
			return nil, internalError("cancel provider signature recipients", err)
		}
	case model.SignatureEventExpired:
		if err := s.signatures.ExpireOpenRecipients(ctx, tx, tenantID, envelopeID); err != nil {
			return nil, internalError("expire provider signature recipients", err)
		}
	}
	var recipientID *uuid.UUID
	if recipient != nil {
		recipientID = &recipient.ID
	}
	if err := s.signatures.AddEvent(ctx, tx, newSignatureProviderEvent(tenantID, envelopeID, recipientID, eventType, &userID, req, ipAddress, userAgent, eventTime)); err != nil {
		// TOCTOU backstop for the dedup fast-path above. The ProviderEventExists
		// SELECT can be bypassed by two concurrent identical callbacks (providers
		// retry); the UNIQUE partial index idx_signature_events_provider_event
		// (migration 000070) then rejects the second insert with 23505. Treat that
		// as an idempotent no-op: roll back this txn (so no envelope/recipient
		// mutation persists for the loser) and return the current envelope, exactly
		// like the ProviderEventExists hit. Only the provider-event uniqueness is
		// swallowed; any other unique violation is a real error.
		if req.ProviderEventID != nil && isUniqueViolationOn(err, "idx_signature_events_provider_event") {
			_ = tx.Rollback(ctx)
			s.logger.Debug().
				Str("envelope_id", envelopeID.String()).
				Str("provider", string(req.Provider)).
				Str("provider_event_id", *req.ProviderEventID).
				Msg("concurrent duplicate signature provider event ignored (unique violation, idempotent)")
			return s.Get(ctx, tenantID, envelopeID)
		}
		return nil, internalError("record signature provider event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature provider event", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.provider_event", tenantID, &userID, map[string]any{
		"id":                   envelopeID,
		"recipient_id":         recipientID,
		"provider":             req.Provider,
		"provider_status":      req.ProviderStatus,
		"provider_event_id":    req.ProviderEventID,
		"provider_envelope_id": req.ProviderEnvelopeID,
		"status":               envelope.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, envelopeID)
}

func (s *SignatureService) RecordCustody(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.RecordSignatureCustodyRequest, ipAddress, userAgent *string) (*model.SignatureEnvelope, error) {
	req.Normalize()
	envelope, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	custody, eventEvidenceHash, err := buildSignatureCustodyEvidence(tenantID, userID, envelope, req, now)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature custody transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.CreateCustodyEvidence(ctx, tx, custody); err != nil {
		return nil, internalError("record signature custody evidence", err)
	}
	event := newSignatureEvent(tenantID, id, nil, model.SignatureEventCustody, &userID, nil, nil, ipAddress, userAgent, eventEvidenceHash, signatureCustodyEventMetadata(custody), now)
	provider := custody.Provider
	event.Provider = &provider
	if err := s.signatures.AddEvent(ctx, tx, event); err != nil {
		return nil, internalError("record signature custody event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature custody", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.custody_recorded", tenantID, &userID, map[string]any{
		"id":            id,
		"custody_id":    custody.ID,
		"file_id":       custody.FileID,
		"content_hash":  custody.ContentHash,
		"evidence_hash": eventEvidenceHash,
		"provider":      custody.Provider,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *SignatureService) Cancel(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.CancelSignatureEnvelopeRequest) (*model.SignatureEnvelope, error) {
	req.Normalize()
	if req.Reason == "" {
		return nil, validationError("cancellation reason is required", map[string]string{"reason": "required"})
	}
	envelope, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if !canCancelSignatureEnvelope(envelope.Status) {
		return nil, conflictError("signature envelope cannot be cancelled from its current status")
	}
	now := s.now().UTC()
	envelope.Status = model.SignatureEnvelopeCancelled
	envelope.CancelledAt = &now
	envelope.CancelledBy = &userID
	envelope.CancellationReason = &req.Reason
	envelope.EvidenceHash = req.EvidenceHash
	envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start signature cancel transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return nil, internalError("cancel signature envelope", err)
	}
	if err := s.signatures.CancelOpenRecipients(ctx, tx, tenantID, id); err != nil {
		return nil, internalError("cancel signature recipients", err)
	}
	if err := s.signatures.AddEvent(ctx, tx, newSignatureEvent(tenantID, id, nil, model.SignatureEventCancelled, &userID, nil, nil, nil, nil, req.EvidenceHash, req.EvidenceMetadata, now)); err != nil {
		return nil, internalError("record signature cancel event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit signature cancel", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.signature.cancelled", tenantID, &userID, map[string]any{
		"id":     id,
		"reason": req.Reason,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *SignatureService) validateSignatureTarget(ctx context.Context, tenantID uuid.UUID, contractID, documentID *uuid.UUID) (model.SignatureTargetType, error) {
	if contractID != nil {
		if _, err := s.contracts.Get(ctx, tenantID, *contractID); err != nil {
			if err == pgx.ErrNoRows {
				return "", validationError("contract not found", map[string]string{"contract_id": "not found"})
			}
			return "", internalError("load signature contract target", err)
		}
		return model.SignatureTargetContract, nil
	}
	if documentID != nil {
		if _, err := s.documents.Get(ctx, tenantID, *documentID); err != nil {
			if err == pgx.ErrNoRows {
				return "", validationError("document not found", map[string]string{"document_id": "not found"})
			}
			return "", internalError("load signature document target", err)
		}
		return model.SignatureTargetDocument, nil
	}
	return "", validationError("signature target is required", map[string]string{"contract_id": "contract_id or document_id required", "document_id": "contract_id or document_id required"})
}

func (s *SignatureService) resolveSignatureProviderRecipient(ctx context.Context, tenantID, envelopeID uuid.UUID, req dto.SignatureProviderEventRequest, required bool) (*model.SignatureRecipient, error) {
	if req.RecipientID == nil && req.ProviderRecipientID == nil {
		if required {
			return nil, validationError("signature provider recipient is required", map[string]string{"recipient_id": "recipient_id or provider_recipient_id required"})
		}
		return nil, nil
	}
	var recipient *model.SignatureRecipient
	var err error
	if req.RecipientID != nil {
		recipient, err = s.signatures.GetRecipient(ctx, tenantID, envelopeID, *req.RecipientID)
	} else {
		recipient, err = s.signatures.GetRecipientByProviderRecipientID(ctx, tenantID, envelopeID, req.Provider, *req.ProviderRecipientID)
	}
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("signature provider recipient not found")
		}
		return nil, internalError("load signature provider recipient", err)
	}
	if err := validateSignatureProviderRecipient(recipient, req); err != nil {
		return nil, err
	}
	return recipient, nil
}

func (s *SignatureService) validateEnvelopeReadyForSend(ctx context.Context, tenantID uuid.UUID, envelope *model.SignatureEnvelope) error {
	if envelope.Status != model.SignatureEnvelopeDraft {
		return conflictError("only draft signature envelopes can be sent")
	}
	if len(envelope.Recipients) == 0 {
		return validationError("at least one signature recipient is required", map[string]string{"recipients": "required"})
	}
	now := s.now().UTC()
	if envelope.ExpiresAt != nil && !envelope.ExpiresAt.After(now) {
		return validationError("signature expiry must be in the future", map[string]string{"expires_at": "must be in the future"})
	}
	if envelope.ContractID == nil {
		return nil
	}
	contract, err := s.contracts.Get(ctx, tenantID, *envelope.ContractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return validationError("contract not found or deleted", map[string]string{"contract_id": "not found"})
		}
		return internalError("load contract before signature send", err)
	}
	blockingAlerts, err := s.signatures.CountBlockingComplianceAlerts(ctx, tenantID, *envelope.ContractID)
	if err != nil {
		return internalError("check pre-signature compliance alerts", err)
	}
	return validateContractReadyForSignature(contract, blockingAlerts)
}

func (s *SignatureService) dispatchSignatureEnvelope(ctx context.Context, envelope *model.SignatureEnvelope, req dto.SendSignatureEnvelopeRequest, now time.Time) (*SignatureProviderDispatch, error) {
	dispatcher := s.dispatcher
	if dispatcher == nil {
		dispatcher = DeterministicSignatureProviderDispatcher{}
	}
	dispatch, err := dispatcher.DispatchSignatureEnvelope(ctx, envelope, req, now)
	if err != nil {
		return nil, internalError("dispatch signature envelope to provider", err)
	}
	if dispatch == nil {
		return nil, internalError("dispatch signature envelope to provider", fmt.Errorf("provider dispatch returned nil"))
	}
	dispatch.EvidenceMetadata = mergeMetadata(req.EvidenceMetadata, dispatch.EvidenceMetadata)
	return dispatch, nil
}

func applySignatureProviderDispatch(envelope *model.SignatureEnvelope, dispatch *SignatureProviderDispatch, now time.Time) error {
	if envelope == nil {
		return validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	if dispatch == nil {
		return validationError("signature provider dispatch is required", map[string]string{"dispatch": "required"})
	}
	fields := map[string]string{}
	provider := dispatch.Provider
	if provider == "" {
		provider = envelope.Provider
		dispatch.Provider = provider
	}
	if provider != envelope.Provider {
		fields["provider"] = "must match envelope provider"
	}
	if strings.TrimSpace(dispatch.ProviderEnvelopeID) == "" {
		fields["provider_envelope_id"] = "required"
	}
	if strings.TrimSpace(dispatch.DeliveryStatus) == "" {
		dispatch.DeliveryStatus = "accepted"
	}
	if strings.TrimSpace(dispatch.ProviderStatus) == "" {
		dispatch.ProviderStatus = "sent"
	}
	if strings.TrimSpace(dispatch.Adapter) == "" {
		dispatch.Adapter = string(provider)
	}
	for i := range envelope.Recipients {
		recipient := &envelope.Recipients[i]
		providerRecipientID := ""
		if dispatch.ProviderRecipientIDs != nil {
			providerRecipientID = strings.TrimSpace(dispatch.ProviderRecipientIDs[recipient.ID])
		}
		if providerRecipientID == "" && recipient.ProviderRecipientID != nil {
			providerRecipientID = strings.TrimSpace(*recipient.ProviderRecipientID)
		}
		if providerRecipientID == "" {
			fields[fmt.Sprintf("recipients.%d.provider_recipient_id", i)] = "required"
			continue
		}
		recipient.Provider = provider
		recipient.Status = model.SignatureRecipientSent
		recipient.ProviderRecipientID = &providerRecipientID
		recipient.EvidenceMetadata = mergeMetadata(recipient.EvidenceMetadata, map[string]any{
			"provider_recipient_id":    providerRecipientID,
			"provider_delivery_status": dispatch.DeliveryStatus,
			"provider_dispatched_at":   now.Format(time.RFC3339Nano),
		})
	}
	if len(fields) > 0 {
		return validationError("invalid signature provider dispatch", fields)
	}
	if dispatch.EvidenceHash != nil && envelope.EvidenceHash == nil {
		envelope.EvidenceHash = dispatch.EvidenceHash
	}
	dispatchMetadata := mergeMetadata(dispatch.EvidenceMetadata, map[string]any{
		"provider_adapter":         dispatch.Adapter,
		"provider_status":          dispatch.ProviderStatus,
		"provider_delivery_status": dispatch.DeliveryStatus,
		"provider_envelope_id":     dispatch.ProviderEnvelopeID,
		"provider_dispatched_at":   now.Format(time.RFC3339Nano),
	})
	if dispatch.ProviderEventID != nil {
		dispatchMetadata["provider_event_id"] = *dispatch.ProviderEventID
	}
	envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, dispatchMetadata)
	return nil
}

func dispatchEventMetadata(dispatch *SignatureProviderDispatch) map[string]any {
	if dispatch == nil {
		return map[string]any{}
	}
	metadata := mergeMetadata(dispatch.EvidenceMetadata)
	metadata["provider_adapter"] = dispatch.Adapter
	metadata["provider_status"] = dispatch.ProviderStatus
	metadata["provider_delivery_status"] = dispatch.DeliveryStatus
	metadata["provider_envelope_id"] = dispatch.ProviderEnvelopeID
	if dispatch.ProviderEventID != nil {
		metadata["provider_event_id"] = *dispatch.ProviderEventID
	}
	if dispatch.EvidenceHash != nil {
		metadata["evidence_hash"] = *dispatch.EvidenceHash
	}
	return metadata
}

func deterministicProviderID(provider model.SignatureProvider, kind string, id uuid.UUID) string {
	return fmt.Sprintf("%s-%s-%s", provider, kind, id.String())
}

func deterministicSignatureDispatchHash(envelope *model.SignatureEnvelope, providerEnvelopeID string, providerRecipientIDs map[uuid.UUID]string) string {
	h := sha256.New()
	_, _ = fmt.Fprintf(h, "tenant=%s\n", envelope.TenantID)
	_, _ = fmt.Fprintf(h, "envelope=%s\n", envelope.ID)
	_, _ = fmt.Fprintf(h, "provider=%s\n", envelope.Provider)
	_, _ = fmt.Fprintf(h, "provider_envelope_id=%s\n", providerEnvelopeID)
	recipientIDs := make([]string, 0, len(providerRecipientIDs))
	for recipientID := range providerRecipientIDs {
		recipientIDs = append(recipientIDs, recipientID.String())
	}
	sort.Strings(recipientIDs)
	for _, rawRecipientID := range recipientIDs {
		recipientID := uuid.MustParse(rawRecipientID)
		_, _ = fmt.Fprintf(h, "recipient=%s:%s\n", rawRecipientID, providerRecipientIDs[recipientID])
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

func validateCreateSignatureEnvelopeRequest(req dto.CreateSignatureEnvelopeRequest) error {
	fields := map[string]string{}
	if req.Title == "" {
		fields["title"] = "required"
	}
	if (req.ContractID == nil && req.DocumentID == nil) || (req.ContractID != nil && req.DocumentID != nil) {
		fields["target"] = "exactly one of contract_id or document_id is required"
	}
	if _, ok := allowedSignatureProviders[req.Provider]; !ok {
		fields["provider"] = "invalid"
	}
	if _, ok := allowedSignatureMethods[req.Method]; !ok {
		fields["method"] = "invalid"
	}
	if req.Language != "" && !model.IsValidSignatureLanguage(req.Language) {
		fields["language"] = "invalid"
	}
	if len(req.Recipients) == 0 {
		fields["recipients"] = "required"
	}
	requiredRecipients := 0
	for i, recipient := range req.Recipients {
		prefix := "recipients"
		if len(req.Recipients) > 1 {
			prefix = fmt.Sprintf("recipients.%d", i)
		}
		// Internal recipients are named from the canonical IAM record after this
		// structural validation. External recipients still have to supply a name.
		if strings.TrimSpace(recipient.Name) == "" && recipient.UserID == nil {
			fields[prefix+".name"] = "required"
		}
		if recipient.Email == nil && recipient.Phone == nil && recipient.UserID == nil {
			fields[prefix+".contact"] = "email, phone, or user_id required"
		}
		if _, ok := allowedSignatureRecipientRoles[recipient.Role]; !ok {
			fields[prefix+".role"] = "invalid"
		} else if recipient.Role != model.SignatureRecipientCarbonCopy {
			requiredRecipients++
		}
		if recipient.Method == nil {
			fields[prefix+".method"] = "required"
		} else if _, ok := allowedSignatureMethods[*recipient.Method]; !ok {
			fields[prefix+".method"] = "invalid"
		}
		if recipient.SigningOrder < 0 {
			fields[prefix+".signing_order"] = "must be non-negative"
		}
		if recipient.Language != nil && !model.IsValidSignatureLanguage(*recipient.Language) {
			fields[prefix+".language"] = "invalid"
		}
	}
	if len(req.Recipients) > 0 && requiredRecipients == 0 {
		fields["recipients"] = "at least one signer or approver required"
	}
	if req.ExpiresAt != nil && req.DueAt != nil && req.ExpiresAt.Before(*req.DueAt) {
		fields["expires_at"] = "must be after due_at"
	}
	if len(fields) > 0 {
		return validationError("invalid signature envelope request", fields)
	}
	return nil
}

func validateContractReadyForSignature(contract *model.Contract, blockingAlerts int) error {
	if contract == nil {
		return validationError("contract not found", map[string]string{"contract_id": "not found"})
	}
	if contract.DeletedAt != nil {
		return validationError("contract not found or deleted", map[string]string{"contract_id": "deleted"})
	}
	if contract.Status != model.ContractStatusPendingSignature {
		return conflictError("contract must be pending_signature before signature send")
	}
	if blockingAlerts > 0 {
		return conflictError("contract has unresolved high or critical compliance alerts")
	}
	return nil
}

func validateRecipientAction(envelope *model.SignatureEnvelope, recipient *model.SignatureRecipient, action dto.SignatureRecipientAction) error {
	if envelope.Status != model.SignatureEnvelopeSent && envelope.Status != model.SignatureEnvelopeViewed {
		return conflictError("signature envelope is not open for recipient action")
	}
	switch recipient.Status {
	case model.SignatureRecipientSent, model.SignatureRecipientViewed:
	default:
		return conflictError("signature recipient is not open for action")
	}
	if recipient.Role == model.SignatureRecipientCarbonCopy && action != dto.SignatureRecipientActionView {
		return validationError("carbon copy recipients can only view", map[string]string{"action": "invalid for carbon_copy"})
	}
	switch action {
	case dto.SignatureRecipientActionView, dto.SignatureRecipientActionSign, dto.SignatureRecipientActionDecline:
		return nil
	default:
		return validationError("invalid signature recipient action", map[string]string{"action": "invalid"})
	}
}

func signatureEventTypeForProviderStatus(status string) (model.SignatureEventType, error) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "view", "viewed", "recipient_viewed", "envelope_viewed":
		return model.SignatureEventViewed, nil
	case "sign", "signed", "complete", "completed", "recipient_signed", "signature_completed":
		return model.SignatureEventSigned, nil
	case "decline", "declined", "rejected", "recipient_declined":
		return model.SignatureEventDeclined, nil
	case "cancel", "cancelled", "canceled", "voided":
		return model.SignatureEventCancelled, nil
	case "expire", "expired", "timed_out", "timeout":
		return model.SignatureEventExpired, nil
	default:
		return "", validationError("unsupported signature provider status", map[string]string{"provider_status": "unsupported"})
	}
}

func providerEventRequiresRecipient(eventType model.SignatureEventType) bool {
	switch eventType {
	case model.SignatureEventViewed, model.SignatureEventSigned, model.SignatureEventDeclined:
		return true
	default:
		return false
	}
}

func validateSignatureProviderEnvelope(envelope *model.SignatureEnvelope, req dto.SignatureProviderEventRequest) error {
	fields := map[string]string{}
	if req.Provider == "" {
		fields["provider"] = "required"
	} else if _, ok := allowedSignatureProviders[req.Provider]; !ok {
		fields["provider"] = "invalid"
	}
	if strings.TrimSpace(req.ProviderStatus) == "" {
		fields["provider_status"] = "required"
	}
	if len(fields) > 0 {
		return validationError("invalid signature provider event", fields)
	}
	if req.Provider != envelope.Provider {
		return conflictError("signature provider does not match envelope provider")
	}
	if req.ProviderEnvelopeID != nil {
		if existing := metadataString(envelope.EvidenceMetadata, "provider_envelope_id"); existing != "" && existing != *req.ProviderEnvelopeID {
			return conflictError("signature provider envelope id does not match envelope evidence")
		}
	}
	return nil
}

func validateSignatureProviderRecipient(recipient *model.SignatureRecipient, req dto.SignatureProviderEventRequest) error {
	if recipient.Provider != req.Provider {
		return conflictError("signature provider does not match recipient provider")
	}
	if req.ProviderRecipientID != nil && recipient.ProviderRecipientID != nil && *recipient.ProviderRecipientID != *req.ProviderRecipientID {
		return conflictError("signature provider recipient id does not match recipient")
	}
	return nil
}

func buildSignatureCustodyEvidence(tenantID, userID uuid.UUID, envelope *model.SignatureEnvelope, req dto.RecordSignatureCustodyRequest, now time.Time) (*model.SignatureCustodyEvidence, *string, error) {
	req.Normalize()
	if envelope == nil {
		return nil, nil, validationError("signature envelope is required", map[string]string{"envelope": "required"})
	}
	if envelope.Status != model.SignatureEnvelopeSigned || envelope.CompletedAt == nil {
		return nil, nil, conflictError("signed-file custody can only be recorded after signature completion")
	}
	provider := req.Provider
	if provider == "" {
		provider = envelope.Provider
	}
	signedAt := envelope.CompletedAt.UTC()
	if req.SignedAt != nil {
		signedAt = req.SignedAt.UTC()
	}

	fields := map[string]string{}
	if req.FileID == "" {
		fields["file_id"] = "required"
	}
	if req.FileName == "" {
		fields["file_name"] = "required"
	}
	if req.FileSizeBytes < 0 {
		fields["file_size_bytes"] = "must be non-negative"
	}
	if req.ContentHash == "" {
		fields["content_hash"] = "required"
	}
	if req.EvidenceHash == nil && req.SealHash == nil {
		fields["evidence_hash"] = "evidence_hash or seal_hash required"
	}
	if _, ok := allowedSignatureProviders[provider]; !ok {
		fields["provider"] = "invalid"
	}
	if signedAt.After(now.Add(5 * time.Minute)) {
		fields["signed_at"] = "must not be in the future"
	}
	if len(fields) > 0 {
		return nil, nil, validationError("invalid signature custody evidence", fields)
	}

	eventEvidenceHash := req.EvidenceHash
	if eventEvidenceHash == nil {
		eventEvidenceHash = req.SealHash
	}
	custody := &model.SignatureCustodyEvidence{
		ID:                uuid.New(),
		TenantID:          tenantID,
		EnvelopeID:        envelope.ID,
		FileID:            req.FileID,
		FileName:          req.FileName,
		FileSizeBytes:     req.FileSizeBytes,
		ContentHash:       req.ContentHash,
		SealHash:          req.SealHash,
		EvidenceHash:      req.EvidenceHash,
		Provider:          provider,
		SignedAt:          signedAt,
		RetentionMetadata: req.RetentionMetadata,
		CustodyMetadata:   req.CustodyMetadata,
		CreatedBy:         userID,
	}
	return custody, eventEvidenceHash, nil
}

func signatureCustodyEventMetadata(custody *model.SignatureCustodyEvidence) map[string]any {
	metadata := map[string]any{
		"custody_id":         custody.ID,
		"file_id":            custody.FileID,
		"file_name":          custody.FileName,
		"file_size_bytes":    custody.FileSizeBytes,
		"content_hash":       custody.ContentHash,
		"provider":           custody.Provider,
		"signed_at":          custody.SignedAt,
		"retention_metadata": custody.RetentionMetadata,
		"custody_metadata":   custody.CustodyMetadata,
	}
	if custody.SealHash != nil {
		metadata["seal_hash"] = *custody.SealHash
	}
	if custody.EvidenceHash != nil {
		metadata["evidence_hash"] = *custody.EvidenceHash
	}
	return metadata
}

var signatureWebhookSecretMetadataKeys = []string{
	"webhook_secret",
	"provider_webhook_secret",
	"signature_secret",
	"shared_secret",
	"hmac_secret",
}

var signatureWebhookSignatureMetadataKeys = []string{
	"webhook_signature",
	"provider_webhook_signature",
	"signature",
	"hmac_signature",
}

var signatureWebhookTimestampMetadataKeys = []string{
	"webhook_timestamp",
	"provider_webhook_timestamp",
	"signature_timestamp",
}

func validateSignatureProviderWebhook(envelope *model.SignatureEnvelope, req *dto.SignatureProviderEventRequest) (bool, error) {
	if req == nil {
		return false, nil
	}
	envelopeMetadata := map[string]any{}
	if envelope != nil && envelope.EvidenceMetadata != nil {
		envelopeMetadata = envelope.EvidenceMetadata
	}
	requestMetadata := req.EvidenceMetadata
	configuredSecret := firstMetadataValue(envelopeMetadata, signatureWebhookSecretMetadataKeys...)
	requestSecret := firstWebhookValue(req.WebhookSecret, requestMetadata, signatureWebhookSecretMetadataKeys...)
	secret := configuredSecret
	if secret == "" {
		secret = requestSecret
	}
	signature := firstWebhookValue(req.WebhookSignature, requestMetadata, signatureWebhookSignatureMetadataKeys...)
	timestamp := firstWebhookValue(req.WebhookTimestamp, requestMetadata, signatureWebhookTimestampMetadataKeys...)
	payloadValue := optionalStringValue(req.WebhookPayload)
	base := firstWebhookValue(req.WebhookSignatureBase, requestMetadata, "webhook_signature_base", "signature_base", "hmac_base")
	algorithm := firstWebhookValue(req.WebhookAlgorithm, requestMetadata, "webhook_algorithm", "signature_algorithm", "hmac_algorithm")

	validationRequested := requestSecret != "" || signature != "" || payloadValue != "" || base != "" || algorithm != ""
	if !validationRequested {
		return false, nil
	}
	if secret == "" {
		return false, forbiddenError("signature provider webhook secret is required")
	}
	if signature == "" {
		return false, forbiddenError("signature provider webhook signature is required")
	}
	if algorithm == "" {
		algorithm = "hmac-sha256"
	}
	switch algorithm {
	case "hmac-sha256", "sha256":
	default:
		return false, validationError("unsupported signature provider webhook algorithm", map[string]string{"webhook_algorithm": "unsupported"})
	}

	payload := []byte(payloadValue)
	if payloadValue == "" {
		payload = req.RawPayload
	}
	if len(payload) == 0 {
		return false, forbiddenError("signature provider webhook payload is required")
	}
	if !validHMACSHA256Signature(secret, payload, timestamp, base, signature) {
		return false, forbiddenError("invalid signature provider webhook signature")
	}
	return true, nil
}

func firstWebhookValue(primary *string, metadata map[string]any, keys ...string) string {
	if value := optionalStringValue(primary); value != "" {
		return value
	}
	return firstMetadataValue(metadata, keys...)
}

func firstMetadataValue(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := metadataString(metadata, key); value != "" {
			return value
		}
	}
	for _, parent := range []string{"webhook", "webhook_validation", "signature_validation"} {
		child, ok := metadata[parent].(map[string]any)
		if !ok {
			continue
		}
		for _, key := range keys {
			if value := metadataString(child, key); value != "" {
				return value
			}
		}
	}
	return ""
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func validHMACSHA256Signature(secret string, payload []byte, timestamp, base, signature string) bool {
	base = strings.ToLower(strings.TrimSpace(base))
	if base == "" || base == "auto" {
		if timestamp != "" {
			base = "timestamp.body"
		} else {
			base = "body"
		}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	switch base {
	case "body", "payload", "raw":
		_, _ = mac.Write(payload)
	case "timestamp.body", "timestamp.payload", "timestamp_body", "timestamp_payload":
		if timestamp == "" {
			return false
		}
		_, _ = mac.Write([]byte(timestamp))
		_, _ = mac.Write([]byte("."))
		_, _ = mac.Write(payload)
	default:
		return false
	}
	expected := mac.Sum(nil)
	actual, ok := decodeWebhookSignature(signature)
	if !ok {
		return false
	}
	return hmac.Equal(expected, actual)
}

func decodeWebhookSignature(signature string) ([]byte, bool) {
	signature = strings.TrimSpace(signature)
	if signature == "" {
		return nil, false
	}
	for _, part := range strings.Split(signature, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "v1=") {
			signature = strings.TrimPrefix(part, "v1=")
			break
		}
	}
	for _, prefix := range []string{"sha256=", "hmac-sha256=", "v1="} {
		signature = strings.TrimPrefix(signature, prefix)
	}
	if decoded, err := hex.DecodeString(signature); err == nil {
		return decoded, true
	}
	if decoded, err := base64.StdEncoding.DecodeString(signature); err == nil {
		return decoded, true
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(signature); err == nil {
		return decoded, true
	}
	return nil, false
}

func scrubSignatureWebhookMetadata(metadata map[string]any) {
	for _, key := range signatureWebhookSecretMetadataKeys {
		delete(metadata, key)
	}
	for _, parent := range []string{"webhook", "webhook_validation", "signature_validation"} {
		child, ok := metadata[parent].(map[string]any)
		if !ok {
			continue
		}
		for _, key := range signatureWebhookSecretMetadataKeys {
			delete(child, key)
		}
	}
}

func applySignatureProviderEvent(envelope *model.SignatureEnvelope, recipient *model.SignatureRecipient, req dto.SignatureProviderEventRequest, eventType model.SignatureEventType, userID uuid.UUID, occurredAt time.Time) error {
	if providerEventRequiresRecipient(eventType) && recipient == nil {
		return validationError("signature provider recipient is required", map[string]string{"recipient_id": "recipient_id or provider_recipient_id required"})
	}
	switch eventType {
	case model.SignatureEventViewed:
		if err := validateRecipientAction(envelope, recipient, dto.SignatureRecipientActionView); err != nil {
			return err
		}
		recipient.Status = model.SignatureRecipientViewed
		if recipient.ViewedAt == nil {
			recipient.ViewedAt = &occurredAt
		}
		if envelope.Status == model.SignatureEnvelopeSent {
			envelope.Status = model.SignatureEnvelopeViewed
		}
	case model.SignatureEventSigned:
		if err := validateRecipientAction(envelope, recipient, dto.SignatureRecipientActionSign); err != nil {
			return err
		}
		recipient.Status = model.SignatureRecipientSigned
		if recipient.ViewedAt == nil {
			recipient.ViewedAt = &occurredAt
		}
		recipient.SignedAt = &occurredAt
		recipient.EvidenceHash = req.EvidenceHash
		recipient.EvidenceMetadata = mergeMetadata(recipient.EvidenceMetadata, req.EvidenceMetadata)
		if req.ProviderRecipientID != nil && recipient.ProviderRecipientID == nil {
			recipient.ProviderRecipientID = req.ProviderRecipientID
		}
		for i := range envelope.Recipients {
			if envelope.Recipients[i].ID == recipient.ID {
				envelope.Recipients[i] = *recipient
				break
			}
		}
		if allRequiredRecipientsSigned(envelope.Recipients) {
			envelope.Status = model.SignatureEnvelopeSigned
			envelope.CompletedAt = &occurredAt
			envelope.EvidenceHash = req.EvidenceHash
			envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
		}
	case model.SignatureEventDeclined:
		if err := validateRecipientAction(envelope, recipient, dto.SignatureRecipientActionDecline); err != nil {
			return err
		}
		declineReason := firstNonNilString(req.DeclineReason, req.Reason)
		if declineReason == nil {
			return validationError("decline reason is required", map[string]string{"decline_reason": "required"})
		}
		recipient.Status = model.SignatureRecipientDeclined
		recipient.DeclinedAt = &occurredAt
		recipient.DeclineReason = declineReason
		recipient.EvidenceHash = req.EvidenceHash
		recipient.EvidenceMetadata = mergeMetadata(recipient.EvidenceMetadata, req.EvidenceMetadata)
		if req.ProviderRecipientID != nil && recipient.ProviderRecipientID == nil {
			recipient.ProviderRecipientID = req.ProviderRecipientID
		}
		envelope.Status = model.SignatureEnvelopeDeclined
		envelope.CompletedAt = &occurredAt
	case model.SignatureEventCancelled:
		if !canCancelSignatureEnvelope(envelope.Status) {
			return conflictError("signature envelope cannot be cancelled from its current status")
		}
		reason := firstNonNilString(req.Reason, req.DeclineReason)
		if reason == nil {
			defaultReason := "provider cancelled"
			reason = &defaultReason
		}
		envelope.Status = model.SignatureEnvelopeCancelled
		envelope.CompletedAt = &occurredAt
		envelope.CancelledAt = &occurredAt
		envelope.CancelledBy = &userID
		envelope.CancellationReason = reason
		envelope.EvidenceHash = req.EvidenceHash
		envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
	case model.SignatureEventExpired:
		if !canExpireSignatureEnvelope(envelope.Status) {
			return conflictError("signature envelope cannot be expired from its current status")
		}
		envelope.Status = model.SignatureEnvelopeExpired
		envelope.CompletedAt = &occurredAt
		envelope.EvidenceHash = req.EvidenceHash
		envelope.EvidenceMetadata = mergeMetadata(envelope.EvidenceMetadata, req.EvidenceMetadata)
	default:
		return validationError("unsupported signature provider status", map[string]string{"provider_status": "unsupported"})
	}
	return nil
}

func (s *SignatureService) rejectExpiredEnvelope(ctx context.Context, tenantID, userID uuid.UUID, envelope *model.SignatureEnvelope, now time.Time) error {
	if envelope.ExpiresAt == nil || envelope.ExpiresAt.After(now) || (envelope.Status != model.SignatureEnvelopeSent && envelope.Status != model.SignatureEnvelopeViewed) {
		return nil
	}
	envelope.Status = model.SignatureEnvelopeExpired
	envelope.CompletedAt = &now
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start signature expiry transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.signatures.UpdateEnvelope(ctx, tx, envelope); err != nil {
		return internalError("expire signature envelope", err)
	}
	if err := s.signatures.AddEvent(ctx, tx, newSignatureEvent(tenantID, envelope.ID, nil, model.SignatureEventExpired, &userID, nil, nil, nil, nil, nil, map[string]any{"reason": "expires_at elapsed"}, now)); err != nil {
		return internalError("record signature expiry event", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit signature expiry", err)
	}
	return conflictError("signature envelope expired")
}

func allRequiredRecipientsSigned(recipients []model.SignatureRecipient) bool {
	required := 0
	for _, recipient := range recipients {
		if recipient.Role == model.SignatureRecipientCarbonCopy {
			continue
		}
		required++
		if recipient.Status != model.SignatureRecipientSigned {
			return false
		}
	}
	return required > 0
}

func canCancelSignatureEnvelope(status model.SignatureEnvelopeStatus) bool {
	switch status {
	case model.SignatureEnvelopeDraft, model.SignatureEnvelopeSent, model.SignatureEnvelopeViewed:
		return true
	default:
		return false
	}
}

func canExpireSignatureEnvelope(status model.SignatureEnvelopeStatus) bool {
	switch status {
	case model.SignatureEnvelopeSent, model.SignatureEnvelopeViewed:
		return true
	default:
		return false
	}
}

func canEditSignaturePlacements(envelope *model.SignatureEnvelope) bool {
	if envelope == nil {
		return false
	}
	switch envelope.Status {
	case model.SignatureEnvelopeDraft, model.SignatureEnvelopeSent, model.SignatureEnvelopeViewed:
	default:
		return false
	}
	for _, recipient := range envelope.Recipients {
		switch recipient.Status {
		case model.SignatureRecipientSigned, model.SignatureRecipientDeclined, model.SignatureRecipientExpired, model.SignatureRecipientCancelled:
			return false
		}
	}
	return true
}

func buildSignatureUserProfile(tenantID, userID uuid.UUID, req dto.UpsertSignatureUserProfileRequest) (*model.SignatureUserProfile, error) {
	fields := map[string]string{}
	if len([]rune(req.TypedName)) > 160 {
		fields["typed_name"] = "must be 160 characters or fewer"
	}
	if len([]rune(req.Initials)) > 16 {
		fields["initials"] = "must be 16 characters or fewer"
	}

	signatureImage, signatureMIME, signatureHash, err := parseSignatureAsset("signature_image", req.SignatureImage)
	if err != nil {
		return nil, err
	}
	initialsImage, initialsMIME, initialsHash, err := parseSignatureAsset("initials_image", req.InitialsImage)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.TypedName) == "" && signatureImage == nil {
		fields["signature"] = "typed_name or signature_image is required"
	}
	if len([]rune(req.ConsentVersion)) > 80 {
		fields["consent_version"] = "must be 80 characters or fewer"
	}
	if len(fields) > 0 {
		return nil, validationError("invalid signature profile", fields)
	}
	return &model.SignatureUserProfile{
		TenantID:           tenantID,
		UserID:             userID,
		TypedName:          req.TypedName,
		Initials:           req.Initials,
		SignatureImage:     signatureImage,
		SignatureImageMIME: signatureMIME,
		SignatureImageHash: signatureHash,
		InitialsImage:      initialsImage,
		InitialsImageMIME:  initialsMIME,
		InitialsImageHash:  initialsHash,
		ConsentVersion:     req.ConsentVersion,
	}, nil
}

func validateSignaturePlacements(envelope *model.SignatureEnvelope, placements []dto.SignaturePlacement) error {
	fields := map[string]string{}
	if len(placements) > 100 {
		fields["placements"] = "must contain 100 fields or fewer"
	}
	recipients := make(map[uuid.UUID]struct{}, len(envelope.Recipients))
	for _, recipient := range envelope.Recipients {
		recipients[recipient.ID] = struct{}{}
	}
	seenIDs := map[string]struct{}{}
	for i, placement := range placements {
		prefix := fmt.Sprintf("placements[%d]", i)
		if placement.ID != "" {
			if len([]rune(placement.ID)) > 80 {
				fields[prefix+".id"] = "must be 80 characters or fewer"
			}
			if _, exists := seenIDs[placement.ID]; exists {
				fields[prefix+".id"] = "must be unique"
			}
			seenIDs[placement.ID] = struct{}{}
		}
		if _, ok := allowedSignaturePlacementKinds[placement.Kind]; !ok {
			fields[prefix+".kind"] = "must be signature, initials, name, or date"
		}
		if placement.RecipientID != nil {
			if _, ok := recipients[*placement.RecipientID]; !ok {
				fields[prefix+".recipient_id"] = "must belong to the envelope"
			}
		}
		if placement.Page < 1 {
			fields[prefix+".page"] = "must be 1 or greater"
		}
		if !percentageWithinPage(placement.X) {
			fields[prefix+".x"] = "must be between 0 and 100"
		}
		if !percentageWithinPage(placement.Y) {
			fields[prefix+".y"] = "must be between 0 and 100"
		}
		if placement.Width <= 0 || placement.Width > 100 {
			fields[prefix+".width"] = "must be greater than 0 and no more than 100"
		}
		if placement.Height <= 0 || placement.Height > 100 {
			fields[prefix+".height"] = "must be greater than 0 and no more than 100"
		}
		if placement.X+placement.Width > 100.001 {
			fields[prefix+".width"] = "must fit within the page"
		}
		if placement.Y+placement.Height > 100.001 {
			fields[prefix+".height"] = "must fit within the page"
		}
		if len([]rune(placement.Label)) > 120 {
			fields[prefix+".label"] = "must be 120 characters or fewer"
		}
	}
	if len(fields) > 0 {
		return validationError("invalid signature placements", fields)
	}
	return nil
}

func percentageWithinPage(value float64) bool {
	return value >= 0 && value <= 100
}

func signaturePlacementsMetadata(placements []dto.SignaturePlacement) []map[string]any {
	out := make([]map[string]any, 0, len(placements))
	for _, placement := range placements {
		item := map[string]any{
			"id":       placement.ID,
			"kind":     placement.Kind,
			"page":     placement.Page,
			"x":        placement.X,
			"y":        placement.Y,
			"width":    placement.Width,
			"height":   placement.Height,
			"required": placement.Required,
		}
		if placement.RecipientID != nil {
			item["recipient_id"] = placement.RecipientID.String()
		}
		if placement.Label != "" {
			item["label"] = placement.Label
		}
		out = append(out, item)
	}
	return out
}

func parseSignatureAsset(field string, value *string) (*string, *string, *string, error) {
	if value == nil {
		return nil, nil, nil, nil
	}
	raw := strings.TrimSpace(*value)
	if raw == "" {
		return nil, nil, nil, nil
	}
	meta, encoded, ok := strings.Cut(raw, ",")
	if !ok || !strings.HasPrefix(meta, "data:") || !strings.Contains(meta, ";base64") {
		return nil, nil, nil, validationError("invalid signature image", map[string]string{field: "must be a base64 data URL"})
	}
	mime := strings.TrimPrefix(strings.Split(meta, ";")[0], "data:")
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/svg+xml":
	default:
		return nil, nil, nil, validationError("unsupported signature image type", map[string]string{field: "must be PNG, JPEG, WebP, or SVG"})
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, nil, nil, validationError("invalid signature image", map[string]string{field: "base64 data is invalid"})
	}
	if len(decoded) > maxSignatureAssetBytes {
		return nil, nil, nil, validationError("signature image is too large", map[string]string{field: "must be 512KB or smaller"})
	}
	sum := sha256.Sum256(decoded)
	hash := hex.EncodeToString(sum[:])
	return &raw, &mime, &hash, nil
}

func signatureRecipientBelongsToUser(recipient *model.SignatureRecipient, userID uuid.UUID, userEmail string) bool {
	if recipient == nil {
		return false
	}
	if recipient.UserID != nil && *recipient.UserID == userID {
		return true
	}
	if recipient.Email != nil && strings.TrimSpace(userEmail) != "" {
		return strings.EqualFold(strings.TrimSpace(*recipient.Email), strings.TrimSpace(userEmail))
	}
	return false
}

func signatureProfileEvidence(profile *model.SignatureUserProfile) map[string]any {
	if profile == nil {
		return map[string]any{}
	}
	out := map[string]any{
		"signature_profile_user_id":         profile.UserID.String(),
		"signature_profile_consent_version": profile.ConsentVersion,
		"signature_profile_updated_at":      profile.UpdatedAt.Format(time.RFC3339Nano),
		"signature_profile_source":          "user_saved_profile",
	}
	if strings.TrimSpace(profile.TypedName) != "" {
		out["signature_profile_typed_name"] = profile.TypedName
	}
	if strings.TrimSpace(profile.Initials) != "" {
		out["signature_profile_initials"] = profile.Initials
	}
	if profile.SignatureImageHash != nil {
		out["signature_profile_signature_hash"] = *profile.SignatureImageHash
	}
	if profile.SignatureImageMIME != nil {
		out["signature_profile_signature_mime"] = *profile.SignatureImageMIME
	}
	if profile.InitialsImageHash != nil {
		out["signature_profile_initials_hash"] = *profile.InitialsImageHash
	}
	if profile.InitialsImageMIME != nil {
		out["signature_profile_initials_mime"] = *profile.InitialsImageMIME
	}
	return out
}

func signaturePlacementEvidence(envelope *model.SignatureEnvelope, recipientID uuid.UUID) map[string]any {
	if envelope == nil || envelope.EvidenceMetadata == nil {
		return map[string]any{}
	}
	raw, ok := envelope.EvidenceMetadata[signaturePlacementsMetadataKey].([]any)
	if !ok {
		return map[string]any{}
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		placement, ok := item.(map[string]any)
		if !ok {
			continue
		}
		rawRecipient, _ := placement["recipient_id"].(string)
		if rawRecipient != "" && rawRecipient != recipientID.String() {
			continue
		}
		if id, _ := placement["id"].(string); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return map[string]any{}
	}
	return map[string]any{
		"native_signature_placement_schema":        signaturePlacementSchemaVersion,
		"native_signature_applied_placement_ids":   ids,
		"native_signature_applied_placement_count": len(ids),
	}
}

func newSignatureEvent(tenantID, envelopeID uuid.UUID, recipientID *uuid.UUID, eventType model.SignatureEventType, actorUserID *uuid.UUID, actorName, actorEmail, ipAddress, userAgent, evidenceHash *string, metadata map[string]any, occurredAt time.Time) *model.SignatureEvent {
	if metadata == nil {
		metadata = map[string]any{}
	}
	return &model.SignatureEvent{
		ID:               uuid.New(),
		TenantID:         tenantID,
		EnvelopeID:       envelopeID,
		RecipientID:      recipientID,
		EventType:        eventType,
		ActorUserID:      actorUserID,
		ActorName:        actorName,
		ActorEmail:       actorEmail,
		IPAddress:        ipAddress,
		UserAgent:        userAgent,
		EvidenceHash:     evidenceHash,
		EvidenceMetadata: metadata,
		OccurredAt:       occurredAt,
	}
}

func newSignatureProviderEvent(tenantID, envelopeID uuid.UUID, recipientID *uuid.UUID, eventType model.SignatureEventType, actorUserID *uuid.UUID, req dto.SignatureProviderEventRequest, ipAddress, userAgent *string, occurredAt time.Time) *model.SignatureEvent {
	event := newSignatureEvent(tenantID, envelopeID, recipientID, eventType, actorUserID, req.ActorName, req.ActorEmail, ipAddress, userAgent, req.EvidenceHash, req.EvidenceMetadata, occurredAt)
	provider := req.Provider
	providerStatus := req.ProviderStatus
	event.Provider = &provider
	event.ProviderStatus = &providerStatus
	event.ProviderEventID = req.ProviderEventID
	event.ProviderEnvelopeID = req.ProviderEnvelopeID
	event.ProviderRecipientID = req.ProviderRecipientID
	return event
}
