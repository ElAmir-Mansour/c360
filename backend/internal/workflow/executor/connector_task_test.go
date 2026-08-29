package executor

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// fakeConnectorDispatcher stands in for the real integration-registry-backed
// dispatcher. It records how many times it was invoked and with what request,
// resolves a SECRET-REF from an in-memory "vault" AT CALL TIME (proving the
// executor never carries the secret), calls a downstream httptest server so the
// test exercises a real (loopback-only) egress boundary, and can be told to fail
// or to deny egress.
type fakeConnectorDispatcher struct {
	mu sync.Mutex

	calls        int32
	lastReq      ConnectorRequest
	failN        int32 // fail the first failN dispatches with a retryable error
	denyEgress   bool  // return ErrConnectorEgressDenied
	targetURL    string
	vault        map[string]string // secret-ref -> cleartext secret
	sawSecret    string            // the secret the dispatcher resolved at call time
	sentIdemKeys []string          // idempotency keys forwarded downstream
}

func (d *fakeConnectorDispatcher) Dispatch(ctx context.Context, req ConnectorRequest) (ConnectorResponse, error) {
	atomic.AddInt32(&d.calls, 1)
	d.mu.Lock()
	d.lastReq = req
	d.mu.Unlock()

	if d.denyEgress {
		// Wrap the sentinel to prove errors.Is matching works through wrapping.
		return ConnectorResponse{}, fmt.Errorf("dispatcher: target 169.254.169.254: %w", ErrConnectorEgressDenied)
	}

	if n := atomic.LoadInt32(&d.failN); n > 0 {
		atomic.AddInt32(&d.failN, -1)
		return ConnectorResponse{}, errors.New("transient upstream error")
	}

	// SECRET-REF CUSTODY: the dispatcher resolves the credential from the framework
	// AT CALL TIME (here, an in-memory vault). The executor never sees or carries it.
	secretRef, _ := req.Input["credential_ref"].(string)
	secret := d.vault[secretRef]
	d.mu.Lock()
	d.sawSecret = secret
	d.mu.Unlock()

	// Exercise a loopback-only outbound call, forwarding the idempotency key so a
	// cooperating downstream could dedupe server-side.
	if d.targetURL != "" {
		httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, d.targetURL, nil)
		if req.IdempotencyKey != "" {
			httpReq.Header.Set("Idempotency-Key", req.IdempotencyKey)
		}
		// Authenticate downstream with the resolved secret (never surfaced back).
		httpReq.Header.Set("Authorization", "Bearer "+secret)
		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return ConnectorResponse{}, err
		}
		_ = resp.Body.Close()
	}

	return ConnectorResponse{
		Output: map[string]interface{}{
			"ticket": map[string]interface{}{"id": "INC-42", "state": "open"},
		},
		Reference:  "INC-42",
		StatusCode: 200,
	}, nil
}

// captureProducer records published audit events for assertion.
type captureProducer struct {
	mu     sync.Mutex
	events []*events.Event
}

func (p *captureProducer) Publish(_ context.Context, _ string, event *events.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
	return nil
}

func (p *captureProducer) all() []*events.Event {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]*events.Event, len(p.events))
	copy(out, p.events)
	return out
}

func connectorInstance() *model.WorkflowInstance {
	started := "user-1"
	return &model.WorkflowInstance{
		ID:        "inst-conn-1",
		TenantID:  "tenant-conn",
		StartedBy: &started,
		Variables: map[string]interface{}{
			"subject": "Server down",
			// The stored value is a REFERENCE, never the cleartext secret.
			"cred_ref": "vault://ops/servicenow#token",
		},
		StepOutputs: map[string]interface{}{},
	}
}

