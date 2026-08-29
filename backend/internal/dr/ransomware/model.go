package ransomware

import "time"

// Signal kinds. These are the dr_ransomware_signal{kind} label values and the
// signal_kind column values; keep them in sync with the migration's CHECK.
const (
	// SignalEntropy fires when sampled changed-payload entropy crosses the
	// high-entropy threshold (bulk encryption fingerprint).
	SignalEntropy = "entropy"
	// SignalByteRate fires when the live byte-rate spikes above the EWMA
	// baseline by the configured multiple (mass-rewrite fingerprint).
	SignalByteRate = "byte_rate"
	// SignalChangeRate fires when the live change/operation rate spikes above
	// the EWMA baseline by the configured multiple.
	SignalChangeRate = "change_rate"
	// SignalDeleteBurst fires when delete/rewrite operations cluster into a
	// burst within the detection window (originals-destruction fingerprint).
	SignalDeleteBurst = "delete_burst"
)

// Severity levels for a persisted signal. A signal observed in isolation is a
// warning; corroboration across signal kinds within one window confirms the
// anomaly and triggers curation of the clean recovery point.
const (
	SeverityWarning   = "warning"
	SeverityConfirmed = "confirmed"
)

// ValidSignalKind reports whether kind is one of the defined signal kinds.
func ValidSignalKind(kind string) bool {
	switch kind {
	case SignalEntropy, SignalByteRate, SignalChangeRate, SignalDeleteBurst:
		return true
	default:
		return false
	}
}

// Baseline is the persisted per-stream learned steady-state for the EWMA rate
// detectors. It is a row in dr_ransomware_baselines; the detector restores from
// it on startup and writes it back as it learns, so a restart does not lose the
// baseline and re-trigger on normal traffic.
type Baseline struct {
	TenantID string `json:"tenant_id"`
	StreamID string `json:"stream_id"`

	// ByteRateMean / ByteRateVar are the EWMA mean and variance of bytes/sec.
	ByteRateMean float64 `json:"byte_rate_mean"`
	ByteRateVar  float64 `json:"byte_rate_var"`
	// ChangeRateMean / ChangeRateVar are the EWMA mean and variance of
	// changes (operations) per second.
	ChangeRateMean float64 `json:"change_rate_mean"`
	ChangeRateVar  float64 `json:"change_rate_var"`
	// EntropyMean / EntropyVar are the EWMA mean and variance of the sampled
	// payload entropy (bits/byte), used to express an entropy jump in stddevs.
	EntropyMean float64 `json:"entropy_mean"`
	EntropyVar  float64 `json:"entropy_var"`

	// Samples is the number of windows folded into the baseline.
	Samples uint64 `json:"samples"`

	UpdatedAt time.Time `json:"updated_at"`
}

// Signal is a persisted ransomware early-warning signal — a row in
// dr_ransomware_signals and the body of the dr.ransomware.suspected event.
type Signal struct {
	ID       string `json:"id"`
	TenantID string `json:"tenant_id"`
	StreamID string `json:"stream_id"`
	// Kind is one of the Signal* constants.
	Kind string `json:"kind"`
	// Severity is warning or confirmed.
	Severity string `json:"severity"`

	// Observed is the live measurement that tripped the detector (entropy in
	// bits/byte, or a rate in units/sec, or a burst count).
	Observed float64 `json:"observed"`
	// Baseline is the learned steady-state the observation is compared against
	// (the EWMA mean for rate signals; the high-entropy threshold for entropy).
	Baseline float64 `json:"baseline"`
	// Ratio is observed/baseline for rate signals (0 when not applicable).
	Ratio float64 `json:"ratio"`
	// Threshold is the configured trip threshold the observation crossed.
	Threshold float64 `json:"threshold"`

	// SampleSeq is the Frame.Seq of the last frame folded into the window that
	// produced the signal, anchoring it to a position in the change stream.
	SampleSeq uint64 `json:"sample_seq"`
	// SourceLSN is the last source LSN seen in the window (the recovery
	// coordinate just past the clean boundary).
	SourceLSN string `json:"source_lsn,omitempty"`

	// CuratedRecoveryPointID is the last-known-clean recovery point that was
	// pinned (legal-held) in response to a confirmed anomaly, when one was
	// available. Empty for warning-level signals or when no clean point existed.
	CuratedRecoveryPointID string `json:"curated_recovery_point_id,omitempty"`

	// Detail is a human-readable explanation for the signals timeline.
	Detail string `json:"detail"`

	ObservedAt time.Time `json:"observed_at"`
	CreatedAt  time.Time `json:"created_at"`
}
