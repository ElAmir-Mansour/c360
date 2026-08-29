package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// intakeSystemActorID is the synthetic actor recorded as created_by on records
// produced by the unauthenticated email webhook (no JWT principal available).
var intakeSystemActorID = uuid.MustParse("00000000-0000-0000-0000-000000000002")

// ErrIntakeSignatureInvalid is returned by the email webhook when the HMAC
// signature does not verify against the addressed mailbox's ingest secret. The
// handler maps it to 401 so a forged delivery is rejected without leaking which
// mailbox exists.
var ErrIntakeSignatureInvalid = errors.New("intake: invalid signature")

// ErrIntakeMailboxNotFound is returned when no active mailbox owns the addressed
// recipient. The handler maps it to 404.
var ErrIntakeMailboxNotFound = errors.New("intake: mailbox not found")

const intakeSignatureTolerance = 5 * time.Minute

// Intake source tags recorded on the audit row's metadata["intake_source"] and
// on the routed legal_request metadata so operators can tell HOW a message
// arrived: the HMAC-signed public webhook, a provider inbound-parse receiver
// (SES/Mailgun/…), the IMAP poller, or a JWT-authenticated Simulate-Inbound
// admin action. Purely descriptive — it never changes routing/classification.
const (
	intakeSourceWebhook   = "webhook"
	intakeSourceSimulated = "simulated"
	intakeSourceIMAP      = "imap"
)

// intakeSourceProvider tags a message ingested through the provider inbound-parse
// receiver, e.g. "provider:mailgun".
func intakeSourceProvider(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "provider"
	}
	return "provider:" + name
}

// IntakeFileStore is the honest seam for persisting the raw email body and its
// attachments to the platform files service (entity_type/entity_id, suite='lex').
// The integrator wires a concrete files-service client; when nil the intake
// pipeline records attachment metadata on the message without persisting bytes,
// so intake still functions in environments without object storage configured.
type IntakeFileStore interface {
	// StoreIntakeFile persists one intake artifact and returns its file id. kind
	// is "raw" for the message body or "attachment" for an attachment.
	StoreIntakeFile(ctx context.Context, tenantID, messageID uuid.UUID, kind, filename, contentType string, content []byte) (uuid.UUID, error)
}

// IntakeService owns direct platform submission (CAP-002) and the email webhook
// pipeline (CAP-002/003): HMAC verification, Message-ID dedup, attachment
// persistence, rules classification, beneficiary resolution, and routed
// legal_request creation. It coordinates with the request spine via the
// LegalRequestService (NOT by writing legal_requests directly) and reads the
// catalog/org registry for routing facts.
type IntakeService struct {
	db            *pgxpool.Pool
	mailboxes     *repository.IntakeMailboxRepository
	messages      *repository.IntakeMessageRepository
	catalog       *repository.ServiceCatalogRepository
	requests      *LegalRequestService
	orgs          *OrgEntityService
	crypto        *lexcrypto.FieldCrypto
	files         IntakeFileStore
	publisher     Publisher
	metrics       *metrics.Metrics
	domainMetrics *LexDomainMetrics
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
}

