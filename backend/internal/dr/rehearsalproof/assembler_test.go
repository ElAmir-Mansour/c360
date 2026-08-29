package rehearsalproof

import (
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/gameday"
)

func TestFromGameDayScorecardProducesLiveProofEnvelope(t *testing.T) {
	now := time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC)
	started := now.Add(-10 * time.Minute)
	completed := now.Add(-2 * time.Minute)
	finished := now.Add(-3 * time.Minute)
	score := 1.0

	asm := New(func() time.Time { return now })
	proof, err := asm.FromGameDayScorecard(gameday.Scorecard{
		Run: &gameday.Run{
			ID:                "run-1",
			TenantID:          "tenant-1",
			ScenarioID:        "scenario-1",
			GroupID:           "group-1",
			Scope:             gameday.ScopeDrill,
			Status:            gameday.RunStatusPassed,
			StepsTotal:        1,
			StepsPassed:       1,
			Score:             &score,
			AllFaultsReverted: true,
			InitiatedAt:       started,
			StartedAt:         &started,
			CompletedAt:       &completed,
		},
		Steps: []*gameday.StepResult{{
			ID:             "step-1",
			RunID:          "run-1",
			StepIndex:      1,
			Action:         gameday.ActionPauseStream,
			Target:         "stream-1",
			ExpectedSignal: "lag_alert",
			SignalObserved: true,
			FaultReverted:  true,
			Passed:         true,
			Detail:         "lag alert observed and cleared",
			StartedAt:      started,
			FinishedAt:     &finished,
		}},
	}, GameDayOptions{
		Systems:          []SystemRef{{ID: "system-1", Name: "Core Banking", Kind: "database", Critical: true}},
		Runbook:          RunbookRef{ID: "runbook-1", Version: "7", ContentHash: "sha256:runbook"},
		RTOTargetSeconds: 600,
		RPOTargetSeconds: 120,
		EvidenceReport:   &EvidenceReportRef{ID: "report-1", Hash: "sha256:report", Algorithm: "sha256"},
		Provenance:       Provenance{Source: SourceLiveRun, CapturedFrom: RunTypeGameDay, RecordedBy: "operator-1"},
	})
	if err != nil {
		t.Fatalf("FromGameDayScorecard: %v", err)
	}

	if proof.SchemaVersion != SchemaVersion {
		t.Fatalf("schema version = %q, want %q", proof.SchemaVersion, SchemaVersion)
	}
	if proof.Run.Type != RunTypeGameDay || proof.Run.ID != "run-1" || proof.Run.ScenarioID != "scenario-1" {
		t.Fatalf("run ref = %+v", proof.Run)
	}
	if !proof.Provenance.Live || proof.Provenance.Seeded || proof.Provenance.Demo {
		t.Fatalf("provenance = %+v, want live non-demo", proof.Provenance)
	}
	if proof.OverallVerdict != VerdictPassed {
		t.Fatalf("overall verdict = %q, want passed", proof.OverallVerdict)
	}
	if proof.FailbackTeardown.Status != TeardownComplete {
		t.Fatalf("teardown = %+v, want complete", proof.FailbackTeardown)
	}
	if len(proof.HealthChecks) != 1 || !proof.HealthChecks[0].Passed || proof.HealthChecks[0].EvidenceID != "step-1" {
		t.Fatalf("health checks = %+v", proof.HealthChecks)
	}
	if proof.EvidenceReport == nil || proof.EvidenceReport.Hash != "sha256:report" {
		t.Fatalf("evidence report = %+v", proof.EvidenceReport)
	}
	if !strings.HasPrefix(proof.EnvelopeHash, "sha256:") {
		t.Fatalf("envelope hash = %q, want sha256 prefix", proof.EnvelopeHash)
	}
	recomputed, err := EnvelopeHash(proof)
	if err != nil {
		t.Fatalf("EnvelopeHash: %v", err)
	}
	if recomputed != proof.EnvelopeHash {
		t.Fatalf("envelope hash not stable: got %s want %s", recomputed, proof.EnvelopeHash)
	}
}

func TestBuildSeededDemoEvidenceIsNeverMarkedLive(t *testing.T) {
	now := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	asm := New(func() time.Time { return now })

	proof, err := asm.Build(BuildInput{
		TenantID:    "tenant-1",
		Run:         RunRef{Type: RunTypeRunbookStudio, ID: "seed-run-1", Mode: "rehearsal", Status: "completed"},
		StartedAt:   now.Add(-time.Hour),
		CompletedAt: ptrTime(now),
		HealthChecks: []HealthCheck{{
			Name:      "seeded check",
			Status:    VerdictPassed,
			Passed:    true,
			CheckedAt: now,
		}},
		Provenance: Provenance{
			Source:       SourceSeededDemo,
			Live:         true,
			CapturedFrom: "recover_demo_seed",
		},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	if proof.Provenance.Live {
		t.Fatalf("seeded proof marked live: %+v", proof.Provenance)
	}
	if !proof.Provenance.Seeded || !proof.Provenance.Demo {
		t.Fatalf("seeded proof provenance = %+v, want seeded demo flags", proof.Provenance)
	}
	if !strings.Contains(proof.Provenance.Notes, "not live") {
		t.Fatalf("seeded proof note = %q, want not-live warning", proof.Provenance.Notes)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
