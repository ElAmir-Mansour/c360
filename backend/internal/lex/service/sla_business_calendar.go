package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/calendar"
)

// SLACalendarProvider is the narrow seam the SLA service uses to obtain a frozen
// calendar.Calculator for a tenant. It is satisfied by *WorkingCalendarService
// (DefaultCalculator / CalculatorFor) so the SLA module never touches the
// working-calendar repository directly and never does naive calendar-day math.
type SLACalendarProvider interface {
	DefaultCalculator(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error)
	CalculatorFor(ctx context.Context, tenantID, calendarID uuid.UUID) (calendar.Calculator, error)
}

// slaBusinessCalendar adapts the working-calendar service into the SLACalendarProvider
// the SLA service consumes. It resolves either the named calendar (when the clock
// references one) or the tenant default, returning the frozen Calculator (C-1).
type slaBusinessCalendar struct {
	calendars SLACalendarProvider
}

// NewSLABusinessCalendar builds the adapter from any SLACalendarProvider
// (in production, *WorkingCalendarService).
func NewSLABusinessCalendar(calendars SLACalendarProvider) *slaBusinessCalendar {
	return &slaBusinessCalendar{calendars: calendars}
}

// Calculator returns the frozen calendar.Calculator to drive working-time
// deadline arithmetic. When calendarID is non-nil it loads that calendar,
// otherwise it falls back to the tenant default.
func (a *slaBusinessCalendar) Calculator(ctx context.Context, tenantID uuid.UUID, calendarID *uuid.UUID) (calendar.Calculator, error) {
	if a == nil || a.calendars == nil {
		return nil, internalError("sla business calendar is not configured", nil)
	}
	if calendarID != nil && *calendarID != uuid.Nil {
		return a.calendars.CalculatorFor(ctx, tenantID, *calendarID)
	}
	return a.calendars.DefaultCalculator(ctx, tenantID)
}
