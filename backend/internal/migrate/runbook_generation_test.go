package migrate

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// mkWorkload builds a workload with a deterministic id derived from its app key so
// assertions on params (migrate_workload_id) are stable across runs.
func mkWorkload(appKey, name string, strategy MigrationStrategy, hours float64, deps ...WorkloadDependency) Workload {
	return Workload{
		ID:                   uuid.NewSHA1(uuid.Nil, []byte("wl:"+appKey)),
		AppKey:               appKey,
		Name:                 name,
		Strategy:             strategy,
		EstimatedEffortHours: hours,
		Dependencies:         deps,
	}
}

func mkGroup(ref, name string, seq int, wls ...Workload) MoveGroup {
	return MoveGroup{
		ID:           uuid.NewSHA1(uuid.Nil, []byte("mg:"+ref)),
		Reference:    ref,
		Name:         name,
		WaveSequence: seq,
		Workloads:    wls,
	}
}

// TestBuildWaveRunbookPlanStructure proves the generator produces ONE parent
// runbook (a milestone per move group) plus ONE child runbook per move group (a
// task per workload), with durations rolled up from the real workload effort.
func TestBuildWaveRunbookPlanStructure(t *testing.T) {
	wave := Wave{
		ID:        uuid.New(),
		Reference: "WAV-2026-0001",
		Name:      "Wave 1",
		MoveGroups: []MoveGroup{
			mkGroup("MG-A", "Edge", 1,
				mkWorkload("web", "Web", StrategyRehost, 4)),
			mkGroup("MG-B", "Core", 2,
				mkWorkload("api", "API", StrategyReplatform, 6),
				mkWorkload("db", "DB", StrategyRehost, 5, WorkloadDependency{AppKey: "api", Criticality: "hard"})),
		},
	}

	plan, err := buildWaveRunbookPlan(wave, connectorTaskPlan{})
	if err != nil {
		t.Fatalf("buildWaveRunbookPlan: %v", err)
	}

	// Parent runbook: exactly one milestone per move group.
	if len(plan.Parent.ImportSteps) != 2 {
		t.Fatalf("parent steps = %d, want 2 (one per move group)", len(plan.Parent.ImportSteps))
	}
	for _, st := range plan.Parent.ImportSteps {
		if st.TaskType != "milestone" {
			t.Fatalf("parent step %q type = %q, want milestone", st.Key, st.TaskType)
		}
	}
	// MG-B's milestone duration must equal the sum of its two workloads' durations
	// (6h + 5h = 11h), a real rollup not a constant.
	var mgbSeconds int
	for _, st := range plan.Parent.ImportSteps {
		if st.Key == "mg-mg-b" {
			mgbSeconds = st.PlannedDurationSeconds
		}
	}
	if want := (6 + 5) * 3600; mgbSeconds != want {
		t.Fatalf("MG-B milestone duration = %d, want %d (6h+5h rollup)", mgbSeconds, want)
	}

	// One child runbook per move group.
	if len(plan.Children) != 2 {
		t.Fatalf("children = %d, want 2", len(plan.Children))
	}
	childByRef := map[string]childRunbookPlan{}
	for _, c := range plan.Children {
		childByRef[c.MoveGroupRef] = c
	}
	// MG-B child runbook: one task per workload (api, db).
	mgb := childByRef["MG-B"]
	if len(mgb.Request.ImportSteps) != 2 {
		t.Fatalf("MG-B child steps = %d, want 2 (api, db)", len(mgb.Request.ImportSteps))
	}
	// Intra-group order: db hard-depends on api, so api must precede db.
	if mgb.Request.ImportSteps[0].Key != "wl-api" || mgb.Request.ImportSteps[1].Key != "wl-db" {
		t.Fatalf("MG-B task order = [%s,%s], want [wl-api, wl-db] (db depends on api)",
			mgb.Request.ImportSteps[0].Key, mgb.Request.ImportSteps[1].Key)
	}
	// The per-workload task carries the real workload id in params (the link).
	apiID := uuid.NewSHA1(uuid.Nil, []byte("wl:api")).String()
	if got := mgb.Request.ImportSteps[0].Params["migrate_workload_id"]; got != apiID {
		t.Fatalf("api task migrate_workload_id = %v, want %s", got, apiID)
	}
}

