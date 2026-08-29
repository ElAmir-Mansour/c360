package migrate

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// isUniqueViolation reports whether err is a Postgres unique-constraint violation
// (SQLSTATE 23505) — used to translate the partial unique index that guards one
// pending approval per subject into ErrVersionConflict.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// store_approval_binding.go owns persistence for the Wave-5 H2 workflow-backed
// approval binding: migrate_approval_binding (migration 000006). It links a
// migrate approval subject (a move group, a cutover go/no-go gate, or a rollback
// plan) to a workflow-engine approval instance and records the mirrored terminal
// decision the workflow drove. The workflow_instance_id / workflow_definition_id
// are opaque refs into workflow_db (the workflow engine owns those rows).

// ApprovalSubjectType names which migrate approval gate a binding serialises.
type ApprovalSubjectType string

const (
	ApprovalSubjectMoveGroup    ApprovalSubjectType = "move_group"
	ApprovalSubjectGate         ApprovalSubjectType = "gate"
	ApprovalSubjectRollbackPlan ApprovalSubjectType = "rollback_plan"
)

// ApprovalBindingStatus is the lifecycle of an approval binding.
type ApprovalBindingStatus string

const (
	ApprovalBindingPending   ApprovalBindingStatus = "pending"
	ApprovalBindingCompleted ApprovalBindingStatus = "completed"
	ApprovalBindingCancelled ApprovalBindingStatus = "cancelled"
	ApprovalBindingFailed    ApprovalBindingStatus = "failed"
)

// ApprovalDecisionOutcome is the migrate-normalised terminal decision recorded on
// a completed binding.
type ApprovalDecisionOutcome string

const (
	ApprovalDecisionApproved ApprovalDecisionOutcome = "approved"
	ApprovalDecisionRejected ApprovalDecisionOutcome = "rejected"
)

// ApprovalBinding is the migrate-side record linking a subject to a workflow
// approval instance + the decision it drove.
type ApprovalBinding struct {
	ID                   uuid.UUID               `json:"id"`
	TenantID             uuid.UUID               `json:"tenant_id"`
	ProgramID            uuid.UUID               `json:"program_id"`
	SubjectType          ApprovalSubjectType     `json:"subject_type"`
	SubjectID            uuid.UUID               `json:"subject_id"`
	WorkflowInstanceID   string                  `json:"workflow_instance_id"`
	WorkflowDefinitionID string                  `json:"workflow_definition_id"`
	WorkflowStepID       string                  `json:"workflow_step_id,omitempty"`
	Status               ApprovalBindingStatus   `json:"status"`
	Decision             ApprovalDecisionOutcome `json:"decision,omitempty"`
	Rationale            string                  `json:"rationale,omitempty"`
	DecidedBy            *uuid.UUID              `json:"decided_by,omitempty"`
	DecidedAt            *time.Time              `json:"decided_at,omitempty"`
	RequestedBy          *uuid.UUID              `json:"requested_by,omitempty"`
	CreatedAt            time.Time               `json:"created_at"`
	UpdatedAt            time.Time               `json:"updated_at"`
}

const approvalBindingColumns = `id, tenant_id, program_id, subject_type, subject_id,
workflow_instance_id, workflow_definition_id, workflow_step_id, status, decision,
rationale, decided_by, decided_at, requested_by, created_at, updated_at`

func scanApprovalBinding(row rowScanner) (*ApprovalBinding, error) {
	var b ApprovalBinding
	var subjectType, status string
	var decision *string
	if err := row.Scan(
		&b.ID, &b.TenantID, &b.ProgramID, &subjectType, &b.SubjectID,
		&b.WorkflowInstanceID, &b.WorkflowDefinitionID, &b.WorkflowStepID, &status, &decision,
		&b.Rationale, &b.DecidedBy, &b.DecidedAt, &b.RequestedBy, &b.CreatedAt, &b.UpdatedAt,
	); err != nil {
		return nil, err
	}
	b.SubjectType = ApprovalSubjectType(subjectType)
	b.Status = ApprovalBindingStatus(status)
	if decision != nil {
		b.Decision = ApprovalDecisionOutcome(*decision)
	}
	return &b, nil
}

