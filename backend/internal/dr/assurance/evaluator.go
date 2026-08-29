package assurance

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

const (
	controlWeight = 10
	rpoWarnRatio  = 0.8
)

// Evaluator evaluates continuous recovery assurance with an injected clock so
// every time-windowed check remains deterministic in tests.
type Evaluator struct {
	now func() time.Time
}

// NewEvaluator constructs an Evaluator. A nil clock defaults to time.Now.
func NewEvaluator(clock func() time.Time) *Evaluator {
	if clock == nil {
		clock = time.Now
	}
	return &Evaluator{now: clock}
}

// Evaluate evaluates profile and evidence with the Evaluator's clock.
func (e *Evaluator) Evaluate(profile AssuranceProfile, evidence AssuranceEvidence) AssuranceAssessment {
	return evaluate(profile.withDefaults(), evidence, e.now())
}

// Evaluate scores profile and evidence at now. If now is zero, time.Now is used.
func Evaluate(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) AssuranceAssessment {
	if now.IsZero() {
		now = time.Now()
	}
	return evaluate(profile.withDefaults(), evidence, now)
}

type assuranceControl struct {
	code         string
	title        string
	weight       int
	failSeverity Severity
	eval         func(AssuranceProfile, AssuranceEvidence, time.Time) controlOutcome
}

type controlOutcome struct {
	verdict        Verdict
	message        string
	recommendation string
	evidenceRefs   []string
}

var assuranceControls = []assuranceControl{
	{
		code:         "drill_cadence",
		title:        "drill cadence",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalDrillCadence,
	},
	{
		code:         "nondisruptive_drill_success",
		title:        "nondisruptive drill success",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalNondisruptiveDrill,
	},
	{
		code:         "app_verification_success",
		title:        "application verification success",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalAppVerification,
	},
	{
		code:         "clean_room_verification",
		title:        "clean-room verification",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalCleanRoomVerification,
	},
	{
		code:         "rpo_breach_status",
		title:        "RPO breach status",
		weight:       controlWeight,
		failSeverity: SeverityCritical,
		eval:         evalRPOBreach,
	},
	{
		code:         "infra_drift",
		title:        "infrastructure drift",
		weight:       controlWeight,
		failSeverity: SeverityCritical,
		eval:         evalInfraDrift,
	},
	{
		code:         "runbook_freshness",
		title:        "runbook freshness",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalRunbookFreshness,
	},
	{
		code:         "dependency_bootgraph_validation",
		title:        "dependency and bootgraph validation",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalDependencyBootGraph,
	},
	{
		code:         "last_failback_test",
		title:        "last failback test",
		weight:       controlWeight,
		failSeverity: SeverityHigh,
		eval:         evalFailbackTest,
	},
	{
		code:         "evidence_recency",
		title:        "evidence recency",
		weight:       controlWeight,
		failSeverity: SeverityCritical,
		eval:         evalEvidenceRecency,
	},
}

