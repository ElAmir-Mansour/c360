package ransomware

import (
	"bytes"
	"crypto/rand"
	"testing"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

const detTestStream = "cccccccc-0000-0000-0000-000000000001"
const detTestTenant = "aaaaaaaa-0000-0000-0000-000000000001"

// testConfig is a tight, deterministic config for the detector unit tests.
func testConfig() Config {
	return Config{
		Window:               1 * time.Second,
		EWMAAlpha:            0.3,
		EntropyThreshold:     7.5,
		EntropySampleBytes:   4096,
		MinEntropySamples:    2,
		SpikeMultiple:        5.0,
		MinBaselineSamples:   2,
		ByteRateFloor:        64,
		ChangeRateFloor:      0.5,
		DeleteBurstThreshold: 10,
		ConfirmSignals:       2,
	}
}

// walFrame builds a WAL change frame with op and payload of the given size of
// the supplied filler bytes (used to control entropy and byte volume).
func walFrame(seq uint64, op byte, body []byte, at time.Time) core.Frame {
	payload := append([]byte{op}, body...)
	return core.Frame{
		StreamID:  detTestStream,
		Seq:       seq,
		Kind:      core.FrameKindWAL,
		Payload:   payload,
		SourceLSN: "0/" + time.Duration(seq).String(),
		EmittedAt: at,
	}
}

func lowEntropyBody(n int) []byte {
	// Highly compressible / structured -> low entropy.
	return bytes.Repeat([]byte(`{"k":"v"}`), n)
}

func highEntropyBody(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return b
}

// collectDetections drives a sequence of frames through the detector and returns
// every non-nil Detection produced (one per closed window), plus a final flush.
func collectDetections(d *Detector, frames []core.Frame, now time.Time) []*Detection {
	var out []*Detection
	for _, f := range frames {
		if det := d.Observe(detTestTenant, f, now); det != nil {
			out = append(out, det)
		}
	}
	if det := d.Flush(detTestTenant, detTestStream); det != nil {
		out = append(out, det)
	}
	return out
}

func hasSignal(dets []*Detection, kind string) (Signal, bool) {
	for _, d := range dets {
		for _, s := range d.Signals {
			if s.Kind == kind {
				return s, true
			}
		}
	}
	return Signal{}, false
}

func anyConfirmed(dets []*Detection) bool {
	for _, d := range dets {
		if d.Confirmed {
			return true
		}
	}
	return false
}

// (a) A normal low-entropy steady stream must produce no signal.
func TestDetector_NormalStream_NoSignal(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	// 30 windows of steady, modest, low-entropy upsert activity.
	for w := 0; w < 30; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		for i := 0; i < 4; i++ { // 4 small changes per second
			frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(8), base.Add(time.Duration(i*100)*time.Millisecond)))
			seq++
		}
	}

	dets := collectDetections(d, frames, start)
	for _, det := range dets {
		if len(det.Signals) != 0 {
			t.Fatalf("steady low-entropy stream fired %d signals (first kind %q, detail %q)",
				len(det.Signals), det.Signals[0].Kind, det.Signals[0].Detail)
		}
		if det.Confirmed {
			t.Fatal("steady stream should never be confirmed")
		}
	}
}

// (b) Sudden high-entropy payloads must raise an entropy signal.
func TestDetector_HighEntropy_RaisesEntropySignal(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	// Warm the baseline with several normal windows first.
	for w := 0; w < 5; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		for i := 0; i < 4; i++ {
			frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(8), base.Add(time.Duration(i*100)*time.Millisecond)))
			seq++
		}
	}
	// Attack window: modest count but ciphertext payloads (encrypted blocks are
	// substantial; entropy estimation needs enough bytes to populate the byte
	// histogram, which is why ransomware's per-block encryption is detectable).
	attackBase := start.Add(6 * time.Second)
	for i := 0; i < 4; i++ {
		frames = append(frames, walFrame(seq, walOpUpsert, highEntropyBody(t, 4096), attackBase.Add(time.Duration(i*100)*time.Millisecond)))
		seq++
	}

	dets := collectDetections(d, frames, start)
	sig, ok := hasSignal(dets, SignalEntropy)
	if !ok {
		t.Fatalf("expected an entropy signal for ciphertext payloads; detections=%+v", dets)
	}
	if sig.Observed < d.Config().EntropyThreshold {
		t.Fatalf("entropy signal observed %.3f below threshold %.3f", sig.Observed, d.Config().EntropyThreshold)
	}
	if sig.Kind != SignalEntropy {
		t.Fatalf("kind = %q", sig.Kind)
	}
}

