package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var detailedAnalyticsMetricKeys = map[string]struct{}{
	"total_requests":       {},
	"completion_rate":      {},
	"avg_processing_hours": {},
	"satisfaction_score":   {},
	"sla_compliance":       {},
	"pending_requests":     {},
}

type detailedAnalyticsSnapshot struct {
	counts             repository.RequestAnalyticsCounts
	processingHours    float64
	processingSample   int
	satisfaction       float64
	satisfactionSample int
	sla                repository.RequestAnalyticsSLA
}

// DetailedAnalytics builds the request-grain Director Legal dashboard from the
// canonical operational tables. A zero From/To resolves to current year-to-date.
func (s *ReportingService) DetailedAnalytics(ctx context.Context, tenantID uuid.UUID, filters model.DetailedAnalyticsFilters, compare bool) (*model.DetailedAnalyticsDashboard, error) {
	filters, err := s.resolveDetailedAnalyticsFilters(filters)
	if err != nil {
		return nil, err
	}
	currentFilter := repository.DetailedAnalyticsFilter{
		From: filters.From, To: filters.To, Department: filters.Department,
		Priority: filters.Priority, Type: filters.Type,
	}

	var (
		current        detailedAnalyticsSnapshot
		previous       detailedAnalyticsSnapshot
		trend          map[time.Time]int
		previousTrend  map[time.Time]int
		byDepartment   []model.CountBucket
		byServiceType  []model.CountBucket
		advisors       []model.LegalAdvisorPerformance
		options        model.DetailedAnalyticsFilterOptions
		previousPeriod *model.AnalyticsPeriod
		previousFilter repository.DetailedAnalyticsFilter
	)
	if compare {
		days := int(filters.To.Sub(filters.From).Hours()/24) + 1
		previousTo := filters.From.AddDate(0, 0, -1)
		previousFrom := previousTo.AddDate(0, 0, -(days - 1))
		previousPeriod = &model.AnalyticsPeriod{From: previousFrom, To: previousTo}
		previousFilter = repository.DetailedAnalyticsFilter{
			From: previousFrom, To: previousTo, Department: filters.Department,
			Priority: filters.Priority, Type: filters.Type,
		}
	}

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { current, err = s.readDetailedSnapshot(gctx, tenantID, currentFilter); return })
	g.Go(func() (err error) { trend, err = s.repo.DetailedRequestTrend(gctx, tenantID, currentFilter); return })
	g.Go(func() (err error) {
		byDepartment, err = s.repo.DetailedRequestsByDepartment(gctx, tenantID, currentFilter)
		return
	})
	g.Go(func() (err error) {
		byServiceType, err = s.repo.DetailedRequestsByServiceType(gctx, tenantID, currentFilter)
		return
	})
	g.Go(func() (err error) {
		advisors, err = s.repo.DetailedAdvisorPerformance(gctx, tenantID, currentFilter)
		return
	})
	g.Go(func() (err error) { options, err = s.repo.DetailedAnalyticsFilterOptions(gctx, tenantID); return })
	if compare {
		g.Go(func() (err error) { previous, err = s.readDetailedSnapshot(gctx, tenantID, previousFilter); return })
		g.Go(func() (err error) {
			previousTrend, err = s.repo.DetailedRequestTrend(gctx, tenantID, previousFilter)
			return
		})
	}
	if err := g.Wait(); err != nil {
		return nil, internalError("build detailed legal analytics", err)
	}

	for i := range advisors {
		if advisors[i].AverageRating != nil {
			v := round2(*advisors[i].AverageRating)
			advisors[i].AverageRating = &v
		}
		if advisors[i].SLACompliance != nil {
			v := round2(*advisors[i].SLACompliance)
			advisors[i].SLACompliance = &v
		}
	}

	dashboard := &model.DetailedAnalyticsDashboard{
		GeneratedAt:        s.now().UTC(),
		Filters:            filters,
		Period:             model.AnalyticsPeriod{From: filters.From, To: filters.To},
		PreviousPeriod:     previousPeriod,
		Summary:            detailedSummary(current, previous, compare),
		MonthlyTrend:       denseDetailedTrend(filters.From, filters.To, trend, previousPeriod, previousTrend),
		ByDepartment:       byDepartment,
		ByServiceType:      byServiceType,
		AdvisorPerformance: advisors,
		FilterOptions:      options,
	}
	return dashboard, nil
}

