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

// ContractRecommendationRepository persists final review-desk recommendations
// (CAP-118..120). A superseding recommendation marks prior rows superseded rather
// than mutating them, preserving the decision trail. Reads lead with tenant_id
// (primary predicate); writes accept a Queryer so a recommendation commits
// atomically with the desk-status transition + any workflow handoff bookkeeping.
type ContractRecommendationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractRecommendationRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractRecommendationRepository {
	return &ContractRecommendationRepository{db: db, logger: logger}
}

func (r *ContractRecommendationRepository) Create(ctx context.Context, q Queryer, rec *model.ContractRecommendation) error {
	metaJSON, err := json.Marshal(orEmptyMap(rec.Metadata))
	if err != nil {
		return fmt.Errorf("marshal contract recommendation metadata: %w", err)
	}
	query := `
		INSERT INTO lex_contract_recommendations (
			id, tenant_id, contract_id, intake_id, outcome, summary, amendment_reason,
			rejection_reason, workflow_instance_id, superseded, recommended_by_name,
			metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,
			$12::jsonb,$13
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		rec.ID, rec.TenantID, rec.ContractID, rec.IntakeID, rec.Outcome, rec.Summary, rec.AmendmentReason,
		rec.RejectionReason, rec.WorkflowInstanceID, rec.Superseded, rec.RecommendedByName,
		metaJSON, rec.CreatedBy,
	).Scan(&rec.CreatedAt, &rec.UpdatedAt)
}

// SupersedeActive marks every live recommendation for the contract superseded so
// a new final recommendation becomes the active one (CAP-118).
func (r *ContractRecommendationRepository) SupersedeActive(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_contract_recommendations
		SET superseded = true, updated_at = now()
		WHERE tenant_id = $1 AND contract_id = $2 AND superseded = false`,
		tenantID, contractID,
	)
	return err
}

// SetWorkflowInstance records the contract-review workflow instance started for
// an approved recommendation (CAP-120).
func (r *ContractRecommendationRepository) SetWorkflowInstance(ctx context.Context, q Queryer, tenantID, id, workflowInstanceID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_contract_recommendations
		SET workflow_instance_id = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, workflowInstanceID,
	)
	return err
}

func (r *ContractRecommendationRepository) GetActive(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ContractRecommendation, error) {
	query := contractRecommendationJSONSelect(`rc.tenant_id = $1 AND rc.contract_id = $2 AND rc.superseded = false`) +
		` ORDER BY t.created_at DESC LIMIT 1`
	return queryRowJSON[model.ContractRecommendation](ctx, r.db, query, tenantID, contractID)
}

func (r *ContractRecommendationRepository) ListByContract(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractRecommendation, error) {
	query := contractRecommendationJSONSelect(`rc.tenant_id = $1 AND rc.contract_id = $2`) +
		` ORDER BY t.created_at DESC`
	return queryListJSON[model.ContractRecommendation](ctx, r.db, query, tenantID, contractID)
}

func contractRecommendationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT rc.id, rc.tenant_id, rc.contract_id, rc.intake_id, rc.outcome,
			       rc.summary, rc.amendment_reason, rc.rejection_reason,
			       rc.workflow_instance_id, rc.superseded, rc.recommended_by_name,
			       COALESCE(rc.metadata, '{}'::jsonb) AS metadata,
			       rc.created_by, rc.created_at, rc.updated_at
			FROM lex_contract_recommendations rc
			WHERE ` + where + `
		) t`
}
