package journal

import "testing"

func TestCompareLSN_PostgresHexForm(t *testing.T) {
	t.Parallel()
	tests := []struct {
		a, b string
		want int
	}{
		// Numeric, NOT lexical: 0/A (10) < 0/10 (16).
		{"0/A", "0/10", -1},
		{"0/10", "0/A", 1},
		{"0/64", "0/64", 0},
		// High word dominates: 1/0 (2^64) > 0/FFFFFFFF.
		{"1/0", "0/FFFFFFFF", 1},
		{"0/FFFFFFFF", "1/0", -1},
		// Equal.
		{"0/16B6248", "0/16B6248", 0},
	}
	for _, tt := range tests {
		if got := CompareLSN(tt.a, tt.b); got != tt.want {
			t.Errorf("CompareLSN(%q,%q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestCompareLSN_DecimalForm(t *testing.T) {
	t.Parallel()
	// Plain decimal cursors compared numerically (9 < 10, not lexical).
	if CompareLSN("9", "10") != -1 {
		t.Error("CompareLSN(9,10) should be -1 (numeric)")
	}
	if CompareLSN("100", "100") != 0 {
		t.Error("CompareLSN(100,100) should be 0")
	}
}

func TestCompareLSN_Empty(t *testing.T) {
	t.Parallel()
	if CompareLSN("", "0/1") != -1 {
		t.Error("empty LSN should sort first")
	}
	if CompareLSN("0/1", "") != 1 {
		t.Error("non-empty LSN should sort after empty")
	}
	if CompareLSN("", "") != 0 {
		t.Error("two empty LSNs should be equal")
	}
}

func TestCompareLSN_LexicalFallback(t *testing.T) {
	t.Parallel()
	// Non-numeric, fixed-width opaque cursors fall back to lexical comparison,
	// which is correct for zero-padded keys.
	if CompareLSN("file:000010", "file:000009") <= 0 {
		t.Error("lexical fallback ordering wrong")
	}
}
