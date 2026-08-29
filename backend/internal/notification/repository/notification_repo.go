package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/notification/dto"
	"github.com/clario360/platform/internal/notification/model"
)

// rowQuerier is satisfied by both *pgxpool.Pool and pgx.Tx, letting an insert
// run either directly on the pool or inside a tenant-scoped transaction.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ErrNotFound is returned when a notification record cannot be found.
var ErrNotFound = errors.New("notification not found")

// NotificationRepository handles notification CRUD operations.
type NotificationRepository struct {
	// db is an interface seam (PgxDB) so the read paths and the dedup/insert
	// paths can be unit-tested with pgxmock; production always passes a concrete
	// *pgxpool.Pool via the constructor. The tenant-GUC write paths
	// (Insert/InsertWithDedup/insertInTx) type-assert back to *pgxpool.Pool
	// because database.RunWithTenant / pool.Begin need a real pool — so
	// production behaviour is byte-for-byte identical and only a mock pool (tests)
	// falls through to the direct-exec path.
	db     PgxDB
	logger zerolog.Logger
}

// NewNotificationRepository creates a new NotificationRepository.
func NewNotificationRepository(db *pgxpool.Pool, logger zerolog.Logger) *NotificationRepository {
	return &NotificationRepository{db: db, logger: logger.With().Str("component", "notification_repo").Logger()}
}

// InsertWithDedup inserts a notification and returns its ID. If a duplicate exists
// (same tenant+user+source_event_id+type), returns empty string and no error (dedup).
//
// The dedup key includes the notification `type` (#9) so that two distinct rules
// firing on one source event — producing different notification types for the same
// user — both survive; only a genuine redelivery of the same (event, user, type)
// collapses. The ON CONFLICT target mirrors the partial-unique idx_notif_dedup index.
func (r *NotificationRepository) InsertWithDedup(ctx context.Context, n *model.Notification) (string, error) {
	dataBytes, err := json.Marshal(n.Data)
	if err != nil {
		dataBytes = []byte("{}")
	}

	const query = `
		INSERT INTO notifications (tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id, user_id, source_event_id, type) WHERE source_event_id IS NOT NULL DO NOTHING
		RETURNING id`

	args := []interface{}{
		n.TenantID, n.UserID, string(n.Type), n.Category, n.Priority,
		n.Title, n.Body, dataBytes, n.ActionURL, n.SourceEventID,
	}

	exec := func(q rowQuerier) (string, error) {
		var id string
		scanErr := q.QueryRow(ctx, query, args...).Scan(&id)
		if scanErr == pgx.ErrNoRows {
			// Duplicate — dedup triggered.
			return "", nil
		}
		if scanErr != nil {
			return "", fmt.Errorf("insert notification: %w", scanErr)
		}
		return id, nil
	}

	// Defense-in-depth (#15): set the tenant GUC inside a tx so FORCE RLS on
	// notifications holds under a non-superuser role. No-op-safe under superuser.
	// database.RunWithTenant needs a concrete *pgxpool.Pool; in production r.db
	// always is one so this path is unchanged. A pgxmock pool (tests) fails the
	// assertion and falls through to the direct-exec path below.
	if pool, ok := r.db.(*pgxpool.Pool); ok {
		if tid, perr := uuid.Parse(n.TenantID); perr == nil {
			var id string
			txErr := database.RunWithTenant(ctx, pool, tid, func(tx pgx.Tx) error {
				var innerErr error
				id, innerErr = exec(tx)
				return innerErr
			})
			return id, txErr
		}
	}
	return exec(r.db)
}

