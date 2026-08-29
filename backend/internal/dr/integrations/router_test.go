package integrations

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

// fakeService implements integrationsService so the router's HTTP wiring,
// permission gating, and error mapping are tested without a database.
type fakeService struct {
	integration  Integration
	integrations []Integration
	err          error

	lastCreate CreateInput
	lastUpdate UpdateInput
	lastID     uuid.UUID
	deleted    bool
}

func (f *fakeService) Create(_ context.Context, tenantID uuid.UUID, in CreateInput) (Integration, error) {
	f.lastCreate = in
	if f.err != nil {
		return Integration{}, f.err
	}
	out := f.integration
	out.TenantID = tenantID
	return out, nil
}
func (f *fakeService) Get(_ context.Context, _, id uuid.UUID) (Integration, error) {
	f.lastID = id
	return f.integration, f.err
}
func (f *fakeService) List(_ context.Context, _ uuid.UUID) ([]Integration, error) {
	return f.integrations, f.err
}
func (f *fakeService) Update(_ context.Context, _, id uuid.UUID, in UpdateInput) (Integration, error) {
	f.lastID = id
	f.lastUpdate = in
	return f.integration, f.err
}
func (f *fakeService) Delete(_ context.Context, _, id uuid.UUID) error {
	f.lastID = id
	f.deleted = true
	return f.err
}
func (f *fakeService) TestConnection(_ context.Context, _, id uuid.UUID) (Integration, error) {
	f.lastID = id
	return f.integration, f.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func newTestRouter(svc integrationsService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_Create_Created(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	svc := &fakeService{integration: Integration{ID: id, Name: "primary", Vendor: "netapp_ontap"}}
	router := newTestRouter(svc)

	body := `{"name":"primary","kind":"storage_array","vendor":"netapp_ontap","endpoint":"https://array","enabled":true,"credentials":{"username":"svc","token":"s3cr3t"}}`
	req := httptest.NewRequest(http.MethodPost, "/integrations", strings.NewReader(body))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastCreate.Vendor != "netapp_ontap" || svc.lastCreate.Credentials.Token != "s3cr3t" {
		t.Fatalf("create input not threaded through: %+v", svc.lastCreate)
	}
	// The response must never echo the secret back.
	if strings.Contains(rec.Body.String(), "s3cr3t") {
		t.Fatalf("response leaked credential: %s", rec.Body.String())
	}
}

func TestRouter_Create_Forbidden_WithoutAdmin(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	router := newTestRouter(&fakeService{})
	req := httptest.NewRequest(http.MethodPost, "/integrations", strings.NewReader(`{"name":"x","kind":"kubernetes","vendor":"k8s"}`))
	req = withUser(req, tenantID, "viewer") // dr:read, not dr:admin
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_Create_ValidationError(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	router := newTestRouter(&fakeService{err: ErrValidation})
	req := httptest.NewRequest(http.MethodPost, "/integrations", strings.NewReader(`{"name":"x","kind":"bogus","vendor":"k8s"}`))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRouter_Create_Conflict(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	router := newTestRouter(&fakeService{err: ErrAlreadyExists})
	req := httptest.NewRequest(http.MethodPost, "/integrations", strings.NewReader(`{"name":"dup","kind":"kubernetes","vendor":"k8s","endpoint":"x"}`))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestRouter_List_OK(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	svc := &fakeService{integrations: []Integration{{ID: uuid.New(), Vendor: "aws_backup", Kind: KindCloudVault}}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/integrations", nil)
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []Integration `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 || env.Data[0].Vendor != "aws_backup" {
		t.Fatalf("data = %+v", env.Data)
	}
}

func TestRouter_Get_NotFound(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	router := newTestRouter(&fakeService{err: ErrNotFound})
	req := httptest.NewRequest(http.MethodGet, "/integrations/"+uuid.NewString(), nil)
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_Get_BadID(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	router := newTestRouter(&fakeService{})
	req := httptest.NewRequest(http.MethodGet, "/integrations/not-a-uuid", nil)
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRouter_Update_OK(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	svc := &fakeService{integration: Integration{ID: id, Status: StatusConfigured}}
	router := newTestRouter(svc)

	body := `{"name":"renamed","kind":"kubernetes","vendor":"k8s","endpoint":"https://api","enabled":false,"credentials":{"token":"rotated"}}`
	req := httptest.NewRequest(http.MethodPut, "/integrations/"+id.String(), strings.NewReader(body))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastID != id || svc.lastUpdate.Name != "renamed" {
		t.Fatalf("update not threaded: id=%s in=%+v", svc.lastID, svc.lastUpdate)
	}
}

func TestRouter_Delete_NoContent(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	svc := &fakeService{}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodDelete, "/integrations/"+id.String(), nil)
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if !svc.deleted || svc.lastID != id {
		t.Fatalf("delete not invoked for %s", id)
	}
}

func TestRouter_Test_OK(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	svc := &fakeService{integration: Integration{ID: id, Status: StatusActive}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/integrations/"+id.String()+"/test", nil)
	req = withUser(req, tenantID, "tenant_admin") // tenant_admin has dr:write
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastID != id {
		t.Fatalf("test not invoked for %s", id)
	}
}

func TestRouter_Test_Forbidden_ForReadOnly(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	router := newTestRouter(&fakeService{})
	req := httptest.NewRequest(http.MethodPost, "/integrations/"+id.String()+"/test", nil)
	req = withUser(req, tenantID, "viewer") // dr:read only
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_Test_ConnectorMissing_Conflict(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	id := uuid.New()
	router := newTestRouter(&fakeService{err: ErrConnectorMissing})
	req := httptest.NewRequest(http.MethodPost, "/integrations/"+id.String()+"/test", nil)
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestRouter_Unauthorized_NoTenant(t *testing.T) {
	t.Parallel()
	router := newTestRouter(&fakeService{})
	req := httptest.NewRequest(http.MethodGet, "/integrations", nil)
	// No user/tenant context, but grant the permission so the gate passes and we
	// reach the tenant check. Permission middleware needs a user; attach one
	// without a tenant id.
	user := &auth.ContextUser{ID: uuid.NewString(), Roles: []string{"viewer"}}
	req = req.WithContext(auth.WithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
}
