package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cyber/dspm/access/analyzer"
	"github.com/clario360/platform/internal/cyber/dspm/access/collector"
	"github.com/clario360/platform/internal/cyber/dspm/access/dto"
	"github.com/clario360/platform/internal/cyber/dspm/access/governance"
	"github.com/clario360/platform/internal/cyber/dspm/access/mapper"
	"github.com/clario360/platform/internal/cyber/dspm/access/model"
	"github.com/clario360/platform/internal/cyber/repository"
	"github.com/clario360/platform/internal/events"
)

// AccessIntelligenceService is the business logic layer for the DSPM Access Intelligence module.
type AccessIntelligenceService struct {
	mappingRepo     *repository.AccessMappingRepository
	auditRepo       *repository.AccessAuditRepository
	policyRepo      *repository.AccessPolicyRepository
	remediationRepo *repository.AccessRemediationRepository

	permCollector     *collector.PermissionCollector
	identityMapper    *mapper.IdentityMapper
	permGraph         *mapper.PermissionGraph
	effectiveAccess   *mapper.EffectiveAccessResolver
	sensitivityScorer *mapper.SensitivityScorer

	overprivAnalyzer    *analyzer.OverprivilegeAnalyzer
	staleAnalyzer       *analyzer.StaleAccessAnalyzer
	blastRadiusAnalyzer *analyzer.BlastRadiusAnalyzer
	privEscAnalyzer     *analyzer.PrivEscAnalyzer
	crossAssetAnalyzer  *analyzer.CrossAssetAnalyzer
	anomalyDetector     *analyzer.AccessAnomalyDetector

	policyEngine    *governance.PolicyEngine
	recommendEngine *governance.RecommendationEngine
	timeBoundMgr    *governance.TimeBoundManager

	producer *events.Producer
	logger   zerolog.Logger
}

// NewAccessIntelligenceService creates a new access intelligence service.
func NewAccessIntelligenceService(
	mappingRepo *repository.AccessMappingRepository,
	auditRepo *repository.AccessAuditRepository,
	policyRepo *repository.AccessPolicyRepository,
	remediationRepo *repository.AccessRemediationRepository,
	permCollector *collector.PermissionCollector,
	identityMapper *mapper.IdentityMapper,
	permGraph *mapper.PermissionGraph,
	effectiveAccess *mapper.EffectiveAccessResolver,
	sensitivityScorer *mapper.SensitivityScorer,
	overprivAnalyzer *analyzer.OverprivilegeAnalyzer,
	staleAnalyzer *analyzer.StaleAccessAnalyzer,
	blastRadiusAnalyzer *analyzer.BlastRadiusAnalyzer,
	privEscAnalyzer *analyzer.PrivEscAnalyzer,
	crossAssetAnalyzer *analyzer.CrossAssetAnalyzer,
	anomalyDetector *analyzer.AccessAnomalyDetector,
	policyEngine *governance.PolicyEngine,
	recommendEngine *governance.RecommendationEngine,
	timeBoundMgr *governance.TimeBoundManager,
	producer *events.Producer,
	logger zerolog.Logger,
) *AccessIntelligenceService {
	return &AccessIntelligenceService{
		mappingRepo:         mappingRepo,
		auditRepo:           auditRepo,
		policyRepo:          policyRepo,
		remediationRepo:     remediationRepo,
		permCollector:       permCollector,
		identityMapper:      identityMapper,
		permGraph:           permGraph,
		effectiveAccess:     effectiveAccess,
		sensitivityScorer:   sensitivityScorer,
		overprivAnalyzer:    overprivAnalyzer,
		staleAnalyzer:       staleAnalyzer,
		blastRadiusAnalyzer: blastRadiusAnalyzer,
		privEscAnalyzer:     privEscAnalyzer,
		crossAssetAnalyzer:  crossAssetAnalyzer,
		anomalyDetector:     anomalyDetector,
		policyEngine:        policyEngine,
		recommendEngine:     recommendEngine,
		timeBoundMgr:        timeBoundMgr,
		producer:            producer,
		logger:              logger.With().Str("service", "access_intelligence").Logger(),
	}
}

// ── Identity Profiles ────────────────────────────────────────────────────────

