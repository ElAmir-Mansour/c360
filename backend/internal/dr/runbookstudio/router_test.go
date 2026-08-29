package runbookstudio

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

// fakeRouterService implements studioService so the router's HTTP wiring,
// permission gating, verb dispatch and error mapping are tested without a
// database.
type fakeRouterService struct {
	plan      Plan
	runbook   *Runbook
	task      *Task
	state     LiveState
	err       error
	lastRBID  string
	lastRunID string
	lastTask  string
	lastVerb  TaskAction
	lastInput AddTaskInput
}

func (f *fakeRouterService) CreateRunbook(_ context.Context, _ uuid.UUID, _ CreateRunbookInput) (*Runbook, []Task, error) {
	return f.runbook, f.plan.Tasks, f.err
}
func (f *fakeRouterService) GetRunbook(_ context.Context, _ uuid.UUID, id string) (Plan, error) {
	f.lastRBID = id
	return f.plan, f.err
}
func (f *fakeRouterService) UpdateRunbook(_ context.Context, _ uuid.UUID, id string, _ UpdateRunbookInput) (*Runbook, error) {
	f.lastRBID = id
	return f.runbook, f.err
}
func (f *fakeRouterService) AddTask(_ context.Context, _ uuid.UUID, id string, in AddTaskInput) (*Task, error) {
	f.lastRBID = id
	f.lastInput = in
	return f.task, f.err
}
func (f *fakeRouterService) StartRun(_ context.Context, _ uuid.UUID, id string, _ StartRunInput) (LiveState, error) {
	f.lastRBID = id
	return f.state, f.err
}
func (f *fakeRouterService) GetRun(_ context.Context, _ uuid.UUID, id string) (LiveState, error) {
	f.lastRunID = id
	return f.state, f.err
}
func (f *fakeRouterService) ActOnTask(_ context.Context, _ uuid.UUID, runID, taskID string, in ActOnTaskInput) (LiveState, error) {
	f.lastRunID = runID
	f.lastTask = taskID
	f.lastVerb = in.Action
	return f.state, f.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_CreateRunbook_RequiresWrite(t *testing.T) {
	router := newRouter(&fakeRouterService{}, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks", strings.NewReader(`{"name":"rb"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:write.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (analyst lacks dr:write)", rec.Code)
	}
}

