package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type LibraryRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLibraryRepository(db *pgxpool.Pool, logger zerolog.Logger) *LibraryRepository {
	return &LibraryRepository{db: db, logger: logger}
}

func (r *LibraryRepository) DB() *pgxpool.Pool {
	return r.db
}

func (r *LibraryRepository) CreateClause(ctx context.Context, q Queryer, item *model.ClauseLibraryItem) error {
	query := `
		INSERT INTO clause_library_items (
			id, tenant_id, code, title_en, title_ar, text_en, text_ar,
			clause_type, category, jurisdiction, source, source_url,
			version, status, governance_status, supersedes_id, deprecated_by_id,
			deprecated_at, tags, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,
			$13,$14,$15,$16,$17,
			$18,$19,$20,$21,$22
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		item.ID, item.TenantID, item.Code, item.TitleEN, item.TitleAR, item.TextEN, item.TextAR,
		item.ClauseType, item.Category, item.Jurisdiction, item.Source, item.SourceURL,
		item.Version, item.Status, item.GovernanceStatus, item.SupersedesID, item.DeprecatedByID,
		item.DeprecatedAt, item.Tags, item.Metadata, item.CreatedBy, item.UpdatedBy,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
}

func (r *LibraryRepository) GetClause(ctx context.Context, tenantID, id uuid.UUID) (*model.ClauseLibraryItem, error) {
	query := clauseLibraryJSONSelect(`c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`)
	return queryRowJSON[model.ClauseLibraryItem](ctx, r.db, query, tenantID, id)
}

func (r *LibraryRepository) ListClauses(ctx context.Context, tenantID uuid.UUID, filters model.ClauseLibraryListFilters) ([]model.ClauseLibraryItem, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if strings.TrimSpace(filters.Search) != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			to_tsvector('simple', coalesce(c.code,'') || ' ' || coalesce(c.title_en,'') || ' ' || coalesce(c.title_ar,'') || ' ' || coalesce(c.text_en,'') || ' ' || coalesce(c.text_ar,'')) @@ plainto_tsquery('simple', $%d)
			OR c.code ILIKE '%%' || $%d || '%%'
			OR c.title_en ILIKE '%%' || $%d || '%%'
			OR c.title_ar ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if strings.TrimSpace(filters.ClauseType) != "" {
		conditions = append(conditions, fmt.Sprintf("c.clause_type = $%d", arg))
		args = append(args, strings.TrimSpace(filters.ClauseType))
		arg++
	}
	if strings.TrimSpace(filters.Category) != "" {
		conditions = append(conditions, fmt.Sprintf("c.category = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Category))
		arg++
	}
	if strings.TrimSpace(filters.Jurisdiction) != "" {
		conditions = append(conditions, fmt.Sprintf("c.jurisdiction = $%d", arg))
		args = append(args, strings.ToUpper(strings.TrimSpace(filters.Jurisdiction)))
		arg++
	}
	if strings.TrimSpace(filters.Status) != "" {
		conditions = append(conditions, fmt.Sprintf("c.status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Status))
		arg++
	}
	if strings.TrimSpace(filters.GovernanceStatus) != "" {
		conditions = append(conditions, fmt.Sprintf("c.governance_status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.GovernanceStatus))
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM clause_library_items c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ClauseLibraryItem{}, 0, nil
	}

	page, perPage := normalizeLibraryPage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := clauseLibraryJSONSelect(where) + fmt.Sprintf(" ORDER BY t.updated_at DESC LIMIT $%d OFFSET $%d", limitIdx, offsetIdx)
	items, err := queryListJSON[model.ClauseLibraryItem](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *LibraryRepository) SearchClauseCandidates(ctx context.Context, tenantID uuid.UUID, filters model.ClauseLibrarySearchFilters) ([]model.ClauseLibrarySearchCandidate, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if useLibraryKeywordPredicate(filters.Query, filters.Semantic) {
		conditions = append(conditions, clauseLibrarySearchPredicate(arg, filters.Language))
		args = append(args, strings.TrimSpace(filters.Query))
		arg++
	}
	if strings.TrimSpace(filters.ClauseType) != "" {
		conditions = append(conditions, fmt.Sprintf("c.clause_type = $%d", arg))
		args = append(args, strings.TrimSpace(filters.ClauseType))
		arg++
	}
	if strings.TrimSpace(filters.Category) != "" {
		conditions = append(conditions, fmt.Sprintf("LOWER(c.category) = LOWER($%d)", arg))
		args = append(args, strings.TrimSpace(filters.Category))
		arg++
	}
	if strings.TrimSpace(filters.Jurisdiction) != "" {
		conditions = append(conditions, fmt.Sprintf("c.jurisdiction = $%d", arg))
		args = append(args, strings.ToUpper(strings.TrimSpace(filters.Jurisdiction)))
		arg++
	}
	if strings.TrimSpace(filters.Status) != "" {
		conditions = append(conditions, fmt.Sprintf("c.status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Status))
		arg++
	}
	if strings.TrimSpace(filters.GovernanceStatus) != "" {
		conditions = append(conditions, fmt.Sprintf("c.governance_status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.GovernanceStatus))
		arg++
	}
	if strings.TrimSpace(filters.RiskLevel) != "" {
		conditions = append(conditions, fmt.Sprintf("LOWER(%s) = LOWER($%d)", libraryRiskSQL("c"), arg))
		args = append(args, strings.TrimSpace(filters.RiskLevel))
		arg++
	}

	query := `
		WITH mapped_regulations AS (
			SELECT r.clause_id,
			       string_agg(DISTINCT concat_ws(' ',
			           g.code, g.title_en, g.title_ar, g.description_en, g.description_ar,
			           g.jurisdiction, g.authority, g.regulation_type,
			           array_to_string(g.tags, ' '), ` + libraryRiskSQL("g") + `,
			           r.reference_type, r.notes
			       ), ' ') AS regulation_text
			FROM regulation_clause_references r
			JOIN regulation_library_items g ON g.tenant_id = r.tenant_id
			 AND g.id = r.regulation_id
			 AND g.deleted_at IS NULL
			WHERE r.tenant_id = $1
			GROUP BY r.clause_id
		)
		SELECT jsonb_build_object(
			'item', to_jsonb(c),
			'regulation_text', COALESCE(m.regulation_text, '')
		)
		FROM clause_library_items c
		LEFT JOIN mapped_regulations m ON m.clause_id = c.id
		WHERE ` + strings.Join(conditions, " AND ") + `
		ORDER BY c.updated_at DESC, c.code ASC`
	return queryListJSON[model.ClauseLibrarySearchCandidate](ctx, r.db, query, args...)
}

func (r *LibraryRepository) UpdateClause(ctx context.Context, q Queryer, item *model.ClauseLibraryItem) error {
	query := `
		UPDATE clause_library_items
		SET code = $3,
		    title_en = $4,
		    title_ar = $5,
		    text_en = $6,
		    text_ar = $7,
		    clause_type = $8,
		    category = $9,
		    jurisdiction = $10,
		    source = $11,
		    source_url = $12,
		    version = $13,
		    status = $14,
		    governance_status = $15,
		    supersedes_id = $16,
		    deprecated_by_id = $17,
		    deprecated_at = $18,
		    tags = $19,
		    metadata = $20,
		    updated_by = $21,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		item.TenantID, item.ID, item.Code, item.TitleEN, item.TitleAR, item.TextEN, item.TextAR,
		item.ClauseType, item.Category, item.Jurisdiction, item.Source, item.SourceURL,
		item.Version, item.Status, item.GovernanceStatus, item.SupersedesID, item.DeprecatedByID,
		item.DeprecatedAt, item.Tags, item.Metadata, item.UpdatedBy,
	).Scan(&item.UpdatedAt)
}