// ListIdentities returns paginated identity profiles sorted by risk.
func (s *AccessIntelligenceService) ListIdentities(ctx context.Context, tenantID uuid.UUID, params *dto.IdentityListParams) (*dto.IdentityListResponse, error) {
	items, total, err := s.mappingRepo.ListIdentityProfiles(ctx, tenantID, params)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	return &dto.IdentityListResponse{
		Data: items,
		Meta: dto.PaginationMeta{Page: params.Page, PerPage: params.PerPage, Total: total, TotalPages: totalPages},
	}, nil
}

// GetIdentity returns a single identity profile.
func (s *AccessIntelligenceService) GetIdentity(ctx context.Context, tenantID uuid.UUID, identityID string) (*model.IdentityProfile, error) {
	return s.mappingRepo.GetIdentityProfile(ctx, tenantID, identityID)
}

// GetIdentityMappings returns all active access mappings for an identity.
func (s *AccessIntelligenceService) GetIdentityMappings(ctx context.Context, tenantID uuid.UUID, identityID string) ([]*model.AccessMapping, error) {
	return s.mappingRepo.ListByIdentity(ctx, tenantID, identityID)
}

// GetBlastRadius calculates the blast radius for an identity.
func (s *AccessIntelligenceService) GetBlastRadius(ctx context.Context, tenantID uuid.UUID, identityID string) (*model.BlastRadius, error) {
	return s.blastRadiusAnalyzer.Calculate(ctx, tenantID, identityID)
}

// GetRecommendations generates least-privilege recommendations for an identity.
func (s *AccessIntelligenceService) GetRecommendations(ctx context.Context, tenantID uuid.UUID, identityID string) ([]model.Recommendation, error) {
	return s.recommendEngine.GenerateForIdentity(ctx, tenantID, identityID)
}

// RemediateRecommendation acts on a least-privilege recommendation for an
// identity. Recommendations are computed per access mapping, so recommendationID
// is the target mapping's ID (Recommendation.MappingID from GetRecommendations).
//
// The action performs a REAL, persisted state transition:
//   - revoke:  mapping.status -> 'revoked', remediation_status -> 'revoked'
//   - apply:   mapping.status -> 'pending_review', remediation_status -> 'applied'
//   - dismiss: mapping.status unchanged, remediation_status -> 'dismissed'
//
// Every decision is written to the dspm_access_remediation_actions ledger and an
// access-audit entry is recorded. External cloud-provider IAM enforcement is a
// deliberate no-op here — see the enforcement hook TODO below; the platform
// honestly records the DECISION and internal STATE only.
func (s *AccessIntelligenceService) RemediateRecommendation(
	ctx context.Context,
	tenantID uuid.UUID,
	identityID string,
	recommendationID uuid.UUID,
	action string,
	note string,
	actorID uuid.UUID,
) (*model.RemediationResult, error) {
	mapping, err := s.remediationRepo.GetMapping(ctx, tenantID, recommendationID)
	if err != nil {
		return nil, err
	}
	// The recommendation must belong to the identity in the path.
	if mapping.IdentityID != identityID {
		return nil, repository.ErrNotFound
	}

	remediationStatus, mappingStatus, ok := remediationStateForAction(action)
	if !ok {
		return nil, fmt.Errorf("invalid remediation action: %s", action)
	}

	// TODO(dspm-enforcement): wire real cloud-provider IAM enforcement here
	// (e.g. AWS IAM policy detach, Azure RBAC role assignment removal, GCP IAM
	// binding revoke) via a pluggable Enforcer. Until that lands the platform
	// records the decision + internal state only, so enforcedExternally is false
	// and outcome is 'recorded' (not 'enforced').
	enforcedExternally := false
	outcome := "recorded"

	actorRef := actorID
	remediationAction := &model.RemediationAction{
		TenantID:           tenantID,
		MappingID:          mapping.ID,
		IdentityType:       mapping.IdentityType,
		IdentityID:         mapping.IdentityID,
		IdentityName:       mapping.IdentityName,
		DataAssetID:        mapping.DataAssetID,
		DataAssetName:      mapping.DataAssetName,
		TargetPermission:   mapping.PermissionType,
		Action:             action,
		Outcome:            outcome,
		Note:               note,
		EnforcedExternally: enforcedExternally,
		ActorID:            &actorRef,
	}

	if err := s.remediationRepo.ApplyRemediation(ctx, remediationAction, remediationStatus, mappingStatus); err != nil {
		return nil, err
	}

	// Record an access-audit entry for the remediation, mirroring how the module
	// audits data-access events.
	auditEntry := &model.AccessAuditEntry{
		TenantID:        tenantID,
		IdentityType:    mapping.IdentityType,
		IdentityID:      mapping.IdentityID,
		DataAssetID:     mapping.DataAssetID,
		Action:          "remediation." + action,
		Success:         true,
		AccessMappingID: &mapping.ID,
		EventTimestamp:  time.Now().UTC(),
	}
	if auditErr := s.auditRepo.Insert(ctx, auditEntry); auditErr != nil {
		s.logger.Warn().Err(auditErr).
			Str("mapping_id", mapping.ID.String()).
			Msg("failed to record remediation audit entry")
	}

	_ = publishEvent(ctx, s.producer, events.Topics.DSPMEvents,
		"com.clario360.cyber.dspm.access.remediation."+action,
		tenantID, nil, map[string]interface{}{
			"mapping_id":        mapping.ID.String(),
			"identity_id":       mapping.IdentityID,
			"target_permission": mapping.PermissionType,
			"action":            action,
			"outcome":           outcome,
		})

	newMappingStatus := mapping.Status
	if mappingStatus != "" {
		newMappingStatus = mappingStatus
	}

	return &model.RemediationResult{
		Action:            *remediationAction,
		MappingID:         mapping.ID,
		RemediationStatus: remediationStatus,
		MappingStatus:     newMappingStatus,
		RemediatedAt:      remediationAction.CreatedAt,
	}, nil
}

