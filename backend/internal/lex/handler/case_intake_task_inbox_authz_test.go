package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func serveCaseIntakeInboxGate(roles []string) (status int, handlerRan bool) {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	})
	h := sharedmw.RequirePermission(auth.PermLexCaseApprove)(final)
	req := httptest.NewRequest(http.MethodGet, "/legal-cases/intake/tasks", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000b",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, handlerRan
}

func TestCaseIntakeTaskInboxRequiresCaseApprovalPermission(t *testing.T) {
	for _, role := range []string{"legal-officer", "legal-advisor", "legal-requester"} {
		if status, ran := serveCaseIntakeInboxGate([]string{role}); status != http.StatusForbidden || ran {
			t.Errorf("%s inbox = status %d handlerRan=%v, want 403/false", role, status, ran)
		}
	}
	for _, role := range []string{"legal-cases-manager", "legal-director", "super-admin"} {
		if status, ran := serveCaseIntakeInboxGate([]string{role}); status != http.StatusOK || !ran {
			t.Errorf("%s inbox = status %d handlerRan=%v, want 200/true", role, status, ran)
		}
	}
	if status, ran := serveCaseIntakeInboxGate([]string{"tenant_admin"}); status != http.StatusForbidden || ran {
		t.Errorf("tenant_admin inbox = status %d handlerRan=%v, want 403/false", status, ran)
	}
}
