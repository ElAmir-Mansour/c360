package recoverytier

import (
	"errors"
	"testing"
	"time"
)

func TestServiceListGetAndRecommend(t *testing.T) {
	t.Parallel()

	svc := NewService()
	profiles := svc.ListProfiles()
	if len(profiles) != 4 {
		t.Fatalf("profiles = %d, want 4", len(profiles))
	}
	if profiles[0].Tier != TierBronze || profiles[3].Tier != TierPlatinum {
		t.Fatalf("tier order = %v, want bronze..platinum", tiersOf(profiles))
	}

	gold, err := svc.GetProfile(TierGold)
	if err != nil {
		t.Fatalf("GetProfile(gold): %v", err)
	}
	if gold.RTOObjective != time.Hour || gold.RPOObjective != 15*time.Minute {
		t.Fatalf("gold objectives = %s/%s, want 1h/15m", gold.RTOObjective, gold.RPOObjective)
	}

	got, err := svc.Recommend(RecommendationRequest{RTO: 4 * time.Hour, RPO: time.Hour})
	if err != nil {
		t.Fatalf("Recommend: %v", err)
	}
	if got.Tier != TierSilver {
		t.Fatalf("recommended tier = %s, want %s", got.Tier, TierSilver)
	}
}

func TestServiceGetProfileUnknownTier(t *testing.T) {
	t.Parallel()

	_, err := NewService().GetProfile(Tier("diamond"))
	if !errors.Is(err, ErrTierNotFound) {
		t.Fatalf("error = %v, want ErrTierNotFound", err)
	}
}

func TestRecommendationRequestJSONConvertsSeconds(t *testing.T) {
	t.Parallel()

	got, err := (RecommendationRequestJSON{
		RTOSeconds:          3600,
		RPOSeconds:          900,
		BusinessCritical:    true,
		MissionCritical:     true,
		RegulatedData:       true,
		RansomwareSensitive: true,
	}).ToRecommendationRequest()
	if err != nil {
		t.Fatalf("ToRecommendationRequest: %v", err)
	}
	if got.RTO != time.Hour || got.RPO != 15*time.Minute {
		t.Fatalf("durations = %s/%s, want 1h/15m", got.RTO, got.RPO)
	}
	if !got.BusinessCritical || !got.MissionCritical || !got.RegulatedData || !got.RansomwareSensitive {
		t.Fatalf("flags not propagated: %+v", got)
	}
}

func TestRecommendationRequestJSONRejectsInvalidSeconds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		req  RecommendationRequestJSON
	}{
		{name: "zero RTO", req: RecommendationRequestJSON{RTOSeconds: 0, RPOSeconds: 1}},
		{name: "negative RPO", req: RecommendationRequestJSON{RTOSeconds: 1, RPOSeconds: -1}},
		{name: "overflow RTO", req: RecommendationRequestJSON{RTOSeconds: maxDurationSeconds + 1, RPOSeconds: 1}},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if _, err := tc.req.ToRecommendationRequest(); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("error = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

func TestNewProfileResponseUsesSecondFields(t *testing.T) {
	t.Parallel()

	gold, err := NewService().GetProfile(TierGold)
	if err != nil {
		t.Fatalf("GetProfile(gold): %v", err)
	}
	resp := NewProfileResponse(gold)
	if resp.Tier != TierGold {
		t.Fatalf("tier = %s, want %s", resp.Tier, TierGold)
	}
	if resp.RTOSeconds != 3600 || resp.RPOSeconds != 900 {
		t.Fatalf("seconds = %d/%d, want 3600/900", resp.RTOSeconds, resp.RPOSeconds)
	}
	if resp.MinimumValidationCadenceSeconds != int64((14*24*time.Hour)/time.Second) {
		t.Fatalf("cadence seconds = %d, want two weeks", resp.MinimumValidationCadenceSeconds)
	}
	if len(resp.Capabilities) == 0 || len(resp.Notes) == 0 {
		t.Fatalf("response dropped catalog text: %+v", resp)
	}
}