func NewIntakeService(
	db *pgxpool.Pool,
	mailboxes *repository.IntakeMailboxRepository,
	messages *repository.IntakeMessageRepository,
	catalog *repository.ServiceCatalogRepository,
	requests *LegalRequestService,
	orgs *OrgEntityService,
	fieldCrypto *lexcrypto.FieldCrypto,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *IntakeService {
	return &IntakeService{
		db:        db,
		mailboxes: mailboxes,
		messages:  messages,
		catalog:   catalog,
		requests:  requests,
		orgs:      orgs,
		crypto:    fieldCrypto,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-intake").Logger(),
		now:       time.Now,
	}
}

// WithFileStore wires the attachment/raw-body persistence seam. Returns the
// receiver for chaining at construction time.
func (s *IntakeService) WithFileStore(store IntakeFileStore) *IntakeService {
	s.files = store
	return s
}

// SetDomainMetrics installs the WS7 runtime collectors so the intake pipeline
// records messages_total{status} and eligibility_denied_total. A nil value is
// ignored; the record helpers are nil-safe so an unwired intake service behaves
// exactly as before (pure observability, no behavioural change).
func (s *IntakeService) SetDomainMetrics(m *LexDomainMetrics) {
	if m != nil {
		s.domainMetrics = m
	}
}

// ---- mailbox administration ----

func (s *IntakeService) CreateMailbox(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateIntakeMailboxRequest) (*model.IntakeMailbox, error) {
	req.Normalize()
	if req.Address == "" {
		return nil, validationError("address is required", map[string]string{"address": "required"})
	}
	if req.RequestType == "" {
		return nil, validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if req.IngestSecret == "" {
		return nil, validationError("ingest_secret is required", map[string]string{"ingest_secret": "required"})
	}
	encrypted, err := s.encryptSecret(req.IngestSecret)
	if err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	mailbox := &model.IntakeMailbox{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		Address:             req.Address,
		RequestType:         req.RequestType,
		ServiceID:           req.ServiceID,
		BeneficiaryEntityID: req.BeneficiaryEntityID,
		IngestSecretHash:    encrypted,
		Active:              active,
		Metadata:            req.Metadata,
		CreatedBy:           userID,
	}
	if err := s.mailboxes.Create(ctx, s.db, mailbox); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a mailbox with this address already exists")
		}
		return nil, internalError("create intake mailbox", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake_mailbox.created", tenantID, &userID, map[string]any{
		"id":           mailbox.ID,
		"address":      mailbox.Address,
		"request_type": mailbox.RequestType,
	}, s.logger)
	return mailbox, nil
}

func (s *IntakeService) ListMailboxes(ctx context.Context, tenantID uuid.UUID, filters model.IntakeMailboxListFilters) ([]model.IntakeMailbox, int, error) {
	return s.mailboxes.List(ctx, tenantID, filters)
}

func (s *IntakeService) GetMailbox(ctx context.Context, tenantID, id uuid.UUID) (*model.IntakeMailbox, error) {
	mailbox, err := s.mailboxes.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("mailbox not found")
		}
		return nil, internalError("load intake mailbox", err)
	}
	return mailbox, nil
}

func (s *IntakeService) UpdateMailbox(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateIntakeMailboxRequest) (*model.IntakeMailbox, error) {
	req.Normalize()
	mailbox, err := s.mailboxes.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("mailbox not found")
		}
		return nil, internalError("load intake mailbox", err)
	}
	if req.RequestType != nil {
		mailbox.RequestType = *req.RequestType
	}
	if req.ServiceID != nil {
		mailbox.ServiceID = req.ServiceID
	}
	if req.BeneficiaryEntityID != nil {
		mailbox.BeneficiaryEntityID = req.BeneficiaryEntityID
	}
	if req.Active != nil {
		mailbox.Active = *req.Active
	}
	if req.Metadata != nil {
		mailbox.Metadata = req.Metadata
	}
	if req.IngestSecret != nil && *req.IngestSecret != "" {
		encrypted, err := s.encryptSecret(*req.IngestSecret)
		if err != nil {
			return nil, err
		}
		mailbox.IngestSecretHash = encrypted
	}
	if strings.TrimSpace(mailbox.RequestType) == "" {
		return nil, validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if err := s.mailboxes.Update(ctx, s.db, mailbox); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("mailbox not found")
		}
		return nil, internalError("update intake mailbox", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake_mailbox.updated", tenantID, &userID, map[string]any{
		"id":      mailbox.ID,
		"address": mailbox.Address,
	}, s.logger)
	return mailbox, nil
}

func (s *IntakeService) DeleteMailbox(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	if err := s.mailboxes.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("mailbox not found")
		}
		return internalError("delete intake mailbox", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake_mailbox.deleted", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return nil
}

// ---- intake messages (read) ----

func (s *IntakeService) ListMessages(ctx context.Context, tenantID uuid.UUID, filters model.IntakeMessageListFilters) ([]model.IntakeMessage, int, error) {
	return s.messages.List(ctx, tenantID, filters)
}

func (s *IntakeService) GetMessage(ctx context.Context, tenantID, id uuid.UUID) (*model.IntakeMessage, error) {
	msg, err := s.messages.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("intake message not found")
		}
		return nil, internalError("load intake message", err)
	}
	return msg, nil
}

// ---- direct platform submission (CAP-002) ----