// ListRemediationActions returns the remediation ledger for a mapping.
func (s *AccessIntelligenceService) ListRemediationActions(ctx context.Context, tenantID, mappingID uuid.UUID) ([]model.RemediationAction, error) {
	return s.remediationRepo.ListByMapping(ctx, tenantID, mappingID)
}

// remediationStateForAction maps a remediation action to the resulting
// remediation status and (optional) mapping status override. ok is false for
// unknown actions. An empty mappingStatus means "leave the mapping status as is".
func remediationStateForAction(action string) (remediationStatus, mappingStatus string, ok bool) {
	switch action {
	case "revoke":
		return "revoked", "revoked", true
	case "apply":
		return "applied", "pending_review", true
	case "dismiss":
		return "dismissed", "", true
	default:
		return "", "", false
	}
}

// ── Data Asset Access ────────────────────────────────────────────────────────

// GetAssetIdentities returns who can access a data asset.
func (s *AccessIntelligenceService) GetAssetIdentities(ctx context.Context, tenantID uuid.UUID, assetID uuid.UUID) ([]*model.AccessMapping, error) {
	return s.mappingRepo.ListByAsset(ctx, tenantID, assetID)
}

// GetAssetAudit returns the access audit trail for a data asset.
func (s *AccessIntelligenceService) GetAssetAudit(ctx context.Context, tenantID uuid.UUID, assetID uuid.UUID, params *dto.AuditListParams) (*dto.AuditListResponse, error) {
	entries, total, err := s.auditRepo.ListByAsset(ctx, tenantID, assetID, params)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	return &dto.AuditListResponse{
		Data: entries,
		Meta: dto.PaginationMeta{Page: params.Page, PerPage: params.PerPage, Total: total, TotalPages: totalPages},
	}, nil
}

// GetIdentityAudit returns the access audit trail for a specific identity.
func (s *AccessIntelligenceService) GetIdentityAudit(ctx context.Context, tenantID uuid.UUID, identityID string, params *dto.AuditListParams) (*dto.AuditListResponse, error) {
	entries, total, err := s.auditRepo.ListByIdentity(ctx, tenantID, identityID, params)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	return &dto.AuditListResponse{
		Data: entries,
		Meta: dto.PaginationMeta{Page: params.Page, PerPage: params.PerPage, Total: total, TotalPages: totalPages},
	}, nil
}

// ── Mappings ─────────────────────────────────────────────────────────────────

