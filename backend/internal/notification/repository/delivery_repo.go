package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/notification/model"
)

// DeliveryRepository handles delivery log operations.
type DeliveryRepository struct {
	// db is an interface seam (PgxDB) so the repository can be unit-tested with
	// pgxmock; production always passes a concrete *pgxpool.Pool.
	db     PgxDB
	logger zerolog.Logger
}

// NewDeliveryRepository creates a new DeliveryRepository.
func NewDeliveryRepository(db *pgxpool.Pool, logger zerolog.Logger) *DeliveryRepository {
	return &DeliveryRepository{db: db, logger: logger.With().Str("component", "delivery_repo").Logger()}
}

// Insert creates a delivery log record.
//
// tenant_id is persisted (backfilled/threaded from the parent notification) so
// delivery logs can be tenant-scoped without a join. next_retry_at and
// deliver_after are written when set so the retry worker (#6) and quiet-hours
// flusher (#10) can claim due rows. max_retries falls back to the DB default (3)
// when unset.
func (r *DeliveryRepository) Insert(ctx context.Context, rec *model.DeliveryRecord) (string, error) {
	metaBytes, err := json.Marshal(rec.Metadata)
	if err != nil {
		metaBytes = []byte("{}")
	}

	const query = `
		INSERT INTO notification_delivery_log
			(notification_id, tenant_id, channel, status, attempt, error_message, metadata, next_retry_at, deliver_after, delivered_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id`

	var tenantArg interface{}
	if rec.TenantID != "" {
		tenantArg = rec.TenantID
	}
	args := []interface{}{
		rec.NotificationID, tenantArg, rec.Channel, rec.Status, rec.Attempt,
		rec.ErrorMessage, metaBytes, rec.NextRetryAt, rec.DeliverAfter, rec.DeliveredAt,
	}

	var id string
	// Defense-in-depth (#15): when the tenant is known, run the write inside a
	// transaction that sets the app.current_tenant_id GUC so that IF a
	// non-superuser DB role is in use the FORCE RLS policies confine the row.
	// Superuser bypasses RLS today, so this is a no-op-safe addition.
	//
	// database.RunWithTenant requires a concrete *pgxpool.Pool; in production
	// r.db always is one, so the tenant-scoped tx path is unchanged. A pgxmock
	// pool (tests) fails the assertion and falls through to the direct-exec path.
	pool, poolOK := r.db.(*pgxpool.Pool)
	if tid, perr := uuid.Parse(rec.TenantID); perr == nil && poolOK {
		err = database.RunWithTenant(ctx, pool, tid, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, query, args...).Scan(&id)
		})
	} else {
		err = r.db.QueryRow(ctx, query, args...).Scan(&id)
	}
	if err != nil {
		return "", fmt.Errorf("insert delivery log: %w", err)
	}
	return id, nil
}

