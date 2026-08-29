package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// DetailedAnalyticsFilter is the repository's request-grain inclusive window.
type DetailedAnalyticsFilter struct {
	From       time.Time
	To         time.Time
	Department *string
	Priority   *string
	Type       *string
}

// RequestAnalyticsCounts is the count portion of one KPI snapshot.
type RequestAnalyticsCounts struct {
	Total   int
	Closed  int
	Pending int
}

// RequestAnalyticsSLA is the final/pending SLA observation set.
type RequestAnalyticsSLA struct {
	Resolved int
	OnTime   int
	Pending  int
}

const detailedAnalyticsUnspecified = "unspecified"

// normalizedDetailedDepartment is the canonical department bucket expression
// shared by dashboard grouping, top-level filtering, filter options and
// contributor drill-downs. NULL, empty and whitespace-only values all belong to
// the public "unspecified" bucket.
func normalizedDetailedDepartment(column string) string {
	return "COALESCE(NULLIF(BTRIM(" + column + "), ''), '" + detailedAnalyticsUnspecified + "')"
}

// requestAnalyticsWhere builds one parameterized legal_requests scope. To is an
// inclusive civil date in the API, therefore the SQL upper bound is the next
// midnight and strictly less-than.
func requestAnalyticsWhere(alias string, filter DetailedAnalyticsFilter, argStart int) (string, []any) {
	prefix := alias
	if prefix != "" && !strings.HasSuffix(prefix, ".") {
		prefix += "."
	}
	args := make([]any, 0, 5)
	idx := argStart
	where := fmt.Sprintf(" AND %screated_at >= $%d AND %screated_at < $%d", prefix, idx, prefix, idx+1)
	args = append(args, filter.From, filter.To.AddDate(0, 0, 1))
	idx += 2
	if filter.Department != nil {
		where += fmt.Sprintf(" AND %s = $%d", normalizedDetailedDepartment(prefix+"department"), idx)
		args = append(args, *filter.Department)
		idx++
	}
	if filter.Priority != nil {
		where += fmt.Sprintf(" AND %spriority = $%d", prefix, idx)
		args = append(args, *filter.Priority)
		idx++
	}
	if filter.Type != nil {
		where += fmt.Sprintf(" AND %srequest_type = $%d", prefix, idx)
		args = append(args, *filter.Type)
	}
	return where, args
}

func (r *ReportingRepository) DetailedRequestCounts(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) (RequestAnalyticsCounts, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	query := `
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE lr.status = 'closed')::int,
		       COUNT(*) FILTER (WHERE lr.status NOT IN ('closed', 'cancelled'))::int
		FROM legal_requests lr
		WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL` + where
	var out RequestAnalyticsCounts
	err := r.db.QueryRow(ctx, query, append([]any{tenantID}, args...)...).Scan(&out.Total, &out.Closed, &out.Pending)
	return out, err
}

// DetailedRequestProcessingDuration prefers working-calendar duration facts.
// It falls back to the execution source only when the fact table has no sample,
// preserving historical rows without mixing wall-clock and working-hour facts.
func (r *ReportingRepository) DetailedRequestProcessingDuration(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) (float64, int, error) {
	where, args := requestAnalyticsWhere("lr", filter, 3)
	query := `
		SELECT COALESCE(AVG(f.working_minutes) / 60.0, 0)::float8, COUNT(*)::int
		FROM lex_duration_facts f
		JOIN legal_requests lr ON lr.tenant_id = f.tenant_id AND lr.id = f.subject_id
		WHERE f.tenant_id = $1 AND f.kind = $2
		  AND lr.deleted_at IS NULL` + where
	var avg float64
	var sample int
	allArgs := append([]any{tenantID, model.DurationFactRequestProcessing}, args...)
	if err := r.db.QueryRow(ctx, query, allArgs...).Scan(&avg, &sample); err != nil {
		return 0, 0, err
	}
	if sample > 0 {
		return avg, sample, nil
	}

	where, args = requestAnalyticsWhere("lr", filter, 2)
	query = `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (es.delivered_at - es.clock_started_at)) / 3600.0), 0)::float8,
		       COUNT(*)::int
		FROM legal_request_execution_state es
		JOIN legal_requests lr ON lr.tenant_id = es.tenant_id AND lr.id = es.legal_request_id
		WHERE es.tenant_id = $1 AND lr.deleted_at IS NULL
		  AND es.clock_started_at IS NOT NULL AND es.delivered_at IS NOT NULL
		  AND es.delivered_at >= es.clock_started_at` + where
	err := r.db.QueryRow(ctx, query, append([]any{tenantID}, args...)...).Scan(&avg, &sample)
	return avg, sample, err
}