// ListMappings returns paginated access mappings.
func (s *AccessIntelligenceService) ListMappings(ctx context.Context, tenantID uuid.UUID, params *dto.AccessMappingListParams) (*dto.AccessMappingListResponse, error) {
	items, total, err := s.mappingRepo.ListMappings(ctx, tenantID, params)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	return &dto.AccessMappingListResponse{
		Data: items,
		Meta: dto.PaginationMeta{Page: params.Page, PerPage: params.PerPage, Total: total, TotalPages: totalPages},
	}, nil
}

// GetOverprivileged returns overprivileged access findings.
func (s *AccessIntelligenceService) GetOverprivileged(ctx context.Context, tenantID uuid.UUID) ([]model.OverprivilegeResult, error) {
	return s.overprivAnalyzer.Analyze(ctx, tenantID)
}

// GetStaleAccess returns stale/unused permissions.
func (s *AccessIntelligenceService) GetStaleAccess(ctx context.Context, tenantID uuid.UUID) ([]model.StaleAccessResult, error) {
	return s.staleAnalyzer.Analyze(ctx, tenantID, 90)
}

// ── Analysis ─────────────────────────────────────────────────────────────────

// GetRiskRanking returns identity profiles sorted by access risk score.
func (s *AccessIntelligenceService) GetRiskRanking(ctx context.Context, tenantID uuid.UUID) ([]model.IdentityProfile, error) {
	params := &dto.IdentityListParams{Sort: "access_risk_score", Order: "desc", PerPage: 50}
	params.SetDefaults()
	items, _, err := s.mappingRepo.ListIdentityProfiles(ctx, tenantID, params)
	if err != nil {
		return nil, err
	}
	result := make([]model.IdentityProfile, 0, len(items))
	for _, p := range items {
		result = append(result, *p)
	}
	return result, nil
}

// GetBlastRadiusRanking returns identity profiles sorted by blast radius score.
func (s *AccessIntelligenceService) GetBlastRadiusRanking(ctx context.Context, tenantID uuid.UUID) ([]model.IdentityProfile, error) {
	params := &dto.IdentityListParams{Sort: "blast_radius_score", Order: "desc", PerPage: 50}
	params.SetDefaults()
	items, _, err := s.mappingRepo.ListIdentityProfiles(ctx, tenantID, params)
	if err != nil {
		return nil, err
	}
	result := make([]model.IdentityProfile, 0, len(items))
	for _, p := range items {
		result = append(result, *p)
	}
	return result, nil
}

// GetEscalationPaths returns privilege escalation paths found across all identities.
func (s *AccessIntelligenceService) GetEscalationPaths(ctx context.Context, tenantID uuid.UUID) ([]model.EscalationPath, error) {
	return s.privEscAnalyzer.FindAllPaths(ctx, tenantID)
}

// GetCrossAsset returns cross-asset access correlations.
func (s *AccessIntelligenceService) GetCrossAsset(ctx context.Context, tenantID uuid.UUID) ([]model.CrossAssetResult, error) {
	return s.crossAssetAnalyzer.Analyze(ctx, tenantID)
}

// ── Governance ───────────────────────────────────────────────────────────────

// ListPolicies returns all access policies for a tenant.
func (s *AccessIntelligenceService) ListPolicies(ctx context.Context, tenantID uuid.UUID) ([]model.AccessPolicy, error) {
	return s.policyRepo.ListAll(ctx, tenantID)
}

// CreatePolicy creates a new access policy.
func (s *AccessIntelligenceService) CreatePolicy(ctx context.Context, tenantID uuid.UUID, req *dto.CreatePolicyRequest, createdBy uuid.UUID) (*model.AccessPolicy, error) {
	policy := &model.AccessPolicy{
		TenantID:    tenantID,
		Name:        req.Name,
		Description: req.Description,
		PolicyType:  req.PolicyType,
		RuleConfig:  req.RuleConfig,
		Enforcement: req.Enforcement,
		Severity:    req.Severity,
		Enabled:     req.Enabled,
		CreatedBy:   &createdBy,
	}
	if err := s.policyRepo.Create(ctx, policy); err != nil {
		return nil, err
	}
	_ = publishEvent(ctx, s.producer, events.Topics.DSPMEvents,
		"com.clario360.cyber.dspm.access.policy.created",
		tenantID, nil, map[string]interface{}{
			"policy_id": policy.ID, "name": policy.Name, "type": policy.PolicyType,
		})
	return policy, nil
}

