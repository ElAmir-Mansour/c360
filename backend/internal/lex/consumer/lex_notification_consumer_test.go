package consumer

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

type fakeLexNotifier struct {
	calls []notifyCall
}

type notifyCall struct {
	tenantID uuid.UUID
	input    service.NotifyInput
}

func (f *fakeLexNotifier) Notify(_ context.Context, tenantID uuid.UUID, in service.NotifyInput) (bool, error) {
	f.calls = append(f.calls, notifyCall{tenantID: tenantID, input: in})
	return true, nil
}

func TestLexNotificationConsumerRoutesSLAEscalationToInbox(t *testing.T) {
	tenantID := uuid.New()
	recipientID := uuid.New()
	requestID := uuid.New()
	clockID := uuid.New()
	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"id":                clockID.String(),
		"legal_request_id":  requestID.String(),
		"recipient_user_id": recipientID.String(),
		"escalation_level":  2,
	})
	if err != nil {
		t.Fatal(err)
	}

	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	err = consumer.Handle(context.Background(), &events.Event{
		ID:       eventID.String(),
		Type:     "com.clario360.lex.sla.escalated",
		TenantID: tenantID.String(),
		Time:     time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC),
		Data:     payload,
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	got := notifier.calls[0]
	if got.tenantID != tenantID {
		t.Fatalf("tenantID = %s, want %s", got.tenantID, tenantID)
	}
	if got.input.RecipientID != recipientID {
		t.Fatalf("RecipientID = %s, want %s", got.input.RecipientID, recipientID)
	}
	if got.input.Category != model.NotificationCategoryRequest {
		t.Fatalf("Category = %s, want %s", got.input.Category, model.NotificationCategoryRequest)
	}
	if got.input.EntityID == nil || *got.input.EntityID != requestID {
		t.Fatalf("EntityID = %v, want %s", got.input.EntityID, requestID)
	}
	if !got.input.Email {
		t.Fatalf("Email = false, want true for SLA alert (PRD 13.0 CAP-162 email fan-out)")
	}
	if got.input.EventID == nil || *got.input.EventID != eventID {
		t.Fatalf("EventID = %v, want %s", got.input.EventID, eventID)
	}
}

// TestLexNotificationConsumerFlipsPRDTriggersToEmail locks in the PRD 13.0 (CAP-162/
// CAP-163) requirement that the three transactional triggers — case status change,
// contract expiry, and SLA alert — fan out an email copy (Email:true), while the two
// deliberate in-app-only watcher paths (matter timeline, matter-comment-created) stay
// Email:false.
func TestLexNotificationConsumerFlipsPRDTriggersToEmail(t *testing.T) {
	tenantID := uuid.New()
	actorID := uuid.New()
	ownerID := uuid.New()
	recipientID := uuid.New()
	entityID := uuid.New()

	cases := []struct {
		name      string
		eventType string
		payload   map[string]any
		wantEmail bool
	}{
		{
			name:      "case status change → email",
			eventType: "com.clario360.lex.case.status_changed",
			payload:   map[string]any{"id": entityID.String(), "status": "closed"},
			wantEmail: true,
		},
		{
			name:      "contract expiring → email",
			eventType: "com.clario360.lex.contract.expiring",
			payload:   map[string]any{"id": entityID.String(), "owner_user_id": ownerID.String(), "title": "MSA"},
			wantEmail: true,
		},
		{
			name:      "sla breached → email",
			eventType: "com.clario360.lex.sla.breached",
			payload:   map[string]any{"id": entityID.String(), "recipient_user_id": recipientID.String()},
			wantEmail: true,
		},
		{
			name:      "matter timeline stays in-app only",
			eventType: "com.clario360.lex.matter.timeline_updated",
			payload:   map[string]any{"matter_id": entityID.String(), "owner_user_id": ownerID.String()},
			wantEmail: false,
		},
		{
			name:      "matter comment created stays in-app only",
			eventType: "com.clario360.lex.matters.comment_created",
			payload:   map[string]any{"matter_id": entityID.String(), "owner_user_id": ownerID.String()},
			wantEmail: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload, err := json.Marshal(tc.payload)
			if err != nil {
				t.Fatal(err)
			}
			notifier := &fakeLexNotifier{}
			consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
			if err := consumer.Handle(context.Background(), &events.Event{
				ID:       uuid.New().String(),
				Type:     tc.eventType,
				TenantID: tenantID.String(),
				UserID:   actorID.String(),
				Time:     time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC),
				Data:     payload,
			}); err != nil {
				t.Fatalf("Handle() error = %v", err)
			}
			if len(notifier.calls) != 1 {
				t.Fatalf("notifications = %d, want 1", len(notifier.calls))
			}
			if got := notifier.calls[0].input.Email; got != tc.wantEmail {
				t.Fatalf("Email = %v, want %v", got, tc.wantEmail)
			}
		})
	}
}

