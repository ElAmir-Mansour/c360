package model

import (
	"time"

	"github.com/google/uuid"
)

// settlement_report.go models the Settlements / ADR read-aggregation report
// (FEATURES 1 + 3): a tenant-scoped, filterable analytics roll-up over the
// legal_settlement aggregate. It mirrors MatterReport conventions (generated_at,
// total, filters, line items, by_* rollups) and adds the value/cycle-time facts
// the analytics UI needs: settled value (executed), value at risk (pending
// approval), average settlement value, and the create->execute cycle time. The
// report is a pure read projection — no PII (counterparty fields) is included.

// SettlementSummary is one settlement line item on a SettlementReport. It is a
// PII-free projection of the settlement row (no counterparty fields).
type SettlementSummary struct {
	ID         uuid.UUID        `json:"id"`
	Reference  string           `json:"reference"`
	MatterID   uuid.UUID        `json:"matter_id"`
	Title      string           `json:"title"`
	Status     SettlementStatus `json:"status"`
	Method     SettlementMethod `json:"method"`
	Value      *float64         `json:"value,omitempty"`
	Currency   *string          `json:"currency,omitempty"`
	ApprovedAt *time.Time       `json:"approved_at,omitempty"`
	ExecutedAt *time.Time       `json:"executed_at,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
}

// SettlementReport is the aggregated Settlements analytics report. It carries the
// matching line items plus rollups: counts by status/method, total value by
// status (esp. executed = settled value, pending_approval = value at risk),
// average settlement value, and create->execute cycle-time statistics.
type SettlementReport struct {
	GeneratedAt time.Time           `json:"generated_at"`
	Total       int                 `json:"total"`
	Filters     map[string]string   `json:"filters"`
	Settlements []SettlementSummary `json:"settlements"`

	// ByStatus counts settlements per FSM status.
	ByStatus map[string]int `json:"by_status"`
	// ByMethod counts settlements per ADR method.
	ByMethod map[string]int `json:"by_method"`
	// ValueByStatus sums settlement value per status (rows with a NULL value
	// contribute 0). The status keys mirror ByStatus.
	ValueByStatus map[string]float64 `json:"value_by_status"`

	// SettledValue is the total value of executed settlements (the realised
	// settled amount). Convenience alias for ValueByStatus["executed"].
	SettledValue float64 `json:"settled_value"`
	// ValueAtRisk is the total value of settlements awaiting approval
	// (pending_approval). Convenience alias for ValueByStatus["pending_approval"].
	ValueAtRisk float64 `json:"value_at_risk"`
	// TotalValue is the sum of value across ALL matching settlements (NULLs as 0).
	TotalValue float64 `json:"total_value"`
	// ValuedCount is the number of matching settlements that carry a non-NULL value.
	ValuedCount int `json:"valued_count"`
	// AverageValue is TotalValue / ValuedCount (0 when no valued settlements).
	AverageValue float64 `json:"average_value"`

	// CycleTime aggregates the create->execute turnaround over executed settlements.
	CycleTime SettlementCycleTime `json:"cycle_time"`
}

// SettlementCycleTime captures create->execute turnaround stats over the executed
// settlements in scope (those with a non-NULL executed_at). Durations are whole
// days (created_at -> executed_at). Count is the number of executed settlements
// the stats are derived from; when Count is 0 the stats are all 0.
type SettlementCycleTime struct {
	ExecutedCount int     `json:"executed_count"`
	AvgDays       float64 `json:"avg_days"`
	MinDays       float64 `json:"min_days"`
	MaxDays       float64 `json:"max_days"`
}
