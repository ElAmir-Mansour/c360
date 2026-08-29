package model

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDetailedAnalyticsDashboardJSONContract(t *testing.T) {
	previous := 9.0
	dashboard := DetailedAnalyticsDashboard{
		GeneratedAt: time.Date(2026, time.July, 27, 8, 30, 0, 0, time.UTC),
		Period: AnalyticsPeriod{
			From: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
			To:   time.Date(2026, time.July, 27, 0, 0, 0, 0, time.UTC),
		},
		Summary: DetailedAnalyticsSummary{
			TotalRequests: AnalyticsMetric{
				Value:              12,
				Available:          true,
				SampleSize:         12,
				PreviousValue:      &previous,
				PreviousAvailable:  true,
				PreviousSampleSize: intPointer(9),
			},
			SatisfactionScore: AnalyticsMetric{
				Available:  false,
				SampleSize: 0,
			},
		},
		MonthlyTrend: []AnalyticsTrendPoint{{
			PeriodStart: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC),
			Count:       7,
		}},
		ByDepartment:       []CountBucket{},
		ByServiceType:      []CountBucket{},
		AdvisorPerformance: []LegalAdvisorPerformance{},
		FilterOptions: DetailedAnalyticsFilterOptions{
			Departments:  []string{},
			ServiceTypes: []string{},
			Priorities:   []string{},
		},
	}

	payload, err := json.Marshal(dashboard)
	if err != nil {
		t.Fatalf("marshal dashboard: %v", err)
	}
	var decoded struct {
		Summary struct {
			TotalRequests AnalyticsMetric `json:"total_requests"`
		} `json:"summary"`
		MonthlyTrend []struct {
			PeriodStart string `json:"period_start"`
			Count       int    `json:"count"`
		} `json:"monthly_trend"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal dashboard contract: %v", err)
	}
	if decoded.Summary.TotalRequests.Value != 12 ||
		!decoded.Summary.TotalRequests.Available ||
		decoded.Summary.TotalRequests.SampleSize != 12 {
		t.Fatalf("summary metric contract malformed: %#v", decoded.Summary.TotalRequests)
	}
	if len(decoded.MonthlyTrend) != 1 ||
		decoded.MonthlyTrend[0].PeriodStart != "2026-07-01T00:00:00Z" ||
		decoded.MonthlyTrend[0].Count != 7 {
		t.Fatalf("monthly trend contract malformed: %#v", decoded.MonthlyTrend)
	}
}

func intPointer(value int) *int { return &value }
