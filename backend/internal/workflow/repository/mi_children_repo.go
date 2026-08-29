package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// MIChildRepository persists the multi_instance (for-each) fan-in ledger:
// workflow_mi_children. One row per fan-out child of a multi_instance parent
// step. It is the durable completion-counter the engine consults on each child
// completion to decide whether the parent step's policy (all / any / n_of_m) is
// satisfied — so the parent resumes EXACTLY ONCE even under concurrent child
// completions (the mutating writes run under the per-instance critical section
// keyed on the PARENT instance, and the terminal transition is guarded so a
// second completion of the same slot is a no-op).
//
// Every statement runs inside an RLS-scoped transaction (SET LOCAL
// app.current_tenant_id, or app.bypass_rls for the engine-internal reads that
// pass an empty tenant), exactly like InstanceRepository, so the FORCED RLS on
// workflow_mi_children (migration 000013) admits the writes.
type MIChildRepository struct {
	pool *pgxpool.Pool
}

// NewMIChildRepository creates a MIChildRepository backed by the pool.
func NewMIChildRepository(pool *pgxpool.Pool) *MIChildRepository {
	return &MIChildRepository{pool: pool}
}

// CreateChild inserts one fan-out child slot for a multi_instance parent step.
// The (parent_instance_id, parent_step_id, child_index) unique constraint makes
// the fan-out idempotent: a recovered/replayed fan-out that re-inserts the same
// slot conflicts and is skipped (DO NOTHING), so the ledger is not double-seeded.
// The generated id + timestamps are scanned back into the struct on a fresh
// insert; on a conflict (already seeded) the existing row is left untouched.
func (r *MIChildRepository) CreateChild(ctx context.Context, child *model.MIChild) error {
	var outputJSON []byte
	if child.Output != nil {
		b, err := json.Marshal(child.Output)
		if err != nil {
			return fmt.Errorf("marshaling mi child output: %w", err)
		}
		outputJSON = b
	}

	tx, err := beginScoped(ctx, r.pool, child.TenantID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ON CONFLICT DO NOTHING keeps fan-out idempotent; RETURNING only yields a row
	// on a fresh insert, so a conflict leaves the caller's zero id/timestamps.
	err = tx.QueryRow(ctx, `
		INSERT INTO workflow_mi_children (
			tenant_id, parent_instance_id, parent_step_id, child_index,
			child_instance_id, status, output, error_message
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (parent_instance_id, parent_step_id, child_index) DO NOTHING
		RETURNING id, created_at, updated_at`,
		child.TenantID,
		child.ParentInstanceID,
		child.ParentStepID,
		child.ChildIndex,
		child.ChildInstanceID,
		child.Status,
		outputJSON,
		child.ErrorMessage,
	).Scan(&child.ID, &child.CreatedAt, &child.UpdatedAt)
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("inserting mi child slot: %w", err)
	}
	return tx.Commit(ctx)
}

// MarkChildTerminalByInstance transitions the child slot identified by its child
// instance id to a terminal state (completed / failed) and records its mapped
// output / error. It is guarded so it only mutates a slot still in 'running':
// the returned bool reports whether THIS call performed the transition (true) or
// found the slot already terminal (false) — the caller uses that to resume the
// parent at most once per child. Runs under the bypass scope (engine-internal,
// already authorized) so the child instance id lookup is not narrowed by an
// unset tenant context.
func (r *MIChildRepository) MarkChildTerminalByInstance(ctx context.Context, childInstanceID, status string, output map[string]interface{}, errMsg *string) (bool, error) {
	var outputJSON []byte
	if output != nil {
		b, err := json.Marshal(output)
		if err != nil {
			return false, fmt.Errorf("marshaling mi child output: %w", err)
		}
		outputJSON = b
	}

	ct, err := rlsExec(ctx, r.pool, "", `
		UPDATE workflow_mi_children
		SET status = $2, output = $3, error_message = $4, updated_at = now()
		WHERE child_instance_id = $1 AND status = 'running'`,
		childInstanceID, status, outputJSON, errMsg,
	)
	if err != nil {
		return false, fmt.Errorf("marking mi child terminal: %w", err)
	}
	return ct.RowsAffected() > 0, nil
}