// ListApprovalBindingsForProgram returns every approval binding of a program
// (all subjects, all statuses), newest first, for the structured evidence report
// (Wave 6, P10b) so a regulator can see which move-group / gate / rollback-plan
// approvals routed through the shared workflow engine and how they were decided.
func (s *Store) ListApprovalBindingsForProgram(ctx context.Context, db DBTX, tenantID, programID uuid.UUID) ([]ApprovalBinding, error) {
	rows, err := db.Query(ctx, `SELECT `+approvalBindingColumns+`
FROM migrate_approval_binding
WHERE tenant_id = $1 AND program_id = $2
ORDER BY created_at DESC`, tenantID, programID)
	if err != nil {
		return nil, fmt.Errorf("migrate: list program approval bindings: %w", err)
	}
	defer rows.Close()
	var out []ApprovalBinding
	for rows.Next() {
		b, err := scanApprovalBinding(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// CreateApprovalBinding inserts a pending approval binding and populates the
// generated id/timestamps back onto b. The partial unique index guarantees a
// subject has at most one pending binding — a duplicate request while one is
// in-flight surfaces as ErrVersionConflict (the caller should read the existing
// one rather than open a second workflow).
func (s *Store) CreateApprovalBinding(ctx context.Context, db DBTX, b *ApprovalBinding) error {
	if b.Status == "" {
		b.Status = ApprovalBindingPending
	}
	created, err := scanApprovalBinding(db.QueryRow(ctx, `
INSERT INTO migrate_approval_binding
    (tenant_id, program_id, subject_type, subject_id, workflow_instance_id,
     workflow_definition_id, workflow_step_id, status, requested_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING `+approvalBindingColumns,
		b.TenantID, b.ProgramID, b.SubjectType, b.SubjectID, b.WorkflowInstanceID,
		b.WorkflowDefinitionID, b.WorkflowStepID, b.Status, b.RequestedBy))
	if err != nil {
		// A pending binding already exists for this subject (partial unique index).
		if isUniqueViolation(err) {
			return fmt.Errorf("an approval is already in progress for this subject: %w", ErrVersionConflict)
		}
		return fmt.Errorf("migrate: create approval binding: %w", err)
	}
	*b = *created
	return nil
}

// GetActiveApprovalBinding returns the pending approval binding for a subject, or
// ErrApprovalNotStarted when none is in flight.
func (s *Store) GetActiveApprovalBinding(ctx context.Context, db DBTX, tenantID uuid.UUID, subjectType ApprovalSubjectType, subjectID uuid.UUID) (*ApprovalBinding, error) {
	b, err := scanApprovalBinding(db.QueryRow(ctx, `SELECT `+approvalBindingColumns+`
FROM migrate_approval_binding
WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'pending'
ORDER BY created_at DESC LIMIT 1`, tenantID, subjectType, subjectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApprovalNotStarted
		}
		return nil, fmt.Errorf("migrate: get active approval binding: %w", err)
	}
	return b, nil
}

// GetApprovalBindingByInstance returns the binding for a workflow instance id, or
// ErrApprovalNotStarted when no binding references it. This is the callback path:
// the workflow engine reports its instance id and migrate resolves the subject.
func (s *Store) GetApprovalBindingByInstance(ctx context.Context, db DBTX, tenantID uuid.UUID, instanceID string) (*ApprovalBinding, error) {
	b, err := scanApprovalBinding(db.QueryRow(ctx, `SELECT `+approvalBindingColumns+`
FROM migrate_approval_binding
WHERE tenant_id = $1 AND workflow_instance_id = $2`, tenantID, instanceID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApprovalNotStarted
		}
		return nil, fmt.Errorf("migrate: get approval binding by instance: %w", err)
	}
	return b, nil
}

// LatestApprovalBinding returns the most recent binding for a subject regardless
// of status (for surfacing the approval history / current state to the UI).
func (s *Store) LatestApprovalBinding(ctx context.Context, db DBTX, tenantID uuid.UUID, subjectType ApprovalSubjectType, subjectID uuid.UUID) (*ApprovalBinding, error) {
	b, err := scanApprovalBinding(db.QueryRow(ctx, `SELECT `+approvalBindingColumns+`
FROM migrate_approval_binding
WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
ORDER BY created_at DESC LIMIT 1`, tenantID, subjectType, subjectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApprovalNotStarted
		}
		return nil, fmt.Errorf("migrate: latest approval binding: %w", err)
	}
	return b, nil
}

// CompleteApprovalBinding records the workflow's terminal decision on a pending
// binding, moving it to 'completed'. It is idempotent-safe: it only updates a row
// still in 'pending' status, returning ErrVersionConflict if another callback
// already completed it (so a duplicate/replayed callback does not double-drive the
// migrate FSM).
func (s *Store) CompleteApprovalBinding(ctx context.Context, db DBTX, tenantID, bindingID uuid.UUID, decision ApprovalDecisionOutcome, rationale string, decidedBy *uuid.UUID, at time.Time) (*ApprovalBinding, error) {
	b, err := scanApprovalBinding(db.QueryRow(ctx, `
UPDATE migrate_approval_binding
   SET status = 'completed',
       decision = $3,
       rationale = $4,
       decided_by = $5,
       decided_at = $6,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
RETURNING `+approvalBindingColumns, tenantID, bindingID, decision, rationale, decidedBy, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: complete approval binding: %w", err)
	}
	return b, nil
}

// FailApprovalBinding marks a pending binding as failed/cancelled (the workflow
// instance failed or was cancelled, so no approval can come from it). Frees the
// subject to have a new approval requested.
func (s *Store) FailApprovalBinding(ctx context.Context, db DBTX, tenantID, bindingID uuid.UUID, status ApprovalBindingStatus, rationale string, at time.Time) (*ApprovalBinding, error) {
	if status != ApprovalBindingFailed && status != ApprovalBindingCancelled {
		return nil, fmt.Errorf("invalid terminal binding status %q: %w", status, ErrValidation)
	}
	b, err := scanApprovalBinding(db.QueryRow(ctx, `
UPDATE migrate_approval_binding
   SET status = $3,
       rationale = $4,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
RETURNING `+approvalBindingColumns, tenantID, bindingID, status, rationale))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: fail approval binding: %w", err)
	}
	return b, nil
}