// Submit creates a legal_request from an authenticated in-app submission routed
// through a catalog service. The service's request_type and approval flags are
// inherited onto the request spine.
func (s *IntakeService) Submit(ctx context.Context, tenantID, userID uuid.UUID, requesterName string, req dto.IntakeSubmitRequest) (*model.LegalRequest, error) {
	req.Normalize()
	if req.ServiceID == uuid.Nil {
		return nil, validationError("service_id is required", map[string]string{"service_id": "required"})
	}
	if req.Title.IsEmpty() {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	service, err := s.catalog.Get(ctx, tenantID, req.ServiceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("service not found", map[string]string{"service_id": "not found"})
		}
		return nil, internalError("load service catalog entry", err)
	}
	if !service.Active {
		return nil, conflictError("service is not active")
	}
	if !service.Channel.AcceptsPlatform() {
		return nil, conflictError("service does not accept platform submissions")
	}
	rules, err := s.catalog.ListRules(ctx, tenantID, service.ID)
	if err != nil {
		return nil, internalError("load service eligibility rules", err)
	}
	input, err := resolveEligibilityInput(ctx, tenantID, s.orgs, userID, req.Department, nil, req.BeneficiaryEntityID, rules)
	if err != nil {
		return nil, err
	}
	decision := evaluateEligibility(service, rules, input)
	if !decision.Eligible {
		s.domainMetrics.RecordIntakeEligibilityDenied()
		return nil, forbiddenError("requester is not eligible for this service")
	}

	createReq := buildPlatformLegalRequestCreate(userID, requesterName, req, service)
	request, err := s.requests.Create(ctx, tenantID, userID, createReq)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake.submitted", tenantID, &userID, map[string]any{
		"id":         request.ID,
		"service_id": service.ID,
		"channel":    "platform",
	}, s.logger)
	s.domainMetrics.RecordIntakeMessage("submitted")
	return request, nil
}

// IngestEmail is the CAP-002/003 email webhook pipeline. It runs WITHOUT a JWT
// principal: the addressed mailbox is resolved in a system (RLS-bypass) tx to
// discover the owning tenant, the HMAC signature is verified against the
// mailbox's ingest secret, the message is deduped on Message-ID, attachments are
// persisted, the rules classifier (CAP-003) resolves request_type + beneficiary,
// and a routed legal_request is created — all within the resolved tenant's RLS
// context.
//
// signature is the raw value of the inbound signature header (hex or base64
// HMAC-SHA256 of webhook_timestamp + "." + rawBody). rawBody is the exact bytes
// the signature was computed over.
func (s *IntakeService) IngestEmail(ctx context.Context, signature string, rawBody []byte, req dto.IntakeEmailWebhookRequest) (*model.IntakeMessage, error) {
	req.Normalize()
	if req.MessageID == "" {
		return nil, validationError("message_id is required", map[string]string{"message_id": "required"})
	}
	if req.To == "" {
		return nil, validationError("to is required", map[string]string{"to": "required"})
	}
	if req.WebhookTimestamp == "" {
		return nil, ErrIntakeSignatureInvalid
	}

	// Resolve the mailbox (and therefore the tenant) WITHOUT a tenant context.
	var mailbox *model.IntakeMailbox
	if err := database.RunSystemRead(ctx, s.db, func(tx pgx.Tx) error {
		found, err := s.mailboxes.GetByAddressSystem(ctx, tx, req.To)
		if err != nil {
			return err
		}
		mailbox = found
		return nil
	}); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrIntakeMailboxNotFound
		}
		return nil, internalError("resolve intake mailbox", err)
	}

	// Verify the HMAC signature against the mailbox's (decrypted) ingest secret.
	secret, err := s.decryptSecret(mailbox.IngestSecretHash)
	if err != nil {
		return nil, internalError("decrypt intake secret", err)
	}
	if !verifyIntakeSignature(secret, rawBody, req.WebhookTimestamp, signature, s.now().UTC()) {
		return nil, ErrIntakeSignatureInvalid
	}

	return s.ingestNormalized(ctx, mailbox, req, intakeSourceWebhook)
}

