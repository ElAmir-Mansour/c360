package cybervault

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

type fakeCyberVaultService struct {
	vaults      []RegisteredVault
	assessment  *StoredPostureAssessment
	assessments []StoredPostureAssessment
	err         error

	syncPlan SyncPlan

	lastTenant  uuid.UUID
	lastGroupID uuid.UUID
	lastVaultID uuid.UUID
	lastPosture VaultPosture
	lastWindow  SyncWindow
	lastSyncReq SyncRequest
	upsertCalls int
	updateCalls int
	evalCalls   int
	planCalls   int
}

func (f *fakeCyberVaultService) UpsertVaultPosture(_ context.Context, tenantID, groupID uuid.UUID, posture VaultPosture) (RegisteredVault, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	f.lastPosture = posture
	f.upsertCalls++
	if f.err != nil {
		return RegisteredVault{}, f.err
	}
	if len(f.vaults) > 0 {
		return f.vaults[0], nil
	}
	return RegisteredVault{TenantID: tenantID.String(), GroupID: groupID.String(), Provider: posture.Provider, Name: posture.Name, Posture: posture}, nil
}

func (f *fakeCyberVaultService) UpdateVaultPosture(_ context.Context, tenantID, groupID, vaultID uuid.UUID, posture VaultPosture) (RegisteredVault, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	f.lastVaultID = vaultID
	f.lastPosture = posture
	f.updateCalls++
	if f.err != nil {
		return RegisteredVault{}, f.err
	}
	if len(f.vaults) > 0 {
		return f.vaults[0], nil
	}
	return RegisteredVault{ID: vaultID.String(), TenantID: tenantID.String(), GroupID: groupID.String(), Provider: posture.Provider, Name: posture.Name, Posture: posture}, nil
}

func (f *fakeCyberVaultService) ListVaultPostures(_ context.Context, tenantID, groupID uuid.UUID) ([]RegisteredVault, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	if f.err != nil {
		return nil, f.err
	}
	return f.vaults, nil
}

func (f *fakeCyberVaultService) EvaluateVault(_ context.Context, tenantID, groupID, vaultID uuid.UUID) (*StoredPostureAssessment, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	f.lastVaultID = vaultID
	f.evalCalls++
	if f.err != nil {
		return nil, f.err
	}
	return f.assessment, nil
}

func (f *fakeCyberVaultService) ListLatestAssessments(_ context.Context, tenantID, groupID uuid.UUID) ([]StoredPostureAssessment, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	if f.err != nil {
		return nil, f.err
	}
	return f.assessments, nil
}

func (f *fakeCyberVaultService) LatestAssessmentByVault(_ context.Context, tenantID, vaultID uuid.UUID) (*StoredPostureAssessment, error) {
	f.lastTenant = tenantID
	f.lastVaultID = vaultID
	if f.err != nil {
		return nil, f.err
	}
	return f.assessment, nil
}

