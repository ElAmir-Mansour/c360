package bcm

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// fixedClock returns a clock function pinned to t, so every date-window rule in
// the scorer is evaluated against an injected, deterministic "now".
func fixedClock(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

// refNow is the deterministic evaluation instant used across scorer tests.
var refNow = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

// daysAgo returns refNow minus n days.
func daysAgo(n int) time.Time { return refNow.AddDate(0, 0, -n) }

// testPack defines the four named controls the prompt requires plus is reused
// across cases. Weights are 1 so the score is a simple satisfied/partial count
// over 4. All four are mandatory so a mandatory breach is exercised too.
func testPack() Pack {
	return Pack{
		Key:      "test-pack",
		Standard: "TEST BCM",
		Version:  "1",
		Title:    "Test pack",
		Controls: []Control{
			{
				Code:             "DR-RECENCY",
				Title:            "drill recency",
				RequiredEvidence: []EvidenceKind{EvidenceDrill},
				Rule:             Rule{Kind: RuleDrillRecency, WindowDays: 90, MinCount: 1},
				Weight:           1,
				Mandatory:        true,
			},
			{
				Code:             "DR-RTO",
				Title:            "RTO met",
				RequiredEvidence: []EvidenceKind{EvidenceFailover},
				Rule:             Rule{Kind: RuleRTOMet, PartialTolerance: 1.25},
				Weight:           1,
				Mandatory:        true,
			},
			{
				Code:             "DR-RPV",
				Title:            "recovery point validated",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleRecoveryPointValidated, WindowDays: 30, MinRatio: 0.999},
				Weight:           1,
				Mandatory:        true,
			},
			{
				Code:             "DR-IMMUT",
				Title:            "immutability enabled",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleImmutabilityEnabled},
				Weight:           1,
				Mandatory:        true,
			},
		},
	}
}

// evidenceWith builds an Evidence bundle marking the given kinds available. This
// mirrors what the collector produces (a wired source => available), so a kind
// not listed is treated by the scorer as "source unavailable" (failed).
func evidenceWith(kinds ...EvidenceKind) *Evidence {
	ev := &Evidence{
		GroupID:   uuid.New(),
		Topology:  GroupTopology{Exists: false},
		available: map[EvidenceKind]bool{},
	}
	for _, k := range kinds {
		ev.available[k] = true
	}
	return ev
}

func resultByCode(a Assessment, code string) (ControlResult, bool) {
	for _, r := range a.ControlResults {
		if r.Code == code {
			return r, true
		}
	}
	return ControlResult{}, false
}

func gapByCode(a Assessment, code string) (Gap, bool) {
	for _, g := range a.Gaps {
		if g.Code == code {
			return g, true
		}
	}
	return Gap{}, false
}

// TestScore_MixedPassAndFail feeds synthetic evidence where two of the four
// named controls pass and two fail, and asserts per-control verdicts, the
// aggregate score, and the gap list.
func TestScore_MixedPassAndFail(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))

	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
	// DR-RECENCY: a passing, fresh drill that met RTO -> satisfied.
	ev.Drills = []DrillEvidence{
		{ID: uuid.New(), Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, ExecutedAt: daysAgo(10)},
	}
	// DR-RTO: latest completed run BLEW the objective beyond tolerance -> failed.
	ev.Failovers = []FailoverEvidence{
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 5000, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(2)},
	}
	// DR-RPV: a validated, fresh, high-ratio recovery point -> satisfied.
	// DR-IMMUT: that recovery point is NOT immutable -> failed.
	ev.RecoveryPoints = []RecoveryPointEvidence{
		{ID: uuid.New(), IsValidated: true, ValidationRatio: 0.9995, SealedAt: daysAgo(5), Immutable: false},
	}

	a := s.Score(pack, ev)

	wantVerdicts := map[string]Verdict{
		"DR-RECENCY": VerdictSatisfied,
		"DR-RTO":     VerdictFailed,
		"DR-RPV":     VerdictSatisfied,
		"DR-IMMUT":   VerdictFailed,
	}
	for code, want := range wantVerdicts {
		got, ok := resultByCode(a, code)
		if !ok {
			t.Fatalf("control %s missing from results", code)
		}
		if got.Verdict != want {
			t.Errorf("control %s: verdict = %s, want %s (reason: %s)", code, got.Verdict, want, got.Reason)
		}
	}

	// 2 satisfied of 4 equal-weight controls -> 50.00.
	if a.Score != 50.0 {
		t.Errorf("score = %v, want 50.0", a.Score)
	}
	if a.Satisfied != 2 || a.Failed != 2 || a.Partial != 0 {
		t.Errorf("tallies satisfied=%d partial=%d failed=%d, want 2/0/2", a.Satisfied, a.Partial, a.Failed)
	}
	// Mandatory controls failed -> not compliant.
	if a.Compliant {
		t.Error("expected not compliant when mandatory controls fail")
	}
	// Gap list contains exactly the two failed controls.
	if len(a.Gaps) != 2 {
		t.Fatalf("gaps = %d, want 2", len(a.Gaps))
	}
	if _, ok := gapByCode(a, "DR-RTO"); !ok {
		t.Error("expected DR-RTO in gaps")
	}
	if _, ok := gapByCode(a, "DR-IMMUT"); !ok {
		t.Error("expected DR-IMMUT in gaps")
	}
}

