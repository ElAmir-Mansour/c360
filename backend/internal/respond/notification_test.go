package respond

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type recordingNotificationSender struct {
	messages []RespondNotificationMessage
	err      error
}

func (s *recordingNotificationSender) SendRespondNotification(_ context.Context, message RespondNotificationMessage) (*NotificationSendReceipt, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.messages = append(s.messages, message)
	return &NotificationSendReceipt{ProviderMessageID: message.IdempotencyKey, Provider: "test"}, nil
}

type memoryNotificationDispatchStore struct {
	byID          map[uuid.UUID]*NotificationDispatch
	byIdempotency map[string]uuid.UUID
}

func newMemoryNotificationDispatchStore() *memoryNotificationDispatchStore {
	return &memoryNotificationDispatchStore{
		byID:          map[uuid.UUID]*NotificationDispatch{},
		byIdempotency: map[string]uuid.UUID{},
	}
}

func (s *memoryNotificationDispatchStore) UpsertNotificationDispatch(_ context.Context, dispatch *NotificationDispatch) (*NotificationDispatch, bool, error) {
	if id, ok := s.byIdempotency[dispatch.TenantID.String()+":"+dispatch.IdempotencyKey]; ok {
		return cloneNotificationDispatch(s.byID[id]), false, nil
	}
	saved := cloneNotificationDispatch(dispatch)
	saved.ID = uuid.New()
	saved.CreatedAt = time.Now().UTC()
	saved.UpdatedAt = saved.CreatedAt
	s.byID[saved.ID] = saved
	s.byIdempotency[saved.TenantID.String()+":"+saved.IdempotencyKey] = saved.ID
	return cloneNotificationDispatch(saved), true, nil
}

func (s *memoryNotificationDispatchStore) MarkNotificationDispatchSent(_ context.Context, tenantID, dispatchID uuid.UUID, providerMessageID string) (*NotificationDispatch, error) {
	dispatch, err := s.get(tenantID, dispatchID)
	if err != nil {
		return nil, err
	}
	dispatch.DeliveryState = NotificationDeliverySent
	dispatch.ProviderMessageID = providerMessageID
	dispatch.DeliveryAttempts++
	return cloneNotificationDispatch(dispatch), nil
}

func (s *memoryNotificationDispatchStore) MarkNotificationDispatchFailed(_ context.Context, tenantID, dispatchID uuid.UUID, errMessage string) (*NotificationDispatch, error) {
	dispatch, err := s.get(tenantID, dispatchID)
	if err != nil {
		return nil, err
	}
	dispatch.DeliveryState = NotificationDeliveryFailed
	dispatch.LastError = errMessage
	dispatch.DeliveryAttempts++
	return cloneNotificationDispatch(dispatch), nil
}

func (s *memoryNotificationDispatchStore) AcknowledgeNotificationDispatch(_ context.Context, tenantID, dispatchID, actorID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := s.get(tenantID, dispatchID)
	if err != nil {
		return nil, err
	}
	dispatch.AckState = NotificationAckAcknowledged
	dispatch.EscalationState = NotificationEscalationStopped
	dispatch.NextEscalationAt = nil
	dispatch.AcknowledgedBy = &actorID
	dispatch.AcknowledgedAt = &at
	return cloneNotificationDispatch(dispatch), nil
}

