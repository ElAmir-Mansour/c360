package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ContractCorrespondenceRepository persists the append-only review-desk
// correspondence thread (CAP-113..116). The table is INSERT-only at the policy
// level (no UPDATE/DELETE policy) so the thread is an immutable audit. Reads lead
// with tenant_id (primary predicate); the insert accepts a Queryer so an
// auto-return note commits atomically with the desk-status transition.
type ContractCorrespondenceRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractCorrespondenceRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractCorrespondenceRepository {
	return &ContractCorrespondenceRepository{db: db, logger: logger}
}

func (r *ContractCorrespondenceRepository) Create(ctx context.Context, q Queryer, c *model.ContractCorrespondence) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal contract correspondence metadata: %w", err)
	}
	query := `
		INSERT INTO lex_contract_correspondence (
			id, tenant_id, contract_id, intake_id, kind, direction, subject, body,
			author_name, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10::jsonb,$11
		)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.ContractID, c.IntakeID, c.Kind, c.Direction, c.Subject, c.Body,
		c.AuthorName, metaJSON, c.CreatedBy,
	).Scan(&c.CreatedAt)
}

func (r *ContractCorrespondenceRepository) ListByContract(ctx context.Context, tenantID, contractID uuid.UUID, filters model.ContractCorrespondenceListFilters) ([]model.ContractCorrespondence, int, error) {
	args := []any{tenantID, contractID}
	arg := 3
	conditions := []string{"c.tenant_id = $1", "c.contract_id = $2"}
	if filters.Kind != nil {
		conditions = append(conditions, fmt.Sprintf("c.kind = $%d", arg))
		args = append(args, *filters.Kind)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM lex_contract_correspondence c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ContractCorrespondence{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := contractCorrespondenceJSONSelect(where) + fmt.Sprintf(" ORDER BY t.created_at DESC LIMIT $%d OFFSET $%d", limitIdx, offsetIdx)
	items, err := queryListJSON[model.ContractCorrespondence](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func contractCorrespondenceJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.contract_id, c.intake_id, c.kind, c.direction,
			       c.subject, c.body, c.author_name,
			       COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at
			FROM lex_contract_correspondence c
			WHERE ` + where + `
		) t`
}
