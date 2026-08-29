package dto

import (
	"strings"
	"time"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// WorkingHoursInput is one working-hours segment in a create/update request.
// DayOfWeek follows time.Weekday (0 = Sunday … 6 = Saturday). StartMinute /
// EndMinute are minutes-from-midnight in the calendar timezone.
type WorkingHoursInput struct {
	Profile      model.CalendarProfile `json:"profile"`
	DayOfWeek    int                   `json:"day_of_week"`
	SegmentIndex int                   `json:"segment_index"`
	StartMinute  int                   `json:"start_minute"`
	EndMinute    int                   `json:"end_minute"`
}

// CreateWorkingCalendarRequest creates a calendar header together with its full
// weekly working-hours profile. Holidays are managed via the dedicated holiday
// endpoints after creation.
type CreateWorkingCalendarRequest struct {
	Name         string              `json:"name"`
	Description  string              `json:"description"`
	Timezone     string              `json:"timezone"`
	IsDefault    bool                `json:"is_default"`
	RamadanStart *time.Time          `json:"ramadan_start,omitempty"`
	RamadanEnd   *time.Time          `json:"ramadan_end,omitempty"`
	Metadata     map[string]any      `json:"metadata"`
	WorkingHours []WorkingHoursInput `json:"working_hours"`
}

// UpdateWorkingCalendarRequest patches the calendar header. WorkingHours, when
// non-nil, fully replaces the existing weekly profile.
type UpdateWorkingCalendarRequest struct {
	Name         *string             `json:"name,omitempty"`
	Description  *string             `json:"description,omitempty"`
	Timezone     *string             `json:"timezone,omitempty"`
	IsDefault    *bool               `json:"is_default,omitempty"`
	RamadanStart *time.Time          `json:"ramadan_start,omitempty"`
	RamadanEnd   *time.Time          `json:"ramadan_end,omitempty"`
	Metadata     map[string]any      `json:"metadata,omitempty"`
	WorkingHours []WorkingHoursInput `json:"working_hours,omitempty"`
}

// AddCalendarHolidayRequest adds a single non-working date to a calendar.
type AddCalendarHolidayRequest struct {
	Date time.Time                 `json:"date"`
	Kind model.CalendarHolidayKind `json:"kind"`
	Name forms.LocalizedText       `json:"name"`
}

func (r *CreateWorkingCalendarRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	r.Timezone = strings.TrimSpace(r.Timezone)
	if r.Timezone == "" {
		r.Timezone = "Asia/Riyadh"
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for i := range r.WorkingHours {
		if r.WorkingHours[i].Profile == "" {
			r.WorkingHours[i].Profile = model.CalendarProfileStandard
		}
	}
}

func (r *UpdateWorkingCalendarRequest) Normalize() {
	if r.Name != nil {
		trimmed := strings.TrimSpace(*r.Name)
		r.Name = &trimmed
	}
	if r.Description != nil {
		trimmed := strings.TrimSpace(*r.Description)
		r.Description = &trimmed
	}
	if r.Timezone != nil {
		trimmed := strings.TrimSpace(*r.Timezone)
		r.Timezone = &trimmed
	}
	for i := range r.WorkingHours {
		if r.WorkingHours[i].Profile == "" {
			r.WorkingHours[i].Profile = model.CalendarProfileStandard
		}
	}
}

func (r *AddCalendarHolidayRequest) Normalize() {
	if r.Kind == "" {
		r.Kind = model.CalendarHolidayKindOfficial
	}
	r.Name.AR = strings.TrimSpace(r.Name.AR)
	r.Name.EN = strings.TrimSpace(r.Name.EN)
}
