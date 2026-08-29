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

type ObligationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewObligationRepository(db *pgxpool.Pool, logger zerolog.Logger) *ObligationRepository {
	return &ObligationRepository{db: db, logger: logger}
}

func (r *ObligationRepository) Create(ctx context.Context, q Queryer, obligation *model.Obligation) error {
	query := `
		INSERT INTO legal_obligations (
			id, tenant_id, title, description, type, status, priority,
			contract_id, matter_id, clause_id, owner_user_id, owner_name, due_date, completed_at,
			reminder_enabled, reminder_lead_days, escalation_enabled, escalation_lead_days, escalation_target,
			last_reminder_at, tags, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,$14,
			$15,$16,$17,$18,$19,
			$20,$21,$22,$23
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		obligation.ID, obligation.TenantID, obligation.Title, obligation.Description, obligation.Type, obligation.Status, obligation.Priority,
		obligation.ContractID, obligation.MatterID, obligation.ClauseID, obligation.OwnerUserID, obligation.OwnerName, lexDatePtr(&obligation.DueDate), obligation.CompletedAt,
		obligation.ReminderEnabled, int32Slice(obligation.ReminderLeadDays), obligation.EscalationEnabled, int32Slice(obligation.EscalationLeadDays), obligation.EscalationTarget,
		obligation.LastReminderAt, obligation.Tags, obligation.Metadata, obligation.CreatedBy,
	).Scan(&obligation.CreatedAt, &obligation.UpdatedAt)
}

func (r *ObligationRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Obligation, error) {
	query := obligationJSONSelect(`o.tenant_id = $1 AND o.id = $2 AND o.deleted_at IS NULL`)
	return queryRowJSON[model.Obligation](ctx, r.db, query, tenantID, id)
}

func (r *ObligationRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.ObligationListFilters) ([]model.Obligation, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"o.tenant_id = $1", "o.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(o.title ILIKE '%%' || $%d || '%%' OR o.description ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("o.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("o.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("o.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.OwnerUserID != nil {
		conditions = append(conditions, fmt.Sprintf("o.owner_user_id = $%d", arg))
		args = append(args, *filters.OwnerUserID)
		arg++
	}
	if filters.ContractID != nil {
		conditions = append(conditions, fmt.Sprintf("o.contract_id = $%d", arg))
		args = append(args, *filters.ContractID)
		arg++
	}
	if filters.MatterID != nil {
		conditions = append(conditions, fmt.Sprintf("o.matter_id = $%d", arg))
		args = append(args, *filters.MatterID)
		arg++
	}
	if filters.DueBefore != nil {
		conditions = append(conditions, fmt.Sprintf("o.due_date <= $%d", arg))
		args = append(args, lexDatePtr(filters.DueBefore))
		arg++
	}
	if filters.DueAfter != nil {
		conditions = append(conditions, fmt.Sprintf("o.due_date >= $%d", arg))
		args = append(args, lexDatePtr(filters.DueAfter))
		arg++
	}
	if filters.Overdue {
		conditions = append(conditions, "o.due_date < CURRENT_DATE AND o.status NOT IN ('completed', 'waived', 'cancelled')")
	}
	if filters.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(o.tags)", arg))
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Tag)))
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_obligations o WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.Obligation{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.due_date"
	if mapped, ok := obligationSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "ASC"
	if filters.SortDirection == "desc" {
		orderDir = "DESC"
	}
	query := obligationJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.Obligation](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *ObligationRepository) Update(ctx context.Context, q Queryer, obligation *model.Obligation) error {
	query := `
		UPDATE legal_obligations
		SET title = $3,
		    description = $4,
		    type = $5,
		    status = $6,
		    priority = $7,
		    contract_id = $8,
		    matter_id = $9,
		    clause_id = $10,
		    owner_user_id = $11,
		    owner_name = $12,
		    due_date = $13,
		    completed_at = $14,
		    reminder_enabled = $15,
		    reminder_lead_days = $16,
		    escalation_enabled = $17,
		    escalation_lead_days = $18,
		    escalation_target = $19,
		    tags = $20,
		    metadata = $21,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		obligation.TenantID, obligation.ID, obligation.Title, obligation.Description, obligation.Type,
		obligation.Status, obligation.Priority, obligation.ContractID, obligation.MatterID, obligation.ClauseID,
		obligation.OwnerUserID, obligation.OwnerName, lexDatePtr(&obligation.DueDate), obligation.CompletedAt,
		obligation.ReminderEnabled, int32Slice(obligation.ReminderLeadDays),
		obligation.EscalationEnabled, int32Slice(obligation.EscalationLeadDays), obligation.EscalationTarget,
		obligation.Tags, obligation.Metadata,
	).Scan(&obligation.UpdatedAt)
}

