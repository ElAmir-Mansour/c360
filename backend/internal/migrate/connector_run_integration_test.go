//go:build integration

package migrate

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// executorDRBridge extends the faithful statefulDRBridge with the REAL behaviour
// of the DR Runbook Studio engine's automated-task Executor: when an AUTOMATED
// task (one that carries an automation_action that is an http(s) URL) is
// completed, it POSTs the task context — tenant/run/task ids + the task params —
// to that URL exactly like runbookActionExecutor.runHTTP does, and treats a
// non-2xx response as a task failure. This lets the test prove that executing the
// generated connector task actually drives migrate's webhook, which invokes the
// connector. It is a test double for the cross-service boundary only; the migrate
// webhook + connector-invocation logic under test is the real code.
type executorDRBridge struct {
	*statefulDRBridge
	client *http.Client
	// actions maps a task id -> (automation_action URL, params) captured at runbook
	// creation, so completing the task can replay the executor POST.
	mu      sync.Mutex
	actions map[uuid.UUID]taskAction
}

type taskAction struct {
	action string
	params map[string]any
}

func newExecutorDRBridge() *executorDRBridge {
	return &executorDRBridge{
		statefulDRBridge: newStatefulDRBridge(),
		client:           &http.Client{Timeout: 5 * time.Second},
		actions:          map[uuid.UUID]taskAction{},
	}
}

func (f *executorDRBridge) CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error) {
	rb, err := f.statefulDRBridge.CreateRunbook(ctx, tenantID, in)
	if err != nil {
		return nil, err
	}
	// Record the automation action + params for each created task by matching the
	// import step key (the stateful bridge preserves task order/keys).
	f.mu.Lock()
	for _, t := range rb.Tasks {
		for _, st := range in.ImportSteps {
			if st.Key == t.TaskKey {
				f.actions[t.ID] = taskAction{action: st.AutomationAction, params: st.Params}
			}
		}
	}
	f.mu.Unlock()
	return rb, nil
}

func (f *executorDRBridge) ActOnTask(ctx context.Context, tenantID, runID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool) (*DRRunLiveState, error) {
	// When COMPLETING an AUTOMATED task with an http(s) automation_action, replay
	// the DR Executor's webhook POST before recording the completion — exactly the
	// order the real engine uses (the Executor runs, then the task-run is marked
	// complete on success).
	if action == DRActionComplete {
		f.mu.Lock()
		ta, ok := f.actions[taskID]
		f.mu.Unlock()
		if ok && isHTTPAction(ta.action) {
			body, _ := json.Marshal(map[string]any{
				"tenant_id":  tenantID.String(),
				"run_id":     runID.String(),
				"task_id":    taskID.String(),
				"task_key":   "",
				"runbook_id": "",
				"params":     ta.params,
			})
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, ta.action, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := f.client.Do(req)
			if err != nil {
				return nil, err
			}
			raw, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				// The Executor treats a non-2xx as a task failure -> fail the task.
				return f.statefulDRBridge.ActOnTask(ctx, tenantID, runID, taskID, DRActionFail, string(raw), true)
			}
		}
	}
	return f.statefulDRBridge.ActOnTask(ctx, tenantID, runID, taskID, action, note, failRun)
}

func isHTTPAction(a string) bool {
	return len(a) >= 7 && (a[:7] == "http://" || (len(a) >= 8 && a[:8] == "https://"))
}

var _ DRBridge = (*executorDRBridge)(nil)

