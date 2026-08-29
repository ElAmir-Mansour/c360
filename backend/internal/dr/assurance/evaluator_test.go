package assurance

import (
	"reflect"
	"testing"
	"time"
)

var refNow = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

func daysAgo(n int) time.Time {
	return refNow.AddDate(0, 0, -n)
}

func baseProfile() AssuranceProfile {
	return AssuranceProfile{
		ID:                           "profile-1",
		TenantID:                     "tenant-1",
		GroupID:                      "group-1",
		WorkloadID:                   "workload-1",
		WorkloadName:                 "payments-api",
		DrillCadenceDays:             90,
		EvidenceRecencyDays:          45,
		RunbookFreshnessDays:         180,
		DependencyValidationDays:     90,
		FailbackTestDays:             180,
		RPOObjectiveSeconds:          300,
		MinAppVerificationPassRatio:  1,
		RequireCleanRoomVerification: true,
		RequireNondisruptiveDrills:   true,
	}
}

func excellentEvidence() AssuranceEvidence {
	return AssuranceEvidence{
		Drills: []DrillEvidence{
			{
				ID:                  "drill-good",
				RunID:               "run-drill-good",
				ExecutedAt:          daysAgo(8),
				CompletedAt:         daysAgo(8).Add(30 * time.Minute),
				NonDisruptive:       true,
				Passed:              true,
				RTOObjectiveSeconds: 900,
				RTOAchievedSeconds:  600,
				RPOObjectiveSeconds: 300,
				RPOAchievedSeconds:  45,
			},
		},
		Verifications: []VerificationEvidence{
			{ID: "verify-app", Kind: VerificationApp, VerifiedAt: daysAgo(3), Passed: true, ChecksPassed: 12, ChecksTotal: 12},
			{ID: "verify-clean", Kind: VerificationCleanRoom, VerifiedAt: daysAgo(4), Passed: true, ChecksPassed: 8, ChecksTotal: 8},
			{ID: "verify-runbook", Kind: VerificationRunbookReview, VerifiedAt: daysAgo(20), Passed: true, ChecksPassed: 1, ChecksTotal: 1},
			{ID: "verify-bootgraph", Kind: VerificationDependencyBootGraph, VerifiedAt: daysAgo(5), Passed: true, ChecksPassed: 6, ChecksTotal: 6},
			{ID: "verify-failback", Kind: VerificationFailback, VerifiedAt: daysAgo(25), Passed: true, ChecksPassed: 4, ChecksTotal: 4},
		},
		Drift: []DriftEvidence{
			{ID: "drift-clean", ObservedAt: daysAgo(1), DriftDetected: false},
		},
		RPO: []RPOEvidence{
			{ID: "rpo-good", MeasuredAt: daysAgo(1), ObjectiveSeconds: 300, ActualLagSeconds: 60, Breached: false},
		},
	}
}

func findingCodes(findings []Finding) []string {
	codes := make([]string, len(findings))
	for i, finding := range findings {
		codes[i] = finding.Code
	}
	return codes
}

func findingByCode(a AssuranceAssessment, code string) (Finding, bool) {
	for _, finding := range a.Findings {
		if finding.Code == code {
			return finding, true
		}
	}
	return Finding{}, false
}

func TestEvaluateExcellentPosture(t *testing.T) {
	t.Parallel()

	assessment := NewEvaluator(func() time.Time { return refNow }).Evaluate(baseProfile(), excellentEvidence())

	if assessment.Score != 100 {
		t.Fatalf("score = %v, want 100", assessment.Score)
	}
	if assessment.Verdict != VerdictSatisfied {
		t.Fatalf("verdict = %s, want satisfied", assessment.Verdict)
	}
	if assessment.Satisfied != assessment.TotalChecks || assessment.Partial != 0 || assessment.Failed != 0 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want %d/0/0",
			assessment.Satisfied, assessment.Partial, assessment.Failed, assessment.TotalChecks)
	}
	if len(assessment.Findings) != 0 {
		t.Fatalf("findings = %d, want 0: %#v", len(assessment.Findings), assessment.Findings)
	}
	if len(assessment.Recommendations) != 0 {
		t.Fatalf("recommendations = %v, want none", assessment.Recommendations)
	}
	if !assessment.EvaluatedAt.Equal(refNow) {
		t.Fatalf("evaluated_at = %v, want %v", assessment.EvaluatedAt, refNow)
	}
}