// (c) A byte-rate spike must raise a rate signal.
func TestDetector_ByteRateSpike_RaisesRateSignal(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	// Warm the baseline: a few small low-entropy upserts per second.
	for w := 0; w < 6; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		for i := 0; i < 2; i++ {
			frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(4), base.Add(time.Duration(i*100)*time.Millisecond)))
			seq++
		}
	}
	// Spike window: a single huge low-entropy payload (drives byte-rate up far
	// beyond baseline without raising entropy — isolates the rate detector).
	spikeBase := start.Add(7 * time.Second)
	frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(20000), spikeBase))
	seq++

	dets := collectDetections(d, frames, start)
	sig, ok := hasSignal(dets, SignalByteRate)
	if !ok {
		t.Fatalf("expected a byte_rate signal for the volume spike; detections=%+v", summarize(dets))
	}
	if sig.Ratio < d.Config().SpikeMultiple {
		t.Fatalf("byte_rate ratio %.2f below spike multiple %.2f", sig.Ratio, d.Config().SpikeMultiple)
	}
	// Entropy must NOT have fired for compressible bytes, proving signal isolation.
	if _, hasE := hasSignal(dets, SignalEntropy); hasE {
		t.Fatal("byte-rate spike of low-entropy data must not raise an entropy signal")
	}
}

// A delete/truncate burst must raise a delete_burst signal.
func TestDetector_DeleteBurst_RaisesSignal(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	burstBase := start.Add(1 * time.Second)
	for i := 0; i < 15; i++ { // 15 deletes in one window >= threshold 10
		op := byte(walOpDelete)
		if i%5 == 0 {
			op = byte(walOpTruncate)
		}
		frames = append(frames, walFrame(seq, op, lowEntropyBody(4), burstBase.Add(time.Duration(i*10)*time.Millisecond)))
		seq++
	}

	dets := collectDetections(d, frames, start)
	sig, ok := hasSignal(dets, SignalDeleteBurst)
	if !ok {
		t.Fatalf("expected a delete_burst signal; detections=%+v", summarize(dets))
	}
	if int(sig.Observed) < int(sig.Threshold) {
		t.Fatalf("delete_burst observed %.0f below threshold %.0f", sig.Observed, sig.Threshold)
	}
}

// A full ransomware-shaped window (high entropy + byte spike + delete burst)
// must be CONFIRMED (>= ConfirmSignals distinct kinds) with severity confirmed.
func TestDetector_FullAttack_Confirmed(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	// Warm baseline with quiet windows.
	for w := 0; w < 6; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(4), base))
		seq++
	}
	// Attack window: many large ciphertext writes plus deletes.
	attackBase := start.Add(7 * time.Second)
	for i := 0; i < 15; i++ {
		op := byte(walOpUpsert)
		if i%2 == 0 {
			op = byte(walOpDelete)
		}
		frames = append(frames, walFrame(seq, op, highEntropyBody(t, 2000), attackBase.Add(time.Duration(i)*time.Millisecond)))
		seq++
	}

	dets := collectDetections(d, frames, start)
	if !anyConfirmed(dets) {
		t.Fatalf("full ransomware-shaped window should be confirmed; detections=%+v", summarize(dets))
	}
	// Every signal in a confirmed window must be marked confirmed severity.
	for _, det := range dets {
		if det.Confirmed {
			for _, s := range det.Signals {
				if s.Severity != SeverityConfirmed {
					t.Fatalf("signal %q in confirmed window has severity %q", s.Kind, s.Severity)
				}
			}
		}
	}
}

