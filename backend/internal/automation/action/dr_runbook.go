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

// DRRunbookExecutor implements the dr_runbook action (§4.6): it POSTs to the DR
// Runbook Studio's ActOnTask endpoint behind the gateway to act on a live DR run
// task (complete / skip / fail), with a per-tenant system token + X-Tenant-ID
// header. The Automation engine appears to the DR service as the actor (the DR
// service stamps ActedBy from the request user; the system token carries the
// automation identity). It never touches the DR database (FR-XC-004).
//
// The DR route is verb-suffixed (router.go:84):
//
//	POST /api/v1/dr/studio/runs/{runID}/tasks/{taskID}:{complete|skip|fail}
//
// Config (ActionRef.Config):
//
//	run_id      (string, required)  the live DR run id
//	task_id     (string, required)  the task within the run to act on
//	task_action (string, required)  one of complete|skip|fail
//	note        (string, optional)  free-text note recorded with the action
//	fail_run    (bool, optional)    on a "fail" of a non-required task, also fail
//	                                the whole run (DR ActOnTaskInput.FailRun)
type DRRunbookExecutor struct {
	client     *http.Client
	gatewayURL string
	minter     TokenMinter
}

// validDRTaskActions is the closed set of DR task verbs the endpoint accepts.
var validDRTaskActions = map[string]bool{
	"complete": true,
	"skip":     true,
	"fail":     true,
}

// NewDRRunbookExecutor constructs the executor.
func NewDRRunbookExecutor(gatewayURL string, minter TokenMinter, client *http.Client) (*DRRunbookExecutor, error) {
	if strings.TrimSpace(gatewayURL) == "" {
		return nil, fmt.Errorf("dr_runbook executor: gateway URL is required")
	}
	if minter == nil {
		return nil, fmt.Errorf("dr_runbook executor: token minter is required")
	}
	if client == nil {
		client = defaultHTTPClient()
	}
	return &DRRunbookExecutor{
		client:     client,
		gatewayURL: strings.TrimRight(gatewayURL, "/"),
		minter:     minter,
	}, nil
}

// drActOnTaskBody mirrors the DR actOnTaskRequest body (note / fail_run).
type drActOnTaskBody struct {
	Note    string `json:"note,omitempty"`
	FailRun bool   `json:"fail_run,omitempty"`
}

// Execute acts on a DR run task and records the DR live-state response.
func (e *DRRunbookExecutor) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	cfg, err := stepConfig(step, model.ActionDRRunbook)
	if err != nil {
		return service.Output{}, err
	}
	runID, err := cfgString(cfg, "run_id")
	if err != nil {
		return service.Output{}, err
	}
	taskID, err := cfgString(cfg, "task_id")
	if err != nil {
		return service.Output{}, err
	}
	taskAction, err := cfgString(cfg, "task_action")
	if err != nil {
		return service.Output{}, err
	}
	taskAction = strings.ToLower(strings.TrimSpace(taskAction))
	if !validDRTaskActions[taskAction] {
		return service.Output{}, invalidConfig("task_action %q must be one of complete|skip|fail", taskAction)
	}
	note, err := cfgStringOpt(cfg, "note", "")
	if err != nil {
		return service.Output{}, err
	}
	failRun, err := cfgBool(cfg, "fail_run", false)
	if err != nil {
		return service.Output{}, err
	}

	tenantID, err := tenantFromContext(ctx)
	if err != nil {
		return service.Output{}, err
	}
	token, err := e.minter.MintSystemToken(tenantID)
	if err != nil {
		return service.Output{}, unavailable(err, "minting system token for tenant %s", tenantID)
	}

	payload, err := json.Marshal(drActOnTaskBody{Note: note, FailRun: failRun})
	if err != nil {
		return service.Output{}, fmt.Errorf("dr_runbook: marshal request body: %w", err)
	}

	// The DR handler splits the {taskAction} path param on ':' into taskID:verb.
	path := fmt.Sprintf("/api/v1/dr/studio/runs/%s/tasks/%s:%s", runID, taskID, taskAction)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.gatewayURL+path, bytes.NewReader(payload))
	if err != nil {
		return service.Output{}, fmt.Errorf("dr_runbook: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := e.client.Do(req)
	if err != nil {
		return service.Output{}, unavailable(err, "POST %s", path)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := fmt.Sprintf("DR studio returned %d for POST %s: %s", resp.StatusCode, path, strings.TrimSpace(string(respBody)))
		if statusIsRetryable(resp.StatusCode) {
			return service.Output{}, unavailable(nil, "%s", msg)
		}
		return service.Output{}, fmt.Errorf("dr_runbook: %s", msg)
	}

	out := service.Output{Data: map[string]any{
		"action":      model.ActionDRRunbook,
		"run_id":      runID,
		"task_id":     taskID,
		"task_action": taskAction,
		"status_code": resp.StatusCode,
	}}
	// The DR handler returns {"data": LiveState}; record it for replay/audit.
	if state := decodeDRState(respBody); state != nil {
		out.Data["live_state"] = state
	}
	return out, nil
}

// decodeDRState extracts the DR LiveState from the {"data": ...} envelope the DR
// handler writes (suiteapi.WriteData), falling back to the raw object.
func decodeDRState(body []byte) map[string]any {
	var top map[string]any
	if err := json.Unmarshal(body, &top); err != nil {
		return nil
	}
	if data, ok := top["data"].(map[string]any); ok {
		return data
	}
	return top
}
