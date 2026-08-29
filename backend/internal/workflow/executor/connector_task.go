package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// =============================================================================
// connector_task — GOVERNED connector invocation step (EXTENSIBILITY).
//
// The service_task executor calls raw net/http and can only reach the fixed set
// of first-party services in the engine's ServiceURLs map. connector_task closes
// the ServiceNow-Flow->IntegrationHub / n8n gap: an authored flow can invoke ANY
// governed connector registered in the platform's integration framework (the
// generic connector Registry + its ~8 delivery/action connectors, or the richer
// lex custom-REST connector with its SSRF guard + secret-ref custody + rules),
// with inputs/outputs mapped through the SAME ${...} VariableResolver every other
// step uses.
//
// It is PURELY ADDITIVE: no existing definition references connector_task, and
// service_task and every other step type are byte-for-byte unchanged.
//
// GOVERNED TRANSIT. connector_task does NOT talk to any connector directly.
// Instead it dispatches through a NARROW seam — ConnectorDispatcher — implemented
// by the service/cmd layer (which CAN import the integration registry) and
// injected via SetConnectorDispatcher, exactly mirroring the ChildStarter /
// FormLoader / IdempotencyStore seams. This keeps the executor package free of any
// dependency on internal/integration or internal/lex, so there is no import cycle
// and test doubles can stand in for the whole dispatch surface.
//
// The dispatcher is the governance choke point that the executor wraps with the
// EXISTING service-task machinery:
//
//   - CIRCUIT BREAKER + BOUNDED BACKOFF: reused from service_task (per-connector
//     breaker, exponential backoff capped at 30s) so a failing connector is
//     tripped open and probed, exactly like an HTTP service.
//   - IDEMPOTENCY LEDGER (Wave-1): the SAME IdempotencyStore seam. The executor
//     CLAIMS the per-attempt key BEFORE any dispatch; a recovered/retried run of
//     the same attempt REPLAYS the cached output and NEVER re-fires the connector.
//     The claimed key is handed to the dispatcher as the Idempotency-Key so a
//     cooperating connector can also dedupe server-side.
//   - SECRET-REF RESOLUTION + EGRESS/SSRF POLICY: performed INSIDE the dispatcher
//     implementation (it owns the integration framework's secret custody + egress
//     guard). Secrets are resolved at call time from the framework and are NEVER
//     placed in step config, resolved variables, the audit event, or the step
//     output. An egress-denied target surfaces as ErrConnectorEgressDenied and the
//     step fails closed.
//   - AUDIT EMIT: workflow.connector.invoked / workflow.connector.failed are
//     published to the workflow events topic (hash-chain audit) carrying only
//     non-sensitive metadata (connector kind/id, operation, status, latency) —
//     never secrets and never the full request/response payload.
//
// FAIL-CLOSED. When no dispatcher is wired (the test-double / unconfigured case)
// the step returns ErrConnectorDispatcherUnset — a clear error, never a panic and
// never a silent no-op.
// =============================================================================

// Sentinel errors for connector_task. ErrConnectorEgressDenied is what a
// dispatcher returns (or wraps) when the target host is blocked by the
// framework's egress/SSRF policy; the executor treats it as non-retryable and
// fails the step closed.
var (
	// ErrConnectorDispatcherUnset is returned when connector_task runs but no
	// ConnectorDispatcher has been wired. Fail-closed: better a loud error than a
	// silently dropped integration call.
	ErrConnectorDispatcherUnset = errors.New("connector_task: no connector dispatcher wired (governed integration unavailable)")

	// ErrConnectorEgressDenied signals the dispatcher rejected the target on
	// egress/SSRF policy grounds. It is non-retryable (retrying a blocked host is
	// pointless and would just churn the breaker).
	ErrConnectorEgressDenied = errors.New("connector_task: target rejected by egress/SSRF policy")
)

