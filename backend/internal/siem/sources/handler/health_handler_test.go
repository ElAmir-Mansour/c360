package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/sources"
)

func TestHealth_NotFound(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	req := httptest.NewRequest("GET", "/"+id.String()+"/health", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHealth_Cached(t *testing.T) {
	svc := newStubSvc()
	d := Deps{Service: svc}
	h := NewHealthHandler(d)
	id := uuid.New()
	tenant := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive, Name: "n"}

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/"+id.String()+"/health", nil)
		req = req.WithContext(auth.WithTenantID(context.Background(), tenant.String()))
		// inject chi URL param
		req = injectChiParam(req, "id", id.String())
		rec := httptest.NewRecorder()
		h.Health(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
	}
}

func injectChiParam(r *http.Request, k, v string) *http.Request {
	rctx := chiCtx(r)
	rctx.URLParams.Add(k, v)
	return r
}