func evaluate(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) AssuranceAssessment {
	results := make([]CheckResult, 0, len(assuranceControls))
	findings := make([]Finding, 0)
	recommendations := make([]string, 0)
	seenRecommendations := make(map[string]struct{})

	totalWeight := 0
	earned := 0.0
	var satisfied, partial, failed int
	highest := VerdictSatisfied

	for _, c := range assuranceControls {
		totalWeight += c.weight
		out := c.eval(profile, evidence, now)
		earned += out.verdict.score() * float64(c.weight)

		severity := Severity("")
		switch out.verdict {
		case VerdictSatisfied:
			satisfied++
		case VerdictPartial:
			partial++
			severity = SeverityWarning
			if highest == VerdictSatisfied {
				highest = VerdictPartial
			}
		default:
			failed++
			severity = c.failSeverity
			highest = VerdictFailed
		}

		result := CheckResult{
			Code:           c.code,
			Title:          c.title,
			Verdict:        out.verdict,
			Severity:       severity,
			Weight:         c.weight,
			Message:        out.message,
			Recommendation: out.recommendation,
			EvidenceRefs:   append([]string(nil), out.evidenceRefs...),
		}
		results = append(results, result)

		if out.verdict == VerdictSatisfied {
			continue
		}
		findings = append(findings, Finding{
			Code:           result.Code,
			Title:          result.Title,
			Verdict:        result.Verdict,
			Severity:       result.Severity,
			Weight:         result.Weight,
			Message:        result.Message,
			Recommendation: result.Recommendation,
			EvidenceRefs:   append([]string(nil), result.EvidenceRefs...),
		})
		if out.recommendation != "" {
			if _, ok := seenRecommendations[out.recommendation]; !ok {
				seenRecommendations[out.recommendation] = struct{}{}
				recommendations = append(recommendations, out.recommendation)
			}
		}
	}

	score := 0.0
	if totalWeight > 0 {
		score = roundPct(earned / float64(totalWeight) * 100)
	}

	return AssuranceAssessment{
		ProfileID:       profile.ID,
		TenantID:        profile.TenantID,
		GroupID:         profile.GroupID,
		WorkloadID:      profile.WorkloadID,
		Score:           clampScore(score),
		Verdict:         highest,
		TotalChecks:     len(assuranceControls),
		Satisfied:       satisfied,
		Partial:         partial,
		Failed:          failed,
		Results:         results,
		Findings:        findings,
		Recommendations: recommendations,
		EvaluatedAt:     now,
	}
}

func evalDrillCadence(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) controlOutcome {
	drill, ok := latestDrill(evidence.Drills, nil)
	if !ok {
		return failed("no drill evidence is recorded", RecommendationScheduleDrill)
	}
	age := freshness(profile.DrillCadenceDays, drill.ObservedAt(), now)
	refs := []string{drill.ID}
	switch age {
	case VerdictSatisfied:
		if drill.Passed {
			return satisfied(refs...)
		}
		return partial("latest drill is recent, but did not pass", RecommendationScheduleDrill, refs...)
	case VerdictPartial:
		return partial("latest drill is outside the required cadence window", RecommendationScheduleDrill, refs...)
	default:
		return failed("latest drill evidence is stale or undated", RecommendationScheduleDrill, refs...)
	}
}

func evalNondisruptiveDrill(profile AssuranceProfile, evidence AssuranceEvidence, _ time.Time) controlOutcome {
	if !profile.RequireNondisruptiveDrills {
		return satisfied()
	}
	drill, ok := latestDrill(evidence.Drills, func(d DrillEvidence) bool { return d.NonDisruptive })
	if !ok {
		return failed("no nondisruptive drill evidence is recorded", RecommendationScheduleDrill)
	}
	refs := []string{drill.ID}
	switch {
	case drill.Passed && drill.Warnings == 0 && len(drill.FailedSteps) == 0:
		return satisfied(refs...)
	case drill.Passed:
		return partial("latest nondisruptive drill passed with warnings", RecommendationScheduleDrill, refs...)
	default:
		return failed("latest nondisruptive drill did not pass", RecommendationScheduleDrill, refs...)
	}
}

func evalAppVerification(profile AssuranceProfile, evidence AssuranceEvidence, _ time.Time) controlOutcome {
	verification, ok := latestVerification(evidence.Verifications, VerificationApp)
	if !ok {
		return failed("no application verification evidence is recorded", RecommendationRerunAppVerification)
	}
	refs := []string{verification.ID}
	ratio := passRatio(verification)
	switch {
	case !verification.Passed:
		return failed("latest application verification did not pass", RecommendationRerunAppVerification, refs...)
	case ratio < profile.MinAppVerificationPassRatio:
		msg := fmt.Sprintf("application verification pass ratio %.2f is below required %.2f", ratio, profile.MinAppVerificationPassRatio)
		return failed(msg, RecommendationRerunAppVerification, refs...)
	case verification.Warnings > 0 || (verification.ChecksTotal > 0 && verification.ChecksPassed < verification.ChecksTotal):
		return partial("latest application verification passed with warnings", RecommendationRerunAppVerification, refs...)
	default:
		return satisfied(refs...)
	}
}

