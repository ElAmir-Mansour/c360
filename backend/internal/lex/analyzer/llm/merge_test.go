package llm

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/analyzer/riskcalc"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func baselineResult() *model.AnalysisResult {
	return &model.AnalysisResult{
		Analysis: &model.ContractRiskAnalysis{
			ID:               uuid.New(),
			TenantID:         uuid.New(),
			ContractID:       uuid.New(),
			ContractVersion:  2,
			OverallRisk:      model.RiskLevelMedium,
			RiskScore:        40,
			ClauseCount:      1,
			MissingClauses:   []model.ClauseType{model.ClauseTypeInsurance},
			ComplianceFlags:  []model.ComplianceFlag{{Code: "existing_flag", Title: "Existing", Severity: model.RiskLevelLow}},
			ExtractedParties: []model.PartyExtraction{{Name: "Acme Corp", Role: "party_a", Source: "det"}},
			AnalyzedBy:       "system",
			AnalyzedAt:       time.Now().UTC(),
		},
		Clauses: []model.ExtractedClause{{
			ClauseType:       model.ClauseTypeTermination,
			Title:            "Termination",
			Content:          "either party may terminate",
			SectionReference: "7.1",
			RiskLevel:        model.RiskLevelMedium,
			RiskScore:        45,
			RiskKeywords:     []string{"terminate"},
			Recommendations:  []string{"Add cure period"},
		}},
	}
}

func TestMergeClauses_DetWinsOnConflict_EscalateOnly(t *testing.T) {
	det := baselineResult()
	now := time.Now().UTC()
	sug := &ClauseSuggestions{
		Clauses: []model.ExtractedClause{{
			ClauseType:           model.ClauseTypeTermination,
			SectionReference:     "7.1",
			RiskLevel:            model.RiskLevelCritical, // higher -> escalate
			RiskScore:            10,                      // lower -> ignored (det floor wins)
			AnalysisSummary:      "llm summary",
			RiskKeywords:         []string{"breach"},
			Recommendations:      []string{"Notify counterparty"},
			ExtractionConfidence: 0.95,
		}},
	}
	merged := MergeClauses(det, sug, now)
	c := merged.Clauses[0]
	if c.RiskLevel != model.RiskLevelCritical {
		t.Fatalf("risk level should escalate to critical, got %s", c.RiskLevel)
	}
	if c.RiskScore != 45 {
		t.Fatalf("det risk score should be preserved (45), got %v", c.RiskScore)
	}
	if !contains(c.RiskKeywords, "terminate") || !contains(c.RiskKeywords, "breach") {
		t.Fatalf("keywords not unioned: %v", c.RiskKeywords)
	}
	if !contains(c.Recommendations, "Add cure period") || !contains(c.Recommendations, "Notify counterparty") {
		t.Fatalf("recommendations not unioned: %v", c.Recommendations)
	}
	// det must not be mutated.
	if det.Clauses[0].RiskLevel != model.RiskLevelMedium {
		t.Fatalf("input det mutated: %s", det.Clauses[0].RiskLevel)
	}
}

func TestMergeClauses_GapFillRespectsConfidence(t *testing.T) {
	det := baselineResult()
	now := time.Now().UTC()
	sug := &ClauseSuggestions{
		Clauses: []model.ExtractedClause{
			{ClauseType: model.ClauseTypeConfidentiality, SectionReference: "9", RiskLevel: model.RiskLevelLow, RiskScore: 20, ExtractionConfidence: 0.5},               // below threshold -> dropped
			{ClauseType: model.ClauseTypeDataProtection, SectionReference: "10", Title: "DP", RiskLevel: model.RiskLevelHigh, RiskScore: 70, ExtractionConfidence: 0.8}, // added
		},
	}
	merged := MergeClauses(det, sug, now)
	if len(merged.Clauses) != 2 {
		t.Fatalf("clause count = %d, want 2 (1 det + 1 high-conf llm)", len(merged.Clauses))
	}
	if merged.Clauses[1].ClauseType != model.ClauseTypeDataProtection {
		t.Fatalf("expected added clause to be data_protection, got %s", merged.Clauses[1].ClauseType)
	}
}

