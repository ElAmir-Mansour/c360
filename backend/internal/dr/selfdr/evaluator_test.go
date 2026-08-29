package selfdr

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

var fixedNow = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

func TestEvaluator_ReadyProfile(t *testing.T) {
	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(readyProfile())

	if assessment.Verdict != VerdictReady {
		t.Fatalf("verdict = %s, want %s; findings=%v", assessment.Verdict, VerdictReady, assessment.Findings)
	}
	if len(assessment.Findings) != 0 {
		t.Fatalf("findings = %v, want none", assessment.Findings)
	}
	wantWaves := [][]string{
		{"artifacts", "config", "control-db", "observability", "vault", "worm"},
		{"outbox"},
		{"dr-service"},
	}
	if got := assessment.RestorePlan.ComponentNames(); !reflect.DeepEqual(got, wantWaves) {
		t.Fatalf("restore waves = %v, want %v", got, wantWaves)
	}
}

func TestEvaluator_MissingAndWeakComponents(t *testing.T) {
	profile := readyProfile()
	profile.Components = removeComponent(profile.Components, "worm")
	mutateComponent(&profile, "control-db", func(c *Component) {
		c.Backup.Immutable = false
	})
	mutateComponent(&profile, "vault", func(c *Component) {
		c.Backup.Encrypted = false
	})
	mutateComponent(&profile, "artifacts", func(c *Component) {
		c.Backup.Available = false
	})

	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(profile)

	if assessment.Verdict != VerdictNotReady {
		t.Fatalf("verdict = %s, want %s", assessment.Verdict, VerdictNotReady)
	}
	for _, code := range []string{
		FindingMissingRequiredComponent,
		FindingBackupNotImmutable,
		FindingBackupNotEncrypted,
		FindingBackupMissing,
		FindingDependencyGraphInvalid,
	} {
		if !hasFinding(assessment, code) {
			t.Fatalf("missing finding %s in %#v", code, assessment.Findings)
		}
	}
}

func TestPlanner_RejectsCycle(t *testing.T) {
	profile := readyProfile()
	profile.Dependencies = append(profile.Dependencies, Dependency{
		ComponentID: "control-db",
		DependsOnID: "dr-service",
	})

	_, err := NewPlanner().Plan(profile)
	if !errors.Is(err, ErrCycle) {
		t.Fatalf("Plan error = %v, want ErrCycle", err)
	}

	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(profile)
	if assessment.Verdict != VerdictNotReady {
		t.Fatalf("verdict = %s, want %s", assessment.Verdict, VerdictNotReady)
	}
	if !hasFinding(assessment, FindingDependencyGraphInvalid) {
		t.Fatalf("missing dependency graph finding in %#v", assessment.Findings)
	}
}

func TestEvaluator_StaleRestoreTests(t *testing.T) {
	profile := readyProfile()
	mutateComponent(&profile, "control-db", func(c *Component) {
		c.Restore.TestedAt = fixedNow.Add(-31 * 24 * time.Hour)
	})

	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(profile)

	if assessment.Verdict != VerdictNotReady {
		t.Fatalf("verdict = %s, want %s", assessment.Verdict, VerdictNotReady)
	}
	if !hasComponentFinding(assessment, "control-db", FindingRestoreTestStale) {
		t.Fatalf("missing stale restore finding in %#v", assessment.Findings)
	}
}

func TestEvaluator_NoIndependentLocation(t *testing.T) {
	profile := readyProfile()
	profile.RecoveryLocations = []RecoveryLocation{
		{ID: "primary", Name: "primary", Available: true, Independent: false},
	}

	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(profile)

	if assessment.Verdict != VerdictNotReady {
		t.Fatalf("verdict = %s, want %s", assessment.Verdict, VerdictNotReady)
	}
	if !hasFinding(assessment, FindingNoIndependentLocation) {
		t.Fatalf("missing independent location finding in %#v", assessment.Findings)
	}
}

func TestEvaluator_BreakGlassAndOfflineBundleFindings(t *testing.T) {
	profile := readyProfile()
	profile.BreakGlass.ControlPlaneIndependent = false
	profile.OfflineBundle.Available = false

	assessment := NewEvaluator(func() time.Time { return fixedNow }).Evaluate(profile)

	if assessment.Verdict != VerdictNotReady {
		t.Fatalf("verdict = %s, want %s", assessment.Verdict, VerdictNotReady)
	}
	for _, code := range []string{FindingBreakGlassDependent, FindingOfflineBundleMissing} {
		if !hasFinding(assessment, code) {
			t.Fatalf("missing finding %s in %#v", code, assessment.Findings)
		}
	}
}

