package tenants

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a tenant or target user cannot be located.
var ErrNotFound = fmt.Errorf("not found")

// ListParams holds the filter/search/sort/paging inputs for the admin tenant list.
type ListParams struct {
	Search   string
	Statuses []string
	Tiers    []string
	Sort     string
	Order    string
	Page     int
	PerPage  int
}

// AdminTenantSummary is one row of the cross-tenant admin list (gap G2).
// license_state/seats deliberately live in license_db and are fetched per-row
// by the frontend; they are not part of this platform_core aggregate.
type AdminTenantSummary struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Slug             string     `json:"slug"`
	Status           string     `json:"status"`
	SubscriptionTier string     `json:"subscription_tier"`
	UserCount        int        `json:"user_count"`
	ActiveUserCount  int        `json:"active_user_count"`
	StorageUsedBytes int64      `json:"storage_used_bytes"`
	DeprovisionedAt  *time.Time `json:"deprovisioned_at"`
	RetainUntil      *time.Time `json:"retain_until"`
	CreatedAt        time.Time  `json:"created_at"`
	LastActivityAt   *time.Time `json:"last_activity_at"`
}

// PlatformSummary is the overview rollup across all tenants (gap G3).
type PlatformSummary struct {
	TenantCount       int   `json:"tenant_count"`
	Active            int   `json:"active"`
	Suspended         int   `json:"suspended"`
	Trial             int   `json:"trial"`
	Deprovisioned     int   `json:"deprovisioned"`
	TotalUsers        int   `json:"total_users"`
	TotalStorageBytes int64 `json:"total_storage_bytes"`
	APICalls24h       *int  `json:"api_calls_24h,omitempty"`
	Attention         int   `json:"attention"`
}

// targetUser is the impersonation target resolved from platform_core.
type targetUser struct {
	ID    string
	Email string
	Roles []string
}

// tenantIdentity is the minimal tenant info needed for suspend/unsuspend guards.
type tenantIdentity struct {
	Name   string
	Slug   string
	Status string
}

// Repository is the platform_core data access for cross-tenant admin tenant ops.
// It owns its own *pgxpool.Pool (platform_core) and is independent of the IAM
// service wiring so it can be mounted standalone.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the platform_core pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

var allowedSorts = map[string]string{
	"name":              "t.name",
	"slug":              "t.slug",
	"status":            "t.status",
	"subscription_tier": "t.subscription_tier",
	"created_at":        "t.created_at",
	"user_count":        "user_count",
	"active_user_count": "active_user_count",
	"last_activity_at":  "last_activity_at",
}

