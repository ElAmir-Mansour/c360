// Package repository persists the licensing domain. Every method takes a DBTX
// so callers choose the execution context: a pool for single reads, or the
// service's open transaction so state changes commit atomically with their
// outbox events.
package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/license/model"
)

// DBTX is the subset of pgx satisfied by both *pgxpool.Pool and pgx.Tx.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repository holds no state; it exists so the service can depend on an
// interface-shaped value and tests can substitute it.
type Repository struct{}

func New() *Repository { return &Repository{} }

// isUniqueViolation reports whether err is a PostgreSQL unique constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// --- Plans ---------------------------------------------------------------

const insertPlanSQL = `
INSERT INTO license_plans (key, name, description, source, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, status, created_at, updated_at`

// CreatePlan inserts a plan and returns it with generated fields populated.
func (r *Repository) CreatePlan(ctx context.Context, db DBTX, plan *model.Plan) error {
	if plan.Source == "" {
		plan.Source = model.PlanSourceCatalog
	}
	if plan.Status == "" {
		plan.Status = model.PlanStatusActive
	}
	err := db.QueryRow(ctx, insertPlanSQL, plan.Key, plan.Name, plan.Description, plan.Source, plan.Status).
		Scan(&plan.ID, &plan.Status, &plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("plan %s: %w", plan.Key, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating plan %s: %w", plan.Key, err)
	}
	return nil
}

const selectPlanByKeySQL = `
SELECT id, key, name, description, source, status, created_at, updated_at
FROM license_plans WHERE key = $1`

// GetPlanByKey loads a plan and its entitlements by its unique key.
func (r *Repository) GetPlanByKey(ctx context.Context, db DBTX, key string) (*model.Plan, error) {
	var plan model.Plan
	err := db.QueryRow(ctx, selectPlanByKeySQL, key).
		Scan(&plan.ID, &plan.Key, &plan.Name, &plan.Description, &plan.Source, &plan.Status, &plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("plan %s: %w", key, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading plan %s: %w", key, err)
	}
	entitlements, err := r.listPlanEntitlements(ctx, db, plan.ID)
	if err != nil {
		return nil, err
	}
	plan.Entitlements = entitlements
	return &plan, nil
}

const listPlansSQL = `
SELECT id, key, name, description, source, status, created_at, updated_at
FROM license_plans
WHERE source = 'catalog' AND status = 'active'
ORDER BY key`

// ListCatalogPlans returns all active assignable plans with entitlements.
func (r *Repository) ListCatalogPlans(ctx context.Context, db DBTX) ([]*model.Plan, error) {
	rows, err := db.Query(ctx, listPlansSQL)
	if err != nil {
		return nil, fmt.Errorf("listing plans: %w", err)
	}
	defer rows.Close()

	var plans []*model.Plan
	for rows.Next() {
		var plan model.Plan
		if err := rows.Scan(&plan.ID, &plan.Key, &plan.Name, &plan.Description, &plan.Source, &plan.Status, &plan.CreatedAt, &plan.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanning plan: %w", err)
		}
		plans = append(plans, &plan)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading plans: %w", err)
	}
	for _, plan := range plans {
		entitlements, err := r.listPlanEntitlements(ctx, db, plan.ID)
		if err != nil {
			return nil, err
		}
		plan.Entitlements = entitlements
	}
	return plans, nil
}

const listTenantIDsByPlanKeySQL = `
SELECT l.tenant_id::text
FROM tenant_licenses l
JOIN license_plans p ON p.id = l.plan_id
WHERE p.key = $1
ORDER BY l.tenant_id`

// ListTenantIDsByPlanKey returns tenants whose current license points at the
// plan. It includes suspended and expired licenses because cache invalidation
// must clear any prior route decision regardless of the effective state.
func (r *Repository) ListTenantIDsByPlanKey(ctx context.Context, db DBTX, key string) ([]string, error) {
	rows, err := db.Query(ctx, listTenantIDsByPlanKeySQL, key)
	if err != nil {
		return nil, fmt.Errorf("listing tenants for plan %s: %w", key, err)
	}
	defer rows.Close()

	var tenantIDs []string
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return nil, fmt.Errorf("scanning tenant for plan %s: %w", key, err)
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading tenants for plan %s: %w", key, err)
	}
	return tenantIDs, nil
}

const updatePlanSQL = `
UPDATE license_plans
SET name = $2, description = $3, updated_at = now()
WHERE key = $1 AND source = 'catalog'
RETURNING id, key, name, description, source, status, created_at, updated_at`

// UpdatePlan updates catalog plan metadata without changing its key,
// entitlements, source or lifecycle status.
func (r *Repository) UpdatePlan(ctx context.Context, db DBTX, key, name, description string) (*model.Plan, error) {
	var plan model.Plan
	err := db.QueryRow(ctx, updatePlanSQL, key, name, description).
		Scan(&plan.ID, &plan.Key, &plan.Name, &plan.Description, &plan.Source, &plan.Status, &plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("plan %s: %w", key, model.ErrNotFound)
		}
		return nil, fmt.Errorf("updating plan %s: %w", key, err)
	}
	entitlements, err := r.listPlanEntitlements(ctx, db, plan.ID)
	if err != nil {
		return nil, err
	}
	plan.Entitlements = entitlements
	return &plan, nil
}

