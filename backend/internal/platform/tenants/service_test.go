package tenants

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
)

// ---- fakes ----------------------------------------------------------------

// fakeSigner records the ttl handed to GenerateImpersonationToken so tests can
// assert the TTL clamp without inspecting a signed JWT.
type fakeSigner struct {
	gotTTL    time.Duration
	called    bool
	token     string
	returnErr error
}

func (f *fakeSigner) GenerateImpersonationToken(targetUserID, targetTenantID, targetEmail string, targetRoles []string, impersonatorUserID string, ttl time.Duration) (string, error) {
	f.called = true
	f.gotTTL = ttl
	if f.returnErr != nil {
		return "", f.returnErr
	}
	if f.token == "" {
		return "fake-token", nil
	}
	return f.token, nil
}

// fakeRepo is an in-memory tenantRepo. Only the methods exercised by the
// suspend/impersonate paths carry behaviour; the rest are inert stubs so the
// type satisfies the interface.
type fakeRepo struct {
	identity *tenantIdentity
	identErr error

	tenant    *AdminTenantSummary
	tenantErr error

	target    *targetUser
	targetErr error

	// audit control + capture
	auditErr     error
	auditCalls   int
	lastAction   string
	lastMetadata map[string]any
}

func (r *fakeRepo) ListTenants(ctx context.Context, p ListParams) ([]AdminTenantSummary, int, error) {
	return nil, 0, nil
}
func (r *fakeRepo) GetTenant(ctx context.Context, tenantID string) (*AdminTenantSummary, error) {
	if r.tenantErr != nil {
		return nil, r.tenantErr
	}
	return r.tenant, nil
}
func (r *fakeRepo) Summary(ctx context.Context) (*PlatformSummary, error) {
	return &PlatformSummary{}, nil
}

func (r *fakeRepo) GetTenantIdentity(ctx context.Context, tenantID string) (*tenantIdentity, error) {
	if r.identErr != nil {
		return nil, r.identErr
	}
	return r.identity, nil
}
func (r *fakeRepo) SetTenantStatus(ctx context.Context, tenantID, status string) error { return nil }
func (r *fakeRepo) SuspendUsers(ctx context.Context, tenantID string) error            { return nil }
func (r *fakeRepo) ReactivateUsers(ctx context.Context, tenantID string) error         { return nil }
func (r *fakeRepo) DeleteSessions(ctx context.Context, tenantID string) error          { return nil }
func (r *fakeRepo) RevokeAPIKeys(ctx context.Context, tenantID string) error           { return nil }

func (r *fakeRepo) ResolveImpersonationTarget(ctx context.Context, tenantID, targetUserID string) (*targetUser, error) {
	if r.targetErr != nil {
		return nil, r.targetErr
	}
	return r.target, nil
}

func (r *fakeRepo) InsertAuditLog(ctx context.Context, tenantID, actorID, action string, metadata []byte) error {
	r.auditCalls++
	r.lastAction = action
	r.lastMetadata = map[string]any{}
	_ = json.Unmarshal(metadata, &r.lastMetadata)
	return r.auditErr
}

func newTestService(repo tenantRepo, signer tokenSigner) *Service {
	return &Service{
		repo:     repo,
		jwt:      signer,
		redis:    nil, // clearRedisSessions short-circuits on nil
		producer: nil, // publishEvent short-circuits on nil
		logger:   zerolog.Nop(),
	}
}

func okTarget() *targetUser {
	return &targetUser{ID: "user-1", Email: "u@example.com", Roles: []string{"viewer"}}
}

// ---- TTL clamp ------------------------------------------------------------

