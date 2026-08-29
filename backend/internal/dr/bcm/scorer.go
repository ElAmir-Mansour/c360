package bcm

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// Verdict is a control's evaluation outcome. The three-valued result lets the
// gap analysis distinguish a clean pass, a near-miss worth flagging, and an
// outright failure.
type Verdict string

const (
	// VerdictSatisfied: the control's rule is fully met by the evidence.
	VerdictSatisfied Verdict = "satisfied"
	// VerdictPartial: the rule is nearly met (a stale-but-passing drill, an RTO
	// within tolerance, some-but-not-all recovery points immutable). Contributes
	// half weight to the score and appears in the gap list.
	VerdictPartial Verdict = "partial"
	// VerdictFailed: the rule is unmet, OR the required evidence was absent. A
	// control with NO evidence is failed — never vacuously passed.
	VerdictFailed Verdict = "failed"
)

// score returns the fraction of weight a verdict contributes: satisfied=1.0,
// partial=0.5, failed=0.0.
func (v Verdict) score() float64 {
	switch v {
	case VerdictSatisfied:
		return 1.0
	case VerdictPartial:
		return 0.5
	default:
		return 0.0
	}
}

// ControlResult is the per-control outcome: the verdict, a human-readable reason
// (the gap explanation when not satisfied), and the evidence ids that drove it
// (auditor traceability). EvidenceRefs are stable string ids so the report is
// reproducible.
type ControlResult struct {
	Code         string   `json:"code"`
	Title        string   `json:"title"`
	Verdict      Verdict  `json:"verdict"`
	Reason       string   `json:"reason"`
	Mandatory    bool     `json:"mandatory"`
	Weight       int      `json:"weight"`
	EvidenceRefs []string `json:"evidence_refs,omitempty"`
}

// Gap is one unmet (failed or partial) control surfaced for remediation, with
// the reason it is unmet.
type Gap struct {
	Code      string  `json:"code"`
	Title     string  `json:"title"`
	Verdict   Verdict `json:"verdict"`
	Reason    string  `json:"reason"`
	Mandatory bool    `json:"mandatory"`
}

// Assessment is the scored result of evaluating a pack against evidence. Score
// is the weighted compliance percentage (0..100). Compliant is true only when
// every mandatory control is satisfied AND the score meets the pass threshold.
// Gaps lists every control that is not fully satisfied.
type Assessment struct {
	PackKey        string          `json:"pack_key"`
	Standard       string          `json:"standard"`
	GroupID        string          `json:"group_id"`
	Score          float64         `json:"score"`
	Compliant      bool            `json:"compliant"`
	TotalControls  int             `json:"total_controls"`
	Satisfied      int             `json:"satisfied"`
	Partial        int             `json:"partial"`
	Failed         int             `json:"failed"`
	ControlResults []ControlResult `json:"control_results"`
	Gaps           []Gap           `json:"gaps"`
	EvaluatedAt    time.Time       `json:"evaluated_at"`
}

// passThreshold is the minimum weighted score for a non-mandatory-blocked pack
// to be considered compliant. A pack with a partial-only profile can still pass
// if it clears this and has no failed mandatory controls.
const passThreshold = 85.0

// Scorer evaluates a pack's controls against collected evidence using an
// injected clock, so every time-windowed rule (drill-recency, recovery-point
// freshness) is deterministic in tests. The Scorer holds no other state.
type Scorer struct {
	now func() time.Time
}

// NewScorer constructs a Scorer. A nil clock defaults to time.Now; tests inject
// a fixed clock so date-window rules are reproducible.
func NewScorer(clock func() time.Time) *Scorer {
	if clock == nil {
		clock = time.Now
	}
	return &Scorer{now: clock}
}

