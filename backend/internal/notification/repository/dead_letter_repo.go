package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// DeadLetterRepository is a durable, Postgres-backed dead-letter store (#14). It
// persists events.DeadLetterEntry rows in notification_dead_letters so failed
// events routed to the DLQ topics survive restarts and can be inspected,
// replayed and acknowledged by operators. It complements — and does not replace
// — the in-memory events.DeadLetterStore, which other services still use.
type DeadLetterRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewDeadLetterRepository creates a new DeadLetterRepository.
func NewDeadLetterRepository(db *pgxpool.Pool, logger zerolog.Logger) *DeadLetterRepository {
	return &DeadLetterRepository{db: db, logger: logger.With().Str("component", "dead_letter_repo").Logger()}
}

// Store upserts a dead-letter entry keyed on its id. A redelivery of the same
// DLQ event (same id) is idempotent: it refreshes the row rather than duplicating
// it, and never resurrects an already replayed/acknowledged entry back to pending.
func (r *DeadLetterRepository) Store(ctx context.Context, entry *events.DeadLetterEntry) error {
	if entry == nil {
		return nil
	}
	status := entry.Status
	if status == "" {
		status = "pending"
	}
	failedAt := entry.FailedAt
	if failedAt.IsZero() {
		failedAt = time.Now().UTC()
	}

	const query = `
		INSERT INTO notification_dead_letters
			(id, original_event_id, original_type, original_topic, tenant_id, error,
			 retry_count, original_event, event_data, status, failed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			original_event_id = EXCLUDED.original_event_id,
			original_type     = EXCLUDED.original_type,
			original_topic    = EXCLUDED.original_topic,
			error             = EXCLUDED.error,
			retry_count       = EXCLUDED.retry_count,
			original_event    = EXCLUDED.original_event,
			event_data        = EXCLUDED.event_data,
			failed_at         = EXCLUDED.failed_at,
			updated_at        = now()`

	if _, err := r.db.Exec(ctx, query,
		entry.ID, entry.OriginalEventID, entry.OriginalType, entry.OriginalTopic,
		nullableUUID(entry.TenantID), entry.Error, entry.RetryCount,
		jsonOrNil(entry.OriginalEvent), jsonOrNil(entry.EventData), status, failedAt.UTC(),
	); err != nil {
		return fmt.Errorf("store dead letter %s: %w", entry.ID, err)
	}
	return nil
}

// Get returns a single dead-letter entry by id. ok is false when not found.
func (r *DeadLetterRepository) Get(ctx context.Context, id string) (*events.DeadLetterEntry, bool, error) {
	const query = `
		SELECT id, original_event_id, original_type, original_topic, tenant_id, error,
		       retry_count, original_event, event_data, status, failed_at
		FROM notification_dead_letters WHERE id = $1`
	entry, err := scanDeadLetter(r.db.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get dead letter %s: %w", id, err)
	}
	return entry, true, nil
}

// List returns dead-letter entries filtered by tenant and/or status, newest
// first. tenantID/status may be empty to skip that filter. limit defaults to 100.
func (r *DeadLetterRepository) List(ctx context.Context, tenantID, status string, limit, offset int) ([]*events.DeadLetterEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	query := `
		SELECT id, original_event_id, original_type, original_topic, tenant_id, error,
		       retry_count, original_event, event_data, status, failed_at
		FROM notification_dead_letters
		WHERE ($1 = '' OR tenant_id = $1::uuid)
		  AND ($2 = '' OR status = $2)
		ORDER BY failed_at DESC
		LIMIT $3 OFFSET $4`

	rows, err := r.db.Query(ctx, query, tenantID, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list dead letters: %w", err)
	}
	defer rows.Close()

	entries := make([]*events.DeadLetterEntry, 0)
	for rows.Next() {
		entry, scanErr := scanDeadLetter(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan dead letter: %w", scanErr)
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

// Count returns the number of entries matching the tenant/status filter.
func (r *DeadLetterRepository) Count(ctx context.Context, tenantID, status string) (int, error) {
	const query = `
		SELECT COUNT(*) FROM notification_dead_letters
		WHERE ($1 = '' OR tenant_id = $1::uuid) AND ($2 = '' OR status = $2)`
	var n int
	if err := r.db.QueryRow(ctx, query, tenantID, status).Scan(&n); err != nil {
		return 0, fmt.Errorf("count dead letters: %w", err)
	}
	return n, nil
}

// MarkReplayed flips an entry to 'replayed'. It is scoped by tenant so a caller
// can only mutate its own entries. ok is false when no matching pending/failed
// row exists. An empty tenantID skips the tenant scope (operator/global use).
func (r *DeadLetterRepository) MarkReplayed(ctx context.Context, tenantID, id string) (bool, error) {
	return r.setStatus(ctx, tenantID, id, "replayed")
}

// Ack flips an entry to 'acknowledged' (operator dismissed it). Tenant-scoped
// like MarkReplayed.
func (r *DeadLetterRepository) Ack(ctx context.Context, tenantID, id string) (bool, error) {
	return r.setStatus(ctx, tenantID, id, "acknowledged")
}

func (r *DeadLetterRepository) setStatus(ctx context.Context, tenantID, id, status string) (bool, error) {
	const query = `
		UPDATE notification_dead_letters
		SET status = $3, updated_at = now()
		WHERE id = $1 AND ($2 = '' OR tenant_id = $2::uuid)`
	tag, err := r.db.Exec(ctx, query, id, tenantID, status)
	if err != nil {
		return false, fmt.Errorf("set dead letter %s status=%s: %w", id, status, err)
	}
	return tag.RowsAffected() > 0, nil
}

// scanDeadLetter scans a row (from QueryRow or Query) into a DeadLetterEntry.
func scanDeadLetter(row pgx.Row) (*events.DeadLetterEntry, error) {
	var (
		entry    events.DeadLetterEntry
		tenantID *string
		origEvt  []byte
		evtData  []byte
	)
	if err := row.Scan(
		&entry.ID, &entry.OriginalEventID, &entry.OriginalType, &entry.OriginalTopic,
		&tenantID, &entry.Error, &entry.RetryCount, &origEvt, &evtData, &entry.Status, &entry.FailedAt,
	); err != nil {
		return nil, err
	}
	if tenantID != nil {
		entry.TenantID = *tenantID
	}
	if len(origEvt) > 0 {
		entry.OriginalEvent = json.RawMessage(origEvt)
	}
	if len(evtData) > 0 {
		entry.EventData = json.RawMessage(evtData)
	}
	return &entry, nil
}

// nullableUUID returns nil for an empty string so a NULL is stored instead of an
// invalid empty uuid literal.
func nullableUUID(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// jsonOrNil returns nil for empty JSON so a SQL NULL is stored (keeps JSONB valid).
func jsonOrNil(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return nil
	}
	return []byte(raw)
}