// TestScore_AllPass asserts a fully-satisfying evidence set yields score 100 and
// compliant=true with an empty gap list.
func TestScore_AllPass(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))

	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
	ev.Drills = []DrillEvidence{
		{ID: uuid.New(), Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, ExecutedAt: daysAgo(5)},
	}
	ev.Failovers = []FailoverEvidence{
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 700, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)},
	}
	ev.RecoveryPoints = []RecoveryPointEvidence{
		{ID: uuid.New(), IsValidated: true, ValidationRatio: 1.0, SealedAt: daysAgo(2), Immutable: true, RetentionUntil: refNow.AddDate(1, 0, 0)},
	}

	a := s.Score(pack, ev)
	if a.Score != 100.0 {
		t.Errorf("score = %v, want 100.0", a.Score)
	}
	if !a.Compliant {
		t.Error("expected compliant when all controls satisfied")
	}
	if len(a.Gaps) != 0 {
		t.Errorf("gaps = %d, want 0", len(a.Gaps))
	}
}

// TestScore_NoEvidenceIsFailedNotVacuous is the critical anti-vacuity test: a
// control whose required evidence kind is unavailable (no source wired) is
// FAILED, never passed.
func TestScore_NoEvidenceIsFailedNotVacuous(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))

	// No kinds available at all.
	ev := evidenceWith()

	a := s.Score(pack, ev)
	if a.Score != 0.0 {
		t.Errorf("score = %v, want 0.0 when no evidence available", a.Score)
	}
	if a.Satisfied != 0 || a.Failed != len(pack.Controls) {
		t.Errorf("tallies satisfied=%d failed=%d, want 0/%d", a.Satisfied, a.Failed, len(pack.Controls))
	}
	for _, r := range a.ControlResults {
		if r.Verdict != VerdictFailed {
			t.Errorf("control %s verdict = %s, want failed (no evidence must not pass)", r.Code, r.Verdict)
		}
		if r.Reason == "" {
			t.Errorf("control %s has empty reason; gap analysis must explain", r.Code)
		}
	}
}

// TestScore_EmptyEvidenceSetIsFailed asserts that an AVAILABLE source returning
// ZERO items (queried, nothing qualified) still fails — distinct from an
// unavailable source, but equally never vacuously passing.
func TestScore_EmptyEvidenceSetIsFailed(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))

	// All sources available but every slice empty.
	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)

	a := s.Score(pack, ev)
	for _, r := range a.ControlResults {
		if r.Verdict != VerdictFailed {
			t.Errorf("control %s verdict = %s, want failed for empty evidence", r.Code, r.Verdict)
		}
	}
	if a.Score != 0.0 {
		t.Errorf("score = %v, want 0.0", a.Score)
	}
}

