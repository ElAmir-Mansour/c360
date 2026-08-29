package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// recordingInstanceRepo captures how the handler queried the store so the tests
// can assert the viewer scope, and serves a single instance for the control-path
// ownership checks.
type recordingInstanceRepo struct {
	instance    *model.WorkflowInstance
	viewerSeen  *repository.InstanceViewer
	viewerCalls int
}

func (r *recordingInstanceRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	return r.instance, nil
}

func (r *recordingInstanceRepo) List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	return r.ListForViewer(ctx, tenantID, nil, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
}

func (r *recordingInstanceRepo) ListForViewer(_ context.Context, _ string, viewer *repository.InstanceViewer, _, _, _ string, _, _ *time.Time, _, _ string, _, _ int) ([]*model.WorkflowInstance, int, error) {
	r.viewerSeen = viewer
	r.viewerCalls++
	return []*model.WorkflowInstance{}, 0, nil
}

func (r *recordingInstanceRepo) GetStepExecutions(_ context.Context, _ string) ([]*model.StepExecution, error) {
	return nil, nil
}

func (r *recordingInstanceRepo) UpdateVariables(_ context.Context, _, _ string, _ map[string]interface{}) error {
	return nil
}

// countingEngine records whether a control action actually reached the engine.
type countingEngine struct {
	cancelled int
	retried   int
}

func (e *countingEngine) StartInstance(_ context.Context, _, _ string, _ dto.StartInstanceRequest) (*model.WorkflowInstance, error) {
	return nil, nil
}
func (e *countingEngine) CancelInstance(_ context.Context, _, _ string) error {
	e.cancelled++
	return nil
}
func (e *countingEngine) RetryInstance(_ context.Context, _, _ string) error {
	e.retried++
	return nil
}
func (e *countingEngine) SuspendInstance(_ context.Context, _, _ string) error { return nil }
func (e *countingEngine) ResumeInstance(_ context.Context, _, _ string) error  { return nil }
func (e *countingEngine) GetHistory(_ context.Context, _, _ string) ([]*model.StepExecution, error) {
	return nil, nil
}

func instanceRequest(method, target, instanceID string, user *auth.ContextUser) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", instanceID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = auth.WithUser(ctx, user)
	return req.WithContext(ctx)
}

func strptr(s string) *string { return &s }

// A business persona (workflow:write via the legal authoring tier, no operator
// verb) must not receive the tenant's whole process log: the list has to be
// scoped to instances they are involved in.
func TestListScopesNonOperatorsToTheirOwnInstances(t *testing.T) {
	repo := &recordingInstanceRepo{}
	h := NewInstanceHandler(&countingEngine{}, repo, nil, zerolog.Nop())

	req := httptest.NewRequest(http.MethodGet, "/?page=1", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "user-contracts-manager",
		TenantID: "tenant-1",
		Roles:    []string{"legal-contracts-manager"},
	}))
	rec := httptest.NewRecorder()

	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if repo.viewerSeen == nil {
		t.Fatal("a non-operator listing must carry a viewer scope")
	}
	if repo.viewerSeen.UserID != "user-contracts-manager" {
		t.Fatalf("viewer user = %q, want the caller", repo.viewerSeen.UserID)
	}
	if len(repo.viewerSeen.Roles) == 0 {
		t.Fatal("viewer roles must be passed through so role-routed task involvement resolves")
	}
}

// An operator still needs the unscoped tenant view to run the engine.
func TestListLeavesOperatorsUnscoped(t *testing.T) {
	repo := &recordingInstanceRepo{}
	h := NewInstanceHandler(&countingEngine{}, repo, nil, zerolog.Nop())

	req := httptest.NewRequest(http.MethodGet, "/?page=1", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "user-admin",
		TenantID: "tenant-1",
		Roles:    []string{"tenant_admin"},
	}))
	rec := httptest.NewRecorder()

	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if repo.viewerCalls != 1 {
		t.Fatalf("list calls = %d, want 1", repo.viewerCalls)
	}
	if repo.viewerSeen != nil {
		t.Fatalf("an operator listing must stay unscoped, got viewer %+v", repo.viewerSeen)
	}
}

// workflow:write authorizes controlling processes, not controlling ANY process:
// a section manager must not be able to cancel another department's run.
func TestCancelRefusedForInstanceTheCallerDidNotStart(t *testing.T) {
	engine := &countingEngine{}
	repo := &recordingInstanceRepo{instance: &model.WorkflowInstance{
		ID:        "instance-1",
		TenantID:  "tenant-1",
		Status:    "running",
		StartedBy: strptr("user-someone-else"),
	}}
	h := NewInstanceHandler(engine, repo, nil, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Cancel(rec, instanceRequest(http.MethodPost, "/instance-1/cancel", "instance-1", &auth.ContextUser{
		ID:       "user-contracts-manager",
		TenantID: "tenant-1",
		Roles:    []string{"legal-contracts-manager"},
	}))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if engine.cancelled != 0 {
		t.Fatal("the engine must not be reached for an unauthorized cancel")
	}
}

func TestCancelAllowedForTheStarter(t *testing.T) {
	engine := &countingEngine{}
	repo := &recordingInstanceRepo{instance: &model.WorkflowInstance{
		ID:        "instance-1",
		TenantID:  "tenant-1",
		Status:    "running",
		StartedBy: strptr("user-contracts-manager"),
	}}
	h := NewInstanceHandler(engine, repo, nil, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Cancel(rec, instanceRequest(http.MethodPost, "/instance-1/cancel", "instance-1", &auth.ContextUser{
		ID:       "user-contracts-manager",
		TenantID: "tenant-1",
		Roles:    []string{"legal-contracts-manager"},
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if engine.cancelled != 1 {
		t.Fatalf("engine cancels = %d, want 1", engine.cancelled)
	}
}

func TestRetryAllowedForOperatorOnAnyInstance(t *testing.T) {
	engine := &countingEngine{}
	repo := &recordingInstanceRepo{instance: &model.WorkflowInstance{
		ID:        "instance-1",
		TenantID:  "tenant-1",
		Status:    "failed",
		StartedBy: strptr("user-someone-else"),
	}}
	h := NewInstanceHandler(engine, repo, nil, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Retry(rec, instanceRequest(http.MethodPost, "/instance-1/retry", "instance-1", &auth.ContextUser{
		ID:       "user-admin",
		TenantID: "tenant-1",
		Roles:    []string{"tenant_admin"},
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if engine.retried != 1 {
		t.Fatalf("engine retries = %d, want 1", engine.retried)
	}
}

// A system-started instance (started_by NULL) has no owner, so only an operator
// may control it — the ownership check must fail closed, not open.
func TestControlRefusedForSystemStartedInstance(t *testing.T) {
	engine := &countingEngine{}
	repo := &recordingInstanceRepo{instance: &model.WorkflowInstance{
		ID:       "instance-1",
		TenantID: "tenant-1",
		Status:   "running",
	}}
	h := NewInstanceHandler(engine, repo, nil, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Cancel(rec, instanceRequest(http.MethodPost, "/instance-1/cancel", "instance-1", &auth.ContextUser{
		ID:       "user-contracts-manager",
		TenantID: "tenant-1",
		Roles:    []string{"legal-contracts-manager"},
	}))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if engine.cancelled != 0 {
		t.Fatal("the engine must not be reached for an unauthorized cancel")
	}
}
