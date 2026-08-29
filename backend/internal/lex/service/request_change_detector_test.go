package service

import (
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

func TestRequestChangeDetectorFlagsConcreteSubstantialTriggers(t *testing.T) {
	oldServiceID := uuid.New()
	newServiceID := uuid.New()
	oldEntityID := uuid.New()
	newEntityID := uuid.New()
	oldDepartment := "finance"
	newDepartment := "operations"

	before := &model.LegalRequest{
		ServiceID:           &oldServiceID,
		RequestType:         "contract_review",
		Priority:            model.RequestPriorityNormal,
		Title:               forms.LocalizedText{EN: "Review supplier agreement"},
		BeneficiaryEntityID: &oldEntityID,
		Department:          &oldDepartment,
	}
	after := &model.LegalRequest{
		ServiceID:           &newServiceID,
		RequestType:         "consultation",
		Priority:            model.RequestPriorityUrgent,
		Title:               forms.LocalizedText{EN: "Review distribution agreement"},
		BeneficiaryEntityID: &newEntityID,
		Department:          &newDepartment,
	}

	decision := NewRequestChangeDetector().Detect(before, after, nil, nil)
	if !decision.Substantial {
		t.Fatalf("Substantial = false, want true")
	}
	for _, reason := range []SubstantialEditReason{
		SubstantialReasonServiceChanged,
		SubstantialReasonRequestTypeChanged,
		SubstantialReasonPriorityChanged,
		SubstantialReasonScopeChanged,
	} {
		if !decision.HasReason(reason) {
			t.Fatalf("decision missing reason %s: %+v", reason, decision.Reasons)
		}
	}
}

func TestRequestChangeDetectorRequiredRequirementChurnIsSubstantial(t *testing.T) {
	req := &model.LegalRequest{RequestType: "contract_review", Priority: model.RequestPriorityNormal}
	afterReqs := []model.RequirementItem{
		{Code: "draft", Kind: model.RequirementKindAttachment, Required: true},
	}

	decision := NewRequestChangeDetector().Detect(req, req, nil, afterReqs)
	if !decision.Substantial {
		t.Fatalf("Substantial = false, want true for added required item")
	}
	if !decision.HasReason(SubstantialReasonRequiredItemAdded) {
		t.Fatalf("missing required_item_added reason: %+v", decision.Reasons)
	}
}

func TestRequestChangeDetectorSatisfactionOnlyIsNotSubstantial(t *testing.T) {
	req := &model.LegalRequest{RequestType: "contract_review", Priority: model.RequestPriorityNormal}
	beforeReqs := []model.RequirementItem{
		{Code: "draft", Kind: model.RequirementKindAttachment, Required: true, Satisfied: false},
	}
	afterReqs := []model.RequirementItem{
		{Code: "draft", Kind: model.RequirementKindAttachment, Required: true, Satisfied: true},
	}

	decision := NewRequestChangeDetector().Detect(req, req, beforeReqs, afterReqs)
	if decision.Substantial {
		t.Fatalf("Substantial = true, want false for evidence satisfaction only: %+v", decision)
	}
}
