package llm

import (
	"strings"
	"time"

	riskcalc "github.com/clario360/platform/internal/lex/analyzer/riskcalc"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// maxKeyFindings caps the merged key findings, matching the deterministic
// analyzer behavior.
const maxKeyFindings = 5

// MergeClauses produces a hybrid analysis result. The deterministic baseline is
// the source of truth: the LLM only ADDS (fills gaps, unions keywords /
// recommendations, escalates risk) and never silently downgrades or drops a
// deterministic clause, entity, or flag. The input det is never mutated.
//
// now is threaded so the recomputed aggregate score uses a deterministic clock
// in tests. If sug is nil, a copy of det is returned unchanged.
func MergeClauses(det *model.AnalysisResult, sug *ClauseSuggestions, now time.Time) *model.AnalysisResult {
	if det == nil || det.Analysis == nil {
		return det
	}
	merged := cloneAnalysisResult(det)
	if sug == nil {
		return merged
	}

	// 1. Clauses keyed by (clause_type, normalized section_reference).
	clauseIndex := make(map[string]int, len(merged.Clauses))
	for i := range merged.Clauses {
		clauseIndex[clauseKey(merged.Clauses[i].ClauseType, merged.Clauses[i].SectionReference)] = i
	}
	for _, lc := range sug.Clauses {
		key := clauseKey(lc.ClauseType, lc.SectionReference)
		if idx, ok := clauseIndex[key]; ok {
			det := &merged.Clauses[idx]
			// Keep det Content/RiskScore/RiskLevel as floor; fill empty summary.
			if strings.TrimSpace(det.AnalysisSummary) == "" {
				det.AnalysisSummary = lc.AnalysisSummary
			}
			det.RiskKeywords = unionStrings(det.RiskKeywords, lc.RiskKeywords)
			det.Recommendations = unionStrings(det.Recommendations, lc.Recommendations)
			// Escalate-only: never de-escalate risk.
			if lc.RiskLevel.Weight() > det.RiskLevel.Weight() {
				det.RiskLevel = lc.RiskLevel
			}
			det.ComplianceFlags = unionStrings(det.ComplianceFlags, []string{"source:hybrid"})
			continue
		}
		// Net-new LLM clause: only at sufficient confidence.
		if lc.ExtractionConfidence < minSuggestionConfidence {
			continue
		}
		newClause := lc
		newClause.ComplianceFlags = unionStrings(newClause.ComplianceFlags, []string{"source:llm"})
		merged.Clauses = append(merged.Clauses, newClause)
		clauseIndex[key] = len(merged.Clauses) - 1
	}

	// 4. Compliance flags: union by Code, det wins on duplicate.
	merged.Analysis.ComplianceFlags = mergeComplianceFlags(merged.Analysis.ComplianceFlags, sug.ComplianceFlags)

	// 5. Parties / Dates / Amounts: det first, append non-duplicate LLM entries.
	merged.Analysis.ExtractedParties = mergeParties(merged.Analysis.ExtractedParties, sug.Parties)
	merged.Analysis.ExtractedDates = mergeDates(merged.Analysis.ExtractedDates, sug.Dates)
	merged.Analysis.ExtractedAmounts = mergeAmounts(merged.Analysis.ExtractedAmounts, sug.Amounts)

	// 3. Recompute aggregates with the shared scoring helper so they stay
	// internally consistent with the merged clause + flag set. The original
	// contract is not retained on the analysis, so the recompute cannot include
	// the value/expiry factors; to honor the escalate-only invariant we floor
	// the merged score/level at the deterministic baseline (never downgrade).
	detScore := det.Analysis.RiskScore
	detLevel := det.Analysis.OverallRisk
	score, level, highRisk := riskcalc.ComputeAnalysisScore(
		contractForScore(merged),
		merged.Clauses,
		merged.Analysis.MissingClauses,
		merged.Analysis.ComplianceFlags,
		now,
	)
	if detScore > score {
		score = detScore
	}
	if detLevel.Weight() > level.Weight() {
		level = detLevel
	}
	merged.Analysis.RiskScore = score
	merged.Analysis.OverallRisk = level
	merged.Analysis.ClauseCount = len(merged.Clauses)
	merged.Analysis.HighRiskClauseCount = highRisk

	// 6. Rebuild findings from merged clauses + missing + flags, merge in LLM
	// findings, sort by severity (via BuildFindings), cap at 5.
	findings := riskcalc.BuildFindings(merged.Clauses, merged.Analysis.MissingClauses, merged.Analysis.ComplianceFlags, nil)
	findings = append(findings, sug.KeyFindings...)
	findings = riskcalc.SortFindings(findings)
	if len(findings) > maxKeyFindings {
		findings = findings[:maxKeyFindings]
	}
	merged.Analysis.KeyFindings = findings

	return merged
}

// MergeObligations dedups deterministic and LLM obligation items. Deterministic
// items win. LLM items with confidence >= 0.6 that are not duplicates are
// appended with Source="llm".
func MergeObligations(det []dto.ObligationExtractionItem, llm []dto.ObligationExtractionItem) []dto.ObligationExtractionItem {
	out := make([]dto.ObligationExtractionItem, 0, len(det)+len(llm))
	seen := map[string]struct{}{}
	for _, item := range det {
		out = append(out, item)
		seen[obligationKey(item)] = struct{}{}
	}
	for _, item := range llm {
		if llmItemConfidence(item) < minSuggestionConfidence {
			continue
		}
		key := obligationKey(item)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		item.Source = "llm"
		out = append(out, item)
	}
	return out
}

// ---- helpers ----

func clauseKey(ct model.ClauseType, sectionRef string) string {
	return string(ct) + "|" + strings.ToLower(strings.TrimSpace(sectionRef))
}

func obligationKey(item dto.ObligationExtractionItem) string {
	title := strings.ToLower(strings.TrimSpace(item.Title))
	due := ""
	if item.DueDate != nil {
		due = item.DueDate.UTC().Format("2006-01-02")
	}
	return title + "|" + due
}

func llmItemConfidence(item dto.ObligationExtractionItem) float64 {
	if item.Metadata == nil {
		return 0
	}
	ext, ok := item.Metadata["extraction"].(map[string]any)
	if !ok {
		return 0
	}
	switch v := ext["llm_confidence"].(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	default:
		return 0
	}
}

func unionStrings(base, extra []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(base)+len(extra))
	for _, v := range base {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	for _, v := range extra {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func mergeComplianceFlags(det, llm []model.ComplianceFlag) []model.ComplianceFlag {
	out := make([]model.ComplianceFlag, 0, len(det)+len(llm))
	seen := map[string]struct{}{}
	for _, f := range det {
		out = append(out, f)
		seen[strings.ToLower(strings.TrimSpace(f.Code))] = struct{}{}
	}
	for _, f := range llm {
		key := strings.ToLower(strings.TrimSpace(f.Code))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, f)
	}
	return out
}

func mergeParties(det, llm []model.PartyExtraction) []model.PartyExtraction {
	out := append([]model.PartyExtraction(nil), det...)
	seen := map[string]struct{}{}
	for _, p := range det {
		seen[strings.ToLower(strings.TrimSpace(p.Name))] = struct{}{}
	}
	for _, p := range llm {
		key := strings.ToLower(strings.TrimSpace(p.Name))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, p)
	}
	return out
}

func mergeDates(det, llm []model.ExtractedDate) []model.ExtractedDate {
	out := append([]model.ExtractedDate(nil), det...)
	seen := map[string]struct{}{}
	for _, d := range det {
		seen[dateKey(d)] = struct{}{}
	}
	for _, d := range llm {
		key := dateKey(d)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, d)
	}
	return out
}

