package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/model"
)

type SupportRequestRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSupportRequestRepository(db *pgxpool.Pool, logger zerolog.Logger) *SupportRequestRepository {
	return &SupportRequestRepository{db: db, logger: logger.With().Str("repository", "lex-support-requests").Logger()}
}

func (r *SupportRequestRepository) Create(ctx context.Context, q Queryer, item *model.SupportRequest) error {
	return q.QueryRow(ctx, `
		INSERT INTO lex_support_requests (
			id, tenant_id, requester_id, requester_entity_id, target_entity_id,
			assignee_id, subject, body, priority, subject_type, subject_id,
			status, resolution_note, expires_at, approver_user_id,
			approval_decided_at, approval_note, approval_route, business_days
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		RETURNING created_at, updated_at`,
		item.ID, item.TenantID, item.RequesterID, item.RequesterEntityID,
		item.TargetEntityID, item.AssigneeID, item.Subject, item.Body, item.Priority,
		item.SubjectType, item.SubjectID, item.Status, item.ResolutionNote, item.ExpiresAt,
		item.ApproverUserID, item.ApprovalDecidedAt, item.ApprovalNote,
		item.ApprovalRoute, item.BusinessDays,
	).Scan(&item.CreatedAt, &item.UpdatedAt)
}

func (r *SupportRequestRepository) Lock(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (*model.SupportRequest, error) {
	var locked uuid.UUID
	if err := q.QueryRow(ctx, `
		SELECT id FROM lex_support_requests
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`, tenantID, id).Scan(&locked); err != nil {
		return nil, err
	}
	return supportRequestGet(ctx, q, `sr.tenant_id = $1 AND sr.id = $2 AND sr.deleted_at IS NULL`, tenantID, id)
}

// UpdateState never writes approver_user_id or approval_route: the approver is
// frozen at creation, so no later statement can silently reassign an in-flight
// request when the org chart is edited. expires_at is writable because the
// validity window is materialised at approval, not at creation.
func (r *SupportRequestRepository) UpdateState(ctx context.Context, q Queryer, item *model.SupportRequest) error {
	return q.QueryRow(ctx, `
		UPDATE lex_support_requests
		SET status = $3, resolution_note = $4, accepted_at = $5,
		    closed_at = $6, expires_at = $7, approval_decided_at = $8,
		    approval_note = $9, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`, item.TenantID, item.ID, item.Status,
		item.ResolutionNote, item.AcceptedAt, item.ClosedAt, item.ExpiresAt,
		item.ApprovalDecidedAt, item.ApprovalNote,
	).Scan(&item.UpdatedAt)
}

func (r *SupportRequestRepository) GetVisible(ctx context.Context, tenantID, actorID, id uuid.UUID, oversee bool) (*model.SupportRequest, error) {
	var item *model.SupportRequest
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		visibility, args := supportVisibilitySQL(actorID, oversee, 3)
		var err error
		item, err = supportRequestGet(ctx, tx,
			"sr.tenant_id = $1 AND sr.id = $2 AND sr.deleted_at IS NULL AND "+visibility,
			append([]any{tenantID, id}, args...)...)
		return err
	})
	return item, err
}

func (r *SupportRequestRepository) List(ctx context.Context, tenantID, actorID uuid.UUID, oversee bool, filters model.SupportRequestListFilters) ([]model.SupportRequest, int, error) {
	var items []model.SupportRequest
	var total int
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		items, total, err = supportRequestListWith(ctx, tx, tenantID, actorID, oversee, filters)
		return err
	})
	return items, total, err
}

