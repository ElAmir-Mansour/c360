package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// IncidentRepository is the persistence surface for the incident / governed
// operator override / dead-letter model (GAP 4). It lets the engine raise an
// incident that PARKS a failed step instead of terminating the whole instance,
// record maker-checker override requests + approvals, and dead-letter abandoned
// or permanently-failed work with enough context to diagnose + replay.
type IncidentRepository struct {
	pool *pgxpool.Pool
}

// NewIncidentRepository creates a repository backed by the pool.
func NewIncidentRepository(pool *pgxpool.Pool) *IncidentRepository {
	return &IncidentRepository{pool: pool}
}

// createIncidentTx inserts an incident row inside the supplied transaction. It is
// idempotent against the partial-unique open-incident index: a re-raise while one
// is already open for the same instance+step does NOT insert a duplicate; the
// existing open incident is loaded and returned instead. On a fresh insert the
// generated ID + timestamps are scanned back into inc.
func (r *IncidentRepository) createIncidentTx(ctx context.Context, tx pgx.Tx, inc *model.Incident) error {
	var details []byte
	if len(inc.Details) > 0 {
		details = []byte(inc.Details)
	}

	// ON CONFLICT on the (instance_id, step_id) WHERE status='open' partial unique
	// index makes a concurrent re-raise a no-op. DO NOTHING returns no row, so we
	// detect that and load the existing open incident.
	row := tx.QueryRow(ctx, `
		INSERT INTO workflow_incidents (
			tenant_id, instance_id, step_id, step_exec_id, step_type,
			status, error_message, attempt, details
		) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8)
		ON CONFLICT (instance_id, step_id) WHERE status = 'open' DO NOTHING
		RETURNING id, created_at, updated_at`,
		inc.TenantID, inc.InstanceID, inc.StepID, inc.StepExecID, inc.StepType,
		inc.ErrorMessage, inc.Attempt, details,
	)
	err := row.Scan(&inc.ID, &inc.CreatedAt, &inc.UpdatedAt)
	if err == nil {
		inc.Status = model.IncidentStatusOpen
		return nil
	}
	if err != pgx.ErrNoRows {
		return fmt.Errorf("inserting incident: %w", err)
	}

	// A conflicting open incident already exists; load it so the caller reuses it.
	existing, gerr := r.getOpenByInstanceStepTx(ctx, tx, inc.InstanceID, inc.StepID)
	if gerr != nil {
		return fmt.Errorf("loading existing open incident after conflict: %w", gerr)
	}
	*inc = *existing
	return nil
}

