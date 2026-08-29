package service

import (
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestUnsatisfiedRequirementCodesOnlyMandatoryItemsBlockClockStart(t *testing.T) {
	got := unsatisfiedRequirementCodes([]model.RequirementItem{
		{Code: "board_resolution", Required: true, Satisfied: false},
		{Code: "optional_context", Required: false, Satisfied: false},
		{Code: "commercial_terms", Required: true, Satisfied: true},
	})
	want := []string{"board_resolution"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unsatisfiedRequirementCodes() = %#v, want %#v", got, want)
	}
}

func TestReturnIncompleteMissingCodesDefaultsAndValidatesRequiredItems(t *testing.T) {
	items := []model.RequirementItem{
		{Code: "authority", Required: true, Satisfied: false},
		{Code: "terms", Required: true, Satisfied: true},
		{Code: "optional_context", Required: false, Satisfied: false},
	}

	got, err := returnIncompleteMissingCodes(items, nil)
	if err != nil {
		t.Fatalf("default missing codes returned error: %v", err)
	}
	if want := []string{"authority"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("default missing codes = %#v, want %#v", got, want)
	}

	got, err = returnIncompleteMissingCodes(items, []string{"terms"})
	if err != nil {
		t.Fatalf("explicit required missing code returned error: %v", err)
	}
	if want := []string{"terms"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit missing codes = %#v, want %#v", got, want)
	}

	if _, err := returnIncompleteMissingCodes(items, []string{"missing"}); err == nil {
		t.Fatal("unknown missing code returned nil error")
	}
	if _, err := returnIncompleteMissingCodes(items, []string{"optional_context"}); err == nil {
		t.Fatal("optional missing code returned nil error")
	}
}

// TestReturnIncompleteMissingCodesEmptyWhenNothingOutstanding documents the
// trigger for the ReturnIncomplete zero-requirement guard: a return with no
// requirement items at all, or one where every required item is already
// satisfied, resolves to an EMPTY missing-code set — which ReturnIncomplete now
// rejects (a return must cite an unmet requirement the requester can act on,
// otherwise it strands them with an empty checklist and no way to advance).
func TestReturnIncompleteMissingCodesEmptyWhenNothingOutstanding(t *testing.T) {
	// No requirements at all.
	got, err := returnIncompleteMissingCodes(nil, nil)
	if err != nil {
		t.Fatalf("empty requirements returned error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("empty requirements missing codes = %#v, want none", got)
	}

	// Requirements exist but every REQUIRED item is already satisfied.
	allSatisfied := []model.RequirementItem{
		{Code: "authority", Required: true, Satisfied: true},
		{Code: "optional_context", Required: false, Satisfied: false},
	}
	got, err = returnIncompleteMissingCodes(allSatisfied, nil)
	if err != nil {
		t.Fatalf("all-satisfied requirements returned error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("all-satisfied missing codes = %#v, want none", got)
	}
}

func TestApplyRequirementUpdateEvidenceSatisfiesAndExplicitFalseClears(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	fileID := uuid.New()
	item := &model.RequirementItem{Kind: model.RequirementKindAttachment}

	applyRequirementUpdate(item, dto.UpdateRequirementItemRequest{FileID: &fileID}, userID, now)
	if !item.Satisfied {
		t.Fatal("file evidence did not satisfy requirement")
	}
	if item.SatisfiedBy == nil || *item.SatisfiedBy != userID || item.SatisfiedAt == nil || !item.SatisfiedAt.Equal(now) {
		t.Fatalf("satisfaction actor/time not recorded: %+v", item)
	}

	falseValue := false
	applyRequirementUpdate(item, dto.UpdateRequirementItemRequest{Satisfied: &falseValue}, userID, now.Add(time.Hour))
	if item.Satisfied {
		t.Fatal("explicit satisfied=false did not clear satisfaction")
	}
	if item.SatisfiedBy != nil || item.SatisfiedAt != nil {
		t.Fatalf("satisfaction evidence actor/time not cleared: %+v", item)
	}
}

func TestRequesterRequirementFulfillmentAllowsEvidenceOnly(t *testing.T) {
	fileID := uuid.New()
	trueValue, falseValue := true, false
	code := "rewritten_control"

	for name, req := range map[string]dto.UpdateRequirementItemRequest{
		"signed contract": {FileID: &fileID, Satisfied: &trueValue},
		"requested data":  {DataValue: stringPointer("Commercial registration 42"), Satisfied: &trueValue},
	} {
		if !requesterCanFulfillRequirement(req) {
			t.Errorf("%s evidence must be allowed", name)
		}
	}
	for name, req := range map[string]dto.UpdateRequirementItemRequest{
		"toggle without evidence": {Satisfied: &trueValue},
		"mark pending":            {FileID: &fileID, Satisfied: &falseValue},
		"rewrite control":         {Code: &code, FileID: &fileID, Satisfied: &trueValue},
	} {
		if requesterCanFulfillRequirement(req) {
			t.Errorf("%s must be rejected", name)
		}
	}
}

func stringPointer(value string) *string { return &value }

func TestRequestAllowsReexecutionCloneOnlyForOriginalRequest(t *testing.T) {
	if !requestAllowsReexecutionClone(&model.LegalRequest{}) {
		t.Fatal("original request without lineage should allow one clone")
	}
	if requestAllowsReexecutionClone(&model.LegalRequest{Metadata: map[string]any{"clone_generation": 1}}) {
		t.Fatal("clone_generation=1 should suppress further clones")
	}
	if requestAllowsReexecutionClone(&model.LegalRequest{Metadata: map[string]any{"clone_generation": "1"}}) {
		t.Fatal("string clone_generation=1 should suppress further clones")
	}
	if requestAllowsReexecutionClone(&model.LegalRequest{Metadata: map[string]any{"cloned_from_request_id": uuid.NewString()}}) {
		t.Fatal("cloned_from_request_id should suppress further clones")
	}
}

func TestCloneMetadataStripsPriorLineage(t *testing.T) {
	got := cloneMetadata(map[string]any{
		"keep":                       "value",
		"cloned_from_request_id":     uuid.NewString(),
		"cloned_from_request_number": "REQ-1",
		"clone_reason":               "old",
		"clone_generation":           1,
	})
	if got["keep"] != "value" {
		t.Fatalf("cloneMetadata dropped unrelated metadata: %#v", got)
	}
	for _, key := range []string{"cloned_from_request_id", "cloned_from_request_number", "clone_reason", "clone_generation"} {
		if _, ok := got[key]; ok {
			t.Fatalf("cloneMetadata retained lineage key %q in %#v", key, got)
		}
	}
}
