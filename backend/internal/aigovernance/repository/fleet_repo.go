package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

// FleetTenant is the cross-tenant metadata row used by the platform AI fleet
// rollup. It mirrors the (private) listAllTenantIDs enumeration but exposes the
// tenant display fields needed by the admin console, without granting the rest
// of the aigovernance package access to raw tenant queries.
type FleetTenant struct {
	ID               uuid.UUID `json:"tenant_id"`
	Name             string    `json:"tenant_name"`
	Slug             string    `json:"tenant_slug"`
	SubscriptionTier string    `json:"subscription_tier"`
}

// FleetRepository provides the cross-tenant primitives the platform AI fleet
// rollup needs. It deliberately lives in the aigovernance package (alongside the
// existing single-tenant repositories) so it can share the tenant-enumeration
// logic, but it never touches the RLS-scoped ai_* tables directly — callers fan
// out to the existing per-tenant repositories under each tenant's RLS context.
type FleetRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewFleetRepository(db *pgxpool.Pool, logger zerolog.Logger) *FleetRepository {
	return &FleetRepository{db: db, logger: loggerWithRepo(logger, "ai_fleet")}
}

// ListTenants returns every active (non-deprovisioned) tenant with the display
// metadata used by the fleet view. The ordering matches listAllTenantIDs
// (created_at ASC) so the two enumerations stay consistent.
func (r *FleetRepository) ListTenants(ctx context.Context) ([]FleetTenant, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, name, slug, subscription_tier::text
		FROM tenants
		WHERE status <> 'deprovisioned'
		ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list tenants for ai fleet: %w", err)
	}
	defer rows.Close()

	tenants := make([]FleetTenant, 0)
	for rows.Next() {
		var t FleetTenant
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.SubscriptionTier); err != nil {
			return nil, fmt.Errorf("scan ai fleet tenant: %w", err)
		}
		tenants = append(tenants, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ai fleet tenants: %w", err)
	}
	return tenants, nil
}

// GetTenant returns the display metadata for a single tenant by id, regardless
// of RLS (it queries the platform tenants table directly). It returns
// ErrNotFound when the tenant does not exist or has been deprovisioned.
func (r *FleetRepository) GetTenant(ctx context.Context, tenantID uuid.UUID) (*FleetTenant, error) {
	var t FleetTenant
	err := r.db.QueryRow(ctx, `
		SELECT id, name, slug, subscription_tier::text
		FROM tenants
		WHERE id = $1 AND status <> 'deprovisioned'`, tenantID).
		Scan(&t.ID, &t.Name, &t.Slug, &t.SubscriptionTier)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get ai fleet tenant: %w", err)
	}
	return &t, nil
}

// LastPredictionAt returns the most recent prediction timestamp for a tenant
// across all models, under the tenant's RLS context. nil means the tenant has
// logged no predictions.
func (r *FleetRepository) LastPredictionAt(ctx context.Context, tenantID uuid.UUID) (*time.Time, error) {
	var last *time.Time
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT MAX(created_at)
			FROM ai_prediction_logs
			WHERE tenant_id = $1`, tenantID).Scan(&last)
	})
	if err != nil {
		return nil, fmt.Errorf("last prediction at for tenant %s: %w", tenantID, err)
	}
	return last, nil
}
