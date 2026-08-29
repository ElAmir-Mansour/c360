package registry

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

// fakeRunbookService implements runbookService so the router's HTTP wiring,
// permission gating and error mapping are tested without a database.
type fakeRunbookService struct {
	getVersion  *RunbookVersion
	getErr      error
	listResult  []*RunbookVersion
	listErr     error
	regenResult RegenerateResult
	regenErr    error

	lastGroupID string
	lastProfile string
	lastTrigger string
}

func (f *fakeRunbookService) GetOrGenerate(_ context.Context, _ uuid.UUID, groupID, profile string) (*RunbookVersion, error) {
	f.lastGroupID = groupID
	f.lastProfile = profile
	return f.getVersion, f.getErr
}

func (f *fakeRunbookService) ListVersions(_ context.Context, _ uuid.UUID, groupID string) ([]*RunbookVersion, error) {
	f.lastGroupID = groupID
	return f.listResult, f.listErr
}

func (f *fakeRunbookService) Regenerate(_ context.Context, _ uuid.UUID, groupID, profile, trigger string) (RegenerateResult, error) {
	f.lastGroupID = groupID
	f.lastProfile = profile
	f.lastTrigger = trigger
	return f.regenResult, f.regenErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_GetRunbook(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{
		getVersion: &RunbookVersion{Version: 3, GroupID: groupID.String(), Steps: []RunbookStep{{Key: "pin_recovery_point", Order: 1}}},
	}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/runbook?profile=isolated", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // analyst has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID != groupID.String() {
		t.Errorf("groupID = %q, want %q", svc.lastGroupID, groupID.String())
	}
	if svc.lastProfile != "isolated" {
		t.Errorf("profile = %q, want isolated", svc.lastProfile)
	}
	var resp struct {
		Data RunbookVersion `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Version != 3 {
		t.Errorf("version = %d, want 3", resp.Data.Version)
	}
}

func TestRouter_GetRunbook_NotFound(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{getErr: ErrGroupNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/runbook", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_GetRunbook_NoAssetsConflict(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{getErr: ErrNoAssets}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/runbook", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_ListVersions(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{listResult: []*RunbookVersion{{Version: 2}, {Version: 1}}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/runbook/versions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "viewer")) // viewer has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data []RunbookVersion `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data) != 2 || resp.Data[0].Version != 2 {
		t.Errorf("versions = %+v, want newest-first [2,1]", resp.Data)
	}
}

func TestRouter_Regenerate(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{
		regenResult: RegenerateResult{
			Version: &RunbookVersion{Version: 4},
			Changed: true,
			Diff:    &RunbookDiff{Added: []string{"boot_member:x"}},
		},
	}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/runbook/regenerate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:write

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTrigger != TriggerManual {
		t.Errorf("trigger = %q, want %q", svc.lastTrigger, TriggerManual)
	}
	var resp struct {
		Data struct {
			Version RunbookVersion `json:"version"`
			Changed bool           `json:"changed"`
			Diff    RunbookDiff    `json:"diff"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Data.Changed || resp.Data.Version.Version != 4 {
		t.Errorf("regenerate response = %+v", resp.Data)
	}
	if len(resp.Data.Diff.Added) != 1 {
		t.Errorf("diff.added = %v, want 1", resp.Data.Diff.Added)
	}
}

func TestRouter_Regenerate_ForbiddenWithoutWrite(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeRunbookService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/runbook/regenerate", nil)
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:write -> 403.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID != "" {
		t.Error("service must not be reached when permission is denied")
	}
}

func TestRouter_BadGroupID(t *testing.T) {
	svc := &fakeRunbookService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/not-a-uuid/runbook", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