// DetailedAnalyticsContributors resolves the same governed request scope as the
// dashboard and returns the exact source observations behind one KPI or chart
// bucket. This keeps drill-down counts aligned with aggregate sample sizes.
func (s *ReportingService) DetailedAnalyticsContributors(
	ctx context.Context,
	tenantID uuid.UUID,
	filters model.DetailedAnalyticsFilters,
	dimension string,
	key string,
	keysRaw string,
	page int,
	perPage int,
) ([]model.DetailedAnalyticsContributor, int, error) {
	resolved, err := s.resolveDetailedAnalyticsFilters(filters)
	if err != nil {
		return nil, 0, err
	}
	dimension = strings.ToLower(strings.TrimSpace(dimension))
	key = strings.TrimSpace(key)
	query := repository.DetailedAnalyticsContributorQuery{
		Dimension: dimension,
		Key:       key,
		Page:      page,
		PerPage:   perPage,
	}

	switch dimension {
	case "metric":
		if _, ok := detailedAnalyticsMetricKeys[key]; !ok {
			return nil, 0, validationError("invalid analytics metric", map[string]string{"key": "unsupported metric"})
		}
	case "month":
		month, parseErr := time.Parse("2006-01-02", key)
		if parseErr != nil {
			return nil, 0, validationError("invalid analytics month", map[string]string{"key": "expected YYYY-MM-DD"})
		}
		month = time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
		query.Month = &month
	case "department":
		if key == "" {
			return nil, 0, validationError("department bucket is required", map[string]string{"key": "required"})
		}
	case "service_type":
		query.Keys = repository.SplitDetailedAnalyticsKeys(keysRaw)
		if len(query.Keys) == 0 && key != "" {
			query.Keys = []string{key}
		}
		if len(query.Keys) == 0 {
			return nil, 0, validationError("service type bucket is required", map[string]string{"keys": "required"})
		}
	case "advisor":
		if key == "" {
			return nil, 0, validationError("advisor bucket is required", map[string]string{"key": "required"})
		}
		if advisorID, parseErr := uuid.Parse(key); parseErr == nil {
			query.AdvisorID = &advisorID
		}
	default:
		return nil, 0, validationError("invalid analytics dimension", map[string]string{"dimension": "unsupported dimension"})
	}

	filter := repository.DetailedAnalyticsFilter{
		From:       resolved.From,
		To:         resolved.To,
		Department: resolved.Department,
		Priority:   resolved.Priority,
		Type:       resolved.Type,
	}
	items, total, err := s.repo.DetailedAnalyticsContributors(ctx, tenantID, filter, query)
	if err != nil {
		return nil, 0, internalError("load detailed analytics contributors", err)
	}
	return items, total, nil
}

func (s *ReportingService) resolveDetailedAnalyticsFilters(filters model.DetailedAnalyticsFilters) (model.DetailedAnalyticsFilters, error) {
	now := s.now().UTC()
	if filters.From.IsZero() {
		filters.From = time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	}
	if filters.To.IsZero() {
		filters.To = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	}
	filters.From = dateOnlyUTC(filters.From)
	filters.To = dateOnlyUTC(filters.To)
	if filters.To.Before(filters.From) {
		return filters, validationError("to date must be on or after from date", map[string]string{"to": "must be on or after from"})
	}
	if filters.To.Sub(filters.From) > 5*366*24*time.Hour {
		return filters, validationError("report window cannot exceed five years", map[string]string{"from": "window exceeds five years"})
	}
	if filters.Priority != nil && *filters.Priority != string(model.RequestPriorityUrgent) && *filters.Priority != string(model.RequestPriorityNormal) {
		return filters, validationError("invalid priority", map[string]string{"priority": "must be urgent or normal"})
	}
	return filters, nil
}

func (s *ReportingService) readDetailedSnapshot(ctx context.Context, tenantID uuid.UUID, filter repository.DetailedAnalyticsFilter) (detailedAnalyticsSnapshot, error) {
	var out detailedAnalyticsSnapshot
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) { out.counts, err = s.repo.DetailedRequestCounts(gctx, tenantID, filter); return })
	g.Go(func() (err error) {
		out.processingHours, out.processingSample, err = s.repo.DetailedRequestProcessingDuration(gctx, tenantID, filter)
		return
	})
	g.Go(func() (err error) {
		out.satisfaction, out.satisfactionSample, err = s.repo.DetailedRequestSatisfaction(gctx, tenantID, filter)
		return
	})
	g.Go(func() (err error) { out.sla, err = s.repo.DetailedRequestSLA(gctx, tenantID, filter); return })
	if err := g.Wait(); err != nil {
		return detailedAnalyticsSnapshot{}, err
	}
	return out, nil
}

