package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// SubstitutionRepository persists the out-of-office / substitute (deputy)
// registry (migration 000009). Like the other pool-backed core repositories
// (TaskRepository / InstanceRepository) it holds a *pgxpool.Pool directly and
// runs every statement inside a SET LOCAL-scoped transaction so the FORCE-RLS'd
// workflow_substitutions table filters by app.current_tenant_id (tenant-scoped
// calls) or app.bypass_rls (the background reads the resolver does when it walks
// a deputy chain on the engine's internal path). It reuses the workflow
// repository's rls.go helpers (beginScoped / rlsExec / newScopedPool +
// WithTenantScope), so no new RLS substrate is introduced.
type SubstitutionRepository struct {
	pool *pgxpool.Pool
}

// NewSubstitutionRepository creates a repository backed by the pool.
func NewSubstitutionRepository(pool *pgxpool.Pool) *SubstitutionRepository {
	return &SubstitutionRepository{pool: pool}
}

const substitutionSelectCols = `
	id, tenant_id, user_id, deputy_id, from_time, to_time,
	active, reason, created_by, created_at, updated_at`

// SetSubstitution records (or replaces) the ACTIVE out-of-office window for a
// user. The uq_workflow_substitutions_active_user partial unique index allows at
// most one active row per (tenant, user), so this deactivates any existing active
// row first and inserts the new one in ONE transaction — the "set my deputy for
// this window" operation is atomic and deterministic. The generated id +
// timestamps are scanned back into sub.
func (r *SubstitutionRepository) SetSubstitution(ctx context.Context, sub *model.Substitution) error {
	tx, err := beginScoped(ctx, r.pool, sub.TenantID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Supersede any currently-active window for this user so the partial unique
	// index (one active row per tenant+user) is never violated.
	if _, err := tx.Exec(ctx, `
		UPDATE workflow_substitutions
		SET active = false, updated_at = now()
		WHERE tenant_id = $1 AND user_id = $2 AND active = true`,
		sub.TenantID, sub.UserID,
	); err != nil {
		return fmt.Errorf("deactivating prior substitution: %w", err)
	}

	var createdBy interface{}
	if sub.CreatedBy != "" {
		createdBy = sub.CreatedBy
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO workflow_substitutions (
			tenant_id, user_id, deputy_id, from_time, to_time, active, reason, created_by
		) VALUES ($1, $2, $3, $4, $5, true, $6, $7)
		RETURNING id, created_at, updated_at`,
		sub.TenantID, sub.UserID, sub.DeputyID,
		sub.FromTime.UTC(), sub.ToTime.UTC(), sub.Reason, createdBy,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
		return fmt.Errorf("inserting substitution: %w", err)
	}
	sub.Active = true
	return tx.Commit(ctx)
}

// ClearSubstitution deactivates the active out-of-office window for a user (the
// operator "I'm back" kill switch). Returns model.ErrNotFound when there is no
// active row to clear.
func (r *SubstitutionRepository) ClearSubstitution(ctx context.Context, tenantID, userID string) error {
	ct, err := rlsExec(ctx, r.pool, tenantID, `
		UPDATE workflow_substitutions
		SET active = false, updated_at = now()
		WHERE tenant_id = $1 AND user_id = $2 AND active = true`,
		tenantID, userID,
	)
	if err != nil {
		return fmt.Errorf("clearing substitution: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("substitution for user %s: %w", userID, model.ErrNotFound)
	}
	return nil
}

// GetActiveDeputy returns the SINGLE active substitution for (tenant, user) whose
// window covers the instant `at`, or (nil, nil) when the user is not out of
// office at that time. This is the resolver's per-hop lookup: it returns nil for
// the fast-path no-op (no active window), and the deputy row otherwise. tenantID
// == "" runs under the cross-tenant bypass scope (the engine's internal path).
func (r *SubstitutionRepository) GetActiveDeputy(ctx context.Context, tenantID, userID string, at time.Time) (*model.Substitution, error) {
	query := `SELECT` + substitutionSelectCols + `
		FROM workflow_substitutions
		WHERE user_id = $1
		  AND active = true
		  AND from_time <= $2
		  AND to_time   >= $2` + tenantPredicate(tenantID, 3) + `
		ORDER BY from_time DESC
		LIMIT 1`

	args := []any{userID, at.UTC()}
	var sctx context.Context
	if tenantID == "" {
		sctx = WithSystemScope(ctx)
	} else {
		sctx = WithTenantScope(ctx, tenantID)
		args = append(args, tenantID)
	}

	sub, err := scanSubstitution(newScopedPool(r.pool).QueryRow(sctx, query, args...))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("getting active deputy: %w", err)
	}
	return sub, nil
}

// ListForUser returns all substitutions (active and inactive) for a user, newest
// first — the admin/console view of a user's OOO history.
func (r *SubstitutionRepository) ListForUser(ctx context.Context, tenantID, userID string) ([]*model.Substitution, error) {
	query := `SELECT` + substitutionSelectCols + `
		FROM workflow_substitutions
		WHERE tenant_id = $1 AND user_id = $2
		ORDER BY created_at DESC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := newScopedPool(r.pool).Query(sctx, query, tenantID, userID)
	if err != nil {
		return nil, fmt.Errorf("listing substitutions for user: %w", err)
	}
	defer rows.Close()

	var out []*model.Substitution
	for rows.Next() {
		sub, serr := scanSubstitutionRow(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// tenantPredicate appends the tenant filter only when a tenant is supplied. The
// engine's internal (bypass-scoped) resolver reads pass tenantID == "" and skip
// the predicate; the RLS bypass makes cross-tenant rows visible for that path.
func tenantPredicate(tenantID string, argPos int) string {
	if tenantID == "" {
		return ""
	}
	return fmt.Sprintf("\n\t\t  AND tenant_id = $%d", argPos)
}

func scanSubstitution(row pgx.Row) (*model.Substitution, error) {
	return scanSubstitutionRow(row)
}

func scanSubstitutionRow(row pgx.Row) (*model.Substitution, error) {
	var (
		sub       model.Substitution
		createdBy *string
	)
	err := row.Scan(
		&sub.ID, &sub.TenantID, &sub.UserID, &sub.DeputyID,
		&sub.FromTime, &sub.ToTime, &sub.Active, &sub.Reason,
		&createdBy, &sub.CreatedAt, &sub.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("scanning substitution: %w", err)
	}
	if createdBy != nil {
		sub.CreatedBy = *createdBy
	}
	return &sub, nil
}
