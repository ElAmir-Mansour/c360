package service

import (
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestPlaybookFromRequest_Valid(t *testing.T) {
	pb, err := playbookFromRequest(uuid.New(), uuid.New(), "NDA Playbook", "desc",
		model.ContractTypeNDA, model.PlaybookStatusActive,
		[]dto.PlaybookClauseRequest{
			{ClauseType: model.ClauseTypeConfidentiality, StandardText: "keep it secret", Required: true},
			{ClauseType: model.ClauseTypeGoverningLaw, StandardText: "KSA law", Required: true, RiskWeight: 0.8},
		}, nil)
	if err != nil {
		t.Fatalf("playbookFromRequest() error = %v", err)
	}
	if len(pb.Clauses) != 2 {
		t.Fatalf("clauses = %d, want 2", len(pb.Clauses))
	}
	// Default risk weight applied when zero.
	if pb.Clauses[0].RiskWeight != 1.0 {
		t.Fatalf("default risk weight = %v, want 1.0", pb.Clauses[0].RiskWeight)
	}
	if pb.Clauses[1].RiskWeight != 0.8 {
		t.Fatalf("explicit risk weight = %v, want 0.8", pb.Clauses[1].RiskWeight)
	}
}

func validationFields(t *testing.T, err error) map[string]string {
	t.Helper()
	if err == nil {
		t.Fatal("expected validation error, got nil")
	}
	appErr, ok := err.(*apperrors.AppError)
	if !ok {
		t.Fatalf("error type = %T, want *apperrors.AppError", err)
	}
	return appErr.Fields
}

func TestPlaybookFromRequest_Invalid(t *testing.T) {
	tests := []struct {
		name      string
		contract  model.ContractType
		status    model.PlaybookStatus
		clauses   []dto.PlaybookClauseRequest
		wantField string
	}{
		{
			name:      "missing name handled via empty",
			contract:  model.ContractTypeNDA,
			status:    model.PlaybookStatusActive,
			clauses:   []dto.PlaybookClauseRequest{{ClauseType: model.ClauseTypeConfidentiality, StandardText: "x", Required: true}},
			wantField: "name",
		},
		{
			name:      "invalid contract type",
			contract:  model.ContractType("not_a_type"),
			status:    model.PlaybookStatusActive,
			clauses:   []dto.PlaybookClauseRequest{{ClauseType: model.ClauseTypeConfidentiality, StandardText: "x", Required: true}},
			wantField: "contract_type",
		},
		{
			name:      "no clauses",
			contract:  model.ContractTypeNDA,
			status:    model.PlaybookStatusActive,
			clauses:   nil,
			wantField: "clauses",
		},
		{
			name:      "required clause without standard text",
			contract:  model.ContractTypeNDA,
			status:    model.PlaybookStatusActive,
			clauses:   []dto.PlaybookClauseRequest{{ClauseType: model.ClauseTypeConfidentiality, Required: true}},
			wantField: "clauses.0.standard_text",
		},
		{
			name:      "risk weight out of range",
			contract:  model.ContractTypeNDA,
			status:    model.PlaybookStatusActive,
			clauses:   []dto.PlaybookClauseRequest{{ClauseType: model.ClauseTypeConfidentiality, StandardText: "x", RiskWeight: 5}},
			wantField: "clauses.0.risk_weight",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			name := "Playbook"
			if tc.wantField == "name" {
				name = ""
			}
			_, err := playbookFromRequest(uuid.New(), uuid.New(), name, "", tc.contract, tc.status, tc.clauses, nil)
			fields := validationFields(t, err)
			if _, ok := fields[tc.wantField]; !ok {
				t.Fatalf("validation fields = %v, want field %q", fields, tc.wantField)
			}
		})
	}
}

func TestClausesToExtracted(t *testing.T) {
	section := "9.2"
	stored := []model.Clause{
		{
			ClauseType:       model.ClauseTypeGoverningLaw,
			Title:            "Governing Law",
			Content:          "Governed by KSA law.",
			SectionReference: &section,
			RiskLevel:        model.RiskLevelLow,
			RiskScore:        12.5,
			RiskKeywords:     []string{"jurisdiction"},
		},
		{ClauseType: model.ClauseTypeConfidentiality, Content: "Keep secret."},
	}
	out := clausesToExtracted(stored)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].ClauseType != model.ClauseTypeGoverningLaw || out[0].SectionReference != "9.2" {
		t.Fatalf("first clause not converted correctly: %+v", out[0])
	}
	if out[0].PrimaryType != model.ClauseTypeGoverningLaw {
		t.Fatalf("PrimaryType not set: %+v", out[0])
	}
	// Nil section reference becomes empty string, not a panic.
	if out[1].SectionReference != "" {
		t.Fatalf("nil section ref should map to empty string, got %q", out[1].SectionReference)
	}
}
