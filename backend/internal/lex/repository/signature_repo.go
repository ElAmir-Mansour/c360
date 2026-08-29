package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type SignatureRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSignatureRepository(db *pgxpool.Pool, logger zerolog.Logger) *SignatureRepository {
	return &SignatureRepository{db: db, logger: logger}
}

func (r *SignatureRepository) CreateEnvelope(ctx context.Context, q Queryer, envelope *model.SignatureEnvelope) error {
	query := `
		INSERT INTO signature_envelopes (
			id, tenant_id, target_type, contract_id, document_id, title, subject, message,
			language, subject_ar, message_ar, legal_consent_en, legal_consent_ar,
			status, provider, method, due_at, expires_at, sent_at, completed_at,
			cancelled_at, cancelled_by, cancellation_reason, evidence_hash, evidence_metadata,
			created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11,$12,$13,
			$14,$15,$16,$17,$18,$19,$20,
			$21,$22,$23,$24,$25,
			$26
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		envelope.ID, envelope.TenantID, envelope.TargetType, envelope.ContractID, envelope.DocumentID,
		envelope.Title, envelope.Subject, envelope.Message,
		envelope.Language, envelope.SubjectAr, envelope.MessageAr, envelope.LegalConsentEn, envelope.LegalConsentAr,
		envelope.Status, envelope.Provider, envelope.Method,
		envelope.DueAt, envelope.ExpiresAt, envelope.SentAt, envelope.CompletedAt,
		envelope.CancelledAt, envelope.CancelledBy, envelope.CancellationReason, envelope.EvidenceHash, envelope.EvidenceMetadata,
		envelope.CreatedBy,
	).Scan(&envelope.CreatedAt, &envelope.UpdatedAt)
}

func (r *SignatureRepository) UpdateEnvelope(ctx context.Context, q Queryer, envelope *model.SignatureEnvelope) error {
	query := `
		UPDATE signature_envelopes
		SET title = $3,
		    subject = $4,
		    message = $5,
		    status = $6,
		    provider = $7,
		    method = $8,
		    due_at = $9,
		    expires_at = $10,
		    sent_at = $11,
		    completed_at = $12,
		    cancelled_at = $13,
		    cancelled_by = $14,
		    cancellation_reason = $15,
		    evidence_hash = $16,
		    evidence_metadata = $17,
		    language = $18,
		    subject_ar = $19,
		    message_ar = $20,
		    legal_consent_en = $21,
		    legal_consent_ar = $22,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		envelope.TenantID, envelope.ID, envelope.Title, envelope.Subject, envelope.Message,
		envelope.Status, envelope.Provider, envelope.Method, envelope.DueAt, envelope.ExpiresAt,
		envelope.SentAt, envelope.CompletedAt, envelope.CancelledAt, envelope.CancelledBy,
		envelope.CancellationReason, envelope.EvidenceHash, envelope.EvidenceMetadata,
		envelope.Language, envelope.SubjectAr, envelope.MessageAr, envelope.LegalConsentEn, envelope.LegalConsentAr,
	).Scan(&envelope.UpdatedAt)
}

func (r *SignatureRepository) CreateRecipient(ctx context.Context, q Queryer, recipient *model.SignatureRecipient) error {
	query := `
		INSERT INTO signature_recipients (
			id, tenant_id, envelope_id, user_id, name, email, phone, role, language, status,
			provider, method, signing_order, provider_recipient_id,
			viewed_at, signed_at, declined_at, decline_reason,
			evidence_hash, evidence_metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
			$11,$12,$13,$14,
			$15,$16,$17,$18,
			$19,$20
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		recipient.ID, recipient.TenantID, recipient.EnvelopeID, recipient.UserID, recipient.Name,
		recipient.Email, recipient.Phone, recipient.Role, recipient.Language, recipient.Status, recipient.Provider, recipient.Method,
		recipient.SigningOrder, recipient.ProviderRecipientID, recipient.ViewedAt, recipient.SignedAt,
		recipient.DeclinedAt, recipient.DeclineReason, recipient.EvidenceHash, recipient.EvidenceMetadata,
	).Scan(&recipient.CreatedAt, &recipient.UpdatedAt)
}

func (r *SignatureRepository) UpdateRecipient(ctx context.Context, q Queryer, recipient *model.SignatureRecipient) error {
	query := `
		UPDATE signature_recipients
		SET status = $4,
		    provider = $5,
		    method = $6,
		    provider_recipient_id = $7,
		    viewed_at = $8,
		    signed_at = $9,
		    declined_at = $10,
		    decline_reason = $11,
		    evidence_hash = $12,
		    evidence_metadata = $13,
		    language = $14,
		    updated_at = now()
		WHERE tenant_id = $1 AND envelope_id = $2 AND id = $3
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		recipient.TenantID, recipient.EnvelopeID, recipient.ID, recipient.Status, recipient.Provider,
		recipient.Method, recipient.ProviderRecipientID, recipient.ViewedAt, recipient.SignedAt, recipient.DeclinedAt,
		recipient.DeclineReason, recipient.EvidenceHash, recipient.EvidenceMetadata, recipient.Language,
	).Scan(&recipient.UpdatedAt)
}