// mountMigrateWebhook stands up an httptest server serving migrate's connector
// webhook route against the real service, returning its base URL.
func mountMigrateWebhook(t *testing.T, svc *Service) string {
	t.Helper()
	router := NewRouter(svc, zerolog.Nop())
	mux := chi.NewRouter()
	mux.Mount("/internal/migrate/webhook", router.WebhookRoutes())
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

// TestIntegrationConnectorInvokedByCutoverRun proves P10a end-to-end: a configured
// connector, once the wave runbook is generated, becomes a real AUTOMATED task in
// the cutover runbook; when the DR engine's Executor runs that task it POSTs to
// migrate's webhook, which invokes the connector and persists the outcome. The
// connector's own endpoint records the call, proving it was genuinely invoked.
func TestIntegrationConnectorInvokedByCutoverRun(t *testing.T) {
	ctx, pool := startMigratePostgres(t)

	// A fake connector endpoint that records each invocation (this is the external
	// system the connector integrates with).
	var connectorCalls int32
	var lastAction string
	var mu sync.Mutex
	connectorSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		connectorCalls++
		if s, ok := body["action"].(string); ok {
			lastAction = s
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer connectorSrv.Close()

	bridge := newExecutorDRBridge()
	webhook := ConnectorWebhookConfig{WebhookToken: "webhook-secret"}
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{},
		WithDRBridge(bridge),
		WithConnectorExecutor(NewHTTPConnectorExecutor(EnvironmentSecretResolver{}, 5*time.Second)),
		WithConnectorWebhook(webhook))
	// The webhook URL must point at the running migrate webhook server; wire it now
	// that the service exists.
	webhook.WebhookURL = mountMigrateWebhook(t, svc) + "/internal/migrate/webhook/connectors/invoke"
	svc.connectorWebhook = webhook

	tenantID := uuid.New()
	actor := fullActor()

	// Configure an enabled connector pointed at the fake endpoint.
	if _, err := svc.SaveConnector(ctx, tenantID, SaveConnectorInput{
		Name: "AWS MGN", Provider: "aws_mgn", EndpointURL: connectorSrv.URL, AuthType: "none", Enabled: true, Actor: actor,
	}); err != nil {
		t.Fatalf("save connector: %v", err)
	}

	programID, _, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)

	// The generated parent runbook must contain the AUTOMATED connector task.
	started, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor)
	if err != nil {
		t.Fatalf("start window run: %v", err)
	}
	var connTaskID uuid.UUID
	for _, task := range started.LiveState.Tasks {
		if task.TaskType == drTaskTypeAutomated {
			connTaskID = task.ID
		}
	}
	if connTaskID == uuid.Nil {
		t.Fatal("cutover run has no AUTOMATED connector task")
	}

	// Complete the connector task: the executor double POSTs to migrate's webhook,
	// which invokes the connector.
	if _, err := svc.ActOnWindowTask(ctx, tenantID, windowID, connTaskID, DRActionComplete, "run connector", false, actor); err != nil {
		t.Fatalf("act on connector task: %v", err)
	}

	mu.Lock()
	calls := connectorCalls
	action := lastAction
	mu.Unlock()
	if calls != 1 {
		t.Fatalf("connector endpoint calls = %d, want 1 (invoked by the run task)", calls)
	}
	if action != "cutover" {
		t.Fatalf("connector action = %q, want cutover", action)
	}

	// The invocation was persisted as a run-driven ConnectorInvocation.
	var source, status string
	var drRun *uuid.UUID
	if err := pool.QueryRow(ctx, `
SELECT source, status, dr_run_id FROM migrate_connector_invocation
WHERE tenant_id = $1 AND window_id = $2`, tenantID, windowID).Scan(&source, &status, &drRun); err != nil {
		t.Fatalf("read persisted invocation: %v", err)
	}
	if source != string(ConnectorSourceCutoverRun) {
		t.Fatalf("invocation source = %q, want cutover_run", source)
	}
	if status != "succeeded" {
		t.Fatalf("invocation status = %q, want succeeded", status)
	}
	if drRun == nil || *drRun != started.LiveState.RunID {
		t.Fatalf("invocation dr_run_id = %v, want %s", drRun, started.LiveState.RunID)
	}

	// Reconstruct the params a generated connector task carries (connector id from
	// the DB) so the idempotency + auth re-drives use a faithful payload.
	var connectorID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM migrate_connector_config WHERE tenant_id = $1 LIMIT 1`, tenantID).Scan(&connectorID); err != nil {
		t.Fatalf("read connector id: %v", err)
	}
	baseParams := func() map[string]any {
		return map[string]any{
			migrateConnectorInvokeMarker: true,
			"connector_id":               connectorID.String(),
			"action":                     "cutover",
			"tenant_id":                  tenantID.String(),
			"webhook_token":              "webhook-secret",
			"source":                     string(ConnectorSourceCutoverRun),
		}
	}

	// Idempotency: re-driving the SAME run task does not double-invoke the connector.
	if _, err := svc.InvokeConnectorFromRun(ctx, RunConnectorInvocation{
		TenantID: tenantID.String(),
		RunID:    started.LiveState.RunID.String(),
		TaskID:   connTaskID.String(),
		Params:   baseParams(),
	}); err != nil {
		t.Fatalf("re-invoke (idempotent): %v", err)
	}
	mu.Lock()
	calls = connectorCalls
	mu.Unlock()
	if calls != 1 {
		t.Fatalf("connector endpoint calls after re-drive = %d, want still 1 (idempotent)", calls)
	}

	// A wrong webhook token is rejected (the webhook authenticates the call).
	badParams := baseParams()
	badParams["webhook_token"] = "wrong"
	if _, err := svc.InvokeConnectorFromRun(ctx, RunConnectorInvocation{
		TenantID: tenantID.String(), RunID: started.LiveState.RunID.String(), TaskID: uuid.New().String(), Params: badParams,
	}); err == nil {
		t.Fatal("connector webhook accepted a wrong webhook token")
	}

	_ = programID
}
