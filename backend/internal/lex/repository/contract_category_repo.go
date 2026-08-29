package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ContractCategoryRepository reads a tenant's manual contract-category catalog
// (migration 000076). It follows the lex JSON-projection read style
// (queryListJSON, tenant_id-first scoping, soft-delete filter) used by the other
// lex repos. The catalog is read-mostly here: the CAP-123 surface lists it and
// resolves which requested slugs are valid; catalog rows are seeded per-tenant.
type ContractCategoryRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractCategoryRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractCategoryRepository {
	return &ContractCategoryRepository{db: db, logger: logger}
}

// ListByTenant returns the tenant's active category catalog ordered by
// sort_order then name (matching idx_contract_categories_tenant).
func (r *ContractCategoryRepository) ListByTenant(ctx context.Context, tenantID uuid.UUID) ([]model.ContractCategory, error) {
	query := contractCategoryJSONSelectWithSuffix(
		`cc.tenant_id = $1 AND cc.deleted_at IS NULL`,
		` ORDER BY cc.sort_order ASC, cc.name ASC`,
	)
	return queryListJSON[model.ContractCategory](ctx, r.db, query, tenantID)
}

func contractCategoryJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cc.id, cc.tenant_id, cc.name, cc.slug, cc.sort_order,
			       cc.created_at, cc.updated_at, cc.deleted_at
			FROM contract_categories cc
			WHERE ` + where + suffix + `
		) t`
}
