package action

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/clario360/platform/internal/automation/model"
)

func TestStartWorkflow_Success(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath, gotAuth, gotTenant, gotCT string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotTenant = r.Header.Get("X-Tenant-ID")
		gotCT = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"wf-instance-123","status":"running","definition_id":"def-9"}`))
	}))
	defer srv.Close()

	minter := newFakeMinter("system-token-xyz")
	exec, err := NewStartWorkflowExecutor(srv.URL, minter, srv.Client())
	if err != nil {
		t.Fatalf("NewStartWorkflowExecutor: %v", err)
	}

	step := actionStep(model.ActionStartWorkflow, map[string]any{
		"definition_id":   "def-9",
		"input_variables": map[string]any{"sev": "critical"},
		"trigger_data":    map[string]any{"alert_id": "a-1"},
	})

	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != startWorkflowPath {
		t.Errorf("path = %q, want %q", gotPath, startWorkflowPath)
	}
	if gotAuth != "Bearer system-token-xyz" {
		t.Errorf("Authorization = %q, want Bearer system-token-xyz", gotAuth)
	}
	if gotTenant != testTenant {
		t.Errorf("X-Tenant-ID = %q, want %q", gotTenant, testTenant)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}
	if minter.lastTenant() != testTenant {
		t.Errorf("minted for tenant %q, want %q", minter.lastTenant(), testTenant)
	}
	if gotBody["definition_id"] != "def-9" {
		t.Errorf("body definition_id = %v, want def-9", gotBody["definition_id"])
	}
	if iv, ok := gotBody["input_variables"].(map[string]any); !ok || iv["sev"] != "critical" {
		t.Errorf("body input_variables = %v, want {sev: critical}", gotBody["input_variables"])
	}
	if td, ok := gotBody["trigger_data"].(map[string]any); !ok || td["alert_id"] != "a-1" {
		t.Errorf("body trigger_data = %v, want {alert_id: a-1}", gotBody["trigger_data"])
	}
	if out.Data["instance_id"] != "wf-instance-123" {
		t.Errorf("output instance_id = %v, want wf-instance-123", out.Data["instance_id"])
	}
	if out.Data["status_code"] != http.StatusCreated {
		t.Errorf("output status_code = %v, want 201", out.Data["status_code"])
	}
}

func TestStartWorkflow_DataEnvelopeResponse(t *testing.T) {
	t.Parallel()
	// Some Clario handlers wrap the resource in {"data": {...}}; the executor
	// must still extract the instance id.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"data":{"id":"wf-enveloped","status":"running"}}`))
	}))
	defer srv.Close()

	exec, _ := NewStartWorkflowExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	out, err := exec.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{"definition_id": "d"}))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.Data["instance_id"] != "wf-enveloped" {
		t.Errorf("instance_id = %v, want wf-enveloped", out.Data["instance_id"])
	}
}

func TestStartWorkflow_RetryableOn5xx(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream down"))
	}))
	defer srv.Close()

	exec, _ := NewStartWorkflowExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{"definition_id": "d"}))
	if err == nil {
		t.Fatal("expected error on 502")
	}
	if !IsRetryable(err) {
		t.Errorf("502 must be retryable, got %v", err)
	}
}

func TestStartWorkflow_PermanentOn4xx(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"bad definition"}`))
	}))
	defer srv.Close()

	exec, _ := NewStartWorkflowExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{"definition_id": "d"}))
	if err == nil {
		t.Fatal("expected error on 400")
	}
	if IsRetryable(err) {
		t.Errorf("400 must NOT be retryable, got %v", err)
	}
}

func TestStartWorkflow_MissingDefinitionID(t *testing.T) {
	t.Parallel()
	exec, _ := NewStartWorkflowExecutor("http://gw", newFakeMinter("t"), http.DefaultClient)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{}))
	if err == nil || !strings.Contains(err.Error(), "definition_id") {
		t.Fatalf("want missing definition_id error, got %v", err)
	}
	if IsRetryable(err) {
		t.Errorf("config error must not be retryable")
	}
}

func TestStartWorkflow_MissingTenant(t *testing.T) {
	t.Parallel()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	exec, _ := NewStartWorkflowExecutor(srv.URL, newFakeMinter("t"), srv.Client())
	// No tenant on the context.
	_, err := exec.Execute(t.Context(), actionStep(model.ActionStartWorkflow, map[string]any{"definition_id": "d"}))
	if err == nil || !strings.Contains(err.Error(), "tenant") {
		t.Fatalf("want no-tenant error, got %v", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Errorf("must not call workflow engine without a tenant")
	}
}

func TestStartWorkflow_MintFailureIsRetryable(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	minter := newFakeMinter("")
	minter.err = permanentErr("iam unreachable")
	exec, _ := NewStartWorkflowExecutor(srv.URL, minter, srv.Client())
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{"definition_id": "d"}))
	if err == nil {
		t.Fatal("expected mint failure")
	}
	if !IsRetryable(err) {
		t.Errorf("mint failure must be retryable, got %v", err)
	}
}

func TestNewStartWorkflowExecutor_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewStartWorkflowExecutor("", newFakeMinter("t"), nil); err == nil {
		t.Error("expected error for empty gateway URL")
	}
	if _, err := NewStartWorkflowExecutor("http://gw", nil, nil); err == nil {
		t.Error("expected error for nil minter")
	}
}
