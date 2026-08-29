package appverify

import (
	"errors"
	"reflect"
	"testing"
)

func TestDefaultCatalogValidAndComplete(t *testing.T) {
	t.Parallel()
	catalog, err := buildDefaultCatalog()
	if err != nil {
		t.Fatalf("buildDefaultCatalog: %v", err)
	}
	if err := catalog.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}

	for _, kind := range WorkloadKinds() {
		profile, ok := catalog.Profile(kind)
		if !ok {
			t.Fatalf("missing profile for %s", kind)
		}
		if profile.WorkloadKind != kind {
			t.Fatalf("profile kind = %s, want %s", profile.WorkloadKind, kind)
		}
	}
}

func TestProfileLookupAndListSorted(t *testing.T) {
	t.Parallel()
	if _, ok := ProfileByKind(WorkloadPostgres); !ok {
		t.Fatal("expected postgres profile")
	}
	if _, ok := ProfileByKind(WorkloadKind("sap_hana")); ok {
		t.Fatal("expected miss for unknown profile")
	}

	profiles := Profiles()
	if len(profiles) != len(WorkloadKinds()) {
		t.Fatalf("profiles len = %d, want %d", len(profiles), len(WorkloadKinds()))
	}
	for i := 1; i < len(profiles); i++ {
		if profiles[i-1].WorkloadKind > profiles[i].WorkloadKind {
			t.Fatalf("profiles not sorted: %s before %s", profiles[i-1].WorkloadKind, profiles[i].WorkloadKind)
		}
	}
}

func TestCatalogValidationRejectsMalformedProfiles(t *testing.T) {
	t.Parallel()
	good := VerificationProfile{
		WorkloadKind: WorkloadPostgres,
		Name:         "PostgreSQL",
		Checks: []VerificationCheck{
			sqlCheck("postgres-connect", "Connect", true, 10, "psql", "SELECT 1", "1", "connectivity"),
		},
	}

	tests := []struct {
		name    string
		profile VerificationProfile
	}{
		{name: "unknown workload", profile: VerificationProfile{WorkloadKind: WorkloadKind("bad"), Name: "bad", Checks: good.Checks}},
		{name: "empty name", profile: VerificationProfile{WorkloadKind: WorkloadPostgres, Checks: good.Checks}},
		{name: "no checks", profile: VerificationProfile{WorkloadKind: WorkloadPostgres, Name: "PostgreSQL"}},
		{name: "duplicate check", profile: VerificationProfile{WorkloadKind: WorkloadPostgres, Name: "PostgreSQL", Checks: []VerificationCheck{good.Checks[0], good.Checks[0]}}},
		{name: "bad check kind", profile: VerificationProfile{WorkloadKind: WorkloadPostgres, Name: "PostgreSQL", Checks: []VerificationCheck{{ID: "x", Name: "x", Kind: CheckKind("bad"), Required: true, TimeoutSeconds: 1, Command: &CommandSpec{Tool: "x", Args: []string{"x"}}}}}},
		{name: "missing command metadata", profile: VerificationProfile{WorkloadKind: WorkloadPostgres, Name: "PostgreSQL", Checks: []VerificationCheck{{ID: "x", Name: "x", Kind: CheckSQLQuery, Required: true, TimeoutSeconds: 1}}}},
		{name: "missing probe metadata", profile: VerificationProfile{WorkloadKind: WorkloadGenericHTTP, Name: "HTTP", Checks: []VerificationCheck{{ID: "x", Name: "x", Kind: CheckHTTPProbe, Required: true, TimeoutSeconds: 1}}}},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := NewCatalog([]VerificationProfile{tc.profile}); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}

	if _, err := NewCatalog([]VerificationProfile{good, good}); err == nil {
		t.Fatal("expected duplicate profile validation error")
	}
}

