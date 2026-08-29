package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// MatterLinkRepository persists cross-domain related-items edges from a matter
// to sibling lex entities. Rows are hard-deletable (link rows, like comments
// and document links, are not WORM-protected).
type MatterLinkRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewMatterLinkRepository(db *pgxpool.Pool, logger zerolog.Logger) *MatterLinkRepository {
	return &MatterLinkRepository{db: db, logger: logger}
}

func (r *MatterLinkRepository) Create(ctx context.Context, l *model.MatterLink) error {
	query := `
		INSERT INTO matter_links (
			id, tenant_id, matter_id, target_type, target_id, relationship, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at`
	return r.db.QueryRow(ctx, query,
		l.ID, l.TenantID, l.MatterID, string(l.TargetType), l.TargetID, l.Relationship, l.CreatedBy,
	).Scan(&l.CreatedAt)
}

func (r *MatterLinkRepository) Get(ctx context.Context, tenantID, matterID, id uuid.UUID) (*model.MatterLink, error) {
	query := matterLinkJSONSelect(`ml.tenant_id = $1 AND ml.matter_id = $2 AND ml.id = $3`)
	return queryRowJSON[model.MatterLink](ctx, r.db, query, tenantID, matterID, id)
}

func (r *MatterLinkRepository) ListByMatter(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterLink, error) {
	query := matterLinkJSONSelectWithSuffix(
		`ml.tenant_id = $1 AND ml.matter_id = $2`,
		` ORDER BY ml.created_at ASC`,
	)
	return queryListJSON[model.MatterLink](ctx, r.db, query, tenantID, matterID)
}