func TestEvaluateWarningPosture(t *testing.T) {
	t.Parallel()

	profile := baseProfile()
	profile.DrillCadenceDays = 30
	profile.RunbookFreshnessDays = 180

	evidence := excellentEvidence()
	evidence.Drills[0].ID = "drill-aging"
	evidence.Drills[0].ExecutedAt = daysAgo(35)
	evidence.Drills[0].CompletedAt = daysAgo(35).Add(30 * time.Minute)
	for i := range evidence.Verifications {
		switch evidence.Verifications[i].Kind {
		case VerificationApp:
			evidence.Verifications[i].Warnings = 1
		case VerificationRunbookReview:
			evidence.Verifications[i].VerifiedAt = daysAgo(210)
		}
	}
	evidence.Drift[0] = DriftEvidence{ID: "drift-open", ObservedAt: daysAgo(2), DriftDetected: true, OpenItems: 2}
	evidence.RPO[0] = RPOEvidence{ID: "rpo-near", MeasuredAt: daysAgo(2), ObjectiveSeconds: 300, ActualLagSeconds: 255}

	assessment := Evaluate(profile, evidence, refNow)

	if assessment.Verdict != VerdictPartial {
		t.Fatalf("verdict = %s, want partial", assessment.Verdict)
	}
	if assessment.Score != 75 {
		t.Fatalf("score = %v, want 75", assessment.Score)
	}
	if assessment.Satisfied != 5 || assessment.Partial != 5 || assessment.Failed != 0 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want 5/5/0",
			assessment.Satisfied, assessment.Partial, assessment.Failed)
	}

	wantCodes := []string{"drill_cadence", "app_verification_success", "rpo_breach_status", "infra_drift", "runbook_freshness"}
	gotCodes := findingCodes(assessment.Findings)
	if !reflect.DeepEqual(gotCodes, wantCodes) {
		t.Fatalf("finding order = %v, want %v", gotCodes, wantCodes)
	}
	for _, finding := range assessment.Findings {
		if finding.Verdict != VerdictPartial {
			t.Fatalf("finding %s verdict = %s, want partial", finding.Code, finding.Verdict)
		}
		if finding.Severity != SeverityWarning {
			t.Fatalf("finding %s severity = %s, want warning", finding.Code, finding.Severity)
		}
	}

	wantRecommendations := []string{
		RecommendationScheduleDrill,
		RecommendationRerunAppVerification,
		RecommendationInvestigateRPO,
		RecommendationResolveDrift,
		RecommendationRefreshRunbook,
	}
	if !reflect.DeepEqual(assessment.Recommendations, wantRecommendations) {
		t.Fatalf("recommendations = %v, want %v", assessment.Recommendations, wantRecommendations)
	}
}

func TestEvaluateFailedPosture(t *testing.T) {
	t.Parallel()

	evidence := AssuranceEvidence{
		Verifications: []VerificationEvidence{
			{ID: "verify-app-failed", Kind: VerificationApp, VerifiedAt: daysAgo(3), Passed: false, ChecksPassed: 4, ChecksTotal: 12},
			{ID: "verify-bootgraph-failed", Kind: VerificationDependencyBootGraph, VerifiedAt: daysAgo(3), Passed: false},
			{ID: "verify-failback-failed", Kind: VerificationFailback, VerifiedAt: daysAgo(10), Passed: false},
		},
		Drift: []DriftEvidence{
			{ID: "drift-critical", ObservedAt: daysAgo(1), DriftDetected: true, OpenItems: 4, CriticalItems: 1},
		},
		RPO: []RPOEvidence{
			{ID: "rpo-breach", MeasuredAt: daysAgo(1), ObjectiveSeconds: 300, ActualLagSeconds: 900, Breached: true},
		},
	}

	assessment := Evaluate(baseProfile(), evidence, refNow)

	if assessment.Verdict != VerdictFailed {
		t.Fatalf("verdict = %s, want failed", assessment.Verdict)
	}
	if assessment.Score != 0 {
		t.Fatalf("score = %v, want 0", assessment.Score)
	}
	if assessment.Satisfied != 0 || assessment.Partial != 0 || assessment.Failed != 10 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want 0/0/10",
			assessment.Satisfied, assessment.Partial, assessment.Failed)
	}

	wantOrder := []string{
		"drill_cadence",
		"nondisruptive_drill_success",
		"app_verification_success",
		"clean_room_verification",
		"rpo_breach_status",
		"infra_drift",
		"runbook_freshness",
		"dependency_bootgraph_validation",
		"last_failback_test",
		"evidence_recency",
	}
	if got := findingCodes(assessment.Findings); !reflect.DeepEqual(got, wantOrder) {
		t.Fatalf("finding order = %v, want %v", got, wantOrder)
	}

	criticalCodes := []string{"rpo_breach_status", "infra_drift", "evidence_recency"}
	for _, code := range criticalCodes {
		finding, ok := findingByCode(assessment, code)
		if !ok {
			t.Fatalf("missing finding %s", code)
		}
		if finding.Verdict != VerdictFailed || finding.Severity != SeverityCritical {
			t.Fatalf("finding %s = %s/%s, want failed/critical", code, finding.Verdict, finding.Severity)
		}
	}
}