// TestDrillRecencyWindow exercises the 90-day window against the injected clock:
// a passing drill exactly inside the window satisfies; the same drill just
// outside is partial (stale). Proves the date-window rule uses the clock.
func TestDrillRecencyWindow(t *testing.T) {
	t.Parallel()
	pack := testPack()

	tests := []struct {
		name       string
		executedAt time.Time
		passed     bool
		rtoActual  int
		want       Verdict
	}{
		{name: "fresh passing within window", executedAt: daysAgo(89), passed: true, rtoActual: 600, want: VerdictSatisfied},
		{name: "on the window boundary", executedAt: daysAgo(90), passed: true, rtoActual: 600, want: VerdictSatisfied},
		{name: "just outside window is partial(stale)", executedAt: daysAgo(91), passed: true, rtoActual: 600, want: VerdictPartial},
		{name: "fresh but missed RTO is partial", executedAt: daysAgo(10), passed: true, rtoActual: 5000, want: VerdictPartial},
		{name: "fresh but failed drill -> no passing -> failed", executedAt: daysAgo(10), passed: false, rtoActual: 600, want: VerdictFailed},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
			ev.Drills = []DrillEvidence{
				{ID: uuid.New(), Passed: tc.passed, RTOActualSeconds: tc.rtoActual, RTOObjectiveSeconds: 900, ExecutedAt: tc.executedAt},
			}
			a := s.Score(pack, ev)
			got, _ := resultByCode(a, "DR-RECENCY")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestRTOMetTolerance covers satisfied / partial(within tolerance) / failed.
func TestRTOMetTolerance(t *testing.T) {
	t.Parallel()
	pack := testPack()

	tests := []struct {
		name      string
		actual    int
		objective int
		want      Verdict
	}{
		{name: "met exactly", actual: 900, objective: 900, want: VerdictSatisfied},
		{name: "under objective", actual: 500, objective: 900, want: VerdictSatisfied},
		{name: "over but within 1.25x", actual: 1000, objective: 900, want: VerdictPartial},
		{name: "over beyond tolerance", actual: 2000, objective: 900, want: VerdictFailed},
		{name: "unknown objective fails (no vacuous pass)", actual: 100, objective: 0, want: VerdictFailed},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
			ev.Failovers = []FailoverEvidence{
				{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: tc.actual, RTOObjectiveSeconds: tc.objective, CompletedAt: daysAgo(1)},
			}
			a := s.Score(pack, ev)
			got, _ := resultByCode(a, "DR-RTO")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestRTOMetPicksLatestCompletedRun asserts the most-recently-completed run is
// chosen, and in-flight (non-COMPLETED) runs are ignored.
func TestRTOMetPicksLatestCompletedRun(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))
	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
	ev.Failovers = []FailoverEvidence{
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 5000, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(30)}, // old, bad
		{ID: uuid.New(), Status: "RUNNING", RTOActualSeconds: 0, RTOObjectiveSeconds: 900, CompletedAt: time.Time{}},      // in-flight, ignored
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 600, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)},   // newest, good
	}
	a := s.Score(pack, ev)
	got, _ := resultByCode(a, "DR-RTO")
	if got.Verdict != VerdictSatisfied {
		t.Errorf("verdict = %s, want satisfied (latest completed run met RTO)", got.Verdict)
	}
}

