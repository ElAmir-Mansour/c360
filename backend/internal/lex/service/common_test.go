package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

type recordingPublisher struct {
	topic string
	event *events.Event
}

func (p *recordingPublisher) Publish(_ context.Context, topic string, event *events.Event) error {
	p.topic = topic
	p.event = event
	return nil
}

func TestWriteEventAddsWatheeqAuditMetadata(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	publisher := &recordingPublisher{}

	writeEvent(context.Background(), publisher, "lex-service", "platform.lex.events", "com.clario360.lex.contract.created", tenantID, &userID, map[string]any{
		"id": "contract-1",
	}, zerolog.Nop())

	if publisher.topic != "platform.lex.events" {
		t.Fatalf("published topic = %q, want platform.lex.events", publisher.topic)
	}
	if publisher.event == nil {
		t.Fatal("expected published event")
	}
	if publisher.event.TenantID != tenantID.String() {
		t.Fatalf("event tenant id = %q, want %q", publisher.event.TenantID, tenantID)
	}
	if publisher.event.UserID != userID.String() {
		t.Fatalf("event user id = %q, want %q", publisher.event.UserID, userID)
	}
	if publisher.event.Subject != "contract/contract-1" {
		t.Fatalf("event subject = %q, want contract/contract-1", publisher.event.Subject)
	}
	for key, want := range map[string]string{
		"tenant_id": tenantID.String(),
		"user_id":   userID.String(),
		"action":    "contract.created",
		"product":   "watheeq",
		"suite":     "lex",
	} {
		if got := publisher.event.Metadata[key]; got != want {
			t.Fatalf("metadata[%s] = %q, want %q in %+v", key, got, want, publisher.event.Metadata)
		}
	}
}

func TestWriteEventOmitsUserMetadataForSystemEvents(t *testing.T) {
	tenantID := uuid.New()
	publisher := &recordingPublisher{}

	writeEvent(context.Background(), publisher, "lex-service", "platform.lex.events", "com.clario360.lex.compliance.checked", tenantID, nil, nil, zerolog.Nop())

	if publisher.event == nil {
		t.Fatal("expected published event")
	}
	if publisher.event.Metadata["tenant_id"] != tenantID.String() {
		t.Fatalf("metadata tenant_id = %q, want %q", publisher.event.Metadata["tenant_id"], tenantID)
	}
	if publisher.event.Metadata["action"] != "compliance.checked" {
		t.Fatalf("metadata action = %q, want compliance.checked", publisher.event.Metadata["action"])
	}
	if _, ok := publisher.event.Metadata["user_id"]; ok {
		t.Fatalf("system event metadata unexpectedly included user_id: %+v", publisher.event.Metadata)
	}
	if publisher.event.UserID != "" {
		t.Fatalf("system event user id = %q, want empty", publisher.event.UserID)
	}
	if publisher.event.Subject != "" {
		t.Fatalf("system event subject = %q, want empty", publisher.event.Subject)
	}
}

func TestLexEventSubjectUsesDomainIdentifiers(t *testing.T) {
	workflowID := uuid.New()
	envelopeID := uuid.New()
	obligationID := uuid.New()

	tests := []struct {
		name      string
		eventType string
		payload   map[string]any
		want      string
	}{
		{
			name:      "workflow",
			eventType: "com.clario360.lex.workflows.task_decided",
			payload:   map[string]any{"workflow_instance_id": workflowID.String(), "task_id": uuid.NewString()},
			want:      "workflow/" + workflowID.String(),
		},
		{
			name:      "signature",
			eventType: "com.clario360.lex.signatures.provider_event",
			payload:   map[string]any{"envelope_id": envelopeID.String(), "provider_status": "completed"},
			want:      "signature/" + envelopeID.String(),
		},
		{
			name:      "obligation reminder",
			eventType: "com.clario360.lex.obligation_reminder.delivery_recorded",
			payload:   map[string]any{"obligation_id": obligationID.String()},
			want:      "obligation/" + obligationID.String(),
		},
		{
			name:      "no identifier",
			eventType: "com.clario360.lex.compliance.checked",
			payload:   map[string]any{"status": "ok"},
			want:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.New()
			publisher := &recordingPublisher{}

			writeEvent(context.Background(), publisher, "lex-service", "platform.lex.events", tt.eventType, tenantID, nil, tt.payload, zerolog.Nop())

			if publisher.event == nil {
				t.Fatal("expected published event")
			}
			if publisher.event.Subject != tt.want {
				t.Fatalf("subject = %q, want %q", publisher.event.Subject, tt.want)
			}
		})
	}
}