// TestLexNotificationConsumerRelaysMatterTimelineToInbox covers #19: every
// matter-timeline CloudEvent type the FE subscribes to is projected into an in-app
// inbox row (so the notification-service WS push reaches a live viewer), carrying
// the matter_id + raw event_type in metadata. Recipient defaults to the event
// actor when the payload has no owner_user_id.
func TestLexNotificationConsumerRelaysMatterTimelineToInbox(t *testing.T) {
	matterTimelineTypes := []string{
		"com.clario360.lex.matter.timeline_updated",
		"com.clario360.lex.matter.external_hold_set",
		"com.clario360.lex.matter.external_hold_cleared",
		"com.clario360.lex.matter.delay_recorded",
		"com.clario360.lex.matter.delay_resolved",
		"com.clario360.lex.matter.delay_updated",
		"com.clario360.lex.matter.delay_reopened",
		"com.clario360.lex.matter.deadline_obligation_created",
	}
	for _, evType := range matterTimelineTypes {
		t.Run(evType, func(t *testing.T) {
			tenantID := uuid.New()
			actorID := uuid.New()
			matterID := uuid.New()
			eventID := uuid.New()
			payload, err := json.Marshal(map[string]any{
				"id":        matterID.String(),
				"matter_id": matterID.String(),
				"category":  "court",
			})
			if err != nil {
				t.Fatal(err)
			}
			notifier := &fakeLexNotifier{}
			consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
			if err := consumer.Handle(context.Background(), &events.Event{
				ID:       eventID.String(),
				Type:     evType,
				TenantID: tenantID.String(),
				UserID:   actorID.String(),
				Time:     time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC),
				Data:     payload,
			}); err != nil {
				t.Fatalf("Handle() error = %v", err)
			}
			if len(notifier.calls) != 1 {
				t.Fatalf("notifications = %d, want 1", len(notifier.calls))
			}
			got := notifier.calls[0]
			if got.input.RecipientID != actorID {
				t.Fatalf("RecipientID = %s, want actor %s", got.input.RecipientID, actorID)
			}
			if got.input.Category != model.NotificationCategoryCase {
				t.Fatalf("Category = %s, want %s", got.input.Category, model.NotificationCategoryCase)
			}
			if got.input.EntityType != "legal_matter" {
				t.Fatalf("EntityType = %q, want legal_matter", got.input.EntityType)
			}
			if got.input.EntityID == nil || *got.input.EntityID != matterID {
				t.Fatalf("EntityID = %v, want %s", got.input.EntityID, matterID)
			}
			if got.input.Email {
				t.Fatalf("Email = true, want false for matter timeline relay")
			}
			if got.input.Metadata["event_type"] != evType {
				t.Fatalf("Metadata event_type = %v, want %s", got.input.Metadata["event_type"], evType)
			}
			if got.input.Metadata["matter_id"] != matterID.String() {
				t.Fatalf("Metadata matter_id = %v, want %s", got.input.Metadata["matter_id"], matterID.String())
			}
		})
	}
}

