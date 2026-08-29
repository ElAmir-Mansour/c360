package migrate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// workflow_client.go (Wave 5, H2) is the LOAD-BEARING integration boundary between
// migrate-service and the SHARED workflow engine (cmd/workflow-engine). Migrate's
// move-group / go-no-go / rollback-plan approval REUSES that engine as a human-task
// approval envelope — it never builds a second approval engine. This replaces the
// local DecideMoveGroup status flip the Wave-4 audit flagged as "the bypass the
// spec forbids".
//
// Cross-service is mandated: migrate-service (:8100) and workflow-engine (:8001)
// are separate processes over separate databases (migrate_db vs workflow_db), so
// the binding MUST be HTTP — migrate cannot call the workflow instRepo/taskRepo
// directly. Production wires HTTPApprovalWorkflowClient (internal HTTP + service
// token); tests substitute a fake or an httptest-backed client that asserts the
// real request shape, exactly like the Wave-2 HTTPDRBridge.

// ErrWorkflowEngineUnavailable is returned when the workflow engine cannot be
// reached (the client is not configured, workflow-engine is down, or it returned
// a transport error / 5xx). The router maps it to 503 — Migrate planning still
// works, but requesting/reading an approval fails closed.
var ErrWorkflowEngineUnavailable = errors.New("migrate approval workflow engine is unavailable")

// ErrWorkflowEngineRejected is returned when the workflow engine rejected a
// request with a 4xx (e.g. an unknown definition, a non-completable task). The
// router maps it to 502 and surfaces the engine's own error message.
var ErrWorkflowEngineRejected = errors.New("migrate approval workflow engine rejected the request")

// ErrApprovalNotStarted is returned when a decision/sync is attempted for a
// subject that has no active approval binding (the approval was never requested).
var ErrApprovalNotStarted = errors.New("migrate approval workflow has not been started")

// ErrApprovalNotDecided is returned when the bound workflow instance is still
// running (no terminal decision yet). The router maps it to 409 so the caller
// retries once the approver has acted.
var ErrApprovalNotDecided = errors.New("migrate approval workflow has not reached a decision")

// Workflow decision form values. These mirror the workflow engine's own approval
// vocabulary (internal/workflow/executor.DecisionApprove/DecisionReject) — a human
// task carries {"decision": "approve"|"reject", "rationale": "..."} in its
// form_data, which the engine records into the instance step_outputs on
// completion. Migrate reads those back to drive its FSM.
const (
	WorkflowDecisionApprove = "approve"
	WorkflowDecisionReject  = "reject"
)

// Workflow instance statuses (mirror model.InstanceStatus*). Migrate ties its
// approval FSM to the engine's authoritative instance lifecycle.
const (
	WorkflowInstanceRunning   = "running"
	WorkflowInstanceCompleted = "completed"
	WorkflowInstanceFailed    = "failed"
	WorkflowInstanceCancelled = "cancelled"
	WorkflowInstanceSuspended = "suspended"
)

// StartApprovalRequest is the migrate-side request to open an approval workflow.
// The input variables travel into the workflow instance so the human task the
// engine creates carries the migrate context (reference, program, requester,
// workload count) for the approver and for downstream notification routing.
type StartApprovalRequest struct {
	// DefinitionID is the workflow_db definition to instantiate (the approval
	// workflow, e.g. "move-group-approval"). Configured, never hardcoded.
	DefinitionID   string
	InputVariables map[string]any
}

// ApprovalInstance is the migrate-side projection of a workflow instance. Only the
// fields migrate persists / decides on are carried; the workflow engine remains
// the system of record.
type ApprovalInstance struct {
	ID           string
	DefinitionID string
	Status       string
	// StepOutputs mirrors the engine's per-step output map. The decision lives at
	// StepOutputs[stepID].output.decision once the approval task is completed.
	StepOutputs map[string]any
}

// ApprovalDecision is the terminal outcome migrate reads from a completed approval
// workflow instance.
type ApprovalDecision struct {
	// Decided is true only when the workflow instance reached a terminal state AND
	// carried a decision. A still-running instance yields Decided=false.
	Decided bool
	// Approved is the normalised migrate outcome (approve -> true, reject -> false).
	Approved  bool
	Rationale string
	// InstanceStatus is the engine's instance status the decision was read from.
	InstanceStatus string
	// StepID is the human-task step the decision was read from (for audit).
	StepID string
}

