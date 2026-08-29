package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/sources"
)

type stubSvc struct {
	mu        sync.Mutex
	bySource  map[uuid.UUID]*sources.Source
	created   bool
	updateErr error
	rotateErr error
	disabled  bool
}

func newStubSvc() *stubSvc {
	return &stubSvc{bySource: map[uuid.UUID]*sources.Source{}}
}

func (s *stubSvc) Onboard(_ context.Context, in sources.OnboardInput) (*sources.Source, *sources.EnrollmentToken, error) {
	if in.Name == "BAD" {
		return nil, nil, &sources.FieldErrors{Errors: []sources.FieldError{{Field: "name"}}}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New()
	src := &sources.Source{ID: id, TenantID: in.TenantID, Name: in.Name, Status: sources.StatusProvisioning, Version: 1, Tags: []byte("{}")}
	s.bySource[id] = src
	s.created = true
	return src, &sources.EnrollmentToken{JWT: "xx", JTI: uuid.New(), SourceID: id, TenantID: in.TenantID, Purpose: sources.PurposeEnroll, ExpiresAt: time.Now().Add(time.Minute)}, nil
}

func (s *stubSvc) Get(_ context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.bySource[id]
	if !ok || src.TenantID != tenantID {
		return nil, sources.ErrNotFound
	}
	return src, nil
}

func (s *stubSvc) List(_ context.Context, _ uuid.UUID, _ sources.ListQuery) (sources.ListResult, error) {
	return sources.ListResult{}, nil
}

func (s *stubSvc) Update(_ context.Context, tenantID, id uuid.UUID, _ sources.UpdateInput, _ int64) (*sources.Source, error) {
	if s.updateErr != nil {
		return nil, s.updateErr
	}
	return s.Get(context.Background(), tenantID, id)
}

func (s *stubSvc) Disable(_ context.Context, tenantID, id uuid.UUID, _ string, _ int64) (*sources.Source, error) {
	s.disabled = true
	return s.Get(context.Background(), tenantID, id)
}

func (s *stubSvc) Enable(_ context.Context, tenantID, id uuid.UUID, _ int64) (*sources.Source, error) {
	return s.Get(context.Background(), tenantID, id)
}

func (s *stubSvc) SoftDelete(_ context.Context, tenantID, id uuid.UUID, _ int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.bySource[id]
	if !ok || src.TenantID != tenantID {
		return sources.ErrNotFound
	}
	delete(s.bySource, id)
	return nil
}

func (s *stubSvc) RotateCert(_ context.Context, tenantID, id uuid.UUID, _ bool, _ int64) (*sources.EnrollmentToken, error) {
	if s.rotateErr != nil {
		return nil, s.rotateErr
	}
	return &sources.EnrollmentToken{JWT: "y", SourceID: id, TenantID: tenantID, Purpose: sources.PurposeRotate, ExpiresAt: time.Now().Add(time.Minute)}, nil
}

func (s *stubSvc) Health(_ context.Context, tenantID, id uuid.UUID) (*sources.Health, error) {
	if src, ok := s.bySource[id]; ok && src.TenantID == tenantID {
		return &sources.Health{ID: id, Name: src.Name, Status: src.Status}, nil
	}
	return nil, sources.ErrNotFound
}

func (s *stubSvc) RecordHeartbeat(_ context.Context, _ uuid.UUID, _ sources.EPSSample) error {
	return nil
}

type captureHub struct{}

func (captureHub) Publish(string, string, []byte) {}

func newTestRouter(svc *stubSvc) chi.Router {
	d := Deps{
		Service:       svc,
		Hub:           captureHub{},
		Logger:        zerolog.Nop(),
		AdminRequired: func(h http.Handler) http.Handler { return h },
		ReadRequired:  func(h http.Handler) http.Handler { return h },
	}
	return NewRouter(d)
}

func withTenant(r *http.Request, tenantID uuid.UUID) *http.Request {
	user := &auth.ContextUser{ID: uuid.New().String(), TenantID: tenantID.String(), Roles: []string{"tenant_admin"}}
	ctx := auth.WithUser(r.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return r.WithContext(ctx)
}

func TestCreate_201(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	body, _ := json.Marshal(map[string]any{"name": "fw-01", "type": "firewall", "transport": "syslog_udp", "address": "h:514"})
	req := httptest.NewRequest("POST", "/", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusCreated, rec.Code)
	require.True(t, svc.created)
}

func TestCreate_Validation(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	body, _ := json.Marshal(map[string]any{"name": "BAD"})
	req := httptest.NewRequest("POST", "/", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestGet_NotFound(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	req := httptest.NewRequest("GET", "/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGet_OK(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Name: "x", Status: sources.StatusActive}
	req := httptest.NewRequest("GET", "/"+id.String(), nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestPatch_MissingIfMatch(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	req := httptest.NewRequest("PATCH", "/"+id.String(), bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPatch_VersionMismatch(t *testing.T) {
	svc := newStubSvc()
	svc.updateErr = errors.New("mismatch: " + sources.ErrVersionMismatch.Error())
	// wrap so errors.Is works
	svc.updateErr = wrap(svc.updateErr, sources.ErrVersionMismatch)
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive}
	req := httptest.NewRequest("PATCH", "/"+id.String(), bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"3"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusPreconditionFailed, rec.Code)
}

// wrap is a tiny helper so test stubs return errors that match the
// sentinel chain.
func wrap(err, sentinel error) error {
	return wrappedErr{err: err, sentinel: sentinel}
}

type wrappedErr struct {
	err      error
	sentinel error
}

func (w wrappedErr) Error() string { return w.err.Error() }
func (w wrappedErr) Unwrap() error { return w.sentinel }

func TestDelete_NoContent(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant}
	req := httptest.NewRequest("DELETE", "/"+id.String(), nil)
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestDisable_Enable_Rotate(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive}

	// Disable
	req := httptest.NewRequest("POST", "/"+id.String()+"/disable", bytes.NewBufferString(`{"reason":"ops"}`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, svc.disabled)

	// Enable
	req = httptest.NewRequest("POST", "/"+id.String()+"/enable", nil)
	req.Header.Set("If-Match", `"1"`)
	rec = httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)

	// Rotate
	req = httptest.NewRequest("POST", "/"+id.String()+"/rotate-cert", bytes.NewBufferString(`{"force":false}`))
	rec = httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestHealth_Caches(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Name: "n", Status: sources.StatusActive}
	req := httptest.NewRequest("GET", "/"+id.String()+"/health", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestList_Empty(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestList_WithQueryParams(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	req := httptest.NewRequest("GET", "/?status=active&type=firewall&transport=syslog_udp&q=fw&tag.env=prod&limit=10", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestRotate_ForceWithoutAdmin_403(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive}

	body, _ := json.Marshal(map[string]any{"force": true})
	req := httptest.NewRequest("POST", "/"+id.String()+"/rotate-cert", bytes.NewBuffer(body))
	rec := httptest.NewRecorder()
	// Override the user to have only viewer role.
	user := &auth.ContextUser{ID: uuid.New().String(), TenantID: tenant.String(), Roles: []string{"viewer"}}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenant.String())
	rtr.ServeHTTP(rec, req.WithContext(ctx))
	require.Equal(t, http.StatusForbidden, rec.Code)
}

func TestGet_InvalidIDIsNotFound(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("GET", "/not-a-uuid", nil)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestCreate_BadJSON(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	req := httptest.NewRequest("POST", "/", bytes.NewBufferString("not-json"))
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, uuid.New()))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