const setPlanStatusSQL = `
UPDATE license_plans
SET status = $2, updated_at = now()
WHERE key = $1 AND source = 'catalog'
RETURNING id, key, name, description, source, status, created_at, updated_at`

// SetPlanStatus changes a catalog plan's lifecycle status. Tenant licenses
// that already reference the plan remain valid; inactive plans are hidden from
// assignment by the service layer.
func (r *Repository) SetPlanStatus(ctx context.Context, db DBTX, key, status string) (*model.Plan, error) {
	var plan model.Plan
	err := db.QueryRow(ctx, setPlanStatusSQL, key, status).
		Scan(&plan.ID, &plan.Key, &plan.Name, &plan.Description, &plan.Source, &plan.Status, &plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("plan %s: %w", key, model.ErrNotFound)
		}
		return nil, fmt.Errorf("setting plan %s status: %w", key, err)
	}
	entitlements, err := r.listPlanEntitlements(ctx, db, plan.ID)
	if err != nil {
		return nil, err
	}
	plan.Entitlements = entitlements
	return &plan, nil
}

const upsertPlanEntitlementSQL = `
INSERT INTO plan_entitlements (plan_id, key, limit_value)
VALUES ($1, $2, $3)
ON CONFLICT (plan_id, key) DO UPDATE SET limit_value = EXCLUDED.limit_value`

// SetPlanEntitlements replaces the plan's entitlement set.
func (r *Repository) SetPlanEntitlements(ctx context.Context, db DBTX, planID string, entitlements []model.Entitlement) error {
	if _, err := db.Exec(ctx, `DELETE FROM plan_entitlements WHERE plan_id = $1`, planID); err != nil {
		return fmt.Errorf("clearing plan entitlements: %w", err)
	}
	for _, e := range entitlements {
		if _, err := db.Exec(ctx, upsertPlanEntitlementSQL, planID, e.Key, e.Limit); err != nil {
			return fmt.Errorf("setting entitlement %s: %w", e.Key, err)
		}
	}
	if _, err := db.Exec(ctx, `UPDATE license_plans SET updated_at = now() WHERE id = $1`, planID); err != nil {
		return fmt.Errorf("touching plan: %w", err)
	}
	return nil
}

const listPlanEntitlementsSQL = `
SELECT key, limit_value FROM plan_entitlements WHERE plan_id = $1 ORDER BY key`

func (r *Repository) listPlanEntitlements(ctx context.Context, db DBTX, planID string) ([]model.Entitlement, error) {
	rows, err := db.Query(ctx, listPlanEntitlementsSQL, planID)
	if err != nil {
		return nil, fmt.Errorf("listing plan entitlements: %w", err)
	}
	defer rows.Close()

	var entitlements []model.Entitlement
	for rows.Next() {
		var e model.Entitlement
		if err := rows.Scan(&e.Key, &e.Limit); err != nil {
			return nil, fmt.Errorf("scanning entitlement: %w", err)
		}
		entitlements = append(entitlements, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading entitlements: %w", err)
	}
	return entitlements, nil
}

// --- Tenant licenses ------------------------------------------------------

const upsertTenantLicenseSQL = `
INSERT INTO tenant_licenses (tenant_id, plan_id, status, seats, starts_at, expires_at, grace_days, offline_license_id, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (tenant_id) DO UPDATE SET
    plan_id            = EXCLUDED.plan_id,
    status             = EXCLUDED.status,
    seats              = EXCLUDED.seats,
    starts_at          = EXCLUDED.starts_at,
    expires_at         = EXCLUDED.expires_at,
    grace_days         = EXCLUDED.grace_days,
    offline_license_id = EXCLUDED.offline_license_id,
    metadata           = EXCLUDED.metadata,
    updated_at         = now()
RETURNING id, created_at, updated_at`

// UpsertTenantLicense assigns or replaces the tenant's license (one license
// per tenant; plan changes overwrite in place, history lives in events).
func (r *Repository) UpsertTenantLicense(ctx context.Context, db DBTX, lic *model.TenantLicense) error {
	metadata := lic.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshaling license metadata: %w", err)
	}
	err = db.QueryRow(ctx, upsertTenantLicenseSQL,
		lic.TenantID, lic.PlanID, lic.Status, lic.Seats, lic.StartsAt, lic.ExpiresAt,
		lic.GraceDays, lic.OfflineLicenseID, metadataJSON,
	).Scan(&lic.ID, &lic.CreatedAt, &lic.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			// offline_license_id unique: the same license file was already activated.
			return fmt.Errorf("offline license already activated: %w", model.ErrAlreadyExists)
		}
		return fmt.Errorf("upserting tenant license: %w", err)
	}
	return nil
}

