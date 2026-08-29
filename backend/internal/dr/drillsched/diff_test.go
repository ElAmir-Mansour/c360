package drillsched

import (
	"reflect"
	"testing"
)

func ratio(v float64) *float64 { return &v }

// baseResult builds a passing result with a stable 3-step timeline and a
// two-member, one-edge asset fingerprint, used as the diff baseline.
func baseResult(id string) *DrillResult {
	return &DrillResult{
		ID:                 id,
		GroupID:            "group-1",
		Passed:             true,
		RTOAchievedSeconds: 600,
		RPOAchievedSeconds: 120,
		ValidationRatio:    ratio(0.9995),
		Steps: []DrillStep{
			{Key: "gate1.validate", Status: StepStatusPassed, DurationMS: 1000},
			{Key: "boot:site-a", Status: StepStatusPassed, DurationMS: 4000},
			{Key: "gate4.attest", Status: StepStatusPassed, DurationMS: 500},
		},
		AssetFingerprint: AssetFingerprint{
			Members:       map[string]int{"site-a": 10, "site-b": 20},
			TopologyEdges: []string{"site-a->site-b"},
		},
	}
}

// TestDiffResults_RTORegressedStepFailedDurationDrift is the prompt's core diff
// scenario: RTO regressed, one step newly failing, and a duration drift. It
// asserts the structured diff is exactly correct.
func TestDiffResults_RTORegressedStepFailedDurationDrift(t *testing.T) {
	prev := baseResult("prev")

	curr := baseResult("curr")
	curr.RTOAchievedSeconds = 720           // +120s : regressed
	curr.RPOAchievedSeconds = 120           // unchanged
	curr.Steps[1].Status = StepStatusFailed // boot:site-a newly fails
	curr.Steps[1].DurationMS = 9000         // and its duration drifts +125%
	curr.Steps[2].DurationMS = 520          // gate4 +4% : below threshold, no drift
	curr.Passed = false                     // overall now fails

	diff := DiffResults(prev, curr, 0)

	if !diff.RTORegressed || diff.RTODeltaSeconds != 120 {
		t.Fatalf("RTO: regressed=%v delta=%d, want true/120", diff.RTORegressed, diff.RTODeltaSeconds)
	}
	if diff.RPORegressed || diff.RPODeltaSeconds != 0 {
		t.Fatalf("RPO: regressed=%v delta=%d, want false/0", diff.RPORegressed, diff.RPODeltaSeconds)
	}
	if !diff.PassedChanged || !diff.NewlyRegressed || diff.NewlyRecovered {
		t.Fatalf("outcome: changed=%v regressed=%v recovered=%v, want true/true/false",
			diff.PassedChanged, diff.NewlyRegressed, diff.NewlyRecovered)
	}
	if !reflect.DeepEqual(diff.NewlyFailedSteps, []string{"boot:site-a"}) {
		t.Fatalf("newly failed = %v, want [boot:site-a]", diff.NewlyFailedSteps)
	}
	if len(diff.NewlyPassedSteps) != 0 {
		t.Fatalf("newly passed = %v, want empty", diff.NewlyPassedSteps)
	}
	if len(diff.AddedSteps) != 0 || len(diff.RemovedSteps) != 0 {
		t.Fatalf("added/removed = %v/%v, want empty", diff.AddedSteps, diff.RemovedSteps)
	}
	if len(diff.DurationDrift) != 1 {
		t.Fatalf("duration drift = %+v, want exactly 1 (boot:site-a)", diff.DurationDrift)
	}
	d := diff.DurationDrift[0]
	if d.Key != "boot:site-a" || d.PreviousMS != 4000 || d.CurrentMS != 9000 || d.DeltaMS != 5000 {
		t.Fatalf("drift entry = %+v, want boot:site-a 4000->9000 (+5000)", d)
	}
	if d.ChangeFraction <= 1.0 { // +5000/4000 = +1.25
		t.Fatalf("change fraction = %v, want > 1.0 (slower)", d.ChangeFraction)
	}
	if diff.AssetDrift.HasChanges() {
		t.Fatalf("asset drift = %+v, want none", diff.AssetDrift)
	}
	if !diff.HasDrift() {
		t.Fatal("HasDrift() = false, want true")
	}
}

