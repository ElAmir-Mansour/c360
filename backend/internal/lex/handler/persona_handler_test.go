package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/lex/service"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// memPersonaStore is an in-memory PersonaStore for the handler tests (no DB).
type memPersonaStore struct {
	mu sync.Mutex
	m  map[string]string
}

func newMemPersonaStore() *memPersonaStore { return &memPersonaStore{m: map[string]string{}} }

func (s *memPersonaStore) key(t, u uuid.UUID) string { return t.String() + "/" + u.String() }

func (s *memPersonaStore) GetActiveRoleSlug(_ context.Context, t, u uuid.UUID) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.m[s.key(t, u)], nil
}

func (s *memPersonaStore) SetActiveRoleSlug(_ context.Context, t, u uuid.UUID, slug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[s.key(t, u)] = slug
	return nil
}

// newPersonaTestRouter mirrors the production authenticated chain (Auth +
// TenantGuard) and registers ONLY the persona routes, so the test exercises the
// real JWT plumbing without a Redis rate limiter or DB.
func newPersonaTestRouter(t *testing.T, store service.PersonaStore) (*chi.Mux, *auth.JWTManager) {
	t.Helper()
	jwtMgr, err := auth.NewJWTManager(config.AuthConfig{
		JWTIssuer:       "test",
		AccessTokenTTL:  time.Hour,
		RefreshTokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}
	svc := service.NewPersonaService(store, zerolog.Nop())
	h := NewPersonaHandler(svc, zerolog.Nop())

	r := chi.NewRouter()
	r.Route("/api/v1/lex", func(r chi.Router) {
		r.Use(sharedmw.Auth(jwtMgr))
		r.Use(sharedmw.Tenant)
		r.Get("/me", h.Me)
		r.Post("/persona", h.SetPersona)
	})
	return r, jwtMgr
}

func bearer(t *testing.T, jwtMgr *auth.JWTManager, tenantID, userID string, roles []string) string {
	t.Helper()
	pair, err := jwtMgr.GenerateTokenPair(userID, tenantID, "user@demo.test", roles, "sess-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair: %v", err)
	}
	return "Bearer " + pair.AccessToken
}

