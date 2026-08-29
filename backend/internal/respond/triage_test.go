package respond

import (
	"errors"
	"testing"
)

func TestRecommendSeverityTableDriven(t *testing.T) {
	tests := []struct {
		name string
		in   IncidentImpactAssessmentInput
		want Severity
	}{
		{
			name: "no material impact is sev4",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeNone,
				BusinessCriticality: BusinessCriticalityNone,
				RevenueImpact:       RevenueImpactNone,
				RegulatoryExposure:  RegulatoryExposureNone,
			},
			want: SeveritySEV4,
		},
		{
			name: "limited user group is sev3",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeLimited,
				BusinessCriticality: BusinessCriticalityNonCritical,
				RevenueImpact:       RevenueImpactNone,
				RegulatoryExposure:  RegulatoryExposureNone,
			},
			want: SeveritySEV3,
		},
		{
			name: "material revenue impact is sev2",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeIndividual,
				BusinessCriticality: BusinessCriticalityNonCritical,
				RevenueImpact:       RevenueImpactMaterial,
				RegulatoryExposure:  RegulatoryExposureNone,
			},
			want: SeveritySEV2,
		},
		{
			name: "confirmed regulatory exposure is sev1",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeIndividual,
				BusinessCriticality: BusinessCriticalityNonCritical,
				RevenueImpact:       RevenueImpactLow,
				RegulatoryExposure:  RegulatoryExposureConfirmed,
			},
			want: SeveritySEV1,
		},
		{
			name: "critical process stopped is sev1",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeLimited,
				BusinessCriticality: BusinessCriticalityCriticalStopped,
				RevenueImpact:       RevenueImpactLow,
				RegulatoryExposure:  RegulatoryExposureUnlikely,
			},
			want: SeveritySEV1,
		},
		{
			name: "large user group and critical degradation is sev2",
			in: IncidentImpactAssessmentInput{
				UserScope:           UserScopeLarge,
				BusinessCriticality: BusinessCriticalityCriticalDegraded,
				RevenueImpact:       RevenueImpactLow,
				RegulatoryExposure:  RegulatoryExposureNone,
			},
			want: SeveritySEV2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := RecommendSeverity(tt.in)
			if err != nil {
				t.Fatalf("RecommendSeverity returned error: %v", err)
			}
			if got.Severity != tt.want {
				t.Fatalf("severity = %s, want %s", got.Severity, tt.want)
			}
			if got.RuleVersion != SeverityRecommendationRuleVersion {
				t.Fatalf("rule version = %q, want %q", got.RuleVersion, SeverityRecommendationRuleVersion)
			}
			if len(got.DimensionSeverities) != 4 {
				t.Fatalf("dimension severities = %d, want 4", len(got.DimensionSeverities))
			}
			if len(got.Reasons) == 0 {
				t.Fatalf("recommendation did not include provenance reasons")
			}
		})
	}
}

func TestRecommendSeverityRejectsInvalidImpactAssessment(t *testing.T) {
	_, err := RecommendSeverity(IncidentImpactAssessmentInput{
		UserScope:           UserImpactScope("everyone"),
		BusinessCriticality: BusinessCriticalityNone,
		RevenueImpact:       RevenueImpactNone,
		RegulatoryExposure:  RegulatoryExposureNone,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}
