package journal

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the CDP journal SLO series. A nil *Metrics is safe: every method
// is a no-op, so components not wired with metrics (e.g. unit tests) need no
// changes. Per the platform rule, NewMetrics uses a per-instance registry.
type Metrics struct {
	// segmentsSealed counts journal segments sealed into the index, by stream,
	// proving the appender is rolling real frames into durable coverage.
	segmentsSealed *prometheus.CounterVec
	// framesJournaled counts frames folded into segments, by stream.
	framesJournaled *prometheus.CounterVec
	// segmentsPruned counts segments reclaimed by retention, by stream.
	segmentsPruned *prometheus.CounterVec
	// bookmarks counts named restore points created, by kind.
	bookmarks *prometheus.CounterVec
	// resolves counts resolve requests, by target kind and outcome.
	resolves *prometheus.CounterVec
	// coverageSeconds is the live recoverable window (latest_ts - earliest_ts)
	// per stream — the headline CDP capability gauge: how far back any-point
	// recovery can reach right now.
	coverageSeconds *prometheus.GaugeVec
}

// NewMetrics registers the journal metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration;
// production passes the service's registry so the series are scraped.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		segmentsSealed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_journal_segments_sealed_total",
			Help: "Journal segments sealed into the CDP index, by stream.",
		}, []string{"stream"}),
		framesJournaled: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_journal_frames_journaled_total",
			Help: "Change frames folded into CDP journal segments, by stream.",
		}, []string{"stream"}),
		segmentsPruned: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_journal_segments_pruned_total",
			Help: "Journal segments reclaimed by retention, by stream.",
		}, []string{"stream"}),
		bookmarks: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_journal_bookmarks_total",
			Help: "Named CDP restore points created, by kind.",
		}, []string{"kind"}),
		resolves: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_journal_resolves_total",
			Help: "APIT resolve requests, by target kind (timestamp|lsn|seq) and outcome (resolved|clamped|pruned|no_coverage|error).",
		}, []string{"target", "outcome"}),
		coverageSeconds: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_journal_coverage_seconds",
			Help: "Live any-point-in-time recovery window per stream (latest recoverable instant minus earliest).",
		}, []string{"stream"}),
	}
	reg.MustRegister(m.segmentsSealed, m.framesJournaled, m.segmentsPruned, m.bookmarks, m.resolves, m.coverageSeconds)
	return m
}

// IncSegmentSealed records a sealed segment of n frames for a stream.
func (m *Metrics) IncSegmentSealed(stream string, frames int) {
	if m == nil {
		return
	}
	m.segmentsSealed.WithLabelValues(stream).Inc()
	if frames > 0 {
		m.framesJournaled.WithLabelValues(stream).Add(float64(frames))
	}
}

// IncSegmentPruned records a reclaimed segment for a stream.
func (m *Metrics) IncSegmentPruned(stream string) {
	if m == nil {
		return
	}
	m.segmentsPruned.WithLabelValues(stream).Inc()
}

// IncBookmark records a created restore point of a kind.
func (m *Metrics) IncBookmark(kind string) {
	if m == nil {
		return
	}
	m.bookmarks.WithLabelValues(kind).Inc()
}

// IncResolve records a resolve outcome by target kind.
func (m *Metrics) IncResolve(target, outcome string) {
	if m == nil {
		return
	}
	m.resolves.WithLabelValues(target, outcome).Inc()
}

// SetCoverageSeconds records a stream's live recoverable window.
func (m *Metrics) SetCoverageSeconds(stream string, seconds float64) {
	if m == nil {
		return
	}
	m.coverageSeconds.WithLabelValues(stream).Set(seconds)
}
