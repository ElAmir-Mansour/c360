package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func serveContractReviewStart(roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	gate := sharedmw.RequireAnyPermission(
		auth.PermLexContractAdd,
		auth.PermLexContractEdit,
		auth.PermLexWrite,
	)
	req := httptest.NewRequest(http.MethodPost, "/contracts/00000000-0000-0000-0000-000000000001/review", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000a",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	gate(final).ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

func TestContractReviewStartGate_AllowsCreatorCapabilityWithoutApproval(t *testing.T) {
	roles := []string{"legal-requester"}
	if got := serveContractReviewStart(roles); got != http.StatusOK {
		t.Fatalf("legal-requester review submission gate: got %d, want 200", got)
	}
	if auth.HasPermission(roles, auth.PermLexContractApprove) {
		t.Fatal("legal-requester unexpectedly has contract approval permission")
	}
	if got := serveContractReviewStart([]string{"legal-auditor"}); got != http.StatusForbidden {
		t.Fatalf("read-only legal-auditor review submission gate: got %d, want 403", got)
	}
}

func TestCanStartContractReview_AddOnlyRequesterMustOwnDraft(t *testing.T) {
	actorID := uuid.MustParse("44444444-0000-0000-0000-00000000000a")
	otherID := uuid.MustParse("44444444-0000-0000-0000-00000000000b")
	requesterRoles := []string{"legal-requester"}

	ownedDraft := &model.Contract{CreatedBy: actorID, Status: model.ContractStatusDraft}
	if !canStartContractReview(context.Background(), requesterRoles, actorID, ownedDraft) {
		t.Fatal("add-only requester should be able to submit their own draft")
	}

	otherDraft := &model.Contract{CreatedBy: otherID, Status: model.ContractStatusDraft}
	if canStartContractReview(context.Background(), requesterRoles, actorID, otherDraft) {
		t.Fatal("add-only requester must not submit another user's draft")
	}

	ownedReview := &model.Contract{CreatedBy: actorID, Status: model.ContractStatusInternalReview}
	if canStartContractReview(context.Background(), requesterRoles, actorID, ownedReview) {
		t.Fatal("add-only requester must not re-submit a contract that has left draft")
	}

	if canStartContractReview(context.Background(), requesterRoles, actorID, nil) {
		t.Fatal("add-only requester must not pass without a contract record")
	}
}

func TestCanStartContractReview_EditorsRetainExistingAccess(t *testing.T) {
	actorID := uuid.MustParse("44444444-0000-0000-0000-00000000000a")
	otherID := uuid.MustParse("44444444-0000-0000-0000-00000000000b")
	otherContract := &model.Contract{CreatedBy: otherID, Status: model.ContractStatusInternalReview}

	if !canStartContractReview(context.Background(), []string{"legal-contracts-manager"}, actorID, otherContract) {
		t.Fatal("contract editor should retain existing cross-record review-submission access")
	}
	if !canStartContractReview(context.Background(), []string{"tenant_admin"}, actorID, otherContract) {
		t.Fatal("coarse lex:write compatibility role should retain existing access")
	}
}
