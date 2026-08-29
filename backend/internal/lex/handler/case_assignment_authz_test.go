package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func serveCaseAssignmentRoute(path string, roles []string) (status int, handlerRan bool) {
	r := chi.NewRouter()
	gated := r.With(sharedmw.RequirePermission(auth.PermLexCaseAssign))
	handler := func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	}
	gated.Post("/legal-cases/{id}/intake/handoff", handler)
	gated.Post("/legal-cases/{id}/assign-officer", handler)

	req := httptest.NewRequest(http.MethodPost, path, nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       uuid.NewString(),
		TenantID: uuid.NewString(),
		Roles:    roles,
	}))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code, handlerRan
}

func TestCasePhase2HandoffRequiresAssignmentPermission(t *testing.T) {
	path := "/legal-cases/" + uuid.NewString() + "/intake/handoff"
	if status, ran := serveCaseAssignmentRoute(path, []string{"legal-officer"}); status != http.StatusForbidden || ran {
		t.Fatalf("legal-officer handoff = status %d handlerRan=%v, want 403/false", status, ran)
	}
	for _, role := range []string{"legal-cases-manager", "legal-director"} {
		if status, ran := serveCaseAssignmentRoute(path, []string{role}); status != http.StatusOK || !ran {
			t.Errorf("%s handoff = status %d handlerRan=%v, want 200/true", role, status, ran)
		}
	}
	if status, ran := serveCaseAssignmentRoute(path, []string{"tenant_admin"}); status != http.StatusForbidden || ran {
		t.Errorf("tenant_admin handoff = status %d handlerRan=%v, want 403/false", status, ran)
	}
}

func TestOfficerAssignmentUsesSameRestrictedGate(t *testing.T) {
	path := "/legal-cases/" + uuid.NewString() + "/assign-officer"
	if status, ran := serveCaseAssignmentRoute(path, []string{"legal-officer"}); status != http.StatusForbidden || ran {
		t.Fatalf("legal-officer assignment = status %d handlerRan=%v, want 403/false", status, ran)
	}
	if status, ran := serveCaseAssignmentRoute(path, []string{"legal-director"}); status != http.StatusOK || !ran {
		t.Fatalf("legal-director assignment = status %d handlerRan=%v, want 200/true", status, ran)
	}
}
