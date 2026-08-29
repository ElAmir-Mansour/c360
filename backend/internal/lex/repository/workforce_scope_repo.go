package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
)

var ErrWorkforceEntityOutsideScope = errors.New("entity is outside caller workforce scope")

// WorkforceScopeMember is the roster projection needed by workforce reporting.
// It deliberately carries no platform identity fields; those are resolved from
// platform_core in one tenant-scoped batch after the lex_db scope is fixed.
type WorkforceScopeMember struct {
	UserID        uuid.UUID
	EntityID      uuid.UUID
	ManagerUserID *uuid.UUID
	EmployeeCode  string
	Title         map[string]string
	CapacityUnits *float64
}

type WorkforceScopeData struct {
	HasOrgRole       bool
	RosterConfigured bool
	EntityIDs        []uuid.UUID
	Members          []WorkforceScopeMember
}

type WorkforceScopeRepository struct {
	db *pgxpool.Pool
}

func NewWorkforceScopeRepository(db *pgxpool.Pool) *WorkforceScopeRepository {
	return &WorkforceScopeRepository{db: db}
}

// ResolveDirectorScope resolves and optionally narrows a caller's legal-director
// subtree. Both the authorization check and roster read happen in one read-only,
// tenant-scoped transaction so entity_id cannot race the check/use boundary.
func (r *WorkforceScopeRepository) ResolveDirectorScope(ctx context.Context, tenantID, callerID uuid.UUID, targetEntityID *uuid.UUID) (WorkforceScopeData, error) {
	var out WorkforceScopeData
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		allEntityIDs, err := workforceDirectorEntityIDs(ctx, tx, tenantID, callerID)
		if err != nil {
			return err
		}
		out.HasOrgRole = len(allEntityIDs) > 0
		if !out.HasOrgRole {
			if targetEntityID != nil {
				return ErrWorkforceEntityOutsideScope
			}
			return nil
		}
		out.RosterConfigured, err = workforceRosterConfigured(ctx, tx, tenantID, allEntityIDs)
		if err != nil {
			return err
		}

		selected := allEntityIDs
		if targetEntityID != nil {
			if !containsWorkforceEntity(allEntityIDs, *targetEntityID) {
				return ErrWorkforceEntityOutsideScope
			}
			selected, err = workforceDescendantEntityIDs(ctx, tx, tenantID, *targetEntityID)
			if err != nil {
				return err
			}
		}
		out.EntityIDs = selected
		out.Members, err = workforceMembersForEntities(ctx, tx, tenantID, selected)
		return err
	})
	if isUndefinedWorkforceRoster(err) {
		return WorkforceScopeData{HasOrgRole: out.HasOrgRole, EntityIDs: out.EntityIDs}, nil
	}
	return out, err
}

func (r *WorkforceScopeRepository) ResolveTenantScope(ctx context.Context, tenantID uuid.UUID) (WorkforceScopeData, error) {
	var out WorkforceScopeData
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id
			FROM legal_org_entities
			WHERE tenant_id = $1 AND active = true AND deleted_at IS NULL
			ORDER BY id`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return err
			}
			out.EntityIDs = append(out.EntityIDs, id)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		out.HasOrgRole = true
		out.Members, err = workforceMembersForEntities(ctx, tx, tenantID, out.EntityIDs)
		out.RosterConfigured = len(out.Members) > 0
		return err
	})
	if isUndefinedWorkforceRoster(err) {
		return WorkforceScopeData{HasOrgRole: true, EntityIDs: out.EntityIDs}, nil
	}
	return out, err
}

func workforceRosterConfigured(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, entityIDs []uuid.UUID) (bool, error) {
	if len(entityIDs) == 0 {
		return false, nil
	}
	var configured bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_org_memberships
			WHERE tenant_id = $1
			  AND entity_id = ANY($2)
			  AND active = true
			  AND deleted_at IS NULL
		)`, tenantID, entityIDs).Scan(&configured)
	return configured, err
}