// Score evaluates every control in pack against ev and returns the assessment.
// Evaluation is deterministic: controls are scored in catalog order, the score
// is the weighted sum of verdict fractions over total weight, and the gap list
// is catalog-ordered. A control whose required evidence kind was not collectable
// (nil source) or whose evidence set is empty is failed with an explicit reason.
func (s *Scorer) Score(pack Pack, ev *Evidence) Assessment {
	now := s.now()
	results := make([]ControlResult, 0, len(pack.Controls))
	gaps := make([]Gap, 0)

	var weightedScore float64
	totalWeight := pack.totalWeight()
	var satisfied, partial, failed int
	mandatoryBreached := false

	for _, c := range pack.Controls {
		res := s.evaluate(c, ev, now)
		results = append(results, res)

		weightedScore += res.Verdict.score() * float64(c.effectiveWeight())

		switch res.Verdict {
		case VerdictSatisfied:
			satisfied++
		case VerdictPartial:
			partial++
		default:
			failed++
		}

		if res.Verdict != VerdictSatisfied {
			gaps = append(gaps, Gap{
				Code:      res.Code,
				Title:     res.Title,
				Verdict:   res.Verdict,
				Reason:    res.Reason,
				Mandatory: res.Mandatory,
			})
			if c.Mandatory {
				mandatoryBreached = true
			}
		}
	}

	score := 0.0
	if totalWeight > 0 {
		score = roundPct(weightedScore / float64(totalWeight) * 100.0)
	}

	return Assessment{
		PackKey:        pack.Key,
		Standard:       pack.Standard,
		Score:          score,
		Compliant:      !mandatoryBreached && score >= passThreshold,
		TotalControls:  len(pack.Controls),
		Satisfied:      satisfied,
		Partial:        partial,
		Failed:         failed,
		ControlResults: results,
		Gaps:           gaps,
		EvaluatedAt:    now,
	}
}

// roundPct rounds a percentage to two decimals so the score is stable across
// runs (no float drift in the persisted/serialised value).
func roundPct(v float64) float64 {
	return math.Round(v*100) / 100
}

// evaluate dispatches a control to its rule evaluator. The switch is exhaustive
// over the rule kinds the catalog validator admits; an unhandled kind (only
// reachable if the validator is bypassed) fails closed with an explicit reason
// rather than vacuously passing.
func (s *Scorer) evaluate(c Control, ev *Evidence, now time.Time) ControlResult {
	base := ControlResult{
		Code:      c.Code,
		Title:     c.Title,
		Mandatory: c.Mandatory,
		Weight:    c.effectiveWeight(),
	}

	// Guard: every required evidence kind must have been collectable. An absent
	// source means we cannot prove the control, so it fails (not passes).
	for _, kind := range c.RequiredEvidence {
		if !ev.Available(kind) {
			base.Verdict = VerdictFailed
			base.Reason = fmt.Sprintf("evidence source for %q is unavailable; control cannot be verified", kind)
			return base
		}
	}

	switch c.Rule.Kind {
	case RuleDrillRecency:
		return s.evalDrillRecency(c, ev, now, base)
	case RuleRTOMet:
		return s.evalRTOMet(c, ev, base)
	case RuleRPOMet:
		return s.evalRPOMet(c, ev, base)
	case RuleRecoveryPointValidated:
		return s.evalRecoveryPointValidated(c, ev, now, base)
	case RuleImmutabilityEnabled:
		return s.evalImmutability(c, ev, now, base)
	case RuleCleanRoomVerified:
		return s.evalCleanRoom(c, ev, now, base)
	case RuleAttestationIssued:
		return s.evalAttestation(c, ev, now, base)
	case RuleGroupConfigured:
		return s.evalGroupConfigured(c, ev, base)
	default:
		base.Verdict = VerdictFailed
		base.Reason = fmt.Sprintf("unsupported rule kind %q", c.Rule.Kind)
		return base
	}
}

