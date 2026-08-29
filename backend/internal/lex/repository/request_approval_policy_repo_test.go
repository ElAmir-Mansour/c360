package repository

import (
	"strings"
	"testing"
)

// currencyClauseMatches mirrors the SQL currency predicate embedded in
// recommendPolicyQuery — `($7 = ” OR currency = ” OR currency = $7)` — as a pure
// Go oracle. $7 is bound from strings.ToUpper(strings.TrimSpace(candidate.Currency)).
// The oracle lets us assert the required truth table without a live Postgres.
func currencyClauseMatches(policyCurrency, candidateCurrency string) bool {
	c := strings.ToUpper(strings.TrimSpace(candidateCurrency)) // $7
	return c == "" || policyCurrency == "" || policyCurrency == c
}

// TestRecommendQueryCurrencyClauseRelaxed locks in the fix at the SQL level: an
// UNSPECIFIED candidate currency ($7 = ”) must NOT filter on currency. Before the
// fix the clause was `(currency = ” OR currency = $7)`, which excluded every
// SAR-defaulted policy for a currency-less approval-start candidate. This assertion
// fails against the old query and passes against the fixed one.
func TestRecommendQueryCurrencyClauseRelaxed(t *testing.T) {
	const relaxed = "($7 = '' OR currency = '' OR currency = $7)"
	if !strings.Contains(recommendPolicyQuery, relaxed) {
		t.Fatalf("recommendPolicyQuery missing relaxed currency clause %q; got:\n%s", relaxed, recommendPolicyQuery)
	}
	// Guard against a silent regression back to the currency-only clause that never
	// matched a currency-less candidate.
	if strings.Contains(recommendPolicyQuery, "AND (currency = '' OR currency = $7)") {
		t.Fatal("recommendPolicyQuery still contains the un-relaxed currency clause")
	}
}

// TestRecommendCurrencyPredicateTruthTable proves the required matching semantics,
// including the regressions that MUST still hold.
func TestRecommendCurrencyPredicateTruthTable(t *testing.T) {
	cases := []struct {
		name           string
		policyCurrency string
		candidateCurr  string
		wantMatch      bool
	}{
		// (a) empty candidate currency matches a SAR-scoped policy — the core bug fix.
		{"empty candidate matches SAR policy", "SAR", "", true},
		// empty candidate matches a currency-agnostic policy too.
		{"empty candidate matches empty policy", "", "", true},
		// empty candidate matches any currency-scoped policy.
		{"empty candidate matches USD policy", "USD", "", true},
		// SAR candidate matches SAR policy.
		{"SAR candidate matches SAR policy", "SAR", "SAR", true},
		// SAR candidate matches currency-agnostic policy.
		{"SAR candidate matches empty policy", "", "SAR", true},
		// candidate currency is normalized (trim + upper) before comparison.
		{"lowercase padded candidate matches SAR policy", "SAR", "  sar ", true},
		// (b) mismatched explicit candidate currency is STILL excluded (regression guard).
		{"SAR candidate excluded from USD policy", "USD", "SAR", false},
		{"USD candidate excluded from SAR policy", "SAR", "USD", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := currencyClauseMatches(tc.policyCurrency, tc.candidateCurr)
			if got != tc.wantMatch {
				t.Fatalf("currencyClauseMatches(policy=%q, candidate=%q) = %v, want %v",
					tc.policyCurrency, tc.candidateCurr, got, tc.wantMatch)
			}
		})
	}
}
