package model

import "testing"

func TestCaseWorkspaceEnums(t *testing.T) {
	for _, value := range []CaseMilestoneType{
		CaseMilestoneTypeFiling, CaseMilestoneTypeHearing, CaseMilestoneTypeSubmission,
		CaseMilestoneTypeDecision, CaseMilestoneTypeDeadline, CaseMilestoneTypeCustom,
	} {
		if !value.Valid() {
			t.Fatalf("milestone type %q should be valid", value)
		}
	}
	if CaseMilestoneType("unknown").Valid() {
		t.Fatal("unknown milestone type should be invalid")
	}

	for _, value := range []EvidenceStatus{
		EvidenceStatusPending, EvidenceStatusSubmitted, EvidenceStatusAdmitted,
		EvidenceStatusRejected, EvidenceStatusWithdrawn,
	} {
		if !value.Valid() {
			t.Fatalf("evidence status %q should be valid", value)
		}
	}
	if EvidenceStatus("unknown").Valid() {
		t.Fatal("unknown evidence status should be invalid")
	}
}

func TestRicherPleadingAndJudgmentEnums(t *testing.T) {
	for _, value := range []PleadingType{
		PleadingTypeMemorandum, PleadingTypeMotion, PleadingTypePetition,
		PleadingTypeAppeal, PleadingTypeNotice, PleadingTypeRequest,
	} {
		if !value.Valid() {
			t.Fatalf("pleading type %q should be valid", value)
		}
	}
	for _, value := range []PleadingDirection{
		PleadingDirectionIncoming, PleadingDirectionOutgoing, PleadingDirectionInternal,
	} {
		if !value.Valid() {
			t.Fatalf("pleading direction %q should be valid", value)
		}
	}
	for _, value := range []JudgmentDecisionType{
		JudgmentDecisionTypeInterim, JudgmentDecisionTypeFirstInstance,
		JudgmentDecisionTypeSubstantive, JudgmentDecisionTypeFinal, JudgmentDecisionTypeAppeal,
		JudgmentDecisionTypeCassation, JudgmentDecisionTypeEnforcement,
		JudgmentDecisionTypeOther,
	} {
		if !value.Valid() {
			t.Fatalf("decision type %q should be valid", value)
		}
	}
	for _, value := range []JudgmentImpact{
		JudgmentImpactPositive, JudgmentImpactNegative, JudgmentImpactNeutral, JudgmentImpactMixed,
	} {
		if !value.Valid() {
			t.Fatalf("judgment impact %q should be valid", value)
		}
	}
}