// TestRecoveryPointValidated covers fresh+ratio / stale / low-ratio / unvalidated.
func TestRecoveryPointValidated(t *testing.T) {
	t.Parallel()
	pack := testPack()

	tests := []struct {
		name      string
		validated bool
		ratio     float64
		sealedAt  time.Time
		want      Verdict
	}{
		{name: "validated fresh high ratio", validated: true, ratio: 0.9995, sealedAt: daysAgo(10), want: VerdictSatisfied},
		{name: "validated but stale", validated: true, ratio: 0.9995, sealedAt: daysAgo(40), want: VerdictPartial},
		{name: "validated fresh but low ratio", validated: true, ratio: 0.95, sealedAt: daysAgo(10), want: VerdictPartial},
		{name: "not validated", validated: false, ratio: 1.0, sealedAt: daysAgo(1), want: VerdictFailed},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
			ev.RecoveryPoints = []RecoveryPointEvidence{
				{ID: uuid.New(), IsValidated: tc.validated, ValidationRatio: tc.ratio, SealedAt: tc.sealedAt},
			}
			a := s.Score(pack, ev)
			got, _ := resultByCode(a, "DR-RPV")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestImmutability covers all/some/none immutable, including the expired-lock
// case where the WORM flag is set but the retention horizon is in the past.
func TestImmutability(t *testing.T) {
	t.Parallel()
	pack := testPack()
	future := refNow.AddDate(1, 0, 0)
	past := refNow.AddDate(0, 0, -1)

	tests := []struct {
		name string
		rps  []RecoveryPointEvidence
		want Verdict
	}{
		{
			name: "all immutable",
			rps: []RecoveryPointEvidence{
				{ID: uuid.New(), Immutable: true, RetentionUntil: future},
				{ID: uuid.New(), Immutable: true, RetentionUntil: future},
			},
			want: VerdictSatisfied,
		},
		{
			name: "some immutable",
			rps: []RecoveryPointEvidence{
				{ID: uuid.New(), Immutable: true, RetentionUntil: future},
				{ID: uuid.New(), Immutable: false},
			},
			want: VerdictPartial,
		},
		{
			name: "none immutable",
			rps: []RecoveryPointEvidence{
				{ID: uuid.New(), Immutable: false},
			},
			want: VerdictFailed,
		},
		{
			name: "WORM flag set but retention expired -> not protected",
			rps: []RecoveryPointEvidence{
				{ID: uuid.New(), Immutable: true, RetentionUntil: past},
			},
			want: VerdictFailed,
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
			ev.RecoveryPoints = tc.rps
			a := s.Score(pack, ev)
			got, _ := resultByCode(a, "DR-IMMUT")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestPartialScoringAndCompliance asserts partial verdicts contribute half
// weight and a partial-only profile is still not compliant if a mandatory
// control is partial (a partial mandatory is a gap, so mandatoryBreached).
func TestPartialScoringAndCompliance(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))

	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
	// DR-RECENCY: stale passing -> partial.
	ev.Drills = []DrillEvidence{
		{ID: uuid.New(), Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, ExecutedAt: daysAgo(120)},
	}
	// DR-RTO: satisfied.
	ev.Failovers = []FailoverEvidence{
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 600, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)},
	}
	// DR-RPV: satisfied; DR-IMMUT: partial (one immutable, one not).
	ev.RecoveryPoints = []RecoveryPointEvidence{
		{ID: uuid.New(), IsValidated: true, ValidationRatio: 1.0, SealedAt: daysAgo(2), Immutable: true, RetentionUntil: refNow.AddDate(1, 0, 0)},
		{ID: uuid.New(), IsValidated: true, ValidationRatio: 1.0, SealedAt: daysAgo(3), Immutable: false},
	}

	a := s.Score(pack, ev)
	// satisfied=2 (1.0 each) + partial=2 (0.5 each) = 3.0 / 4 = 75.00.
	if a.Score != 75.0 {
		t.Errorf("score = %v, want 75.0", a.Score)
	}
	if a.Satisfied != 2 || a.Partial != 2 || a.Failed != 0 {
		t.Errorf("tallies satisfied=%d partial=%d failed=%d, want 2/2/0", a.Satisfied, a.Partial, a.Failed)
	}
	// Partial mandatory controls are gaps -> not compliant.
	if a.Compliant {
		t.Error("expected not compliant when mandatory controls are only partial")
	}
	if len(a.Gaps) != 2 {
		t.Errorf("gaps = %d, want 2", len(a.Gaps))
	}
}

// TestWeightedScore asserts control weights bias the score: a heavy satisfied
// control plus a light failed control scores higher than equal weighting.
func TestWeightedScore(t *testing.T) {
	t.Parallel()
	pack := Pack{
		Key: "w", Standard: "W", Controls: []Control{
			{Code: "HEAVY", Title: "h", RequiredEvidence: []EvidenceKind{EvidenceFailover}, Rule: Rule{Kind: RuleRTOMet}, Weight: 3},
			{Code: "LIGHT", Title: "l", RequiredEvidence: []EvidenceKind{EvidenceDrill}, Rule: Rule{Kind: RuleDrillRecency, WindowDays: 90}, Weight: 1},
		},
	}
	s := NewScorer(fixedClock(refNow))
	ev := evidenceWith(EvidenceFailover, EvidenceDrill)
	// HEAVY satisfied, LIGHT failed (no drills).
	ev.Failovers = []FailoverEvidence{
		{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 600, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)},
	}
	a := s.Score(pack, ev)
	// (3*1.0 + 1*0.0) / 4 = 75.00.
	if a.Score != 75.0 {
		t.Errorf("weighted score = %v, want 75.0", a.Score)
	}
}