// ingestNormalized is the shared, post-authentication half of the intake
// pipeline: it takes an ALREADY-RESOLVED, ALREADY-AUTHENTICATED mailbox + a
// normalized email payload and runs Message-ID dedup, artifact persistence, the
// CAP-003 rules classifier, beneficiary resolution, and routed legal_request
// creation — all within the mailbox's tenant RLS context. It is the single reuse
// point behind every intake ingress (the HMAC webhook, the provider inbound-parse
// receiver, the IMAP poller, and the Simulate-Inbound admin action); the caller
// is responsible for whatever authentication that ingress requires BEFORE calling
// here. source is recorded on metadata["intake_source"] for audit/filtering and
// never affects routing. Idempotent on (tenant, provider_message_id).
func (s *IntakeService) ingestNormalized(ctx context.Context, mailbox *model.IntakeMailbox, req dto.IntakeEmailWebhookRequest, source string) (*model.IntakeMessage, error) {
	if strings.TrimSpace(req.MessageID) == "" {
		return nil, validationError("message_id is required", map[string]string{"message_id": "required"})
	}
	tenantID := mailbox.TenantID

	// Dedup on Message-ID within the tenant context.
	var duplicate bool
	if err := database.RunReadWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		exists, err := s.messages.ExistsByProviderMessageID(ctx, tx, tenantID, req.MessageID)
		if err != nil {
			return err
		}
		duplicate = exists
		return nil
	}); err != nil {
		return nil, internalError("dedup intake message", err)
	}
	if duplicate {
		// Idempotent: return the already-ingested message.
		existing, err := s.messageByProviderID(ctx, tenantID, req.MessageID)
		if err != nil {
			return nil, err
		}
		s.domainMetrics.RecordIntakeMessage("duplicate")
		return existing, nil
	}

	messageID := uuid.New()
	rawFileID, attachmentIDs := s.persistArtifacts(ctx, tenantID, messageID, req)

	msg := &model.IntakeMessage{
		ID:                messageID,
		TenantID:          tenantID,
		MailboxID:         &mailbox.ID,
		ProviderMessageID: req.MessageID,
		FromAddress:       req.From,
		ToAddress:         req.To,
		Subject:           req.Subject,
		RawFileID:         rawFileID,
		AttachmentFileIDs: attachmentIDs,
		Status:            model.IntakeMessageStatusReceived,
		Metadata:          intakeMessageMetadata(source, req.WebhookTimestamp),
		CreatedBy:         intakeSystemActorID,
	}

	if err := s.persistMessage(ctx, tenantID, msg); err != nil {
		if isUniqueViolation(err) {
			// Lost a dedup race — return the winner idempotently.
			existing, lookupErr := s.messageByProviderID(ctx, tenantID, req.MessageID)
			if lookupErr == nil {
				return existing, nil
			}
		}
		return nil, internalError("persist intake message", err)
	}

	// Classify (CAP-003) against the active catalog after the received audit row
	// exists, so failures can move the message to rejected instead of vanishing.
	services, err := s.activeServices(ctx, tenantID)
	if err != nil {
		_ = s.markRejected(ctx, tenantID, messageID, err.Error())
		s.domainMetrics.RecordIntakeMessage(string(model.IntakeMessageStatusRejected))
		return nil, err
	}
	classification := newIntakeClassifier(mailbox.RequestType).Classify(req.Subject, req.Body, services)
	routedService := resolveIntakeRouteService(services, classification, mailbox.ServiceID)

	requestType := classification.RequestType
	serviceID := mailbox.ServiceID
	serviceCode := classification.ServiceCode
	requesterApprovalRequired := false
	providerApprovalRequired := false
	if routedService != nil {
		id := routedService.ID
		serviceID = &id
		serviceCode = routedService.Code
		if requestType == "" {
			requestType = routedService.RequestType
		}
		requesterApprovalRequired = routedService.RequesterApprovalReqd
		providerApprovalRequired = routedService.ProviderApprovalReqd
	}
	if requestType == "" {
		_ = s.markRejected(ctx, tenantID, messageID, "unable to classify intake message")
		s.domainMetrics.RecordIntakeMessage(string(model.IntakeMessageStatusRejected))
		return nil, validationError("unable to classify intake message", map[string]string{"message_id": "unclassified"})
	}

	beneficiaryEntityID := mailbox.BeneficiaryEntityID
	if classification.BeneficiaryCode != "" {
		if resolved := s.resolveBeneficiary(ctx, tenantID, classification.BeneficiaryCode); resolved != nil {
			beneficiaryEntityID = resolved
		}
	}
	if err := s.markClassified(ctx, tenantID, messageID, requestType, beneficiaryEntityID, classification.Reason); err != nil {
		return nil, internalError("mark intake message classified", err)
	}
	msg.Status = model.IntakeMessageStatusClassified
	msg.ClassifiedRequestType = optionalString(requestType)
	msg.BeneficiaryEntityID = beneficiaryEntityID
	msg.ClassifierReason = optionalString(classification.Reason)

	// Create the routed legal_request via the spine.
	createReq := dto.CreateLegalRequestRequest{
		RequestType:           requestType,
		ServiceID:             serviceID,
		Title:                 forms.LocalizedText{EN: req.Subject, AR: req.Subject},
		Description:           req.Body,
		RequesterName:         intakeRequesterName(req.From),
		BeneficiaryEntityID:   beneficiaryEntityID,
		Priority:              model.RequestPriorityNormal,
		RequesterApprovalReqd: requesterApprovalRequired,
		ProviderApprovalReqd:  providerApprovalRequired,
		Metadata:              emailIntakeRequestMetadata(serviceID, serviceCode, mailbox.ID, classification.Reason, req.MessageID, source),
	}
	request, err := s.requests.Create(ctx, tenantID, intakeSystemActorID, createReq)
	if err != nil {
		// Record the failure on the message for audit but surface the error.
		_ = s.markRejected(ctx, tenantID, messageID, err.Error())
		s.domainMetrics.RecordIntakeMessage(string(model.IntakeMessageStatusRejected))
		return nil, err
	}

	if err := s.markRouted(ctx, tenantID, messageID, request.ID, requestType, beneficiaryEntityID, classification.Reason); err != nil {
		return nil, internalError("mark intake message routed", err)
	}
	msg.Status = model.IntakeMessageStatusRouted
	msg.LegalRequestID = &request.ID

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.intake.email_routed", tenantID, nil, map[string]any{
		"id":               messageID,
		"legal_request_id": request.ID,
		"request_type":     requestType,
		"channel":          "email",
		"intake_source":    source,
		"classifier":       classification.Reason,
	}, s.logger)
	s.domainMetrics.RecordIntakeMessage(string(model.IntakeMessageStatusRouted))
	return msg, nil
}

