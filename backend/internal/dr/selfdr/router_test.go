package selfdr

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

// fakeService implements selfdrService so the router's HTTP wiring, permission
// gating and error mapping are tested without a database.
type fakeService struct {
	sealing    bool
	assessHdr  *StoredAssessment
	assessScrd *ReadinessAssessment
	assessErr  error
	report     *AssessmentReport
	reportErr  error
	latest     *AssessmentReport
	latestErr  error
	backupArt  *StoredArtifact
	backupErr  error
	bundleArt  *StoredArtifact
	bundleErr  error
	artifacts  []StoredArtifact

	gotProfile   *SelfDRProfile
	gotBackup    BackupRequest
	gotBundle    OfflineBundleRequest
	lastReportID uuid.UUID
}

func (f *fakeService) RequiredComponents() []ComponentKind { return RequiredComponentKinds() }
func (f *fakeService) SealingEnabled() bool                { return f.sealing }

func (f *fakeService) Assess(_ context.Context, _, _ uuid.UUID, profile *SelfDRProfile) (*StoredAssessment, *ReadinessAssessment, error) {
	f.gotProfile = profile
	return f.assessHdr, f.assessScrd, f.assessErr
}

func (f *fakeService) GetReport(_ context.Context, _, id uuid.UUID) (*AssessmentReport, error) {
	f.lastReportID = id
	return f.report, f.reportErr
}

func (f *fakeService) GetLatest(context.Context, uuid.UUID) (*AssessmentReport, error) {
	return f.latest, f.latestErr
}

func (f *fakeService) CaptureBackup(_ context.Context, _, _ uuid.UUID, req BackupRequest) (*StoredArtifact, error) {
	f.gotBackup = req
	return f.backupArt, f.backupErr
}

func (f *fakeService) GenerateBundle(_ context.Context, _, _ uuid.UUID, req OfflineBundleRequest) (*StoredArtifact, error) {
	f.gotBundle = req
	return f.bundleArt, f.bundleErr
}

func (f *fakeService) ListArtifacts(context.Context, uuid.UUID, int) ([]StoredArtifact, error) {
	return f.artifacts, nil
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func decodeData(t *testing.T, body []byte, dst any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v (body=%s)", err, body)
	}
	if err := json.Unmarshal(env.Data, dst); err != nil {
		t.Fatalf("unmarshal data: %v (data=%s)", err, env.Data)
	}
}

func newTestRouter(svc selfdrService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_ListComponents(t *testing.T) {
	t.Parallel()
	svc := &fakeService{sealing: true}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodGet, "/selfdr/components", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var payload struct {
		RequiredComponents []ComponentKind `json:"required_components"`
		SealingEnabled     bool            `json:"sealing_enabled"`
	}
	decodeData(t, rr.Body.Bytes(), &payload)
	if len(payload.RequiredComponents) != len(RequiredComponentKinds()) || !payload.SealingEnabled {
		t.Errorf("payload = %+v, want full baseline + sealing enabled", payload)
	}
}

func TestRouter_AssessBaseline(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		assessHdr:  &StoredAssessment{ID: uuid.New(), Verdict: VerdictNotReady, Critical: 3},
		assessScrd: &ReadinessAssessment{Verdict: VerdictNotReady, Findings: []Finding{{Code: FindingBreakGlassMissing, Severity: SeverityCritical}}},
	}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/assess", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.gotProfile != nil {
		t.Error("empty body should pass a nil profile (baseline)")
	}
}