func supportRequestListWith(ctx context.Context, q Queryer, tenantID, actorID uuid.UUID, oversee bool, filters model.SupportRequestListFilters) ([]model.SupportRequest, int, error) {
	conditions := []string{"sr.tenant_id = $1", "sr.deleted_at IS NULL"}
	args := []any{tenantID}
	arg := 2

	switch filters.Box {
	case model.SupportBoxInbox:
		// The colleague's inbox is the routing surface. A request still behind
		// the approval gate has not been routed to anyone, so it is excluded
		// here regardless of any status filter the caller supplies -- otherwise
		// the gate would be purely cosmetic.
		conditions = append(conditions, fmt.Sprintf("sr.assignee_id = $%d", arg), supportAssigneeRoutedSQL)
		args = append(args, actorID)
		arg++
	case model.SupportBoxSent:
		conditions = append(conditions, fmt.Sprintf("sr.requester_id = $%d", arg))
		args = append(args, actorID)
		arg++
	case model.SupportBoxApprovals:
		conditions = append(conditions, fmt.Sprintf("sr.approver_user_id = $%d", arg))
		args = append(args, actorID)
		arg++
	default:
		visibility, visibilityArgs := supportVisibilitySQL(actorID, oversee, arg)
		conditions = append(conditions, visibility)
		args = append(args, visibilityArgs...)
		arg += len(visibilityArgs)
	}

	if len(filters.Statuses) > 0 {
		conditions = append(conditions, fmt.Sprintf("sr.status = ANY($%d)", arg))
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		args = append(args, statuses)
		arg++
	} else if filters.History {
		conditions = append(conditions, "sr.status IN ('resolved','declined','expired','cancelled','rejected')")
	} else {
		// pending_manager_approval is live work for the requester (awaiting
		// approval) and for the approver (awaiting my decision). The assignee
		// predicate above keeps it out of the colleague's inbox.
		conditions = append(conditions, "sr.status IN ('pending_manager_approval','open','accepted')")
	}
	if filters.EntityID != nil {
		conditions = append(conditions, fmt.Sprintf("(sr.target_entity_id = $%d OR sr.requester_entity_id = $%d)", arg, arg))
		args = append(args, *filters.EntityID)
		arg++
	}

	where := strings.Join(conditions, " AND ")
	var total int
	if err := q.QueryRow(ctx, "SELECT COUNT(*) FROM lex_support_requests sr WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.SupportRequest{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	args = append(args, perPage, (page-1)*perPage)
	query := supportRequestJSONSelect(where) + fmt.Sprintf(`
		ORDER BY CASE WHEN t.expires_at IS NULL THEN 1 ELSE 0 END,
		         t.expires_at ASC NULLS LAST, t.created_at DESC, t.id ASC
		LIMIT $%d OFFSET $%d`, arg, arg+1)
	items, err := queryListJSON[model.SupportRequest](ctx, q, query, args...)
	return items, total, err
}

// supportAssigneeRoutedSQL is the gate: a request is only the assignee's
// business once it has actually been routed to them. Kept as a constant so the
// inbox box and the party predicate cannot drift apart.
const supportAssigneeRoutedSQL = "sr.status <> 'pending_manager_approval'"

// supportVisibilitySQL returns a fail-closed predicate.
//
// A request behind the approval gate is visible ONLY to the requester and the
// frozen approver. Everyone else -- including the assignee and including an
// overseer whose subtree contains the target entity -- sees it only once it has
// been routed. The assignee is usually a member of the target entity, so leaving
// the subtree branch ungated would hand the unapproved request straight back to
// the colleague it was withheld from and make the gate cosmetic.
//
// Past the gate the original rules stand: party (requester/assignee), plus an
// overseer whose own active entity, or a descendant of it, is either endpoint.
func supportVisibilitySQL(actorID uuid.UUID, oversee bool, firstArg int) (string, []any) {
	approvalParty := fmt.Sprintf("sr.requester_id = $%d OR sr.approver_user_id = $%d", firstArg, firstArg)
	routed := fmt.Sprintf("sr.assignee_id = $%d", firstArg)
	if oversee {
		subtree := fmt.Sprintf(`EXISTS (
		SELECT 1
		FROM legal_org_memberships om
		JOIN legal_org_entities candidate
		  ON candidate.tenant_id = sr.tenant_id
		 AND candidate.id IN (sr.target_entity_id, sr.requester_entity_id)
		 AND candidate.deleted_at IS NULL
		WHERE om.tenant_id = sr.tenant_id
		  AND om.user_id = $%d
		  AND om.active = true
		  AND om.deleted_at IS NULL
		  AND (candidate.id = om.entity_id OR om.entity_id::text = ANY(candidate.path))
	)`, firstArg)
		routed = "(" + routed + " OR " + subtree + ")"
	}
	return "(" + approvalParty + " OR (" + supportAssigneeRoutedSQL + " AND " + routed + "))", []any{actorID}
}

// RequesterEntity resolves the actor's own unit deterministically. Memberships
// have no primary flag, so the deepest active entity wins; UUID is the stable
// tie-break. No active membership intentionally returns nil, not a guessed unit.
func (r *SupportRequestRepository) RequesterEntity(ctx context.Context, tenantID, userID uuid.UUID) (*uuid.UUID, error) {
	var id *uuid.UUID
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		id, err = supportRequesterEntityWith(ctx, tx, tenantID, userID)
		return err
	})
	return id, err
}