func (s *memoryNotificationDispatchStore) ListDueNotificationEscalations(_ context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]NotificationDispatch, error) {
	if limit <= 0 {
		limit = 100
	}
	var out []NotificationDispatch
	for _, dispatch := range s.byID {
		if dispatch.TenantID != tenantID ||
			dispatch.AckState != NotificationAckPending ||
			dispatch.EscalationState != NotificationEscalationWaiting ||
			dispatch.NextEscalationAt == nil ||
			dispatch.NextEscalationAt.After(now) {
			continue
		}
		out = append(out, *cloneNotificationDispatch(dispatch))
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func (s *memoryNotificationDispatchStore) MarkNotificationDispatchEscalated(_ context.Context, tenantID, dispatchID, escalatedDispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := s.get(tenantID, dispatchID)
	if err != nil {
		return nil, err
	}
	dispatch.EscalationState = NotificationEscalationEscalated
	dispatch.EscalatedDispatchID = &escalatedDispatchID
	dispatch.EscalatedAt = &at
	dispatch.NextEscalationAt = nil
	return cloneNotificationDispatch(dispatch), nil
}

func (s *memoryNotificationDispatchStore) MarkNotificationDispatchExhausted(_ context.Context, tenantID, dispatchID uuid.UUID, at time.Time) (*NotificationDispatch, error) {
	dispatch, err := s.get(tenantID, dispatchID)
	if err != nil {
		return nil, err
	}
	dispatch.EscalationState = NotificationEscalationExhausted
	dispatch.EscalatedAt = &at
	dispatch.NextEscalationAt = nil
	return cloneNotificationDispatch(dispatch), nil
}

func (s *memoryNotificationDispatchStore) get(tenantID, dispatchID uuid.UUID) (*NotificationDispatch, error) {
	dispatch, ok := s.byID[dispatchID]
	if !ok || dispatch.TenantID != tenantID {
		return nil, ErrNotificationDispatchNotFound
	}
	return dispatch, nil
}

func TestNotificationDispatchIdempotency(t *testing.T) {
	ctx := context.Background()
	store := newMemoryNotificationDispatchStore()
	sender := &recordingNotificationSender{}
	now := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	engine, err := NewNotificationEngine(
		store,
		sender,
		WithNotificationEngineClock(func() time.Time { return now }),
		WithDefaultAckTimeout(time.Minute),
	)
	if err != nil {
		t.Fatalf("NewNotificationEngine: %v", err)
	}

	req := baseDispatchRequest()
	first, created, err := engine.Dispatch(ctx, req)
	if err != nil {
		t.Fatalf("first Dispatch: %v", err)
	}
	if !created {
		t.Fatalf("first dispatch was not created")
	}
	second, created, err := engine.Dispatch(ctx, req)
	if err != nil {
		t.Fatalf("second Dispatch: %v", err)
	}
	if created {
		t.Fatalf("duplicate dispatch was created")
	}
	if first.ID != second.ID {
		t.Fatalf("duplicate dispatch id = %s, want %s", second.ID, first.ID)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sender calls = %d, want 1", len(sender.messages))
	}
}

func TestNotificationAckStopsEscalation(t *testing.T) {
	ctx := context.Background()
	store := newMemoryNotificationDispatchStore()
	sender := &recordingNotificationSender{}
	now := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	engine, err := NewNotificationEngine(
		store,
		sender,
		WithNotificationEngineClock(func() time.Time { return now }),
		WithDefaultAckTimeout(time.Minute),
	)
	if err != nil {
		t.Fatalf("NewNotificationEngine: %v", err)
	}

	dispatch, _, err := engine.Dispatch(ctx, baseDispatchRequest())
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	now = now.Add(2 * time.Minute)
	if _, err := engine.Acknowledge(ctx, dispatch.TenantID, dispatch.ID, dispatch.RecipientUserID); err != nil {
		t.Fatalf("Acknowledge: %v", err)
	}
	escalated, err := engine.ProcessDueEscalations(ctx, dispatch.TenantID, 10)
	if err != nil {
		t.Fatalf("ProcessDueEscalations: %v", err)
	}
	if len(escalated) != 0 {
		t.Fatalf("escalated after ack = %d, want 0", len(escalated))
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sender calls = %d, want initial send only", len(sender.messages))
	}
}

func TestNotificationNoAckEscalates(t *testing.T) {
	ctx := context.Background()
	store := newMemoryNotificationDispatchStore()
	sender := &recordingNotificationSender{}
	now := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	engine, err := NewNotificationEngine(
		store,
		sender,
		WithNotificationEngineClock(func() time.Time { return now }),
		WithDefaultAckTimeout(time.Minute),
	)
	if err != nil {
		t.Fatalf("NewNotificationEngine: %v", err)
	}

	req := baseDispatchRequest()
	dispatch, _, err := engine.Dispatch(ctx, req)
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	now = now.Add(2 * time.Minute)
	escalated, err := engine.ProcessDueEscalations(ctx, dispatch.TenantID, 10)
	if err != nil {
		t.Fatalf("ProcessDueEscalations: %v", err)
	}
	if len(escalated) != 1 {
		t.Fatalf("escalated = %d, want 1", len(escalated))
	}
	if escalated[0].RecipientUserID != req.EscalationChain[1] {
		t.Fatalf("escalated recipient = %s, want %s", escalated[0].RecipientUserID, req.EscalationChain[1])
	}
	if len(sender.messages) != 2 {
		t.Fatalf("sender calls = %d, want initial and escalation", len(sender.messages))
	}
	original := store.byID[dispatch.ID]
	if original.EscalationState != NotificationEscalationEscalated || original.EscalatedDispatchID == nil {
		t.Fatalf("original escalation state = %+v", original)
	}
}

func TestNotificationSendFailureIsRecorded(t *testing.T) {
	ctx := context.Background()
	store := newMemoryNotificationDispatchStore()
	sender := &recordingNotificationSender{err: errors.New("provider rejected request")}
	engine, err := NewNotificationEngine(store, sender, WithDefaultAckTimeout(time.Minute))
	if err != nil {
		t.Fatalf("NewNotificationEngine: %v", err)
	}

	dispatch, created, err := engine.Dispatch(ctx, baseDispatchRequest())
	if err == nil {
		t.Fatalf("Dispatch error was nil")
	}
	if !created {
		t.Fatalf("failed first dispatch should still create a durable record")
	}
	if dispatch.DeliveryState != NotificationDeliveryFailed || dispatch.LastError == "" {
		t.Fatalf("failed dispatch state = %+v", dispatch)
	}
}

func baseDispatchRequest() NotificationDispatchRequest {
	primary := uuid.New()
	secondary := uuid.New()
	return NotificationDispatchRequest{
		TenantID:        uuid.New(),
		IncidentID:      uuid.New(),
		Role:            RoleTechnicalLead,
		RecipientUserID: primary,
		Channel:         NotificationChannelEmail,
		IdempotencyKey:  "incident-role-primary",
		Title:           "Major incident mobilization",
		Body:            "You have been assigned to the incident response team.",
		RequiresAck:     true,
		AckTimeout:      time.Minute,
		EscalationChain: []uuid.UUID{primary, secondary},
	}
}

func cloneNotificationDispatch(in *NotificationDispatch) *NotificationDispatch {
	if in == nil {
		return nil
	}
	out := *in
	out.EscalationChain = append([]uuid.UUID(nil), in.EscalationChain...)
	out.Payload = copyPayload(in.Payload)
	if in.RoleAssignmentID != nil {
		id := *in.RoleAssignmentID
		out.RoleAssignmentID = &id
	}
	if in.EscalatedDispatchID != nil {
		id := *in.EscalatedDispatchID
		out.EscalatedDispatchID = &id
	}
	if in.NextEscalationAt != nil {
		at := *in.NextEscalationAt
		out.NextEscalationAt = &at
	}
	if in.EscalatedAt != nil {
		at := *in.EscalatedAt
		out.EscalatedAt = &at
	}
	if in.AcknowledgedBy != nil {
		id := *in.AcknowledgedBy
		out.AcknowledgedBy = &id
	}
	if in.AcknowledgedAt != nil {
		at := *in.AcknowledgedAt
		out.AcknowledgedAt = &at
	}
	return &out
}
