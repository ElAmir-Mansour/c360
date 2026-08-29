package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/model"
)

var WorkforceAttributableDomains = []string{
	"contracts", "matters", "obligations", "consultations", "cases", "contract_intakes", "requests", "support",
}

type WorkforceAttribution struct {
	UserID          uuid.UUID
	Rel             string
	Domain          string
	SubjectID       uuid.UUID
	Status          string
	IsOpen          bool
	IsResolved      bool
	CreatedAt       time.Time
	ClosedAt        *time.Time
	DueDate         *time.Time
	AttributionPath model.AttributionPath
	FallbackName    string
}

type WorkforceDomainCoverage struct {
	Domain     string
	Total      int
	Attributed int
}

type WorkforceDomainResult struct {
	Attributions []WorkforceAttribution
	Coverage     WorkforceDomainCoverage
}

type WorkforceRepository struct {
	db *pgxpool.Pool
}

func NewWorkforceRepository(db *pgxpool.Pool) *WorkforceRepository {
	return &WorkforceRepository{db: db}
}

func (r *WorkforceRepository) ReadDomain(
	ctx context.Context,
	tenantID uuid.UUID,
	domain string,
	userIDs []uuid.UUID,
	includeAll bool,
	rels []string,
) (WorkforceDomainResult, error) {
	attributionSQL, ok := workforceAttributionSQL[domain]
	if !ok {
		return WorkforceDomainResult{}, fmt.Errorf("unsupported workforce domain %q", domain)
	}
	coverageSQL := workforceCoverageSQL[domain]
	result := WorkforceDomainResult{Coverage: WorkforceDomainCoverage{Domain: domain}}
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, coverageSQL, tenantID).Scan(&result.Coverage.Total, &result.Coverage.Attributed); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			WITH attribution AS (`+attributionSQL+`)
			SELECT user_id, rel, domain, subject_id, status, is_open, is_resolved,
			       created_at, closed_at, due_date, attribution_path, fallback_name
			FROM attribution
			WHERE ($2::boolean OR user_id = ANY($3::uuid[]))
			  AND rel = ANY($4::text[])
			ORDER BY user_id, domain, subject_id, rel`, tenantID, includeAll, userIDs, rels)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item WorkforceAttribution
			if err := rows.Scan(
				&item.UserID, &item.Rel, &item.Domain, &item.SubjectID, &item.Status,
				&item.IsOpen, &item.IsResolved, &item.CreatedAt, &item.ClosedAt, &item.DueDate,
				&item.AttributionPath, &item.FallbackName,
			); err != nil {
				return err
			}
			result.Attributions = append(result.Attributions, item)
		}
		return rows.Err()
	})
	if result.Attributions == nil {
		result.Attributions = []WorkforceAttribution{}
	}
	return result, err
}

func (r *WorkforceRepository) UnroutedRequests(ctx context.Context, tenantID uuid.UUID) (int, error) {
	var count int
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT count(*)::int
			FROM legal_requests s
			WHERE s.tenant_id = $1
			  AND s.deleted_at IS NULL
			  AND s.status NOT IN ('draft','cancelled','closed')
			  AND NOT EXISTS (
				SELECT 1 FROM legal_consultations c
				WHERE c.tenant_id = s.tenant_id AND c.deleted_at IS NULL AND c.legal_request_id = s.id
			  )
			  AND NOT EXISTS (
				SELECT 1 FROM legal_cases k
				WHERE k.tenant_id = s.tenant_id AND k.deleted_at IS NULL AND k.request_id = s.id
			  )`, tenantID).Scan(&count)
	})
	return count, err
}

