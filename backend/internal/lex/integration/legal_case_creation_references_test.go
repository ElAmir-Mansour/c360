//go:build integration

package integration

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func createCaseSourceRequest(t *testing.T, h *lexHarness, label string) model.LegalRequest {
	t.Helper()
	return mustData[model.LegalRequest](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
		RequestType:   "case_source_" + uuid.NewString()[:8],
		Title:         forms.LocalizedText{EN: label, AR: label},
		Description:   "Case source request integration fixture.",
		RequesterName: "Case Requester",
		Priority:      model.RequestPriorityNormal,
	}), http.StatusCreated)
}

func caseReferenceCreateRequest(label string) dto.CreateLegalCaseRequest {
	return dto.CreateLegalCaseRequest{
		CaseType:      "civil",
		CompanyStatus: model.CaseCompanyStatusPlaintiff,
		Title:         forms.LocalizedText{EN: label, AR: label},
		Description:   "Reference validation fixture.",
		Status:        model.CaseStatusIntake,
		Priority:      model.LegalPriorityMedium,
	}
}

func TestLegalCaseCreationReferencesAreTenantScopedAndMutuallyExclusive(t *testing.T) {
	tenantA := newLexHarness(t)
	tenantB := newLexHarness(t)
	contract := tenantA.createContractWithText(t, "Cross-tenant source", model.ContractTypeServiceAgreement, 1000, "")
	request := createCaseSourceRequest(t, tenantA, "Cross-tenant request")
	courtID := uuid.New()
	if _, err := tenantA.env.db.Exec(t.Context(), `
		INSERT INTO legal_courts (id, tenant_id, code, name, created_by)
		VALUES ($1, $2, $3, '{"en":"Integration Court","ar":"محكمة اختبار"}'::jsonb, $4)`,
		courtID, tenantA.tenantID, "COURT-"+uuid.NewString()[:8], tenantA.userID,
	); err != nil {
		t.Fatalf("insert court fixture: %v", err)
	}
	courts := mustPaginated[model.LegalCourt](t, tenantA.doJSON(t, http.MethodGet, "/api/v1/lex/legal-courts?active=true&search=Integration", nil), http.StatusOK)
	if len(courts.Data) != 1 || courts.Data[0].ID != courtID {
		t.Fatalf("tenant court catalog = %+v, want %s", courts.Data, courtID)
	}

	tests := []struct {
		name  string
		apply func(*dto.CreateLegalCaseRequest)
	}{
		{name: "contract", apply: func(req *dto.CreateLegalCaseRequest) { req.ContractID = &contract.ID }},
		{name: "request", apply: func(req *dto.CreateLegalCaseRequest) { req.RequestID = &request.ID }},
		{name: "court", apply: func(req *dto.CreateLegalCaseRequest) { req.CourtID = &courtID }},
	}
	for _, test := range tests {
		t.Run("cross-tenant "+test.name, func(t *testing.T) {
			req := caseReferenceCreateRequest(test.name)
			test.apply(&req)
			expectStatus(t, tenantB.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", req), http.StatusUnprocessableEntity)
		})
	}

	mutuallyExclusive := caseReferenceCreateRequest("exclusive")
	mutuallyExclusive.ContractID = &contract.ID
	mutuallyExclusive.RequestID = &request.ID
	expectStatus(t, tenantA.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", mutuallyExclusive), http.StatusUnprocessableEntity)
}

func TestSelectableCaseClassificationsReturnsOnlyActiveRoots(t *testing.T) {
	h := newLexHarness(t)
	rootID, childID, inactiveID := uuid.New(), uuid.New(), uuid.New()
	if _, err := h.env.db.Exec(t.Context(), `
		INSERT INTO legal_case_classifications
			(id, tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
		VALUES
			($1::uuid,$4,NULL,'ROOT_SELECTABLE','{"en":"Selectable","ar":"قابل للاختيار"}'::jsonb,ARRAY[($1::uuid)::text],false,true,1,$5),
			($2::uuid,$4,$1::uuid,'NESTED_NOT_SELECTABLE','{"en":"Nested","ar":"فرعي"}'::jsonb,ARRAY[($1::uuid)::text,($2::uuid)::text],false,true,2,$5),
			($3::uuid,$4,NULL,'ROOT_INACTIVE','{"en":"Inactive","ar":"غير نشط"}'::jsonb,ARRAY[($3::uuid)::text],false,false,3,$5)`,
		rootID, childID, inactiveID, h.tenantID, h.userID,
	); err != nil {
		t.Fatalf("insert classification fixtures: %v", err)
	}

	items := mustPaginated[model.CaseClassification](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/case-classifications/selectable?search=Selectable", nil), http.StatusOK)
	if len(items.Data) != 1 || items.Data[0].ID != rootID {
		t.Fatalf("selectable classifications = %+v, want root %s only", items.Data, rootID)
	}
}

func TestLegalCaseRequestLinkCannotOverwriteAndCanBeCleared(t *testing.T) {
	h := newLexHarness(t)
	request := createCaseSourceRequest(t, h, "Occupied request")
	courtID := uuid.New()
	if _, err := h.env.db.Exec(t.Context(), `
		INSERT INTO legal_courts (id, tenant_id, code, name, created_by)
		VALUES ($1, $2, $3, '{"en":"Reference Court","ar":"محكمة مرجعية"}'::jsonb, $4)`,
		courtID, h.tenantID, "COURT-"+uuid.NewString()[:8], h.userID,
	); err != nil {
		t.Fatalf("insert court fixture: %v", err)
	}

	create := caseReferenceCreateRequest("first linked case")
	create.RequestID = &request.ID
	create.CourtID = &courtID
	created := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", create), http.StatusCreated)
	if created.RequestID == nil || *created.RequestID != request.ID || created.CourtID == nil || *created.CourtID != courtID || created.Court == nil {
		t.Fatalf("created references not hydrated: %+v", created)
	}

	occupied := caseReferenceCreateRequest("second linked case")
	occupied.RequestID = &request.ID
	expectStatus(t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", occupied), http.StatusConflict)

	updated := mustData[model.LegalCase](t, h.doJSON(t, http.MethodPut, "/api/v1/lex/legal-cases/"+created.ID.String(), dto.UpdateLegalCaseRequest{
		ClearedFields: []string{"request_id", "court_id"},
	}), http.StatusOK)
	if updated.RequestID != nil || updated.CourtID != nil || updated.Court != nil {
		t.Fatalf("references not cleared: %+v", updated)
	}
	if updated.CaseNumber != created.CaseNumber || updated.Description != created.Description || updated.CaseType != created.CaseType {
		t.Fatalf("clear changed unrelated fields: before=%+v after=%+v", created, updated)
	}

	reloadedRequest := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/legal-requests/"+request.ID.String(), nil), http.StatusOK)
	if reloadedRequest.SubjectID != nil || reloadedRequest.SubjectType != nil {
		t.Fatalf("request back-link not cleared: %+v", reloadedRequest)
	}
}
