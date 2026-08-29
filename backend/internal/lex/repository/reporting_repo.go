package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ReportingRepository is the READ-only analytics repository for Phase 4
// (CAP-133..151). Most methods compute aggregates directly from the Phase-0..3
// source tables (legal_cases, legal_investigations, contracts,
// legal_consultations, legal_requests / legal_request_execution_state,
// legal_sla_clocks). The flagship SLA compliance
// read uses lex_duration_facts so C-2 transition coverage is visible in the KPI.
// This repository performs NO writes.
//
// Time-window / scope filters are applied with parameterized predicates assembled
// by a small helper so all queries share identical, injection-safe filter logic.
type ReportingRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewReportingRepository(db *pgxpool.Pool, logger zerolog.Logger) *ReportingRepository {
	return &ReportingRepository{db: db, logger: logger.With().Str("repository", "lex-reporting").Logger()}
}

// ReportFilter is the resolved, parameterized scope for one query. argStart is the
// 1-based positional index of the FIRST filter argument (tenant_id is always $1).
type ReportFilter struct {
	from       *time.Time
	to         *time.Time
	department *string
	status     *string
	typ        *string
}

func NewReportFilter(f model.ReportFilters) ReportFilter {
	return ReportFilter{from: f.From, to: f.To, department: f.Department, status: f.Status, typ: f.Type}
}

// where appends parameterized predicates for the configured filters against the
// given column names, starting positional placeholders at argStart. Returns the
// combined SQL fragment (each predicate ANDed, leading " AND " when non-empty)
// and the matching args in order. Pass "" for a column to skip that dimension.
func (rf ReportFilter) where(tsCol, deptCol, statusCol, typeCol string, argStart int) (string, []any) {
	sql := ""
	args := make([]any, 0, 5)
	idx := argStart
	if rf.from != nil && tsCol != "" {
		sql += " AND " + tsCol + " >= $" + itoa(idx)
		args = append(args, *rf.from)
		idx++
	}
	if rf.to != nil && tsCol != "" {
		sql += " AND " + tsCol + " <= $" + itoa(idx)
		args = append(args, *rf.to)
		idx++
	}
	if rf.department != nil && deptCol != "" {
		sql += " AND " + deptCol + " = $" + itoa(idx)
		args = append(args, *rf.department)
		idx++
	}
	if rf.status != nil && statusCol != "" {
		sql += " AND " + statusCol + " = $" + itoa(idx)
		args = append(args, *rf.status)
		idx++
	}
	if rf.typ != nil && typeCol != "" {
		sql += " AND " + typeCol + " = $" + itoa(idx)
		args = append(args, *rf.typ)
		idx++
	}
	return sql, args
}