// An entropy-only window (single signal kind) must remain a warning, not a
// confirmation, so a single noisy field cannot trigger curation.
func TestDetector_SingleSignal_NotConfirmed(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	// Warm baseline so rate baselines exist. Baseline payloads are the SAME size
	// (4096B) as the attack window so the byte/change rate does not spike; the
	// only thing that changes in the attack is the payload's randomness.
	for w := 0; w < 4; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		for i := 0; i < 4; i++ {
			frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(456), base.Add(time.Duration(i*100)*time.Millisecond)))
			seq++
		}
	}
	// One window of high-entropy but SAME count/size as baseline (no rate spike,
	// no deletes) -> entropy signal only.
	attackBase := start.Add(5 * time.Second)
	for i := 0; i < 4; i++ {
		frames = append(frames, walFrame(seq, walOpUpsert, highEntropyBody(t, 4096), attackBase.Add(time.Duration(i*100)*time.Millisecond)))
		seq++
	}

	dets := collectDetections(d, frames, start)
	if _, ok := hasSignal(dets, SignalEntropy); !ok {
		t.Fatalf("expected the entropy signal to fire; detections=%+v", summarize(dets))
	}
	if anyConfirmed(dets) {
		t.Fatalf("a single-kind signal window must not be confirmed; detections=%+v", summarize(dets))
	}
	if _, ok := hasSignal(dets, SignalByteRate); ok {
		t.Fatal("no byte-rate spike expected when size/count match baseline")
	}
}

// Markers carry no payload and must not contribute to rates/entropy.
func TestDetector_MarkerFramesIgnored(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	frames := []core.Frame{
		{StreamID: detTestStream, Seq: 1, Kind: core.FrameKindMarker, SourceLSN: "0/1", EmittedAt: start},
		{StreamID: detTestStream, Seq: 2, Kind: core.FrameKindMarker, SourceLSN: "0/2", EmittedAt: start.Add(2 * time.Second)},
	}
	dets := collectDetections(d, frames, start)
	for _, det := range dets {
		if len(det.Signals) != 0 {
			t.Fatalf("marker-only stream fired signals: %+v", det.Signals)
		}
	}
}

// The baseline snapshot/restore round-trips so a restart resumes learned state.
func TestDetector_BaselineSnapshotRestore(t *testing.T) {
	t.Parallel()
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	var frames []core.Frame
	seq := uint64(1)
	for w := 0; w < 8; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		for i := 0; i < 3; i++ {
			frames = append(frames, walFrame(seq, walOpUpsert, lowEntropyBody(16), base.Add(time.Duration(i*100)*time.Millisecond)))
			seq++
		}
	}
	collectDetections(d, frames, start)

	b, ok := d.SnapshotBaseline(detTestTenant, detTestStream)
	if !ok {
		t.Fatal("expected a baseline snapshot after observing frames")
	}
	if b.ByteRateMean <= 0 || b.ChangeRateMean <= 0 || b.Samples == 0 {
		t.Fatalf("baseline should be warm: %+v", b)
	}

	// A fresh detector restored from the snapshot must NOT immediately flag a
	// window whose rate matches the learned baseline.
	d2 := NewDetector(testConfig())
	d2.RestoreBaseline(b)
	var more []core.Frame
	mb := start.Add(20 * time.Second)
	for i := 0; i < 3; i++ {
		more = append(more, walFrame(seq, walOpUpsert, lowEntropyBody(16), mb.Add(time.Duration(i*100)*time.Millisecond)))
		seq++
	}
	dets := collectDetections(d2, more, start)
	for _, det := range dets {
		if _, ok := hasSignalIn(det, SignalByteRate); ok {
			t.Fatalf("restored baseline should suppress a same-rate window's spike: %+v", det.Signals)
		}
	}
}

func hasSignalIn(det *Detection, kind string) (Signal, bool) {
	for _, s := range det.Signals {
		if s.Kind == kind {
			return s, true
		}
	}
	return Signal{}, false
}

func summarize(dets []*Detection) []string {
	var out []string
	for _, d := range dets {
		for _, s := range d.Signals {
			out = append(out, s.Kind+":"+s.Detail)
		}
	}
	return out
}