func (r *WorkforceScopeRepository) ResolveSelfScope(ctx context.Context, tenantID, callerID uuid.UUID) (WorkforceScopeData, error) {
	var out WorkforceScopeData
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT entity_id, manager_user_id, employee_code,
			       COALESCE(NULLIF(title, 'null'::jsonb), '{}'::jsonb), capacity_units
			FROM legal_org_memberships
			WHERE tenant_id = $1 AND user_id = $2 AND active = true AND deleted_at IS NULL
			ORDER BY entity_id`, tenantID, callerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			member := WorkforceScopeMember{UserID: callerID}
			var titleJSON []byte
			if err := rows.Scan(&member.EntityID, &member.ManagerUserID, &member.EmployeeCode, &titleJSON, &member.CapacityUnits); err != nil {
				return err
			}
			if err := json.Unmarshal(titleJSON, &member.Title); err != nil {
				return fmt.Errorf("decode workforce membership title: %w", err)
			}
			out.EntityIDs = append(out.EntityIDs, member.EntityID)
			out.Members = append(out.Members, member)
		}
		return rows.Err()
	})
	if isUndefinedWorkforceRoster(err) {
		return WorkforceScopeData{}, nil
	}
	return out, err
}

func workforceDirectorEntityIDs(ctx context.Context, tx pgx.Tx, tenantID, callerID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		WITH RECURSIVE roots AS (
			SELECT e.id
			FROM legal_org_roles r
			JOIN legal_org_entities e ON e.id = r.entity_id AND e.tenant_id = r.tenant_id
			WHERE r.tenant_id = $1
			  AND r.user_id = $2
			  AND r.role_key = 'legal_director'
			  AND r.deleted_at IS NULL
			  AND e.active = true
			  AND e.deleted_at IS NULL
		), subtree AS (
			SELECT id FROM roots
			UNION
			SELECT c.id
			FROM legal_org_entities c
			JOIN subtree s ON c.parent_id = s.id
			WHERE c.tenant_id = $1 AND c.active = true AND c.deleted_at IS NULL
		)
		SELECT id FROM subtree ORDER BY id`, tenantID, callerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func workforceDescendantEntityIDs(ctx context.Context, tx pgx.Tx, tenantID, rootID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		WITH RECURSIVE subtree AS (
			SELECT id FROM legal_org_entities
			WHERE tenant_id = $1 AND id = $2 AND active = true AND deleted_at IS NULL
			UNION
			SELECT c.id FROM legal_org_entities c
			JOIN subtree s ON c.parent_id = s.id
			WHERE c.tenant_id = $1 AND c.active = true AND c.deleted_at IS NULL
		)
		SELECT id FROM subtree ORDER BY id`, tenantID, rootID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func workforceMembersForEntities(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, entityIDs []uuid.UUID) ([]WorkforceScopeMember, error) {
	if len(entityIDs) == 0 {
		return []WorkforceScopeMember{}, nil
	}
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT ON (m.user_id) m.user_id, m.entity_id, m.manager_user_id,
		       m.employee_code, COALESCE(NULLIF(m.title, 'null'::jsonb), '{}'::jsonb), m.capacity_units
		FROM legal_org_memberships m
		WHERE m.tenant_id = $1
		  AND m.entity_id = ANY($2)
		  AND m.active = true
		  AND m.deleted_at IS NULL
		ORDER BY m.user_id, m.updated_at DESC, m.entity_id`, tenantID, entityIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := make([]WorkforceScopeMember, 0)
	for rows.Next() {
		var member WorkforceScopeMember
		var titleJSON []byte
		if err := rows.Scan(&member.UserID, &member.EntityID, &member.ManagerUserID, &member.EmployeeCode, &titleJSON, &member.CapacityUnits); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(titleJSON, &member.Title); err != nil {
			return nil, fmt.Errorf("decode workforce membership title: %w", err)
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func containsWorkforceEntity(ids []uuid.UUID, target uuid.UUID) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

func isUndefinedWorkforceRoster(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == "42P01" &&
		strings.Contains(pgErr.Message, `relation "legal_org_memberships" does not exist`)
}