const selectTenantLicenseSQL = `
SELECT l.id, l.tenant_id, l.plan_id, p.key, l.status, l.seats, l.starts_at, l.expires_at,
       l.grace_days, l.offline_license_id, l.metadata, l.created_at, l.updated_at
FROM tenant_licenses l
JOIN license_plans p ON p.id = l.plan_id
WHERE l.tenant_id = $1`

// GetTenantLicense loads the tenant's license with its plan key.
func (r *Repository) GetTenantLicense(ctx context.Context, db DBTX, tenantID string) (*model.TenantLicense, error) {
	var lic model.TenantLicense
	var metadataJSON []byte
	err := db.QueryRow(ctx, selectTenantLicenseSQL, tenantID).Scan(
		&lic.ID, &lic.TenantID, &lic.PlanID, &lic.PlanKey, &lic.Status, &lic.Seats,
		&lic.StartsAt, &lic.ExpiresAt, &lic.GraceDays, &lic.OfflineLicenseID,
		&metadataJSON, &lic.CreatedAt, &lic.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("license for tenant %s: %w", tenantID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading tenant license: %w", err)
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &lic.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshaling license metadata: %w", err)
		}
	}
	return &lic, nil
}

const setLicenseStatusSQL = `
UPDATE tenant_licenses SET status = $2, updated_at = now() WHERE tenant_id = $1`

// SetLicenseStatus suspends or resumes a tenant's license.
func (r *Repository) SetLicenseStatus(ctx context.Context, db DBTX, tenantID, status string) error {
	tag, err := db.Exec(ctx, setLicenseStatusSQL, tenantID, status)
	if err != nil {
		return fmt.Errorf("setting license status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("license for tenant %s: %w", tenantID, model.ErrNotFound)
	}
	return nil
}

// listTenantLicensesSQL joins each tenant license to its current-period
// seats.users usage counter. The seats key and period are passed as
// parameters; absent counters read as zero. Filters are applied with optional
// predicates that are no-ops when their parameter is NULL.
const listTenantLicensesSQL = `
SELECT l.tenant_id::text, p.key, l.status, l.seats, l.expires_at, l.grace_days,
       COALESCE(u.used, 0) AS seats_used,
       COUNT(*) OVER () AS total
FROM tenant_licenses l
JOIN license_plans p ON p.id = l.plan_id
LEFT JOIN LATERAL (
    SELECT used FROM usage_counters uc
    WHERE uc.tenant_id = l.tenant_id AND uc.key = $1 AND uc.period_start = $2
) u ON true
WHERE ($3::text IS NULL OR l.status = $3)
  AND ($4::text IS NULL OR p.key = $4)
  AND ($5::int IS NULL OR (l.status = 'active' AND l.expires_at <= now() + make_interval(days => $5::int)))
ORDER BY l.expires_at
LIMIT $6 OFFSET $7`

// ListTenantLicenses returns a page of the cross-tenant fleet license view
// (G7), each row carrying current-period seat usage and the total row count
// for pagination. seatsKey/periodStart locate the usage counter to join.
func (r *Repository) ListTenantLicenses(ctx context.Context, db DBTX, seatsKey string, periodStart time.Time, f model.TenantLicenseFilter, now time.Time) ([]model.TenantLicenseRow, int, error) {
	page := f.Page
	if page < 1 {
		page = 1
	}
	perPage := f.PerPage
	if perPage < 1 {
		perPage = 20
	}
	var status, planKey *string
	if f.Status != "" {
		status = &f.Status
	}
	if f.PlanKey != "" {
		planKey = &f.PlanKey
	}
	rows, err := db.Query(ctx, listTenantLicensesSQL,
		seatsKey, periodStart, status, planKey, f.ExpiringWithinDays, perPage, (page-1)*perPage)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tenant licenses: %w", err)
	}
	defer rows.Close()

	var (
		out   []model.TenantLicenseRow
		total int
	)
	for rows.Next() {
		var row model.TenantLicenseRow
		var lic model.TenantLicense
		if err := rows.Scan(&row.TenantID, &row.PlanKey, &row.Status, &row.Seats,
			&row.ExpiresAt, &row.GraceDays, &row.SeatsUsed, &total); err != nil {
			return nil, 0, fmt.Errorf("scanning tenant license row: %w", err)
		}
		lic.Status, lic.ExpiresAt, lic.GraceDays = row.Status, row.ExpiresAt, row.GraceDays
		row.State = lic.State(now)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("reading tenant license rows: %w", err)
	}
	return out, total, nil
}

