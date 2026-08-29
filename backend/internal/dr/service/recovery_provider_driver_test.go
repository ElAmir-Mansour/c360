package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	drprovider "github.com/clario360/platform/internal/dr/provider"
)

func TestProviderRecoveryTargetDriverAdaptsEnsureTeardown(t *testing.T) {
	fake := drprovider.NewFakeAdapter()
	driver, err := NewProviderRecoveryTargetDriver(fake)
	if err != nil {
		t.Fatalf("NewProviderRecoveryTargetDriver: %v", err)
	}
	rc := RestoreContext{
		IdempotencyKey:   "run|site|rp",
		TenantID:         uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		GroupID:          "group-1",
		SiteID:           "site-1",
		StreamID:         "stream-1",
		RecoveryEndpoint: "provider://target",
		Plaintext:        []byte("restore bytes"),
		Drill:            true,
	}
	externalID, err := driver.Ensure(context.Background(), rc)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if externalID == "" {
		t.Fatal("external id was empty")
	}
	if err := driver.Teardown(context.Background(), externalID, rc); err != nil {
		t.Fatalf("Teardown: %v", err)
	}
	if !fake.TornDown(externalID) {
		t.Fatalf("external id %q was not torn down", externalID)
	}
}

func TestRecoveryDriverCompatibilityRejectsVerifyAndCommandForRegulated(t *testing.T) {
	verify := NewRestoreVerifyDriver()
	if err := ValidateRecoveryDriverCompatibility(verify, true); !errors.Is(err, drprovider.ErrRegulatedIncompatible) {
		t.Fatalf("verify compatibility error = %v, want ErrRegulatedIncompatible", err)
	}

	command, err := NewCommandRecoveryTargetDriver(CommandRecoveryTargetDriverConfig{
		EnsureCommand:   []string{"/bin/ensure"},
		TeardownCommand: []string{"/bin/teardown"},
	})
	if err != nil {
		t.Fatalf("NewCommandRecoveryTargetDriver: %v", err)
	}
	if err := ValidateRecoveryDriverCompatibility(command, true); !errors.Is(err, drprovider.ErrRegulatedIncompatible) {
		t.Fatalf("command compatibility error = %v, want ErrRegulatedIncompatible", err)
	}
	if err := ValidateRecoveryDriverCompatibility(command, false); err != nil {
		t.Fatalf("non-regulated command compatibility: %v", err)
	}
}
