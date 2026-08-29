package authz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/database"
)

// ErrPolicyNotFound is returned by write methods when no policy matches the
// supplied id within the tenant's RLS scope.
var ErrPolicyNotFound = errors.New("abac policy not found")

// ErrInvalidTenant is returned when a tenant identifier is empty or not a UUID.
var ErrInvalidTenant = errors.New("invalid tenant id")

// parseTenantUUID validates and parses a tenant identifier. RLS requires a
// concrete tenant; an empty or malformed id is rejected before touching the DB.
func parseTenantUUID(tenantID string) (uuid.UUID, error) {
	if tenantID == "" {
		return uuid.Nil, ErrInvalidTenant
	}
	id, err := uuid.Parse(tenantID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: %s", ErrInvalidTenant, tenantID)
	}
	return id, nil
}

// Create inserts a new ABAC policy for the policy's tenant and returns it with
// the database-assigned id, timestamps, and any column defaults populated. The
// write runs inside a transaction with app.current_tenant_id set so RLS
// enforces tenant isolation. The tenant's policy cache is invalidated on
// success.
//
// p.TenantID must be a valid tenant UUID; it scopes both the RLS context and
// the inserted row. If p.ID is empty the database assigns one.
func (r *Repository) Create(ctx context.Context, p Policy) (Policy, error) {
	tenantUUID, err := parseTenantUUID(p.TenantID)
	if err != nil {
		return Policy{}, err
	}

	conditions, err := marshalConditions(p.Conditions)
	if err != nil {
		return Policy{}, err
	}

	const query = `
		INSERT INTO abac_policies (tenant_id, name, description, effect, action, resource_type, conditions, priority, enabled)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9)
		RETURNING id, tenant_id, name, COALESCE(description, ''), effect, action, resource_type, conditions, priority, enabled`

	var out Policy
	err = database.RunWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, query,
			tenantUUID.String(), p.Name, p.Description, string(p.Effect),
			p.Action, p.ResourceType, conditions, p.Priority, p.Enabled,
		)
		return scanPolicyRow(row, &out)
	})
	if err != nil {
		return Policy{}, fmt.Errorf("creating abac policy: %w", err)
	}

	r.Invalidate(p.TenantID)
	return out, nil
}

// Update replaces the mutable fields of an existing policy (identified by p.ID
// within p.TenantID) and returns the updated row. Returns ErrPolicyNotFound if
// no row in the tenant's scope matches. Invalidates the tenant cache on
// success.
func (r *Repository) Update(ctx context.Context, p Policy) (Policy, error) {
	tenantUUID, err := parseTenantUUID(p.TenantID)
	if err != nil {
		return Policy{}, err
	}
	if p.ID == "" {
		return Policy{}, fmt.Errorf("%w: missing policy id", ErrPolicyNotFound)
	}

	conditions, err := marshalConditions(p.Conditions)
	if err != nil {
		return Policy{}, err
	}

	const query = `
		UPDATE abac_policies
		SET name = $2, description = NULLIF($3, ''), effect = $4, action = $5,
		    resource_type = $6, conditions = $7, priority = $8, enabled = $9
		WHERE id = $1
		RETURNING id, tenant_id, name, COALESCE(description, ''), effect, action, resource_type, conditions, priority, enabled`

	var out Policy
	err = database.RunWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, query,
			p.ID, p.Name, p.Description, string(p.Effect),
			p.Action, p.ResourceType, conditions, p.Priority, p.Enabled,
		)
		if scanErr := scanPolicyRow(row, &out); scanErr != nil {
			if errors.Is(scanErr, pgx.ErrNoRows) {
				return ErrPolicyNotFound
			}
			return scanErr
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrPolicyNotFound) {
			return Policy{}, err
		}
		return Policy{}, fmt.Errorf("updating abac policy: %w", err)
	}

	r.Invalidate(p.TenantID)
	return out, nil
}

// Delete removes the policy with the given id within tenantID. Returns
// ErrPolicyNotFound when no row matched. Invalidates the tenant cache on a
// successful delete.
func (r *Repository) Delete(ctx context.Context, tenantID, id string) error {
	tenantUUID, err := parseTenantUUID(tenantID)
	if err != nil {
		return err
	}
	if id == "" {
		return fmt.Errorf("%w: missing policy id", ErrPolicyNotFound)
	}

	err = database.RunWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		tag, execErr := tx.Exec(ctx, `DELETE FROM abac_policies WHERE id = $1`, id)
		if execErr != nil {
			return execErr
		}
		if tag.RowsAffected() == 0 {
			return ErrPolicyNotFound
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrPolicyNotFound) {
			return err
		}
		return fmt.Errorf("deleting abac policy: %w", err)
	}

	r.Invalidate(tenantID)
	return nil
}