// UpdatePolicy updates an existing access policy.
func (s *AccessIntelligenceService) UpdatePolicy(ctx context.Context, tenantID, policyID uuid.UUID, req *dto.UpdatePolicyRequest) (*model.AccessPolicy, error) {
	existing, err := s.policyRepo.GetByID(ctx, tenantID, policyID)
	if err != nil {
		return nil, err
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.RuleConfig != nil {
		existing.RuleConfig = *req.RuleConfig
	}
	if req.Enforcement != nil {
		existing.Enforcement = *req.Enforcement
	}
	if req.Severity != nil {
		existing.Severity = *req.Severity
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if err := s.policyRepo.Update(ctx, existing); err != nil {
		return nil, err
	}
	return existing, nil
}

// DeletePolicy removes an access policy.
func (s *AccessIntelligenceService) DeletePolicy(ctx context.Context, tenantID, policyID uuid.UUID) error {
	return s.policyRepo.Delete(ctx, tenantID, policyID)
}

// GetPolicyViolations evaluates all enabled policies and returns violations.
func (s *AccessIntelligenceService) GetPolicyViolations(ctx context.Context, tenantID uuid.UUID) ([]model.PolicyViolation, error) {
	return s.policyEngine.Evaluate(ctx, tenantID)
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// Dashboard returns access intelligence KPIs.
func (s *AccessIntelligenceService) Dashboard(ctx context.Context, tenantID uuid.UUID) (*model.AccessDashboard, error) {
	totalIdentities, err := s.mappingRepo.CountIdentities(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	highRisk, err := s.mappingRepo.CountHighRiskIdentities(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	overpriv, err := s.mappingRepo.CountOverprivileged(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	staleCount, err := s.mappingRepo.CountStale(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	avgBlast, err := s.mappingRepo.AvgBlastRadius(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	violations, err := s.policyRepo.CountViolations(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	totalMappings, err := s.mappingRepo.CountTotal(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	activeMappings, err := s.mappingRepo.CountActive(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	riskDist, err := s.mappingRepo.RiskDistribution(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	classAccess, err := s.mappingRepo.ClassificationAccessBreakdown(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	topRisky, err := s.mappingRepo.TopRiskyIdentities(ctx, tenantID, 10)
	if err != nil {
		return nil, err
	}

	topRiskyList := make([]model.IdentityProfile, 0, len(topRisky))
	for _, p := range topRisky {
		topRiskyList = append(topRiskyList, *p)
	}

	return &model.AccessDashboard{
		TotalIdentities:        totalIdentities,
		HighRiskIdentities:     highRisk,
		OverprivilegedMappings: overpriv,
		StalePermissions:       staleCount,
		AvgBlastRadius:         math.Round(avgBlast*100) / 100,
		PolicyViolations:       violations,
		TotalMappings:          totalMappings,
		ActiveMappings:         activeMappings,
		RiskDistribution:       riskDist,
		ClassificationAccess:   classAccess,
		TopRiskyIdentities:     topRiskyList,
	}, nil
}

// ── Collection Engine ────────────────────────────────────────────────────────

// RunCollectionCycle executes the full access intelligence collection and analysis
// cycle for a single tenant. This is called by the scheduling engine.
func (s *AccessIntelligenceService) RunCollectionCycle(ctx context.Context, tenantID uuid.UUID) error {
	start := time.Now()
	s.logger.Info().Str("tenant_id", tenantID.String()).Msg("starting access intelligence collection cycle")

	// 1. Collect permissions from all sources.
	var perms []collector.RawPermission
	if s.permCollector != nil {
		var err error
		perms, err = s.permCollector.CollectAll(ctx, tenantID)
		if err != nil {
			s.logger.Error().Err(err).Msg("permission collection failed")
			return err
		}
	}

	// 2. Build/update access mappings.
	if len(perms) > 0 {
		if err := s.identityMapper.BuildMappings(ctx, tenantID, perms); err != nil {
			s.logger.Error().Err(err).Msg("identity mapping failed")
			return err
		}
	}

	// 3. Mark stale mappings.
	_, _ = s.staleAnalyzer.MarkStale(ctx, tenantID, 90, s.mappingRepo)

	// 4. Update identity profiles.
	if err := s.updateIdentityProfiles(ctx, tenantID); err != nil {
		s.logger.Error().Err(err).Msg("identity profile update failed")
	}

	// 5. Expire time-bound grants.
	if s.timeBoundMgr != nil {
		_, _ = s.timeBoundMgr.ExpireGrants(ctx, tenantID)
	}

	duration := time.Since(start)
	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Dur("duration", duration).
		Msg("access intelligence collection cycle complete")

	return nil
}

// updateIdentityProfiles recalculates aggregated identity profiles from current mappings.
func (s *AccessIntelligenceService) updateIdentityProfiles(ctx context.Context, tenantID uuid.UUID) error {
	mappings, err := s.mappingRepo.ListActiveByTenant(ctx, tenantID)
	if err != nil {
		return err
	}

	// Group by identity.
	type identityData struct {
		name     string
		email    string
		source   string
		idType   string
		mappings []*model.AccessMapping
	}
	byIdentity := make(map[string]*identityData)
	for _, m := range mappings {
		key := m.IdentityType + "|" + m.IdentityID
		id, ok := byIdentity[key]
		if !ok {
			id = &identityData{
				name:   m.IdentityName,
				source: m.IdentitySource,
				idType: m.IdentityType,
			}
			byIdentity[key] = id
		}
		id.mappings = append(id.mappings, m)
	}

	// Get asset weights for blast radius.
	weights, _ := s.mappingRepo.AllAssetWeights(ctx, tenantID)
	maxPossible := s.sensitivityScorer.MaxPossibleScore(weights)

	for key, id := range byIdentity {
		identityID := key[len(id.idType)+1:]

		totalAssets := make(map[uuid.UUID]bool)
		sensitiveAssets := make(map[uuid.UUID]bool)
		var overprivCount, staleCount int
		var maxRisk float64
		var lastActivity *time.Time

		var assetAccesses []model.AssetAccess
		for _, m := range id.mappings {
			totalAssets[m.DataAssetID] = true
			if m.DataClassification == "restricted" || m.DataClassification == "confidential" {
				sensitiveAssets[m.DataAssetID] = true
			}
			if m.UsageCount90d == 0 {
				overprivCount++
			}
			if m.IsStale {
				staleCount++
			}
			if m.AccessRiskScore > maxRisk {
				maxRisk = m.AccessRiskScore
			}
			if m.LastUsedAt != nil && (lastActivity == nil || m.LastUsedAt.After(*lastActivity)) {
				lastActivity = m.LastUsedAt
			}

			assetAccesses = append(assetAccesses, model.AssetAccess{
				DataAssetID:        m.DataAssetID,
				DataAssetName:      m.DataAssetName,
				DataClassification: m.DataClassification,
				MaxPermissionLevel: m.PermissionType,
				SensitivityWeight:  m.SensitivityWeight,
			})
		}

		blastRadius := s.sensitivityScorer.Score(assetAccesses, maxPossible)

		// Compute composite risk score: sensitivity × breadth × usage_anomaly
		var totalRisk float64
		for _, m := range id.mappings {
			totalRisk += m.AccessRiskScore
		}
		accessRiskScore := math.Min(totalRisk/float64(len(id.mappings))*2, 100)

		profile := &model.IdentityProfile{
			TenantID:              tenantID,
			IdentityType:          id.idType,
			IdentityID:            identityID,
			IdentityName:          id.name,
			IdentityEmail:         id.email,
			IdentitySource:        id.source,
			TotalAssetsAccessible: len(totalAssets),
			SensitiveAssetsCount:  len(sensitiveAssets),
			PermissionCount:       len(id.mappings),
			OverprivilegedCount:   overprivCount,
			StalePermissionCount:  staleCount,
			BlastRadiusScore:      math.Round(blastRadius*100) / 100,
			BlastRadiusLevel:      model.RiskLevel(blastRadius),
			AccessRiskScore:       math.Round(accessRiskScore*100) / 100,
			AccessRiskLevel:       model.RiskLevel(accessRiskScore),
			LastActivityAt:        lastActivity,
			Status:                "active",
		}

		if err := s.mappingRepo.UpsertIdentityProfile(ctx, profile); err != nil {
			s.logger.Warn().Err(err).Str("identity", identityID).Msg("failed to upsert identity profile")
		}
	}

	return nil
}
