package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
)

// DocumentSearchRepository implements full-text search over legal_documents
// (CAP-169/182). It reads the search_vector GENERATED column (title + description
// + extracted_text) added by the cross-cutting staged migration and ranks hits
// with ts_rank, producing a ts_headline snippet. The GIN index on search_vector
// (CAP-182/183) keeps the query indexed. websearch_to_tsquery is used so an
// operator can type a natural query ("breach AND penalty") safely.
type DocumentSearchRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewDocumentSearchRepository(db *pgxpool.Pool, logger zerolog.Logger) *DocumentSearchRepository {
	return &DocumentSearchRepository{db: db, logger: logger}
}

// Search runs the FTS query within tenant scope and returns ranked hits plus the
// total match count. The query text is bound as a parameter into
// websearch_to_tsquery, so it cannot break out of the statement.
func (r *DocumentSearchRepository) Search(ctx context.Context, tenantID uuid.UUID, req dto.DocumentSearchRequest, page, perPage int) ([]dto.DocumentSearchHit, int, error) {
	args := []any{tenantID, req.Query}
	arg := 3
	conditions := []string{
		"d.tenant_id = $1",
		"d.deleted_at IS NULL",
		// Bilingual FTS: normalized 'simple' vector match (Arabic tashkeel/alef
		// folding + English lowercasing) OR an ILIKE substring fallback that
		// recovers partial/prefix Arabic queries and English stems the tokenizer
		// drops. Mirrors reference_library_repo.go. All bound via $2 (no injection).
		`(
			d.search_vector @@ websearch_to_tsquery('simple', lex_search_normalize($2))
			OR d.title ILIKE '%' || $2 || '%'
			OR coalesce(d.description, '') ILIKE '%' || $2 || '%'
			OR coalesce(d.extracted_text, '') ILIKE '%' || $2 || '%'
		)`,
	}
	if req.Type != "" {
		conditions = append(conditions, fmt.Sprintf("d.type = $%d", arg))
		args = append(args, req.Type)
		arg++
	}
	if req.Status != "" {
		conditions = append(conditions, fmt.Sprintf("d.status = $%d", arg))
		args = append(args, req.Status)
		arg++
	}
	if req.Confidentiality != "" {
		conditions = append(conditions, fmt.Sprintf("d.confidentiality = $%d", arg))
		args = append(args, req.Confidentiality)
		arg++
	}
	if req.Category != "" {
		conditions = append(conditions, fmt.Sprintf("d.category = $%d", arg))
		args = append(args, req.Category)
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_documents d WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []dto.DocumentSearchHit{}, 0, nil
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}

	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.title, d.type, d.description,
			       d.file_id, d.file_name, d.file_size_bytes, d.extracted_text,
			       d.category, d.confidentiality, d.contract_id, d.current_version, d.status,
			       COALESCE(d.tags, '{}') AS tags, COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_by, d.created_at, d.updated_at, d.deleted_at,
			       ts_rank(d.search_vector, websearch_to_tsquery('simple', lex_search_normalize($2)))
			           + CASE WHEN d.title ILIKE '%' || $2 || '%' THEN 0.5 ELSE 0 END AS rank,
			       ts_headline('simple',
			                   coalesce(d.title,'') || ' — ' || coalesce(d.description,'') || ' ' || coalesce(d.extracted_text,''),
			                   websearch_to_tsquery('simple', lex_search_normalize($2)),
			                   'MaxFragments=2, MinWords=5, MaxWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet
			FROM legal_documents d
			WHERE ` + where + fmt.Sprintf(`
			ORDER BY rank DESC, d.updated_at DESC
			LIMIT $%d OFFSET $%d
		) t`, arg, arg+1)
	args = append(args, perPage, (page-1)*perPage)

	items, err := queryListJSON[dto.DocumentSearchHit](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// SetExtractedText stores the OCR/extracted plaintext for a document so the
// GENERATED search_vector is rebuilt to include the body (CAP-169). It is the
// write-side seam used after a file's text layer has been extracted. No-op match
// returns model.ErrNotFound semantics via the caller (RowsAffected==0 handled by
// caller); here it simply executes the UPDATE.
func (r *DocumentSearchRepository) SetExtractedText(ctx context.Context, tenantID, documentID uuid.UUID, text string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE legal_documents SET extracted_text = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, documentID, strings.TrimSpace(text))
	return err
}
