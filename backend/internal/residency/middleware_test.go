package residency

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

// errLoader always fails with a non-not-found error (simulating a DB outage).
type errLoader struct{}

func (errLoader) TenantRegion(context.Context, string) (string, error) {
	return "", errors.New("db down")
}

func doReq(t *testing.T, mw http.Handler, tenantID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if tenantID != "" {
		req = req.WithContext(auth.WithTenantID(req.Context(), tenantID))
	}
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)
	return rec
}

func TestMiddleware_EnforcementDisabled_PassThrough(t *testing.T) {
	// No ServiceRegion => disabled.
	e := NewEnforcer(config.ResidencyConfig{}, NewStaticLoader(map[string]string{"t": "eu-west"}))
	if e.Enabled() {
		t.Fatal("enforcer should be disabled with empty ServiceRegion")
	}
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (pass-through)", rec.Code)
	}
}

func TestMiddleware_NilLoader_PassThrough(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"}, nil)
	if e.Enabled() {
		t.Fatal("enforcer with nil loader must not be enabled")
	}
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200", rec.Code)
	}
}

func TestMiddleware_NoTenant_PassThrough(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{}))
	rec := doReq(t, e.Middleware(okHandler()), "")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (no tenant => pass-through)", rec.Code)
	}
}

func TestMiddleware_SameRegion_Allowed(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{"t": "ksa-central"}))
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (same region)", rec.Code)
	}
}

func TestMiddleware_UnrestrictedTenant_Allowed(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{"t": ""}))
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (unrestricted tenant)", rec.Code)
	}
}

func TestMiddleware_AllowlistedRegion_Allowed(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{
		ServiceRegion:  "ksa-central",
		AllowedRegions: []string{"ksa-west"},
	}, NewStaticLoader(map[string]string{"t": "ksa-west"}))
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusOK {
		t.Errorf("code = %d, want 200 (allowlisted region)", rec.Code)
	}
}

func TestMiddleware_CrossRegion_Denied(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{"t": "eu-west"}))
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code = %d, want 403 (cross region)", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q", ct)
	}
	if body := rec.Body.String(); body == "" || !contains(body, "RESIDENCY_VIOLATION") {
		t.Errorf("body = %q, want RESIDENCY_VIOLATION", body)
	}
}

func TestMiddleware_TenantNotFound_DeniedFailClosed(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"},
		NewStaticLoader(map[string]string{})) // tenant "t" absent
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403 (fail-closed on not found)", rec.Code)
	}
}

func TestMiddleware_LoaderError_DeniedFailClosed(t *testing.T) {
	e := NewEnforcer(config.ResidencyConfig{ServiceRegion: "ksa-central"}, errLoader{})
	rec := doReq(t, e.Middleware(okHandler()), "t")
	if rec.Code != http.StatusForbidden {
		t.Errorf("code = %d, want 403 (fail-closed on loader error)", rec.Code)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
