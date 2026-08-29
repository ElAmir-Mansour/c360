package journal

import (
	"math/big"
	"strings"
)

// CompareLSN orders two source LSN strings. It understands the common log-cursor
// shapes used by the GA capturers and falls back to a stable lexical order:
//
//   - PostgreSQL WAL LSNs "X/Y" (two hex segments) are compared as the 128-bit
//     value (X<<64)|Y, so "0/A" < "0/10" < "1/0" numerically (not lexically).
//   - Plain decimal/file-offset cursors are compared as big integers.
//   - Anything else is compared lexically (the documented fallback), which is
//     correct for zero-padded, fixed-width cursors.
//
// It returns -1, 0 or +1 like strings.Compare. Empty strings sort first.
func CompareLSN(a, b string) int {
	if a == b {
		return 0
	}
	if a == "" {
		return -1
	}
	if b == "" {
		return 1
	}
	av, aok := lsnValue(a)
	bv, bok := lsnValue(b)
	if aok && bok {
		return av.Cmp(bv)
	}
	// Mixed or unparseable: fall back to lexical, which is deterministic.
	return strings.Compare(a, b)
}

// lsnValue parses an LSN into a big.Int for numeric comparison. It handles the
// PostgreSQL "hi/lo" hex form and plain decimal cursors. ok is false when the
// string is not one of those numeric shapes.
func lsnValue(s string) (*big.Int, bool) {
	if slash := strings.IndexByte(s, '/'); slash >= 0 {
		hiStr := s[:slash]
		loStr := s[slash+1:]
		if hiStr == "" || loStr == "" {
			return nil, false
		}
		hi, ok := new(big.Int).SetString(hiStr, 16)
		if !ok {
			return nil, false
		}
		lo, ok := new(big.Int).SetString(loStr, 16)
		if !ok {
			return nil, false
		}
		// value = (hi << 64) | lo
		v := new(big.Int).Lsh(hi, 64)
		v.Or(v, lo)
		return v, true
	}
	// Plain decimal cursor (file offset / sequence number).
	if v, ok := new(big.Int).SetString(s, 10); ok {
		return v, true
	}
	return nil, false
}
