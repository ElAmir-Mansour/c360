package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// PlaybookRepository persists clause playbooks (WTQ-RSK-02): CRUD plus the
// lookup of the active playbook applicable to a contract type.
type PlaybookRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewPlaybookRepository(db *pgxpool.Pool, logger zerolog.Logger) *PlaybookRepository {
	return &PlaybookRepository{db: db, logger: logger}
}

const playbookColumns = `id, tenant_id, name, description, contract_type, status, clauses, metadata,
	created_by, updated_by, created_at, updated_at`

func (r *PlaybookRepository) Create(ctx context.Context, q Queryer, playbook *model.ClausePlaybook) error {
	clausesJSON, err := json.Marshal(playbook.Clauses)
	if err != nil {
		return fmt.Errorf("marshal playbook clauses: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(playbook.Metadata))
	if err != nil {
		return fmt.Errorf("marshal playbook metadata: %w", err)
	}
	row := q.QueryRow(ctx, `
		INSERT INTO lex_clause_playbooks (
			id, tenant_id, name, description, contract_type, status, clauses, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
		RETURNING `+playbookColumns,
		playbook.ID, playbook.TenantID, playbook.Name, playbook.Description, playbook.ContractType,
		playbook.Status, clausesJSON, metadataJSON, playbook.CreatedBy,
	)
	created, err := scanPlaybook(row)
	if err != nil {
		return err
	}
	*playbook = *created
	return nil
}

func (r *PlaybookRepository) Update(ctx context.Context, q Queryer, playbook *model.ClausePlaybook, updatedBy uuid.UUID) error {
	clausesJSON, err := json.Marshal(playbook.Clauses)
	if err != nil {
		return fmt.Errorf("marshal playbook clauses: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(playbook.Metadata))
	if err != nil {
		return fmt.Errorf("marshal playbook metadata: %w", err)
	}
	row := q.QueryRow(ctx, `
		UPDATE lex_clause_playbooks
		SET name = $3,
		    description = $4,
		    contract_type = $5,
		    status = $6,
		    clauses = $7::jsonb,
		    metadata = $8::jsonb,
		    updated_by = $9,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING `+playbookColumns,
		playbook.TenantID, playbook.ID, playbook.Name, playbook.Description, playbook.ContractType,
		playbook.Status, clausesJSON, metadataJSON, updatedBy,
	)
	updated, err := scanPlaybook(row)
	if err != nil {
		return err
	}
	*playbook = *updated
	return nil
}

func (r *PlaybookRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ClausePlaybook, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+playbookColumns+`
		FROM lex_clause_playbooks
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	return scanPlaybook(row)
}

// PlaybookSortColumns is the allowlist mapping FE sort keys to safe SQL column
// expressions for the playbook list (WTQ-RSK-02 #1). Exposed so the handler and
// repository share one source of truth.
var PlaybookSortColumns = map[string]string{
	"name":          "name",
	"contract_type": "contract_type",
	"status":        "status",
	"updated_at":    "updated_at",
	"created_at":    "created_at",
}

func (r *PlaybookRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.PlaybookListFilters) ([]model.ClausePlaybook, int, error) {
	page := filters.Page
	if page < 1 {
		page = 1
	}
	perPage := filters.PerPage
	if perPage < 1 {
		perPage = 50
	}
	if perPage > 200 {
		perPage = 200
	}

	args := []any{tenantID}
	arg := 2
	conditions := []string{"tenant_id = $1", "deleted_at IS NULL"}
	if search := strings.TrimSpace(filters.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf("(name ILIKE '%%' || $%d || '%%' OR description ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, search)
		arg++
	}
	if filters.ContractType != nil {
		conditions = append(conditions, fmt.Sprintf("contract_type = $%d", arg))
		args = append(args, string(*filters.ContractType))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("status = $%d", arg))
		args = append(args, string(*filters.Status))
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM lex_clause_playbooks WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ClausePlaybook{}, 0, nil
	}

	// Resolve a safe ORDER BY from the allowlist. Defaults preserve the prior
	// stable ordering when no sort is requested.
	orderCol := "contract_type"
	orderDir := "ASC"
	tieBreak := ", updated_at DESC"
	if filters.SortColumn != "" {
		if _, ok := allowedPlaybookSortValue(filters.SortColumn); ok {
			orderCol = filters.SortColumn
			tieBreak = ", id ASC"
		}
	}
	if strings.EqualFold(filters.SortDirection, "asc") {
		orderDir = "ASC"
	} else if strings.EqualFold(filters.SortDirection, "desc") {
		orderDir = "DESC"
	}

	args = append(args, perPage, (page-1)*perPage)
	query := fmt.Sprintf(`
		SELECT %s
		FROM lex_clause_playbooks
		WHERE %s
		ORDER BY %s %s%s
		LIMIT $%d OFFSET $%d`,
		playbookColumns, where, orderCol, orderDir, tieBreak, arg, arg+1)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]model.ClausePlaybook, 0)
	for rows.Next() {
		item, err := scanPlaybook(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	return items, total, rows.Err()
}

// allowedPlaybookSortValue reports whether col is one of the allowlisted SQL
// column expressions for playbook ordering. Guards against SQL injection: only a
// value already present in PlaybookSortColumns is ever interpolated.
func allowedPlaybookSortValue(col string) (string, bool) {
	for _, v := range PlaybookSortColumns {
		if v == col {
			return v, true
		}
	}
	return "", false
}

// GetActiveByContractType returns the single active playbook applicable to the
// contract type, or pgx.ErrNoRows when none is configured.
func (r *PlaybookRepository) GetActiveByContractType(ctx context.Context, tenantID uuid.UUID, contractType model.ContractType) (*model.ClausePlaybook, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+playbookColumns+`
		FROM lex_clause_playbooks
		WHERE tenant_id = $1
		  AND contract_type = $2
		  AND status = 'active'
		  AND deleted_at IS NULL
		ORDER BY updated_at DESC
		LIMIT 1`,
		tenantID, contractType,
	)
	return scanPlaybook(row)
}

func (r *PlaybookRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE lex_clause_playbooks SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// LockStatus locks a playbook row FOR UPDATE inside tx and returns its current
// status. Used by the approval orchestrator subject spec (WTQ-RSK-02 #9).
func (r *PlaybookRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM lex_clause_playbooks
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// SetStatusTx updates a playbook's status (and stamps updated_by/updated_at) inside
// a transaction. Used by the approval advance hook to flip draft → active on
// approve. pgx.ErrNoRows when the row is absent.
func (r *PlaybookRepository) SetStatusTx(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID, status model.PlaybookStatus, updatedBy uuid.UUID) error {
	ct, err := tx.Exec(ctx, `
		UPDATE lex_clause_playbooks
		SET status = $3, updated_by = $4, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, string(status), updatedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ArchiveActiveOfTypeTx archives (status='archived') any currently-active playbook
// of the given contract type, EXCEPT the playbook identified by excludeID, inside a
// transaction. It is used when a draft is approved to active so the one-active-per
// -type invariant (idx_lex_clause_playbooks_active_type) is preserved by superseding
// the prior active. Returns the number of rows superseded.
func (r *PlaybookRepository) ArchiveActiveOfTypeTx(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, contractType model.ContractType, excludeID uuid.UUID, updatedBy uuid.UUID) (int, error) {
	ct, err := tx.Exec(ctx, `
		UPDATE lex_clause_playbooks
		SET status = 'archived', updated_by = $4, updated_at = now()
		WHERE tenant_id = $1
		  AND contract_type = $2
		  AND status = 'active'
		  AND id <> $3
		  AND deleted_at IS NULL`,
		tenantID, string(contractType), excludeID, updatedBy,
	)
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}

// GetTx loads a playbook by id within a transaction (no row lock). Used by the
// approval advance hook to read the contract type before flipping status.
func (r *PlaybookRepository) GetTx(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (*model.ClausePlaybook, error) {
	row := tx.QueryRow(ctx, `
		SELECT `+playbookColumns+`
		FROM lex_clause_playbooks
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	return scanPlaybook(row)
}

const deviationReviewColumns = `id, tenant_id, contract_id, clause_type, status, note,
	reviewed_by, reviewed_at, created_at, updated_at`

// ListDeviationReviews returns the triage review rows for a contract (WTQ-RSK-02 #3).
func (r *PlaybookRepository) ListDeviationReviews(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractClauseDeviationReview, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+deviationReviewColumns+`
		FROM contract_clause_deviation_reviews
		WHERE tenant_id = $1 AND contract_id = $2
		ORDER BY clause_type ASC`,
		tenantID, contractID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.ContractClauseDeviationReview, 0)
	for rows.Next() {
		item, err := scanDeviationReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}

// UpsertDeviationReview inserts or updates (in place) the triage disposition for a
// (tenant, contract, clause_type) deviation and returns the resulting row.
func (r *PlaybookRepository) UpsertDeviationReview(ctx context.Context, review *model.ContractClauseDeviationReview) (*model.ContractClauseDeviationReview, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO contract_clause_deviation_reviews (
			tenant_id, contract_id, clause_type, status, note, reviewed_by, reviewed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (tenant_id, contract_id, clause_type)
		DO UPDATE SET
			status = EXCLUDED.status,
			note = EXCLUDED.note,
			reviewed_by = EXCLUDED.reviewed_by,
			reviewed_at = EXCLUDED.reviewed_at,
			updated_at = now()
		RETURNING `+deviationReviewColumns,
		review.TenantID, review.ContractID, string(review.ClauseType), string(review.Status),
		review.Note, review.ReviewedBy, review.ReviewedAt,
	)
	return scanDeviationReview(row)
}

func scanDeviationReview(row pgx.Row) (*model.ContractClauseDeviationReview, error) {
	var item model.ContractClauseDeviationReview
	var clauseType, status string
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.ContractID, &clauseType, &status, &item.Note,
		&item.ReviewedBy, &item.ReviewedAt, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.ClauseType = model.ClauseType(clauseType)
	item.Status = model.DeviationReviewStatus(status)
	return &item, nil
}

func scanPlaybook(row pgx.Row) (*model.ClausePlaybook, error) {
	var item model.ClausePlaybook
	var contractType, status string
	var clausesJSON, metadataJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.Name, &item.Description, &contractType, &status,
		&clausesJSON, &metadataJSON, &item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.ContractType = model.ContractType(contractType)
	item.Status = model.PlaybookStatus(status)
	if len(clausesJSON) > 0 {
		if err := json.Unmarshal(clausesJSON, &item.Clauses); err != nil {
			return nil, fmt.Errorf("decode playbook clauses: %w", err)
		}
	}
	if item.Clauses == nil {
		item.Clauses = []model.PlaybookClause{}
	}
	item.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &item.Metadata); err != nil {
			return nil, fmt.Errorf("decode playbook metadata: %w", err)
		}
	}
	return &item, nil
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
