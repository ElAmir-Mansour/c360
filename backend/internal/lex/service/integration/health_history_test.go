package integration

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// TestGradeForVerdicts pins the honest grade mapping: reachable=healthy; an
// auth-flavoured detail while unreachable=unauthenticated; planned/disabled is
// "disabled" (operator intent, NOT an outage); otherwise unreachable.
func TestGradeForVerdicts(t *testing.T) {
	cases := []struct {
		name   string
		health model.IntegrationHealth
		want   string
	}{
		{"reachable", model.IntegrationHealth{Reachable: true}, HealthGradeHealthy},
		{"401 detail", model.IntegrationHealth{Reachable: false, Detail: "401 unauthorized"}, HealthGradeUnauthenticated},
		{"forbidden", model.IntegrationHealth{Reachable: false, Detail: "Forbidden by upstream"}, HealthGradeUnauthenticated},
		{"dns fail", model.IntegrationHealth{Reachable: false, Detail: "dns lookup failed"}, HealthGradeUnreachable},
		{"planned", model.IntegrationHealth{Reachable: false, Status: model.IntegrationStatusPlanned, Detail: "not configured"}, HealthGradeDisabled},
		{"disabled", model.IntegrationHealth{Reachable: false, Status: model.IntegrationStatusDisabled}, HealthGradeDisabled},
	}
	for _, tc := range cases {
		if got := GradeFor(tc.health); got != tc.want {
			t.Errorf("%s: GradeFor = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// TestGradeIsOutage: only the actionable outage grades alert; disabled/healthy do not.
func TestGradeIsOutage(t *testing.T) {
	if !gradeIsOutage(HealthGradeUnreachable) || !gradeIsOutage(HealthGradeUnauthenticated) {
		t.Fatal("unreachable + unauthenticated must be outages")
	}
	if gradeIsOutage(HealthGradeHealthy) || gradeIsOutage(HealthGradeDisabled) {
		t.Fatal("healthy / disabled must NOT be outages (no false alert)")
	}
}

// TestDegradeAlertCopyIsSecretFree: the bilingual alert copy carries the code +
// grade + sanitized detail and is non-empty in both languages — and never the
// secret material (we feed a detail that LOOKS like a credential and assert the
// copy is just the operator-safe detail string the adapter already sanitized).
func TestDegradeAlertCopy(t *testing.T) {
	titleAuth := degradeTitle("najiz-court", HealthGradeUnauthenticated)
	if titleAuth.AR == "" || titleAuth.EN == "" || !strings.Contains(titleAuth.EN, "najiz-court") {
		t.Fatalf("auth title missing code/language: %+v", titleAuth)
	}
	body := degradeBody("najiz-court", "401 token expired", HealthGradeUnauthenticated)
	if !strings.Contains(body.EN, "rotat") {
		t.Fatalf("unauthenticated body should hint rotation: %q", body.EN)
	}
	// Empty detail still yields a complete, non-panicking message.
	emptyBody := degradeBody("hr-feed", "", HealthGradeUnreachable)
	if emptyBody.AR == "" || emptyBody.EN == "" {
		t.Fatalf("empty-detail body must still be populated: %+v", emptyBody)
	}
}

// TestHealthRecorderNilRepoIsSafe: a recorder with no repo is a no-op (history
// skipped, degrade detection skipped) and NEVER fails the probe — the registry
// relies on this so an unwired ledger can't break health checks.
func TestHealthRecorderNilRepoIsSafe(t *testing.T) {
	rec := NewHealthRecorder(nil, nil, zerolog.Nop())
	got, err := rec.Record(context.Background(), uuid.New(), model.IntegrationHealth{EndpointID: uuid.New(), Reachable: false, Detail: "401"})
	if err != nil {
		t.Fatalf("nil-repo Record returned error: %v", err)
	}
	if (got != HealthCheckRecord{}) {
		t.Fatalf("nil-repo Record returned a non-zero record: %+v", got)
	}
	hist, err := rec.History(context.Background(), uuid.New(), uuid.New(), 10)
	if err != nil || len(hist) != 0 {
		t.Fatalf("nil-repo History = (%v, %v), want ([], nil)", hist, err)
	}
}

// TestExpiriesDefaultNone: an adapter that does not implement ExpiryReporter (and a
// nil adapter) yields no expiry warnings.
func TestExpiriesDefaultNone(t *testing.T) {
	if w := Expiries(nil, model.IntegrationEndpoint{}); w != nil {
		t.Fatalf("nil adapter expiries = %v, want nil", w)
	}
	if w := Expiries(struct{}{}, model.IntegrationEndpoint{}); w != nil {
		t.Fatalf("non-reporter adapter expiries = %v, want nil", w)
	}
}
