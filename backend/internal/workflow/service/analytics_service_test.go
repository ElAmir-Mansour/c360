package service

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
)

// fakeAnalyticsRepo is a hand double for analyticsRepository. It records the
// arguments the service passed (so we can assert window normalization + interval
// whitelisting reached the read model) and returns canned rows.
type fakeAnalyticsRepo struct {
	cycleWindow   int
	cycleKey      string
	bottleWindow  int
	bottleKey     string
	reworkDefWin  int
	reworkStepWin int
	throughputInt string
	throughputWin int
	activeCalled  bool
	buckets       []dto.ThroughputBucket
	active        int
}

func (f *fakeAnalyticsRepo) CycleTime(_ context.Context, _, definitionKey string, windowDays int) ([]dto.CycleTimeStats, error) {
	f.cycleKey = definitionKey
	f.cycleWindow = windowDays
	return []dto.CycleTimeStats{{DefinitionKey: definitionKey, Version: 1, CompletedCount: 3, P50Seconds: 100}}, nil
}

func (f *fakeAnalyticsRepo) Bottlenecks(_ context.Context, _, definitionKey string, windowDays int) ([]dto.StepBottleneck, error) {
	f.bottleKey = definitionKey
	f.bottleWindow = windowDays
	return []dto.StepBottleneck{{StepID: "review", P90Seconds: 500}}, nil
}

func (f *fakeAnalyticsRepo) ReworkPerDefinition(_ context.Context, _ string, windowDays int) ([]dto.ReworkStat, error) {
	f.reworkDefWin = windowDays
	return []dto.ReworkStat{{DefinitionKey: "k", TotalExecutions: 10, ReworkExecutions: 2, ReworkRate: 0.2}}, nil
}

func (f *fakeAnalyticsRepo) ReworkPerStep(_ context.Context, _ string, windowDays int) ([]dto.ReworkStat, error) {
	f.reworkStepWin = windowDays
	return []dto.ReworkStat{{DefinitionKey: "k", StepID: "review", TotalExecutions: 5, ReworkExecutions: 1, ReworkRate: 0.2}}, nil
}

func (f *fakeAnalyticsRepo) Throughput(_ context.Context, _, interval string, windowDays int) ([]dto.ThroughputBucket, error) {
	f.throughputInt = interval
	f.throughputWin = windowDays
	return f.buckets, nil
}

func (f *fakeAnalyticsRepo) ActiveCount(_ context.Context, _ string) (int, error) {
	f.activeCalled = true
	return f.active, nil
}

func newAnalyticsSvc(repo analyticsRepository) *AnalyticsService {
	return NewAnalyticsService(repo, zerolog.Nop())
}

func TestAnalyticsService_CycleTimeDefaultsWindowAndRequiresKey(t *testing.T) {
	repo := &fakeAnalyticsRepo{}
	svc := newAnalyticsSvc(repo)

	// Missing key -> error, repo untouched.
	if _, err := svc.CycleTime(context.Background(), "t", "", 0); err == nil {
		t.Fatal("CycleTime() with empty key: want error, got nil")
	}

	// windowDays 0 -> default 90 reaches the repo; report echoes it.
	report, err := svc.CycleTime(context.Background(), "t", "key-1", 0)
	if err != nil {
		t.Fatalf("CycleTime() error = %v", err)
	}
	if repo.cycleWindow != 90 {
		t.Fatalf("repo window = %d, want default 90", repo.cycleWindow)
	}
	if report.WindowDays != 90 || report.DefinitionKey != "key-1" || len(report.Versions) != 1 {
		t.Fatalf("CycleTime report = %+v, unexpected", report)
	}
}

func TestAnalyticsService_CycleTimeClampsWindow(t *testing.T) {
	repo := &fakeAnalyticsRepo{}
	svc := newAnalyticsSvc(repo)
	report, err := svc.CycleTime(context.Background(), "t", "key-1", 10000)
	if err != nil {
		t.Fatalf("CycleTime() error = %v", err)
	}
	if repo.cycleWindow != 365 || report.WindowDays != 365 {
		t.Fatalf("window clamp = %d/%d, want 365/365", repo.cycleWindow, report.WindowDays)
	}
}

