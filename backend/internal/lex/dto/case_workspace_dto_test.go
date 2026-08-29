package dto

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestCreateCaseWorkspaceDTOsNormalizeDefaults(t *testing.T) {
	milestone := CreateCaseMilestoneRequest{
		Title:  "  File appeal  ",
		Source: "  ",
	}
	milestone.Normalize()
	if milestone.Title != "File appeal" {
		t.Fatalf("milestone title = %q", milestone.Title)
	}
	if milestone.MilestoneType != model.CaseMilestoneTypeCustom ||
		milestone.Status != model.CaseMilestoneStatusPlanned ||
		milestone.Source != "manual" {
		t.Fatalf("milestone defaults = type %q status %q source %q",
			milestone.MilestoneType, milestone.Status, milestone.Source)
	}

	evidence := CreateCaseDocumentLinkRequest{
		CourtReference: stringPointer("  CRT-2026-19  "),
	}
	evidence.Normalize()
	if evidence.EvidenceStatus != model.EvidenceStatusPending {
		t.Fatalf("evidence default status = %q", evidence.EvidenceStatus)
	}
	if evidence.CourtReference == nil || *evidence.CourtReference != "CRT-2026-19" {
		t.Fatalf("court reference = %v", evidence.CourtReference)
	}
}

func TestLitigationWorkspaceDTOsNormalizeEnums(t *testing.T) {
	pleading := CreatePleadingRequest{
		Type:      model.PleadingType(" MOTION "),
		Direction: model.PleadingDirection(" INCOMING "),
		Recipient: stringPointer("  Commercial Court  "),
	}
	pleading.Normalize()
	if pleading.Type != model.PleadingTypeMotion || pleading.Direction != model.PleadingDirectionIncoming {
		t.Fatalf("pleading enum normalization = type %q direction %q", pleading.Type, pleading.Direction)
	}
	if pleading.Recipient == nil || *pleading.Recipient != "Commercial Court" {
		t.Fatalf("recipient = %v", pleading.Recipient)
	}

	judgment := CreateJudgmentRequest{
		DecisionType: model.JudgmentDecisionType(" FINAL "),
		JudgeName:    stringPointer("  Judge A  "),
	}
	judgment.Normalize()
	if judgment.DecisionType != model.JudgmentDecisionTypeFinal {
		t.Fatalf("decision type = %q", judgment.DecisionType)
	}
	if judgment.JudgeName == nil || *judgment.JudgeName != "Judge A" {
		t.Fatalf("judge name = %v", judgment.JudgeName)
	}
}

func stringPointer(value string) *string { return &value }