// Insert inserts a notification without dedup (no source_event_id).
func (r *NotificationRepository) Insert(ctx context.Context, n *model.Notification) (string, error) {
	dataBytes, err := json.Marshal(n.Data)
	if err != nil {
		dataBytes = []byte("{}")
	}

	const query = `
		INSERT INTO notifications (tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id`

	args := []interface{}{
		n.TenantID, n.UserID, string(n.Type), n.Category, n.Priority,
		n.Title, n.Body, dataBytes, n.ActionURL, n.SourceEventID,
	}

	exec := func(q rowQuerier) (string, error) {
		var id string
		if scanErr := q.QueryRow(ctx, query, args...).Scan(&id); scanErr != nil {
			return "", fmt.Errorf("insert notification: %w", scanErr)
		}
		return id, nil
	}

	// Defense-in-depth (#15): set the tenant GUC inside a tx so FORCE RLS holds
	// under a non-superuser role. No-op-safe under superuser. Only a concrete
	// *pgxpool.Pool (production) takes the tenant-scoped tx path; a pgxmock pool
	// (tests) falls through to the direct-exec path.
	if pool, ok := r.db.(*pgxpool.Pool); ok {
		if tid, perr := uuid.Parse(n.TenantID); perr == nil {
			var id string
			txErr := database.RunWithTenant(ctx, pool, tid, func(tx pgx.Tx) error {
				var innerErr error
				id, innerErr = exec(tx)
				return innerErr
			})
			return id, txErr
		}
	}
	return exec(r.db)
}

// StageFunc runs inside the notification-insert transaction so a caller can
// transactionally stage a side effect (e.g. a transactional-outbox event)
// atomically with the notification write. It receives the open tx and the
// freshly inserted notification id, and is invoked ONLY when a row was actually
// inserted (never on a dedup no-op). Returning an error rolls back the whole
// transaction, so the notification and its staged event commit or fail together.
type StageFunc func(ctx context.Context, tx pgx.Tx, id string) error

// InsertWithDedupStaged behaves exactly like InsertWithDedup but additionally
// runs stage within the SAME transaction as the insert when (and only when) a
// row is inserted. It is the transactional-outbox path (#12): the caller stages
// the notification.created event with the inserted id so the event cannot be
// lost after the row commits. stage may be nil, in which case this is identical
// to InsertWithDedup. On a dedup no-op ("" id) stage is not called.
func (r *NotificationRepository) InsertWithDedupStaged(ctx context.Context, n *model.Notification, stage StageFunc) (string, error) {
	if stage == nil {
		return r.InsertWithDedup(ctx, n)
	}

	dataBytes, err := json.Marshal(n.Data)
	if err != nil {
		dataBytes = []byte("{}")
	}

	const query = `
		INSERT INTO notifications (tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id, user_id, source_event_id, type) WHERE source_event_id IS NOT NULL DO NOTHING
		RETURNING id`

	args := []interface{}{
		n.TenantID, n.UserID, string(n.Type), n.Category, n.Priority,
		n.Title, n.Body, dataBytes, n.ActionURL, n.SourceEventID,
	}

	run := func(tx pgx.Tx) (string, error) {
		var id string
		scanErr := tx.QueryRow(ctx, query, args...).Scan(&id)
		if scanErr == pgx.ErrNoRows {
			return "", nil // duplicate — dedup triggered, nothing to stage
		}
		if scanErr != nil {
			return "", fmt.Errorf("insert notification: %w", scanErr)
		}
		if err := stage(ctx, tx, id); err != nil {
			return "", fmt.Errorf("stage notification event: %w", err)
		}
		return id, nil
	}

	return r.insertInTx(ctx, n.TenantID, run)
}

// InsertStaged behaves exactly like Insert but additionally runs stage within
// the SAME transaction as the insert (transactional outbox, #12). stage may be
// nil, in which case this is identical to Insert.
func (r *NotificationRepository) InsertStaged(ctx context.Context, n *model.Notification, stage StageFunc) (string, error) {
	if stage == nil {
		return r.Insert(ctx, n)
	}

	dataBytes, err := json.Marshal(n.Data)
	if err != nil {
		dataBytes = []byte("{}")
	}

	const query = `
		INSERT INTO notifications (tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id`

	args := []interface{}{
		n.TenantID, n.UserID, string(n.Type), n.Category, n.Priority,
		n.Title, n.Body, dataBytes, n.ActionURL, n.SourceEventID,
	}

	run := func(tx pgx.Tx) (string, error) {
		var id string
		if scanErr := tx.QueryRow(ctx, query, args...).Scan(&id); scanErr != nil {
			return "", fmt.Errorf("insert notification: %w", scanErr)
		}
		if err := stage(ctx, tx, id); err != nil {
			return "", fmt.Errorf("stage notification event: %w", err)
		}
		return id, nil
	}

	return r.insertInTx(ctx, n.TenantID, run)
}