// TestDiffResults_NoDrift asserts two identical results produce a diff with no
// drift flagged.
func TestDiffResults_NoDrift(t *testing.T) {
	diff := DiffResults(baseResult("prev"), baseResult("curr"), 0)
	if diff.HasDrift() {
		t.Fatalf("HasDrift() = true for identical results: %+v", diff)
	}
	if diff.RTODeltaSeconds != 0 || diff.RPODeltaSeconds != 0 {
		t.Fatalf("deltas = %d/%d, want 0/0", diff.RTODeltaSeconds, diff.RPODeltaSeconds)
	}
	if len(diff.DurationDrift) != 0 {
		t.Fatalf("duration drift = %+v, want none", diff.DurationDrift)
	}
}

// TestDiffResults_NewlyRecovered asserts a previously failing step/outcome that
// now passes is reported as recovered, and an RTO improvement is not a regression.
func TestDiffResults_NewlyRecovered(t *testing.T) {
	prev := baseResult("prev")
	prev.Passed = false
	prev.Steps[1].Status = StepStatusFailed
	prev.RTOAchievedSeconds = 800

	curr := baseResult("curr") // all passing, RTO 600

	diff := DiffResults(prev, curr, 0)
	if !diff.NewlyRecovered || diff.NewlyRegressed {
		t.Fatalf("recovered=%v regressed=%v, want true/false", diff.NewlyRecovered, diff.NewlyRegressed)
	}
	if !reflect.DeepEqual(diff.NewlyPassedSteps, []string{"boot:site-a"}) {
		t.Fatalf("newly passed = %v, want [boot:site-a]", diff.NewlyPassedSteps)
	}
	if diff.RTORegressed || diff.RTODeltaSeconds != -200 {
		t.Fatalf("RTO: regressed=%v delta=%d, want false/-200", diff.RTORegressed, diff.RTODeltaSeconds)
	}
}

// TestDiffResults_AddedRemovedSteps asserts step set changes are reported, and a
// newly-added failing step also counts as newly failed.
func TestDiffResults_AddedRemovedSteps(t *testing.T) {
	prev := baseResult("prev")
	curr := baseResult("curr")
	// Remove gate4.attest, add a failing boot:site-c.
	curr.Steps = []DrillStep{
		{Key: "gate1.validate", Status: StepStatusPassed, DurationMS: 1000},
		{Key: "boot:site-a", Status: StepStatusPassed, DurationMS: 4000},
		{Key: "boot:site-c", Status: StepStatusFailed, DurationMS: 3000},
	}

	diff := DiffResults(prev, curr, 0)
	if !reflect.DeepEqual(diff.AddedSteps, []string{"boot:site-c"}) {
		t.Fatalf("added = %v, want [boot:site-c]", diff.AddedSteps)
	}
	if !reflect.DeepEqual(diff.RemovedSteps, []string{"gate4.attest"}) {
		t.Fatalf("removed = %v, want [gate4.attest]", diff.RemovedSteps)
	}
	if !reflect.DeepEqual(diff.NewlyFailedSteps, []string{"boot:site-c"}) {
		t.Fatalf("newly failed = %v, want [boot:site-c] (new step that fails)", diff.NewlyFailedSteps)
	}
}

// TestDiffResults_AssetDrift asserts member add/remove/reorder and edge add/remove.
func TestDiffResults_AssetDrift(t *testing.T) {
	prev := baseResult("prev") // members a:10 b:20, edge a->b
	curr := baseResult("curr")
	curr.AssetFingerprint = AssetFingerprint{
		Members:       map[string]int{"site-a": 5, "site-c": 30}, // a reordered 10->5, b removed, c added
		TopologyEdges: []string{"site-a->site-c"},                // a->b removed, a->c added
	}

	diff := DiffResults(prev, curr, 0)
	ad := diff.AssetDrift
	if !reflect.DeepEqual(ad.AddedMembers, []string{"site-c"}) {
		t.Fatalf("added members = %v, want [site-c]", ad.AddedMembers)
	}
	if !reflect.DeepEqual(ad.RemovedMembers, []string{"site-b"}) {
		t.Fatalf("removed members = %v, want [site-b]", ad.RemovedMembers)
	}
	if len(ad.ReorderedMembers) != 1 || ad.ReorderedMembers[0].SiteID != "site-a" ||
		ad.ReorderedMembers[0].FromOrder != 10 || ad.ReorderedMembers[0].ToOrder != 5 {
		t.Fatalf("reordered = %+v, want site-a 10->5", ad.ReorderedMembers)
	}
	if !reflect.DeepEqual(ad.AddedEdges, []string{"site-a->site-c"}) {
		t.Fatalf("added edges = %v, want [site-a->site-c]", ad.AddedEdges)
	}
	if !reflect.DeepEqual(ad.RemovedEdges, []string{"site-a->site-b"}) {
		t.Fatalf("removed edges = %v, want [site-a->site-b]", ad.RemovedEdges)
	}
	if !diff.HasDrift() {
		t.Fatal("HasDrift() = false, want true (asset drift present)")
	}
}

