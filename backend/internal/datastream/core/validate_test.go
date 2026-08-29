package core

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestRowHash_Deterministic(t *testing.T) {
	t.Parallel()
	row := []byte("id=1,name=alpha,amount=100.00")
	got := RowHash(row)

	sum := sha256.Sum256(row)
	want := hex.EncodeToString(sum[:])
	if got != want {
		t.Fatalf("RowHash = %s, want %s", got, want)
	}
	// Stable across calls.
	if RowHash(row) != got {
		t.Fatal("RowHash is not deterministic")
	}
	// Different input -> different hash.
	if RowHash([]byte("id=2")) == got {
		t.Fatal("distinct rows hashed to the same value")
	}
}

func TestMatchRatio(t *testing.T) {
	t.Parallel()
	cases := []struct {
		matched, total int
		want           float64
	}{
		{matched: 999, total: 1000, want: 0.999},
		{matched: 1000, total: 1000, want: 1.0},
		{matched: 0, total: 0, want: 0.0}, // nothing verified -> conservative 0
		{matched: 500, total: 1000, want: 0.5},
	}
	for _, tc := range cases {
		if got := MatchRatio(tc.matched, tc.total); got != tc.want {
			t.Errorf("MatchRatio(%d,%d) = %v, want %v", tc.matched, tc.total, got, tc.want)
		}
	}
}

func TestNewValidation_AndThreshold(t *testing.T) {
	t.Parallel()

	pass := NewValidation(9990, 10000, "")
	if !pass.Passed() {
		t.Errorf("expected 9990/10000 (%.4f) to pass threshold %.3f", pass.MatchRatio, ValidationThreshold)
	}
	if pass.Mismatches != 10 {
		t.Errorf("Mismatches = %d, want 10", pass.Mismatches)
	}
	if pass.Checks != 10000 {
		t.Errorf("Checks = %d, want 10000", pass.Checks)
	}

	fail := NewValidation(9980, 10000, "drift detected")
	if fail.Passed() {
		t.Errorf("expected 9980/10000 (%.4f) to fail threshold", fail.MatchRatio)
	}
	if fail.Details != "drift detected" {
		t.Errorf("Details not preserved: %q", fail.Details)
	}
}