// RaiseIncidentAtomic opens an incident AND transitions the instance to the
// 'incident' status in ONE transaction (the instance row locked FOR UPDATE), so a
// crash between raising the incident and parking the instance cannot tear state.
// The caller supplies inst with the failed step already reflected in
// CurrentStepID and its lock_version as last read. On success inst.LockVersion is
// advanced and inc is populated (a fresh incident, or the pre-existing open one).
func (r *IncidentRepository) RaiseIncidentAtomic(ctx context.Context, inst *model.WorkflowInstance, inc *model.Incident) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("beginning raise-incident transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	instRepo := &InstanceRepository{pool: r.pool}
	locked, err := instRepo.GetByIDForUpdate(ctx, tx, inst.ID)
	if err != nil {
		return fmt.Errorf("locking instance for incident: %w", err)
	}
	if locked.LockVersion != inst.LockVersion {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}

	if err := r.createIncidentTx(ctx, tx, inc); err != nil {
		return err
	}

	if err := instRepo.updateWithLockTx(ctx, tx, inst); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// getOpenByInstanceStepTx loads the open incident for an instance+step within a
// transaction. Returns model.ErrNotFound when none is open.
func (r *IncidentRepository) getOpenByInstanceStepTx(ctx context.Context, tx pgx.Tx, instanceID, stepID string) (*model.Incident, error) {
	return scanIncident(tx.QueryRow(ctx, incidentSelect+`
		WHERE instance_id = $1 AND step_id = $2 AND status = 'open'
		ORDER BY created_at DESC LIMIT 1`, instanceID, stepID))
}

// GetOpenByInstance returns the most recent open incident for an instance, or
// model.ErrNotFound when none is open.
func (r *IncidentRepository) GetOpenByInstance(ctx context.Context, tenantID, instanceID string) (*model.Incident, error) {
	return scanIncident(r.pool.QueryRow(ctx, incidentSelect+`
		WHERE tenant_id = $1 AND instance_id = $2 AND status = 'open'
		ORDER BY created_at DESC LIMIT 1`, tenantID, instanceID))
}

// GetByID returns an incident by id, tenant-scoped.
func (r *IncidentRepository) GetByID(ctx context.Context, tenantID, id string) (*model.Incident, error) {
	return scanIncident(r.pool.QueryRow(ctx, incidentSelect+`
		WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// ListByInstance returns all incidents for an instance, newest first.
func (r *IncidentRepository) ListByInstance(ctx context.Context, tenantID, instanceID string) ([]*model.Incident, error) {
	rows, err := r.pool.Query(ctx, incidentSelect+`
		WHERE tenant_id = $1 AND instance_id = $2
		ORDER BY created_at DESC`, tenantID, instanceID)
	if err != nil {
		return nil, fmt.Errorf("listing incidents: %w", err)
	}
	defer rows.Close()
	var out []*model.Incident
	for rows.Next() {
		inc, serr := scanIncidentRow(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, inc)
	}
	return out, rows.Err()
}

// ResolveIncident marks an incident resolved with the given resolution kind and
// operator. Only an OPEN incident may be resolved.
func (r *IncidentRepository) ResolveIncident(ctx context.Context, id, resolvedBy, kind string) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE workflow_incidents
		SET status = 'resolved', resolved_by = $2, resolution_kind = $3,
		    resolved_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'open'`,
		id, resolvedBy, kind,
	)
	if err != nil {
		return fmt.Errorf("resolving incident: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("incident %s: %w", id, model.ErrNoOpenIncident)
	}
	return nil
}

// MarkIncidentDeadLettered flips an open incident to dead_lettered.
func (r *IncidentRepository) MarkIncidentDeadLettered(ctx context.Context, id, resolvedBy string) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE workflow_incidents
		SET status = 'dead_lettered', resolved_by = $2,
		    resolution_kind = 'dead_letter', resolved_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'open'`,
		id, resolvedBy,
	)
	if err != nil {
		return fmt.Errorf("dead-lettering incident: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("incident %s: %w", id, model.ErrNoOpenIncident)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Overrides (maker-checker)
// ---------------------------------------------------------------------------

// CreateOverride inserts a pending maker-checker override request. The generated
// ID + timestamps are scanned back.
func (r *IncidentRepository) CreateOverride(ctx context.Context, ov *model.IncidentOverride) error {
	var oldVars, newVars []byte
	if len(ov.OldVariables) > 0 {
		oldVars = []byte(ov.OldVariables)
	}
	if len(ov.NewVariables) > 0 {
		newVars = []byte(ov.NewVariables)
	}
	return r.pool.QueryRow(ctx, `
		INSERT INTO workflow_incident_overrides (
			tenant_id, incident_id, instance_id, kind, status,
			requested_by, reason, old_variables, new_variables
		) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`,
		ov.TenantID, ov.IncidentID, ov.InstanceID, ov.Kind,
		ov.RequestedBy, ov.Reason, oldVars, newVars,
	).Scan(&ov.ID, &ov.CreatedAt, &ov.UpdatedAt)
}

// GetOverride loads an override by id, tenant-scoped.
func (r *IncidentRepository) GetOverride(ctx context.Context, tenantID, id string) (*model.IncidentOverride, error) {
	return scanOverride(r.pool.QueryRow(ctx, overrideSelect+`
		WHERE tenant_id = $1 AND id = $2`, tenantID, id))
}

// ApproveOverride marks a pending override approved by a checker. It is the
// caller's responsibility (the service) to have already enforced that approvedBy
// is DISTINCT from requested_by; this method additionally guards it in SQL
// (fail-closed): the WHERE clause refuses to approve when requested_by = approver
// so a same-actor approval affects zero rows.
func (r *IncidentRepository) ApproveOverride(ctx context.Context, id, approvedBy string) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE workflow_incident_overrides
		SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'pending' AND requested_by <> $2`,
		id, approvedBy,
	)
	if err != nil {
		return fmt.Errorf("approving override: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return model.ErrOverrideNotPending
	}
	return nil
}

// RejectOverride marks a pending override rejected by a checker.
func (r *IncidentRepository) RejectOverride(ctx context.Context, id, rejectedBy, reason string) error {
	ct, err := r.pool.Exec(ctx, `
		UPDATE workflow_incident_overrides
		SET status = 'rejected', rejected_by = $2, reject_reason = $3,
		    rejected_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'pending'`,
		id, rejectedBy, reason,
	)
	if err != nil {
		return fmt.Errorf("rejecting override: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return model.ErrOverrideNotPending
	}
	return nil
}

// ---------------------------------------------------------------------------
// Dead letter
// ---------------------------------------------------------------------------

// CreateDeadLetter inserts a dead-letter row. The generated ID + created_at are
// scanned back.
func (r *IncidentRepository) CreateDeadLetter(ctx context.Context, dl *model.DeadLetter) error {
	var snapshot []byte
	if len(dl.Snapshot) > 0 {
		snapshot = []byte(dl.Snapshot)
	}
	return r.pool.QueryRow(ctx, `
		INSERT INTO workflow_dead_letter (
			tenant_id, instance_id, incident_id, step_id, step_type,
			reason, error_message, definition_id, definition_ver, snapshot, abandoned_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at`,
		dl.TenantID, dl.InstanceID, dl.IncidentID, dl.StepID, dl.StepType,
		dl.Reason, dl.ErrorMessage, dl.DefinitionID, dl.DefinitionVer, snapshot, dl.AbandonedBy,
	).Scan(&dl.ID, &dl.CreatedAt)
}

// ListDeadLetter returns dead-letter rows for a tenant, newest first.
func (r *IncidentRepository) ListDeadLetter(ctx context.Context, tenantID string, limit int) ([]*model.DeadLetter, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, deadLetterSelect+`
		WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, fmt.Errorf("listing dead letters: %w", err)
	}
	defer rows.Close()
	var out []*model.DeadLetter
	for rows.Next() {
		dl, serr := scanDeadLetterRow(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, dl)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

const incidentSelect = `
	SELECT id, tenant_id, instance_id, step_id, step_exec_id, step_type,
	       status, error_message, attempt, details,
	       resolved_by, resolved_at, resolution_kind, created_at, updated_at
	FROM workflow_incidents`

func scanIncident(row pgx.Row) (*model.Incident, error) {
	return scanIncidentRow(row)
}

func scanIncidentRow(row pgx.Row) (*model.Incident, error) {
	var (
		inc     model.Incident
		details []byte
	)
	err := row.Scan(
		&inc.ID, &inc.TenantID, &inc.InstanceID, &inc.StepID, &inc.StepExecID, &inc.StepType,
		&inc.Status, &inc.ErrorMessage, &inc.Attempt, &details,
		&inc.ResolvedBy, &inc.ResolvedAt, &inc.ResolutionKind, &inc.CreatedAt, &inc.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("incident: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning incident: %w", err)
	}
	if details != nil {
		inc.Details = json.RawMessage(details)
	}
	return &inc, nil
}

const overrideSelect = `
	SELECT id, tenant_id, incident_id, instance_id, kind, status,
	       requested_by, reason, old_variables, new_variables,
	       approved_by, approved_at, rejected_by, rejected_at, reject_reason,
	       created_at, updated_at
	FROM workflow_incident_overrides`

func scanOverride(row pgx.Row) (*model.IncidentOverride, error) {
	var (
		ov      model.IncidentOverride
		oldVars []byte
		newVars []byte
	)
	err := row.Scan(
		&ov.ID, &ov.TenantID, &ov.IncidentID, &ov.InstanceID, &ov.Kind, &ov.Status,
		&ov.RequestedBy, &ov.Reason, &oldVars, &newVars,
		&ov.ApprovedBy, &ov.ApprovedAt, &ov.RejectedBy, &ov.RejectedAt, &ov.RejectReason,
		&ov.CreatedAt, &ov.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("incident override: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning incident override: %w", err)
	}
	if oldVars != nil {
		ov.OldVariables = json.RawMessage(oldVars)
	}
	if newVars != nil {
		ov.NewVariables = json.RawMessage(newVars)
	}
	return &ov, nil
}

const deadLetterSelect = `
	SELECT id, tenant_id, instance_id, incident_id, step_id, step_type,
	       reason, error_message, definition_id, definition_ver, snapshot,
	       abandoned_by, created_at
	FROM workflow_dead_letter`

func scanDeadLetterRow(row pgx.Row) (*model.DeadLetter, error) {
	var (
		dl       model.DeadLetter
		snapshot []byte
	)
	err := row.Scan(
		&dl.ID, &dl.TenantID, &dl.InstanceID, &dl.IncidentID, &dl.StepID, &dl.StepType,
		&dl.Reason, &dl.ErrorMessage, &dl.DefinitionID, &dl.DefinitionVer, &snapshot,
		&dl.AbandonedBy, &dl.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("dead letter: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning dead letter: %w", err)
	}
	if snapshot != nil {
		dl.Snapshot = json.RawMessage(snapshot)
	}
	return &dl, nil
}
