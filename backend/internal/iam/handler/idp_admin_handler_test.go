package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
	"github.com/clario360/platform/internal/iam/service"
)

// fakeIdPAdminRepo is an in-memory repository.IdPConnectionAdminRepository for
// handler/service tests (no DB/Redis). Keyed on tenant+provider.
type fakeIdPAdminRepo struct {
	conns map[string]*model.IdPConnection
}

func newFakeIdPAdminRepo() *fakeIdPAdminRepo {
	return &fakeIdPAdminRepo{conns: map[string]*model.IdPConnection{}}
}

func (f *fakeIdPAdminRepo) key(tenantID, provider string) string { return tenantID + "|" + provider }

func (f *fakeIdPAdminRepo) GetByProvider(_ context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	c, ok := f.conns[f.key(tenantID, provider)]
	if !ok || !c.Enabled {
		return nil, model.ErrNotFound
	}
	cp := *c
	return &cp, nil
}

func (f *fakeIdPAdminRepo) GetByProviderAny(_ context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	c, ok := f.conns[f.key(tenantID, provider)]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *c
	return &cp, nil
}

func (f *fakeIdPAdminRepo) GetByEmailDomain(_ context.Context, _ string) (*model.IdPConnection, error) {
	return nil, model.ErrNotFound
}

func (f *fakeIdPAdminRepo) ListByTenant(_ context.Context, tenantID string) ([]model.IdPConnection, error) {
	var out []model.IdPConnection
	for _, c := range f.conns {
		if c.TenantID == tenantID {
			cp := *c
			repository.RedactSecret(&cp)
			out = append(out, cp)
		}
	}
	return out, nil
}

func (f *fakeIdPAdminRepo) UpsertConnection(_ context.Context, c *model.IdPConnection) error {
	k := f.key(c.TenantID, c.Provider)
	if existing, ok := f.conns[k]; ok && c.ClientSecret == "" {
		c.ClientSecret = existing.ClientSecret // merge-on-update
	}
	c.ID = "idp-" + c.Provider
	stored := *c
	f.conns[k] = &stored
	return nil
}

func (f *fakeIdPAdminRepo) DeleteConnection(_ context.Context, tenantID, provider string) error {
	k := f.key(tenantID, provider)
	if _, ok := f.conns[k]; !ok {
		return model.ErrNotFound
	}
	delete(f.conns, k)
	return nil
}

// withUserRouter mounts the IdP admin routes behind a middleware that injects an
// authenticated ContextUser with the given roles/tenant.
func withUserRouter(h *IdPAdminHandler, tenantID string, roles []string) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUser(req.Context(), &auth.ContextUser{
				ID:       "user-1",
				TenantID: tenantID,
				Roles:    roles,
			})
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/idp-connections", h.Routes())
	return r
}

func newIdPAdminHandler() (*IdPAdminHandler, *fakeIdPAdminRepo) {
	repo := newFakeIdPAdminRepo()
	svc := service.NewIdPAdminService(repo, "https://demo.clario360.sa", zerolog.Nop())
	return NewIdPAdminHandler(svc, zerolog.Nop()), repo
}

const testTenant = "aaaaaaaa-0000-0000-0000-000000000001"

func TestIdPAdmin_CreateListGetDelete(t *testing.T) {
	h, _ := newIdPAdminHandler()
	router := withUserRouter(h, testTenant, []string{"super_admin"})

	// Create.
	body := map[string]any{
		"provider":  "Othaim SSO",
		"kind":      "oidc",
		"enabled":   true,
		"issuer":    "https://idp.othaim.demo",
		"client_id": "clario-web",
	}
	buf, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/idp-connections/", bytes.NewReader(buf)))
	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created idpConnectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("create: decode: %v", err)
	}
	if created.Provider != "othaim-sso" {
		t.Fatalf("expected normalized slug othaim-sso, got %q", created.Provider)
	}
	if created.RedirectURL != "https://demo.clario360.sa/api/v1/auth/sso/othaim-sso/callback" {
		t.Fatalf("expected defaulted redirect_url, got %q", created.RedirectURL)
	}

	// List.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/idp-connections/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", rec.Code)
	}
	var list []idpConnectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("list: decode: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(list))
	}

	// Get.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/idp-connections/othaim-sso", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d", rec.Code)
	}

	// Delete.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/idp-connections/othaim-sso", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d", rec.Code)
	}

	// Get after delete → 404.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/idp-connections/othaim-sso", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get-after-delete: expected 404, got %d", rec.Code)
	}
}

func TestIdPAdmin_SecretNeverEchoed(t *testing.T) {
	h, repo := newIdPAdminHandler()
	router := withUserRouter(h, testTenant, []string{"super_admin"})

	body := map[string]any{
		"provider":      "acme",
		"kind":          "oidc",
		"enabled":       true,
		"issuer":        "https://idp.acme.demo",
		"client_id":     "cid",
		"client_secret": "top-secret",
	}
	buf, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/idp-connections/", bytes.NewReader(buf)))
	if rec.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("top-secret")) {
		t.Fatal("client_secret leaked in create response")
	}
	// The secret was persisted in the repo.
	if got := repo.conns[repo.key(testTenant, "acme")].ClientSecret; got != "top-secret" {
		t.Fatalf("expected stored secret, got %q", got)
	}

	// Update with blank secret keeps the stored one (merge-on-update).
	upd := map[string]any{"provider": "acme", "kind": "oidc", "enabled": true, "issuer": "https://idp.acme.demo", "client_id": "cid"}
	buf, _ = json.Marshal(upd)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/idp-connections/acme", bytes.NewReader(buf)))
	if rec.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := repo.conns[repo.key(testTenant, "acme")].ClientSecret; got != "top-secret" {
		t.Fatalf("blank-secret update wiped stored secret: %q", got)
	}
}

func TestIdPAdmin_Validation(t *testing.T) {
	h, _ := newIdPAdminHandler()
	router := withUserRouter(h, testTenant, []string{"super_admin"})

	// OIDC without issuer or endpoints → 400.
	body := map[string]any{"provider": "bad", "kind": "oidc", "client_id": "x"}
	buf, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/idp-connections/", bytes.NewReader(buf)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oidc without endpoints, got %d (%s)", rec.Code, rec.Body.String())
	}

	// SAML without metadata → 400.
	body = map[string]any{"provider": "samlp", "kind": "saml"}
	buf, _ = json.Marshal(body)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/idp-connections/", bytes.NewReader(buf)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for saml without metadata, got %d", rec.Code)
	}
}

func TestIdPAdmin_Forbidden(t *testing.T) {
	h, _ := newIdPAdminHandler()
	// A role with no tenant-admin verbs.
	router := withUserRouter(h, testTenant, []string{"viewer"})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/idp-connections/", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin, got %d", rec.Code)
	}

	body := map[string]any{"provider": "x", "kind": "oidc", "issuer": "https://i", "client_id": "c"}
	buf, _ := json.Marshal(body)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/idp-connections/", bytes.NewReader(buf)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin write, got %d", rec.Code)
	}
}
