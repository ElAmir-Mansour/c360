package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

// SuppressionRepository manages the compliance suppression list (#17):
// per-user, per-channel entries that hard-block outbound delivery (unsubscribes,
// hard bounces, spam complaints).
type SuppressionRepository struct {
	// db is an interface seam (PgxDB) so the repository can be unit-tested with
	// pgxmock; production always passes a concrete *pgxpool.Pool.
	db     PgxDB
	logger zerolog.Logger
}

// NewSuppressionRepository creates a new SuppressionRepository.
func NewSuppressionRepository(db *pgxpool.Pool, logger zerolog.Logger) *SuppressionRepository {
	return &SuppressionRepository{db: db, logger: logger.With().Str("component", "suppression_repo").Logger()}
}

// IsSuppressed reports whether outbound delivery on channel is suppressed for
// the user in the tenant.
func (r *SuppressionRepository) IsSuppressed(ctx context.Context, tenantID, userID, channel string) (bool, error) {
	const query = `SELECT EXISTS (
		SELECT 1 FROM notification_suppressions
		WHERE tenant_id = $1 AND user_id = $2 AND channel = $3)`
	var exists bool
	if err := r.db.QueryRow(ctx, query, tenantID, userID, channel).Scan(&exists); err != nil {
		return false, fmt.Errorf("check suppression: %w", err)
	}
	return exists, nil
}

// Add inserts (or refreshes) a suppression entry. Idempotent on the
// (tenant_id, user_id, channel) primary key so a repeated one-click unsubscribe
// or bounce simply updates the reason/timestamp.
func (r *SuppressionRepository) Add(ctx context.Context, sup *model.Suppression) error {
	const query = `INSERT INTO notification_suppressions (tenant_id, user_id, channel, reason)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tenant_id, user_id, channel)
		DO UPDATE SET reason = EXCLUDED.reason, created_at = now()`
	if _, err := r.db.Exec(ctx, query, sup.TenantID, sup.UserID, sup.Channel, sup.Reason); err != nil {
		return fmt.Errorf("add suppression: %w", err)
	}
	return nil
}

// Remove deletes a suppression entry (re-subscribe).
func (r *SuppressionRepository) Remove(ctx context.Context, tenantID, userID, channel string) error {
	const query = `DELETE FROM notification_suppressions
		WHERE tenant_id = $1 AND user_id = $2 AND channel = $3`
	if _, err := r.db.Exec(ctx, query, tenantID, userID, channel); err != nil {
		return fmt.Errorf("remove suppression: %w", err)
	}
	return nil
}

// List returns the suppression entries for a tenant, newest first.
func (r *SuppressionRepository) List(ctx context.Context, tenantID string) ([]model.Suppression, error) {
	const query = `SELECT tenant_id, user_id, channel, reason, created_at
		FROM notification_suppressions
		WHERE tenant_id = $1
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list suppressions: %w", err)
	}
	defer rows.Close()

	var out []model.Suppression
	for rows.Next() {
		var s model.Suppression
		if err := rows.Scan(&s.TenantID, &s.UserID, &s.Channel, &s.Reason, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan suppression: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