// ListTenants returns a paginated AdminTenantSummary[] computed in a single SQL
// statement via a LEFT JOIN aggregate over users (never N+1). storage_used_bytes
// is reported as 0 here — like license_state/seats it is sourced elsewhere and
// the frontend lazy-loads usage per visible row (doc §E.2 P0 fallback).
func (r *Repository) ListTenants(ctx context.Context, p ListParams) ([]AdminTenantSummary, int, error) {
	where := []string{"1=1"}
	args := []any{}
	idx := 1

	if s := strings.TrimSpace(p.Search); s != "" {
		where = append(where, fmt.Sprintf("(t.name ILIKE $%d OR t.slug ILIKE $%d OR t.domain ILIKE $%d)", idx, idx, idx))
		args = append(args, "%"+s+"%")
		idx++
	}
	if len(p.Statuses) > 0 {
		ph := make([]string, 0, len(p.Statuses))
		for _, st := range p.Statuses {
			st = strings.TrimSpace(st)
			if st == "" {
				continue
			}
			ph = append(ph, fmt.Sprintf("$%d", idx))
			args = append(args, st)
			idx++
		}
		if len(ph) > 0 {
			where = append(where, fmt.Sprintf("t.status IN (%s)", strings.Join(ph, ", ")))
		}
	}
	if len(p.Tiers) > 0 {
		ph := make([]string, 0, len(p.Tiers))
		for _, tr := range p.Tiers {
			tr = strings.TrimSpace(tr)
			if tr == "" {
				continue
			}
			ph = append(ph, fmt.Sprintf("$%d", idx))
			args = append(args, tr)
			idx++
		}
		if len(ph) > 0 {
			where = append(where, fmt.Sprintf("t.subscription_tier IN (%s)", strings.Join(ph, ", ")))
		}
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := r.pool.QueryRow(ctx, "SELECT COUNT(*) FROM tenants t WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting tenants: %w", err)
	}

	sortCol := "t.created_at"
	if c, ok := allowedSorts[p.Sort]; ok {
		sortCol = c
	}
	sortDir := "DESC"
	if strings.EqualFold(p.Order, "asc") {
		sortDir = "ASC"
	}

	page := p.Page
	if page < 1 {
		page = 1
	}
	perPage := p.PerPage
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	offset := (page - 1) * perPage

	// Single LEFT JOIN aggregate: user_count, active_user_count and last_activity
	// computed once per tenant, no per-row round-trips.
	query := fmt.Sprintf(`
		SELECT
			t.id, t.name, t.slug, t.status, t.subscription_tier,
			COALESCE(u.user_count, 0)        AS user_count,
			COALESCE(u.active_user_count, 0) AS active_user_count,
			t.deprovisioned_at, t.retain_until, t.created_at,
			u.last_activity_at
		FROM tenants t
		LEFT JOIN (
			SELECT tenant_id,
			       COUNT(*)                                         AS user_count,
			       COUNT(*) FILTER (WHERE status = 'active')        AS active_user_count,
			       MAX(last_login_at)                               AS last_activity_at
			FROM users
			WHERE deleted_at IS NULL
			GROUP BY tenant_id
		) u ON u.tenant_id = t.id
		WHERE %s
		ORDER BY %s %s
		LIMIT $%d OFFSET $%d`,
		whereSQL, sortCol, sortDir, idx, idx+1,
	)
	args = append(args, perPage, offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tenants: %w", err)
	}
	defer rows.Close()

	out := make([]AdminTenantSummary, 0, perPage)
	for rows.Next() {
		var s AdminTenantSummary
		if err := rows.Scan(
			&s.ID, &s.Name, &s.Slug, &s.Status, &s.SubscriptionTier,
			&s.UserCount, &s.ActiveUserCount,
			&s.DeprovisionedAt, &s.RetainUntil, &s.CreatedAt,
			&s.LastActivityAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning tenant summary: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterating tenant summaries: %w", err)
	}
	return out, total, nil
}

// GetTenant returns a single AdminTenantSummary by id, using the SAME projection
// as ListTenants (identical column list + LEFT JOIN aggregate) so a detail row is
// byte-for-byte consistent with a list row. It returns ErrNotFound when the tenant
// does not exist.
func (r *Repository) GetTenant(ctx context.Context, tenantID string) (*AdminTenantSummary, error) {
	const query = `
		SELECT
			t.id, t.name, t.slug, t.status, t.subscription_tier,
			COALESCE(u.user_count, 0)        AS user_count,
			COALESCE(u.active_user_count, 0) AS active_user_count,
			t.deprovisioned_at, t.retain_until, t.created_at,
			u.last_activity_at
		FROM tenants t
		LEFT JOIN (
			SELECT tenant_id,
			       COUNT(*)                                         AS user_count,
			       COUNT(*) FILTER (WHERE status = 'active')        AS active_user_count,
			       MAX(last_login_at)                               AS last_activity_at
			FROM users
			WHERE deleted_at IS NULL
			GROUP BY tenant_id
		) u ON u.tenant_id = t.id
		WHERE t.id = $1`

	var s AdminTenantSummary
	err := r.pool.QueryRow(ctx, query, tenantID).Scan(
		&s.ID, &s.Name, &s.Slug, &s.Status, &s.SubscriptionTier,
		&s.UserCount, &s.ActiveUserCount,
		&s.DeprovisionedAt, &s.RetainUntil, &s.CreatedAt,
		&s.LastActivityAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("tenant %s: %w", tenantID, ErrNotFound)
		}
		return nil, fmt.Errorf("getting tenant: %w", err)
	}
	return &s, nil
}

