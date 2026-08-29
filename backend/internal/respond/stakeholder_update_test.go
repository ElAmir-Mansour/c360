package respond

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDeterministicStakeholderUpdateUsesIncidentStateAndTimeline(t *testing.T) {
	tenantID := uuid.New()
	incidentID := uuid.New()
	actorID := uuid.New()
	declaredAt := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	nextUpdate := declaredAt.Add(15 * time.Minute)
	eventID := uuid.New()
	inc := &Incident{
		ID:               incidentID,
		TenantID:         tenantID,
		Reference:        "INC-2026-0042",
		Title:            "Card authorization failures",
		Description:      "Card payments are failing for EMEA customers.",
		Severity:         SeveritySEV1,
		Status:           StatusMitigating,
		DeclaredBy:       actorID,
		DeclaredAt:       declaredAt,
		ImpactedServices: []string{"payments-api", "card-gateway"},
		RowVersion:       3,
	}
	latest := &TimelineEvent{
		ID:         eventID,
		TenantID:   tenantID,
		IncidentID: incidentID,
		ActorID:    actorID,
		OccurredAt: declaredAt.Add(5 * time.Minute),
		EventType:  EventSeverityChanged,
		Payload: map[string]any{
			"from": SeveritySEV2,
			"to":   SeveritySEV1,
		},
	}

	got, err := (DeterministicStakeholderUpdateGenerator{}).GenerateStakeholderUpdate(context.Background(), StakeholderUpdateSnapshot{
		Incident: inc,
		Timeline: StakeholderTimelineSummary{
			EventCount: 4,
			Latest:     latest,
		},
		Reason:       StakeholderUpdateReasonTriggered,
		GeneratedAt:  declaredAt.Add(6 * time.Minute),
		NextUpdateAt: &nextUpdate,
	})
	if err != nil {
		t.Fatalf("GenerateStakeholderUpdate: %v", err)
	}
	for _, want := range []string{
		"INC-2026-0042",
		"Card authorization failures",
		"SEV1 / Mitigating",
		"Card payments are failing for EMEA customers.",
		"payments-api, card-gateway",
		"Timeline events recorded: 4",
		EventSeverityChanged,
		nextUpdate.Format(time.RFC3339),
	} {
		if !strings.Contains(got.Body, want) {
			t.Fatalf("body missing %q:\n%s", want, got.Body)
		}
	}
	if got.Subject != "INC-2026-0042 SEV1 Mitigating update" {
		t.Fatalf("subject = %q", got.Subject)
	}
	if got.SourceTimelineEventID == nil || *got.SourceTimelineEventID != eventID {
		t.Fatalf("source timeline id = %v, want %s", got.SourceTimelineEventID, eventID)
	}
}
