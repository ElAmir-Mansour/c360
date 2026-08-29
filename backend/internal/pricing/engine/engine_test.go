package engine

import (
	"math"
	"testing"

	"github.com/clario360/platform/internal/pricing/model"
)

const tol = 0.01 // SAR — the acceptance tolerance the spreadsheet parity requires.

func approx(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s: got %.6f, want %.6f (|Δ|=%.6f > %.2f)", label, got, want, math.Abs(got-want), tol)
	}
}

// defaultInputs returns the golden-vector defaults for a model: SaaS, term=12,
// 1 unit (+1 VM for per-core), hot=2GB cold=5GB.
func defaultInputs(m model.Model) model.Inputs {
	in := model.Inputs{
		Model:         m,
		Deployment:    model.DeploymentSaaS,
		TermMonths:    12,
		HotStorageGB:  2,
		ColdStorageGB: 5,
	}
	if m == model.ModelPerCore {
		in.Cores = 1
		in.VMs = 1
	} else {
		in.Users = 1
	}
	return in
}

func tierOf(q model.Quote, t model.Tier) model.InternalTier {
	for _, it := range q.Tiers {
		if it.Tier == t {
			return it
		}
	}
	panic("tier not found: " + string(t))
}

// TestGoldenVectors_PerUser asserts every published per-user golden figure.
func TestGoldenVectors_PerUser(t *testing.T) {
	q := Compute(model.DefaultConfig(), defaultInputs(model.ModelPerUser), 1)

	// TotalMonthly per tier.
	approx(t, "per_user Standard TotalMonthly", tierOf(q, model.TierStandard).TotalMonthly, 156.414375)
	approx(t, "per_user Growth TotalMonthly", tierOf(q, model.TierGrowth).TotalMonthly, 211.66396875)
	approx(t, "per_user Professional TotalMonthly", tierOf(q, model.TierProfessional).TotalMonthly, 300.46696875)
	approx(t, "per_user Customized TotalMonthly", tierOf(q, model.TierCustomized).TotalMonthly, 2688.309)

	// ContractValue per tier.
	approx(t, "per_user Standard ContractValue", tierOf(q, model.TierStandard).ContractValue, 1876.9725)
	approx(t, "per_user Growth ContractValue", tierOf(q, model.TierGrowth).ContractValue, 2539.967625)
	approx(t, "per_user Professional ContractValue", tierOf(q, model.TierProfessional).ContractValue, 3605.603625)
	approx(t, "per_user Customized ContractValue", tierOf(q, model.TierCustomized).ContractValue, 32259.708)

	// Standard line-item breakdown.
	std := tierOf(q, model.TierStandard)
	approx(t, "per_user Standard UserBase", std.LineItems.BaseCharge, 63.375)
	approx(t, "per_user Standard AI", std.LineItems.AIAllocation, 29.25)
	approx(t, "per_user Standard Storage", std.LineItems.DataStorage, 58.5)
	approx(t, "per_user Standard Setup", std.LineItems.DeploymentSetupPremium, 0)
	approx(t, "per_user Standard SubTotal", std.SubTotal, 151.125)
	approx(t, "per_user Standard TermDisc", std.TermDiscount, -15.1125)
	approx(t, "per_user Standard NetSubTotal", std.NetSubTotal, 136.0125)
	approx(t, "per_user Standard VAT", std.VAT, 20.401875)

	// per_user has no VM line item.
	if std.LineItems.VMInfrastructure != 0 {
		t.Errorf("per_user must not have a VM line: got %v", std.LineItems.VMInfrastructure)
	}

	// RealizedMargin ~0.145299 for all tiers, guardrail OK.
	for _, tier := range model.Tiers {
		it := tierOf(q, tier)
		approx(t, "per_user "+string(tier)+" RealizedMargin", it.Internal.RealizedMargin, 0.145299)
		if it.Internal.Guardrail != model.GuardrailOK {
			t.Errorf("per_user %s guardrail: got %q, want OK", tier, it.Internal.Guardrail)
		}
	}
}

