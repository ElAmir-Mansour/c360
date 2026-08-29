package action

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
)

// StartWorkflowExecutor implements the start_workflow action (§4.6): it POSTs to
// the workflow engine's instance-create endpoint behind the gateway with a
// per-tenant system token + X-Tenant-ID header and returns the created instance
// id. It never calls the workflow engine's database — only its public API
// (FR-XC-004).
//
// Config (ActionRef.Config):
//
//	definition_id  (string, required)  the workflow definition to instantiate
//	trigger_data   (object, optional)  passed verbatim as the instance trigger_data
//	input_variables(object, optional)  passed verbatim as the instance input_variables
type StartWorkflowExecutor struct {
	client     *http.Client
	gatewayURL string
	minter     TokenMinter
}

// startWorkflowPath is the gateway-relative path for creating a workflow
// instance (workflow InstanceHandler mounts POST "/" under this prefix).
const startWorkflowPath = "/api/v1/workflows/instances"

// NewStartWorkflowExecutor constructs the executor. gatewayURL is the base URL of
// the API gateway (e.g. http://api-gateway:8080); minter mints the per-tenant
// system token; client is the HTTP client (a sane default is used when nil).
func NewStartWorkflowExecutor(gatewayURL string, minter TokenMinter, client *http.Client) (*StartWorkflowExecutor, error) {
	if strings.TrimSpace(gatewayURL) == "" {
		return nil, fmt.Errorf("start_workflow executor: gateway URL is required")
	}
	if minter == nil {
		return nil, fmt.Errorf("start_workflow executor: token minter is required")
	}
	if client == nil {
		client = defaultHTTPClient()
	}
	return &StartWorkflowExecutor{
		client:     client,
		gatewayURL: strings.TrimRight(gatewayURL, "/"),
		minter:     minter,
	}, nil
}

// startWorkflowBody is the request body the workflow engine's StartInstance
// handler decodes (workflow/dto.StartInstanceRequest).
type startWorkflowBody struct {
	DefinitionID   string          `json:"definition_id"`
	InputVariables map[string]any  `json:"input_variables,omitempty"`
	TriggerData    json.RawMessage `json:"trigger_data,omitempty"`
}

// Execute creates a workflow instance and records the response in the run log.
func (e *StartWorkflowExecutor) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	cfg, err := stepConfig(step, model.ActionStartWorkflow)
	if err != nil {
		return service.Output{}, err
	}
	definitionID, err := cfgString(cfg, "definition_id")
	if err != nil {
		return service.Output{}, err
	}
	inputVars, err := cfgMap(cfg, "input_variables")
	if err != nil {
		return service.Output{}, err
	}

	body := startWorkflowBody{DefinitionID: definitionID, InputVariables: inputVars}
	if td, ok := cfg["trigger_data"]; ok && td != nil {
		raw, mErr := json.Marshal(td)
		if mErr != nil {
			return service.Output{}, invalidConfig("trigger_data is not JSON-serialisable: %v", mErr)
		}
		body.TriggerData = raw
	}

	tenantID, err := tenantFromContext(ctx)
	if err != nil {
		return service.Output{}, err
	}
	token, err := e.minter.MintSystemToken(tenantID)
	if err != nil {
		// A minting failure is an infrastructure blip, not a config error: retry.
		return service.Output{}, unavailable(err, "minting system token for tenant %s", tenantID)
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return service.Output{}, fmt.Errorf("start_workflow: marshal request body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.gatewayURL+startWorkflowPath, bytes.NewReader(payload))
	if err != nil {
		return service.Output{}, fmt.Errorf("start_workflow: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := e.client.Do(req)
	if err != nil {
		return service.Output{}, unavailable(err, "POST %s", startWorkflowPath)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := fmt.Sprintf("workflow engine returned %d for POST %s: %s", resp.StatusCode, startWorkflowPath, strings.TrimSpace(string(respBody)))
		if statusIsRetryable(resp.StatusCode) {
			return service.Output{}, unavailable(nil, "%s", msg)
		}
		return service.Output{}, fmt.Errorf("start_workflow: %s", msg)
	}

	instanceID, fields := extractInstance(respBody)
	out := service.Output{Data: map[string]any{
		"action":        model.ActionStartWorkflow,
		"definition_id": definitionID,
		"instance_id":   instanceID,
		"status_code":   resp.StatusCode,
	}}
	if fields != nil {
		out.Data["response"] = fields
	}
	return out, nil
}

// extractInstance pulls the created instance id and a compact copy of the
// response from the workflow engine. The engine's Start handler returns the
// InstanceResponse directly (top-level "id"); other Clario handlers wrap the
// resource in {"data": {...}} (suiteapi.WriteData). Both shapes are handled so
// the executor is robust to the response envelope.
func extractInstance(body []byte) (string, map[string]any) {
	var top map[string]any
	if err := json.Unmarshal(body, &top); err != nil {
		return "", nil
	}
	if id, ok := top["id"].(string); ok && id != "" {
		return id, top
	}
	if data, ok := top["data"].(map[string]any); ok {
		if id, ok := data["id"].(string); ok && id != "" {
			return id, data
		}
		return "", data
	}
	return "", top
}
