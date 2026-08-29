package cleanroom

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_IncVerdict(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.IncVerdict("group-a", VerdictClean)
	m.IncVerdict("group-a", VerdictClean)
	m.IncVerdict("group-a", VerdictMalware)
	m.AddChunksScanned(5)

	if got := testutil.ToFloat64(m.verdict.WithLabelValues("group-a", VerdictClean)); got != 2 {
		t.Fatalf("clean verdict count: got %v want 2", got)
	}
	if got := testutil.ToFloat64(m.verdict.WithLabelValues("group-a", VerdictMalware)); got != 1 {
		t.Fatalf("malware verdict count: got %v want 1", got)
	}
	if got := testutil.ToFloat64(m.chunksScanned); got != 5 {
		t.Fatalf("chunks scanned: got %v want 5", got)
	}
}

func TestMetrics_NilSafe(t *testing.T) {
	t.Parallel()
	var m *Metrics
	// Must not panic on a nil receiver.
	m.IncVerdict("g", VerdictClean)
	m.AddChunksScanned(3)
}

func TestNewMetrics_NilRegistry(t *testing.T) {
	t.Parallel()
	// A nil registry uses a private one; construction must not panic and the
	// methods must work.
	m := NewMetrics(nil)
	m.IncVerdict("g", VerdictError)
	m.AddChunksScanned(1)
}