func TestPlanner_DeterministicWaveOrdering(t *testing.T) {
	profile := SelfDRProfile{
		ID: "deterministic",
		Components: []Component{
			{ID: "svc", Name: "service", Kind: ComponentKindDRService},
			{ID: "beta", Name: "beta", Kind: ComponentKindConfigIaC},
			{ID: "alpha", Name: "alpha", Kind: ComponentKindPostgresControlDB},
			{ID: "gamma", Name: "gamma", Kind: ComponentKindObjectWORMStore},
		},
		Dependencies: []Dependency{
			{ComponentID: "svc", DependsOnID: "gamma"},
			{ComponentID: "svc", DependsOnID: "alpha"},
			{ComponentID: "svc", DependsOnID: "beta"},
		},
	}

	plan, err := NewPlanner().Plan(profile)
	if err != nil {
		t.Fatalf("Plan error: %v", err)
	}

	want := [][]string{{"alpha", "beta", "gamma"}, {"service"}}
	if got := plan.ComponentNames(); !reflect.DeepEqual(got, want) {
		t.Fatalf("restore waves = %v, want %v", got, want)
	}
}

func readyProfile() SelfDRProfile {
	return SelfDRProfile{
		ID:                "selfdr-ready",
		Name:              "ready control plane",
		RestoreTestWindow: 30 * 24 * time.Hour,
		Components: []Component{
			readyComponent("dr-service", "dr-service", ComponentKindDRService),
			readyComponent("outbox", "outbox", ComponentKindEventOutboxQueue),
			readyComponent("worm", "worm", ComponentKindObjectWORMStore),
			readyComponent("vault", "vault", ComponentKindVaultPKISecrets),
			readyComponent("control-db", "control-db", ComponentKindPostgresControlDB),
			readyComponent("artifacts", "artifacts", ComponentKindContainerImagesArtifacts),
			readyComponent("observability", "observability", ComponentKindObservability),
			readyComponent("config", "config", ComponentKindConfigIaC),
		},
		Dependencies: []Dependency{
			{ComponentID: "outbox", DependsOnID: "control-db"},
			{ComponentID: "dr-service", DependsOnID: "control-db"},
			{ComponentID: "dr-service", DependsOnID: "worm"},
			{ComponentID: "dr-service", DependsOnID: "outbox"},
			{ComponentID: "dr-service", DependsOnID: "vault"},
			{ComponentID: "dr-service", DependsOnID: "artifacts"},
			{ComponentID: "dr-service", DependsOnID: "config"},
			{ComponentID: "dr-service", DependsOnID: "observability"},
		},
		RecoveryLocations: []RecoveryLocation{
			{ID: "primary", Name: "primary", Available: true, Independent: false},
			{ID: "secondary", Name: "secondary", Region: "us-east-2", Available: true, Independent: true},
		},
		BreakGlass: BreakGlassAccess{
			Available:               true,
			ControlPlaneIndependent: true,
			Holders:                 2,
			TestedAt:                fixedNow.Add(-24 * time.Hour),
			LocationID:              "secondary",
		},
		OfflineBundle: OfflineRestoreBundle{
			Available:   true,
			Complete:    true,
			LocationID:  "secondary",
			GeneratedAt: fixedNow.Add(-24 * time.Hour),
		},
	}
}

func readyComponent(id, name string, kind ComponentKind) Component {
	return Component{
		ID:       id,
		Name:     name,
		Kind:     kind,
		Required: true,
		Objective: RecoveryObjective{
			RTOSeconds: 900,
			RPOSeconds: 300,
		},
		Backup: BackupEvidence{
			Available:     true,
			Immutable:     true,
			Encrypted:     true,
			LocationID:    "secondary",
			CapturedAt:    fixedNow.Add(-5 * time.Minute),
			MaxRPOSeconds: 60,
		},
		Restore: RestoreEvidence{
			Passed:     true,
			TestedAt:   fixedNow.Add(-24 * time.Hour),
			LocationID: "secondary",
			RTOSeconds: 300,
			RPOSeconds: 60,
		},
		RecoveryLocations: []string{"secondary"},
	}
}

func removeComponent(components []Component, id string) []Component {
	out := make([]Component, 0, len(components))
	for _, component := range components {
		if component.ID != id {
			out = append(out, component)
		}
	}
	return out
}

func mutateComponent(profile *SelfDRProfile, id string, mutate func(*Component)) {
	for i := range profile.Components {
		if profile.Components[i].ID == id {
			mutate(&profile.Components[i])
			return
		}
	}
}

func hasFinding(assessment ReadinessAssessment, code string) bool {
	for _, finding := range assessment.Findings {
		if finding.Code == code {
			return true
		}
	}
	return false
}

func hasComponentFinding(assessment ReadinessAssessment, componentID, code string) bool {
	for _, finding := range assessment.Findings {
		if finding.ComponentID == componentID && finding.Code == code {
			return true
		}
	}
	return false
}
