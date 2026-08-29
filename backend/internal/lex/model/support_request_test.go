package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSupportRequestNullableContractFieldsSerializeAsNull(t *testing.T) {
	raw, err := json.Marshal(SupportRequest{})
	if err != nil {
		t.Fatal(err)
	}
	jsonText := string(raw)
	for _, field := range []string{
		"requester_entity_id", "subject_type", "subject_id", "expires_at", "accepted_at", "closed_at",
		"approver_user_id", "approval_decided_at", "business_days",
	} {
		if !strings.Contains(jsonText, `"`+field+`":null`) {
			t.Fatalf("%s must be present as null in stable API contract: %s", field, jsonText)
		}
	}
}

func TestSupportApprovalStatusVocabularyAndTerminality(t *testing.T) {
	for _, status := range []SupportRequestStatus{SupportStatusPendingManagerApproval, SupportStatusRejected} {
		if !status.Valid() {
			t.Fatalf("%s must be an accepted status", status)
		}
	}
	// The gate state is open-ended; rejection is terminal exactly like the other
	// closed states, so nothing downstream can reopen it.
	if SupportStatusPendingManagerApproval.Terminal() {
		t.Fatal("pending_manager_approval must not be terminal")
	}
	if !SupportStatusRejected.Terminal() {
		t.Fatal("rejected must be terminal")
	}
	if SupportRequestStatus("approved").Valid() {
		t.Fatal("status vocabulary must stay closed")
	}
}

func TestSupportApprovalRouteAlwaysRecordsWhetherAHumanDecided(t *testing.T) {
	automatic := map[SupportApprovalRoute]bool{
		SupportRouteManager:       false,
		SupportRouteUnitHead:      false,
		SupportRouteAutoNoManager: true,
		SupportRouteAutoSelf:      true,
	}
	for route, want := range automatic {
		if !route.Valid() {
			t.Fatalf("%s must be an accepted route", route)
		}
		if route.Automatic() != want {
			t.Fatalf("%s Automatic() = %v, want %v", route, route.Automatic(), want)
		}
	}
	// There is no unrecorded route: an empty value is not a valid one, so a row
	// can never claim an approval whose provenance is unknown.
	if SupportApprovalRoute("").Valid() {
		t.Fatal("an unrecorded approval route must be invalid")
	}
}

func TestSupportBoxVocabularyIncludesTheApproverScope(t *testing.T) {
	for _, box := range []SupportRequestBox{SupportBoxInbox, SupportBoxSent, SupportBoxAll, SupportBoxApprovals} {
		if !box.Valid() {
			t.Fatalf("%s must be an accepted box", box)
		}
	}
	if SupportRequestBox("pending").Valid() {
		t.Fatal("box vocabulary must stay closed")
	}
}

func TestSupportDirectoryMemberManagerSerializesAsNull(t *testing.T) {
	raw, err := json.Marshal(SupportDirectoryMember{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"manager_user_id":null`) {
		t.Fatalf("manager_user_id must be present as null: %s", raw)
	}
}
