package model

import "time"

// TenantID is the typed tenant identifier carried alongside every SIEM
// resource. It is intentionally a named alias around string (not a
// distinct type) so existing helpers like auth.TenantFromContext
// continue to interoperate without manual conversion.
type TenantID = string

// Severity is the normalized severity value used by every SIEM domain
// entity (detection, alert, event, etc.). The values are intentionally
// lowercase to match the existing platform audit module conventions.
type Severity string

// Severity values. Anything outside this set must be normalized at the
// boundary of the system (consumer or handler) before persistence.
const (
	SeverityInfo     Severity = "info"
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// AllSeverities is the canonical ordering of severities, weakest first.
// Tests and consumers may iterate over it deterministically.
var AllSeverities = []Severity{
	SeverityInfo,
	SeverityLow,
	SeverityMedium,
	SeverityHigh,
	SeverityCritical,
}

// IsValid reports whether s is one of the recognized severities.
func (s Severity) IsValid() bool {
	for _, v := range AllSeverities {
		if v == s {
			return true
		}
	}
	return false
}

// HealthCheck mirrors a row of siem.health_check. It exists so the
// repository can prove a round-trip insert/select under tenant isolation
// without depending on any of the real domain tables that arrive in
// SIEM-03 onward.
type HealthCheck struct {
	ID        string    `db:"id"`
	TenantID  string    `db:"tenant_id"`
	CreatedAt time.Time `db:"created_at"`
}

// MetaInfo is the JSON payload returned by GET /api/v1/siem/_meta.
//
// Field names are explicit so the smoke and contract scripts can assert
// against them with `jq` without surprises.
type MetaInfo struct {
	Service       string `json:"service"`
	Version       string `json:"version"`
	Commit        string `json:"commit"`
	BuildTime     string `json:"build_time"`
	GoVersion     string `json:"go_version"`
	UptimeSeconds int64  `json:"uptime_seconds"`
	TenantID      string `json:"tenant_id"`
}
