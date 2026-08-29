//go:build integration

package migrate

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeWorkflowEngine is an httptest-backed stand-in for the SHARED workflow engine.
// It implements the exact two endpoints migrate's approval client calls
// (POST /api/v1/workflows/instances, GET /api/v1/workflows/instances/{id}) and lets
// the test drive the instance from "running" to a terminal decision — so the full
// cross-service seam under test is the REAL migrate code (client + service + store),
// only the engine process is doubled at its true HTTP boundary.
type fakeWorkflowEngine struct {
	mu             sync.Mutex
	server         *httptest.Server
	startCalls     []map[string]any
	instanceID     string
	instanceStatus string
	stepOutputs    map[string]any
	definitionID   string
}

func newFakeWorkflowEngine(definitionID string) *fakeWorkflowEngine {
	f := &fakeWorkflowEngine{
		instanceID:     uuid.New().String(),
		instanceStatus: WorkflowInstanceRunning,
		stepOutputs:    map[string]any{},
		definitionID:   definitionID,
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.handle))
	return f
}

func (f *fakeWorkflowEngine) URL() string { return f.server.URL }
func (f *fakeWorkflowEngine) Close()      { f.server.Close() }

// decide moves the fake instance to a terminal completed state carrying the given
// decision (approve|reject) — as the engine would after the approver completes the
// human task.
func (f *fakeWorkflowEngine) decide(decision, rationale string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.instanceStatus = WorkflowInstanceCompleted
	f.stepOutputs = map[string]any{
		"approve_step": map[string]any{
			"output": map[string]any{"decision": decision, "rationale": rationale},
		},
	}
}

func (f *fakeWorkflowEngine) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/workflows/instances":
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		f.startCalls = append(f.startCalls, body)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            f.instanceID,
			"definition_id": f.definitionID,
			"status":        f.instanceStatus,
			"step_outputs":  map[string]any{},
		})
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/workflows/instances/"+f.instanceID:
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":            f.instanceID,
			"definition_id": f.definitionID,
			"status":        f.instanceStatus,
			"step_outputs":  f.stepOutputs,
		})
	default:
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "NOT_FOUND", "message": r.URL.Path}})
	}
}

// readMoveGroupStatus reads a single move group via the service's own store + tx
// runner (same-package access) so tests can assert the persisted FSM state.
func readMoveGroupStatus(ctx context.Context, svc *Service, tenantID, moveGroupID uuid.UUID) (*MoveGroup, error) {
	var mg *MoveGroup
	err := svc.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		g, gerr := svc.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if gerr != nil {
			return gerr
		}
		mg = g
		return nil
	})
	return mg, err
}

// seedReadyMoveGroup builds a program -> workloads -> completeness-passing move
// group and returns the group ready for submission (status=ready).
func seedReadyMoveGroup(t *testing.T, ctx context.Context, svc *Service, tenantID uuid.UUID, actor Actor) *MoveGroup {
	t.Helper()
	prog, err := svc.CreateProgram(ctx, tenantID, CreateProgramInput{Name: "Approval Program", Actor: actor})
	if err != nil {
		t.Fatalf("create program: %v", err)
	}
	for _, in := range []WorkloadInput{
		{AppKey: "api", Name: "Order API", Strategy: StrategyReplatform, Tier: "tier-1", ReadinessScore: 80, EstimatedEffortHours: 4},
		{AppKey: "db", Name: "Order DB", Strategy: StrategyRehost, Tier: "tier-0", ReadinessScore: 60, EstimatedEffortHours: 6, Dependencies: []WorkloadDependency{{AppKey: "api", Criticality: "hard"}}},
	} {
		if _, err := svc.UpsertWorkload(ctx, tenantID, prog.ID, in, actor); err != nil {
			t.Fatalf("upsert workload %s: %v", in.AppKey, err)
		}
	}
	mg, err := svc.CreateMoveGroup(ctx, tenantID, CreateMoveGroupInput{
		ProgramID: prog.ID, Name: "Order platform", AppKeys: []string{"api", "db"}, Actor: actor,
	})
	if err != nil {
		t.Fatalf("create move group: %v", err)
	}
	checked, err := svc.ValidateMoveGroupCompleteness(ctx, tenantID, mg.ID, actor, mg.RowVersion)
	if err != nil {
		t.Fatalf("validate completeness: %v", err)
	}
	if checked.Status != MoveGroupReady {
		t.Fatalf("move group completeness = %s (%v), want ready", checked.Status, checked.CompletenessFindings)
	}
	return checked
}