// TestGoldenVectors_PerCore asserts every published per-core golden figure.
func TestGoldenVectors_PerCore(t *testing.T) {
	q := Compute(model.DefaultConfig(), defaultInputs(model.ModelPerCore), 1)

	approx(t, "per_core Standard TotalMonthly", tierOf(q, model.TierStandard).TotalMonthly, 736.66125)
	approx(t, "per_core Growth TotalMonthly", tierOf(q, model.TierGrowth).TotalMonthly, 812.345625)
	approx(t, "per_core Professional TotalMonthly", tierOf(q, model.TierProfessional).TotalMonthly, 928.395)
	approx(t, "per_core Customized TotalMonthly", tierOf(q, model.TierCustomized).TotalMonthly, 3350.295)

	approx(t, "per_core Standard ContractValue", tierOf(q, model.TierStandard).ContractValue, 8839.935)
	approx(t, "per_core Growth ContractValue", tierOf(q, model.TierGrowth).ContractValue, 9748.1475)
	approx(t, "per_core Professional ContractValue", tierOf(q, model.TierProfessional).ContractValue, 11140.74)
	approx(t, "per_core Customized ContractValue", tierOf(q, model.TierCustomized).ContractValue, 40203.54)

	std := tierOf(q, model.TierStandard)
	approx(t, "per_core Standard CoreBase", std.LineItems.BaseCharge, 195)
	approx(t, "per_core Standard AI", std.LineItems.AIAllocation, 29.25)
	approx(t, "per_core Standard VM", std.LineItems.VMInfrastructure, 487.5)
	approx(t, "per_core Standard SubTotal", std.SubTotal, 711.75)
	approx(t, "per_core Standard TermDisc", std.TermDiscount, -71.175)
	approx(t, "per_core Standard NetSubTotal", std.NetSubTotal, 640.575)
	approx(t, "per_core Standard VAT", std.VAT, 96.08625)

	// per_core has no storage line item.
	if std.LineItems.DataStorage != 0 {
		t.Errorf("per_core must not have a storage line: got %v", std.LineItems.DataStorage)
	}

	for _, tier := range model.Tiers {
		if g := tierOf(q, tier).Internal.Guardrail; g != model.GuardrailOK {
			t.Errorf("per_core %s guardrail: got %q, want OK", tier, g)
		}
	}
}

// TestTermUnder12_NoAnnualDiscount proves the term discount is only applied at
// the annual-commit threshold.
func TestTermUnder12_NoAnnualDiscount(t *testing.T) {
	in := defaultInputs(model.ModelPerUser)
	in.TermMonths = 6
	q := Compute(model.DefaultConfig(), in, 1)
	std := tierOf(q, model.TierStandard)
	if std.TermDiscount != 0 {
		t.Errorf("term<12 must yield 0 term discount, got %v", std.TermDiscount)
	}
	// With no discount, NetSubTotal == SubTotal and the whole roll-up follows.
	approx(t, "term6 NetSubTotal==SubTotal", std.NetSubTotal, std.SubTotal)
	approx(t, "term6 ContractValue", std.ContractValue, std.TotalMonthly*6)
}

// TestOnPremSetupPremium: deployment 2 adds a flat setup line and uses the
// local storage factor (0.5).
func TestOnPremSetupPremium(t *testing.T) {
	in := defaultInputs(model.ModelPerUser)
	in.Deployment = model.DeploymentOnPrem
	r := model.DefaultConfig()
	q := Compute(r, in, 1)
	std := tierOf(q, model.TierStandard)

	// Setup = 500 * 1 (no air-gap) * markup(1.3) * FX(3.75) = 2437.5
	approx(t, "on-prem Setup", std.LineItems.DeploymentSetupPremium, 500*1.3*3.75)
	// Storage now uses the local factor 0.5: ((2*5)+(5*1)) * 0.5 * 1.3 * 3.75
	approx(t, "on-prem Storage (local factor)", std.LineItems.DataStorage, 15*0.5*1.3*3.75)
}

