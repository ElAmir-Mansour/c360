package metrics

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestRecordSupportRequestsExpired(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics := New(registry)

	metrics.RecordSupportRequestsExpired(3)
	metrics.RecordSupportRequestsExpired(0)
	metrics.RecordSupportRequestsExpired(-1)

	if got := testutil.ToFloat64(metrics.SupportRequestsExpiredTotal); got != 3 {
		t.Fatalf("lex_support_requests_expired_total = %v, want 3", got)
	}

	var nilMetrics *Metrics
	nilMetrics.RecordSupportRequestsExpired(2)
}
