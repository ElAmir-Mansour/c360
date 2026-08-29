package service

import (
	"fmt"

	"github.com/clario360/platform/internal/pricing/model"
)

// TierPlanMap is the explicit, configurable mapping from the four commercial
// pricing tiers to license_plans (by plan key). It is the load-bearing seam of
// the commercial loop: an accepted quote's selected tier is resolved to a
// concrete license plan key here, and only here, before AssignLicense binds the
// tenant to it.
//
// The mapping is DATA, not code: DefaultTierPlanMap is the compiled-in default
// (tier name == plan key, matching migration 000012 which seeds the four tier
// plans), and license-service wiring can override it from configuration. It is
// deliberately a value type (not a global) so tests and alternate deployments
// can supply their own without mutating package state.
type TierPlanMap map[model.Tier]string

// DefaultTierPlanMap maps each tier 1:1 to a catalog plan whose key equals the
// tier name. These plan keys are seeded by migration 000012_seed_tier_plans in
// license_db. Keeping the default identity-mapped means "the four tiers map 1:1
// to license_plans keys" (model.Tier doc) holds without any configuration.
func DefaultTierPlanMap() TierPlanMap {
	return TierPlanMap{
		model.TierStandard:     string(model.TierStandard),
		model.TierGrowth:       string(model.TierGrowth),
		model.TierProfessional: string(model.TierProfessional),
		model.TierCustomized:   string(model.TierCustomized),
	}
}

// ResolvePlanKey returns the license plan key mapped to a tier. It is
// FAIL-CLOSED: an unknown tier, or a tier with no mapped (or empty) plan key,
// is an error — the commercial loop never silently provisions "nothing" or a
// default plan. The returned error wraps model.ErrTierUnmapped so the handler
// can map it to a 422 without importing the concrete mapping.
func (m TierPlanMap) ResolvePlanKey(t model.Tier) (string, error) {
	if !model.IsValidTier(t) {
		return "", fmt.Errorf("%w: %q is not one of standard/growth/professional/customized", model.ErrTierUnmapped, t)
	}
	key, ok := m[t]
	if !ok || key == "" {
		return "", fmt.Errorf("%w: tier %q has no mapped license plan (configure the tier→plan map)", model.ErrTierUnmapped, t)
	}
	return key, nil
}

// Validate reports whether the map covers all four tiers with non-empty plan
// keys. It is used at wiring time so a misconfigured mapping fails fast rather
// than at the first provision-from-quote call.
func (m TierPlanMap) Validate() error {
	for _, t := range model.Tiers {
		if _, err := m.ResolvePlanKey(t); err != nil {
			return err
		}
	}
	return nil
}
