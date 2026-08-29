package iacdr

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

// fakeIacService implements iacService so the router's HTTP wiring, permission
// gating and error mapping are tested without a database.
type fakeIacService struct {
	snap      *Snapshot
	snaps     []Snapshot
	diff      DiffResult
	plan      ReconstitutionPlan
	ingestErr error
	getErr    error
	diffErr   error
	planErr   error

	lastIngest   IngestRequest
	lastDiffBase string
}

func (f *fakeIacService) Ingest(_ context.Context, _ uuid.UUID, req IngestRequest) (*Snapshot, error) {
	f.lastIngest = req
	if f.ingestErr != nil {
		return nil, f.ingestErr
	}
	return f.snap, nil
}
func (f *fakeIacService) GetSnapshot(_ context.Context, _ uuid.UUID, _ string) (*Snapshot, error) {
	return f.snap, f.getErr
}
func (f *fakeIacService) ListSnapshots(_ context.Context, _ uuid.UUID) ([]Snapshot, error) {
	return f.snaps, nil
}
func (f *fakeIacService) Diff(_ context.Context, _ uuid.UUID, _, baseID string) (DiffResult, error) {
	f.lastDiffBase = baseID
	return f.diff, f.diffErr
}
func (f *fakeIacService) ReconstitutionPlan(_ context.Context, _ uuid.UUID, _ string) (ReconstitutionPlan, error) {
	return f.plan, f.planErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_Ingest_OK(t *testing.T) {
	svc := &fakeIacService{snap: &Snapshot{ID: uuid.NewString(), Name: "prod", Version: 1, SourceKind: SourceTerraformState}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := `{"name":"prod","source_kind":"terraform_state","artifact":"{\"version\":4}"}`
	req := httptest.NewRequest(http.MethodPost, "/iac-snapshots", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // dr:write

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastIngest.Name != "prod" || svc.lastIngest.SourceKind != SourceTerraformState {
		t.Errorf("ingest req not propagated: %+v", svc.lastIngest)
	}
	if string(svc.lastIngest.Artifact) != `{"version":4}` {
		t.Errorf("artifact not decoded: %q", svc.lastIngest.Artifact)
	}
}

func TestRouter_Ingest_Base64Artifact(t *testing.T) {
	svc := &fakeIacService{snap: &Snapshot{ID: uuid.NewString()}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	// "hello" base64 = aGVsbG8=
	body := `{"name":"p","source_kind":"helm_release","artifact_base64":"aGVsbG8="}`
	req := httptest.NewRequest(http.MethodPost, "/iac-snapshots", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if string(svc.lastIngest.Artifact) != "hello" {
		t.Errorf("base64 artifact not decoded: %q", svc.lastIngest.Artifact)
	}
}

func TestRouter_Ingest_Forbidden_WithoutWrite(t *testing.T) {
	svc := &fakeIacService{snap: &Snapshot{}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := `{"name":"p","source_kind":"terraform_state","artifact":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/iac-snapshots", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // only dr:read

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Ingest_BadRequestMissingArtifact(t *testing.T) {
	svc := &fakeIacService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := `{"name":"p","source_kind":"terraform_state"}`
	req := httptest.NewRequest(http.MethodPost, "/iac-snapshots", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_GetSnapshot_NotFound(t *testing.T) {
	svc := &fakeIacService{getErr: ErrSnapshotNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/iac-snapshots/"+uuid.NewString(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Diff_RequiresAgainst(t *testing.T) {
	svc := &fakeIacService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/iac-snapshots/"+uuid.NewString()+"/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (missing against); body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Diff_OK(t *testing.T) {
	base := uuid.NewString()
	svc := &fakeIacService{diff: DiffResult{
		Added: []ResourceDiff{{Key: ResourceKey{Provider: "aws", Type: "aws_vpc", Name: "x"}, Change: ChangeAdded}},
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/iac-snapshots/"+uuid.NewString()+"/diff?against="+base, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastDiffBase != base {
		t.Errorf("against not propagated: %q", svc.lastDiffBase)
	}
}

func TestRouter_ReconstitutionPlan_Cycle409(t *testing.T) {
	svc := &fakeIacService{planErr: ErrCycle}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/iac-snapshots/"+uuid.NewString()+"/reconstitution-plan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (cycle); body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_ListSnapshots(t *testing.T) {
	svc := &fakeIacService{snaps: []Snapshot{{ID: uuid.NewString(), Name: "a"}, {ID: uuid.NewString(), Name: "b"}}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/iac-snapshots", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			Count int `json:"count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	if body.Data.Count != 2 {
		t.Errorf("count = %d, want 2", body.Data.Count)
	}
}