// evalDrillRecency: a passing drill within the window whose actual RTO met the
// objective satisfies the control. A passing drill that is stale OR missed RTO
// is partial. No passing drill is a failure.
func (s *Scorer) evalDrillRecency(c Control, ev *Evidence, now time.Time, base ControlResult) ControlResult {
	rule := c.Rule
	min := rule.effectiveMinCount()

	// Sort newest-first so "most recent" is deterministic.
	drills := append([]DrillEvidence(nil), ev.Drills...)
	sort.SliceStable(drills, func(i, j int) bool { return drills[i].ExecutedAt.After(drills[j].ExecutedAt) })

	if len(drills) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no DR drills recorded for this group"
		return base
	}

	var freshPassing, anyPassing int
	var bestFresh *DrillEvidence
	var stalePassing *DrillEvidence
	rtoMissedFresh := false

	for i := range drills {
		d := drills[i]
		if !d.Passed {
			continue
		}
		anyPassing++
		fresh := rule.withinWindow(d.ExecutedAt, now)
		rtoOK := rtoMet(d.RTOActualSeconds, d.RTOObjectiveSeconds, rule.RTOObjectiveSeconds)
		if fresh {
			if rtoOK {
				freshPassing++
				if bestFresh == nil {
					bestFresh = &drills[i]
				}
			} else {
				rtoMissedFresh = true
			}
		} else if stalePassing == nil {
			stalePassing = &drills[i]
		}
	}

	switch {
	case freshPassing >= min:
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("%d passing drill(s) within %dd met RTO objective", freshPassing, rule.WindowDays)
		base.EvidenceRefs = []string{bestFresh.ID.String()}
		return base
	case rtoMissedFresh:
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("a passing drill ran within %dd but missed its RTO objective", rule.WindowDays)
		return base
	case stalePassing != nil:
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("most recent passing drill (%s) is older than %dd", stalePassing.ExecutedAt.Format("2006-01-02"), rule.WindowDays)
		base.EvidenceRefs = []string{stalePassing.ID.String()}
		return base
	case anyPassing > 0:
		// Passing drills exist but neither fresh+RTO-met nor identified stale —
		// defensive branch; treat as partial.
		base.Verdict = VerdictPartial
		base.Reason = "passing drills exist but none within the window met the RTO objective"
		return base
	default:
		base.Verdict = VerdictFailed
		base.Reason = "no successful DR drill on record"
		return base
	}
}

// evalRTOMet: the most recent completed run achieved RTO actual <= objective.
func (s *Scorer) evalRTOMet(c Control, ev *Evidence, base ControlResult) ControlResult {
	runs := completedRuns(ev.Failovers)
	if len(runs) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no completed failover/drill run to evidence RTO"
		return base
	}
	latest := runs[0]
	objective := effectiveObjective(latest.RTOObjectiveSeconds, c.Rule.RTOObjectiveSeconds)
	base.EvidenceRefs = []string{latest.ID.String()}
	if rtoMet(latest.RTOActualSeconds, latest.RTOObjectiveSeconds, c.Rule.RTOObjectiveSeconds) {
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("latest run RTO %ds <= objective %ds", latest.RTOActualSeconds, objective)
		return base
	}
	if withinTolerance(latest.RTOActualSeconds, objective, c.Rule.effectivePartialTolerance()) {
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("latest run RTO %ds exceeded objective %ds but is within tolerance", latest.RTOActualSeconds, objective)
		return base
	}
	base.Verdict = VerdictFailed
	base.Reason = fmt.Sprintf("latest run RTO %ds exceeded objective %ds beyond tolerance", latest.RTOActualSeconds, objective)
	return base
}

// evalRPOMet: the freshest validated recovery point achieved RPO <= objective.
func (s *Scorer) evalRPOMet(c Control, ev *Evidence, base ControlResult) ControlResult {
	rps := sortedRecoveryPoints(ev.RecoveryPoints)
	var chosen *RecoveryPointEvidence
	for i := range rps {
		if rps[i].IsValidated {
			chosen = &rps[i]
			break
		}
	}
	if chosen == nil {
		base.Verdict = VerdictFailed
		base.Reason = "no validated recovery point to evidence RPO"
		return base
	}
	objective := c.Rule.RPOObjectiveSeconds
	if objective <= 0 {
		// No pack-level RPO override: fall back to the GA objective of 300s so the
		// rule is never unbounded.
		objective = 300
	}
	base.EvidenceRefs = []string{chosen.ID.String()}
	if chosen.RPOSeconds <= objective {
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("freshest validated recovery point RPO %ds <= objective %ds", chosen.RPOSeconds, objective)
		return base
	}
	if withinTolerance(chosen.RPOSeconds, objective, c.Rule.effectivePartialTolerance()) {
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("recovery point RPO %ds exceeded objective %ds but within tolerance", chosen.RPOSeconds, objective)
		return base
	}
	base.Verdict = VerdictFailed
	base.Reason = fmt.Sprintf("recovery point RPO %ds exceeded objective %ds beyond tolerance", chosen.RPOSeconds, objective)
	return base
}