func evalCleanRoomVerification(profile AssuranceProfile, evidence AssuranceEvidence, _ time.Time) controlOutcome {
	if !profile.RequireCleanRoomVerification {
		return satisfied()
	}
	verification, ok := latestVerification(evidence.Verifications, VerificationCleanRoom)
	if !ok {
		return failed("no clean-room verification evidence is recorded", RecommendationRunCleanRoom)
	}
	refs := []string{verification.ID}
	switch {
	case verification.Passed && verification.Warnings == 0:
		return satisfied(refs...)
	case verification.Passed:
		return partial("latest clean-room verification passed with warnings", RecommendationRunCleanRoom, refs...)
	default:
		return failed("latest clean-room verification did not pass", RecommendationRunCleanRoom, refs...)
	}
}

func evalRPOBreach(profile AssuranceProfile, evidence AssuranceEvidence, _ time.Time) controlOutcome {
	rpo, ok := latestRPO(evidence.RPO)
	if !ok {
		return failed("no RPO evidence is recorded", RecommendationInvestigateRPO)
	}
	refs := []string{rpo.ID}
	objective := rpoObjective(profile, rpo)
	switch {
	case rpo.Breached || rpo.BreachOpen || rpo.ActualLagSeconds > objective:
		msg := fmt.Sprintf("latest RPO lag %ds exceeds objective %ds", rpo.ActualLagSeconds, objective)
		return failed(msg, RecommendationInvestigateRPO, refs...)
	case rpo.ActualLagSeconds < 0:
		return failed("latest RPO lag is invalid", RecommendationInvestigateRPO, refs...)
	case float64(rpo.ActualLagSeconds) >= float64(objective)*rpoWarnRatio:
		msg := fmt.Sprintf("latest RPO lag %ds is near objective %ds", rpo.ActualLagSeconds, objective)
		return partial(msg, RecommendationInvestigateRPO, refs...)
	default:
		return satisfied(refs...)
	}
}

func evalInfraDrift(_ AssuranceProfile, evidence AssuranceEvidence, _ time.Time) controlOutcome {
	drift, ok := latestDrift(evidence.Drift)
	if !ok {
		return failed("no infrastructure drift evidence is recorded", RecommendationResolveDrift)
	}
	refs := []string{drift.ID}
	switch {
	case drift.CriticalItems > 0:
		msg := fmt.Sprintf("critical infrastructure drift is open: %d critical item(s)", drift.CriticalItems)
		return failed(msg, RecommendationResolveDrift, refs...)
	case drift.DriftDetected || drift.OpenItems > 0:
		msg := fmt.Sprintf("infrastructure drift is open: %d item(s)", openDriftItems(drift))
		return partial(msg, RecommendationResolveDrift, refs...)
	default:
		return satisfied(refs...)
	}
}

func evalRunbookFreshness(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) controlOutcome {
	verification, ok := latestVerification(evidence.Verifications, VerificationRunbookReview)
	if !ok {
		return failed("no runbook review evidence is recorded", RecommendationRefreshRunbook)
	}
	refs := []string{verification.ID}
	if !verification.Passed {
		return failed("latest runbook review did not pass", RecommendationRefreshRunbook, refs...)
	}
	age := freshness(profile.RunbookFreshnessDays, verification.VerifiedAt, now)
	switch age {
	case VerdictSatisfied:
		if verification.Warnings > 0 {
			return partial("latest runbook review passed with warnings", RecommendationRefreshRunbook, refs...)
		}
		return satisfied(refs...)
	case VerdictPartial:
		return partial("runbook review evidence is outside the freshness window", RecommendationRefreshRunbook, refs...)
	default:
		return failed("runbook review evidence is stale or undated", RecommendationRefreshRunbook, refs...)
	}
}