// TestOrderMoveGroupsTopologicalReusesEngine proves the move-group ordering comes
// from a topological sort over the dependency DAG (computed by the reused DR
// topology engine), not just the wave sequence: a hard cross-group dependency
// reorders groups ahead of their sequence number.
func TestOrderMoveGroupsByDependency(t *testing.T) {
	// Group "Late" is at sequence 1 but its workload hard-depends on a workload in
	// group "Early" (sequence 2). The dependency must win: Early before Late.
	early := mkGroup("MG-EARLY", "Early", 2, mkWorkload("foundation", "Foundation", StrategyRehost, 2))
	late := mkGroup("MG-LATE", "Late", 1,
		mkWorkload("app", "App", StrategyRehost, 2, WorkloadDependency{AppKey: "foundation", Criticality: "hard"}))

	ordered, err := orderMoveGroups([]MoveGroup{late, early})
	if err != nil {
		t.Fatalf("orderMoveGroups: %v", err)
	}
	if len(ordered) != 2 {
		t.Fatalf("ordered groups = %d, want 2", len(ordered))
	}
	if ordered[0].Reference != "MG-EARLY" || ordered[1].Reference != "MG-LATE" {
		t.Fatalf("order = [%s,%s], want [MG-EARLY, MG-LATE] (dependency overrides sequence)",
			ordered[0].Reference, ordered[1].Reference)
	}
}

// TestOrderMoveGroupsRejectsCycle proves a cyclic move-group dependency (illegal
// input) is rejected by the reused topology cycle detection, so we never generate
// an undeadlockable runbook.
func TestOrderMoveGroupsRejectsCycle(t *testing.T) {
	a := mkGroup("MG-A", "A", 1, mkWorkload("a1", "A1", StrategyRehost, 1, WorkloadDependency{AppKey: "b1", Criticality: "hard"}))
	b := mkGroup("MG-B", "B", 2, mkWorkload("b1", "B1", StrategyRehost, 1, WorkloadDependency{AppKey: "a1", Criticality: "hard"}))
	if _, err := orderMoveGroups([]MoveGroup{a, b}); err == nil {
		t.Fatal("cyclic move-group dependency must be rejected")
	}
}

// drBridgeRequest captures one request the HTTPDRBridge made, for shape assertions.
type drBridgeRequest struct {
	method string
	path   string
	tenant string
	auth   string
	body   map[string]any
}

