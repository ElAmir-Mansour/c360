// Package model defines the pricing & quoting domain: the versioned,
// governed rate configuration (PricingRates / PricingConfig), the calculator
// inputs (Inputs), and the two structurally-distinct output shapes.
//
// Masking is by struct shape, not by a runtime flag: ClientTier physically
// omits margin/internal-cost; InternalTier embeds ClientTier and ADDS the
// internal block. A handler chooses the type by the caller's RBAC verb, so a
// client can never coerce internal figures into a client-facing response.
//
// All money is SAR. Pricing config is platform-global and versioned (immutable
// versions + effective dates + created_by), not tenant-scoped.
package model

import (
	"errors"
	"time"
)

// Model selects the calculator sheet.
type Model string

const (
	ModelPerUser Model = "per_user"
	ModelPerCore Model = "per_core"
)

// Deployment mirrors the spreadsheet's deployment codes.
type Deployment int

const (
	DeploymentSaaS      Deployment = 1 // hosted; no setup premium; storage volume factor 0.8
	DeploymentOnPrem    Deployment = 2 // on-prem / VPC; flat setup premium; storage factor 0.5
	DeploymentAirGapped Deployment = 3 // high-security; air-gap multiplier on base/VM/setup
)

// Tier is one of the four commercial tiers (they map 1:1 to license_plans keys).
type Tier string

const (
	TierStandard     Tier = "standard"
	TierGrowth       Tier = "growth"
	TierProfessional Tier = "professional"
	TierCustomized   Tier = "customized"
)

// Tiers is the canonical ordering used for output.
var Tiers = []Tier{TierStandard, TierGrowth, TierProfessional, TierCustomized}

// Config version statuses.
const (
	ConfigStatusDraft    = "draft"
	ConfigStatusActive   = "active"
	ConfigStatusArchived = "archived"
)

// Guardrail results.
const (
	GuardrailOK         = "OK"
	GuardrailBelowFloor = "BELOW FLOOR"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
	ErrInvalidConfig = errors.New("invalid pricing config")
	ErrImmutable     = errors.New("version is not editable")
	ErrNoActive      = errors.New("no active pricing config")
)

// BaseBuildUp is the per-unit cost build-up (compute+licensing+support+
// security+overhead). BaseCost sums them.
type BaseBuildUp struct {
	Compute   float64 `json:"compute"`
	Licensing float64 `json:"licensing"`
	Support   float64 `json:"support"`
	Security  float64 `json:"security"`
	Overhead  float64 `json:"overhead"`
	// CostPerVM is only meaningful on the per-core build-up (0 on per-user).
	CostPerVM float64 `json:"cost_per_vm,omitempty"`
}

// BaseCost is the summed per-unit build-up used by the engine.
func (b BaseBuildUp) BaseCost() float64 {
	return b.Compute + b.Licensing + b.Support + b.Security + b.Overhead
}

// TierFactors are the resource multipliers applied to the base charge per tier.
type TierFactors struct {
	Standard     float64 `json:"standard"`
	Growth       float64 `json:"growth"`
	Professional float64 `json:"professional"`
	Customized   float64 `json:"customized"`
}

// For returns the resource factor for a tier.
func (f TierFactors) For(t Tier) float64 {
	switch t {
	case TierStandard:
		return f.Standard
	case TierGrowth:
		return f.Growth
	case TierProfessional:
		return f.Professional
	case TierCustomized:
		return f.Customized
	}
	return 0
}

// AIAllowances are the metered AI allowances (in millions of tokens) per unit
// for the capped tiers. Customized is excluded (it uses AIDedicatedCost).
type AIAllowances struct {
	Standard     float64 `json:"standard"`
	Growth       float64 `json:"growth"`
	Professional float64 `json:"professional"`
}

// For returns the per-unit allowance in millions for a capped tier; the
// second return is false for Customized (no per-unit allowance).
func (a AIAllowances) For(t Tier) (float64, bool) {
	switch t {
	case TierStandard:
		return a.Standard, true
	case TierGrowth:
		return a.Growth, true
	case TierProfessional:
		return a.Professional, true
	}
	return 0, false
}

