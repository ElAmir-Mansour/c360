package byok

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeBYOKService implements byokService so the router's HTTP wiring, permission
// gating, and error mapping are tested without a database.
type fakeBYOKService struct {
	kek     *TenantKEK
	keks    []*TenantKEK
	entries []*CustodyEntry
	intact  bool
	broken  int64
	root    string
	err     error

	enrolledProvider string
	enrolledRef      string
	rotated          bool
}

func (f *fakeBYOKService) Enroll(_ context.Context, _ uuid.UUID, provider, reference string) (*TenantKEK, error) {
	f.enrolledProvider = provider
	f.enrolledRef = reference
	if f.err != nil {
		return nil, f.err
	}
	return f.kek, nil
}
func (f *fakeBYOKService) ListKEKs(_ context.Context, _ uuid.UUID) ([]*TenantKEK, error) {
	return f.keks, f.err
}
func (f *fakeBYOKService) Rotate(_ context.Context, _ uuid.UUID) (*TenantKEK, error) {
	f.rotated = true
	if f.err != nil {
		return nil, f.err
	}
	return f.kek, nil
}
func (f *fakeBYOKService) CustodyLog(_ context.Context, _ uuid.UUID) ([]*CustodyEntry, error) {
	return f.entries, f.err
}
func (f *fakeBYOKService) VerifyCustody(_ context.Context, _ uuid.UUID) (bool, int64, string, error) {
	return f.intact, f.broken, f.root, f.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func newTestRouter(svc byokService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_Enroll_Created(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	svc := &fakeBYOKService{kek: &TenantKEK{ID: uuid.New(), TenantID: tenant, KeyVersion: 1, Provider: ProviderSoftware, State: KEKStateActive}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/byok/keys", strings.NewReader(`{"provider":"software"}`))
	req = withUser(req, tenant, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.enrolledProvider != "software" {
		t.Fatalf("provider not passed through: %q", svc.enrolledProvider)
	}
}

func TestRouter_Enroll_RequiresAdmin(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	router := newTestRouter(&fakeBYOKService{})
	req := httptest.NewRequest(http.MethodPost, "/byok/keys", strings.NewReader(`{}`))
	req = withUser(req, tenant, "viewer") // viewer has dr:read only
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer enroll should be 403, got %d", rec.Code)
	}
}

func TestRouter_Enroll_AlreadyEnrolledConflict(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	router := newTestRouter(&fakeBYOKService{err: ErrAlreadyEnrolled})
	req := httptest.NewRequest(http.MethodPost, "/byok/keys", strings.NewReader(`{"provider":"software"}`))
	req = withUser(req, tenant, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
}

func TestRouter_ListKeys_OK(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	svc := &fakeBYOKService{keks: []*TenantKEK{{KeyVersion: 1, State: KEKStateActive}}}
	router := newTestRouter(svc)
	req := httptest.NewRequest(http.MethodGet, "/byok/keys", nil)
	req = withUser(req, tenant, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Rotate_OK(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	svc := &fakeBYOKService{kek: &TenantKEK{KeyVersion: 2, State: KEKStateActive}}
	router := newTestRouter(svc)
	req := httptest.NewRequest(http.MethodPost, "/byok/keys/rotate", nil)
	req = withUser(req, tenant, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !svc.rotated {
		t.Fatalf("rotate not invoked")
	}
}

func TestRouter_CustodyLog_OK(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	svc := &fakeBYOKService{
		entries: []*CustodyEntry{{Seq: 1, Action: ActionEnroll, EntryHash: "abc"}},
		intact:  true,
		root:    "deadbeef",
	}
	router := newTestRouter(svc)
	req := httptest.NewRequest(http.MethodGet, "/byok/keys/custody-log", nil)
	req = withUser(req, tenant, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// The suiteapi envelope wraps the payload under "data"; confirm the custody
	// response fields round-tripped through it.
	var env struct {
		Data custodyLogResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if !env.Data.Intact || env.Data.MerkleRoot != "deadbeef" || len(env.Data.Entries) != 1 {
		t.Fatalf("custody response not carried through: %+v", env.Data)
	}
}

func TestRouter_Unauthenticated(t *testing.T) {
	t.Parallel()
	router := newTestRouter(&fakeBYOKService{})
	req := httptest.NewRequest(http.MethodGet, "/byok/keys", nil) // no auth context
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Fatalf("unauthenticated should be 401/403, got %d", rec.Code)
	}
}
