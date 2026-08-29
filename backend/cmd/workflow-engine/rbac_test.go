package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
)

// okHandler is the protected handler the classifier guards; reaching it means
// authorization passed.
func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// withRoles attaches a context user carrying the given roles, mirroring what
// middleware.Auth populates from JWT claims.
func withRoles(req *http.Request, roles ...string) *http.Request {
	return req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID: "u1", TenantID: "t1", Roles: roles,
	}))
}

// serve runs the classifier in front of okHandler and returns the status code.
func serve(t *testing.T, classifier func(http.Handler) http.Handler, method, path string, roles ...string) int {
	t.Helper()
	req := withRoles(httptest.NewRequest(method, path, nil), roles...)
	rec := httptest.NewRecorder()
	classifier(okHandler()).ServeHTTP(rec, req)
	return rec.Code
}

// TestWorkflowRBACClassifiers asserts the per-action permission each route
// requires, exercising the real classifiers against the real auth.HasPermission
// role logic. viewer holds workflow:read; analyst adds workflow:task;
// tenant_admin holds all workflow verbs; super-admin matches everything via
// admin:*. custom-role has NO code-map entry (auth.HasPermission skips unknown
// role slugs → zero permissions), standing in for tenant-created custom roles:
// it must reach every authenticated-baseline route (core reads + assignee task
// actions) and be 403'd everywhere a workflow:* grant is required.
func TestWorkflowRBACClassifiers(t *testing.T) {
	type wrap = func(http.Handler) http.Handler

	cases := []struct {
		name       string
		classifier wrap
		method     string
		path       string
		// allowed roles must each reach the handler (200); blocked roles must
		// each be rejected (403).
		allowed []string
		blocked []string
	}{
		// definitions — GET is authenticated-baseline
		{"def list baseline", definitionRBAC, http.MethodGet, "/api/v1/workflows/definitions/", []string{"custom-role", "viewer", "tenant_admin", "super-admin"}, nil},
		{"def create write", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def clone write", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/abc/clone", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def update write", definitionRBAC, http.MethodPut, "/api/v1/workflows/definitions/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def activate admin", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/abc/activate", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def publish admin", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/abc/publish", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def archive admin", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/abc/archive", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"def delete admin", definitionRBAC, http.MethodDelete, "/api/v1/workflows/definitions/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// instances — GET is authenticated-baseline
		{"inst list baseline", instanceRBAC, http.MethodGet, "/api/v1/workflows/instances/", []string{"custom-role", "viewer", "tenant_admin", "super-admin"}, nil},
		{"inst start write", instanceRBAC, http.MethodPost, "/api/v1/workflows/instances/", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"inst cancel write", instanceRBAC, http.MethodPost, "/api/v1/workflows/instances/abc/cancel", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"inst delete admin", instanceRBAC, http.MethodDelete, "/api/v1/workflows/instances/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// in-flight instance migration (migrationRBAC): every POST -> workflow:admin
		{"migrate instance admin", migrationRBAC, http.MethodPost, "/api/v1/workflows/migrations/instances/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"migrate bulk admin", migrationRBAC, http.MethodPost, "/api/v1/workflows/migrations/bulk", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// tasks — GET (incl. /tasks/count badge) is authenticated-baseline;
		// claim/unclaim/complete require workflow:task (role-routed tasks skip
		// service-side eligibility checks, so the grant is the enforced gate);
		// delegate/assign/reject/comment stay workflow:write
		{"task list baseline", taskRBAC, http.MethodGet, "/api/v1/workflows/tasks/", []string{"custom-role", "viewer", "analyst", "tenant_admin", "super-admin"}, nil},
		{"task count baseline", taskRBAC, http.MethodGet, "/api/v1/workflows/tasks/count", []string{"custom-role", "viewer", "analyst", "tenant_admin", "super-admin"}, nil},
		{"task claim task-perm", taskRBAC, http.MethodPost, "/api/v1/workflows/tasks/abc/claim", []string{"analyst", "tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"task unclaim task-perm", taskRBAC, http.MethodPost, "/api/v1/workflows/tasks/abc/unclaim", []string{"analyst", "tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"task complete task-perm", taskRBAC, http.MethodPost, "/api/v1/workflows/tasks/abc/complete", []string{"analyst", "tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"task delegate write", taskRBAC, http.MethodPost, "/api/v1/workflows/tasks/abc/delegate", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// templates — GET is authenticated-baseline
		{"tmpl list baseline", templateRBAC, http.MethodGet, "/api/v1/workflows/templates/", []string{"custom-role", "viewer", "tenant_admin", "super-admin"}, nil},
		{"tmpl instantiate write", templateRBAC, http.MethodPost, "/api/v1/workflows/templates/abc/instantiate", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// trigger-executions — unchanged: GET stays workflow:read
		{"trig list read", triggerExecutionRBAC, http.MethodGet, "/api/v1/workflows/trigger-executions/", []string{"viewer", "tenant_admin", "super-admin"}, []string{"custom-role"}},
		{"trig replay write", triggerExecutionRBAC, http.MethodPost, "/api/v1/workflows/trigger-executions/abc/replay", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// WP-5 SLA policies + calendars (slaRBAC): unchanged — GET -> workflow:read, POST/PUT/DELETE -> workflow:write
		{"sla-policies list read", slaRBAC, http.MethodGet, "/api/v1/workflows/sla-policies/", []string{"viewer", "tenant_admin", "super-admin"}, []string{"custom-role"}},
		{"sla-policies create write", slaRBAC, http.MethodPost, "/api/v1/workflows/sla-policies/", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"calendars list read", slaRBAC, http.MethodGet, "/api/v1/workflows/calendars/", []string{"viewer", "tenant_admin", "super-admin"}, []string{"custom-role"}},
		{"calendars update write", slaRBAC, http.MethodPut, "/api/v1/workflows/calendars/default", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},

		// WP-3 workflow forms: unchanged — GET -> workflow:read, POST/PUT/DELETE -> workflow:write
		{"forms list read", formsRBAC, http.MethodGet, "/api/v1/workflows/forms/", []string{"viewer", "tenant_admin", "super-admin"}, []string{"custom-role"}},
		{"forms create write", formsRBAC, http.MethodPost, "/api/v1/workflows/forms/", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"forms update write", formsRBAC, http.MethodPut, "/api/v1/workflows/forms/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
		{"forms delete write", formsRBAC, http.MethodDelete, "/api/v1/workflows/forms/abc", []string{"tenant_admin", "super-admin"}, []string{"viewer", "custom-role"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, role := range tc.allowed {
				if code := serve(t, tc.classifier, tc.method, tc.path, role); code != http.StatusOK {
					t.Errorf("role %q on %s %s: got %d, want 200", role, tc.method, tc.path, code)
				}
			}
			for _, role := range tc.blocked {
				if code := serve(t, tc.classifier, tc.method, tc.path, role); code != http.StatusForbidden {
					t.Errorf("role %q on %s %s: got %d, want 403", role, tc.method, tc.path, code)
				}
			}
		})
	}
}

// TestWorkflowRBACRejectsUnauthenticated proves every gate — including the
// authenticated-baseline requireAuthenticated routes — rejects a request with
// no context user (no Auth middleware ran) rather than falling through.
func TestWorkflowRBACRejectsUnauthenticated(t *testing.T) {
	cases := []struct {
		name       string
		classifier func(http.Handler) http.Handler
		method     string
		path       string
	}{
		{"definition read", definitionRBAC, http.MethodGet, "/api/v1/workflows/definitions/"},
		{"definition create", definitionRBAC, http.MethodPost, "/api/v1/workflows/definitions/"},
		{"task inbox read", taskRBAC, http.MethodGet, "/api/v1/workflows/tasks/"},
		{"task count read", taskRBAC, http.MethodGet, "/api/v1/workflows/tasks/count"},
		{"task claim", taskRBAC, http.MethodPost, "/api/v1/workflows/tasks/abc/claim"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			tc.classifier(okHandler()).ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated %s %s: got %d, want 401", tc.method, tc.path, rec.Code)
			}
		})
	}
}
