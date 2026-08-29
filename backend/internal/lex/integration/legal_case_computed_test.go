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

// legalCaseDetailResponse mirrors dto.LegalCaseDetail on the wire: the embedded
// case fields plus the WS9 computed block.
type legalCaseDetailResponse struct {
	model.LegalCase
	Computed dto.CaseComputedBlock `json:"computed"`
}

// legalCaseListItemResponse mirrors dto.LegalCaseListItem on the wire: the case
// row plus the WS9 list aggregates.
type legalCaseListItemResponse struct {
	model.LegalCase
	NextHearingDate *time.Time `json:"next_hearing_date"`
	PartyCount      int        `json:"party_count"`
}

// TestLegalCaseComputedBlockAndListAggregates exercises the WS9 surface end to
// end: bulk party/task creation, the case-detail computed block, and the list
// aggregate columns. It depends on the integrator having wired:
//
//	POST /legal-cases/{id}/parties/bulk -> LegalCase.BulkAddParties
//	POST /legal-cases/{id}/tasks/bulk   -> LegalCase.BulkDefineTasks
func TestLegalCaseComputedBlockAndListAggregates(t *testing.T) {
	h := newLexHarness(t)

	created := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", map[string]any{
		"case_type":      "civil",
		"company_status": string(model.CaseCompanyStatusPlaintiff),
		"title":          map[string]string{"en": "Computed Block Case", "ar": "قضية"},
		"priority":       string(model.LegalPriorityHigh),
	}), http.StatusCreated)
	caseID := created.ID

	// Bulk-create two parties in one call.
	parties := mustData[[]model.CaseParty](t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/parties/bulk", caseID),
		dto.BulkCreateCasePartiesRequest{
			Parties: []dto.CreateCasePartyRequest{
				{Role: model.CasePartyRolePlaintiff, Name: "Acme Corp"},
				{Role: model.CasePartyRoleDefendant, Name: "Globex LLC"},
			},
		}), http.StatusCreated)
	if len(parties) != 2 {
		t.Fatalf("bulk parties: got %d, want 2", len(parties))
	}

	// Bulk-create three tasks; one is created already-done so it should NOT count
	// toward open_task_count.
	tasks := mustData[[]model.CaseTask](t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/tasks/bulk", caseID),
		dto.BulkCreateCaseTasksRequest{
			Tasks: []dto.CreateCaseTaskRequest{
				{Title: "Draft pleading", Priority: model.LegalPriorityMedium, Status: model.CaseTaskStatusOpen},
				{Title: "File motion", Priority: model.LegalPriorityHigh, Status: model.CaseTaskStatusInProgress},
				{Title: "Closed item", Priority: model.LegalPriorityLow, Status: model.CaseTaskStatusDone},
			},
		}), http.StatusCreated)
	if len(tasks) != 3 {
		t.Fatalf("bulk tasks: got %d, want 3", len(tasks))
	}

	// Add a future hearing so next_hearing_date populates.
	future := time.Now().UTC().Add(72 * time.Hour)
	past := time.Now().UTC().Add(-72 * time.Hour)
	mustData[model.CaseHearing](t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/hearings", caseID),
		dto.CreateCaseHearingRequest{HearingDate: past, Notes: "past"}), http.StatusCreated)
	mustData[model.CaseHearing](t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/hearings", caseID),
		dto.CreateCaseHearingRequest{HearingDate: future, Notes: "next"}), http.StatusCreated)

	// GET detail: assert the computed block.
	detail := mustData[legalCaseDetailResponse](t, h.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s", caseID), nil), http.StatusOK)

	// open_task_count must equal the non-done tasks actually on the case. The case
	// carries the 3 explicit tasks above (2 open, 1 done) PLUS any tasks seeded by
	// case-creation automation (all open) — so assert against the real task list
	// rather than a hardcoded number, which still proves the Done task is excluded.
	wantOpen := 0
	for _, tk := range detail.Tasks {
		if tk.Status != model.CaseTaskStatusDone {
			wantOpen++
		}
	}
	if wantOpen < 2 {
		t.Fatalf("expected at least the 2 explicit open tasks, counted %d in %d total", wantOpen, len(detail.Tasks))
	}
	if detail.Computed.OpenTaskCount != wantOpen {
		t.Fatalf("computed.open_task_count = %d, want %d (non-done tasks on the case)", detail.Computed.OpenTaskCount, wantOpen)
	}
	if detail.Computed.EscalationLevel != 0 {
		t.Fatalf("computed.escalation_level = %d, want 0 (no clock yet)", detail.Computed.EscalationLevel)
	}
	if detail.Computed.SLAOutcome != nil {
		t.Fatalf("computed.sla_outcome = %v, want nil (case never opened)", *detail.Computed.SLAOutcome)
	}
	if detail.Computed.NextHearingDate == nil {
		t.Fatal("computed.next_hearing_date = nil, want the future hearing")
	} else if got := detail.Computed.NextHearingDate.UTC().Truncate(time.Second); !got.Equal(future.Truncate(time.Second)) {
		t.Fatalf("computed.next_hearing_date = %s, want %s", got, future.Truncate(time.Second))
	}
	// days_open is computed from creation time (no clock yet); should be present and >= 0.
	if detail.Computed.DaysOpen == nil {
		t.Fatal("computed.days_open = nil, want a value computed from created_at")
	} else if *detail.Computed.DaysOpen < 0 {
		t.Fatalf("computed.days_open = %d, want >= 0", *detail.Computed.DaysOpen)
	}
	// Backward-compat: embedded case fields still present.
	if detail.ID != caseID {
		t.Fatalf("detail.id = %s, want %s (embedded case must round-trip)", detail.ID, caseID)
	}
	// Child aggregates must be hydrated: the 3 explicit tasks are present (plus any
	// automation-seeded tasks), so assert >= 3 rather than an exact count.
	if len(detail.Tasks) < 3 {
		t.Fatalf("detail.tasks = %d, want >= 3 (hydrated child aggregates preserved)", len(detail.Tasks))
	}

	// LIST: assert the per-row aggregates.
	list := mustPaginated[legalCaseListItemResponse](t, h.doJSON(t, http.MethodGet,
		"/api/v1/lex/legal-cases?per_page=50", nil), http.StatusOK)
	var row *legalCaseListItemResponse
	for i := range list.Data {
		if list.Data[i].ID == caseID {
			row = &list.Data[i]
			break
		}
	}
	if row == nil {
		t.Fatalf("case %s not found in list response", caseID)
	}
	if row.PartyCount != 2 {
		t.Fatalf("list row party_count = %d, want 2", row.PartyCount)
	}
	if row.NextHearingDate == nil {
		t.Fatal("list row next_hearing_date = nil, want the future hearing")
	} else if got := row.NextHearingDate.UTC().Truncate(time.Second); !got.Equal(future.Truncate(time.Second)) {
		t.Fatalf("list row next_hearing_date = %s, want %s", got, future.Truncate(time.Second))
	}
}

// TestBulkCreatePartiesRejectsEmpty asserts the bulk endpoints reject an empty
// batch with a 422 validation error (the codebase convention for service-layer
// validationError/VALIDATION_ERROR, matching every other lex integration test).
func TestBulkCreatePartiesRejectsEmpty(t *testing.T) {
	h := newLexHarness(t)
	created := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", map[string]any{
		"case_type":      "civil",
		"company_status": string(model.CaseCompanyStatusDefendant),
		"title":          map[string]string{"en": "Empty Bulk", "ar": "فارغ"},
		"priority":       string(model.LegalPriorityMedium),
	}), http.StatusCreated)

	mustError(t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/parties/bulk", created.ID),
		dto.BulkCreateCasePartiesRequest{Parties: nil}), http.StatusUnprocessableEntity)

	mustError(t, h.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/tasks/bulk", created.ID),
		dto.BulkCreateCaseTasksRequest{Tasks: nil}), http.StatusUnprocessableEntity)

	_ = uuid.Nil // keep uuid import stable if helpers above change.
}