var workforceAttributionSQL = map[string]string{
	"contracts": `
		SELECT tenant_id, owner_user_id AS user_id, 'owner'::text AS rel,
		       'contracts'::text AS domain, id AS subject_id, status,
		       status IN ('draft','internal_review','legal_review','negotiation','pending_signature','suspended') AS is_open,
		       status IN ('active','expired','terminated','renewed') AS is_resolved,
		       created_at,
		       CASE WHEN status IN ('active','expired','terminated','renewed')
		                  AND status_changed_at >= created_at AND status_changed_at < now()
		            THEN status_changed_at END AS closed_at,
		       expiry_date::date AS due_date,
		       'direct'::text AS attribution_path, COALESCE(BTRIM(owner_name), '') AS fallback_name
		FROM contracts
		WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL
		UNION ALL
		SELECT tenant_id, legal_reviewer_id, 'reviewer', 'contracts', id, status,
		       status IN ('draft','internal_review','legal_review','negotiation','pending_signature','suspended'),
		       status IN ('active','expired','terminated','renewed'),
		       created_at,
		       CASE WHEN status IN ('active','expired','terminated','renewed')
		                  AND status_changed_at >= created_at AND status_changed_at < now()
		            THEN status_changed_at END,
		       expiry_date::date, 'direct',
		       COALESCE(BTRIM(legal_reviewer_name), '')
		FROM contracts
		WHERE tenant_id = $1 AND deleted_at IS NULL AND legal_reviewer_id IS NOT NULL`,
	"matters": `
		SELECT tenant_id, owner_user_id AS user_id, 'owner'::text AS rel,
		       'matters'::text AS domain, id AS subject_id, status,
		       status IN ('intake','open','in_review','waiting_on_business','on_hold') AS is_open,
		       status = 'closed' AS is_resolved,
		       created_at,
		       CASE WHEN status = 'closed' AND closed_at >= created_at AND closed_at < now()
		            THEN closed_at END AS closed_at,
		       due_date, 'direct'::text AS attribution_path,
		       COALESCE(BTRIM(owner_name), '') AS fallback_name
		FROM legal_matters
		WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL`,
	"obligations": `
		SELECT tenant_id, owner_user_id AS user_id, 'owner'::text AS rel,
		       'obligations'::text AS domain, id AS subject_id, status,
		       status IN ('open','in_progress','blocked') AS is_open,
		       status = 'completed' AS is_resolved,
		       created_at,
		       CASE WHEN status = 'completed' AND completed_at >= created_at AND completed_at < now()
		            THEN completed_at END AS closed_at,
		       due_date, 'direct'::text AS attribution_path,
		       COALESCE(BTRIM(owner_name), '') AS fallback_name
		FROM legal_obligations
		WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_user_id IS NOT NULL`,
	"consultations": `
		SELECT tenant_id, advisor_id AS user_id, 'advisor'::text AS rel,
		       'consultations'::text AS domain, id AS subject_id, status,
		       status IN ('submitted','classified','routed') AS is_open,
		       status IN ('responded','approved','archived') AS is_resolved,
		       created_at,
		       CASE WHEN COALESCE(responded_at, approved_at, archived_at) >= created_at
		                  AND COALESCE(responded_at, approved_at, archived_at) < now()
		            THEN COALESCE(responded_at, approved_at, archived_at) END AS closed_at,
		       NULL::date AS due_date, 'direct'::text AS attribution_path,
		       COALESCE(BTRIM(advisor_name), '') AS fallback_name
		FROM legal_consultations
		WHERE tenant_id = $1 AND deleted_at IS NULL AND advisor_id IS NOT NULL`,
	"cases": `
		SELECT tenant_id, handling_officer_id AS user_id, 'handler'::text AS rel,
		       'cases'::text AS domain, id AS subject_id, status,
		       status IN ('intake','phase1','phase2','open','under_procedure') AS is_open,
		       status = 'closed' AS is_resolved,
		       created_at,
		       CASE WHEN status = 'closed' THEN (
		           SELECT MIN(a.created_at)
		           FROM legal_case_audit_log a
		           WHERE a.tenant_id = legal_cases.tenant_id
		             AND a.case_id = legal_cases.id
		             AND a.to_status = 'closed'
		             AND a.created_at >= legal_cases.created_at
		             AND a.created_at < now()
		       ) END AS closed_at,
		       NULL::date AS due_date,
		       'direct'::text AS attribution_path, COALESCE(BTRIM(responsible_lawyer), '') AS fallback_name
		FROM legal_cases
		WHERE tenant_id = $1 AND deleted_at IS NULL AND handling_officer_id IS NOT NULL
		UNION ALL
		SELECT tenant_id, supervisor_id, 'supervisor', 'cases', id, status,
		       status IN ('intake','phase1','phase2','open','under_procedure'),
		       status = 'closed', created_at,
		       CASE WHEN status = 'closed' THEN (
		           SELECT MIN(a.created_at)
		           FROM legal_case_audit_log a
		           WHERE a.tenant_id = legal_cases.tenant_id
		             AND a.case_id = legal_cases.id
		             AND a.to_status = 'closed'
		             AND a.created_at >= legal_cases.created_at
		             AND a.created_at < now()
		       ) END,
		       NULL::date,
		       'direct', ''::text
		FROM legal_cases
		WHERE tenant_id = $1 AND deleted_at IS NULL AND supervisor_id IS NOT NULL`,
	"contract_intakes": `
		SELECT tenant_id, assigned_reviewer_id AS user_id, 'reviewer'::text AS rel,
		       'contract_intakes'::text AS domain, id AS subject_id, status,
		       status IN ('received','acknowledged','routed_to_legal','under_review') AS is_open,
		       status = 'completed' AS is_resolved,
		       received_at AS created_at,
		       CASE WHEN status = 'completed' THEN (
		           SELECT MIN(a.created_at)
		           FROM lex_contract_review_desk_audit a
		           WHERE a.tenant_id = lex_contract_intakes.tenant_id
		             AND a.contract_id = lex_contract_intakes.contract_id
		             AND a.subject_id = lex_contract_intakes.id
		             AND a.to_status = 'completed'
		             AND a.created_at >= lex_contract_intakes.received_at
		             AND a.created_at < now()
		       ) END AS closed_at,
		       NULL::date AS due_date,
		       'direct'::text AS attribution_path, COALESCE(BTRIM(assigned_reviewer_name), '') AS fallback_name
		FROM lex_contract_intakes
		WHERE tenant_id = $1 AND assigned_reviewer_id IS NOT NULL`,
	"requests": `
		WITH scoped AS (
			SELECT lr.id, lr.tenant_id, lr.status, lr.subject_type, lr.subject_id, lr.created_at
			FROM legal_requests lr
			WHERE lr.tenant_id = $1 AND lr.deleted_at IS NULL
		)
		SELECT s.tenant_id, c.advisor_id AS user_id, 'advisor'::text AS rel,
		       'requests'::text AS domain, s.id AS subject_id, s.status,
		       s.status NOT IN ('draft','delivered','closed','cancelled') AS is_open,
		       s.status IN ('delivered','closed') AS is_resolved, s.created_at,
		       NULL::timestamptz AS closed_at, NULL::date AS due_date,
		       'linked'::text AS attribution_path,
		       COALESCE(BTRIM(c.advisor_name), '') AS fallback_name
		FROM scoped s
		JOIN legal_consultations c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
		 AND (c.legal_request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('consultation', 'legal_consultation')))
		WHERE c.advisor_id IS NOT NULL
		UNION
		SELECT s.tenant_id, c.handling_officer_id, 'handler', 'requests', s.id, s.status,
		       s.status NOT IN ('draft','delivered','closed','cancelled'),
		       s.status IN ('delivered','closed'), s.created_at, NULL::timestamptz, NULL::date, 'linked',
		       COALESCE(BTRIM(c.responsible_lawyer), '')
		FROM scoped s
		JOIN legal_cases c ON c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
		 AND (c.request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('case', 'legal_case')))
		WHERE c.handling_officer_id IS NOT NULL`,
	"support": `
		SELECT tenant_id, assignee_id AS user_id, 'assignee'::text AS rel,
		       'support'::text AS domain, id AS subject_id, status,
		       status IN ('open','accepted') AS is_open,
		       status = 'resolved' AS is_resolved,
		       created_at,
		       CASE WHEN status = 'resolved'
		                  AND closed_at >= created_at AND closed_at < now()
		            THEN closed_at END AS closed_at,
		       NULL::date AS due_date,
		       'direct'::text AS attribution_path, ''::text AS fallback_name
		FROM lex_support_requests
		WHERE tenant_id = $1 AND deleted_at IS NULL AND assignee_id IS NOT NULL`,
}

