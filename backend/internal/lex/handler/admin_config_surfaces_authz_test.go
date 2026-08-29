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

// serveAdminConfigSurfaceRoute mirrors the permission-tier wiring in
// registerLexHandlers for the four System-Administrator admin-config surfaces
// (F7 working calendars, F8 org & entity registry, F9 case classifications,
// F10 attachment policies). It replicates ONLY the RBAC tier — not the org-RBAC
// recipient gate, which is a transparent pass-through with no OrgRoleResolver —
// so it isolates the slug/tier logic these findings are about.
//
// The tier definitions here are kept byte-for-byte identical to routes.go:
//   - working-calendars: read = ANY(catalog:view, lex:read);
//     write = ANY(catalog:manage, lex:write)                       (F7)
//   - org-entities:      read = ANY(security:view, lex:read);
//     write = ANY(security:manage, lex:write)                      (F8)
//   - case-classifications: read = ANY(catalog:view, lex:read);
//     write = catalog:manage ONLY, NO coarse fallback             (F9)
//   - attachment-policies: read = ANY(catalog:view, lex:view, lex:read);
//     add/edit/close = ANY(catalog:manage, lex:<verb>, lex:write) (F10)
func serveAdminConfigSurfaceRoute(method, path string, roles []string) (status int, handlerRan bool) {
	r := chi.NewRouter()

	catalogView := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogView, auth.PermLexRead))
	calendarWrite := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexWrite))
	catalogManage := r.With(sharedmw.RequirePermission(auth.PermLexCatalogManage)) // F9: NO coarse fallback.
	securityView := r.With(sharedmw.RequireAnyPermission(auth.PermLexSecurityView, auth.PermLexRead))
	securityManage := r.With(sharedmw.RequireAnyPermission(auth.PermLexSecurityManage, auth.PermLexWrite))
	apRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogView, auth.PermLexView, auth.PermLexRead))
	apAdd := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexAdd, auth.PermLexWrite))
	apEdit := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexEdit, auth.PermLexWrite))
	apClose := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexClose, auth.PermLexWrite))

	handler := func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	}

	// F7 working calendars.
	catalogView.Get("/working-calendars", handler)
	catalogView.Get("/working-calendars/{id}", handler)
	calendarWrite.Post("/working-calendars", handler)
	calendarWrite.Put("/working-calendars/{id}", handler)
	calendarWrite.Delete("/working-calendars/{id}", handler)
	// F8 org & entity registry.
	securityView.Get("/org-entities", handler)
	securityView.Get("/org-entities/{id}", handler)
	securityManage.Post("/org-entities", handler)
	securityManage.Put("/org-entities/{id}", handler)
	securityManage.Delete("/org-entities/{id}", handler)
	// F9 case classifications.
	catalogView.Get("/case-classifications", handler)
	catalogView.Get("/case-classifications/{id}", handler)
	catalogManage.Post("/case-classifications", handler)
	catalogManage.Put("/case-classifications/{id}", handler)
	catalogManage.Delete("/case-classifications/{id}", handler)
	// F10 attachment policies.
	apRead.Get("/attachment-policies", handler)
	apRead.Post("/attachment-policies/evaluate", handler)
	apRead.Get("/attachment-policies/{id}", handler)
	apAdd.Post("/attachment-policies", handler)
	apEdit.Put("/attachment-policies/{id}", handler)
	apClose.Delete("/attachment-policies/{id}", handler)

	req := httptest.NewRequest(method, path, nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       uuid.NewString(),
		TenantID: uuid.NewString(),
		Roles:    roles,
	}))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code, handlerRan
}

