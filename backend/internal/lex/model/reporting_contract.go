package model

// Package note (Reports upgrade — contract analytics v2).
//
// These are the ADDITIVE shapes appended to ContractAnalyticsReport by the
// reports upgrade: spend rollups (SUM of contracts.total_value with an honest
// multi-currency split — amounts are NEVER FX-converted), the 24-month
// expiry-cliff series, and draft->active cycle-time stats. Existing fields on
// ContractAnalyticsReport are untouched so the payload stays
// backward-compatible for every current consumer of
// GET /reports/contracts-analytics.

// ValueBucket is a single {key, count, total_value, by_currency} aggregate row
// for spend rollups (by type / by department). TotalValue is the raw
// SUM(total_value) across ALL currencies for the key — no FX conversion is
// applied (PDPL/in-Kingdom reporting keeps source amounts) — and ByCurrency
// splits the same sum per currency code so the client can render each currency
// separately (SAR-first in the Watheeq UI).
type ValueBucket struct {
	Key        string             `json:"key"`
	Count      int                `json:"count"`
	TotalValue float64            `json:"total_value"`
	ByCurrency map[string]float64 `json:"by_currency"`
}

// ExpiryCliffPoint is one month of the forward-looking contract expiry cliff:
// how many live contracts expire in that month and their summed value. Month is
// "YYYY-MM". The series is dense (zero-filled) so charts render a continuous
// 24-month axis.
type ExpiryCliffPoint struct {
	Month string  `json:"month"`
	Count int     `json:"count"`
	Value float64 `json:"value"`
}

// Sources a ContractCycleTimeStats can be computed from.
const (
	// CycleTimeSourceDurationFacts — lex_duration_facts kind=contract_review,
	// the CloudEvents/audit-event-derived fact store (preferred when populated).
	CycleTimeSourceDurationFacts = "duration_facts"
	// CycleTimeSourceStatusTimeline — contracts.created_at ->
	// status_changed_at for contracts that reached active/renewed (the same
	// status-timeline primary source CAP-140 uses).
	CycleTimeSourceStatusTimeline = "status_timeline"
)

// ContractCycleTimeStats summarizes the draft->active cycle time in DAYS:
// average, median (p50) and p90, with the sample size and the timeline source
// the stats were computed from.
type ContractCycleTimeStats struct {
	AvgDays    float64 `json:"avg_days"`
	P50Days    float64 `json:"p50_days"`
	P90Days    float64 `json:"p90_days"`
	SampleSize int     `json:"sample_size"`
	Source     string  `json:"source"`
}
