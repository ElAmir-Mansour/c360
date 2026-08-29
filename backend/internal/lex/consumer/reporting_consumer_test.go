package consumer

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

type fakeDurationFacts struct {
	transitions []dto.UpsertDurationFactRequest
	sources     []durationSourceCall
}

type durationSourceCall struct {
	tenantID   uuid.UUID
	kind       model.DurationFactKind
	subjectID  uuid.UUID
	occurredAt time.Time
}

func (f *fakeDurationFacts) UpsertFromTransition(_ context.Context, _ uuid.UUID, req dto.UpsertDurationFactRequest) (*model.DurationFact, error) {
	f.transitions = append(f.transitions, req)
	return &model.DurationFact{Kind: req.Kind, SubjectID: req.SubjectID}, nil
}

func (f *fakeDurationFacts) UpsertFromSource(_ context.Context, tenantID uuid.UUID, kind model.DurationFactKind, subjectID uuid.UUID, occurredAt time.Time) (*model.DurationFact, error) {
	f.sources = append(f.sources, durationSourceCall{tenantID: tenantID, kind: kind, subjectID: subjectID, occurredAt: occurredAt})
	return &model.DurationFact{Kind: kind, SubjectID: subjectID}, nil
}

func TestReportingConsumerReconstructsExecutionDeliveredFromLegalRequestID(t *testing.T) {
	tenantID := uuid.New()
	stateID := uuid.New()
	requestID := uuid.New()
	deliveredAt := time.Date(2026, 6, 20, 10, 30, 0, 0, time.UTC)
	payload, err := json.Marshal(map[string]any{
		"id":               stateID.String(),
		"legal_request_id": requestID.String(),
		"delivered_at":     deliveredAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}

	facts := &fakeDurationFacts{}
	consumer := NewReportingConsumer(nil, nil, zerolog.Nop())
	consumer.facts = facts
	err = consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.NewString(),
		Type:     "com.clario360.lex.execution.delivered",
		TenantID: tenantID.String(),
		Time:     deliveredAt.Add(time.Minute),
		Data:     payload,
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(facts.transitions) != 0 {
		t.Fatalf("transitions = %d, want 0", len(facts.transitions))
	}
	if len(facts.sources) != 1 {
		t.Fatalf("sources = %d, want 1", len(facts.sources))
	}
	got := facts.sources[0]
	if got.kind != model.DurationFactRequestProcessing {
		t.Fatalf("kind = %s, want %s", got.kind, model.DurationFactRequestProcessing)
	}
	if got.subjectID != requestID {
		t.Fatalf("subjectID = %s, want legal_request_id %s", got.subjectID, requestID)
	}
	if !got.occurredAt.Equal(deliveredAt) {
		t.Fatalf("occurredAt = %s, want %s", got.occurredAt, deliveredAt)
	}
}

func TestReportingConsumerIgnoresNonTerminalStatusChange(t *testing.T) {
	tenantID := uuid.New()
	requestID := uuid.New()
	payload, err := json.Marshal(map[string]any{
		"id":     requestID.String(),
		"status": "in_execution",
	})
	if err != nil {
		t.Fatal(err)
	}

	facts := &fakeDurationFacts{}
	consumer := NewReportingConsumer(nil, nil, zerolog.Nop())
	consumer.facts = facts
	err = consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.NewString(),
		Type:     "com.clario360.lex.request.status_changed",
		TenantID: tenantID.String(),
		Time:     time.Date(2026, 6, 20, 11, 0, 0, 0, time.UTC),
		Data:     payload,
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(facts.transitions) != 0 || len(facts.sources) != 0 {
		t.Fatalf("duration writes = transitions %d sources %d, want none", len(facts.transitions), len(facts.sources))
	}
}

func TestReportingConsumerPassesSLATargetMinutesFromPayloadSeconds(t *testing.T) {
	tenantID := uuid.New()
	requestID := uuid.New()
	startedAt := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)
	deliveredAt := time.Date(2026, 6, 20, 11, 0, 0, 0, time.UTC)
	payload, err := json.Marshal(map[string]any{
		"legal_request_id":   requestID.String(),
		"clock_started_at":   startedAt.Format(time.RFC3339),
		"delivered_at":       deliveredAt.Format(time.RFC3339),
		"sla_target_seconds": 7200,
	})
	if err != nil {
		t.Fatal(err)
	}

	facts := &fakeDurationFacts{}
	consumer := NewReportingConsumer(nil, nil, zerolog.Nop())
	consumer.facts = facts
	err = consumer.Handle(context.Background(), &events.Event{
		ID:       uuid.NewString(),
		Type:     "com.clario360.lex.request.delivered",
		TenantID: tenantID.String(),
		Time:     deliveredAt,
		Data:     payload,
	})
	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(facts.transitions) != 1 {
		t.Fatalf("transitions = %d, want 1", len(facts.transitions))
	}
	got := facts.transitions[0]
	if got.SubjectID != requestID {
		t.Fatalf("SubjectID = %s, want %s", got.SubjectID, requestID)
	}
	if got.SLATargetMinutes == nil || *got.SLATargetMinutes != 120 {
		t.Fatalf("SLATargetMinutes = %v, want 120", got.SLATargetMinutes)
	}
}
