package model

import (
	"testing"
	"time"
)

func TestTenantLicense_State(t *testing.T) {
	expires := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	lic := &TenantLicense{
		Status:    LicenseStatusActive,
		ExpiresAt: expires,
		GraceDays: 14,
	}

	cases := []struct {
		name   string
		status string
		now    time.Time
		want   string
	}{
		{name: "active before expiry", status: LicenseStatusActive, now: expires.Add(-time.Hour), want: StateActive},
		{name: "in grace at expiry instant", status: LicenseStatusActive, now: expires, want: StateInGrace},
		{name: "in grace mid-window", status: LicenseStatusActive, now: expires.Add(13 * 24 * time.Hour), want: StateInGrace},
		{name: "expired after grace", status: LicenseStatusActive, now: expires.Add(14 * 24 * time.Hour), want: StateExpired},
		{name: "suspended overrides time", status: LicenseStatusSuspended, now: expires.Add(-time.Hour), want: StateSuspended},
	}
	for _, tc := range cases {
		lic.Status = tc.status
		if got := lic.State(tc.now); got != tc.want {
			t.Errorf("%s: State() = %s, want %s", tc.name, got, tc.want)
		}
	}
}

func TestEntitlement_Revoked(t *testing.T) {
	zero, five := int64(0), int64(5)

	if (Entitlement{Key: "a"}).Revoked() {
		t.Error("nil limit must not be revoked")
	}
	if (Entitlement{Key: "a", Limit: &five}).Revoked() {
		t.Error("positive limit must not be revoked")
	}
	if !(Entitlement{Key: "a", Limit: &zero}).Revoked() {
		t.Error("zero limit must be revoked")
	}
}

func TestPeriodStart(t *testing.T) {
	in := time.Date(2026, 6, 13, 17, 45, 12, 0, time.FixedZone("AST", 3*3600))
	got := PeriodStart(in)
	want := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("PeriodStart() = %v, want %v", got, want)
	}
}
