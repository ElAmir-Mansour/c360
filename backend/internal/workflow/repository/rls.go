package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// txBeginner is the minimal capability the RLS-scoped helpers need from a
// connection pool: open a transaction. Both the production *pgxpool.Pool and the
// unit-test pgxmock pool (pgxmock.PgxPoolIface) satisfy it, so a repository can
// hold this seam and be exercised against a mock while production wires the real
// pool. Every existing caller passing a *pgxpool.Pool keeps compiling unchanged
// (the concrete pool converts to this interface at the call site).
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// This file is the workflow repository layer's RLS scoping substrate. It mirrors
// the proven database.RunWithTenant / RunSystemTx pattern (internal/database/
// tenant_context.go) that the forms/SLA tables already use, so the 5 CORE tables
// (workflow_definitions/instances/tasks/step_executions/trigger_executions) can
// be FORCE-RLS'd (migration 000008) without changing repository call sites'
// method signatures.
//
// The design keeps BACKWARD COMPATIBILITY with the eight existing workflow test
// packages: the DefinitionRepository / ActivityExecutionRepository unit tests
// inject a pgxmock DBTX DIRECTLY (via the definitionDBTX / activityDBTX seams and
// the &Repo{db: mock} literal / *WithDB constructors). Those injected handles are
// used verbatim — no RLS transaction is layered on — so the recorded pgxmock
// expectations (which expect a bare Exec/Query/QueryRow, not BEGIN/set_config/
// COMMIT) still match. Only the PRODUCTION path (NewXxx(pool)) wraps the pool in
// a scopedPool that per-call opens a SET LOCAL-scoped transaction.
//
// Instance / Task / TriggerExecution repositories hold a *pgxpool.Pool directly
// and have NO pgxmock unit tests pinning their SQL sequence, so their pool-backed
// methods set the tenant/bypass context inline (via rlsExec/rlsQuery/rlsQueryRow
// or, for multi-statement transactions, setTxScope after Begin).

// setSessionTenant sets app.current_tenant_id for the current transaction via
// SET LOCAL semantics (set_config(..., is_local=true)). Mirrors
// database.SetTenantContext but lives in the repository package so the workflow
// repos do not take an import cycle on internal/database (which imports nothing
// from here — this is purely to keep the layering explicit and the SQL identical).
func setSessionTenant(ctx context.Context, tx pgx.Tx, tenantID string) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
		return fmt.Errorf("set tenant rls context (tenant=%s): %w", tenantID, err)
	}
	return nil
}

// setSessionBypass sets app.bypass_rls = 'on' for the current transaction (SET
// LOCAL). Used by the legitimately cross-tenant background workers (recovery /
// scheduler / cron / event-trigger consumer) and the engine's internal, already
// tenant-authorized re-entry reads that pass tenantID == "".
func setSessionBypass(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('app.bypass_rls', 'on', true)"); err != nil {
		return fmt.Errorf("set bypass rls context: %w", err)
	}
	return nil
}

// setTxScope applies the correct RLS scope to an already-open transaction based
// on tenantID: a non-empty tenantID sets app.current_tenant_id (tenant scope);
// an empty tenantID sets app.bypass_rls = 'on' (system/cross-tenant scope, used
// by the engine's internal re-entry reads and the background workers). This is
// the single decision point that maps the existing "empty tenant == internal
// call" convention onto RLS.
func setTxScope(ctx context.Context, tx pgx.Tx, tenantID string) error {
	if tenantID == "" {
		return setSessionBypass(ctx, tx)
	}
	return setSessionTenant(ctx, tx, tenantID)
}

// beginScoped opens a transaction on pool and applies the RLS scope for tenantID
// (tenant when non-empty, bypass when empty). The caller owns commit/rollback.
func beginScoped(ctx context.Context, pool txBeginner, tenantID string) (pgx.Tx, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("beginning rls-scoped transaction: %w", err)
	}
	if err := setTxScope(ctx, tx, tenantID); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}

// rlsExec runs a single-statement Exec under an RLS-scoped transaction on pool.
// tenantID == "" selects the bypass scope. The statement's own writes commit iff
// it succeeds — matching the autocommit semantics the pool-direct Exec had before
// the RLS retrofit, while now carrying the SET LOCAL scope RLS requires.
func rlsExec(ctx context.Context, pool txBeginner, tenantID, sql string, args ...any) (pgconn.CommandTag, error) {
	tx, err := beginScoped(ctx, pool, tenantID)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	ct, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return pgconn.CommandTag{}, fmt.Errorf("committing rls-scoped exec: %w", err)
	}
	return ct, nil
}