// DeleteOldDeliveryLogs removes delivery-log rows older than the cutoff, in
// batches to bound lock/WAL footprint. Delivery logs are also cascade-deleted
// with their parent notification; this lets a retention scheduler prune logs
// independently (e.g. a shorter log-retention window than notifications). It
// loops until fewer than batchSize rows remain or ctx is cancelled, returning
// the total deleted. Intended to be driven by a retention scheduler (Wave C/E)
// following the DigestService.RunScheduler pattern. Not wired here.
func (r *DeliveryRepository) DeleteOldDeliveryLogs(ctx context.Context, olderThan time.Time, batchSize int) (int64, error) {
	if batchSize <= 0 {
		batchSize = 1000
	}
	const query = `
		DELETE FROM notification_delivery_log
		WHERE id IN (
			SELECT id FROM notification_delivery_log
			WHERE created_at < $1
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
			return total, fmt.Errorf("delete old delivery logs: %w", err)
		}
		n := tag.RowsAffected()
		total += n
		if n < int64(batchSize) {
			break
		}
	}
	return total, nil
}

// UpdateStatus updates the status of a delivery record.
func (r *DeliveryRepository) UpdateStatus(ctx context.Context, id, status string, errMsg *string, deliveredAt *time.Time) error {
	query := `
		UPDATE notification_delivery_log
		SET status = $1, error_message = $2, delivered_at = $3
		WHERE id = $4`

	_, err := r.db.Exec(ctx, query, status, errMsg, deliveredAt, id)
	if err != nil {
		return fmt.Errorf("update delivery status: %w", err)
	}
	return nil
}

// IncrementAttempt increments the attempt count and updates status/error.
func (r *DeliveryRepository) IncrementAttempt(ctx context.Context, id string, status string, errMsg *string) error {
	query := `
		UPDATE notification_delivery_log
		SET attempt = attempt + 1, status = $1, error_message = $2
		WHERE id = $3`

	_, err := r.db.Exec(ctx, query, status, errMsg, id)
	if err != nil {
		return fmt.Errorf("increment attempt: %w", err)
	}
	return nil
}

// GetFailedRecent returns failed delivery records from the last 24 hours for a
// single tenant. The tenant predicate (tenant_id column added in migration
// 000005) prevents a tenant-scoped retry action from re-firing another tenant's
// failed deliveries.
func (r *DeliveryRepository) GetFailedRecent(ctx context.Context, tenantID string) ([]model.DeliveryRecord, error) {
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	query := `
		SELECT id, notification_id, channel, status, attempt, error_message, metadata, delivered_at, created_at
		FROM notification_delivery_log
		WHERE status = 'failed' AND tenant_id = $1 AND created_at >= $2
		ORDER BY created_at ASC`

	rows, err := r.db.Query(ctx, query, tenantID, cutoff)
	if err != nil {
		return nil, fmt.Errorf("get failed deliveries: %w", err)
	}
	defer rows.Close()

	var results []model.DeliveryRecord
	for rows.Next() {
		var rec model.DeliveryRecord
		if err := rows.Scan(
			&rec.ID, &rec.NotificationID, &rec.Channel, &rec.Status,
			&rec.Attempt, &rec.ErrorMessage, &rec.Metadata, &rec.DeliveredAt, &rec.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan delivery: %w", err)
		}
		results = append(results, rec)
	}
	return results, rows.Err()
}

// GetFailedRecentFiltered returns failed deliveries with optional channel
// filter, scoped to a single tenant. The tenant predicate confines
// AdminHandler.RetryFailed to the caller's own tenant (previously it re-fired
// EVERY tenant's failed deliveries).
func (r *DeliveryRepository) GetFailedRecentFiltered(ctx context.Context, tenantID, channel string, since time.Time) ([]model.DeliveryRecord, error) {
	query := `
		SELECT id, notification_id, channel, status, attempt, error_message, metadata, delivered_at, created_at
		FROM notification_delivery_log
		WHERE status = 'failed' AND tenant_id = $1 AND created_at >= $2`
	args := []interface{}{tenantID, since}

	if channel != "" {
		query += ` AND channel = $3`
		args = append(args, channel)
	}
	query += ` ORDER BY created_at ASC`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get failed deliveries filtered: %w", err)
	}
	defer rows.Close()

	var results []model.DeliveryRecord
	for rows.Next() {
		var rec model.DeliveryRecord
		if err := rows.Scan(
			&rec.ID, &rec.NotificationID, &rec.Channel, &rec.Status,
			&rec.Attempt, &rec.ErrorMessage, &rec.Metadata, &rec.DeliveredAt, &rec.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan delivery: %w", err)
		}
		results = append(results, rec)
	}
	return results, rows.Err()
}

// GetDeliveryStats returns aggregated delivery statistics.
func (r *DeliveryRepository) GetDeliveryStats(ctx context.Context, tenantID string, since time.Time) ([]model.DeliveryStats, error) {
	query := `
		SELECT dl.channel, dl.status, COUNT(*) as count
		FROM notification_delivery_log dl
		JOIN notifications n ON n.id = dl.notification_id
		WHERE n.tenant_id = $1 AND dl.created_at >= $2
		GROUP BY dl.channel, dl.status
		ORDER BY dl.channel, dl.status`

	rows, err := r.db.Query(ctx, query, tenantID, since)
	if err != nil {
		return nil, fmt.Errorf("get delivery stats: %w", err)
	}
	defer rows.Close()

	var stats []model.DeliveryStats
	for rows.Next() {
		var s model.DeliveryStats
		if err := rows.Scan(&s.Channel, &s.Status, &s.Count); err != nil {
			return nil, fmt.Errorf("scan stats: %w", err)
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

// GetRichDeliveryStats computes the full frontend-compatible stats response.
func (r *DeliveryRepository) GetRichDeliveryStats(ctx context.Context, tenantID string, since time.Time, period string, channel string) (*model.RichDeliveryStats, error) {
	result := &model.RichDeliveryStats{
		Period:    period,
		ByChannel: make(map[string]model.ChannelStats),
		ByType:    make(map[string]int64),
		ByDay:     []model.DayStats{},
	}

	// 1) Per-channel aggregates
	channelQuery := `
		SELECT dl.channel, dl.status, COUNT(*) as count
		FROM notification_delivery_log dl
		JOIN notifications n ON n.id = dl.notification_id
		WHERE n.tenant_id = $1 AND dl.created_at >= $2`
	channelArgs := []interface{}{tenantID, since}
	argIdx := 3
	if channel != "" {
		channelQuery += fmt.Sprintf(` AND dl.channel = $%d`, argIdx)
		channelArgs = append(channelArgs, channel)
	}
	channelQuery += ` GROUP BY dl.channel, dl.status ORDER BY dl.channel, dl.status`

	rows, err := r.db.Query(ctx, channelQuery, channelArgs...)
	if err != nil {
		return nil, fmt.Errorf("get channel stats: %w", err)
	}
	for rows.Next() {
		var ch, status string
		var count int64
		if err := rows.Scan(&ch, &status, &count); err != nil {
			rows.Close()
			return nil, err
		}
		cs := result.ByChannel[ch]
		cs.Sent += count
		if status == model.DeliveryDelivered {
			cs.Delivered += count
			result.Delivered += count
		} else if status == model.DeliveryFailed {
			cs.Failed += count
			result.Failed += count
		}
		result.TotalSent += count
		result.ByChannel[ch] = cs
	}
	rows.Close()

	if result.TotalSent > 0 {
		result.DeliveryRate = float64(result.Delivered) / float64(result.TotalSent)
	}

	// 2) By notification type
	typeQuery := `
		SELECT n.type, COUNT(*) as count
		FROM notification_delivery_log dl
		JOIN notifications n ON n.id = dl.notification_id
		WHERE n.tenant_id = $1 AND dl.created_at >= $2`
	typeArgs := []interface{}{tenantID, since}
	if channel != "" {
		typeQuery += ` AND dl.channel = $3`
		typeArgs = append(typeArgs, channel)
	}
	typeQuery += ` GROUP BY n.type ORDER BY count DESC`

	rows, err = r.db.Query(ctx, typeQuery, typeArgs...)
	if err != nil {
		return nil, fmt.Errorf("get type stats: %w", err)
	}
	for rows.Next() {
		var ntype string
		var count int64
		if err := rows.Scan(&ntype, &count); err != nil {
			rows.Close()
			return nil, err
		}
		result.ByType[ntype] = count
	}
	rows.Close()

	// 3) By day
	dayQuery := `
		SELECT dl.created_at::date as day,
		       COUNT(*) as sent,
		       COUNT(*) FILTER (WHERE dl.status = 'delivered') as delivered,
		       COUNT(*) FILTER (WHERE dl.status = 'failed') as failed
		FROM notification_delivery_log dl
		JOIN notifications n ON n.id = dl.notification_id
		WHERE n.tenant_id = $1 AND dl.created_at >= $2`
	dayArgs := []interface{}{tenantID, since}
	if channel != "" {
		dayQuery += ` AND dl.channel = $3`
		dayArgs = append(dayArgs, channel)
	}
	dayQuery += ` GROUP BY day ORDER BY day ASC`

	rows, err = r.db.Query(ctx, dayQuery, dayArgs...)
	if err != nil {
		return nil, fmt.Errorf("get day stats: %w", err)
	}
	for rows.Next() {
		var ds model.DayStats
		var day time.Time
		if err := rows.Scan(&day, &ds.Sent, &ds.Delivered, &ds.Failed); err != nil {
			rows.Close()
			return nil, err
		}
		ds.Date = day.Format("2006-01-02")
		result.ByDay = append(result.ByDay, ds)
	}
	rows.Close()

	// 4) Average delivery time (from delivery records that have duration_ms)
	avgQuery := `
		SELECT COALESCE(AVG(dl.duration_ms), 0)::bigint
		FROM notification_delivery_log dl
		JOIN notifications n ON n.id = dl.notification_id
		WHERE n.tenant_id = $1 AND dl.created_at >= $2 AND dl.duration_ms IS NOT NULL`
	avgArgs := []interface{}{tenantID, since}
	if channel != "" {
		avgQuery += ` AND dl.channel = $3`
		avgArgs = append(avgArgs, channel)
	}
	_ = r.db.QueryRow(ctx, avgQuery, avgArgs...).Scan(&result.AvgDeliveryTimeMS)

	return result, nil
}

// GetWebhookDeliveries returns paginated delivery records for a specific
// webhook, scoped to the caller's tenant. The tenant predicate (in addition to
// the webhook-ownership check the handler performs) prevents one tenant's
// request/response bodies from leaking to another.
func (r *DeliveryRepository) GetWebhookDeliveries(ctx context.Context, tenantID, webhookID string, page, perPage int, status string) ([]model.WebhookDelivery, int64, error) {
	offset := (page - 1) * perPage

	countQuery := `SELECT COUNT(*) FROM notification_delivery_log WHERE webhook_id = $1 AND tenant_id = $2`
	dataQuery := `SELECT id, webhook_id, COALESCE(event_type,'') as event_type, status,
		COALESCE(request_url,'') as request_url, COALESCE(request_body,'{}')::jsonb as request_body,
		response_status, response_body, duration_ms, attempt, next_retry_at, created_at
		FROM notification_delivery_log WHERE webhook_id = $1 AND tenant_id = $2`

	args := []interface{}{webhookID, tenantID}
	argIdx := 3

	if status != "" {
		filter := fmt.Sprintf(` AND status = $%d`, argIdx)
		countQuery += filter
		dataQuery += filter
		args = append(args, status)
		argIdx++
	}

	dataQuery += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)

	var total int64
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count webhook deliveries: %w", err)
	}

	dataArgs := append(args, perPage, offset)
	rows, err := r.db.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list webhook deliveries: %w", err)
	}
	defer rows.Close()

	var results []model.WebhookDelivery
	for rows.Next() {
		var d model.WebhookDelivery
		if err := rows.Scan(
			&d.ID, &d.WebhookID, &d.EventType, &d.Status,
			&d.RequestURL, &d.RequestBody, &d.ResponseStatus, &d.ResponseBody,
			&d.DurationMS, &d.AttemptCount, &d.NextRetryAt, &d.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan webhook delivery: %w", err)
		}
		results = append(results, d)
	}
	return results, total, rows.Err()
}

// GetByID retrieves a delivery record by its ID.
func (r *DeliveryRepository) GetByID(ctx context.Context, id string) (*model.DeliveryRecord, error) {
	query := `
		SELECT id, notification_id, channel, status, attempt, error_message, metadata, delivered_at, created_at
		FROM notification_delivery_log
		WHERE id = $1`

	var rec model.DeliveryRecord
	err := r.db.QueryRow(ctx, query, id).Scan(
		&rec.ID, &rec.NotificationID, &rec.Channel, &rec.Status,
		&rec.Attempt, &rec.ErrorMessage, &rec.Metadata, &rec.DeliveredAt, &rec.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get delivery by id: %w", err)
	}
	return &rec, nil
}

// GetNotificationByID retrieves a notification by ID, scoped to the caller's
// tenant. The tenant predicate keeps a retry action (which loads the parent
// notification for re-dispatch) confined to the caller's own tenant even if a
// delivery-log row's tenant were ever mismatched.
func (r *DeliveryRepository) GetNotificationByID(ctx context.Context, tenantID, notifID string) (*model.Notification, error) {
	query := `
		SELECT id, tenant_id, user_id, type, category, priority, title, body, data, action_url, source_event_id, read_at, created_at
		FROM notifications WHERE id = $1 AND tenant_id = $2`

	var n model.Notification
	err := r.db.QueryRow(ctx, query, notifID, tenantID).Scan(
		&n.ID, &n.TenantID, &n.UserID, &n.Type, &n.Category, &n.Priority,
		&n.Title, &n.Body, &n.Data, &n.ActionURL, &n.SourceEventID, &n.ReadAt, &n.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get notification by id: %w", err)
	}
	n.ComputeRead()
	return &n, nil
}

// RetryDelivery re-queues a specific delivery record for the caller's tenant. It
// returns the number of rows affected so the handler can distinguish a
// successful re-queue from a delivery that does not belong to the tenant (or is
// not in a retryable state) and answer 404 rather than leaking cross-tenant
// existence. The tenant predicate confines the mutation to the caller's tenant.
func (r *DeliveryRepository) RetryDelivery(ctx context.Context, tenantID, deliveryID string) (int64, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE notification_delivery_log SET status = 'pending', error_message = NULL WHERE id = $1 AND tenant_id = $2 AND status = 'failed'`,
		deliveryID, tenantID,
	)
	if err != nil {
		return 0, fmt.Errorf("retry delivery: %w", err)
	}
	return tag.RowsAffected(), nil
}

