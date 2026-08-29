// Package ransomware is ClarioDR's early-warning detector over the replication
// change stream (DESIGN_DataStream_DR.md, ClarioDR capability #3). It watches
// the same Frame stream the recovery pipeline applies and flags the statistical
// fingerprints of a ransomware event in flight:
//
//   - HIGH ENTROPY: bulk encryption turns ordinarily-compressible business data
//     (text, JSON, structured rows) into ciphertext that is statistically
//     indistinguishable from random. Real Shannon entropy over sampled changed
//     payload bytes climbs toward the 8.0 bits/byte ceiling as a stream flips
//     from plaintext to ciphertext.
//   - RATE SPIKES: mass rewrite drives the byte-rate (and change-rate) far above
//     a stream's learned steady-state. We keep a per-stream EWMA baseline of
//     bytes/second and changes/second and fire when the live rate exceeds the
//     baseline by a configurable multiple.
//   - DELETE/REWRITE BURSTS: ransomware deletes or overwrites the originals after
//     encrypting. A burst of WAL delete/rewrite operations within a short window
//     is the third corroborating signal.
//
// On a CONFIRMED anomaly the detector stages dr.ransomware.suspected to the
// transactional outbox and CURATES the last-known-clean recovery point (pins it
// via the recovery-point legal-hold path) so a clean restore target survives the
// attack. Detection is advisory and never blocks replication — the stream keeps
// flowing into the WORM store, which is itself ransomware-immutable.
//
// The entropy and EWMA primitives below are implemented from scratch on the
// standard library's math package; nothing here is a stub.
package ransomware

import "math"

// ShannonEntropy returns the Shannon entropy of data in bits per byte, in the
// range [0, 8]. It is computed over the empirical byte-value distribution:
//
//	H = -Σ p(b) · log2(p(b))   for each distinct byte value b in [0,255]
//
// Uniformly random bytes (e.g. AES-GCM ciphertext) approach 8.0; a constant or
// highly repetitive payload approaches 0.0. An empty slice has zero entropy by
// convention (no information). This is the real measure used to flag the
// plaintext->ciphertext transition of a ransomware encryption pass.
func ShannonEntropy(data []byte) float64 {
	if len(data) == 0 {
		return 0
	}
	var counts [256]int
	for _, b := range data {
		counts[b]++
	}
	n := float64(len(data))
	var h float64
	for _, c := range counts {
		if c == 0 {
			continue
		}
		p := float64(c) / n
		h -= p * math.Log2(p)
	}
	// Clamp tiny negative drift from floating-point rounding to exactly 0.
	if h < 0 {
		h = 0
	}
	return h
}

// EWMA is an exponentially weighted moving average baseline. It learns a
// stream's steady-state rate (bytes/sec or changes/sec) and lets the detector
// compare a live observation against the learned normal without storing a full
// history.
//
// The update rule is the standard:
//
//	avg_t = α · x_t + (1 - α) · avg_{t-1}
//
// where α (the smoothing factor) in (0,1] sets responsiveness: larger α reacts
// faster to recent samples, smaller α is steadier. The variance is tracked with
// the matching incremental EWMVar recursion so a spike can be expressed in
// standard deviations as well as in multiples of the mean.
type EWMA struct {
	alpha       float64 // smoothing factor in (0,1]
	mean        float64 // current EWMA mean
	variance    float64 // current EWMA variance (population, exponentially weighted)
	initialized bool    // false until the first Update seeds the baseline
	samples     uint64  // count of observations folded in
}

// NewEWMA constructs an EWMA with smoothing factor alpha. Alpha is clamped into
// (0,1]; a non-positive or NaN alpha defaults to 0.3, a sensible per-tick
// responsiveness for second-resolution rate baselines.
func NewEWMA(alpha float64) *EWMA {
	if !(alpha > 0) || alpha > 1 || math.IsNaN(alpha) {
		alpha = 0.3
	}
	return &EWMA{alpha: alpha}
}

// Update folds observation x into the baseline and returns the new mean. The
// first observation seeds the mean directly (no warm-up bias toward zero) so a
// stream with a genuinely high steady-state rate is not immediately flagged.
func (e *EWMA) Update(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return e.mean
	}
	if !e.initialized {
		e.mean = x
		e.variance = 0
		e.initialized = true
		e.samples = 1
		return e.mean
	}
	// West's incremental EWMA mean+variance recursion:
	//   diff      = x - mean
	//   incr      = α · diff
	//   mean     += incr
	//   variance  = (1 - α) · (variance + diff · incr)
	diff := x - e.mean
	incr := e.alpha * diff
	e.mean += incr
	e.variance = (1 - e.alpha) * (e.variance + diff*incr)
	e.samples++
	return e.mean
}

// Mean returns the current baseline mean.
func (e *EWMA) Mean() float64 { return e.mean }

// Variance returns the current exponentially-weighted variance.
func (e *EWMA) Variance() float64 {
	if e.variance < 0 {
		return 0
	}
	return e.variance
}

// StdDev returns the current exponentially-weighted standard deviation.
func (e *EWMA) StdDev() float64 { return math.Sqrt(e.Variance()) }

// Initialized reports whether the baseline has seen at least one observation.
func (e *EWMA) Initialized() bool { return e.initialized }

// Samples returns the number of observations folded into the baseline.
func (e *EWMA) Samples() uint64 { return e.samples }

// Restore seeds an EWMA from a persisted baseline so the detector resumes with
// the learned steady-state after a process restart. samples<1 is treated as a
// single seeding observation so the next Update blends rather than reseeds.
func (e *EWMA) Restore(mean, variance float64, samples uint64) {
	if math.IsNaN(mean) || math.IsInf(mean, 0) {
		return
	}
	e.mean = mean
	if variance < 0 || math.IsNaN(variance) || math.IsInf(variance, 0) {
		variance = 0
	}
	e.variance = variance
	if samples < 1 {
		samples = 1
	}
	e.samples = samples
	e.initialized = true
}

// SpikeRatio returns observed / baselineMean — how many times the live rate
// exceeds the learned steady-state. A baseline mean at or below floor (typically
// a small epsilon) returns 0 so a cold or near-idle stream cannot manufacture an
// infinite ratio from the first non-zero sample.
func SpikeRatio(observed, baselineMean, floor float64) float64 {
	if baselineMean <= floor || baselineMean <= 0 {
		return 0
	}
	if observed <= 0 {
		return 0
	}
	return observed / baselineMean
}
