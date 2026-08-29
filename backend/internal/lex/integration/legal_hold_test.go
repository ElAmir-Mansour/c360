//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// createDocument is a local helper that creates an active legal document via the
// API and returns it.
func (h *lexHarness) createDocument(t *testing.T, title string) model.LegalDocument {
	t.Helper()
	return mustData[model.LegalDocument](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/documents", dto.CreateLegalDocumentRequest{
		Title:           title,
		Type:            model.DocumentTypePolicy,
		Description:     title + " created by the legal hold suite.",
		Confidentiality: model.DocumentConfidentialityInternal,
		Tags:            []string{"legal-hold"},
		Metadata:        map[string]any{"source": "legal-hold-test"},
		Document: &dto.FileReference{
			FileID:        uuid.New(),
			FileName:      "hold-doc.pdf",
			FileSizeBytes: 1024,
			ContentHash:   "sha256:" + uuid.NewString(),
			ExtractedText: "Document body for legal hold acceptance.",
			ChangeSummary: "initial",
		},
	}), http.StatusCreated)
}

func (h *lexHarness) createMatter(t *testing.T, title string) model.Matter {
	t.Helper()
	return mustData[model.Matter](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/matters", dto.CreateMatterRequest{
		Title:       title,
		Description: title + " opened for legal hold acceptance.",
		Type:        model.MatterTypeLitigation,
		Status:      model.MatterStatusOpen,
		Priority:    model.LegalPriorityHigh,
		OwnerUserID: h.userID,
		OwnerName:   "Legal Hold Owner",
		Tags:        []string{"litigation"},
		Metadata:    map[string]any{"counterparty": "Opposing Party LLC"},
	}), http.StatusCreated)
}

func (h *lexHarness) applyHold(t *testing.T, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID, reference string) model.LegalHold {
	t.Helper()
	return mustData[model.LegalHold](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-holds", dto.ApplyLegalHoldRequest{
		SubjectType: subjectType,
		SubjectID:   subjectID,
		Reason:      "Litigation preservation for " + reference,
		Reference:   reference,
		Custodian:   "General Counsel",
		Notes:       "Preserve all related records pending the matter.",
		Metadata:    map[string]any{"matter_ref": reference},
	}), http.StatusCreated)
}

// TestLegalHoldLifecycleAndIdempotency covers apply -> list/get -> release and
// the apply/release idempotency edges.
func TestLegalHoldLifecycleAndIdempotency(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Hold Lifecycle Contract", model.ContractTypeServiceAgreement, 500_000, lifecycleContractText())

	hold := h.applyHold(t, model.LegalHoldSubjectContract, contract.ID, "CASE-2026-001")
	if hold.Status != model.LegalHoldStatusActive {
		t.Fatalf("applied hold status = %s, want active", hold.Status)
	}
	if hold.SubjectType != model.LegalHoldSubjectContract || hold.SubjectID != contract.ID {
		t.Fatalf("applied hold subject = %s/%s, want contract/%s", hold.SubjectType, hold.SubjectID, contract.ID)
	}
	if hold.AppliedBy != h.userID {
		t.Fatalf("applied_by = %s, want %s", hold.AppliedBy, h.userID)
	}

	// Get returns the persisted hold.
	got := mustData[model.LegalHold](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-holds/%s", hold.ID), nil), http.StatusOK)
	if got.ID != hold.ID || got.Reference != "CASE-2026-001" {
		t.Fatalf("get hold = %+v, want id %s reference CASE-2026-001", got, hold.ID)
	}

	// List (active filter) includes it.
	active := mustPaginated[model.LegalHold](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds?status=active&page=1&per_page=50", nil), http.StatusOK)
	if !containsHold(active.Data, hold.ID) {
		t.Fatalf("active list missing hold %s: %+v", hold.ID, active.Data)
	}

	// Re-applying an active hold on the same subject conflicts (idempotency: at
	// most one active hold per subject).
	dup := h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-holds", dto.ApplyLegalHoldRequest{
		SubjectType: model.LegalHoldSubjectContract,
		SubjectID:   contract.ID,
		Reason:      "Duplicate attempt",
	})
	if code := mustErrorCode(t, dup, http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("duplicate apply error code = %s, want LEGAL_HOLD_ACTIVE", code)
	}

	// Release the hold.
	released := mustData[model.LegalHold](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", hold.ID), dto.ReleaseLegalHoldRequest{
		ReleaseNote: "Matter resolved, preservation lifted.",
	}), http.StatusOK)
	if released.Status != model.LegalHoldStatusReleased || released.ReleasedBy == nil || *released.ReleasedBy != h.userID {
		t.Fatalf("released hold = %+v, want released by %s", released, h.userID)
	}
	if released.ReleasedAt == nil {
		t.Fatalf("released hold missing released_at: %+v", released)
	}

	// Releasing again is a conflict (no longer active).
	if code := mustErrorCode(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", hold.ID), dto.ReleaseLegalHoldRequest{}), http.StatusConflict); code == "" {
		t.Fatalf("second release should conflict with a code, got empty")
	}

	// After release the subject can be held again (re-apply succeeds).
	reHold := h.applyHold(t, model.LegalHoldSubjectContract, contract.ID, "CASE-2026-002")
	if reHold.ID == hold.ID || reHold.Status != model.LegalHoldStatusActive {
		t.Fatalf("re-applied hold = %+v, want a new active hold", reHold)
	}

	// Released history is still retrievable via the released filter.
	releasedList := mustPaginated[model.LegalHold](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds?status=released&page=1&per_page=50", nil), http.StatusOK)
	if !containsHold(releasedList.Data, hold.ID) {
		t.Fatalf("released list missing historical hold %s: %+v", hold.ID, releasedList.Data)
	}
}

