package cyberrecovery

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

// fakeFlowService implements flowService so the router's HTTP wiring, permission
// gating, and error mapping are tested without a database or composed services.
type fakeFlowService struct {
	overview *Overview
	flow     *Flow
	events   []FlowEvent
	err      error
	calls    int
}

func (f *fakeFlowService) Overview(context.Context, uuid.UUID) (*Overview, error) {
	f.calls++
	return f.overview, f.err
}
func (f *fakeFlowService) ListCleanPoints(context.Context, uuid.UUID, int) ([]CleanPoint, error) {
	f.calls++
	return []CleanPoint{}, f.err
}
func (f *fakeFlowService) ListFlows(context.Context, uuid.UUID, int) ([]Flow, error) {
	f.calls++
	return []Flow{}, f.err
}
func (f *fakeFlowService) GetFlow(context.Context, uuid.UUID, uuid.UUID) (*Flow, []FlowEvent, error) {
	f.calls++
	return f.flow, f.events, f.err
}
func (f *fakeFlowService) SelectCleanPoint(context.Context, uuid.UUID, Actor, SelectCleanPointInput) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) Provision(context.Context, uuid.UUID, uuid.UUID, Actor) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) RunRecovery(context.Context, uuid.UUID, uuid.UUID, Actor, string) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) RunIntegrityCheck(context.Context, uuid.UUID, uuid.UUID, Actor) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) RequestApproval(context.Context, uuid.UUID, uuid.UUID, Actor) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) Approve(context.Context, uuid.UUID, uuid.UUID, Actor, string) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) ReturnToProduction(context.Context, uuid.UUID, uuid.UUID, Actor) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}
func (f *fakeFlowService) Abort(context.Context, uuid.UUID, uuid.UUID, Actor, string) (*Flow, error) {
	f.calls++
	return f.flow, f.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Email: "op@tenant.example", Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_Overview_RequiresRead(t *testing.T) {
	svc := &fakeFlowService{overview: &Overview{}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // analyst has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data Overview `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func TestRouter_Overview_Unauthenticated(t *testing.T) {
	svc := &fakeFlowService{overview: &Overview{}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/overview", nil) // no user context
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 denial", rec.Code)
	}
	if svc.calls != 0 {
		t.Error("service called for an unauthenticated request")
	}
}

// TestRouter_SelectCleanPoint_RequiresWrite proves the authz-denied path: a
// read-only role (viewer/analyst → dr:read only) cannot start a flow.
func TestRouter_SelectCleanPoint_RequiresWrite(t *testing.T) {
	svc := &fakeFlowService{flow: &Flow{ID: uuid.New()}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := strings.NewReader(`{"clean_point_id":"` + uuid.NewString() + `","target_label":"host"}`)
	req := httptest.NewRequest(http.MethodPost, "/flows", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read, NOT dr:write

	if rec.Code == http.StatusOK || rec.Code == http.StatusCreated {
		t.Fatalf("read-only role reached the write handler: status %d", rec.Code)
	}
	if svc.calls != 0 {
		t.Error("service should not have been called for an unauthorized request")
	}
}

// TestRouter_ReturnToProduction_RequiresFailover proves the most consequential
// action is gated: a read-only role cannot reach it.
func TestRouter_ReturnToProduction_RequiresFailover(t *testing.T) {
	svc := &fakeFlowService{flow: &Flow{ID: uuid.New(), Phase: PhaseReturnedToProduction}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/flows/"+uuid.NewString()+"/return-to-production", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "viewer")) // dr:read only

	if rec.Code == http.StatusOK {
		t.Fatalf("read-only role reached return-to-production: status %d", rec.Code)
	}
	if svc.calls != 0 {
		t.Error("service should not have been called for an unauthorized request")
	}
}

// TestRouter_ReturnToProduction_GateBlockMapsTo409 proves the HARD gate refusal
// surfaces as a 409 with the typed code (not a 500/stack trace).
func TestRouter_ReturnToProduction_GateBlockMapsTo409(t *testing.T) {
	svc := &fakeFlowService{err: ErrIntegrityGateNotPassed}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/flows/"+uuid.NewString()+"/return-to-production", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:failover

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "integrity_gate_not_passed") {
		t.Errorf("body = %s, want typed integrity_gate_not_passed code", rec.Body.String())
	}
}

// TestRouter_Approve_RequiresAdmin proves the approval sign-off is dr:admin
// gated (a write-but-not-admin role would be rejected; here analyst lacks it).
func TestRouter_Approve_RequiresAdmin(t *testing.T) {
	svc := &fakeFlowService{flow: &Flow{ID: uuid.New(), Phase: PhaseApproved}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/flows/"+uuid.NewString()+"/approve", strings.NewReader(`{"note":"ok"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // no dr:admin

	if rec.Code == http.StatusOK {
		t.Fatalf("analyst (no dr:admin) reached approve: status %d", rec.Code)
	}
}

func TestRouter_Approve_AdminAllowed(t *testing.T) {
	svc := &fakeFlowService{flow: &Flow{ID: uuid.New(), Phase: PhaseApproved}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/flows/"+uuid.NewString()+"/approve", strings.NewReader(`{"note":"ok"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:admin

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_SelectCleanPoint_BadBody(t *testing.T) {
	svc := &fakeFlowService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/flows", strings.NewReader(`{"clean_point_id":"not-a-uuid","target_label":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if svc.calls != 0 {
		t.Error("service called despite an invalid uuid")
	}
}
