package service

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
)

// analyticsRepository is the READ-ONLY process-analytics read model the
// AnalyticsService drives. It mirrors the WorkflowAnalyticsRepository methods so
// the service can be unit-tested against a double. Every method is tenant-scoped
// at the repository layer (RLS).
type analyticsRepository interface {
	CycleTime(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]dto.CycleTimeStats, error)
	Bottlenecks(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]dto.StepBottleneck, error)
	ReworkPerDefinition(ctx context.Context, tenantID string, windowDays int) ([]dto.ReworkStat, error)
	ReworkPerStep(ctx context.Context, tenantID string, windowDays int) ([]dto.ReworkStat, error)
	Throughput(ctx context.Context, tenantID, interval string, windowDays int) ([]dto.ThroughputBucket, error)
	ActiveCount(ctx context.Context, tenantID string) (int, error)
}

// AnalyticsService assembles the four process-intelligence reports (cycle time,
// bottlenecks, rework, throughput) from the read model. It is purely a
// read-side aggregator — no engine or state-model interaction — so it never
// mutates workflow state.
type AnalyticsService struct {
	repo   analyticsRepository
	logger zerolog.Logger
}

// NewAnalyticsService creates an AnalyticsService over the given read model.
func NewAnalyticsService(repo analyticsRepository, logger zerolog.Logger) *AnalyticsService {
	return &AnalyticsService{
		repo:   repo,
		logger: logger.With().Str("service", "workflow_analytics").Logger(),
	}
}

// defaultWindowDays is the analytics lookback used when the caller does not
// specify one; it is re-clamped at the repository layer as a defence in depth.
const defaultWindowDays = 90

// normalizeWindow defaults and bounds the window so the service and repository
// agree on the reported window_days value returned to the caller.
func normalizeWindow(days int) int {
	if days <= 0 {
		return defaultWindowDays
	}
	if days > 365 {
		return 365
	}
	return days
}

// CycleTime returns the per-version cycle-time report for a definition lineage.
func (s *AnalyticsService) CycleTime(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.CycleTimeReport, error) {
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}
	windowDays = normalizeWindow(windowDays)
	versions, err := s.repo.CycleTime(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	if versions == nil {
		versions = []dto.CycleTimeStats{}
	}
	return &dto.CycleTimeReport{
		DefinitionKey: definitionKey,
		WindowDays:    windowDays,
		Versions:      versions,
	}, nil
}

// Bottlenecks returns the slowest-first per-step bottleneck report, optionally
// scoped to a single definition lineage (empty definitionKey = all definitions).
func (s *AnalyticsService) Bottlenecks(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.BottleneckReport, error) {
	windowDays = normalizeWindow(windowDays)
	steps, err := s.repo.Bottlenecks(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	if steps == nil {
		steps = []dto.StepBottleneck{}
	}
	return &dto.BottleneckReport{
		DefinitionKey: definitionKey,
		WindowDays:    windowDays,
		Steps:         steps,
	}, nil
}

// Rework returns both the per-definition and per-step rework rates.
func (s *AnalyticsService) Rework(ctx context.Context, tenantID string, windowDays int) (*dto.ReworkReport, error) {
	windowDays = normalizeWindow(windowDays)
	perDef, err := s.repo.ReworkPerDefinition(ctx, tenantID, windowDays)
	if err != nil {
		return nil, err
	}
	perStep, err := s.repo.ReworkPerStep(ctx, tenantID, windowDays)
	if err != nil {
		return nil, err
	}
	if perDef == nil {
		perDef = []dto.ReworkStat{}
	}
	if perStep == nil {
		perStep = []dto.ReworkStat{}
	}
	return &dto.ReworkReport{
		WindowDays:    windowDays,
		PerDefinition: perDef,
		PerStep:       perStep,
	}, nil
}

// Throughput returns the started/completed/failed time series plus the derived
// totals, in-flight count, and failure rate. interval must be 'day' or 'week';
// any other value is coerced to 'day'.
func (s *AnalyticsService) Throughput(ctx context.Context, tenantID, interval string, windowDays int) (*dto.ThroughputReport, error) {
	interval = normalizeInterval(interval)
	windowDays = normalizeWindow(windowDays)

	buckets, err := s.repo.Throughput(ctx, tenantID, interval, windowDays)
	if err != nil {
		return nil, err
	}
	if buckets == nil {
		buckets = []dto.ThroughputBucket{}
	}
	active, err := s.repo.ActiveCount(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	report := &dto.ThroughputReport{
		Interval:    interval,
		WindowDays:  windowDays,
		Buckets:     buckets,
		ActiveCount: active,
	}
	for _, b := range buckets {
		report.TotalStarted += b.Started
		report.TotalCompleted += b.Completed
		report.TotalFailed += b.Failed
	}
	if terminal := report.TotalCompleted + report.TotalFailed; terminal > 0 {
		report.FailureRate = float64(report.TotalFailed) / float64(terminal)
	}
	return report, nil
}

// normalizeInterval whitelists the DATE_TRUNC granularity. Because the interval
// is interpolated into the throughput SQL (DATE_TRUNC's first argument is a
// keyword, not a bind value), this whitelist is the ONLY place a caller-supplied
// interval can enter the query — anything not 'day'/'week' collapses to 'day', so
// no arbitrary string ever reaches the SQL.
func normalizeInterval(interval string) string {
	switch interval {
	case "week":
		return "week"
	default:
		return "day"
	}
}
