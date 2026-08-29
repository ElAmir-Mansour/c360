package service

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// SLAKPIService computes the flagship SLA-compliance rate (CAP-151):
//
//	rate = completed-on-time / total received x 100   (target >= 90%, QUARTERLY)
//
// It reads request-processing duration facts and buckets each terminal SLA
// outcome into a calendar quarter via the working-calendar (calendar.Calculator)
// so the quarter boundaries are timezone-correct (CAP working-day basis). The
// quarter math runs exclusively through ReportingCalendarPort ->
// calendar.Calculator.
type SLAKPIService struct {
	repo     *repository.ReportingRepository
	calendar ReportingCalendarPort
	logger   zerolog.Logger
	now      func() time.Time
}

func NewSLAKPIService(repo *repository.ReportingRepository, calendarPort ReportingCalendarPort, logger zerolog.Logger) *SLAKPIService {
	return &SLAKPIService{
		repo:     repo,
		calendar: calendarPort,
		logger:   logger.With().Str("service", "lex-sla-kpi").Logger(),
		now:      time.Now,
	}
}

// SLACompliance builds the quarterly SLA-compliance report. quarters limits the
// output to the most recent N quarters (already clamped by the caller).
func (s *SLAKPIService) SLACompliance(ctx context.Context, tenantID uuid.UUID, filters model.ReportFilters, quarters int) (*model.SLAComplianceReport, error) {
	if quarters <= 0 {
		quarters = 4
	}
	calc, err := s.calendar.CalculatorFor(ctx, tenantID)
	if err != nil {
		return nil, internalError("load working calendar", err)
	}
	outcomes, err := s.repo.ListDurationFactSLAOutcomes(ctx, tenantID, repository.NewReportFilter(filters))
	if err != nil {
		return nil, internalError("list duration fact sla outcomes", err)
	}

	type bucket struct {
		q     model.QuarterSLACompliance
		order time.Time
	}
	byLabel := map[string]*bucket{}
	for _, o := range outcomes {
		start, endExcl, label := quarterBounds(calc, o.StartedAt)
		b, ok := byLabel[label]
		if !ok {
			b = &bucket{
				q: model.QuarterSLACompliance{
					Quarter:      label,
					QuarterStart: normalizeDate(start),
					QuarterEnd:   normalizeDate(endExcl.AddDate(0, 0, -1)),
					TargetPct:    model.SLAComplianceTarget,
				},
				order: start,
			}
			byLabel[label] = b
		}
		b.q.Received++
		switch o.SLAOutcome {
		case model.SLAClockOutcomeOnTime:
			b.q.OnTime++
		case model.SLAClockOutcomeBreached:
			b.q.Breached++
		default:
			b.q.Pending++
		}
	}

	buckets := make([]*bucket, 0, len(byLabel))
	for _, b := range byLabel {
		buckets = append(buckets, b)
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].order.After(buckets[j].order) })
	if len(buckets) > quarters {
		buckets = buckets[:quarters]
	}
	// Present oldest-first for charting.
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].order.Before(buckets[j].order) })

	report := &model.SLAComplianceReport{
		GeneratedAt: s.now().UTC(),
		Filters:     filters,
		TargetPct:   model.SLAComplianceTarget,
		Quarters:    make([]model.QuarterSLACompliance, 0, len(buckets)),
	}
	var totalReceived, totalOnTime int
	for _, b := range buckets {
		if b.q.Received > 0 {
			b.q.RatePct = round1(float64(b.q.OnTime) / float64(b.q.Received) * 100.0)
		}
		b.q.MeetsTarget = b.q.RatePct >= model.SLAComplianceTarget
		totalReceived += b.q.Received
		totalOnTime += b.q.OnTime
		report.Quarters = append(report.Quarters, b.q)
	}
	if totalReceived > 0 {
		report.OverallRatePct = round1(float64(totalOnTime) / float64(totalReceived) * 100.0)
	}
	report.OverallMeets = report.OverallRatePct >= model.SLAComplianceTarget
	return report, nil
}

// CurrentQuarterRate returns just the rate for the quarter containing "now",
// computed the same way as SLACompliance. Convenience for the dashboard headline.
func (s *SLAKPIService) CurrentQuarterRate(ctx context.Context, tenantID uuid.UUID) (float64, error) {
	report, err := s.SLACompliance(ctx, tenantID, model.ReportFilters{}, 8)
	if err != nil {
		return 0, err
	}
	calc, err := s.calendar.CalculatorFor(ctx, tenantID)
	if err != nil {
		return 0, internalError("load working calendar", err)
	}
	_, _, label := quarterBounds(calc, s.now())
	for _, q := range report.Quarters {
		if q.Quarter == label {
			return q.RatePct, nil
		}
	}
	return 0, nil
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10.0
}
