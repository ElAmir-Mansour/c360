package predict

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_ObserveForecastSetsGauges(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	h := 120.0
	m.ObserveForecast("stream-1", Forecast{
		PredictedBreachSeconds: &h,
		LagTrendSlope:          0.5,
		ThroughputCollapse:     true,
	})

	if got := testutil.ToFloat64(m.predictedBreach.WithLabelValues("stream-1")); got != 120 {
		t.Fatalf("dr_predicted_breach_seconds = %v, want 120", got)
	}
	if got := testutil.ToFloat64(m.lagTrendSlope.WithLabelValues("stream-1")); got != 0.5 {
		t.Fatalf("dr_predicted_lag_trend_slope = %v, want 0.5", got)
	}
	if got := testutil.ToFloat64(m.throughputCollapse.WithLabelValues("stream-1")); got != 1 {
		t.Fatalf("dr_predicted_throughput_collapse = %v, want 1", got)
	}
}

func TestMetrics_NoFinititeBreachClearsGauge(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	h := 60.0
	m.ObserveForecast("stream-1", Forecast{PredictedBreachSeconds: &h})
	if got := testutil.CollectAndCount(m.predictedBreach); got != 1 {
		t.Fatalf("expected the breach series to be present, got %d", got)
	}

	// A subsequent forecast with no finite breach must remove the series so a
	// stale "imminent" reading does not linger.
	m.ObserveForecast("stream-1", Forecast{PredictedBreachSeconds: nil})
	if got := testutil.CollectAndCount(m.predictedBreach); got != 0 {
		t.Fatalf("breach series should be cleared when no breach is forecast, got %d", got)
	}
}

func TestMetrics_IncBreachForecast(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)
	m.IncBreachForecast("stream-1")
	m.IncBreachForecast("stream-1")
	if got := testutil.ToFloat64(m.breachForecasts.WithLabelValues("stream-1")); got != 2 {
		t.Fatalf("dr_prediction_breach_forecasts_total = %v, want 2", got)
	}
}

func TestMetrics_Forget(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)
	h := 30.0
	m.ObserveForecast("stream-1", Forecast{PredictedBreachSeconds: &h, LagTrendSlope: 1})
	m.Forget("stream-1")
	if got := testutil.CollectAndCount(m.predictedBreach); got != 0 {
		t.Fatalf("Forget must remove the breach gauge, got %d", got)
	}
	if got := testutil.CollectAndCount(m.lagTrendSlope); got != 0 {
		t.Fatalf("Forget must remove the slope gauge, got %d", got)
	}
}

func TestMetrics_NilReceiverIsNoop(t *testing.T) {
	t.Parallel()
	var m *Metrics
	h := 10.0
	m.ObserveForecast("s", Forecast{PredictedBreachSeconds: &h})
	m.IncBreachForecast("s")
	m.Forget("s")
}

func TestNewMetrics_NilRegistryDoesNotPanic(t *testing.T) {
	t.Parallel()
	_ = NewMetrics(nil) // must register on a private registry, no panic
}