// ---- helpers ----

func (s *IntakeService) activeServices(ctx context.Context, tenantID uuid.UUID) ([]model.ServiceCatalogEntry, error) {
	active := true
	items, _, err := s.catalog.List(ctx, tenantID, model.ServiceCatalogListFilters{
		Page:    1,
		PerPage: 200,
		Active:  &active,
	})
	if err != nil {
		return nil, internalError("list active services", err)
	}
	return items, nil
}

func (s *IntakeService) resolveBeneficiary(ctx context.Context, tenantID uuid.UUID, code string) *uuid.UUID {
	if s.orgs == nil {
		return nil
	}
	entity, err := s.orgs.GetByCode(ctx, tenantID, code)
	if err != nil || entity == nil {
		return nil
	}
	id := entity.ID
	return &id
}

func (s *IntakeService) persistArtifacts(ctx context.Context, tenantID, messageID uuid.UUID, req dto.IntakeEmailWebhookRequest) (*uuid.UUID, []uuid.UUID) {
	attachmentIDs := make([]uuid.UUID, 0, len(req.Attachments))
	if s.files == nil {
		return nil, attachmentIDs
	}
	var rawFileID *uuid.UUID
	if id, err := s.files.StoreIntakeFile(ctx, tenantID, messageID, "raw", "message.eml", "message/rfc822", []byte(req.Body)); err == nil {
		rawFileID = &id
	} else {
		s.logger.Error().Err(err).Str("message_id", messageID.String()).Msg("persist intake raw body")
	}
	for _, attachment := range req.Attachments {
		content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(attachment.ContentB64))
		if err != nil {
			s.logger.Error().Err(err).Str("filename", attachment.Filename).Msg("decode intake attachment")
			continue
		}
		id, err := s.files.StoreIntakeFile(ctx, tenantID, messageID, "attachment", attachment.Filename, attachment.ContentType, content)
		if err != nil {
			s.logger.Error().Err(err).Str("filename", attachment.Filename).Msg("persist intake attachment")
			continue
		}
		attachmentIDs = append(attachmentIDs, id)
	}
	return rawFileID, attachmentIDs
}

func (s *IntakeService) persistMessage(ctx context.Context, tenantID uuid.UUID, msg *model.IntakeMessage) error {
	return database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		return s.messages.Create(ctx, tx, msg)
	})
}

