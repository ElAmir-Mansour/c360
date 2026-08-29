package analyzer

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func standardConfidentialityText() string {
	return "Each party shall keep confidential all proprietary information disclosed by the other party and shall not disclose it to third parties without prior written consent, for a period of five years."
}

func testPlaybook() *model.ClausePlaybook {
	return &model.ClausePlaybook{
		ID:           uuid.New(),
		Name:         "Standard NDA Playbook",
		ContractType: model.ContractTypeNDA,
		Status:       model.PlaybookStatusActive,
		Clauses: []model.PlaybookClause{
			{
				ClauseType:   model.ClauseTypeConfidentiality,
				Title:        "Confidentiality",
				StandardText: standardConfidentialityText(),
				Required:     true,
				RiskWeight:   1.0,
			},
			{
				ClauseType:   model.ClauseTypeGoverningLaw,
				Title:        "Governing Law",
				StandardText: "This agreement is governed by the laws of the Kingdom of Saudi Arabia and the courts of Riyadh have exclusive jurisdiction.",
				Required:     true,
				RiskWeight:   0.9,
			},
			{
				ClauseType:   model.ClauseTypeTermination,
				Title:        "Termination",
				StandardText: "Either party may terminate this agreement upon thirty days written notice to the other party.",
				Required:     false,
				RiskWeight:   0.5,
			},
		},
	}
}

func findDeviation(report *model.ClauseDeviationReport, kind model.ClauseDeviationKind, ct model.ClauseType) *model.ClauseDeviation {
	for i := range report.Deviations {
		if report.Deviations[i].Kind == kind && report.Deviations[i].ClauseType == ct {
			return &report.Deviations[i]
		}
	}
	return nil
}

func TestDeviationDetector_MissingRequiredClause(t *testing.T) {
	d := NewDeviationDetector()
	// Contract has confidentiality + governing law but NOT termination (optional),
	// and is missing governing law entirely to trigger a required-missing.
	clauses := []model.ExtractedClause{
		{ClauseType: model.ClauseTypeConfidentiality, Content: standardConfidentialityText(), SectionReference: "1"},
	}
	report := d.Detect(uuid.New(), clauses, testPlaybook(), time.Now())
	dev := findDeviation(report, model.ClauseDeviationMissing, model.ClauseTypeGoverningLaw)
	if dev == nil {
		t.Fatalf("expected MISSING deviation for governing_law; got %+v", report.Deviations)
	}
	if !dev.Required {
		t.Fatal("missing governing_law should be marked required")
	}
	if report.MissingCount != 1 {
		t.Fatalf("MissingCount = %d, want 1", report.MissingCount)
	}
	// Optional missing termination must NOT be reported.
	if findDeviation(report, model.ClauseDeviationMissing, model.ClauseTypeTermination) != nil {
		t.Fatal("optional termination should not be reported as missing")
	}
}

func TestDeviationDetector_AlteredBeyondThreshold(t *testing.T) {
	d := NewDeviationDetector()
	clauses := []model.ExtractedClause{
		{ClauseType: model.ClauseTypeConfidentiality, Content: standardConfidentialityText(), SectionReference: "1"},
		{ClauseType: model.ClauseTypeGoverningLaw, SectionReference: "9",
			// Materially different governing law: foreign jurisdiction, different wording.
			Content: "Disputes are resolved exclusively in the courts of New York under the laws of the State of Delaware in the United States."},
	}
	report := d.Detect(uuid.New(), clauses, testPlaybook(), time.Now())
	dev := findDeviation(report, model.ClauseDeviationAltered, model.ClauseTypeGoverningLaw)
	if dev == nil {
		t.Fatalf("expected ALTERED deviation for governing_law; got %+v", report.Deviations)
	}
	if dev.Similarity == nil || *dev.Similarity >= d.threshold {
		t.Fatalf("ALTERED similarity = %v, want below threshold %v", dev.Similarity, d.threshold)
	}
	if report.AlteredCount != 1 {
		t.Fatalf("AlteredCount = %d, want 1", report.AlteredCount)
	}
}

