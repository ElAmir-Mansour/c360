package service

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// ReferenceLibraryMetrics holds the Prometheus collectors for the GLOBAL
// WatheeqTech reference library (WatheeqTech_Library_Design.md §4 observability).
// It is registered on the lex service's PER-INSTANCE registry (deps.Registerer,
// never the global default) so re-constructing the lex Application in a test does
// not panic with duplicate-registration. Every record method is nil-safe: a
// service built without metrics (unit tests) records nothing rather than panics.
type ReferenceLibraryMetrics struct {
	// requests counts every reference-library HTTP handler invocation, labelled by
	// logical route and terminal outcome (ok|not_found|bad_request|unconfigured|
	// upstream_error|rate_limited|error) — drives per-route error-rate alerting.
	requests *prometheus.CounterVec
	// duration is the wall-clock handler latency per route (seconds).
	duration *prometheus.HistogramVec
	// downloads counts byte-download attempts by byte_source (volume|file-service)
	// and outcome (ok|not_modified|not_found|error) — proves the cross-tenant byte
	// path is exercised and which store served it.
	downloads *prometheus.CounterVec
	// bytesServed is the running total of PDF bytes streamed to callers.
	bytesServed prometheus.Counter
	// cache tracks the list/facets read-through cache by surface (list|facets) and
	// event (hit|miss|store|invalidate) — proves the static-corpus cache is warm.
	cache *prometheus.CounterVec
	// ai counts Second-Brain proxy calls by route (search|ask) and outcome
	// (ok|unconfigured|rate_limited|upstream_error|error) — the LLM-cost surface.
	ai *prometheus.CounterVec
}

// NewReferenceLibraryMetrics registers the reference-library collectors on reg
// and returns the handle. reg MUST be the lex per-instance registry
// (deps.Registerer); passing nil falls back to a throwaway registry so the
// service is still usable (e.g. a unit test that does not assert on metrics).
func NewReferenceLibraryMetrics(reg prometheus.Registerer) *ReferenceLibraryMetrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &ReferenceLibraryMetrics{
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_reference_library_requests_total",
			Help: "Reference-library handler invocations by route and terminal outcome.",
		}, []string{"route", "outcome"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "lex_reference_library_request_duration_seconds",
			Help:    "Reference-library handler latency by route.",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
		}, []string{"route"}),
		downloads: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_reference_library_downloads_total",
			Help: "Reference-library byte downloads by backing store and outcome.",
		}, []string{"byte_source", "outcome"}),
		bytesServed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_reference_library_bytes_served_total",
			Help: "Total PDF bytes streamed to callers from the reference library.",
		}),
		cache: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_reference_library_cache_events_total",
			Help: "Reference-library list/facets read-through cache events.",
		}, []string{"surface", "event"}),
		ai: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_reference_library_ai_requests_total",
			Help: "Reference-library Second-Brain proxy calls by route and outcome.",
		}, []string{"route", "outcome"}),
	}
	reg.MustRegister(m.requests, m.duration, m.downloads, m.bytesServed, m.cache, m.ai)
	return m
}

// ObserveRequest records one handler invocation: its outcome and latency.
func (m *ReferenceLibraryMetrics) ObserveRequest(route, outcome string, started time.Time) {
	if m == nil {
		return
	}
	m.requests.WithLabelValues(route, outcome).Inc()
	m.duration.WithLabelValues(route).Observe(time.Since(started).Seconds())
}

// RecordDownload records a byte-download attempt and, on success, the bytes served.
func (m *ReferenceLibraryMetrics) RecordDownload(byteSource, outcome string, bytes int64) {
	if m == nil {
		return
	}
	m.downloads.WithLabelValues(byteSource, outcome).Inc()
	if bytes > 0 {
		m.bytesServed.Add(float64(bytes))
	}
}

// RecordCache records a read-through cache event for a browse surface.
func (m *ReferenceLibraryMetrics) RecordCache(surface, event string) {
	if m == nil {
		return
	}
	m.cache.WithLabelValues(surface, event).Inc()
}

// RecordAI records a Second-Brain proxy call outcome.
func (m *ReferenceLibraryMetrics) RecordAI(route, outcome string) {
	if m == nil {
		return
	}
	m.ai.WithLabelValues(route, outcome).Inc()
}
