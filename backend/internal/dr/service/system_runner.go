package service

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// PGXSystemRunner runs the failover Driver's collaborators (recovery executor,
// health validator, attestation engine) against the pool WITHOUT a tenant
// filter, because the leader-singleton Driver claims runs across all tenants
// (DESIGN_DataStream_DR.md §7 system path). It uses database.RunSystemTx /
// RunSystemRead which set app.bypass_rls within the transaction — the single,
// clearly-named system path the design reserves for the background loops.
type PGXSystemRunner struct {
	Pool *pgxpool.Pool
}

// NewPGXSystemRunner builds a system runner over the pool.
func NewPGXSystemRunner(pool *pgxpool.Pool) PGXSystemRunner {
	return PGXSystemRunner{Pool: pool}
}

// RunSystemTx runs fn inside a read-write system transaction (RLS bypassed).
func (r PGXSystemRunner) RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error {
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystemRead runs fn inside a read-only system transaction (RLS bypassed).
func (r PGXSystemRunner) RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error {
	return database.RunSystemRead(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}
