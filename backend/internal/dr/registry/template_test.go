package registry

import (
	"errors"
	"testing"
	"time"
)

// threeMemberSnapshot builds a realistic asset snapshot for a group with three
// members in a non-trivial boot order, a validated recovery point, and an
// isolated network mapping. It is the shared fixture for the template, diff and
// generator tests.
func threeMemberSnapshot() AssetSnapshot {
	return AssetSnapshot{
		GroupID:             "11111111-1111-1111-1111-111111111111",
		GroupName:           "core-banking",
		RTOObjectiveSeconds: 900,
		RPOObjectiveSeconds: 300,
		NetworkProfile:      "production",
		CapturedAt:          time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC),
		Members: []MemberAsset{
			// Deliberately out of boot order in the slice; the template must sort.
			{SiteID: "site-db", SiteName: "postgres-primary", SiteKind: "database", PrimaryEndpoint: "db.prod:5432", BootOrder: 10, NetworkProfile: "production", PrimaryCIDR: "10.0.0.0/24", RecoveryCIDR: "10.9.0.0/24"},
			{SiteID: "site-app", SiteName: "app-tier", SiteKind: "vm", PrimaryEndpoint: "app.prod:8080", BootOrder: 30, NetworkProfile: "production", PrimaryCIDR: "10.0.0.0/24", RecoveryCIDR: "10.9.0.0/24"},
			{SiteID: "site-cache", SiteName: "redis-cache", SiteKind: "vm", PrimaryEndpoint: "cache.prod:6379", BootOrder: 20, NetworkProfile: "production", PrimaryCIDR: "10.0.0.0/24", RecoveryCIDR: "10.9.0.0/24"},
		},
		RecoveryPoint: &RecoveryPointAsset{
			ID:              "rp-0001",
			MarkerLSN:       "0/16B3F00",
			RPOSeconds:      42,
			ValidationRatio: 0.9995,
			IsValidated:     true,
			LegalHold:       true,
			SealedAt:        "2026-06-13T11:59:00Z",
		},
	}
}

func TestTemplate_Materialize_StepOrderAndContent(t *testing.T) {
	tmpl := NewTemplate()
	steps, err := tmpl.Materialize(threeMemberSnapshot())
	if err != nil {
		t.Fatalf("Materialize: %v", err)
	}

	// 6 fixed steps (pin, quiesce, approval, health, attest) + 3 boot steps = 8.
	if len(steps) != 8 {
		t.Fatalf("expected 8 steps, got %d", len(steps))
	}

	// The exact ordered key sequence the template must produce: pin, quiesce,
	// approval, then boot members in BOOT ORDER (db=10, cache=20, app=30), then
	// health gate, then attest. This is the §6 gate sequence the runbook mirrors.
	wantKeys := []string{
		"pin_recovery_point",
		"quiesce",
		"approval",
		"boot_member:site-db",
		"boot_member:site-cache",
		"boot_member:site-app",
		"health_gate",
		"attest",
	}
	for i, want := range wantKeys {
		if steps[i].Key != want {
			t.Errorf("step %d: key = %q, want %q", i, steps[i].Key, want)
		}
		if steps[i].Order != i+1 {
			t.Errorf("step %d (%s): Order = %d, want %d", i, steps[i].Key, steps[i].Order, i+1)
		}
	}

	// Gate assignments mirror the FSM.
	gateByKey := map[string]string{
		"pin_recovery_point":     "gate1",
		"approval":               "gate2",
		"boot_member:site-db":    "gate3",
		"boot_member:site-cache": "gate3",
		"boot_member:site-app":   "gate3",
		"attest":                 "gate4",
	}
	for _, s := range steps {
		if want, ok := gateByKey[s.Key]; ok && s.Gate != want {
			t.Errorf("step %q: Gate = %q, want %q", s.Key, s.Gate, want)
		}
	}

	// Gate-1 step must pin the real recovery point id and carry its RPO.
	pin := steps[0]
	if pin.Kind != StepKindPinRecoveryPoint {
		t.Errorf("pin step kind = %q", pin.Kind)
	}
	if got := pin.Params["recovery_point_id"]; got != "rp-0001" {
		t.Errorf("pin recovery_point_id = %v, want rp-0001", got)
	}
	if got := pin.Params["rpo_seconds"]; got != 42 {
		t.Errorf("pin rpo_seconds = %v, want 42", got)
	}

	// A boot step must carry the member's real site_id, boot_order, profile, remap.
	var dbBoot RunbookStep
	for _, s := range steps {
		if s.Key == "boot_member:site-db" {
			dbBoot = s
		}
	}
	if dbBoot.Params["site_id"] != "site-db" {
		t.Errorf("db boot site_id = %v", dbBoot.Params["site_id"])
	}
	if dbBoot.Params["boot_order"] != 10 {
		t.Errorf("db boot boot_order = %v, want 10", dbBoot.Params["boot_order"])
	}
	if dbBoot.Params["network_profile"] != "production" {
		t.Errorf("db boot network_profile = %v", dbBoot.Params["network_profile"])
	}
	if dbBoot.Params["recovery_cidr"] != "10.9.0.0/24" {
		t.Errorf("db boot recovery_cidr = %v", dbBoot.Params["recovery_cidr"])
	}

	// Health gate must reference all three members.
	health := steps[6]
	if ids, ok := health.Params["member_site_ids"].([]string); !ok || len(ids) != 3 {
		t.Errorf("health gate member_site_ids = %v, want 3 members", health.Params["member_site_ids"])
	}
	if health.Params["member_count"] != 3 {
		t.Errorf("health gate member_count = %v, want 3", health.Params["member_count"])
	}

	// Attest must carry the RTO objective.
	attest := steps[7]
	if attest.Params["rto_objective_seconds"] != 900 {
		t.Errorf("attest rto_objective_seconds = %v, want 900", attest.Params["rto_objective_seconds"])
	}
}

func TestTemplate_Materialize_NoMembers(t *testing.T) {
	tmpl := NewTemplate()
	_, err := tmpl.Materialize(AssetSnapshot{GroupID: "g", GroupName: "empty"})
	if !errors.Is(err, ErrNoAssets) {
		t.Fatalf("expected ErrNoAssets for a memberless group, got %v", err)
	}
}

func TestTemplate_Materialize_NoRecoveryPointFlagsGate1Blocked(t *testing.T) {
	snap := threeMemberSnapshot()
	snap.RecoveryPoint = nil
	steps, err := tmpl.MaterializeOrFail(t, snap)
	if err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	pin := steps[0]
	if pin.Params["blocked"] != true {
		t.Errorf("expected Gate-1 step flagged blocked when no validated recovery point exists, got %v", pin.Params)
	}
	if pin.Params["recovery_point_id"] != nil {
		t.Errorf("expected nil recovery_point_id when none exists, got %v", pin.Params["recovery_point_id"])
	}
}

// tmpl is a package-level helper variable used by table tests to avoid
// reconstructing the template; MaterializeOrFail wraps the call.
var tmpl = templateHelper{}

type templateHelper struct{}

func (templateHelper) MaterializeOrFail(t *testing.T, snap AssetSnapshot) ([]RunbookStep, error) {
	t.Helper()
	return NewTemplate().Materialize(snap)
}