// TestGroupConfiguredRule covers the structural rule's three states.
func TestGroupConfiguredRule(t *testing.T) {
	t.Parallel()
	pack := Pack{
		Key: "g", Standard: "G", Controls: []Control{
			{Code: "GRP", Title: "grp", RequiredEvidence: []EvidenceKind{EvidenceGroupTopology}, Rule: Rule{Kind: RuleGroupConfigured, MinCount: 2}},
		},
	}

	tests := []struct {
		name string
		topo GroupTopology
		want Verdict
	}{
		{name: "configured", topo: GroupTopology{Exists: true, MemberCount: 3, HasStream: true}, want: VerdictSatisfied},
		{name: "members but no stream", topo: GroupTopology{Exists: true, MemberCount: 3, HasStream: false}, want: VerdictPartial},
		{name: "stream but too few members", topo: GroupTopology{Exists: true, MemberCount: 1, HasStream: true}, want: VerdictPartial},
		{name: "does not exist", topo: GroupTopology{Exists: false}, want: VerdictFailed},
		{name: "exists but empty", topo: GroupTopology{Exists: true, MemberCount: 0, HasStream: false}, want: VerdictFailed},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceGroupTopology)
			ev.Topology = tc.topo
			a := s.Score(pack, ev)
			got, _ := resultByCode(a, "GRP")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestCleanRoomAndAttestation covers the clean-room and attestation rules,
// including the stale-but-clean partial and the not-clean failure.
func TestCleanRoomAndAttestation(t *testing.T) {
	t.Parallel()

	t.Run("clean room", func(t *testing.T) {
		t.Parallel()
		pack := Pack{Key: "c", Standard: "C", Controls: []Control{
			{Code: "CR", Title: "cr", RequiredEvidence: []EvidenceKind{EvidenceCleanRoom}, Rule: Rule{Kind: RuleCleanRoomVerified, WindowDays: 90}},
		}}
		cases := []struct {
			name string
			ev   []CleanRoomEvidence
			want Verdict
		}{
			{name: "fresh clean", ev: []CleanRoomEvidence{{ID: uuid.New(), Verdict: "clean", Clean: true, VerifiedAt: daysAgo(10)}}, want: VerdictSatisfied},
			{name: "stale clean", ev: []CleanRoomEvidence{{ID: uuid.New(), Verdict: "clean", Clean: true, VerifiedAt: daysAgo(120)}}, want: VerdictPartial},
			{name: "latest not clean", ev: []CleanRoomEvidence{{ID: uuid.New(), Verdict: "malware", Clean: false, VerifiedAt: daysAgo(1)}}, want: VerdictFailed},
			{name: "none", ev: nil, want: VerdictFailed},
		}
		for _, tc := range cases {
			tc := tc
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				s := NewScorer(fixedClock(refNow))
				e := evidenceWith(EvidenceCleanRoom)
				e.CleanRoom = tc.ev
				got, _ := resultByCode(s.Score(pack, e), "CR")
				if got.Verdict != tc.want {
					t.Errorf("verdict = %s, want %s", got.Verdict, tc.want)
				}
			})
		}
	})

	t.Run("attestation", func(t *testing.T) {
		t.Parallel()
		pack := Pack{Key: "at", Standard: "AT", Controls: []Control{
			{Code: "ATT", Title: "att", RequiredEvidence: []EvidenceKind{EvidenceAttestation}, Rule: Rule{Kind: RuleAttestationIssued, WindowDays: 90}},
		}}
		cases := []struct {
			name string
			ev   []AttestationEvidence
			want Verdict
		}{
			{name: "fresh", ev: []AttestationEvidence{{ID: uuid.New(), CreatedAt: daysAgo(10)}}, want: VerdictSatisfied},
			{name: "stale", ev: []AttestationEvidence{{ID: uuid.New(), CreatedAt: daysAgo(200)}}, want: VerdictPartial},
			{name: "none", ev: nil, want: VerdictFailed},
		}
		for _, tc := range cases {
			tc := tc
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				s := NewScorer(fixedClock(refNow))
				e := evidenceWith(EvidenceAttestation)
				e.Attestations = tc.ev
				got, _ := resultByCode(s.Score(pack, e), "ATT")
				if got.Verdict != tc.want {
					t.Errorf("verdict = %s, want %s", got.Verdict, tc.want)
				}
			})
		}
	})
}

