//go:build integration

package integration

import (
	"net/http"
	"testing"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestMatterConflictCheckAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	existingMatter := mustData[model.Matter](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/matters", dto.CreateMatterRequest{
		Title:       "Project Falcon Employment Dispute",
		Description: "Employee exit dispute involving Acme KSA LLC.",
		Type:        model.MatterTypeEmployment,
		Status:      model.MatterStatusOpen,
		Priority:    model.LegalPriorityHigh,
		OwnerUserID: h.userID,
		OwnerName:   "Integration Owner",
		Metadata:    map[string]any{"counterparty": "Acme KSA LLC"},
	}), http.StatusCreated)
	contractReq := h.baseContractRequest("Acme Master Services Agreement", model.ContractTypeServiceAgreement, 500_000, "Acme KSA LLC service terms.")
	contractReq.PartyBName = "Acme KSA LLC"
	existingContract := h.createContract(t, contractReq)

	positive := mustData[dto.MatterConflictCheckResult](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/matters/conflict-check", dto.MatterConflictCheckRequest{
		Title:        existingMatter.Title,
		Counterparty: "Acme KSA LLC",
	}), http.StatusOK)
	if len(positive.Conflicts) < 2 {
		t.Fatalf("conflicts = %d, want at least 2: %+v", len(positive.Conflicts), positive.Conflicts)
	}
	var sawMatter, sawContract bool
	for _, conflict := range positive.Conflicts {
		if conflict.MatterID != nil && *conflict.MatterID == existingMatter.ID {
			sawMatter = true
		}
		if conflict.ContractID != nil && *conflict.ContractID == existingContract.ID {
			sawContract = true
		}
	}
	if !sawMatter || !sawContract {
		t.Fatalf("missing expected matches matter=%v contract=%v conflicts=%+v", sawMatter, sawContract, positive.Conflicts)
	}
	if positive.CheckedAt.IsZero() {
		t.Fatal("expected checked_at")
	}

	negative := mustData[dto.MatterConflictCheckResult](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/matters/conflict-check", dto.MatterConflictCheckRequest{
		Title:           "Northstar Retail Lease Advice",
		Counterparty:    "Northstar Properties",
		ContractContext: "Showroom lease premises renewal in Jeddah.",
	}), http.StatusOK)
	if len(negative.Conflicts) != 0 {
		t.Fatalf("negative conflicts = %+v, want none", negative.Conflicts)
	}
	if len(negative.Warnings) != 0 {
		t.Fatalf("negative warnings = %+v, want none", negative.Warnings)
	}
}