// TestLegalHoldEnforcementContract proves a held contract cannot be deleted,
// cancelled, or terminated, and that the operation succeeds once released.
func TestLegalHoldEnforcementContract(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Held Contract", model.ContractTypeVendor, 750_000, lifecycleContractText())
	hold := h.applyHold(t, model.LegalHoldSubjectContract, contract.ID, "LIT-2026-77")
	contractApprover := h.contractApprover(t)

	// Delete is refused while under hold.
	if code := mustErrorCode(t, contractApprover.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("delete-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}

	// The contract is still readable (not deleted).
	expectStatus(t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK)

	// A destructive status transition (draft -> cancelled) is refused.
	if code := mustErrorCode(t, contractApprover.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/contracts/%s/status", contract.ID), dto.UpdateContractStatusRequest{
		Status: model.ContractStatusCancelled,
	}), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("cancel-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}

	// Release the hold, then delete must succeed.
	mustData[model.LegalHold](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", hold.ID), dto.ReleaseLegalHoldRequest{
		ReleaseNote: "Cleared for disposal.",
	}), http.StatusOK)

	expectStatus(t, contractApprover.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusNoContent)
	// Now gone.
	expectStatus(t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusNotFound)
}

// TestLegalHoldEnforcementDocumentAndMatter proves enforcement on documents
// (delete + archive) and matters (delete + close).
func TestLegalHoldEnforcementDocumentAndMatter(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)

	// Document: delete + archive refused while held.
	document := h.createDocument(t, "Held Privileged Memo")
	docHold := h.applyHold(t, model.LegalHoldSubjectDocument, document.ID, "DOC-HOLD-1")

	if code := mustErrorCode(t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/documents/%s", document.ID), nil), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("document delete-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}
	archived := model.DocumentStatusArchived
	if code := mustErrorCode(t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/documents/%s", document.ID), dto.UpdateLegalDocumentRequest{
		Status: &archived,
	}), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("document archive-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}

	// Non-destructive update (title) is still allowed under hold.
	newTitle := "Held Privileged Memo (annotated)"
	expectStatus(t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/documents/%s", document.ID), dto.UpdateLegalDocumentRequest{
		Title: &newTitle,
	}), http.StatusOK)

	// Release, then archive succeeds.
	mustData[model.LegalHold](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", docHold.ID), dto.ReleaseLegalHoldRequest{}), http.StatusOK)
	expectStatus(t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/documents/%s", document.ID), dto.UpdateLegalDocumentRequest{
		Status: &archived,
	}), http.StatusOK)

	// Matter: delete + close refused while held.
	matter := h.createMatter(t, "Held Litigation Matter")
	matterHold := h.applyHold(t, model.LegalHoldSubjectMatter, matter.ID, "MAT-HOLD-1")

	if code := mustErrorCode(t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/matters/%s", matter.ID), nil), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("matter delete-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}
	if code := mustErrorCode(t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/matters/%s/status", matter.ID), dto.UpdateMatterStatusRequest{
		Status: model.MatterStatusClosed,
	}), http.StatusConflict); code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("matter close-while-held code = %s, want LEGAL_HOLD_ACTIVE", code)
	}

	mustData[model.LegalHold](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", matterHold.ID), dto.ReleaseLegalHoldRequest{}), http.StatusOK)
	expectStatus(t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/matters/%s", matter.ID), nil), http.StatusNoContent)
}

// TestLegalHoldSubjectMustExist proves a hold cannot be placed on a phantom id.
func TestLegalHoldSubjectMustExist(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	resp := h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-holds", dto.ApplyLegalHoldRequest{
		SubjectType: model.LegalHoldSubjectContract,
		SubjectID:   uuid.New(),
		Reason:      "no such contract",
	})
	expectStatus(t, resp, http.StatusNotFound)

	// Missing reason is a validation error (422 from the service validator).
	contract := h.createContractWithText(t, "Validation Contract", model.ContractTypeNDA, 1000, lifecycleContractText())
	bad := h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-holds", dto.ApplyLegalHoldRequest{
		SubjectType: model.LegalHoldSubjectContract,
		SubjectID:   contract.ID,
	})
	expectStatus(t, bad, http.StatusUnprocessableEntity)
}