func doMe(t *testing.T, r http.Handler, token string) (int, service.LexMeResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/me", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	var env struct {
		Data service.LexMeResponse `json:"data"`
	}
	if rec.Code == http.StatusOK {
		if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
			t.Fatalf("decode /me body: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, env.Data
}

func TestPersonaMe_LegalDirector(t *testing.T) {
	r, jwtMgr := newPersonaTestRouter(t, newMemPersonaStore())
	tenantID := uuid.NewString()
	userID := uuid.NewString()
	token := bearer(t, jwtMgr, tenantID, userID, []string{"legal-director"})

	code, me := doMe(t, r, token)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if me.AccessState != service.AccessStateReady {
		t.Fatalf("access_state = %q, want READY", me.AccessState)
	}
	if me.ActiveLegalRole == nil || me.ActiveLegalRole.Slug != "legal-director" {
		t.Fatalf("active role = %+v, want legal-director", me.ActiveLegalRole)
	}
	if me.ActiveLegalRole.Tier != "Legal" {
		t.Errorf("director tier = %q, want Legal", me.ActiveLegalRole.Tier)
	}
	if me.PersonaLanding != "/lex/command-center" {
		t.Errorf("persona_landing = %q, want /lex/command-center", me.PersonaLanding)
	}
	// Granular effective permission must be present (incl. lex:case:approve).
	var hasApprove bool
	for _, p := range me.EffectivePermissions {
		if p == auth.PermLexCaseApprove {
			hasApprove = true
			break
		}
	}
	if !hasApprove {
		t.Errorf("effective_permissions must include %s; got %v", auth.PermLexCaseApprove, me.EffectivePermissions)
	}
	if !me.Capabilities.CanApproveCases {
		t.Error("capabilities.can_approve_cases must be true for legal-director")
	}
	if !me.Capabilities.CanAssignCases || !me.Capabilities.CanDistributeContracts || !me.Capabilities.CanManageConfiguration {
		t.Error("director must have assign/distribute/manage-config capabilities")
	}
	if me.PermissionVersion == "" {
		t.Error("permission_version must be set")
	}
}

func TestPersonaMe_LegalOfficer_NoApprove(t *testing.T) {
	r, jwtMgr := newPersonaTestRouter(t, newMemPersonaStore())
	token := bearer(t, jwtMgr, uuid.NewString(), uuid.NewString(), []string{"legal-officer"})

	code, me := doMe(t, r, token)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if me.ActiveLegalRole == nil || me.ActiveLegalRole.Slug != "legal-officer" {
		t.Fatalf("active role = %+v, want legal-officer", me.ActiveLegalRole)
	}
	if me.PersonaLanding != "/lex/my-work" {
		t.Errorf("persona_landing = %q, want /lex/my-work", me.PersonaLanding)
	}
	if me.Capabilities.CanApproveCases {
		t.Error("capabilities.can_approve_cases must be FALSE for legal-officer")
	}
	if !me.Capabilities.CanHandleCases {
		t.Error("legal-officer must be able to handle cases (view+edit)")
	}
}

func TestPersonaMe_NonLegalUser(t *testing.T) {
	r, jwtMgr := newPersonaTestRouter(t, newMemPersonaStore())
	token := bearer(t, jwtMgr, uuid.NewString(), uuid.NewString(), []string{"viewer"})

	code, me := doMe(t, r, token)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (no silent denial)", code)
	}
	if me.AccessState != service.AccessStateNoLexRole {
		t.Fatalf("access_state = %q, want NO_LEX_ROLE_ASSIGNED", me.AccessState)
	}
	if me.ActiveLegalRole != nil {
		t.Errorf("active_legal_role must be null, got %+v", me.ActiveLegalRole)
	}
	if me.PersonaLanding != "/dashboard" {
		t.Errorf("persona_landing = %q, want /dashboard", me.PersonaLanding)
	}
	if len(me.AvailableLegalRoles) != 0 {
		t.Errorf("available_legal_roles must be empty, got %v", me.AvailableLegalRoles)
	}
}

func TestPersonaPost_SwitchAndReject(t *testing.T) {
	store := newMemPersonaStore()
	r, jwtMgr := newPersonaTestRouter(t, store)
	tenantID := uuid.NewString()
	userID := uuid.NewString()
	// Multi-role user: director + cases-manager.
	token := bearer(t, jwtMgr, tenantID, userID, []string{"legal-director", "legal-cases-manager"})

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/lex/persona", strings.NewReader(body))
		req.Header.Set("Authorization", token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}

	// Switch to a HELD role -> 200 + active role updated + landing changes.
	rec := post(`{"role_slug":"legal-cases-manager"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch to held role status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data service.LexMeResponse `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.ActiveLegalRole == nil || env.Data.ActiveLegalRole.Slug != "legal-cases-manager" {
		t.Fatalf("active role after switch = %+v, want legal-cases-manager", env.Data.ActiveLegalRole)
	}
	if env.Data.PersonaLanding != "/lex/cases/control" {
		t.Errorf("persona_landing after switch = %q, want /lex/cases/control", env.Data.PersonaLanding)
	}

	// The preference must persist: a fresh /me defaults to the switched persona.
	if _, me := doMe(t, r, token); me.ActiveLegalRole == nil || me.ActiveLegalRole.Slug != "legal-cases-manager" {
		t.Fatalf("/me did not honour persisted persona: %+v", me.ActiveLegalRole)
	}

	// Switch to a slug the user does NOT hold -> 403.
	rec = post(`{"role_slug":"legal-system-admin"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("switch to UNHELD role status = %d, want 403 (body=%s)", rec.Code, rec.Body.String())
	}

	// Empty slug -> 400.
	if rec := post(`{"role_slug":""}`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty role_slug status = %d, want 400", rec.Code)
	}
}