func TestImpersonate_TTLClamp(t *testing.T) {
	cases := []struct {
		name    string
		ttlSecs int
		wantTTL time.Duration
	}{
		{"zero clamps to max", 0, maxImpersonationTTL},
		{"negative clamps to max", -42, maxImpersonationTTL},
		{"over max clamps to max", 5000, maxImpersonationTTL},
		{"exactly max stays", 900, maxImpersonationTTL},
		{"under max preserved", 300, 300 * time.Second},
		{"one second preserved", 1, 1 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}, target: okTarget()}
			signer := &fakeSigner{token: "tok"}
			svc := newTestService(repo, signer)

			before := time.Now()
			res, err := svc.Impersonate(context.Background(), "tenant-1", "admin-1", "user-1", "investigation", tc.ttlSecs)
			after := time.Now()
			if err != nil {
				t.Fatalf("Impersonate returned error: %v", err)
			}
			if !signer.called {
				t.Fatal("expected signer to be invoked")
			}
			// (a) the value passed to the jwt mint is clamped.
			if signer.gotTTL != tc.wantTTL {
				t.Errorf("ttl passed to signer = %v, want %v", signer.gotTTL, tc.wantTTL)
			}
			// (a) the returned expires_at reflects the same clamped ttl.
			lo := before.Add(tc.wantTTL)
			hi := after.Add(tc.wantTTL)
			if res.ExpiresAt.Before(lo) || res.ExpiresAt.After(hi) {
				t.Errorf("ExpiresAt %v not within [%v, %v]", res.ExpiresAt, lo, hi)
			}
			// audit metadata should record the same clamped ttl_seconds.
			if got := int(tc.wantTTL.Seconds()); !metaInt(t, repo.lastMetadata, "ttl_seconds", got) {
				t.Errorf("audit ttl_seconds = %v, want %d", repo.lastMetadata["ttl_seconds"], got)
			}
			if res.AccessToken != "tok" {
				t.Errorf("AccessToken = %q, want the minted token", res.AccessToken)
			}
			if !res.Readonly {
				t.Error("impersonation result must be readonly")
			}
		})
	}
}

// TestImpersonate_TTLClamp_RealSigner exercises the clamp against the real
// auth.JWTManager (ephemeral RSA keys, no DB) and asserts the clamp via the
// signed token's own expiry claim.
func TestImpersonate_TTLClamp_RealSigner(t *testing.T) {
	mgr, err := auth.NewJWTManager(config.AuthConfig{
		JWTIssuer:       "test-issuer",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}, target: okTarget()}
	svc := newTestService(repo, mgr)

	// Request a 1-hour TTL; it must be clamped to 900s in the minted token.
	res, err := svc.Impersonate(context.Background(), "tenant-1", "admin-1", "user-1", "reason", 3600)
	if err != nil {
		t.Fatalf("Impersonate: %v", err)
	}
	claims, err := mgr.ValidateAccessToken(res.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken: %v", err)
	}
	if !claims.Readonly {
		t.Error("minted impersonation token must be readonly")
	}
	if claims.ImpersonatedBy != "admin-1" {
		t.Errorf("ImpersonatedBy = %q, want admin-1", claims.ImpersonatedBy)
	}
	life := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if life > maxImpersonationTTL+2*time.Second || life < maxImpersonationTTL-2*time.Second {
		t.Errorf("token lifetime = %v, want ~%v (clamped)", life, maxImpersonationTTL)
	}
}

// ---- fail-closed audit ----------------------------------------------------

func TestImpersonate_FailClosed_AuditError(t *testing.T) {
	repo := &fakeRepo{
		identity: &tenantIdentity{Name: "Acme", Status: "active"},
		target:   okTarget(),
		auditErr: errors.New("audit store down"),
	}
	signer := &fakeSigner{token: "should-not-be-returned"}
	svc := newTestService(repo, signer)

	res, err := svc.Impersonate(context.Background(), "tenant-1", "admin-1", "user-1", "reason", 300)
	if err == nil {
		t.Fatal("expected an error when the audit write fails")
	}
	if res != nil {
		t.Fatalf("expected NO result on audit failure, got %+v", res)
	}
	if !strings.Contains(err.Error(), "audit impersonation start") {
		t.Errorf("error = %v, want it to wrap the audit failure", err)
	}
	// The audit write must have been attempted exactly once before failing.
	if repo.auditCalls != 1 {
		t.Errorf("audit calls = %d, want 1", repo.auditCalls)
	}
	if repo.lastAction != "tenant.impersonation.started" {
		t.Errorf("audit action = %q, want tenant.impersonation.started", repo.lastAction)
	}
}

