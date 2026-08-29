package recoverytier

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestRecommendSelectsMinimumTierForThresholds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		rto  time.Duration
		rpo  time.Duration
		want Tier
	}{
		{name: "bronze at day objectives", rto: 24 * time.Hour, rpo: 24 * time.Hour, want: TierBronze},
		{name: "silver at four hour and one hour objectives", rto: 4 * time.Hour, rpo: time.Hour, want: TierSilver},
		{name: "gold at sub two hour and sub thirty minute objectives", rto: 90 * time.Minute, rpo: 20 * time.Minute, want: TierGold},
		{name: "platinum when RPO is tighter than gold", rto: 90 * time.Minute, rpo: 10 * time.Minute, want: TierPlatinum},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := Recommend(RecommendationRequest{RTO: tc.rto, RPO: tc.rpo})
			if err != nil {
				t.Fatalf("Recommend returned error: %v", err)
			}
			if got.Tier != tc.want {
				t.Fatalf("tier = %s, want %s", got.Tier, tc.want)
			}
		})
	}
}

func TestRecommendAppliesCriticalityFlags(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		req            RecommendationRequest
		want           Tier
		wantCyberVault bool
		wantCleanRoom  bool
		wantStrategy   Strategy
	}{
		{
			name:         "business critical starts at silver",
			req:          RecommendationRequest{RTO: 24 * time.Hour, RPO: 24 * time.Hour, BusinessCritical: true},
			want:         TierSilver,
			wantStrategy: StrategyPilotLight,
		},
		{
			name:           "mission critical starts at gold",
			req:            RecommendationRequest{RTO: 24 * time.Hour, RPO: 24 * time.Hour, MissionCritical: true},
			want:           TierGold,
			wantCyberVault: true,
			wantCleanRoom:  true,
			wantStrategy:   StrategyWarmStandby,
		},
		{
			name:           "regulated data requires cyber vault",
			req:            RecommendationRequest{RTO: 24 * time.Hour, RPO: 24 * time.Hour, RegulatedData: true},
			want:           TierGold,
			wantCyberVault: true,
			wantStrategy:   StrategyWarmStandby,
		},
		{
			name:          "ransomware sensitive requires clean room",
			req:           RecommendationRequest{RTO: 24 * time.Hour, RPO: 24 * time.Hour, RansomwareSensitive: true},
			want:          TierGold,
			wantCleanRoom: true,
			wantStrategy:  StrategyWarmStandby,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := Recommend(tc.req)
			if err != nil {
				t.Fatalf("Recommend returned error: %v", err)
			}
			if got.Tier != tc.want {
				t.Fatalf("tier = %s, want %s", got.Tier, tc.want)
			}
			if got.RecommendedStrategy != tc.wantStrategy {
				t.Fatalf("strategy = %s, want %s", got.RecommendedStrategy, tc.wantStrategy)
			}
			if tc.wantCyberVault && !got.RequiresCyberVault {
				t.Fatalf("expected cyber vault requirement")
			}
			if tc.wantCleanRoom && !got.RequiresCleanRoom {
				t.Fatalf("expected clean room requirement")
			}
		})
	}
}

func TestRecommendNearZeroObjectivesUseActiveActive(t *testing.T) {
	t.Parallel()

	got, err := Recommend(RecommendationRequest{RTO: 5 * time.Minute, RPO: time.Minute})
	if err != nil {
		t.Fatalf("Recommend returned error: %v", err)
	}
	if got.Tier != TierPlatinum {
		t.Fatalf("tier = %s, want %s", got.Tier, TierPlatinum)
	}
	if got.RecommendedStrategy != StrategyActiveActive {
		t.Fatalf("strategy = %s, want %s", got.RecommendedStrategy, StrategyActiveActive)
	}
}

func TestRecommendRejectsUnsatisfiedOrInvalidObjectives(t *testing.T) {
	t.Parallel()

	if _, err := Recommend(RecommendationRequest{RTO: 30 * time.Second, RPO: 30 * time.Second}); !errors.Is(err, ErrNoRecommendation) {
		t.Fatalf("expected ErrNoRecommendation, got %v", err)
	}
	if _, err := Recommend(RecommendationRequest{RTO: 0, RPO: time.Hour}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest, got %v", err)
	}
}

func TestCatalogValidation(t *testing.T) {
	t.Parallel()

	if err := ValidateCatalog(); err != nil {
		t.Fatalf("ValidateCatalog: %v", err)
	}
	if _, err := buildCatalog(); err != nil {
		t.Fatalf("buildCatalog: %v", err)
	}

	tests := []struct {
		name   string
		mutate func([]TierProfile) []TierProfile
	}{
		{
			name: "empty catalog",
			mutate: func(_ []TierProfile) []TierProfile {
				return nil
			},
		},
		{
			name: "duplicate tier",
			mutate: func(profiles []TierProfile) []TierProfile {
				profiles[1].Tier = profiles[0].Tier
				return profiles
			},
		},
		{
			name: "missing tier",
			mutate: func(profiles []TierProfile) []TierProfile {
				return profiles[:len(profiles)-1]
			},
		},
		{
			name: "unknown strategy",
			mutate: func(profiles []TierProfile) []TierProfile {
				profiles[0].RecommendedStrategy = Strategy("snapshot_teleport")
				return profiles
			},
		},
		{
			name: "weaker higher-tier objective",
			mutate: func(profiles []TierProfile) []TierProfile {
				profiles[2].RTOObjective = profiles[1].RTOObjective + time.Hour
				return profiles
			},
		},
		{
			name: "missing capabilities",
			mutate: func(profiles []TierProfile) []TierProfile {
				profiles[0].Capabilities = nil
				return profiles
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			profiles := tc.mutate(List())
			if err := validateCatalog(profiles); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}

func TestListOrderingIsDeterministic(t *testing.T) {
	t.Parallel()

	want := []Tier{TierBronze, TierSilver, TierGold, TierPlatinum}
	first := tiersOf(List())
	if !reflect.DeepEqual(first, want) {
		t.Fatalf("tier order = %v, want %v", first, want)
	}

	for i := 0; i < 5; i++ {
		if got := tiersOf(List()); !reflect.DeepEqual(got, first) {
			t.Fatalf("tier order changed on iteration %d: got %v want %v", i, got, first)
		}
	}
}

func TestLookupAndListReturnDefensiveCopies(t *testing.T) {
	t.Parallel()

	gold, ok := Lookup(TierGold)
	if !ok {
		t.Fatalf("expected gold profile")
	}
	if _, ok := Lookup(Tier("diamond")); ok {
		t.Fatalf("expected unknown tier lookup miss")
	}

	originalCapability := gold.Capabilities[0]
	gold.Capabilities[0] = "mutated"

	goldAgain, ok := Lookup(TierGold)
	if !ok {
		t.Fatalf("expected gold profile")
	}
	if goldAgain.Capabilities[0] != originalCapability {
		t.Fatalf("lookup exposed mutable catalog slice: got %q want %q", goldAgain.Capabilities[0], originalCapability)
	}

	listed := List()
	listed[0].Notes[0] = "mutated"
	listedAgain := List()
	if listedAgain[0].Notes[0] == "mutated" {
		t.Fatalf("list exposed mutable catalog slice")
	}
}

func tiersOf(profiles []TierProfile) []Tier {
	out := make([]Tier, len(profiles))
	for i, profile := range profiles {
		out[i] = profile.Tier
	}
	return out
}