// ApprovalWorkflowClient is the seam migrate uses to request an approval and read
// its decision from the shared workflow engine. Production wires
// HTTPApprovalWorkflowClient; tests substitute a fake or httptest-backed client.
type ApprovalWorkflowClient interface {
	// Configured reports whether the client has an endpoint + definition to call.
	// When false, the approval-request path fails closed (503) and the guarded
	// manual-override path becomes the only way to decide (clearly audited).
	Configured() bool
	// DefaultDefinitionID is the configured approval workflow definition id used
	// when a StartApprovalRequest does not override it. Empty when unconfigured.
	DefaultDefinitionID() string
	// StartApproval opens a workflow instance for an approval and returns it.
	StartApproval(ctx context.Context, tenantID uuid.UUID, req StartApprovalRequest) (*ApprovalInstance, error)
	// GetInstance fetches a workflow instance (status + step outputs) by id.
	GetInstance(ctx context.Context, tenantID uuid.UUID, instanceID string) (*ApprovalInstance, error)
}

// DecisionFromInstance extracts the terminal decision from a workflow instance's
// step outputs at the given step id. It is computed from the REAL engine state —
// never a canned answer. When stepID is empty it scans every step output for a
// decision (single-step approval workflows). A still-running instance, or one with
// no decision recorded, yields Decided=false.
func DecisionFromInstance(inst *ApprovalInstance, stepID string) ApprovalDecision {
	out := ApprovalDecision{InstanceStatus: inst.Status, StepID: stepID}
	// A cancelled instance is a terminal "no decision" — treat as not decided so
	// the caller does not flip the migrate FSM off a cancelled approval.
	if inst.Status != WorkflowInstanceCompleted {
		return out
	}
	if decision, rationale, sid, ok := scanStepDecision(inst.StepOutputs, stepID); ok {
		out.Decided = true
		out.Approved = decision == WorkflowDecisionApprove
		out.Rationale = rationale
		out.StepID = sid
	}
	return out
}

// scanStepDecision reads the decision/rationale from a step output map. Each entry
// is shaped {stepID: {"output": {"decision": "...", "rationale": "..."}}} — the
// exact shape engine_service.storeStepOutput writes on human-task completion. When
// wantStep is set, only that step is read; otherwise the first step carrying a
// recognised decision wins (single-approver workflows have exactly one).
func scanStepDecision(outputs map[string]any, wantStep string) (decision, rationale, stepID string, ok bool) {
	read := func(id string, v any) (string, string, bool) {
		wrap, isMap := v.(map[string]any)
		if !isMap {
			return "", "", false
		}
		inner, hasOutput := wrap["output"].(map[string]any)
		if !hasOutput {
			// Some paths store the form_data directly without an "output" wrapper.
			inner = wrap
		}
		d, _ := inner["decision"].(string)
		d = strings.ToLower(strings.TrimSpace(d))
		if d != WorkflowDecisionApprove && d != WorkflowDecisionReject {
			return "", "", false
		}
		r, _ := inner["rationale"].(string)
		return d, r, true
	}
	if wantStep != "" {
		if d, r, found := read(wantStep, outputs[wantStep]); found {
			return d, r, wantStep, true
		}
		return "", "", "", false
	}
	for id, v := range outputs {
		if d, r, found := read(id, v); found {
			return d, r, id, true
		}
	}
	return "", "", "", false
}

// HTTPApprovalWorkflowClient calls the workflow engine's instance API on
// clario workflow-engine over an internal base URL with a service-token JWT. It is
// the production ApprovalWorkflowClient.
type HTTPApprovalWorkflowClient struct {
	baseURL      string
	token        string
	definitionID string
	client       *http.Client
}

// NewHTTPApprovalWorkflowClient constructs the production HTTP client. baseURL is
// the internal workflow-engine URL (MIGRATE_WORKFLOW_SERVICE_URL); token is the
// service-token JWT (MIGRATE_INTERNAL_TOKEN) that authorises workflow:write
// (instance start) + workflow:read (instance get); definitionID is the configured
// approval workflow definition (MIGRATE_APPROVAL_WORKFLOW_DEFINITION_ID).
func NewHTTPApprovalWorkflowClient(baseURL, token, definitionID string, timeout time.Duration) *HTTPApprovalWorkflowClient {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &HTTPApprovalWorkflowClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:        strings.TrimSpace(token),
		definitionID: strings.TrimSpace(definitionID),
		client:       &http.Client{Timeout: timeout},
	}
}

// Configured reports whether the client has both an endpoint and a definition id.
// Both are required: without an endpoint there is nowhere to call; without a
// definition id there is no approval workflow to instantiate.
func (c *HTTPApprovalWorkflowClient) Configured() bool {
	return c != nil && c.baseURL != "" && c.definitionID != ""
}

