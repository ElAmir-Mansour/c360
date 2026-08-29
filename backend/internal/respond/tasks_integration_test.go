//go:build integration

package respond

import (
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationTaskTemplateInstantiationPersistsGraph(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{
		PermRespondDeclare, PermRespondRead, PermRespondUpdate, PermRespondAdmin,
	}}

	incident, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:       "payment authorization outage",
		Description: "Card authorization is failing for checkout traffic.",
		Severity:    SeveritySEV1,
		Actor:       actor,
	})
	if err != nil {
		t.Fatalf("DeclareIncident: %v", err)
	}

	graph, err := svc.InstantiateTaskTemplate(ctx, tenantID, InstantiateTaskTemplateInput{
		IncidentID:  incident.ID,
		TemplateKey: "payment-outage",
		Actor:       actor,
	})
	if err != nil {
		t.Fatalf("InstantiateTaskTemplate: %v", err)
	}
	if len(graph.Tasks) != 8 {
		t.Fatalf("tasks = %d, want seeded payment-outage graph with 8 tasks", len(graph.Tasks))
	}
	byKey := tasksByKey(graph.Tasks)
	openBridge := byKey["open-command-bridge"]
	if openBridge.Status != TaskStatusRunnable {
		t.Fatalf("open-command-bridge status = %s, want runnable", openBridge.Status)
	}
	if got := byKey["assess-payment-impact"].Status; got != TaskStatusPending {
		t.Fatalf("assess-payment-impact status = %s, want pending", got)
	}
	if got := byKey["assess-payment-impact"].Dependencies; len(got) != 1 || got[0] != openBridge.ID {
		t.Fatalf("assess-payment-impact dependencies = %v, want open-command-bridge", got)
	}

	graph, err = svc.TransitionIncidentTaskStatus(ctx, tenantID, TransitionIncidentTaskStatusInput{
		IncidentID: incident.ID,
		TaskID:     openBridge.ID,
		To:         TaskStatusComplete,
		Actor:      actor,
	})
	if err != nil {
		t.Fatalf("TransitionIncidentTaskStatus open bridge: %v", err)
	}
	byKey = tasksByKey(graph.Tasks)
	if byKey["freeze-risky-deployments"].Status != TaskStatusRunnable ||
		byKey["assess-payment-impact"].Status != TaskStatusRunnable {
		t.Fatalf("successors after open bridge = freeze:%s assess:%s, want runnable/runnable",
			byKey["freeze-risky-deployments"].Status, byKey["assess-payment-impact"].Status)
	}

	var assignmentCount, historyCount int
	if err := (pgxTenantRunner{pool: pool}).RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM respond_incident_task_assignment WHERE tenant_id = $1 AND incident_id = $2`, tenantID, incident.ID).Scan(&assignmentCount); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM respond_incident_task_status_history WHERE tenant_id = $1 AND incident_id = $2`, tenantID, incident.ID).Scan(&historyCount)
	}); err != nil {
		t.Fatalf("count persisted task history: %v", err)
	}
	if assignmentCount != 8 {
		t.Fatalf("assignment rows = %d, want 8", assignmentCount)
	}
	if historyCount < 10 {
		t.Fatalf("status history rows = %d, want creation plus frontier transitions", historyCount)
	}

	events, err := svc.ListTimelineEvents(ctx, tenantID, incident.ID, actor, TimelineFilter{Limit: 20})
	if err != nil {
		t.Fatalf("ListTimelineEvents: %v", err)
	}
	if !timelineHasEvent(events, EventTaskTemplateInstantiated) || !timelineHasEvent(events, EventTaskStatusChanged) {
		t.Fatalf("timeline events = %+v, want template and status task events", events)
	}
}

func timelineHasEvent(events []TimelineEvent, eventType string) bool {
	for _, event := range events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}
