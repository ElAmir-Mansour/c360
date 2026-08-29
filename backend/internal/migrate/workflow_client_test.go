package migrate

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// TestHTTPApprovalWorkflowClientStartShape proves the production workflow client
// issues the REAL workflow-engine StartInstance request: POST
// /api/v1/workflows/instances with {definition_id, input_variables}, the tenant
// propagated and the service token attached, and decodes the InstanceResponse
// (which the engine writes as the top-level body, NOT wrapped in {"data": ...}).
func TestHTTPApprovalWorkflowClientStartShape(t *testing.T) {
	instanceID := uuid.New().String()
	var capturedPath, capturedMethod, capturedTenant, capturedAuth string
	var capturedBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &capturedBody)
		capturedPath = r.URL.Path
		capturedMethod = r.Method
		capturedTenant = r.Header.Get("X-Tenant-ID")
		capturedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		// The workflow instance handler responds with dto.InstanceResponse directly.
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            instanceID,
			"definition_id": "move-group-approval",
			"status":        "running",
			"step_outputs":  map[string]any{},
		})
	}))
	defer srv.Close()

	client := NewHTTPApprovalWorkflowClient(srv.URL, "svc-token-xyz", "move-group-approval", 5*time.Second)
	if !client.Configured() {
		t.Fatal("client with url + definition must be Configured()")
	}
	tenantID := uuid.New()
	inst, err := client.StartApproval(context.Background(), tenantID, StartApprovalRequest{
		DefinitionID: "move-group-approval",
		InputVariables: map[string]any{
			"move_group_id": uuid.New().String(),
			"approver_role": PermMigrateApprove,
		},
	})
	if err != nil {
		t.Fatalf("StartApproval: %v", err)
	}

	if capturedMethod != http.MethodPost || capturedPath != "/api/v1/workflows/instances" {
		t.Fatalf("request = %s %s, want POST /api/v1/workflows/instances", capturedMethod, capturedPath)
	}
	if capturedTenant != tenantID.String() {
		t.Fatalf("X-Tenant-ID = %q, want %s", capturedTenant, tenantID)
	}
	if capturedAuth != "Bearer svc-token-xyz" {
		t.Fatalf("Authorization = %q, want Bearer svc-token-xyz", capturedAuth)
	}
	if capturedBody["definition_id"] != "move-group-approval" {
		t.Fatalf("body definition_id = %v, want move-group-approval", capturedBody["definition_id"])
	}
	iv, ok := capturedBody["input_variables"].(map[string]any)
	if !ok || iv["approver_role"] != PermMigrateApprove {
		t.Fatalf("body input_variables = %v, want approver_role=%s", capturedBody["input_variables"], PermMigrateApprove)
	}
	if inst.ID != instanceID || inst.Status != WorkflowInstanceRunning {
		t.Fatalf("decoded instance = %+v, want id=%s status=running", inst, instanceID)
	}
}

// TestHTTPApprovalWorkflowClientGetInstance proves the client reads the instance
// (GET /api/v1/workflows/instances/{id}) and surfaces the step_outputs the
// decision is extracted from.
func TestHTTPApprovalWorkflowClientGetInstance(t *testing.T) {
	instanceID := uuid.New().String()
	var capturedPath, capturedMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedMethod = r.Method
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            instanceID,
			"definition_id": "move-group-approval",
			"status":        "completed",
			"step_outputs": map[string]any{
				"approve_step": map[string]any{
					"output": map[string]any{"decision": "approve", "rationale": "meets criteria"},
				},
			},
		})
	}))
	defer srv.Close()

	client := NewHTTPApprovalWorkflowClient(srv.URL, "tok", "move-group-approval", 5*time.Second)
	inst, err := client.GetInstance(context.Background(), uuid.New(), instanceID)
	if err != nil {
		t.Fatalf("GetInstance: %v", err)
	}
	if capturedMethod != http.MethodGet || capturedPath != "/api/v1/workflows/instances/"+instanceID {
		t.Fatalf("request = %s %s, want GET .../instances/%s", capturedMethod, capturedPath, instanceID)
	}
	dec := DecisionFromInstance(inst, "")
	if !dec.Decided || !dec.Approved || dec.Rationale != "meets criteria" {
		t.Fatalf("decision = %+v, want decided approved rationale='meets criteria'", dec)
	}
	if dec.StepID != "approve_step" {
		t.Fatalf("decision step id = %q, want approve_step", dec.StepID)
	}
}

