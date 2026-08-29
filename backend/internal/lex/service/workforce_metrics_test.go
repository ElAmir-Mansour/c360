package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

func TestWorkforceTelemetryIsLabelFreeAndUsesOpenThreshold(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics := NewLexDomainMetrics(registry)

	metrics.ObserveWorkforceReport(499, 10001, 0.1)
	if count, _ := workforceHistogramSnapshot(t, registry); count != 0 {
		t.Fatalf("large-report histogram observations = %d below 500 items, want 0", count)
	}
	if got := testutil.ToFloat64(metrics.WorkforceOpenOver10KTotal); got != 1 {
		t.Fatalf("open threshold counter = %v, want 1", got)
	}

	metrics.ObserveWorkforceReport(500, 10000, 0.2)
	if count, bounds := workforceHistogramSnapshot(t, registry); count != 1 || !containsWorkforceHistogramBound(bounds, 2) {
		t.Fatalf("large-report histogram count/bounds = %d/%v, want one observation and exact 2.0s bucket", count, bounds)
	}

	metrics.ObserveWorkforceReport(10001, 10001, 0.3)
	if count, _ := workforceHistogramSnapshot(t, registry); count != 2 {
		t.Fatalf("large-report histogram observations = %d, want one label-free series with two observations", count)
	}
	if got := testutil.ToFloat64(metrics.WorkforceOpenOver10KTotal); got != 2 {
		t.Fatalf("open threshold counter = %v, want 2", got)
	}
}

func TestWorkforceTelemetryOpenCountIncludesLinkedAttributableItems(t *testing.T) {
	linkedID := uuid.New()
	directID := uuid.New()
	items, open := workforceTelemetryCounts([]repository.WorkforceAttribution{
		{Domain: "requests", SubjectID: linkedID, IsOpen: true, AttributionPath: model.AttributionLinked},
		{Domain: "requests", SubjectID: linkedID, IsOpen: true, AttributionPath: model.AttributionLinked},
		{Domain: "contracts", SubjectID: directID, IsOpen: true, AttributionPath: model.AttributionDirect},
	})
	if items != 2 || open != 2 {
		t.Fatalf("telemetry counts = %d/%d, want 2 distinct attributable items and 2 open", items, open)
	}
}

func workforceHistogramSnapshot(t *testing.T, registry *prometheus.Registry) (uint64, []float64) {
	t.Helper()
	families, err := registry.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}
	for _, family := range families {
		if family.GetName() != "lex_workforce_large_report_duration_seconds" || len(family.Metric) != 1 {
			continue
		}
		histogram := family.Metric[0].GetHistogram()
		bounds := make([]float64, 0, len(histogram.Bucket))
		for _, bucket := range histogram.Bucket {
			bounds = append(bounds, bucket.GetUpperBound())
		}
		return histogram.GetSampleCount(), bounds
	}
	t.Fatal("workforce duration histogram not registered")
	return 0, nil
}

func containsWorkforceHistogramBound(bounds []float64, target float64) bool {
	for _, bound := range bounds {
		if bound == target {
			return true
		}
	}
	return false
}