// TestHTTPDRBridgeCreateRunbookRequestShape proves the production HTTP bridge
// issues the REAL DR Runbook Studio request: POST /api/v1/dr/studio/runbooks with
// the import_steps body, the tenant propagated, and the service token attached;
// and that it decodes the {"data":{"runbook":...,"tasks":...}} envelope.
func TestHTTPDRBridgeCreateRunbookRequestShape(t *testing.T) {
	var captured drBridgeRequest
	runbookID := uuid.New()
	taskID := uuid.New()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		captured = drBridgeRequest{
			method: r.Method,
			path:   r.URL.Path,
			tenant: r.Header.Get("X-Tenant-ID"),
			auth:   r.Header.Get("Authorization"),
			body:   body,
		}
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/dr/studio/runbooks" {
			http.Error(w, "unexpected route", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"runbook": map[string]any{
					"id": runbookID.String(), "name": body["name"], "status": "draft", "source": "registry",
				},
				"tasks": []map[string]any{
					{"id": taskID.String(), "task_key": "mg-a", "name": "A", "task_type": "milestone", "planned_duration_seconds": 3600},
				},
			},
		})
	}))
	defer srv.Close()

	bridge := NewHTTPDRBridge(srv.URL, "svc-token-123", 5*time.Second)
	tenantID := uuid.New()
	rb, err := bridge.CreateRunbook(context.Background(), tenantID, CreateDRRunbookRequest{
		Name:        "Wave WAV-1",
		Description: "generated",
		ImportSteps: []DRImportStep{{Key: "mg-a", Name: "A", TaskType: "milestone", Required: true, PlannedDurationSeconds: 3600}},
	})
	if err != nil {
		t.Fatalf("CreateRunbook: %v", err)
	}

	// Request shape.
	if captured.method != http.MethodPost {
		t.Fatalf("method = %s, want POST", captured.method)
	}
	if captured.path != "/api/v1/dr/studio/runbooks" {
		t.Fatalf("path = %s, want /api/v1/dr/studio/runbooks", captured.path)
	}
	if captured.tenant != tenantID.String() {
		t.Fatalf("X-Tenant-ID = %q, want %s", captured.tenant, tenantID)
	}
	if captured.auth != "Bearer svc-token-123" {
		t.Fatalf("Authorization = %q, want Bearer svc-token-123", captured.auth)
	}
	steps, ok := captured.body["import_steps"].([]any)
	if !ok || len(steps) != 1 {
		t.Fatalf("import_steps in body = %v, want 1 step", captured.body["import_steps"])
	}
	step0 := steps[0].(map[string]any)
	if step0["key"] != "mg-a" || step0["task_type"] != "milestone" {
		t.Fatalf("import step body = %v, want key=mg-a task_type=milestone", step0)
	}

	// Response decoding.
	if rb.ID != runbookID {
		t.Fatalf("decoded runbook id = %s, want %s", rb.ID, runbookID)
	}
	if len(rb.Tasks) != 1 || rb.Tasks[0].ID != taskID || rb.Tasks[0].TaskType != "milestone" {
		t.Fatalf("decoded tasks = %#v, want one milestone task %s", rb.Tasks, taskID)
	}
}

// TestHTTPDRBridge4xxSurfacesRejection proves a DR 4xx (e.g. an authoring cycle)
// becomes ErrDRBridgeRejected with the engine's real message, and a 5xx becomes
// ErrDRBridgeUnavailable (fail closed, retriable).
func TestHTTPDRBridgeErrorMapping(t *testing.T) {
	cycleSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"code": "cycle", "message": "task predecessors would create a cycle"})
	}))
	defer cycleSrv.Close()
	bridge := NewHTTPDRBridge(cycleSrv.URL, "t", time.Second)
	_, err := bridge.CreateRunbook(context.Background(), uuid.New(), CreateDRRunbookRequest{Name: "x"})
	if err == nil || !strings.Contains(err.Error(), "create a cycle") {
		t.Fatalf("4xx err = %v, want ErrDRBridgeRejected with engine message", err)
	}
	if !isDRBridgeRejected(err) {
		t.Fatalf("4xx err = %v, want wrapped ErrDRBridgeRejected", err)
	}

	downSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer downSrv.Close()
	bridge2 := NewHTTPDRBridge(downSrv.URL, "t", time.Second)
	_, err = bridge2.GetRun(context.Background(), uuid.New(), uuid.New())
	if !isDRBridgeUnavailable(err) {
		t.Fatalf("5xx err = %v, want wrapped ErrDRBridgeUnavailable", err)
	}

	// An unconfigured bridge fails closed without dialing.
	if (&HTTPDRBridge{}).Configured() {
		t.Fatal("empty bridge should report not configured")
	}
}

func isDRBridgeRejected(err error) bool {
	return err != nil && errorsIs(err, ErrDRBridgeRejected)
}
func isDRBridgeUnavailable(err error) bool {
	return err != nil && errorsIs(err, ErrDRBridgeUnavailable)
}

// errorsIs avoids importing errors at the top for a one-liner helper readability.
func errorsIs(err, target error) bool {
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
