package journal

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_RecordsSeries(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.IncSegmentSealed("stream-1", 100)
	m.IncSegmentSealed("stream-1", 50)
	m.IncSegmentPruned("stream-1")
	m.IncBookmark(BookmarkBarrier)
	m.IncResolve("timestamp", "resolved")
	m.IncResolve("seq", "pruned")
	m.SetCoverageSeconds("stream-1", 3600)

	if got := testutil.ToFloat64(m.segmentsSealed.WithLabelValues("stream-1")); got != 2 {
		t.Fatalf("segments_sealed = %v, want 2", got)
	}
	if got := testutil.ToFloat64(m.framesJournaled.WithLabelValues("stream-1")); got != 150 {
		t.Fatalf("frames_journaled = %v, want 150", got)
	}
	if got := testutil.ToFloat64(m.segmentsPruned.WithLabelValues("stream-1")); got != 1 {
		t.Fatalf("segments_pruned = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.coverageSeconds.WithLabelValues("stream-1")); got != 3600 {
		t.Fatalf("coverage_seconds = %v, want 3600", got)
	}

	// The series must be scrapeable from the registry under their documented names.
	gathered, err := reg.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	var names []string
	for _, mf := range gathered {
		names = append(names, mf.GetName())
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{
		"dr_journal_segments_sealed_total",
		"dr_journal_frames_journaled_total",
		"dr_journal_segments_pruned_total",
		"dr_journal_bookmarks_total",
		"dr_journal_resolves_total",
		"dr_journal_coverage_seconds",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("metric %q not registered; have %s", want, joined)
		}
	}
}

func TestMetrics_NilIsSafe(t *testing.T) {
	t.Parallel()
	var m *Metrics
	// Every method must be a no-op on a nil receiver.
	m.IncSegmentSealed("s", 1)
	m.IncSegmentPruned("s")
	m.IncBookmark(BookmarkManual)
	m.IncResolve("seq", "resolved")
	m.SetCoverageSeconds("s", 1)
}

func TestNewMetrics_NilRegistryDoesNotPanic(t *testing.T) {
	t.Parallel()
	// A nil registry must register on a private one (no duplicate-registration
	// panic), matching the platform per-instance-registry rule.
	_ = NewMetrics(nil)
	_ = NewMetrics(nil)
}