// TestDiffResults_NoPrevious asserts a first result (no predecessor) yields a
// structured diff: a failing first drill is flagged as a regression; deltas are
// zero (no baseline) and no asset drift is computed.
func TestDiffResults_NoPrevious(t *testing.T) {
	curr := baseResult("curr")
	curr.Passed = false

	diff := DiffResults(nil, curr, 0)
	if diff.PreviousResultID != "" {
		t.Fatalf("previous id = %q, want empty", diff.PreviousResultID)
	}
	if !diff.NewlyRegressed || !diff.PassedChanged {
		t.Fatalf("first failing drill: regressed=%v changed=%v, want true/true", diff.NewlyRegressed, diff.PassedChanged)
	}
	if diff.RTODeltaSeconds != 0 || diff.RPODeltaSeconds != 0 {
		t.Fatalf("deltas against no baseline = %d/%d, want 0/0", diff.RTODeltaSeconds, diff.RPODeltaSeconds)
	}
	if diff.AssetDrift.HasChanges() {
		t.Fatalf("asset drift against no baseline = %+v, want none", diff.AssetDrift)
	}

	// A passing first drill is not a regression and has no drift.
	passing := DiffResults(nil, baseResult("first"), 0)
	if passing.NewlyRegressed || passing.HasDrift() {
		t.Fatalf("passing first drill: regressed=%v hasDrift=%v, want false/false", passing.NewlyRegressed, passing.HasDrift())
	}
}

// TestDiffResults_DeterministicOrdering asserts the diff's slice outputs are
// sorted so equal inputs always yield byte-equal diffs.
func TestDiffResults_DeterministicOrdering(t *testing.T) {
	prev := baseResult("prev")
	prev.Steps = nil // everything in curr is "added"
	curr := baseResult("curr")
	curr.Steps = []DrillStep{
		{Key: "zzz", Status: StepStatusPassed},
		{Key: "aaa", Status: StepStatusPassed},
		{Key: "mmm", Status: StepStatusPassed},
	}
	d1 := DiffResults(prev, curr, 0)
	d2 := DiffResults(prev, curr, 0)
	if !reflect.DeepEqual(d1, d2) {
		t.Fatal("two diffs of equal inputs differ; ordering is not deterministic")
	}
	if !reflect.DeepEqual(d1.AddedSteps, []string{"aaa", "mmm", "zzz"}) {
		t.Fatalf("added steps = %v, want sorted [aaa mmm zzz]", d1.AddedSteps)
	}
}

// TestDurationDrift_ZeroBaseline asserts a step that went from 0ms to non-zero
// is reported as drift (no division by zero).
func TestDurationDrift_ZeroBaseline(t *testing.T) {
	prev := baseResult("prev")
	prev.Steps[0].DurationMS = 0
	curr := baseResult("curr")
	curr.Steps[0].DurationMS = 1500

	diff := DiffResults(prev, curr, 0)
	found := false
	for _, d := range diff.DurationDrift {
		if d.Key == "gate1.validate" {
			found = true
			if d.PreviousMS != 0 || d.CurrentMS != 1500 || d.ChangeFraction != 1.0 {
				t.Fatalf("zero-baseline drift = %+v, want 0->1500 fraction 1.0", d)
			}
		}
	}
	if !found {
		t.Fatal("expected duration drift for the zero-baseline step")
	}
}

// TestDurationDrift_Threshold asserts the threshold gate: a 20% change is below
// the default 25% and not reported; a custom 10% threshold reports it.
func TestDurationDrift_Threshold(t *testing.T) {
	prev := baseResult("prev")
	curr := baseResult("curr")
	curr.Steps[0].DurationMS = 1200 // +20%

	if d := DiffResults(prev, curr, 0); len(d.DurationDrift) != 0 {
		t.Fatalf("default threshold: drift = %+v, want none (20%% < 25%%)", d.DurationDrift)
	}
	if d := DiffResults(prev, curr, 0.10); len(d.DurationDrift) != 1 {
		t.Fatalf("10%% threshold: drift = %+v, want 1 (20%% > 10%%)", d.DurationDrift)
	}
}
