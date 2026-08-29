package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// DetailedAnalyticsContributorQuery selects one KPI or chart bucket from the
// same request scope used by DetailedAnalytics.
type DetailedAnalyticsContributorQuery struct {
	Dimension string
	Key       string
	Keys      []string
	Month     *time.Time
	AdvisorID *uuid.UUID
	Page      int
	PerPage   int
}

// DetailedAnalyticsContributors returns the source observations behind one
// dashboard aggregate. Average/rate metrics intentionally return their actual
// fact, feedback, or SLA rows rather than every request in the surrounding
// period, so the drawer count matches the metric's sample size.
func (r *ReportingRepository) DetailedAnalyticsContributors(
	ctx context.Context,
	tenantID uuid.UUID,
	filter DetailedAnalyticsFilter,
	drilldown DetailedAnalyticsContributorQuery,
) ([]model.DetailedAnalyticsContributor, int, error) {
	where, filterArgs := requestAnalyticsWhere("lr", filter, 2)
	args := append([]any{tenantID}, filterArgs...)
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	const scopedCTE = `
		WITH scoped AS (
			SELECT lr.id, lr.tenant_id, lr.request_number, lr.title, lr.department,
			       lr.request_type, lr.priority, lr.status, lr.requester_name,
			       lr.created_at, lr.subject_type, lr.subject_id
			FROM legal_requests lr
			WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL`
	const contributorColumns = `
		s.id, s.request_number, s.title, s.department, s.request_type,
		s.priority, s.status, s.requester_name, s.created_at`
	const emptyObservationColumns = `
		NULL::float8 AS processing_hours,
		NULL::int AS satisfaction_rating,
		NULL::text AS sla_outcome,
		NULL::uuid AS advisor_id,
		NULL::text AS advisor_name`

	base := scopedCTE + where + `
		)`
	var contributorCTEs string

	switch drilldown.Dimension {
	case "metric":
		switch drilldown.Key {
		case "total_requests", "completion_rate":
			contributorCTEs = `, contributors AS (
				SELECT ` + contributorColumns + `, ` + emptyObservationColumns + `
				FROM scoped s
			)`
		case "pending_requests":
			contributorCTEs = `, contributors AS (
				SELECT ` + contributorColumns + `, ` + emptyObservationColumns + `
				FROM scoped s
				WHERE s.status NOT IN ('closed', 'cancelled')
			)`
		case "avg_processing_hours":
			kindArg := addArg(model.DurationFactRequestProcessing)
			contributorCTEs = `, fact_rows AS (
				SELECT s.id, s.request_number, s.title, s.department, s.request_type,
				       s.priority, s.status, s.requester_name, s.created_at,
				       f.working_minutes::float8 / 60.0 AS processing_hours
				FROM scoped s
				JOIN lex_duration_facts f
				  ON f.tenant_id = s.tenant_id AND f.subject_id = s.id
				WHERE f.kind = ` + kindArg + `
			), contributors AS (
				SELECT f.id, f.request_number, f.title, f.department, f.request_type,
				       f.priority, f.status, f.requester_name, f.created_at,
				       f.processing_hours,
				       NULL::int AS satisfaction_rating,
				       NULL::text AS sla_outcome,
				       NULL::uuid AS advisor_id,
				       NULL::text AS advisor_name
				FROM fact_rows f
				UNION ALL
				SELECT ` + contributorColumns + `,
				       EXTRACT(EPOCH FROM (es.delivered_at - es.clock_started_at))::float8 / 3600.0,
				       NULL::int, NULL::text, NULL::uuid, NULL::text
				FROM scoped s
				JOIN legal_request_execution_state es
				  ON es.tenant_id = s.tenant_id AND es.legal_request_id = s.id
				WHERE NOT EXISTS (SELECT 1 FROM fact_rows)
				  AND es.clock_started_at IS NOT NULL
				  AND es.delivered_at IS NOT NULL
				  AND es.delivered_at >= es.clock_started_at
			)`
		case "satisfaction_score":
			contributorCTEs = `, contributors AS (
				SELECT ` + contributorColumns + `,
				       NULL::float8 AS processing_hours,
				       f.rating::int AS satisfaction_rating,
				       NULL::text AS sla_outcome,
				       NULL::uuid AS advisor_id,
				       NULL::text AS advisor_name
				FROM scoped s
				JOIN legal_request_feedback f
				  ON f.tenant_id = s.tenant_id AND f.request_id = s.id
			)`
		case "sla_compliance":
			contributorCTEs = `, contributors AS (
				SELECT ` + contributorColumns + `,
				       NULL::float8 AS processing_hours,
				       NULL::int AS satisfaction_rating,
				       c.outcome::text AS sla_outcome,
				       NULL::uuid AS advisor_id,
				       NULL::text AS advisor_name
				FROM scoped s
				JOIN legal_sla_clocks c
				  ON c.tenant_id = s.tenant_id AND c.legal_request_id = s.id
				WHERE c.outcome IN ('on_time', 'breached')
			)`
		default:
			return nil, 0, fmt.Errorf("unsupported detailed analytics metric %q", drilldown.Key)
		}
	case "month":
		if drilldown.Month == nil {
			return nil, 0, fmt.Errorf("month drilldown requires a month")
		}
		monthArg := addArg(*drilldown.Month)
		contributorCTEs = `, contributors AS (
			SELECT ` + contributorColumns + `, ` + emptyObservationColumns + `
			FROM scoped s
			WHERE s.created_at >= ` + monthArg + `
			  AND s.created_at < (` + monthArg + `::date + INTERVAL '1 month')
		)`
	case "department":
		keyArg := addArg(drilldown.Key)
		contributorCTEs = `, contributors AS (
			SELECT ` + contributorColumns + `, ` + emptyObservationColumns + `
			FROM scoped s
			WHERE ` + normalizedDetailedDepartment("s.department") + ` = ` + keyArg + `
		)`
	case "service_type":
		keysArg := addArg(drilldown.Keys)
		contributorCTEs = `, contributors AS (
			SELECT ` + contributorColumns + `, ` + emptyObservationColumns + `
			FROM scoped s
			WHERE s.request_type = ANY(` + keysArg + `::text[])
		)`
	case "advisor":
		advisorWhere := ""
		if drilldown.AdvisorID != nil {
			advisorWhere = "a.advisor_id = " + addArg(*drilldown.AdvisorID)
		} else {
			advisorWhere = "a.advisor_id IS NULL AND LOWER(BTRIM(a.advisor_name)) = LOWER(BTRIM(" + addArg(drilldown.Key) + "))"
		}
		contributorCTEs = `, advisor_link AS (
			SELECT s.id AS request_id, c.advisor_id,
			       COALESCE(NULLIF(BTRIM(c.advisor_name), ''), c.advisor_id::text) AS advisor_name
			FROM scoped s
			JOIN legal_consultations c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
			 AND (c.legal_request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('consultation', 'legal_consultation')))
			WHERE c.advisor_id IS NOT NULL OR NULLIF(BTRIM(c.advisor_name), '') IS NOT NULL
			UNION
			SELECT s.id, c.handling_officer_id,
			       COALESCE(NULLIF(BTRIM(c.responsible_lawyer), ''), c.handling_officer_id::text)
			FROM scoped s
			JOIN legal_cases c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
			 AND (c.request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('case', 'legal_case')))
			WHERE c.handling_officer_id IS NOT NULL OR NULLIF(BTRIM(c.responsible_lawyer), '') IS NOT NULL
			UNION
			SELECT s.id, i.assigned_reviewer_id,
			       COALESCE(NULLIF(BTRIM(i.assigned_reviewer_name), ''), i.assigned_reviewer_id::text)
			FROM scoped s
			JOIN lex_contract_intakes i ON i.tenant_id = s.tenant_id
			 AND s.subject_id = i.contract_id AND s.subject_type IN ('contract', 'legal_contract')
			WHERE i.assigned_reviewer_id IS NOT NULL OR NULLIF(BTRIM(i.assigned_reviewer_name), '') IS NOT NULL
		), contributors AS (
			SELECT DISTINCT ` + contributorColumns + `,
			       NULL::float8 AS processing_hours,
			       NULL::int AS satisfaction_rating,
			       NULL::text AS sla_outcome,
			       a.advisor_id,
			       a.advisor_name
			FROM scoped s
			JOIN advisor_link a ON a.request_id = s.id
			WHERE ` + advisorWhere + `
		)`
	default:
		return nil, 0, fmt.Errorf("unsupported detailed analytics dimension %q", drilldown.Dimension)
	}

	page := drilldown.Page
	if page < 1 {
		page = 1
	}
	perPage := drilldown.PerPage
	if perPage < 1 {
		perPage = 25
	}
	limitArg := addArg(perPage)
	offsetArg := addArg((page - 1) * perPage)
	query := base + contributorCTEs + `
		SELECT id, request_number, title, department, request_type, priority,
		       status, requester_name, created_at, processing_hours,
		       satisfaction_rating, sla_outcome, advisor_id, advisor_name,
		       COUNT(*) OVER()::int
		FROM contributors
		ORDER BY created_at DESC, id
		LIMIT ` + limitArg + ` OFFSET ` + offsetArg

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.DetailedAnalyticsContributor, 0, perPage)
	total := 0
	for rows.Next() {
		var item model.DetailedAnalyticsContributor
		var titleJSON []byte
		if err := rows.Scan(
			&item.RequestID,
			&item.RequestNumber,
			&titleJSON,
			&item.Department,
			&item.RequestType,
			&item.Priority,
			&item.Status,
			&item.RequesterName,
			&item.CreatedAt,
			&item.ProcessingHours,
			&item.SatisfactionRating,
			&item.SLAOutcome,
			&item.AdvisorID,
			&item.AdvisorName,
			&total,
		); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal(titleJSON, &item.Title); err != nil {
			return nil, 0, fmt.Errorf("decode contributor title: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// SplitDetailedAnalyticsKeys normalizes the repeated/batched service-type
// selector used by the "Other" donut segment.
func SplitDetailedAnalyticsKeys(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		key := strings.TrimSpace(part)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}
