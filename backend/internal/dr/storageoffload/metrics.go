package storageoffload

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the storage-offload observability series. Construct once per
// process with NewMetrics and inject into the Service. A nil *Metrics is safe:
// every method is a no-op, so components not wired with metrics (e.g. unit
// tests) need no changes.
//
// Per the platform rule these register on a per-instance registry
// (prometheus.NewRegistry / the service's registry), never the global default,
// so constructing twice in a test never panics on duplicate registration.
type Metrics struct {
	snapshotsRequested *prometheus.CounterVec // by kind: full | incremental
	snapshotsReady     prometheus.Counter
	snapshotsFailed    prometheus.Counter
	snapshotsExpired   prometheus.Counter
	replications       prometheus.Counter
	bytesOffloaded     prometheus.Counter   // bytes the array/provider copied (delta accounting)
	bytesReplicated    prometheus.Counter   // bytes shipped to DR targets
	createSeconds      prometheus.Histogram // request -> READY
	replicateSeconds   prometheus.Histogram // READY -> REPLICATED
}

// NewMetrics registers the storage-offload metrics on reg. A nil reg registers
// on a private registry (tests), so construction never panics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		snapshotsRequested: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_storage_offload_snapshots_requested_total",
			Help: "Total array/file storage-offload snapshots requested, by kind (full|incremental).",
		}, []string{"kind"}),
		snapshotsReady: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_snapshots_ready_total",
			Help: "Total storage-offload snapshots that reached READY (array reported complete).",
		}),
		snapshotsFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_snapshots_failed_total",
			Help: "Total storage-offload snapshots that transitioned to FAILED.",
		}),
		snapshotsExpired: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_snapshots_expired_total",
			Help: "Total storage-offload snapshots expired by retention.",
		}),
		replications: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_replications_total",
			Help: "Total storage-offload snapshot replications to a DR target.",
		}),
		bytesOffloaded: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_bytes_offloaded_total",
			Help: "Total bytes the provider actually copied when taking snapshots (delta for incrementals).",
		}),
		bytesReplicated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_storage_offload_bytes_replicated_total",
			Help: "Total bytes shipped to DR replication targets.",
		}),
		createSeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_storage_offload_create_seconds",
			Help:    "Seconds from snapshot request to READY.",
			Buckets: []float64{0.1, 0.5, 1, 5, 15, 30, 60, 300, 900},
		}),
		replicateSeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_storage_offload_replicate_seconds",
			Help:    "Seconds from a READY snapshot to REPLICATED at the DR target.",
			Buckets: []float64{0.1, 0.5, 1, 5, 15, 30, 60, 300, 900},
		}),
	}
	reg.MustRegister(
		m.snapshotsRequested, m.snapshotsReady, m.snapshotsFailed, m.snapshotsExpired,
		m.replications, m.bytesOffloaded, m.bytesReplicated, m.createSeconds, m.replicateSeconds,
	)
	return m
}

// IncRequested records a requested snapshot of the given kind.
func (m *Metrics) IncRequested(kind string) {
	if m == nil {
		return
	}
	m.snapshotsRequested.WithLabelValues(kind).Inc()
}

// IncReady records a snapshot reaching READY and the bytes the provider copied.
func (m *Metrics) IncReady(offloadedBytes int64) {
	if m == nil {
		return
	}
	m.snapshotsReady.Inc()
	if offloadedBytes > 0 {
		m.bytesOffloaded.Add(float64(offloadedBytes))
	}
}

// IncFailed records a snapshot reaching FAILED.
func (m *Metrics) IncFailed() {
	if m == nil {
		return
	}
	m.snapshotsFailed.Inc()
}

// IncExpired records n snapshots expired by retention.
func (m *Metrics) IncExpired(n int) {
	if m == nil || n <= 0 {
		return
	}
	m.snapshotsExpired.Add(float64(n))
}

// IncReplicated records a completed replication and the bytes shipped.
func (m *Metrics) IncReplicated(transferred int64) {
	if m == nil {
		return
	}
	m.replications.Inc()
	if transferred > 0 {
		m.bytesReplicated.Add(float64(transferred))
	}
}

// ObserveCreate records seconds from snapshot request to READY.
func (m *Metrics) ObserveCreate(seconds float64) {
	if m == nil {
		return
	}
	m.createSeconds.Observe(seconds)
}

// ObserveReplicate records seconds from READY to REPLICATED.
func (m *Metrics) ObserveReplicate(seconds float64) {
	if m == nil {
		return
	}
	m.replicateSeconds.Observe(seconds)
}
