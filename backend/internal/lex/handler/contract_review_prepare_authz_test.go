package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func serveContractReviewPrepare(roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	gate := sharedmw.RequireAnyPermission(
		auth.PermLexContractAdd,
		auth.PermLexContractEdit,
		auth.PermLexWrite,
	)
	req := httptest.NewRequest(http.MethodPost, "/contracts/00000000-0000-0000-0000-000000000001/review-desk/attachments", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000a",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	gate(final).ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

func TestContractReviewPrepareGate_AllowsCreatorAndEditorCapabilities(t *testing.T) {
	for _, roles := range [][]string{
		{"legal-requester"},
		{"legal-contracts-manager"},
		{"tenant_admin"},
	} {
		if got := serveContractReviewPrepare(roles); got != http.StatusOK {
			t.Fatalf("prepare gate for roles %v: got %d, want 200", roles, got)
		}
	}
	if got := serveContractReviewPrepare([]string{"legal-auditor"}); got != http.StatusForbidden {
		t.Fatalf("read-only prepare gate: got %d, want 403", got)
	}
}
