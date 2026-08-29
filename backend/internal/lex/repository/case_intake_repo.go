package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// CaseIntakeRepository persists the singleton-per-case intake tracking record
// (CAP-032..036): the two-phase directive/handoff state machine summary. Queries
// filter by tenant_id (primary predicate) with table RLS as a backstop. Accepts a
// Queryer on writes so intake transitions commit atomically with the case-row and
// audit/version writes the service performs.
type CaseIntakeRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseIntakeRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseIntakeRepository {
	return &CaseIntakeRepository{db: db, logger: logger}
}

func (r *CaseIntakeRepository) Create(ctx context.Context, q Queryer, in *model.CaseIntake) error {
	metaJSON, err := json.Marshal(orEmptyMap(in.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case intake metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_intakes (
			id, tenant_id, case_id, phase, phase1_started_at, phase1_completed_at,
			phase2_started_at, phase2_completed_at, ceo_directive_ref, doa_authority_ref,
			strength_assessment, task_estimate, workflow_instance_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,
			$11,$12,$13,$14::jsonb,$15
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		in.ID, in.TenantID, in.CaseID, in.Phase, in.Phase1StartedAt, in.Phase1CompletedAt,
		in.Phase2StartedAt, in.Phase2CompletedAt, in.CEODirectiveRef, in.DoAAuthorityRef,
		in.StrengthAssessment, in.TaskEstimate, in.WorkflowInstanceID, metaJSON, in.CreatedBy,
	).Scan(&in.CreatedAt, &in.UpdatedAt)
}

func (r *CaseIntakeRepository) GetByCase(ctx context.Context, tenantID, caseID uuid.UUID) (*model.CaseIntake, error) {
	query := caseIntakeJSONSelect(`ci.tenant_id = $1 AND ci.case_id = $2`)
	return queryRowJSON[model.CaseIntake](ctx, r.db, query, tenantID, caseID)
}

// Update rewrites the mutable intake state. Accepts a Queryer so the transition
// joins the same transaction as the case-row + workflow writes.
func (r *CaseIntakeRepository) Update(ctx context.Context, q Queryer, in *model.CaseIntake) error {
	metaJSON, err := json.Marshal(orEmptyMap(in.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case intake metadata: %w", err)
	}
	query := `
		UPDATE legal_case_intakes
		SET phase = $3,
		    phase1_started_at = $4,
		    phase1_completed_at = $5,
		    phase2_started_at = $6,
		    phase2_completed_at = $7,
		    ceo_directive_ref = $8,
		    doa_authority_ref = $9,
		    strength_assessment = $10,
		    task_estimate = $11,
		    workflow_instance_id = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		in.TenantID, in.CaseID, in.Phase, in.Phase1StartedAt, in.Phase1CompletedAt,
		in.Phase2StartedAt, in.Phase2CompletedAt, in.CEODirectiveRef, in.DoAAuthorityRef,
		in.StrengthAssessment, in.TaskEstimate, in.WorkflowInstanceID, metaJSON,
	).Scan(&in.UpdatedAt)
}

func caseIntakeJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ci.id, ci.tenant_id, ci.case_id, ci.phase, ci.phase1_started_at,
			       ci.phase1_completed_at, ci.phase2_started_at, ci.phase2_completed_at,
			       ci.ceo_directive_ref, ci.doa_authority_ref, ci.strength_assessment,
			       ci.task_estimate, ci.workflow_instance_id,
			       COALESCE(ci.metadata, '{}'::jsonb) AS metadata,
			       ci.created_by, ci.created_at, ci.updated_at
			FROM legal_case_intakes ci
			WHERE ` + where + `
		) t`
}
