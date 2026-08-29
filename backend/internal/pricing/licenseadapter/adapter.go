// Package licenseadapter bridges the pricing commercial loop to the co-located
// license service. It implements pricing/service.LicenseAssigner by reusing the
// EXISTING license lifecycle (AssignLicense + SetOverride + SeedUsageCounter) —
// no new provisioning path, no HTTP hop. Because license-service hosts both the
// pricing and license services over one DB pool, provision-from-quote closes the
// loop in-process.
//
// The adapter depends on a narrow interface (LicenseAPI) rather than the
// concrete *licservice.Service, so it is unit-testable with a fake. The real
// *licservice.Service satisfies LicenseAPI directly (all three methods are
// exported), and pricing importing the license service is acyclic (license does
// not import pricing).
package licenseadapter

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"

	licmodel "github.com/clario360/platform/internal/license/model"
	licservice "github.com/clario360/platform/internal/license/service"
	pricingservice "github.com/clario360/platform/internal/pricing/service"
)

// LicenseAPI is the slice of the license service the adapter needs.
// *licservice.Service satisfies it; tests provide a fake.
type LicenseAPI interface {
	AssignLicense(ctx context.Context, in licservice.AssignLicenseInput) (*licmodel.TenantLicense, error)
	SetOverride(ctx context.Context, o *licmodel.Override) error
	SeedUsageCounter(ctx context.Context, tenantID, key string) error
}

// Adapter implements pricing/service.LicenseAssigner over the license API.
type Adapter struct {
	lic    LicenseAPI
	logger zerolog.Logger
}

// New builds the adapter. lic is the license API (in production, *licservice.Service).
func New(lic LicenseAPI, logger zerolog.Logger) *Adapter {
	return &Adapter{lic: lic, logger: logger.With().Str("component", "license-adapter").Logger()}
}

var _ pricingservice.LicenseAssigner = (*Adapter)(nil)

// AssignTierPlan closes the commercial loop for one quote: it assigns the tier
// plan to the tenant (AssignLicense — replace-idempotent), then records the AI
// allowance so metering knows the monthly quota. For a metered tier it sets a
// per-tenant override on ai.tokens equal to the allowance (millions) — the
// override takes precedence over the plan default in resolve() — and seeds the
// current-period usage counter to 0. For Customized (uncapped) it sets an
// override with a nil limit (granted, no quota) and does not seed a metered
// counter. Every step reuses an EXISTING license service method.
func (a *Adapter) AssignTierPlan(ctx context.Context, in pricingservice.AssignTierPlanInput) error {
	if _, err := a.lic.AssignLicense(ctx, licservice.AssignLicenseInput{
		TenantID:  in.TenantID,
		PlanKey:   in.PlanKey,
		Seats:     in.Seats,
		ExpiresAt: in.ExpiresAt,
		GraceDays: in.GraceDays,
	}); err != nil {
		return fmt.Errorf("assign license %q: %w", in.PlanKey, err)
	}

	override := &licmodel.Override{
		TenantID: in.TenantID,
		Key:      licmodel.AITokensKey,
		Reason:   fmt.Sprintf("AI allowance from quote %s (tier %s)", in.QuoteNumber, in.AIAllowance.Tier),
	}
	if in.AIAllowance.Metered {
		// The allowance is in MILLIONS of tokens; store it as an integer millions
		// quota (rounded to the nearest million — allowances are whole per-unit
		// millions * integer units, so this is exact for the seeded rates).
		limit := roundToInt64(in.AIAllowance.AllowanceMillions)
		override.Limit = &limit
	}
	// Customized: leave Limit nil -> granted without quota (uncapped dedicated AI).
	if err := a.lic.SetOverride(ctx, override); err != nil {
		return fmt.Errorf("set ai.tokens allowance override: %w", err)
	}

	if in.AIAllowance.Metered {
		if err := a.lic.SeedUsageCounter(ctx, in.TenantID, licmodel.AITokensKey); err != nil {
			return fmt.Errorf("seed ai.tokens usage counter: %w", err)
		}
	}

	a.logger.Info().
		Str("tenant_id", in.TenantID).
		Str("plan_key", in.PlanKey).
		Bool("ai_metered", in.AIAllowance.Metered).
		Float64("ai_allowance_millions", in.AIAllowance.AllowanceMillions).
		Msg("closed commercial loop: tier plan + AI allowance assigned")
	return nil
}

// roundToInt64 rounds a non-negative float to the nearest int64 (no math import).
func roundToInt64(f float64) int64 {
	if f < 0 {
		return 0
	}
	return int64(f + 0.5)
}