func supportRequesterEntityWith(ctx context.Context, q Queryer, tenantID, userID uuid.UUID) (*uuid.UUID, error) {
	var value uuid.UUID
	err := q.QueryRow(ctx, `
			SELECT e.id
			FROM legal_org_memberships m
			JOIN legal_org_entities e
			  ON e.tenant_id = m.tenant_id AND e.id = m.entity_id
			WHERE m.tenant_id = $1 AND m.user_id = $2
			  AND m.active = true AND m.deleted_at IS NULL
			  AND e.active = true AND e.deleted_at IS NULL
			ORDER BY COALESCE(cardinality(e.path), 0) DESC, e.id ASC
			LIMIT 1`, tenantID, userID).Scan(&value)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// SupportApproverCandidate is the org-data answer to "who approves this
// requester", carrying the route so the caller can record how it was reached.
// A nil result means the org data names nobody above the requester.
type SupportApproverCandidate struct {
	UserID uuid.UUID
	Route  model.SupportApprovalRoute
}

// ResolveApprover applies the design's recommended policy in order:
//
//  1. legal_org_memberships.manager_user_id for the requester   -> manager
//  2. nearest department_manager / legal_director walking UP the
//     legal_org_entities tree from the requester's own unit      -> unit_head
//  3. nobody                                                     -> nil
//
// Step 3 is not an error: the caller auto-approves rather than stranding the
// requester in pending_manager_approval forever. In the live demo tenant 19
// active memberships carry only 16 managers, so this path is real, not
// theoretical.
//
// entityID is the requester's own unit as already resolved by RequesterEntity,
// passed in so the row's requester_entity_id and the tree that was walked can
// never disagree.
func (r *SupportRequestRepository) ResolveApprover(ctx context.Context, tenantID, requesterID uuid.UUID, entityID *uuid.UUID) (*SupportApproverCandidate, error) {
	var candidate *SupportApproverCandidate
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		candidate, err = resolveSupportApproverWith(ctx, tx, tenantID, requesterID, entityID)
		return err
	})
	return candidate, err
}

func resolveSupportApproverWith(ctx context.Context, q Queryer, tenantID, requesterID uuid.UUID, entityID *uuid.UUID) (*SupportApproverCandidate, error) {
	managerID, err := supportManagerUserIDWith(ctx, q, tenantID, requesterID)
	if err != nil {
		return nil, err
	}
	if managerID != nil {
		return &SupportApproverCandidate{UserID: *managerID, Route: model.SupportRouteManager}, nil
	}
	if entityID == nil {
		return nil, nil
	}
	headID, err := supportUnitHeadUserIDWith(ctx, q, tenantID, *entityID)
	if err != nil {
		return nil, err
	}
	if headID == nil {
		return nil, nil
	}
	return &SupportApproverCandidate{UserID: *headID, Route: model.SupportRouteUnitHead}, nil
}

