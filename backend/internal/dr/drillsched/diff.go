package drillsched

import (
	"math"
	"sort"
)

// DiffResults computes the structured difference from a previous drill result to
// the current one for the same schedule/group. It is a pure function (no I/O) so
// the diff rules are unit-tested directly. driftThreshold is the proportional
// step-duration change above which a step is reported as drifted; pass <= 0 to
// use the package default (25%).
//
// What it surfaces (the real algorithm, not a placeholder):
//   - outcome transitions: pass<->fail, and the directional regressed/recovered;
//   - RTO/RPO deltas (current - previous) and whether they regressed (got worse);
//   - step transitions keyed by stable step Key: newly failed, newly passed,
//     added (present only now), removed (present only before);
//   - per-step duration drift: for a step present in both, |Δduration|/previous
//     exceeding the threshold (with a signed change fraction so callers can tell
//     slower from faster), guarding division by zero;
//   - asset/topology drift: members added/removed/reordered, edges added/removed.
//
// All slice outputs are sorted so equal inputs yield an equal diff.
func DiffResults(previous, current *DrillResult, driftThreshold float64) DrillDiff {
	if driftThreshold <= 0 {
		driftThreshold = durationDriftThreshold
	}
	diff := DrillDiff{
		GroupID:         current.GroupID,
		ScheduleID:      current.ScheduleID,
		CurrentResultID: current.ID,
	}
	if previous != nil {
		diff.PreviousResultID = previous.ID
	}

	// --- Outcome transitions -------------------------------------------------
	diff.CurrentPassed = current.Passed
	if previous != nil {
		diff.PreviousPassed = previous.Passed
		diff.PassedChanged = previous.Passed != current.Passed
		diff.NewlyRegressed = previous.Passed && !current.Passed
		diff.NewlyRecovered = !previous.Passed && current.Passed
	} else {
		// No predecessor: the current outcome is itself "new". A failing first
		// drill is reported as a regression so it is not silently swallowed.
		diff.PreviousPassed = true
		diff.PassedChanged = !current.Passed
		diff.NewlyRegressed = !current.Passed
	}

	// --- RTO / RPO deltas ----------------------------------------------------
	if previous != nil {
		diff.RTODeltaSeconds = current.RTOAchievedSeconds - previous.RTOAchievedSeconds
		diff.RPODeltaSeconds = current.RPOAchievedSeconds - previous.RPOAchievedSeconds
		diff.RTORegressed = diff.RTODeltaSeconds > 0
		diff.RPORegressed = diff.RPODeltaSeconds > 0
	}

	// --- Step transitions + duration drift -----------------------------------
	// Only meaningful against a predecessor. For a first result there is no
	// baseline, so reporting every step as "added" would be noise; the outcome
	// flags above already capture a failing first drill.
	if previous != nil {
		prevSteps := indexSteps(previous.Steps)
		currSteps := indexSteps(current.Steps)
		diff.NewlyFailedSteps, diff.NewlyPassedSteps, diff.AddedSteps, diff.RemovedSteps, diff.DurationDrift =
			diffSteps(prevSteps, currSteps, driftThreshold)

		// --- Asset / topology drift -----------------------------------------
		diff.AssetDrift = diffFingerprints(previous.AssetFingerprint, current.AssetFingerprint)
	}

	return diff
}

// indexSteps builds a Key->step map. The failover driver guarantees one row per
// (run, step) so a step key is unique within a result; a plain map is correct.
// On the (defensive) chance of a duplicate key in malformed input, the last one
// wins — the diff is still deterministic.
func indexSteps(steps []DrillStep) map[string]DrillStep {
	m := make(map[string]DrillStep, len(steps))
	for _, s := range steps {
		m[s.Key] = s
	}
	return m
}