// ConnectorRequest is the governed, secret-free dispatch envelope the executor
// hands the ConnectorDispatcher. It names WHICH connector to invoke and WHAT to
// send; it never carries resolved secrets — the dispatcher resolves those from
// the framework's secret custody at call time, keyed by the connector's stored
// config.
type ConnectorRequest struct {
	// TenantID scopes connector + credential resolution to the invoking tenant
	// (RLS boundary): a flow can only reach connectors configured for its tenant.
	TenantID string
	// Kind is the connector kind/type key (e.g. "slack", "servicenow", "custom",
	// "webhook"). The dispatcher resolves this against the integration registry.
	Kind string
	// ID optionally pins a SPECIFIC configured connector endpoint/instance (when a
	// tenant has several of the same kind). Empty selects the tenant's default
	// endpoint for the kind.
	ID string
	// Operation is the connector action to perform (e.g. "send", "fetch",
	// "create_ticket"). Empty lets the connector apply its default operation.
	Operation string
	// Input is the resolved, secret-free input payload (produced from the step's
	// input mapping via the ${...} VariableResolver). It never contains
	// credentials — those live in the connector's stored config, resolved by the
	// dispatcher.
	Input map[string]interface{}
	// IdempotencyKey is the executor's per-attempt key. The dispatcher SHOULD pass
	// it to the connector (e.g. an Idempotency-Key header) so cooperating
	// downstreams can dedupe server-side, complementing the executor's ledger.
	IdempotencyKey string
}

// ConnectorResponse is the governed, secret-free result the dispatcher returns.
// Output flows back into the step output (and is cached in the idempotency
// ledger for replay); it MUST NOT contain any secret material.
type ConnectorResponse struct {
	// Output is the connector's non-sensitive structured result. It becomes the
	// step's output after optional output mapping.
	Output map[string]interface{}
	// Reference is a provider-assigned identifier for the action (a ticket key, an
	// esign envelope id, a message ts), when any. Surfaced on the step output and
	// audit event.
	Reference string
	// StatusCode is the upstream status (HTTP or API), when meaningful (0 = n/a).
	StatusCode int
}

// ConnectorDispatcher is the NARROW seam connector_task uses to invoke a governed
// connector WITHOUT importing the integration framework. It is implemented by the
// service/cmd layer over internal/integration (the generic connector Registry) or
// internal/lex (the custom-REST connector), and injected via
// SetConnectorDispatcher.
//
// The implementation OWNS the framework's governance that the executor cannot
// reach from here: it resolves the connector by (tenant, kind, id), resolves
// secret-refs (kms:// / vault://) to real credentials AT CALL TIME, runs the
// egress/SSRF policy check on the target, and performs the actual outbound call.
// It returns ErrConnectorEgressDenied (directly or wrapped) when the target is
// blocked. It must NEVER return secrets in ConnectorResponse and must NEVER log
// them.
type ConnectorDispatcher interface {
	// Dispatch invokes the named connector with the request's input and returns a
	// secret-free response. An egress/SSRF rejection is reported as (or wraps)
	// ErrConnectorEgressDenied. Any other error is treated by the executor as a
	// retryable transport-class failure unless it wraps ErrConnectorEgressDenied
	// or is otherwise flagged non-retryable by the dispatcher.
	Dispatch(ctx context.Context, req ConnectorRequest) (ConnectorResponse, error)
}

// ConnectorTaskExecutor implements the connector_task step type. It reuses the
// service-task circuit breaker + bounded backoff and the Wave-1 idempotency
// ledger, and emits governed audit events, while delegating the actual (secret-
// resolving, egress-guarded) connector call to an injected ConnectorDispatcher.
type ConnectorTaskExecutor struct {
	dispatcher  ConnectorDispatcher
	producer    EventPublisher
	resolver    *expression.VariableResolver
	logger      zerolog.Logger
	breakers    map[string]*circuitBreaker
	mu          sync.RWMutex
	idempotency IdempotencyStore
}