// The config-only System Administrator (legal-system-admin, §13) holds
// lex:catalog:manage + lex:security:manage but NO coarse lex:read / lex:write /
// lex:view / lex:add / lex:edit / lex:close. It is the persona designated to own
// all four admin-config surfaces, so EVERY read AND write must pass:
//   - manage grants the writes directly;
//   - manage on a config domain expands to :view (expandGrants), so the reads
//     pass via catalog:view / security:view without any coarse key.
//
// This is the regression lock for F7/F8/F9/F10 — before the fix the reads sat on
// coarse lex:read and the writes on coarse lex:write / lex:add / lex:close, none
// of which the System Administrator holds, so it was 403'd from every surface it
// is designed to configure.
func TestAdminConfigSurfacesAllowConfigOnlySystemAdmin(t *testing.T) {
	id := uuid.NewString()
	cases := []struct{ method, path string }{
		// F7 working calendars.
		{http.MethodGet, "/working-calendars"},
		{http.MethodGet, "/working-calendars/" + id},
		{http.MethodPost, "/working-calendars"},
		{http.MethodPut, "/working-calendars/" + id},
		{http.MethodDelete, "/working-calendars/" + id},
		// F8 org & entity registry.
		{http.MethodGet, "/org-entities"},
		{http.MethodGet, "/org-entities/" + id},
		{http.MethodPost, "/org-entities"},
		{http.MethodPut, "/org-entities/" + id},
		{http.MethodDelete, "/org-entities/" + id},
		// F9 case classifications.
		{http.MethodGet, "/case-classifications"},
		{http.MethodGet, "/case-classifications/" + id},
		{http.MethodPost, "/case-classifications"},
		{http.MethodPut, "/case-classifications/" + id},
		{http.MethodDelete, "/case-classifications/" + id},
		// F10 attachment policies.
		{http.MethodGet, "/attachment-policies"},
		{http.MethodPost, "/attachment-policies/evaluate"},
		{http.MethodGet, "/attachment-policies/" + id},
		{http.MethodPost, "/attachment-policies"},
		{http.MethodPut, "/attachment-policies/" + id},
		{http.MethodDelete, "/attachment-policies/" + id},
	}
	for _, tc := range cases {
		if status, ran := serveAdminConfigSurfaceRoute(tc.method, tc.path, []string{"legal-system-admin"}); status != http.StatusOK || !ran {
			t.Errorf("legal-system-admin %s %s = status %d handlerRan=%v, want 200/true", tc.method, tc.path, status, ran)
		}
	}
}

// F9 direction-(b) server-side authz hole closure: a role that holds coarse
// lex:write but NOT lex:catalog:manage (legal-officer, and by extension the
// cases/contracts managers, supervisors, advisor) must be DENIED every
// case-classification MUTATION now that the write tier is catalog:manage with NO
// coarse fallback — the UI is no longer the only guard. Reads still pass via the
// coarse lex:read fallback on catalogView.
func TestCaseClassificationWritesDenyCoarseWriteWithoutCatalogManage(t *testing.T) {
	id := uuid.NewString()
	// Reads pass (lex:read fallback on catalogView).
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/case-classifications"},
		{http.MethodGet, "/case-classifications/" + id},
	} {
		if status, ran := serveAdminConfigSurfaceRoute(tc.method, tc.path, []string{"legal-officer"}); status != http.StatusOK || !ran {
			t.Errorf("legal-officer %s %s = status %d handlerRan=%v, want 200/true", tc.method, tc.path, status, ran)
		}
	}
	// Mutations are denied — catalog:manage has no coarse lex:write fallback.
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/case-classifications"},
		{http.MethodPut, "/case-classifications/" + id},
		{http.MethodDelete, "/case-classifications/" + id},
	} {
		if status, ran := serveAdminConfigSurfaceRoute(tc.method, tc.path, []string{"legal-officer"}); status != http.StatusForbidden || ran {
			t.Errorf("legal-officer %s %s = status %d handlerRan=%v, want 403/false", tc.method, tc.path, status, ran)
		}
	}
}

// The read-only Auditor (legal-auditor) holds coarse lex:read (+ catalog:view /
// security:view) but neither any :manage verb nor coarse lex:write — so every
// read across the four surfaces must pass and every write must stay 403. This
// proves the fixes are additive (the 13 coarse-read roles keep read access) and
// did not accidentally widen any write tier to plain readers.
func TestAdminConfigSurfacesReadOnlyAuditor(t *testing.T) {
	id := uuid.NewString()
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/working-calendars"},
		{http.MethodGet, "/org-entities"},
		{http.MethodGet, "/case-classifications"},
		{http.MethodGet, "/attachment-policies"},
		{http.MethodGet, "/attachment-policies/" + id},
	} {
		if status, ran := serveAdminConfigSurfaceRoute(tc.method, tc.path, []string{"legal-auditor"}); status != http.StatusOK || !ran {
			t.Errorf("legal-auditor %s %s = status %d handlerRan=%v, want 200/true", tc.method, tc.path, status, ran)
		}
	}
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/working-calendars"},
		{http.MethodPost, "/org-entities"},
		{http.MethodPost, "/case-classifications"},
		{http.MethodPost, "/attachment-policies"},
		{http.MethodPut, "/attachment-policies/" + id},
		{http.MethodDelete, "/attachment-policies/" + id},
	} {
		if status, ran := serveAdminConfigSurfaceRoute(tc.method, tc.path, []string{"legal-auditor"}); status != http.StatusForbidden || ran {
			t.Errorf("legal-auditor %s %s = status %d handlerRan=%v, want 403/false", tc.method, tc.path, status, ran)
		}
	}
}
