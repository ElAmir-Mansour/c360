package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func f64(v float64) *float64 { return &v }

func sampleReport() *model.ClauseDeviationReport {
	return &model.ClauseDeviationReport{
		ContractID:      uuid.New(),
		PlaybookID:      uuid.New(),
		PlaybookName:    "NDA Playbook",
		ContractType:    model.ContractTypeNDA,
		Matched:         true,
		MissingCount:    1,
		AlteredCount:    1,
		ExtraCount:      1,
		ComplianceScore: 42.5,
		Deviations: []model.ClauseDeviation{
			{Kind: model.ClauseDeviationMissing, ClauseType: model.ClauseTypeConfidentiality, Required: true, Severity: model.RiskLevelHigh},
			{Kind: model.ClauseDeviationAltered, ClauseType: model.ClauseTypeGoverningLaw, Required: false, Severity: model.RiskLevelMedium, Similarity: f64(0.3), Threshold: f64(0.6)},
			{Kind: model.ClauseDeviationExtra, ClauseType: model.ClauseTypeInsurance, Required: false, Severity: model.RiskLevelLow},
		},
		GeneratedAt: time.Now().UTC(),
	}
}

func TestFilterReportDeviations_NoFilters(t *testing.T) {
	report := sampleReport()
	out := FilterReportDeviations(report, DeviationReportFilters{})
	if out != report {
		t.Fatal("no-filter call should return the same report pointer")
	}
}

func TestFilterReportDeviations_BySeverity(t *testing.T) {
	report := sampleReport()
	out := FilterReportDeviations(report, DeviationReportFilters{Severities: []model.RiskLevel{model.RiskLevelHigh}})
	if len(out.Deviations) != 1 || out.Deviations[0].Kind != model.ClauseDeviationMissing {
		t.Fatalf("expected only the high-severity missing deviation, got %+v", out.Deviations)
	}
	// Whole-report counts must be preserved (not recomputed).
	if out.MissingCount != 1 || out.AlteredCount != 1 || out.ExtraCount != 1 || out.ComplianceScore != 42.5 {
		t.Fatalf("whole-report counts/score must be preserved, got %+v", out)
	}
	// Original report's deviations must be untouched.
	if len(report.Deviations) != 3 {
		t.Fatalf("original report mutated: %d deviations", len(report.Deviations))
	}
}

func TestFilterReportDeviations_ByKindAndRequired(t *testing.T) {
	report := sampleReport()
	out := FilterReportDeviations(report, DeviationReportFilters{
		Kinds:        []model.ClauseDeviationKind{model.ClauseDeviationMissing, model.ClauseDeviationAltered},
		RequiredOnly: true,
	})
	if len(out.Deviations) != 1 || out.Deviations[0].ClauseType != model.ClauseTypeConfidentiality {
		t.Fatalf("expected only required missing deviation, got %+v", out.Deviations)
	}
}

func TestSeverityRank(t *testing.T) {
	if severityRank("critical") <= severityRank("high") {
		t.Fatal("critical must outrank high")
	}
	if severityRank("high") <= severityRank("medium") {
		t.Fatal("high must outrank medium")
	}
	if severityRank("") != 0 {
		t.Fatal("empty severity must rank 0")
	}
}

func TestDeviationsDetectedPayload(t *testing.T) {
	report := sampleReport()
	pb := &model.ClausePlaybook{ID: report.PlaybookID, Name: "NDA Playbook", ContractType: model.ContractTypeNDA}
	payload := deviationsDetectedPayload(report.ContractID, pb, report)
	if payload["missing_required_count"].(int) != 1 {
		t.Fatalf("missing_required_count = %v, want 1", payload["missing_required_count"])
	}
	if payload["max_severity"].(string) != string(model.RiskLevelHigh) {
		t.Fatalf("max_severity = %v, want high", payload["max_severity"])
	}
	if payload["contract_id"] != report.ContractID || payload["playbook_id"] != pb.ID {
		t.Fatalf("payload missing contract_id/playbook_id: %+v", payload)
	}
}

func TestPlaybookTemplates_AreDraftsAndValid(t *testing.T) {
	svc := &PlaybookService{}
	templates := svc.ListTemplates()
	if len(templates) == 0 {
		t.Fatal("expected a non-empty template library")
	}
	seen := map[string]bool{}
	for _, tmpl := range templates {
		if tmpl.Key == "" || tmpl.Name == "" || tmpl.ContractType == "" {
			t.Fatalf("template missing required field: %+v", tmpl)
		}
		if seen[tmpl.Key] {
			t.Fatalf("duplicate template key: %s", tmpl.Key)
		}
		seen[tmpl.Key] = true
		if len(tmpl.Clauses) == 0 {
			t.Fatalf("template %s has no clauses", tmpl.Key)
		}
	}
	// findTemplate resolves a known key and rejects an unknown one.
	if _, ok := findTemplate("nda_standard"); !ok {
		t.Fatal("expected nda_standard template to exist")
	}
	if _, ok := findTemplate("does_not_exist"); ok {
		t.Fatal("expected unknown template key to be absent")
	}
}
