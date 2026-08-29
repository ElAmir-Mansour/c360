package action

import (
	"testing"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
)

// allKindsDispatcher wires a distinct staticExecutor per Kind so each route can
// be asserted independently.
func allKindsDispatcher(t *testing.T) (*Dispatcher, map[string]*staticExecutor) {
	t.Helper()
	execs := map[string]*staticExecutor{
		model.ActionStartWorkflow: {out: map[string]any{"instance_id": "wf-1"}},
		model.ActionIntegration:   {out: map[string]any{"event_id": "ev-int"}},
		model.ActionNotification:  {out: map[string]any{"event_id": "ev-not"}},
		model.ActionDRRunbook:     {out: map[string]any{"run_id": "dr-1"}},
		model.ActionHTTPCall:      {out: map[string]any{"status_code": 200}},
	}
	d, err := NewDispatcher(DispatcherConfig{
		StartWorkflow: execs[model.ActionStartWorkflow],
		Integration:   execs[model.ActionIntegration],
		Notification:  execs[model.ActionNotification],
		DRRunbook:     execs[model.ActionDRRunbook],
		HTTPCall:      execs[model.ActionHTTPCall],
	})
	if err != nil {
		t.Fatalf("NewDispatcher: %v", err)
	}
	return d, execs
}

func TestDispatcher_RoutesEachKind(t *testing.T) {
	t.Parallel()
	d, execs := allKindsDispatcher(t)

	for _, kind := range []string{
		model.ActionStartWorkflow,
		model.ActionIntegration,
		model.ActionNotification,
		model.ActionDRRunbook,
		model.ActionHTTPCall,
	} {
		out, err := d.Execute(tenantCtx(), actionStep(kind, map[string]any{}))
		if err != nil {
			t.Fatalf("kind %s: Execute: %v", kind, err)
		}
		// The matching executor was called exactly once with the right kind.
		if execs[kind].calls != 1 {
			t.Errorf("kind %s: target called %d times, want 1", kind, execs[kind].calls)
		}
		if execs[kind].gotKind != kind {
			t.Errorf("kind %s: routed to executor that saw %q", kind, execs[kind].gotKind)
		}
		// No other executor was called for this step.
		for other, ex := range execs {
			if other != kind && ex.calls != 0 {
				t.Errorf("kind %s leaked to %s (calls=%d)", kind, other, ex.calls)
			}
		}
		// The output is annotated with the routing decision.
		if out.Data["action"] != kind {
			t.Errorf("kind %s: output action = %v", kind, out.Data["action"])
		}
		if out.Data["dispatched"] != true {
			t.Errorf("kind %s: output not marked dispatched", kind)
		}
		// Reset call counters for the next kind.
		for _, ex := range execs {
			ex.calls = 0
			ex.gotKind = ""
		}
	}
}

func TestDispatcher_RecordsTargetResponse(t *testing.T) {
	t.Parallel()
	target := &staticExecutor{out: map[string]any{"instance_id": "wf-77", "status_code": 201}}
	d, err := NewDispatcher(DispatcherConfig{StartWorkflow: target})
	if err != nil {
		t.Fatalf("NewDispatcher: %v", err)
	}
	out, err := d.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{}))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.Data["instance_id"] != "wf-77" {
		t.Errorf("target response not preserved: %v", out.Data)
	}
	if out.Data["status_code"] != 201 {
		t.Errorf("target status not preserved: %v", out.Data["status_code"])
	}
}

func TestDispatcher_UnknownKindIsPermanent(t *testing.T) {
	t.Parallel()
	d, _ := NewDispatcher(DispatcherConfig{HTTPCall: &staticExecutor{}})
	_, err := d.Execute(tenantCtx(), actionStep(model.ActionStartWorkflow, map[string]any{}))
	if err == nil {
		t.Fatal("expected error for unwired kind")
	}
	if IsRetryable(err) {
		t.Errorf("unknown kind must be permanent, got retryable %v", err)
	}
}

func TestDispatcher_RetryableErrorPropagatesByDefault(t *testing.T) {
	t.Parallel()
	target := &staticExecutor{err: retryableErr("svc down")}
	d, _ := NewDispatcher(DispatcherConfig{HTTPCall: target})
	_, err := d.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{}))
	if err == nil || !IsRetryable(err) {
		t.Fatalf("default policy must propagate retryable error, got %v", err)
	}
}

func TestDispatcher_PermanentErrorPropagates(t *testing.T) {
	t.Parallel()
	target := &staticExecutor{err: permanentErr("bad config")}
	d, _ := NewDispatcher(DispatcherConfig{HTTPCall: target})
	_, err := d.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{}))
	if err == nil {
		t.Fatal("expected error")
	}
	if IsRetryable(err) {
		t.Errorf("permanent error must not become retryable")
	}
}

func TestDispatcher_SkipOnUnavailablePolicy(t *testing.T) {
	t.Parallel()
	target := &staticExecutor{err: retryableErr("target down")}
	d, err := NewDispatcher(DispatcherConfig{HTTPCall: target, SkipOnUnavailable: true})
	if err != nil {
		t.Fatalf("NewDispatcher: %v", err)
	}
	out, err := d.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{}))
	if err != nil {
		t.Fatalf("skip policy must swallow retryable error, got %v", err)
	}
	if out.Data["skipped"] != true {
		t.Errorf("expected skipped output, got %v", out.Data)
	}
	if out.Data["reason"] != "target_unavailable" {
		t.Errorf("skip reason = %v", out.Data["reason"])
	}
}

func TestDispatcher_SkipPolicyStillFailsPermanent(t *testing.T) {
	t.Parallel()
	// A permanent error must fail even under the skip-on-unavailable policy.
	target := &staticExecutor{err: permanentErr("malformed")}
	d, _ := NewDispatcher(DispatcherConfig{HTTPCall: target, SkipOnUnavailable: true})
	_, err := d.Execute(tenantCtx(), actionStep(model.ActionHTTPCall, map[string]any{}))
	if err == nil {
		t.Fatal("permanent error must not be skipped")
	}
}

func TestNewDispatcher_RequiresAnExecutor(t *testing.T) {
	t.Parallel()
	if _, err := NewDispatcher(DispatcherConfig{}); err == nil {
		t.Error("expected error when no executors supplied")
	}
}

func TestDispatcher_SatisfiesActionExecutor(t *testing.T) {
	t.Parallel()
	d, _ := allKindsDispatcher(t)
	var _ service.ActionExecutor = d
	if !d.Supports(model.ActionHTTPCall) {
		t.Error("expected http_call support")
	}
}
