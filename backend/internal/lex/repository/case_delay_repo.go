package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// CaseDelayRepository owns the Case Timelines vertical persistence (CAP-084..088):
// the timeline/external-dependency projection over legal_matters (read + the
// dedicated ALTERed columns) and the legal_case_delay_events register. It mirrors
// MatterRepository conventions: tenant_id FIRST, JSON row projection,
// queryRowJSON/queryListJSON, soft-delete, sort allowlist. It NEVER mutates the
// core Matter aggregate columns — only the timeline extension columns added by the
// staged ALTER.
type CaseDelayRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseDelayRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseDelayRepository {
	return &CaseDelayRepository{db: db, logger: logger}
}

// GetTimeline loads the timeline projection of a matter. It returns pgx.ErrNoRows
// when the matter does not exist (or is soft-deleted) in the tenant.
func (r *CaseDelayRepository) GetTimeline(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID) (*model.MatterTimeline, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT m.id AS matter_id, m.tenant_id, m.matter_number, m.title, m.status,
			       m.opened_at, m.due_date::timestamptz AS due_date, m.closed_at,
			       m.estimated_duration_days,
			       m.estimated_completion_date::timestamptz AS estimated_completion_date,
			       COALESCE(m.external_hold, false) AS external_hold,
			       m.external_hold_category, m.external_hold_since, m.closure_reason,
			       m.updated_at
			FROM legal_matters m
			WHERE m.tenant_id = $1 AND m.id = $2 AND m.deleted_at IS NULL
		) t`
	return queryRowJSON[model.MatterTimeline](ctx, q, query, tenantID, matterID)
}

// UpdateTimeline writes the timeline-estimate columns (CAP-084) on legal_matters.
// It touches ONLY the timeline extension columns plus updated_at — never the
// Matter aggregate fields the MatterRepository owns. q may be a tx.
func (r *CaseDelayRepository) UpdateTimeline(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID, estimatedDurationDays *int, estimatedCompletionDate *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matters
		SET estimated_duration_days = $3,
		    estimated_completion_date = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, matterID, estimatedDurationDays, lexDatePtr(estimatedCompletionDate),
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetExternalHold flips the external-pending flag on legal_matters (CAP-087): when
// held it records the category + since timestamp; when cleared it nulls them. It
// does NOT force the matter closed (CAP-085: due_date stays nullable, no forced
// closure). q may be a tx.
func (r *CaseDelayRepository) SetExternalHold(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID, held bool, category *model.DelayCategory, since *time.Time) error {
	var categoryArg any
	if category != nil {
		categoryArg = string(*category)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_matters
		SET external_hold = $3,
		    external_hold_category = CASE WHEN $3 THEN $4 ELSE NULL END,
		    external_hold_since    = CASE WHEN $3 THEN COALESCE($5, now()) ELSE NULL END,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, matterID, held, categoryArg, since,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetClosureReason records the closure reason on legal_matters (CAP-093:
// closure_reason='reconciliation' when a settlement closes the matter). q may be a
// tx so it commits atomically with the status change driven by MatterRepository.
func (r *CaseDelayRepository) SetClosureReason(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID, reason string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matters
		SET closure_reason = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, matterID, strings.TrimSpace(reason),
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CreateDelayEvent appends a delay-event register row (CAP-086/087). q may be a tx.
func (r *CaseDelayRepository) CreateDelayEvent(ctx context.Context, q Queryer, event *model.LegalCaseDelayEvent) error {
	query := `
		INSERT INTO legal_case_delay_events (
			id, tenant_id, matter_id, category, reason, opened_at, resolved_at, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		event.ID, event.TenantID, event.MatterID, event.Category, event.Reason,
		event.OpenedAt, event.ResolvedAt, event.Metadata, event.CreatedBy,
	).Scan(&event.CreatedAt, &event.UpdatedAt)
}

// GetDelayEvent loads a single delay event scoped to its matter + tenant.
func (r *CaseDelayRepository) GetDelayEvent(ctx context.Context, tenantID, matterID, eventID uuid.UUID) (*model.LegalCaseDelayEvent, error) {
	query := delayEventJSONSelect(`d.tenant_id = $1 AND d.matter_id = $2 AND d.id = $3 AND d.deleted_at IS NULL`)
	return queryRowJSON[model.LegalCaseDelayEvent](ctx, r.db, query, tenantID, matterID, eventID)
}

