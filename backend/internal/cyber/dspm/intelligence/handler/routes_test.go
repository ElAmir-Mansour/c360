package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
)

// TestFinancialRunRoute_RequiresCyberWrite verifies that POST /dspm/financial/run
// is registered and gated behind cyber:write: a user without the permission is
// rejected with 403 before the handler (and its service/DB) is ever reached.
func TestFinancialRunRoute_RequiresCyberWrite(t *testing.T) {
	r := chi.NewRouter()
	// Handler with a nil service is fine: the gate rejects the request before the
	// handler body runs, so the service is never dereferenced.
	RegisterRoutes(r, &IntelligenceHandler{})

	req := httptest.NewRequest(http.MethodPost, "/dspm/financial/run", nil)
	// Authenticated user WITHOUT cyber:write.
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "11111111-1111-1111-1111-111111111111",
		TenantID: "22222222-2222-2222-2222-222222222222",
		Roles:    []string{},
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for user lacking cyber:write, got %d", rec.Code)
	}
}

// TestFinancialRunRoute_MethodGuard verifies the path only accepts POST.
func TestFinancialRunRoute_MethodGuard(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, &IntelligenceHandler{})

	req := httptest.NewRequest(http.MethodDelete, "/dspm/financial/run", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for non-POST on /dspm/financial/run, got %d", rec.Code)
	}
}