// scopedPool wraps a *pgxpool.Pool and implements the Exec/Query/QueryRow DBTX
// surface (definitionDBTX / activityDBTX) by running EACH call inside a short
// RLS-scoped transaction. The scope is carried on the context via WithTenantScope
// / WithSystemScope; when neither is present it FAILS CLOSED to bypass=off tenant
// scope with an empty tenant, so RLS makes zero rows visible (the safe default)
// rather than silently leaking across tenants.
//
// It is the production adapter for the DBTX-seam repositories (DefinitionRepository,
// ActivityExecutionRepository): NewXxx(pool) wraps the pool here, while unit tests
// inject a raw pgxmock DBTX and never hit this type.
type scopedPool struct {
	pool txBeginner
}

func newScopedPool(pool txBeginner) *scopedPool { return &scopedPool{pool: pool} }

// rlsScopeKey types the context key for the RLS scope so it cannot collide.
type rlsScopeKey struct{}

// rlsScope carries the per-call RLS decision on the context.
type rlsScope struct {
	system   bool
	tenantID string
}

// WithTenantScope returns a context that scopes subsequent scopedPool calls to
// tenantID (SET LOCAL app.current_tenant_id). A DBTX-seam repository method reads
// the tenant from this context so its Exec/Query/QueryRow run RLS-filtered.
func WithTenantScope(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, rlsScopeKey{}, rlsScope{tenantID: tenantID})
}

// WithSystemScope returns a context that scopes subsequent scopedPool calls to
// the cross-tenant bypass (SET LOCAL app.bypass_rls = 'on'). Used by the engine's
// internal, already-authorized reads and the background workers.
func WithSystemScope(ctx context.Context) context.Context {
	return context.WithValue(ctx, rlsScopeKey{}, rlsScope{system: true})
}

// scopeFrom resolves the RLS scope from the context. Absent an explicit scope it
// returns a tenant scope with an EMPTY tenant id, which under the 000008 policies
// makes NULL::uuid = tenant_id — i.e. no rows — the fail-closed default.
func scopeFrom(ctx context.Context) rlsScope {
	if s, ok := ctx.Value(rlsScopeKey{}).(rlsScope); ok {
		return s
	}
	return rlsScope{}
}

// applyScope sets the resolved RLS scope on an open transaction.
func (p *scopedPool) applyScope(ctx context.Context, tx pgx.Tx) error {
	s := scopeFrom(ctx)
	if s.system {
		return setSessionBypass(ctx, tx)
	}
	return setSessionTenant(ctx, tx, s.tenantID)
}

func (p *scopedPool) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return pgconn.CommandTag{}, fmt.Errorf("beginning scoped exec tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := p.applyScope(ctx, tx); err != nil {
		return pgconn.CommandTag{}, err
	}
	ct, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return pgconn.CommandTag{}, fmt.Errorf("committing scoped exec: %w", err)
	}
	return ct, nil
}

func (p *scopedPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	// A read still needs the SET LOCAL scope, so it runs inside a transaction.
	// The rows must be fully drained before the tx commits; scopedRows wraps the
	// pgx.Rows and commits (releasing the connection) on Close.
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("beginning scoped query tx: %w", err)
	}
	if err := p.applyScope(ctx, tx); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return &scopedRows{Rows: rows, tx: tx, ctx: ctx}, nil
}

func (p *scopedPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	// QueryRow must keep the connection/tx alive until Scan runs, then release it.
	// scopedRow defers the Begin+scope until Scan so a scan error path still frees
	// the connection.
	return &scopedRow{pool: p.pool, apply: p.applyScope, ctx: ctx, sql: sql, args: args}
}

// scopedRows adapts a transaction-scoped pgx.Rows so Close() also commits the
// owning transaction, releasing the pooled connection.
type scopedRows struct {
	pgx.Rows
	tx  pgx.Tx
	ctx context.Context
}

func (r *scopedRows) Close() {
	r.Rows.Close()
	// Commit to release the connection cleanly; on error the deferred rollback in
	// the driver would still free it, so ignore the commit error here.
	_ = r.tx.Commit(r.ctx)
}

// scopedRow lazily opens an RLS-scoped transaction on Scan, scans the single row,
// then commits to release the connection. It preserves pgx.ErrNoRows so callers'
// not-found translation is unchanged.
type scopedRow struct {
	pool  txBeginner
	apply func(context.Context, pgx.Tx) error
	ctx   context.Context
	sql   string
	args  []any
}

func (r *scopedRow) Scan(dest ...any) error {
	tx, err := r.pool.Begin(r.ctx)
	if err != nil {
		return fmt.Errorf("beginning scoped query-row tx: %w", err)
	}
	defer tx.Rollback(r.ctx) //nolint:errcheck
	if err := r.apply(r.ctx, tx); err != nil {
		return err
	}
	if err := tx.QueryRow(r.ctx, r.sql, r.args...).Scan(dest...); err != nil {
		return err
	}
	if err := tx.Commit(r.ctx); err != nil {
		return fmt.Errorf("committing scoped query-row: %w", err)
	}
	return nil
}