func TestRouter_AssessWithProfileBody(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		assessHdr:  &StoredAssessment{ID: uuid.New(), Verdict: VerdictReady},
		assessScrd: &ReadinessAssessment{Verdict: VerdictReady},
	}
	h := newTestRouter(svc)

	body := `{"id":"my-cp","components":[{"id":"c1","name":"db","kind":"postgres_control_db"}]}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/assess", strings.NewReader(body)), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.gotProfile == nil || svc.gotProfile.ID != "my-cp" || len(svc.gotProfile.Components) != 1 {
		t.Errorf("profile = %+v, want decoded my-cp profile", svc.gotProfile)
	}
}

func TestRouter_CaptureBackupValidatesBody(t *testing.T) {
	t.Parallel()
	h := newTestRouter(&fakeService{})
	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/backups", strings.NewReader(`{}`)), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when component_id/kind missing", rr.Code)
	}
}

func TestRouter_CaptureBackupSuccess(t *testing.T) {
	t.Parallel()
	svc := &fakeService{backupArt: &StoredArtifact{ID: uuid.New(), Kind: ArtifactKindControlPlaneBackup}}
	h := newTestRouter(svc)
	body := `{"component_id":"postgres_control_db","component_kind":"postgres_control_db","max_rpo_seconds":300,"retain_days":30}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/backups", strings.NewReader(body)), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.gotBackup.ComponentID != "postgres_control_db" || svc.gotBackup.MaxRPOSeconds != 300 || svc.gotBackup.RetainUntil.IsZero() {
		t.Errorf("backup request = %+v, want decoded component + retain-until set", svc.gotBackup)
	}
}

func TestRouter_BackupNotConfigured(t *testing.T) {
	t.Parallel()
	svc := &fakeService{backupErr: ErrSealingNotConfigured}
	h := newTestRouter(svc)
	body := `{"component_id":"c","component_kind":"postgres_control_db"}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/backups", strings.NewReader(body)), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 when sealing not configured", rr.Code)
	}
}

func TestRouter_GenerateBundleSuccess(t *testing.T) {
	t.Parallel()
	svc := &fakeService{bundleArt: &StoredArtifact{ID: uuid.New(), Kind: ArtifactKindOfflineBundle}}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/offline-bundle", strings.NewReader(`{"retain_days":365}`)), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.gotBundle.RetainUntil.IsZero() {
		t.Error("retain-until should be set from retain_days")
	}
}

func TestRouter_GetLatestNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{latestErr: ErrAssessmentNotFound}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodGet, "/selfdr/assessments/latest", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestRouter_GetAssessmentReport(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	svc := &fakeService{report: &AssessmentReport{Assessment: StoredAssessment{ID: id, Verdict: VerdictDegraded}}}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodGet, "/selfdr/assessments/"+id.String(), nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastReportID != id {
		t.Errorf("GetReport called with %s, want %s", svc.lastReportID, id)
	}
}

// TestRouter_PermissionGating asserts the three-tier gate: dr:read for reads,
// dr:write for assess, dr:admin for the operational seal paths.
func TestRouter_PermissionGating(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		assessHdr:  &StoredAssessment{},
		assessScrd: &ReadinessAssessment{},
	}
	h := newTestRouter(svc)

	// viewer (dr:read) can read components.
	readReq := withUser(httptest.NewRequest(http.MethodGet, "/selfdr/components", nil), uuid.New(), "viewer")
	readRR := httptest.NewRecorder()
	h.ServeHTTP(readRR, readReq)
	if readRR.Code != http.StatusOK {
		t.Errorf("dr:read components status = %d, want 200", readRR.Code)
	}

	// viewer cannot assess (needs dr:write).
	assessReq := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/assess", nil), uuid.New(), "viewer")
	assessRR := httptest.NewRecorder()
	h.ServeHTTP(assessRR, assessReq)
	if assessRR.Code != http.StatusForbidden {
		t.Errorf("dr:read assess status = %d, want 403", assessRR.Code)
	}

	// viewer cannot capture a backup (needs dr:admin).
	backupReq := withUser(httptest.NewRequest(http.MethodPost, "/selfdr/backups", strings.NewReader(`{}`)), uuid.New(), "viewer")
	backupRR := httptest.NewRecorder()
	h.ServeHTTP(backupRR, backupReq)
	if backupRR.Code != http.StatusForbidden {
		t.Errorf("dr:read backup status = %d, want 403", backupRR.Code)
	}
}
