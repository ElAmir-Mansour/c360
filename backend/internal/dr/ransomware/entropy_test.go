package ransomware

import (
	"bytes"
	"crypto/rand"
	"math"
	"testing"
)

func TestShannonEntropy(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		data    []byte
		wantMin float64
		wantMax float64
	}{
		{
			name:    "empty is zero",
			data:    nil,
			wantMin: 0,
			wantMax: 0,
		},
		{
			name:    "single repeated byte is zero",
			data:    bytes.Repeat([]byte{0x41}, 4096),
			wantMin: 0,
			wantMax: 0.0001,
		},
		{
			name:    "two equiprobable values is one bit",
			data:    twoValuePattern(4096),
			wantMin: 0.999,
			wantMax: 1.0001,
		},
		{
			name:    "all 256 byte values uniformly is eight bits",
			data:    allBytesUniform(256 * 16),
			wantMin: 7.999,
			wantMax: 8.0001,
		},
		{
			name:    "english-like text is moderate",
			data:    []byte("the quick brown fox jumps over the lazy dog the quick brown fox jumps over the lazy dog"),
			wantMin: 3.5,
			wantMax: 4.8,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := ShannonEntropy(tc.data)
			if got < tc.wantMin || got > tc.wantMax {
				t.Fatalf("ShannonEntropy = %.6f, want in [%.4f, %.4f]", got, tc.wantMin, tc.wantMax)
			}
			if got < 0 || got > 8 {
				t.Fatalf("entropy %.6f out of [0,8]", got)
			}
		})
	}
}

func TestShannonEntropy_CiphertextIsHigh(t *testing.T) {
	t.Parallel()
	// Cryptographically random bytes (the shape of AES-GCM output) must measure
	// near the 8.0 ceiling — the core fact the entropy detector relies on.
	buf := make([]byte, 64*1024)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand: %v", err)
	}
	got := ShannonEntropy(buf)
	if got < 7.9 {
		t.Fatalf("random-bytes entropy = %.4f, want >= 7.9", got)
	}
}

func TestShannonEntropy_PlaintextBelowCiphertext(t *testing.T) {
	t.Parallel()
	plain := bytes.Repeat([]byte(`{"id":1,"name":"alice","active":true}`), 200)
	cipher := make([]byte, len(plain))
	if _, err := rand.Read(cipher); err != nil {
		t.Fatalf("rand: %v", err)
	}
	hp := ShannonEntropy(plain)
	hc := ShannonEntropy(cipher)
	if !(hp < hc) {
		t.Fatalf("expected plaintext entropy %.4f < ciphertext entropy %.4f", hp, hc)
	}
	if hc-hp < 2.0 {
		t.Fatalf("ciphertext entropy %.4f should clearly exceed plaintext %.4f (gap %.4f)", hc, hp, hc-hp)
	}
}

func TestEWMA_SeedsOnFirstSample(t *testing.T) {
	t.Parallel()
	e := NewEWMA(0.3)
	if e.Initialized() {
		t.Fatal("EWMA should not be initialized before first Update")
	}
	if got := e.Update(100); got != 100 {
		t.Fatalf("first Update should seed the mean to the sample, got %.4f", got)
	}
	if !e.Initialized() || e.Samples() != 1 {
		t.Fatalf("after first Update: initialized=%v samples=%d", e.Initialized(), e.Samples())
	}
	if e.Variance() != 0 {
		t.Fatalf("variance after one sample should be 0, got %.6f", e.Variance())
	}
}

func TestEWMA_ConvergesToConstant(t *testing.T) {
	t.Parallel()
	e := NewEWMA(0.5)
	for i := 0; i < 100; i++ {
		e.Update(42)
	}
	if math.Abs(e.Mean()-42) > 1e-9 {
		t.Fatalf("EWMA of a constant should converge to it, got %.9f", e.Mean())
	}
	if e.Variance() > 1e-9 {
		t.Fatalf("variance of a constant stream should be ~0, got %.9f", e.Variance())
	}
}