func TestPlannerDeterministicOrdering(t *testing.T) {
	t.Parallel()
	workload := WorkloadMetadata{
		ID:              "w-postgres",
		Name:            "orders-db",
		Kind:            WorkloadPostgres,
		Database:        "orders",
		RecoveryPointID: "rp-123",
		Endpoints: []WorkloadEndpoint{
			{Name: "z", Type: "sql", Address: "db-z"},
			{Name: "a", Type: "sql", Address: "db-a"},
		},
		Attributes: map[string]string{"health_path": "/healthz"},
	}

	objectivesA := RecoveryObjectives{
		MaxLagSeconds:   30,
		IncludeCheckIDs: []string{"postgres-replica-lag"},
	}
	objectivesB := RecoveryObjectives{
		MaxLagSeconds:   30,
		IncludeCheckIDs: []string{"postgres-replica-lag", "postgres-replica-lag"},
	}

	planA, err := PlanChecks(workload, objectivesA)
	if err != nil {
		t.Fatalf("PlanChecks A: %v", err)
	}
	planB, err := PlanChecks(workload, objectivesB)
	if err != nil {
		t.Fatalf("PlanChecks B: %v", err)
	}

	want := []string{"postgres-connect", "postgres-recovery-marker", "postgres-write-smoke", "postgres-replica-lag"}
	if got := planA.CheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("plan A ids = %v, want %v", got, want)
	}
	if got := planB.CheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("plan B ids = %v, want %v", got, want)
	}
	if planA.Parameters["endpoint.address"] != "db-a" {
		t.Fatalf("primary endpoint = %q, want db-a", planA.Parameters["endpoint.address"])
	}
}

func TestPlannerIncludesRequiredChecks(t *testing.T) {
	t.Parallel()
	profile, ok := ProfileByKind(WorkloadMySQL)
	if !ok {
		t.Fatal("missing mysql profile")
	}
	plan, err := PlanChecks(WorkloadMetadata{Kind: WorkloadMySQL}, RecoveryObjectives{})
	if err != nil {
		t.Fatalf("PlanChecks: %v", err)
	}
	if got, want := plan.RequiredCheckIDs(), profile.RequiredCheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("required check ids = %v, want %v", got, want)
	}
	for _, check := range plan.Checks {
		if !check.Required {
			t.Fatalf("unexpected optional check %s in default plan", check.ID)
		}
	}
}

func TestPlannerUnknownWorkloadFallsBackToGenericHTTP(t *testing.T) {
	t.Parallel()
	plan, err := PlanChecks(
		WorkloadMetadata{
			ID:              "w-unknown",
			Kind:            WorkloadKind("sap_hana"),
			RecoveryPointID: "rp-unknown",
			Endpoints:       []WorkloadEndpoint{{Name: "primary", Type: "http", URL: "https://app.example.com"}},
		},
		RecoveryObjectives{},
	)
	if err != nil {
		t.Fatalf("PlanChecks: %v", err)
	}
	if plan.RequestedKind != WorkloadKind("sap_hana") {
		t.Fatalf("requested kind = %s, want sap_hana", plan.RequestedKind)
	}
	if plan.ProfileKind != WorkloadGenericHTTP {
		t.Fatalf("profile kind = %s, want %s", plan.ProfileKind, WorkloadGenericHTTP)
	}
	want := []string{"http-ready", "http-recovery-marker"}
	if got := plan.CheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("check ids = %v, want %v", got, want)
	}
	if plan.Parameters["endpoint.url"] != "https://app.example.com" {
		t.Fatalf("endpoint.url = %q", plan.Parameters["endpoint.url"])
	}
}

func TestPlannerCanRequireOptionalCheck(t *testing.T) {
	t.Parallel()
	plan, err := PlanChecks(
		WorkloadMetadata{Kind: WorkloadRedis},
		RecoveryObjectives{RequireCheckIDs: []string{"redis-replication-offset"}},
	)
	if err != nil {
		t.Fatalf("PlanChecks: %v", err)
	}
	want := []string{"redis-ping", "redis-role", "redis-recovery-marker", "redis-write-smoke", "redis-replication-offset"}
	if got := plan.CheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("check ids = %v, want %v", got, want)
	}
	if got := plan.RequiredCheckIDs(); got[len(got)-1] != "redis-replication-offset" {
		t.Fatalf("last required check = %s, want redis-replication-offset", got[len(got)-1])
	}
}

func TestPlannerRejectsUnknownRequestedCheck(t *testing.T) {
	t.Parallel()
	_, err := PlanChecks(
		WorkloadMetadata{Kind: WorkloadPostgres},
		RecoveryObjectives{IncludeCheckIDs: []string{"postgres-nope"}},
	)
	if !errors.Is(err, ErrUnknownCheck) {
		t.Fatalf("PlanChecks error = %v, want ErrUnknownCheck", err)
	}
}
