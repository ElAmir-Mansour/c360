package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
)

// withUser returns a request carrying an authenticated user with the given role
// slugs and tenant in context, exactly as the Auth middleware would have set it.
func withUser(method, target, tenant string, roles ...string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader("{}"))
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "user-1",
		TenantID: tenant,
		Email:    "u@example.com",
		Roles:    roles,
	})
	ctx = auth.WithTenantID(ctx, tenant)
	return req.WithContext(ctx)
}

// TestRequireNotificationsManage is the table-driven test for the handler-level
// defense-in-depth check guarding the notification control plane.
func TestRequireNotificationsManage(t *testing.T) {
	tests := []struct {
		name      string
		roles     []string
		authed    bool
		wantAllow bool
	}{
		{name: "tenant_admin allowed", roles: []string{"tenant_admin"}, authed: true, wantAllow: true},
		{name: "super_admin allowed via admin:*", roles: []string{"super_admin"}, authed: true, wantAllow: true},
		{name: "analyst denied", roles: []string{"analyst"}, authed: true, wantAllow: false},
		{name: "no roles denied", roles: []string{}, authed: true, wantAllow: false},
		{name: "unauthenticated denied", authed: false, wantAllow: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/test", nil)
			if tt.authed {
				ctx := auth.WithUser(req.Context(), &auth.ContextUser{ID: "u1", Roles: tt.roles})
				req = req.WithContext(ctx)
			}
			rec := httptest.NewRecorder()

			allowed := requireNotificationsManage(rec, req)

			if allowed != tt.wantAllow {
				t.Fatalf("requireNotificationsManage = %v, want %v", allowed, tt.wantAllow)
			}
			if !tt.wantAllow && rec.Code != http.StatusForbidden {
				t.Fatalf("expected 403 on deny, got %d", rec.Code)
			}
			if tt.wantAllow && rec.Code != http.StatusOK {
				t.Fatalf("expected the recorder untouched (200) on allow, got %d", rec.Code)
			}
		})
	}
}

// TestAdminHandler_AuthzGating asserts the AdminHandler control-plane endpoints
// fail closed for a caller lacking notifications:manage (the deps are nil,
// proving the 403 short-circuits before any service/repo access).
func TestAdminHandler_AuthzGating(t *testing.T) {
	h := NewAdminHandler(nil, nil, nil, zerolog.Nop())

	cases := []struct {
		name    string
		call    func(http.ResponseWriter, *http.Request)
		roles   []string
		tenant  string
		wantErr int
	}{
		{name: "SendTest denied for analyst", call: h.SendTestNotification, roles: []string{"analyst"}, tenant: "t1", wantErr: http.StatusForbidden},
		{name: "DeliveryStats denied for analyst", call: h.GetDeliveryStats, roles: []string{"analyst"}, tenant: "t1", wantErr: http.StatusForbidden},
		{name: "RetryFailed denied for analyst", call: h.RetryFailed, roles: []string{"analyst"}, tenant: "t1", wantErr: http.StatusForbidden},
		// Passes the manage gate but has no resolvable tenant → 403 tenant required,
		// still short-circuiting before the (nil) dispatcher/repo.
		{name: "RetryFailed requires tenant", call: h.RetryFailed, roles: []string{"tenant_admin"}, tenant: "", wantErr: http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := withUser(http.MethodPost, "/api/v1/notifications/x", tc.tenant, tc.roles...)
			rec := httptest.NewRecorder()
			tc.call(rec, req)
			if rec.Code != tc.wantErr {
				t.Fatalf("expected %d, got %d (body=%s)", tc.wantErr, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestRoute_RequirePermissionGate asserts the router-level RBAC middleware that
// guards the notification control-plane routes returns 403 for a caller without
// notifications:manage and passes an authorized caller through to the handler.
func TestRoute_RequirePermissionGate(t *testing.T) {
	r := chi.NewRouter()
	r.With(middleware.RequirePermission(auth.PermNotificationsManage)).
		Get("/api/v1/notifications/delivery-stats", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		})

	// Authorized.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, withUser(http.MethodGet, "/api/v1/notifications/delivery-stats", "t1", "tenant_admin"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for tenant_admin, got %d", rec.Code)
	}

	// Forbidden.
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, withUser(http.MethodGet, "/api/v1/notifications/delivery-stats", "t1", "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for analyst, got %d", rec.Code)
	}
}
