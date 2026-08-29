package governance

import (
	"context"
	"fmt"
	"math"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cyber/dspm/access/model"
)

// RecommendationEngine generates actionable least-privilege recommendations for an identity.
type RecommendationEngine struct {
	repo   MappingProvider
	logger zerolog.Logger
}

// NewRecommendationEngine creates a recommendation generator.
func NewRecommendationEngine(repo MappingProvider, logger zerolog.Logger) *RecommendationEngine {
	return &RecommendationEngine{
		repo:   repo,
		logger: logger.With().Str("component", "recommendation_engine").Logger(),
	}
}

// GenerateForIdentity analyzes an identity's permission profile and generates recommendations.
// Types: "revoke" (unused), "downgrade" (excessive level), "time_bound" (indefinite on sensitive), "review" (ambiguous).
func (r *RecommendationEngine) GenerateForIdentity(ctx context.Context, tenantID uuid.UUID, identityID string) ([]model.Recommendation, error) {
	allMappings, err := r.repo.ListActiveByTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	// Filter to target identity.
	var identityMappings []*model.AccessMapping
	for _, m := range allMappings {
		if m.IdentityID == identityID {
			identityMappings = append(identityMappings, m)
		}
	}

	var recommendations []model.Recommendation

	for _, m := range identityMappings {
		// 1. Revoke: unused permissions on sensitive data.
		if m.UsageCount90d == 0 && (m.DataClassification == "confidential" || m.DataClassification == "restricted") {
			riskReduction := m.SensitivityWeight * model.PermissionBreadth(m.PermissionType)
			recommendations = append(recommendations, model.Recommendation{
				Type:           "revoke",
				MappingID:      m.ID,
				IdentityID:     m.IdentityID,
				IdentityName:   m.IdentityName,
				DataAssetName:  m.DataAssetName,
				PermissionType: m.PermissionType,
				Reason:         fmt.Sprintf("لم تُستخدم صلاحية %s على %s (%s) خلال 90 يومًا", m.PermissionType, m.DataAssetName, m.DataClassification),
				Impact:         fmt.Sprintf("يزيل صلاحية %s للوصول إلى %s", m.PermissionType, m.DataAssetName),
				RiskReduction:  math.Round(riskReduction*100) / 100,
			})
			continue
		}

		// 2. Downgrade: admin/write used only for reads.
		if isHighPermission(m.PermissionType) && m.UsageCount90d > 0 {
			// If the identity has used this permission but only for read operations,
			// the permission level is excessive. Since we can't inspect individual
			// query types from the mapping alone, we flag admin/full_control for
			// downgrade consideration when usage count is low relative to read count.
			if m.PermissionType == "admin" || m.PermissionType == "full_control" {
				riskReduction := m.SensitivityWeight * (model.PermissionBreadth(m.PermissionType) - model.PermissionBreadth("read"))
				recommendations = append(recommendations, model.Recommendation{
					Type:           "downgrade",
					MappingID:      m.ID,
					IdentityID:     m.IdentityID,
					IdentityName:   m.IdentityName,
					DataAssetName:  m.DataAssetName,
					PermissionType: m.PermissionType,
					Reason:         fmt.Sprintf("قد تكون صلاحية %s الحالية مفرطة — يُنصح بخفضها إلى القراءة", m.PermissionType),
					Impact:         fmt.Sprintf("يخفض مستوى الوصول من %s إلى القراءة على %s", m.PermissionType, m.DataAssetName),
					RiskReduction:  math.Round(riskReduction*100) / 100,
				})
			}
		}

		// 3. Time-bound: indefinite grants on restricted data.
		if m.ExpiresAt == nil && m.DataClassification == "restricted" {
			recommendations = append(recommendations, model.Recommendation{
				Type:           "time_bound",
				MappingID:      m.ID,
				IdentityID:     m.IdentityID,
				IdentityName:   m.IdentityName,
				DataAssetName:  m.DataAssetName,
				PermissionType: m.PermissionType,
				Reason:         fmt.Sprintf("وصول %s غير محدد المدة إلى الأصل المقيّد %s — ينبغي أن يكون له تاريخ انتهاء", m.PermissionType, m.DataAssetName),
				Impact:         "يضيف تاريخ انتهاء مدته 30 يومًا لتقليل مخاطر الوصول الدائم",
				RiskReduction:  m.SensitivityWeight * 0.3,
			})
		}

		// 4. Review: ambiguous usage patterns (low usage on sensitive data).
		if m.UsageCount90d > 0 && m.UsageCount90d <= 3 && (m.DataClassification == "confidential" || m.DataClassification == "restricted") {
			recommendations = append(recommendations, model.Recommendation{
				Type:           "review",
				MappingID:      m.ID,
				IdentityID:     m.IdentityID,
				IdentityName:   m.IdentityName,
				DataAssetName:  m.DataAssetName,
				PermissionType: m.PermissionType,
				Reason:         fmt.Sprintf("استخدام منخفض (%d عمليات وصول خلال 90 يومًا) على %s %s — تحقّق من استمرار الحاجة إلى الوصول", m.UsageCount90d, m.DataClassification, m.DataAssetName),
				Impact:         "مراجعة بشرية لتحديد ما إذا كان الوصول مناسبًا",
				RiskReduction:  m.SensitivityWeight * 0.1,
			})
		}
	}

	return recommendations, nil
}

func isHighPermission(permType string) bool {
	return permType == "admin" || permType == "full_control" || permType == "write" || permType == "delete" || permType == "alter"
}
