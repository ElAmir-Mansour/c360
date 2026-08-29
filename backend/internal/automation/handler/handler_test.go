package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
	"github.com/clario360/platform/internal/automation/trigger"
	"github.com/clario360/platform/internal/config"
)

const (
	testTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	testUser   = "bbbbbbbb-0000-0000-0000-000000000002"
)

// =============================================================================
// Fakes for the Service / ManualInvoker / WebhookHandler seams
// =============================================================================

type fakeService struct {
	mu sync.Mutex

	automations map[string]*model.Automation
	runbooks    map[string]*model.Runbook
	runs        map[string]*service.RunWithLog
	gates       map[string]*model.ApprovalGate // runID -> resolved gate

	created    *model.Automation
	updated    *model.Automation
	deletedID  string
	replayedID string
	replayRun  *model.Run

	// programmable error to return from the next call.
	err error
	// non-replayable signal for Replay.
	nonReplayable bool
}

func newFakeService() *fakeService {
	return &fakeService{
		automations: map[string]*model.Automation{},
		runbooks:    map[string]*model.Runbook{},
		runs:        map[string]*service.RunWithLog{},
		gates:       map[string]*model.ApprovalGate{},
	}
}

func (f *fakeService) CreateAutomation(_ context.Context, tenantID string, a *model.Automation) (*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	a.ID = "auto-1"
	a.TenantID = tenantID
	f.created = a
	f.automations[a.ID] = a
	return a, nil
}

func (f *fakeService) GetAutomationByID(_ context.Context, tenantID, id string) (*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	a, ok := f.automations[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	return a, nil
}

func (f *fakeService) ListAutomations(_ context.Context, tenantID string) ([]*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	var out []*model.Automation
	for _, a := range f.automations {
		out = append(out, a)
	}
	return out, nil
}

func (f *fakeService) UpdateAutomation(_ context.Context, tenantID, id string, a *model.Automation) (*model.Automation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	a.ID = id
	f.updated = a
	f.automations[id] = a
	return a, nil
}

func (f *fakeService) DeleteAutomation(_ context.Context, tenantID, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.deletedID = id
	delete(f.automations, id)
	return nil
}

func (f *fakeService) CreateRunbook(_ context.Context, tenantID string, rb *model.Runbook) (*model.Runbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	rb.ID = "rb-1"
	rb.TenantID = tenantID
	f.runbooks[rb.ID] = rb
	return rb, nil
}

func (f *fakeService) GetRunbookByID(_ context.Context, tenantID, id string) (*model.Runbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	rb, ok := f.runbooks[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	return rb, nil
}

func (f *fakeService) ListRuns(_ context.Context, tenantID string, limit, offset int) ([]*model.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	var out []*model.Run
	for _, rl := range f.runs {
		out = append(out, rl.Run)
	}
	return out, nil
}

func (f *fakeService) GetRunWithLog(_ context.Context, tenantID, runID string) (*service.RunWithLog, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	rl, ok := f.runs[runID]
	if !ok {
		return nil, model.ErrNotFound
	}
	return rl, nil
}

func (f *fakeService) ApproveRun(_ context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	g := &model.ApprovalGate{RunID: runID, TenantID: tenantID, Status: model.GateStatusApproved}
	f.gates[runID] = g
	return g, nil
}

func (f *fakeService) RejectRun(_ context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	g := &model.ApprovalGate{RunID: runID, TenantID: tenantID, Status: model.GateStatusRejected}
	f.gates[runID] = g
	return g, nil
}

func (f *fakeService) Replay(_ context.Context, tenantID, originalID string) (*model.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nonReplayable {
		return nil, service.ErrNonReplayable
	}
	if f.err != nil {
		return nil, f.err
	}
	f.replayedID = originalID
	rof := originalID
	f.replayRun = &model.Run{ID: "replay-1", TenantID: tenantID, ReplayOf: &rof, Status: model.RunStatusPending}
	return f.replayRun, nil
}

type fakeInvoker struct {
	mu           sync.Mutex
	called       bool
	automationID string
	userID       string
	body         map[string]any
	err          error
}

func (f *fakeInvoker) Invoke(_ context.Context, tenantID, automationID, userID string, body map[string]any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.called = true
	f.automationID = automationID
	f.userID = userID
	f.body = body
	return nil
}

type fakeWebhook struct {
	mu     sync.Mutex
	token  string
	status int // status to write
}

func (f *fakeWebhook) HandleToken(w http.ResponseWriter, _ *http.Request, token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.token = token
	status := f.status
	if status == 0 {
		status = http.StatusAccepted
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"accepted": status == http.StatusAccepted, "token": token}})
}