// TestIntegrationSubmitOpensApprovalWorkflow proves the H2 realization: submitting
// a move group with the workflow engine wired OPENS a real workflow approval
// instance (over the true HTTP boundary) and persists a migrate_approval_binding
// linking the move group to that instance — no local decision was taken.
func TestIntegrationSubmitOpensApprovalWorkflow(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	engine := newFakeWorkflowEngine("move-group-approval")
	defer engine.Close()
	client := NewHTTPApprovalWorkflowClient(engine.URL(), "svc-token", "move-group-approval", 5*time.Second)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithApprovalWorkflowClient(client))
	tenantID := uuid.New()
	actor := fullActor()

	mg := seedReadyMoveGroup(t, ctx, svc, tenantID, actor)
	submitted, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, mg.RowVersion)
	if err != nil {
		t.Fatalf("submit move group: %v", err)
	}
	if submitted.Status != MoveGroupApprovalPending {
		t.Fatalf("submitted status = %s, want approval_pending", submitted.Status)
	}

	// The workflow engine was asked to START an approval workflow with the move
	// group context in its input variables.
	if len(engine.startCalls) != 1 {
		t.Fatalf("workflow StartInstance calls = %d, want 1", len(engine.startCalls))
	}
	iv, _ := engine.startCalls[0]["input_variables"].(map[string]any)
	if iv["move_group_id"] != mg.ID.String() {
		t.Fatalf("workflow input move_group_id = %v, want %s", iv["move_group_id"], mg.ID)
	}
	if engine.startCalls[0]["definition_id"] != "move-group-approval" {
		t.Fatalf("workflow definition_id = %v, want move-group-approval", engine.startCalls[0]["definition_id"])
	}

	// A pending binding now links the move group to the engine's instance id.
	var (
		instID, status string
	)
	if err := pool.QueryRow(ctx, `SELECT workflow_instance_id, status
FROM migrate_approval_binding WHERE tenant_id = $1 AND subject_type = 'move_group' AND subject_id = $2`,
		tenantID, mg.ID).Scan(&instID, &status); err != nil {
		t.Fatalf("read approval binding: %v", err)
	}
	if instID != engine.instanceID || status != "pending" {
		t.Fatalf("binding = (instance=%s status=%s), want (instance=%s status=pending)", instID, status, engine.instanceID)
	}

	// The move group has NOT been decided locally — it is still awaiting the
	// workflow's decision, with no approved_by set.
	group, err := readMoveGroupStatus(ctx, svc, tenantID, mg.ID)
	if err != nil {
		t.Fatalf("read move group: %v", err)
	}
	if group.Status != MoveGroupApprovalPending || group.ApprovedBy != nil {
		t.Fatalf("group = (status=%s approved_by=%v), want approval_pending + no local decision", group.Status, group.ApprovedBy)
	}
	_ = submitted
}

// TestIntegrationCallbackDrivesMigrateDecision proves the workflow decision (task
// completion, surfaced by the engine as a completed instance carrying a decision)
// drives the migrate FSM through the callback path — the move group flips to
// approved and the binding is completed. This is the end-to-end replacement for
// the local DecideMoveGroup flip.
func TestIntegrationCallbackDrivesMigrateDecision(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	engine := newFakeWorkflowEngine("move-group-approval")
	defer engine.Close()
	client := NewHTTPApprovalWorkflowClient(engine.URL(), "svc-token", "move-group-approval", 5*time.Second)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithApprovalWorkflowClient(client))
	tenantID := uuid.New()
	actor := fullActor()

	mg := seedReadyMoveGroup(t, ctx, svc, tenantID, actor)
	if _, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, mg.RowVersion); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// While the workflow is still running the callback is a no-op (not decided).
	if _, err := svc.ApplyApprovalCallback(ctx, tenantID, engine.instanceID, nil); err != ErrApprovalNotDecided {
		t.Fatalf("callback while running should return ErrApprovalNotDecided, got %v", err)
	}
	group, err := readMoveGroupStatus(ctx, svc, tenantID, mg.ID)
	if err != nil {
		t.Fatalf("get move group: %v", err)
	}
	if group.Status != MoveGroupApprovalPending {
		t.Fatalf("status while running = %s, want approval_pending", group.Status)
	}

	// The approver completes the workflow task -> the engine reports a completed
	// instance with an "approve" decision. The callback now drives the migrate FSM.
	approver := uuid.New()
	engine.decide(WorkflowDecisionApprove, "meets all completeness criteria")
	binding, err := svc.ApplyApprovalCallback(ctx, tenantID, engine.instanceID, &approver)
	if err != nil {
		t.Fatalf("callback after decision: %v", err)
	}
	if binding.Status != ApprovalBindingCompleted || binding.Decision != ApprovalDecisionApproved {
		t.Fatalf("binding = (status=%s decision=%s), want completed/approved", binding.Status, binding.Decision)
	}

	// The move group is now approved, carrying the workflow's rationale.
	group, err = readMoveGroupStatus(ctx, svc, tenantID, mg.ID)
	if err != nil {
		t.Fatalf("get move group: %v", err)
	}
	if group.Status != MoveGroupApproved {
		t.Fatalf("status after decision = %s, want approved", group.Status)
	}
	if group.DecisionRationale != "meets all completeness criteria" {
		t.Fatalf("rationale = %q, want the workflow rationale", group.DecisionRationale)
	}
	if group.ApprovedBy == nil || *group.ApprovedBy != approver {
		t.Fatalf("approved_by = %v, want the callback approver %s", group.ApprovedBy, approver)
	}

	// A replayed callback is idempotent (binding already completed).
	replay, err := svc.ApplyApprovalCallback(ctx, tenantID, engine.instanceID, &approver)
	if err != nil {
		t.Fatalf("replayed callback: %v", err)
	}
	if replay.Status != ApprovalBindingCompleted {
		t.Fatalf("replayed callback binding status = %s, want completed (idempotent)", replay.Status)
	}
}

