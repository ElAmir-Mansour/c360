package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// IntakeMessageRepository persists ingested email intake messages
// (legal_intake_messages). provider_message_id carries a partial-unique dedup
// index per (tenant, provider_message_id); Insert relies on the caller having
// checked ExistsByProviderMessageID, while a racing duplicate surfaces as a
// 23505 unique violation the service translates to an idempotent no-op.
type IntakeMessageRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewIntakeMessageRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntakeMessageRepository {
	return &IntakeMessageRepository{db: db, logger: logger}
}

func (r *IntakeMessageRepository) Create(ctx context.Context, q Queryer, msg *model.IntakeMessage) error {
	metaJSON, err := json.Marshal(orEmptyMap(msg.Metadata))
	if err != nil {
		return fmt.Errorf("marshal intake message metadata: %w", err)
	}
	query := `
		INSERT INTO legal_intake_messages (
			id, tenant_id, mailbox_id, provider_message_id, from_address, to_address,
			subject, raw_file_id, attachment_file_ids, classified_request_type,
			beneficiary_entity_id, legal_request_id, status, classifier_reason,
			error_message, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,
			$11,$12,$13,$14,
			$15,$16::jsonb,$17
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		msg.ID, msg.TenantID, msg.MailboxID, msg.ProviderMessageID, msg.FromAddress, msg.ToAddress,
		msg.Subject, msg.RawFileID, attachmentIDs(msg.AttachmentFileIDs), msg.ClassifiedRequestType,
		msg.BeneficiaryEntityID, msg.LegalRequestID, msg.Status, msg.ClassifierReason,
		msg.ErrorMessage, metaJSON, msg.CreatedBy,
	).Scan(&msg.CreatedAt, &msg.UpdatedAt)
}

// MarkClassified records the CAP-003 classifier outcome after the message has
// first been persisted as received.
func (r *IntakeMessageRepository) MarkClassified(ctx context.Context, q Queryer, tenantID, id uuid.UUID, classifiedRequestType string, beneficiaryEntityID *uuid.UUID, reason string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_intake_messages
		SET status = $3,
		    classified_request_type = $4,
		    beneficiary_entity_id = $5,
		    classifier_reason = $6,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, model.IntakeMessageStatusClassified, classifiedRequestType, beneficiaryEntityID, reason,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// MarkRouted records the CAP-003 routing outcome on an existing message row.
func (r *IntakeMessageRepository) MarkRouted(ctx context.Context, q Queryer, tenantID, id uuid.UUID, legalRequestID uuid.UUID, classifiedRequestType string, beneficiaryEntityID *uuid.UUID, reason string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_intake_messages
		SET status = $3,
		    legal_request_id = $4,
		    classified_request_type = $5,
		    beneficiary_entity_id = $6,
		    classifier_reason = $7,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, model.IntakeMessageStatusRouted, legalRequestID, classifiedRequestType, beneficiaryEntityID, reason,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// MarkRejected records a message that could not be routed (audit retention).
func (r *IntakeMessageRepository) MarkRejected(ctx context.Context, q Queryer, tenantID, id uuid.UUID, errorMessage string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_intake_messages
		SET status = $3,
		    error_message = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, model.IntakeMessageStatusRejected, errorMessage,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ExistsByProviderMessageID reports whether a message with the upstream
// Message-ID already exists for the tenant (CAP-002 dedup). Accepts a Queryer so
// it can run inside the same tx that establishes the tenant context.
func (r *IntakeMessageRepository) ExistsByProviderMessageID(ctx context.Context, q Queryer, tenantID uuid.UUID, providerMessageID string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_intake_messages
			WHERE tenant_id = $1 AND provider_message_id = $2
		)`,
		tenantID, strings.TrimSpace(providerMessageID),
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *IntakeMessageRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntakeMessage, error) {
	return r.scanOne(ctx, intakeMessageBaseSelect(`m.tenant_id = $1 AND m.id = $2`), tenantID, id)
}

func (r *IntakeMessageRepository) GetByProviderMessageID(ctx context.Context, q Queryer, tenantID uuid.UUID, providerMessageID string) (*model.IntakeMessage, error) {
	return scanIntakeMessage(q.QueryRow(ctx, intakeMessageBaseSelect(`m.tenant_id = $1 AND m.provider_message_id = $2`), tenantID, strings.TrimSpace(providerMessageID)))
}

func (r *IntakeMessageRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.IntakeMessageListFilters) ([]model.IntakeMessage, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"m.tenant_id = $1"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(m.subject ILIKE '%%' || $%d || '%%' OR m.from_address ILIKE '%%' || $%d || '%%' OR m.provider_message_id ILIKE '%%' || $%d || '%%')", arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("m.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.MailboxID != nil {
		conditions = append(conditions, fmt.Sprintf("m.mailbox_id = $%d", arg))
		args = append(args, *filters.MailboxID)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_intake_messages m WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.IntakeMessage{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "m.created_at"
	if filters.SortColumn == "m.updated_at" {
		orderCol = "m.updated_at"
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := intakeMessageBaseSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]model.IntakeMessage, 0)
	for rows.Next() {
		msg, err := scanIntakeMessage(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *msg)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func intakeMessageBaseSelect(where string) string {
	return `
		SELECT m.id, m.tenant_id, m.mailbox_id, m.provider_message_id, m.from_address,
		       m.to_address, m.subject, m.raw_file_id,
		       COALESCE(m.attachment_file_ids, '{}'), m.classified_request_type,
		       m.beneficiary_entity_id, m.legal_request_id, m.status, m.classifier_reason,
		       m.error_message, COALESCE(m.metadata, '{}'::jsonb), m.created_by,
		       m.created_at, m.updated_at
		FROM legal_intake_messages m
		WHERE ` + where
}

func (r *IntakeMessageRepository) scanOne(ctx context.Context, query string, args ...any) (*model.IntakeMessage, error) {
	return scanIntakeMessage(r.db.QueryRow(ctx, query, args...))
}

func scanIntakeMessage(row rowScanner) (*model.IntakeMessage, error) {
	var msg model.IntakeMessage
	var attachments []uuid.UUID
	var metaRaw []byte
	if err := row.Scan(
		&msg.ID, &msg.TenantID, &msg.MailboxID, &msg.ProviderMessageID, &msg.FromAddress,
		&msg.ToAddress, &msg.Subject, &msg.RawFileID, &attachments, &msg.ClassifiedRequestType,
		&msg.BeneficiaryEntityID, &msg.LegalRequestID, &msg.Status, &msg.ClassifierReason,
		&msg.ErrorMessage, &metaRaw, &msg.CreatedBy, &msg.CreatedAt, &msg.UpdatedAt,
	); err != nil {
		return nil, err
	}
	msg.AttachmentFileIDs = attachments
	if msg.AttachmentFileIDs == nil {
		msg.AttachmentFileIDs = []uuid.UUID{}
	}
	if len(metaRaw) > 0 {
		if err := json.Unmarshal(metaRaw, &msg.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal intake message metadata: %w", err)
		}
	}
	if msg.Metadata == nil {
		msg.Metadata = map[string]any{}
	}
	return &msg, nil
}

func attachmentIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}