func (r *ReportingRepository) DetailedRequestSatisfaction(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) (float64, int, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	query := `
		SELECT COALESCE(AVG(f.rating), 0)::float8, COUNT(*)::int
		FROM legal_request_feedback f
		JOIN legal_requests lr ON lr.tenant_id = f.tenant_id AND lr.id = f.request_id
		WHERE f.tenant_id = $1 AND lr.deleted_at IS NULL` + where
	var avg float64
	var sample int
	err := r.db.QueryRow(ctx, query, append([]any{tenantID}, args...)...).Scan(&avg, &sample)
	return avg, sample, err
}

func (r *ReportingRepository) DetailedRequestSLA(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) (RequestAnalyticsSLA, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	// DISTINCT ON pins each request to its CURRENT cycle. Since 000110 a returned
	// and resubmitted request owns one clock per round, so a plain join would
	// count it once per round and inflate every figure here. 'stopped' cycles are
	// excluded by the outcome filters — a round the department handed back is
	// neither on-time nor breached.
	query := `
		SELECT COUNT(*) FILTER (WHERE c.outcome IN ('on_time', 'breached'))::int,
		       COUNT(*) FILTER (WHERE c.outcome = 'on_time')::int,
		       COUNT(*) FILTER (WHERE c.outcome = 'pending')::int
		FROM legal_requests lr
		JOIN (
			SELECT DISTINCT ON (tenant_id, legal_request_id) tenant_id, legal_request_id, outcome
			FROM legal_sla_clocks
			ORDER BY tenant_id, legal_request_id, cycle DESC
		) c ON c.tenant_id = lr.tenant_id AND c.legal_request_id = lr.id
		WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL` + where
	var out RequestAnalyticsSLA
	err := r.db.QueryRow(ctx, query, append([]any{tenantID}, args...)...).Scan(&out.Resolved, &out.OnTime, &out.Pending)
	return out, err
}

