package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ContractClauseAmendmentRepository persists proposed clause amendments
// (CAP-111). It mirrors MatterCommentRepository: tenant_id-first scoping, JSON
// row projection for reads, and a Queryer-driven write path so callers may run
// inside a transaction. Rows are immutable except for the decision transition
// (status + decided_by + decided_at).
type ContractClauseAmendmentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractClauseAmendmentRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractClauseAmendmentRepository {
	return &ContractClauseAmendmentRepository{db: db, logger: logger}
}

func (r *ContractClauseAmendmentRepository) Create(ctx context.Context, q Queryer, a *model.ContractClauseAmendment) error {
	query := `
		INSERT INTO contract_clause_amendments (
			id, tenant_id, clause_id, contract_id, original_text, proposed_text, reason, status, proposed_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		a.ID, a.TenantID, a.ClauseID, a.ContractID, a.OriginalText, a.ProposedText, a.Reason, a.Status, a.ProposedBy,
	).Scan(&a.CreatedAt)
}

func (r *ContractClauseAmendmentRepository) Get(ctx context.Context, tenantID, contractID, clauseID, id uuid.UUID) (*model.ContractClauseAmendment, error) {
	query := amendmentJSONSelect(`a.tenant_id = $1 AND a.contract_id = $2 AND a.clause_id = $3 AND a.id = $4`)
	return queryRowJSON[model.ContractClauseAmendment](ctx, r.db, query, tenantID, contractID, clauseID, id)
}

func (r *ContractClauseAmendmentRepository) ListByClause(ctx context.Context, tenantID, contractID, clauseID uuid.UUID) ([]model.ContractClauseAmendment, error) {
	query := amendmentJSONSelectWithSuffix(
		`a.tenant_id = $1 AND a.contract_id = $2 AND a.clause_id = $3`,
		` ORDER BY a.created_at DESC`,
	)
	return queryListJSON[model.ContractClauseAmendment](ctx, r.db, query, tenantID, contractID, clauseID)
}

// Decide stamps the accept/reject transition. It only advances rows still in the
// `proposed` state, so a concurrent second decision affects zero rows
// (pgx.ErrNoRows) rather than re-deciding an already-decided amendment.
func (r *ContractClauseAmendmentRepository) Decide(ctx context.Context, q Queryer, tenantID, contractID, clauseID, id, decidedBy uuid.UUID, status model.ClauseAmendmentStatus) error {
	ct, err := q.Exec(ctx, `
		UPDATE contract_clause_amendments
		SET status = $5,
		    decided_by = $6,
		    decided_at = now()
		WHERE tenant_id = $1 AND contract_id = $2 AND clause_id = $3 AND id = $4
		  AND status = 'proposed'`,
		tenantID, contractID, clauseID, id, status, decidedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func amendmentJSONSelect(where string) string {
	return amendmentJSONSelectWithSuffix(where, "")
}

func amendmentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.clause_id, a.contract_id,
			       a.original_text, a.proposed_text, a.reason, a.status,
			       a.proposed_by, a.decided_by, a.decided_at, a.created_at
			FROM contract_clause_amendments a
			WHERE ` + where + suffix + `
		) t`
}
