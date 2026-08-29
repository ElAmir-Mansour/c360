package cleanpoint

import (
	"reflect"
	"testing"
	"time"
)

var refNow = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

func fixedClock(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

func secondsAgo(n int) time.Time {
	return refNow.Add(-time.Duration(n) * time.Second)
}

func cleanEvidence() RecoveryPointEvidence {
	return RecoveryPointEvidence{
		RecoveryPointID: "rp-clean",
		GroupID:         "cg-prod",

		CreatedAt:           secondsAgo(60),
		RPOObjectiveSeconds: 300,

		CleanRoomVerdict:          CleanRoomVerdictClean,
		CleanRoomFinishedAt:       secondsAgo(20),
		AppVerificationVerdict:    AppVerificationPassed,
		AppVerificationFinishedAt: secondsAgo(10),

		AttestationVerified:      true,
		AttestedAt:               refNow.Add(-time.Hour),
		MaxAttestationAgeSeconds: int((24 * time.Hour).Seconds()),

		Immutable:      true,
		Sealed:         true,
		SealVerified:   true,
		RetentionUntil: refNow.Add(30 * 24 * time.Hour),
	}
}

func TestScore_CleanPromote(t *testing.T) {
	t.Parallel()

	decision := NewScorer(fixedClock(refNow)).Score(cleanEvidence())

	if decision.Kind != DecisionPromote {
		t.Fatalf("kind = %s, want promote", decision.Kind)
	}
	if decision.Score != 100 {
		t.Fatalf("score = %v, want 100", decision.Score)
	}
	if len(decision.Findings) != 0 {
		t.Fatalf("findings = %d, want 0: %#v", len(decision.Findings), decision.Findings)
	}
	if len(decision.Reasons) != 0 {
		t.Fatalf("reasons = %d, want 0: %#v", len(decision.Reasons), decision.Reasons)
	}
	if !decision.EvaluatedAt.Equal(refNow) {
		t.Fatalf("evaluated_at = %v, want %v", decision.EvaluatedAt, refNow)
	}
}

func TestScore_WarningPromote(t *testing.T) {
	t.Parallel()

	ev := cleanEvidence()
	ev.AttestedAt = refNow.Add(-25 * time.Hour)

	decision := Score(ev, refNow)

	if decision.Kind != DecisionPromoteWithWarnings {
		t.Fatalf("kind = %s, want promote_with_warnings", decision.Kind)
	}
	if decision.Score != 95 {
		t.Fatalf("score = %v, want 95", decision.Score)
	}
	if len(decision.Findings) != 1 {
		t.Fatalf("findings = %d, want 1: %#v", len(decision.Findings), decision.Findings)
	}
	f := decision.Findings[0]
	if f.Code != "CP-ATTESTATION" || f.Severity != SeverityWarning {
		t.Fatalf("finding = %#v, want CP-ATTESTATION warning", f)
	}
	if len(decision.Reasons) != 1 || decision.Reasons[0].Code != f.Code || decision.Reasons[0].Message != f.Message {
		t.Fatalf("reasons = %#v, want reason derived from finding %#v", decision.Reasons, f)
	}
}

func TestScore_RetestForMissingOrStaleEvidence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		mutate   func(*RecoveryPointEvidence)
		wantCode string
	}{
		{
			name: "missing app verification",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.AppVerificationVerdict = ""
			},
			wantCode: "CP-APPVERIFY",
		},
		{
			name: "stale attestation",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.AttestedAt = refNow.Add(-49 * time.Hour)
			},
			wantCode: "CP-ATTESTATION",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ev := cleanEvidence()
			tc.mutate(&ev)

			decision := Score(ev, refNow)
			if decision.Kind != DecisionRetest {
				t.Fatalf("kind = %s, want retest", decision.Kind)
			}
			f, ok := findingByCode(decision, tc.wantCode)
			if !ok {
				t.Fatalf("missing finding %s in %#v", tc.wantCode, decision.Findings)
			}
			if f.Severity != SeverityHigh {
				t.Fatalf("finding severity = %s, want high: %#v", f.Severity, f)
			}
		})
	}
}