// TestImpersonate_SignerError ensures a minting failure surfaces and no audit
// row is written (the audit happens only after a successful mint).
func TestImpersonate_SignerError(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}, target: okTarget()}
	signer := &fakeSigner{returnErr: errors.New("kms unavailable")}
	svc := newTestService(repo, signer)

	res, err := svc.Impersonate(context.Background(), "tenant-1", "admin-1", "user-1", "reason", 300)
	if err == nil || res != nil {
		t.Fatalf("expected error and nil result, got res=%+v err=%v", res, err)
	}
	if repo.auditCalls != 0 {
		t.Errorf("audit must not run on mint failure; calls = %d", repo.auditCalls)
	}
}

func TestImpersonate_RequiresReason(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}, target: okTarget()}
	signer := &fakeSigner{}
	svc := newTestService(repo, signer)

	res, err := svc.Impersonate(context.Background(), "tenant-1", "admin-1", "user-1", "   ", 300)
	if err == nil || res != nil {
		t.Fatalf("expected validation error, got res=%+v err=%v", res, err)
	}
	if !errors.Is(err, ErrValidation) {
		t.Errorf("error = %v, want ErrValidation", err)
	}
	if signer.called {
		t.Error("signer must not be called when reason is missing")
	}
	if repo.auditCalls != 0 {
		t.Error("no audit on validation failure")
	}
}

// ---- suspend guards + fail-closed audit -----------------------------------

func TestSuspend_RequiresReason(t *testing.T) {
	svc := newTestService(&fakeRepo{}, &fakeSigner{})
	err := svc.Suspend(context.Background(), "tenant-1", "admin-1", "")
	if !errors.Is(err, ErrValidation) {
		t.Errorf("error = %v, want ErrValidation", err)
	}
}

func TestSuspend_AlreadySuspended_Conflict(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "suspended"}}
	svc := newTestService(repo, &fakeSigner{})
	err := svc.Suspend(context.Background(), "tenant-1", "admin-1", "policy")
	if !errors.Is(err, ErrConflict) {
		t.Errorf("error = %v, want ErrConflict", err)
	}
	if repo.auditCalls != 0 {
		t.Error("no audit when guard rejects")
	}
}

func TestSuspend_Deprovisioned_Conflict(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "deprovisioned"}}
	svc := newTestService(repo, &fakeSigner{})
	err := svc.Suspend(context.Background(), "tenant-1", "admin-1", "policy")
	if !errors.Is(err, ErrConflict) {
		t.Errorf("error = %v, want ErrConflict", err)
	}
}

func TestSuspend_FailClosed_AuditError(t *testing.T) {
	repo := &fakeRepo{
		identity: &tenantIdentity{Name: "Acme", Status: "active"},
		auditErr: errors.New("audit store down"),
	}
	svc := newTestService(repo, &fakeSigner{})
	err := svc.Suspend(context.Background(), "tenant-1", "admin-1", "policy")
	if err == nil {
		t.Fatal("expected suspend to fail when audit write fails")
	}
	if !strings.Contains(err.Error(), "audit suspend") {
		t.Errorf("error = %v, want it to wrap the audit failure", err)
	}
	if repo.lastAction != "tenant.suspended" {
		t.Errorf("audit action = %q, want tenant.suspended", repo.lastAction)
	}
}

func TestSuspend_Success(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}}
	svc := newTestService(repo, &fakeSigner{})
	if err := svc.Suspend(context.Background(), "tenant-1", "admin-1", "abuse"); err != nil {
		t.Fatalf("Suspend: %v", err)
	}
	if repo.auditCalls != 1 || repo.lastAction != "tenant.suspended" {
		t.Errorf("expected one tenant.suspended audit, got calls=%d action=%q", repo.auditCalls, repo.lastAction)
	}
	if got, ok := repo.lastMetadata["reason"].(string); !ok || got != "abuse" {
		t.Errorf("audit reason = %v, want abuse", repo.lastMetadata["reason"])
	}
}

