package action

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/automation/model"
)

func TestDRRunbook_Success(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath, gotAuth, gotTenant string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotTenant = r.Header.Get("X-Tenant-ID")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"run_id":"dr-run-1","status":"RUNNING","frontier":["t2"]}}`))
	}))
	defer srv.Close()

	minter := newFakeMinter("sys-tok")
	exec, err := NewDRRunbookExecutor(srv.URL, minter, srv.Client())
	if err != nil {
		t.Fatalf("NewDRRunbookExecutor: %v", err)
	}

	step := actionStep(model.ActionDRRunbook, map[string]any{
		"run_id":      "dr-run-1",
		"task_id":     "task-abc",
		"task_action": "complete",
		"note":        "auto-completed by automation",
	})
	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	wantPath := "/api/v1/dr/studio/runs/dr-run-1/tasks/task-abc:complete"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}
	if gotAuth != "Bearer sys-tok" {
		t.Errorf("Authorization = %q, want Bearer sys-tok", gotAuth)
	}
	if gotTenant != testTenant {
		t.Errorf("X-Tenant-ID = %q, want %q", gotTenant, testTenant)
	}
	if gotBody["note"] != "auto-completed by automation" {
		t.Errorf("body note = %v", gotBody["note"])
	}
	if _, ok := gotBody["fail_run"]; ok {
		t.Errorf("fail_run should be omitted when false, got %v", gotBody["fail_run"])
	}
	if out.Data["task_action"] != "complete" {
		t.Errorf("output task_action = %v, want complete", out.Data["task_action"])
	}
	state, ok := out.Data["live_state"].(map[string]any)
	if !ok || state["run_id"] != "dr-run-1" {
		t.Errorf("output live_state = %v, want run_id dr-run-1", out.Data["live_state"])
	}
}

func TestDRRunbook_FailWithFailRun(t *testing.T) {
	t.Parallel()
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"status":"FAILED"}}`))
	}))
	defer srv.Close()

	exec, _ := NewDRRunbookExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	step := actionStep(model.ActionDRRunbook, map[string]any{
		"run_id": "r", "task_id": "tk", "task_action": "fail", "fail_run": true,
	})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !strings.HasSuffix(gotPath, "/tasks/tk:fail") {
		t.Errorf("path = %q, want suffix /tasks/tk:fail", gotPath)
	}
	if gotBody["fail_run"] != true {
		t.Errorf("fail_run = %v, want true", gotBody["fail_run"])
	}
}

func TestDRRunbook_BadTaskAction(t *testing.T) {
	t.Parallel()
	exec, _ := NewDRRunbookExecutor("http://gw", newFakeMinter("t"), http.DefaultClient)
	step := actionStep(model.ActionDRRunbook, map[string]any{
		"run_id": "r", "task_id": "tk", "task_action": "explode",
	})
	_, err := exec.Execute(tenantCtx(), step)
	if err == nil || !strings.Contains(err.Error(), "task_action") {
		t.Fatalf("want task_action validation error, got %v", err)
	}
	if IsRetryable(err) {
		t.Errorf("config error must not be retryable")
	}
}

func TestDRRunbook_RetryableOn429(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	exec, _ := NewDRRunbookExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	step := actionStep(model.ActionDRRunbook, map[string]any{"run_id": "r", "task_id": "tk", "task_action": "skip"})
	_, err := exec.Execute(tenantCtx(), step)
	if err == nil || !IsRetryable(err) {
		t.Fatalf("429 must be retryable, got %v", err)
	}
}

func TestDRRunbook_PermanentOn409(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"task not runnable"}`))
	}))
	defer srv.Close()

	exec, _ := NewDRRunbookExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	step := actionStep(model.ActionDRRunbook, map[string]any{"run_id": "r", "task_id": "tk", "task_action": "complete"})
	_, err := exec.Execute(tenantCtx(), step)
	if err == nil {
		t.Fatal("expected error on 409")
	}
	if IsRetryable(err) {
		t.Errorf("409 must NOT be retryable, got %v", err)
	}
}

func TestDRRunbook_MissingRunID(t *testing.T) {
	t.Parallel()
	exec, _ := NewDRRunbookExecutor("http://gw", newFakeMinter("t"), http.DefaultClient)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionDRRunbook, map[string]any{"task_id": "tk", "task_action": "complete"}))
	if err == nil || !strings.Contains(err.Error(), "run_id") {
		t.Fatalf("want run_id error, got %v", err)
	}
}
