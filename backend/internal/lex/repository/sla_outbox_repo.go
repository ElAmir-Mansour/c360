package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SLAOutboxRepository owns the append-only SLA notification outbox. It mirrors the
// obligation outbox (000007): partial-unique dedup on
// (tenant, clock, event_type, escalation_level) so the idempotent monitor never
// double-queues an ack/breach/escalation, and a status machine driven by the
// shared dispatcher seam.
type SLAOutboxRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSLAOutboxRepository(db *pgxpool.Pool, logger zerolog.Logger) *SLAOutboxRepository {
	return &SLAOutboxRepository{db: db, logger: logger}
}

// Enqueue inserts the supplied outbox rows, swallowing dedup conflicts. Returns the
// rows actually queued plus the number skipped as duplicates.
func (r *SLAOutboxRepository) Enqueue(ctx context.Context, q Queryer, items []model.SLANotificationOutboxItem) ([]model.SLANotificationOutboxItem, int, error) {
	queued := make([]model.SLANotificationOutboxItem, 0, len(items))
	skipped := 0
	for _, item := range items {
		if item.Status == "" {
			item.Status = model.SLANotificationOutboxPending
		}
		saved, err := insertSLAOutboxItem(ctx, q, item)
		if err != nil {
			if err == pgx.ErrNoRows {
				skipped++
				continue
			}
			return nil, skipped, err
		}
		queued = append(queued, *saved)
	}
	return queued, skipped, nil
}

func insertSLAOutboxItem(ctx context.Context, q Queryer, item model.SLANotificationOutboxItem) (*model.SLANotificationOutboxItem, error) {
	if item.ProviderMetadata == nil {
		item.ProviderMetadata = map[string]any{}
	}
	if item.Status == "" {
		item.Status = model.SLANotificationOutboxPending
	}
	query := `
		WITH inserted AS (
			INSERT INTO legal_sla_notification_outbox (
				id, tenant_id, sla_clock_id, legal_request_id, event_id, event_type, escalation_level,
				channel, recipient_user_id, recipient_name, recipient_contact, scheduled_at,
				status, provider, provider_message_id, provider_metadata, error_message,
				attempt_count, last_attempt_at, sent_at, created_by
			) VALUES (
				$1,$2,$3,$4,$5,$6,$7,
				$8,$9,$10,$11,$12,
				$13,$14,$15,$16,$17,
				$18,$19,$20,$21
			)
			ON CONFLICT DO NOTHING
			RETURNING *
		)
	` + slaOutboxJSONFrom("inserted")
	return queryRowJSON[model.SLANotificationOutboxItem](ctx, q, query,
		item.ID, item.TenantID, item.SLAClockID, item.LegalRequestID, item.EventID, item.EventType, item.EscalationLevel,
		item.Channel, item.RecipientUserID, item.RecipientName, item.RecipientContact, item.ScheduledAt.UTC(),
		item.Status, item.Provider, item.ProviderMessageID, item.ProviderMetadata, item.ErrorMessage,
		item.AttemptCount, item.LastAttemptAt, item.SentAt, item.CreatedBy,
	)
}

func (r *SLAOutboxRepository) Get(ctx context.Context, tenantID, outboxID uuid.UUID) (*model.SLANotificationOutboxItem, error) {
	query := slaOutboxJSONSelect(`o.tenant_id = $1 AND o.id = $2`, "")
	return queryRowJSON[model.SLANotificationOutboxItem](ctx, r.db, query, tenantID, outboxID)
}

func (r *SLAOutboxRepository) ListDispatchCandidates(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int, retryFailed bool) ([]model.SLANotificationOutboxItem, error) {
	if limit <= 0 {
		limit = 200
	}
	statusPredicate := "o.status = 'pending'"
	if retryFailed {
		statusPredicate = "o.status IN ('pending', 'failed')"
	}
	query := slaOutboxJSONSelect(
		`o.tenant_id = $1 AND `+statusPredicate+` AND o.scheduled_at <= $2`,
		`ORDER BY o.scheduled_at ASC, o.created_at ASC LIMIT $3`,
	)
	return queryListJSON[model.SLANotificationOutboxItem](ctx, r.db, query, tenantID, asOf.UTC(), limit)
}

