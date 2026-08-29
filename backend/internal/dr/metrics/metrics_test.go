package metrics

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetricsExposeDesignSLOSeries(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := New(reg)

	m.SetRPO("tier-0", 42)
	m.SetValidationRatio("tier-0", 0.9995)
	m.SetStreamStatus("stream-1", "degraded")
	m.ObserveRTO("real", 123)

	if got := testutil.ToFloat64(m.rpoSeconds.WithLabelValues("tier-0")); got != 42 {
		t.Fatalf("dr_rpo_seconds = %v, want 42", got)
	}
	if got := testutil.ToFloat64(m.validationRatio.WithLabelValues("tier-0")); got != 0.9995 {
		t.Fatalf("dr_recovery_point_validation_ratio = %v, want 0.9995", got)
	}
	if got := testutil.ToFloat64(m.streamStatus.WithLabelValues("stream-1", "degraded")); got != 1 {
		t.Fatalf("degraded stream status = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.streamStatus.WithLabelValues("stream-1", "streaming")); got != 0 {
		t.Fatalf("streaming stream status = %v, want 0", got)
	}
	if count := testutil.CollectAndCount(m.failoverRTO); count == 0 {
		t.Fatal("dr_failover_rto_seconds was not collected")
	}
}

func TestMetricsNilReceiverIsNoop(t *testing.T) {
	t.Parallel()
	var m *Metrics

	m.SetRPO("tier-0", 1)
	m.SetValidationRatio("tier-0", 1)
	m.SetStreamStatus("stream-1", "streaming")
	m.ObserveRTO("real", 1)
}