// TestLegalHoldTenantIsolation proves holds are tenant-scoped: tenant B cannot
// read tenant A's hold, cannot list it, and cannot release it.
func TestLegalHoldTenantIsolation(t *testing.T) {
	t.Parallel()

	tenantA := newLexHarness(t)
	tenantB := newLexHarness(t)

	contract := tenantA.createContractWithText(t, "Tenant A Held Contract", model.ContractTypeVendor, 250_000, lifecycleContractText())
	hold := tenantA.applyHold(t, model.LegalHoldSubjectContract, contract.ID, "A-CASE-1")

	// Tenant B cannot read it.
	expectStatus(t, tenantB.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-holds/%s", hold.ID), nil), http.StatusNotFound)

	// Tenant B's list does not expose it.
	bList := mustPaginated[model.LegalHold](t, tenantB.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds?page=1&per_page=100", nil), http.StatusOK)
	if containsHold(bList.Data, hold.ID) {
		t.Fatalf("tenant B list exposed tenant A hold %s", hold.ID)
	}

	// Tenant B cannot release it.
	expectStatus(t, tenantB.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", hold.ID), dto.ReleaseLegalHoldRequest{}), http.StatusNotFound)

	// Tenant A still sees its active hold (isolation did not affect the owner).
	aList := mustPaginated[model.LegalHold](t, tenantA.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds?status=active&page=1&per_page=100", nil), http.StatusOK)
	if !containsHold(aList.Data, hold.ID) {
		t.Fatalf("tenant A active list missing own hold %s", hold.ID)
	}
}

// TestLegalHoldPermissionGuards proves apply/release require lex:write and list
// requires lex:read.
func TestLegalHoldPermissionGuards(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Perm Guarded Contract", model.ContractTypeServiceAgreement, 100_000, lifecycleContractText())

	readOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "viewer"))
	noAccess := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "no_lex_access"))

	// Read-only cannot apply.
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, "/api/v1/lex/legal-holds", dto.ApplyLegalHoldRequest{
		SubjectType: model.LegalHoldSubjectContract,
		SubjectID:   contract.ID,
		Reason:      "should be blocked",
	}), http.StatusForbidden)

	// Read-only can list.
	expectStatus(t, readOnly.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds", nil), http.StatusOK)

	// No-access cannot list.
	expectStatus(t, noAccess.doJSON(t, http.MethodGet, "/api/v1/lex/legal-holds", nil), http.StatusForbidden)

	// Writer applies, then read-only cannot release.
	hold := h.applyHold(t, model.LegalHoldSubjectContract, contract.ID, "PERM-1")
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-holds/%s/release", hold.ID), dto.ReleaseLegalHoldRequest{}), http.StatusForbidden)

	// Alias route works too.
	expectStatus(t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/legal-holds", nil), http.StatusOK)
}

func containsHold(holds []model.LegalHold, id uuid.UUID) bool {
	for _, hold := range holds {
		if hold.ID == id {
			return true
		}
	}
	return false
}

// mustErrorCode asserts the response status and returns the error code from the
// suiteapi flat error envelope ({"code":...,"message":...}).
func mustErrorCode(t *testing.T, resp *http.Response, wantStatus int) string {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("response status = %d, want %d, body=%s", resp.StatusCode, wantStatus, readBody(t, resp.Body))
	}
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	decodeBody(t, resp.Body, &payload)
	return payload.Code
}
