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

// serveIntegrationRegistryRoute mirrors the integration-registry tier wiring in
// registerLexHandlers: reads gate on ANY(lex:integration:read, lex:read) and
// mutations on ANY(lex:integration:manage, lex:write) — the SAME granular tiers
// as the rest of the connector framework, NOT the coarse cross-cutting
// lex:view/lex:add/lex:edit/lex:close tiers.
func serveIntegrationRegistryRoute(method, path string, roles []string) (status int, handlerRan bool) {
	r := chi.NewRouter()
	integrationRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexIntegrationRead, auth.PermLexRead))
	integrationManage := r.With(sharedmw.RequireAnyPermission(auth.PermLexIntegrationManage, auth.PermLexWrite))
	handler := func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	}
	integrationRead.Get("/integrations", handler)
	integrationRead.Get("/integrations/{id}", handler)
	integrationManage.Post("/integrations", handler)
	integrationManage.Put("/integrations/{id}", handler)
	integrationManage.Delete("/integrations/{id}", handler)

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

// The config-only System Administrator (§13) holds lex:integration:manage but
// NO coarse lex:read / lex:write / lex:view. It is the persona designated to
// operate connectors, so every registry verb must pass: manage grants the
// mutations directly and expands to lex:integration:read for the reads
// (expandGrants: manage on a config domain implies its lower verbs). This is a
// regression lock — the bare CRUD used to sit on the crossRead/crossAdd/
// crossEdit/crossClose tiers, where the System Administrator could rotate a
// connector's secrets yet was 403'd from listing, creating, updating, or
// deleting connectors.
func TestIntegrationRegistryCRUDAllowsConfigOnlySystemAdmin(t *testing.T) {
	id := uuid.NewString()
	cases := []struct{ method, path string }{
		{http.MethodGet, "/integrations"},
		{http.MethodGet, "/integrations/" + id},
		{http.MethodPost, "/integrations"},
		{http.MethodPut, "/integrations/" + id},
		{http.MethodDelete, "/integrations/" + id},
	}
	for _, tc := range cases {
		if status, ran := serveIntegrationRegistryRoute(tc.method, tc.path, []string{"legal-system-admin"}); status != http.StatusOK || !ran {
			t.Errorf("legal-system-admin %s %s = status %d handlerRan=%v, want 200/true", tc.method, tc.path, status, ran)
		}
	}
}

// The Auditor holds lex:integration:read (reads pass) but neither
// lex:integration:manage nor lex:write — every mutation must stay 403.
func TestIntegrationRegistryMutationsDenyReadOnlyAuditor(t *testing.T) {
	id := uuid.NewString()
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/integrations"},
		{http.MethodGet, "/integrations/" + id},
	} {
		if status, ran := serveIntegrationRegistryRoute(tc.method, tc.path, []string{"legal-auditor"}); status != http.StatusOK || !ran {
			t.Errorf("legal-auditor %s %s = status %d handlerRan=%v, want 200/true", tc.method, tc.path, status, ran)
		}
	}
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/integrations"},
		{http.MethodPut, "/integrations/" + id},
		{http.MethodDelete, "/integrations/" + id},
	} {
		if status, ran := serveIntegrationRegistryRoute(tc.method, tc.path, []string{"legal-auditor"}); status != http.StatusForbidden || ran {
			t.Errorf("legal-auditor %s %s = status %d handlerRan=%v, want 403/false", tc.method, tc.path, status, ran)
		}
	}
}