func (s *IntakeService) markClassified(ctx context.Context, tenantID, messageID uuid.UUID, requestType string, beneficiaryEntityID *uuid.UUID, reason string) error {
	return database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		return s.messages.MarkClassified(ctx, tx, tenantID, messageID, requestType, beneficiaryEntityID, reason)
	})
}

func (s *IntakeService) markRouted(ctx context.Context, tenantID, messageID, legalRequestID uuid.UUID, requestType string, beneficiaryEntityID *uuid.UUID, reason string) error {
	return database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		return s.messages.MarkRouted(ctx, tx, tenantID, messageID, legalRequestID, requestType, beneficiaryEntityID, reason)
	})
}

func (s *IntakeService) markRejected(ctx context.Context, tenantID, messageID uuid.UUID, errorMessage string) error {
	return database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		return s.messages.MarkRejected(ctx, tx, tenantID, messageID, errorMessage)
	})
}

func (s *IntakeService) messageByProviderID(ctx context.Context, tenantID uuid.UUID, providerMessageID string) (*model.IntakeMessage, error) {
	var msg *model.IntakeMessage
	err := database.RunReadWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		found, err := s.messages.GetByProviderMessageID(ctx, tx, tenantID, providerMessageID)
		if err != nil {
			return err
		}
		msg = found
		return nil
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("intake message not found")
		}
		return nil, internalError("load deduped intake message", err)
	}
	return msg, nil
}

func (s *IntakeService) encryptSecret(plaintext string) (string, error) {
	if s.crypto == nil {
		// No field crypto configured — store the secret as-is (legacy plaintext is
		// honored by the decrypt path). The integrator should wire crypto in prod.
		return plaintext, nil
	}
	encrypted, err := s.crypto.Encrypt(plaintext)
	if err != nil {
		return "", internalError("encrypt intake secret", err)
	}
	return encrypted, nil
}

func (s *IntakeService) decryptSecret(stored string) (string, error) {
	if s.crypto == nil {
		return stored, nil
	}
	return s.crypto.Decrypt(stored)
}

// verifyIntakeSignature checks an HMAC-SHA256 over timestamp + "." + body keyed
// by secret against the supplied header value (accepted as hex or base64,
// optionally "sha256="/ "v1=" prefixed). The timestamp must be fresh to bound
// replay; provider_message_id dedup then makes fresh redelivery idempotent.
func verifyIntakeSignature(secret string, body []byte, timestamp, signature string, now time.Time) bool {
	if strings.TrimSpace(secret) == "" || strings.TrimSpace(signature) == "" || strings.TrimSpace(timestamp) == "" {
		return false
	}
	signedAt, ok := parseIntakeWebhookTimestamp(timestamp)
	if !ok || !timestampWithinTolerance(signedAt, now, intakeSignatureTolerance) {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strings.TrimSpace(timestamp)))
	mac.Write([]byte("."))
	mac.Write(body)
	expected := mac.Sum(nil)

	actual, ok := decodeIntakeSignature(signature)
	return ok && hmac.Equal(actual, expected)
}

func intakeRequesterName(from string) string {
	from = strings.TrimSpace(from)
	if from == "" {
		return "email-intake"
	}
	return from
}

func intakeRequestMetadata(base map[string]any, channel, serviceCode, messageID string) map[string]any {
	out := map[string]any{}
	for key, value := range base {
		out[key] = value
	}
	out["intake_channel"] = channel
	if serviceCode != "" {
		out["intake_service_code"] = serviceCode
	}
	if messageID != "" {
		out["intake_message_id"] = messageID
	}
	return out
}

func buildPlatformLegalRequestCreate(userID uuid.UUID, requesterName string, req dto.IntakeSubmitRequest, service *model.ServiceCatalogEntry) dto.CreateLegalRequestRequest {
	requesterName = strings.TrimSpace(requesterName)
	if requesterName == "" {
		requesterName = userID.String()
	}
	return dto.CreateLegalRequestRequest{
		RequestType:           service.RequestType,
		ServiceID:             &service.ID,
		Title:                 req.Title,
		Description:           req.Description,
		RequesterName:         requesterName,
		BeneficiaryEntityID:   req.BeneficiaryEntityID,
		Department:            req.Department,
		Priority:              req.Priority,
		UrgencyJustification:  req.UrgencyJustification,
		RequesterApprovalReqd: service.RequesterApprovalReqd,
		ProviderApprovalReqd:  service.ProviderApprovalReqd,
		Metadata:              platformIntakeRequestMetadata(req.Metadata, service, userID, requesterName, req.BeneficiaryEntityID),
	}
}