// TestLexNotificationConsumerRoutesRequestRoutedToRequester covers CAP-159 / PRD 13.0
// "transferring a request": a request.routed transfer with no explicit assignee is
// projected into the requester's inbox (+ email), NOT the routing actor's. The spawned
// subject linkage travels in metadata.
func TestLexNotificationConsumerRoutesRequestRoutedToRequester(t *testing.T) {
	tenantID := uuid.New()
	actorID := uuid.New()
	requesterID := uuid.New()
	requestID := uuid.New()
	subjectID := uuid.New()
	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"id":                requestID.String(),
		"request_number":    "LR-2026-0042",
		"request_type":      "litigation",
		"requester_user_id": requesterID.String(),
		"previous_status":   "approved",
		"status":            "routed",
		"subject_type":      "legal_case",
		"subject_id":        subjectID.String(),
	})
	if err != nil {
		t.Fatal(err)
	}
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       eventID.String(),
		Type:     "com.clario360.lex.request.routed",
		TenantID: tenantID.String(),
		UserID:   actorID.String(),
		Time:     time.Date(2026, 6, 28, 9, 0, 0, 0, time.UTC),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	got := notifier.calls[0]
	if got.tenantID != tenantID {
		t.Fatalf("tenantID = %s, want %s", got.tenantID, tenantID)
	}
	if got.input.RecipientID != requesterID {
		t.Fatalf("RecipientID = %s, want requester %s (not actor %s)", got.input.RecipientID, requesterID, actorID)
	}
	if got.input.Category != model.NotificationCategoryRequest {
		t.Fatalf("Category = %s, want %s", got.input.Category, model.NotificationCategoryRequest)
	}
	if got.input.EntityType != "legal_request" {
		t.Fatalf("EntityType = %q, want legal_request", got.input.EntityType)
	}
	if got.input.EntityID == nil || *got.input.EntityID != requestID {
		t.Fatalf("EntityID = %v, want %s", got.input.EntityID, requestID)
	}
	if !got.input.Email {
		t.Fatalf("Email = false, want true for request transfer receipt")
	}
	if got.input.EventID == nil || *got.input.EventID != eventID {
		t.Fatalf("EventID = %v, want %s", got.input.EventID, eventID)
	}
	if got.input.Metadata["subject_id"] != subjectID.String() {
		t.Fatalf("Metadata subject_id = %v, want %s", got.input.Metadata["subject_id"], subjectID.String())
	}
	if got.input.Metadata["request_number"] != "LR-2026-0042" {
		t.Fatalf("Metadata request_number = %v, want LR-2026-0042", got.input.Metadata["request_number"])
	}
}

// TestLexNotificationConsumerRequestRoutedPrefersAssignee verifies the transfer alert
// routes to a named new handler (assignee_user_id) — not the requester or the actor —
// when the payload carries one, so the receiving officer is notified of the handoff.
func TestLexNotificationConsumerRequestRoutedPrefersAssignee(t *testing.T) {
	tenantID := uuid.New()
	actorID := uuid.New()
	requesterID := uuid.New()
	assigneeID := uuid.New()
	requestID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"id":                requestID.String(),
		"requester_user_id": requesterID.String(),
		"assignee_user_id":  assigneeID.String(),
		"status":            "routed",
	})
	if err != nil {
		t.Fatal(err)
	}
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.New().String(),
		Type:     "com.clario360.lex.request.routed",
		TenantID: tenantID.String(),
		UserID:   actorID.String(),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	if got := notifier.calls[0].input.RecipientID; got != assigneeID {
		t.Fatalf("RecipientID = %s, want assignee %s", got, assigneeID)
	}
}

// TestLexNotificationConsumerMatterTimelinePrefersOwner verifies the relay routes
// to the matter owner when the event payload carries owner_user_id (so a colleague
// viewing the matter — not just the actor — gets the live update).
func TestLexNotificationConsumerMatterTimelinePrefersOwner(t *testing.T) {
	tenantID := uuid.New()
	actorID := uuid.New()
	ownerID := uuid.New()
	matterID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"matter_id":     matterID.String(),
		"owner_user_id": ownerID.String(),
		"category":      "government",
	})
	if err != nil {
		t.Fatal(err)
	}
	notifier := &fakeLexNotifier{}
	consumer := NewLexNotificationConsumer(notifier, nil, zerolog.Nop())
	if err := consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.New().String(),
		Type:     "com.clario360.lex.matter.delay_recorded",
		TenantID: tenantID.String(),
		UserID:   actorID.String(),
		Data:     payload,
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(notifier.calls) != 1 {
		t.Fatalf("notifications = %d, want 1", len(notifier.calls))
	}
	if got := notifier.calls[0].input.RecipientID; got != ownerID {
		t.Fatalf("RecipientID = %s, want owner %s", got, ownerID)
	}
}
