// Package model defines the licensing domain: plans grant entitlement keys
// (suite / app / module / seat counters), tenants hold one license against a
// plan, per-tenant overrides adjust individual entitlements, and metered
// usage is tracked per UTC calendar month.
package model

import (
	"errors"
	"time"
)

// Plan sources distinguish the assignable catalog from plans imported by
// offline license activation.
const (
	PlanSourceCatalog = "catalog"
	PlanSourceOffline = "offline"
)

// Plan statuses support catalog lifecycle without deleting plans that active
// tenant licenses may still reference.
const (
	PlanStatusActive  = "active"
	PlanStatusRetired = "retired"
)

// License statuses persisted on tenant_licenses. Expiry is computed from
// timestamps, not stored, so a license cannot be active in the database while
// expired in reality.
const (
	LicenseStatusActive    = "active"
	LicenseStatusSuspended = "suspended"
)

// Effective license states returned by decisions.
const (
	StateActive    = "active"
	StateInGrace   = "in_grace"
	StateExpired   = "expired"
	StateSuspended = "suspended"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
	ErrLimitExceeded = errors.New("entitlement limit exceeded")
)

// Plan is a named bundle of entitlements.
type Plan struct {
	ID           string        `json:"id"`
	Key          string        `json:"key"`
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	Source       string        `json:"source"`
	Status       string        `json:"status"`
	Entitlements []Entitlement `json:"entitlements,omitempty"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`
}

// Entitlement grants a key, optionally bounded by a quota.
// Limit semantics: nil = granted without quota; >0 = metered quota;
// 0 = explicitly revoked (meaningful on overrides).
type Entitlement struct {
	Key   string `json:"key"`
	Limit *int64 `json:"limit,omitempty"`
}

// Revoked reports whether this entitlement explicitly revokes its key.
func (e Entitlement) Revoked() bool {
	return e.Limit != nil && *e.Limit == 0
}

// TenantLicense binds a tenant to a plan for a period.
type TenantLicense struct {
	ID               string         `json:"id"`
	TenantID         string         `json:"tenant_id"`
	PlanID           string         `json:"plan_id"`
	PlanKey          string         `json:"plan_key"`
	Status           string         `json:"status"`
	Seats            int64          `json:"seats"`
	StartsAt         time.Time      `json:"starts_at"`
	ExpiresAt        time.Time      `json:"expires_at"`
	GraceDays        int            `json:"grace_days"`
	OfflineLicenseID *string        `json:"offline_license_id,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

// State computes the effective license state at the given instant.
func (l *TenantLicense) State(now time.Time) string {
	if l.Status == LicenseStatusSuspended {
		return StateSuspended
	}
	if now.Before(l.ExpiresAt) {
		return StateActive
	}
	graceEnd := l.ExpiresAt.Add(time.Duration(l.GraceDays) * 24 * time.Hour)
	if now.Before(graceEnd) {
		return StateInGrace
	}
	return StateExpired
}

// Override adjusts one entitlement for one tenant, taking precedence over
// the plan's row for the same key.
type Override struct {
	TenantID  string    `json:"tenant_id"`
	Key       string    `json:"key"`
	Limit     *int64    `json:"limit,omitempty"`
	Reason    string    `json:"reason"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Usage is one tenant's consumption of one metered entitlement in one
// UTC calendar month.
type Usage struct {
	TenantID    string    `json:"tenant_id"`
	Key         string    `json:"key"`
	PeriodStart time.Time `json:"period_start"`
	Used        int64     `json:"used"`
}

// TenantLicenseRow is one row of the cross-tenant fleet license view: a
// tenant's license joined to its current-period seat usage. State is the
// effective state computed by TenantLicense.State.
type TenantLicenseRow struct {
	TenantID  string    `json:"tenant_id"`
	PlanKey   string    `json:"plan_key"`
	Status    string    `json:"status"`
	State     string    `json:"state"`
	Seats     int64     `json:"seats"`
	SeatsUsed int64     `json:"seats_used"`
	ExpiresAt time.Time `json:"expires_at"`
	GraceDays int       `json:"grace_days"`
}

// TenantLicenseFilter narrows the fleet license list (G7).
type TenantLicenseFilter struct {
	Status             string // license status: active | suspended
	PlanKey            string
	ExpiringWithinDays *int // include only licenses expiring within N days
	Page               int
	PerPage            int
}

// SeatRollupTenant is one tenant's contribution to a fleet usage rollup (G11).
type SeatRollupTenant struct {
	TenantID string `json:"tenant_id"`
	Limit    int64  `json:"limit"`
	Used     int64  `json:"used"`
	Over     bool   `json:"over"`
}

// SeatRollup is the cross-tenant aggregate for one metered key in one period.
type SeatRollup struct {
	Key        string             `json:"key"`
	Period     string             `json:"period"`
	TotalLimit int64              `json:"total_limit"`
	TotalUsed  int64              `json:"total_used"`
	PerTenant  []SeatRollupTenant `json:"per_tenant"`
}

// Decision is the enforcement API's answer to "may tenant T use key K?".
type Decision struct {
	Allowed      bool      `json:"allowed"`
	Key          string    `json:"key"`
	Reason       string    `json:"reason,omitempty"`
	LicenseState string    `json:"license_state"`
	PlanKey      string    `json:"plan_key,omitempty"`
	Limit        *int64    `json:"limit,omitempty"`
	Used         int64     `json:"used"`
	Remaining    *int64    `json:"remaining,omitempty"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
}

// PeriodStart returns the first day of t's UTC calendar month — the metering
// period key used by usage_counters.
func PeriodStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}
