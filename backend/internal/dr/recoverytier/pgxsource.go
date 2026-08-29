package recoverytier

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
)

// PGXSiteSource reads protected-site recovery objectives from dr_db, tenant-scoped
// via the platform's read transaction helper so every query runs under SET LOCAL
// app.current_tenant_id (RLS backstop). protected_site stores only RTO/RPO
// objectives today, so the criticality flags on SiteObjectives are left false (see
// SiteObjectives).
type PGXSiteSource struct {
	pool *pgxpool.Pool
}

// NewPGXSiteSource constructs a DB-backed SiteSource over the DR pool.
func NewPGXSiteSource(pool *pgxpool.Pool) *PGXSiteSource {
	return &PGXSiteSource{pool: pool}
}

const siteObjectivesColumns = `id, name, rto_objective_seconds, rpo_objective_seconds`

// Site returns one site's configured objectives within the tenant's RLS scope.
// Returns ErrSiteNotFound when the site is not in the tenant's scope.
func (s *PGXSiteSource) Site(ctx context.Context, tenantID, siteID uuid.UUID) (SiteObjectives, error) {
	const q = `SELECT ` + siteObjectivesColumns + ` FROM protected_site WHERE id = $1`
	var obj SiteObjectives
	err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		scanErr := tx.QueryRow(ctx, q, siteID).Scan(&obj.SiteID, &obj.Name, &obj.RTOSeconds, &obj.RPOSeconds)
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return ErrSiteNotFound
		}
		return scanErr
	})
	if errors.Is(err, ErrSiteNotFound) {
		return SiteObjectives{}, ErrSiteNotFound
	}
	if err != nil {
		return SiteObjectives{}, fmt.Errorf("query protected site: %w", err)
	}
	return obj, nil
}

// Sites returns every protected site's objectives in the tenant's RLS scope,
// ordered by name for a stable coverage report.
func (s *PGXSiteSource) Sites(ctx context.Context, tenantID uuid.UUID) ([]SiteObjectives, error) {
	const q = `SELECT ` + siteObjectivesColumns + ` FROM protected_site ORDER BY name ASC`
	out := make([]SiteObjectives, 0)
	err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		rows, qErr := tx.Query(ctx, q)
		if qErr != nil {
			return qErr
		}
		defer rows.Close()
		for rows.Next() {
			var obj SiteObjectives
			if scanErr := rows.Scan(&obj.SiteID, &obj.Name, &obj.RTOSeconds, &obj.RPOSeconds); scanErr != nil {
				return scanErr
			}
			out = append(out, obj)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("query protected sites: %w", err)
	}
	return out, nil
}

var _ SiteSource = (*PGXSiteSource)(nil)