// groupCount runs a tenant-scoped, filtered "SELECT col, COUNT(*) GROUP BY col"
// and returns ordered CountBucket rows. col is a trusted, hard-coded column name.
func (r *ReportingRepository) groupCount(ctx context.Context, tenantID uuid.UUID, table, col, tsCol, deptCol, statusCol, typeCol string, rf ReportFilter) ([]model.CountBucket, error) {
	filterSQL, filterArgs := rf.where(tsCol, deptCol, statusCol, typeCol, 2)
	query := "SELECT COALESCE(NULLIF(" + col + "::text, ''), 'unspecified') AS k, COUNT(*) AS c FROM " + table +
		" WHERE tenant_id = $1 AND deleted_at IS NULL" + filterSQL +
		" GROUP BY 1 ORDER BY c DESC, k ASC"
	args := append([]any{tenantID}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.CountBucket, 0)
	for rows.Next() {
		var b model.CountBucket
		if err := rows.Scan(&b.Key, &b.Count); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// scalarCount runs a tenant-scoped, filtered COUNT(*) with an optional extra
// predicate (already parameterized against positional args appended after the
// filter args; extraArgs are bound in order).
func (r *ReportingRepository) scalarCount(ctx context.Context, tenantID uuid.UUID, table, tsCol, deptCol, statusCol, typeCol, extraPredicate string, rf ReportFilter) (int, error) {
	filterSQL, filterArgs := rf.where(tsCol, deptCol, statusCol, typeCol, 2)
	query := "SELECT COUNT(*) FROM " + table + " WHERE tenant_id = $1 AND deleted_at IS NULL" + filterSQL
	if extraPredicate != "" {
		query += " AND " + extraPredicate
	}
	args := append([]any{tenantID}, filterArgs...)
	var count int
	if err := r.db.QueryRow(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// --- CASE reports (CAP-133..138) -------------------------------------------

func (r *ReportingRepository) CaseTotal(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_cases", "created_at", "department", "status", "case_type", "", rf)
}

func (r *ReportingRepository) CasesByType(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_cases", "case_type", "created_at", "department", "status", "case_type", rf)
}

func (r *ReportingRepository) CasesByDepartment(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_cases", "department", "created_at", "department", "status", "case_type", rf)
}

func (r *ReportingRepository) CasesByStatus(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_cases", "status", "created_at", "department", "status", "case_type", rf)
}

func (r *ReportingRepository) CasesByCompanyStatus(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_cases", "company_status", "created_at", "department", "status", "case_type", rf)
}

func (r *ReportingRepository) CaseStatusCount(ctx context.Context, tenantID uuid.UUID, status string, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_cases", "created_at", "department", "", "case_type", "status = '"+sqlIdentLiteral(status)+"'", rf)
}

// CasesResolvedBetween counts distinct cases that actually transitioned to
// closed in the half-open [from,to) window. It intentionally reads the immutable
// lifecycle audit log rather than filtering legal_cases.created_at (which would
// answer the different and misleading question "cases created in the window
// that happen to be closed now").
func (r *ReportingRepository) CasesResolvedBetween(ctx context.Context, tenantID uuid.UUID, from, to time.Time) (int, error) {
	const query = `
		SELECT COUNT(DISTINCT audit.case_id)
		FROM legal_case_audit_log audit
		JOIN legal_cases cases
		  ON cases.tenant_id = audit.tenant_id
		 AND cases.id = audit.case_id
		 AND cases.deleted_at IS NULL
		WHERE audit.tenant_id = $1
		  AND audit.to_status = 'closed'
		  AND audit.created_at >= $2
		  AND audit.created_at < $3`
	var count int
	if err := r.db.QueryRow(ctx, query, tenantID, from, to).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// CasesExpectedResolutionBetween counts live cases whose expected resolution
// falls in the half-open [from,to) window. The case-manager dashboard uses this
// as its forward-looking 30-day workload signal; rows without an expected
// resolution date do not contribute.
func (r *ReportingRepository) CasesExpectedResolutionBetween(ctx context.Context, tenantID uuid.UUID, from, to time.Time) (int, error) {
	return casesExpectedResolutionBetween(ctx, r.db, tenantID, from, to)
}

func casesExpectedResolutionBetween(ctx context.Context, q Queryer, tenantID uuid.UUID, from, to time.Time) (int, error) {
	const query = `
		SELECT COUNT(*)
		FROM legal_cases
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND status NOT IN ('closed', 'cancelled')
		  AND expected_resolution_date >= $2
		  AND expected_resolution_date < $3`
	var count int
	if err := q.QueryRow(ctx, query, tenantID, from, to).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// InvestigationStatusCounts returns exact full-portfolio status buckets. The
// caller derives total/ongoing from these buckets; no paginated list limit can
// truncate either KPI.
func (r *ReportingRepository) InvestigationStatusCounts(ctx context.Context, tenantID uuid.UUID) ([]model.CountBucket, error) {
	return r.groupCount(
		ctx,
		tenantID,
		"legal_investigations",
		"status",
		"created_at",
		"department",
		"status",
		"",
		ReportFilter{},
	)
}

// InvestigationCaseTypeCounts groups investigations by the type of their linked
// legal case. Unlinked investigations (and investigations linked to a removed
// case) are retained in an "unspecified" bucket so the distribution always sums
// to the full investigation portfolio.
func (r *ReportingRepository) InvestigationCaseTypeCounts(ctx context.Context, tenantID uuid.UUID) ([]model.CountBucket, error) {
	return investigationCaseTypeCounts(ctx, r.db, tenantID)
}

func investigationCaseTypeCounts(ctx context.Context, q Queryer, tenantID uuid.UUID) ([]model.CountBucket, error) {
	const query = `
		SELECT COALESCE(NULLIF(c.case_type, ''), 'unspecified') AS key,
		       COUNT(*) AS count
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL
		GROUP BY 1
		ORDER BY count DESC, key ASC`
	rows, err := q.Query(ctx, query, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.CountBucket, 0)
	for rows.Next() {
		var bucket model.CountBucket
		if err := rows.Scan(&bucket.Key, &bucket.Count); err != nil {
			return nil, err
		}
		out = append(out, bucket)
	}
	return out, rows.Err()
}

// InvestigationCaseTypes resolves the linked legal-case type for a bounded set
// of investigation IDs. Both sides of the join are tenant-scoped; unlinked rows
// are omitted so callers can represent case_type as an optional field.
func (r *ReportingRepository) InvestigationCaseTypes(ctx context.Context, tenantID uuid.UUID, investigationIDs []uuid.UUID) (map[uuid.UUID]string, error) {
	return investigationCaseTypes(ctx, r.db, tenantID, investigationIDs)
}

func investigationCaseTypes(ctx context.Context, q Queryer, tenantID uuid.UUID, investigationIDs []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string)
	if len(investigationIDs) == 0 {
		return out, nil
	}
	const query = `
		SELECT i.id, c.case_type
		FROM legal_investigations i
		JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL
		  AND i.id = ANY($2::uuid[])
		  AND NULLIF(c.case_type, '') IS NOT NULL`
	rows, err := q.Query(ctx, query, tenantID, investigationIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var caseType string
		if err := rows.Scan(&id, &caseType); err != nil {
			return nil, err
		}
		out[id] = caseType
	}
	return out, rows.Err()
}

// --- INVESTIGATION reports -------------------------------------------------

// Investigation report category is explicitly classified metadata first. Older
// rows predate that field, so their linked legal-case type is the stable fallback.
// Keep this expression identical in every aggregate and list query so a type
// filter cannot produce internally inconsistent report sections.
const investigationReportCategorySQL = "COALESCE(NULLIF(BTRIM(i.metadata->>'category'), ''), NULLIF(BTRIM(c.case_type), ''), 'unspecified')"

type InvestigationReportSummary struct {
	Total                      int
	Closed                     int
	AvgOpenAgeDays             float64
	AvgRegisterToApprovedHours float64
	ApprovalSampleSize         int
}

func investigationReportFilter(rf ReportFilter, argStart int) (string, []any) {
	return rf.where("i.created_at", "i.department", "i.status", investigationReportCategorySQL, argStart)
}

// InvestigationReportSummary computes headline counts/ageing and the
// register->approved working-time duration. Approval duration reads the
// immutable investigation_resolution fact, and explicitly excludes the
// zero-length placeholder written when an investigation is first registered.
func (r *ReportingRepository) InvestigationReportSummary(ctx context.Context, tenantID uuid.UUID, asOf time.Time, rf ReportFilter) (InvestigationReportSummary, error) {
	return investigationReportSummary(ctx, r.db, tenantID, asOf, rf)
}

func investigationReportSummary(ctx context.Context, q Queryer, tenantID uuid.UUID, asOf time.Time, rf ReportFilter) (InvestigationReportSummary, error) {
	filterSQL, filterArgs := investigationReportFilter(rf, 3)
	query := `
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE i.status IN ('approved', 'closed', 'cancelled'))::int,
		       COALESCE(AVG(GREATEST(EXTRACT(EPOCH FROM ($2 - i.created_at)) / 86400.0, 0))
		           FILTER (WHERE i.status NOT IN ('approved', 'closed', 'cancelled')), 0)::float8,
		       COALESCE(AVG(f.working_minutes / 60.0)
		           FILTER (WHERE f.ended_at > f.started_at), 0)::float8,
		       COUNT(f.id) FILTER (WHERE f.ended_at > f.started_at)::int
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		LEFT JOIN lex_duration_facts f
		  ON f.tenant_id = i.tenant_id
		 AND f.subject_id = i.id
		 AND f.kind = 'investigation_resolution'
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL` + filterSQL
	args := append([]any{tenantID, asOf}, filterArgs...)
	var summary InvestigationReportSummary
	err := q.QueryRow(ctx, query, args...).Scan(
		&summary.Total,
		&summary.Closed,
		&summary.AvgOpenAgeDays,
		&summary.AvgRegisterToApprovedHours,
		&summary.ApprovalSampleSize,
	)
	return summary, err
}

func (r *ReportingRepository) InvestigationsByStatus(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	filterSQL, filterArgs := investigationReportFilter(rf, 2)
	query := `
		SELECT i.status::text AS key, COUNT(*)::int AS count
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL` + filterSQL + `
		GROUP BY i.status
		ORDER BY count DESC, key ASC`
	return r.investigationCountBuckets(ctx, query, append([]any{tenantID}, filterArgs...)...)
}

func (r *ReportingRepository) InvestigationsByCategory(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	filterSQL, filterArgs := investigationReportFilter(rf, 2)
	query := `
		SELECT ` + investigationReportCategorySQL + ` AS key, COUNT(*)::int AS count
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL` + filterSQL + `
		GROUP BY 1
		ORDER BY count DESC, key ASC`
	return r.investigationCountBuckets(ctx, query, append([]any{tenantID}, filterArgs...)...)
}

// InvestigationSLAOutcomes returns the latest investigation clock per record.
// The explicit service-code predicate prevents an unrelated polymorphic clock
// from contributing even in the event of a subject UUID collision.
func (r *ReportingRepository) InvestigationSLAOutcomes(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	filterSQL, filterArgs := investigationReportFilter(rf, 2)
	query := `
		SELECT latest.outcome::text AS key, COUNT(*)::int AS count
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		JOIN LATERAL (
			SELECT clock.outcome
			FROM legal_sla_clocks clock
			WHERE clock.tenant_id = i.tenant_id
			  AND clock.legal_request_id = i.id
			  AND clock.service_code = 'legal_investigation'
			ORDER BY clock.cycle DESC, clock.created_at DESC
			LIMIT 1
		) latest ON TRUE
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL` + filterSQL + `
		GROUP BY latest.outcome
		ORDER BY count DESC, key ASC`
	return r.investigationCountBuckets(ctx, query, append([]any{tenantID}, filterArgs...)...)
}

// InvestigationReportItems returns a capped, non-sensitive drill-down list.
// The route is report-readable, so selecting encrypted PII fields here would be
// a permission escalation; this query deliberately never touches them.
func (r *ReportingRepository) InvestigationReportItems(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int, rf ReportFilter) ([]model.InvestigationReportItem, error) {
	return investigationReportItems(ctx, r.db, tenantID, asOf, limit, rf)
}

func investigationReportItems(ctx context.Context, q Queryer, tenantID uuid.UUID, asOf time.Time, limit int, rf ReportFilter) ([]model.InvestigationReportItem, error) {
	if limit <= 0 {
		return []model.InvestigationReportItem{}, nil
	}
	filterSQL, filterArgs := investigationReportFilter(rf, 3)
	limitPlaceholder := itoa(3 + len(filterArgs))
	query := `
		SELECT i.id,
		       i.investigation_number,
		       i.status,
		       ` + investigationReportCategorySQL + ` AS category,
		       i.priority,
		       i.department,
		       i.created_at,
		       CASE WHEN i.status = 'approved' THEN f.ended_at ELSE i.closed_at END AS resolved_at,
		       GREATEST(EXTRACT(EPOCH FROM (
		           COALESCE(CASE WHEN i.status = 'approved' THEN f.ended_at ELSE i.closed_at END, $2) - i.created_at
		       )) / 86400.0, 0)::float8 AS age_days,
		       latest.outcome
		FROM legal_investigations i
		LEFT JOIN legal_cases c
		  ON c.tenant_id = i.tenant_id
		 AND c.id = i.case_id
		 AND c.deleted_at IS NULL
		LEFT JOIN lex_duration_facts f
		  ON f.tenant_id = i.tenant_id
		 AND f.subject_id = i.id
		 AND f.kind = 'investigation_resolution'
		 AND f.ended_at > f.started_at
		LEFT JOIN LATERAL (
			SELECT clock.outcome
			FROM legal_sla_clocks clock
			WHERE clock.tenant_id = i.tenant_id
			  AND clock.legal_request_id = i.id
			  AND clock.service_code = 'legal_investigation'
			ORDER BY clock.cycle DESC, clock.created_at DESC
			LIMIT 1
		) latest ON TRUE
		WHERE i.tenant_id = $1
		  AND i.deleted_at IS NULL` + filterSQL + `
		ORDER BY i.created_at DESC, i.id ASC
		LIMIT $` + limitPlaceholder
	args := append([]any{tenantID, asOf}, filterArgs...)
	args = append(args, limit)
	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.InvestigationReportItem, 0)
	for rows.Next() {
		var item model.InvestigationReportItem
		var department sql.NullString
		var resolvedAt sql.NullTime
		var slaOutcome sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.InvestigationNumber,
			&item.Status,
			&item.Category,
			&item.Priority,
			&department,
			&item.CreatedAt,
			&resolvedAt,
			&item.AgeDays,
			&slaOutcome,
		); err != nil {
			return nil, err
		}
		item.Department = optionalTrimmedString(department)
		if resolvedAt.Valid {
			resolved := resolvedAt.Time.UTC()
			item.ResolvedAt = &resolved
		}
		if outcome := optionalSLAOutcome(slaOutcome); outcome != nil {
			item.SLAOutcome = outcome
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *ReportingRepository) investigationCountBuckets(ctx context.Context, query string, args ...any) ([]model.CountBucket, error) {
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.CountBucket, 0)
	for rows.Next() {
		var bucket model.CountBucket
		if err := rows.Scan(&bucket.Key, &bucket.Count); err != nil {
			return nil, err
		}
		out = append(out, bucket)
	}
	return out, rows.Err()
}

// --- CONTRACT reports (CAP-139..142) ---------------------------------------

func (r *ReportingRepository) ContractTotal(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "contracts", "created_at", "department", "status", "type", "", rf)
}

func (r *ReportingRepository) ContractsByDepartment(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "contracts", "department", "created_at", "department", "status", "type", rf)
}

func (r *ReportingRepository) ContractsByType(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "contracts", "type", "created_at", "department", "status", "type", rf)
}

func (r *ReportingRepository) ContractsByStatus(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "contracts", "status", "created_at", "department", "status", "type", rf)
}