// claimedDeliveryColumns is the RETURNING projection for the claim queries. It
// COALESCEs the nullable tenant_id to ” so it scans into a string, matching
// model.DeliveryRecord.
const claimedDeliveryColumns = `dl.id, COALESCE(dl.tenant_id::text, ''), dl.notification_id, dl.channel, dl.status,
	dl.attempt, dl.max_retries, dl.error_message, dl.metadata, dl.next_retry_at, dl.deliver_after, dl.delivered_at, dl.created_at`

func scanClaimedDeliveries(rows pgx.Rows) ([]model.DeliveryRecord, error) {
	defer rows.Close()
	var results []model.DeliveryRecord
	for rows.Next() {
		var rec model.DeliveryRecord
		if err := rows.Scan(
			&rec.ID, &rec.TenantID, &rec.NotificationID, &rec.Channel, &rec.Status,
			&rec.Attempt, &rec.MaxRetries, &rec.ErrorMessage, &rec.Metadata,
			&rec.NextRetryAt, &rec.DeliverAfter, &rec.DeliveredAt, &rec.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan claimed delivery: %w", err)
		}
		results = append(results, rec)
	}
	return results, rows.Err()
}

// ClaimDueRetries atomically claims up to `limit` delivery rows that are due for
// retry (status failed/retrying, next_retry_at <= now(), attempts remaining),
// using FOR UPDATE SKIP LOCKED over the idx_delivery_retry_due index so
// concurrent workers never claim the same row. Each claimed row is flipped to
// 'retrying' and its next_retry_at pushed to leaseUntil (a visibility timeout):
// this both locks the row out of a sibling worker's next claim and guarantees
// that if the worker crashes mid-send, the row is re-claimed once the lease
// expires. The claimed rows are returned for re-dispatch (#6).
func (r *DeliveryRepository) ClaimDueRetries(ctx context.Context, limit int, leaseUntil time.Time) ([]model.DeliveryRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	const query = `
		WITH due AS (
			SELECT id FROM notification_delivery_log
			WHERE status IN ('failed', 'retrying')
			  AND next_retry_at IS NOT NULL
			  AND next_retry_at <= now()
			  AND attempt < max_retries
			ORDER BY next_retry_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE notification_delivery_log dl
		SET status = 'retrying', next_retry_at = $2
		FROM due
		WHERE dl.id = due.id
		RETURNING ` + claimedDeliveryColumns
	rows, err := r.db.Query(ctx, query, limit, leaseUntil)
	if err != nil {
		return nil, fmt.Errorf("claim due retries: %w", err)
	}
	return scanClaimedDeliveries(rows)
}