// =============================================================================
// Test harness: a real JWT manager + a fully-wired chi router.
// =============================================================================

type harness struct {
	router  chi.Router
	svc     *fakeService
	invoker *fakeInvoker
	webhook *fakeWebhook
	jwt     *auth.JWTManager
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	jwt, err := auth.NewJWTManager(config.AuthConfig{
		JWTIssuer:       "test",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}
	svc := newFakeService()
	invoker := &fakeInvoker{}
	webhook := &fakeWebhook{}
	h := New(svc, invoker, webhook, zerolog.Nop())
	r := chi.NewRouter()
	RegisterRoutes(r, h, jwt)
	return &harness{router: r, svc: svc, invoker: invoker, webhook: webhook, jwt: jwt}
}

// token mints an access token for a role (the role's permission set decides
// 200 vs 403). tenant_admin has all automation perms; viewer has read only.
func (h *harness) token(t *testing.T, role string) string {
	t.Helper()
	pair, err := h.jwt.GenerateTokenPair(testUser, testTenant, "user@test.dev", []string{role}, "sess-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair: %v", err)
	}
	return pair.AccessToken
}

// do issues a request with an optional bearer token and JSON body.
func (h *harness) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

// =============================================================================
// CRUD
// =============================================================================

func TestCreateAutomation_OK(t *testing.T) {
	h := newHarness(t)
	body := automationRequest{
		Name:      "watch",
		Enabled:   true,
		RunbookID: "rb-1",
		Trigger:   model.TriggerConfig{Type: model.TriggerTypeManual},
	}
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations", h.token(t, "tenant_admin"), body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if h.svc.created == nil || h.svc.created.Name != "watch" {
		t.Fatalf("service did not receive the create: %+v", h.svc.created)
	}
	if h.svc.created.CreatedBy != testUser {
		t.Fatalf("expected created_by from token, got %q", h.svc.created.CreatedBy)
	}
}

func TestCreateAutomation_Forbidden_ReadOnlyRole(t *testing.T) {
	h := newHarness(t)
	body := automationRequest{Name: "x", RunbookID: "rb-1", Trigger: model.TriggerConfig{Type: model.TriggerTypeManual}}
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations", h.token(t, "viewer"), body)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer write, got %d", rec.Code)
	}
	if h.svc.created != nil {
		t.Fatal("service create should not run when forbidden")
	}
}

func TestCreateAutomation_Unauthenticated(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations", "", automationRequest{Name: "x"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a token, got %d", rec.Code)
	}
}

func TestCreateAutomation_ValidationError(t *testing.T) {
	h := newHarness(t)
	h.svc.err = model.ErrInvalidConfig
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations", h.token(t, "tenant_admin"),
		automationRequest{Name: "x", RunbookID: "rb", Trigger: model.TriggerConfig{Type: model.TriggerTypeManual}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid config, got %d", rec.Code)
	}
}

func TestListAndGetAutomation_OK(t *testing.T) {
	h := newHarness(t)
	h.svc.automations["auto-9"] = &model.Automation{ID: "auto-9", TenantID: testTenant, Name: "n9"}

	rec := h.do(t, http.MethodGet, "/api/v1/automation/automations", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 list for viewer, got %d", rec.Code)
	}
	rec = h.do(t, http.MethodGet, "/api/v1/automation/automations/auto-9", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 get for viewer, got %d", rec.Code)
	}
	rec = h.do(t, http.MethodGet, "/api/v1/automation/automations/ghost", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown automation, got %d", rec.Code)
	}
}