func detailedSummary(current, previous detailedAnalyticsSnapshot, compare bool) model.DetailedAnalyticsSummary {
	completion := 0.0
	if current.counts.Total > 0 {
		completion = float64(current.counts.Closed) / float64(current.counts.Total) * 100
	}
	slaRate := 0.0
	if current.sla.Resolved > 0 {
		slaRate = float64(current.sla.OnTime) / float64(current.sla.Resolved) * 100
	}

	metrics := model.DetailedAnalyticsSummary{
		TotalRequests:      analyticsMetric(float64(current.counts.Total), current.counts.Total, true),
		CompletionRate:     analyticsMetric(round2(completion), current.counts.Total, current.counts.Total > 0),
		AvgProcessingHours: analyticsMetric(round2(current.processingHours), current.processingSample, current.processingSample > 0),
		SatisfactionScore:  analyticsMetric(round2(current.satisfaction), current.satisfactionSample, current.satisfactionSample > 0),
		SLACompliance:      analyticsMetric(round2(slaRate), current.sla.Resolved, current.sla.Resolved > 0),
		PendingRequests:    analyticsMetric(float64(current.counts.Pending), current.counts.Total, true),
	}
	if !compare {
		return metrics
	}
	previousCompletion := 0.0
	if previous.counts.Total > 0 {
		previousCompletion = float64(previous.counts.Closed) / float64(previous.counts.Total) * 100
	}
	previousSLA := 0.0
	if previous.sla.Resolved > 0 {
		previousSLA = float64(previous.sla.OnTime) / float64(previous.sla.Resolved) * 100
	}
	attachPrevious(&metrics.TotalRequests, float64(previous.counts.Total), previous.counts.Total, true)
	attachPrevious(&metrics.CompletionRate, round2(previousCompletion), previous.counts.Total, previous.counts.Total > 0)
	attachPrevious(&metrics.AvgProcessingHours, round2(previous.processingHours), previous.processingSample, previous.processingSample > 0)
	attachPrevious(&metrics.SatisfactionScore, round2(previous.satisfaction), previous.satisfactionSample, previous.satisfactionSample > 0)
	attachPrevious(&metrics.SLACompliance, round2(previousSLA), previous.sla.Resolved, previous.sla.Resolved > 0)
	attachPrevious(&metrics.PendingRequests, float64(previous.counts.Pending), previous.counts.Total, true)
	return metrics
}

func analyticsMetric(value float64, sample int, available bool) model.AnalyticsMetric {
	return model.AnalyticsMetric{Value: value, Available: available, SampleSize: sample}
}

func attachPrevious(metric *model.AnalyticsMetric, value float64, sample int, available bool) {
	metric.PreviousValue = &value
	metric.PreviousAvailable = available
	metric.PreviousSampleSize = &sample
}

func denseDetailedTrend(from, to time.Time, counts map[time.Time]int, previousPeriod *model.AnalyticsPeriod, previous map[time.Time]int) []model.AnalyticsTrendPoint {
	currentMonths := monthsBetween(from, to)
	previousMonths := []time.Time{}
	if previousPeriod != nil {
		previousMonths = monthsBetween(previousPeriod.From, previousPeriod.To)
	}
	out := make([]model.AnalyticsTrendPoint, 0, len(currentMonths))
	for i, month := range currentMonths {
		point := model.AnalyticsTrendPoint{PeriodStart: month, Count: counts[month]}
		if i < len(previousMonths) {
			value := previous[previousMonths[i]]
			point.PreviousCount = &value
		}
		out = append(out, point)
	}
	return out
}

func monthsBetween(from, to time.Time) []time.Time {
	start := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(to.Year(), to.Month(), 1, 0, 0, 0, 0, time.UTC)
	out := make([]time.Time, 0, 12)
	for cursor := start; !cursor.After(end); cursor = cursor.AddDate(0, 1, 0) {
		out = append(out, cursor)
	}
	return out
}

func dateOnlyUTC(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}
