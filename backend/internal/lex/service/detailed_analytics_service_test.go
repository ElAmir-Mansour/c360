package service

import (
	"context"
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/google/uuid"
)

func TestResolveDetailedAnalyticsFiltersDefaultsToCurrentYearToDate(t *testing.T) {
	now := time.Date(2026, time.July, 22, 17, 45, 0, 0, time.FixedZone("WAT", 60*60))
	service := &ReportingService{now: func() time.Time { return now }}

	filters, err := service.resolveDetailedAnalyticsFilters(model.DetailedAnalyticsFilters{})
	if err != nil {
		t.Fatalf("resolve filters: %v", err)
	}
	wantFrom := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, time.July, 22, 0, 0, 0, 0, time.UTC)
	if !filters.From.Equal(wantFrom) {
		t.Fatalf("from = %s, want %s", filters.From, wantFrom)
	}
	if !filters.To.Equal(wantTo) {
		t.Fatalf("to = %s, want %s", filters.To, wantTo)
	}
}

func TestResolveDetailedAnalyticsFiltersRejectsInvalidInputs(t *testing.T) {
	service := &ReportingService{now: time.Now}
	from := time.Date(2026, time.July, 22, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, -1)
	if _, err := service.resolveDetailedAnalyticsFilters(model.DetailedAnalyticsFilters{From: from, To: to}); err == nil {
		t.Fatal("expected reversed date range to fail")
	}

	priority := "high"
	if _, err := service.resolveDetailedAnalyticsFilters(model.DetailedAnalyticsFilters{
		From:     from,
		To:       from,
		Priority: &priority,
	}); err == nil {
		t.Fatal("expected unsupported request priority to fail")
	}
}

func TestDetailedSummaryPreservesUnavailableSamplesAndComparison(t *testing.T) {
	current := detailedAnalyticsSnapshot{
		counts:           repository.RequestAnalyticsCounts{Total: 8, Closed: 6, Pending: 2},
		processingHours:  18.25,
		processingSample: 4,
		sla:              repository.RequestAnalyticsSLA{Resolved: 5, OnTime: 4},
	}
	previous := detailedAnalyticsSnapshot{
		counts:             repository.RequestAnalyticsCounts{Total: 4, Closed: 1, Pending: 3},
		processingHours:    30,
		processingSample:   2,
		satisfaction:       4.5,
		satisfactionSample: 2,
		sla:                repository.RequestAnalyticsSLA{Resolved: 0},
	}

	summary := detailedSummary(current, previous, true)
	if summary.CompletionRate.Value != 75 || !summary.CompletionRate.Available {
		t.Fatalf("completion = %#v, want available 75%%", summary.CompletionRate)
	}
	if summary.SatisfactionScore.Available || summary.SatisfactionScore.SampleSize != 0 {
		t.Fatalf("empty satisfaction sample must be unavailable: %#v", summary.SatisfactionScore)
	}
	if summary.SatisfactionScore.PreviousValue == nil || *summary.SatisfactionScore.PreviousValue != 4.5 || !summary.SatisfactionScore.PreviousAvailable {
		t.Fatalf("previous satisfaction not attached correctly: %#v", summary.SatisfactionScore)
	}
	if summary.SLACompliance.Value != 80 || !summary.SLACompliance.Available {
		t.Fatalf("SLA = %#v, want available 80%%", summary.SLACompliance)
	}
	if summary.SLACompliance.PreviousAvailable {
		t.Fatalf("zero previous SLA denominator must be unavailable: %#v", summary.SLACompliance)
	}
}

func TestDenseDetailedTrendZeroFillsAndAlignsPreviousMonths(t *testing.T) {
	from := time.Date(2026, time.January, 10, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.March, 5, 0, 0, 0, 0, time.UTC)
	previousPeriod := &model.AnalyticsPeriod{
		From: time.Date(2025, time.November, 16, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, time.January, 9, 0, 0, 0, 0, time.UTC),
	}
	current := map[time.Time]int{
		time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC): 3,
		time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC):   7,
	}
	previous := map[time.Time]int{
		time.Date(2025, time.November, 1, 0, 0, 0, 0, time.UTC): 2,
		time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC):  5,
	}

	points := denseDetailedTrend(from, to, current, previousPeriod, previous)
	if len(points) != 3 {
		t.Fatalf("points = %d, want 3", len(points))
	}
	if points[1].Count != 0 {
		t.Fatalf("missing February must be zero-filled, got %d", points[1].Count)
	}
	if points[0].PreviousCount == nil || *points[0].PreviousCount != 2 {
		t.Fatalf("November comparison = %#v, want 2", points[0].PreviousCount)
	}
	if points[1].PreviousCount == nil || *points[1].PreviousCount != 0 {
		t.Fatalf("missing December comparison must be zero-filled")
	}
	if points[2].PreviousCount == nil || *points[2].PreviousCount != 5 {
		t.Fatalf("January comparison = %#v, want 5", points[2].PreviousCount)
	}
}

func TestDetailedAnalyticsContributorsRejectsInvalidSelectorsBeforeQuerying(t *testing.T) {
	service := &ReportingService{
		now: func() time.Time {
			return time.Date(2026, time.July, 27, 0, 0, 0, 0, time.UTC)
		},
	}
	tests := []struct {
		name      string
		dimension string
		key       string
		keys      string
	}{
		{name: "dimension", dimension: "unknown"},
		{name: "metric", dimension: "metric", key: "invented"},
		{name: "month", dimension: "month", key: "July 2026"},
		{name: "department", dimension: "department"},
		{name: "service type", dimension: "service_type", keys: " , "},
		{name: "advisor", dimension: "advisor"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := service.DetailedAnalyticsContributors(
				context.Background(),
				uuid.New(),
				model.DetailedAnalyticsFilters{},
				test.dimension,
				test.key,
				test.keys,
				1,
				25,
			)
			if err == nil {
				t.Fatal("expected selector validation error")
			}
		})
	}
}