func (r *SignatureRepository) MarkRecipientsSent(ctx context.Context, q Queryer, tenantID, envelopeID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE signature_recipients
		SET status = 'sent',
		    updated_at = now()
		WHERE tenant_id = $1
		  AND envelope_id = $2
		  AND status = 'draft'`,
		tenantID, envelopeID,
	)
	return err
}

func (r *SignatureRepository) CancelOpenRecipients(ctx context.Context, q Queryer, tenantID, envelopeID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE signature_recipients
		SET status = 'cancelled',
		    updated_at = now()
		WHERE tenant_id = $1
		  AND envelope_id = $2
		  AND status IN ('draft','sent','viewed')`,
		tenantID, envelopeID,
	)
	return err
}

func (r *SignatureRepository) ExpireOpenRecipients(ctx context.Context, q Queryer, tenantID, envelopeID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE signature_recipients
		SET status = 'expired',
		    updated_at = now()
		WHERE tenant_id = $1
		  AND envelope_id = $2
		  AND status IN ('draft','sent','viewed')`,
		tenantID, envelopeID,
	)
	return err
}

func (r *SignatureRepository) AddEvent(ctx context.Context, q Queryer, event *model.SignatureEvent) error {
	query := `
		INSERT INTO signature_events (
			id, tenant_id, envelope_id, recipient_id, event_type,
			provider, provider_status, provider_event_id, provider_envelope_id, provider_recipient_id,
			actor_user_id,
			actor_name, actor_email, ip_address, user_agent, evidence_hash,
			evidence_metadata, occurred_at
		) VALUES (
			$1,$2,$3,$4,$5,
			$6,$7,$8,$9,$10,
			$11,
			$12,$13,$14,$15,$16,
			$17,$18
		)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		event.ID, event.TenantID, event.EnvelopeID, event.RecipientID, event.EventType,
		event.Provider, event.ProviderStatus, event.ProviderEventID, event.ProviderEnvelopeID, event.ProviderRecipientID,
		event.ActorUserID,
		event.ActorName, event.ActorEmail, event.IPAddress, event.UserAgent, event.EvidenceHash,
		event.EvidenceMetadata, event.OccurredAt,
	).Scan(&event.CreatedAt)
}

// ProviderEventExists reports whether a provider event with the given
// (tenant, provider, provider_event_id) tuple has already been recorded. It backs
// idempotent webhook handling: providers (DocuSign Connect, Adobe Sign, Najiz,
// emdha) retry callback delivery, so a duplicate carrying the same provider event
// id must not re-run the envelope FSM or re-emit a domain event. The lookup uses
// the partial index idx_signature_events_provider_event. An empty providerEventID
// reports false (un-deduplicable events fall through to normal processing).
func (r *SignatureRepository) ProviderEventExists(ctx context.Context, q Queryer, tenantID uuid.UUID, provider model.SignatureProvider, providerEventID string) (bool, error) {
	providerEventID = strings.TrimSpace(providerEventID)
	if providerEventID == "" {
		return false, nil
	}
	const query = `
		SELECT EXISTS (
			SELECT 1 FROM signature_events
			WHERE tenant_id = $1 AND provider = $2 AND provider_event_id = $3
		)`
	var exists bool
	if err := q.QueryRow(ctx, query, tenantID, provider, providerEventID).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *SignatureRepository) CreateCustodyEvidence(ctx context.Context, q Queryer, custody *model.SignatureCustodyEvidence) error {
	query := `
		INSERT INTO signature_custody_evidence (
			id, tenant_id, envelope_id, file_id, file_name, file_size_bytes,
			content_hash, seal_hash, evidence_hash, provider, signed_at,
			retention_metadata, custody_metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14
		)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		custody.ID, custody.TenantID, custody.EnvelopeID, custody.FileID, custody.FileName,
		custody.FileSizeBytes, custody.ContentHash, custody.SealHash, custody.EvidenceHash,
		custody.Provider, custody.SignedAt, custody.RetentionMetadata, custody.CustodyMetadata,
		custody.CreatedBy,
	).Scan(&custody.CreatedAt)
}

func (r *SignatureRepository) GetEnvelope(ctx context.Context, tenantID, id uuid.UUID) (*model.SignatureEnvelope, error) {
	query := signatureEnvelopeJSONSelect(`e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`)
	return queryRowJSON[model.SignatureEnvelope](ctx, r.db, query, tenantID, id)
}

func (r *SignatureRepository) GetRecipient(ctx context.Context, tenantID, envelopeID, recipientID uuid.UUID) (*model.SignatureRecipient, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, envelope_id, user_id, name, email, phone, role, language, status,
			       provider, method, signing_order, provider_recipient_id,
			       viewed_at, signed_at, declined_at, decline_reason,
			       evidence_hash, COALESCE(evidence_metadata, '{}'::jsonb) AS evidence_metadata,
			       created_at, updated_at
			FROM signature_recipients
			WHERE tenant_id = $1 AND envelope_id = $2 AND id = $3
		) t`
	return queryRowJSON[model.SignatureRecipient](ctx, r.db, query, tenantID, envelopeID, recipientID)
}

