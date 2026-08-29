// Package sovereignty wires the platform's WTQ-SEC-03 data-residency mechanism
// into ClarioDR.
//
// A sovereign client requires DR to geo-fence each tenant to its bound residency
// region: the DR API (control plane) must refuse to serve a tenant whose data
// may not legally reside in this deployment's region, and DR's data plane must
// refuse to write recovery data to a WORM bucket in a disallowed region.
//
// This package is a thin, self-contained adapter over internal/residency:
//   - NewResidencyEnforcer builds a request-time chi Enforcer from the base app
//     config and the service DB pool (mirroring cmd/lex-service).
//   - AssertRegionAllowed is a data-plane guard for recovery writes: it reuses
//     the exact same decision function the middleware uses, so control-plane and
//     data-plane residency decisions can never drift.
//
// Physical hosting placement (which datacenter a deployment actually runs in)
// remains an infrastructure concern; this package provides the code mechanism
// that binds and enforces the residency contract.
package sovereignty

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/residency"
)

// NewResidencyEnforcer builds a DR data-residency Enforcer from the base
// application config and the service DB pool, attaching an audit logger so every
// DENY is recorded as a structured "residency.denied" event.
//
// The returned Enforcer's Middleware is a pass-through when residency
// enforcement is disabled (cfg.Residency.ServiceRegion empty) or when a tenant
// has no residency binding, exactly like the lex-service wiring. The tenant
// region is resolved from the platform_core tenants table via NewPGLoader, so
// the same DB pool that backs the DR service must be able to read that table.
//
// db must be non-nil; residency lookups fail closed (HTTP 403) on any load
// error, so a nil pool would deny every tenant-scoped request. Callers should
// only enable enforcement (a non-empty ServiceRegion) when a usable pool is
// available.
func NewResidencyEnforcer(cfg appconfig.ResidencyConfig, db *pgxpool.Pool, logger zerolog.Logger) *residency.Enforcer {
	return residency.NewEnforcer(cfg, residency.NewPGLoader(db)).
		WithAuditLogger(logger)
}

// AssertRegionAllowed is the DR data-plane residency guard.
//
// Before recovery data is written to a WORM bucket physically located in
// targetRegion, callers pass the owning tenant's bound residency region
// (tenantRegion) and the region of the target bucket. It returns nil when the
// write is permitted and a *RegionViolationError when the tenant's data may not
// reside in targetRegion.
//
// Decisions mirror the request-time middleware exactly (they share
// residency.EnforceRegion):
//   - targetRegion empty  => allowed (target is unrestricted / enforcement off).
//   - tenantRegion empty  => allowed (tenant has no residency constraint).
//   - regions match       => allowed.
//   - otherwise           => denied.
//
// Comparison is case-insensitive and whitespace-tolerant. This helper compares
// strings only; it does not read or mutate any WORM/region configuration.
func AssertRegionAllowed(tenantRegion, targetRegion string) error {
	if residency.EnforceRegion(tenantRegion, targetRegion) == residency.Deny {
		return &RegionViolationError{
			TenantRegion: tenantRegion,
			TargetRegion: targetRegion,
		}
	}
	return nil
}

// RegionResolver resolves a tenant's bound residency region from the same
// platform_core.tenants source the control-plane middleware uses, so data-plane
// (WORM Seal/Get) and control-plane (HTTP middleware) residency decisions can
// never drift. It structurally satisfies the data-plane resolver interface the
// WORM client accepts (worm.TenantRegionResolver) without this package importing
// worm — avoiding the worm -> sovereignty import cycle.
//
// An empty region means the tenant is unrestricted. A lookup error (including
// residency.ErrTenantNotFound) is returned verbatim so the WORM client fails
// CLOSED rather than bypassing residency on a resolve failure.
type RegionResolver struct {
	loader residency.RegionLoader
}

// NewRegionResolver builds a RegionResolver over the service DB pool, using the
// exact same platform_core tenants loader the residency middleware uses. db must
// be non-nil when enforcement is enabled; a nil pool would fail every lookup
// closed, denying all recovery-data writes/reads.
func NewRegionResolver(db *pgxpool.Pool) *RegionResolver {
	return &RegionResolver{loader: residency.NewPGLoader(db)}
}

// NewRegionResolverFromLoader builds a RegionResolver over an arbitrary region
// loader (e.g. residency.NewStaticLoader in tests).
func NewRegionResolverFromLoader(loader residency.RegionLoader) *RegionResolver {
	return &RegionResolver{loader: loader}
}

// TenantRegion returns the tenant's residency region ("" if unrestricted). It
// satisfies worm.TenantRegionResolver.
func (r *RegionResolver) TenantRegion(ctx context.Context, tenantID string) (string, error) {
	if r == nil || r.loader == nil {
		return "", fmt.Errorf("sovereignty: region resolver has no loader")
	}
	return r.loader.TenantRegion(ctx, tenantID)
}

// RegionViolationError reports that a tenant bound to TenantRegion may not have
// its recovery data written to a WORM bucket in TargetRegion.
type RegionViolationError struct {
	TenantRegion string
	TargetRegion string
}

func (e *RegionViolationError) Error() string {
	return fmt.Sprintf(
		"data-residency violation: tenant region %q may not be stored in target region %q",
		e.TenantRegion, e.TargetRegion,
	)
}
