package consumer

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/model"
)

func TestLexNotificationConsumerRoutesSupportLifecycle(t *testing.T) {
	tenantID, requesterID, assigneeID, supportID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	tests := []struct {
		eventType string
		status    string
		recipient uuid.UUID
		actionURL string
	}{
		{"com.clario360.lex.support_request.created", "open", assigneeID, "/lex/inbox?view=incoming"},
		{"com.clario360.lex.support_request.accepted", "accepted", requesterID, "/lex/inbox?view=sent"},
		{"com.clario360.lex.support_request.resolved", "resolved", requesterID, "/lex/inbox?view=history"},
	}
	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			payload, err := json.Marshal(map[string]any{
				"id": supportID, "requester_id": requesterID, "assignee_id": assigneeID,
				"subject": "VAT clause", "status": tc.status, "target_entity_id": uuid.New(),
			})
			if err != nil {
				t.Fatal(err)
			}
			notifier := &fakeLexNotifier{}
			consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
			if err := consumer.Handle(context.Background(), &events.Event{
				ID: uuid.NewString(), Type: tc.eventType, TenantID: tenantID.String(), Data: payload,
			}); err != nil {
				t.Fatalf("Handle: %v", err)
			}
			if len(notifier.calls) != 1 {
				t.Fatalf("notifications = %d, want 1", len(notifier.calls))
			}
			got := notifier.calls[0].input
			if got.RecipientID != tc.recipient || got.Category != model.NotificationCategoryGeneral {
				t.Fatalf("notification = %+v, want recipient %s general", got, tc.recipient)
			}
			if got.EntityID == nil || *got.EntityID != supportID || got.ActionURL != tc.actionURL || got.Email {
				t.Fatalf("support notification routing = %+v", got)
			}
		})
	}
}

// The manager-approval gate is only as good as its notifications: if the
// approver is never told, every gated request stalls until they happen to open
// the inbox. Each event must reach the ONE party who can act on it.
func TestLexNotificationConsumerRoutesSupportApprovalGate(t *testing.T) {
	tenantID, requesterID, assigneeID := uuid.New(), uuid.New(), uuid.New()
	approverID, supportID := uuid.New(), uuid.New()
	tests := []struct {
		name      string
		eventType string
		status    string
		recipient uuid.UUID
		actionURL string
	}{
		// The approver, not the colleague — the request is not yet theirs.
		{"submitted goes to the approver", "com.clario360.lex.support_request.submitted_for_approval",
			"pending_manager_approval", approverID, "/lex/inbox?view=incoming"},
		// The requester only; the colleague is told by `.created` at routing.
		{"approved goes to the requester", "com.clario360.lex.support_request.approved",
			"open", requesterID, "/lex/inbox?view=sent"},
		{"rejected goes to the requester", "com.clario360.lex.support_request.rejected",
			"rejected", requesterID, "/lex/inbox?view=history"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payload, err := json.Marshal(map[string]any{
				"id": supportID, "requester_id": requesterID, "assignee_id": assigneeID,
				"approver_user_id": approverID, "approval_route": "manager", "approval_note": "",
				"subject": "VAT clause", "status": tc.status, "target_entity_id": uuid.New(),
			})
			if err != nil {
				t.Fatal(err)
			}
			notifier := &fakeLexNotifier{}
			consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
			if err := consumer.Handle(context.Background(), &events.Event{
				ID: uuid.NewString(), Type: tc.eventType, TenantID: tenantID.String(), Data: payload,
			}); err != nil {
				t.Fatalf("Handle: %v", err)
			}
			if len(notifier.calls) != 1 {
				t.Fatalf("notifications = %d, want exactly 1", len(notifier.calls))
			}
			got := notifier.calls[0].input
			if got.RecipientID != tc.recipient {
				t.Fatalf("recipient = %s, want %s", got.RecipientID, tc.recipient)
			}
			if got.EntityID == nil || *got.EntityID != supportID || got.ActionURL != tc.actionURL {
				t.Fatalf("approval notification routing = %+v", got)
			}
			if got.Title.EN == "" || got.Title.AR == "" || got.Body.EN == "" || got.Body.AR == "" {
				t.Fatalf("approval notification must be bilingual; got %+v / %+v", got.Title, got.Body)
			}
		})
	}
}

// The rejection reason is the only actionable content the requester receives, so
// it must reach them in the body rather than being buried in metadata.
func TestLexNotificationConsumerCarriesTheRejectionReasonToTheRequester(t *testing.T) {
	requesterID := uuid.New()
	payload, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "requester_id": requesterID, "approver_user_id": uuid.New(),
		"status": "rejected", "approval_route": "manager",
		"approval_note": "Route this to the contracts desk instead.",
	})
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID: uuid.NewString(), Type: "com.clario360.lex.support_request.rejected",
		TenantID: uuid.NewString(), Data: payload,
	}); err != nil {
		t.Fatal(err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	body := notifier.calls[0].input.Body
	if !strings.Contains(body.EN, "Route this to the contracts desk instead.") {
		t.Fatalf("rejection reason missing from English body: %q", body.EN)
	}
	if !strings.Contains(body.AR, "Route this to the contracts desk instead.") {
		t.Fatalf("rejection reason missing from Arabic body: %q", body.AR)
	}
}

// An auto-cleared request (no manager in the org chart, or the requester IS the
// approver) has no approver_user_id to address. It must fall through silently
// rather than notifying uuid.Nil.
func TestLexNotificationConsumerSkipsApprovalEventWithNoApprover(t *testing.T) {
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	payload, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "status": "pending_manager_approval", "approval_route": "auto_no_manager",
	})
	if err := consumer.Handle(context.Background(), &events.Event{
		ID: uuid.NewString(), Type: "com.clario360.lex.support_request.submitted_for_approval",
		TenantID: uuid.NewString(), Data: payload,
	}); err != nil {
		t.Fatal(err)
	}
	if len(notifier.calls) != 0 {
		t.Fatalf("notifications = %d, want none when there is no approver", len(notifier.calls))
	}
}

func TestLexNotificationConsumerDoesNotNotifyOnBenignSupportExpiry(t *testing.T) {
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	payload, _ := json.Marshal(map[string]any{"id": uuid.New(), "status": "expired"})
	if err := consumer.Handle(context.Background(), &events.Event{
		ID: uuid.NewString(), Type: "com.clario360.lex.support_request.expired",
		TenantID: uuid.NewString(), Data: payload,
	}); err != nil {
		t.Fatal(err)
	}
	if len(notifier.calls) != 0 {
		t.Fatalf("expiry notifications = %d, want silent cleanup", len(notifier.calls))
	}
}