var workforceCoverageSQL = map[string]string{
	"contracts": `
		SELECT count(*)::int,
		       count(*) FILTER (WHERE owner_user_id IS NOT NULL OR legal_reviewer_id IS NOT NULL)::int
		FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL`,
	"matters": `
		SELECT count(*)::int, count(*) FILTER (WHERE owner_user_id IS NOT NULL)::int
		FROM legal_matters WHERE tenant_id = $1 AND deleted_at IS NULL`,
	"obligations": `
		SELECT count(*)::int, count(*) FILTER (WHERE owner_user_id IS NOT NULL)::int
		FROM legal_obligations WHERE tenant_id = $1 AND deleted_at IS NULL`,
	"consultations": `
		SELECT count(*)::int, count(*) FILTER (WHERE advisor_id IS NOT NULL)::int
		FROM legal_consultations WHERE tenant_id = $1 AND deleted_at IS NULL`,
	"cases": `
		SELECT count(*)::int,
		       count(*) FILTER (WHERE handling_officer_id IS NOT NULL OR supervisor_id IS NOT NULL)::int
		FROM legal_cases WHERE tenant_id = $1 AND deleted_at IS NULL`,
	"contract_intakes": `
		SELECT count(*)::int, count(*) FILTER (WHERE assigned_reviewer_id IS NOT NULL)::int
		FROM lex_contract_intakes WHERE tenant_id = $1`,
	"requests": `
		SELECT count(*)::int,
		       count(*) FILTER (WHERE
			EXISTS (
				SELECT 1 FROM legal_consultations c
				WHERE c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
				  AND (c.legal_request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('consultation','legal_consultation')))
				  AND c.advisor_id IS NOT NULL
			) OR EXISTS (
				SELECT 1 FROM legal_cases c
				WHERE c.tenant_id = s.tenant_id AND c.deleted_at IS NULL
				  AND (c.request_id = s.id OR (s.subject_id = c.id AND s.subject_type IN ('case','legal_case')))
				  AND c.handling_officer_id IS NOT NULL
			)
		)::int
		FROM legal_requests s WHERE s.tenant_id = $1 AND s.deleted_at IS NULL`,
	"support": `
		SELECT count(*)::int, count(*) FILTER (WHERE assignee_id IS NOT NULL)::int
		FROM lex_support_requests WHERE tenant_id = $1 AND deleted_at IS NULL`,
}
