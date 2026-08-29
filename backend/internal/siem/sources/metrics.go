package sources

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics is the full SIEM-03 §4.12 set. Built against a per-instance
// registry so test setup can instantiate fresh metrics without colliding
// on the default global Prom registry.
type Metrics struct {
	SourcesTotal             *prometheus.GaugeVec
	ProvisioningAgeSeconds   *prometheus.GaugeVec
	SourceEPSCurrent         *prometheus.GaugeVec
	SourceBaselineEPS        *prometheus.GaugeVec
	SourceDriftPct           *prometheus.GaugeVec
	SourceLastSeenAge        *prometheus.GaugeVec
	SourceCertExpiryDays     *prometheus.GaugeVec
	EnrollIssuedTotal        *prometheus.CounterVec
	EnrollConsumedTotal      *prometheus.CounterVec
	EnrollReplayBlockedTotal *prometheus.CounterVec
	PKILeafIssuedTotal       *prometheus.CounterVec
	PKILeafRevokedTotal      *prometheus.CounterVec
	MTLSVerificationsTotal   *prometheus.CounterVec
	DetectorRunDuration      prometheus.Histogram
	DetectorSilentSources    *prometheus.GaugeVec
	DetectorSilentTrans      *prometheus.CounterVec
	DetectorRecoveredTotal   *prometheus.CounterVec
	HeartbeatRateLimited     *prometheus.CounterVec
	HeartbeatIngestedTotal   *prometheus.CounterVec
}

// NewMetrics constructs the full set and registers them on reg.
//
// IMPORTANT: Histograms are *not* labelled by source_id (cardinality
// discipline — see PROMPT3.MD §4.12 anti-pattern note).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	factory := promauto.With(reg)
	return &Metrics{
		SourcesTotal: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_sources_total",
			Help: "Number of sources by tenant and status.",
		}, []string{"tenant", "status"}),

		ProvisioningAgeSeconds: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_sources_provisioning_age_seconds",
			Help: "Seconds spent in provisioning state per source.",
		}, []string{"tenant", "source_id"}),

		SourceEPSCurrent: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_source_eps_current",
			Help: "Latest EPS reading per source per window.",
		}, []string{"tenant", "source_id", "window"}),

		SourceBaselineEPS: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_source_baseline_eps",
			Help: "EWMA baseline EPS per source.",
		}, []string{"tenant", "source_id"}),

		SourceDriftPct: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_source_drift_pct",
			Help: "Signed drift percentage from baseline per source.",
		}, []string{"tenant", "source_id"}),

		SourceLastSeenAge: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_source_last_seen_age_seconds",
			Help: "Seconds since last heartbeat per source.",
		}, []string{"tenant", "source_id"}),

		SourceCertExpiryDays: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_source_cert_expiry_days",
			Help: "Days until cert expiry per source (negative if expired).",
		}, []string{"tenant", "source_id"}),

		EnrollIssuedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_enrollment_tokens_issued_total",
			Help: "Enrollment tokens issued by tenant and purpose.",
		}, []string{"tenant", "purpose"}),

		EnrollConsumedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_enrollment_tokens_consumed_total",
			Help: "Enrollment tokens consumed by tenant, purpose, result.",
		}, []string{"tenant", "purpose", "result"}),

		EnrollReplayBlockedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_enrollment_tokens_replay_blocked_total",
			Help: "Enrollment-token replay attempts blocked.",
		}, []string{"tenant"}),

		PKILeafIssuedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_pki_leaf_issued_total",
			Help: "PKI leaf certificates issued by tenant.",
		}, []string{"tenant"}),

		PKILeafRevokedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_pki_leaf_revoked_total",
			Help: "PKI leaf certificates revoked.",
		}, []string{"tenant", "reason"}),

		MTLSVerificationsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_mtls_verifications_total",
			Help: "mTLS verifications by outcome.",
		}, []string{"result"}),

		DetectorRunDuration: factory.NewHistogram(prometheus.HistogramOpts{
			Name:    "siem_detector_run_duration_seconds",
			Help:    "Detector loop run duration.",
			Buckets: prometheus.DefBuckets,
		}),

		DetectorSilentSources: factory.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_detector_silent_sources",
			Help: "Number of sources currently in silent status per tenant.",
		}, []string{"tenant"}),

		DetectorSilentTrans: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_detector_silent_transitions_total",
			Help: "Active→silent transitions by tenant and reason.",
		}, []string{"tenant", "reason"}),

		DetectorRecoveredTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_detector_recovered_total",
			Help: "Silent→active recovery transitions by tenant.",
		}, []string{"tenant"}),

		HeartbeatRateLimited: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_heartbeat_rate_limited_total",
			Help: "Heartbeats rejected by the per-source rate limiter.",
		}, []string{"tenant", "source_id"}),

		HeartbeatIngestedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_heartbeat_ingested_total",
			Help: "Heartbeats accepted by tenant.",
		}, []string{"tenant"}),
	}
}
