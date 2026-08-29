// Package recoverytier defines the built-in disaster-recovery SLO tiers used to
// translate workload objectives into a recommended recovery strategy.
package recoverytier

import (
	"errors"
	"fmt"
	"time"
)

// Tier is the stable catalog identifier for a recovery SLO tier.
type Tier string

const (
	TierBronze   Tier = "bronze"
	TierSilver   Tier = "silver"
	TierGold     Tier = "gold"
	TierPlatinum Tier = "platinum"
)

// Strategy is the recommended DR operating model for a tier.
type Strategy string

const (
	StrategyBackupRestore Strategy = "backup_restore"
	StrategyPilotLight    Strategy = "pilot_light"
	StrategyWarmStandby   Strategy = "warm_standby"
	StrategyActiveActive  Strategy = "active_active"
)

var (
	// ErrInvalidRequest is returned when a recommendation request cannot be
	// evaluated, for example because RTO/RPO were omitted.
	ErrInvalidRequest = errors.New("recoverytier: invalid recommendation request")
	// ErrNoRecommendation is returned when no built-in tier can satisfy the
	// requested objectives and criticality flags.
	ErrNoRecommendation = errors.New("recoverytier: no tier satisfies request")
)

var tierOrder = []Tier{TierBronze, TierSilver, TierGold, TierPlatinum}

var tierRank = map[Tier]int{
	TierBronze:   0,
	TierSilver:   1,
	TierGold:     2,
	TierPlatinum: 3,
}

// TierProfile is one deterministic catalog entry. RTOObjective and RPOObjective
// are maximum target objectives for the tier; lower durations represent
// stronger recovery guarantees.
type TierProfile struct {
	Tier                     Tier
	RTOObjective             time.Duration
	RPOObjective             time.Duration
	RecommendedStrategy      Strategy
	MinimumValidationCadence time.Duration
	RequiresCyberVault       bool
	RequiresCleanRoom        bool
	Capabilities             []string
	Notes                    []string
}

// Validate checks a profile is internally consistent and uses known enum values.
func (p TierProfile) Validate() error {
	if p.Tier == "" {
		return fmt.Errorf("tier is empty")
	}
	if !ValidTier(p.Tier) {
		return fmt.Errorf("tier %q is unknown", p.Tier)
	}
	if p.RTOObjective <= 0 {
		return fmt.Errorf("tier %s: RTO objective must be > 0", p.Tier)
	}
	if p.RPOObjective <= 0 {
		return fmt.Errorf("tier %s: RPO objective must be > 0", p.Tier)
	}
	if !ValidStrategy(p.RecommendedStrategy) {
		return fmt.Errorf("tier %s: strategy %q is unknown", p.Tier, p.RecommendedStrategy)
	}
	if p.MinimumValidationCadence <= 0 {
		return fmt.Errorf("tier %s: minimum validation cadence must be > 0", p.Tier)
	}
	if err := validateStringSet("capability", p.Tier, p.Capabilities); err != nil {
		return err
	}
	if err := validateStringSet("note", p.Tier, p.Notes); err != nil {
		return err
	}
	return nil
}

// Satisfies reports whether the profile meets the requested objectives and
// criticality flags.
func (p TierProfile) Satisfies(req RecommendationRequest) bool {
	if !ValidTier(p.Tier) {
		return false
	}
	if req.RTO <= 0 || req.RPO <= 0 {
		return false
	}
	if p.RTOObjective > req.RTO || p.RPOObjective > req.RPO {
		return false
	}
	if tierRank[p.Tier] < req.minimumRank() {
		return false
	}
	if req.RegulatedData && !p.RequiresCyberVault {
		return false
	}
	if req.RansomwareSensitive && !p.RequiresCleanRoom {
		return false
	}
	return true
}

// RecommendationRequest is the input to Recommend. RTO and RPO are the maximum
// acceptable recovery time and data-loss objectives for a workload.
type RecommendationRequest struct {
	RTO                 time.Duration
	RPO                 time.Duration
	BusinessCritical    bool
	MissionCritical     bool
	RegulatedData       bool
	RansomwareSensitive bool
}

func (r RecommendationRequest) minimumRank() int {
	minimum := 0
	if r.BusinessCritical {
		minimum = max(minimum, tierRank[TierSilver])
	}
	if r.MissionCritical {
		minimum = max(minimum, tierRank[TierGold])
	}
	return minimum
}

// Recommend returns the lowest built-in tier that satisfies the requested
// RTO/RPO objectives and criticality flags.
func Recommend(req RecommendationRequest) (TierProfile, error) {
	if req.RTO <= 0 {
		return TierProfile{}, fmt.Errorf("%w: RTO must be > 0", ErrInvalidRequest)
	}
	if req.RPO <= 0 {
		return TierProfile{}, fmt.Errorf("%w: RPO must be > 0", ErrInvalidRequest)
	}
	for _, profile := range List() {
		if profile.Satisfies(req) {
			return profile, nil
		}
	}
	return TierProfile{}, fmt.Errorf("%w: RTO=%s RPO=%s", ErrNoRecommendation, req.RTO, req.RPO)
}

// ValidTier reports whether t is one of the built-in tier constants.
func ValidTier(t Tier) bool {
	_, ok := tierRank[t]
	return ok
}

// ValidStrategy reports whether s is one of the built-in strategy constants.
func ValidStrategy(s Strategy) bool {
	switch s {
	case StrategyBackupRestore, StrategyPilotLight, StrategyWarmStandby, StrategyActiveActive:
		return true
	default:
		return false
	}
}

var catalog map[Tier]TierProfile

