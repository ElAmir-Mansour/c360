package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ContractComplianceReviewRepository persists the per-issue triage state for a
// contract's regulatory-compliance flags (CAP-109). It follows the lex
// repository style: tenant_id-first scoping, row_to_json projection on reads, and
// an idempotent upsert keyed on (tenant_id, contract_id, flag_ref) so the latest
// disposition for a flag replaces the prior one in place.
type ContractComplianceReviewRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractComplianceReviewRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractComplianceReviewRepository {
	return &ContractComplianceReviewRepository{db: db, logger: logger}
}

// Upsert writes (or replaces) the review row for a single flag. When the row
// transitions to resolved the caller supplies resolvedBy/resolvedAt; otherwise
// those are cleared. Returns the persisted row.
func (r *ContractComplianceReviewRepository) Upsert(ctx context.Context, q Queryer, review *model.ContractComplianceReview) (*model.ContractComplianceReview, error) {
	query := `
		INSERT INTO contract_compliance_reviews (
			id, tenant_id, contract_id, flag_ref, status, note, resolved_by, resolved_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (tenant_id, contract_id, flag_ref) DO UPDATE
		SET status = EXCLUDED.status,
		    note = EXCLUDED.note,
		    resolved_by = EXCLUDED.resolved_by,
		    resolved_at = EXCLUDED.resolved_at,
		    updated_at = now()
		RETURNING id, created_at, updated_at`
	err := q.QueryRow(ctx, query,
		review.ID, review.TenantID, review.ContractID, review.FlagRef,
		review.Status, review.Note, review.ResolvedBy, review.ResolvedAt,
	).Scan(&review.ID, &review.CreatedAt, &review.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return review, nil
}

// Get fetches a single review row by id, tenant-scoped.
func (r *ContractComplianceReviewRepository) Get(ctx context.Context, tenantID, contractID, id uuid.UUID) (*model.ContractComplianceReview, error) {
	query := complianceReviewJSONSelect(`cr.tenant_id = $1 AND cr.contract_id = $2 AND cr.id = $3`)
	return queryRowJSON[model.ContractComplianceReview](ctx, r.db, query, tenantID, contractID, id)
}

// ListByContract returns every review row for a contract, tenant-scoped.
func (r *ContractComplianceReviewRepository) ListByContract(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractComplianceReview, error) {
	query := complianceReviewJSONSelectWithSuffix(
		`cr.tenant_id = $1 AND cr.contract_id = $2`,
		` ORDER BY cr.updated_at DESC`,
	)
	return queryListJSON[model.ContractComplianceReview](ctx, r.db, query, tenantID, contractID)
}

// Update patches an existing review row in place (status/note/resolution). Used
// by the PUT path. Returns pgx.ErrNoRows when no row matches.
func (r *ContractComplianceReviewRepository) Update(ctx context.Context, q Queryer, review *model.ContractComplianceReview) error {
	ct, err := q.Exec(ctx, `
		UPDATE contract_compliance_reviews
		SET status = $4,
		    note = $5,
		    resolved_by = $6,
		    resolved_at = $7,
		    updated_at = now()
		WHERE tenant_id = $1 AND contract_id = $2 AND id = $3`,
		review.TenantID, review.ContractID, review.ID,
		review.Status, review.Note, review.ResolvedBy, review.ResolvedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func complianceReviewJSONSelect(where string) string {
	return complianceReviewJSONSelectWithSuffix(where, "")
}

func complianceReviewJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cr.id, cr.tenant_id, cr.contract_id, cr.flag_ref,
			       cr.status, cr.note, cr.resolved_by, cr.resolved_at,
			       cr.created_at, cr.updated_at
			FROM contract_compliance_reviews cr
			WHERE ` + where + suffix + `
		) t`
}