func platformIntakeRequestMetadata(base map[string]any, service *model.ServiceCatalogEntry, requesterUserID uuid.UUID, requesterName string, beneficiaryEntityID *uuid.UUID) map[string]any {
	out := intakeRequestMetadata(base, "platform", service.Code, "")
	out["intake_service_id"] = service.ID.String()
	out["requester_user_id"] = requesterUserID.String()
	out["requester_name"] = requesterName
	out["requester_approval_required"] = service.RequesterApprovalReqd
	out["provider_approval_required"] = service.ProviderApprovalReqd
	if beneficiaryEntityID != nil && *beneficiaryEntityID != uuid.Nil {
		out["beneficiary_entity_id"] = beneficiaryEntityID.String()
	}
	return out
}

func emailIntakeRequestMetadata(serviceID *uuid.UUID, serviceCode string, mailboxID uuid.UUID, classifierReason, providerMessageID, source string) map[string]any {
	out := intakeRequestMetadata(nil, "email", serviceCode, providerMessageID)
	if serviceID != nil && *serviceID != uuid.Nil {
		out["intake_service_id"] = serviceID.String()
	}
	out["intake_mailbox_id"] = mailboxID.String()
	if classifierReason != "" {
		out["intake_classifier_reason"] = classifierReason
	}
	if source = strings.TrimSpace(source); source != "" {
		out["intake_source"] = source
	}
	return out
}

// intakeMessageMetadata builds the persisted intake-message metadata bag. It
// always records how the message arrived (intake_source) and carries the
// webhook signing timestamp when the ingress supplied one (the HMAC webhook
// path); the provider/IMAP/simulate paths omit it.
func intakeMessageMetadata(source, webhookTimestamp string) map[string]any {
	out := map[string]any{"intake_source": source}
	if strings.TrimSpace(webhookTimestamp) != "" {
		out["webhook_timestamp"] = webhookTimestamp
	}
	return out
}

func resolveIntakeRouteService(services []model.ServiceCatalogEntry, classification IntakeClassification, mailboxServiceID *uuid.UUID) *model.ServiceCatalogEntry {
	if classification.ServiceID != uuid.Nil {
		if svc := serviceByID(services, classification.ServiceID); svc != nil {
			return svc
		}
	}
	if mailboxServiceID != nil && *mailboxServiceID != uuid.Nil {
		return serviceByID(services, *mailboxServiceID)
	}
	return nil
}

func serviceByID(services []model.ServiceCatalogEntry, id uuid.UUID) *model.ServiceCatalogEntry {
	for i := range services {
		if services[i].ID == id {
			return &services[i]
		}
	}
	return nil
}

func parseIntakeWebhookTimestamp(timestamp string) (time.Time, bool) {
	timestamp = strings.TrimSpace(timestamp)
	if timestamp == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, timestamp); err == nil {
			return parsed.UTC(), true
		}
	}
	if raw, err := strconv.ParseInt(timestamp, 10, 64); err == nil {
		switch {
		case raw > 1_000_000_000_000:
			return time.UnixMilli(raw).UTC(), true
		case raw > 0:
			return time.Unix(raw, 0).UTC(), true
		}
	}
	return time.Time{}, false
}

func timestampWithinTolerance(signedAt, now time.Time, tolerance time.Duration) bool {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	delta := now.UTC().Sub(signedAt.UTC())
	if delta < 0 {
		delta = -delta
	}
	return delta <= tolerance
}

func decodeIntakeSignature(signature string) ([]byte, bool) {
	signature = strings.TrimSpace(signature)
	if signature == "" {
		return nil, false
	}
	for _, part := range strings.Split(signature, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToLower(part), "v1=") {
			signature = strings.TrimPrefix(part, part[:3])
			break
		}
	}
	lowered := strings.ToLower(signature)
	for _, prefix := range []string{"sha256=", "hmac-sha256=", "v1="} {
		if strings.HasPrefix(lowered, prefix) {
			signature = signature[len(prefix):]
			break
		}
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
	if decoded, err := base64.RawURLEncoding.DecodeString(signature); err == nil {
		return decoded, true
	}
	return nil, false
}

func optionalString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
