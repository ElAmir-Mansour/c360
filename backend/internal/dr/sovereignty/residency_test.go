package sovereignty

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	appconfig "github.com/clario360/platform/internal/config"
)

func TestAssertRegionAllowed(t *testing.T) {
	cases := []struct {
		name         string
		tenantRegion string
		targetRegion string
		wantErr      bool
	}{
		{"target-unrestricted", "ksa-central", "", false},
		{"tenant-unrestricted", "", "ksa-central", false},
		{"both-empty", "", "", false},
		{"same-region", "ksa-central", "ksa-central", false},
		{"same-region-case-insensitive", "KSA-Central", "ksa-central", false},
		{"same-region-whitespace", " ksa-central ", "ksa-central", false},
		{"cross-region-denied", "ksa-central", "eu-west", true},
		{"cross-region-denied-reverse", "eu-west", "ksa-central", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := AssertRegionAllowed(tc.tenantRegion, tc.targetRegion)
			if tc.wantErr && err == nil {
				t.Fatalf("AssertRegionAllowed(%q,%q) = nil, want error", tc.tenantRegion, tc.targetRegion)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("AssertRegionAllowed(%q,%q) = %v, want nil", tc.tenantRegion, tc.targetRegion, err)
			}
		})
	}
}

func TestAssertRegionAllowed_ErrorType(t *testing.T) {
	err := AssertRegionAllowed("ksa-central", "eu-west")
	if err == nil {
		t.Fatal("expected a region violation error")
	}
	var rv *RegionViolationError
	if !errors.As(err, &rv) {
		t.Fatalf("error = %T, want *RegionViolationError", err)
	}
	if rv.TenantRegion != "ksa-central" || rv.TargetRegion != "eu-west" {
		t.Errorf("violation = %+v, want tenant=ksa-central target=eu-west", rv)
	}
	if rv.Error() == "" {
		t.Error("RegionViolationError.Error() must be non-empty")
	}
}

// TestNewResidencyEnforcer_DisabledIsPassThrough proves that when residency
// enforcement is off (empty ServiceRegion), the enforcer is inert and its
// middleware passes every request through — even with a nil pool, because a
// disabled enforcer never performs a tenant-region lookup.
func TestNewResidencyEnforcer_DisabledIsPassThrough(t *testing.T) {
	enf := NewResidencyEnforcer(appconfig.ResidencyConfig{}, nil, zerolog.Nop())
	if enf == nil {
		t.Fatal("NewResidencyEnforcer returned nil")
	}
	if enf.Enabled() {
		t.Fatal("enforcer with empty ServiceRegion must report Enabled() == false")
	}

	nextCalled := false
	h := enf.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/dr/recovery-points", nil))

	if !nextCalled {
		t.Error("disabled enforcer must pass the request through to the next handler")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

// TestNewResidencyEnforcer_EnabledReportsEnabled proves that supplying a
// ServiceRegion yields an active enforcer whose PGLoader is present. A nil pool
// pointer is passed only to exercise construction: NewPGLoader always returns a
// non-nil loader, so Enabled() is driven by the ServiceRegion. The loader is
// exercised against a live DB in integration, not this unit test, so no query
// is issued here.
func TestNewResidencyEnforcer_EnabledReportsEnabled(t *testing.T) {
	var pool *pgxpool.Pool // nil; construction must not dial or query it
	enf := NewResidencyEnforcer(
		appconfig.ResidencyConfig{ServiceRegion: "ksa-central"},
		pool,
		zerolog.Nop(),
	)
	if !enf.Enabled() {
		t.Fatal("enforcer with ServiceRegion set and a loader must report Enabled() == true")
	}
}