func (r *LibraryRepository) SoftDeleteClause(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE clause_library_items SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LibraryRepository) CreateRegulation(ctx context.Context, q Queryer, item *model.RegulationLibraryItem) error {
	query := `
		INSERT INTO regulation_library_items (
			id, tenant_id, code, title_en, title_ar, description_en, description_ar,
			jurisdiction, authority, source, source_url, regulation_type, effective_date,
			version, status, tags, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,
			$14,$15,$16,$17,$18,$19
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		item.ID, item.TenantID, item.Code, item.TitleEN, item.TitleAR, item.DescriptionEN, item.DescriptionAR,
		item.Jurisdiction, item.Authority, item.Source, item.SourceURL, item.RegulationType, datePtr(item.EffectiveDate),
		item.Version, item.Status, item.Tags, item.Metadata, item.CreatedBy, item.UpdatedBy,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
}

func (r *LibraryRepository) GetRegulation(ctx context.Context, tenantID, id uuid.UUID) (*model.RegulationLibraryItem, error) {
	query := regulationLibraryJSONSelect(`g.tenant_id = $1 AND g.id = $2 AND g.deleted_at IS NULL`)
	item, err := queryRowJSON[model.RegulationLibraryItem](ctx, r.db, query, tenantID, id)
	if err != nil {
		return nil, err
	}
	refs, err := r.ListRegulationClauseReferences(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	item.ClauseReferences = refs
	return item, nil
}

func (r *LibraryRepository) ListRegulations(ctx context.Context, tenantID uuid.UUID, filters model.RegulationLibraryListFilters) ([]model.RegulationLibraryItem, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"g.tenant_id = $1", "g.deleted_at IS NULL"}
	if strings.TrimSpace(filters.Search) != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			to_tsvector('simple', coalesce(g.code,'') || ' ' || coalesce(g.title_en,'') || ' ' || coalesce(g.title_ar,'') || ' ' || coalesce(g.description_en,'') || ' ' || coalesce(g.description_ar,'') || ' ' || coalesce(g.authority,'')) @@ plainto_tsquery('simple', $%d)
			OR g.code ILIKE '%%' || $%d || '%%'
			OR g.title_en ILIKE '%%' || $%d || '%%'
			OR g.title_ar ILIKE '%%' || $%d || '%%'
			OR g.authority ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if strings.TrimSpace(filters.Jurisdiction) != "" {
		conditions = append(conditions, fmt.Sprintf("g.jurisdiction = $%d", arg))
		args = append(args, strings.ToUpper(strings.TrimSpace(filters.Jurisdiction)))
		arg++
	}
	if strings.TrimSpace(filters.Authority) != "" {
		conditions = append(conditions, fmt.Sprintf("g.authority = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Authority))
		arg++
	}
	if strings.TrimSpace(filters.RegulationType) != "" {
		conditions = append(conditions, fmt.Sprintf("g.regulation_type = $%d", arg))
		args = append(args, strings.TrimSpace(filters.RegulationType))
		arg++
	}
	if strings.TrimSpace(filters.Status) != "" {
		conditions = append(conditions, fmt.Sprintf("g.status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Status))
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM regulation_library_items g WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.RegulationLibraryItem{}, 0, nil
	}

	page, perPage := normalizeLibraryPage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := regulationLibraryJSONSelect(where) + fmt.Sprintf(" ORDER BY t.updated_at DESC LIMIT $%d OFFSET $%d", limitIdx, offsetIdx)
	items, err := queryListJSON[model.RegulationLibraryItem](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *LibraryRepository) SearchRegulationCandidates(ctx context.Context, tenantID uuid.UUID, filters model.RegulationLibrarySearchFilters) ([]model.RegulationLibrarySearchCandidate, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"g.tenant_id = $1", "g.deleted_at IS NULL"}
	if useLibraryKeywordPredicate(filters.Query, filters.Semantic) {
		conditions = append(conditions, regulationLibrarySearchPredicate(arg, filters.Language))
		args = append(args, strings.TrimSpace(filters.Query))
		arg++
	}
	if strings.TrimSpace(filters.Jurisdiction) != "" {
		conditions = append(conditions, fmt.Sprintf("g.jurisdiction = $%d", arg))
		args = append(args, strings.ToUpper(strings.TrimSpace(filters.Jurisdiction)))
		arg++
	}
	if strings.TrimSpace(filters.Authority) != "" {
		conditions = append(conditions, fmt.Sprintf("LOWER(g.authority) = LOWER($%d)", arg))
		args = append(args, strings.TrimSpace(filters.Authority))
		arg++
	}
	if strings.TrimSpace(filters.RegulationType) != "" {
		conditions = append(conditions, fmt.Sprintf("g.regulation_type = $%d", arg))
		args = append(args, strings.TrimSpace(filters.RegulationType))
		arg++
	}
	if strings.TrimSpace(filters.Status) != "" {
		conditions = append(conditions, fmt.Sprintf("g.status = $%d", arg))
		args = append(args, strings.TrimSpace(filters.Status))
		arg++
	}
	if strings.TrimSpace(filters.RiskLevel) != "" {
		conditions = append(conditions, fmt.Sprintf("LOWER(%s) = LOWER($%d)", libraryRiskSQL("g"), arg))
		args = append(args, strings.TrimSpace(filters.RiskLevel))
		arg++
	}

	query := `
		WITH mapped_clauses AS (
			SELECT r.regulation_id,
			       string_agg(DISTINCT concat_ws(' ',
			           c.code, c.title_en, c.title_ar, c.text_en, c.text_ar,
			           c.clause_type, c.category, c.jurisdiction, c.status, c.governance_status,
			           array_to_string(c.tags, ' '), ` + libraryRiskSQL("c") + `,
			           r.reference_type, r.notes
			       ), ' ') AS clause_text
			FROM regulation_clause_references r
			JOIN clause_library_items c ON c.tenant_id = r.tenant_id
			 AND c.id = r.clause_id
			 AND c.deleted_at IS NULL
			WHERE r.tenant_id = $1
			GROUP BY r.regulation_id
		)
		SELECT jsonb_build_object(
			'item', ` + regulationLibraryJSONBuild("g") + `,
			'clause_text', COALESCE(m.clause_text, '')
		)
		FROM regulation_library_items g
		LEFT JOIN mapped_clauses m ON m.regulation_id = g.id
		WHERE ` + strings.Join(conditions, " AND ") + `
		ORDER BY g.updated_at DESC, g.code ASC`
	return queryListJSON[model.RegulationLibrarySearchCandidate](ctx, r.db, query, args...)
}

func (r *LibraryRepository) UpdateRegulation(ctx context.Context, q Queryer, item *model.RegulationLibraryItem) error {
	query := `
		UPDATE regulation_library_items
		SET code = $3,
		    title_en = $4,
		    title_ar = $5,
		    description_en = $6,
		    description_ar = $7,
		    jurisdiction = $8,
		    authority = $9,
		    source = $10,
		    source_url = $11,
		    regulation_type = $12,
		    effective_date = $13,
		    version = $14,
		    status = $15,
		    tags = $16,
		    metadata = $17,
		    updated_by = $18,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		item.TenantID, item.ID, item.Code, item.TitleEN, item.TitleAR, item.DescriptionEN, item.DescriptionAR,
		item.Jurisdiction, item.Authority, item.Source, item.SourceURL, item.RegulationType, datePtr(item.EffectiveDate),
		item.Version, item.Status, item.Tags, item.Metadata, item.UpdatedBy,
	).Scan(&item.UpdatedAt)
}

