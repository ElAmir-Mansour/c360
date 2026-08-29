// Package riskcalc holds the pure contract-analysis arithmetic and finding
// construction shared by the deterministic analyzer and the hybrid LLM merge.
// It is a leaf package (depends only on lex/model) so both
// internal/lex/analyzer and internal/lex/analyzer/llm can import it without an
// import cycle.
package riskcalc

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

// ComputeAnalysisScore is the single source of truth for the aggregate contract
// risk arithmetic. It returns the clamped raw score (0-100), the derived risk
// level, and the count of high/critical clauses.
func ComputeAnalysisScore(contract *model.Contract, clauses []model.ExtractedClause, missing []model.ClauseType, flags []model.ComplianceFlag, now time.Time) (float64, model.RiskLevel, int) {
	clauseRiskSum := 0.0
	highRiskCount := 0
	for _, clause := range clauses {
		clauseRiskSum += clause.RiskScore
		if clause.RiskLevel == model.RiskLevelCritical || clause.RiskLevel == model.RiskLevelHigh {
			highRiskCount++
		}
	}
	clauseRiskAvg := 0.0
	if len(clauses) > 0 {
		clauseRiskAvg = clauseRiskSum / float64(len(clauses))
	}
	missingPenalty := float64(len(missing) * 8)
	valueFactor := 0.0
	if contract != nil && contract.TotalValue != nil {
		switch {
		case *contract.TotalValue > 10_000_000:
			valueFactor = 15
		case *contract.TotalValue > 1_000_000:
			valueFactor = 10
		}
	}
	expiry := 0.0
	if contract != nil {
		expiry = ExpiryFactor(contract.ExpiryDate, now)
	}
	compliancePenalty := float64(len(flags) * 5)

	rawScore := clauseRiskAvg + missingPenalty + valueFactor + expiry + compliancePenalty
	if rawScore > 100 {
		rawScore = 100
	}
	return rawScore, model.RiskLevelFromScore(rawScore), highRiskCount
}

// ExpiryFactor returns the risk contribution from an approaching expiry date.
func ExpiryFactor(expiryDate *time.Time, now time.Time) float64 {
	if expiryDate == nil {
		return 0
	}
	days := int(expiryDate.UTC().Sub(time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)).Hours() / 24)
	switch {
	case days <= 7:
		return 20
	case days <= 30:
		return 10
	default:
		return 0
	}
}

// BuildFindings constructs risk findings from clauses, missing clauses,
// compliance flags, and metadata warnings, sorted by severity. The caller is
// responsible for capping the result (e.g. to 5).
func BuildFindings(clauses []model.ExtractedClause, missing []model.ClauseType, complianceFlags []model.ComplianceFlag, metadataWarnings []string) []model.RiskFinding {
	findings := make([]model.RiskFinding, 0, len(clauses)+len(missing)+len(complianceFlags)+len(metadataWarnings))
	for _, clause := range clauses {
		if clause.RiskLevel == model.RiskLevelNone {
			continue
		}
		ref := clause.SectionReference
		clauseType := clause.ClauseType
		findings = append(findings, model.RiskFinding{
			Title:           fmt.Sprintf("بند «%s» يستدعي المراجعة", strings.Title(strings.ReplaceAll(string(clause.ClauseType), "_", " "))),
			Description:     clause.AnalysisSummary,
			Severity:        clause.RiskLevel,
			ClauseReference: &ref,
			Recommendation:  strings.Join(clause.Recommendations, " "),
			ClauseType:      &clauseType,
		})
	}
	for _, missingClause := range missing {
		title := fmt.Sprintf("بند «%s» مفقود", strings.ReplaceAll(string(missingClause), "_", " "))
		findings = append(findings, model.RiskFinding{
			Title:          title,
			Description:    "لا يتضمّن العقد بندًا معياريًا مطلوبًا.",
			Severity:       model.RiskLevelHigh,
			Recommendation: "أضِف البند المفقود قبل اعتماد العقد.",
			ClauseType:     &missingClause,
		})
	}
	for _, flag := range complianceFlags {
		findings = append(findings, model.RiskFinding{
			Title:           flag.Title,
			Description:     flag.Description,
			Severity:        flag.Severity,
			ClauseReference: flag.ClauseReference,
			Recommendation:  flag.Description,
		})
	}
	for _, warning := range metadataWarnings {
		findings = append(findings, model.RiskFinding{
			Title:          "عدم تطابق البيانات الوصفية",
			Description:    warning,
			Severity:       model.RiskLevelMedium,
			Recommendation: "تحقّق من تطابق البيانات الوصفية للعقد مع نص المستند المُوقَّع.",
		})
	}
	return SortFindings(findings)
}

// SortFindings sorts risk findings by descending severity weight, then by
// clause type. It sorts in place and returns the slice for convenience.
func SortFindings(findings []model.RiskFinding) []model.RiskFinding {
	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Severity.Weight() != findings[j].Severity.Weight() {
			return findings[i].Severity.Weight() > findings[j].Severity.Weight()
		}
		left := ""
		if findings[i].ClauseType != nil {
			left = string(*findings[i].ClauseType)
		}
		right := ""
		if findings[j].ClauseType != nil {
			right = string(*findings[j].ClauseType)
		}
		return left < right
	})
	return findings
}
