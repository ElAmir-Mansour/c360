package residency

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrTenantNotFound is returned when a tenant ID has no row in the tenants table.
var ErrTenantNotFound = errors.New("residency: tenant not found")

// RegionLoader resolves a tenant's bound residency region.
//
// The returned region is the raw value from the tenants.residency_region column;
// an empty string means the tenant is unrestricted (NULL in the database).
type RegionLoader interface {
	TenantRegion(ctx context.Context, tenantID string) (string, error)
}

// rowQuerier is the minimal subset of the pgx pool API the loader needs. Both
// *pgxpool.Pool and test fakes satisfy it, keeping the loader unit-testable.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PGLoader loads tenant residency regions from the platform_core tenants table.
type PGLoader struct {
	db rowQuerier
}

// NewPGLoader constructs a Postgres-backed RegionLoader. db is typically a
// *pgxpool.Pool.
func NewPGLoader(db rowQuerier) *PGLoader {
	return &PGLoader{db: db}
}

const tenantRegionQuery = `SELECT COALESCE(residency_region, '') FROM tenants WHERE id = $1`

// TenantRegion returns the residency region bound to the tenant, or an empty
// string if the tenant is unrestricted (residency_region IS NULL).
func (l *PGLoader) TenantRegion(ctx context.Context, tenantID string) (string, error) {
	var region string
	err := l.db.QueryRow(ctx, tenantRegionQuery, tenantID).Scan(&region)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrTenantNotFound
		}
		return "", fmt.Errorf("residency: loading tenant region: %w", err)
	}
	return region, nil
}

// StaticLoader is a RegionLoader backed by an in-memory map, useful for tests
// and for deployments that bind residency via configuration rather than the DB.
type StaticLoader struct {
	regions map[string]string
}

// NewStaticLoader builds a StaticLoader from a tenantID -> region map.
func NewStaticLoader(regions map[string]string) *StaticLoader {
	cp := make(map[string]string, len(regions))
	for k, v := range regions {
		cp[k] = v
	}
	return &StaticLoader{regions: cp}
}

// TenantRegion returns the configured region for the tenant. Unknown tenants are
// reported as ErrTenantNotFound so callers can decide how strict to be.
func (l *StaticLoader) TenantRegion(_ context.Context, tenantID string) (string, error) {
	region, ok := l.regions[tenantID]
	if !ok {
		return "", ErrTenantNotFound
	}
	return region, nil
}