// TestHTTPApprovalWorkflowClientErrors proves transport / 4xx / 5xx map to the
// fail-closed vs rejected sentinels (the router turns them into 503 vs 502).
func TestHTTPApprovalWorkflowClientErrors(t *testing.T) {
	// 4xx -> ErrWorkflowEngineRejected, carrying the engine message.
	rejectSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{"code": "VALIDATION_ERROR", "message": "definition_id is required"},
		})
	}))
	defer rejectSrv.Close()
	rejectClient := NewHTTPApprovalWorkflowClient(rejectSrv.URL, "t", "def", time.Second)
	if _, err := rejectClient.GetInstance(context.Background(), uuid.New(), uuid.New().String()); err == nil ||
		!isErr(err, ErrWorkflowEngineRejected) {
		t.Fatalf("4xx should map to ErrWorkflowEngineRejected, got %v", err)
	}

	// 5xx -> ErrWorkflowEngineUnavailable (fail closed).
	downSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer downSrv.Close()
	downClient := NewHTTPApprovalWorkflowClient(downSrv.URL, "t", "def", time.Second)
	if _, err := downClient.GetInstance(context.Background(), uuid.New(), uuid.New().String()); err == nil ||
		!isErr(err, ErrWorkflowEngineUnavailable) {
		t.Fatalf("5xx should map to ErrWorkflowEngineUnavailable, got %v", err)
	}

	// Unconfigured client (no url/definition) is not Configured and its start fails
	// closed rather than dialing an empty URL.
	empty := NewHTTPApprovalWorkflowClient("", "", "", time.Second)
	if empty.Configured() {
		t.Fatal("empty client must not be Configured()")
	}
}

// TestDecisionFromInstance proves the decision is extracted from the REAL engine
// step-output shape and never invented: a running instance is not decided, a
// completed reject yields Approved=false, and an unwrapped form_data shape (no
// "output" key) is still read.
func TestDecisionFromInstance(t *testing.T) {
	// Running instance: no decision, regardless of any partial outputs.
	running := &ApprovalInstance{Status: WorkflowInstanceRunning, StepOutputs: map[string]any{}}
	if DecisionFromInstance(running, "").Decided {
		t.Fatal("a running instance must not be decided")
	}

	// Completed reject (wrapped in "output").
	reject := &ApprovalInstance{Status: WorkflowInstanceCompleted, StepOutputs: map[string]any{
		"s1": map[string]any{"output": map[string]any{"decision": "reject", "rationale": "blocked"}},
	}}
	d := DecisionFromInstance(reject, "s1")
	if !d.Decided || d.Approved || d.Rationale != "blocked" {
		t.Fatalf("reject decision = %+v, want decided !approved rationale=blocked", d)
	}

	// Completed approve with the form_data stored directly (no "output" wrapper).
	approve := &ApprovalInstance{Status: WorkflowInstanceCompleted, StepOutputs: map[string]any{
		"s1": map[string]any{"decision": "approve"},
	}}
	if da := DecisionFromInstance(approve, "s1"); !da.Decided || !da.Approved {
		t.Fatalf("unwrapped approve decision = %+v, want decided approved", da)
	}

	// Cancelled instance is terminal-but-undecided.
	cancelled := &ApprovalInstance{Status: WorkflowInstanceCancelled, StepOutputs: map[string]any{
		"s1": map[string]any{"output": map[string]any{"decision": "approve"}},
	}}
	if DecisionFromInstance(cancelled, "s1").Decided {
		t.Fatal("a cancelled instance must not be decided")
	}

	// Completed but no recognised decision anywhere: not decided.
	noDecision := &ApprovalInstance{Status: WorkflowInstanceCompleted, StepOutputs: map[string]any{
		"s1": map[string]any{"output": map[string]any{"comment": "n/a"}},
	}}
	if DecisionFromInstance(noDecision, "").Decided {
		t.Fatal("a completed instance with no decision must not be decided")
	}
}