func TestRouter_CreateRunbook_Created(t *testing.T) {
	svc := &fakeRouterService{runbook: &Runbook{ID: "rb-1", Name: "rb"}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks", strings.NewReader(`{"name":"rb"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:write
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_CreateRunbook_MissingName(t *testing.T) {
	router := newRouter(&fakeRouterService{}, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for missing name", rec.Code)
	}
}

func TestRouter_AddTask_CycleReturns409(t *testing.T) {
	svc := &fakeRouterService{err: ErrCycle}
	router := newRouter(svc, zerolog.Nop()).Routes()
	rbID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks/"+rbID.String()+"/tasks",
		strings.NewReader(`{"task_key":"x","name":"x","predecessors":["a"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 on cycle; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cycle") {
		t.Fatalf("body should mention cycle: %s", rec.Body.String())
	}
}

func TestRouter_AddTask_PropagatesInput(t *testing.T) {
	svc := &fakeRouterService{task: &Task{ID: "t-1"}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	rbID := uuid.New()
	body := `{"task_key":"boot","name":"Boot","task_type":"automated","planned_duration_seconds":120,"automation_action":"boot-vm","predecessors":["p1"]}`
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks/"+rbID.String()+"/tasks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastInput.TaskType != TaskTypeAutomated || svc.lastInput.PlannedDuration != 120 ||
		svc.lastInput.AutomationAction != "boot-vm" || len(svc.lastInput.Predecessors) != 1 {
		t.Fatalf("input not propagated: %+v", svc.lastInput)
	}
}

func TestRouter_StartRun_RequiresFailover(t *testing.T) {
	router := newRouter(&fakeRouterService{}, zerolog.Nop()).Routes()
	rbID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks/"+rbID.String()+"/runs", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:failover; the run endpoints require dr:failover.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (run start requires dr:failover)", rec.Code)
	}
}

func TestRouter_StartRun_Created(t *testing.T) {
	svc := &fakeRouterService{state: LiveState{Run: Run{ID: "run-1", Status: RunStatusRunning}, Frontier: []string{"A"}}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	rbID := uuid.New()
	// empty body is allowed (mode defaults to live).
	req := httptest.NewRequest(http.MethodPost, "/studio/runbooks/"+rbID.String()+"/runs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin", "super-admin"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_GetRun_LiveState(t *testing.T) {
	svc := &fakeRouterService{state: LiveState{
		Run:      Run{ID: "run-1", Status: RunStatusRunning, PlannedCriticalPathSeconds: 45},
		Frontier: []string{"A"},
		Projection: RunProjection{
			PlannedCriticalPathSeconds: 45, RemainingCriticalPathSeconds: 45, ProjectedFinishSeconds: 45, OnTrack: true,
		},
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	runID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/studio/runs/"+runID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastRunID != runID.String() {
		t.Fatalf("run id not propagated: %q", svc.lastRunID)
	}
	var body struct {
		Data LiveState `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.Data.Projection.PlannedCriticalPathSeconds != 45 || len(body.Data.Frontier) != 1 {
		t.Fatalf("live state not serialised: %+v", body.Data)
	}
}

func TestRouter_ActOnTask_VerbDispatch(t *testing.T) {
	runID := uuid.New()
	taskID := uuid.New()
	cases := []struct {
		verb string
		want TaskAction
	}{
		{"complete", ActionComplete},
		{"skip", ActionSkip},
		{"fail", ActionFail},
	}
	for _, tc := range cases {
		t.Run(tc.verb, func(t *testing.T) {
			svc := &fakeRouterService{state: LiveState{Run: Run{ID: runID.String(), Status: RunStatusRunning}}}
			router := newRouter(svc, zerolog.Nop()).Routes()
			path := "/studio/runs/" + runID.String() + "/tasks/" + taskID.String() + ":" + tc.verb
			req := httptest.NewRequest(http.MethodPost, path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if svc.lastVerb != tc.want {
				t.Fatalf("dispatched verb = %q, want %q", svc.lastVerb, tc.want)
			}
			if svc.lastTask != taskID.String() {
				t.Fatalf("task id not parsed: %q", svc.lastTask)
			}
		})
	}
}

func TestRouter_ActOnTask_NotRunnableReturns409(t *testing.T) {
	svc := &fakeRouterService{err: ErrTaskNotRunnable}
	router := newRouter(svc, zerolog.Nop()).Routes()
	runID := uuid.New()
	taskID := uuid.New()
	path := "/studio/runs/" + runID.String() + "/tasks/" + taskID.String() + ":complete"
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for not-runnable task; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_ActOnTask_BadVerb(t *testing.T) {
	router := newRouter(&fakeRouterService{}, zerolog.Nop()).Routes()
	runID := uuid.New()
	taskID := uuid.New()
	path := "/studio/runs/" + runID.String() + "/tasks/" + taskID.String() + ":launch"
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for unknown verb", rec.Code)
	}
}

func TestRouter_ActOnTask_MissingVerb(t *testing.T) {
	router := newRouter(&fakeRouterService{}, zerolog.Nop()).Routes()
	runID := uuid.New()
	taskID := uuid.New()
	// No ":verb" suffix.
	path := "/studio/runs/" + runID.String() + "/tasks/" + taskID.String()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for missing verb", rec.Code)
	}
}

func TestRouter_GetRunbook_NotFound(t *testing.T) {
	svc := &fakeRouterService{err: ErrNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()
	rbID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/studio/runbooks/"+rbID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
