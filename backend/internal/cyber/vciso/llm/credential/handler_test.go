package credential

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/store/crypto"
)

// newTestHandler builds a Handler backed by the in-memory fake store + fake
// transit (NO Vault, NO DB, NO network) and returns the capture emitter so tests
// can assert events never carry the key.
func newTestHandler(t *testing.T) (*Handler, *captureEmitter) {
	t.Helper()
	mgr, err := crypto.NewDEKManager(crypto.DEKManagerConfig{}, crypto.DEKManagerDeps{Transit: fakeTransit{}})
	if err != nil {
		t.Fatalf("NewDEKManager: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Close() })
	sc, err := crypto.NewSecretCrypto(mgr)
	if err != nil {
		t.Fatalf("NewSecretCrypto: %v", err)
	}
	emit := &captureEmitter{}
	svc, err := NewService(newFakeStore(), sc, emit)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return NewHandler(svc, zerolog.Nop()), emit
}

// adminCtx returns a request context carrying a tenant + an admin user (role
// tenant_admin -> carries vciso:llm:admin).
func adminCtx(tenantID uuid.UUID) context.Context {
	ctx := auth.WithTenantID(context.Background(), tenantID.String())
	ctx = auth.WithUser(ctx, &auth.ContextUser{
		ID:       uuid.New().String(),
		TenantID: tenantID.String(),
		Email:    "admin@tenant.test",
		Roles:    []string{"tenant_admin"},
	})
	return ctx
}

// nonAdminCtx returns a context with a tenant but a non-admin role.
func nonAdminCtx(tenantID uuid.UUID) context.Context {
	ctx := auth.WithTenantID(context.Background(), tenantID.String())
	ctx = auth.WithUser(ctx, &auth.ContextUser{
		ID:       uuid.New().String(),
		TenantID: tenantID.String(),
		Email:    "user@tenant.test",
		Roles:    []string{"analyst"},
	})
	return ctx
}

func doJSON(h http.HandlerFunc, method, target string, ctx context.Context, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, target, &buf).WithContext(ctx)
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestHandler_SetThenGetStatus_NoKeyLeak(t *testing.T) {
	h, emit := newTestHandler(t)
	tenant := uuid.New()

	// PUT credential.
	setRec := doJSON(h.Set, http.MethodPut, "/llm/credential", adminCtx(tenant), map[string]string{
		"provider": "anthropic",
		"model":    "claude-opus-4-8",
		"api_key":  "sk-ant-handler-key-1234567890abcdef",
	})
	if setRec.Code != http.StatusOK {
		t.Fatalf("Set status = %d, want 200; body=%s", setRec.Code, setRec.Body.String())
	}
	assertNoKeyInBody(t, setRec.Body.Bytes())

	// GET status must never contain the key or any cipher.
	getRec := doJSON(h.GetStatus, http.MethodGet, "/llm/credential", adminCtx(tenant), nil)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GetStatus = %d, want 200; body=%s", getRec.Code, getRec.Body.String())
	}
	var status Status
	if err := json.Unmarshal(getRec.Body.Bytes(), &status); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}
	if !status.Configured || !status.Enabled {
		t.Fatalf("status not configured/enabled: %+v", status)
	}
	if status.Provider != "anthropic" || status.Model != "claude-opus-4-8" {
		t.Fatalf("unexpected provider/model: %+v", status)
	}
	assertNoKeyInBody(t, getRec.Body.Bytes())

	// The emitted event must NOT carry the key or cipher.
	emit.mu.Lock()
	defer emit.mu.Unlock()
	if len(emit.events) == 0 {
		t.Fatal("expected at least one emitted event")
	}
	for _, e := range emit.events {
		for k, v := range e.Payload {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "api_key") || strings.Contains(lk, "cipher") || strings.Contains(lk, "secret") {
				t.Fatalf("event %q payload key %q must not exist", e.Type, k)
			}
			if s, ok := v.(string); ok && strings.Contains(s, "sk-ant-") {
				t.Fatalf("event %q payload value leaks key: %v", e.Type, v)
			}
		}
	}
}

