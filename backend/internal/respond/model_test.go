package respond

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTransitionTableExhaustive(t *testing.T) {
	for _, from := range Statuses {
		allowed := map[Status]bool{}
		for _, to := range TransitionTable[from] {
			allowed[to] = true
			if err := ValidateTransition(from, to); err != nil {
				t.Fatalf("allowed transition %s -> %s rejected: %v", from, to, err)
			}
		}
		for _, to := range Statuses {
			if from == to || allowed[to] {
				continue
			}
			if err := ValidateTransition(from, to); err == nil {
				t.Fatalf("forbidden transition %s -> %s was accepted", from, to)
			}
		}
	}
}

func TestActorPermissions(t *testing.T) {
	userID := uuid.New()
	commander := Actor{UserID: userID, IncidentRoles: []IncidentRole{RoleCommander}}
	if !commander.Can(PermRespondTransition) || !commander.Can(PermRespondSeverity) {
		t.Fatalf("commander should transition and change severity")
	}

	resolver := Actor{UserID: userID, IncidentRoles: []IncidentRole{RoleResolver}}
	if resolver.Can(PermRespondTransition) {
		t.Fatalf("resolver should not transition incident lifecycle")
	}
	if !resolver.Can(PermRespondUpdate) {
		t.Fatalf("resolver should update incident details")
	}

	admin := Actor{UserID: userID, GlobalPermissions: []string{"respond:*"}}
	if !admin.Can(PermRespondTimeline) || !admin.Can(PermRespondDeclare) {
		t.Fatalf("respond wildcard should cover respond permissions")
	}
}

func TestQuickActionsGateClosureOnPIRSignOff(t *testing.T) {
	inc := &Incident{ID: uuid.New(), Status: StatusResolved, RowVersion: 7}

	actions := quickActionsForIncident(inc, nil)
	if len(actions) != 1 {
		t.Fatalf("actions = %d, want closure action", len(actions))
	}
	if actions[0].Enabled || actions[0].DisabledReason == "" {
		t.Fatalf("unsigned PIR closure action = %+v, want disabled with reason", actions[0])
	}

	signedBy := uuid.New()
	signedAt := time.Now().UTC()
	actions = quickActionsForIncident(inc, &IncidentPIR{
		Status:      PIRStatusSignedOff,
		SignedOffBy: &signedBy,
		SignedOffAt: &signedAt,
	})
	if len(actions) != 1 || !actions[0].Enabled || actions[0].DisabledReason != "" {
		t.Fatalf("signed PIR closure action = %+v, want enabled without reason", actions)
	}
}

func TestTimelineFeedPublishesByIncident(t *testing.T) {
	feed := NewTimelineFeed(1)
	incidentA := uuid.New()
	incidentB := uuid.New()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := feed.Subscribe(ctx, incidentA)

	feed.Publish(TimelineEvent{IncidentID: incidentB, EventType: "ignored"})
	select {
	case ev := <-ch:
		t.Fatalf("received event for wrong incident: %+v", ev)
	case <-time.After(20 * time.Millisecond):
	}

	want := TimelineEvent{IncidentID: incidentA, EventType: "delivered"}
	feed.Publish(want)
	select {
	case got := <-ch:
		if got.EventType != want.EventType {
			t.Fatalf("event type = %s, want %s", got.EventType, want.EventType)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for feed event")
	}
}