// supportManagerUserIDWith mirrors RequesterEntity's deepest-membership-first
// ordering so the manager and the requester entity are drawn from the same
// membership whenever that membership names one. Memberships without a manager
// are skipped rather than short-circuiting to "no manager", so a shallower
// membership that does name one still counts.
func supportManagerUserIDWith(ctx context.Context, q Queryer, tenantID, userID uuid.UUID) (*uuid.UUID, error) {
	var value uuid.UUID
	err := q.QueryRow(ctx, `
			SELECT m.manager_user_id
			FROM legal_org_memberships m
			JOIN legal_org_entities e
			  ON e.tenant_id = m.tenant_id AND e.id = m.entity_id
			WHERE m.tenant_id = $1 AND m.user_id = $2
			  AND m.active = true AND m.deleted_at IS NULL
			  AND e.active = true AND e.deleted_at IS NULL
			  AND m.manager_user_id IS NOT NULL
			ORDER BY COALESCE(cardinality(e.path), 0) DESC, e.id ASC
			LIMIT 1`, tenantID, userID).Scan(&value)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// supportUnitHeadUserIDWith walks parent_id upward from the requester's own unit
// and returns the nearest unit head. The requester's own unit is included: the
// head of the unit you belong to is your unit head. Ties at the same depth
// prefer department_manager over legal_director -- the closer authority first --
// and break deterministically on user_id.
func supportUnitHeadUserIDWith(ctx context.Context, q Queryer, tenantID, entityID uuid.UUID) (*uuid.UUID, error) {
	var value uuid.UUID
	err := q.QueryRow(ctx, `
			WITH RECURSIVE chain AS (
				SELECT e.id, e.parent_id, 0 AS depth
				FROM legal_org_entities e
				WHERE e.tenant_id = $1 AND e.id = $2
				  AND e.active = true AND e.deleted_at IS NULL
				UNION ALL
				SELECT p.id, p.parent_id, c.depth + 1
				FROM chain c
				JOIN legal_org_entities p
				  ON p.tenant_id = $1 AND p.id = c.parent_id
				 AND p.active = true AND p.deleted_at IS NULL
			)
			SELECT r.user_id
			FROM chain c
			JOIN legal_org_roles r
			  ON r.tenant_id = $1 AND r.entity_id = c.id AND r.deleted_at IS NULL
			WHERE r.role_key IN ('department_manager', 'legal_director')
			ORDER BY c.depth ASC,
			         CASE r.role_key WHEN 'department_manager' THEN 0 ELSE 1 END,
			         r.user_id ASC
			LIMIT 1`, tenantID, entityID).Scan(&value)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func (r *SupportRequestRepository) DirectoryEntities(ctx context.Context, tenantID uuid.UUID) ([]model.SupportEntitySummary, error) {
	var entities []model.SupportEntitySummary
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		entities, err = supportDirectoryEntitiesWith(ctx, tx, tenantID)
		return err
	})
	return entities, err
}

func supportDirectoryEntitiesWith(ctx context.Context, q Queryer, tenantID uuid.UUID) ([]model.SupportEntitySummary, error) {
	return queryListJSON[model.SupportEntitySummary](ctx, q, supportDirectoryEntitySQL(), tenantID)
}

func supportDirectoryEntitySQL() string {
	return `
			SELECT row_to_json(t) FROM (
				SELECT e.id, e.code, COALESCE(e.name, '{}'::jsonb) AS name, e.entity_type
				FROM legal_org_entities e
				WHERE e.tenant_id = $1 AND e.active = true AND e.deleted_at IS NULL
				  AND EXISTS (
					SELECT 1 FROM legal_org_memberships m
					WHERE m.tenant_id = e.tenant_id AND m.entity_id = e.id
					  AND m.active = true AND m.deleted_at IS NULL
				  )
				ORDER BY COALESCE(cardinality(e.path), 0), e.code, e.id
			) t`
}

func (r *SupportRequestRepository) ListTenantIDs(ctx context.Context, now time.Time) ([]uuid.UUID, error) {
	return listSupportTenantIDsWith(ctx, r.db, now)
}

