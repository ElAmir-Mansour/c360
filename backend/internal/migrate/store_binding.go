package migrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// store_binding.go owns persistence for the Wave-2 DR runbook bridge: the
// migrate_runbook_binding audit trail and the wave/window link columns added in
// migration 000003. The IDs stored here are opaque references into dr_db (the DR
// engine owns the runbook/run rows); migrate_db only records the linkage.

const runbookBindingColumns = `id, tenant_id, program_id, wave_id, window_id, move_group_id,
dr_runbook_id, dr_run_id, role, parent_binding_id, source, status, ordinal, detail,
created_by, created_at, updated_at`

func scanRunbookBinding(row rowScanner) (*RunbookBinding, error) {
	var b RunbookBinding
	var role, source, status string
	var detail []byte
	if err := row.Scan(
		&b.ID, &b.TenantID, &b.ProgramID, &b.WaveID, &b.WindowID, &b.MoveGroupID,
		&b.DRRunbookID, &b.DRRunID, &role, &b.ParentBindingID, &source, &status, &b.Ordinal, &detail,
		&b.CreatedBy, &b.CreatedAt, &b.UpdatedAt,
	); err != nil {
		return nil, err
	}
	b.Role = RunbookBindingRole(role)
	b.Source = RunbookBindingSource(source)
	b.Status = RunbookBindingStatus(status)
	if len(detail) > 0 {
		if err := json.Unmarshal(detail, &b.Detail); err != nil {
			return nil, err
		}
	}
	if b.Detail == nil {
		b.Detail = map[string]any{}
	}
	return &b, nil
}

// CreateRunbookBinding inserts a runbook binding row and populates the generated
// id/timestamps back onto b.
func (s *Store) CreateRunbookBinding(ctx context.Context, db DBTX, b *RunbookBinding) error {
	if b.Detail == nil {
		b.Detail = map[string]any{}
	}
	detailJSON, err := json.Marshal(b.Detail)
	if err != nil {
		return fmt.Errorf("migrate: encode binding detail: %w", err)
	}
	if b.Role == "" {
		b.Role = BindingRoleParent
	}
	if b.Source == "" {
		b.Source = BindingSourceGenerated
	}
	if b.Status == "" {
		b.Status = BindingStatusGenerated
	}
	created, err := scanRunbookBinding(db.QueryRow(ctx, `
INSERT INTO migrate_runbook_binding
    (tenant_id, program_id, wave_id, window_id, move_group_id, dr_runbook_id, dr_run_id,
     role, parent_binding_id, source, status, ordinal, detail, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
RETURNING `+runbookBindingColumns,
		b.TenantID, b.ProgramID, b.WaveID, b.WindowID, b.MoveGroupID, b.DRRunbookID, b.DRRunID,
		b.Role, b.ParentBindingID, b.Source, b.Status, b.Ordinal, detailJSON, b.CreatedBy))
	if err != nil {
		return fmt.Errorf("migrate: create runbook binding: %w", err)
	}
	*b = *created
	return nil
}

// SupersedeWaveBindings marks every active (generated/running) binding of a wave
// as superseded, so a regeneration produces a clean current set while preserving
// the prior bindings (and their dr_runbook_ids) for audit/history.
func (s *Store) SupersedeWaveBindings(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID) error {
	_, err := db.Exec(ctx, `
UPDATE migrate_runbook_binding
   SET status = 'superseded', updated_at = now()
 WHERE tenant_id = $1 AND wave_id = $2 AND status IN ('generated','running')`, tenantID, waveID)
	if err != nil {
		return fmt.Errorf("migrate: supersede wave bindings: %w", err)
	}
	return nil
}