// NewConnectorTaskExecutor builds the executor. The dispatcher, publisher and
// idempotency store are all OPTIONAL and set separately (mirroring the human/
// service task executors) so this constructor's signature stays stable for tests
// and embedders. With no dispatcher the step fails closed.
func NewConnectorTaskExecutor(logger zerolog.Logger) *ConnectorTaskExecutor {
	return &ConnectorTaskExecutor{
		resolver: expression.NewVariableResolver(),
		logger:   logger.With().Str("executor", "connector_task").Logger(),
		breakers: make(map[string]*circuitBreaker),
	}
}

// SetConnectorDispatcher installs the governed dispatch seam. It is the cmd/
// wiring's job to build a dispatcher over the integration registry; without it
// the executor fails closed.
func (e *ConnectorTaskExecutor) SetConnectorDispatcher(d ConnectorDispatcher) {
	e.dispatcher = d
}

// SetEventPublisher installs the audit publisher. When set, invoked/failed audit
// events are emitted to the workflow events topic; when nil the step still runs
// (audit emit is best-effort, mirroring the human-task executor).
func (e *ConnectorTaskExecutor) SetEventPublisher(p EventPublisher) {
	e.producer = p
}

// SetIdempotencyStore enables persisted at-most-once semantics for connector
// dispatch (Wave-1 ledger). The same seam and semantics as service_task: a
// recovered/retried run of the same attempt replays the cached output and never
// re-fires the connector. When nil the legacy at-least-once path runs.
func (e *ConnectorTaskExecutor) SetIdempotencyStore(store IdempotencyStore) {
	e.idempotency = store
}