func (f *fakeCyberVaultService) PlanSync(_ context.Context, tenantID, groupID, vaultID uuid.UUID, window SyncWindow, request SyncRequest) (SyncPlan, error) {
	f.lastTenant = tenantID
	f.lastGroupID = groupID
	f.lastVaultID = vaultID
	f.lastWindow = window
	f.lastSyncReq = request
	f.planCalls++
	if f.err != nil {
		return SyncPlan{}, f.err
	}
	return f.syncPlan, nil
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func withUserWithoutTenant(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	return req.WithContext(auth.WithUser(req.Context(), user))
}

func newHTTPRouter(svc cyberVaultService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_UpsertVault_TenantAndEnvelope(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	vaultID := uuid.NewString()
	svc := &fakeCyberVaultService{vaults: []RegisteredVault{{ID: vaultID, TenantID: tenantID.String(), GroupID: groupID.String(), Name: "prod vault", Provider: VaultProviderAWSBackup}}}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults?group="+groupID.String(), strings.NewReader(`{"name":"prod vault","provider":"aws_backup"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTenant != tenantID || svc.lastGroupID != groupID {
		t.Fatalf("tenant/group = %s/%s, want %s/%s", svc.lastTenant, svc.lastGroupID, tenantID, groupID)
	}
	if svc.lastPosture.Name != "prod vault" || svc.lastPosture.Provider != VaultProviderAWSBackup {
		t.Fatalf("posture not propagated: %+v", svc.lastPosture)
	}
	var body struct {
		Data RegisteredVault `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	if body.Data.ID != vaultID {
		t.Fatalf("response id = %q, want %s", body.Data.ID, vaultID)
	}
}

func TestRouter_UpsertVaultByID_BadUUID(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodPut, "/cyber-vaults/not-a-uuid", strings.NewReader(`{"name":"v"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if svc.upsertCalls != 0 {
		t.Fatalf("service called on bad uuid")
	}
}

func TestRouter_ListVaults_JSONEnvelope(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	svc := &fakeCyberVaultService{vaults: []RegisteredVault{{ID: uuid.NewString(), Name: "a"}, {ID: uuid.NewString(), Name: "b"}}}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/cyber-vaults?group="+groupID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTenant != tenantID || svc.lastGroupID != groupID {
		t.Fatalf("tenant/group = %s/%s, want %s/%s", svc.lastTenant, svc.lastGroupID, tenantID, groupID)
	}
	var body struct {
		Data struct {
			Count  int               `json:"count"`
			Vaults []RegisteredVault `json:"vaults"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	if body.Data.Count != 2 || len(body.Data.Vaults) != 2 {
		t.Fatalf("list envelope = %+v, want count 2 and 2 vaults", body.Data)
	}
}

func TestRouter_ListVaults_MissingTenantContext(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/cyber-vaults?group="+uuid.NewString(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUserWithoutTenant(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_EvaluateVault_PermissionAndDispatch(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	groupID := uuid.New()
	vaultID := uuid.New()
	svc := &fakeCyberVaultService{assessment: &StoredPostureAssessment{VaultID: vaultID.String(), Score: 100, Verdict: VerdictSatisfied}}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+vaultID.String()+"/evaluate?group="+groupID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("analyst status = %d, want 403", rec.Code)
	}
	if svc.evalCalls != 0 {
		t.Fatalf("service called despite missing write permission")
	}

	req = httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+vaultID.String()+"/evaluate?group="+groupID.String(), nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, "tenant_admin"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("tenant_admin status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTenant != tenantID || svc.lastGroupID != groupID || svc.lastVaultID != vaultID {
		t.Fatalf("tenant/group/vault = %s/%s/%s, want %s/%s/%s", svc.lastTenant, svc.lastGroupID, svc.lastVaultID, tenantID, groupID, vaultID)
	}
}

func TestRouter_EvaluateVault_BadUUID(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/not-a-uuid/evaluate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if svc.evalCalls != 0 {
		t.Fatalf("service called on bad uuid")
	}
}

func TestRouter_ListAssessments_JSONEnvelope(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	svc := &fakeCyberVaultService{assessments: []StoredPostureAssessment{
		{VaultID: uuid.NewString(), Score: 100, Verdict: VerdictSatisfied},
		{VaultID: uuid.NewString(), Score: 50, Verdict: VerdictPartial},
	}}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/cyber-vaults/assessments?group="+groupID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			Count       int                       `json:"count"`
			Assessments []StoredPostureAssessment `json:"assessments"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	if body.Data.Count != 2 || len(body.Data.Assessments) != 2 {
		t.Fatalf("assessment envelope = %+v, want count 2", body.Data)
	}
}

func TestRouter_LatestAssessment_NotFound(t *testing.T) {
	t.Parallel()
	vaultID := uuid.New()
	svc := &fakeCyberVaultService{err: ErrAssessmentNotFound}
	router := newHTTPRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/cyber-vaults/"+vaultID.String()+"/assessments/latest", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_ServiceErrorMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "invalid request", err: ErrInvalidRequest, status: http.StatusBadRequest},
		{name: "vault not found", err: ErrVaultNotFound, status: http.StatusNotFound},
		{name: "source unavailable", err: ErrSourceUnavailable, status: http.StatusServiceUnavailable},
		{name: "internal", err: errors.New("database down"), status: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			router := newHTTPRouter(&fakeCyberVaultService{err: tt.err})
			req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+uuid.NewString()+"/evaluate?group="+uuid.NewString(), nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}