func evalDependencyBootGraph(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) controlOutcome {
	verification, ok := latestVerification(evidence.Verifications, VerificationDependencyBootGraph)
	if !ok {
		return failed("no dependency or bootgraph validation evidence is recorded", RecommendationValidateBootGraph)
	}
	refs := []string{verification.ID}
	if !verification.Passed {
		return failed("latest dependency or bootgraph validation did not pass", RecommendationValidateBootGraph, refs...)
	}
	age := freshness(profile.DependencyValidationDays, verification.VerifiedAt, now)
	switch age {
	case VerdictSatisfied:
		if verification.Warnings > 0 {
			return partial("latest dependency or bootgraph validation passed with warnings", RecommendationValidateBootGraph, refs...)
		}
		return satisfied(refs...)
	case VerdictPartial:
		return partial("dependency or bootgraph validation is outside the freshness window", RecommendationValidateBootGraph, refs...)
	default:
		return failed("dependency or bootgraph validation is stale or undated", RecommendationValidateBootGraph, refs...)
	}
}

func evalFailbackTest(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) controlOutcome {
	verification, ok := latestVerification(evidence.Verifications, VerificationFailback)
	if !ok {
		return failed("no failback test evidence is recorded", RecommendationTestFailback)
	}
	refs := []string{verification.ID}
	if !verification.Passed {
		return failed("latest failback test did not pass", RecommendationTestFailback, refs...)
	}
	age := freshness(profile.FailbackTestDays, verification.VerifiedAt, now)
	switch age {
	case VerdictSatisfied:
		if verification.Warnings > 0 {
			return partial("latest failback test passed with warnings", RecommendationTestFailback, refs...)
		}
		return satisfied(refs...)
	case VerdictPartial:
		return partial("latest failback test is outside the required test window", RecommendationTestFailback, refs...)
	default:
		return failed("latest failback test evidence is stale or undated", RecommendationTestFailback, refs...)
	}
}

func evalEvidenceRecency(profile AssuranceProfile, evidence AssuranceEvidence, now time.Time) controlOutcome {
	type recencyProbe struct {
		name string
		id   string
		at   time.Time
		ok   bool
	}

	drill, hasDrill := latestDrill(evidence.Drills, nil)
	app, hasApp := latestVerification(evidence.Verifications, VerificationApp)
	clean, hasClean := latestVerification(evidence.Verifications, VerificationCleanRoom)
	drift, hasDrift := latestDrift(evidence.Drift)
	rpo, hasRPO := latestRPO(evidence.RPO)

	probes := []recencyProbe{
		{name: "drill", id: drill.ID, at: drill.ObservedAt(), ok: hasDrill},
		{name: "app_verification", id: app.ID, at: app.VerifiedAt, ok: hasApp},
		{name: "drift", id: drift.ID, at: drift.ObservedAt, ok: hasDrift},
		{name: "rpo", id: rpo.ID, at: rpo.MeasuredAt, ok: hasRPO},
	}
	if profile.RequireCleanRoomVerification {
		probes = append(probes, recencyProbe{name: "clean_room", id: clean.ID, at: clean.VerifiedAt, ok: hasClean})
	}

	missing := make([]string, 0)
	stale := make([]string, 0)
	refs := make([]string, 0, len(probes))
	hardFail := false
	for _, probe := range probes {
		if !probe.ok {
			missing = append(missing, probe.name)
			hardFail = true
			continue
		}
		refs = append(refs, probe.id)
		switch freshness(profile.EvidenceRecencyDays, probe.at, now) {
		case VerdictSatisfied:
		case VerdictPartial:
			stale = append(stale, probe.name)
		default:
			stale = append(stale, probe.name)
			hardFail = true
		}
	}

	if len(missing) == 0 && len(stale) == 0 {
		return satisfied(refs...)
	}

	parts := make([]string, 0, 2)
	if len(missing) > 0 {
		parts = append(parts, "missing: "+strings.Join(missing, ","))
	}
	if len(stale) > 0 {
		parts = append(parts, "stale: "+strings.Join(stale, ","))
	}
	msg := "continuous assurance evidence is not current (" + strings.Join(parts, "; ") + ")"
	if hardFail {
		return failed(msg, RecommendationRefreshEvidence, refs...)
	}
	return partial(msg, RecommendationRefreshEvidence, refs...)
}

