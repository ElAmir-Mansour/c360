package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

func TestTriggerExecutionHandlerList(t *testing.T) {
	createdAt := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	reader := &fakeTriggerExecutionReader{
		listExecutions: []*model.TriggerExecution{{
			ID:           "trigger-1",
			TenantID:     "tenant-1",
			DefinitionID: "def-1",
			EventID:      "event-1",
			Topic:        events.Topics.AlertEvents,
			Status:       model.TriggerExecutionStatusStarted,
			Reason:       "instance_started",
			TriggerData:  json.RawMessage(`{"alert":{"id":"alert-1"}}`),
			CreatedAt:    createdAt,
		}},
		total: 3,
	}
	h := NewTriggerExecutionHandler(reader, nil, zerolog.Nop())

	req := httptest.NewRequest(http.MethodGet, "/?status=started&definition_id=def-1&event_id=event-1&topic=cyber.alert.events&page=2&per_page=1", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: "admin-1", TenantID: "tenant-1"}))
	rec := httptest.NewRecorder()

	h.Routes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "tenant-1", reader.tenantID)
	require.Equal(t, model.TriggerExecutionStatusStarted, reader.status)
	require.Equal(t, "def-1", reader.definitionID)
	require.Equal(t, "event-1", reader.eventID)
	require.Equal(t, events.Topics.AlertEvents, reader.topic)
	require.Equal(t, 1, reader.limit)
	require.Equal(t, 1, reader.offset)

	var resp dto.ListTriggerExecutionsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Len(t, resp.Data, 1)
	require.Equal(t, "trigger-1", resp.Data[0].ID)
	require.Equal(t, 2, resp.Meta.Page)
	require.Equal(t, 3, resp.Meta.Total)
}

func TestTriggerExecutionHandlerRejectsInvalidStatus(t *testing.T) {
	h := NewTriggerExecutionHandler(&fakeTriggerExecutionReader{}, nil, zerolog.Nop())

	req := httptest.NewRequest(http.MethodGet, "/?status=unknown", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: "admin-1", TenantID: "tenant-1"}))
	rec := httptest.NewRecorder()

	h.Routes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestTriggerExecutionHandlerReplay(t *testing.T) {
	startedAt := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	replayer := &fakeTriggerExecutionReplayer{
		instance: &model.WorkflowInstance{
			ID:            "instance-1",
			TenantID:      "tenant-1",
			DefinitionID:  "def-1",
			DefinitionVer: 2,
			Status:        model.InstanceStatusRunning,
			Variables:     map[string]interface{}{"alert_id": "alert-1"},
			StepOutputs:   map[string]interface{}{},
			StartedAt:     startedAt,
			UpdatedAt:     startedAt,
		},
	}
	h := NewTriggerExecutionHandler(&fakeTriggerExecutionReader{}, replayer, zerolog.Nop())

	req := httptest.NewRequest(http.MethodPost, "/trigger-1/replay", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: "admin-1", TenantID: "tenant-1"}))
	rec := httptest.NewRecorder()

	h.Routes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, "tenant-1", replayer.tenantID)
	require.Equal(t, "admin-1", replayer.userID)
	require.Equal(t, "trigger-1", replayer.triggerExecutionID)

	var resp dto.ReplayTriggerExecutionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, "trigger-1", resp.SourceTriggerExecutionID)
	require.Equal(t, "instance-1", resp.Instance.ID)
}

type fakeTriggerExecutionReader struct {
	exec           *model.TriggerExecution
	listExecutions []*model.TriggerExecution
	total          int
	err            error

	tenantID     string
	status       string
	definitionID string
	eventID      string
	topic        string
	limit        int
	offset       int
}

func (f *fakeTriggerExecutionReader) GetByID(_ context.Context, tenantID, id string) (*model.TriggerExecution, error) {
	f.tenantID = tenantID
	if f.err != nil {
		return nil, f.err
	}
	if f.exec == nil || f.exec.ID != id {
		return nil, model.ErrNotFound
	}
	return f.exec, nil
}

func (f *fakeTriggerExecutionReader) List(_ context.Context, tenantID, status, definitionID, eventID, topic string, _ *time.Time, _ *time.Time, limit, offset int) ([]*model.TriggerExecution, int, error) {
	f.tenantID = tenantID
	f.status = status
	f.definitionID = definitionID
	f.eventID = eventID
	f.topic = topic
	f.limit = limit
	f.offset = offset
	if f.err != nil {
		return nil, 0, f.err
	}
	return f.listExecutions, f.total, nil
}

type fakeTriggerExecutionReplayer struct {
	instance *model.WorkflowInstance
	err      error

	tenantID           string
	userID             string
	triggerExecutionID string
}

func (f *fakeTriggerExecutionReplayer) Replay(_ context.Context, tenantID, userID, triggerExecutionID string) (*model.WorkflowInstance, error) {
	f.tenantID = tenantID
	f.userID = userID
	f.triggerExecutionID = triggerExecutionID
	if f.err != nil {
		return nil, f.err
	}
	return f.instance, nil
}