func TestUpdateAndDeleteAutomation(t *testing.T) {
	h := newHarness(t)
	h.svc.automations["auto-9"] = &model.Automation{ID: "auto-9", TenantID: testTenant}

	rec := h.do(t, http.MethodPut, "/api/v1/automation/automations/auto-9", h.token(t, "tenant_admin"),
		automationRequest{Name: "renamed", RunbookID: "rb-1", Trigger: model.TriggerConfig{Type: model.TriggerTypeManual}})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 update, got %d: %s", rec.Code, rec.Body.String())
	}
	if h.svc.updated == nil || h.svc.updated.Name != "renamed" {
		t.Fatalf("update not received: %+v", h.svc.updated)
	}

	rec = h.do(t, http.MethodDelete, "/api/v1/automation/automations/auto-9", h.token(t, "tenant_admin"), nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 delete, got %d", rec.Code)
	}
	if h.svc.deletedID != "auto-9" {
		t.Fatalf("delete not received, got %q", h.svc.deletedID)
	}

	rec = h.do(t, http.MethodDelete, "/api/v1/automation/automations/auto-9", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 delete for viewer, got %d", rec.Code)
	}
}

// =============================================================================
// Manual invoke
// =============================================================================

func TestInvokeAutomation_OK(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations/auto-1/invoke", h.token(t, "tenant_admin"),
		invokeRequest{Data: map[string]any{"reason": "manual run"}})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	if !h.invoker.called || h.invoker.automationID != "auto-1" {
		t.Fatalf("invoker not called correctly: %+v", h.invoker)
	}
	if h.invoker.userID != testUser {
		t.Fatalf("expected invoker user from token, got %q", h.invoker.userID)
	}
	if h.invoker.body["reason"] != "manual run" {
		t.Fatalf("expected invoke body forwarded, got %+v", h.invoker.body)
	}
}

func TestInvokeAutomation_Forbidden(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/automations/auto-1/invoke", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 invoke for viewer, got %d", rec.Code)
	}
	if h.invoker.called {
		t.Fatal("invoker must not run when forbidden")
	}
}

// =============================================================================
// Runbooks
// =============================================================================

func TestCreateAndGetRunbook(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runbooks", h.token(t, "tenant_admin"),
		runbookRequest{Name: "rb", Steps: []model.RunbookStep{{Type: model.StepTypeAction, Action: model.ActionRef{Kind: model.ActionNotification}}}})
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 runbook, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = h.do(t, http.MethodGet, "/api/v1/automation/runbooks/rb-1", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 get runbook, got %d", rec.Code)
	}
}

// =============================================================================
// Runs + execution log
// =============================================================================

