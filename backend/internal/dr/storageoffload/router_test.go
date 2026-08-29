package storageoffload

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

// fakeOffloadService implements offloadService so the router's HTTP wiring,
// permission gating, and error mapping are tested without a database.
type fakeOffloadService struct {
	volume    *Volume
	volumes   []*Volume
	snapshot  *Snapshot
	snapshots []*Snapshot
	err       error

	lastVolumeID   uuid.UUID
	lastSnapshotID uuid.UUID
	lastTarget     string
	lastRegistered *Volume
}

func (f *fakeOffloadService) RegisterVolume(_ context.Context, v *Volume) (*Volume, error) {
	f.lastRegistered = v
	if f.err != nil {
		return nil, f.err
	}
	return f.volume, nil
}
func (f *fakeOffloadService) GetVolume(_ context.Context, _, id uuid.UUID) (*Volume, error) {
	f.lastVolumeID = id
	return f.volume, f.err
}
func (f *fakeOffloadService) ListVolumes(_ context.Context, _ uuid.UUID) ([]*Volume, error) {
	return f.volumes, f.err
}
func (f *fakeOffloadService) RequestSnapshot(_ context.Context, _, volumeID uuid.UUID) (*Snapshot, error) {
	f.lastVolumeID = volumeID
	return f.snapshot, f.err
}
func (f *fakeOffloadService) GetSnapshot(_ context.Context, _, id uuid.UUID) (*Snapshot, error) {
	f.lastSnapshotID = id
	return f.snapshot, f.err
}
func (f *fakeOffloadService) ListSnapshots(_ context.Context, _, volumeID uuid.UUID) ([]*Snapshot, error) {
	f.lastVolumeID = volumeID
	return f.snapshots, f.err
}
func (f *fakeOffloadService) RequestReplication(_ context.Context, _, snapshotID uuid.UUID, target string) (*Snapshot, error) {
	f.lastSnapshotID = snapshotID
	f.lastTarget = target
	return f.snapshot, f.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func newTestRouter(svc offloadService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_RegisterVolume_Created(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	volID := uuid.New()
	svc := &fakeOffloadService{volume: &Volume{ID: volID, TenantID: tenantID, Name: "v"}}
	router := newTestRouter(svc)

	body := `{"name":"v","provider":"file","array_endpoint":"/snaps","source_location":"/data"}`
	req := httptest.NewRequest(http.MethodPost, "/storage-volumes", strings.NewReader(body))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastRegistered == nil || svc.lastRegistered.Name != "v" || svc.lastRegistered.SourceLocation != "/data" {
		t.Fatalf("registered volume = %+v", svc.lastRegistered)
	}
}

func TestRouter_RegisterVolume_Forbidden_WithoutAdmin(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	svc := &fakeOffloadService{}
	router := newTestRouter(svc)
	// viewer has dr:read but not dr:admin.
	req := httptest.NewRequest(http.MethodPost, "/storage-volumes", strings.NewReader(`{"name":"v","source_location":"/d"}`))
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_RequestSnapshot_Accepted(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	volID := uuid.New()
	snapID := uuid.New()
	svc := &fakeOffloadService{snapshot: &Snapshot{ID: snapID, VolumeID: volID, State: StatePending, Kind: SnapshotKindFull}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/storage-volumes/"+volID.String()+"/snapshots", nil)
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastVolumeID != volID {
		t.Fatalf("lastVolumeID = %s, want %s", svc.lastVolumeID, volID)
	}
}

func TestRouter_ListSnapshots_OK(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	volID := uuid.New()
	svc := &fakeOffloadService{snapshots: []*Snapshot{{ID: uuid.New(), VolumeID: volID, State: StateReady}}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/storage-volumes/"+volID.String()+"/snapshots", nil)
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []Snapshot `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 {
		t.Fatalf("data len = %d, want 1", len(env.Data))
	}
}

func TestRouter_Replicate_RequiresTarget(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	snapID := uuid.New()
	svc := &fakeOffloadService{snapshot: &Snapshot{ID: snapID}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/storage-snapshots/"+snapID.String()+"/replicate", strings.NewReader(`{}`))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (missing target)", rec.Code)
	}
}

func TestRouter_Replicate_Accepted(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	snapID := uuid.New()
	svc := &fakeOffloadService{snapshot: &Snapshot{ID: snapID, State: StateReplicating}}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/storage-snapshots/"+snapID.String()+"/replicate", strings.NewReader(`{"target":"dr://site-2/vol"}`))
	req = withUser(req, tenantID, "tenant_admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTarget != "dr://site-2/vol" {
		t.Fatalf("lastTarget = %q", svc.lastTarget)
	}
}

func TestRouter_GetSnapshot_NotFound(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	snapID := uuid.New()
	svc := &fakeOffloadService{err: ErrNotFound}
	router := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/storage-snapshots/"+snapID.String(), nil)
	req = withUser(req, tenantID, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