func TestUnsuspend_NotSuspended_Conflict(t *testing.T) {
	repo := &fakeRepo{identity: &tenantIdentity{Name: "Acme", Status: "active"}}
	svc := newTestService(repo, &fakeSigner{})
	if err := svc.Unsuspend(context.Background(), "tenant-1", "admin-1"); !errors.Is(err, ErrConflict) {
		t.Errorf("error = %v, want ErrConflict", err)
	}
}

func TestUnsuspend_FailClosed_AuditError(t *testing.T) {
	repo := &fakeRepo{
		identity: &tenantIdentity{Name: "Acme", Status: "suspended"},
		auditErr: errors.New("audit store down"),
	}
	svc := newTestService(repo, &fakeSigner{})
	err := svc.Unsuspend(context.Background(), "tenant-1", "admin-1")
	if err == nil || !strings.Contains(err.Error(), "audit unsuspend") {
		t.Errorf("error = %v, want wrapped audit unsuspend failure", err)
	}
}

// ---- get single tenant (G2 detail) ----------------------------------------

func TestGet_Success(t *testing.T) {
	want := &AdminTenantSummary{
		ID:               "tenant-1",
		Name:             "Acme",
		Slug:             "acme",
		Status:           "active",
		SubscriptionTier: "enterprise",
		UserCount:        7,
		ActiveUserCount:  5,
	}
	repo := &fakeRepo{tenant: want}
	svc := newTestService(repo, &fakeSigner{})

	got, err := svc.Get(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if got == nil || got.ID != want.ID || got.Slug != want.Slug || got.Status != want.Status {
		t.Errorf("Get = %+v, want %+v", got, want)
	}
	if got.SubscriptionTier != want.SubscriptionTier || got.UserCount != want.UserCount || got.ActiveUserCount != want.ActiveUserCount {
		t.Errorf("Get projection mismatch: got %+v, want %+v", got, want)
	}
}

func TestGet_NotFound_Passthrough(t *testing.T) {
	repo := &fakeRepo{tenantErr: ErrNotFound}
	svc := newTestService(repo, &fakeSigner{})

	got, err := svc.Get(context.Background(), "missing")
	if got != nil {
		t.Fatalf("expected nil result on not-found, got %+v", got)
	}
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("error = %v, want ErrNotFound", err)
	}
}

// ---- handler: envelope + 404 mapping --------------------------------------

func TestHandlerGet_OK_Envelope(t *testing.T) {
	repo := &fakeRepo{tenant: &AdminTenantSummary{ID: "tenant-1", Name: "Acme", Slug: "acme", Status: "active"}}
	h := NewHandler(newTestService(repo, &fakeSigner{}), zerolog.Nop())

	rec := httptest.NewRecorder()
	req := getWithURLParam(t, "id", "tenant-1")
	h.Get(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data AdminTenantSummary `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Data.ID != "tenant-1" || body.Data.Slug != "acme" || body.Data.Status != "active" {
		t.Errorf("data = %+v, want tenant-1/acme/active", body.Data)
	}
}

func TestHandlerGet_NotFound(t *testing.T) {
	repo := &fakeRepo{tenantErr: ErrNotFound}
	h := NewHandler(newTestService(repo, &fakeSigner{}), zerolog.Nop())

	rec := httptest.NewRecorder()
	req := getWithURLParam(t, "id", "missing")
	h.Get(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "NOT_FOUND" {
		t.Errorf("code = %q, want NOT_FOUND", body.Code)
	}
}

// ---- helpers --------------------------------------------------------------

// getWithURLParam builds a GET request whose chi route context carries {key:val},
// so a handler that reads chi.URLParam(r, key) resolves it without a full router.
func getWithURLParam(t *testing.T, key, val string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/tenants/"+val, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, val)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// metaInt reports whether key in m equals want, accounting for JSON numbers
// decoding to float64.
func metaInt(t *testing.T, m map[string]any, key string, want int) bool {
	t.Helper()
	v, ok := m[key]
	if !ok {
		return false
	}
	switch n := v.(type) {
	case float64:
		return int(n) == want
	case int:
		return n == want
	default:
		return false
	}
}