// getBreaker returns the per-connector circuit breaker, creating one on demand.
// Keying on kind+id gives each configured connector its own breaker so one bad
// endpoint does not trip a healthy sibling of the same kind.
func (e *ConnectorTaskExecutor) getBreaker(key string) *circuitBreaker {
	e.mu.RLock()
	cb, ok := e.breakers[key]
	e.mu.RUnlock()
	if ok {
		return cb
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if cb, ok = e.breakers[key]; ok {
		return cb
	}
	cb = newCircuitBreaker()
	e.breakers[key] = cb
	return cb
}

// Connector-task config keys.
const (
	// configConnectorKind names the connector kind/type (required).
	configConnectorKind = "connector_kind"
	// configConnectorID optionally pins a specific configured connector instance.
	configConnectorID = "connector_id"
	// configConnectorOperation names the connector action (optional).
	configConnectorOperation = "operation"
	// configConnectorInputMapping maps ${...}/literal values into the connector
	// input payload: { "<connector_field>": "${variables.x}" | literal, ... }.
	configConnectorInputMapping = "input_mapping"
	// configConnectorOutputMapping OPTIONALLY projects the connector output onto
	// step output keys: { "<step_output_key>": "<connector_output_path>", ... }.
	// Absent => the connector output is surfaced verbatim under "output".
	configConnectorOutputMapping = "output_mapping"
)

// Execute dispatches a governed connector invocation.
//
// Expected step.Config keys:
//   - connector_kind (string, required)
//   - connector_id (string, optional): pin a specific configured instance
//   - operation (string, optional): connector action
//   - input_mapping (object, optional): field -> ${...}/literal
//   - output_mapping (object, optional): step_output_key -> connector_output_path
//   - retry (object, optional): {"max_attempts": int, "backoff_ms": int}
func (e *ConnectorTaskExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	// Fail-closed: no dispatcher means governed integration is unavailable.
	if e.dispatcher == nil {
		return nil, fmt.Errorf("connector_task %s: %w", step.ID, ErrConnectorDispatcherUnset)
	}

	kind, err := configString(step.Config, configConnectorKind)
	if err != nil {
		return nil, fmt.Errorf("connector_task %s: %w", step.ID, err)
	}
	connectorID := configStringOptional(step.Config, configConnectorID)
	operation := configStringOptional(step.Config, configConnectorOperation)

	// Resolve the input mapping through the SAME ${...} resolver every other step
	// uses. The resulting payload is data-only and secret-free: credentials live
	// in the connector's stored config and are resolved by the dispatcher, never
	// carried through instance variables or step config.
	dataCtx := buildDataContext(instance)
	input, err := e.resolveInputMapping(step, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("connector_task %s: %w", step.ID, err)
	}

	maxAttempts, backoffMs := parseRetryConfig(step.Config)

	// ---- Idempotency guard (at-most-once connector effect) -------------------
	// Identical shape to service_task: CLAIM the per-attempt key before any
	// dispatch; replay a completed prior attempt instead of re-firing.
	idemKey := ActivityIdempotencyKey(exec)
	if e.idempotency != nil {
		claimed, existing, cErr := e.idempotency.Claim(ctx, &model.ActivityExecution{
			IdempotencyKey: idemKey,
			InstanceID:     exec.InstanceID,
			StepID:         exec.StepID,
			Attempt:        maxOne(exec.Attempt),
		})
		if cErr != nil {
			// Fail closed: cannot record intent to call => do NOT call.
			return nil, fmt.Errorf("connector_task %s: idempotency claim: %w", step.ID, cErr)
		}
		if !claimed {
			if existing != nil && existing.Status == model.ActivityStatusCompleted {
				e.logger.Info().
					Str("step_id", step.ID).
					Str("connector_kind", kind).
					Str("idempotency_key", idemKey).
					Msg("connector call deduplicated: replaying cached response (not re-firing)")
				return replayResult(existing.ResponseData), nil
			}
			return nil, fmt.Errorf("connector_task %s: connector call already in progress for key %s (not re-firing)", step.ID, idemKey)
		}
	}

	req := ConnectorRequest{
		TenantID:       instance.TenantID,
		Kind:           kind,
		ID:             connectorID,
		Operation:      operation,
		Input:          input,
		IdempotencyKey: idemKeyIfStore(e.idempotency, idemKey),
	}

	start := time.Now()
	resp, callErr := e.runWithRetry(ctx, req, step, maxAttempts, backoffMs)
	latencyMs := time.Since(start).Milliseconds()

	// Build the step result (secret-free) BEFORE recording the ledger outcome so
	// the cached response and the returned result are identical on replay.
	var result *ExecutionResult
	if callErr == nil {
		result, err = e.buildResult(step, resp, dataCtx)
		if err != nil {
			callErr = fmt.Errorf("connector_task %s: %w", step.ID, err)
		}
	}

	// Record the ledger outcome so recovery/retry can replay or skip.
	if e.idempotency != nil {
		if callErr != nil {
			if mErr := e.idempotency.MarkFailed(ctx, idemKey, callErr.Error()); mErr != nil {
				e.logger.Error().Err(mErr).Str("idempotency_key", idemKey).Msg("failed to mark connector activity failed in idempotency ledger")
			}
		} else {
			var cached json.RawMessage
			if result != nil && result.Output != nil {
				if b, mErr := json.Marshal(result.Output); mErr == nil {
					cached = b
				}
			}
			if mErr := e.idempotency.MarkCompleted(ctx, idemKey, cached); mErr != nil {
				e.logger.Error().Err(mErr).Str("idempotency_key", idemKey).Msg("failed to mark connector activity completed in idempotency ledger")
			}
		}
	}

	// Governed audit emit (non-sensitive metadata only).
	e.publishAudit(ctx, instance, step, kind, connectorID, operation, resp, latencyMs, callErr)

	if callErr != nil {
		return nil, callErr
	}
	return result, nil
}

// runWithRetry dispatches through the ConnectorDispatcher with circuit-breaker
// protection and bounded exponential backoff — the SAME governance service_task
// applies to HTTP calls. An egress/SSRF denial is non-retryable and short-circuits
// the loop; other errors trip the breaker and back off.
func (e *ConnectorTaskExecutor) runWithRetry(ctx context.Context, req ConnectorRequest, step *model.StepDefinition, maxAttempts, backoffMs int) (ConnectorResponse, error) {
	breakerKey := req.Kind
	if req.ID != "" {
		breakerKey = req.Kind + ":" + req.ID
	}
	cb := e.getBreaker(breakerKey)

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			delay := time.Duration(backoffMs) * time.Millisecond
			for i := 1; i < attempt; i++ {
				delay *= 2
			}
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
			e.logger.Debug().
				Str("step_id", step.ID).
				Str("connector_kind", req.Kind).
				Int("attempt", attempt+1).
				Dur("backoff", delay).
				Msg("retrying connector dispatch")
			select {
			case <-ctx.Done():
				return ConnectorResponse{}, fmt.Errorf("connector_task %s: context cancelled during retry backoff: %w", step.ID, ctx.Err())
			case <-time.After(delay):
			}
		}

		if !cb.Allow() {
			lastErr = fmt.Errorf("connector_task %s: circuit_open for connector %q", step.ID, breakerKey)
			e.logger.Warn().
				Str("step_id", step.ID).
				Str("connector", breakerKey).
				Msg("circuit breaker open, skipping connector dispatch")
			continue
		}

		resp, err := e.dispatcher.Dispatch(ctx, req)
		if err == nil {
			cb.RecordSuccess()
			e.logger.Info().
				Str("step_id", step.ID).
				Str("connector_kind", req.Kind).
				Str("connector_id", req.ID).
				Str("operation", req.Operation).
				Int("attempt", attempt+1).
				Msg("connector dispatch succeeded")
			return resp, nil
		}

		lastErr = err
		// An egress/SSRF denial is a hard, non-retryable policy failure: do not
		// churn the breaker or retry a target we are not permitted to reach.
		if errors.Is(err, ErrConnectorEgressDenied) {
			e.logger.Error().
				Err(err).
				Str("step_id", step.ID).
				Str("connector_kind", req.Kind).
				Msg("connector dispatch rejected by egress/SSRF policy (not retrying)")
			return ConnectorResponse{}, fmt.Errorf("connector_task %s: %w", step.ID, err)
		}

		cb.RecordFailure()
		e.logger.Warn().
			Err(err).
			Str("step_id", step.ID).
			Str("connector_kind", req.Kind).
			Int("attempt", attempt+1).
			Int("max_attempts", maxAttempts).
			Msg("connector dispatch failed, will retry")
	}

	return ConnectorResponse{}, fmt.Errorf("connector_task %s: all %d attempts exhausted: %w", step.ID, maxAttempts, lastErr)
}