// diffSteps computes the four step-transition sets plus duration drift between
// two indexed step maps.
func diffSteps(prev, curr map[string]DrillStep, threshold float64) (newlyFailed, newlyPassed, added, removed []string, drift []StepDurationDrift) {
	for key, cs := range curr {
		ps, existed := prev[key]
		if !existed {
			added = append(added, key)
			// A brand-new step that is already failing counts as newly failed too,
			// so a new gate that fails on its first appearance is surfaced.
			if !cs.Passed() {
				newlyFailed = append(newlyFailed, key)
			}
			continue
		}
		// Step present in both: detect a pass/fail transition.
		switch {
		case ps.Passed() && !cs.Passed():
			newlyFailed = append(newlyFailed, key)
		case !ps.Passed() && cs.Passed():
			newlyPassed = append(newlyPassed, key)
		}
		// Duration drift, guarding division by zero.
		if d, ok := durationDrift(key, ps.DurationMS, cs.DurationMS, threshold); ok {
			drift = append(drift, d)
		}
	}
	for key := range prev {
		if _, ok := curr[key]; !ok {
			removed = append(removed, key)
		}
	}

	sort.Strings(newlyFailed)
	sort.Strings(newlyPassed)
	sort.Strings(added)
	sort.Strings(removed)
	sort.Slice(drift, func(i, j int) bool { return drift[i].Key < drift[j].Key })
	return newlyFailed, newlyPassed, added, removed, drift
}

// durationDrift reports whether a step's duration changed beyond the threshold.
// The change fraction is signed (positive = slower now). When the previous
// duration is zero, any non-zero current duration is reported as drift with an
// undefined-but-finite fraction (we use the current value's sign), since a
// proportional change is undefined against zero.
func durationDrift(key string, prevMS, currMS int64, threshold float64) (StepDurationDrift, bool) {
	deltaMS := currMS - prevMS
	if deltaMS == 0 {
		return StepDurationDrift{}, false
	}
	var fraction float64
	if prevMS == 0 {
		// No baseline: emit drift (a step that went from 0ms to non-zero IS a
		// change), with a fraction of +/-1.0 to denote a full-magnitude shift.
		fraction = math.Copysign(1.0, float64(deltaMS))
	} else {
		fraction = float64(deltaMS) / float64(prevMS)
	}
	if math.Abs(fraction) < threshold {
		return StepDurationDrift{}, false
	}
	return StepDurationDrift{
		Key:            key,
		PreviousMS:     prevMS,
		CurrentMS:      currMS,
		DeltaMS:        deltaMS,
		ChangeFraction: fraction,
	}, true
}

// diffFingerprints computes member and edge drift between two asset fingerprints.
func diffFingerprints(prev, curr AssetFingerprint) AssetDrift {
	var drift AssetDrift

	for site, order := range curr.Members {
		prevOrder, existed := prev.Members[site]
		if !existed {
			drift.AddedMembers = append(drift.AddedMembers, site)
			continue
		}
		if prevOrder != order {
			drift.ReorderedMembers = append(drift.ReorderedMembers, MemberReorder{
				SiteID:    site,
				FromOrder: prevOrder,
				ToOrder:   order,
			})
		}
	}
	for site := range prev.Members {
		if _, ok := curr.Members[site]; !ok {
			drift.RemovedMembers = append(drift.RemovedMembers, site)
		}
	}

	prevEdges := stringSet(prev.TopologyEdges)
	currEdges := stringSet(curr.TopologyEdges)
	for e := range currEdges {
		if _, ok := prevEdges[e]; !ok {
			drift.AddedEdges = append(drift.AddedEdges, e)
		}
	}
	for e := range prevEdges {
		if _, ok := currEdges[e]; !ok {
			drift.RemovedEdges = append(drift.RemovedEdges, e)
		}
	}

	sort.Strings(drift.AddedMembers)
	sort.Strings(drift.RemovedMembers)
	sort.Strings(drift.AddedEdges)
	sort.Strings(drift.RemovedEdges)
	sort.Slice(drift.ReorderedMembers, func(i, j int) bool {
		return drift.ReorderedMembers[i].SiteID < drift.ReorderedMembers[j].SiteID
	})
	return drift
}

// stringSet builds a set from a slice.
func stringSet(in []string) map[string]struct{} {
	m := make(map[string]struct{}, len(in))
	for _, s := range in {
		m[s] = struct{}{}
	}
	return m
}