// Summary computes the cross-tenant overview rollup (gap G3). attention counts
// tenants that are suspended OR mid-provisioning (onboarding) OR deprovisioned
// but still inside their retention window.
func (r *Repository) Summary(ctx context.Context) (*PlatformSummary, error) {
	var s PlatformSummary
	err := r.pool.QueryRow(ctx, `
		SELECT
			COUNT(*)                                                          AS tenant_count,
			COUNT(*) FILTER (WHERE status = 'active')                         AS active,
			COUNT(*) FILTER (WHERE status = 'suspended')                      AS suspended,
			COUNT(*) FILTER (WHERE status = 'trial')                          AS trial,
			COUNT(*) FILTER (WHERE status = 'deprovisioned')                  AS deprovisioned,
			COUNT(*) FILTER (
				WHERE status = 'suspended'
				   OR status = 'onboarding'
				   OR (status = 'deprovisioned' AND retain_until IS NOT NULL AND retain_until > now())
			)                                                                 AS attention
		FROM tenants`,
	).Scan(&s.TenantCount, &s.Active, &s.Suspended, &s.Trial, &s.Deprovisioned, &s.Attention)
	if err != nil {
		return nil, fmt.Errorf("computing tenant summary: %w", err)
	}

	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`,
	).Scan(&s.TotalUsers); err != nil {
		return nil, fmt.Errorf("counting total users: %w", err)
	}

	// API calls in the last 24h from audit_logs (best-effort; nil if unavailable).
	var apiCalls int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE created_at > now() - interval '24 hours'`,
	).Scan(&apiCalls); err == nil {
		s.APICalls24h = &apiCalls
	}

	// total_storage_bytes is sourced outside platform_core (files/usage); reported
	// as 0 here, consistent with the per-row lazy-load fallback for G2.
	s.TotalStorageBytes = 0
	return &s, nil
}

// GetTenantIdentity returns the minimal tenant identity needed by suspend guards.
func (r *Repository) GetTenantIdentity(ctx context.Context, tenantID string) (*tenantIdentity, error) {
	var ti tenantIdentity
	err := r.pool.QueryRow(ctx,
		`SELECT name, slug, status FROM tenants WHERE id = $1`, tenantID,
	).Scan(&ti.Name, &ti.Slug, &ti.Status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("tenant %s: %w", tenantID, ErrNotFound)
		}
		return nil, fmt.Errorf("loading tenant identity: %w", err)
	}
	return &ti, nil
}

