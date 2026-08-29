package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func serveContractDeliveryAchievement(roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	gate := sharedmw.RequirePermission(auth.PermLexContractEdit)
	req := httptest.NewRequest(http.MethodPost, "/requests/request/execution/delivery-confirmation/confirmation/achieve", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000a",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	gate(final).ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

func TestContractDeliveryAchievementRequiresContractEditor(t *testing.T) {
	for _, role := range []string{
		"legal-advisor",
		"legal-contracts-supervisor",
		"legal-contracts-manager",
		"legal-director",
		"super_admin",
	} {
		if got := serveContractDeliveryAchievement([]string{role}); got != http.StatusOK {
			t.Errorf("%s achievement gate: got %d, want 200", role, got)
		}
	}

	for _, role := range []string{
		"legal-requester",
		"legal-officer",
		"legal-auditor",
		"tenant_admin",
	} {
		if got := serveContractDeliveryAchievement([]string{role}); got != http.StatusForbidden {
			t.Errorf("%s achievement gate: got %d, want 403", role, got)
		}
	}
}
