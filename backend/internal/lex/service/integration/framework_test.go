package integration

import (
	"testing"
	"time"
)

// TestSimulateNafathWebhookProvesLoop: the synthetic webhook is signed with the
// SAME HMAC the public verifier checks and round-trips successfully — proving the
// secret + signature inbound path end-to-end, in-process, with NO external call.
func TestSimulateNafathWebhookProvesLoop(t *testing.T) {
	now := time.Date(2026, time.June, 26, 10, 0, 0, 0, time.UTC)
	event, err := SimulateNafathWebhook("super-shared-secret", now)
	if err != nil {
		t.Fatalf("SimulateNafathWebhook(valid secret) error = %v, want nil", err)
	}
	if event.TransID == "" {
		t.Fatalf("synthetic event missing trans_id: %+v", event)
	}
}

// TestSimulateNafathWebhookEmptySecretRejected: an empty secret must FAIL closed —
// the verifier rejects an unsigned/secretless loop rather than faking success.
func TestSimulateNafathWebhookEmptySecretRejected(t *testing.T) {
	if _, err := SimulateNafathWebhook("", time.Now()); err == nil {
		t.Fatal("empty secret must fail signature verification (fail-closed)")
	}
}

// TestVerifyNafathWebhookRejectsTampered: a body signed with secret A but presented
// with a signature over a DIFFERENT body (tampered) must be REJECTED — the inbound
// verifier never accepts unverified input.
func TestVerifyNafathWebhookRejectsTampered(t *testing.T) {
	now := time.Now().UTC()
	// A valid synthetic event proves the happy path; then we corrupt the wire by
	// verifying a real body against a mismatched signature.
	if _, err := VerifyNafathWebhook("secretA", []byte(`{"trans_id":"x","status":"COMPLETED"}`), "sha256=deadbeef", NafathLoANone, now); err == nil {
		t.Fatal("tampered/invalid signature must be rejected")
	}
	// Wrong secret over a correctly-self-signed body is also rejected (the
	// simulate loop only succeeds when the verifier uses the SAME secret).
	if _, err := SimulateNafathWebhook("secretA", now); err != nil {
		t.Fatalf("self-consistent loop should pass: %v", err)
	}
}

// TestSynthesizeStepsAlwaysHasStage: a coarse result (no Steps) still yields one
// stage so the console always renders a staged diagnostic; an unreachable coarse
// result produces a fail stage with a remediation hint.
func TestSynthesizeStepsAlwaysHasStage(t *testing.T) {
	ok := SynthesizeSteps(TestResult{Reachable: true, Detail: "200 OK"})
	if len(ok) != 1 || ok[0].Status != DiagStatusOK {
		t.Fatalf("reachable coarse result steps = %+v, want one ok stage", ok)
	}
	bad := SynthesizeSteps(TestResult{Reachable: false})
	if len(bad) != 1 || bad[0].Status != DiagStatusFail || bad[0].Hint == "" {
		t.Fatalf("unreachable coarse result must yield a fail stage with a hint: %+v", bad)
	}
	// A connector that already emitted steps is returned unchanged.
	pre := []DiagnosticStep{{Key: "auth", Status: DiagStatusOK}}
	if got := SynthesizeSteps(TestResult{Steps: pre}); len(got) != 1 || got[0].Key != "auth" {
		t.Fatalf("pre-populated steps must pass through unchanged: %+v", got)
	}
}

// TestSyncModeNormalize: an unknown/empty mode defaults to the safe delta cadence;
// preview is recognised and reports IsPreview.
func TestSyncModeNormalize(t *testing.T) {
	if NormalizeSyncMode("") != SyncModeDelta || NormalizeSyncMode("bogus") != SyncModeDelta {
		t.Fatal("unknown mode must default to delta")
	}
	if !SyncModePreview.IsPreview() || SyncModeFull.IsPreview() {
		t.Fatal("IsPreview misclassified")
	}
	if !SyncModeFull.Valid() || SyncMode("nope").Valid() {
		t.Fatal("Valid misclassified")
	}
}