func connectorStep() *model.StepDefinition {
	return &model.StepDefinition{
		ID:   "open-incident",
		Type: model.StepTypeConnectorTask,
		Name: "Open ServiceNow Incident",
		Config: map[string]interface{}{
			"connector_kind": "servicenow",
			"connector_id":   "primary",
			"operation":      "create_ticket",
			"input_mapping": map[string]interface{}{
				"short_description": "${variables.subject}",
				"credential_ref":    "${variables.cred_ref}",
			},
			"output_mapping": map[string]interface{}{
				"incident_id":    "reference",
				"incident_state": "output.ticket.state",
			},
		},
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestConnectorTask_DispatchesThroughRegistryWithIOMapping proves the happy path:
// the executor resolves the input mapping via ${...}, dispatches through the fake
// registry connector, and projects the response back via output_mapping.
func TestConnectorTask_DispatchesThroughRegistryWithIOMapping(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	disp := &fakeConnectorDispatcher{
		targetURL: srv.URL,
		vault:     map[string]string{"vault://ops/servicenow#token": "s3cr3t-token"},
	}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)

	inst := connectorInstance()
	step := connectorStep()
	res, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != 1 {
		t.Fatalf("dispatcher calls = %d, want 1", got)
	}

	// Input mapping resolved the ${...} placeholders.
	if got := disp.lastReq.Input["short_description"]; got != "Server down" {
		t.Fatalf("short_description = %v, want %q", got, "Server down")
	}
	if disp.lastReq.Kind != "servicenow" || disp.lastReq.ID != "primary" || disp.lastReq.Operation != "create_ticket" {
		t.Fatalf("dispatch target mismatch: %+v", disp.lastReq)
	}
	if disp.lastReq.TenantID != "tenant-conn" {
		t.Fatalf("tenant not propagated: %q", disp.lastReq.TenantID)
	}

	// Output mapping projected reference + nested output path onto step output.
	if res.Output["incident_id"] != "INC-42" {
		t.Fatalf("incident_id = %v, want INC-42", res.Output["incident_id"])
	}
	if res.Output["incident_state"] != "open" {
		t.Fatalf("incident_state = %v, want open", res.Output["incident_state"])
	}
}

// TestConnectorTask_IdempotentReexecutionDoesNotDoubleFire proves the Wave-1
// ledger prevents a recovered/retried SAME-attempt run from re-firing the
// connector: the second Execute replays the cached output.
func TestConnectorTask_IdempotentReexecutionDoesNotDoubleFire(t *testing.T) {
	disp := &fakeConnectorDispatcher{vault: map[string]string{}}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)
	exe.SetIdempotencyStore(newMemIdempotencyStore())

	inst := connectorInstance()
	step := connectorStep()

	exec1 := &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}
	res1, err := exe.Execute(context.Background(), inst, step, exec1)
	if err != nil {
		t.Fatalf("first Execute error = %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != 1 {
		t.Fatalf("after first execute, dispatch calls = %d, want 1", got)
	}
	// The dispatcher received the idempotency key to forward downstream.
	if disp.lastReq.IdempotencyKey == "" {
		t.Fatalf("expected idempotency key forwarded to dispatcher when store is wired")
	}

	// Recovery: same instance/step/attempt => same key => replay, no re-fire.
	exec2 := &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1}
	res2, err := exe.Execute(context.Background(), inst, step, exec2)
	if err != nil {
		t.Fatalf("recovery re-Execute error = %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != 1 {
		t.Fatalf("after recovery, dispatch calls = %d, want 1 (must NOT double-fire)", got)
	}
	if res1.Output["incident_id"] != res2.Output["incident_id"] {
		t.Fatalf("replayed output %v != original %v", res2.Output["incident_id"], res1.Output["incident_id"])
	}
}

// TestConnectorTask_SecretResolvedAtCallTimeNotInAuditOrOutput proves secret
// custody: the SECRET is resolved by the dispatcher at call time (never carried
// by the executor) and appears in NEITHER the step output NOR the audit event.
func TestConnectorTask_SecretResolvedAtCallTimeNotInAuditOrOutput(t *testing.T) {
	const secret = "top-secret-token-value"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	disp := &fakeConnectorDispatcher{
		targetURL: srv.URL,
		vault:     map[string]string{"vault://ops/servicenow#token": secret},
	}
	prod := &captureProducer{}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)
	exe.SetEventPublisher(prod)

	inst := connectorInstance()
	step := connectorStep()
	res, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}

	// The dispatcher resolved the real secret at call time.
	if disp.sawSecret != secret {
		t.Fatalf("dispatcher should have resolved the secret at call time, got %q", disp.sawSecret)
	}

	// The secret must NOT be in the step output.
	if strings.Contains(fmt.Sprintf("%v", res.Output), secret) {
		t.Fatalf("secret leaked into step output: %v", res.Output)
	}

	// The secret must NOT be in ANY audit event payload.
	evs := prod.all()
	if len(evs) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(evs))
	}
	if !strings.HasSuffix(evs[0].Type, "workflow.connector.invoked") {
		t.Fatalf("audit event type = %q, want suffix workflow.connector.invoked", evs[0].Type)
	}
	blob := fmt.Sprintf("%v %v", evs[0].Data, evs[0])
	if strings.Contains(blob, secret) {
		t.Fatalf("secret leaked into audit event: %s", blob)
	}
	// Only the stored REFERENCE (not the resolved secret) may transit the executor;
	// and even it must not be echoed into the audit payload (which carries metadata
	// only, not the input).
	if strings.Contains(blob, "vault://ops/servicenow#token") {
		t.Fatalf("audit event unexpectedly carried the secret reference / input: %s", blob)
	}
}

