package analyzer

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	riskcalc "github.com/clario360/platform/internal/lex/analyzer/riskcalc"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
)

type EntityExtractor interface {
	Extract(text string) ([]model.PartyExtraction, []model.ExtractedDate, []model.ExtractedAmount)
	WarnOnMetadataMismatch(contractPartyA, contractPartyB string, parties []model.PartyExtraction) []string
}

type RiskAnalyzer struct {
	extractor       *ClauseExtractor
	missingDetector *MissingClauseDetector
	entityExtractor EntityExtractor
	compliance      *ComplianceChecker
	recommendations *RecommendationEngine
	metrics         *metrics.Metrics
	now             func() time.Time
}

func NewRiskAnalyzer(
	extractor *ClauseExtractor,
	missingDetector *MissingClauseDetector,
	entityExtractor EntityExtractor,
	compliance *ComplianceChecker,
	recommendations *RecommendationEngine,
	m *metrics.Metrics,
) *RiskAnalyzer {
	return &RiskAnalyzer{
		extractor:       extractor,
		missingDetector: missingDetector,
		entityExtractor: entityExtractor,
		compliance:      compliance,
		recommendations: recommendations,
		metrics:         m,
		now:             time.Now,
	}
}

func (a *RiskAnalyzer) SetNow(now func() time.Time) {
	if now != nil {
		a.now = now
	}
}

func (a *RiskAnalyzer) Analyze(contract *model.Contract, text string) (*model.ContractRiskAnalysis, error) {
	result, err := a.AnalyzeDetailed(contract, text)
	if err != nil {
		return nil, err
	}
	return result.Analysis, nil
}

// AnalyzeDetailedCtx is a context-aware variant of AnalyzeDetailed. The
// deterministic analyzer does not use the context, but exposing this method lets
// callers thread a request context through a hybrid (LLM-enriched) analyzer that
// satisfies the same interface, without changing the legacy signature.
func (a *RiskAnalyzer) AnalyzeDetailedCtx(_ context.Context, contract *model.Contract, text string) (*model.AnalysisResult, error) {
	return a.AnalyzeDetailed(contract, text)
}

func (a *RiskAnalyzer) AnalyzeDetailed(contract *model.Contract, text string) (*model.AnalysisResult, error) {
	if contract == nil {
		return nil, fmt.Errorf("contract is required")
	}
	start := a.now()

	clauses, err := a.extractor.ExtractClauses(text)
	if err != nil {
		return nil, fmt.Errorf("extract clauses: %w", err)
	}
	found := make(map[model.ClauseType]bool, len(clauses))
	for _, clause := range clauses {
		found[clause.ClauseType] = true
		if a.metrics != nil {
			a.metrics.ClauseExtractionTotal.WithLabelValues(string(clause.ClauseType)).Inc()
			a.metrics.ClauseRiskTotal.WithLabelValues(string(clause.RiskLevel)).Inc()
		}
	}

	missing := a.missingDetector.Detect(contract.Type, found)
	for _, clauseType := range missing {
		if a.metrics != nil {
			a.metrics.MissingClausesTotal.WithLabelValues(string(clauseType)).Inc()
		}
	}

	parties, dates, amounts := a.entityExtractor.Extract(text)
	complianceFlags := a.compliance.Check(contract, clauses, text)
	metadataWarnings := a.entityExtractor.WarnOnMetadataMismatch(contract.PartyAName, contract.PartyBName, parties)

	rawScore, riskLevel, highRiskCount := ComputeAnalysisScore(contract, clauses, missing, complianceFlags, a.now())

	recommendations := uniqueRecommendations(clauses, missing, complianceFlags, a.recommendations)
	findings := BuildFindings(clauses, missing, complianceFlags, metadataWarnings)
	if len(findings) > 5 {
		findings = findings[:5]
	}

	duration := a.now().Sub(start)
	analysis := &model.ContractRiskAnalysis{
		ID:                  uuid.New(),
		TenantID:            contract.TenantID,
		ContractID:          contract.ID,
		ContractVersion:     contract.CurrentVersion,
		OverallRisk:         riskLevel,
		RiskScore:           rawScore,
		ClauseCount:         len(clauses),
		HighRiskClauseCount: highRiskCount,
		MissingClauses:      missing,
		KeyFindings:         findings,
		Recommendations:     recommendations,
		ComplianceFlags:     complianceFlags,
		ExtractedParties:    parties,
		ExtractedDates:      dates,
		ExtractedAmounts:    amounts,
		AnalysisDurationMS:  duration.Milliseconds(),
		AnalyzedBy:          "system",
		AnalyzedAt:          a.now().UTC(),
		CreatedAt:           a.now().UTC(),
	}
	if a.metrics != nil {
		a.metrics.ContractAnalysisDuration.Observe(duration.Seconds())
	}
	return &model.AnalysisResult{Analysis: analysis, Clauses: clauses}, nil
}

// ComputeAnalysisScore is the single source of truth for the aggregate contract
// risk arithmetic. Both the deterministic analyzer and the hybrid merge use it
// so their scores can never diverge. It returns the clamped raw score (0-100),
// the derived risk level, and the count of high/critical clauses.
func ComputeAnalysisScore(contract *model.Contract, clauses []model.ExtractedClause, missing []model.ClauseType, flags []model.ComplianceFlag, now time.Time) (float64, model.RiskLevel, int) {
	return riskcalc.ComputeAnalysisScore(contract, clauses, missing, flags, now)
}

// BuildFindings exposes the deterministic finding construction (severity sort,
// finding-per-clause/missing/flag/warning) so the hybrid merge reuses identical
// logic. Caller is responsible for capping the result (e.g. to 5).
func BuildFindings(clauses []model.ExtractedClause, missing []model.ClauseType, complianceFlags []model.ComplianceFlag, metadataWarnings []string) []model.RiskFinding {
	return riskcalc.BuildFindings(clauses, missing, complianceFlags, metadataWarnings)
}

// SortFindings sorts risk findings by descending severity weight, then by
// clause type, matching the deterministic analyzer ordering. It sorts in place
// and returns the slice for convenience. Exported so the hybrid merge can
// re-sort after appending LLM findings.
func SortFindings(findings []model.RiskFinding) []model.RiskFinding {
	return riskcalc.SortFindings(findings)
}

func uniqueRecommendations(clauses []model.ExtractedClause, missing []model.ClauseType, complianceFlags []model.ComplianceFlag, engine *RecommendationEngine) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(clauses)+len(missing)+len(complianceFlags))
	appendUnique := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	for _, clause := range clauses {
		appendUnique(clause.Recommendations...)
	}
	for _, missingClause := range missing {
		appendUnique(fmt.Sprintf("Insert a standard %s clause before approval.", strings.ReplaceAll(string(missingClause), "_", " ")))
	}
	for _, flag := range complianceFlags {
		switch flag.Code {
		case "pii_without_data_protection":
			appendUnique("Add a data protection clause covering breach notice, deletion, and transfer controls.")
		case "vendor_without_audit_rights":
			appendUnique("Include audit rights clause per vendor management policy.")
		case "foreign_governing_law":
			appendUnique("Negotiate governing law to local jurisdiction.")
		case "high_value_without_insurance":
			appendUnique("Require evidence of insurance coverage for high-value commitments.")
		default:
			appendUnique(flag.Description)
		}
	}
	sort.Strings(out)
	return out
}
