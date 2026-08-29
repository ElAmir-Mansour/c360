package licenseadapter

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"

	licmodel "github.com/clario360/platform/internal/license/model"
	licservice "github.com/clario360/platform/internal/license/service"
	pricingmodel "github.com/clario360/platform/internal/pricing/model"
	pricingservice "github.com/clario360/platform/internal/pricing/service"
)

// fakeLicense records the calls the adapter makes so tests can assert the loop
// reuses the EXISTING license lifecycle (AssignLicense + SetOverride +
// SeedUsageCounter) rather than inventing a new path.
type fakeLicense struct {
	assignIn    licservice.AssignLicenseInput
	assignCalls int
	override    *licmodel.Override
	seedTenant  string
	seedKey     string
	seedCalls   int
}

func (f *fakeLicense) AssignLicense(ctx context.Context, in licservice.AssignLicenseInput) (*licmodel.TenantLicense, error) {
	f.assignCalls++
	f.assignIn = in
	return &licmodel.TenantLicense{TenantID: in.TenantID, PlanKey: in.PlanKey}, nil
}

func (f *fakeLicense) SetOverride(ctx context.Context, o *licmodel.Override) error {
	f.override = o
	return nil
}

func (f *fakeLicense) SeedUsageCounter(ctx context.Context, tenantID, key string) error {
	f.seedCalls++
	f.seedTenant, f.seedKey = tenantID, key
	return nil
}

func TestAdapter_MeteredTier_SetsAllowanceOverrideAndSeedsCounter(t *testing.T) {
	fl := &fakeLicense{}
	a := New(fl, zerolog.Nop())

	expires := time.Date(2027, 7, 2, 0, 0, 0, 0, time.UTC)
	err := a.AssignTierPlan(context.Background(), pricingservice.AssignTierPlanInput{
		TenantID:    "tenant-1",
		PlanKey:     "professional",
		Seats:       3,
		ExpiresAt:   expires,
		GraceDays:   7,
		QuoteNumber: "Q-2026-000042",
		AIAllowance: pricingmodel.AIAllowance{Tier: pricingmodel.TierProfessional, Metered: true, AllowanceMillions: 30},
	})
	if err != nil {
		t.Fatalf("AssignTierPlan: %v", err)
	}

	// Reuse AssignLicense with the resolved plan/seats/expiry.
	if fl.assignCalls != 1 {
		t.Fatalf("AssignLicense calls: got %d, want 1", fl.assignCalls)
	}
	if fl.assignIn.PlanKey != "professional" || fl.assignIn.Seats != 3 || !fl.assignIn.ExpiresAt.Equal(expires) {
		t.Errorf("AssignLicense input wrong: %+v", fl.assignIn)
	}

	// (4) AI allowance recorded as a per-tenant entitlement value: an ai.tokens
	// override with the 30M limit.
	if fl.override == nil {
		t.Fatal("expected an ai.tokens override to be set")
	}
	if fl.override.Key != licmodel.AITokensKey {
		t.Errorf("override key: got %q, want %q", fl.override.Key, licmodel.AITokensKey)
	}
	if fl.override.Limit == nil || *fl.override.Limit != 30 {
		t.Errorf("override limit: got %v, want 30", fl.override.Limit)
	}
	// And a usage_counters seed for the metered key.
	if fl.seedCalls != 1 || fl.seedKey != licmodel.AITokensKey || fl.seedTenant != "tenant-1" {
		t.Errorf("usage seed wrong: calls=%d tenant=%q key=%q", fl.seedCalls, fl.seedTenant, fl.seedKey)
	}
}

func TestAdapter_CustomizedTier_UncappedOverrideNoSeed(t *testing.T) {
	fl := &fakeLicense{}
	a := New(fl, zerolog.Nop())

	err := a.AssignTierPlan(context.Background(), pricingservice.AssignTierPlanInput{
		TenantID:    "tenant-2",
		PlanKey:     "customized",
		Seats:       10,
		ExpiresAt:   time.Now().Add(24 * time.Hour),
		QuoteNumber: "Q-2026-000043",
		AIAllowance: pricingmodel.AIAllowance{Tier: pricingmodel.TierCustomized, Metered: false, DedicatedCost: 500},
	})
	if err != nil {
		t.Fatalf("AssignTierPlan(customized): %v", err)
	}
	// Uncapped: override present but with a NIL limit (granted, no quota).
	if fl.override == nil || fl.override.Key != licmodel.AITokensKey {
		t.Fatalf("expected an ai.tokens override for customized")
	}
	if fl.override.Limit != nil {
		t.Errorf("customized override limit should be nil (uncapped), got %v", *fl.override.Limit)
	}
	// No metered usage counter is seeded for an uncapped allowance.
	if fl.seedCalls != 0 {
		t.Errorf("customized should not seed a metered counter, got %d seeds", fl.seedCalls)
	}
}

// Compile-time assertion the adapter satisfies the pricing seam.
var _ pricingservice.LicenseAssigner = (*Adapter)(nil)