func TestAnalyticsService_BottlenecksPassesOptionalKey(t *testing.T) {
	repo := &fakeAnalyticsRepo{}
	svc := newAnalyticsSvc(repo)
	report, err := svc.Bottlenecks(context.Background(), "t", "def-key", 30)
	if err != nil {
		t.Fatalf("Bottlenecks() error = %v", err)
	}
	if repo.bottleKey != "def-key" || repo.bottleWindow != 30 {
		t.Fatalf("repo got key=%q win=%d, want def-key/30", repo.bottleKey, repo.bottleWindow)
	}
	if report.DefinitionKey != "def-key" || len(report.Steps) != 1 {
		t.Fatalf("Bottlenecks report = %+v, unexpected", report)
	}
}

func TestAnalyticsService_ReworkReturnsBothScopes(t *testing.T) {
	repo := &fakeAnalyticsRepo{}
	svc := newAnalyticsSvc(repo)
	report, err := svc.Rework(context.Background(), "t", 0)
	if err != nil {
		t.Fatalf("Rework() error = %v", err)
	}
	if repo.reworkDefWin != 90 || repo.reworkStepWin != 90 {
		t.Fatalf("rework windows = %d/%d, want 90/90", repo.reworkDefWin, repo.reworkStepWin)
	}
	if len(report.PerDefinition) != 1 || len(report.PerStep) != 1 {
		t.Fatalf("Rework report = %+v, want 1 per-def + 1 per-step", report)
	}
}

func TestAnalyticsService_ThroughputComputesTotalsAndFailureRate(t *testing.T) {
	repo := &fakeAnalyticsRepo{
		active: 4,
		buckets: []dto.ThroughputBucket{
			{BucketStart: "2026-07-01T00:00:00Z", Started: 5, Completed: 3, Failed: 1},
			{BucketStart: "2026-07-02T00:00:00Z", Started: 4, Completed: 2, Failed: 2},
		},
	}
	svc := newAnalyticsSvc(repo)
	report, err := svc.Throughput(context.Background(), "t", "bogus", 0)
	if err != nil {
		t.Fatalf("Throughput() error = %v", err)
	}
	// bogus interval -> whitelisted to 'day'.
	if repo.throughputInt != "day" || report.Interval != "day" {
		t.Fatalf("interval = %q/%q, want day (whitelist)", repo.throughputInt, report.Interval)
	}
	if !repo.activeCalled || report.ActiveCount != 4 {
		t.Fatalf("active count not wired: called=%v value=%d", repo.activeCalled, report.ActiveCount)
	}
	if report.TotalStarted != 9 || report.TotalCompleted != 5 || report.TotalFailed != 3 {
		t.Fatalf("totals = %d/%d/%d, want 9/5/3", report.TotalStarted, report.TotalCompleted, report.TotalFailed)
	}
	// failure rate = failed / (completed + failed) = 3 / 8 = 0.375.
	if report.FailureRate < 0.374 || report.FailureRate > 0.376 {
		t.Fatalf("FailureRate = %v, want ~0.375", report.FailureRate)
	}
}

func TestAnalyticsService_ThroughputWeekWhitelisted(t *testing.T) {
	repo := &fakeAnalyticsRepo{}
	svc := newAnalyticsSvc(repo)
	report, err := svc.Throughput(context.Background(), "t", "week", 14)
	if err != nil {
		t.Fatalf("Throughput() error = %v", err)
	}
	if repo.throughputInt != "week" || report.Interval != "week" {
		t.Fatalf("interval = %q, want week", repo.throughputInt)
	}
	// no terminal instances -> failure rate stays 0 (no divide-by-zero).
	if report.FailureRate != 0 {
		t.Fatalf("FailureRate = %v, want 0 on empty", report.FailureRate)
	}
}
