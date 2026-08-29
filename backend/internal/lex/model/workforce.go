package model

import "github.com/google/uuid"

// MetricValue is the universal numeric carrier for workforce reporting.
// Unavailable metrics carry a specific reason and never fabricate a zero.
type MetricValue struct {
	Value       *float64 `json:"value"`
	Available   bool     `json:"available"`
	Reason      string   `json:"reason,omitempty"`
	Numerator   *int     `json:"numerator,omitempty"`
	Denominator *int     `json:"denominator,omitempty"`
	Sample      *int     `json:"sample,omitempty"`
}

type ScopeMode string

const (
	ScopeModeOrg      ScopeMode = "org"
	ScopeModeSelf     ScopeMode = "self"
	ScopeModeTenant   ScopeMode = "tenant"
	ScopeModeUnscoped ScopeMode = "unscoped"
)

type ScopeEnvelope struct {
	Mode        ScopeMode   `json:"mode"`
	EntityIDs   []uuid.UUID `json:"entity_ids"`
	UserIDs     []uuid.UUID `json:"user_ids"`
	MemberCount int         `json:"member_count"`
	Reason      string      `json:"reason,omitempty"`
	Warning     string      `json:"warning,omitempty"`
	StaleDays   *int        `json:"stale_days,omitempty"`
}

type CalendarSource string

const (
	CalendarSourceTenant      CalendarSource = "tenant"
	CalendarSourceFallbackUTC CalendarSource = "fallback_utc"
)

type PeriodEnvelope struct {
	From           string         `json:"from"`
	To             string         `json:"to"`
	Timezone       string         `json:"timezone"`
	CalendarSource CalendarSource `json:"calendar_source"`
	WorkingDays    MetricValue    `json:"working_days"`
}

type CoverageExclusion struct {
	Domain string `json:"domain"`
	Reason string `json:"reason"`
	Detail string `json:"detail,omitempty"`
}

type CoverageEnvelope struct {
	DomainsRequested  int                 `json:"domains_requested"`
	DomainsReturned   int                 `json:"domains_returned"`
	ItemsTotal        int                 `json:"items_total"`
	ItemsAttributed   int                 `json:"items_attributed"`
	ItemsUnattributed int                 `json:"items_unattributed"`
	AttributionPct    int                 `json:"attribution_pct"`
	RowsReturned      int                 `json:"rows_returned"`
	RowsTruncated     int                 `json:"rows_truncated"`
	Exclusions        []CoverageExclusion `json:"exclusions"`
}

type DomainErrorKind string

const (
	DomainErrorForbidden  DomainErrorKind = "forbidden"
	DomainErrorQueryError DomainErrorKind = "query_error"
)

type DomainError struct {
	Domain string          `json:"domain"`
	Kind   DomainErrorKind `json:"kind"`
	Detail string          `json:"detail,omitempty"`
}

type AttributionPath string

const (
	AttributionDirect AttributionPath = "direct"
	AttributionLinked AttributionPath = "linked"
)

type DomainBreakdown struct {
	Domain          string          `json:"domain"`
	Rel             string          `json:"rel"`
	AttributionPath AttributionPath `json:"attribution_path"`
	Open            int             `json:"open"`
	Resolved        int             `json:"resolved"`
}

type TeamMemberMetrics struct {
	ActiveWorkload         MetricValue `json:"active_workload"`
	LoadIndexPct           MetricValue `json:"load_index_pct"`
	UtilisationPct         MetricValue `json:"utilisation_pct"`
	CompletionRatePct      MetricValue `json:"completion_rate_pct"`
	OnTimePct              MetricValue `json:"on_time_pct"`
	MedianCycleDays        MetricValue `json:"median_cycle_days"`
	ApprovalLatencyHrs     MetricValue `json:"approval_latency_hrs"`
	ObligationDischargePct MetricValue `json:"obligation_discharge_pct"`
	OverdueCount           MetricValue `json:"overdue_count"`
	IdleAssignmentPct      MetricValue `json:"idle_assignment_pct"`
}

type IdentityStatus string

const (
	IdentityResolved   IdentityStatus = "resolved"
	IdentityUnverified IdentityStatus = "unverified"
	IdentityUnknown    IdentityStatus = "unknown"
)

type TeamMember struct {
	UserID         uuid.UUID         `json:"user_id"`
	DisplayName    string            `json:"display_name"`
	AvatarURL      string            `json:"avatar_url,omitempty"`
	Title          map[string]string `json:"title,omitempty"`
	EntityID       *uuid.UUID        `json:"entity_id,omitempty"`
	IdentityStatus IdentityStatus    `json:"identity_status"`
	UserStatus     string            `json:"user_status"`
	Metrics        TeamMemberMetrics `json:"metrics"`
	ByDomain       []DomainBreakdown `json:"by_domain"`
	LinkedCount    int               `json:"linked_count"`
}

type WorkforceRollup struct {
	DistributionGini       MetricValue            `json:"distribution_gini"`
	KeyPersonConcentration MetricValue            `json:"key_person_concentration_pct"`
	BacklogBurnPct         MetricValue            `json:"backlog_burn_pct"`
	UnroutedRequests       MetricValue            `json:"unrouted_requests"`
	Aging                  map[string]MetricValue `json:"aging"`
}

type WorkforceReport struct {
	Scope    ScopeEnvelope    `json:"scope"`
	Period   PeriodEnvelope   `json:"period"`
	Team     []TeamMember     `json:"team"`
	Rollup   WorkforceRollup  `json:"rollup"`
	Coverage CoverageEnvelope `json:"coverage"`
	Degraded bool             `json:"degraded"`
	Errors   []DomainError    `json:"errors"`
}
