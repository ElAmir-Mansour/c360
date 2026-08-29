package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractComplianceService backs CAP-109 (regulatory compliance check). It
// joins the contract's AI-populated compliance flags (the latest analysis'
// compliance_flags) to the tenant's configured compliance rules to surface the
// rule text, severity, remediation and source clause for each matched issue, and
// overlays the reviewer's per-issue triage state (contract_compliance_reviews).
// POST/PUT upsert and flip a single flag's open/resolved disposition.
type ContractComplianceService struct {
	db         *pgxpool.Pool
	contracts  *repository.ContractRepository
	compliance *repository.ComplianceRepository
	reviews    *repository.ContractComplianceReviewRepository
	publisher  Publisher
	topic      string
	logger     zerolog.Logger
}

func NewContractComplianceService(
	db *pgxpool.Pool,
	contracts *repository.ContractRepository,
	compliance *repository.ComplianceRepository,
	reviews *repository.ContractComplianceReviewRepository,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *ContractComplianceService {
	return &ContractComplianceService{
		db:         db,
		contracts:  contracts,
		compliance: compliance,
		reviews:    reviews,
		publisher:  publisherOrNoop(publisher),
		topic:      topic,
		logger:     logger.With().Str("service", "lex-contract-compliance").Logger(),
	}
}

// ensureContractExists fetches the parent contract tenant-scoped, translating
// ErrNoRows into a 404.
func (s *ContractComplianceService) ensureContractExists(ctx context.Context, tenantID, contractID uuid.UUID) error {
	_, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("contract not found")
		}
		return internalError("load contract", err)
	}
	return nil
}

// Check builds the full compliance picture for a contract: each matched
// regulatory flag enriched with rule context and overlaid with its review state,
// plus the open/resolved roll-up that drives the KPI strip.
func (s *ContractComplianceService) Check(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ContractComplianceCheck, error) {
	if err := s.ensureContractExists(ctx, tenantID, contractID); err != nil {
		return nil, err
	}

	result := &model.ContractComplianceCheck{
		ContractID:  contractID,
		GeneratedAt: time.Now().UTC(),
		Items:       []model.ContractComplianceItem{},
	}

	analysis, err := s.contracts.GetLatestAnalysis(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No analysis yet → no flags to triage. Reviews require a flag, so
			// return the empty (but valid) picture.
			return result, nil
		}
		return nil, internalError("load latest analysis", err)
	}
	result.HasAnalysis = true

	rules, err := s.compliance.ListRules(ctx, tenantID)
	if err != nil {
		return nil, internalError("list compliance rules", err)
	}
	rulesByKey := indexRulesByKey(rules)

	reviews, err := s.reviews.ListByContract(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("list compliance reviews", err)
	}
	reviewsByFlag := make(map[string]model.ContractComplianceReview, len(reviews))
	for _, rv := range reviews {
		reviewsByFlag[rv.FlagRef] = rv
	}

	for _, flag := range analysis.ComplianceFlags {
		item := model.ContractComplianceItem{
			FlagRef:         flag.Code,
			Title:           flag.Title,
			Description:     flag.Description,
			Severity:        flag.Severity,
			ClauseReference: flag.ClauseReference,
			Status:          model.ContractComplianceReviewOpen,
		}
		if rule, ok := rulesByKey[strings.ToLower(strings.TrimSpace(flag.Code))]; ok {
			name := rule.Name
			ruleType := string(rule.RuleType)
			item.Rule = &name
			item.RuleType = &ruleType
			// Severity from a configured rule wins over the flag's own severity.
			if sev := complianceRuleRiskLevel(rule.Severity); sev != model.RiskLevelNone {
				item.Severity = sev
			}
			if rem := ruleRemediation(rule); rem != "" {
				item.Remediation = &rem
			}
		}
		if rv, ok := reviewsByFlag[flag.Code]; ok {
			item.Status = rv.Status
			item.Note = rv.Note
			item.ResolvedBy = rv.ResolvedBy
			item.ResolvedAt = rv.ResolvedAt
		}

		result.Items = append(result.Items, item)
		result.Total++
		if item.Status == model.ContractComplianceReviewResolved {
			result.Resolved++
		} else {
			result.Open++
		}
	}

	return result, nil
}