// TestAirGapMultiplier: deployment 3 multiplies base, VM, and setup by the
// air-gap high-security multiplier (1.4) and uses the local storage factor.
func TestAirGapMultiplier(t *testing.T) {
	r := model.DefaultConfig()

	// per_user: base and setup carry 1.4; storage uses local factor.
	inU := defaultInputs(model.ModelPerUser)
	inU.Deployment = model.DeploymentAirGapped
	stdU := tierOf(Compute(r, inU, 1), model.TierStandard)
	approx(t, "air-gap per_user base", stdU.LineItems.BaseCharge, 1*13*1.0*1.4*1.3*3.75)
	approx(t, "air-gap per_user setup", stdU.LineItems.DeploymentSetupPremium, 500*1.4*1.3*3.75)
	approx(t, "air-gap per_user storage", stdU.LineItems.DataStorage, 15*0.5*1.3*3.75)
	// AI allocation does NOT carry the air-gap multiplier.
	approx(t, "air-gap per_user AI (no agM)", stdU.LineItems.AIAllocation, 1*2*3*1.3*3.75)

	// per_core: base, VM, and setup carry 1.4.
	inC := defaultInputs(model.ModelPerCore)
	inC.Deployment = model.DeploymentAirGapped
	stdC := tierOf(Compute(r, inC, 1), model.TierStandard)
	approx(t, "air-gap per_core base", stdC.LineItems.BaseCharge, 1*40*1.0*1.4*1.3*3.75)
	approx(t, "air-gap per_core VM", stdC.LineItems.VMInfrastructure, 1*100*1.4*1.3*3.75)
	approx(t, "air-gap per_core setup", stdC.LineItems.DeploymentSetupPremium, 500*1.4*1.3*3.75)
}

// TestVolumeBreakpoints walks the step-lookup boundaries.
func TestVolumeBreakpoints(t *testing.T) {
	r := model.DefaultConfig()
	cases := []struct {
		units int64
		want  float64
	}{
		{24, 0.0}, {25, 0.05}, {99, 0.05}, {100, 0.10}, {249, 0.10}, {250, 0.15},
		{0, 0.0}, {1000, 0.15},
	}
	for _, c := range cases {
		if got := r.AppliedVolumeDiscount(c.units); got != c.want {
			t.Errorf("AppliedVolumeDiscount(%d): got %v, want %v", c.units, got, c.want)
		}
	}

	// End-to-end: at 100 units the VolumeDiscount line equals -SubTotal*0.10.
	in := defaultInputs(model.ModelPerUser)
	in.Users = 100
	std := tierOf(Compute(r, in, 1), model.TierStandard)
	approx(t, "100-user VolumeDiscount", std.VolumeDiscount, -std.SubTotal*0.10)
	// Term discount then stacks on (SubTotal + VolumeDiscount).
	approx(t, "100-user TermDiscount", std.TermDiscount, -(std.SubTotal+std.VolumeDiscount)*0.10)
}

// TestCustomizedAI_FlatUncapped: the Customized AI line is a flat dedicated
// cost, constant regardless of the unit count (per_user and per_core).
func TestCustomizedAI_FlatUncapped(t *testing.T) {
	r := model.DefaultConfig()
	wantU := r.AIDedicatedCost * r.MarkupMultiplier * r.FXUSDToSAR // 500*1.3*3.75 = 2437.5

	for _, users := range []int64{1, 10, 500} {
		in := defaultInputs(model.ModelPerUser)
		in.Users = users
		cust := tierOf(Compute(r, in, 1), model.TierCustomized)
		approx(t, "customized per_user AI flat", cust.LineItems.AIAllocation, wantU)
	}
	for _, cores := range []int64{1, 10, 500} {
		in := defaultInputs(model.ModelPerCore)
		in.Cores = cores
		cust := tierOf(Compute(r, in, 1), model.TierCustomized)
		approx(t, "customized per_core AI flat", cust.LineItems.AIAllocation, wantU)
	}
}

