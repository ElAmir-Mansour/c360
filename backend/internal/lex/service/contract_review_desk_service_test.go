package service

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestContractAttachmentSlotSeedsAreThePrdSet(t *testing.T) {
	want := []struct {
		slot     model.ContractAttachmentSlot
		required bool
	}{
		{model.ContractAttachmentSlotFoundationDocument, true},
		{model.ContractAttachmentSlotPurposeOfContract, true},
		{model.ContractAttachmentSlotAuthorizedPersonID, true},
		{model.ContractAttachmentSlotPowerOfAttorney, false},
		{model.ContractAttachmentSlotAddendumPriorDocs, false},
	}
	if len(contractAttachmentSlotSeeds) != len(want) {
		t.Fatalf("seed count = %d, want %d", len(contractAttachmentSlotSeeds), len(want))
	}
	for i, w := range want {
		got := contractAttachmentSlotSeeds[i]
		if got.Slot != w.slot {
			t.Fatalf("seed[%d].Slot = %q, want %q", i, got.Slot, w.slot)
		}
		if got.Required != w.required {
			t.Fatalf("seed[%d] (%s).Required = %v, want %v", i, w.slot, got.Required, w.required)
		}
	}
}

func TestBuildCompletenessResultRequiresAllPrdRequiredSlots(t *testing.T) {
	contractID := uuid.New()

	result := buildCompletenessResult(contractID, nil, nil, time.Unix(123, 0).UTC())
	if result.Complete {
		t.Fatalf("Complete = true, want false when no PRD slot is satisfied")
	}
	// All five PRD slots are surfaced; only the three required ones (foundation,
	// purpose, authorized-person id) count as missing — power_of_attorney and
	// addendum_prior_docs are optional.
	if len(result.Slots) != 5 {
		t.Fatalf("Slots len = %d, want 5", len(result.Slots))
	}
	if len(result.MissingSlots) != 3 {
		t.Fatalf("MissingSlots len = %d, want 3 (the required PRD slots)", len(result.MissingSlots))
	}
	for _, missing := range result.MissingSlots {
		switch missing {
		case model.ContractAttachmentSlotPowerOfAttorney, model.ContractAttachmentSlotAddendumPriorDocs:
			t.Fatalf("optional PRD slot %q reported missing", missing)
		}
	}
}

func TestBuildCompletenessResultPreservesOptionalSlotOverride(t *testing.T) {
	contractID := uuid.New()
	liveAttachmentID := uuid.New()
	requirements := []model.ContractAttachmentRequirement{
		{ContractID: contractID, Slot: model.ContractAttachmentSlotFoundationDocument, Required: true, Label: "Foundation", SortOrder: 10},
		// Purpose is toggled optional for this intake — it must not be reported missing.
		{ContractID: contractID, Slot: model.ContractAttachmentSlotPurposeOfContract, Required: false, Label: "Purpose", SortOrder: 20},
	}
	live := map[model.ContractAttachmentSlot]model.ContractAttachment{
		model.ContractAttachmentSlotFoundationDocument: {
			ID:         liveAttachmentID,
			ContractID: contractID,
			Slot:       model.ContractAttachmentSlotFoundationDocument,
			FileName:   "foundation.pdf",
		},
	}

	result := buildCompletenessResult(contractID, requirements, live, time.Unix(123, 0).UTC())
	if result.Complete {
		t.Fatalf("Complete = true, want false because authorized_person_id is still missing")
	}
	for _, missing := range result.MissingSlots {
		if missing == model.ContractAttachmentSlotPurposeOfContract {
			t.Fatalf("purpose_of_contract reported missing even though requirement override made it optional")
		}
	}
}

func TestBuildCompletenessResultPreservesLegacyStoredSlot(t *testing.T) {
	contractID := uuid.New()
	// A pre-PRD intake stored a required legacy "draft" requirement row. The union
	// must still surface and gate on it even though it is outside the PRD seed set.
	requirements := []model.ContractAttachmentRequirement{
		{ContractID: contractID, Slot: model.ContractAttachmentSlotDraft, Required: true, Label: "Draft", SortOrder: 110},
	}

	result := buildCompletenessResult(contractID, requirements, nil, time.Unix(123, 0).UTC())
	if len(result.Slots) != len(contractAttachmentSlotSeeds)+1 {
		t.Fatalf("Slots len = %d, want %d (PRD seeds + 1 legacy)", len(result.Slots), len(contractAttachmentSlotSeeds)+1)
	}
	sawDraft := false
	for _, missing := range result.MissingSlots {
		if missing == model.ContractAttachmentSlotDraft {
			sawDraft = true
		}
	}
	if !sawDraft {
		t.Fatalf("legacy draft slot not gated as missing; MissingSlots = %v", result.MissingSlots)
	}
}

func TestValidateRecommendationGateRequiresCompletenessAndUnderReview(t *testing.T) {
	intake := &model.ContractIntake{
		Status:              model.ContractIntakeStatusRoutedToLegal,
		CompletenessChecked: true,
		CompletenessPassed:  true,
	}
	if err := validateRecommendationGate(intake); err == nil || httpStatus(err) != http.StatusConflict {
		t.Fatalf("validateRecommendationGate(routed) = %v, want conflict", err)
	}

	intake.Status = model.ContractIntakeStatusUnderReview
	intake.CompletenessPassed = false
	if err := validateRecommendationGate(intake); err == nil || httpStatus(err) != http.StatusConflict {
		t.Fatalf("validateRecommendationGate(incomplete) = %v, want conflict", err)
	}

	intake.CompletenessPassed = true
	if err := validateRecommendationGate(intake); err != nil {
		t.Fatalf("validateRecommendationGate(under_review complete) = %v, want nil", err)
	}
}

func TestContractIntakeReturnAllowed(t *testing.T) {
	if contractIntakeReturnAllowed(model.ContractIntakeStatusCompleted) {
		t.Fatalf("completed intake can be returned, want false")
	}
	if !contractIntakeReturnAllowed(model.ContractIntakeStatusRoutedToLegal) {
		t.Fatalf("routed intake cannot be returned, want true")
	}
	if !contractIntakeReturnAllowed(model.ContractIntakeStatusUnderReview) {
		t.Fatalf("under_review intake cannot be returned, want true")
	}
}

func TestApprovedRecommendationRequiresManagerApprovalStart(t *testing.T) {
	req := dto.RecordContractRecommendationRequest{
		Outcome: model.ContractRecommendationOutcomeApproved,
		Summary: "Proceed",
	}
	req.Normalize()

	err := validateRecommendationRequest(req)
	if err == nil {
		t.Fatalf("validateRecommendationRequest() = nil, want validation error")
	}
	if httpStatus(err) != http.StatusUnprocessableEntity {
		t.Fatalf("approval handoff validation status = %d, want 422", httpStatus(err))
	}

	req.StartApproval = true
	if err := validateRecommendationRequest(req); err != nil {
		t.Fatalf("validateRecommendationRequest(start_approval=true) = %v, want nil", err)
	}
}