func TestListAndGetRun_WithLog(t *testing.T) {
	h := newHarness(t)
	h.svc.runs["run-1"] = &service.RunWithLog{
		Run:        &model.Run{ID: "run-1", TenantID: testTenant, Status: model.RunStatusCompleted, CurrentStep: 2},
		Steps:      []*model.RunStep{{RunID: "run-1", Index: 0, Status: model.StepStatusOK}, {RunID: "run-1", Index: 1, Status: model.StepStatusOK}},
		Replayable: true,
		GapAt:      -1,
	}

	rec := h.do(t, http.MethodGet, "/api/v1/automation/runs", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 list runs, got %d", rec.Code)
	}

	rec = h.do(t, http.MethodGet, "/api/v1/automation/runs/run-1", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 get run, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data service.RunWithLog `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data.Steps) != 2 || !resp.Data.Replayable {
		t.Fatalf("expected run+log with 2 steps replayable, got %+v", resp.Data)
	}
}

// =============================================================================
// Approval gate decisions
// =============================================================================

func TestApproveRun_OK_RequiresApprovePermission(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-1/approve", h.token(t, "tenant_admin"),
		decisionRequest{Comment: "lgtm"})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 approve, got %d: %s", rec.Code, rec.Body.String())
	}
	if g := h.svc.gates["run-1"]; g == nil || g.Status != model.GateStatusApproved {
		t.Fatalf("expected approved gate recorded, got %+v", g)
	}
}

func TestApproveRun_Forbidden_WriteRoleLacksApprove(t *testing.T) {
	h := newHarness(t)
	// viewer has neither approve nor write; assert the approve gate specifically
	// rejects a non-approver.
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-1/approve", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 approve for viewer, got %d", rec.Code)
	}
}

func TestRejectRun_OK(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-1/reject", h.token(t, "tenant_admin"),
		decisionRequest{Comment: "nope"})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 reject, got %d", rec.Code)
	}
	if g := h.svc.gates["run-1"]; g == nil || g.Status != model.GateStatusRejected {
		t.Fatalf("expected rejected gate, got %+v", g)
	}
}

func TestDecide_ConflictMapsTo409(t *testing.T) {
	h := newHarness(t)
	h.svc.err = model.ErrConflict
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-1/approve", h.token(t, "tenant_admin"), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a conflict, got %d", rec.Code)
	}
}

// =============================================================================
// Replay
// =============================================================================

func TestReplay_OK(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-done/replay", h.token(t, "tenant_admin"), nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 replay, got %d: %s", rec.Code, rec.Body.String())
	}
	if h.svc.replayedID != "run-done" {
		t.Fatalf("expected replay of run-done, got %q", h.svc.replayedID)
	}
	var resp struct {
		Data model.Run `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.ReplayOf == nil || *resp.Data.ReplayOf != "run-done" {
		t.Fatalf("expected replay_of lineage in response, got %+v", resp.Data)
	}
}

func TestReplay_NonReplayableMapsTo409(t *testing.T) {
	h := newHarness(t)
	h.svc.nonReplayable = true
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-x/replay", h.token(t, "tenant_admin"), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a non-replayable run, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReplay_Forbidden(t *testing.T) {
	h := newHarness(t)
	rec := h.do(t, http.MethodPost, "/api/v1/automation/runs/run-x/replay", h.token(t, "viewer"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 replay for viewer, got %d", rec.Code)
	}
}

// =============================================================================
// Webhook (token-auth, NO JWT)
// =============================================================================

func TestWebhook_ValidToken_NoJWT(t *testing.T) {
	h := newHarness(t)
	// No Authorization header at all — the webhook route must accept it.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automation/webhooks/secret-token-123",
		bytes.NewReader([]byte(`{"alert":"fire"}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 from webhook, got %d: %s", rec.Code, rec.Body.String())
	}
	if h.webhook.token != "secret-token-123" {
		t.Fatalf("expected token forwarded, got %q", h.webhook.token)
	}
}

func TestWebhook_UnknownToken_404(t *testing.T) {
	h := newHarness(t)
	h.webhook.status = http.StatusNotFound // the source answers 404 for an unknown token
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automation/webhooks/ghost-token", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown webhook token, got %d", rec.Code)
	}
}

func TestWebhook_IgnoresBearerToken(t *testing.T) {
	h := newHarness(t)
	// Even a garbage bearer token must not block the webhook route (it is not
	// behind the Auth middleware). The webhook source still accepts it.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/automation/webhooks/tok", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Authorization", "Bearer not-a-real-jwt")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected webhook to accept regardless of bearer header, got %d", rec.Code)
	}
}

// Compile-time proof the production service + trigger sources satisfy the
// handler seams (a signature drift fails here, at the wiring point).
var (
	_ Service        = (*service.AutomationService)(nil)
	_ ManualInvoker  = (*trigger.ManualSource)(nil)
	_ WebhookHandler = (*trigger.WebhookSource)(nil)
)
