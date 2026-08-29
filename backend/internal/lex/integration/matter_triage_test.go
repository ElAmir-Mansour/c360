//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestMatterTriageWorkflowAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contractReq := h.baseContractRequest("Triage Linked Contract", model.ContractTypeVendor, 320_000, "Vendor dispute service records.")
	contractReq.PartyBName = "Desert Cloud Services LLC"
	contract := h.createContract(t, contractReq)

	requesterID := uuid.New()
	requesterName := "Procurement Requester"
	department := "Procurement"
	matter := mustData[model.Matter](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/matters", dto.CreateMatterRequest{
		Title:           "Desert Cloud Services Escalation",
		Description:     "Supplier missed onboarding milestones and requires legal intake triage.",
		Type:            model.MatterTypeContract,
		Status:          model.MatterStatusIntake,
		Priority:        model.LegalPriorityMedium,
		OwnerUserID:     h.userID,
		OwnerName:       "Legal Intake Queue",
		RequesterUserID: &requesterID,
		RequesterName:   &requesterName,
		Department:      &department,
		Tags:            []string{"intake", "supplier"},
		Metadata:        map[string]any{"counterparty": "Desert Cloud Services LLC", "intake_channel": "business_portal"},
		ContractIDs:     []uuid.UUID{contract.ID},
	}), http.StatusCreated)
	if matter.Status != model.MatterStatusIntake || len(matter.Contracts) != 1 {
		t.Fatalf("created matter = %+v, want intake with linked contract", matter)
	}

	triageOwner := uuid.New()
	triageOwnerName := "Senior Legal Counsel"
	dueDate := time.Now().UTC().AddDate(0, 0, 5)
	priority := model.LegalPriorityCritical
	triaged := mustData[model.Matter](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/matters/%s/triage", matter.ID), dto.TriageMatterRequest{
		Status:      model.MatterStatusInReview,
		Priority:    &priority,
		OwnerUserID: &triageOwner,
		OwnerName:   &triageOwnerName,
		DueDate:     &dueDate,
		Notes:       "Escalated because onboarding delay blocks a regulated service launch.",
		Metadata: map[string]any{
			"triage_category": "supplier_delay",
			"sla_class":       "urgent",
			"risk_owner":      "procurement",
		},
	}), http.StatusOK)
	if triaged.Status != model.MatterStatusInReview || triaged.Priority != model.LegalPriorityCritical {
		t.Fatalf("triaged matter status/priority = %s/%s, want in_review/critical", triaged.Status, triaged.Priority)
	}
	if triaged.OwnerUserID != triageOwner || triaged.OwnerName != triageOwnerName {
		t.Fatalf("triaged owner = %s/%q, want %s/%q", triaged.OwnerUserID, triaged.OwnerName, triageOwner, triageOwnerName)
	}
	if triaged.DueDate == nil || triaged.DueDate.UTC().Format("2006-01-02") != dueDate.UTC().Format("2006-01-02") {
		t.Fatalf("triaged due_date = %v, want %s", triaged.DueDate, dueDate.UTC().Format("2006-01-02"))
	}
	if len(triaged.Contracts) != 1 || triaged.Contracts[0].ContractID != contract.ID {
		t.Fatalf("triaged contract links = %+v, want linked contract %s", triaged.Contracts, contract.ID)
	}
	if triaged.Metadata["triage_category"] != "supplier_delay" || triaged.Metadata["sla_class"] != "urgent" {
		t.Fatalf("triage metadata missing request fields: %+v", triaged.Metadata)
	}
	evidence, ok := triaged.Metadata["intake_triage"].(map[string]any)
	if !ok {
		t.Fatalf("intake_triage evidence missing: %+v", triaged.Metadata)
	}
	if evidence["previous_status"] != string(model.MatterStatusIntake) ||
		evidence["target_status"] != string(model.MatterStatusInReview) ||
		evidence["triaged_by"] != h.userID.String() ||
		evidence["notes"] != "Escalated because onboarding delay blocks a regulated service launch." {
		t.Fatalf("intake_triage evidence = %+v, want triage audit details", evidence)
	}

	listed := mustPaginated[model.Matter](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/matters?status=in_review&owner_user_id=%s&page=1&per_page=20", triageOwner), nil), http.StatusOK)
	if !matterListContains(listed.Data, matter.ID) {
		t.Fatalf("triaged matter missing from filtered work queue: %+v", listed.Data)
	}
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/matters/%s/triage", matter.ID), dto.TriageMatterRequest{
		Status: model.MatterStatusWaitingOnBusiness,
		Notes:  "Duplicate triage should be blocked once the matter is in review.",
	}), http.StatusUnprocessableEntity)
}

func matterListContains(items []model.Matter, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}