// ApprovedContractCount counts contracts that have reached an approved/active
// lifecycle state (status in active/renewed) within the window — the numerator of
// the approved-contract ratio (CAP-148).
func (r *ReportingRepository) ApprovedContractCount(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "contracts", "created_at", "department", "", "type", "status IN ('active', 'renewed')", rf)
}

// ContractResolvedCount counts contracts that have reached a SETTLED/terminal
// lifecycle state (status in active/expired/terminated/renewed — past the
// draft/review/negotiation/pending_signature pipeline; suspended and cancelled
// are NOT resolved). This is the resolution-rate numerator for contracts and is
// intentionally broader than ApprovedContractCount (active/renewed only).
func (r *ReportingRepository) ContractResolvedCount(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "contracts", "created_at", "department", "", "type", "status IN ('active', 'expired', 'terminated', 'renewed')", rf)
}

// ContractReviewDuration returns the average review turnaround in WALL-CLOCK hours
// and the sample size, computed from contracts that reached an active/approved
// status (created_at -> status_changed_at). This is the source-table primary read
// (CAP-140); the service refines it with duration_fact working-hours when present.
func (r *ReportingRepository) ContractReviewDuration(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (avgHours float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("created_at", "department", "", "type", 2)
	query := `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (status_changed_at - created_at)) / 3600.0), 0)::float8 AS avg_hours,
		       COUNT(*) AS sample
		FROM contracts
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND status_changed_at IS NOT NULL
		  AND status_changed_at >= created_at
		  AND status IN ('active', 'renewed')` + filterSQL
	args := append([]any{tenantID}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avgHours, &sample); err != nil {
		return 0, 0, err
	}
	return avgHours, sample, nil
}

// --- CONSULTATION reports (CAP-143..145) -----------------------------------

func (r *ReportingRepository) ConsultationTotal(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_consultations", "created_at", "department", "status", "type", "", rf)
}

func (r *ReportingRepository) ConsultationsByDepartment(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_consultations", "department", "created_at", "department", "status", "type", rf)
}

func (r *ReportingRepository) ConsultationsByType(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_consultations", "type", "created_at", "department", "status", "type", rf)
}

func (r *ReportingRepository) ConsultationsByStatus(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.CountBucket, error) {
	return r.groupCount(ctx, tenantID, "legal_consultations", "status", "created_at", "department", "status", "type", rf)
}

// ConsultationResolvedCount counts advisory consultations that have reached a
// resolved state (status in responded/approved/archived) — the resolution-rate
// numerator for advisory.
func (r *ReportingRepository) ConsultationResolvedCount(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_consultations", "created_at", "department", "", "type", "status IN ('responded', 'approved', 'archived')", rf)
}

// ConsultationCompletionDuration returns the average completion turnaround in
// WALL-CLOCK hours (created_at -> responded_at) and the sample size, over
// consultations that have been responded (CAP-145).
func (r *ReportingRepository) ConsultationCompletionDuration(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (avgHours float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("created_at", "department", "", "type", 2)
	query := `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 3600.0), 0)::float8 AS avg_hours,
		       COUNT(*) AS sample
		FROM legal_consultations
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND responded_at IS NOT NULL
		  AND responded_at >= created_at` + filterSQL
	args := append([]any{tenantID}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avgHours, &sample); err != nil {
		return 0, 0, err
	}
	return avgHours, sample, nil
}

// --- LEGAL REQUEST resolution counts ---------------------------------------

// LegalRequestTotal counts all legal_requests for the tenant (soft-delete aware).
func (r *ReportingRepository) LegalRequestTotal(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_requests", "created_at", "", "status", "", "", rf)
}

// LegalRequestResolvedCount counts legal_requests that have reached a terminal
// fulfilled state (status in delivered/closed) — the resolution-rate numerator
// for requests.
func (r *ReportingRepository) LegalRequestResolvedCount(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	return r.scalarCount(ctx, tenantID, "legal_requests", "created_at", "", "", "", "status IN ('delivered', 'closed')", rf)
}

// --- PERFORMANCE KPIs (CAP-146..150) ---------------------------------------

// RequestProcessingDuration returns the average request processing time in
// WALL-CLOCK hours (clock_started_at -> delivered_at) and the sample size, over
// legal_request_execution_state rows that have been delivered (CAP-146). Note:
// legal_request_execution_state has no deleted_at column, so this query does NOT
// filter on soft-delete.
func (r *ReportingRepository) RequestProcessingDuration(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (avgHours float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("clock_started_at", "", "status", "", 2)
	query := `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - clock_started_at)) / 3600.0), 0)::float8 AS avg_hours,
		       COUNT(*) AS sample
		FROM legal_request_execution_state
		WHERE tenant_id = $1
		  AND clock_started_at IS NOT NULL
		  AND delivered_at IS NOT NULL
		  AND delivered_at >= clock_started_at` + filterSQL
	args := append([]any{tenantID}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avgHours, &sample); err != nil {
		return 0, 0, err
	}
	return avgHours, sample, nil
}

// OverdueRequestCount counts breached SLA clocks (CAP-149) within the window.
// legal_sla_clocks has no deleted_at column.
func (r *ReportingRepository) OverdueRequestCount(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (int, error) {
	filterSQL, filterArgs := rf.where("clock_started_at", "", "", "", 2)
	// COUNT(DISTINCT legal_request_id), not COUNT(*): since 000110 a returned and
	// resubmitted request owns one clock per round, and if two rounds both breach
	// the same request would otherwise be reported as two overdue requests.
	query := `SELECT COUNT(DISTINCT legal_request_id) FROM legal_sla_clocks
		WHERE tenant_id = $1 AND breached = true` + filterSQL
	args := append([]any{tenantID}, filterArgs...)
	var count int
	if err := r.db.QueryRow(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// SLAOutcomeCounts returns (resolvedClocks, onTimeClocks) over legal_sla_clocks
// within the window — the basis for estimated-duration adherence (CAP-150). A
// clock is "resolved" once its outcome is final (on_time or breached).
func (r *ReportingRepository) SLAOutcomeCounts(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (resolved int, onTime int, err error) {
	filterSQL, filterArgs := rf.where("clock_started_at", "", "", "", 2)
	query := `
		SELECT
			COUNT(*) FILTER (WHERE outcome IN ('on_time', 'breached')) AS resolved,
			COUNT(*) FILTER (WHERE outcome = 'on_time') AS on_time
		FROM legal_sla_clocks
		WHERE tenant_id = $1` + filterSQL
	args := append([]any{tenantID}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&resolved, &onTime); err != nil {
		return 0, 0, err
	}
	return resolved, onTime, nil
}

// DurationFactSLAOutcomeCounts returns resolved/on-time counts from
// request-processing duration facts. It lets KPI surfaces prefer C-2 facts while
// retaining SLAOutcomeCounts as a compatibility fallback when no facts exist.
func (r *ReportingRepository) DurationFactSLAOutcomeCounts(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (resolved int, onTime int, err error) {
	filterSQL, filterArgs := rf.where("started_at", "department", "sla_outcome", "category", 3)
	query := `
		SELECT
			COUNT(*) FILTER (WHERE sla_outcome IN ('on_time', 'breached')) AS resolved,
			COUNT(*) FILTER (WHERE sla_outcome = 'on_time') AS on_time
		FROM lex_duration_facts
		WHERE tenant_id = $1
		  AND kind = $2` + filterSQL
	args := append([]any{tenantID, model.DurationFactRequestProcessing}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&resolved, &onTime); err != nil {
		return 0, 0, err
	}
	return resolved, onTime, nil
}

// --- FLAGSHIP: SLA compliance (CAP-151) ------------------------------------

// SLAClockOutcome is a minimal projection of a single SLA clock. It remains for
// secondary diagnostics; the flagship CAP-151 KPI reads duration facts instead.
type SLAClockOutcome struct {
	ClockStartedAt time.Time
	Outcome        string
}

// ListSLAClockOutcomes streams the (clock_started_at, outcome) of every SLA clock
// for the tenant within the window, oldest first.
func (r *ReportingRepository) ListSLAClockOutcomes(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]SLAClockOutcome, error) {
	filterSQL, filterArgs := rf.where("clock_started_at", "", "", "", 2)
	query := `
		SELECT clock_started_at, outcome
		FROM legal_sla_clocks
		WHERE tenant_id = $1` + filterSQL + `
		ORDER BY clock_started_at ASC`
	args := append([]any{tenantID}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SLAClockOutcome, 0)
	for rows.Next() {
		var o SLAClockOutcome
		if err := rows.Scan(&o.ClockStartedAt, &o.Outcome); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ListDurationFactSLAOutcomes streams request-processing duration facts that
// carry an SLA outcome. This is the CAP-151 source for quarterly compliance.
func (r *ReportingRepository) ListDurationFactSLAOutcomes(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) ([]model.DurationFactSLAOutcome, error) {
	filterSQL, filterArgs := rf.where("started_at", "department", "sla_outcome", "category", 3)
	query := `
		SELECT started_at, sla_outcome
		FROM lex_duration_facts
		WHERE tenant_id = $1
		  AND kind = $2
		  AND sla_outcome IS NOT NULL` + filterSQL + `
		ORDER BY started_at ASC`
	args := append([]any{tenantID, model.DurationFactRequestProcessing}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.DurationFactSLAOutcome, 0)
	for rows.Next() {
		var (
			o   model.DurationFactSLAOutcome
			raw string
		)
		if err := rows.Scan(&o.StartedAt, &raw); err != nil {
			return nil, err
		}
		o.StartedAt = o.StartedAt.UTC()
		o.SLAOutcome = model.SLAClockOutcome(raw)
		if o.SLAOutcome.Valid() {
			out = append(out, o)
		}
	}
	return out, rows.Err()
}

// ListTenantIDs returns the distinct tenant IDs that have any legal-case,
// contract, consultation, or SLA-clock rows — used by any cross-tenant report
// fan-out (mirrors ContractRepository.ListTenantIDs).
func (r *ReportingRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT tenant_id FROM legal_cases WHERE deleted_at IS NULL
		UNION
		SELECT DISTINCT tenant_id FROM contracts WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// itoa is a tiny, allocation-light int->string for positional placeholders.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// sqlIdentLiteral defensively strips single quotes from a hard-coded status
// constant before embedding it. Statuses passed here are caller-controlled
// constants (e.g. "closed", "under_procedure"), never user input.
func sqlIdentLiteral(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' || s[i] == ';' {
			continue
		}
		out = append(out, s[i])
	}
	return string(out)
}