// AttachChildInstance links a spawned child instance id onto an existing fan-out
// slot (used by the SEQUENTIAL path, which seeds slots up-front but starts each
// child one at a time). It targets the slot by (parent, step, index) and only
// attaches when the slot has no child instance yet and is still running, so a
// replay cannot re-point a slot. Runs under the bypass scope (engine-internal).
func (r *MIChildRepository) AttachChildInstance(ctx context.Context, parentInstanceID, parentStepID string, childIndex int, childInstanceID string) error {
	_, err := rlsExec(ctx, r.pool, "", `
		UPDATE workflow_mi_children
		SET child_instance_id = $4, updated_at = now()
		WHERE parent_instance_id = $1 AND parent_step_id = $2 AND child_index = $3
		  AND child_instance_id IS NULL AND status = 'running'`,
		parentInstanceID, parentStepID, childIndex, childInstanceID,
	)
	if err != nil {
		return fmt.Errorf("attaching child instance to mi slot: %w", err)
	}
	return nil
}

// GetChildByInstance returns the fan-in slot for a given child instance id, or
// model.ErrNotFound when the child instance is not a multi_instance fan-out
// child (e.g. a top-level or call-activity child). Runs under the bypass scope.
func (r *MIChildRepository) GetChildByInstance(ctx context.Context, childInstanceID string) (*model.MIChild, error) {
	tx, err := beginScoped(ctx, r.pool, "")
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	child, err := r.scanChild(tx.QueryRow(ctx, `
		SELECT id, tenant_id, parent_instance_id, parent_step_id, child_index,
		       child_instance_id, status, output, error_message, created_at, updated_at
		FROM workflow_mi_children
		WHERE child_instance_id = $1`, childInstanceID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing mi child read: %w", err)
	}
	return child, nil
}

// ListChildren returns all fan-out slots for a multi_instance parent step,
// ordered by child_index ascending, so the caller can count terminal children
// and aggregate outputs into the result collection in stable order. Runs under
// the bypass scope (engine-internal).
func (r *MIChildRepository) ListChildren(ctx context.Context, parentInstanceID, parentStepID string) ([]*model.MIChild, error) {
	tx, err := beginScoped(ctx, r.pool, "")
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT id, tenant_id, parent_instance_id, parent_step_id, child_index,
		       child_instance_id, status, output, error_message, created_at, updated_at
		FROM workflow_mi_children
		WHERE parent_instance_id = $1 AND parent_step_id = $2
		ORDER BY child_index ASC`, parentInstanceID, parentStepID)
	if err != nil {
		return nil, fmt.Errorf("listing mi children: %w", err)
	}
	children, err := r.scanChildren(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing mi children list: %w", err)
	}
	return children, nil
}

func (r *MIChildRepository) scanChild(row pgx.Row) (*model.MIChild, error) {
	var (
		c          model.MIChild
		outputJSON []byte
	)
	err := row.Scan(
		&c.ID,
		&c.TenantID,
		&c.ParentInstanceID,
		&c.ParentStepID,
		&c.ChildIndex,
		&c.ChildInstanceID,
		&c.Status,
		&outputJSON,
		&c.ErrorMessage,
		&c.CreatedAt,
		&c.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("mi child: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning mi child: %w", err)
	}
	if len(outputJSON) > 0 {
		if err := json.Unmarshal(outputJSON, &c.Output); err != nil {
			return nil, fmt.Errorf("unmarshaling mi child output: %w", err)
		}
	}
	return &c, nil
}

func (r *MIChildRepository) scanChildren(rows pgx.Rows) ([]*model.MIChild, error) {
	var children []*model.MIChild
	for rows.Next() {
		var (
			c          model.MIChild
			outputJSON []byte
		)
		if err := rows.Scan(
			&c.ID,
			&c.TenantID,
			&c.ParentInstanceID,
			&c.ParentStepID,
			&c.ChildIndex,
			&c.ChildInstanceID,
			&c.Status,
			&outputJSON,
			&c.ErrorMessage,
			&c.CreatedAt,
			&c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning mi child row: %w", err)
		}
		if len(outputJSON) > 0 {
			if err := json.Unmarshal(outputJSON, &c.Output); err != nil {
				return nil, fmt.Errorf("unmarshaling mi child output: %w", err)
			}
		}
		children = append(children, &c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating mi child rows: %w", err)
	}
	return children, nil
}
