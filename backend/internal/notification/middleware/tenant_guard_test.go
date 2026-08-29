package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
)

// captureTenant is a downstream handler that records the tenant the guard placed
// in context and answers 200 so tests can distinguish "passed through" from the
// guard's own error responses.
func captureTenant(dst *string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*dst = auth.TenantFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})
}

func TestTenantGuard(t *testing.T) {
	tests := []struct {
		name          string
		user          *auth.ContextUser
		queryTenant   string
		wantStatus    int
		wantPassed    bool
		wantCtxTenant string
	}{
		{
			name:       "unauthenticated is rejected",
			user:       nil,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "missing tenant is rejected",
			user:       &auth.ContextUser{ID: "u1", TenantID: "", Roles: []string{"analyst"}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:          "normal user is scoped to its own tenant",
			user:          &auth.ContextUser{ID: "u1", TenantID: "tenant-a", Roles: []string{"analyst"}},
			wantStatus:    http.StatusOK,
			wantPassed:    true,
			wantCtxTenant: "tenant-a",
		},
		{
			name:          "normal user cannot override tenant via query",
			user:          &auth.ContextUser{ID: "u1", TenantID: "tenant-a", Roles: []string{"analyst"}},
			queryTenant:   "tenant-b",
			wantStatus:    http.StatusOK,
			wantPassed:    true,
			wantCtxTenant: "tenant-a", // override ignored for non-super-admin
		},
		{
			name:          "super admin may override tenant via query",
			user:          &auth.ContextUser{ID: "root", TenantID: "tenant-a", Roles: []string{"super_admin"}},
			queryTenant:   "tenant-b",
			wantStatus:    http.StatusOK,
			wantPassed:    true,
			wantCtxTenant: "tenant-b",
		},
		{
			name:          "super admin without override keeps own tenant",
			user:          &auth.ContextUser{ID: "root", TenantID: "tenant-a", Roles: []string{"super_admin"}},
			wantStatus:    http.StatusOK,
			wantPassed:    true,
			wantCtxTenant: "tenant-a",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotTenant string
			passed := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				passed = true
				captureTenant(&gotTenant).ServeHTTP(w, r)
			})

			target := "/api/v1/notifications"
			if tt.queryTenant != "" {
				target += "?tenant_id=" + tt.queryTenant
			}
			req := httptest.NewRequest(http.MethodGet, target, nil)
			if tt.user != nil {
				req = req.WithContext(auth.WithUser(req.Context(), tt.user))
			}
			rec := httptest.NewRecorder()

			TenantGuard(next).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if passed != tt.wantPassed {
				t.Fatalf("passed downstream = %v, want %v", passed, tt.wantPassed)
			}
			if tt.wantPassed && gotTenant != tt.wantCtxTenant {
				t.Fatalf("downstream tenant = %q, want %q", gotTenant, tt.wantCtxTenant)
			}
		})
	}
}
