package service

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

type entitlementsChangedPayload struct {
	t        *testing.T
	tenantID string
	want     EntitlementsChangedEvent
}

func (m entitlementsChangedPayload) Match(v interface{}) bool {
	m.t.Helper()
	payload, ok := v.([]byte)
	if !ok {
		m.t.Errorf("payload argument has type %T, want []byte", v)
		return false
	}
	var event events.Event
	if err := json.Unmarshal(payload, &event); err != nil {
		m.t.Errorf("unmarshal event payload: %v", err)
		return false
	}
	if event.Type != "com.clario360."+entitlementsChangedEventType {
		m.t.Errorf("event type = %s, want com.clario360.%s", event.Type, entitlementsChangedEventType)
		return false
	}
	if event.Source != "clario360/"+eventSource {
		m.t.Errorf("event source = %s, want clario360/%s", event.Source, eventSource)
		return false
	}
	if event.TenantID != m.tenantID {
		m.t.Errorf("event tenant = %s, want %s", event.TenantID, m.tenantID)
		return false
	}
	var got EntitlementsChangedEvent
	if err := json.Unmarshal(event.Data, &got); err != nil {
		m.t.Errorf("unmarshal event data: %v", err)
		return false
	}
	if got != m.want {
		m.t.Errorf("event data = %+v, want %+v", got, m.want)
		return false
	}
	return true
}

func newServiceMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool() error = %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func expectServiceQueries(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStageEntitlementsChangedWritesTenantScopedOutboxEvent(t *testing.T) {
	mock := newServiceMockPool(t)
	svc := New(nil, nil, zerolog.Nop())
	tenantID := "aaaaaaaa-0000-0000-0000-000000000001"
	data := EntitlementsChangedEvent{
		Reason:         entitlementsChangeOverrideSet,
		EntitlementKey: "api.calls",
	}

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO event_outbox")).
		WithArgs(
			pgxmock.AnyArg(),
			tenantID,
			events.Topics.LicenseEvents,
			"com.clario360."+entitlementsChangedEventType,
			entitlementsChangedPayload{t: t, tenantID: tenantID, want: data},
		).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := svc.stageEntitlementsChanged(context.Background(), mock, tenantID, data); err != nil {
		t.Fatalf("stageEntitlementsChanged() error = %v", err)
	}
	expectServiceQueries(t, mock)
}

func TestStageEntitlementsChangedRequiresInvalidationScope(t *testing.T) {
	mock := newServiceMockPool(t)
	svc := New(nil, nil, zerolog.Nop())

	err := svc.stageEntitlementsChanged(context.Background(), mock, "aaaaaaaa-0000-0000-0000-000000000001", EntitlementsChangedEvent{
		Reason: entitlementsChangeOverrideSet,
	})
	if err == nil {
		t.Fatal("expected missing invalidation scope error")
	}
	expectServiceQueries(t, mock)
}