// ClaimDueDeferred atomically claims up to `limit` quiet-hours-deferred
// deliveries whose deliver_after has passed (status 'pending', deliver_after <=
// now()), flipping them to 'retrying' with a lease so the flush loop (#10) can
// send them exactly once. A send failure re-enters the normal retry pipeline.
func (r *DeliveryRepository) ClaimDueDeferred(ctx context.Context, limit int, leaseUntil time.Time) ([]model.DeliveryRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	const query = `
		WITH due AS (
			SELECT id FROM notification_delivery_log
			WHERE status = 'pending'
			  AND deliver_after IS NOT NULL
			  AND deliver_after <= now()
			ORDER BY deliver_after
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE notification_delivery_log dl
		SET status = 'retrying', next_retry_at = $2
		FROM due
		WHERE dl.id = due.id
		RETURNING ` + claimedDeliveryColumns
	rows, err := r.db.Query(ctx, query, limit, leaseUntil)
	if err != nil {
		return nil, fmt.Errorf("claim due deferred: %w", err)
	}
	return scanClaimedDeliveries(rows)
}

// MarkDeliverySucceeded records a successful (re)delivery: status delivered,
// attempt bumped, delivered_at set, and next_retry_at cleared so the row is
// never re-claimed.
func (r *DeliveryRepository) MarkDeliverySucceeded(ctx context.Context, id string, attempt int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_delivery_log
		 SET status = 'delivered', attempt = $2, delivered_at = now(), next_retry_at = NULL, error_message = NULL
		 WHERE id = $1`,
		id, attempt,
	)
	if err != nil {
		return fmt.Errorf("mark delivery succeeded: %w", err)
	}
	return nil
}

// RescheduleDelivery re-arms a delivery for a later retry (status 'retrying',
// attempt bumped, next_retry_at set to the backoff instant).
func (r *DeliveryRepository) RescheduleDelivery(ctx context.Context, id string, attempt int, nextRetryAt time.Time, errMsg *string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_delivery_log
		 SET status = 'retrying', attempt = $2, next_retry_at = $3, error_message = $4
		 WHERE id = $1`,
		id, attempt, nextRetryAt, errMsg,
	)
	if err != nil {
		return fmt.Errorf("reschedule delivery: %w", err)
	}
	return nil
}

