package instant

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the instant-recovery observability series. Construct once per
// process with NewMetrics and inject into the Service and Hydrator. A nil
// *Metrics is safe: every method is a no-op, so components not wired with
// metrics (e.g. unit tests) need no changes.
//
// Per the platform rule these register on a per-instance registry
// (prometheus.NewRegistry / the service's registry), never the global default,
// so constructing twice in a test never panics on duplicate registration.
type Metrics struct {
	sessionsStarted    prometheus.Counter
	sessionsReady      prometheus.Counter
	sessionsFinalized  prometheus.Counter
	sessionsFailed     prometheus.Counter
	chunksHydrated     prometheus.Counter
	chunksWritten      prometheus.Counter
	hydrationProgress  *prometheus.GaugeVec     // dr_instant_hydration_percent{session}
	timeToReadySeconds prometheus.Histogram     // start -> READY
	readChunkSeconds   *prometheus.HistogramVec // by source: overlay | base
}

// NewMetrics registers the instant-recovery metrics on reg. A nil reg registers
// on a private registry (tests), so construction never panics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		sessionsStarted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_sessions_started_total",
			Help: "Total instant-recovery sessions started (COW overlay presented over a recovery point).",
		}),
		sessionsReady: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_sessions_ready_total",
			Help: "Total instant-recovery sessions that finished lazy hydration (HYDRATING -> READY).",
		}),
		sessionsFinalized: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_sessions_finalized_total",
			Help: "Total instant-recovery sessions finalized into a standalone full copy.",
		}),
		sessionsFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_sessions_failed_total",
			Help: "Total instant-recovery sessions that transitioned to FAILED.",
		}),
		chunksHydrated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_chunks_hydrated_total",
			Help: "Total base chunks lazily copied from the recovery point into a session overlay.",
		}),
		chunksWritten: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_instant_chunks_written_total",
			Help: "Total redirect-on-write overlay chunks recorded by recovered workloads.",
		}),
		hydrationProgress: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_instant_hydration_percent",
			Help: "Per-session lazy-hydration progress as a 0..100 percentage.",
		}, []string{"session"}),
		timeToReadySeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_instant_time_to_ready_seconds",
			Help:    "Seconds from session start to full hydration (READY).",
			Buckets: []float64{1, 5, 15, 30, 60, 300, 900, 1800, 3600},
		}),
		readChunkSeconds: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "dr_instant_read_chunk_seconds",
			Help:    "Chunk read latency by source: overlay (redirected/hydrated) or base (read-through).",
			Buckets: prometheus.DefBuckets,
		}, []string{"source"}),
	}
	reg.MustRegister(
		m.sessionsStarted, m.sessionsReady, m.sessionsFinalized, m.sessionsFailed,
		m.chunksHydrated, m.chunksWritten, m.hydrationProgress,
		m.timeToReadySeconds, m.readChunkSeconds,
	)
	return m
}

// IncStarted records a started session.
func (m *Metrics) IncStarted() {
	if m == nil {
		return
	}
	m.sessionsStarted.Inc()
}

// IncReady records a session reaching READY (hydration complete).
func (m *Metrics) IncReady() {
	if m == nil {
		return
	}
	m.sessionsReady.Inc()
}

// IncFinalized records a session reaching FINALIZED.
func (m *Metrics) IncFinalized() {
	if m == nil {
		return
	}
	m.sessionsFinalized.Inc()
}

// IncFailed records a session reaching FAILED.
func (m *Metrics) IncFailed() {
	if m == nil {
		return
	}
	m.sessionsFailed.Inc()
}

// AddChunksHydrated adds n newly-hydrated base chunks.
func (m *Metrics) AddChunksHydrated(n int) {
	if m == nil || n <= 0 {
		return
	}
	m.chunksHydrated.Add(float64(n))
}

// IncChunkWritten records one redirect-on-write.
func (m *Metrics) IncChunkWritten() {
	if m == nil {
		return
	}
	m.chunksWritten.Inc()
}

// SetHydrationProgress records a session's hydration percentage.
func (m *Metrics) SetHydrationProgress(sessionID string, percent float64) {
	if m == nil {
		return
	}
	m.hydrationProgress.WithLabelValues(sessionID).Set(percent)
}

// ClearHydrationProgress removes a session's progress series (after FINALIZED)
// so the gauge does not linger at 100 forever.
func (m *Metrics) ClearHydrationProgress(sessionID string) {
	if m == nil {
		return
	}
	m.hydrationProgress.DeleteLabelValues(sessionID)
}

// ObserveTimeToReady records seconds from start to READY.
func (m *Metrics) ObserveTimeToReady(seconds float64) {
	if m == nil {
		return
	}
	m.timeToReadySeconds.Observe(seconds)
}

// ObserveReadChunk records a chunk read latency by source ("overlay" | "base").
func (m *Metrics) ObserveReadChunk(source string, seconds float64) {
	if m == nil {
		return
	}
	m.readChunkSeconds.WithLabelValues(source).Observe(seconds)
}