// insertInTx runs fn inside a transaction. When the tenant id is a UUID it uses
// database.RunWithTenant so the tenant GUC is set (FORCE RLS holds under a
// non-superuser role, matching Insert/InsertWithDedup); otherwise it falls back
// to a plain transaction so the staged write is still atomic with the insert.
func (r *NotificationRepository) insertInTx(ctx context.Context, tenantID string, fn func(pgx.Tx) (string, error)) (string, error) {
	var id string
	// The staged-outbox write path opens a real transaction and therefore needs a
	// concrete *pgxpool.Pool. In production r.db always is one; a pgxmock pool is
	// rejected here (the staged path is exercised by the DB-backed integration
	// tests, not the pgxmock unit tests).
	pool, ok := r.db.(*pgxpool.Pool)
	if !ok {
		return "", fmt.Errorf("insertInTx requires a *pgxpool.Pool")
	}
	if tid, perr := uuid.Parse(tenantID); perr == nil {
		txErr := database.RunWithTenant(ctx, pool, tid, func(tx pgx.Tx) error {
			var innerErr error
			id, innerErr = fn(tx)
			return innerErr
		})
		return id, txErr
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin notification tx: %w", err)
	}
	defer tx.Rollback(ctx)
	id, err = fn(tx)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit notification tx: %w", err)
	}
	return id, nil
}

// DeleteOldNotifications removes read notifications older than the cutoff, in
// batches to bound lock/WAL footprint. It loops until fewer than batchSize rows
// remain or ctx is cancelled, returning the total deleted. Only already-read
// notifications are purged so unread items are never lost. Intended to be driven
// by a retention scheduler (Wave C/E) following the DigestService.RunScheduler
// pattern (#16). Not wired here.
func (r *NotificationRepository) DeleteOldNotifications(ctx context.Context, olderThan time.Time, batchSize int) (int64, error) {
	if batchSize <= 0 {
		batchSize = 1000
	}
	const query = `
		DELETE FROM notifications
		WHERE id IN (
			SELECT id FROM notifications
			WHERE read_at IS NOT NULL AND created_at < $1
			ORDER BY created_at
			LIMIT $2
		)`
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		tag, err := r.db.Exec(ctx, query, olderThan, batchSize)
		if err != nil {
			return total, fmt.Errorf("delete old notifications: %w", err)
		}
		n := tag.RowsAffected()
		total += n
		if n < int64(batchSize) {
			break
		}
	}
	return total, nil
}

// FindByID returns a single notification by ID, scoped to tenant and user.
func (r *NotificationRepository) FindByID(ctx context.Context, tenantID, userID, id string) (*model.Notification, error) {
	query := `
		SELECT id, tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id, read_at, created_at
		FROM notifications
		WHERE id = $1 AND tenant_id = $2 AND user_id = $3`

	return r.scanNotification(r.db.QueryRow(ctx, query, id, tenantID, userID))
}

// Query lists notifications with filtering and pagination.
func (r *NotificationRepository) Query(ctx context.Context, params *dto.QueryParams) ([]model.Notification, int, error) {
	where, args := r.buildWhere(params)

	countQuery := "SELECT COUNT(*) FROM notifications" + where
	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count notifications: %w", err)
	}

	orderCol := "created_at"
	if params.Sort == "priority" {
		orderCol = "CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END"
	}
	orderDir := "DESC"
	if params.Order == "asc" {
		orderDir = "ASC"
	}

	argIdx := len(args) + 1
	dataQuery := fmt.Sprintf(
		"SELECT id, tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id, read_at, created_at FROM notifications%s ORDER BY %s %s LIMIT $%d OFFSET $%d",
		where, orderCol, orderDir, argIdx, argIdx+1,
	)
	args = append(args, params.PerPage, params.Offset())

	rows, err := r.db.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()

	results := make([]model.Notification, 0)
	for rows.Next() {
		n, err := r.scanNotificationFromRow(rows)
		if err != nil {
			return nil, 0, err
		}
		results = append(results, *n)
	}
	return results, total, rows.Err()
}