// evalRecoveryPointValidated: a validated recovery point with ratio >= MinRatio
// sealed within the window satisfies; validated-but-stale or below-ratio is
// partial; none validated fails.
func (s *Scorer) evalRecoveryPointValidated(c Control, ev *Evidence, now time.Time, base ControlResult) ControlResult {
	rps := sortedRecoveryPoints(ev.RecoveryPoints)
	if len(rps) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no recovery points recorded for this group"
		return base
	}
	minRatio := c.Rule.effectiveMinRatio()

	var freshGood *RecoveryPointEvidence
	var staleGood *RecoveryPointEvidence
	var lowRatio *RecoveryPointEvidence
	for i := range rps {
		rp := &rps[i]
		if !rp.IsValidated {
			continue
		}
		ratioOK := rp.ValidationRatio >= minRatio
		fresh := c.Rule.withinWindow(rp.SealedAt, now)
		switch {
		case ratioOK && fresh && freshGood == nil:
			freshGood = rp
		case ratioOK && !fresh && staleGood == nil:
			staleGood = rp
		case !ratioOK && lowRatio == nil:
			lowRatio = rp
		}
	}

	switch {
	case freshGood != nil:
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("validated recovery point (ratio %.4f) sealed within %dd", freshGood.ValidationRatio, c.Rule.WindowDays)
		base.EvidenceRefs = []string{freshGood.ID.String()}
		return base
	case staleGood != nil:
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("validated recovery point exists but is older than %dd", c.Rule.WindowDays)
		base.EvidenceRefs = []string{staleGood.ID.String()}
		return base
	case lowRatio != nil:
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("validated recovery point ratio %.4f below required %.4f", lowRatio.ValidationRatio, minRatio)
		base.EvidenceRefs = []string{lowRatio.ID.String()}
		return base
	default:
		base.Verdict = VerdictFailed
		base.Reason = "no validated recovery point on record"
		return base
	}
}

// evalImmutability: every retained recovery point is WORM-immutable with a
// future retention horizon. All immutable => satisfied; some => partial; none
// (or no recovery points) => failed.
func (s *Scorer) evalImmutability(c Control, ev *Evidence, now time.Time, base ControlResult) ControlResult {
	rps := ev.RecoveryPoints
	if len(rps) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no recovery points to protect with immutability"
		return base
	}
	var immutable, total int
	refs := make([]string, 0, len(rps))
	for i := range rps {
		rp := rps[i]
		total++
		// Immutable requires the WORM flag AND a retention horizon still in the
		// future — an expired lock no longer protects the object.
		if rp.Immutable && rp.RetentionUntil.After(now) {
			immutable++
			refs = append(refs, rp.ID.String())
		}
	}
	switch {
	case immutable == total:
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("all %d recovery point(s) are WORM-immutable with future retention", total)
		base.EvidenceRefs = refs
		return base
	case immutable > 0:
		base.Verdict = VerdictPartial
		base.Reason = fmt.Sprintf("%d of %d recovery point(s) are immutable", immutable, total)
		base.EvidenceRefs = refs
		return base
	default:
		base.Verdict = VerdictFailed
		base.Reason = "no recovery point is held under WORM immutability with a future retention horizon"
		return base
	}
}

// evalCleanRoom: the latest verdict is clean and within the window => satisfied;
// a clean verdict exists but only stale => partial; latest is not clean or none
// => failed.
func (s *Scorer) evalCleanRoom(c Control, ev *Evidence, now time.Time, base ControlResult) ControlResult {
	scans := append([]CleanRoomEvidence(nil), ev.CleanRoom...)
	sort.SliceStable(scans, func(i, j int) bool { return scans[i].VerifiedAt.After(scans[j].VerifiedAt) })
	if len(scans) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no clean-room scan recorded for this group"
		return base
	}
	latest := scans[0]
	if !latest.Clean {
		base.Verdict = VerdictFailed
		base.Reason = fmt.Sprintf("latest clean-room verdict is %q (not clean)", latest.Verdict)
		base.EvidenceRefs = []string{latest.ID.String()}
		return base
	}
	if c.Rule.withinWindow(latest.VerifiedAt, now) {
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("clean-room verified clean within %dd", c.Rule.WindowDays)
		base.EvidenceRefs = []string{latest.ID.String()}
		return base
	}
	base.Verdict = VerdictPartial
	base.Reason = fmt.Sprintf("clean-room verdict is clean but older than %dd", c.Rule.WindowDays)
	base.EvidenceRefs = []string{latest.ID.String()}
	return base
}

