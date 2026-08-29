package gameday

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

// fakeGamedayService implements gamedayService so the router's HTTP wiring,
// permission gating and error mapping are tested without a database.
type fakeGamedayService struct {
	scenario  *Scenario
	scenarios []*Scenario
	createErr error
	listErr   error
	card      *Scorecard
	execErr   error
	getErr    error

	lastInput      CreateScenarioInput
	lastScenarioID string
	lastRunID      string
}

func (f *fakeGamedayService) CreateScenario(_ context.Context, _ uuid.UUID, in CreateScenarioInput) (*Scenario, error) {
	f.lastInput = in
	return f.scenario, f.createErr
}

func (f *fakeGamedayService) ListScenarios(_ context.Context, _ uuid.UUID) ([]*Scenario, error) {
	return f.scenarios, f.listErr
}

func (f *fakeGamedayService) ExecuteScenario(_ context.Context, _ uuid.UUID, scenarioID string, _ *uuid.UUID) (*Scorecard, error) {
	f.lastScenarioID = scenarioID
	return f.card, f.execErr
}

func (f *fakeGamedayService) GetScorecard(_ context.Context, _ uuid.UUID, runID string) (*Scorecard, error) {
	f.lastRunID = runID
	return f.card, f.getErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_CreateScenario_Created(t *testing.T) {
	svc := &fakeGamedayService{scenario: &Scenario{ID: "sc-1", Name: "n", Scope: ScopeDrill}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	payload := `{"group_id":"` + uuid.New().String() + `","name":"pause-lag","scope":"drill","steps":[{"action":"pause_stream","target":"s1","expect":{"signal":"lag_alert","detect_within":"30s"}}]}`
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:write

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastInput.Name != "pause-lag" || svc.lastInput.Scope != ScopeDrill {
		t.Fatalf("input not propagated: %+v", svc.lastInput)
	}
	if len(svc.lastInput.Steps) != 1 || svc.lastInput.Steps[0].Action != ActionPauseStream {
		t.Fatalf("steps not decoded: %+v", svc.lastInput.Steps)
	}
	if svc.lastInput.Steps[0].Expect.DetectWithin.Std().String() != "30s" {
		t.Fatalf("detect_within not decoded: %v", svc.lastInput.Steps[0].Expect.DetectWithin.Std())
	}
}

func TestRouter_CreateScenario_RequiresWrite(t *testing.T) {
	router := newRouter(&fakeGamedayService{}, zerolog.Nop()).Routes()
	payload := `{"group_id":"x","name":"n","scope":"drill","steps":[]}`
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read only
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (analyst lacks dr:write)", rec.Code)
	}
}

func TestRouter_CreateScenario_ProductionScopeRejected422(t *testing.T) {
	svc := &fakeGamedayService{createErr: ErrProductionScope}
	router := newRouter(svc, zerolog.Nop()).Routes()
	payload := `{"group_id":"` + uuid.New().String() + `","name":"n","scope":"production","steps":[{"action":"pause_stream"}]}`
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 for production scope; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_ListScenarios(t *testing.T) {
	svc := &fakeGamedayService{scenarios: []*Scenario{{ID: "a"}, {ID: "b"}}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/gameday/scenarios", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []*Scenario `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("scenarios = %d, want 2", len(body.Data))
	}
}

func TestRouter_ExecuteScenario_RequiresFailoverPermission(t *testing.T) {
	router := newRouter(&fakeGamedayService{}, zerolog.Nop()).Routes()
	scenarioID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios/"+scenarioID.String()+"/runs", nil)
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:failover — executing a gated chaos exercise
	// must be refused.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (analyst lacks dr:failover)", rec.Code)
	}
}

func TestRouter_ExecuteScenario_OK(t *testing.T) {
	score := 1.0
	svc := &fakeGamedayService{card: &Scorecard{
		Run:   &Run{ID: "run-1", Status: RunStatusPassed, Score: &score},
		Steps: []*StepResult{{StepIndex: 0, Passed: true}},
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	scenarioID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios/"+scenarioID.String()+"/runs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:failover

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastScenarioID != scenarioID.String() {
		t.Fatalf("scenario id not propagated: %q", svc.lastScenarioID)
	}
}

func TestRouter_ExecuteScenario_ProductionScopeRejected422WithScorecard(t *testing.T) {
	svc := &fakeGamedayService{
		card:    &Scorecard{Run: &Run{ID: "run-x", Status: RunStatusAborted, SafetyVerdict: SafetyRejectedProduction}},
		execErr: ErrProductionScope,
	}
	router := newRouter(svc, zerolog.Nop()).Routes()
	scenarioID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/gameday/scenarios/"+scenarioID.String()+"/runs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "rejected_production") {
		t.Fatalf("body should carry the rejection verdict scorecard: %s", rec.Body.String())
	}
}

func TestRouter_GetScorecard_OK(t *testing.T) {
	svc := &fakeGamedayService{card: &Scorecard{Run: &Run{ID: "run-1", Status: RunStatusPassed}}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	runID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/gameday/runs/"+runID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastRunID != runID.String() {
		t.Fatalf("run id not propagated: %q", svc.lastRunID)
	}
}

func TestRouter_GetScorecard_NotFound(t *testing.T) {
	svc := &fakeGamedayService{getErr: ErrRunNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()
	runID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/gameday/runs/"+runID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
