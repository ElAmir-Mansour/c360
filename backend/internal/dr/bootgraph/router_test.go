package bootgraph

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

// fakeBootService implements bootService so the router's HTTP wiring, permission
// gating and error mapping are tested without a database.
type fakeBootService struct {
	plan      BootPlan
	planErr   error
	defineErr error
	runDetail RunDetail
	runErr    error
	getErr    error

	lastGroupID string
	lastSpecs   []ServiceSpec
	lastPolicy  string
	lastRunID   string
}

func (f *fakeBootService) DefineServices(_ context.Context, _ uuid.UUID, groupID string, specs []ServiceSpec) (BootPlan, error) {
	f.lastGroupID = groupID
	f.lastSpecs = specs
	if f.defineErr != nil {
		return BootPlan{}, f.defineErr
	}
	return f.plan, nil
}

func (f *fakeBootService) GetPlan(_ context.Context, _ uuid.UUID, groupID string) (BootPlan, error) {
	f.lastGroupID = groupID
	return f.plan, f.planErr
}

func (f *fakeBootService) StartRun(_ context.Context, _ uuid.UUID, groupID, policy string, _ *string) (RunDetail, error) {
	f.lastGroupID = groupID
	f.lastPolicy = policy
	return f.runDetail, f.runErr
}

func (f *fakeBootService) GetRun(_ context.Context, _ uuid.UUID, runID string) (RunDetail, error) {
	f.lastRunID = runID
	if f.getErr != nil {
		return RunDetail{}, f.getErr
	}
	return f.runDetail, nil
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_GetPlan(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeBootService{
		plan: BootPlan{GroupID: groupID.String(), Tiers: [][]Service{
			{{ID: "s-db", Name: "db"}, {ID: "s-cache", Name: "cache"}},
			{{ID: "s-api", Name: "api"}},
		}},
	}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/boot-plan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // analyst has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID != groupID.String() {
		t.Fatalf("group id not propagated: %q", svc.lastGroupID)
	}
	var body struct {
		Data struct {
			TierCount int        `json:"tier_count"`
			TierNames [][]string `json:"tier_names"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if body.Data.TierCount != 2 {
		t.Fatalf("tier_count = %d, want 2", body.Data.TierCount)
	}
}

func TestRouter_DefineServices_RequiresWrite(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeBootService{plan: BootPlan{GroupID: groupID.String()}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	bodyJSON := `{"services":[{"name":"db","probe_kind":"tcp","probe_target":"db:5432"}]}`
	mk := func(roles ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/boot-services", strings.NewReader(bodyJSON))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, withUser(req, uuid.New(), roles...))
		return rec
	}

	// analyst lacks dr:write -> 403.
	if rec := mk("analyst"); rec.Code != http.StatusForbidden {
		t.Fatalf("analyst status = %d, want 403", rec.Code)
	}
	// tenant_admin has dr:write -> 201.
	if rec := mk("tenant_admin"); rec.Code != http.StatusCreated {
		t.Fatalf("tenant_admin status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if len(svc.lastSpecs) != 1 || svc.lastSpecs[0].Name != "db" {
		t.Fatalf("specs not propagated: %+v", svc.lastSpecs)
	}
}

func TestRouter_DefineServices_CycleIs409(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeBootService{defineErr: ErrCycle}
	router := newRouter(svc, zerolog.Nop()).Routes()

	bodyJSON := `{"services":[{"name":"a","probe_kind":"tcp","probe_target":"a:1","depends_on":["b"]},{"name":"b","probe_kind":"tcp","probe_target":"b:1","depends_on":["a"]}]}`
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/boot-services", strings.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("cycle status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_StartRun_RequiresFailover(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeBootService{runDetail: RunDetail{Run: BootRun{ID: "run-1", Status: RunStatusCompleted}}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	mk := func(roles ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/boot-runs", strings.NewReader(`{"policy":"rollback"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, withUser(req, uuid.New(), roles...))
		return rec
	}

	// analyst lacks dr:failover -> 403.
	if rec := mk("analyst"); rec.Code != http.StatusForbidden {
		t.Fatalf("analyst status = %d, want 403", rec.Code)
	}
	// tenant_admin has dr:failover -> 202.
	rec := mk("tenant_admin")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("tenant_admin status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastPolicy != PolicyRollback {
		t.Fatalf("policy not propagated: %q", svc.lastPolicy)
	}
}

func TestRouter_GetRun(t *testing.T) {
	runID := uuid.New()
	svc := &fakeBootService{runDetail: RunDetail{Run: BootRun{ID: runID.String(), Status: RunStatusCompleted}}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/boot-runs/"+runID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastRunID != runID.String() {
		t.Fatalf("run id not propagated: %q", svc.lastRunID)
	}
}

func TestRouter_GetRun_NotFoundIs404(t *testing.T) {
	runID := uuid.New()
	svc := &fakeBootService{getErr: ErrRunNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/boot-runs/"+runID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_DefineServices_EmptyBodyIs400(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeBootService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/boot-services", strings.NewReader(`{"services":[]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