func (r *ReportingRepository) DetailedRequestTrend(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) (map[time.Time]int, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	query := `
		SELECT date_trunc('month', lr.created_at)::date AS month, COUNT(*)::int
		FROM legal_requests lr
		WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL` + where + `
		GROUP BY 1 ORDER BY 1`
	rows, err := r.db.Query(ctx, query, append([]any{tenantID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[time.Time]int)
	for rows.Next() {
		var month time.Time
		var count int
		if err := rows.Scan(&month, &count); err != nil {
			return nil, err
		}
		out[time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)] = count
	}
	return out, rows.Err()
}

func (r *ReportingRepository) detailedRequestGroup(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter, column string) ([]model.CountBucket, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	query := `SELECT ` + normalizedDetailedDepartment(column) + `, COUNT(*)::int
		FROM legal_requests lr
		WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL` + where + `
		GROUP BY 1 ORDER BY 2 DESC, 1 ASC`
	rows, err := r.db.Query(ctx, query, append([]any{tenantID}, args...)...)
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

func (r *ReportingRepository) DetailedRequestsByDepartment(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) ([]model.CountBucket, error) {
	return r.detailedRequestGroup(ctx, tenantID, filter, "lr.department")
}

func (r *ReportingRepository) DetailedRequestsByServiceType(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) ([]model.CountBucket, error) {
	return r.detailedRequestGroup(ctx, tenantID, filter, "lr.request_type")
}

// DetailedAdvisorPerformance resolves the actual downstream owner of the
// request's linked consultation, case, or contract-review intake and aggregates
// only those attributable requests.
func (r *ReportingRepository) DetailedAdvisorPerformance(ctx context.Context, tenantID uuid.UUID, filter DetailedAnalyticsFilter) ([]model.LegalAdvisorPerformance, error) {
	where, args := requestAnalyticsWhere("lr", filter, 2)
	query := `
		WITH scoped AS (
			SELECT lr.id, lr.tenant_id, lr.status, lr.subject_type, lr.subject_id
			FROM legal_requests lr
			WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL` + where + `
		), advisor_link AS (
			SELECT s.id AS request_id, c.advisor_id,
			       COALESCE(NULLIF(BTRIM(c.advisor_name), ''), c.advisor_id::text) AS advisor_name,
			       s.status
			FROM scoped s
			JOIN legal_consultations c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
			 AND (c.legal_request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('consultation', 'legal_consultation')))
			WHERE c.advisor_id IS NOT NULL OR NULLIF(BTRIM(c.advisor_name), '') IS NOT NULL
			UNION
			SELECT s.id, c.handling_officer_id,
			       COALESCE(NULLIF(BTRIM(c.responsible_lawyer), ''), c.handling_officer_id::text), s.status
			FROM scoped s
			JOIN legal_cases c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
			 AND (c.request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('case', 'legal_case')))
			WHERE c.handling_officer_id IS NOT NULL OR NULLIF(BTRIM(c.responsible_lawyer), '') IS NOT NULL
			UNION
			SELECT s.id, i.assigned_reviewer_id,
			       COALESCE(NULLIF(BTRIM(i.assigned_reviewer_name), ''), i.assigned_reviewer_id::text), s.status
			FROM scoped s
			JOIN lex_contract_intakes i ON i.tenant_id = s.tenant_id
			 AND s.subject_id = i.contract_id AND s.subject_type IN ('contract', 'legal_contract')
			WHERE i.assigned_reviewer_id IS NOT NULL OR NULLIF(BTRIM(i.assigned_reviewer_name), '') IS NOT NULL
		)
		SELECT a.advisor_id, MAX(a.advisor_name) AS advisor_name,
		       COUNT(DISTINCT a.request_id)::int AS total_requests,
		       COUNT(DISTINCT a.request_id) FILTER (WHERE a.status = 'closed')::int AS completed,
		       COUNT(DISTINCT a.request_id) FILTER (WHERE a.status NOT IN ('closed', 'cancelled'))::int AS active,
		       AVG(f.rating)::float8 AS avg_rating,
		       COUNT(DISTINCT f.id)::int AS rating_count,
		       COUNT(DISTINCT c.id) FILTER (WHERE c.outcome IN ('on_time', 'breached'))::int AS resolved_slas,
		       COUNT(DISTINCT c.id) FILTER (WHERE c.outcome = 'on_time')::int AS on_time_slas
		FROM advisor_link a
		LEFT JOIN legal_request_feedback f ON f.tenant_id = $1 AND f.request_id = a.request_id
		LEFT JOIN (
			SELECT DISTINCT ON (tenant_id, legal_request_id) id, tenant_id, legal_request_id, outcome
			FROM legal_sla_clocks
			ORDER BY tenant_id, legal_request_id, cycle DESC
		) c ON c.tenant_id = $1 AND c.legal_request_id = a.request_id
		GROUP BY a.advisor_id,
		         COALESCE(a.advisor_id::text, 'legacy:' || LOWER(BTRIM(a.advisor_name)))
		ORDER BY completed DESC, total_requests DESC, advisor_name ASC
		LIMIT 10`
	rows, err := r.db.Query(ctx, query, append([]any{tenantID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.LegalAdvisorPerformance, 0)
	for rows.Next() {
		var item model.LegalAdvisorPerformance
		var onTime int
		if err := rows.Scan(&item.AdvisorID, &item.AdvisorName, &item.TotalRequests,
			&item.Completed, &item.Active, &item.AverageRating, &item.RatingCount,
			&item.ResolvedSLAs, &onTime); err != nil {
			return nil, err
		}
		if item.ResolvedSLAs > 0 {
			rate := float64(onTime) / float64(item.ResolvedSLAs) * 100
			item.SLACompliance = &rate
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *ReportingRepository) DetailedAnalyticsFilterOptions(ctx context.Context, tenantID uuid.UUID) (model.DetailedAnalyticsFilterOptions, error) {
	read := func(column string, includeUnspecified bool) ([]string, error) {
		rows, err := r.db.Query(ctx, detailedAnalyticsFilterOptionQuery(column, includeUnspecified), tenantID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		values := make([]string, 0)
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				return nil, err
			}
			values = append(values, value)
		}
		return values, rows.Err()
	}
	departments, err := read("department", true)
	if err != nil {
		return model.DetailedAnalyticsFilterOptions{}, err
	}
	serviceTypes, err := read("request_type", false)
	if err != nil {
		return model.DetailedAnalyticsFilterOptions{}, err
	}
	priorities, err := read("priority", false)
	if err != nil {
		return model.DetailedAnalyticsFilterOptions{}, err
	}
	return model.DetailedAnalyticsFilterOptions{Departments: departments, ServiceTypes: serviceTypes, Priorities: priorities}, nil
}

func detailedAnalyticsFilterOptionQuery(column string, includeUnspecified bool) string {
	expression := "BTRIM(" + column + ")"
	nonBlank := " AND NULLIF(BTRIM(" + column + "), '') IS NOT NULL"
	if includeUnspecified {
		expression = normalizedDetailedDepartment(column)
		nonBlank = ""
	}
	return `SELECT DISTINCT ` + expression + `
		FROM legal_requests WHERE tenant_id = $1 AND deleted_at IS NULL` + nonBlank + ` ORDER BY 1`
}
