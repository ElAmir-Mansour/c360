package migrate

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestWaveRunbookEmitsConnectorTask proves P10a's core generation contract: when a
// connector task plan is supplied, the generated PARENT wave runbook contains a
// real AUTOMATED task whose automation_action is the webhook URL and whose params
// carry the connector id, action, tenant, source and webhook token — i.e. a task
// the DR engine's Executor will POST to migrate to invoke the connector. Without
// a plan, no such task is emitted (connectors are opt-in).
func TestWaveRunbookEmitsConnectorTask(t *testing.T) {
	wave := Wave{
		ID:        uuid.New(),
		Reference: "WAV-2026-0009",
		Name:      "Wave 9",
		MoveGroups: []MoveGroup{
			mkGroup("MG-A", "Edge", 1, mkWorkload("web", "Web", StrategyRehost, 4)),
		},
	}
	tenantID := uuid.New()
	connectorID := uuid.NewSHA1(uuid.Nil, []byte("conn:mgn"))
	plan := connectorTaskPlan{
		webhook:  ConnectorWebhookConfig{WebhookURL: "http://migrate:8100/internal/migrate/webhook/connectors/invoke", WebhookToken: "secret-token"},
		tenantID: tenantID,
		source:   ConnectorSourceCutoverRun,
		connectors: []ConnectorConfig{
			{ID: connectorID, Name: "AWS MGN", Provider: "aws_mgn", Enabled: true},
		},
	}

	// With the plan: exactly one AUTOMATED connector task is appended after the
	// move-group milestone.
	withPlan, err := buildWaveRunbookPlan(wave, plan)
	if err != nil {
		t.Fatalf("buildWaveRunbookPlan: %v", err)
	}
	var connTask *DRImportStep
	milestones := 0
	for i := range withPlan.Parent.ImportSteps {
		st := &withPlan.Parent.ImportSteps[i]
		switch st.TaskType {
		case drTaskTypeAutomated:
			connTask = st
		case "milestone":
			milestones++
		}
	}
	if milestones != 1 {
		t.Fatalf("milestones = %d, want 1", milestones)
	}
	if connTask == nil {
		t.Fatal("no AUTOMATED connector task emitted in the parent runbook")
	}
	if connTask.AutomationAction != "http://migrate:8100/internal/migrate/webhook/connectors/invoke" {
		t.Fatalf("automation_action = %q, want the webhook URL", connTask.AutomationAction)
	}
	if !connTask.Required {
		t.Fatal("connector task must be Required (a failed connector fails the run task)")
	}
	if got, _ := connTask.Params[migrateConnectorInvokeMarker].(bool); !got {
		t.Fatalf("connector task must carry the %s=true marker", migrateConnectorInvokeMarker)
	}
	if connTask.Params["connector_id"] != connectorID.String() {
		t.Fatalf("connector task connector_id = %v, want %s", connTask.Params["connector_id"], connectorID)
	}
	if connTask.Params["tenant_id"] != tenantID.String() {
		t.Fatalf("connector task tenant_id = %v, want %s", connTask.Params["tenant_id"], tenantID)
	}
	if connTask.Params["action"] != "cutover" {
		t.Fatalf("connector task action = %v, want cutover", connTask.Params["action"])
	}
	if connTask.Params["webhook_token"] != "secret-token" {
		t.Fatalf("connector task webhook_token = %v, want secret-token", connTask.Params["webhook_token"])
	}
	if connTask.Params["source"] != string(ConnectorSourceCutoverRun) {
		t.Fatalf("connector task source = %v, want %s", connTask.Params["source"], ConnectorSourceCutoverRun)
	}

	// Without a plan: no connector task (only the milestone).
	noPlan, err := buildWaveRunbookPlan(wave, connectorTaskPlan{})
	if err != nil {
		t.Fatalf("buildWaveRunbookPlan (no plan): %v", err)
	}
	for _, st := range noPlan.Parent.ImportSteps {
		if st.TaskType == drTaskTypeAutomated {
			t.Fatalf("connector task emitted without a plan: %s", st.Key)
		}
	}
}

// TestRollbackRunbookEmitsConnectorTask proves the rollback runbook likewise emits
// an AUTOMATED connector task, AFTER the reversion tasks, carrying the window id
// (known at rollback generation) and the rollback source/action.
func TestRollbackRunbookEmitsConnectorTask(t *testing.T) {
	wave := Wave{
		ID:        uuid.New(),
		Reference: "WAV-2026-0010",
		MoveGroups: []MoveGroup{
			mkGroup("MG-A", "Edge", 1, mkWorkload("web", "Web", StrategyRehost, 4)),
		},
	}
	windowID := uuid.New()
	window := CutoverWindow{ID: windowID, Reference: "CUT-2026-0010"}
	connectorID := uuid.NewSHA1(uuid.Nil, []byte("conn:sync"))
	plan := connectorTaskPlan{
		webhook:  ConnectorWebhookConfig{WebhookURL: "http://migrate:8100/hook", WebhookToken: "tok"},
		tenantID: uuid.New(),
		windowID: &windowID,
		source:   ConnectorSourceRollbackRun,
		connectors: []ConnectorConfig{
			{ID: connectorID, Name: "DNS Sync", Provider: "dns", Enabled: true},
		},
	}

	req, err := buildRollbackRunbookRequest(wave, window, plan)
	if err != nil {
		t.Fatalf("buildRollbackRunbookRequest: %v", err)
	}
	last := req.ImportSteps[len(req.ImportSteps)-1]
	if last.TaskType != drTaskTypeAutomated {
		t.Fatalf("last rollback step type = %q, want the appended AUTOMATED connector task", last.TaskType)
	}
	if !strings.HasPrefix(last.Key, "conn-rollback-") {
		t.Fatalf("connector task key = %q, want conn-rollback- prefix", last.Key)
	}
	if last.Params["window_id"] != windowID.String() {
		t.Fatalf("rollback connector task window_id = %v, want %s", last.Params["window_id"], windowID)
	}
	if last.Params["action"] != "rollback" || last.Params["source"] != string(ConnectorSourceRollbackRun) {
		t.Fatalf("rollback connector task action/source = %v/%v, want rollback/%s", last.Params["action"], last.Params["source"], ConnectorSourceRollbackRun)
	}
}
