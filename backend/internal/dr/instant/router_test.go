package instant

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

// fakeInstantService implements instantService so the router's HTTP wiring,
// permission gating, and error mapping are tested without a database.
type fakeInstantService struct {
	startSess   *Session
	startErr    error
	progress    *Progress
	progressErr error
	readData    []byte
	readErr     error
	writeErr    error
	finalSess   *Session
	finalErr    error

	lastPointID uuid.UUID
	lastGroupID *uuid.UUID
	lastSession uuid.UUID
	lastIndex   int
	lastWrite   []byte
}

func (f *fakeInstantService) StartSession(_ context.Context, _ uuid.UUID, pointID uuid.UUID, groupID *uuid.UUID) (*Session, error) {
	f.lastPointID = pointID
	f.lastGroupID = groupID
	return f.startSess, f.startErr
}

func (f *fakeInstantService) GetProgress(_ context.Context, _ uuid.UUID, sessionID uuid.UUID) (*Progress, error) {
	f.lastSession = sessionID
	return f.progress, f.progressErr
}

func (f *fakeInstantService) ReadChunk(_ context.Context, _ uuid.UUID, sessionID uuid.UUID, i int) ([]byte, error) {
	f.lastSession = sessionID
	f.lastIndex = i
	return f.readData, f.readErr
}

func (f *fakeInstantService) WriteChunk(_ context.Context, _ uuid.UUID, sessionID uuid.UUID, i int, data []byte) error {
	f.lastSession = sessionID
	f.lastIndex = i
	f.lastWrite = append([]byte(nil), data...)
	return f.writeErr
}

func (f *fakeInstantService) BeginFinalize(_ context.Context, _ uuid.UUID, sessionID uuid.UUID) (*Session, error) {
	f.lastSession = sessionID
	return f.finalSess, f.finalErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func newTestRouter(svc instantService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_StartInstantRecovery(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	sess := &Session{ID: uuid.New(), State: StateHydrating, ChunksTotal: 10}
	svc := &fakeInstantService{startSess: sess}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/instant-recovery", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:failover

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastPointID != pointID {
		t.Fatalf("pointID = %s, want %s", svc.lastPointID, pointID)
	}
	var resp struct {
		Data Session `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.State != StateHydrating {
		t.Fatalf("state = %q, want HYDRATING", resp.Data.State)
	}
}

func TestRouter_StartWithGroupBody(t *testing.T) {
	t.Parallel()
	pointID := uuid.New()
	groupID := uuid.New()
	svc := &fakeInstantService{startSess: &Session{ID: uuid.New(), State: StateHydrating}}
	router := newTestRouter(svc)

	body := strings.NewReader(`{"group_id":"` + groupID.String() + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/instant-recovery", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID == nil || *svc.lastGroupID != groupID {
		t.Fatalf("group_id = %v, want %s", svc.lastGroupID, groupID)
	}
}

func TestRouter_StartForbiddenForReadOnlyRole(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{startSess: &Session{ID: uuid.New()}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/recovery-points/"+uuid.New().String()+"/instant-recovery", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read only, not dr:failover

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_GetSessionProgress(t *testing.T) {
	t.Parallel()
	sessionID := uuid.New()
	svc := &fakeInstantService{progress: &Progress{
		Session:         &Session{ID: sessionID, State: StateHydrating, ChunksTotal: 10, ChunksHydrated: 4},
		PercentComplete: 40,
	}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/instant-sessions/"+sessionID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read suffices

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data Progress `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.PercentComplete != 40 {
		t.Fatalf("percent = %v, want 40", resp.Data.PercentComplete)
	}
}

func TestRouter_ReadChunkReturnsRawBytes(t *testing.T) {
	t.Parallel()
	sessionID := uuid.New()
	svc := &fakeInstantService{readData: []byte("chunk-data")}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/instant-sessions/"+sessionID.String()+"/chunks/7", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "chunk-data" {
		t.Fatalf("body = %q, want raw chunk bytes", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Fatalf("content-type = %q, want application/octet-stream", ct)
	}
	if svc.lastSession != sessionID || svc.lastIndex != 7 {
		t.Fatalf("read called with session=%s index=%d", svc.lastSession, svc.lastIndex)
	}
}

func TestRouter_ReadChunkBadIndex(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{readData: []byte("unused")}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/instant-sessions/"+uuid.New().String()+"/chunks/-1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_WriteChunkRecordsRawBody(t *testing.T) {
	t.Parallel()
	sessionID := uuid.New()
	svc := &fakeInstantService{}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPut, "/instant-sessions/"+sessionID.String()+"/chunks/3", strings.NewReader("new-bytes"))
	req.Header.Set("Content-Type", "application/octet-stream")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastSession != sessionID || svc.lastIndex != 3 {
		t.Fatalf("write called with session=%s index=%d", svc.lastSession, svc.lastIndex)
	}
	if string(svc.lastWrite) != "new-bytes" {
		t.Fatalf("written body = %q, want new-bytes", string(svc.lastWrite))
	}
}

func TestRouter_WriteChunkForbiddenForReadOnlyRole(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPut, "/instant-sessions/"+uuid.New().String()+"/chunks/1", strings.NewReader("x"))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_FinalizeNotReadyConflict(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{finalErr: ErrNotReady}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/instant-sessions/"+uuid.New().String()+"/finalize", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_FinalizeAccepted(t *testing.T) {
	t.Parallel()
	sessionID := uuid.New()
	svc := &fakeInstantService{finalSess: &Session{ID: sessionID, State: StateFinalizing}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/instant-sessions/"+sessionID.String()+"/finalize", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_GetSessionNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{progressErr: ErrNotFound}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/instant-sessions/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_Unauthenticated(t *testing.T) {
	t.Parallel()
	svc := &fakeInstantService{progress: &Progress{Session: &Session{}}}
	router := newTestRouter(svc)

	// No user in context: RequirePermission rejects before the handler runs.
	req := httptest.NewRequest(http.MethodGet, "/instant-sessions/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("unauthenticated request should not succeed, got %d", rec.Code)
	}
}
