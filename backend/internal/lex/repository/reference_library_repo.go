package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ReferenceLibraryRepository reads the GLOBAL WatheeqTech reference catalog. It
// mirrors LibraryRepository's raw-pool + row_to_json + COUNT/GIN/ILIKE shape but
// strips EVERY tenant_id predicate (the table is global) and exposes NO writes
// (the catalog is provisioned only by the ingestion job). Every query filters
// `deleted_at IS NULL AND published`.
//
// db is the Queryer interface (satisfied by *pgxpool.Pool and by pgxmock) so the
// filter/facet/pagination SQL is unit-testable without a live database.
type ReferenceLibraryRepository struct {
	db     Queryer
	logger zerolog.Logger
}

func NewReferenceLibraryRepository(db Queryer, logger zerolog.Logger) *ReferenceLibraryRepository {
	return &ReferenceLibraryRepository{db: db, logger: logger}
}

// buildReferenceLibraryListWhere builds the browse/metadata-search WHERE predicate
// and its positional args, returning the next free positional index for the
// LIMIT/OFFSET the caller appends. It is a PURE function (no DB) so the exact
// filter semantics — FTS+ILIKE search, category/doc_type equality, tag ANY() —
// are unit-testable in isolation. Search is a metadata FTS/ILIKE over title/
// description/authority/tags (contents search is the Second-Brain AI proxy, not
// this path).
func buildReferenceLibraryListWhere(filters model.ReferenceLibraryListFilters) (string, []any, int) {
	args := []any{}
	arg := 1
	conditions := []string{"d.deleted_at IS NULL", "d.published = true"}

	if search := strings.TrimSpace(filters.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			to_tsvector('simple', coalesce(d.title_ar,'') || ' ' || coalesce(d.title_en,'') || ' ' || coalesce(d.description_ar,'') || ' ' || coalesce(d.description_en,'') || ' ' || coalesce(d.authority,'') || ' ' || array_to_string(d.tags, ' ')) @@ plainto_tsquery('simple', $%d)
			OR d.title_ar ILIKE '%%' || $%d || '%%'
			OR d.title_en ILIKE '%%' || $%d || '%%'
			OR d.authority ILIKE '%%' || $%d || '%%'
			OR array_to_string(d.tags, ' ') ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg, arg, arg))
		args = append(args, search)
		arg++
	}
	if category := strings.TrimSpace(filters.Category); category != "" {
		conditions = append(conditions, fmt.Sprintf("d.category = $%d", arg))
		args = append(args, category)
		arg++
	}
	if docType := strings.TrimSpace(filters.DocType); docType != "" {
		conditions = append(conditions, fmt.Sprintf("d.doc_type = $%d", arg))
		args = append(args, docType)
		arg++
	}
	if tag := strings.TrimSpace(filters.Tag); tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(d.tags)", arg))
		args = append(args, tag)
		arg++
	}
	return strings.Join(conditions, " AND "), args, arg
}

// List returns a page of published catalog rows plus the total, applying the
// browse filters.
func (r *ReferenceLibraryRepository) List(ctx context.Context, filters model.ReferenceLibraryListFilters) ([]model.ReferenceLibraryDocument, int, error) {
	where, args, arg := buildReferenceLibraryListWhere(filters)

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM reference_library_documents d WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ReferenceLibraryDocument{}, 0, nil
	}

	page, perPage := normalizeLibraryPage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := referenceLibraryJSONSelect(where) + fmt.Sprintf(" ORDER BY t.category ASC, t.doc_type ASC, t.title_ar ASC LIMIT $%d OFFSET $%d", limitIdx, offsetIdx)
	items, err := queryListJSON[model.ReferenceLibraryDocument](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Get resolves a single published, non-deleted catalog row by id. It returns
// pgx.ErrNoRows when the row is absent so the service maps it to a 404.
func (r *ReferenceLibraryRepository) Get(ctx context.Context, id uuid.UUID) (*model.ReferenceLibraryDocument, error) {
	query := referenceLibraryJSONSelect("d.id = $1 AND d.deleted_at IS NULL AND d.published = true")
	return queryRowJSON[model.ReferenceLibraryDocument](ctx, r.db, query, id)
}

// Fingerprint returns a cheap corpus version signature — the count of live,
// published rows and the newest updated_at — used to derive strong cache
// validators (ETags) for the list/facets browse surfaces and to bust the
// read-through cache the instant the ingestion job UPSERTs a row. maxUpdated is
// the zero time when the corpus is empty.
func (r *ReferenceLibraryRepository) Fingerprint(ctx context.Context) (count int, maxUpdated time.Time, err error) {
	var maxUpdatedNull *time.Time
	row := r.db.QueryRow(ctx, `
		SELECT COUNT(*), MAX(updated_at)
		FROM reference_library_documents
		WHERE deleted_at IS NULL AND published = true`)
	if err = row.Scan(&count, &maxUpdatedNull); err != nil {
		return 0, time.Time{}, err
	}
	if maxUpdatedNull != nil {
		maxUpdated = *maxUpdatedNull
	}
	return count, maxUpdated, nil
}

// Facets returns category / doc_type / tag buckets with published-document counts
// for the browse filter tree.
func (r *ReferenceLibraryRepository) Facets(ctx context.Context) (*model.ReferenceLibraryFacets, error) {
	facets := &model.ReferenceLibraryFacets{
		Categories: []model.ReferenceLibraryFacet{},
		DocTypes:   []model.ReferenceLibraryFacet{},
		Tags:       []model.ReferenceLibraryFacet{},
	}
	var err error
	if facets.Categories, err = r.scanFacets(ctx, `
		SELECT category AS value, COUNT(*) AS count
		FROM reference_library_documents
		WHERE deleted_at IS NULL AND published = true
		GROUP BY category
		ORDER BY count DESC, category ASC`); err != nil {
		return nil, err
	}
	if facets.DocTypes, err = r.scanFacets(ctx, `
		SELECT doc_type AS value, COUNT(*) AS count
		FROM reference_library_documents
		WHERE deleted_at IS NULL AND published = true
		GROUP BY doc_type
		ORDER BY count DESC, doc_type ASC`); err != nil {
		return nil, err
	}
	if facets.Tags, err = r.scanFacets(ctx, `
		SELECT tag AS value, COUNT(*) AS count
		FROM reference_library_documents, unnest(tags) AS tag
		WHERE deleted_at IS NULL AND published = true
		GROUP BY tag
		ORDER BY count DESC, tag ASC`); err != nil {
		return nil, err
	}
	return facets, nil
}

func (r *ReferenceLibraryRepository) scanFacets(ctx context.Context, query string) ([]model.ReferenceLibraryFacet, error) {
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []model.ReferenceLibraryFacet{}
	for rows.Next() {
		var f model.ReferenceLibraryFacet
		if err := rows.Scan(&f.Value, &f.Count); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func referenceLibraryJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.title_ar, d.title_en, d.description_ar, d.description_en,
			       d.category, d.doc_type, d.jurisdiction, d.authority, d.source, d.source_url,
			       COALESCE(d.tags, '{}') AS tags,
			       d.byte_source, d.file_id, d.storage_key, d.library_tenant_id,
			       d.file_size_bytes, d.content_hash, d.published, d.version,
			       d.hijri_date, d.gregorian_date::timestamptz AS gregorian_date,
			       d.effective_date::timestamptz AS effective_date,
			       COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_at, d.updated_at, d.deleted_at
			FROM reference_library_documents d
			WHERE ` + where + `
		) t`
}
