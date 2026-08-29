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

// NotificationSubscriptionRepository owns per-user (category, channel) delivery
// overrides (lex_notification_subscription). The model is opt-out: a missing row
// means the channel is enabled; an enabled=false row suppresses delivery. The
// consumer/monitor consult IsSuppressed before writing an inbox row / enqueuing
// an email. Queries filter by tenant_id (primary predicate) with table RLS as a
// backstop.
type NotificationSubscriptionRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewNotificationSubscriptionRepository(db *pgxpool.Pool, logger zerolog.Logger) *NotificationSubscriptionRepository {
	return &NotificationSubscriptionRepository{db: db, logger: logger}
}

// Upsert creates or updates a (user, category, channel) override and returns the
// persisted row. The natural key is (tenant, user, category, channel).
func (r *NotificationSubscriptionRepository) Upsert(ctx context.Context, sub *model.NotificationSubscription) (*model.NotificationSubscription, error) {
	query := `
		WITH upserted AS (
			INSERT INTO lex_notification_subscription (
				id, tenant_id, user_id, category, channel, enabled, created_by
			) VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (tenant_id, user_id, category, channel)
			DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
			RETURNING *
		)
	` + notificationSubscriptionJSONFrom("upserted")
	return queryRowJSON[model.NotificationSubscription](ctx, r.db, query,
		sub.ID, sub.TenantID, sub.UserID, sub.Category, sub.Channel, sub.Enabled, sub.CreatedBy)
}

func (r *NotificationSubscriptionRepository) Get(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.NotificationSubscription, error) {
	query := notificationSubscriptionJSONSelect(`s.tenant_id = $1 AND s.user_id = $2 AND s.id = $3`, "")
	return queryRowJSON[model.NotificationSubscription](ctx, r.db, query, tenantID, userID, id)
}

// List returns a user's overrides, optionally filtered by category/channel.
func (r *NotificationSubscriptionRepository) List(ctx context.Context, tenantID, userID uuid.UUID, filters model.NotificationSubscriptionListFilters) ([]model.NotificationSubscription, error) {
	args := []any{tenantID, userID}
	conditions := []string{"s.tenant_id = $1", "s.user_id = $2"}
	if filters.Category != nil {
		args = append(args, *filters.Category)
		conditions = append(conditions, fmt.Sprintf("s.category = $%d", len(args)))
	}
	if filters.Channel != nil {
		args = append(args, *filters.Channel)
		conditions = append(conditions, fmt.Sprintf("s.channel = $%d", len(args)))
	}
	where := strings.Join(conditions, " AND ")
	query := notificationSubscriptionJSONSelect(where, "ORDER BY s.category ASC, s.channel ASC")
	return queryListJSON[model.NotificationSubscription](ctx, r.db, query, args...)
}

// Delete removes a single override (reverting that channel/category to the
// default-enabled behaviour).
func (r *NotificationSubscriptionRepository) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM lex_notification_subscription WHERE tenant_id = $1 AND user_id = $2 AND id = $3`, tenantID, userID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// IsSuppressed reports whether the given user has explicitly disabled the
// (category, channel) pair. Absence of a row => not suppressed (opt-out model).
func (r *NotificationSubscriptionRepository) IsSuppressed(ctx context.Context, q Queryer, tenantID, userID uuid.UUID, category model.NotificationCategory, channel model.NotificationChannel) (bool, error) {
	if q == nil {
		q = r.db
	}
	var suppressed bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM lex_notification_subscription
			WHERE tenant_id = $1 AND user_id = $2 AND category = $3 AND channel = $4 AND enabled = false
		)`, tenantID, userID, category, channel).Scan(&suppressed)
	return suppressed, err
}

// --- hearing proximity dedup markers (CAP-162) ------------------------------

// MarkHearingProximity records that a proximity reminder has been emitted for a
// (hearing, horizon_days) pair. The returned bool is false when a marker already
// existed (so the monitor never double-reminds). The marker is the dedup ledger
// for the ProximityMonitor (mirrors ContractRepository.RecordExpiryNotification).
func (r *NotificationSubscriptionRepository) MarkHearingProximity(ctx context.Context, q Queryer, tenantID, caseID, hearingID uuid.UUID, horizonDays int, hearingDate, firedAt time.Time, createdBy uuid.UUID) (bool, error) {
	if q == nil {
		q = r.db
	}
	ct, err := q.Exec(ctx, `
		INSERT INTO lex_hearing_proximity_marker (
			id, tenant_id, case_id, hearing_id, horizon_days, hearing_date, fired_at, created_by
		) VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (tenant_id, hearing_id, horizon_days) DO NOTHING`,
		tenantID, caseID, hearingID, horizonDays, hearingDate.UTC(), firedAt.UTC(), createdBy)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

// ListUpcomingHearings scans not-yet-occurred, not-soft-deleted hearings for a
// tenant whose hearing_date falls within [now, now+horizon] (inclusive upper),
// joined to legal_cases for the case title/number and recipient owners. The
// monitor buckets by horizon-days and dedups via lex_hearing_proximity_marker.
func (r *NotificationSubscriptionRepository) ListUpcomingHearings(ctx context.Context, tenantID uuid.UUID, from, until time.Time) ([]model.UpcomingHearing, error) {
	rows, err := r.db.Query(ctx, `
		SELECT h.id, h.tenant_id, h.case_id, c.case_number,
		       COALESCE(c.title, '{}'::jsonb), h.hearing_date, h.location,
		       c.handling_officer_id, c.supervisor_id, c.section_manager_id
		FROM legal_case_hearings h
		JOIN legal_cases c ON c.id = h.case_id AND c.tenant_id = h.tenant_id AND c.deleted_at IS NULL
		WHERE h.tenant_id = $1
		  AND h.deleted_at IS NULL
		  AND h.hearing_date >= $2
		  AND h.hearing_date <= $3
		ORDER BY h.hearing_date ASC`,
		tenantID, from.UTC(), until.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.UpcomingHearing, 0)
	for rows.Next() {
		var h model.UpcomingHearing
		if err := rows.Scan(
			&h.HearingID, &h.TenantID, &h.CaseID, &h.CaseNumber,
			&h.CaseTitle, &h.HearingDate, &h.Location,
			&h.HandlingOfficerID, &h.SupervisorID, &h.SectionManagerID,
		); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// ListTenantIDs returns the distinct tenant ids known to the notification tables,
// for cross-tenant monitor fan-out (mirrors SLAClockRepository.ListTenantIDs).
// It scans legal_cases so the ProximityMonitor sees every tenant that owns
// hearings even before any inbox/marker row exists.
func (r *NotificationSubscriptionRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT tenant_id FROM legal_cases WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func notificationSubscriptionJSONSelect(where, suffix string) string {
	if strings.TrimSpace(suffix) != "" {
		suffix = " " + strings.TrimSpace(suffix)
	}
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.user_id, s.category, s.channel, s.enabled,
			       s.created_by, s.created_at, s.updated_at
			FROM lex_notification_subscription s
			WHERE %s%s
		) t`, where, suffix)
}

func notificationSubscriptionJSONFrom(source string) string {
	return fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.user_id, s.category, s.channel, s.enabled,
			       s.created_by, s.created_at, s.updated_at
			FROM %s s
		) t`, source)
}