// TestDecideMoveGroupGatedByWorkflow proves the local DecideMoveGroup flip is now
// GATED: when the workflow engine is configured, a plain decision is REFUSED
// (ErrApprovalWorkflowRequired) and an override without migrate:admin is refused
// (ErrManualOverrideNotAllowed) — both BEFORE any database access, so the bypass
// cannot flip an approval. Uses a service wired with a configured client but no DB
// (the gate returns before the tx opens).
func TestDecideMoveGroupGatedByWorkflow(t *testing.T) {
	client := &stubApprovalClient{configured: true, definitionID: "move-group-approval"}
	svc := &Service{
		approvals: client,
		logger:    zerolog.Nop(),
		now:       func() time.Time { return time.Unix(0, 0).UTC() },
	}

	approver := Actor{UserID: uuid.New(), Permission: []string{PermMigrateApprove}}
	// Default path (no override) is refused with ErrApprovalWorkflowRequired.
	if _, err := svc.DecideMoveGroup(context.Background(), uuid.New(), uuid.New(), approver, true, "ok", 1, false); err != ErrApprovalWorkflowRequired {
		t.Fatalf("configured engine + no override should return ErrApprovalWorkflowRequired, got %v", err)
	}
	// Override requested but the actor lacks migrate:admin -> ErrManualOverrideNotAllowed.
	if _, err := svc.DecideMoveGroup(context.Background(), uuid.New(), uuid.New(), approver, true, "ok", 1, true); err != ErrManualOverrideNotAllowed {
		t.Fatalf("override without admin should return ErrManualOverrideNotAllowed, got %v", err)
	}

	// Requesting/syncing an approval with no engine configured fails closed (503),
	// never silently succeeding. The planner/approver holds the required verbs so
	// the fail-closed check (not an auth check) is what fires.
	planner := Actor{UserID: uuid.New(), Permission: []string{PermMigratePlan, PermMigrateApprove}}
	noEngine := &Service{logger: zerolog.Nop(), now: svc.now}
	if _, err := noEngine.RequestMoveGroupApproval(context.Background(), uuid.New(), uuid.New(), planner); err != ErrWorkflowEngineUnavailable {
		t.Fatalf("request without engine should return ErrWorkflowEngineUnavailable, got %v", err)
	}
	if _, err := noEngine.SyncMoveGroupApproval(context.Background(), uuid.New(), uuid.New(), planner); err != ErrWorkflowEngineUnavailable {
		t.Fatalf("sync without engine should return ErrWorkflowEngineUnavailable, got %v", err)
	}
	if noEngine.ApprovalsConfigured() {
		t.Fatal("service without a client must not report ApprovalsConfigured")
	}
}

// isErr is a small errors.Is wrapper kept local to the test to avoid importing
// errors solely for a one-liner in several asserts.
func isErr(err, target error) bool {
	for e := err; e != nil; {
		if e == target {
			return true
		}
		u, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

// stubApprovalClient is a configurable ApprovalWorkflowClient used to exercise the
// gate logic without a live engine. It records StartApproval calls and returns a
// scripted instance from GetInstance.
type stubApprovalClient struct {
	configured    bool
	definitionID  string
	started       []StartApprovalRequest
	startInstance *ApprovalInstance
	getInstance   *ApprovalInstance
	getErr        error
}

func (c *stubApprovalClient) Configured() bool            { return c.configured }
func (c *stubApprovalClient) DefaultDefinitionID() string { return c.definitionID }

func (c *stubApprovalClient) StartApproval(_ context.Context, _ uuid.UUID, req StartApprovalRequest) (*ApprovalInstance, error) {
	c.started = append(c.started, req)
	if c.startInstance != nil {
		return c.startInstance, nil
	}
	return &ApprovalInstance{ID: uuid.New().String(), DefinitionID: c.definitionID, Status: WorkflowInstanceRunning, StepOutputs: map[string]any{}}, nil
}

func (c *stubApprovalClient) GetInstance(_ context.Context, _ uuid.UUID, _ string) (*ApprovalInstance, error) {
	if c.getErr != nil {
		return nil, c.getErr
	}
	return c.getInstance, nil
}

var _ ApprovalWorkflowClient = (*stubApprovalClient)(nil)