// VolumeBreakpoint is one step of the volume-discount LOOKUP: the discount that
// applies when units >= MinUnits (highest matching threshold wins).
type VolumeBreakpoint struct {
	MinUnits int64   `json:"min_units"`
	Discount float64 `json:"discount"`
}

// PricingRates is the ~40 governed rates serialized as the pricing_config
// payload. The Go struct is the typed contract; JSONB is a serialization detail.
type PricingRates struct {
	FXUSDToSAR            float64 `json:"fx_usd_to_sar"`
	VATRate               float64 `json:"vat_rate"`
	MarkupMultiplier      float64 `json:"markup_multiplier"`
	SalesDiscountDefault  float64 `json:"sales_discount_default"`
	AnnualCommitDiscount  float64 `json:"annual_commit_discount"`
	AnnualCommitMinMonths int     `json:"annual_commit_min_months"`
	MinMarginFloor        float64 `json:"min_margin_floor"`

	TierResourceFactor TierFactors `json:"tier_resource_factor"`

	AICostPer1MTokens   float64      `json:"ai_cost_per_1m_tokens"`
	AIAllowanceMillions AIAllowances `json:"ai_allowance_millions"`
	AIDedicatedCost     float64      `json:"ai_dedicated_cost"`

	StorageHotUSDPerGB       float64 `json:"storage_hot_usd_per_gb"`
	StorageColdUSDPerGB      float64 `json:"storage_cold_usd_per_gb"`
	StorageVolumeFactorSaaS  float64 `json:"storage_volume_factor_saas"`
	StorageVolumeFactorLocal float64 `json:"storage_volume_factor_local"`

	DeploymentSetupFlat          float64 `json:"deployment_setup_flat"`
	AirgapHighSecurityMultiplier float64 `json:"airgap_high_security_multiplier"`

	PerUser BaseBuildUp `json:"per_user"`
	PerCore BaseBuildUp `json:"per_core"`

	VolumeBreakpoints []VolumeBreakpoint `json:"volume_breakpoints"`
}

// AppliedVolumeDiscount returns the step-lookup discount for a unit count:
// the discount of the highest breakpoint whose MinUnits <= units. Breakpoints
// are validated to be ascending and start at 0, so a linear scan is correct.
func (r PricingRates) AppliedVolumeDiscount(units int64) float64 {
	discount := 0.0
	for _, bp := range r.VolumeBreakpoints {
		if units >= bp.MinUnits {
			discount = bp.Discount
		}
	}
	return discount
}

// Inputs are the client-supplied calculator inputs. The client NEVER sends
// rates, factors, markup, or the margin floor — only these drivers.
type Inputs struct {
	Model         Model      `json:"model"`
	Deployment    Deployment `json:"deployment"`
	TermMonths    int        `json:"term_months"`
	Users         int64      `json:"users,omitempty"` // per_user model
	Cores         int64      `json:"cores,omitempty"` // per_core model
	VMs           int64      `json:"vms,omitempty"`   // per_core model
	HotStorageGB  float64    `json:"hot_storage_gb"`
	ColdStorageGB float64    `json:"cold_storage_gb"`
	// SalesDiscount is optional; nil falls back to PricingRates.SalesDiscountDefault.
	SalesDiscount *float64 `json:"sales_discount,omitempty"`
}

// LineItems is the client-facing per-tier line breakdown. Field names are model
// neutral so the same shape serves both sheets:
//   - BaseCharge   = UserBaseCharge (per_user) | CoreBaseCharge (per_core)
//   - VMOrStorage2 = VMInfrastructure (per_core); 0 on per_user
//   - DataStorage  = storage line (per_user); 0 on per_core
type LineItems struct {
	BaseCharge             float64 `json:"base_charge"`
	AIAllocation           float64 `json:"ai_allocation"`
	DataStorage            float64 `json:"data_storage"`
	VMInfrastructure       float64 `json:"vm_infrastructure"`
	DeploymentSetupPremium float64 `json:"deployment_setup_premium"`
}

