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
)

// TestHTTPDRBridgeActOnTaskRequestShape proves the production HTTP bridge issues
// the REAL DR Runbook Studio task-action request: POST to
// /studio/runs/{runID}/tasks/{taskID}:complete with the note/fail_run body, the
// tenant propagated and the service token attached, and decodes the LiveState
// (including the per-task run state used by the validation gate).
func TestHTTPDRBridgeActOnTaskRequestShape(t *testing.T) {
	runID := uuid.New()
	taskID := uuid.New()
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
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"run": map[string]any{
					"id": runID.String(), "runbook_id": uuid.New().String(), "mode": "live", "status": "completed",
				},
				"tasks": []map[string]any{
					{"id": taskID.String(), "task_key": "wl-api", "name": "API", "task_type": "manual", "required": true},
				},
				"task_runs": []map[string]any{
					{"task_id": taskID.String(), "status": "complete"},
				},
				"frontier":   []string{},
				"projection": map[string]any{"completed_tasks": 1, "total_tasks": 1},
			},
		})
	}))
	defer srv.Close()

	bridge := NewHTTPDRBridge(srv.URL, "svc-token-xyz", 5*time.Second)
	tenantID := uuid.New()
	live, err := bridge.ActOnTask(context.Background(), tenantID, runID, taskID, DRActionComplete, "looks good", false)
	if err != nil {
		t.Fatalf("ActOnTask: %v", err)
	}

	wantPath := "/api/v1/dr/studio/runs/" + runID.String() + "/tasks/" + taskID.String() + ":complete"
	if capturedMethod != http.MethodPost || capturedPath != wantPath {
		t.Fatalf("request = %s %s, want POST %s", capturedMethod, capturedPath, wantPath)
	}
	if capturedTenant != tenantID.String() {
		t.Fatalf("X-Tenant-ID = %q, want %s", capturedTenant, tenantID)
	}
	if capturedAuth != "Bearer svc-token-xyz" {
		t.Fatalf("Authorization = %q, want Bearer svc-token-xyz", capturedAuth)
	}
	if capturedBody["note"] != "looks good" {
		t.Fatalf("body note = %v, want 'looks good'", capturedBody["note"])
	}
	if _, hasFailRun := capturedBody["fail_run"]; hasFailRun {
		t.Fatalf("fail_run must be omitted when false, body = %v", capturedBody)
	}

	// The decoded live state reflects the real run + per-task completion.
	if !live.Succeeded() {
		t.Fatalf("decoded run status = %s, want completed", live.Status)
	}
	if !live.RequiredTasksCompleted() {
		t.Fatal("decoded live state should report required tasks completed")
	}
}

// TestHTTPDRBridgeActOnTaskRejectsInvalidAction proves the bridge guards the verb
// before dialing (no malformed request to the engine).
func TestHTTPDRBridgeActOnTaskRejectsInvalidAction(t *testing.T) {
	bridge := NewHTTPDRBridge("http://example.invalid", "t", time.Second)
	if _, err := bridge.ActOnTask(context.Background(), uuid.New(), uuid.New(), uuid.New(), DRTaskAction("approve"), "", false); err == nil {
		t.Fatal("invalid task action must be rejected before dialing")
	}
}

// TestDRRunLiveStateGates proves the validation-gate predicates on the run state
// reflect the REAL DR run state (status + per-task completion), not canned
// answers. These are the signals the cutover/rollback gates tie to.
func TestDRRunLiveStateGates(t *testing.T) {
	t1 := uuid.New()
	t2 := uuid.New()

	// A running run with one required task not yet complete: not succeeded, not
	// failed, required tasks NOT all complete.
	running := &DRRunLiveState{
		Status: DRRunStatusRunning,
		Tasks: []DRTask{
			{ID: t1, Required: true},
			{ID: t2, Required: false},
		},
		TaskRuns: []DRTaskRun{
			{TaskID: t1.String(), Status: "runnable"},
		},
	}
	if running.Succeeded() || running.Failed() || running.Terminal() {
		t.Fatal("running run must not be succeeded/failed/terminal")
	}
	if running.RequiredTasksCompleted() {
		t.Fatal("required task incomplete must report RequiredTasksCompleted=false")
	}

	// All required tasks complete, optional one skipped: required complete = true.
	done := &DRRunLiveState{
		Status: DRRunStatusCompleted,
		Tasks: []DRTask{
			{ID: t1, Required: true},
			{ID: t2, Required: false},
		},
		TaskRuns: []DRTaskRun{
			{TaskID: t1.String(), Status: DRTaskRunComplete},
			{TaskID: t2.String(), Status: DRTaskRunSkipped},
		},
	}
	if !done.Succeeded() || !done.Terminal() || done.Failed() {
		t.Fatal("completed run must be succeeded + terminal, not failed")
	}
	if !done.RequiredTasksCompleted() {
		t.Fatal("all required complete must report RequiredTasksCompleted=true")
	}

	// A required task that was only SKIPPED does not satisfy required completion.
	skippedRequired := &DRRunLiveState{
		Status:   DRRunStatusCompleted,
		Tasks:    []DRTask{{ID: t1, Required: true}},
		TaskRuns: []DRTaskRun{{TaskID: t1.String(), Status: DRTaskRunSkipped}},
	}
	if skippedRequired.RequiredTasksCompleted() {
		t.Fatal("a skipped required task must NOT satisfy RequiredTasksCompleted")
	}

	// Failed/aborted runs report Failed()=true and Terminal()=true.
	failed := &DRRunLiveState{Status: DRRunStatusFailed, Tasks: []DRTask{{ID: t1, Required: true}}}
	if !failed.Failed() || !failed.Terminal() || failed.Succeeded() {
		t.Fatalf("failed run predicate mismatch: failed=%v terminal=%v succeeded=%v", failed.Failed(), failed.Terminal(), failed.Succeeded())
	}
	aborted := &DRRunLiveState{Status: DRRunStatusAborted}
	if !aborted.Failed() || !aborted.Terminal() {
		t.Fatal("aborted run must be Failed()+Terminal()")
	}

	// A nil/empty state never claims success.
	var nilState *DRRunLiveState
	if nilState.Succeeded() || nilState.Failed() || nilState.Terminal() || nilState.RequiredTasksCompleted() {
		t.Fatal("nil live state must report all predicates false")
	}
}