func TestScore_QuarantineForMaliciousDirtySignals(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		mutate   func(*RecoveryPointEvidence)
		wantCode string
	}{
		{
			name: "malware finding",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.MalwareFindings = []string{"Dr.Test.EICAR"}
			},
			wantCode: "CP-MALWARE",
		},
		{
			name: "integrity mismatch",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.IntegrityMismatch = true
			},
			wantCode: "CP-INTEGRITY",
		},
		{
			name: "ransomware suspicion",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.RansomwareSuspected = true
			},
			wantCode: "CP-RANSOMWARE",
		},
		{
			name: "critical malware signal",
			mutate: func(ev *RecoveryPointEvidence) {
				ev.Signals = []Signal{{
					Kind:     SignalMalwareFinding,
					Severity: SeverityCritical,
					Code:     "av.hit",
					Message:  "malware signature hit",
				}}
			},
			wantCode: "CP-MALWARE",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ev := cleanEvidence()
			tc.mutate(&ev)

			decision := Score(ev, refNow)
			if decision.Kind != DecisionQuarantine {
				t.Fatalf("kind = %s, want quarantine", decision.Kind)
			}
			f, ok := findingByCode(decision, tc.wantCode)
			if !ok {
				t.Fatalf("missing finding %s in %#v", tc.wantCode, decision.Findings)
			}
			if f.Severity != SeverityCritical {
				t.Fatalf("finding severity = %s, want critical: %#v", f.Severity, f)
			}
		})
	}
}

func TestScore_DeterministicFindingOrdering(t *testing.T) {
	t.Parallel()

	signals := []Signal{
		{Kind: SignalDeleteRateAnomaly, Severity: SeverityWarning, Code: "z-delete", Message: "delete spike"},
		{Kind: SignalAppVerification, Severity: SeverityHigh, Code: "app", Message: "smoke check failed"},
		{Kind: SignalMalwareFinding, Severity: SeverityCritical, Code: "av", Message: "malware hit"},
		{Kind: SignalEntropyAnomaly, Severity: SeverityWarning, Code: "a-entropy", Message: "entropy spike"},
		{Kind: SignalIntegrityMismatch, Severity: SeverityCritical, Code: "hash", Message: "hash chain mismatch"},
	}

	evA := cleanEvidence()
	evA.Signals = signals
	evB := cleanEvidence()
	evB.Signals = reverseSignals(signals)

	decisionA := Score(evA, refNow)
	decisionB := Score(evB, refNow)

	gotA := findingKeys(decisionA.Findings)
	gotB := findingKeys(decisionB.Findings)
	if !reflect.DeepEqual(gotA, gotB) {
		t.Fatalf("finding order differs:\nA=%v\nB=%v", gotA, gotB)
	}

	want := []string{
		"CP-MALWARE|malware_finding|av: malware hit",
		"CP-INTEGRITY|integrity_mismatch|hash: hash chain mismatch",
		"CP-RANSOMWARE|entropy_anomaly|a-entropy: entropy spike",
		"CP-RANSOMWARE|delete_rate_anomaly|z-delete: delete spike",
		"CP-APPVERIFY|app_verification|app: smoke check failed",
	}
	if !reflect.DeepEqual(gotA, want) {
		t.Fatalf("finding order = %v, want %v", gotA, want)
	}

	gotReasons := reasonKeys(decisionA.Reasons)
	if !reflect.DeepEqual(gotReasons, want) {
		t.Fatalf("reason order = %v, want %v", gotReasons, want)
	}
}

func TestScore_Bounds(t *testing.T) {
	t.Parallel()

	cases := []RecoveryPointEvidence{
		cleanEvidence(),
		{
			CleanRoomVerdict:    CleanRoomVerdictMalware,
			MalwareFindings:     []string{"Dr.Test.EICAR", "Dr.Ransom.Note"},
			IntegrityMismatch:   true,
			RansomwareSuspected: true,
			Signals: []Signal{
				{Kind: SignalMalwareFinding, Severity: SeverityCritical, Message: "one"},
				{Kind: SignalIntegrityMismatch, Severity: SeverityCritical, Message: "two"},
				{Kind: SignalRansomwareSuspicion, Severity: SeverityCritical, Message: "three"},
			},
		},
	}

	for _, ev := range cases {
		decision := Score(ev, refNow)
		if decision.Score < 0 || decision.Score > 100 {
			t.Fatalf("score = %v, want within 0..100 for %#v", decision.Score, ev)
		}
	}
}

func findingByCode(decision Decision, code string) (Finding, bool) {
	for _, f := range decision.Findings {
		if f.Code == code {
			return f, true
		}
	}
	return Finding{}, false
}

func reverseSignals(in []Signal) []Signal {
	out := make([]Signal, len(in))
	for i := range in {
		out[len(in)-1-i] = in[i]
	}
	return out
}

func findingKeys(findings []Finding) []string {
	out := make([]string, 0, len(findings))
	for _, f := range findings {
		out = append(out, f.Code+"|"+string(f.Kind)+"|"+f.Message)
	}
	return out
}

func reasonKeys(reasons []Reason) []string {
	out := make([]string, 0, len(reasons))
	for _, r := range reasons {
		out = append(out, r.Code+"|"+string(r.Kind)+"|"+r.Message)
	}
	return out
}
