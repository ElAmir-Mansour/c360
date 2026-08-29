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

// ContractIntakeRepository persists the singleton-per-contract review-desk intake
// record (CAP-100..105): the desk reference number + receipt/route/return state
// machine + last completeness snapshot. Reads lead with tenant_id (primary
// predicate) and table RLS as a backstop; writes accept a Queryer so transitions
// commit atomically with the contract-bound audit/version writes.
type ContractIntakeRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractIntakeRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractIntakeRepository {
	return &ContractIntakeRepository{db: db, logger: logger}
}

func (r *ContractIntakeRepository) Create(ctx context.Context, q Queryer, in *model.ContractIntake) error {
	metaJSON, err := json.Marshal(orEmptyMap(in.Metadata))
	if err != nil {
		return fmt.Errorf("marshal contract intake metadata: %w", err)
	}
	query := `
		INSERT INTO lex_contract_intakes (
			id, tenant_id, contract_id, reference_number, status, received_at,
			acknowledged_at, acknowledged_by, routed_to_legal_at, routed_to_legal_by,
			assigned_reviewer_id, assigned_reviewer_name, completeness_checked,
			completeness_passed, last_checked_at, returned_at, returned_by,
			return_reason, deficiency_notice, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,
			$11,$12,$13,
			$14,$15,$16,$17,
			$18,$19,$20::jsonb,$21
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		in.ID, in.TenantID, in.ContractID, in.ReferenceNumber, in.Status, in.ReceivedAt,
		in.AcknowledgedAt, in.AcknowledgedBy, in.RoutedToLegalAt, in.RoutedToLegalBy,
		in.AssignedReviewerID, in.AssignedReviewerName, in.CompletenessChecked,
		in.CompletenessPassed, in.LastCheckedAt, in.ReturnedAt, in.ReturnedBy,
		in.ReturnReason, in.DeficiencyNotice, metaJSON, in.CreatedBy,
	).Scan(&in.CreatedAt, &in.UpdatedAt)
}

func (r *ContractIntakeRepository) GetByContract(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ContractIntake, error) {
	query := contractIntakeJSONSelect(`ci.tenant_id = $1 AND ci.contract_id = $2`)
	return queryRowJSON[model.ContractIntake](ctx, r.db, query, tenantID, contractID)
}

func (r *ContractIntakeRepository) Update(ctx context.Context, q Queryer, in *model.ContractIntake) error {
	metaJSON, err := json.Marshal(orEmptyMap(in.Metadata))
	if err != nil {
		return fmt.Errorf("marshal contract intake metadata: %w", err)
	}
	query := `
		UPDATE lex_contract_intakes
		SET status = $3,
		    acknowledged_at = $4,
		    acknowledged_by = $5,
		    routed_to_legal_at = $6,
		    routed_to_legal_by = $7,
		    assigned_reviewer_id = $8,
		    assigned_reviewer_name = $9,
		    completeness_checked = $10,
		    completeness_passed = $11,
		    last_checked_at = $12,
		    returned_at = $13,
		    returned_by = $14,
		    return_reason = $15,
		    deficiency_notice = $16,
		    metadata = $17::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND contract_id = $2
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		in.TenantID, in.ContractID, in.Status, in.AcknowledgedAt, in.AcknowledgedBy,
		in.RoutedToLegalAt, in.RoutedToLegalBy, in.AssignedReviewerID, in.AssignedReviewerName,
		in.CompletenessChecked, in.CompletenessPassed, in.LastCheckedAt, in.ReturnedAt,
		in.ReturnedBy, in.ReturnReason, in.DeficiencyNotice, metaJSON,
	).Scan(&in.UpdatedAt)
}

// NextReferenceSequence returns the next monotonic per-tenant per-year sequence
// for the desk reference number (CAP-100), computed from the existing rows so the
// service can format e.g. CRD-2026-000123 without a dedicated sequence object.
func (r *ContractIntakeRepository) NextReferenceSequence(ctx context.Context, q Queryer, tenantID uuid.UUID, year int) (int, error) {
	prefix := fmt.Sprintf("CRD-%d-", year)
	var maxSeq int
	err := q.QueryRow(ctx, `
		SELECT COALESCE(MAX(NULLIF(regexp_replace(reference_number, '^CRD-[0-9]+-', ''), '')::int), 0)
		FROM lex_contract_intakes
		WHERE tenant_id = $1 AND reference_number LIKE $2`,
		tenantID, prefix+"%",
	).Scan(&maxSeq)
	if err != nil {
		return 0, err
	}
	return maxSeq + 1, nil
}

func contractIntakeJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ci.id, ci.tenant_id, ci.contract_id, ci.reference_number, ci.status,
			       ci.received_at, ci.acknowledged_at, ci.acknowledged_by,
			       ci.routed_to_legal_at, ci.routed_to_legal_by, ci.assigned_reviewer_id,
			       ci.assigned_reviewer_name, ci.completeness_checked, ci.completeness_passed,
			       ci.last_checked_at, ci.returned_at, ci.returned_by, ci.return_reason,
			       ci.deficiency_notice, COALESCE(ci.metadata, '{}'::jsonb) AS metadata,
			       ci.created_by, ci.created_at, ci.updated_at
			FROM lex_contract_intakes ci
			WHERE ` + where + `
		) t`
}