func (r *ObligationRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, obligationID uuid.UUID, status model.ObligationStatus, completedAt *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_obligations
		SET status = $3,
		    completed_at = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, obligationID, status, completedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ObligationRepository) ListNotificationCandidates(ctx context.Context, tenantID uuid.UUID, asOf time.Time, horizonDays int) ([]model.Obligation, error) {
	through := asOf.AddDate(0, 0, horizonDays)
	throughDate := lexDatePtr(&through)
	overdueFloor := asOf.AddDate(0, 0, -30)
	overdueFloorDate := lexDatePtr(&overdueFloor)
	query := obligationJSONSelect(`
		o.tenant_id = $1
		AND o.deleted_at IS NULL
		AND o.status NOT IN ('completed', 'waived', 'cancelled')
		AND (o.reminder_enabled OR o.escalation_enabled)
		AND o.due_date BETWEEN $2 AND $3
	`) + ` ORDER BY t.due_date ASC, t.priority DESC, t.title ASC`
	return queryListJSON[model.Obligation](ctx, r.db, query, tenantID, overdueFloorDate, throughDate)
}

func (r *ObligationRepository) MarkReminderSent(ctx context.Context, q Queryer, tenantID, obligationID uuid.UUID, sentAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_obligations
		SET last_reminder_at = $3,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, obligationID, sentAt.UTC(),
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ObligationRepository) EnqueueNotificationOutboxItems(ctx context.Context, q Queryer, items []model.ObligationNotificationOutboxItem) ([]model.ObligationNotificationOutboxItem, int, error) {
	queued := make([]model.ObligationNotificationOutboxItem, 0, len(items))
	skipped := 0
	for _, item := range items {
		if item.Status == "" {
			item.Status = model.ObligationNotificationOutboxPending
		}
		saved, err := insertNotificationOutboxItem(ctx, q, item)
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

func (r *ObligationRepository) MarkNotificationOutboxDelivery(ctx context.Context, q Queryer, tenantID, outboxID uuid.UUID, status model.ObligationNotificationOutboxStatus, attemptedAt time.Time, provider string, providerMessageID *string, providerMetadata map[string]any, errorMessage *string) (*model.ObligationNotificationOutboxItem, error) {
	if providerMetadata == nil {
		providerMetadata = map[string]any{}
	}
	query := `
		WITH updated AS (
			UPDATE legal_obligation_notification_outbox
			SET status = $3::text,
			    provider = $4,
			    provider_message_id = $5,
			    provider_metadata = $6::jsonb,
			    error_message = $7,
			    attempt_count = attempt_count + 1,
			    last_attempt_at = $8::timestamptz,
			    sent_at = CASE WHEN $3::text = 'sent' THEN $8::timestamptz ELSE NULL END,
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2
			RETURNING *
		)
	` + obligationNotificationOutboxJSONFrom("updated")
	return queryRowJSON[model.ObligationNotificationOutboxItem](ctx, q, query,
		tenantID, outboxID, status, provider, providerMessageID, providerMetadata, errorMessage, attemptedAt.UTC(),
	)
}

func (r *ObligationRepository) GetNotificationOutboxItem(ctx context.Context, tenantID, outboxID uuid.UUID) (*model.ObligationNotificationOutboxItem, error) {
	query := obligationNotificationOutboxJSONSelect(`o.tenant_id = $1 AND o.id = $2`, "")
	return queryRowJSON[model.ObligationNotificationOutboxItem](ctx, r.db, query, tenantID, outboxID)
}

func (r *ObligationRepository) ListNotificationOutboxDispatchCandidates(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int, retryFailed bool) ([]model.ObligationNotificationOutboxItem, error) {
	statusPredicate := "o.status = 'pending'"
	if retryFailed {
		statusPredicate = "o.status IN ('pending', 'failed')"
	}
	query := obligationNotificationOutboxJSONSelect(
		`o.tenant_id = $1 AND `+statusPredicate+` AND o.scheduled_at <= $2`,
		`ORDER BY o.scheduled_at ASC, o.created_at ASC LIMIT $3`,
	)
	return queryListJSON[model.ObligationNotificationOutboxItem](ctx, r.db, query, tenantID, asOf.UTC(), limit)
}

func (r *ObligationRepository) MarkNotificationOutboxSentForReminder(ctx context.Context, q Queryer, item model.ObligationNotificationOutboxItem) (*model.ObligationNotificationOutboxItem, error) {
	if item.ProviderMetadata == nil {
		item.ProviderMetadata = map[string]any{}
	}
	if item.SentAt == nil {
		sentAt := time.Now().UTC()
		item.SentAt = &sentAt
	}
	if item.LastAttemptAt == nil {
		item.LastAttemptAt = item.SentAt
	}
	scheduledDate := lexDatePtr(&item.ScheduledAt)
	query := `
		WITH updated AS (
			UPDATE legal_obligation_notification_outbox
			SET event_id = $5,
			    event_type = $6,
			    lead_days = $7,
			    recipient_user_id = $8,
			    recipient_name = $9,
			    recipient_contact = $10,
			    scheduled_at = $11,
			    status = 'sent',
			    provider = $12,
			    provider_message_id = $13,
			    provider_metadata = $14,
			    error_message = NULL,
			    attempt_count = attempt_count + 1,
			    last_attempt_at = $15,
			    sent_at = $15,
			    updated_at = now()
			WHERE tenant_id = $1
			  AND obligation_id = $2
			  AND channel = $3
			  AND scheduled_date = $4
			  AND status IN ('pending', 'sent')
			RETURNING *
		)
	` + obligationNotificationOutboxJSONFrom("updated")
	saved, err := queryRowJSON[model.ObligationNotificationOutboxItem](ctx, q, query,
		item.TenantID, item.ObligationID, item.Channel, scheduledDate,
		item.EventID, item.EventType, item.LeadDays, item.RecipientUserID, item.RecipientName,
		item.RecipientContact, item.ScheduledAt.UTC(), item.Provider, item.ProviderMessageID,
		item.ProviderMetadata, item.SentAt.UTC(),
	)
	if err == nil {
		return saved, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}
	item.Status = model.ObligationNotificationOutboxSent
	item.AttemptCount = 1
	saved, err = insertNotificationOutboxItem(ctx, q, item)
	if err == pgx.ErrNoRows {
		return markExistingNotificationOutboxSentForReminder(ctx, q, item, scheduledDate)
	}
	return saved, err
}

func (r *ObligationRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_obligations SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func insertNotificationOutboxItem(ctx context.Context, q Queryer, item model.ObligationNotificationOutboxItem) (*model.ObligationNotificationOutboxItem, error) {
	if item.ProviderMetadata == nil {
		item.ProviderMetadata = map[string]any{}
	}
	if item.Status == "" {
		item.Status = model.ObligationNotificationOutboxPending
	}
	query := `
		WITH inserted AS (
			INSERT INTO legal_obligation_notification_outbox (
				id, tenant_id, obligation_id, event_id, event_type, lead_days, channel,
				recipient_user_id, recipient_name, recipient_contact, scheduled_at, scheduled_date,
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
	` + obligationNotificationOutboxJSONFrom("inserted")
	return queryRowJSON[model.ObligationNotificationOutboxItem](ctx, q, query,
		item.ID, item.TenantID, item.ObligationID, item.EventID, item.EventType, item.LeadDays, item.Channel,
		item.RecipientUserID, item.RecipientName, item.RecipientContact, item.ScheduledAt.UTC(), lexDatePtr(&item.ScheduledAt),
		item.Status, item.Provider, item.ProviderMessageID, item.ProviderMetadata, item.ErrorMessage,
		item.AttemptCount, item.LastAttemptAt, item.SentAt, item.CreatedBy,
	)
}

func markExistingNotificationOutboxSentForReminder(ctx context.Context, q Queryer, item model.ObligationNotificationOutboxItem, scheduledDate *time.Time) (*model.ObligationNotificationOutboxItem, error) {
	query := `
		WITH updated AS (
			UPDATE legal_obligation_notification_outbox
			SET event_id = $5,
			    event_type = $6,
			    lead_days = $7,
			    recipient_user_id = $8,
			    recipient_name = $9,
			    recipient_contact = $10,
			    scheduled_at = $11,
			    status = 'sent',
			    provider = $12,
			    provider_message_id = $13,
			    provider_metadata = $14,
			    error_message = NULL,
			    attempt_count = attempt_count + 1,
			    last_attempt_at = $15,
			    sent_at = $15,
			    updated_at = now()
			WHERE tenant_id = $1
			  AND obligation_id = $2
			  AND channel = $3
			  AND scheduled_date = $4
			  AND status IN ('pending', 'sent')
			RETURNING *
		)
	` + obligationNotificationOutboxJSONFrom("updated")
	return queryRowJSON[model.ObligationNotificationOutboxItem](ctx, q, query,
		item.TenantID, item.ObligationID, item.Channel, scheduledDate,
		item.EventID, item.EventType, item.LeadDays, item.RecipientUserID, item.RecipientName,
		item.RecipientContact, item.ScheduledAt.UTC(), item.Provider, item.ProviderMessageID,
		item.ProviderMetadata, item.SentAt.UTC(),
	)
}

func obligationNotificationOutboxJSONFrom(source string) string {
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.obligation_id, o.event_id, o.event_type,
			       o.lead_days, o.channel, o.recipient_user_id, o.recipient_name,
			       o.recipient_contact, o.scheduled_at, o.status, o.provider,
			       o.provider_message_id, COALESCE(o.provider_metadata, '{}'::jsonb) AS provider_metadata,
			       o.error_message, o.attempt_count, o.last_attempt_at, o.sent_at,
			       o.created_by, o.created_at, o.updated_at
			FROM %s o
		) t`, source)
}

func obligationNotificationOutboxJSONSelect(where string, suffix string) string {
	if strings.TrimSpace(suffix) != "" {
		suffix = " " + strings.TrimSpace(suffix)
	}
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.obligation_id, o.event_id, o.event_type,
			       o.lead_days, o.channel, o.recipient_user_id, o.recipient_name,
			       o.recipient_contact, o.scheduled_at, o.status, o.provider,
			       o.provider_message_id, COALESCE(o.provider_metadata, '{}'::jsonb) AS provider_metadata,
			       o.error_message, o.attempt_count, o.last_attempt_at, o.sent_at,
			       o.created_by, o.created_at, o.updated_at
			FROM legal_obligation_notification_outbox o
			WHERE %s%s
		) t`, where, suffix)
}

func obligationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT o.id, o.tenant_id, o.title, o.description, o.type, o.status, o.priority,
			       o.contract_id, c.title AS contract_title,
			       o.matter_id, m.title AS matter_title,
			       o.clause_id, o.owner_user_id, o.owner_name,
			       o.due_date::timestamptz AS due_date, o.completed_at,
			       o.reminder_enabled, COALESCE(o.reminder_lead_days, '{}') AS reminder_lead_days,
			       o.escalation_enabled, COALESCE(o.escalation_lead_days, '{}') AS escalation_lead_days,
			       o.escalation_target, o.last_reminder_at,
			       COALESCE(o.tags, '{}') AS tags, COALESCE(o.metadata, '{}'::jsonb) AS metadata,
			       o.created_by, o.created_at, o.updated_at, o.deleted_at,
			       (o.due_date - CURRENT_DATE)::int AS days_until_due
			FROM legal_obligations o
			LEFT JOIN contracts c ON c.id = o.contract_id AND c.tenant_id = o.tenant_id AND c.deleted_at IS NULL
			LEFT JOIN legal_matters m ON m.id = o.matter_id AND m.tenant_id = o.tenant_id AND m.deleted_at IS NULL
			WHERE ` + where + `
		) t`
}

func obligationSortColumn(column string) (string, bool) {
	switch column {
	case "o.title":
		return "t.title", true
	case "o.status":
		return "t.status", true
	case "o.type":
		return "t.type", true
	case "o.priority":
		return "t.priority", true
	case "o.due_date":
		return "t.due_date", true
	case "o.updated_at":
		return "t.updated_at", true
	case "o.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}

func int32Slice(values []int) []int32 {
	out := make([]int32, 0, len(values))
	for _, value := range values {
		out = append(out, int32(value))
	}
	return out
}
