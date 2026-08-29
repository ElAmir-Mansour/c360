package ransomware

import (
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

// WAL-frame payload operation bytes. The replication core encodes each
// FrameKindWAL payload with a leading operation byte (see
// internal/datastream/core/capture_pg.go): 1=upsert, 2=delete, 3=truncate. The
// detector reads only this first byte to classify destructive operations; it
// never decodes the row body, so it is cheap and decoder-agnostic.
const (
	walOpUpsert   = 1
	walOpDelete   = 2
	walOpTruncate = 3
)

// Config tunes the detector's thresholds. Zero values fall back to the
// production defaults in DefaultConfig so a partially-specified Config is valid.
type Config struct {
	// Window is the aggregation window: frames are folded into per-stream
	// windows of this wall-clock duration, and rates are computed per window.
	Window time.Duration
	// EWMAAlpha is the smoothing factor for the per-stream rate baselines.
	EWMAAlpha float64

	// EntropyThreshold is the bits/byte at or above which sampled changed
	// payload is treated as high-entropy (likely ciphertext). 7.5 of the 8.0
	// ceiling catches AES output while tolerating dense-but-structured data.
	EntropyThreshold float64
	// EntropySampleBytes caps how many payload bytes are sampled per frame for
	// the entropy estimate, bounding CPU on large WAL records.
	EntropySampleBytes int
	// MinEntropySamples is the minimum number of sampled frames in a window
	// before an entropy signal can fire (avoids a single odd frame tripping it).
	MinEntropySamples int

	// SpikeMultiple is how many times the live byte/change rate must exceed the
	// EWMA baseline to fire a rate signal.
	SpikeMultiple float64
	// MinBaselineSamples is the number of learned windows required before rate
	// spikes are evaluated (the baseline must be warm).
	MinBaselineSamples uint64
	// ByteRateFloor / ChangeRateFloor are the minimum baseline means below which
	// a stream is treated as idle and rate spikes are suppressed (a near-zero
	// baseline would otherwise manufacture an enormous ratio from one frame).
	ByteRateFloor   float64
	ChangeRateFloor float64

	// DeleteBurstThreshold is the count of delete/truncate operations within a
	// window that constitutes a destructive burst.
	DeleteBurstThreshold int

	// ConfirmSignals is the number of distinct signal kinds that must fire in a
	// single window to confirm an anomaly (and curate the clean recovery point).
	ConfirmSignals int
}

// DefaultConfig returns the production detector thresholds.
func DefaultConfig() Config {
	return Config{
		Window:               10 * time.Second,
		EWMAAlpha:            0.3,
		EntropyThreshold:     7.5,
		EntropySampleBytes:   4096,
		MinEntropySamples:    4,
		SpikeMultiple:        5.0,
		MinBaselineSamples:   3,
		ByteRateFloor:        64,
		ChangeRateFloor:      0.5,
		DeleteBurstThreshold: 50,
		ConfirmSignals:       2,
	}
}

func (c Config) withDefaults() Config {
	d := DefaultConfig()
	if c.Window <= 0 {
		c.Window = d.Window
	}
	if !(c.EWMAAlpha > 0) || c.EWMAAlpha > 1 {
		c.EWMAAlpha = d.EWMAAlpha
	}
	if c.EntropyThreshold <= 0 || c.EntropyThreshold > 8 {
		c.EntropyThreshold = d.EntropyThreshold
	}
	if c.EntropySampleBytes <= 0 {
		c.EntropySampleBytes = d.EntropySampleBytes
	}
	if c.MinEntropySamples <= 0 {
		c.MinEntropySamples = d.MinEntropySamples
	}
	if c.SpikeMultiple <= 1 {
		c.SpikeMultiple = d.SpikeMultiple
	}
	if c.MinBaselineSamples == 0 {
		c.MinBaselineSamples = d.MinBaselineSamples
	}
	if c.ByteRateFloor <= 0 {
		c.ByteRateFloor = d.ByteRateFloor
	}
	if c.ChangeRateFloor <= 0 {
		c.ChangeRateFloor = d.ChangeRateFloor
	}
	if c.DeleteBurstThreshold <= 0 {
		c.DeleteBurstThreshold = d.DeleteBurstThreshold
	}
	if c.ConfirmSignals <= 0 {
		c.ConfirmSignals = d.ConfirmSignals
	}
	return c
}

// window accumulates frame statistics for one stream over the current interval.
type window struct {
	start      time.Time
	end        time.Time // latest frame time observed
	changes    int       // count of change operations (WAL records + deltas)
	deletes    int       // count of delete/truncate operations
	bytes      int64     // total payload bytes
	entropySum float64   // sum of per-frame sampled entropy
	entropyN   int       // count of frames contributing to entropySum
	entropyMax float64   // peak per-frame entropy in the window
	lastSeq    uint64    // last frame Seq folded in
	lastLSN    string    // last source LSN folded in
}

// duration returns the wall-clock span the window covers, never below 1s so a
// per-second rate is well defined for a single tightly-packed batch.
func (w *window) duration() float64 {
	d := w.end.Sub(w.start).Seconds()
	if d < 1 {
		return 1
	}
	return d
}

// streamState is the detector's per-stream running state.
type streamState struct {
	byteRate   *EWMA
	changeRate *EWMA
	entropy    *EWMA
	cur        *window
}

// Detection is the detector's per-window verdict for one stream. It is a pure
// value; the monitor decides what to persist and whether to curate.
type Detection struct {
	StreamID  string
	TenantID  string
	WindowEnd time.Time
	LastSeq   uint64
	LastLSN   string

	// Signals are the individual fingerprints that fired this window.
	Signals []Signal
	// Confirmed is true when at least Config.ConfirmSignals distinct kinds
	// fired — the trigger to curate the last-known-clean recovery point.
	Confirmed bool

	// MeanEntropy is the window's mean sampled entropy (for the metric/gauge).
	MeanEntropy float64
}

// Detector is the stateful streaming detector. It is safe for concurrent use:
// a single goroutine usually drives Observe per stream, but the per-stream maps
// are guarded so the HTTP/metrics readers and the apply path can coexist.
type Detector struct {
	cfg Config

	mu      sync.Mutex
	streams map[string]*streamState
}

// NewDetector constructs a Detector with cfg (defaults applied for zero fields).
func NewDetector(cfg Config) *Detector {
	return &Detector{
		cfg:     cfg.withDefaults(),
		streams: make(map[string]*streamState),
	}
}

// Config returns the effective (defaulted) configuration.
func (d *Detector) Config() Config { return d.cfg }

// RestoreBaseline seeds a stream's EWMA baselines from a persisted Baseline so
// the detector resumes its learned steady-state after a restart. Safe to call
// before any Observe for the stream.
func (d *Detector) RestoreBaseline(b Baseline) {
	if b.StreamID == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	st := d.stateLocked(b.TenantID, b.StreamID)
	st.byteRate.Restore(b.ByteRateMean, b.ByteRateVar, b.Samples)
	st.changeRate.Restore(b.ChangeRateMean, b.ChangeRateVar, b.Samples)
	st.entropy.Restore(b.EntropyMean, b.EntropyVar, b.Samples)
}

// SnapshotBaseline returns the current learned baseline for a stream for
// persistence. ok is false when the stream is unknown.
func (d *Detector) SnapshotBaseline(tenantID, streamID string) (Baseline, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.streams[streamID]
	if !ok {
		return Baseline{}, false
	}
	return Baseline{
		TenantID:       tenantID,
		StreamID:       streamID,
		ByteRateMean:   st.byteRate.Mean(),
		ByteRateVar:    st.byteRate.Variance(),
		ChangeRateMean: st.changeRate.Mean(),
		ChangeRateVar:  st.changeRate.Variance(),
		EntropyMean:    st.entropy.Mean(),
		EntropyVar:     st.entropy.Variance(),
		Samples:        st.byteRate.Samples(),
		UpdatedAt:      time.Now().UTC(),
	}, true
}

func (d *Detector) stateLocked(tenantID, streamID string) *streamState {
	st, ok := d.streams[streamID]
	if !ok {
		st = &streamState{
			byteRate:   NewEWMA(d.cfg.EWMAAlpha),
			changeRate: NewEWMA(d.cfg.EWMAAlpha),
			entropy:    NewEWMA(d.cfg.EWMAAlpha),
		}
		d.streams[streamID] = st
	}
	return st
}

// Observe folds one frame into the detector. It returns a non-nil Detection
// only when the frame closes a window (its EmittedAt advanced past the current
// window's end by Config.Window) — that is when rates and signals are computed.
// Pass tenantID so a fired signal/curation is tenant-scoped. A frame with a
// zero EmittedAt is stamped with now so wall-clock windows still progress.
func (d *Detector) Observe(tenantID string, f core.Frame, now time.Time) *Detection {
	d.mu.Lock()
	defer d.mu.Unlock()

	ft := f.EmittedAt
	if ft.IsZero() {
		ft = now
	}
	ft = ft.UTC()

	st := d.stateLocked(tenantID, f.StreamID)

	var out *Detection
	if st.cur != nil && ft.Sub(st.cur.start) >= d.cfg.Window {
		// The incoming frame belongs to a new window: close and evaluate the
		// current one first, then start a fresh window with this frame.
		out = d.closeWindowLocked(tenantID, f.StreamID, st)
	}
	if st.cur == nil {
		st.cur = &window{start: ft, end: ft}
	}

	d.foldLocked(st.cur, f, ft)
	return out
}

// foldLocked accumulates a single frame into the open window.
func (d *Detector) foldLocked(w *window, f core.Frame, ft time.Time) {
	if ft.After(w.end) {
		w.end = ft
	}
	w.lastSeq = f.Seq
	if f.SourceLSN != "" {
		w.lastLSN = f.SourceLSN
	}
	w.bytes += int64(len(f.Payload))

	switch f.Kind {
	case core.FrameKindWAL, core.FrameKindFileDelta:
		w.changes++
		if isDestructive(f) {
			w.deletes++
		}
	case core.FrameKindSnapshotChunk:
		// Snapshot chunks are the SEED phase (bulk copy), not change activity;
		// they still contribute bytes/entropy but not a change-rate count.
	case core.FrameKindMarker:
		// Markers carry no data payload; ignored for rates and entropy.
		return
	}

	// Sample entropy on data-bearing frames. We sample up to
	// EntropySampleBytes; uniform random data has near-maximal entropy in any
	// representative sample, so a cap keeps the estimate cheap and faithful.
	if len(f.Payload) > 0 && (f.Kind == core.FrameKindWAL || f.Kind == core.FrameKindFileDelta || f.Kind == core.FrameKindSnapshotChunk) {
		sample := f.Payload
		if len(sample) > d.cfg.EntropySampleBytes {
			sample = sample[:d.cfg.EntropySampleBytes]
		}
		h := ShannonEntropy(sample)
		w.entropySum += h
		w.entropyN++
		if h > w.entropyMax {
			w.entropyMax = h
		}
	}
}

// Flush forces evaluation of a stream's open window (e.g. on shutdown or a
// periodic tick when frames stop arriving) and returns the Detection, or nil
// when there is no open window. It then clears the window so the next frame
// starts fresh; the EWMA baselines are retained.
func (d *Detector) Flush(tenantID, streamID string) *Detection {
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.streams[streamID]
	if !ok || st.cur == nil {
		return nil
	}
	return d.closeWindowLocked(tenantID, streamID, st)
}

// closeWindowLocked evaluates st.cur, updates the EWMA baselines with the
// window's observed rates, clears the window, and returns the Detection (nil
// when the window had no activity to evaluate).
func (d *Detector) closeWindowLocked(tenantID, streamID string, st *streamState) *Detection {
	w := st.cur
	st.cur = nil
	if w == nil {
		return nil
	}

	dur := w.duration()
	byteRate := float64(w.bytes) / dur
	changeRate := float64(w.changes) / dur
	meanEntropy := 0.0
	if w.entropyN > 0 {
		meanEntropy = w.entropySum / float64(w.entropyN)
	}

	det := &Detection{
		StreamID:    streamID,
		TenantID:    tenantID,
		WindowEnd:   w.end,
		LastSeq:     w.lastSeq,
		LastLSN:     w.lastLSN,
		MeanEntropy: meanEntropy,
	}

	// Evaluate against the PRE-update baseline so the spiking window is compared
	// to the steady-state it is departing from, not one already pulled upward by
	// its own values.
	baseByte := st.byteRate.Mean()
	baseChange := st.changeRate.Mean()
	warm := st.byteRate.Samples() >= d.cfg.MinBaselineSamples

	// --- Entropy signal ---------------------------------------------------
	if w.entropyN >= d.cfg.MinEntropySamples && meanEntropy >= d.cfg.EntropyThreshold {
		det.Signals = append(det.Signals, Signal{
			TenantID:   tenantID,
			StreamID:   streamID,
			Kind:       SignalEntropy,
			Observed:   meanEntropy,
			Baseline:   st.entropy.Mean(),
			Threshold:  d.cfg.EntropyThreshold,
			SampleSeq:  w.lastSeq,
			SourceLSN:  w.lastLSN,
			ObservedAt: w.end,
			Detail: fmt.Sprintf("mean payload entropy %.3f bits/byte over %d samples >= threshold %.2f (peak %.3f); bulk-encryption fingerprint",
				meanEntropy, w.entropyN, d.cfg.EntropyThreshold, w.entropyMax),
		})
	}

	// --- Byte-rate spike --------------------------------------------------
	if warm {
		if r := SpikeRatio(byteRate, baseByte, d.cfg.ByteRateFloor); r >= d.cfg.SpikeMultiple {
			det.Signals = append(det.Signals, Signal{
				TenantID:   tenantID,
				StreamID:   streamID,
				Kind:       SignalByteRate,
				Observed:   byteRate,
				Baseline:   baseByte,
				Ratio:      r,
				Threshold:  d.cfg.SpikeMultiple,
				SampleSeq:  w.lastSeq,
				SourceLSN:  w.lastLSN,
				ObservedAt: w.end,
				Detail: fmt.Sprintf("byte rate %.0f B/s is %.1fx baseline %.0f B/s (>= %.1fx); mass-rewrite fingerprint",
					byteRate, r, baseByte, d.cfg.SpikeMultiple),
			})
		}
		// --- Change-rate spike -------------------------------------------
		if r := SpikeRatio(changeRate, baseChange, d.cfg.ChangeRateFloor); r >= d.cfg.SpikeMultiple {
			det.Signals = append(det.Signals, Signal{
				TenantID:   tenantID,
				StreamID:   streamID,
				Kind:       SignalChangeRate,
				Observed:   changeRate,
				Baseline:   baseChange,
				Ratio:      r,
				Threshold:  d.cfg.SpikeMultiple,
				SampleSeq:  w.lastSeq,
				SourceLSN:  w.lastLSN,
				ObservedAt: w.end,
				Detail: fmt.Sprintf("change rate %.2f ops/s is %.1fx baseline %.2f ops/s (>= %.1fx)",
					changeRate, r, baseChange, d.cfg.SpikeMultiple),
			})
		}
	}

	// --- Delete/rewrite burst --------------------------------------------
	if w.deletes >= d.cfg.DeleteBurstThreshold {
		det.Signals = append(det.Signals, Signal{
			TenantID:   tenantID,
			StreamID:   streamID,
			Kind:       SignalDeleteBurst,
			Observed:   float64(w.deletes),
			Baseline:   0,
			Threshold:  float64(d.cfg.DeleteBurstThreshold),
			SampleSeq:  w.lastSeq,
			SourceLSN:  w.lastLSN,
			ObservedAt: w.end,
			Detail: fmt.Sprintf("%d delete/truncate operations in %ds window >= %d; originals-destruction fingerprint",
				w.deletes, int(math.Round(dur)), d.cfg.DeleteBurstThreshold),
		})
	}

	// Confirmation: distinct signal kinds corroborating within one window.
	kinds := map[string]struct{}{}
	for _, s := range det.Signals {
		kinds[s.Kind] = struct{}{}
	}
	det.Confirmed = len(kinds) >= d.cfg.ConfirmSignals
	severity := SeverityWarning
	if det.Confirmed {
		severity = SeverityConfirmed
	}
	for i := range det.Signals {
		det.Signals[i].Severity = severity
	}
	// Stable ordering for deterministic persistence/tests.
	sort.SliceStable(det.Signals, func(i, j int) bool {
		return det.Signals[i].Kind < det.Signals[j].Kind
	})

	// Fold this window's observed rates into the baselines AFTER evaluation so
	// the steady-state keeps learning (a sustained legitimately-high rate is
	// absorbed; a transient attack spike has already been flagged).
	st.byteRate.Update(byteRate)
	st.changeRate.Update(changeRate)
	if w.entropyN > 0 {
		st.entropy.Update(meanEntropy)
	}

	return det
}

// isDestructive reports whether a WAL frame's payload is a delete or truncate
// operation, read from the leading operation byte of the core's WAL wire format.
// File deltas carry their own delete encoding; a file-delta frame is treated as
// destructive when its first byte is the core's file delete op (3). For any
// other/unknown payload shape it returns false (counted as a plain change).
func isDestructive(f core.Frame) bool {
	if len(f.Payload) == 0 {
		return false
	}
	switch f.Kind {
	case core.FrameKindWAL:
		switch f.Payload[0] {
		case walOpDelete, walOpTruncate:
			return true
		}
	case core.FrameKindFileDelta:
		// core.capture_file encodes fileOpDelete as 3 in the first byte.
		if f.Payload[0] == fileDeltaDeleteOp {
			return true
		}
	}
	return false
}

// fileDeltaDeleteOp mirrors internal/datastream/core/capture_file.go's
// fileOpDelete (=3): a path removed at the source since the baseline.
const fileDeltaDeleteOp = 3