func (r *MatterLinkRepository) Delete(ctx context.Context, tenantID, matterID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `
		DELETE FROM matter_links
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3`,
		tenantID, matterID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ErrTargetNotFound is returned by ResolveTarget when the referenced target
// entity does not exist for the tenant (or has been soft-deleted). The service
// maps this to a 4xx so a dangling link is never persisted.
var ErrTargetNotFound = errors.New("link target not found")

// targetMeta describes, per target_type, the physical table and the columns we
// use for (a) the human-readable reference number and (b) the title. The table
// names deliberately differ from the public target_type strings: the lex schema
// prefixes most aggregates with legal_ (e.g. target_type 'consultation' lives in
// legal_consultations). Keeping this mapping in one place documents the seam.
//
// Notes on columns:
//   - referenceExpr  : a TEXT/text-castable column holding the user-facing number
//     (consultation_number, case_number, settlement.reference, contract_number).
//   - titleExpr      : a SQL expression yielding the title as text. For tables
//     whose title is JSONB+localized (legal_consultations, legal_cases) we
//     coalesce the Arabic then English key (Arabic-first per Watheeq). For
//     investigations the only title-like field (subject) is field-encrypted
//     ciphertext and is intentionally NOT exposed as a title — ” is returned.
//   - tenantScoped   : every target table is tenant-scoped; all support a
//     deleted_at soft-delete column, so existence excludes soft-deleted rows.
//
// 'litigation' has no dedicated table — in the lex schema litigation is a
// category of legal_cases — so it resolves against legal_cases, same as
// 'legal_case'. The unique index still distinguishes the two target_type values,
// which is intentional (a matter may relate to the same case both as a generic
// "legal_case" and as a "litigation" emphasis).
type targetMeta struct {
	table         string
	referenceExpr string
	titleExpr     string
}

func matterLinkTargetMeta(t model.MatterLinkTargetType) (targetMeta, bool) {
	switch t {
	case model.MatterLinkTargetConsultation:
		return targetMeta{
			table:         "legal_consultations",
			referenceExpr: "consultation_number",
			titleExpr:     "COALESCE(NULLIF(title->>'ar',''), NULLIF(title->>'en',''), '')",
		}, true
	case model.MatterLinkTargetInvestigation:
		return targetMeta{
			table:         "legal_investigations",
			referenceExpr: "investigation_number",
			titleExpr:     "''", // subject is field-encrypted; do not expose as title.
		}, true
	case model.MatterLinkTargetLegalCase, model.MatterLinkTargetLitigation:
		return targetMeta{
			table:         "legal_cases",
			referenceExpr: "case_number",
			titleExpr:     "COALESCE(NULLIF(title->>'ar',''), NULLIF(title->>'en',''), '')",
		}, true
	case model.MatterLinkTargetSettlement:
		return targetMeta{
			table:         "legal_settlement",
			referenceExpr: "reference",
			titleExpr:     "COALESCE(title,'')",
		}, true
	case model.MatterLinkTargetContract:
		return targetMeta{
			table:         "contracts",
			referenceExpr: "COALESCE(contract_number,'')",
			titleExpr:     "COALESCE(title,'')",
		}, true
	default:
		return targetMeta{}, false
	}
}

// ResolveTarget verifies that the referenced target exists, is owned by the
// tenant, and is not soft-deleted; on success it returns the target's
// human-readable reference and title for read-time enrichment. It returns
// ErrTargetNotFound for a missing/foreign/deleted target. The query string is
// assembled only from internal constants (table + column names from
// matterLinkTargetMeta); tenant_id and target_id are passed as bind parameters,
// so this is not SQL-injectable from user input.
func (r *MatterLinkRepository) ResolveTarget(ctx context.Context, tenantID uuid.UUID, t model.MatterLinkTargetType, targetID uuid.UUID) (reference, title string, err error) {
	meta, ok := matterLinkTargetMeta(t)
	if !ok {
		return "", "", ErrTargetNotFound
	}
	query := `SELECT ` + meta.referenceExpr + ` AS reference, ` + meta.titleExpr + ` AS title
		FROM ` + meta.table + `
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`
	err = r.db.QueryRow(ctx, query, tenantID, targetID).Scan(&reference, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrTargetNotFound
	}
	if err != nil {
		return "", "", err
	}
	return reference, title, nil
}

// EnrichTargets best-effort populates TargetReference/TargetTitle for each link
// in place. Resolution failures (e.g. a target deleted after the link was made,
// or a transient error) are non-fatal: the affected link keeps empty enrichment
// fields so the list endpoint never fails on stale references. Lookups are
// grouped by target_type so we issue at most one query per distinct type.
func (r *MatterLinkRepository) EnrichTargets(ctx context.Context, tenantID uuid.UUID, links []model.MatterLink) {
	if len(links) == 0 {
		return
	}
	// Group the target ids per type so we can resolve each type in a single
	// ANY($2) query rather than one round-trip per link.
	idsByType := make(map[model.MatterLinkTargetType][]uuid.UUID)
	for _, l := range links {
		idsByType[l.TargetType] = append(idsByType[l.TargetType], l.TargetID)
	}
	type meta struct {
		reference string
		title     string
	}
	resolved := make(map[model.MatterLinkTargetType]map[uuid.UUID]meta)
	for t, ids := range idsByType {
		tm, ok := matterLinkTargetMeta(t)
		if !ok {
			continue
		}
		query := `SELECT id, ` + tm.referenceExpr + ` AS reference, ` + tm.titleExpr + ` AS title
			FROM ` + tm.table + `
			WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`
		rows, err := r.db.Query(ctx, query, tenantID, ids)
		if err != nil {
			r.logger.Warn().Err(err).Str("target_type", string(t)).Msg("matter link enrichment query failed; returning links without enrichment")
			continue
		}
		m := make(map[uuid.UUID]meta)
		for rows.Next() {
			var id uuid.UUID
			var rec meta
			if scanErr := rows.Scan(&id, &rec.reference, &rec.title); scanErr != nil {
				continue
			}
			m[id] = rec
		}
		rows.Close()
		resolved[t] = m
	}
	for i := range links {
		if m, ok := resolved[links[i].TargetType]; ok {
			if rec, ok := m[links[i].TargetID]; ok {
				links[i].TargetReference = rec.reference
				links[i].TargetTitle = rec.title
			}
		}
	}
}

func matterLinkJSONSelect(where string) string {
	return matterLinkJSONSelectWithSuffix(where, "")
}

func matterLinkJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ml.id, ml.tenant_id, ml.matter_id, ml.target_type, ml.target_id,
			       ml.relationship, ml.created_by, ml.created_at
			FROM matter_links ml
			WHERE ` + where + suffix + `
		) t`
}