func (p AssuranceProfile) withDefaults() AssuranceProfile {
	p.DrillCadenceDays = daysOrDefault(p.DrillCadenceDays, DefaultDrillCadenceDays)
	p.EvidenceRecencyDays = daysOrDefault(p.EvidenceRecencyDays, DefaultEvidenceRecencyDays)
	p.RunbookFreshnessDays = daysOrDefault(p.RunbookFreshnessDays, DefaultRunbookFreshnessDays)
	p.DependencyValidationDays = daysOrDefault(p.DependencyValidationDays, DefaultDependencyValidationDays)
	p.FailbackTestDays = daysOrDefault(p.FailbackTestDays, DefaultFailbackTestDays)
	p.RPOObjectiveSeconds = daysOrDefault(p.RPOObjectiveSeconds, DefaultRPOObjectiveSeconds)
	if p.MinAppVerificationPassRatio <= 0 || p.MinAppVerificationPassRatio > 1 {
		p.MinAppVerificationPassRatio = 1
	}
	if !p.RequireCleanRoomVerification {
		p.RequireCleanRoomVerification = true
	}
	if !p.RequireNondisruptiveDrills {
		p.RequireNondisruptiveDrills = true
	}
	return p
}

func (v Verdict) score() float64 {
	switch v {
	case VerdictSatisfied:
		return 1
	case VerdictPartial:
		return 0.5
	default:
		return 0
	}
}

func satisfied(refs ...string) controlOutcome {
	return controlOutcome{verdict: VerdictSatisfied, evidenceRefs: nonEmpty(refs)}
}

func partial(message, recommendation string, refs ...string) controlOutcome {
	return controlOutcome{
		verdict:        VerdictPartial,
		message:        message,
		recommendation: recommendation,
		evidenceRefs:   nonEmpty(refs),
	}
}

func failed(message, recommendation string, refs ...string) controlOutcome {
	return controlOutcome{
		verdict:        VerdictFailed,
		message:        message,
		recommendation: recommendation,
		evidenceRefs:   nonEmpty(refs),
	}
}

func freshness(maxDays int, at, now time.Time) Verdict {
	if at.IsZero() || at.After(now) {
		return VerdictFailed
	}
	if withinDays(at, now, maxDays) {
		return VerdictSatisfied
	}
	if withinDays(at, now, warningDays(maxDays)) {
		return VerdictPartial
	}
	return VerdictFailed
}

func withinDays(t, now time.Time, days int) bool {
	return !t.Before(now.AddDate(0, 0, -days))
}

func daysOrDefault(v, def int) int {
	if v > 0 {
		return v
	}
	return def
}

func warningDays(days int) int {
	if days < 2 {
		return days + 1
	}
	return days + days/2
}

func passRatio(v VerificationEvidence) float64 {
	if v.ChecksTotal <= 0 {
		if v.Passed {
			return 1
		}
		return 0
	}
	if v.ChecksPassed <= 0 {
		return 0
	}
	if v.ChecksPassed > v.ChecksTotal {
		return 1
	}
	return float64(v.ChecksPassed) / float64(v.ChecksTotal)
}

func rpoObjective(profile AssuranceProfile, rpo RPOEvidence) int {
	if rpo.ObjectiveSeconds > 0 {
		return rpo.ObjectiveSeconds
	}
	return profile.RPOObjectiveSeconds
}

