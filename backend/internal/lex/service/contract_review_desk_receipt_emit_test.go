package service

import (
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// TestContractRequesterFieldsCarriesRequesterIdentity verifies the intake receipt
// events (intake_opened / intake_acknowledged) are enriched with the contract
// requester (owner) identity — requester_user_id / requester_name / contract_title —
// so the notification consumer can route the PRD §9.1 receipt to the requester
// rather than the desk clerk.
func TestContractRequesterFieldsCarriesRequesterIdentity(t *testing.T) {
	ownerID := uuid.New()
	contract := &model.Contract{
		ID:          uuid.New(),
		OwnerUserID: ownerID,
		OwnerName:   "Sara Al-Otaibi",
		Title:       "Vendor Services Agreement",
	}

	fields := contractRequesterFields(contract)

	if got := fields["requester_user_id"]; got != ownerID {
		t.Fatalf("requester_user_id = %v, want %s", got, ownerID)
	}
	if got := fields["requester_name"]; got != "Sara Al-Otaibi" {
		t.Fatalf("requester_name = %v, want Sara Al-Otaibi", got)
	}
	if got := fields["contract_title"]; got != "Vendor Services Agreement" {
		t.Fatalf("contract_title = %v, want Vendor Services Agreement", got)
	}
}

// TestContractRequesterFieldsNilContract confirms a nil contract yields an empty
// map (no requester keys), so the consumer safely skips the receipt rather than
// panicking or targeting a zero recipient.
func TestContractRequesterFieldsNilContract(t *testing.T) {
	fields := contractRequesterFields(nil)
	if len(fields) != 0 {
		t.Fatalf("fields = %v, want empty map for nil contract", fields)
	}
}
