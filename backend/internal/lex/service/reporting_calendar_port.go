package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/model"
)

// ReportingCalendarPort is the narrow seam through which the reporting module
// obtains a working-time calendar.Calculator. It exists so reporting depends only
// on the FROZEN calendar contract (C-1) and never on the WorkingCalendarService
// concretely or the repository — mirroring how SLA/Execution consume the engine.
//
// ALL quarter/working-day arithmetic in the reporting module flows through the
// Calculator returned here (CAP working-day basis), so quarter bucketing and the
// duration_fact working-minutes are timezone- and holiday-correct.
type ReportingCalendarPort interface {
	// CalculatorFor returns the tenant's default working-time Calculator. When no
	// default calendar is configured it returns a sensible UTC fallback so reports
	// still render (the working-minutes simply degrade to civil time).
	CalculatorFor(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error)
	// ResolveFor is the provenance-aware form used by workforce reporting. It
	// distinguishes the tenant calendar from the accepted 24x7 UTC fallback.
	ResolveFor(ctx context.Context, tenantID uuid.UUID) ReportingCalendarResolution
}

type ReportingCalendarResolution struct {
	Calculator calendar.Calculator
	Source     model.CalendarSource
}

// workingCalendarPort adapts *WorkingCalendarService to ReportingCalendarPort.
type workingCalendarPort struct {
	calendars *WorkingCalendarService
}

// NewReportingCalendarPort wraps the WorkingCalendarService. A nil service yields
// a port that always returns the UTC fallback calculator.
func NewReportingCalendarPort(calendars *WorkingCalendarService) ReportingCalendarPort {
	return &workingCalendarPort{calendars: calendars}
}

func (p *workingCalendarPort) CalculatorFor(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error) {
	return p.ResolveFor(ctx, tenantID).Calculator, nil
}

func (p *workingCalendarPort) ResolveFor(ctx context.Context, tenantID uuid.UUID) ReportingCalendarResolution {
	if p == nil || p.calendars == nil {
		return ReportingCalendarResolution{Calculator: fallbackCalculator(), Source: model.CalendarSourceFallbackUTC}
	}
	calc, err := p.calendars.DefaultCalculator(ctx, tenantID)
	if err != nil {
		// No default calendar (or load failure): degrade to a 24x7 UTC calendar so
		// reports remain available. Working-minutes then equal civil minutes.
		return ReportingCalendarResolution{Calculator: fallbackCalculator(), Source: model.CalendarSourceFallbackUTC}
	}
	return ReportingCalendarResolution{Calculator: calc, Source: model.CalendarSourceTenant}
}

// fallbackCalculator is a 24x7 UTC calculator with no holidays. It guarantees the
// reporting endpoints never fail purely because a tenant has not configured a
// working calendar; the quarter boundaries are still computed correctly (they are
// civil-date based) and working-minutes degrade gracefully to wall-clock minutes.
func fallbackCalculator() calendar.Calculator {
	full := []calendar.WorkingSegment{{Start: 0, End: 24 * 60}}
	std := map[time.Weekday][]calendar.WorkingSegment{}
	for wd := time.Sunday; wd <= time.Saturday; wd++ {
		std[wd] = full
	}
	return calendar.NewCalculator(calendar.WorkingCalendarSnapshot{
		Location: time.UTC,
		Standard: std,
		Ramadan:  map[time.Weekday][]calendar.WorkingSegment{},
	})
}

// quarterBounds returns the inclusive civil [start, endExclusive) bounds of the
// calendar quarter containing t, expressed in the calculator's timezone. The
// reporting service uses these bounds (computed via the Calculator's Location) to
// bucket SLA outcomes into quarters on the CAP working-day basis.
func quarterBounds(calc calendar.Calculator, t time.Time) (start time.Time, endExclusive time.Time, label string) {
	loc := time.UTC
	if calc != nil && calc.Location() != nil {
		loc = calc.Location()
	}
	local := t.In(loc)
	q := (int(local.Month()) - 1) / 3 // 0..3
	startMonth := time.Month(q*3 + 1)
	start = time.Date(local.Year(), startMonth, 1, 0, 0, 0, 0, loc)
	endExclusive = start.AddDate(0, 3, 0)
	label = fmt.Sprintf("%d-Q%d", local.Year(), q+1)
	return start, endExclusive, label
}