// evalAttestation: an attestation within the window => satisfied; only a stale
// one => partial; none => failed.
func (s *Scorer) evalAttestation(c Control, ev *Evidence, now time.Time, base ControlResult) ControlResult {
	atts := append([]AttestationEvidence(nil), ev.Attestations...)
	sort.SliceStable(atts, func(i, j int) bool { return atts[i].CreatedAt.After(atts[j].CreatedAt) })
	if len(atts) == 0 {
		base.Verdict = VerdictFailed
		base.Reason = "no attestation issued for this group"
		return base
	}
	latest := atts[0]
	if c.Rule.withinWindow(latest.CreatedAt, now) {
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("attestation issued within %dd", c.Rule.WindowDays)
		base.EvidenceRefs = []string{latest.ID.String()}
		return base
	}
	base.Verdict = VerdictPartial
	base.Reason = fmt.Sprintf("most recent attestation is older than %dd", c.Rule.WindowDays)
	base.EvidenceRefs = []string{latest.ID.String()}
	return base
}

// evalGroupConfigured: the group exists with >= MinCount members and a stream.
func (s *Scorer) evalGroupConfigured(c Control, ev *Evidence, base ControlResult) ControlResult {
	topo := ev.Topology
	if !topo.Exists {
		base.Verdict = VerdictFailed
		base.Reason = "consistency group does not exist"
		return base
	}
	min := c.Rule.effectiveMinCount()
	base.EvidenceRefs = []string{topo.GroupID.String()}
	if topo.MemberCount >= min && topo.HasStream {
		base.Verdict = VerdictSatisfied
		base.Reason = fmt.Sprintf("group has %d member(s) and an active replication stream", topo.MemberCount)
		return base
	}
	if topo.MemberCount >= min || topo.HasStream {
		base.Verdict = VerdictPartial
		if !topo.HasStream {
			base.Reason = fmt.Sprintf("group has %d member(s) but no replication stream", topo.MemberCount)
		} else {
			base.Reason = fmt.Sprintf("group has a stream but only %d member(s) (need %d)", topo.MemberCount, min)
		}
		return base
	}
	base.Verdict = VerdictFailed
	base.Reason = "group is not configured for recovery (no members, no stream)"
	return base
}

// ---------------------------------------------------------------------------
// Shared deterministic helpers.
// ---------------------------------------------------------------------------

// effectiveObjective resolves the objective to compare against: a non-zero
// pack-level override wins over the evidence-carried objective.
func effectiveObjective(evidenceObjective, ruleOverride int) int {
	if ruleOverride > 0 {
		return ruleOverride
	}
	if evidenceObjective > 0 {
		return evidenceObjective
	}
	return 0
}

// rtoMet reports whether an actual RTO meets the resolved objective. A
// zero/unknown objective means the rule cannot be proven met (returns false),
// so an unconfigured objective never vacuously passes.
func rtoMet(actual, evidenceObjective, ruleOverride int) bool {
	objective := effectiveObjective(evidenceObjective, ruleOverride)
	if objective <= 0 {
		return false
	}
	return actual > 0 && actual <= objective
}

// withinTolerance reports whether actual exceeds objective only within the
// partial tolerance multiple (objective > 0, tolerance >= 1).
func withinTolerance(actual, objective int, tolerance float64) bool {
	if objective <= 0 || actual <= 0 {
		return false
	}
	limit := float64(objective) * tolerance
	return float64(actual) <= limit
}

// completedRuns returns the failover runs that completed with a positive actual
// RTO, newest first. In-flight or zero-RTO runs are excluded.
func completedRuns(in []FailoverEvidence) []FailoverEvidence {
	out := make([]FailoverEvidence, 0, len(in))
	for _, r := range in {
		if r.Status == "COMPLETED" && r.RTOActualSeconds > 0 && !r.CompletedAt.IsZero() {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CompletedAt.After(out[j].CompletedAt) })
	return out
}

// sortedRecoveryPoints returns recovery points newest-sealed first.
func sortedRecoveryPoints(in []RecoveryPointEvidence) []RecoveryPointEvidence {
	out := append([]RecoveryPointEvidence(nil), in...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].SealedAt.After(out[j].SealedAt) })
	return out
}
