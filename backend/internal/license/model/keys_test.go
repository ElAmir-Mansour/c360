package model

import (
	"testing"
	"time"
)

// TestEntitlementKeys_Registry asserts the canonical entitlement-key registry
// is exactly the expected set with correct kind classification. This registry
// is the single source of truth for gateway route gating and seeds, so drift
// here is a cross-service contract break.
func TestEntitlementKeys_Registry(t *testing.T) {
	want := map[string]string{
		"suite.cyber":            EntitlementKindSuite,
		"suite.data":             EntitlementKindSuite,
		"suite.siem":             EntitlementKindSuite,
		"suite.datastream":       EntitlementKindSuite,
		"app.acta":               EntitlementKindApp,
		"app.watheeq":            EntitlementKindApp,
		"app.bosalah":            EntitlementKindApp,
		RecoverITDRKey:           EntitlementKindSuite,
		RecoverCloudDRKey:        EntitlementKindSuite,
		RecoverCyberRecoveryKey:  EntitlementKindSuite,
		RespondMajorIncidentKey:  EntitlementKindSuite,
		MigrateCloudMigrationKey: EntitlementKindSuite,
		AITokensKey:              EntitlementKindMeter,
		"seats.users":            EntitlementKindSeat,
	}

	if len(EntitlementKeys) != len(want) {
		t.Fatalf("EntitlementKeys has %d entries, want %d", len(EntitlementKeys), len(want))
	}

	got := make(map[string]string, len(EntitlementKeys))
	for _, ek := range EntitlementKeys {
		if ek.Key == "" {
			t.Errorf("entitlement key has empty Key: %+v", ek)
		}
		if ek.Label == "" {
			t.Errorf("entitlement key %q has empty Label", ek.Key)
		}
		if _, dup := got[ek.Key]; dup {
			t.Errorf("duplicate entitlement key %q in registry", ek.Key)
		}
		got[ek.Key] = ek.Kind
	}

	for key, wantKind := range want {
		gotKind, ok := got[key]
		if !ok {
			t.Errorf("registry missing expected key %q", key)
			continue
		}
		if gotKind != wantKind {
			t.Errorf("key %q kind = %q, want %q", key, gotKind, wantKind)
		}
	}
	for key := range got {
		if _, ok := want[key]; !ok {
			t.Errorf("registry has unexpected key %q", key)
		}
	}
}

// TestEntitlementKeys_KindsAreValid asserts every registry entry uses one of
// the three declared entitlement kinds and nothing else.
func TestEntitlementKeys_KindsAreValid(t *testing.T) {
	valid := map[string]bool{
		EntitlementKindSuite: true,
		EntitlementKindApp:   true,
		EntitlementKindSeat:  true,
		EntitlementKindMeter: true,
	}
	for _, ek := range EntitlementKeys {
		if !valid[ek.Kind] {
			t.Errorf("key %q has invalid kind %q", ek.Key, ek.Kind)
		}
	}
}

// TestEntitlementKeys_KindConstants pins the literal kind discriminator values,
// since they are persisted and compared as strings across services.
func TestEntitlementKeys_KindConstants(t *testing.T) {
	if EntitlementKindSuite != "suite" {
		t.Errorf("EntitlementKindSuite = %q, want %q", EntitlementKindSuite, "suite")
	}
	if EntitlementKindApp != "app" {
		t.Errorf("EntitlementKindApp = %q, want %q", EntitlementKindApp, "app")
	}
	if EntitlementKindSeat != "seat" {
		t.Errorf("EntitlementKindSeat = %q, want %q", EntitlementKindSeat, "seat")
	}
}

// TestSeatsKey_AliasConsistency asserts the SeatsKey constant has its reserved
// literal value and that the registry's seat entry is keyed on exactly that
// constant (the alias used in EntitlementKeys), so seat licensing resolves to
// one canonical key everywhere.
func TestSeatsKey_AliasConsistency(t *testing.T) {
	if SeatsKey != "seats.users" {
		t.Fatalf("SeatsKey = %q, want %q", SeatsKey, "seats.users")
	}

	var seatEntries []EntitlementKey
	for _, ek := range EntitlementKeys {
		if ek.Kind == EntitlementKindSeat {
			seatEntries = append(seatEntries, ek)
		}
	}
	if len(seatEntries) != 1 {
		t.Fatalf("expected exactly one seat entry in registry, got %d", len(seatEntries))
	}
	if seatEntries[0].Key != SeatsKey {
		t.Errorf("seat registry entry Key = %q, want SeatsKey %q", seatEntries[0].Key, SeatsKey)
	}
}

// TestTenantLicense_State_Boundaries complements the existing State test with
// boundary instants not exercised there: the exact grace-end instant, the
// suspended-while-expired case, and a zero-grace license collapsing straight
// from active to expired at the expiry instant.
func TestTenantLicense_State_Boundaries(t *testing.T) {
	expires := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		status    string
		graceDays int
		now       time.Time
		want      string
	}{
		{
			name:      "exact grace-end instant is expired",
			status:    LicenseStatusActive,
			graceDays: 14,
			now:       expires.Add(14 * 24 * time.Hour),
			want:      StateExpired,
		},
		{
			name:      "one nanosecond before grace-end is in grace",
			status:    LicenseStatusActive,
			graceDays: 14,
			now:       expires.Add(14*24*time.Hour - time.Nanosecond),
			want:      StateInGrace,
		},
		{
			name:      "suspended overrides expired time",
			status:    LicenseStatusSuspended,
			graceDays: 14,
			now:       expires.Add(365 * 24 * time.Hour),
			want:      StateSuspended,
		},
		{
			name:      "suspended overrides active time",
			status:    LicenseStatusSuspended,
			graceDays: 14,
			now:       expires.Add(-365 * 24 * time.Hour),
			want:      StateSuspended,
		},
		{
			name:      "zero grace at expiry instant is expired",
			status:    LicenseStatusActive,
			graceDays: 0,
			now:       expires,
			want:      StateExpired,
		},
		{
			name:      "zero grace just before expiry is active",
			status:    LicenseStatusActive,
			graceDays: 0,
			now:       expires.Add(-time.Nanosecond),
			want:      StateActive,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lic := &TenantLicense{
				Status:    tc.status,
				ExpiresAt: expires,
				GraceDays: tc.graceDays,
			}
			if got := lic.State(tc.now); got != tc.want {
				t.Errorf("State() = %s, want %s", got, tc.want)
			}
		})
	}
}
