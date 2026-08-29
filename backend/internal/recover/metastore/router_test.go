package metastore

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

// fakeRegistry implements registryAPI so the router's HTTP wiring, permission
// gating, and error mapping are tested without a database.
type fakeRegistry struct {
	app     *Application
	page    ListPage
	err     error
	created *Application
}

func (f *fakeRegistry) ResolveApplication(_ context.Context, _ uuid.UUID, _ string) (*Application, error) {
	return f.app, f.err
}
func (f *fakeRegistry) ListApplications(_ context.Context, _ uuid.UUID, _, _ int) (ListPage, error) {
	return f.page, f.err
}
func (f *fakeRegistry) CreateApplication(_ context.Context, _ uuid.UUID, _ ApplicationInput) (*Application, error) {
	return f.created, f.err
}
func (f *fakeRegistry) UpdateApplication(_ context.Context, _ uuid.UUID, _ string, _ ApplicationInput) (*Application, error) {
	return f.app, f.err
}
func (f *fakeRegistry) DeleteApplication(_ context.Context, _ uuid.UUID, _ string) error {
	return f.err
}

// fakePopulator implements populatorAPI.
type fakePopulator struct {
	res     *PopulateResult
	sync    *SyncResult
	popErr  error
	syncErr error
}

func (f *fakePopulator) Populate(_ context.Context, _ uuid.UUID, _ string, _ *string) (*PopulateResult, error) {
	return f.res, f.popErr
}
func (f *fakePopulator) Sync(_ context.Context, _ uuid.UUID, _, _ string) (*SyncResult, error) {
	return f.sync, f.syncErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func testRouter(reg registryAPI, pop populatorAPI) http.Handler {
	return newRouter(reg, pop, zerolog.Nop()).Routes()
}

func TestRouter_ListApplications_OK(t *testing.T) {
	reg := &fakeRegistry{page: ListPage{Applications: []Application{{ID: "a1", AppKey: "core"}}, Total: 1}}
	router := testRouter(reg, &fakePopulator{})

	req := httptest.NewRequest(http.MethodGet, "/metastore/applications", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []Application       `json:"data"`
		Meta struct{ Total int } `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 || env.Meta.Total != 1 {
		t.Fatalf("unexpected payload: %s", rec.Body.String())
	}
}

func TestRouter_CreateApplication_OK(t *testing.T) {
	reg := &fakeRegistry{created: &Application{ID: "a1", AppKey: "core", MetadataRevision: 1}}
	router := testRouter(reg, &fakePopulator{})

	body := `{"app_key":"core","name":"Core","recovery_tier":"tier_1","rto_target_seconds":3600}`
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // dr:admin
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

// TestRouter_CreateApplication_AuthzDenied proves admin mutation is rejected for
// a read-only caller server-side (not merely hidden in the UI).
func TestRouter_CreateApplication_AuthzDenied(t *testing.T) {
	router := testRouter(&fakeRegistry{}, &fakePopulator{})
	body := `{"app_key":"core","name":"Core"}`
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read only — no dr:admin
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

// TestRouter_Populate_AuthzDenied proves the populate (dr:write) route rejects a
// caller without dr:write.
func TestRouter_Populate_AuthzDenied(t *testing.T) {
	router := testRouter(&fakeRegistry{}, &fakePopulator{res: &PopulateResult{}})
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications/a1/populate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read only — no dr:write
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_Populate_OK(t *testing.T) {
	pop := &fakePopulator{res: &PopulateResult{ApplicationID: "a1", RunbookID: "rb1", TaskCount: 5, SourceRevision: 1}}
	router := testRouter(&fakeRegistry{}, pop)
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications/a1/populate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // dr:write present
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Sync_OK(t *testing.T) {
	pop := &fakePopulator{sync: &SyncResult{ApplicationID: "a1", RunbookID: "rb1", Drifted: true, Kind: DriftStale}}
	router := testRouter(&fakeRegistry{}, pop)
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications/a1/runbooks/rb1/sync", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct{ Data SyncResult }
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !env.Data.Drifted || env.Data.Kind != DriftStale {
		t.Fatalf("unexpected sync payload: %s", rec.Body.String())
	}
}

func TestRouter_GetApplication_NotFound(t *testing.T) {
	router := testRouter(&fakeRegistry{err: ErrNotFound}, &fakePopulator{})
	req := httptest.NewRequest(http.MethodGet, "/metastore/applications/missing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_CreateApplication_InvalidBody(t *testing.T) {
	router := testRouter(&fakeRegistry{err: ErrInvalid}, &fakePopulator{})
	body := `{"app_key":"","name":""}`
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Populate_NoRecoveryTarget(t *testing.T) {
	router := testRouter(&fakeRegistry{}, &fakePopulator{popErr: ErrNoRecoveryTarget})
	req := httptest.NewRequest(http.MethodPost, "/metastore/applications/a1/populate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}