// supportExpiryTenantsSQL and supportExpirySweepSQL are named so the expiry
// allow-list is auditable in one place. Both list the clock-bearing states
// explicitly; pending_manager_approval is absent by construction, because a
// request behind the gate has no expiry clock yet (its window is materialised at
// approval) and expiring it would silently close a request nobody could act on.
const supportExpiryTenantsSQL = `
		SELECT DISTINCT tenant_id
		FROM lex_support_requests
		WHERE status IN ('open','accepted')
		  AND expires_at IS NOT NULL AND expires_at <= $1
		  AND deleted_at IS NULL`

func listSupportTenantIDsWith(ctx context.Context, q Queryer, now time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, supportExpiryTenantsSQL, now.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tenantIDs []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	return tenantIDs, rows.Err()
}

// ExpireDue atomically claims and expires at most limit due rows. The half-open
// due boundary is expires_at <= now: at the exact persisted expiry instant the
// request is no longer active. Accepted work intentionally still expires.
func (r *SupportRequestRepository) ExpireDue(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]model.SupportRequest, error) {
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	var expired []model.SupportRequest
	err := database.RunWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		expired, err = expireSupportDueWith(ctx, tx, tenantID, now, limit)
		return err
	})
	return expired, err
}

const supportExpirySweepSQL = `
			WITH due AS (
				SELECT id
				FROM lex_support_requests
				WHERE tenant_id = $1
				  AND status IN ('open','accepted')
				  AND expires_at IS NOT NULL
				  AND expires_at <= $2
				  AND deleted_at IS NULL
				ORDER BY expires_at ASC, id ASC
				LIMIT $3
				FOR UPDATE SKIP LOCKED
			), updated AS (
				UPDATE lex_support_requests sr
				SET status = 'expired', closed_at = $2, updated_at = $2
				FROM due
				WHERE sr.tenant_id = $1 AND sr.id = due.id
				  AND sr.status IN ('open','accepted')
				RETURNING sr.*
			)
			SELECT row_to_json(u) FROM updated u`

func expireSupportDueWith(ctx context.Context, q Queryer, tenantID uuid.UUID, now time.Time, limit int) ([]model.SupportRequest, error) {
	rows, err := q.Query(ctx, supportExpirySweepSQL, tenantID, now.UTC(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJSONRows[model.SupportRequest](rows)
}

func supportRequestGet(ctx context.Context, q Queryer, where string, args ...any) (*model.SupportRequest, error) {
	return queryRowJSON[model.SupportRequest](ctx, q, supportRequestJSONSelect(where), args...)
}

func supportRequestJSONSelect(where string) string {
	return `
		SELECT row_to_json(t) FROM (
			SELECT sr.id, sr.tenant_id, sr.requester_id, sr.requester_entity_id,
			       sr.target_entity_id, sr.assignee_id, sr.subject, sr.body,
			       sr.priority, sr.subject_type, sr.subject_id, sr.status,
			       sr.resolution_note, sr.approver_user_id, sr.approval_decided_at,
			       sr.approval_note, sr.approval_route, sr.business_days,
			       sr.expires_at, sr.accepted_at, sr.closed_at,
			       sr.created_at, sr.updated_at, sr.deleted_at,
			       CASE WHEN re.id IS NULL THEN NULL ELSE jsonb_build_object(
			         'id', re.id, 'code', re.code, 'name', COALESCE(re.name, '{}'::jsonb),
			         'entity_type', re.entity_type
			       ) END AS requester_entity,
			       jsonb_build_object(
			         'id', te.id, 'code', te.code, 'name', COALESCE(te.name, '{}'::jsonb),
			         'entity_type', te.entity_type
			       ) AS target_entity
			FROM lex_support_requests sr
			LEFT JOIN legal_org_entities re
			  ON re.tenant_id = sr.tenant_id AND re.id = sr.requester_entity_id
			JOIN legal_org_entities te
			  ON te.tenant_id = sr.tenant_id AND te.id = sr.target_entity_id
			WHERE ` + where + `
		) t`
}

func scanJSONRows[T any](rows pgx.Rows) ([]T, error) {
	items := make([]T, 0)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item T
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