func (r *SignatureRepository) GetRecipientByProviderRecipientID(ctx context.Context, tenantID, envelopeID uuid.UUID, provider model.SignatureProvider, providerRecipientID string) (*model.SignatureRecipient, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, envelope_id, user_id, name, email, phone, role, language, status,
			       provider, method, signing_order, provider_recipient_id,
			       viewed_at, signed_at, declined_at, decline_reason,
			       evidence_hash, COALESCE(evidence_metadata, '{}'::jsonb) AS evidence_metadata,
			       created_at, updated_at
			FROM signature_recipients
			WHERE tenant_id = $1
			  AND envelope_id = $2
			  AND provider = $3
			  AND provider_recipient_id = $4
		) t`
	return queryRowJSON[model.SignatureRecipient](ctx, r.db, query, tenantID, envelopeID, provider, providerRecipientID)
}

func (r *SignatureRepository) ListEnvelopes(ctx context.Context, tenantID uuid.UUID, filters model.SignatureEnvelopeListFilters) ([]model.SignatureEnvelope, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"e.tenant_id = $1", "e.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(e.title ILIKE '%%' || $%d || '%%' OR e.subject ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("e.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Provider != nil {
		conditions = append(conditions, fmt.Sprintf("e.provider = $%d", arg))
		args = append(args, *filters.Provider)
		arg++
	}
	if filters.Method != nil {
		conditions = append(conditions, fmt.Sprintf("e.method = $%d", arg))
		args = append(args, *filters.Method)
		arg++
	}
	if filters.ContractID != nil {
		conditions = append(conditions, fmt.Sprintf("e.contract_id = $%d", arg))
		args = append(args, *filters.ContractID)
		arg++
	}
	if filters.DocumentID != nil {
		conditions = append(conditions, fmt.Sprintf("e.document_id = $%d", arg))
		args = append(args, *filters.DocumentID)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM signature_envelopes e WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.SignatureEnvelope{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := signatureEnvelopeSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := signatureEnvelopeJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.SignatureEnvelope](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *SignatureRepository) CountBlockingComplianceAlerts(ctx context.Context, tenantID, contractID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM compliance_alerts
		WHERE tenant_id = $1
		  AND contract_id = $2
		  AND severity IN ('critical','high')
		  AND status IN ('open','acknowledged','investigating')`,
		tenantID, contractID,
	).Scan(&count)
	return count, err
}

func (r *SignatureRepository) GetUserProfile(ctx context.Context, tenantID, userID uuid.UUID) (*model.SignatureUserProfile, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT tenant_id, user_id, typed_name, initials,
			       signature_image, signature_image_mime, signature_image_hash,
			       initials_image, initials_image_mime, initials_image_hash,
			       consent_version, created_at, updated_at
			FROM signature_user_profiles
			WHERE tenant_id = $1 AND user_id = $2
		) t`
	return queryRowJSON[model.SignatureUserProfile](ctx, r.db, query, tenantID, userID)
}

func (r *SignatureRepository) UpsertUserProfile(ctx context.Context, q Queryer, profile *model.SignatureUserProfile) error {
	query := `
		INSERT INTO signature_user_profiles (
			tenant_id, user_id, typed_name, initials,
			signature_image, signature_image_mime, signature_image_hash,
			initials_image, initials_image_mime, initials_image_hash,
			consent_version
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
		)
		ON CONFLICT (tenant_id, user_id) DO UPDATE
		SET typed_name = EXCLUDED.typed_name,
		    initials = EXCLUDED.initials,
		    signature_image = EXCLUDED.signature_image,
		    signature_image_mime = EXCLUDED.signature_image_mime,
		    signature_image_hash = EXCLUDED.signature_image_hash,
		    initials_image = EXCLUDED.initials_image,
		    initials_image_mime = EXCLUDED.initials_image_mime,
		    initials_image_hash = EXCLUDED.initials_image_hash,
		    consent_version = EXCLUDED.consent_version,
		    updated_at = now()
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		profile.TenantID, profile.UserID, profile.TypedName, profile.Initials,
		profile.SignatureImage, profile.SignatureImageMIME, profile.SignatureImageHash,
		profile.InitialsImage, profile.InitialsImageMIME, profile.InitialsImageHash,
		profile.ConsentVersion,
	).Scan(&profile.CreatedAt, &profile.UpdatedAt)
}