func TestEWMA_TracksStepChange(t *testing.T) {
	t.Parallel()
	// alpha controls responsiveness: a larger alpha moves the mean farther toward
	// a new level in one step. Verify the recursion mean += alpha*(x-mean).
	e := NewEWMA(0.4)
	e.Update(10) // seed
	got := e.Update(20)
	want := 10 + 0.4*(20-10) // 14
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("EWMA step: got %.9f, want %.9f", got, want)
	}
	// A sustained higher level pulls the mean up over successive samples.
	for i := 0; i < 50; i++ {
		e.Update(20)
	}
	if math.Abs(e.Mean()-20) > 1e-6 {
		t.Fatalf("EWMA should converge to the new level 20, got %.6f", e.Mean())
	}
}

func TestEWMA_VarianceGrowsWithDispersion(t *testing.T) {
	t.Parallel()
	steady := NewEWMA(0.3)
	noisy := NewEWMA(0.3)
	for i := 0; i < 200; i++ {
		steady.Update(100)
		if i%2 == 0 {
			noisy.Update(50)
		} else {
			noisy.Update(150)
		}
	}
	if noisy.Variance() <= steady.Variance() {
		t.Fatalf("dispersed stream variance %.4f should exceed steady %.4f", noisy.Variance(), steady.Variance())
	}
	if noisy.StdDev() <= 0 {
		t.Fatalf("noisy stddev should be positive, got %.6f", noisy.StdDev())
	}
}

func TestEWMA_RestoreResumesBaseline(t *testing.T) {
	t.Parallel()
	e := NewEWMA(0.3)
	e.Restore(500, 25, 10)
	if !e.Initialized() || e.Mean() != 500 || e.Samples() != 10 {
		t.Fatalf("Restore: mean=%.2f samples=%d initialized=%v", e.Mean(), e.Samples(), e.Initialized())
	}
	// The next Update must blend (not reseed): 500 + 0.3*(600-500) = 530.
	got := e.Update(600)
	if math.Abs(got-530) > 1e-9 {
		t.Fatalf("after Restore the next Update should blend, got %.9f want 530", got)
	}
}

func TestEWMA_IgnoresNaNAndInf(t *testing.T) {
	t.Parallel()
	e := NewEWMA(0.3)
	e.Update(100)
	e.Update(math.NaN())
	e.Update(math.Inf(1))
	if e.Mean() != 100 {
		t.Fatalf("NaN/Inf samples must be ignored, mean=%.4f", e.Mean())
	}
}

func TestEWMA_DefaultsInvalidAlpha(t *testing.T) {
	t.Parallel()
	for _, a := range []float64{0, -1, 2, math.NaN()} {
		e := NewEWMA(a)
		// A defaulted alpha must still produce a working blend.
		e.Update(10)
		got := e.Update(20)
		if got <= 10 || got >= 20 {
			t.Fatalf("defaulted alpha %.2f produced bad blend %.4f", a, got)
		}
	}
}

func TestSpikeRatio(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		observed float64
		baseline float64
		floor    float64
		want     float64
	}{
		{"5x spike", 500, 100, 10, 5},
		{"idle baseline below floor suppressed", 1000, 5, 10, 0},
		{"zero baseline suppressed", 1000, 0, 10, 0},
		{"non-positive observed suppressed", 0, 100, 10, 0},
		{"exact baseline is 1x", 100, 100, 10, 1},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := SpikeRatio(tc.observed, tc.baseline, tc.floor)
			if math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("SpikeRatio(%.0f,%.0f,%.0f) = %.4f, want %.4f", tc.observed, tc.baseline, tc.floor, got, tc.want)
			}
		})
	}
}

// --- test data helpers ----------------------------------------------------

func twoValuePattern(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		if i%2 == 0 {
			b[i] = 0x00
		} else {
			b[i] = 0xFF
		}
	}
	return b
}

func allBytesUniform(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i % 256)
	}
	return b
}
