package service

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func workingCalendarRiyadh(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		t.Fatalf("load Asia/Riyadh: %v", err)
	}
	return loc
}

func workingCalendarAt(t *testing.T, y int, m time.Month, d, hh, mm int) time.Time {
	t.Helper()
	return time.Date(y, m, d, hh, mm, 0, 0, workingCalendarRiyadh(t))
}

func workingCalendarHour(tenantID, calendarID uuid.UUID, profile model.CalendarProfile, day time.Weekday, segmentIndex, startMinute, endMinute int) model.WorkingHours {
	return model.WorkingHours{
		ID:           uuid.New(),
		TenantID:     tenantID,
		CalendarID:   calendarID,
		Profile:      profile,
		DayOfWeek:    int(day),
		SegmentIndex: segmentIndex,
		StartMinute:  startMinute,
		EndMinute:    endMinute,
	}
}

func assertWorkingCalendarValidationField(t *testing.T, err error, field, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected validation error for %s", field)
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusUnprocessableEntity)
	}
	if got := appErr.Fields[field]; got != want {
		t.Fatalf("field %q = %q, want %q in %+v", field, got, want, appErr.Fields)
	}
}

func TestWorkingCalendarBuildCalculatorAppliesProfilesAndHolidays(t *testing.T) {
	tenantID := uuid.New()
	calendarID := uuid.New()
	ramadanStart := workingCalendarAt(t, 2026, 6, 21, 0, 0)
	ramadanEnd := workingCalendarAt(t, 2026, 6, 25, 0, 0)

	cal := &model.WorkingCalendar{
		ID:           calendarID,
		TenantID:     tenantID,
		Name:         "KSA business hours",
		Timezone:     "Asia/Riyadh",
		RamadanStart: &ramadanStart,
		RamadanEnd:   &ramadanEnd,
		WorkingHours: []model.WorkingHours{
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileStandard, time.Sunday, 0, 9*60, 17*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileStandard, time.Monday, 0, 9*60, 17*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileStandard, time.Tuesday, 0, 9*60, 17*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileStandard, time.Wednesday, 0, 9*60, 17*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileStandard, time.Thursday, 0, 9*60, 17*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileRamadan, time.Sunday, 0, 9*60, 12*60),
			workingCalendarHour(tenantID, calendarID, model.CalendarProfileRamadan, time.Sunday, 1, 13*60, 14*60),
		},
		Holidays: []model.CalendarHoliday{
			{
				ID:         uuid.New(),
				TenantID:   tenantID,
				CalendarID: calendarID,
				Date:       workingCalendarAt(t, 2026, 6, 22, 0, 0),
				Kind:       model.CalendarHolidayKindOfficial,
			},
		},
	}

	calc, err := (&WorkingCalendarService{}).buildCalculator(cal)
	if err != nil {
		t.Fatalf("buildCalculator returned error: %v", err)
	}

	if got := calc.Location().String(); got != "Asia/Riyadh" {
		t.Fatalf("calculator location = %q, want Asia/Riyadh", got)
	}
	if !calc.IsWorkingTime(workingCalendarAt(t, 2026, 6, 21, 11, 30)) {
		t.Fatalf("Ramadan first segment should be working")
	}
	if calc.IsWorkingTime(workingCalendarAt(t, 2026, 6, 21, 12, 30)) {
		t.Fatalf("Ramadan split-shift break should be non-working")
	}
	if !calc.IsWorkingTime(workingCalendarAt(t, 2026, 6, 21, 13, 30)) {
		t.Fatalf("Ramadan second segment should be working")
	}
	if calc.IsWorkingTime(workingCalendarAt(t, 2026, 6, 22, 10, 0)) {
		t.Fatalf("holiday should be non-working")
	}
	if !calc.IsWorkingTime(workingCalendarAt(t, 2026, 6, 28, 15, 0)) {
		t.Fatalf("standard Sunday hours should apply outside Ramadan")
	}
}

func TestWorkingCalendarBuildCalculatorRejectsInvalidTimezone(t *testing.T) {
	_, err := (&WorkingCalendarService{}).buildCalculator(&model.WorkingCalendar{
		Name:     "Invalid",
		Timezone: "Not/AZone",
	})

	assertWorkingCalendarValidationField(t, err, "timezone", "invalid")
}

func TestValidateCalendarCreateRejectsInvalidRamadanWindow(t *testing.T) {
	start := workingCalendarAt(t, 2026, 6, 21, 0, 0)
	end := workingCalendarAt(t, 2026, 6, 20, 0, 0)

	err := validateCalendarCreate(dto.CreateWorkingCalendarRequest{
		Name:         "KSA business hours",
		Timezone:     "Asia/Riyadh",
		RamadanStart: &start,
		RamadanEnd:   &end,
		WorkingHours: []dto.WorkingHoursInput{
			{
				Profile:      model.CalendarProfileStandard,
				DayOfWeek:    int(time.Sunday),
				SegmentIndex: 0,
				StartMinute:  9 * 60,
				EndMinute:    17 * 60,
			},
		},
	})

	assertWorkingCalendarValidationField(t, err, "ramadan_end", "before_start")
}

func TestValidateWorkingHoursInputsRejectsInvalidRows(t *testing.T) {
	cases := []struct {
		name  string
		input dto.WorkingHoursInput
		field string
		want  string
	}{
		{
			name: "profile",
			input: dto.WorkingHoursInput{
				Profile:      model.CalendarProfile("custom"),
				DayOfWeek:    int(time.Sunday),
				SegmentIndex: 0,
				StartMinute:  9 * 60,
				EndMinute:    17 * 60,
			},
			field: "profile",
			want:  "invalid",
		},
		{
			name: "day of week",
			input: dto.WorkingHoursInput{
				Profile:      model.CalendarProfileStandard,
				DayOfWeek:    7,
				SegmentIndex: 0,
				StartMinute:  9 * 60,
				EndMinute:    17 * 60,
			},
			field: "day_of_week",
			want:  "out_of_range",
		},
		{
			name: "segment index",
			input: dto.WorkingHoursInput{
				Profile:      model.CalendarProfileStandard,
				DayOfWeek:    int(time.Sunday),
				SegmentIndex: -1,
				StartMinute:  9 * 60,
				EndMinute:    17 * 60,
			},
			field: "segment_index",
			want:  "out_of_range",
		},
		{
			name: "minute range",
			input: dto.WorkingHoursInput{
				Profile:      model.CalendarProfileStandard,
				DayOfWeek:    int(time.Sunday),
				SegmentIndex: 0,
				StartMinute:  -1,
				EndMinute:    17 * 60,
			},
			field: "start_minute",
			want:  "out_of_range",
		},
		{
			name: "end before start",
			input: dto.WorkingHoursInput{
				Profile:      model.CalendarProfileStandard,
				DayOfWeek:    int(time.Sunday),
				SegmentIndex: 0,
				StartMinute:  17 * 60,
				EndMinute:    9 * 60,
			},
			field: "end_minute",
			want:  "before_start",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateWorkingHoursInputs([]dto.WorkingHoursInput{tc.input})
			assertWorkingCalendarValidationField(t, err, tc.field, tc.want)
		})
	}
}