func (r *SignatureRepository) DeleteUserProfile(ctx context.Context, q Queryer, tenantID, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		DELETE FROM signature_user_profiles
		WHERE tenant_id = $1 AND user_id = $2`,
		tenantID, userID,
	)
	return err
}

func signatureEnvelopeJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT e.id, e.tenant_id, e.target_type, e.contract_id, e.document_id,
			       e.title, e.subject, e.message,
			       COALESCE(e.language, 'en') AS language,
			       COALESCE(e.subject_ar, '') AS subject_ar,
			       COALESCE(e.message_ar, '') AS message_ar,
			       COALESCE(e.legal_consent_en, '') AS legal_consent_en,
			       COALESCE(e.legal_consent_ar, '') AS legal_consent_ar,
			       e.status, e.provider, e.method,
			       e.due_at, e.expires_at, e.sent_at, e.completed_at, e.cancelled_at,
			       e.cancelled_by, e.cancellation_reason, e.evidence_hash,
			       COALESCE(e.evidence_metadata, '{}'::jsonb) AS evidence_metadata,
			       e.created_by, e.created_at, e.updated_at, e.deleted_at,
			       COALESCE((
			       	SELECT json_agg(row_to_json(sr_row))
			       	FROM (
			       		SELECT sr.id, sr.tenant_id, sr.envelope_id, sr.user_id, sr.name, sr.email, sr.phone,
			       		       sr.role, sr.language, sr.status, sr.provider, sr.method, sr.signing_order,
			       		       sr.provider_recipient_id, sr.viewed_at, sr.signed_at, sr.declined_at,
			       		       sr.decline_reason, sr.evidence_hash,
			       		       COALESCE(sr.evidence_metadata, '{}'::jsonb) AS evidence_metadata,
			       		       sr.created_at, sr.updated_at
			       		FROM signature_recipients sr
			       		WHERE sr.tenant_id = e.tenant_id AND sr.envelope_id = e.id
			       		ORDER BY sr.signing_order ASC, sr.created_at ASC
			       	) sr_row
			       ), '[]'::json) AS recipients,
			       COALESCE((
			       	SELECT json_agg(row_to_json(se_row))
			       	FROM (
			       		SELECT se.id, se.tenant_id, se.envelope_id, se.recipient_id, se.event_type,
			       		       se.provider, se.provider_status, se.provider_event_id,
			       		       se.provider_envelope_id, se.provider_recipient_id,
			       		       se.actor_user_id, se.actor_name, se.actor_email, se.ip_address,
			       		       se.user_agent, se.evidence_hash,
			       		       COALESCE(se.evidence_metadata, '{}'::jsonb) AS evidence_metadata,
			       		       se.occurred_at, se.created_at
			       		FROM signature_events se
			       		WHERE se.tenant_id = e.tenant_id AND se.envelope_id = e.id
			       		ORDER BY se.occurred_at ASC, se.created_at ASC
			       	) se_row
			       ), '[]'::json) AS events,
			       COALESCE((
			       	SELECT json_agg(row_to_json(sc_row))
			       	FROM (
			       		SELECT sc.id, sc.tenant_id, sc.envelope_id, sc.file_id, sc.file_name,
			       		       sc.file_size_bytes, sc.content_hash, sc.seal_hash, sc.evidence_hash,
			       		       sc.provider, sc.signed_at,
			       		       COALESCE(sc.retention_metadata, '{}'::jsonb) AS retention_metadata,
			       		       COALESCE(sc.custody_metadata, '{}'::jsonb) AS custody_metadata,
			       		       sc.created_by, sc.created_at
			       		FROM signature_custody_evidence sc
			       		WHERE sc.tenant_id = e.tenant_id AND sc.envelope_id = e.id
			       		ORDER BY sc.signed_at ASC, sc.created_at ASC
			       	) sc_row
			       ), '[]'::json) AS custody_evidence
			FROM signature_envelopes e
			WHERE ` + where + `
		) t`
}

func signatureEnvelopeSortColumn(column string) (string, bool) {
	switch column {
	case "e.title":
		return "t.title", true
	case "e.status":
		return "t.status", true
	case "e.provider":
		return "t.provider", true
	case "e.due_at":
		return "t.due_at", true
	case "e.expires_at":
		return "t.expires_at", true
	case "e.updated_at":
		return "t.updated_at", true
	case "e.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
