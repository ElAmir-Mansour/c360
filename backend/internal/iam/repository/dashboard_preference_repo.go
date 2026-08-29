package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/iam/model"
)

type DashboardPreferenceRepository interface {
	Get(ctx context.Context, tenantID, userID string) (*model.DashboardPreference, error)
	Upsert(ctx context.Context, preference *model.DashboardPreference) error
	Delete(ctx context.Context, tenantID, userID string) error
}

type dashboardPreferenceRepo struct {
	pool *pgxpool.Pool
}

func NewDashboardPreferenceRepository(pool *pgxpool.Pool) DashboardPreferenceRepository {
	return &dashboardPreferenceRepo{pool: pool}
}

func (r *dashboardPreferenceRepo) Get(ctx context.Context, tenantID, userID string) (*model.DashboardPreference, error) {
	const query = `
		SELECT tenant_id, user_id, preferences, created_at, updated_at
		FROM user_dashboard_preferences
		WHERE tenant_id = $1 AND user_id = $2`

	preference := &model.DashboardPreference{}
	err := r.pool.QueryRow(ctx, query, tenantID, userID).Scan(
		&preference.TenantID,
		&preference.UserID,
		&preference.Preferences,
		&preference.CreatedAt,
		&preference.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, model.ErrNotFound
		}
		return nil, fmt.Errorf("get dashboard preferences: %w", err)
	}
	return preference, nil
}

func (r *dashboardPreferenceRepo) Upsert(ctx context.Context, preference *model.DashboardPreference) error {
	if preference.Preferences == nil {
		preference.Preferences = json.RawMessage(`{}`)
	}
	const query = `
		INSERT INTO user_dashboard_preferences (tenant_id, user_id, preferences)
		VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id, user_id) DO UPDATE
		SET preferences = EXCLUDED.preferences, updated_at = NOW()
		RETURNING created_at, updated_at`
	if err := r.pool.QueryRow(
		ctx,
		query,
		preference.TenantID,
		preference.UserID,
		preference.Preferences,
	).Scan(&preference.CreatedAt, &preference.UpdatedAt); err != nil {
		return fmt.Errorf("upsert dashboard preferences: %w", err)
	}
	return nil
}

func (r *dashboardPreferenceRepo) Delete(ctx context.Context, tenantID, userID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM user_dashboard_preferences
		WHERE tenant_id = $1 AND user_id = $2`, tenantID, userID)
	if err != nil {
		return fmt.Errorf("delete dashboard preferences: %w", err)
	}
	return nil
}
