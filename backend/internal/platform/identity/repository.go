package identity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminUserSummary is a cross-tenant user projection for the platform admin
// console. Unlike the tenant-scoped iam user views it carries the owning
// tenant's display name and a flattened list of role names, and it never
// exposes sensitive columns (password_hash, mfa_secret).
type AdminUserSummary struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	FirstName   string     `json:"first_name"`
	LastName    string     `json:"last_name"`
	TenantID    string     `json:"tenant_id"`
	TenantName  string     `json:"tenant_name"`
	Status      string     `json:"status"`
	Roles       []string   `json:"roles"`
	LastLoginAt *time.Time `json:"last_login_at"`
}

// SearchParams holds the filters for a cross-tenant user search. All fields are
// optional; an empty SearchParams matches every (non-deleted) user across every
// tenant.
type SearchParams struct {
	// Email narrows to users whose email matches (ILIKE, substring).
	Email string
	// Query matches against email OR first_name OR last_name (ILIKE, substring).
	Query string
	// TenantID, when non-empty, restricts the search to a single tenant.
	TenantID string
	// Status, when non-empty, restricts to a single user_status value.
	Status string
	// Page is 1-based.
	Page int
	// PerPage is the page size.
	PerPage int
}

// Repository provides cross-tenant user lookups over the platform_core pool.
// It is intentionally self-contained (it does not depend on the iam repository)
// because it is owned by the platform admin console and must never be subject to
// the tenant-locking that the iam UserRepository.List enforces.
type Repository interface {
	Search(ctx context.Context, params SearchParams) ([]AdminUserSummary, int, error)
}

type repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a cross-tenant identity Repository over the supplied
// platform_core pool.
func NewRepository(pool *pgxpool.Pool) Repository {
	return &repository{pool: pool}
}

func (r *repository) Search(ctx context.Context, params SearchParams) ([]AdminUserSummary, int, error) {
	conditions := []string{"u.deleted_at IS NULL"}
	var args []any
	argIdx := 1

	// Deliberately NO tenant filter unless tenant_id is supplied: this is the
	// cross-tenant search the iam List cannot perform.
	if params.TenantID != "" {
		conditions = append(conditions, fmt.Sprintf("u.tenant_id = $%d", argIdx))
		args = append(args, params.TenantID)
		argIdx++
	}
	if params.Status != "" {
		conditions = append(conditions, fmt.Sprintf("u.status = $%d", argIdx))
		args = append(args, params.Status)
		argIdx++
	}
	if params.Email != "" {
		conditions = append(conditions, fmt.Sprintf("u.email ILIKE $%d", argIdx))
		args = append(args, "%"+params.Email+"%")
		argIdx++
	}
	if params.Query != "" {
		conditions = append(conditions, fmt.Sprintf(
			"(u.email ILIKE $%d OR u.first_name ILIKE $%d OR u.last_name ILIKE $%d)",
			argIdx, argIdx, argIdx,
		))
		args = append(args, "%"+params.Query+"%")
		argIdx++
	}

	where := strings.Join(conditions, " AND ")

	// Count total across all matched tenants.
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM users u WHERE %s", where)
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting users: %w", err)
	}
	if total == 0 {
		return []AdminUserSummary{}, 0, nil
	}

	offset := (params.Page - 1) * params.PerPage

	// Roles are aggregated with a correlated array_agg subquery to avoid an
	// N+1 round trip per user. NULLs are filtered so a roleless user yields an
	// empty array rather than {NULL}.
	dataQuery := fmt.Sprintf(`
		SELECT
			u.id,
			u.email,
			u.first_name,
			u.last_name,
			u.tenant_id,
			t.name AS tenant_name,
			u.status,
			COALESCE(
				(
					SELECT array_agg(r.name ORDER BY r.name)
					FROM user_roles ur
					INNER JOIN roles r ON r.id = ur.role_id
					WHERE ur.user_id = u.id
				),
				ARRAY[]::text[]
			) AS roles,
			u.last_login_at
		FROM users u
		INNER JOIN tenants t ON t.id = u.tenant_id
		WHERE %s
		ORDER BY u.email ASC, u.id ASC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, params.PerPage, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("searching users: %w", err)
	}
	defer rows.Close()

	results := make([]AdminUserSummary, 0)
	for rows.Next() {
		var s AdminUserSummary
		if err := rows.Scan(
			&s.ID,
			&s.Email,
			&s.FirstName,
			&s.LastName,
			&s.TenantID,
			&s.TenantName,
			&s.Status,
			&s.Roles,
			&s.LastLoginAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning user row: %w", err)
		}
		if s.Roles == nil {
			s.Roles = []string{}
		}
		results = append(results, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterating user rows: %w", err)
	}

	return results, total, nil
}