// ClaimDispatchCandidates atomically reserves up to `limit` due outbox rows for a
// single dispatcher pass so concurrent tickers/instances never contend for the
// same row. It selects the eligible rows with FOR UPDATE SKIP LOCKED inside the
// same statement that returns them, so a row a competing pass already holds is
// skipped (it returns fewer rows) rather than blocking. The status itself is NOT
// mutated here — MarkDelivery records the terminal verdict — but the row lock is
// held until the surrounding transaction commits/rolls back, so callers that want
// the claim to fence the whole dispatch MUST pass a transaction Queryer and keep
// it open across the MarkDelivery write. Callers that only need an ordered batch
// (the existing best-effort path) may pass the pool; the lock then releases at
// statement end, degrading gracefully to ListDispatchCandidates semantics.
func (r *SLAOutboxRepository) ClaimDispatchCandidates(ctx context.Context, q Queryer, tenantID uuid.UUID, asOf time.Time, limit int, retryFailed bool) ([]model.SLANotificationOutboxItem, error) {
	if limit <= 0 {
		limit = 200
	}
	statusPredicate := "status = 'pending'"
	if retryFailed {
		statusPredicate = "status IN ('pending', 'failed')"
	}
	// The CTE claims the row ids under SKIP LOCKED, then the outer JSON projection
	// hydrates only the claimed ids. Claiming by id (not re-scanning the table)
	// keeps the projection consistent with the locked set.
	query := `
		WITH claimed AS (
			SELECT id
			FROM legal_sla_notification_outbox
			WHERE tenant_id = $1 AND ` + statusPredicate + ` AND scheduled_at <= $2
			ORDER BY scheduled_at ASC, created_at ASC
			LIMIT $3
			FOR UPDATE SKIP LOCKED
		)
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.sla_clock_id, o.legal_request_id, o.event_id, o.event_type,
			       o.escalation_level, o.channel, o.recipient_user_id, o.recipient_name,
			       o.recipient_contact, o.scheduled_at, o.status, o.provider,
			       o.provider_message_id, COALESCE(o.provider_metadata, '{}'::jsonb) AS provider_metadata,
			       o.error_message, o.attempt_count, o.last_attempt_at, o.sent_at,
			       o.created_by, o.created_at, o.updated_at
			FROM legal_sla_notification_outbox o
			JOIN claimed c ON c.id = o.id
			ORDER BY o.scheduled_at ASC, o.created_at ASC
		) t`
	return queryListJSON[model.SLANotificationOutboxItem](ctx, q, query, tenantID, asOf.UTC(), limit)
}

func (r *SLAOutboxRepository) MarkDelivery(ctx context.Context, q Queryer, tenantID, outboxID uuid.UUID, status model.SLANotificationOutboxStatus, attemptedAt time.Time, provider string, providerMessageID *string, providerMetadata map[string]any, errorMessage *string) (*model.SLANotificationOutboxItem, error) {
	if providerMetadata == nil {
		providerMetadata = map[string]any{}
	}
	// status IN ('pending','failed') is the delivery precondition: a row already
	// marked 'sent' is terminal, so a duplicate dispatch (a lost claim race, or a
	// retry that overlapped a concurrent pass) updates 0 rows and returns nil. The
	// service treats a nil row as "already delivered by the winning pass" rather
	// than a not-found error, so the outcome is idempotent.
	query := `
		WITH updated AS (
			UPDATE legal_sla_notification_outbox
			SET status = $3::text,
			    provider = $4,
			    provider_message_id = $5,
			    provider_metadata = $6::jsonb,
			    error_message = $7,
			    attempt_count = attempt_count + 1,
			    last_attempt_at = $8::timestamptz,
			    sent_at = CASE WHEN $3::text = 'sent' THEN $8::timestamptz ELSE NULL END,
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'failed')
			RETURNING *
		)
	` + slaOutboxJSONFrom("updated")
	item, err := queryRowJSON[model.SLANotificationOutboxItem](ctx, q, query,
		tenantID, outboxID, status, provider, providerMessageID, providerMetadata, errorMessage, attemptedAt.UTC(),
	)
	if err == pgx.ErrNoRows {
		// 0 rows: lost race / already terminal — no-op, not an error.
		return nil, nil
	}
	return item, err
}

func slaOutboxJSONFrom(source string) string {
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.sla_clock_id, o.legal_request_id, o.event_id, o.event_type,
			       o.escalation_level, o.channel, o.recipient_user_id, o.recipient_name,
			       o.recipient_contact, o.scheduled_at, o.status, o.provider,
			       o.provider_message_id, COALESCE(o.provider_metadata, '{}'::jsonb) AS provider_metadata,
			       o.error_message, o.attempt_count, o.last_attempt_at, o.sent_at,
			       o.created_by, o.created_at, o.updated_at
			FROM %s o
		) t`, source)
}

func slaOutboxJSONSelect(where string, suffix string) string {
	if strings.TrimSpace(suffix) != "" {
		suffix = " " + strings.TrimSpace(suffix)
	}
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.sla_clock_id, o.legal_request_id, o.event_id, o.event_type,
			       o.escalation_level, o.channel, o.recipient_user_id, o.recipient_name,
			       o.recipient_contact, o.scheduled_at, o.status, o.provider,
			       o.provider_message_id, COALESCE(o.provider_metadata, '{}'::jsonb) AS provider_metadata,
			       o.error_message, o.attempt_count, o.last_attempt_at, o.sent_at,
			       o.created_by, o.created_at, o.updated_at
			FROM legal_sla_notification_outbox o
			WHERE %s%s
		) t`, where, suffix)
}