// CreateReview records (upserts) the reviewer's triage of a single matched flag.
// The flag must exist on the contract's latest analysis.
func (s *ContractComplianceService) CreateReview(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.CreateComplianceReviewRequest) (*model.ContractComplianceReview, error) {
	req.Normalize()
	if req.FlagRef == "" {
		return nil, validationError("flag_ref is required", map[string]string{"flag_ref": "required"})
	}
	status, err := parseComplianceStatus(req.Status, model.ContractComplianceReviewOpen)
	if err != nil {
		return nil, err
	}
	if err := s.ensureContractExists(ctx, tenantID, contractID); err != nil {
		return nil, err
	}

	review := &model.ContractComplianceReview{
		ID:         uuid.New(),
		TenantID:   tenantID,
		ContractID: contractID,
		FlagRef:    req.FlagRef,
		Status:     status,
		Note:       req.Note,
	}
	applyResolution(review, userID)

	saved, err := s.reviews.Upsert(ctx, s.db, review)
	if err != nil {
		return nil, internalError("upsert compliance review", err)
	}
	s.publish(ctx, tenantID, userID, contractID, saved, "com.clario360.lex.contracts.compliance_review_recorded")
	return saved, nil
}

// UpdateReview patches an existing review — chiefly to flip open ⇄ resolved.
func (s *ContractComplianceService) UpdateReview(ctx context.Context, tenantID, userID, contractID, reviewID uuid.UUID, req dto.UpdateComplianceReviewRequest) (*model.ContractComplianceReview, error) {
	req.Normalize()
	review, err := s.reviews.Get(ctx, tenantID, contractID, reviewID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("compliance review not found")
		}
		return nil, internalError("load compliance review", err)
	}
	if req.Status != nil {
		status, perr := parseComplianceStatus(*req.Status, review.Status)
		if perr != nil {
			return nil, perr
		}
		review.Status = status
	}
	if req.Note != nil {
		review.Note = *req.Note
	}
	applyResolution(review, userID)

	if err := s.reviews.Update(ctx, s.db, review); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("compliance review not found")
		}
		return nil, internalError("update compliance review", err)
	}
	s.publish(ctx, tenantID, userID, contractID, review, "com.clario360.lex.contracts.compliance_review_updated")
	return review, nil
}

func (s *ContractComplianceService) publish(ctx context.Context, tenantID, userID, contractID uuid.UUID, review *model.ContractComplianceReview, eventType string) {
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, map[string]any{
		"id":          contractID,
		"contract_id": contractID,
		"review_id":   review.ID,
		"flag_ref":    review.FlagRef,
		"status":      string(review.Status),
	}, s.logger)
}

// applyResolution sets/clears the resolution stamps to match the row's status.
func applyResolution(review *model.ContractComplianceReview, userID uuid.UUID) {
	if review.Status == model.ContractComplianceReviewResolved {
		if review.ResolvedBy == nil {
			by := userID
			review.ResolvedBy = &by
		}
		if review.ResolvedAt == nil {
			at := time.Now().UTC()
			review.ResolvedAt = &at
		}
		return
	}
	review.ResolvedBy = nil
	review.ResolvedAt = nil
}

func parseComplianceStatus(raw string, fallback model.ContractComplianceReviewStatus) (model.ContractComplianceReviewStatus, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return fallback, nil
	case string(model.ContractComplianceReviewOpen):
		return model.ContractComplianceReviewOpen, nil
	case string(model.ContractComplianceReviewResolved):
		return model.ContractComplianceReviewResolved, nil
	default:
		return "", validationError("invalid status", map[string]string{"status": "must be open or resolved"})
	}
}

// indexRulesByKey maps each compliance rule to its lookup keys (lower-cased name
// and rule_type) so an AI flag's code can be matched to its governing rule.
func indexRulesByKey(rules []model.ComplianceRule) map[string]model.ComplianceRule {
	out := make(map[string]model.ComplianceRule, len(rules)*2)
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if name := strings.ToLower(strings.TrimSpace(rule.Name)); name != "" {
			if _, exists := out[name]; !exists {
				out[name] = rule
			}
		}
		if rt := strings.ToLower(strings.TrimSpace(string(rule.RuleType))); rt != "" {
			if _, exists := out[rt]; !exists {
				out[rt] = rule
			}
		}
	}
	return out
}

// ruleRemediation surfaces operator-authored remediation guidance from the rule
// config, falling back to the rule description.
func ruleRemediation(rule model.ComplianceRule) string {
	if rule.Config != nil {
		if v, ok := rule.Config["remediation"].(string); ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return trimmed
			}
		}
	}
	return strings.TrimSpace(rule.Description)
}

// complianceRuleRiskLevel maps a compliance-rule severity onto the shared
// RiskLevel vocabulary used by the flag/UI severity indicators.
func complianceRuleRiskLevel(sev model.ComplianceSeverity) model.RiskLevel {
	switch sev {
	case model.ComplianceSeverityCritical:
		return model.RiskLevelCritical
	case model.ComplianceSeverityHigh:
		return model.RiskLevelHigh
	case model.ComplianceSeverityMedium:
		return model.RiskLevelMedium
	case model.ComplianceSeverityLow:
		return model.RiskLevelLow
	default:
		return model.RiskLevelNone
	}
}