// TestRPOMet covers the RPO rule including the pack-level override objective.
func TestRPOMet(t *testing.T) {
	t.Parallel()
	pack := Pack{Key: "r", Standard: "R", Controls: []Control{
		{Code: "RPO", Title: "rpo", RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint}, Rule: Rule{Kind: RuleRPOMet, RPOObjectiveSeconds: 300, PartialTolerance: 1.5}},
	}}

	tests := []struct {
		name      string
		validated bool
		rpo       int
		want      Verdict
	}{
		{name: "met", validated: true, rpo: 250, want: VerdictSatisfied},
		{name: "within tolerance", validated: true, rpo: 400, want: VerdictPartial},
		{name: "beyond tolerance", validated: true, rpo: 1000, want: VerdictFailed},
		{name: "no validated rp", validated: false, rpo: 100, want: VerdictFailed},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := NewScorer(fixedClock(refNow))
			ev := evidenceWith(EvidenceRecoveryPoint)
			ev.RecoveryPoints = []RecoveryPointEvidence{
				{ID: uuid.New(), IsValidated: tc.validated, RPOSeconds: tc.rpo, SealedAt: daysAgo(1)},
			}
			got, _ := resultByCode(s.Score(pack, ev), "RPO")
			if got.Verdict != tc.want {
				t.Errorf("verdict = %s, want %s (reason: %s)", got.Verdict, tc.want, got.Reason)
			}
		})
	}
}

// TestEvidenceRefsRecorded asserts a satisfied control records the driving
// evidence id (auditor traceability), not an empty ref list.
func TestEvidenceRefsRecorded(t *testing.T) {
	t.Parallel()
	pack := testPack()
	s := NewScorer(fixedClock(refNow))
	drillID := uuid.New()
	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint)
	ev.Drills = []DrillEvidence{
		{ID: drillID, Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, ExecutedAt: daysAgo(5)},
	}
	a := s.Score(pack, ev)
	got, _ := resultByCode(a, "DR-RECENCY")
	if len(got.EvidenceRefs) != 1 || got.EvidenceRefs[0] != drillID.String() {
		t.Errorf("evidence refs = %v, want [%s]", got.EvidenceRefs, drillID)
	}
}

// TestScore_Deterministic asserts two scorings of the same pack+evidence produce
// identical assessments (same score, same verdicts, same gap order).
func TestScore_Deterministic(t *testing.T) {
	t.Parallel()
	pack := iso22301Pack()
	s := NewScorer(fixedClock(refNow))
	ev := evidenceWith(EvidenceDrill, EvidenceFailover, EvidenceRecoveryPoint, EvidenceAttestation, EvidenceGroupTopology)
	ev.Topology = GroupTopology{Exists: true, MemberCount: 2, HasStream: true, GroupID: uuid.New()}
	ev.Drills = []DrillEvidence{{ID: uuid.New(), Passed: true, RTOActualSeconds: 600, RTOObjectiveSeconds: 900, ExecutedAt: daysAgo(5)}}
	ev.Failovers = []FailoverEvidence{{ID: uuid.New(), Status: "COMPLETED", RTOActualSeconds: 600, RTOObjectiveSeconds: 900, CompletedAt: daysAgo(1)}}
	ev.RecoveryPoints = []RecoveryPointEvidence{{ID: uuid.New(), IsValidated: true, ValidationRatio: 1.0, RPOSeconds: 60, SealedAt: daysAgo(2), Immutable: true, RetentionUntil: refNow.AddDate(1, 0, 0)}}
	ev.Attestations = []AttestationEvidence{{ID: uuid.New(), CreatedAt: daysAgo(2)}}

	a1 := s.Score(pack, ev)
	a2 := s.Score(pack, ev)
	if a1.Score != a2.Score {
		t.Errorf("non-deterministic score: %v vs %v", a1.Score, a2.Score)
	}
	if len(a1.Gaps) != len(a2.Gaps) {
		t.Fatalf("non-deterministic gap count: %d vs %d", len(a1.Gaps), len(a2.Gaps))
	}
	for i := range a1.Gaps {
		if a1.Gaps[i].Code != a2.Gaps[i].Code {
			t.Errorf("gap order differs at %d: %s vs %s", i, a1.Gaps[i].Code, a2.Gaps[i].Code)
		}
	}
}
