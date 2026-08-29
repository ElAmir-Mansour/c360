package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// contractAuditMaxPerPage caps a single audit page/export slice. It is
// deliberately higher than the interactive list cap (200) because the CSV
// export path pulls one large slice, mirroring ContractReport's bulk default.
const contractAuditMaxPerPage = 1000

// ContractAuditRepository serves the tenant-wide contract portfolio audit feed
// (GET /contracts/audit). It mirrors the MatterAuditRepository read-path role
// but, unlike matters (which have a dedicated legal_matter_audit_log table),
// contracts already persist their governance facts on the aggregate itself:
// created_at/created_by, previous_status→status + status_changed_at/_by,
// archive_status/archive_date/archived_by/archive_reason (CAP-122),
// last_analyzed_at, the immutable contract_versions rows, and any
// metadata->'timeline' entries (the same extension point the per-contract
// timeline reads). This repo PROJECTS those columns into one chronological
// event stream instead of introducing a parallel audit table — no migration,
// no second write path, and the feed can never disagree with the aggregate.
//
// NOTE: owner and total_value changes are not yet historically stored anywhere
// in lex_db (UpdateContract only publishes a bus event); the metadata timeline
// branch below is the designated landing spot — once contract mutations append
// {event_type:"owner_changed"|"value_changed", field, before, after,
// actor_user_id, occurred_at} entries to metadata->'timeline' (a follow-up in
// the shared ContractService, which this build does not edit), they surface
// here with zero read-path changes. This mirrors how the matter audit read
// path shipped ahead of its emission wiring.
type ContractAuditRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractAuditRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractAuditRepository {
	return &ContractAuditRepository{db: db, logger: logger}
}

// contractAuditScopeClauses builds the contract-level WHERE conditions (alias
// "c") for the audit feed. The semantics intentionally MATCH
// ContractRepository.List one-for-one (same params, same operators) so the
// feed scopes to exactly the set of contracts the list view shows. Returns the
// conditions, their positional args, and the next free arg index.
func contractAuditScopeClauses(tenantID uuid.UUID, filters model.ContractAuditFilters) ([]string, []any, int) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			to_tsvector('english', coalesce(c.title,'') || ' ' || coalesce(c.party_b_name,'') || ' ' || coalesce(c.description,'')) @@ plainto_tsquery('english', $%d)
			OR c.title ILIKE '%%' || $%d || '%%'
			OR c.party_b_name ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("c.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("c.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("c.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	if filters.OwnerUserID != nil {
		conditions = append(conditions, fmt.Sprintf("c.owner_user_id = $%d", arg))
		args = append(args, *filters.OwnerUserID)
		arg++
	}
	if filters.RiskLevel != nil {
		conditions = append(conditions, fmt.Sprintf("c.risk_level = $%d", arg))
		args = append(args, *filters.RiskLevel)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("c.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(c.tags)", arg))
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Tag)))
		arg++
	}
	if filters.OrgEntityID != nil {
		conditions = append(conditions, fmt.Sprintf("c.org_entity_id = $%d", arg))
		args = append(args, *filters.OrgEntityID)
		arg++
	}
	if filters.ExpiringInDays != nil {
		conditions = append(conditions, fmt.Sprintf("c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + $%d::int", arg))
		args = append(args, *filters.ExpiringInDays)
		arg++
	}
	return conditions, args, arg
}

// contractAuditWindowClauses builds the occurred_at window conditions applied
// to the projected event rows (alias "e"). From is inclusive, To exclusive
// (the handler already normalized date-only bounds). Returns conditions, args,
// and the next free arg index.
func contractAuditWindowClauses(filters model.ContractAuditFilters, arg int) ([]string, []any, int) {
	conditions := []string{}
	args := []any{}
	if filters.From != nil {
		conditions = append(conditions, fmt.Sprintf("e.occurred_at >= $%d", arg))
		args = append(args, *filters.From)
		arg++
	}
	if filters.To != nil {
		conditions = append(conditions, fmt.Sprintf("e.occurred_at < $%d", arg))
		args = append(args, *filters.To)
		arg++
	}
	return conditions, args, arg
}

