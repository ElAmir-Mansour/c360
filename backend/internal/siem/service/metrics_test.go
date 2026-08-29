package service_test

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"

	obsmetrics "github.com/clario360/platform/internal/observability/metrics"
	"github.com/clario360/platform/internal/siem/service"
)

func TestNewSIEMMetrics_RegistersExpectedSeries(t *testing.T) {
	t.Parallel()
	m := obsmetrics.NewMetrics("siem-service")
	sm := service.NewSIEMMetrics(m)

	// Up metric is seeded to 1.
	if v := testutil.ToFloat64(sm.Up.WithLabelValues("dev", "unknown")); v != 1 {
		t.Errorf("siem_service_up = %v, want 1", v)
	}

	// Readiness has three components seeded.
	for _, c := range []string{"postgres", "redis", "kafka"} {
		_ = sm.Readiness.WithLabelValues(c)
	}

	// Update readiness and confirm.
	sm.SetReadiness("postgres", true)
	if v := testutil.ToFloat64(sm.Readiness.WithLabelValues("postgres")); v != 1 {
		t.Errorf("readiness postgres=%v, want 1", v)
	}
	sm.SetReadiness("postgres", false)
	if v := testutil.ToFloat64(sm.Readiness.WithLabelValues("postgres")); v != 0 {
		t.Errorf("readiness postgres=%v, want 0", v)
	}

	// Seed one child per vec so the gatherer surfaces them.
	sm.HTTPRequestsTotal.WithLabelValues("GET", "/api/v1/siem/_meta", "200").Inc()
	sm.HTTPDurationSeconds.WithLabelValues("GET", "/api/v1/siem/_meta").Observe(0.01)
	sm.KafkaProducerMsgs.WithLabelValues("dlq", "ok").Inc()
	sm.KafkaConsumerLag.WithLabelValues("alerts", "0").Set(0)
	sm.AuditEmitTotal.WithLabelValues("ok").Inc()

	// Metric names carry the sanitized prefix (siem_service_*, hyphen → underscore).
	mfs, err := m.Registry().Gather()
	if err != nil {
		t.Fatal(err)
	}
	wanted := map[string]bool{
		"siem_service_up":                            false,
		"siem_service_build_info":                    false,
		"siem_service_start_time_seconds":            false,
		"siem_service_http_requests_total":           false,
		"siem_service_http_request_duration_seconds": false,
		"siem_service_kafka_producer_messages_total": false,
		"siem_service_kafka_consumer_lag":            false,
		"siem_service_audit_emit_total":              false,
		"siem_service_readiness":                     false,
	}
	for _, mf := range mfs {
		if _, ok := wanted[mf.GetName()]; ok {
			wanted[mf.GetName()] = true
		}
	}
	for name, ok := range wanted {
		if !ok {
			t.Errorf("metric %q missing", name)
		}
	}
}

func TestBuild_ReExportsBuildInfo(t *testing.T) {
	t.Parallel()
	b := service.Build()
	if b.Version == "" || b.GoVersion == "" {
		t.Errorf("Build() returned empty values: %+v", b)
	}
	if !strings.HasPrefix(b.GoVersion, "go") {
		t.Errorf("GoVersion=%q must start with 'go'", b.GoVersion)
	}
}

// Smoke: prometheus shouldn't reject the registered metrics — exercise
// the gatherer directly to catch label or buckets issues.
func TestSIEMMetrics_PrometheusGatherSucceeds(t *testing.T) {
	t.Parallel()
	m := obsmetrics.NewMetrics("siem-service")
	_ = service.NewSIEMMetrics(m)

	if _, err := m.Registry().Gather(); err != nil {
		t.Fatal(err)
	}
	_ = prometheus.NewRegistry() // touch import
}