// listExpiringLicensesSQL uses idx_tenant_licenses_expiry: active licenses
// whose expiry falls within the window, soonest first.
const listExpiringLicensesSQL = `
SELECT l.tenant_id::text, p.key, l.status, l.seats, l.expires_at, l.grace_days
FROM tenant_licenses l
JOIN license_plans p ON p.id = l.plan_id
WHERE l.status = 'active' AND l.expires_at <= now() + make_interval(days => $1::int)
ORDER BY l.expires_at`

// ListExpiringLicenses returns active licenses expiring within withinDays,
// ordered by expires_at (G8). now computes each row's effective state.
func (r *Repository) ListExpiringLicenses(ctx context.Context, db DBTX, withinDays int, now time.Time) ([]model.TenantLicenseRow, error) {
	rows, err := db.Query(ctx, listExpiringLicensesSQL, withinDays)
	if err != nil {
		return nil, fmt.Errorf("listing expiring licenses: %w", err)
	}
	defer rows.Close()

	var out []model.TenantLicenseRow
	for rows.Next() {
		var row model.TenantLicenseRow
		var lic model.TenantLicense
		if err := rows.Scan(&row.TenantID, &row.PlanKey, &row.Status, &row.Seats,
			&row.ExpiresAt, &row.GraceDays); err != nil {
			return nil, fmt.Errorf("scanning expiring license: %w", err)
		}
		lic.Status, lic.ExpiresAt, lic.GraceDays = row.Status, row.ExpiresAt, row.GraceDays
		row.State = lic.State(now)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading expiring licenses: %w", err)
	}
	return out, nil
}

// seatRollupSQL aggregates one metered key across every tenant: the seats
// field defines the per-tenant limit, the current-period counter defines
// usage. Tenants with no counter row still appear (used = 0).
const seatRollupSQL = `
SELECT l.tenant_id::text, l.seats AS limit_value, COALESCE(u.used, 0) AS used
FROM tenant_licenses l
LEFT JOIN LATERAL (
    SELECT used FROM usage_counters uc
    WHERE uc.tenant_id = l.tenant_id AND uc.key = $1 AND uc.period_start = $2
) u ON true
ORDER BY l.tenant_id`

// SeatRollup aggregates a seat/metered key across the fleet for one period
// (G11). The limit comes from tenant_licenses.seats; usage from the
// current-period counter for key.
func (r *Repository) SeatRollup(ctx context.Context, db DBTX, key string, periodStart time.Time) (int64, int64, []model.SeatRollupTenant, error) {
	rows, err := db.Query(ctx, seatRollupSQL, key, periodStart)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("aggregating usage rollup for %s: %w", key, err)
	}
	defer rows.Close()

	var (
		totalLimit, totalUsed int64
		perTenant             []model.SeatRollupTenant
	)
	for rows.Next() {
		var t model.SeatRollupTenant
		if err := rows.Scan(&t.TenantID, &t.Limit, &t.Used); err != nil {
			return 0, 0, nil, fmt.Errorf("scanning rollup row: %w", err)
		}
		t.Over = t.Limit > 0 && t.Used > t.Limit
		totalLimit += t.Limit
		totalUsed += t.Used
		perTenant = append(perTenant, t)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, nil, fmt.Errorf("reading rollup rows: %w", err)
	}
	return totalLimit, totalUsed, perTenant, nil
}

