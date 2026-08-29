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

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

type LegalCourtRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalCourtRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalCourtRepository {
	return &LegalCourtRepository{db: db, logger: logger}
}

// Create inserts one tenant-owned court. Rows only ever arrive this way: the
// migration that created `legal_courts` deliberately seeded nothing because the
// customer-supplied court list was empty.
func (r *LegalCourtRepository) Create(ctx context.Context, c *model.LegalCourt) error {
	nameJSON, err := json.Marshal(c.Name)
	if err != nil {
		return fmt.Errorf("marshal legal court name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal court metadata: %w", err)
	}
	query := `
		INSERT INTO legal_courts (
			id, tenant_id, code, name, active, is_system, sort, metadata, created_by
		) VALUES (
			$1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9
		)
		RETURNING created_at, updated_at`
	return r.db.QueryRow(ctx, query,
		c.ID, c.TenantID, c.Code, nameJSON, c.Active, c.IsSystem, c.Sort, metadataJSON, c.CreatedBy,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *LegalCourtRepository) Update(ctx context.Context, c *model.LegalCourt) error {
	nameJSON, err := json.Marshal(c.Name)
	if err != nil {
		return fmt.Errorf("marshal legal court name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal legal court metadata: %w", err)
	}
	query := `
		UPDATE legal_courts
		SET code = $3,
		    name = $4::jsonb,
		    active = $5,
		    sort = $6,
		    metadata = $7::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return r.db.QueryRow(ctx, query,
		c.TenantID, c.ID, c.Code, nameJSON, c.Active, c.Sort, metadataJSON,
	).Scan(&c.UpdatedAt)
}

// SoftDelete tombstones a court. The partial unique index on (tenant_id, code)
// ignores deleted rows, so the code becomes reusable afterwards.
func (r *LegalCourtRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_courts SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CountCasesUsing reports how many live cases point at the court. The FK is
// ON DELETE RESTRICT, so a delete would fail at the database anyway; counting
// first lets the service answer with a useful 409 instead of a 500.
func (r *LegalCourtRepository) CountCasesUsing(ctx context.Context, tenantID, id uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM legal_cases
		WHERE tenant_id = $1 AND court_id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	).Scan(&count)
	return count, err
}

// LegacyCourtValues returns the distinct free-text `competent_court` strings still
// carried by cases that were never linked to a reference row, newest-heaviest
// first. Nothing is auto-mapped or discarded — this is purely so an administrator
// can see which historical spellings exist and reconcile them deliberately.
func (r *LegalCourtRepository) LegacyCourtValues(ctx context.Context, tenantID uuid.UUID, limit int) ([]dto.LegalCourtLegacyValue, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT btrim(competent_court) AS value, COUNT(*) AS cases
		FROM legal_cases
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND court_id IS NULL
		  AND competent_court IS NOT NULL
		  AND length(btrim(competent_court)) > 0
		GROUP BY btrim(competent_court)
		ORDER BY cases DESC, value ASC
		LIMIT $2`,
		tenantID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]dto.LegalCourtLegacyValue, 0)
	for rows.Next() {
		var item dto.LegalCourtLegacyValue
		if err := rows.Scan(&item.Value, &item.Cases); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *LegalCourtRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalCourt, error) {
	return queryRowJSON[model.LegalCourt](ctx, r.db, legalCourtJSONSelect(`c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`), tenantID, id)
}

func (r *LegalCourtRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalCourtListFilters) ([]model.LegalCourt, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if search := strings.TrimSpace(filters.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf(`(c.code ILIKE '%%' || $%[1]d || '%%' OR c.name->>'en' ILIKE '%%' || $%[1]d || '%%' OR c.name->>'ar' ILIKE '%%' || $%[1]d || '%%')`, arg))
		args = append(args, search)
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("c.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_courts c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalCourt{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx, offsetIdx := arg, arg+1
	args = append(args, perPage, (page-1)*perPage)
	orderColumn := "t.sort"
	switch filters.SortColumn {
	case "code":
		orderColumn = "t.code"
	case "name":
		orderColumn = "t.name"
	case "updated_at":
		orderColumn = "t.updated_at"
	}
	direction := "ASC"
	if filters.SortDirection == "desc" {
		direction = "DESC"
	}
	query := legalCourtJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s, t.code ASC LIMIT $%d OFFSET $%d", orderColumn, direction, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalCourt](ctx, r.db, query, args...)
	return items, total, err
}

func legalCourtJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.code, c.name, c.active, c.is_system,
			       c.sort, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at, c.deleted_at
			FROM legal_courts c
			WHERE ` + where + `
		) t`
}