// TestConnectorTask_EgressDeniedTargetRejected proves an egress/SSRF denial from
// the dispatcher fails the step closed and is NOT retried.
func TestConnectorTask_EgressDeniedTargetRejected(t *testing.T) {
	disp := &fakeConnectorDispatcher{denyEgress: true, vault: map[string]string{}}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)

	inst := connectorInstance()
	step := connectorStep()
	// Even with retries configured, an egress denial must not retry.
	step.Config["retry"] = map[string]interface{}{"max_attempts": 3, "backoff_ms": 1}

	_, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1})
	if err == nil {
		t.Fatalf("expected egress-denied error, got nil")
	}
	if !errors.Is(err, ErrConnectorEgressDenied) {
		t.Fatalf("error should wrap ErrConnectorEgressDenied, got %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != 1 {
		t.Fatalf("egress-denied must not retry: dispatch calls = %d, want 1", got)
	}
}

// TestConnectorTask_CircuitBreakerOpensOnRepeatedFailure proves the reused
// service-task breaker trips OPEN after repeated dispatch failures, so a
// subsequent attempt short-circuits with circuit_open (never reaching the
// dispatcher).
func TestConnectorTask_CircuitBreakerOpensOnRepeatedFailure(t *testing.T) {
	// Fail every dispatch so the breaker accumulates failures.
	disp := &fakeConnectorDispatcher{failN: 1 << 30, vault: map[string]string{}}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)

	inst := connectorInstance()
	step := connectorStep()

	// Drive enough failing attempts to exceed maxFailures (3). Each Execute here is
	// a single attempt (maxAttempts defaults to 1), so run several separate steps
	// against the SAME connector breaker (keyed by kind:id).
	var lastErr error
	for i := 0; i < 3; i++ {
		s := &model.StepExecution{InstanceID: inst.ID, StepID: fmt.Sprintf("s-%d", i), Attempt: 1}
		if _, lastErr = exe.Execute(context.Background(), inst, step, s); lastErr == nil {
			t.Fatalf("attempt %d unexpectedly succeeded", i)
		}
	}
	callsBeforeOpen := atomic.LoadInt32(&disp.calls)
	if callsBeforeOpen != 3 {
		t.Fatalf("dispatch calls before breaker open = %d, want 3", callsBeforeOpen)
	}

	// The breaker is now OPEN. The next attempt must short-circuit WITHOUT calling
	// the dispatcher.
	s := &model.StepExecution{InstanceID: inst.ID, StepID: "s-open", Attempt: 1}
	_, err := exe.Execute(context.Background(), inst, step, s)
	if err == nil || !strings.Contains(err.Error(), "circuit_open") {
		t.Fatalf("expected circuit_open error, got %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != callsBeforeOpen {
		t.Fatalf("open breaker must not reach dispatcher: calls = %d, want %d", got, callsBeforeOpen)
	}
}

// TestConnectorTask_FailsClosedWithoutDispatcher proves the fail-closed contract:
// with no dispatcher wired, the step returns a clear error (never a panic, never a
// silent no-op).
func TestConnectorTask_FailsClosedWithoutDispatcher(t *testing.T) {
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	inst := connectorInstance()
	step := connectorStep()

	_, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1})
	if err == nil {
		t.Fatalf("expected fail-closed error with no dispatcher, got nil")
	}
	if !errors.Is(err, ErrConnectorDispatcherUnset) {
		t.Fatalf("error should wrap ErrConnectorDispatcherUnset, got %v", err)
	}
}

// TestConnectorTask_RetryThenSucceed proves the bounded-backoff retry path: a
// transient failure is retried and the next attempt succeeds.
func TestConnectorTask_RetryThenSucceed(t *testing.T) {
	disp := &fakeConnectorDispatcher{failN: 1, vault: map[string]string{}}
	exe := NewConnectorTaskExecutor(zerolog.Nop())
	exe.SetConnectorDispatcher(disp)

	inst := connectorInstance()
	step := connectorStep()
	step.Config["retry"] = map[string]interface{}{"max_attempts": 3, "backoff_ms": 1}

	res, err := exe.Execute(context.Background(), inst, step, &model.StepExecution{InstanceID: inst.ID, StepID: step.ID, Attempt: 1})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if got := atomic.LoadInt32(&disp.calls); got != 2 {
		t.Fatalf("dispatch calls = %d, want 2 (1 fail + 1 success)", got)
	}
	if res.Output["incident_id"] != "INC-42" {
		t.Fatalf("incident_id = %v, want INC-42", res.Output["incident_id"])
	}
}