// ClientTier is the masked, client-facing tier result. The internal block
// (cost / gross profit / realized margin / guardrail) is PHYSICALLY ABSENT —
// there is no field a client could read even if the serializer misbehaved.
type ClientTier struct {
	Tier           Tier      `json:"tier"`
	LineItems      LineItems `json:"line_items"`
	SubTotal       float64   `json:"sub_total"`
	VolumeDiscount float64   `json:"volume_discount"`
	TermDiscount   float64   `json:"term_discount"`
	SalesDiscount  float64   `json:"sales_discount"`
	NetSubTotal    float64   `json:"net_sub_total"`
	VAT            float64   `json:"vat"`
	TotalMonthly   float64   `json:"total_monthly"`
	ContractValue  float64   `json:"contract_value"`
}

// InternalBlock is the INTERNAL-ONLY margin view. It is a separate type so it
// can only reach a response by explicit construction of an InternalTier.
type InternalBlock struct {
	InternalCost   float64 `json:"internal_cost"`
	GrossProfit    float64 `json:"gross_profit"`
	RealizedMargin float64 `json:"realized_margin"`
	Guardrail      string  `json:"guardrail"`
}

// InternalTier is ClientTier plus the internal margin block. Only served to
// callers holding pricing:admin (structural masking).
type InternalTier struct {
	ClientTier
	Internal InternalBlock `json:"internal"`
}

// Client returns the masked view of an internal tier (used by the handler and
// by any export path so masking is enforced by construction).
func (t InternalTier) Client() ClientTier {
	return t.ClientTier
}

// Quote is the engine's full computation for a set of inputs against a config
// version: the four tiers WITH their internal blocks. This is the internal
// representation; the handler serializes either the masked or the full view.
type Quote struct {
	Model          Model          `json:"model"`
	PricingVersion int            `json:"pricing_version"`
	Currency       string         `json:"currency"`
	Tiers          []InternalTier `json:"tiers"`
}

// ClientTiers returns the masked tier list for a client-facing response.
func (q Quote) ClientTiers() []ClientTier {
	out := make([]ClientTier, len(q.Tiers))
	for i, t := range q.Tiers {
		out[i] = t.Client()
	}
	return out
}

// PricingConfig is one immutable, governed version of the rate set.
type PricingConfig struct {
	ID            string       `json:"id"`
	Version       int          `json:"version"`
	Status        string       `json:"status"`
	Rates         PricingRates `json:"rates"`
	Currency      string       `json:"currency"`
	EffectiveFrom time.Time    `json:"effective_from"`
	EffectiveTo   *time.Time   `json:"effective_to,omitempty"`
	Notes         string       `json:"notes"`
	CreatedBy     string       `json:"created_by"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

// DefaultConfig returns the version-1 rate set from the spreadsheet's FORMULAS
// block. It is the compiled-in seed AND the fixture the golden-vector tests run
// against, so the engine's parity with the spreadsheet is asserted against the
// exact values that seed a fresh database.
func DefaultConfig() PricingRates {
	return PricingRates{
		FXUSDToSAR:            3.75,
		VATRate:               0.15,
		MarkupMultiplier:      1.30,
		SalesDiscountDefault:  0.0,
		AnnualCommitDiscount:  0.10,
		AnnualCommitMinMonths: 12,
		MinMarginFloor:        0.10,

		TierResourceFactor: TierFactors{
			Standard:     1.0,
			Growth:       1.15,
			Professional: 1.35,
			Customized:   1.6,
		},

		AICostPer1MTokens:   3.0,
		AIAllowanceMillions: AIAllowances{Standard: 2, Growth: 5, Professional: 10},
		AIDedicatedCost:     500.0,

		StorageHotUSDPerGB:       5.0,
		StorageColdUSDPerGB:      1.0,
		StorageVolumeFactorSaaS:  0.8,
		StorageVolumeFactorLocal: 0.5,

		DeploymentSetupFlat:          500.0,
		AirgapHighSecurityMultiplier: 1.4,

		PerUser: BaseBuildUp{Compute: 4, Licensing: 3, Support: 2.5, Security: 1.5, Overhead: 2},
		PerCore: BaseBuildUp{Compute: 20, Licensing: 8, Support: 6, Security: 4, Overhead: 2, CostPerVM: 100},

		VolumeBreakpoints: []VolumeBreakpoint{
			{MinUnits: 0, Discount: 0.0},
			{MinUnits: 25, Discount: 0.05},
			{MinUnits: 100, Discount: 0.10},
			{MinUnits: 250, Discount: 0.15},
		},
	}
}
