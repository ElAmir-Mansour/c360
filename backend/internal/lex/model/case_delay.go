package model

import (
	"time"

	"github.com/google/uuid"
)

// case_delay.go models the Case Timelines vertical (CAP-084..088): the
// external-dependency / delay extension that hangs off legal_matters plus the
// per-event delay register. It does NOT redefine the Matter struct (model/matter.go
// is owned elsewhere); instead it carries a thin MatterTimeline extension type that
// projects the columns added to legal_matters by the staged ALTER, and the
// LegalCaseDelayEvent register row.

// DelayCategory classifies why a matter/case is externally blocked or delayed
// (CAP-088). It is the external party the matter is waiting on.
type DelayCategory string

const (
	// DelayCategoryCourt — waiting on a court (hearing schedule, ruling).
	DelayCategoryCourt DelayCategory = "court"
	// DelayCategoryGovernment — waiting on a government body/regulator.
	DelayCategoryGovernment DelayCategory = "government"
	// DelayCategoryDepartment — waiting on an internal business department.
	DelayCategoryDepartment DelayCategory = "department"
	// DelayCategoryExpert — waiting on an appointed expert/consultant.
	DelayCategoryExpert DelayCategory = "expert"
)

// Valid reports whether the delay category is one of the allowed values.
func (c DelayCategory) Valid() bool {
	switch c {
	case DelayCategoryCourt, DelayCategoryGovernment, DelayCategoryDepartment, DelayCategoryExpert:
		return true
	default:
		return false
	}
}

// MatterTimeline is the timeline/external-dependency projection of a matter
// (CAP-084..088). It mirrors the columns the staged migration ALTERs onto
// legal_matters; the Timelines service reads/writes these via a small dedicated
// repository without touching the Matter aggregate.
type MatterTimeline struct {
	MatterID                uuid.UUID      `json:"matter_id"`
	TenantID                uuid.UUID      `json:"tenant_id"`
	MatterNumber            string         `json:"matter_number"`
	Title                   string         `json:"title"`
	Status                  MatterStatus   `json:"status"`
	OpenedAt                time.Time      `json:"opened_at"`
	DueDate                 *time.Time     `json:"due_date,omitempty"`
	ClosedAt                *time.Time     `json:"closed_at,omitempty"`
	EstimatedDurationDays   *int           `json:"estimated_duration_days,omitempty"`
	EstimatedCompletionDate *time.Time     `json:"estimated_completion_date,omitempty"`
	ExternalHold            bool           `json:"external_hold"`
	ExternalHoldCategory    *DelayCategory `json:"external_hold_category,omitempty"`
	ExternalHoldSince       *time.Time     `json:"external_hold_since,omitempty"`
	ClosureReason           *string        `json:"closure_reason,omitempty"`
	UpdatedAt               time.Time      `json:"updated_at"`
	// DelayEvents is the resolved register of delay events for the matter
	// (hydrated by the service on Get).
	DelayEvents []LegalCaseDelayEvent `json:"delay_events,omitempty"`
	// OpenDelayDays is the running total of days the matter has spent in recorded
	// (still-open) delay windows, computed at read time.
	OpenDelayDays int `json:"open_delay_days"`
}

// LegalCaseDelayEvent is one recorded external-dependency / delay window on a
// matter (CAP-086/087): an open→resolved interval with a classified cause. It is
// an audit-style register row (soft-deleted, tenant-scoped).
type LegalCaseDelayEvent struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	MatterID   uuid.UUID      `json:"matter_id"`
	Category   DelayCategory  `json:"category"`
	Reason     string         `json:"reason"`
	OpenedAt   time.Time      `json:"opened_at"`
	ResolvedAt *time.Time     `json:"resolved_at,omitempty"`
	Resolved   bool           `json:"resolved"`
	Metadata   map[string]any `json:"metadata"`
	CreatedBy  uuid.UUID      `json:"created_by"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  *time.Time     `json:"deleted_at,omitempty"`
}

// MatterTimelineSummary is one row of the cross-matter (portfolio) timeline
// summary that powers a manager triage dashboard (#15). It carries the matter's
// key timeline signals plus the running open-delay-day total computed in SQL.
type MatterTimelineSummary struct {
	MatterID                uuid.UUID      `json:"matter_id"`
	MatterNumber            string         `json:"matter_number"`
	Title                   string         `json:"title"`
	Status                  MatterStatus   `json:"status"`
	ExternalHold            bool           `json:"external_hold"`
	ExternalHoldCategory    *DelayCategory `json:"external_hold_category,omitempty"`
	ExternalHoldSince       *time.Time     `json:"external_hold_since,omitempty"`
	EstimatedCompletionDate *time.Time     `json:"estimated_completion_date,omitempty"`
	DueDate                 *time.Time     `json:"due_date,omitempty"`
	OpenDelayDays           int            `json:"open_delay_days"`
	UpdatedAt               time.Time      `json:"updated_at"`
}

// MatterTimelineSummaryFilters scopes the cross-matter timeline summary listing
// (#15). All filters are tenant-scoped by the service.
type MatterTimelineSummaryFilters struct {
	// OnHold, when non-nil, filters to matters that are (true) or are not (false)
	// externally held.
	OnHold *bool
	// MinOpenDelayDays, when > 0, filters to matters whose running open-delay-day
	// total is at least this value.
	MinOpenDelayDays int
	Page             int
	PerPage          int
	// SortColumn is one of "open_delay_days" or "updated_at" (default).
	SortColumn string
	// SortDir is "asc" or "desc" (default "desc").
	SortDir string
}

// LegalCaseHoldHistory is one immutable audit row recording an external-hold
// (external-pending) change on a matter (#12): set vs cleared, the actor, and the
// classified category/reason at the time of the change.
type LegalCaseHoldHistory struct {
	ID        uuid.UUID      `json:"id"`
	TenantID  uuid.UUID      `json:"tenant_id"`
	MatterID  uuid.UUID      `json:"matter_id"`
	Action    string         `json:"action"`
	Category  *DelayCategory `json:"category,omitempty"`
	Reason    *string        `json:"reason,omitempty"`
	CreatedBy uuid.UUID      `json:"created_by"`
	CreatedAt time.Time      `json:"created_at"`
}

// DelayEventListFilters scopes a delay-event listing for a matter.
type DelayEventListFilters struct {
	MatterID uuid.UUID
	Category *DelayCategory
	OpenOnly bool
	// Search is an optional case-insensitive ILIKE match on the reason column (#9).
	Search     string
	Page       int
	PerPage    int
	SortColumn string
	SortDir    string
}