// resolveInputMapping resolves the step's input_mapping into a concrete payload
// via the ${...} VariableResolver. An absent mapping yields an empty payload; a
// non-object mapping is a config error.
func (e *ConnectorTaskExecutor) resolveInputMapping(step *model.StepDefinition, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	raw, ok := step.Config[configConnectorInputMapping]
	if !ok || raw == nil {
		return map[string]interface{}{}, nil
	}
	m, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("%s must be an object", configConnectorInputMapping)
	}
	resolved, err := e.resolver.Resolve(m, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("resolving input_mapping: %w", err)
	}
	out, ok := resolved.(map[string]interface{})
	if !ok {
		return map[string]interface{}{}, nil
	}
	return out, nil
}

// buildResult assembles the step output from the connector response, applying an
// optional output_mapping. The connector reference + status code are always
// surfaced as non-sensitive metadata; the raw connector output is exposed under
// "output" when no explicit mapping is configured.
func (e *ConnectorTaskExecutor) buildResult(step *model.StepDefinition, resp ConnectorResponse, dataCtx map[string]interface{}) (*ExecutionResult, error) {
	out := map[string]interface{}{}
	if resp.Reference != "" {
		out["reference"] = resp.Reference
	}
	if resp.StatusCode != 0 {
		out["status_code"] = resp.StatusCode
	}

	mappingRaw, hasMapping := step.Config[configConnectorOutputMapping]
	if !hasMapping || mappingRaw == nil {
		// No explicit mapping: surface the connector output verbatim.
		if resp.Output != nil {
			out["output"] = resp.Output
		}
		return &ExecutionResult{Output: out}, nil
	}

	mapping, ok := mappingRaw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("%s must be an object", configConnectorOutputMapping)
	}
	// Build a single resolution root so mapping paths can address BOTH the
	// top-level response metadata ("reference", "status_code") AND the nested
	// connector payload ("output.<...>", e.g. "output.ticket.state").
	respRoot := map[string]interface{}{
		"reference":   resp.Reference,
		"status_code": resp.StatusCode,
		"output":      resp.Output,
	}
	for stepKey, pathRaw := range mapping {
		path, ok := pathRaw.(string)
		if !ok {
			return nil, fmt.Errorf("%s[%s] must be a string path", configConnectorOutputMapping, stepKey)
		}
		val, err := e.resolver.ResolvePath(path, respRoot)
		if err != nil {
			// A mapping miss is not fatal: leave the key unset (the connector may
			// legitimately omit an optional field) but do not error the step.
			e.logger.Debug().Str("step_id", step.ID).Str("path", path).Msg("output_mapping path not present in connector response")
			continue
		}
		out[stepKey] = val
	}
	return &ExecutionResult{Output: out}, nil
}

