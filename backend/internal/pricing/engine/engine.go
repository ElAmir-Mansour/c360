// Package engine is the server-authoritative, pure pricing calculator. It has
// NO I/O: given a PricingRates value and Inputs it computes the full four-tier
// output, exactly per the FORMULAS block of the Enterprise Pricing Calculator.
//
// Determinism + purity make it unit-testable against the spreadsheet's golden
// vectors with no database. The margin-floor guardrail is evaluated here, on
// the server; the client never supplies rates, markup, or the floor.
package engine

import (
	"fmt"

	"github.com/clario360/platform/internal/pricing/model"
)

// Compute prices all four tiers for the given inputs against the rate set.
// It returns a model.Quote whose tiers carry BOTH the client-facing figures and
// the internal margin block; the caller (handler) decides which to serialize.
//
// version is stamped onto the quote for display/reproducibility; pass 0 for a
// standalone (unsaved) computation.
func Compute(rates model.PricingRates, in model.Inputs, version int) model.Quote {
	tiers := make([]model.InternalTier, 0, len(model.Tiers))
	for _, tier := range model.Tiers {
		tiers = append(tiers, computeTier(rates, in, tier))
	}
	return model.Quote{
		Model:          in.Model,
		PricingVersion: version,
		Currency:       "SAR",
		Tiers:          tiers,
	}
}

// computeTier prices one tier. markup*FX is applied to EVERY client-facing line
// item; the internal cost divides the SubTotal back out by markup.
func computeTier(r model.PricingRates, in model.Inputs, tier model.Tier) model.InternalTier {
	markup := r.MarkupMultiplier
	fx := r.FXUSDToSAR
	me := markup * fx // the multiplier every client line carries

	// units drives base charge, per-unit AI, and the volume breakpoint.
	var units int64
	var build model.BaseBuildUp
	switch in.Model {
	case model.ModelPerCore:
		units = in.Cores
		build = r.PerCore
	default: // per_user
		units = in.Users
		build = r.PerUser
	}
	baseCost := build.BaseCost()
	tierFactor := r.TierResourceFactor.For(tier)

	// Air-gap high-security multiplier applies (to base charge, VM infra, and
	// setup) only when the deployment is air-gapped.
	agM := 1.0
	if in.Deployment == model.DeploymentAirGapped {
		agM = r.AirgapHighSecurityMultiplier
	}

	// Base charge: units * baseCost * tierFactor * agM * markup * FX.
	baseCharge := float64(units) * baseCost * tierFactor * agM * me

	// AI allocation: capped tiers = units * allowanceMillions * costPer1M;
	// Customized = flat dedicated AI infra cost (uncapped, NOT per-unit).
	var ai float64
	if allowance, capped := r.AIAllowanceMillions.For(tier); capped {
		ai = float64(units) * allowance * r.AICostPer1MTokens * me
	} else {
		ai = r.AIDedicatedCost * me
	}

	// Storage volume factor: 0.8 SaaS, 0.5 local (on-prem or air-gapped).
	storageFactor := r.StorageVolumeFactorLocal
	if in.Deployment == model.DeploymentSaaS {
		storageFactor = r.StorageVolumeFactorSaaS
	}

	// Deployment setup premium: 0 for SaaS; flat*agM otherwise (agM==airgap
	// multiplier only when dep==3).
	var setup float64
	if in.Deployment != model.DeploymentSaaS {
		setup = r.DeploymentSetupFlat * agM * me
	}

	li := model.LineItems{
		BaseCharge:             baseCharge,
		AIAllocation:           ai,
		DeploymentSetupPremium: setup,
	}

	// Model-specific line: per_user has DataStorage; per_core has VMInfrastructure.
	// Both are the SAME across tiers (independent of tierFactor).
	switch in.Model {
	case model.ModelPerCore:
		li.VMInfrastructure = float64(in.VMs) * build.CostPerVM * agM * me
	default: // per_user
		li.DataStorage = ((in.HotStorageGB * r.StorageHotUSDPerGB) + (in.ColdStorageGB * r.StorageColdUSDPerGB)) * storageFactor * me
	}

	subTotal := li.BaseCharge + li.AIAllocation + li.DataStorage + li.VMInfrastructure + li.DeploymentSetupPremium

	// Roll-up. Discounts compound in the fixed order: volume, then annual term,
	// then sales. Each stage's base is SubTotal + all prior (negative) discounts.
	appliedVol := r.AppliedVolumeDiscount(units)
	volumeDiscount := -subTotal * appliedVol

	termRate := 0.0
	if in.TermMonths >= r.AnnualCommitMinMonths {
		termRate = r.AnnualCommitDiscount
	}
	termDiscount := -(subTotal + volumeDiscount) * termRate

	salesRate := r.SalesDiscountDefault
	if in.SalesDiscount != nil {
		salesRate = *in.SalesDiscount
	}
	salesDiscount := -(subTotal + volumeDiscount + termDiscount) * salesRate

	netSubTotal := subTotal + volumeDiscount + termDiscount + salesDiscount
	vat := netSubTotal * r.VATRate
	totalMonthly := netSubTotal + vat
	contractValue := totalMonthly * float64(in.TermMonths)

	client := model.ClientTier{
		Tier:           tier,
		LineItems:      li,
		SubTotal:       subTotal,
		VolumeDiscount: volumeDiscount,
		TermDiscount:   termDiscount,
		SalesDiscount:  salesDiscount,
		NetSubTotal:    netSubTotal,
		VAT:            vat,
		TotalMonthly:   totalMonthly,
		ContractValue:  contractValue,
	}

	// Internal block (never client-facing). InternalCost strips markup back out
	// of the SubTotal; RealizedMargin is gross profit over the discounted net.
	internalCost := 0.0
	if markup != 0 {
		internalCost = subTotal / markup
	}
	grossProfit := netSubTotal - internalCost
	realizedMargin := 0.0
	if netSubTotal != 0 {
		realizedMargin = grossProfit / netSubTotal
	}
	guardrail := model.GuardrailOK
	if realizedMargin < r.MinMarginFloor {
		guardrail = model.GuardrailBelowFloor
	}

	return model.InternalTier{
		ClientTier: client,
		Internal: model.InternalBlock{
			InternalCost:   internalCost,
			GrossProfit:    grossProfit,
			RealizedMargin: realizedMargin,
			Guardrail:      guardrail,
		},
	}
}

