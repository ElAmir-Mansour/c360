package assurance

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/bcm"
	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/failback"
	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
)

// stubVerificationSource returns a fixed slice and satisfies every
// VerificationEvidence source interface, so one stub can stand in for any
// per-kind source in the collector tests.
type stubVerificationSource struct {
	items []VerificationEvidence
	err   error
}

func (s stubVerificationSource) AppVerificationEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]VerificationEvidence, error) {
	return s.items, s.err
}
func (s stubVerificationSource) CleanRoomVerificationEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]VerificationEvidence, error) {
	return s.items, s.err
}
func (s stubVerificationSource) RunbookReviewEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]VerificationEvidence, error) {
	return s.items, s.err
}
func (s stubVerificationSource) BootGraphVerificationEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]VerificationEvidence, error) {
	return s.items, s.err
}
func (s stubVerificationSource) FailbackVerificationEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]VerificationEvidence, error) {
	return s.items, s.err
}

type stubDrillSource struct {
	items []DrillEvidence
	err   error
}

func (s stubDrillSource) DrillEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]DrillEvidence, error) {
	return s.items, s.err
}

type stubRPOSource struct {
	items []RPOEvidence
	err   error
}

func (s stubRPOSource) RPOEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) ([]RPOEvidence, error) {
	return s.items, s.err
}

type stubDomainFeed struct {
	ev  DomainEvidence
	err error
}

func (s stubDomainFeed) AssuranceDomainEvidence(context.Context, DBTX, uuid.UUID, uuid.UUID) (DomainEvidence, error) {
	return s.ev, s.err
}

func TestComposeEvidence_NormalizesExistingDRDomains(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	later := now.Add(10 * time.Minute)
	rtoActual := 42
	failoverCompleted := now.Add(30 * time.Minute)
	failbackCompleted := now.Add(45 * time.Minute)
	lastErr := "tier failed"
	score := 100.0

	ev := ComposeEvidence(DomainEvidence{
		BCMDrills: []bcm.DrillEvidence{{
			ID:                  uuid.MustParse("00000000-0000-0000-0000-000000000001"),
			Passed:              true,
			RTOActualSeconds:    12,
			RTOObjectiveSeconds: 30,
			RPOSeconds:          5,
			ExecutedAt:          now,
		}},
		BCMRecoveryPoints: []bcm.RecoveryPointEvidence{{
			ID:         uuid.MustParse("00000000-0000-0000-0000-000000000002"),
			RPOSeconds: 8,
			SealedAt:   now,
		}},
		BCMCleanRoom: []bcm.CleanRoomEvidence{{
			ID:         uuid.MustParse("00000000-0000-0000-0000-000000000003"),
			Verdict:    cleanroom.VerdictClean,
			Clean:      true,
			VerifiedAt: now,
		}},
		AppVerifications: []appverify.Result{{
			WorkloadID:   "workload-1",
			Passed:       true,
			ChecksTotal:  3,
			ChecksPassed: 2,
			FinishedAt:   later,
			Results: []appverify.CheckResult{{
				EvidenceRef: "artifact://appverify/1",
			}},
		}},
		CleanRoomScans: []cleanroom.Scan{{
			ID:              "scan-1",
			RecoveryPointID: "rp-1",
			Verdict:         cleanroom.VerdictMalware,
			ChunksScanned:   2,
			Findings: []cleanroom.ChunkVerdict{
				{Clean: true, IntegrityOK: true},
				{Clean: false, IntegrityOK: true},
			},
			FinishedAt: later,
		}},
		RecoveryPoints: []drmodel.RecoveryPoint{{
			ID:         "rp-2",
			RPOSeconds: 9,
			SealedAt:   later,
		}},
		StreamRPO: []drmodel.StreamRPO{{
			StreamID:   "stream-1",
			LagSeconds: 7,
			MeasuredAt: later,
		}},
		FailoverRuns: []drmodel.FailoverRun{{
			ID:                  "fo-1",
			Mode:                drmodel.ModeDrill,
			Status:              drmodel.StatusCompleted,
			InitiatedAt:         now,
			CompletedAt:         &failoverCompleted,
			RTOObjectiveSeconds: 60,
			RTOActualSeconds:    &rtoActual,
		}},
		GameDayScorecards: []gameday.Scorecard{{
			Run: &gameday.Run{
				ID:                "gd-1",
				ScenarioID:        "scenario-1",
				Scope:             gameday.ScopeDrill,
				Status:            gameday.RunStatusPassed,
				StepsTotal:        1,
				StepsPassed:       1,
				Score:             &score,
				AllFaultsReverted: true,
				InitiatedAt:       now,
				CompletedAt:       &later,
			},
		}},
		BootRuns: []bootgraph.BootRun{{
			ID:          "boot-1",
			Status:      bootgraph.RunStatusFailed,
			TotalTiers:  2,
			TiersBooted: 1,
			LastError:   &lastErr,
			StartedAt:   now,
			CompletedAt: &later,
		}},
		FailbackRuns: []failback.FailbackRun{{
			ID:          "fb-1",
			Status:      failback.StatusCompleted,
			InitiatedAt: now,
			CompletedAt: &failbackCompleted,
			UpdatedAt:   failbackCompleted,
		}},
	})

	if len(ev.Drills) != 3 {
		t.Fatalf("drill evidence count = %d, want 3: %+v", len(ev.Drills), ev.Drills)
	}
	if len(ev.RPO) != 3 {
		t.Fatalf("rpo evidence count = %d, want 3: %+v", len(ev.RPO), ev.RPO)
	}

	verifications := map[string]VerificationEvidence{}
	for _, item := range ev.Verifications {
		verifications[item.ID] = item
	}
	assertVerification(t, verifications, "bcm:clean_room:00000000-0000-0000-0000-000000000003", VerificationCleanRoom, true, 0, 0)
	assertVerification(t, verifications, "appverify:workload-1", VerificationApp, true, 2, 3)
	assertVerification(t, verifications, "cleanroom:scan-1", VerificationCleanRoom, false, 1, 2)
	assertVerification(t, verifications, "bootgraph:boot-1", VerificationDependencyBootGraph, false, 1, 2)
	assertVerification(t, verifications, "failback:fb-1", VerificationFailback, true, 0, 0)

	if got := verifications["appverify:workload-1"].Artifacts; len(got) != 1 || got[0] != "artifact://appverify/1" {
		t.Fatalf("appverify artifacts = %v, want artifact ref", got)
	}
}