func TestHandler_NonAdminForbidden(t *testing.T) {
	h, _ := newTestHandler(t)
	tenant := uuid.New()

	for _, tc := range []struct {
		name   string
		fn     http.HandlerFunc
		method string
		body   any
	}{
		{"set", h.Set, http.MethodPut, map[string]string{"provider": "anthropic", "api_key": "sk-ant-x-1234567890abcdef"}},
		{"rotate", h.Rotate, http.MethodPost, map[string]string{"api_key": "sk-ant-x-1234567890abcdef"}},
		{"delete", h.Delete, http.MethodDelete, nil},
		{"status", h.GetStatus, http.MethodGet, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := doJSON(tc.fn, tc.method, "/llm/credential", nonAdminCtx(tenant), tc.body)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s: status = %d, want 403; body=%s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandler_RotateRequiresExisting(t *testing.T) {
	h, _ := newTestHandler(t)
	tenant := uuid.New()

	// Rotate with no prior Set -> 404 (ErrNotConfigured).
	rec := doJSON(h.Rotate, http.MethodPost, "/llm/credential/rotate", adminCtx(tenant), map[string]string{
		"api_key": "sk-ant-rotate-1234567890abcdef",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("Rotate-without-set status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}

	// Set then rotate -> 200, version bumps.
	if r := doJSON(h.Set, http.MethodPut, "/llm/credential", adminCtx(tenant), map[string]string{
		"provider": "anthropic", "api_key": "sk-ant-first-1234567890abcdef",
	}); r.Code != http.StatusOK {
		t.Fatalf("Set: %d %s", r.Code, r.Body.String())
	}
	r := doJSON(h.Rotate, http.MethodPost, "/llm/credential/rotate", adminCtx(tenant), map[string]string{
		"api_key": "sk-ant-second-1234567890abcdef",
	})
	if r.Code != http.StatusOK {
		t.Fatalf("Rotate: %d %s", r.Code, r.Body.String())
	}
	var st Status
	_ = json.Unmarshal(r.Body.Bytes(), &st)
	if st.Version < 2 {
		t.Fatalf("expected version >= 2 after rotate, got %d", st.Version)
	}
	assertNoKeyInBody(t, r.Body.Bytes())
}

func TestHandler_DeleteIdempotent(t *testing.T) {
	h, _ := newTestHandler(t)
	tenant := uuid.New()

	// Delete with nothing configured -> 204 (idempotent).
	rec := doJSON(h.Delete, http.MethodDelete, "/llm/credential", adminCtx(tenant), nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("Delete-empty status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_SetValidationError(t *testing.T) {
	h, _ := newTestHandler(t)
	tenant := uuid.New()

	// Unsupported provider -> 400.
	rec := doJSON(h.Set, http.MethodPut, "/llm/credential", adminCtx(tenant), map[string]string{
		"provider": "cohere", "api_key": "sk-whatever-1234567890abcdef",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unsupported-provider status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}

	// Bad key format (anthropic without sk-ant- prefix) -> 400.
	rec = doJSON(h.Set, http.MethodPut, "/llm/credential", adminCtx(tenant), map[string]string{
		"provider": "anthropic", "api_key": "not-a-valid-anthropic-key-123",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad-key-format status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandler_NilServiceUnavailable(t *testing.T) {
	h := NewHandler(nil, zerolog.Nop())
	tenant := uuid.New()
	rec := doJSON(h.GetStatus, http.MethodGet, "/llm/credential", adminCtx(tenant), nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil-service status = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
}

// assertNoKeyInBody fails if the response body contains any plaintext-key marker
// or a cipher/api_key field.
func assertNoKeyInBody(t *testing.T, body []byte) {
	t.Helper()
	s := string(body)
	for _, bad := range []string{"sk-ant-", "api_key", "cipher", "enc:v1:"} {
		if strings.Contains(s, bad) {
			t.Fatalf("response body must not contain %q: %s", bad, s)
		}
	}
}