// publishAudit emits workflow.connector.invoked (success) or
// workflow.connector.failed to the workflow events topic. The payload carries
// ONLY non-sensitive metadata: connector kind/id, operation, status, latency, and
// (on failure) a sanitized error message. It NEVER carries secrets, the input
// payload, or the full connector response. Best-effort: a publish failure is
// logged, never fails the step.
func (e *ConnectorTaskExecutor) publishAudit(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, kind, connectorID, operation string, resp ConnectorResponse, latencyMs int64, callErr error) {
	if e.producer == nil {
		return
	}
	payload := map[string]interface{}{
		"instance_id":    instance.ID,
		"step_id":        step.ID,
		"connector_kind": kind,
		"operation":      operation,
		"latency_ms":     latencyMs,
	}
	if connectorID != "" {
		payload["connector_id"] = connectorID
	}
	if instance.StartedBy != nil {
		payload["initiator_id"] = *instance.StartedBy
	}

	eventType := "workflow.connector.invoked"
	if callErr != nil {
		eventType = "workflow.connector.failed"
		payload["status"] = "failed"
		payload["error"] = callErr.Error()
	} else {
		payload["status"] = "invoked"
		if resp.Reference != "" {
			payload["reference"] = resp.Reference
		}
		if resp.StatusCode != 0 {
			payload["status_code"] = resp.StatusCode
		}
	}

	evt, err := events.NewEvent(eventType, "workflow-engine", instance.TenantID, payload)
	if err != nil {
		e.logger.Warn().Err(err).Str("step_id", step.ID).Msg("failed to build connector audit event")
		return
	}
	if err := e.producer.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		e.logger.Warn().Err(err).Str("step_id", step.ID).Msg("failed to publish connector audit event")
	}
}

// idemKeyIfStore returns the idempotency key only when a store is wired, so the
// dispatcher receives a key to forward exactly when the executor is enforcing
// at-most-once (mirroring service_task, which stamps the header only when guarded).
func idemKeyIfStore(store IdempotencyStore, key string) string {
	if store == nil {
		return ""
	}
	return key
}

// parseRetryConfig reads the optional {"max_attempts","backoff_ms"} retry block,
// applying the same defaults as service_task (1 attempt, 500ms backoff).
func parseRetryConfig(config map[string]interface{}) (maxAttempts, backoffMs int) {
	maxAttempts = 1
	backoffMs = 500
	if retryRaw, ok := config["retry"]; ok {
		if retryMap, ok := retryRaw.(map[string]interface{}); ok {
			if v, ok := retryMap["max_attempts"]; ok {
				maxAttempts = toInt(v)
			}
			if v, ok := retryMap["backoff_ms"]; ok {
				backoffMs = toInt(v)
			}
		}
	}
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	return maxAttempts, backoffMs
}