// UpdateDelayEvent edits the category and/or reason of an existing (non-deleted)
// delay-event register row (#13). category/reason are pointers: a nil pointer
// leaves that column unchanged. It always bumps updated_at. q may be a tx.
// Returns pgx.ErrNoRows when no matching live row exists.
func (r *CaseDelayRepository) UpdateDelayEvent(ctx context.Context, q Queryer, tenantID, matterID, eventID uuid.UUID, category *model.DelayCategory, reason *string) error {
	var categoryArg any
	if category != nil {
		categoryArg = string(*category)
	}
	var reasonArg any
	if reason != nil {
		reasonArg = strings.TrimSpace(*reason)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_delay_events
		SET category   = COALESCE($4, category),
		    reason     = COALESCE($5, reason),
		    updated_at = now()
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, matterID, eventID, categoryArg, reasonArg,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ReopenDelayEvent clears resolved_at on a previously-resolved delay window (#13),
// the inverse of ResolveDelayEvent. It only matches rows that are currently
// resolved (resolved_at IS NOT NULL) so a no-op reopen of an already-open window
// returns pgx.ErrNoRows. q may be a tx.
func (r *CaseDelayRepository) ReopenDelayEvent(ctx context.Context, q Queryer, tenantID, matterID, eventID uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_delay_events
		SET resolved_at = NULL, updated_at = now()
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3 AND deleted_at IS NULL AND resolved_at IS NOT NULL`,
		tenantID, matterID, eventID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ResolveDelayEvent closes an open delay-event window (CAP-086). q may be a tx.
func (r *CaseDelayRepository) ResolveDelayEvent(ctx context.Context, q Queryer, tenantID, matterID, eventID uuid.UUID, resolvedAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_delay_events
		SET resolved_at = $4, updated_at = now()
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3 AND deleted_at IS NULL AND resolved_at IS NULL`,
		tenantID, matterID, eventID, resolvedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ListDelayEvents returns a tenant + matter scoped, filtered, paginated listing.
func (r *CaseDelayRepository) ListDelayEvents(ctx context.Context, tenantID uuid.UUID, filters model.DelayEventListFilters) ([]model.LegalCaseDelayEvent, int, error) {
	args := []any{tenantID, filters.MatterID}
	arg := 3
	conditions := []string{"d.tenant_id = $1", "d.matter_id = $2", "d.deleted_at IS NULL"}
	if filters.Category != nil {
		conditions = append(conditions, fmt.Sprintf("d.category = $%d", arg))
		args = append(args, string(*filters.Category))
		arg++
	}
	if filters.OpenOnly {
		conditions = append(conditions, "d.resolved_at IS NULL")
	}
	if search := strings.TrimSpace(filters.Search); search != "" {
		conditions = append(conditions, fmt.Sprintf("d.reason ILIKE '%%' || $%d || '%%'", arg))
		args = append(args, search)
		arg++
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_case_delay_events d WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalCaseDelayEvent{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	orderCol := "t.opened_at"
	if mapped, ok := delayEventSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if strings.EqualFold(filters.SortDir, "asc") {
		orderDir = "ASC"
	}
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := delayEventJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalCaseDelayEvent](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// ListMatterTimelineSummaries returns the cross-matter (portfolio) timeline
// summary for a tenant (#15): one row per live matter with its key timeline
// signals plus the running open-delay-day total computed in SQL. open_delay_days
// is summed per delay window as floor((COALESCE(resolved_at, now()) - opened_at)
// in days), clamped to >= 0 — matching the in-Go computeOpenDelayDays semantics.
// The per-matter aggregate is a correlated LEFT JOIN subquery; this is the
// simplest correct approach and is fine at portfolio scale (a triage dashboard).
func (r *CaseDelayRepository) ListMatterTimelineSummaries(ctx context.Context, tenantID uuid.UUID, filters model.MatterTimelineSummaryFilters) ([]model.MatterTimelineSummary, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"m.tenant_id = $1", "m.deleted_at IS NULL"}
	if filters.OnHold != nil {
		conditions = append(conditions, fmt.Sprintf("COALESCE(m.external_hold, false) = $%d", arg))
		args = append(args, *filters.OnHold)
		arg++
	}
	where := strings.Join(conditions, " AND ")

	// The open-delay-day total per matter, matching computeOpenDelayDays.
	openDelayExpr := `COALESCE((
		SELECT SUM(GREATEST(FLOOR(EXTRACT(EPOCH FROM (COALESCE(d.resolved_at, now()) - d.opened_at)) / 86400), 0))
		FROM legal_case_delay_events d
		WHERE d.tenant_id = m.tenant_id AND d.matter_id = m.id AND d.deleted_at IS NULL
	), 0)::int`

	having := ""
	if filters.MinOpenDelayDays > 0 {
		having = fmt.Sprintf(" WHERE open_delay_days >= $%d", arg)
		args = append(args, filters.MinOpenDelayDays)
		arg++
	}

	base := `
		SELECT m.id AS matter_id, m.matter_number, m.title, m.status,
		       COALESCE(m.external_hold, false) AS external_hold,
		       m.external_hold_category, m.external_hold_since,
		       m.estimated_completion_date::timestamptz AS estimated_completion_date,
		       m.due_date::timestamptz AS due_date,
		       ` + openDelayExpr + ` AS open_delay_days,
		       m.updated_at
		FROM legal_matters m
		WHERE ` + where

	countQuery := "SELECT COUNT(*) FROM (" + base + ") s" + having
	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.MatterTimelineSummary{}, 0, nil
	}

	orderCol := "s.updated_at"
	if filters.SortColumn == "open_delay_days" {
		orderCol = "s.open_delay_days"
	}
	orderDir := "DESC"
	if strings.EqualFold(filters.SortDir, "asc") {
		orderDir = "ASC"
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	query := fmt.Sprintf(`
		SELECT row_to_json(s)
		FROM (%s) s%s
		ORDER BY %s %s, s.matter_id ASC
		LIMIT $%d OFFSET $%d`, base, having, orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.MatterTimelineSummary](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// InsertHoldHistory appends one immutable external-hold change row (#12). q may be
// a tx so it commits atomically with the legal_matters external_hold update.
func (r *CaseDelayRepository) InsertHoldHistory(ctx context.Context, q Queryer, row *model.LegalCaseHoldHistory) error {
	var categoryArg any
	if row.Category != nil {
		categoryArg = string(*row.Category)
	}
	var reasonArg any
	if row.Reason != nil {
		reasonArg = *row.Reason
	}
	query := `
		INSERT INTO legal_case_hold_history (id, tenant_id, matter_id, action, category, reason, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		row.ID, row.TenantID, row.MatterID, row.Action, categoryArg, reasonArg, row.CreatedBy,
	).Scan(&row.CreatedAt)
}

// ListHoldHistory returns the external-hold change trail for a matter, newest
// first (#12). It is a small per-matter audit listing (no pagination needed).
func (r *CaseDelayRepository) ListHoldHistory(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.LegalCaseHoldHistory, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT h.id, h.tenant_id, h.matter_id, h.action, h.category, h.reason,
			       h.created_by, h.created_at
			FROM legal_case_hold_history h
			WHERE h.tenant_id = $1 AND h.matter_id = $2
			ORDER BY h.created_at DESC
		) t`
	return queryListJSON[model.LegalCaseHoldHistory](ctx, r.db, query, tenantID, matterID)
}

func delayEventJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.matter_id, d.category, d.reason,
			       d.opened_at, d.resolved_at, (d.resolved_at IS NOT NULL) AS resolved,
			       COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_by, d.created_at, d.updated_at, d.deleted_at
			FROM legal_case_delay_events d
			WHERE ` + where + `
		) t`
}

func delayEventSortColumn(column string) (string, bool) {
	switch column {
	case "category":
		return "t.category", true
	case "opened_at":
		return "t.opened_at", true
	case "resolved_at":
		return "t.resolved_at", true
	case "created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
