package authz

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository loads ABAC policies from platform_core. It implements PolicyProvider.
type Repository struct {
	pool *pgxpool.Pool

	// cache holds per-tenant policy snapshots with a short TTL to keep the
	// engine off the database on every request. ABAC policies change rarely.
	mu       sync.RWMutex
	cache    map[string]cachedPolicies
	cacheTTL time.Duration
}

type cachedPolicies struct {
	policies []Policy
	expires  time.Time
}

// NewRepository constructs a DB-backed policy provider. cacheTTL of 0 disables caching.
func NewRepository(pool *pgxpool.Pool, cacheTTL time.Duration) *Repository {
	return &Repository{
		pool:     pool,
		cache:    make(map[string]cachedPolicies),
		cacheTTL: cacheTTL,
	}
}

// PoliciesForTenant returns enabled policies for the tenant, ordered by priority.
func (r *Repository) PoliciesForTenant(ctx context.Context, tenantID string) ([]Policy, error) {
	if tenantID == "" {
		return nil, nil
	}

	if r.cacheTTL > 0 {
		r.mu.RLock()
		entry, ok := r.cache[tenantID]
		r.mu.RUnlock()
		if ok && time.Now().Before(entry.expires) {
			return entry.policies, nil
		}
	}

	policies, err := r.load(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	if r.cacheTTL > 0 {
		r.mu.Lock()
		r.cache[tenantID] = cachedPolicies{policies: policies, expires: time.Now().Add(r.cacheTTL)}
		r.mu.Unlock()
	}

	return policies, nil
}

// Invalidate clears the cached policies for a tenant (call after writes).
func (r *Repository) Invalidate(tenantID string) {
	r.mu.Lock()
	delete(r.cache, tenantID)
	r.mu.Unlock()
}

func (r *Repository) load(ctx context.Context, tenantID string) ([]Policy, error) {
	const query = `
		SELECT id, tenant_id, name, COALESCE(description, ''), effect,
		       action, resource_type, conditions, priority, enabled
		FROM abac_policies
		WHERE tenant_id = $1 AND enabled = true
		ORDER BY priority DESC, created_at ASC`

	rows, err := r.pool.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("querying abac policies: %w", err)
	}
	defer rows.Close()

	var policies []Policy
	for rows.Next() {
		var (
			p          Policy
			conditions []byte
		)
		if err := rows.Scan(
			&p.ID, &p.TenantID, &p.Name, &p.Description, &p.Effect,
			&p.Action, &p.ResourceType, &conditions, &p.Priority, &p.Enabled,
		); err != nil {
			return nil, fmt.Errorf("scanning abac policy: %w", err)
		}
		if len(conditions) > 0 {
			if err := json.Unmarshal(conditions, &p.Conditions); err != nil {
				return nil, fmt.Errorf("decoding policy conditions for %s: %w", p.ID, err)
			}
		}
		policies = append(policies, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating abac policies: %w", err)
	}
	return policies, nil
}