func openDriftItems(d DriftEvidence) int {
	if d.OpenItems > 0 {
		return d.OpenItems
	}
	return d.AddedItems + d.RemovedItems + d.ChangedItems
}

func latestDrill(drills []DrillEvidence, filter func(DrillEvidence) bool) (DrillEvidence, bool) {
	var best DrillEvidence
	var bestKey string
	found := false
	for _, drill := range drills {
		if filter != nil && !filter(drill) {
			continue
		}
		key := drillTieKey(drill)
		if !found || newer(drill.ObservedAt(), key, best.ObservedAt(), bestKey) {
			best = drill
			bestKey = key
			found = true
		}
	}
	return best, found
}

func latestVerification(verifications []VerificationEvidence, kind VerificationKind) (VerificationEvidence, bool) {
	var best VerificationEvidence
	var bestKey string
	found := false
	for _, verification := range verifications {
		if verification.Kind != kind {
			continue
		}
		key := verificationTieKey(verification)
		if !found || newer(verification.VerifiedAt, key, best.VerifiedAt, bestKey) {
			best = verification
			bestKey = key
			found = true
		}
	}
	return best, found
}

func latestDrift(items []DriftEvidence) (DriftEvidence, bool) {
	var best DriftEvidence
	var bestKey string
	found := false
	for _, item := range items {
		key := driftTieKey(item)
		if !found || newer(item.ObservedAt, key, best.ObservedAt, bestKey) {
			best = item
			bestKey = key
			found = true
		}
	}
	return best, found
}

func latestRPO(items []RPOEvidence) (RPOEvidence, bool) {
	var best RPOEvidence
	var bestKey string
	found := false
	for _, item := range items {
		key := rpoTieKey(item)
		if !found || newer(item.MeasuredAt, key, best.MeasuredAt, bestKey) {
			best = item
			bestKey = key
			found = true
		}
	}
	return best, found
}

func newer(at time.Time, key string, bestAt time.Time, bestKey string) bool {
	if at.After(bestAt) {
		return true
	}
	if at.Equal(bestAt) && key > bestKey {
		return true
	}
	return false
}

func drillTieKey(d DrillEvidence) string {
	return strings.Join([]string{
		d.ID,
		d.RunID,
		strconv.FormatBool(d.Passed),
		strconv.FormatBool(d.NonDisruptive),
		strconv.Itoa(d.Warnings),
		strings.Join(d.FailedSteps, ","),
	}, "\x00")
}

func verificationTieKey(v VerificationEvidence) string {
	return strings.Join([]string{
		v.ID,
		string(v.Kind),
		strconv.FormatBool(v.Passed),
		strconv.Itoa(v.ChecksPassed),
		strconv.Itoa(v.ChecksTotal),
		strconv.Itoa(v.Warnings),
		v.Message,
	}, "\x00")
}

func driftTieKey(d DriftEvidence) string {
	return strings.Join([]string{
		d.ID,
		strconv.FormatBool(d.DriftDetected),
		strconv.Itoa(d.OpenItems),
		strconv.Itoa(d.CriticalItems),
		strconv.Itoa(d.AddedItems),
		strconv.Itoa(d.RemovedItems),
		strconv.Itoa(d.ChangedItems),
		d.Message,
	}, "\x00")
}

func rpoTieKey(r RPOEvidence) string {
	return strings.Join([]string{
		r.ID,
		strconv.Itoa(r.ObjectiveSeconds),
		strconv.Itoa(r.ActualLagSeconds),
		strconv.FormatBool(r.Breached),
		strconv.FormatBool(r.BreachOpen),
		r.RecoveryPointID,
		r.ReplicationStreamID,
	}, "\x00")
}

func nonEmpty(refs []string) []string {
	out := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref != "" {
			out = append(out, ref)
		}
	}
	return out
}

func roundPct(v float64) float64 {
	return math.Round(v*100) / 100
}

func clampScore(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