func dateKey(d model.ExtractedDate) string {
	value := ""
	if d.Value != nil {
		value = d.Value.UTC().Format("2006-01-02")
	}
	return strings.ToLower(strings.TrimSpace(d.Label)) + "|" + value
}

func mergeAmounts(det, llm []model.ExtractedAmount) []model.ExtractedAmount {
	out := append([]model.ExtractedAmount(nil), det...)
	seen := map[string]struct{}{}
	for _, a := range det {
		seen[amountKey(a)] = struct{}{}
	}
	for _, a := range llm {
		key := amountKey(a)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, a)
	}
	return out
}

func amountKey(a model.ExtractedAmount) string {
	return strings.ToLower(strings.TrimSpace(a.Label))
}

// cloneAnalysisResult deep-copies the parts of an AnalysisResult that merge
// mutates so the input is never modified.
func cloneAnalysisResult(in *model.AnalysisResult) *model.AnalysisResult {
	analysisCopy := *in.Analysis
	analysisCopy.MissingClauses = append([]model.ClauseType(nil), in.Analysis.MissingClauses...)
	analysisCopy.KeyFindings = append([]model.RiskFinding(nil), in.Analysis.KeyFindings...)
	analysisCopy.Recommendations = append([]string(nil), in.Analysis.Recommendations...)
	analysisCopy.ComplianceFlags = append([]model.ComplianceFlag(nil), in.Analysis.ComplianceFlags...)
	analysisCopy.ExtractedParties = append([]model.PartyExtraction(nil), in.Analysis.ExtractedParties...)
	analysisCopy.ExtractedDates = append([]model.ExtractedDate(nil), in.Analysis.ExtractedDates...)
	analysisCopy.ExtractedAmounts = append([]model.ExtractedAmount(nil), in.Analysis.ExtractedAmounts...)

	clausesCopy := make([]model.ExtractedClause, len(in.Clauses))
	for i, c := range in.Clauses {
		cc := c
		cc.MatchedTypes = append([]model.ClauseType(nil), c.MatchedTypes...)
		cc.RiskKeywords = append([]string(nil), c.RiskKeywords...)
		cc.Recommendations = append([]string(nil), c.Recommendations...)
		cc.ComplianceFlags = append([]string(nil), c.ComplianceFlags...)
		clausesCopy[i] = cc
	}
	return &model.AnalysisResult{Analysis: &analysisCopy, Clauses: clausesCopy}
}

// contractForScore reconstructs the minimal contract fields ComputeAnalysisScore
// reads from the analysis we hold (the original contract is not retained on the
// result). Value and expiry factors are not recoverable from the analysis alone,
// so they are intentionally omitted on recompute; the deterministic clause-avg,
// missing-penalty, and compliance-penalty dominate the hybrid delta. This keeps
// the merge a pure function of (det result, suggestions).
func contractForScore(merged *model.AnalysisResult) *model.Contract {
	return &model.Contract{
		ID:       merged.Analysis.ContractID,
		TenantID: merged.Analysis.TenantID,
	}
}