// TestDRTaskActionValid proves only the three DR Studio verbs are accepted.
func TestDRTaskActionValid(t *testing.T) {
	for _, ok := range []DRTaskAction{DRActionComplete, DRActionSkip, DRActionFail} {
		if !ok.Valid() {
			t.Fatalf("%s should be valid", ok)
		}
	}
	for _, bad := range []DRTaskAction{"", "approve", "complete ", "COMPLETE"} {
		if bad.Valid() {
			t.Fatalf("%q should be invalid", bad)
		}
	}
}

// TestBuildRollbackRunbookRequestReverseOrder proves the rollback runbook is the
// REVERSE of the cutover order: db hard-depends on api, so the cutover order is
// api then db; the rollback must revert db FIRST, then api. The tasks carry the
// real workload ids and the rollback kind in params, reusing the same ordering
// engine as the forward generator.
func TestBuildRollbackRunbookRequestReverseOrder(t *testing.T) {
	api := mkWorkload("api", "API", StrategyReplatform, 6)
	db := mkWorkload("db", "DB", StrategyRehost, 5, WorkloadDependency{AppKey: "api", Criticality: "hard"})
	wave := Wave{
		ID:        uuid.New(),
		Reference: "WAV-2026-0001",
		Name:      "Wave 1",
		MoveGroups: []MoveGroup{
			mkGroup("MG-A", "Core", 1, api, db),
		},
	}
	window := CutoverWindow{Reference: "CUT-2026-0001"}

	req, err := buildRollbackRunbookRequest(wave, window, connectorTaskPlan{})
	if err != nil {
		t.Fatalf("buildRollbackRunbookRequest: %v", err)
	}
	if len(req.ImportSteps) != 2 {
		t.Fatalf("rollback steps = %d, want 2", len(req.ImportSteps))
	}
	// Reverse of forward [api, db] => [db, api].
	if req.ImportSteps[0].Key != "rb-db" || req.ImportSteps[1].Key != "rb-api" {
		t.Fatalf("rollback order = [%s,%s], want [rb-db, rb-api] (reverse of cutover)",
			req.ImportSteps[0].Key, req.ImportSteps[1].Key)
	}
	for _, st := range req.ImportSteps {
		if !st.Required || st.TaskType != "manual" {
			t.Fatalf("rollback step %q must be required manual, got required=%v type=%s", st.Key, st.Required, st.TaskType)
		}
		if st.Params["kind"] != "rollback" {
			t.Fatalf("rollback step %q must carry kind=rollback param", st.Key)
		}
	}
	// The first rollback task targets db (the real workload id is the link).
	dbID := uuid.NewSHA1(uuid.Nil, []byte("wl:db")).String()
	if got := req.ImportSteps[0].Params["migrate_workload_id"]; got != dbID {
		t.Fatalf("first rollback task migrate_workload_id = %v, want %s (db)", got, dbID)
	}
}

// TestBuildRollbackRunbookRequestEmptyRejected proves a wave with no workloads
// cannot produce a rollback runbook (fails closed, not an empty stub).
func TestBuildRollbackRunbookRequestEmptyRejected(t *testing.T) {
	wave := Wave{ID: uuid.New(), Reference: "WAV-EMPTY", MoveGroups: []MoveGroup{mkGroup("MG-X", "X", 1)}}
	if _, err := buildRollbackRunbookRequest(wave, CutoverWindow{Reference: "CUT-X"}, connectorTaskPlan{}); err == nil {
		t.Fatal("rollback request for a wave with no workloads must be rejected")
	}
}
