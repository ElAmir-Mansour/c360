package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// NotificationInboxRepository owns the durable lex in-app inbox
// (lex_notification_inbox, CAP-156). It is the lex-side alternative to coupling
// against the platform notification-service: the consumer/monitor write rows
// here directly. Idempotency is enforced by a partial-unique index on
// (tenant, recipient_id, dedup_key) so a re-fired event/monitor pass is
// swallowed (mirrors the SLA/obligation outbox dedup idiom). Queries filter by
// tenant_id (primary predicate) with table RLS as a backstop.
type NotificationInboxRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewNotificationInboxRepository(db *pgxpool.Pool, logger zerolog.Logger) *NotificationInboxRepository {
	return &NotificationInboxRepository{db: db, logger: logger}
}

// Create inserts an inbox row, swallowing dedup conflicts. The returned bool is
// false when the row was a duplicate (dedup_key already present for the
// recipient) and therefore not written.
func (r *NotificationInboxRepository) Create(ctx context.Context, q Queryer, item *model.NotificationInboxItem) (bool, error) {
	if q == nil {
		q = r.db
	}
	if item.Category == "" {
		item.Category = model.NotificationCategoryGeneral
	}
	metaJSON, err := json.Marshal(orEmptyMap(item.Metadata))
	if err != nil {
		return false, fmt.Errorf("marshal notification inbox metadata: %w", err)
	}
	titleJSON, err := json.Marshal(item.Title)
	if err != nil {
		return false, fmt.Errorf("marshal notification inbox title: %w", err)
	}
	bodyJSON, err := json.Marshal(item.Body)
	if err != nil {
		return false, fmt.Errorf("marshal notification inbox body: %w", err)
	}
	query := `
		INSERT INTO lex_notification_inbox (
			id, tenant_id, recipient_id, category, title, body,
			entity_type, entity_id, action_url, event_id, dedup_key, metadata
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6::jsonb,
			$7,$8,$9,$10,$11,$12::jsonb
		)
		ON CONFLICT DO NOTHING
		RETURNING created_at, updated_at`
	err = q.QueryRow(ctx, query,
		item.ID, item.TenantID, item.RecipientID, item.Category, titleJSON, bodyJSON,
		item.EntityType, item.EntityID, item.ActionURL, item.EventID, item.DedupKey, metaJSON,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *NotificationInboxRepository) Get(ctx context.Context, tenantID, recipientID, id uuid.UUID) (*model.NotificationInboxItem, error) {
	query := notificationInboxJSONSelect(`n.tenant_id = $1 AND n.recipient_id = $2 AND n.id = $3 AND n.deleted_at IS NULL`, "")
	return queryRowJSON[model.NotificationInboxItem](ctx, r.db, query, tenantID, recipientID, id)
}

// List returns a recipient's inbox page plus the total count matching the
// filters (excluding pagination).
func (r *NotificationInboxRepository) List(ctx context.Context, tenantID, recipientID uuid.UUID, filters model.NotificationInboxListFilters) ([]model.NotificationInboxItem, int, error) {
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	args := []any{tenantID, recipientID}
	conditions := []string{"n.tenant_id = $1", "n.recipient_id = $2", "n.deleted_at IS NULL"}
	if filters.Category != nil {
		args = append(args, *filters.Category)
		conditions = append(conditions, fmt.Sprintf("n.category = $%d", len(args)))
	}
	if filters.UnreadOnly {
		conditions = append(conditions, "n.read_at IS NULL")
	}
	where := strings.Join(conditions, " AND ")

	var total int
	countQuery := `SELECT count(*) FROM lex_notification_inbox n WHERE ` + where
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	sortColumn := notificationInboxSortColumn(filters.SortColumn)
	sortDir := "DESC"
	if strings.EqualFold(filters.SortDirection, "asc") {
		sortDir = "ASC"
	}
	args = append(args, perPage, (page-1)*perPage)
	suffix := fmt.Sprintf("ORDER BY %s %s, n.id DESC LIMIT $%d OFFSET $%d", sortColumn, sortDir, len(args)-1, len(args))
	listQuery := notificationInboxJSONSelect(where, suffix)
	items, err := queryListJSON[model.NotificationInboxItem](ctx, r.db, listQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Counts returns total and unread counts for badge rendering.
func (r *NotificationInboxRepository) Counts(ctx context.Context, tenantID, recipientID uuid.UUID) (model.NotificationInboxCounts, error) {
	var counts model.NotificationInboxCounts
	query := `
		SELECT count(*) AS total,
		       count(*) FILTER (WHERE read_at IS NULL) AS unread
		FROM lex_notification_inbox
		WHERE tenant_id = $1 AND recipient_id = $2 AND deleted_at IS NULL`
	err := r.db.QueryRow(ctx, query, tenantID, recipientID).Scan(&counts.Total, &counts.Unread)
	return counts, err
}

// MarkRead marks a single row read (idempotent: a row already read keeps its
// original read_at). Returns the updated row.
func (r *NotificationInboxRepository) MarkRead(ctx context.Context, tenantID, recipientID, id uuid.UUID, readAt time.Time) (*model.NotificationInboxItem, error) {
	query := `
		WITH updated AS (
			UPDATE lex_notification_inbox
			SET read_at = COALESCE(read_at, $4::timestamptz), updated_at = now()
			WHERE tenant_id = $1 AND recipient_id = $2 AND id = $3 AND deleted_at IS NULL
			RETURNING *
		)
	` + notificationInboxJSONFrom("updated")
	return queryRowJSON[model.NotificationInboxItem](ctx, r.db, query, tenantID, recipientID, id, readAt.UTC())
}

// MarkAllRead marks every unread row of a recipient read and returns the number
// of rows affected.
func (r *NotificationInboxRepository) MarkAllRead(ctx context.Context, tenantID, recipientID uuid.UUID, readAt time.Time) (int64, error) {
	ct, err := r.db.Exec(ctx, `
		UPDATE lex_notification_inbox
		SET read_at = $3::timestamptz, updated_at = now()
		WHERE tenant_id = $1 AND recipient_id = $2 AND read_at IS NULL AND deleted_at IS NULL`,
		tenantID, recipientID, readAt.UTC())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

func notificationInboxSortColumn(requested string) string {
	switch requested {
	case "created_at", "n.created_at":
		return "n.created_at"
	case "read_at", "n.read_at":
		return "n.read_at"
	case "category", "n.category":
		return "n.category"
	default:
		return "n.created_at"
	}
}

func notificationInboxJSONSelect(where, suffix string) string {
	if strings.TrimSpace(suffix) != "" {
		suffix = " " + strings.TrimSpace(suffix)
	}
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT n.id, n.tenant_id, n.recipient_id, n.category,
			       COALESCE(n.title, '{}'::jsonb) AS title,
			       COALESCE(n.body, '{}'::jsonb) AS body,
			       n.entity_type, n.entity_id, n.action_url, n.event_id, n.dedup_key,
			       COALESCE(n.metadata, '{}'::jsonb) AS metadata,
			       n.read_at, n.created_at, n.updated_at
			FROM lex_notification_inbox n
			WHERE %s%s
		) t`, where, suffix)
}

func notificationInboxJSONFrom(source string) string {
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT n.id, n.tenant_id, n.recipient_id, n.category,
			       COALESCE(n.title, '{}'::jsonb) AS title,
			       COALESCE(n.body, '{}'::jsonb) AS body,
			       n.entity_type, n.entity_id, n.action_url, n.event_id, n.dedup_key,
			       COALESCE(n.metadata, '{}'::jsonb) AS metadata,
			       n.read_at, n.created_at, n.updated_at
			FROM %s n
		) t`, source)
}