func TestEvaluateStaleEvidence(t *testing.T) {
	t.Parallel()

	profile := baseProfile()
	profile.DrillCadenceDays = 365
	profile.EvidenceRecencyDays = 30
	profile.RunbookFreshnessDays = 365
	profile.DependencyValidationDays = 365
	profile.FailbackTestDays = 365

	evidence := excellentEvidence()
	evidence.Drills[0].ExecutedAt = daysAgo(120)
	evidence.Drills[0].CompletedAt = daysAgo(120).Add(30 * time.Minute)
	for i := range evidence.Verifications {
		evidence.Verifications[i].VerifiedAt = daysAgo(120)
	}
	evidence.Drift[0].ObservedAt = daysAgo(120)
	evidence.RPO[0].MeasuredAt = daysAgo(120)

	assessment := Evaluate(profile, evidence, refNow)

	finding, ok := findingByCode(assessment, "evidence_recency")
	if !ok {
		t.Fatalf("missing evidence_recency finding: %#v", assessment.Findings)
	}
	if finding.Verdict != VerdictFailed {
		t.Fatalf("evidence_recency verdict = %s, want failed", finding.Verdict)
	}
	if finding.Recommendation != RecommendationRefreshEvidence {
		t.Fatalf("recommendation = %s, want %s", finding.Recommendation, RecommendationRefreshEvidence)
	}
	if assessment.Score != 90 {
		t.Fatalf("score = %v, want 90", assessment.Score)
	}
	if assessment.Verdict != VerdictFailed {
		t.Fatalf("verdict = %s, want failed", assessment.Verdict)
	}
}

func TestEvaluateDeterministicOrdering(t *testing.T) {
	t.Parallel()

	profile := baseProfile()
	at := daysAgo(3)
	evidenceA := excellentEvidence()
	evidenceA.Verifications = append(evidenceA.Verifications,
		VerificationEvidence{ID: "verify-app-a", Kind: VerificationApp, VerifiedAt: at, Passed: false, ChecksPassed: 2, ChecksTotal: 10},
		VerificationEvidence{ID: "verify-app-z", Kind: VerificationApp, VerifiedAt: at, Passed: true, ChecksPassed: 10, ChecksTotal: 10, Warnings: 1},
	)
	evidenceA.Drift = []DriftEvidence{
		{ID: "drift-a", ObservedAt: at, DriftDetected: false},
		{ID: "drift-z", ObservedAt: at, DriftDetected: true, OpenItems: 1},
	}

	evidenceB := evidenceA
	evidenceB.Verifications = append([]VerificationEvidence(nil), evidenceA.Verifications...)
	for i, j := 0, len(evidenceB.Verifications)-1; i < j; i, j = i+1, j-1 {
		evidenceB.Verifications[i], evidenceB.Verifications[j] = evidenceB.Verifications[j], evidenceB.Verifications[i]
	}
	evidenceB.Drift = append([]DriftEvidence(nil), evidenceA.Drift...)
	for i, j := 0, len(evidenceB.Drift)-1; i < j; i, j = i+1, j-1 {
		evidenceB.Drift[i], evidenceB.Drift[j] = evidenceB.Drift[j], evidenceB.Drift[i]
	}

	a := Evaluate(profile, evidenceA, refNow)
	b := Evaluate(profile, evidenceB, refNow)

	wantCodes := []string{"app_verification_success", "infra_drift"}
	if got := findingCodes(a.Findings); !reflect.DeepEqual(got, wantCodes) {
		t.Fatalf("finding order A = %v, want %v", got, wantCodes)
	}
	if got := findingCodes(b.Findings); !reflect.DeepEqual(got, wantCodes) {
		t.Fatalf("finding order B = %v, want %v", got, wantCodes)
	}
	if !reflect.DeepEqual(a.Findings, b.Findings) {
		t.Fatalf("findings differ for reordered evidence:\nA=%#v\nB=%#v", a.Findings, b.Findings)
	}
}

func TestEvaluateScoreBounds(t *testing.T) {
	t.Parallel()

	cases := []AssuranceAssessment{
		Evaluate(AssuranceProfile{MinAppVerificationPassRatio: 2, DrillCadenceDays: -1}, AssuranceEvidence{}, refNow),
		Evaluate(baseProfile(), excellentEvidence(), refNow),
	}

	for _, assessment := range cases {
		if assessment.Score < 0 || assessment.Score > 100 {
			t.Fatalf("score = %v, want within 0..100", assessment.Score)
		}
		for _, result := range assessment.Results {
			if result.Weight < 0 {
				t.Fatalf("negative weight for result %#v", result)
			}
		}
	}
}