// UnreadCount returns the number of unread notifications for a user in a tenant.
func (r *NotificationRepository) UnreadCount(ctx context.Context, tenantID, userID string) (int64, error) {
	var count int64
	err := r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL",
		tenantID, userID,
	).Scan(&count)
	return count, err
}

// MarkRead marks a single notification as read. The operation is idempotent:
// if the notification is already read, nil is returned. ErrNotFound is returned
// only when the notification genuinely does not belong to the user/tenant.
//
// A single CTE resolves both the UPDATE and the existence check in one round-trip,
// replacing the prior two-query approach.
func (r *NotificationRepository) MarkRead(ctx context.Context, tenantID, userID, id string) error {
	const query = `
		WITH update_attempt AS (
			UPDATE notifications SET read_at = $1
			WHERE id = $2 AND tenant_id = $3 AND user_id = $4 AND read_at IS NULL
			RETURNING id
		),
		row_exists AS (
			SELECT id FROM notifications WHERE id = $2 AND tenant_id = $3 AND user_id = $4
		)
		SELECT
			(SELECT COUNT(*) FROM update_attempt) AS rows_updated,
			(SELECT COUNT(*) FROM row_exists)     AS rows_found`

	var rowsUpdated, rowsFound int
	if err := r.db.QueryRow(ctx, query, time.Now().UTC(), id, tenantID, userID).
		Scan(&rowsUpdated, &rowsFound); err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if rowsFound == 0 {
		return fmt.Errorf("%w", ErrNotFound)
	}
	// rowsUpdated == 0 && rowsFound > 0 → already read, idempotent success.
	return nil
}