func (r *LibraryRepository) SoftDeleteRegulation(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE regulation_library_items SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LibraryRepository) UpsertRegulationClauseReference(ctx context.Context, q Queryer, ref *model.RegulationClauseReference) error {
	query := `
		INSERT INTO regulation_clause_references (
			id, tenant_id, regulation_id, clause_id, reference_type, notes, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (tenant_id, regulation_id, clause_id, reference_type)
		DO UPDATE SET notes = EXCLUDED.notes
		RETURNING id, created_at`
	return q.QueryRow(ctx, query,
		ref.ID, ref.TenantID, ref.RegulationID, ref.ClauseID, ref.ReferenceType, ref.Notes, ref.CreatedBy,
	).Scan(&ref.ID, &ref.CreatedAt)
}

func (r *LibraryRepository) DeleteRegulationClauseReference(ctx context.Context, tenantID, regulationID, clauseID uuid.UUID, referenceType model.RegulationClauseReferenceType) error {
	ct, err := r.db.Exec(ctx, `
		DELETE FROM regulation_clause_references
		WHERE tenant_id = $1 AND regulation_id = $2 AND clause_id = $3 AND reference_type = $4`,
		tenantID, regulationID, clauseID, referenceType,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LibraryRepository) ListRegulationClauseReferences(ctx context.Context, tenantID, regulationID uuid.UUID) ([]model.RegulationClauseReference, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT r.id, r.tenant_id, r.regulation_id, r.clause_id, r.reference_type, r.notes,
			       c.code AS clause_code, c.title_en AS clause_title_en, c.title_ar AS clause_title_ar,
			       r.created_by, r.created_at
			FROM regulation_clause_references r
			JOIN clause_library_items c ON c.tenant_id = r.tenant_id AND c.id = r.clause_id AND c.deleted_at IS NULL
			WHERE r.tenant_id = $1 AND r.regulation_id = $2
			ORDER BY c.code ASC, r.created_at ASC
		) t`
	return queryListJSON[model.RegulationClauseReference](ctx, r.db, query, tenantID, regulationID)
}

func clauseLibraryJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.code, c.title_en, c.title_ar, c.text_en, c.text_ar,
			       c.clause_type, c.category, c.jurisdiction, c.source, c.source_url,
			       c.version, c.status, c.governance_status, c.supersedes_id,
			       c.deprecated_by_id, c.deprecated_at,
			       COALESCE(c.tags, '{}') AS tags, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.updated_by, c.created_at, c.updated_at, c.deleted_at
			FROM clause_library_items c
			WHERE ` + where + `
		) t`
}

func regulationLibraryJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT g.id, g.tenant_id, g.code, g.title_en, g.title_ar,
			       g.description_en, g.description_ar, g.jurisdiction, g.authority,
			       g.source, g.source_url, g.regulation_type,
			       g.effective_date::timestamptz AS effective_date,
			       g.version, g.status, COALESCE(g.tags, '{}') AS tags,
			       COALESCE(g.metadata, '{}'::jsonb) AS metadata,
			       g.created_by, g.updated_by, g.created_at, g.updated_at, g.deleted_at
			FROM regulation_library_items g
			WHERE ` + where + `
		) t`
}

func regulationLibraryJSONBuild(alias string) string {
	return fmt.Sprintf(`jsonb_build_object(
		'id', %s.id,
		'tenant_id', %s.tenant_id,
		'code', %s.code,
		'title_en', %s.title_en,
		'title_ar', %s.title_ar,
		'description_en', %s.description_en,
		'description_ar', %s.description_ar,
		'jurisdiction', %s.jurisdiction,
		'authority', %s.authority,
		'source', %s.source,
		'source_url', %s.source_url,
		'regulation_type', %s.regulation_type,
		'effective_date', %s.effective_date::timestamptz,
		'version', %s.version,
		'status', %s.status,
		'tags', COALESCE(%s.tags, '{}'),
		'metadata', COALESCE(%s.metadata, '{}'::jsonb),
		'created_by', %s.created_by,
		'updated_by', %s.updated_by,
		'created_at', %s.created_at,
		'updated_at', %s.updated_at,
		'deleted_at', %s.deleted_at
	)`, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias, alias)
}

func normalizeLibraryPage(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	return page, perPage
}

func useLibraryKeywordPredicate(query string, semantic bool) bool {
	return strings.TrimSpace(query) != "" && !semantic
}

func clauseLibrarySearchPredicate(arg int, language string) string {
	lang := normalizeLibrarySearchLanguage(language)
	documentFields := []string{
		"coalesce(c.code,'')",
		"coalesce(c.clause_type,'')",
		"coalesce(c.category,'')",
		"coalesce(c.jurisdiction,'')",
		"coalesce(c.status,'')",
		"coalesce(c.governance_status,'')",
		"coalesce(array_to_string(c.tags, ' '),'')",
		libraryRiskSQL("c"),
		"coalesce(m.regulation_text,'')",
	}
	predicates := []string{
		fmt.Sprintf("c.code ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("c.clause_type ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("c.category ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("c.jurisdiction ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("c.status ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("c.governance_status ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("array_to_string(c.tags, ' ') ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("%s ILIKE '%%' || $%d || '%%'", libraryRiskSQL("c"), arg),
		fmt.Sprintf("coalesce(m.regulation_text,'') ILIKE '%%' || $%d || '%%'", arg),
	}
	if lang != "ar" {
		documentFields = append(documentFields, "coalesce(c.title_en,'')", "coalesce(c.text_en,'')")
		predicates = append(predicates,
			fmt.Sprintf("c.title_en ILIKE '%%' || $%d || '%%'", arg),
			fmt.Sprintf("c.text_en ILIKE '%%' || $%d || '%%'", arg),
		)
	}
	if lang != "en" {
		documentFields = append(documentFields, "coalesce(c.title_ar,'')", "coalesce(c.text_ar,'')")
		predicates = append(predicates,
			fmt.Sprintf("c.title_ar ILIKE '%%' || $%d || '%%'", arg),
			fmt.Sprintf("c.text_ar ILIKE '%%' || $%d || '%%'", arg),
		)
	}
	return fmt.Sprintf(`(
		to_tsvector('simple', %s) @@ plainto_tsquery('simple', $%d)
		OR %s
	)`, strings.Join(documentFields, " || ' ' || "), arg, strings.Join(predicates, "\n\t\tOR "))
}

func regulationLibrarySearchPredicate(arg int, language string) string {
	lang := normalizeLibrarySearchLanguage(language)
	documentFields := []string{
		"coalesce(g.code,'')",
		"coalesce(g.jurisdiction,'')",
		"coalesce(g.authority,'')",
		"coalesce(g.regulation_type,'')",
		"coalesce(g.status,'')",
		"coalesce(array_to_string(g.tags, ' '),'')",
		libraryRiskSQL("g"),
		"coalesce(m.clause_text,'')",
	}
	predicates := []string{
		fmt.Sprintf("g.code ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("g.jurisdiction ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("g.authority ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("g.regulation_type ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("g.status ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("array_to_string(g.tags, ' ') ILIKE '%%' || $%d || '%%'", arg),
		fmt.Sprintf("%s ILIKE '%%' || $%d || '%%'", libraryRiskSQL("g"), arg),
		fmt.Sprintf("coalesce(m.clause_text,'') ILIKE '%%' || $%d || '%%'", arg),
	}
	if lang != "ar" {
		documentFields = append(documentFields, "coalesce(g.title_en,'')", "coalesce(g.description_en,'')")
		predicates = append(predicates,
			fmt.Sprintf("g.title_en ILIKE '%%' || $%d || '%%'", arg),
			fmt.Sprintf("g.description_en ILIKE '%%' || $%d || '%%'", arg),
		)
	}
	if lang != "en" {
		documentFields = append(documentFields, "coalesce(g.title_ar,'')", "coalesce(g.description_ar,'')")
		predicates = append(predicates,
			fmt.Sprintf("g.title_ar ILIKE '%%' || $%d || '%%'", arg),
			fmt.Sprintf("g.description_ar ILIKE '%%' || $%d || '%%'", arg),
		)
	}
	return fmt.Sprintf(`(
		to_tsvector('simple', %s) @@ plainto_tsquery('simple', $%d)
		OR %s
	)`, strings.Join(documentFields, " || ' ' || "), arg, strings.Join(predicates, "\n\t\tOR "))
}

func normalizeLibrarySearchLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "ar", "arabic":
		return "ar"
	case "en", "eng", "english":
		return "en"
	default:
		return "all"
	}
}

func libraryRiskSQL(alias string) string {
	return fmt.Sprintf(
		"coalesce(%s.metadata->>'risk_level', %s.metadata->>'riskLevel', %s.metadata->>'risk_tier', %s.metadata->>'riskTier', %s.metadata->>'risk', '')",
		alias, alias, alias, alias, alias,
	)
}