func TestDeviationDetector_CompliantWithinThreshold(t *testing.T) {
	d := NewDeviationDetector()
	clauses := []model.ExtractedClause{
		// Confidentiality nearly identical to the standard (minor rewording).
		{ClauseType: model.ClauseTypeConfidentiality, SectionReference: "1",
			Content: "Each party shall keep confidential all proprietary information disclosed by the other party and shall not disclose it to any third parties without prior written consent for a period of five years."},
		{ClauseType: model.ClauseTypeGoverningLaw, SectionReference: "9",
			Content: "This agreement is governed by the laws of the Kingdom of Saudi Arabia and the courts of Riyadh shall have exclusive jurisdiction."},
	}
	report := d.Detect(uuid.New(), clauses, testPlaybook(), time.Now())
	if findDeviation(report, model.ClauseDeviationAltered, model.ClauseTypeConfidentiality) != nil {
		t.Fatalf("confidentiality should be compliant; deviations = %+v", report.Deviations)
	}
	if findDeviation(report, model.ClauseDeviationAltered, model.ClauseTypeGoverningLaw) != nil {
		t.Fatalf("governing_law should be compliant; deviations = %+v", report.Deviations)
	}
	if report.AlteredCount != 0 || report.MissingCount != 0 {
		t.Fatalf("expected fully compliant required clauses; missing=%d altered=%d", report.MissingCount, report.AlteredCount)
	}
	// Both required clauses (weights 1.0 + 0.9) present & compliant; termination
	// optional (weight 0.5) absent. ComplianceScore = (1.0+0.9)/(1.0+0.9+0.5).
	if report.ComplianceScore <= 70 || report.ComplianceScore > 100 {
		t.Fatalf("ComplianceScore = %v, want a high partial score", report.ComplianceScore)
	}
}

func TestDeviationDetector_ExtraClause(t *testing.T) {
	d := NewDeviationDetector()
	clauses := []model.ExtractedClause{
		{ClauseType: model.ClauseTypeConfidentiality, Content: standardConfidentialityText(), SectionReference: "1"},
		{ClauseType: model.ClauseTypeGoverningLaw, Content: "This agreement is governed by the laws of the Kingdom of Saudi Arabia and the courts of Riyadh have exclusive jurisdiction.", SectionReference: "9"},
		// Non-standard clause: non-compete is not in the NDA playbook.
		{ClauseType: model.ClauseTypeNonCompete, Content: "The receiving party agrees not to compete for 24 months.", SectionReference: "12"},
		// "other" must be ignored as noise.
		{ClauseType: model.ClauseTypeOther, Content: "Miscellaneous boilerplate.", SectionReference: "15"},
	}
	report := d.Detect(uuid.New(), clauses, testPlaybook(), time.Now())
	dev := findDeviation(report, model.ClauseDeviationExtra, model.ClauseTypeNonCompete)
	if dev == nil {
		t.Fatalf("expected EXTRA deviation for non_compete; got %+v", report.Deviations)
	}
	if report.ExtraCount != 1 {
		t.Fatalf("ExtraCount = %d, want 1 (other ignored)", report.ExtraCount)
	}
	if findDeviation(report, model.ClauseDeviationExtra, model.ClauseTypeOther) != nil {
		t.Fatal("'other' clause should not be reported as extra")
	}

	// EXTRA detection can be disabled.
	d2 := NewDeviationDetector(WithExtraClauseDetection(false))
	report2 := d2.Detect(uuid.New(), clauses, testPlaybook(), time.Now())
	if report2.ExtraCount != 0 {
		t.Fatalf("ExtraCount with detection disabled = %d, want 0", report2.ExtraCount)
	}
}

func TestDeviationDetector_NoPlaybook(t *testing.T) {
	d := NewDeviationDetector()
	report := d.Detect(uuid.New(), nil, nil, time.Now())
	if report.Matched {
		t.Fatal("report.Matched should be false when no playbook applies")
	}
	if len(report.Deviations) != 0 {
		t.Fatalf("expected no deviations without a playbook; got %d", len(report.Deviations))
	}
}

func TestJaccardSimilarity_Bounds(t *testing.T) {
	if s := jaccardSimilarity("", ""); s != 1.0 {
		t.Fatalf("empty/empty = %v, want 1.0", s)
	}
	if s := jaccardSimilarity("hello world", ""); s != 0.0 {
		t.Fatalf("nonempty/empty = %v, want 0.0", s)
	}
	identical := jaccardSimilarity("indemnification clause limits liability", "indemnification clause limits liability")
	if identical != 1.0 {
		t.Fatalf("identical = %v, want 1.0", identical)
	}
	partial := jaccardSimilarity("indemnification clause limits liability", "indemnification clause unlimited liability exposure")
	if partial <= 0 || partial >= 1 {
		t.Fatalf("partial = %v, want strictly between 0 and 1", partial)
	}
}