// MarkDeliveryExhausted terminally fails a delivery that exhausted its retry
// budget (or hit a terminal error): status 'failed' with next_retry_at cleared
// so the retry worker never re-claims it (dead-lettered in the delivery log).
func (r *DeliveryRepository) MarkDeliveryExhausted(ctx context.Context, id string, attempt int, errMsg *string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_delivery_log
		 SET status = 'failed', attempt = $2, next_retry_at = NULL, error_message = $3
		 WHERE id = $1`,
		id, attempt, errMsg,
	)
	if err != nil {
		return fmt.Errorf("mark delivery exhausted: %w", err)
	}
	return nil
}

// CountRetryBacklog returns the number of delivery rows currently due for retry,
// for the notification_delivery_retry_backlog gauge (#6).
func (r *DeliveryRepository) CountRetryBacklog(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM notification_delivery_log
		 WHERE status IN ('failed', 'retrying')
		   AND next_retry_at IS NOT NULL
		   AND next_retry_at <= now()
		   AND attempt < max_retries`,
	).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count retry backlog: %w", err)
	}
	return n, nil
}

// FindDeliveryByID returns a delivery record for retry purposes, including the
// webhook_id, scoped to the caller's tenant. A cross-tenant id returns
// (nil, "", nil) so callers answer 404 without leaking existence.
func (r *DeliveryRepository) FindDeliveryByID(ctx context.Context, tenantID, id string) (*model.DeliveryRecord, string, error) {
	query := `
		SELECT id, notification_id, channel, status, attempt, error_message, metadata, delivered_at, created_at, COALESCE(webhook_id::text, '')
		FROM notification_delivery_log
		WHERE id = $1 AND tenant_id = $2`

	var rec model.DeliveryRecord
	var webhookID string
	err := r.db.QueryRow(ctx, query, id, tenantID).Scan(
		&rec.ID, &rec.NotificationID, &rec.Channel, &rec.Status,
		&rec.Attempt, &rec.ErrorMessage, &rec.Metadata, &rec.DeliveredAt, &rec.CreatedAt,
		&webhookID,
	)
	if err == pgx.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("find delivery by id: %w", err)
	}
	return &rec, webhookID, nil
}
