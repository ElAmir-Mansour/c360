package cybervault

import (
	"reflect"
	"testing"
	"time"
)

var refNow = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

func daysAgo(n int) time.Time {
	return refNow.AddDate(0, 0, -n)
}

func strongPosture() VaultPosture {
	return VaultPosture{
		ID:             "vault-1",
		Name:           "prod-cyber-vault",
		Provider:       VaultProviderAWSBackup,
		PrimaryRegion:  "us-east-1",
		ReplicaRegions: []string{"us-west-2"},

		ImmutabilityEnabled: true,
		VaultLockEnabled:    true,
		EncryptionEnabled:   true,
		CustomerManagedKey:  true,

		Approval: ApprovalPolicy{
			RequireRestoreApproval:     true,
			RestoreApprovers:           2,
			RequireDestructiveApproval: true,
			DestructiveApprovers:       2,
			SeparationOfDuties:         true,
		},
		Retention: RetentionPolicy{MinimumDays: 90, RequiredMinimumDays: 35},
		Isolation: IsolationPolicy{
			CrossAccount:      true,
			DisjointAdmins:    true,
			SourceAdminDenied: true,
		},
		LastRestoreTestAt:      daysAgo(10),
		LastRestoreTestPassed:  true,
		BreakGlassEnabled:      true,
		BreakGlassMFA:          true,
		BreakGlassLastTestedAt: daysAgo(30),
	}
}

func findingByCode(a PostureAssessment, code string) (VaultFinding, bool) {
	for _, f := range a.Findings {
		if f.Code == code {
			return f, true
		}
	}
	return VaultFinding{}, false
}

func TestEvaluate_SatisfiedPosture(t *testing.T) {
	t.Parallel()

	assessment := NewEvaluator(func() time.Time { return refNow }).Evaluate(strongPosture())

	if assessment.Score != 100 {
		t.Fatalf("score = %v, want 100", assessment.Score)
	}
	if assessment.Verdict != VerdictSatisfied {
		t.Fatalf("verdict = %s, want satisfied", assessment.Verdict)
	}
	if assessment.Satisfied != assessment.TotalControls || assessment.Partial != 0 || assessment.Failed != 0 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want %d/0/0",
			assessment.Satisfied, assessment.Partial, assessment.Failed, assessment.TotalControls)
	}
	if len(assessment.Findings) != 0 {
		t.Fatalf("findings = %d, want 0: %#v", len(assessment.Findings), assessment.Findings)
	}
	if !assessment.EvaluatedAt.Equal(refNow) {
		t.Fatalf("evaluated_at = %v, want %v", assessment.EvaluatedAt, refNow)
	}
}

func TestEvaluate_WarningPartialPosture(t *testing.T) {
	t.Parallel()

	posture := strongPosture()
	posture.CustomerManagedKey = false
	posture.Approval.SeparationOfDuties = false
	posture.Retention.MinimumDays = 14
	posture.LastRestoreTestAt = daysAgo(120)
	posture.BreakGlassLastTestedAt = daysAgo(240)

	assessment := Evaluate(posture, refNow)

	if assessment.Verdict != VerdictPartial {
		t.Fatalf("verdict = %s, want partial", assessment.Verdict)
	}
	if assessment.Score != 72.5 {
		t.Fatalf("score = %v, want 72.5", assessment.Score)
	}
	if assessment.Satisfied != 3 || assessment.Partial != 5 || assessment.Failed != 0 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want 3/5/0",
			assessment.Satisfied, assessment.Partial, assessment.Failed)
	}

	wantCodes := []string{"CV-ENCRYPTION", "CV-APPROVALS", "CV-RETENTION", "CV-RESTORE-TEST", "CV-BREAKGLASS"}
	gotCodes := make([]string, len(assessment.Findings))
	for i, f := range assessment.Findings {
		gotCodes[i] = f.Code
		if f.Verdict != VerdictPartial {
			t.Fatalf("finding %s verdict = %s, want partial", f.Code, f.Verdict)
		}
		if f.Severity != SeverityWarning {
			t.Fatalf("finding %s severity = %s, want warning", f.Code, f.Severity)
		}
	}
	if !reflect.DeepEqual(gotCodes, wantCodes) {
		t.Fatalf("finding order = %v, want %v", gotCodes, wantCodes)
	}
}

func TestEvaluate_FailedHighRiskPosture(t *testing.T) {
	t.Parallel()

	posture := VaultPosture{
		ID:            "vault-bad",
		Provider:      VaultProviderGeneric,
		PrimaryRegion: "us-east-1",
	}

	assessment := Evaluate(posture, refNow)

	if assessment.Verdict != VerdictFailed {
		t.Fatalf("verdict = %s, want failed", assessment.Verdict)
	}
	if assessment.Score != 0 {
		t.Fatalf("score = %v, want 0", assessment.Score)
	}
	if assessment.Satisfied != 0 || assessment.Partial != 0 || assessment.Failed != 8 {
		t.Fatalf("tallies satisfied/partial/failed = %d/%d/%d, want 0/0/8",
			assessment.Satisfied, assessment.Partial, assessment.Failed)
	}
	if len(assessment.Findings) != assessment.TotalControls {
		t.Fatalf("findings = %d, want %d", len(assessment.Findings), assessment.TotalControls)
	}

	criticalCodes := []string{"CV-LOCK", "CV-ISOLATION", "CV-ENCRYPTION", "CV-APPROVALS", "CV-RETENTION"}
	for _, code := range criticalCodes {
		f, ok := findingByCode(assessment, code)
		if !ok {
			t.Fatalf("missing critical finding %s", code)
		}
		if f.Verdict != VerdictFailed || f.Severity != SeverityHigh {
			t.Fatalf("finding %s = %s/%s, want failed/high", code, f.Verdict, f.Severity)
		}
	}

	gotOrder := make([]string, len(assessment.Findings))
	for i, f := range assessment.Findings {
		gotOrder[i] = f.Code
	}
	wantOrder := []string{
		"CV-LOCK",
		"CV-ISOLATION",
		"CV-REPLICA",
		"CV-ENCRYPTION",
		"CV-APPROVALS",
		"CV-RETENTION",
		"CV-RESTORE-TEST",
		"CV-BREAKGLASS",
	}
	if !reflect.DeepEqual(gotOrder, wantOrder) {
		t.Fatalf("finding order = %v, want %v", gotOrder, wantOrder)
	}
}
