package copilot

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// PGXRunner adapts a *pgxpool.Pool to the copilot's runner interfaces. The
// copilot identifies tenants by string (the DR repository takes string IDs), so
// this parses the tenant string to the uuid database.RunWithTenant requires and
// sets app.current_tenant_id for RLS. It satisfies TenantRunner, readRunner, and
// SystemRunner, so one value wires the whole package in production. The
// integration phase constructs it with NewPGXRunner(pool) and injects the same
// value into NewTools, NewService (Deps.Runner), and NewPruneLoop.
type PGXRunner struct {
	pool *pgxpool.Pool
}

// NewPGXRunner builds a runner over the DR pool.
func NewPGXRunner(pool *pgxpool.Pool) *PGXRunner { return &PGXRunner{pool: pool} }

// RunWithTenant runs fn in a tenant-scoped read-write transaction (RLS on).
func (r *PGXRunner) RunWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error {
	id, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("copilot: invalid tenant id %q: %w", tenantID, err)
	}
	return database.RunWithTenant(ctx, r.pool, id, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a tenant-scoped read-only transaction (RLS on).
func (r *PGXRunner) RunReadWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error {
	id, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("copilot: invalid tenant id %q: %w", tenantID, err)
	}
	return database.RunReadWithTenant(ctx, r.pool, id, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystemTx runs fn on the cross-tenant system path (RLS bypassed) for the
// retention-pruning loop.
func (r *PGXRunner) RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error {
	return database.RunSystemTx(ctx, r.pool, func(tx pgx.Tx) error { return fn(tx) })
}