// contractAuditEventsCTE is the UNION ALL projection of the durable contract
// governance columns into one event stream. Every branch selects the same
// column tuple; the scope CTE has already applied tenant + list filters.
//
// The metadata->'timeline' branch defensively guards both shape (must be a
// jsonb array of objects) and value formats (ISO-ish occurred_at, UUID-shaped
// actor_user_id) so one malformed hand-written entry cannot 500 the feed.
const contractAuditEventsCTE = `
	events AS (
		SELECT (s.id::text || ':created')                    AS id,
		       s.tenant_id, s.id AS contract_id, s.title     AS contract_title,
		       'contract_created'                            AS event_type,
		       'lifecycle'                                   AS field,
		       NULL::text                                    AS before,
		       s.status::text                                AS after,
		       s.created_by                                  AS actor_user_id,
		       s.created_at                                  AS occurred_at,
		       'contracts.created_at'                        AS source,
		       jsonb_build_object('type', s.type)            AS detail
		FROM scope s
		UNION ALL
		SELECT (s.id::text || ':status:' || s.status),
		       s.tenant_id, s.id, s.title,
		       'status_changed', 'status',
		       s.previous_status::text, s.status::text,
		       s.status_changed_by, s.status_changed_at,
		       'contracts.status_changed_at',
		       '{}'::jsonb
		FROM scope s
		WHERE s.status_changed_at IS NOT NULL
		UNION ALL
		SELECT (s.id::text || ':archived'),
		       s.tenant_id, s.id, s.title,
		       'contract_archived', 'archive_status',
		       'active'::text, 'archived'::text,
		       s.archived_by, s.archive_date,
		       'contracts.archive_date',
		       jsonb_build_object('archive_reason', s.archive_reason)
		FROM scope s
		WHERE s.archive_date IS NOT NULL AND s.archive_status = 'archived'
		UNION ALL
		SELECT (s.id::text || ':analysis'),
		       s.tenant_id, s.id, s.title,
		       'analysis_completed', 'risk_level',
		       NULL::text, s.risk_level::text,
		       NULL::uuid, s.last_analyzed_at,
		       'contracts.last_analyzed_at',
		       jsonb_build_object('risk_score', s.risk_score)
		FROM scope s
		WHERE s.last_analyzed_at IS NOT NULL
		UNION ALL
		SELECT (v.id::text || ':version'),
		       v.tenant_id, s.id, s.title,
		       'version_uploaded', 'document_version',
		       CASE WHEN v.version > 1 THEN (v.version - 1)::text END, v.version::text,
		       v.uploaded_by, v.uploaded_at,
		       'contract_versions.uploaded_at',
		       jsonb_build_object(
		           'version', v.version,
		           'file_name', v.file_name,
		           'content_hash', v.content_hash,
		           'change_summary', v.change_summary
		       )
		FROM contract_versions v
		JOIN scope s ON s.id = v.contract_id AND s.tenant_id = v.tenant_id
		UNION ALL
		SELECT (s.id::text || ':metadata:' || (entry.ord - 1)::text),
		       s.tenant_id, s.id, s.title,
		       COALESCE(NULLIF(entry.value->>'event_type',''), NULLIF(entry.value->>'type',''), 'metadata_event'),
		       COALESCE(entry.value->>'field', ''),
		       entry.value->>'before', entry.value->>'after',
		       CASE WHEN entry.value->>'actor_user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		            THEN (entry.value->>'actor_user_id')::uuid END,
		       ((entry.value->>'occurred_at'))::timestamptz,
		       'contract.metadata.timeline',
		       entry.value
		FROM scope s
		CROSS JOIN LATERAL jsonb_array_elements(
			CASE WHEN jsonb_typeof(s.metadata->'timeline') = 'array'
			     THEN s.metadata->'timeline' ELSE '[]'::jsonb END
		) WITH ORDINALITY AS entry(value, ord)
		WHERE jsonb_typeof(entry.value) = 'object'
		  AND entry.value->>'occurred_at' ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?'
	)`

// ListPortfolioAudit returns one page of the tenant's contract portfolio audit
// feed, newest-first (matching the per-contract timeline ordering), plus the
// total number of matching events. Mirrors ContractRepository.List's
// count-then-page shape and the queryListJSON row_to_json convention.
func (r *ContractAuditRepository) ListPortfolioAudit(ctx context.Context, tenantID uuid.UUID, filters model.ContractAuditFilters) ([]model.ContractAuditEvent, int, error) {
	scopeConds, args, arg := contractAuditScopeClauses(tenantID, filters)
	windowConds, windowArgs, arg := contractAuditWindowClauses(filters, arg)
	args = append(args, windowArgs...)

	where := "TRUE"
	if len(windowConds) > 0 {
		where = strings.Join(windowConds, " AND ")
	}
	base := `
		WITH scope AS (
			SELECT c.id, c.tenant_id, c.title, c.type, c.status, c.previous_status,
			       c.status_changed_at, c.status_changed_by,
			       c.risk_level, c.risk_score, c.last_analyzed_at,
			       c.archive_status, c.archive_date, c.archived_by, c.archive_reason,
			       c.metadata, c.created_by, c.created_at
			FROM contracts c
			WHERE ` + strings.Join(scopeConds, " AND ") + `
		),` + contractAuditEventsCTE

	var total int
	countQuery := base + `
		SELECT COUNT(*) FROM events e WHERE ` + where
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count contract audit events: %w", err)
	}
	if total == 0 {
		return []model.ContractAuditEvent{}, 0, nil
	}

	page := filters.Page
	if page < 1 {
		page = 1
	}
	perPage := filters.PerPage
	if perPage < 1 {
		perPage = 25
	}
	if perPage > contractAuditMaxPerPage {
		perPage = contractAuditMaxPerPage
	}
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)

	query := base + fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT e.id, e.tenant_id, e.contract_id, e.contract_title, e.event_type,
			       e.field, e.before, e.after, e.actor_user_id, e.occurred_at,
			       e.source, COALESCE(e.detail, '{}'::jsonb) AS detail
			FROM events e
			WHERE `+where+`
			ORDER BY e.occurred_at DESC, e.id ASC
			LIMIT $%d OFFSET $%d
		) t`, limitIdx, offsetIdx)
	items, err := queryListJSON[model.ContractAuditEvent](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list contract audit events: %w", err)
	}
	return items, total, nil
}