// MarkAllRead marks all unread notifications as read for a user in a tenant.
func (r *NotificationRepository) MarkAllRead(ctx context.Context, tenantID, userID string) (int64, error) {
	now := time.Now().UTC()
	tag, err := r.db.Exec(ctx,
		"UPDATE notifications SET read_at = $1 WHERE tenant_id = $2 AND user_id = $3 AND read_at IS NULL",
		now, tenantID, userID,
	)
	if err != nil {
		return 0, fmt.Errorf("mark all read: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Delete hard-deletes a notification.
func (r *NotificationRepository) Delete(ctx context.Context, tenantID, userID, id string) error {
	tag, err := r.db.Exec(ctx,
		"DELETE FROM notifications WHERE id = $1 AND tenant_id = $2 AND user_id = $3",
		id, tenantID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete notification: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w", ErrNotFound)
	}
	return nil
}

// BulkDelete deletes multiple notifications by ID, scoped to tenant and user.
func (r *NotificationRepository) BulkDelete(ctx context.Context, tenantID, userID string, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	// Build parameterized query with ANY($3)
	tag, err := r.db.Exec(ctx,
		"DELETE FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND id = ANY($3)",
		tenantID, userID, ids,
	)
	if err != nil {
		return 0, fmt.Errorf("bulk delete notifications: %w", err)
	}
	return tag.RowsAffected(), nil
}

// GetUnreadForDigest returns unread notifications created since a cutoff for a list of users.
func (r *NotificationRepository) GetUnreadForDigest(ctx context.Context, tenantID string, since time.Time) ([]model.Notification, error) {
	query := `
		SELECT id, tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id, read_at, created_at
		FROM notifications
		WHERE tenant_id = $1 AND read_at IS NULL AND created_at >= $2
		ORDER BY user_id, created_at DESC`

	rows, err := r.db.Query(ctx, query, tenantID, since)
	if err != nil {
		return nil, fmt.Errorf("get unread for digest: %w", err)
	}
	defer rows.Close()

	results := make([]model.Notification, 0)
	for rows.Next() {
		n, err := r.scanNotificationFromRow(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, *n)
	}
	return results, rows.Err()
}

// CountsResult holds per-category notification totals and the overall unread count.
type CountsResult struct {
	Unread     int `json:"unread"`
	All        int `json:"all"`
	Security   int `json:"security"`
	Data       int `json:"data"`
	Workflow   int `json:"workflow"`
	Governance int `json:"governance"`
	Legal      int `json:"legal"`
	System     int `json:"system"`
}

// GetCounts returns per-category notification counts and the total unread count for a
// user in a single query, replacing the seven round-trips previously made by the frontend.
func (r *NotificationRepository) GetCounts(ctx context.Context, tenantID, userID string) (*CountsResult, error) {
	const query = `
		SELECT
			COUNT(*) FILTER (WHERE read_at IS NULL)           AS unread,
			COUNT(*)                                           AS all,
			COUNT(*) FILTER (WHERE category = 'security')     AS security,
			COUNT(*) FILTER (WHERE category = 'data')         AS data,
			COUNT(*) FILTER (WHERE category = 'workflow')     AS workflow,
			COUNT(*) FILTER (WHERE category = 'governance')   AS governance,
			COUNT(*) FILTER (WHERE category = 'legal')        AS legal,
			COUNT(*) FILTER (WHERE category = 'system')       AS system
		FROM notifications
		WHERE tenant_id = $1 AND user_id = $2`

	var res CountsResult
	if err := r.db.QueryRow(ctx, query, tenantID, userID).Scan(
		&res.Unread, &res.All,
		&res.Security, &res.Data, &res.Workflow,
		&res.Governance, &res.Legal, &res.System,
	); err != nil {
		return nil, fmt.Errorf("get counts: %w", err)
	}
	return &res, nil
}

func (r *NotificationRepository) buildWhere(params *dto.QueryParams) (string, []interface{}) {
	var conditions []string
	var args []interface{}
	idx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", idx))
	args = append(args, params.TenantID)
	idx++

	conditions = append(conditions, fmt.Sprintf("user_id = $%d", idx))
	args = append(args, params.UserID)
	idx++

	if params.Category != "" {
		conditions = append(conditions, fmt.Sprintf("category = $%d", idx))
		args = append(args, params.Category)
		idx++
	}

	if params.Type != "" {
		conditions = append(conditions, fmt.Sprintf("type = $%d", idx))
		args = append(args, params.Type)
		idx++
	}

	if params.Priority != "" {
		conditions = append(conditions, fmt.Sprintf("priority = $%d", idx))
		args = append(args, params.Priority)
		idx++
	}

	if params.Read != nil {
		if *params.Read {
			conditions = append(conditions, "read_at IS NOT NULL")
		} else {
			conditions = append(conditions, "read_at IS NULL")
		}
	}

	if params.DateFrom != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", idx))
		args = append(args, *params.DateFrom)
		idx++
	}

	if params.DateTo != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", idx))
		args = append(args, *params.DateTo)
		idx++
	}

	return " WHERE " + strings.Join(conditions, " AND "), args
}

func (r *NotificationRepository) scanNotification(row pgx.Row) (*model.Notification, error) {
	var n model.Notification
	err := row.Scan(
		&n.ID, &n.TenantID, &n.UserID, &n.Type, &n.Category, &n.Priority,
		&n.Title, &n.Body, &n.Data, &n.ActionURL, &n.SourceEventID, &n.ReadAt, &n.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan notification: %w", err)
	}
	n.ComputeRead()
	return &n, nil
}

func (r *NotificationRepository) scanNotificationFromRow(rows pgx.Rows) (*model.Notification, error) {
	var n model.Notification
	err := rows.Scan(
		&n.ID, &n.TenantID, &n.UserID, &n.Type, &n.Category, &n.Priority,
		&n.Title, &n.Body, &n.Data, &n.ActionURL, &n.SourceEventID, &n.ReadAt, &n.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan notification row: %w", err)
	}
	n.ComputeRead()
	return &n, nil
}