// SetEnabled toggles the enabled flag of the policy with the given id within
// tenantID and returns the updated row. Returns ErrPolicyNotFound when no row
// matched. Invalidates the tenant cache on success.
func (r *Repository) SetEnabled(ctx context.Context, tenantID, id string, enabled bool) (Policy, error) {
	tenantUUID, err := parseTenantUUID(tenantID)
	if err != nil {
		return Policy{}, err
	}
	if id == "" {
		return Policy{}, fmt.Errorf("%w: missing policy id", ErrPolicyNotFound)
	}

	const query = `
		UPDATE abac_policies
		SET enabled = $2
		WHERE id = $1
		RETURNING id, tenant_id, name, COALESCE(description, ''), effect, action, resource_type, conditions, priority, enabled`

	var out Policy
	err = database.RunWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, query, id, enabled)
		if scanErr := scanPolicyRow(row, &out); scanErr != nil {
			if errors.Is(scanErr, pgx.ErrNoRows) {
				return ErrPolicyNotFound
			}
			return scanErr
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrPolicyNotFound) {
			return Policy{}, err
		}
		return Policy{}, fmt.Errorf("toggling abac policy: %w", err)
	}

	r.Invalidate(tenantID)
	return out, nil
}

// GetByID returns a single policy by id within tenantID, regardless of its
// enabled state (the management API needs to read disabled policies, unlike
// PoliciesForTenant which only loads enabled ones for the engine). Returns
// ErrPolicyNotFound when no row matched. This is a read but lives here because
// it is part of the management surface added alongside the writes; it does not
// alter PoliciesForTenant's behavior or caching.
func (r *Repository) GetByID(ctx context.Context, tenantID, id string) (Policy, error) {
	tenantUUID, err := parseTenantUUID(tenantID)
	if err != nil {
		return Policy{}, err
	}
	if id == "" {
		return Policy{}, ErrPolicyNotFound
	}

	const query = `
		SELECT id, tenant_id, name, COALESCE(description, ''), effect, action, resource_type, conditions, priority, enabled
		FROM abac_policies
		WHERE id = $1`

	var out Policy
	err = database.RunReadWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, query, id)
		if scanErr := scanPolicyRow(row, &out); scanErr != nil {
			if errors.Is(scanErr, pgx.ErrNoRows) {
				return ErrPolicyNotFound
			}
			return scanErr
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrPolicyNotFound) {
			return Policy{}, err
		}
		return Policy{}, fmt.Errorf("loading abac policy: %w", err)
	}
	return out, nil
}

// ListForManagement returns ALL policies for the tenant (enabled and disabled),
// ordered the same way the engine loads them. Optional filters narrow by exact
// action, exact resource type, and enabled state (enabled == nil = no filter).
// Like GetByID this is a management read and does not affect PoliciesForTenant.
func (r *Repository) ListForManagement(ctx context.Context, tenantID, action, resourceType string, enabled *bool) ([]Policy, error) {
	tenantUUID, err := parseTenantUUID(tenantID)
	if err != nil {
		return nil, err
	}

	const query = `
		SELECT id, tenant_id, name, COALESCE(description, ''), effect, action, resource_type, conditions, priority, enabled
		FROM abac_policies
		WHERE tenant_id = $1
		  AND ($2 = '' OR action = $2)
		  AND ($3 = '' OR resource_type = $3)
		  AND ($4::bool IS NULL OR enabled = $4)
		ORDER BY priority DESC, created_at ASC`

	var out []Policy
	err = database.RunReadWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		rows, qErr := tx.Query(ctx, query, tenantUUID.String(), action, resourceType, enabled)
		if qErr != nil {
			return qErr
		}
		defer rows.Close()
		for rows.Next() {
			var p Policy
			if scanErr := scanPolicyRow(rows, &p); scanErr != nil {
				return scanErr
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("listing abac policies: %w", err)
	}
	return out, nil
}

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanPolicyRow(row rowScanner, p *Policy) error {
	var conditions []byte
	if err := row.Scan(
		&p.ID, &p.TenantID, &p.Name, &p.Description, &p.Effect,
		&p.Action, &p.ResourceType, &conditions, &p.Priority, &p.Enabled,
	); err != nil {
		return err
	}
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &p.Conditions); err != nil {
			return fmt.Errorf("decoding policy conditions for %s: %w", p.ID, err)
		}
	}
	return nil
}

func marshalConditions(conditions []Condition) ([]byte, error) {
	if conditions == nil {
		// Persist an empty JSON array rather than NULL to match the column default.
		return []byte("[]"), nil
	}
	b, err := json.Marshal(conditions)
	if err != nil {
		return nil, fmt.Errorf("encoding policy conditions: %w", err)
	}
	return b, nil
}
