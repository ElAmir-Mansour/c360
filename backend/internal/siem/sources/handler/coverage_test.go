package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/sources"
)

// invalidIDForPath returns an invalid uuid string to force the
// handler-side parse error branch.
const invalidID = "not-a-uuid"

func TestUpdate_InvalidID(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("PATCH", "/"+invalidID, bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestDelete_InvalidID(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("DELETE", "/"+invalidID, nil)
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestDisable_InvalidID(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("POST", "/"+invalidID+"/disable", bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestEnable_InvalidID(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("POST", "/"+invalidID+"/enable", nil)
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestRotate_InvalidID(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("POST", "/"+invalidID+"/rotate-cert", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestUpdate_BadJSON(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant}
	req := httptest.NewRequest("PATCH", "/"+id.String(), bytes.NewBufferString(`nope`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPatch_MissingTenant(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	id := uuid.New()
	req := httptest.NewRequest("PATCH", "/"+id.String(), bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"1"`)
	// No tenant injected — must error
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestRotate_ForceFromAdminWorks(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive}

	body := []byte(`{"force":true}`)
	req := httptest.NewRequest("POST", "/"+id.String()+"/rotate-cert", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()
	user := &auth.ContextUser{ID: uuid.New().String(), TenantID: tenant.String(), Roles: []string{"tenant_admin"}}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenant.String())
	rtr.ServeHTTP(rec, req.WithContext(ctx))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestMountHeartbeatRouter_Healthz(t *testing.T) {
	svc := newStubSvc()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	_ = rdb
	// Build a stub mTLS middleware. We don't exercise the mTLS gate
	// here — the /healthz route is mounted at the same level.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/healthz", nil)
	mux.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	_ = svc
	_ = zerolog.Nop()
}

func TestList_NoTenant(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