// ListBindingsForWave returns the CURRENT (non-superseded) bindings of a wave,
// parent first then children by ordinal.
func (s *Store) ListBindingsForWave(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID) ([]RunbookBinding, error) {
	rows, err := db.Query(ctx, `SELECT `+runbookBindingColumns+`
FROM migrate_runbook_binding
WHERE tenant_id = $1 AND wave_id = $2 AND status <> 'superseded'
ORDER BY (role = 'parent') DESC, ordinal ASC, created_at ASC`, tenantID, waveID)
	if err != nil {
		return nil, fmt.Errorf("migrate: list wave bindings: %w", err)
	}
	defer rows.Close()
	var out []RunbookBinding
	for rows.Next() {
		b, err := scanRunbookBinding(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// SupersedeWindowRollbackBindings marks every active (generated/running)
// rollback binding of a window as superseded so a regeneration produces a clean
// current set while preserving prior rollback runbooks (audit history).
func (s *Store) SupersedeWindowRollbackBindings(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID) error {
	_, err := db.Exec(ctx, `
UPDATE migrate_runbook_binding
   SET status = 'superseded', updated_at = now()
 WHERE tenant_id = $1 AND window_id = $2 AND role = 'rollback' AND status IN ('generated','running')`, tenantID, windowID)
	if err != nil {
		return fmt.Errorf("migrate: supersede window rollback bindings: %w", err)
	}
	return nil
}

// GetActiveRollbackBindingForWindow returns the current (non-superseded) rollback
// binding for a window, or ErrNotFound when none has been generated.
func (s *Store) GetActiveRollbackBindingForWindow(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID) (*RunbookBinding, error) {
	b, err := scanRunbookBinding(db.QueryRow(ctx, `SELECT `+runbookBindingColumns+`
FROM migrate_runbook_binding
WHERE tenant_id = $1 AND window_id = $2 AND role = 'rollback' AND status <> 'superseded'
ORDER BY created_at DESC LIMIT 1`, tenantID, windowID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get active rollback binding: %w", err)
	}
	return b, nil
}

// GetParentBindingForWave returns the current parent binding of a wave (the
// generated parent runbook), or ErrNotFound when no runbook has been generated.
func (s *Store) GetParentBindingForWave(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID) (*RunbookBinding, error) {
	b, err := scanRunbookBinding(db.QueryRow(ctx, `SELECT `+runbookBindingColumns+`
FROM migrate_runbook_binding
WHERE tenant_id = $1 AND wave_id = $2 AND role = 'parent' AND status <> 'superseded'
ORDER BY created_at DESC LIMIT 1`, tenantID, waveID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get parent binding: %w", err)
	}
	return b, nil
}

// SetBindingRun records a started run id + status on a binding.
func (s *Store) SetBindingRun(ctx context.Context, db DBTX, tenantID, bindingID, runID uuid.UUID, status RunbookBindingStatus) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_runbook_binding
   SET dr_run_id = $3, status = $4, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, bindingID, runID, status)
	if err != nil {
		return fmt.Errorf("migrate: set binding run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetBindingStatus updates only the lifecycle status of a binding (e.g. a run
// completing or failing), leaving the run id intact.
func (s *Store) SetBindingStatus(ctx context.Context, db DBTX, tenantID, bindingID uuid.UUID, status RunbookBindingStatus) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_runbook_binding
   SET status = $3, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, bindingID, status)
	if err != nil {
		return fmt.Errorf("migrate: set binding status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetBindingByID returns a single binding row by id (tenant-scoped).
func (s *Store) GetBindingByID(ctx context.Context, db DBTX, tenantID, bindingID uuid.UUID) (*RunbookBinding, error) {
	b, err := scanRunbookBinding(db.QueryRow(ctx, `SELECT `+runbookBindingColumns+`
FROM migrate_runbook_binding WHERE tenant_id = $1 AND id = $2`, tenantID, bindingID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get binding by id: %w", err)
	}
	return b, nil
}

// LinkWaveRunbook stores the generated parent runbook id + topology group on the
// wave row and stamps the generation time, making the previously-inert columns
// real links to the DR engine.
func (s *Store) LinkWaveRunbook(ctx context.Context, db DBTX, tenantID, waveID, runbookID uuid.UUID, topologyGroupID *uuid.UUID, at time.Time) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_wave
   SET dr_runbook_id = $3, dr_topology_group_id = COALESCE($4, dr_topology_group_id),
       runbook_generated_at = $5, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, waveID, runbookID, topologyGroupID, at)
	if err != nil {
		return fmt.Errorf("migrate: link wave runbook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LinkWindowRun stores the DR runbook + run id on a cutover window, making the
// previously-inert runbook_run_id usage a real link to the DR engine's run, and
// stamps who started the run + when (the auditable start event, migration 000004).
func (s *Store) LinkWindowRun(ctx context.Context, db DBTX, tenantID, windowID, runbookID, runID uuid.UUID, startedBy *uuid.UUID, at time.Time) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_cutover_window
   SET dr_runbook_id = $3, dr_run_id = $4, runbook_run_id = $4,
       run_started_by = $5, run_started_at = $6, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, windowID, runbookID, runID, startedBy, at)
	if err != nil {
		return fmt.Errorf("migrate: link window run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LinkRollbackPlanRunbook records the generated isolated rollback DR runbook id
// on the window's rollback plan (reusing the plan's runbook_id column, 000001).
func (s *Store) LinkRollbackPlanRunbook(ctx context.Context, db DBTX, tenantID, planID, runbookID uuid.UUID) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_rollback_plan
   SET runbook_id = $3, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, planID, runbookID)
	if err != nil {
		return fmt.Errorf("migrate: link rollback plan runbook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const rollbackRunColumns = `id, tenant_id, program_id, window_id, wave_id, rollback_plan_id,
binding_id, dr_runbook_id, dr_run_id, triggered_by, reason, status, created_at, updated_at`

func scanRollbackRun(row rowScanner) (*RollbackRun, error) {
	var r RollbackRun
	var status string
	if err := row.Scan(
		&r.ID, &r.TenantID, &r.ProgramID, &r.WindowID, &r.WaveID, &r.RollbackPlanID,
		&r.BindingID, &r.DRRunbookID, &r.DRRunID, &r.TriggeredBy, &r.Reason, &status,
		&r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.Status = RollbackRunStatus(status)
	return &r, nil
}

// CreateRollbackRun records a rollback execution's trigger-decision provenance
// (who/why) plus the isolated DR rollback runbook + run it drove.
func (s *Store) CreateRollbackRun(ctx context.Context, db DBTX, r *RollbackRun) error {
	if r.Status == "" {
		r.Status = RollbackRunRunning
	}
	created, err := scanRollbackRun(db.QueryRow(ctx, `
INSERT INTO migrate_rollback_run
    (tenant_id, program_id, window_id, wave_id, rollback_plan_id, binding_id,
     dr_runbook_id, dr_run_id, triggered_by, reason, status)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
RETURNING `+rollbackRunColumns,
		r.TenantID, r.ProgramID, r.WindowID, r.WaveID, r.RollbackPlanID, r.BindingID,
		r.DRRunbookID, r.DRRunID, r.TriggeredBy, r.Reason, r.Status))
	if err != nil {
		return fmt.Errorf("migrate: create rollback run: %w", err)
	}
	*r = *created
	return nil
}

// GetRollbackRunByID returns one rollback-run provenance row by id.
func (s *Store) GetRollbackRunByID(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*RollbackRun, error) {
	r, err := scanRollbackRun(db.QueryRow(ctx, `SELECT `+rollbackRunColumns+`
FROM migrate_rollback_run WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get rollback run: %w", err)
	}
	return r, nil
}

// ListRollbackRunsForProgram returns every executed rollback run of a program
// (all windows/waves), newest first, for the structured evidence report (Wave 6,
// P10b) so a regulator can see the rollback provenance — who triggered it, why,
// against which window, and its outcome.
func (s *Store) ListRollbackRunsForProgram(ctx context.Context, db DBTX, tenantID, programID uuid.UUID) ([]RollbackRun, error) {
	rows, err := db.Query(ctx, `SELECT `+rollbackRunColumns+`
FROM migrate_rollback_run
WHERE tenant_id = $1 AND program_id = $2
ORDER BY created_at DESC`, tenantID, programID)
	if err != nil {
		return nil, fmt.Errorf("migrate: list program rollback runs: %w", err)
	}
	defer rows.Close()
	var out []RollbackRun
	for rows.Next() {
		r, err := scanRollbackRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// LatestRollbackRunForWindow returns the most recent rollback-run provenance for
// a window, or ErrNotFound when no rollback has been executed.
func (s *Store) LatestRollbackRunForWindow(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID) (*RollbackRun, error) {
	r, err := scanRollbackRun(db.QueryRow(ctx, `SELECT `+rollbackRunColumns+`
FROM migrate_rollback_run
WHERE tenant_id = $1 AND window_id = $2
ORDER BY created_at DESC LIMIT 1`, tenantID, windowID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: latest rollback run: %w", err)
	}
	return r, nil
}

// SetRollbackRunStatus updates a rollback-run's observed status.
func (s *Store) SetRollbackRunStatus(ctx context.Context, db DBTX, tenantID, id uuid.UUID, status RollbackRunStatus) error {
	tag, err := db.Exec(ctx, `
UPDATE migrate_rollback_run
   SET status = $3, updated_at = now()
 WHERE tenant_id = $1 AND id = $2`, tenantID, id, status)
	if err != nil {
		return fmt.Errorf("migrate: set rollback run status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
