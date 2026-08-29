package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

func fp(v float64) *float64 { return &v }
func sp(v string) *string   { return &v }

func tp(s string) *time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return &t
}

func ct(v string) *model.ContractType {
	c := model.ContractType(v)
	return &c
}

func TestNumericRangesOverlap(t *testing.T) {
	cases := []struct {
		name                   string
		aMin, aMax, bMin, bMax *float64
		want                   bool
	}{
		{"both unbounded", nil, nil, nil, nil, true},
		{"disjoint a below b", fp(0), fp(10), fp(20), fp(30), false},
		{"disjoint a above b", fp(50), fp(60), fp(10), fp(20), false},
		{"touching at boundary", fp(0), fp(10), fp(10), fp(20), true},
		{"overlapping", fp(0), fp(15), fp(10), fp(20), true},
		{"a contains b", fp(0), fp(100), fp(10), fp(20), true},
		{"a open low overlaps", nil, fp(10), fp(5), fp(20), true},
		{"a open low disjoint", nil, fp(4), fp(5), fp(20), false},
		{"a open high overlaps", fp(15), nil, fp(5), fp(20), true},
		{"a open high disjoint", fp(25), nil, fp(5), fp(20), false},
		{"b unbounded both", fp(5), fp(10), nil, nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := numericRangesOverlap(tc.aMin, tc.aMax, tc.bMin, tc.bMax); got != tc.want {
				t.Fatalf("numericRangesOverlap = %v, want %v", got, tc.want)
			}
			// overlap is symmetric.
			if got := numericRangesOverlap(tc.bMin, tc.bMax, tc.aMin, tc.aMax); got != tc.want {
				t.Fatalf("numericRangesOverlap (swapped) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestTimeWindowsOverlap(t *testing.T) {
	cases := []struct {
		name                         string
		aFrom, aUntil, bFrom, bUntil *time.Time
		want                         bool
	}{
		{"both unbounded", nil, nil, nil, nil, true},
		{"disjoint a before b", tp("2026-01-01T00:00:00Z"), tp("2026-02-01T00:00:00Z"), tp("2026-03-01T00:00:00Z"), tp("2026-04-01T00:00:00Z"), false},
		{"touching boundary", tp("2026-01-01T00:00:00Z"), tp("2026-02-01T00:00:00Z"), tp("2026-02-01T00:00:00Z"), tp("2026-03-01T00:00:00Z"), true},
		{"overlapping", tp("2026-01-01T00:00:00Z"), tp("2026-02-15T00:00:00Z"), tp("2026-02-01T00:00:00Z"), tp("2026-03-01T00:00:00Z"), true},
		{"a open start overlaps", nil, tp("2026-02-15T00:00:00Z"), tp("2026-02-01T00:00:00Z"), nil, true},
		{"a open start disjoint", nil, tp("2026-01-15T00:00:00Z"), tp("2026-02-01T00:00:00Z"), nil, false},
		{"a open end overlaps", tp("2026-02-01T00:00:00Z"), nil, nil, tp("2026-02-15T00:00:00Z"), true},
		{"a open end disjoint", tp("2026-03-01T00:00:00Z"), nil, nil, tp("2026-02-15T00:00:00Z"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := timeWindowsOverlap(tc.aFrom, tc.aUntil, tc.bFrom, tc.bUntil); got != tc.want {
				t.Fatalf("timeWindowsOverlap = %v, want %v", got, tc.want)
			}
			if got := timeWindowsOverlap(tc.bFrom, tc.bUntil, tc.aFrom, tc.aUntil); got != tc.want {
				t.Fatalf("timeWindowsOverlap (swapped) = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCategoriesOverlap(t *testing.T) {
	cases := []struct {
		name string
		a, b *string
		want bool
	}{
		{"both any", nil, nil, true},
		{"a any", nil, sp("Finance"), true},
		{"b any", sp("Finance"), nil, true},
		{"equal", sp("Finance"), sp("Finance"), true},
		{"equal case-insensitive", sp("finance"), sp("FINANCE"), true},
		{"different", sp("Finance"), sp("Legal"), false},
		{"empty string treated as any", sp("  "), sp("Legal"), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := categoriesOverlap(tc.a, tc.b); got != tc.want {
				t.Fatalf("categoriesOverlap = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestScopesOverlap_AllDimensionsANDed(t *testing.T) {
	base := approvalPolicyScope{
		ContractType: ct("nda"),
		Department:   sp("Legal"),
		MinValue:     fp(0),
		MaxValue:     fp(100),
		ValidFrom:    tp("2026-01-01T00:00:00Z"),
		ValidUntil:   tp("2026-12-31T00:00:00Z"),
	}

	// Identical scope overlaps.
	if !scopesOverlap(base, base) {
		t.Fatalf("identical scope must overlap")
	}

	// Different contract type breaks overlap even when everything else matches.
	other := base
	other.ContractType = ct("msa")
	if scopesOverlap(base, other) {
		t.Fatalf("different contract type must not overlap")
	}

	// Disjoint value range breaks overlap.
	other = base
	other.MinValue = fp(200)
	other.MaxValue = fp(300)
	if scopesOverlap(base, other) {
		t.Fatalf("disjoint value range must not overlap")
	}

	// Disjoint window breaks overlap.
	other = base
	other.ValidFrom = tp("2027-01-01T00:00:00Z")
	other.ValidUntil = tp("2027-12-31T00:00:00Z")
	if scopesOverlap(base, other) {
		t.Fatalf("disjoint window must not overlap")
	}

	// Department "any" on one side still overlaps.
	other = base
	other.Department = nil
	if !scopesOverlap(base, other) {
		t.Fatalf("any-department must overlap")
	}
}

func TestScopesIdentical(t *testing.T) {
	base := approvalPolicyScope{
		ContractType: ct("nda"),
		Department:   sp("Legal"),
		MinValue:     fp(0),
		MaxValue:     fp(100),
		ValidFrom:    tp("2026-01-01T00:00:00Z"),
		ValidUntil:   tp("2026-12-31T00:00:00Z"),
	}
	same := base
	if !scopesIdentical(base, same) {
		t.Fatalf("identical scopes must compare equal")
	}
	// Case-insensitive department still identical.
	caseDiff := base
	caseDiff.Department = sp("legal")
	if !scopesIdentical(base, caseDiff) {
		t.Fatalf("case-insensitive department must be identical")
	}
	// Overlapping-but-not-equal value range is NOT identical.
	overlap := base
	overlap.MaxValue = fp(150)
	if scopesIdentical(base, overlap) {
		t.Fatalf("overlapping-but-distinct range must not be identical")
	}
	if !scopesOverlap(base, overlap) {
		t.Fatalf("the same range should still overlap")
	}
	// nil vs set is not identical.
	nilDept := base
	nilDept.Department = nil
	if scopesIdentical(base, nilDept) {
		t.Fatalf("nil vs set department must not be identical")
	}
}

func TestValidateApprovalPolicyWindow(t *testing.T) {
	cases := []struct {
		name        string
		from, until *time.Time
		wantErr     bool
	}{
		{"both nil ok", nil, nil, false},
		{"only from ok", tp("2026-01-01T00:00:00Z"), nil, false},
		{"only until ok", nil, tp("2026-01-01T00:00:00Z"), false},
		{"until after from ok", tp("2026-01-01T00:00:00Z"), tp("2026-02-01T00:00:00Z"), false},
		{"until equal from invalid", tp("2026-01-01T00:00:00Z"), tp("2026-01-01T00:00:00Z"), true},
		{"until before from invalid", tp("2026-02-01T00:00:00Z"), tp("2026-01-01T00:00:00Z"), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateApprovalPolicyWindow(tc.from, tc.until)
			if tc.wantErr != (err != nil) {
				t.Fatalf("validateApprovalPolicyWindow err=%v, wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

func TestIsEffectiveAt_ExpiryWindow(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name        string
		from, until *time.Time
		want        bool
	}{
		{"unbounded effective", nil, nil, true},
		{"within window effective", tp("2026-06-01T00:00:00Z"), tp("2026-07-01T00:00:00Z"), true},
		{"not yet effective", tp("2026-06-20T00:00:00Z"), nil, false},
		{"expired", nil, tp("2026-06-10T00:00:00Z"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &model.ApprovalPolicy{ValidFrom: tc.from, ValidUntil: tc.until}
			if got := p.IsEffectiveAt(now); got != tc.want {
				t.Fatalf("IsEffectiveAt = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestHasIdenticalConflict(t *testing.T) {
	if hasIdenticalConflict(nil) {
		t.Fatalf("nil conflicts must report no identical conflict")
	}
	overlapOnly := []ApprovalPolicyConflict{{Identical: false}, {Identical: false}}
	if hasIdenticalConflict(overlapOnly) {
		t.Fatalf("overlap-only conflicts must not be identical")
	}
	mixed := []ApprovalPolicyConflict{{Identical: false}, {Identical: true}}
	if !hasIdenticalConflict(mixed) {
		t.Fatalf("a single identical conflict must be detected")
	}
}
