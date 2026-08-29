package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// CalendarProfile selects which weekly working-hours profile a row belongs to.
// The "standard" profile is the default year-round schedule; the "ramadan"
// profile overrides it for the Gregorian window declared on the calendar (CAP-029,
// Hijri auto-conversion is intentionally out of scope for v1 — Ramadan is entered
// as an explicit Gregorian date range).
type CalendarProfile string

const (
	CalendarProfileStandard CalendarProfile = "standard"
	CalendarProfileRamadan  CalendarProfile = "ramadan"
)

// CalendarHolidayKind classifies a non-working calendar day. A "weekly" holiday
// is the recurring weekend marker, while "official" and "religious" holidays are
// specific Gregorian dates (CAP-021).
type CalendarHolidayKind string

const (
	CalendarHolidayKindWeekly    CalendarHolidayKind = "weekly"
	CalendarHolidayKindOfficial  CalendarHolidayKind = "official"
	CalendarHolidayKindReligious CalendarHolidayKind = "religious"
)

// WorkingCalendar is a per-tenant working-time definition (CAP-020). Exactly one
// calendar per tenant may carry is_default = true (enforced by a partial-unique
// index where deleted_at IS NULL). The timezone is an IANA name (e.g.
// "Asia/Riyadh") used to localize all SLA arithmetic.
type WorkingCalendar struct {
	ID           uuid.UUID         `json:"id"`
	TenantID     uuid.UUID         `json:"tenant_id"`
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	Timezone     string            `json:"timezone"`
	IsDefault    bool              `json:"is_default"`
	RamadanStart *time.Time        `json:"ramadan_start,omitempty"`
	RamadanEnd   *time.Time        `json:"ramadan_end,omitempty"`
	Metadata     map[string]any    `json:"metadata"`
	CreatedBy    uuid.UUID         `json:"created_by"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
	DeletedAt    *time.Time        `json:"deleted_at,omitempty"`
	WorkingHours []WorkingHours    `json:"working_hours,omitempty"`
	Holidays     []CalendarHoliday `json:"holidays,omitempty"`
}

// WorkingHours is one working segment for a (profile, day_of_week) pair. A day may
// carry several segments to model a split shift (segment_index 0,1,...). DayOfWeek
// follows Go's time.Weekday convention: 0 = Sunday … 6 = Saturday. StartMinute and
// EndMinute are minutes-from-midnight in the calendar timezone (0..1440); a row
// with EndMinute <= StartMinute is rejected at the service layer.
type WorkingHours struct {
	ID           uuid.UUID       `json:"id"`
	TenantID     uuid.UUID       `json:"tenant_id"`
	CalendarID   uuid.UUID       `json:"calendar_id"`
	Profile      CalendarProfile `json:"profile"`
	DayOfWeek    int             `json:"day_of_week"`
	SegmentIndex int             `json:"segment_index"`
	StartMinute  int             `json:"start_minute"`
	EndMinute    int             `json:"end_minute"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

// CalendarHoliday is a non-working day on a calendar. The Date is a calendar date
// (no time component) interpreted in the calendar timezone; Name is bilingual
// (Arabic-first per CAP-172).
type CalendarHoliday struct {
	ID         uuid.UUID           `json:"id"`
	TenantID   uuid.UUID           `json:"tenant_id"`
	CalendarID uuid.UUID           `json:"calendar_id"`
	Date       time.Time           `json:"date"`
	Kind       CalendarHolidayKind `json:"kind"`
	Name       forms.LocalizedText `json:"name"`
	CreatedBy  uuid.UUID           `json:"created_by"`
	CreatedAt  time.Time           `json:"created_at"`
	UpdatedAt  time.Time           `json:"updated_at"`
}

// WorkingCalendarListFilters drives the paginated calendar list.
type WorkingCalendarListFilters struct {
	Page          int
	PerPage       int
	Search        string
	IsDefault     *bool
	SortColumn    string
	SortDirection string
}