func init() {
	c, err := buildCatalog()
	if err != nil {
		panic(fmt.Sprintf("recoverytier: invalid built-in catalog: %v", err))
	}
	catalog = c
}

func buildCatalog() (map[Tier]TierProfile, error) {
	profiles := []TierProfile{
		{
			Tier:                     TierBronze,
			RTOObjective:             24 * time.Hour,
			RPOObjective:             24 * time.Hour,
			RecommendedStrategy:      StrategyBackupRestore,
			MinimumValidationCadence: 90 * 24 * time.Hour,
			Capabilities: []string{
				"scheduled_backups",
				"restore_runbooks",
				"quarterly_validation",
			},
			Notes: []string{
				"Baseline tier for low-criticality workloads with day-scale recovery objectives.",
				"Restores from protected backups into rebuilt infrastructure.",
			},
		},
		{
			Tier:                     TierSilver,
			RTOObjective:             4 * time.Hour,
			RPOObjective:             time.Hour,
			RecommendedStrategy:      StrategyPilotLight,
			MinimumValidationCadence: 30 * 24 * time.Hour,
			Capabilities: []string{
				"pilot_light_infrastructure",
				"cross_region_replication",
				"monthly_validation",
			},
			Notes: []string{
				"Recommended for business-critical services that can tolerate hours of recovery.",
				"Keeps core dependencies pre-positioned while application capacity scales during recovery.",
			},
		},
		{
			Tier:                     TierGold,
			RTOObjective:             time.Hour,
			RPOObjective:             15 * time.Minute,
			RecommendedStrategy:      StrategyWarmStandby,
			MinimumValidationCadence: 14 * 24 * time.Hour,
			RequiresCyberVault:       true,
			RequiresCleanRoom:        true,
			Capabilities: []string{
				"warm_standby_capacity",
				"immutable_cyber_vault",
				"clean_room_validation",
				"biweekly_validation",
			},
			Notes: []string{
				"Recommended for mission-critical or regulated workloads with sub-hour recovery targets.",
				"Maintains a running recovery environment and ransomware-safe recovery evidence.",
			},
		},
		{
			Tier:                     TierPlatinum,
			RTOObjective:             5 * time.Minute,
			RPOObjective:             time.Minute,
			RecommendedStrategy:      StrategyActiveActive,
			MinimumValidationCadence: 7 * 24 * time.Hour,
			RequiresCyberVault:       true,
			RequiresCleanRoom:        true,
			Capabilities: []string{
				"active_active_replication",
				"automated_failover",
				"continuous_health_checks",
				"immutable_cyber_vault",
				"clean_room_validation",
				"weekly_validation",
			},
			Notes: []string{
				"Recommended for near-zero recovery objectives and services that cannot tolerate regional downtime.",
				"Requires continuously exercised traffic steering and conflict-aware data replication.",
			},
		},
	}

	if err := validateCatalog(profiles); err != nil {
		return nil, err
	}
	out := make(map[Tier]TierProfile, len(profiles))
	for _, profile := range profiles {
		out[profile.Tier] = cloneProfile(profile)
	}
	return out, nil
}

// ValidateCatalog checks the built-in catalog is internally consistent.
func ValidateCatalog() error {
	return validateCatalog(List())
}

func validateCatalog(profiles []TierProfile) error {
	if len(profiles) == 0 {
		return fmt.Errorf("catalog is empty")
	}
	seen := make(map[Tier]TierProfile, len(profiles))
	for _, profile := range profiles {
		if err := profile.Validate(); err != nil {
			return err
		}
		if _, dup := seen[profile.Tier]; dup {
			return fmt.Errorf("duplicate tier %q", profile.Tier)
		}
		seen[profile.Tier] = profile
	}
	for _, tier := range tierOrder {
		if _, ok := seen[tier]; !ok {
			return fmt.Errorf("missing tier %q", tier)
		}
	}
	for i := 1; i < len(tierOrder); i++ {
		prev := seen[tierOrder[i-1]]
		next := seen[tierOrder[i]]
		if next.RTOObjective > prev.RTOObjective {
			return fmt.Errorf("tier %s has weaker RTO objective than %s", next.Tier, prev.Tier)
		}
		if next.RPOObjective > prev.RPOObjective {
			return fmt.Errorf("tier %s has weaker RPO objective than %s", next.Tier, prev.Tier)
		}
		if next.MinimumValidationCadence > prev.MinimumValidationCadence {
			return fmt.Errorf("tier %s has weaker validation cadence than %s", next.Tier, prev.Tier)
		}
	}
	return nil
}

// List returns the built-in catalog sorted from lowest to highest recovery tier.
func List() []TierProfile {
	out := make([]TierProfile, 0, len(catalog))
	for _, tier := range tierOrder {
		if profile, ok := catalog[tier]; ok {
			out = append(out, cloneProfile(profile))
		}
	}
	return out
}

// Lookup returns a profile by tier and whether it exists.
func Lookup(tier Tier) (TierProfile, bool) {
	profile, ok := catalog[tier]
	if !ok {
		return TierProfile{}, false
	}
	return cloneProfile(profile), true
}

func cloneProfile(profile TierProfile) TierProfile {
	profile.Capabilities = append([]string(nil), profile.Capabilities...)
	profile.Notes = append([]string(nil), profile.Notes...)
	return profile
}

func validateStringSet(name string, tier Tier, values []string) error {
	if len(values) == 0 {
		return fmt.Errorf("tier %s: at least one %s is required", tier, name)
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			return fmt.Errorf("tier %s: empty %s", tier, name)
		}
		if _, dup := seen[value]; dup {
			return fmt.Errorf("tier %s: duplicate %s %q", tier, name, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}