// SetTenantStatus flips only the tenant row status (used by suspend/unsuspend).
// It deliberately does NOT touch deprovisioned_at/retain_until.
func (r *Repository) SetTenantStatus(ctx context.Context, tenantID, status string) error {
	ct, err := r.pool.Exec(ctx,
		`UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1`, tenantID, status)
	if err != nil {
		return fmt.Errorf("setting tenant status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("tenant %s: %w", tenantID, ErrNotFound)
	}
	return nil
}

// SuspendUsers marks every user of the tenant as suspended. Mirrors the
// deprovisioner store method of the same name (cuts access without soft-delete).
func (r *Repository) SuspendUsers(ctx context.Context, tenantID string) error {
	if _, err := r.pool.Exec(ctx,
		`UPDATE users SET status = 'suspended', updated_at = now() WHERE tenant_id = $1`, tenantID); err != nil {
		return fmt.Errorf("suspending users: %w", err)
	}
	return nil
}

// ReactivateUsers reverses SuspendUsers — restores only users that are currently
// suspended (it will not resurrect soft-deleted rows or change other statuses).
func (r *Repository) ReactivateUsers(ctx context.Context, tenantID string) error {
	if _, err := r.pool.Exec(ctx,
		`UPDATE users SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND status = 'suspended'`, tenantID); err != nil {
		return fmt.Errorf("reactivating users: %w", err)
	}
	return nil
}

// DeleteSessions removes all DB-backed sessions for the tenant.
func (r *Repository) DeleteSessions(ctx context.Context, tenantID string) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM sessions WHERE tenant_id = $1`, tenantID); err != nil {
		return fmt.Errorf("deleting sessions: %w", err)
	}
	return nil
}

// RevokeAPIKeys revokes all active API keys for the tenant.
func (r *Repository) RevokeAPIKeys(ctx context.Context, tenantID string) error {
	if _, err := r.pool.Exec(ctx,
		`UPDATE api_keys SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL`, tenantID); err != nil {
		return fmt.Errorf("revoking api keys: %w", err)
	}
	return nil
}

// InsertAuditLog writes a synchronous, fail-closed audit row into platform_core
// audit_logs. Used for destructive platform ops (suspend/unsuspend/impersonate)
// so a broker outage cannot silently drop the record (doc §I OQ-4).
func (r *Repository) InsertAuditLog(ctx context.Context, tenantID, actorID, action string, metadata []byte) error {
	if len(metadata) == 0 {
		metadata = []byte("{}")
	}
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO audit_logs (tenant_id, user_id, service, action, resource_type, resource_id, metadata)
		VALUES ($1, $2, 'platform-admin', $3, 'tenant', $1, $4::jsonb)`,
		tenantID, actorID, action, metadata,
	); err != nil {
		return fmt.Errorf("inserting audit log: %w", err)
	}
	return nil
}

// ResolveImpersonationTarget returns the user to impersonate. If targetUserID is
// supplied it is validated to belong to the tenant; otherwise the tenant owner /
// first tenant-admin (falling back to the earliest-created active user) is chosen.
// The returned roles are the role slugs assigned to that user.
func (r *Repository) ResolveImpersonationTarget(ctx context.Context, tenantID, targetUserID string) (*targetUser, error) {
	var id, email string
	if strings.TrimSpace(targetUserID) != "" {
		err := r.pool.QueryRow(ctx,
			`SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
			targetUserID, tenantID,
		).Scan(&id, &email)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, fmt.Errorf("target user %s in tenant %s: %w", targetUserID, tenantID, ErrNotFound)
			}
			return nil, fmt.Errorf("loading target user: %w", err)
		}
	} else {
		// Prefer a tenant-admin / owner role holder, then fall back to the
		// earliest active user in the tenant.
		err := r.pool.QueryRow(ctx, `
			SELECT u.id, u.email
			FROM users u
			LEFT JOIN user_roles ur ON ur.user_id = u.id
			LEFT JOIN roles ro ON ro.id = ur.role_id
			WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
			ORDER BY (ro.slug IN ('owner', 'tenant-admin')) DESC NULLS LAST, u.created_at ASC
			LIMIT 1`,
			tenantID,
		).Scan(&id, &email)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, fmt.Errorf("no impersonable user in tenant %s: %w", tenantID, ErrNotFound)
			}
			return nil, fmt.Errorf("selecting impersonation target: %w", err)
		}
	}

	roles, err := r.userRoleSlugs(ctx, id)
	if err != nil {
		return nil, err
	}
	return &targetUser{ID: id, Email: email, Roles: roles}, nil
}

func (r *Repository) userRoleSlugs(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ro.slug
		FROM roles ro
		INNER JOIN user_roles ur ON ur.role_id = ro.id
		WHERE ur.user_id = $1
		ORDER BY ro.slug`, userID)
	if err != nil {
		return nil, fmt.Errorf("loading user roles: %w", err)
	}
	defer rows.Close()
	roles := make([]string, 0)
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, fmt.Errorf("scanning role slug: %w", err)
		}
		roles = append(roles, slug)
	}
	return roles, rows.Err()
}