// --- Overrides ------------------------------------------------------------

const upsertOverrideSQL = `
INSERT INTO entitlement_overrides (tenant_id, key, limit_value, reason)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tenant_id, key) DO UPDATE SET
    limit_value = EXCLUDED.limit_value,
    reason      = EXCLUDED.reason,
    updated_at  = now()`

// UpsertOverride creates or updates a per-tenant entitlement override.
func (r *Repository) UpsertOverride(ctx context.Context, db DBTX, o *model.Override) error {
	if _, err := db.Exec(ctx, upsertOverrideSQL, o.TenantID, o.Key, o.Limit, o.Reason); err != nil {
		return fmt.Errorf("upserting override %s: %w", o.Key, err)
	}
	return nil
}

// DeleteOverride removes a per-tenant override, restoring the plan default.
func (r *Repository) DeleteOverride(ctx context.Context, db DBTX, tenantID, key string) error {
	tag, err := db.Exec(ctx, `DELETE FROM entitlement_overrides WHERE tenant_id = $1 AND key = $2`, tenantID, key)
	if err != nil {
		return fmt.Errorf("deleting override %s: %w", key, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("override %s: %w", key, model.ErrNotFound)
	}
	return nil
}

const listOverridesSQL = `
SELECT tenant_id, key, limit_value, reason, updated_at
FROM entitlement_overrides WHERE tenant_id = $1 ORDER BY key`

// ListOverrides returns all overrides for a tenant.
func (r *Repository) ListOverrides(ctx context.Context, db DBTX, tenantID string) ([]model.Override, error) {
	rows, err := db.Query(ctx, listOverridesSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing overrides: %w", err)
	}
	defer rows.Close()

	var overrides []model.Override
	for rows.Next() {
		var o model.Override
		if err := rows.Scan(&o.TenantID, &o.Key, &o.Limit, &o.Reason, &o.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanning override: %w", err)
		}
		overrides = append(overrides, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading overrides: %w", err)
	}
	return overrides, nil
}

// --- Usage ----------------------------------------------------------------

const addUsageSQL = `
INSERT INTO usage_counters (tenant_id, key, period_start, used)
VALUES ($1, $2, $3, GREATEST($4, 0))
ON CONFLICT (tenant_id, key, period_start) DO UPDATE SET
    used       = GREATEST(usage_counters.used + $4, 0),
    updated_at = now()
RETURNING used`

// AddUsage atomically adjusts the tenant's counter for the current period by
// delta (which may be negative; counters floor at zero) and returns the new
// total.
func (r *Repository) AddUsage(ctx context.Context, db DBTX, tenantID, key string, periodStart time.Time, delta int64) (int64, error) {
	var used int64
	err := db.QueryRow(ctx, addUsageSQL, tenantID, key, periodStart, delta).Scan(&used)
	if err != nil {
		return 0, fmt.Errorf("adding usage for %s: %w", key, err)
	}
	return used, nil
}

const getUsageSQL = `
SELECT used FROM usage_counters WHERE tenant_id = $1 AND key = $2 AND period_start = $3`

// GetUsage returns the tenant's counter for the period; zero if absent.
func (r *Repository) GetUsage(ctx context.Context, db DBTX, tenantID, key string, periodStart time.Time) (int64, error) {
	var used int64
	err := db.QueryRow(ctx, getUsageSQL, tenantID, key, periodStart).Scan(&used)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("reading usage for %s: %w", key, err)
	}
	return used, nil
}

const listUsageSQL = `
SELECT tenant_id, key, period_start, used
FROM usage_counters WHERE tenant_id = $1 AND period_start = $2 ORDER BY key`

// ListUsage returns all counters for a tenant in the given period.
func (r *Repository) ListUsage(ctx context.Context, db DBTX, tenantID string, periodStart time.Time) ([]model.Usage, error) {
	rows, err := db.Query(ctx, listUsageSQL, tenantID, periodStart)
	if err != nil {
		return nil, fmt.Errorf("listing usage: %w", err)
	}
	defer rows.Close()

	var usage []model.Usage
	for rows.Next() {
		var u model.Usage
		if err := rows.Scan(&u.TenantID, &u.Key, &u.PeriodStart, &u.Used); err != nil {
			return nil, fmt.Errorf("scanning usage: %w", err)
		}
		usage = append(usage, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading usage: %w", err)
	}
	return usage, nil
}