// TestIntegrationSyncDrivesMigrateDecision proves the pull path: after the workflow
// decides (reject here), SyncMoveGroupApproval reads the engine decision and flips
// the migrate FSM to rejected.
func TestIntegrationSyncDrivesMigrateDecision(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	engine := newFakeWorkflowEngine("move-group-approval")
	defer engine.Close()
	client := NewHTTPApprovalWorkflowClient(engine.URL(), "svc-token", "move-group-approval", 5*time.Second)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithApprovalWorkflowClient(client))
	tenantID := uuid.New()
	actor := fullActor()

	mg := seedReadyMoveGroup(t, ctx, svc, tenantID, actor)
	if _, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, mg.RowVersion); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Still running -> sync is a 409 (ErrApprovalNotDecided), never a local flip.
	if _, err := svc.SyncMoveGroupApproval(ctx, tenantID, mg.ID, actor); err != ErrApprovalNotDecided {
		t.Fatalf("sync while running should return ErrApprovalNotDecided, got %v", err)
	}

	engine.decide(WorkflowDecisionReject, "completeness gaps remain")
	group, err := svc.SyncMoveGroupApproval(ctx, tenantID, mg.ID, actor)
	if err != nil {
		t.Fatalf("sync after decision: %v", err)
	}
	if group.Status != MoveGroupRejected {
		t.Fatalf("status after reject = %s, want rejected", group.Status)
	}
}

// TestIntegrationManualOverrideGated proves that with the engine wired the local
// DecideMoveGroup flip is refused as the default (ErrApprovalWorkflowRequired) and
// only an admin break-glass override is honoured, cancelling the in-flight binding
// so a later callback cannot re-drive the group.
func TestIntegrationManualOverrideGated(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	engine := newFakeWorkflowEngine("move-group-approval")
	defer engine.Close()
	client := NewHTTPApprovalWorkflowClient(engine.URL(), "svc-token", "move-group-approval", 5*time.Second)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithApprovalWorkflowClient(client))
	tenantID := uuid.New()
	admin := fullActor() // fullActor holds migrate:admin

	mg := seedReadyMoveGroup(t, ctx, svc, tenantID, admin)
	submitted, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, admin, mg.RowVersion)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	// A non-admin approver cannot override.
	approver := Actor{UserID: uuid.New(), Permission: []string{PermMigrateApprove}}
	if _, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, approver, true, "x", submitted.RowVersion, false); err != ErrApprovalWorkflowRequired {
		t.Fatalf("default decision with engine should be ErrApprovalWorkflowRequired, got %v", err)
	}
	if _, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, approver, true, "x", submitted.RowVersion, true); err != ErrManualOverrideNotAllowed {
		t.Fatalf("override by non-admin should be ErrManualOverrideNotAllowed, got %v", err)
	}

	// Admin break-glass override succeeds and cancels the in-flight binding.
	group, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, admin, true, "break-glass approve", submitted.RowVersion, true)
	if err != nil {
		t.Fatalf("admin override: %v", err)
	}
	if group.Status != MoveGroupApproved {
		t.Fatalf("status after override = %s, want approved", group.Status)
	}
	var bindingStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM migrate_approval_binding
WHERE tenant_id = $1 AND subject_id = $2`, tenantID, mg.ID).Scan(&bindingStatus); err != nil {
		t.Fatalf("read binding: %v", err)
	}
	if bindingStatus != "cancelled" {
		t.Fatalf("binding after override = %s, want cancelled", bindingStatus)
	}
}