// Validate checks a rate set is internally consistent and safe to publish.
// It is fail-closed: any violation is an error and the publish is rejected.
//
// Rules (design §2.1.1): all money-like rates finite and >= 0; vat_rate,
// discounts, and min_margin_floor in [0,1]; markup_multiplier >= 1; tier
// factors > 0; volume_breakpoints sorted ascending and starting at min_units 0.
func Validate(r model.PricingRates) error {
	nonNeg := map[string]float64{
		"fx_usd_to_sar":                   r.FXUSDToSAR,
		"ai_cost_per_1m_tokens":           r.AICostPer1MTokens,
		"ai_dedicated_cost":               r.AIDedicatedCost,
		"storage_hot_usd_per_gb":          r.StorageHotUSDPerGB,
		"storage_cold_usd_per_gb":         r.StorageColdUSDPerGB,
		"deployment_setup_flat":           r.DeploymentSetupFlat,
		"airgap_high_security_multiplier": r.AirgapHighSecurityMultiplier,
		"ai_allowance.standard":           r.AIAllowanceMillions.Standard,
		"ai_allowance.growth":             r.AIAllowanceMillions.Growth,
		"ai_allowance.professional":       r.AIAllowanceMillions.Professional,
		"per_user.compute":                r.PerUser.Compute,
		"per_user.licensing":              r.PerUser.Licensing,
		"per_user.support":                r.PerUser.Support,
		"per_user.security":               r.PerUser.Security,
		"per_user.overhead":               r.PerUser.Overhead,
		"per_core.compute":                r.PerCore.Compute,
		"per_core.licensing":              r.PerCore.Licensing,
		"per_core.support":                r.PerCore.Support,
		"per_core.security":               r.PerCore.Security,
		"per_core.overhead":               r.PerCore.Overhead,
		"per_core.cost_per_vm":            r.PerCore.CostPerVM,
	}
	for name, v := range nonNeg {
		if !finite(v) || v < 0 {
			return fmt.Errorf("%w: %s must be a finite value >= 0 (got %v)", model.ErrInvalidConfig, name, v)
		}
	}

	unit := map[string]float64{
		"vat_rate":               r.VATRate,
		"sales_discount_default": r.SalesDiscountDefault,
		"annual_commit_discount": r.AnnualCommitDiscount,
		"min_margin_floor":       r.MinMarginFloor,
	}
	for name, v := range unit {
		if !finite(v) || v < 0 || v > 1 {
			return fmt.Errorf("%w: %s must be in [0,1] (got %v)", model.ErrInvalidConfig, name, v)
		}
	}

	if !finite(r.MarkupMultiplier) || r.MarkupMultiplier < 1 {
		return fmt.Errorf("%w: markup_multiplier must be >= 1 (got %v)", model.ErrInvalidConfig, r.MarkupMultiplier)
	}
	if r.AnnualCommitMinMonths < 0 {
		return fmt.Errorf("%w: annual_commit_min_months must be >= 0 (got %d)", model.ErrInvalidConfig, r.AnnualCommitMinMonths)
	}

	factors := map[string]float64{
		"tier_resource_factor.standard":     r.TierResourceFactor.Standard,
		"tier_resource_factor.growth":       r.TierResourceFactor.Growth,
		"tier_resource_factor.professional": r.TierResourceFactor.Professional,
		"tier_resource_factor.customized":   r.TierResourceFactor.Customized,
	}
	for name, v := range factors {
		if !finite(v) || v <= 0 {
			return fmt.Errorf("%w: %s must be > 0 (got %v)", model.ErrInvalidConfig, name, v)
		}
	}

	if len(r.VolumeBreakpoints) == 0 {
		return fmt.Errorf("%w: volume_breakpoints must not be empty", model.ErrInvalidConfig)
	}
	if r.VolumeBreakpoints[0].MinUnits != 0 {
		return fmt.Errorf("%w: volume_breakpoints must start at min_units 0", model.ErrInvalidConfig)
	}
	prev := int64(-1)
	for i, bp := range r.VolumeBreakpoints {
		if bp.MinUnits < 0 {
			return fmt.Errorf("%w: volume_breakpoints[%d].min_units must be >= 0", model.ErrInvalidConfig, i)
		}
		if bp.MinUnits <= prev {
			return fmt.Errorf("%w: volume_breakpoints must be strictly ascending by min_units", model.ErrInvalidConfig)
		}
		prev = bp.MinUnits
		if !finite(bp.Discount) || bp.Discount < 0 || bp.Discount > 1 {
			return fmt.Errorf("%w: volume_breakpoints[%d].discount must be in [0,1] (got %v)", model.ErrInvalidConfig, i, bp.Discount)
		}
	}

	return nil
}

// finite reports whether f is neither NaN nor +/-Inf, without importing math
// into hot paths that don't need it.
func finite(f float64) bool {
	return f == f && f-f == 0
}
