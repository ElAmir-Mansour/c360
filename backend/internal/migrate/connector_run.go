package migrate

import (
	"context"
	"crypto/subtle"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// connector_run.go (Wave 6, P10a) makes configured migration connectors ACTUALLY
// invoked during a live cutover / rollback RUN. Before Wave 6 a connector could
// only be called by the manual `POST /connectors/{id}/invoke` endpoint — it was
// never part of a real execution.
//
// The real path now: when a wave/rollback runbook is generated the generator
// emits an AUTOMATED task per configured, enabled connector whose
// automation_action is migrate's OWN connector-invocation webhook URL. The DR
// Runbook Studio engine's Executor (cmd/clario-dr-service/orchestration.go,
// runbookActionExecutor.runHTTP) POSTs the task context — including the task
// params — to that webhook when the task runs. The webhook (InvokeConnectorFromRun)
// resolves the window from the DR run id, resolves the configured connector, and
// invokes it through the SAME ConnectorExecutor the manual path uses, persisting
// the outcome as a run-driven ConnectorInvocation. The connector is therefore
// driven by the real DR engine, not a dead manual-only endpoint.

// ConnectorWebhookConfig configures the self-referential webhook the generated
// AUTOMATED connector tasks call. WebhookURL is migrate's own internal
// connector-invocation endpoint the DR engine's Executor can reach
// (MIGRATE_SELF_URL + /internal/migrate/connectors/invoke); WebhookToken is a
// shared secret the webhook validates on each call. Because the DR Executor's
// HTTP action runner posts only a JSON body (no auth header), the token travels
// in the task params and the webhook compares it in constant time — the params
// live in dr_db behind that tenant's runbook, so the secret is not exposed to end
// users. When unset, connector tasks are NOT emitted (the runbook is generated
// without them) and the webhook is disabled, so the feature fails closed rather
// than emitting a task the engine cannot authenticate.
type ConnectorWebhookConfig struct {
	WebhookURL   string
	WebhookToken string
}

// Configured reports whether both a reachable webhook URL and a token are set.
func (c ConnectorWebhookConfig) Configured() bool {
	return strings.TrimSpace(c.WebhookURL) != "" && strings.TrimSpace(c.WebhookToken) != ""
}

// WithConnectorWebhook wires the connector-invocation webhook config so generated
// runbooks emit connector-invoking AUTOMATED tasks and the internal webhook can
// authenticate the DR engine's callbacks.
func WithConnectorWebhook(cfg ConnectorWebhookConfig) Option {
	return func(s *Service) { s.connectorWebhook = cfg }
}

// connectorTaskPlan is the resolved connector selection the generator projects
// into AUTOMATED runbook tasks. Each entry becomes one AUTOMATED task whose
// automation_action is the webhook URL and whose params carry the connector id,
// action, tenant + webhook token so the webhook can invoke the right connector.
type connectorTaskPlan struct {
	webhook    ConnectorWebhookConfig
	tenantID   uuid.UUID
	windowID   *uuid.UUID // set for rollback (window known at generation); nil for wave
	source     ConnectorInvocationSource
	connectors []ConnectorConfig
}

// automationTask builds the AUTOMATED DRImportStep for one connector + phase. The
// key/name encode the phase (e.g. "cutover"/"rollback") + connector name so the
// task is human-readable in the DR run. predecessorKeys chains it after the
// migration work so the connector fires once the workloads are cut over/reverted.
func (p connectorTaskPlan) automationTask(connector ConnectorConfig, phase, action string) DRImportStep {
	key := "conn-" + phase + "-" + sanitizeKey(connector.Name)
	params := map[string]any{
		migrateConnectorInvokeMarker: true,
		"connector_id":               connector.ID.String(),
		"connector_name":             connector.Name,
		"provider":                   connector.Provider,
		"action":                     action,
		"tenant_id":                  p.tenantID.String(),
		"webhook_token":              p.webhook.WebhookToken,
		"source":                     string(p.source),
	}
	if p.windowID != nil {
		params["window_id"] = p.windowID.String()
	}
	return DRImportStep{
		Key:              key,
		Name:             fmt.Sprintf("Invoke %s connector (%s)", connector.Name, action),
		TaskType:         drTaskTypeAutomated,
		Required:         true,
		Owner:            connector.Name,
		Instructions:     fmt.Sprintf("Automated: POST the %s action to the %s migration connector during %s.", action, connector.Provider, phase),
		AutomationAction: strings.TrimRight(strings.TrimSpace(p.webhook.WebhookURL), "/"),
		Params:           params,
	}
}

// drTaskTypeAutomated mirrors the DR Runbook Studio "automated" task type — the
// type the DR engine drives through its Executor (which invokes our webhook).
const (
	drTaskTypeAutomated = "automated"

	// migrateConnectorInvokeMarker flags a runbook task's params as a migrate
	// connector-invocation request, so the webhook can reject a stray POST that
	// happens to hit the endpoint without the intended shape.
	migrateConnectorInvokeMarker = "migrate_connector_invoke"
)

// resolveConnectorTaskPlan loads the tenant's enabled connectors and, when the
// webhook is configured, returns a plan the generator uses to emit connector
// tasks. When the webhook is not configured OR no enabled connector exists it
// returns a zero plan (no connector tasks), so a runbook is still generated —
// connectors are an opt-in overlay, not a hard precondition.
func (s *Service) resolveConnectorTaskPlan(ctx context.Context, tx DBTX, tenantID uuid.UUID, windowID *uuid.UUID, source ConnectorInvocationSource) (connectorTaskPlan, error) {
	if !s.connectorWebhook.Configured() {
		return connectorTaskPlan{}, nil
	}
	all, err := s.store.ListConnectors(ctx, tx, tenantID)
	if err != nil {
		return connectorTaskPlan{}, err
	}
	enabled := make([]ConnectorConfig, 0, len(all))
	for _, c := range all {
		if c.Enabled {
			enabled = append(enabled, c)
		}
	}
	if len(enabled) == 0 {
		return connectorTaskPlan{}, nil
	}
	return connectorTaskPlan{
		webhook:    s.connectorWebhook,
		tenantID:   tenantID,
		windowID:   windowID,
		source:     source,
		connectors: enabled,
	}, nil
}

// RunConnectorInvocation is the input the internal connector-invocation webhook
// decodes from the DR engine Executor's POST body. The Executor posts the task
// context (tenant_id/run_id/task_id/task_key/runbook_id) plus the task params
// (which carry the connector selection + webhook token) at the top level under
// "params".
type RunConnectorInvocation struct {
	TenantID  string         `json:"tenant_id"`
	RunID     string         `json:"run_id"`
	TaskID    string         `json:"task_id"`
	TaskKey   string         `json:"task_key"`
	RunbookID string         `json:"runbook_id"`
	Params    map[string]any `json:"params"`
}

// InvokeConnectorFromRun is invoked by the connector-invocation webhook when the
// DR engine runs a generated AUTOMATED connector task. It authenticates the call
// with the webhook token carried in the task params, resolves the window (either
// the window_id in params for a rollback runbook, or — for a wave cutover — the
// window whose dr_run_id equals the run id), resolves the configured connector,
// and invokes it through the shared ConnectorExecutor. The outcome is persisted
// as a run-driven ConnectorInvocation, idempotent per (run, task): a re-run of
// the same task returns the recorded outcome instead of re-invoking.
//
// A non-nil error surfaces to the DR engine as a task failure (the Executor's
// runHTTP treats a non-2xx as a failed automated task), so a failed connector
// invocation correctly fails the runbook task — the connector is a REAL gate.
func (s *Service) InvokeConnectorFromRun(ctx context.Context, in RunConnectorInvocation) (*ConnectorInvocation, error) {
	if !s.connectorWebhook.Configured() {
		return nil, ErrConnectorNotConfigured
	}
	if in.Params == nil {
		return nil, fmt.Errorf("connector invocation params are required: %w", ErrValidation)
	}
	if marker, _ := in.Params[migrateConnectorInvokeMarker].(bool); !marker {
		return nil, fmt.Errorf("not a migrate connector-invocation task: %w", ErrValidation)
	}
	// Authenticate: the webhook token in the task params must match the configured
	// secret. Constant-time compare, and fail closed if the task carried none.
	token := paramStr(in.Params, "webhook_token")
	if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(s.connectorWebhook.WebhookToken)) != 1 {
		return nil, ErrUnauthorized
	}

	tenantID, err := uuid.Parse(strings.TrimSpace(firstNonEmpty(paramStr(in.Params, "tenant_id"), in.TenantID)))
	if err != nil {
		return nil, fmt.Errorf("a valid tenant_id is required: %w", ErrValidation)
	}
	connectorID, err := uuid.Parse(paramStr(in.Params, "connector_id"))
	if err != nil {
		return nil, fmt.Errorf("a valid connector_id is required: %w", ErrValidation)
	}
	action := paramStr(in.Params, "action")
	if action == "" {
		return nil, fmt.Errorf("a connector action is required: %w", ErrValidation)
	}
	source := ConnectorInvocationSource(paramStr(in.Params, "source"))
	switch source {
	case ConnectorSourceCutoverRun, ConnectorSourceRollbackRun:
	default:
		source = ConnectorSourceCutoverRun
	}

	var runID *uuid.UUID
	if id, perr := uuid.Parse(strings.TrimSpace(in.RunID)); perr == nil && id != uuid.Nil {
		runID = &id
	}
	var taskID *uuid.UUID
	if id, perr := uuid.Parse(strings.TrimSpace(in.TaskID)); perr == nil && id != uuid.Nil {
		taskID = &id
	}

	// Idempotency key: deterministic per (run, task) so the DR engine re-driving
	// the same automated task never double-invokes the connector.
	idempotencyKey := paramStr(in.Params, "idempotency_key")
	if idempotencyKey == "" {
		if runID != nil && taskID != nil {
			idempotencyKey = "run:" + runID.String() + ":task:" + taskID.String()
		} else {
			idempotencyKey = "run:" + strings.TrimSpace(in.RunID) + ":task:" + strings.TrimSpace(in.TaskKey)
		}
	}

	var cfg *ConnectorConfig
	var inv *ConnectorInvocation
	var programID uuid.UUID
	created := false
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		// Idempotent: return the recorded outcome for a repeated (run, task).
		if existing, gerr := s.store.GetInvocationByKey(ctx, tx, tenantID, idempotencyKey); gerr == nil {
			inv = existing
			return nil
		} else if !errorsIsNotFound(gerr) {
			return gerr
		}

		cfg, err = s.store.GetConnector(ctx, tx, tenantID, connectorID)
		if err != nil {
			return err
		}
		if !cfg.Enabled {
			return ErrConnectorNotConfigured
		}

		// Resolve the window: rollback tasks carry it in params; cutover tasks are
		// resolved from the run id the DR engine reports.
		window, werr := s.resolveConnectorWindow(ctx, tx, tenantID, in.Params, runID)
		if werr != nil {
			return werr
		}
		programID = window.ProgramID

		inv = &ConnectorInvocation{
			TenantID:       tenantID,
			ConnectorID:    connectorID,
			WindowID:       window.ID,
			IdempotencyKey: idempotencyKey,
			Action:         action,
			RequestBody: map[string]any{
				"run_id":     in.RunID,
				"task_id":    in.TaskID,
				"task_key":   in.TaskKey,
				"runbook_id": in.RunbookID,
			},
			Source:   source,
			DRRunID:  runID,
			DRTaskID: taskID,
			TaskKey:  strings.TrimSpace(in.TaskKey),
		}
		if err := s.store.CreateInvocation(ctx, tx, inv); err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil || inv == nil || !created {
		return inv, err
	}

	// Invoke the connector OUTSIDE the tenant tx (a network call), then persist the
	// outcome + audit in a second tx — the same shape as the manual InvokeConnector.
	status, httpStatus, response, callErr := s.connectors.Invoke(ctx, *cfg, ConnectorInvocation{
		Action:         action,
		WindowID:       inv.WindowID,
		IdempotencyKey: idempotencyKey,
		RequestBody:    inv.RequestBody,
	})
	if perr := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		finished, ferr := s.store.FinishInvocation(ctx, tx, tenantID, inv.ID, status, httpStatus, response, errString(callErr))
		if ferr != nil {
			return ferr
		}
		inv = finished
		return s.audit(ctx, tx, tenantID, programID, nil, "connector.invoked_by_run", &inv.ID, "connector_invocation",
			"Migration connector invoked by DR run task", map[string]any{
				"connector_id": connectorID, "action": action, "status": status, "http_status": httpStatus,
				"source": string(source), "dr_run_id": in.RunID, "dr_task_id": in.TaskID, "task_key": in.TaskKey,
			}, s.now())
	}); perr != nil {
		return inv, perr
	}
	if callErr != nil {
		return inv, callErr
	}
	return inv, nil
}

// resolveConnectorWindow finds the cutover window a run-driven connector task
// belongs to: rollback tasks carry an explicit window_id in params; cutover tasks
// are resolved by the run id (the window persists its dr_run_id when the run
// starts). It errors if neither locates a window.
func (s *Service) resolveConnectorWindow(ctx context.Context, tx DBTX, tenantID uuid.UUID, params map[string]any, runID *uuid.UUID) (*CutoverWindow, error) {
	if raw := paramStr(params, "window_id"); raw != "" {
		windowID, err := uuid.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid window_id in connector task: %w", ErrValidation)
		}
		return s.store.GetWindow(ctx, tx, tenantID, windowID)
	}
	if runID != nil {
		w, err := s.store.GetWindowByDRRunID(ctx, tx, tenantID, *runID)
		if err == nil {
			return w, nil
		}
		if !errorsIsNotFound(err) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("could not resolve the cutover window for the connector task: %w", ErrNotFound)
}

// paramStr reads a trimmed string param, tolerating non-string JSON scalars.
func paramStr(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	switch v := params[key].(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}
