package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// DetailedAnalyticsFilters is the resolved request-grain scope echoed in the
// Director Legal analytics response. From and To are inclusive civil dates.
type DetailedAnalyticsFilters struct {
	From       time.Time `json:"from"`
	To         time.Time `json:"to"`
	Department *string   `json:"department,omitempty"`
	Priority   *string   `json:"priority,omitempty"`
	Type       *string   `json:"type,omitempty"`
}

// AnalyticsPeriod is an inclusive reporting window.
type AnalyticsPeriod struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// AnalyticsMetric carries a metric value plus its real observation sample.
// Available is false for rate/average metrics with no valid denominator; those
// values must render as unavailable, never as a fabricated zero.
type AnalyticsMetric struct {
	Value              float64  `json:"value"`
	Available          bool     `json:"available"`
	SampleSize         int      `json:"sample_size"`
	PreviousValue      *float64 `json:"previous_value,omitempty"`
	PreviousAvailable  bool     `json:"previous_available"`
	PreviousSampleSize *int     `json:"previous_sample_size,omitempty"`
}

// DetailedAnalyticsSummary is the KPI strip requested by the Legal Director.
type DetailedAnalyticsSummary struct {
	TotalRequests      AnalyticsMetric `json:"total_requests"`
	CompletionRate     AnalyticsMetric `json:"completion_rate"`
	AvgProcessingHours AnalyticsMetric `json:"avg_processing_hours"`
	SatisfactionScore  AnalyticsMetric `json:"satisfaction_score"`
	SLACompliance      AnalyticsMetric `json:"sla_compliance"`
	PendingRequests    AnalyticsMetric `json:"pending_requests"`
}

// AnalyticsTrendPoint is one dense month in the request trend. PreviousCount
// aligns the equivalent ordinal month of the preceding comparison window.
type AnalyticsTrendPoint struct {
	PeriodStart   time.Time `json:"period_start"`
	Count         int       `json:"count"`
	PreviousCount *int      `json:"previous_count,omitempty"`
}

// LegalAdvisorPerformance is a real downstream assignment rollup. AdvisorID is
// nullable because some legacy domain rows recorded a reviewer name before a
// directory id became mandatory.
type LegalAdvisorPerformance struct {
	AdvisorID     *uuid.UUID `json:"advisor_id,omitempty"`
	AdvisorName   string     `json:"advisor_name"`
	TotalRequests int        `json:"total_requests"`
	Completed     int        `json:"completed_requests"`
	Active        int        `json:"active_requests"`
	AverageRating *float64   `json:"average_rating,omitempty"`
	RatingCount   int        `json:"rating_count"`
	SLACompliance *float64   `json:"sla_compliance_pct,omitempty"`
	ResolvedSLAs  int        `json:"resolved_slas"`
}

// DetailedAnalyticsFilterOptions are real tenant values used to build select
// controls. They are never hard-coded sample departments or service types.
type DetailedAnalyticsFilterOptions struct {
	Departments  []string `json:"departments"`
	ServiceTypes []string `json:"service_types"`
	Priorities   []string `json:"priorities"`
}

// DetailedAnalyticsDashboard is the single consistent read model for the
// request-centric Director Legal dashboard.
type DetailedAnalyticsDashboard struct {
	GeneratedAt        time.Time                      `json:"generated_at"`
	Filters            DetailedAnalyticsFilters       `json:"filters"`
	Period             AnalyticsPeriod                `json:"period"`
	PreviousPeriod     *AnalyticsPeriod               `json:"previous_period,omitempty"`
	Summary            DetailedAnalyticsSummary       `json:"summary"`
	MonthlyTrend       []AnalyticsTrendPoint          `json:"monthly_trend"`
	ByDepartment       []CountBucket                  `json:"by_department"`
	ByServiceType      []CountBucket                  `json:"by_service_type"`
	AdvisorPerformance []LegalAdvisorPerformance      `json:"advisor_performance"`
	FilterOptions      DetailedAnalyticsFilterOptions `json:"filter_options"`
}

// DetailedAnalyticsContributor is one source observation behind a detailed
// analytics KPI or chart bucket. Request identity is always present; the
// optional observation fields identify why the row contributes to an average,
// rating, SLA rate, or advisor bucket.
type DetailedAnalyticsContributor struct {
	RequestID          uuid.UUID           `json:"request_id"`
	RequestNumber      string              `json:"request_number"`
	Title              forms.LocalizedText `json:"title"`
	Department         *string             `json:"department,omitempty"`
	RequestType        string              `json:"request_type"`
	Priority           RequestPriority     `json:"priority"`
	Status             RequestStatus       `json:"status"`
	RequesterName      string              `json:"requester_name"`
	CreatedAt          time.Time           `json:"created_at"`
	ProcessingHours    *float64            `json:"processing_hours,omitempty"`
	SatisfactionRating *int                `json:"satisfaction_rating,omitempty"`
	SLAOutcome         *string             `json:"sla_outcome,omitempty"`
	AdvisorID          *uuid.UUID          `json:"advisor_id,omitempty"`
	AdvisorName        *string             `json:"advisor_name,omitempty"`
}