func TestCollector_DomainFeedsMergeThroughComposer(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	sources := Sources{
		Feeds: []EvidenceSource{
			stubDomainFeed{ev: DomainEvidence{
				AppVerifications: []appverify.Result{{
					WorkloadID:   "app-1",
					Passed:       true,
					ChecksTotal:  1,
					ChecksPassed: 1,
					FinishedAt:   now,
				}},
				RecoveryPoints: []drmodel.RecoveryPoint{{
					ID:         "rp-1",
					RPOSeconds: 4,
					SealedAt:   now,
				}},
			}},
		},
		CleanRoom: stubVerificationSource{items: []VerificationEvidence{{ID: "legacy-clean", Kind: VerificationApp}}},
	}

	ev, err := NewCollector(sources).Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	if len(ev.RPO) != 1 || ev.RPO[0].ID != "recovery_point:rp-1" {
		t.Fatalf("rpo evidence = %+v, want recovery point-derived row", ev.RPO)
	}

	gotKinds := map[string]VerificationKind{}
	for _, item := range ev.Verifications {
		gotKinds[item.ID] = item.Kind
	}
	if gotKinds["appverify:app-1"] != VerificationApp {
		t.Fatalf("appverify kind = %q, want app", gotKinds["appverify:app-1"])
	}
	if gotKinds["legacy-clean"] != VerificationCleanRoom {
		t.Fatalf("legacy clean-room kind = %q, want clean_room", gotKinds["legacy-clean"])
	}
}

func TestCollector_StampsCanonicalKindsAndMerges(t *testing.T) {
	t.Parallel()
	// Each verification source deliberately returns the WRONG kind to prove the
	// collector re-stamps every row with that source's canonical kind.
	sources := Sources{
		Drills:    stubDrillSource{items: []DrillEvidence{{ID: "d1"}}},
		App:       stubVerificationSource{items: []VerificationEvidence{{ID: "app", Kind: VerificationFailback}}},
		CleanRoom: stubVerificationSource{items: []VerificationEvidence{{ID: "clean", Kind: VerificationApp}}},
		Runbook:   stubVerificationSource{items: []VerificationEvidence{{ID: "rb", Kind: VerificationApp}}},
		BootGraph: stubVerificationSource{items: []VerificationEvidence{{ID: "boot", Kind: VerificationApp}}},
		Failback:  stubVerificationSource{items: []VerificationEvidence{{ID: "fb", Kind: VerificationApp}}},
		RPO:       stubRPOSource{items: []RPOEvidence{{ID: "r1"}}},
	}
	ev, err := NewCollector(sources).Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	if len(ev.Drills) != 1 || len(ev.RPO) != 1 {
		t.Fatalf("drills=%d rpo=%d, want 1/1", len(ev.Drills), len(ev.RPO))
	}
	got := map[string]VerificationKind{}
	for _, v := range ev.Verifications {
		got[v.ID] = v.Kind
	}
	want := map[string]VerificationKind{
		"app":   VerificationApp,
		"clean": VerificationCleanRoom,
		"rb":    VerificationRunbookReview,
		"boot":  VerificationDependencyBootGraph,
		"fb":    VerificationFailback,
	}
	for id, kind := range want {
		if got[id] != kind {
			t.Errorf("verification %q kind = %q, want %q", id, got[id], kind)
		}
	}
}

func TestCollector_NilSourcesYieldEmptyEvidence(t *testing.T) {
	t.Parallel()
	ev, err := NewCollector(Sources{}).Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	if len(ev.Drills) != 0 || len(ev.Verifications) != 0 || len(ev.Drift) != 0 || len(ev.RPO) != 0 {
		t.Errorf("expected empty evidence for nil sources, got %+v", ev)
	}
}

func TestCollector_SourceErrorAborts(t *testing.T) {
	t.Parallel()
	sources := Sources{
		Drills: stubDrillSource{items: []DrillEvidence{{ID: "d1"}}},
		App:    stubVerificationSource{err: errors.New("boom")},
	}
	_, err := NewCollector(sources).Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected a source error to abort collection")
	}
}

func assertVerification(t *testing.T, items map[string]VerificationEvidence, id string, kind VerificationKind, passed bool, checksPassed, checksTotal int) {
	t.Helper()
	item, ok := items[id]
	if !ok {
		t.Fatalf("verification %q missing from %+v", id, items)
	}
	if item.Kind != kind || item.Passed != passed || item.ChecksPassed != checksPassed || item.ChecksTotal != checksTotal {
		t.Fatalf("verification %q = kind %q passed %v checks %d/%d, want %q %v %d/%d",
			id, item.Kind, item.Passed, item.ChecksPassed, item.ChecksTotal, kind, passed, checksPassed, checksTotal)
	}
}
