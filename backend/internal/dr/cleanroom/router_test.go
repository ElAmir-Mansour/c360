package cleanroom

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// stubAPI implements the router's API surface.
type stubAPI struct {
	scanResult *Scan
	scanErr    error
	latest     *Scan
	latestErr  error

	scannedPoint  uuid.UUID
	scannedTenant uuid.UUID
}

func (s *stubAPI) ScanRecoveryPoint(_ context.Context, tenantID, pointID uuid.UUID) (*Scan, error) {
	s.scannedTenant = tenantID
	s.scannedPoint = pointID
	return s.scanResult, s.scanErr
}

func (s *stubAPI) LatestScan(_ context.Context, _, _ uuid.UUID) (*Scan, error) {
	return s.latest, s.latestErr
}

func withUser(req *http.Request, tenantID, userID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: userID.String(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_RunScan_Clean(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	api := &stubAPI{scanResult: &Scan{
		RecoveryPointID: pointID.String(),
		Verdict:         VerdictClean,
		Scanner:         "signature",
		ChunksScanned:   2,
	}}
	router := NewHandler(api, zerolog.Nop()).Routes()
	tenantID := uuid.New()

	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/cleanroom-scan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rec.Code, rec.Body.String())
	}
	if api.scannedPoint != pointID {
		t.Fatalf("scanned point: got %s want %s", api.scannedPoint, pointID)
	}
	if api.scannedTenant != tenantID {
		t.Fatalf("scanned tenant: got %s want %s", api.scannedTenant, tenantID)
	}
	var body struct {
		Data Scan `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if body.Data.Verdict != VerdictClean {
		t.Fatalf("body verdict: got %q want clean", body.Data.Verdict)
	}
}

func TestRouter_RunScan_DirtyStillReturns200(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	api := &stubAPI{scanResult: &Scan{RecoveryPointID: pointID.String(), Verdict: VerdictMalware}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/cleanroom-scan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("a completed scan with a dirty verdict is still 200; got %d", rec.Code)
	}
}

func TestRouter_GetCleanroom(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	api := &stubAPI{latest: &Scan{RecoveryPointID: pointID.String(), Verdict: VerdictClean}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-points/"+pointID.String()+"/cleanroom", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_GetCleanroom_NotFound(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	api := &stubAPI{latestErr: ErrNotFound}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-points/"+pointID.String()+"/cleanroom", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_RequiresWritePermission(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	api := &stubAPI{scanResult: &Scan{Verdict: VerdictClean}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	// "viewer" has dr:read but not dr:write, so the scan POST must be forbidden.
	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/cleanroom-scan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: got %d want 403; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_RejectsBadUUID(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-points/not-a-uuid/cleanroom", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_RequiresTenant(t *testing.T) {
	t.Parallel()
	api := &stubAPI{scanResult: &Scan{Verdict: VerdictClean}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	pointID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/cleanroom-scan", nil)
	rec := httptest.NewRecorder()
	// User present (so RequirePermission passes via roles) but no tenant in ctx.
	user := &auth.ContextUser{ID: uuid.NewString(), Roles: []string{"tenant_admin"}}
	router.ServeHTTP(rec, req.WithContext(auth.WithUser(req.Context(), user)))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d want 401; body=%s", rec.Code, rec.Body.String())
	}
}