// TestGuardrailBelowFloor: a crafted low-margin config (markup barely above 1 +
// a heavy sales discount) drives RealizedMargin under the floor and fires the
// guardrail.
func TestGuardrailBelowFloor(t *testing.T) {
	r := model.DefaultConfig()
	r.MarkupMultiplier = 1.05 // thin markup → thin margin
	in := defaultInputs(model.ModelPerUser)
	sales := 0.20
	in.SalesDiscount = &sales

	std := tierOf(Compute(r, in, 1), model.TierStandard)
	if std.Internal.Guardrail != model.GuardrailBelowFloor {
		t.Fatalf("expected BELOW FLOOR, got %q (margin=%.4f, floor=%.2f)",
			std.Internal.Guardrail, std.Internal.RealizedMargin, r.MinMarginFloor)
	}
	if std.Internal.RealizedMargin >= r.MinMarginFloor {
		t.Errorf("crafted margin %.4f should be below floor %.2f", std.Internal.RealizedMargin, r.MinMarginFloor)
	}
}

// TestInternalCostConsistency: InternalCost = SubTotal/markup, and
// GrossProfit = NetSubTotal - InternalCost, for the default config.
func TestInternalCostConsistency(t *testing.T) {
	r := model.DefaultConfig()
	std := tierOf(Compute(r, defaultInputs(model.ModelPerUser), 1), model.TierStandard)
	approx(t, "InternalCost = SubTotal/markup", std.Internal.InternalCost, std.SubTotal/r.MarkupMultiplier)
	approx(t, "GrossProfit = Net - InternalCost", std.Internal.GrossProfit, std.NetSubTotal-std.Internal.InternalCost)
}

// TestValidate_DefaultConfigPasses guards the seed config against the validator.
func TestValidate_DefaultConfigPasses(t *testing.T) {
	if err := Validate(model.DefaultConfig()); err != nil {
		t.Fatalf("DefaultConfig() must validate, got: %v", err)
	}
}

// TestValidate_Rejections proves the fail-closed validator catches each rule.
func TestValidate_Rejections(t *testing.T) {
	base := model.DefaultConfig()

	mutate := func(f func(r *model.PricingRates)) model.PricingRates {
		r := base
		// Deep-copy the slice so per-case mutations don't leak.
		r.VolumeBreakpoints = append([]model.VolumeBreakpoint(nil), base.VolumeBreakpoints...)
		f(&r)
		return r
	}

	cases := map[string]func(r *model.PricingRates){
		"markup < 1":             func(r *model.PricingRates) { r.MarkupMultiplier = 0.9 },
		"vat > 1":                func(r *model.PricingRates) { r.VATRate = 1.5 },
		"negative fx":            func(r *model.PricingRates) { r.FXUSDToSAR = -1 },
		"floor > 1":              func(r *model.PricingRates) { r.MinMarginFloor = 2 },
		"tier factor zero":       func(r *model.PricingRates) { r.TierResourceFactor.Standard = 0 },
		"breakpoints empty":      func(r *model.PricingRates) { r.VolumeBreakpoints = nil },
		"breakpoints not from 0": func(r *model.PricingRates) { r.VolumeBreakpoints[0].MinUnits = 5 },
		"breakpoints not ascending": func(r *model.PricingRates) {
			r.VolumeBreakpoints = []model.VolumeBreakpoint{{MinUnits: 0}, {MinUnits: 100}, {MinUnits: 50}}
		},
		"nan rate": func(r *model.PricingRates) { r.AICostPer1MTokens = math.NaN() },
	}
	for name, mut := range cases {
		if err := Validate(mutate(mut)); err == nil {
			t.Errorf("Validate must reject %q", name)
		}
	}
}