func (c *HTTPApprovalWorkflowClient) DefaultDefinitionID() string {
	if c == nil {
		return ""
	}
	return c.definitionID
}

// startInstanceWire matches dto.StartInstanceRequest (the workflow engine's start
// payload).
type startInstanceWire struct {
	DefinitionID   string         `json:"definition_id"`
	InputVariables map[string]any `json:"input_variables,omitempty"`
}

// instanceWire decodes dto.InstanceResponse. The workflow instance handler writes
// this directly with writeJSON (no {"data": ...} envelope), so it is the top-level
// response body.
type instanceWire struct {
	ID            string         `json:"id"`
	DefinitionID  string         `json:"definition_id"`
	Status        string         `json:"status"`
	CurrentStepID *string        `json:"current_step_id"`
	StepOutputs   map[string]any `json:"step_outputs"`
}

// workflowErrorWire decodes the workflow engine's error body {"error": {"code",
// "message"}} so a 4xx surfaces the real engine reason.
type workflowErrorWire struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *HTTPApprovalWorkflowClient) StartApproval(ctx context.Context, tenantID uuid.UUID, req StartApprovalRequest) (*ApprovalInstance, error) {
	defID := strings.TrimSpace(req.DefinitionID)
	if defID == "" {
		defID = c.definitionID
	}
	if defID == "" {
		return nil, fmt.Errorf("%w: no approval workflow definition configured", ErrWorkflowEngineUnavailable)
	}
	body := startInstanceWire{DefinitionID: defID, InputVariables: req.InputVariables}
	var out instanceWire
	if err := c.do(ctx, tenantID, http.MethodPost, "/api/v1/workflows/instances", body, &out); err != nil {
		return nil, err
	}
	return decodeInstance(out)
}

func (c *HTTPApprovalWorkflowClient) GetInstance(ctx context.Context, tenantID uuid.UUID, instanceID string) (*ApprovalInstance, error) {
	if strings.TrimSpace(instanceID) == "" {
		return nil, fmt.Errorf("%w: empty instance id", ErrValidation)
	}
	var out instanceWire
	if err := c.do(ctx, tenantID, http.MethodGet, "/api/v1/workflows/instances/"+instanceID, nil, &out); err != nil {
		return nil, err
	}
	return decodeInstance(out)
}

func decodeInstance(in instanceWire) (*ApprovalInstance, error) {
	if strings.TrimSpace(in.ID) == "" {
		return nil, fmt.Errorf("%w: workflow instance response missing id", ErrWorkflowEngineUnavailable)
	}
	inst := &ApprovalInstance{
		ID:           in.ID,
		DefinitionID: in.DefinitionID,
		Status:       in.Status,
		StepOutputs:  in.StepOutputs,
	}
	if inst.StepOutputs == nil {
		inst.StepOutputs = map[string]any{}
	}
	return inst, nil
}

// do performs a tenant-propagated, service-token-authenticated request to the
// workflow engine and unmarshals the top-level JSON body into out. A transport
// error or 5xx is ErrWorkflowEngineUnavailable (fail closed, retriable); a 4xx is
// ErrWorkflowEngineRejected carrying the engine's own error message.
func (c *HTTPApprovalWorkflowClient) do(ctx context.Context, tenantID uuid.UUID, method, path string, body any, out any) error {
	if strings.TrimSpace(c.baseURL) == "" {
		return ErrWorkflowEngineUnavailable
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("migrate workflow client: encoding request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("%w: building request: %v", ErrWorkflowEngineUnavailable, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	// Propagate the tenant so workflow-engine scopes its tenant transaction to the
	// same tenant (its Tenant middleware honours X-Tenant-ID).
	req.Header.Set("X-Tenant-ID", tenantID.String())

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrWorkflowEngineUnavailable, err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if readErr != nil {
		return fmt.Errorf("%w: reading response: %v", ErrWorkflowEngineUnavailable, readErr)
	}
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusServiceUnavailable {
		return fmt.Errorf("%w: workflow-engine status %d", ErrWorkflowEngineUnavailable, resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var ee workflowErrorWire
		_ = json.Unmarshal(raw, &ee)
		msg := strings.TrimSpace(ee.Error.Message)
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return fmt.Errorf("%w (status %d): %s", ErrWorkflowEngineRejected, resp.StatusCode, msg)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: decoding response: %v", ErrWorkflowEngineUnavailable, err)
	}
	return nil
}

var _ ApprovalWorkflowClient = (*HTTPApprovalWorkflowClient)(nil)