func TestMergeClauses_AggregatesRecomputedConsistently(t *testing.T) {
	det := baselineResult()
	now := time.Now().UTC()
	sug := &ClauseSuggestions{
		Clauses: []model.ExtractedClause{
			{ClauseType: model.ClauseTypeIndemnification, SectionReference: "5", Title: "Indem", RiskLevel: model.RiskLevelHigh, RiskScore: 80, ExtractionConfidence: 0.9},
		},
	}
	merged := MergeClauses(det, sug, now)
	wantScore, wantLevel, wantHigh := riskcalc.ComputeAnalysisScore(
		&model.Contract{ID: merged.Analysis.ContractID, TenantID: merged.Analysis.TenantID},
		merged.Clauses, merged.Analysis.MissingClauses, merged.Analysis.ComplianceFlags, now,
	)
	// Score floored at deterministic baseline.
	if wantScore < det.Analysis.RiskScore {
		wantScore = det.Analysis.RiskScore
	}
	if merged.Analysis.RiskScore != wantScore {
		t.Fatalf("risk score = %v, want %v", merged.Analysis.RiskScore, wantScore)
	}
	if merged.Analysis.HighRiskClauseCount != wantHigh {
		t.Fatalf("high risk count = %d, want %d", merged.Analysis.HighRiskClauseCount, wantHigh)
	}
	if merged.Analysis.ClauseCount != len(merged.Clauses) {
		t.Fatalf("clause count = %d, want %d", merged.Analysis.ClauseCount, len(merged.Clauses))
	}
	_ = wantLevel
}

func TestMergeClauses_NeverDowngradesScore(t *testing.T) {
	det := baselineResult()
	det.Analysis.RiskScore = 88 // high baseline (e.g. from value/expiry factors)
	det.Analysis.OverallRisk = model.RiskLevelCritical
	now := time.Now().UTC()
	merged := MergeClauses(det, &ClauseSuggestions{}, now)
	if merged.Analysis.RiskScore < 88 {
		t.Fatalf("score downgraded: %v < 88", merged.Analysis.RiskScore)
	}
	if merged.Analysis.OverallRisk != model.RiskLevelCritical {
		t.Fatalf("level downgraded: %s", merged.Analysis.OverallRisk)
	}
}

func TestMergeClauses_EntitiesAndFlagsUnioned(t *testing.T) {
	det := baselineResult()
	now := time.Now().UTC()
	sug := &ClauseSuggestions{
		Parties:         []model.PartyExtraction{{Name: "Acme Corp"}, {Name: "Beta LLC", Role: "party_b"}}, // Acme dup, Beta new
		ComplianceFlags: []model.ComplianceFlag{{Code: "existing_flag", Severity: model.RiskLevelHigh}, {Code: "new_flag", Title: "New", Severity: model.RiskLevelMedium}},
	}
	merged := MergeClauses(det, sug, now)
	if len(merged.Analysis.ExtractedParties) != 2 {
		t.Fatalf("parties = %d, want 2", len(merged.Analysis.ExtractedParties))
	}
	if len(merged.Analysis.ComplianceFlags) != 2 {
		t.Fatalf("flags = %d, want 2", len(merged.Analysis.ComplianceFlags))
	}
	// det wins on duplicate flag code (severity stays low).
	for _, f := range merged.Analysis.ComplianceFlags {
		if f.Code == "existing_flag" && f.Severity != model.RiskLevelLow {
			t.Fatalf("det flag overwritten: %s", f.Severity)
		}
	}
}

func TestMergeClauses_FindingsCappedAtFive(t *testing.T) {
	det := baselineResult()
	// Many missing clauses -> many findings.
	det.Analysis.MissingClauses = model.AllClauseTypes()
	now := time.Now().UTC()
	merged := MergeClauses(det, &ClauseSuggestions{}, now)
	if len(merged.Analysis.KeyFindings) > maxKeyFindings {
		t.Fatalf("findings = %d, want <= %d", len(merged.Analysis.KeyFindings), maxKeyFindings)
	}
}

func TestMergeObligations_DedupAndConfidence(t *testing.T) {
	due := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	det := []dto.ObligationExtractionItem{
		{Title: "Submit report", DueDate: &due, Source: "payload"},
	}
	llm := []dto.ObligationExtractionItem{
		// duplicate (same title+due) -> dropped
		llmItem("Submit report", due, 0.9),
		// new, high conf -> kept
		llmItem("Pay invoice", time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC), 0.8),
		// new, low conf -> dropped
		llmItem("Low conf thing", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), 0.4),
	}
	merged := MergeObligations(det, llm)
	if len(merged) != 2 {
		t.Fatalf("merged = %d, want 2", len(merged))
	}
	if merged[0].Title != "Submit report" || merged[0].Source != "payload" {
		t.Fatalf("det item should win: %+v", merged[0])
	}
	if merged[1].Title != "Pay invoice" || merged[1].Source != "llm" {
		t.Fatalf("expected llm Pay invoice: %+v", merged[1])
	}
}

func llmItem(title string, due time.Time, conf float64) dto.ObligationExtractionItem {
	d := due
	return dto.ObligationExtractionItem{
		Title:   title,
		DueDate: &d,
		Source:  "llm",
		Metadata: map[string]any{
			"extraction": map[string]any{"deterministic": false, "llm_confidence": conf},
		},
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
