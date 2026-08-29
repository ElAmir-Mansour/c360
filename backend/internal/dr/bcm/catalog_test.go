package bcm

import (
	"testing"
)

// TestBuiltinCatalogValid asserts the seeded packs pass validation (the init
// would have panicked otherwise, but this exercises buildCatalog directly).
func TestBuiltinCatalogValid(t *testing.T) {
	t.Parallel()
	c, err := buildCatalog()
	if err != nil {
		t.Fatalf("buildCatalog: %v", err)
	}
	if len(c) < 2 {
		t.Fatalf("expected >= 2 seeded packs, got %d", len(c))
	}
	for _, key := range []string{"iso22301", "nca-sama-bcm"} {
		if _, ok := c[key]; !ok {
			t.Errorf("expected seeded pack %q", key)
		}
	}
}

// TestPacksSortedAndComplete asserts the listing is sorted by key and every pack
// is internally consistent.
func TestPacksSortedAndComplete(t *testing.T) {
	t.Parallel()
	packs := Packs()
	if len(packs) < 2 {
		t.Fatalf("expected >= 2 packs, got %d", len(packs))
	}
	for i := 1; i < len(packs); i++ {
		if packs[i-1].Key > packs[i].Key {
			t.Errorf("packs not sorted: %q before %q", packs[i-1].Key, packs[i].Key)
		}
	}
	for _, p := range packs {
		if err := p.Validate(); err != nil {
			t.Errorf("pack %s invalid: %v", p.Key, err)
		}
		if p.totalWeight() < len(p.Controls) {
			t.Errorf("pack %s total weight %d < control count %d", p.Key, p.totalWeight(), len(p.Controls))
		}
	}
}

// TestPackByKey covers hit and miss.
func TestPackByKey(t *testing.T) {
	t.Parallel()
	if _, ok := PackByKey("iso22301"); !ok {
		t.Error("expected iso22301 to exist")
	}
	if _, ok := PackByKey("does-not-exist"); ok {
		t.Error("expected miss for unknown pack key")
	}
}

// TestPackControlLookup covers the per-pack control accessor.
func TestPackControlLookup(t *testing.T) {
	t.Parallel()
	p, _ := PackByKey("nca-sama-bcm")
	if _, ok := p.Control("BC-3"); !ok {
		t.Error("expected BC-3 in nca-sama-bcm pack")
	}
	if _, ok := p.Control("NOPE"); ok {
		t.Error("expected miss for unknown control")
	}
}

// TestPackValidateRejects asserts the validator catches malformed packs across
// every failure mode, so a bad seeded pack cannot slip through.
func TestPackValidateRejects(t *testing.T) {
	t.Parallel()
	good := Control{Code: "C1", Title: "t", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: RuleDrillRecency, WindowDays: 90}}

	tests := []struct {
		name string
		pack Pack
	}{
		{name: "empty key", pack: Pack{Standard: "s", Controls: []Control{good}}},
		{name: "empty standard", pack: Pack{Key: "k", Controls: []Control{good}}},
		{name: "no controls", pack: Pack{Key: "k", Standard: "s"}},
		{name: "empty control code", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Title: "t", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: RuleDrillRecency}}}}},
		{name: "duplicate code", pack: Pack{Key: "k", Standard: "s", Controls: []Control{good, good}}},
		{name: "empty title", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: RuleDrillRecency}}}}},
		{name: "no required evidence", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", Title: "t", Rule: Rule{Kind: RuleDrillRecency}}}}},
		{name: "unknown rule kind", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", Title: "t", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: "bogus"}}}}},
		{name: "negative window", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", Title: "t", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: RuleDrillRecency, WindowDays: -1}}}}},
		{name: "bad tolerance", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", Title: "t", RequiredEvidence: []EvidenceKind{EvidenceFailover}, Rule: Rule{Kind: RuleRTOMet, PartialTolerance: 0.5}}}}},
		{name: "ratio out of range", pack: Pack{Key: "k", Standard: "s", Controls: []Control{{Code: "C", Title: "t", RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint}, Rule: Rule{Kind: RuleRecoveryPointValidated, MinRatio: 1.5}}}}},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if err := tc.pack.Validate(); err == nil {
				t.Errorf("expected validation error for %s", tc.name)
			}
		})
	}
}

// TestSeededPacksAreScorable runs each seeded pack against an all-passing
// evidence bundle and asserts it reaches full compliance — proving the seeded
// rules are evaluable end-to-end (no orphan evidence kinds, no unreachable
// controls).
func TestSeededPacksAreScorable(t *testing.T) {
	t.Parallel()
	s := NewScorer(fixedClock(refNow))
	for _, p := range Packs() {
		p := p
		t.Run(p.Key, func(t *testing.T) {
			t.Parallel()
			ev := fullyPassingEvidence()
			a := s.Score(p, ev)
			if a.Score != 100.0 {
				t.Errorf("pack %s score = %v, want 100.0 for all-passing evidence; gaps=%+v", p.Key, a.Score, a.Gaps)
			}
			if !a.Compliant {
				t.Errorf("pack %s not compliant for all-passing evidence", p.Key)
			}
		})
	}
}

// fullyPassingEvidence returns an evidence bundle that satisfies every rule kind
// the seeded packs use.
func fullyPassingEvidence() *Evidence {
	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint, EvidenceAttestation, EvidenceCleanRoom, EvidenceGroupTopology)
	ev.Topology = GroupTopology{Exists: true, MemberCount: 3, HasStream: true}
	ev.Drills = []DrillEvidence{
		{Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, RPOSeconds: 60, ExecutedAt: daysAgo(5)},
	}
	ev.Failovers = []FailoverEvidence{
		{Status: "COMPLETED", RTOActualSeconds: 600, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)},
	}
	ev.RecoveryPoints = []RecoveryPointEvidence{
		{IsValidated: true, ValidationRatio: 1.0, RPOSeconds: 60, SealedAt: daysAgo(2), Immutable: true, RetentionUntil: refNow.AddDate(1, 0, 0)},
	}
	ev.Attestations = []AttestationEvidence{{CreatedAt: daysAgo(2)}}
	ev.CleanRoom = []CleanRoomEvidence{{Verdict: "clean", Clean: true, VerifiedAt: daysAgo(3)}}
	return ev
}
