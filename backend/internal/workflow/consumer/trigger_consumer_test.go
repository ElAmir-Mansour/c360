package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

func TestEvaluateFilterSupportsRuleOperators(t *testing.T) {
	eventData := map[string]interface{}{
		"alert": map[string]interface{}{
			"severity": "critical",
			"score":    float64(92),
			"tags":     []interface{}{"edr", "ransomware"},
			"summary":  "EDR detected suspicious encryption activity",
		},
	}

	filter := map[string]interface{}{
		"alert.severity":   map[string]interface{}{"operator": "in", "value": []interface{}{"high", "critical"}},
		"alert.score":      map[string]interface{}{"gte": 90},
		"alert.tags":       map[string]interface{}{"contains": "edr"},
		"alert.summary":    map[string]interface{}{"operator": "contains", "value": "encryption"},
		"alert.suppressed": map[string]interface{}{"exists": false},
	}

	require.True(t, evaluateFilter(filter, eventData))

	filter["alert.score"] = map[string]interface{}{"lt": 90}
	require.False(t, evaluateFilter(filter, eventData))
}

func TestBuildDedupKeyUsesConfiguredFields(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-1",
		TriggerConfig: model.TriggerConfig{
			DedupeKeyFields: []string{"alert.id", "alert.source"},
		},
	}

	event1 := testEvent("event-1", `{"alert":{"id":"alert-1","source":"sensor-a"}}`)
	event2 := testEvent("event-2", `{"alert":{"id":"alert-1","source":"sensor-a"}}`)
	event3 := testEvent("event-3", `{"alert":{"id":"alert-2","source":"sensor-a"}}`)

	key1 := buildDedupKey(def, event1, mustEventData(t, event1))
	key2 := buildDedupKey(def, event2, mustEventData(t, event2))
	key3 := buildDedupKey(def, event3, mustEventData(t, event3))

	require.Equal(t, key1, key2)
	require.NotEqual(t, key1, key3)

	missingFieldEvent := testEvent("event-4", `{"alert":{"id":"alert-1"}}`)
	require.Equal(t, defaultDedupKey(def.ID, missingFieldEvent.ID), buildDedupKey(def, missingFieldEvent, mustEventData(t, missingFieldEvent)))
}

func TestTriggerConsumerHandleDedupeByConfiguredFields(t *testing.T) {
	ctx := context.Background()
	rdb, cleanup := testRedis(t)
	defer cleanup()

	def := &model.WorkflowDefinition{
		ID:       "def-1",
		TenantID: "tenant-1",
		TriggerConfig: model.TriggerConfig{
			Type:             model.TriggerTypeEvent,
			Topic:            events.Topics.AlertEvents,
			Filter:           map[string]interface{}{"alert.severity": map[string]interface{}{"in": []interface{}{"high", "critical"}}},
			DedupeKeyFields:  []string{"alert.id"},
			DedupeTTLSeconds: 60,
		},
		Variables: map[string]model.VariableDef{
			"alert_id": {Type: "string", Source: "alert.id"},
			"owner":    {Type: "string", Default: "soc"},
		},
	}

	repo := &fakeDefinitionRepo{definitions: []*model.WorkflowDefinition{def}}
	starter := &fakeWorkflowStarter{}
	recorder := &fakeTriggerExecutionStore{}
	consumer := NewTriggerConsumer(repo, starter, rdb, zerolog.Nop(), recorder)

	first := testEvent("event-1", `{"alert":{"id":"alert-1","severity":"critical"}}`)
	second := testEvent("event-2", `{"alert":{"id":"alert-1","severity":"critical"}}`)

	require.NoError(t, consumer.Handle(ctx, first))
	require.NoError(t, consumer.Handle(ctx, second))

	require.Len(t, starter.calls, 1)
	require.Equal(t, def.TenantID, starter.calls[0].tenantID)
	require.Equal(t, "system", starter.calls[0].userID)
	require.Equal(t, "alert-1", starter.calls[0].request.InputVariables["alert_id"])
	require.Equal(t, "soc", starter.calls[0].request.InputVariables["owner"])
	require.Equal(t, []string{events.Topics.AlertEvents, events.Topics.AlertEvents}, repo.topics)

	require.Len(t, recorder.records, 2)
	require.Equal(t, model.TriggerExecutionStatusStarted, recorder.records[0].Status)
	require.Equal(t, "instance_started", recorder.records[0].Reason)
	require.Equal(t, "instance-1", *recorder.records[0].InstanceID)
	require.Equal(t, model.TriggerExecutionStatusDuplicate, recorder.records[1].Status)
	require.Equal(t, "dedupe_key_exists", recorder.records[1].Reason)
	require.Equal(t, recorder.records[0].DedupeKey, recorder.records[1].DedupeKey)
}

func TestTriggerConsumerHandleDeletesDedupeKeyWhenStartFails(t *testing.T) {
	ctx := context.Background()
	rdb, cleanup := testRedis(t)
	defer cleanup()

	def := &model.WorkflowDefinition{
		ID:       "def-1",
		TenantID: "tenant-1",
		TriggerConfig: model.TriggerConfig{
			Type:  model.TriggerTypeEvent,
			Topic: events.Topics.AlertEvents,
		},
	}

	repo := &fakeDefinitionRepo{definitions: []*model.WorkflowDefinition{def}}
	starter := &fakeWorkflowStarter{errors: []error{errors.New("start failed"), nil}}
	recorder := &fakeTriggerExecutionStore{}
	consumer := NewTriggerConsumer(repo, starter, rdb, zerolog.Nop(), recorder)
	event := testEvent("event-1", `{"alert":{"id":"alert-1"}}`)

	require.Error(t, consumer.Handle(ctx, event))
	require.Equal(t, int64(0), rdb.Exists(ctx, defaultDedupKey(def.ID, event.ID)).Val())

	require.NoError(t, consumer.Handle(ctx, event))
	require.Len(t, starter.calls, 2)
	require.Equal(t, int64(1), rdb.Exists(ctx, defaultDedupKey(def.ID, event.ID)).Val())

	require.Len(t, recorder.records, 2)
	require.Equal(t, model.TriggerExecutionStatusFailed, recorder.records[0].Status)
	require.Equal(t, "start_instance_failed", recorder.records[0].Reason)
	require.NotNil(t, recorder.records[0].ErrorMessage)
	require.Equal(t, model.TriggerExecutionStatusStarted, recorder.records[1].Status)
}

func TestTriggerConsumerHandleRecordsFilterSkip(t *testing.T) {
	ctx := context.Background()
	rdb, cleanup := testRedis(t)
	defer cleanup()

	def := &model.WorkflowDefinition{
		ID:       "def-1",
		TenantID: "tenant-1",
		TriggerConfig: model.TriggerConfig{
			Type:   model.TriggerTypeEvent,
			Topic:  events.Topics.AlertEvents,
			Filter: map[string]interface{}{"alert.severity": "critical"},
		},
	}

	repo := &fakeDefinitionRepo{definitions: []*model.WorkflowDefinition{def}}
	starter := &fakeWorkflowStarter{}
	recorder := &fakeTriggerExecutionStore{}
	consumer := NewTriggerConsumer(repo, starter, rdb, zerolog.Nop(), recorder)

	event := testEvent("event-1", `{"alert":{"id":"alert-1","severity":"low"}}`)
	require.NoError(t, consumer.Handle(ctx, event))

	require.Empty(t, starter.calls)
	require.Len(t, recorder.records, 1)
	require.Equal(t, model.TriggerExecutionStatusSkipped, recorder.records[0].Status)
	require.Equal(t, "filter_not_matched", recorder.records[0].Reason)
	require.JSONEq(t, string(event.Data), string(recorder.records[0].TriggerData))
}

func TestTriggerConsumerReplayStartsInstanceFromTriggerExecution(t *testing.T) {
	ctx := context.Background()
	rdb, cleanup := testRedis(t)
	defer cleanup()

	def := &model.WorkflowDefinition{
		ID:       "def-1",
		TenantID: "tenant-1",
		Status:   model.DefinitionStatusActive,
		TriggerConfig: model.TriggerConfig{
			Type:  model.TriggerTypeEvent,
			Topic: events.Topics.AlertEvents,
		},
		Variables: map[string]model.VariableDef{
			"alert_id": {Type: "string", Source: "alert.id"},
			"owner":    {Type: "string", Default: "soc"},
		},
	}

	source := &model.TriggerExecution{
		ID:           "trigger-1",
		TenantID:     "tenant-1",
		DefinitionID: "def-1",
		EventID:      "event-1",
		Topic:        events.Topics.AlertEvents,
		Status:       model.TriggerExecutionStatusStarted,
		TriggerData:  json.RawMessage(`{"alert":{"id":"alert-1","severity":"critical"}}`),
	}

	repo := &fakeDefinitionRepo{definitions: []*model.WorkflowDefinition{def}}
	starter := &fakeWorkflowStarter{}
	recorder := &fakeTriggerExecutionStore{byID: map[string]*model.TriggerExecution{source.ID: source}}
	consumer := NewTriggerConsumer(repo, starter, rdb, zerolog.Nop(), recorder)

	instance, err := consumer.Replay(ctx, "tenant-1", "admin-1", source.ID)
	require.NoError(t, err)

	require.Equal(t, "instance-1", instance.ID)
	require.Len(t, starter.calls, 1)
	require.Equal(t, "tenant-1", starter.calls[0].tenantID)
	require.Equal(t, "admin-1", starter.calls[0].userID)
	require.Equal(t, "def-1", starter.calls[0].request.DefinitionID)
	require.Equal(t, "alert-1", starter.calls[0].request.InputVariables["alert_id"])
	require.Equal(t, "soc", starter.calls[0].request.InputVariables["owner"])

	require.Len(t, recorder.records, 1)
	require.Equal(t, model.TriggerExecutionStatusStarted, recorder.records[0].Status)
	require.Equal(t, "replay_started", recorder.records[0].Reason)
	require.Equal(t, "replay:trigger-1", recorder.records[0].DedupeKey)
	require.Equal(t, "instance-1", *recorder.records[0].InstanceID)
}

type fakeDefinitionRepo struct {
	definitions []*model.WorkflowDefinition
	topics      []string
	err         error
}

func (f *fakeDefinitionRepo) GetActiveByTriggerTopic(_ context.Context, topic string) ([]*model.WorkflowDefinition, error) {
	f.topics = append(f.topics, topic)
	if f.err != nil {
		return nil, f.err
	}

	definitions := make([]*model.WorkflowDefinition, 0, len(f.definitions))
	for _, def := range f.definitions {
		if def.TriggerConfig.Topic == topic {
			definitions = append(definitions, def)
		}
	}
	return definitions, nil
}

func (f *fakeDefinitionRepo) GetActiveByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, def := range f.definitions {
		if def.ID == id && def.TenantID == tenantID && def.Status == model.DefinitionStatusActive {
			return def, nil
		}
	}
	return nil, model.ErrNotFound
}

type startCall struct {
	tenantID string
	userID   string
	request  dto.StartInstanceRequest
}

type fakeWorkflowStarter struct {
	calls  []startCall
	errors []error
}

func (f *fakeWorkflowStarter) StartInstance(_ context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error) {
	f.calls = append(f.calls, startCall{tenantID: tenantID, userID: userID, request: req})
	if len(f.errors) > 0 {
		err := f.errors[0]
		f.errors = f.errors[1:]
		if err != nil {
			return nil, err
		}
	}

	return &model.WorkflowInstance{
		ID:       fmt.Sprintf("instance-%d", len(f.calls)),
		TenantID: tenantID,
	}, nil
}

type fakeTriggerExecutionStore struct {
	records []*model.TriggerExecution
	byID    map[string]*model.TriggerExecution
	err     error
}

func (f *fakeTriggerExecutionStore) Create(_ context.Context, exec *model.TriggerExecution) error {
	if f.err != nil {
		return f.err
	}
	copied := *exec
	if copied.ID == "" {
		copied.ID = fmt.Sprintf("trigger-record-%d", len(f.records)+1)
	}
	if copied.CreatedAt.IsZero() {
		copied.CreatedAt = time.Now().UTC()
	}
	if len(copied.TriggerData) > 0 {
		copied.TriggerData = copyRawMessage(copied.TriggerData)
	}
	f.records = append(f.records, &copied)
	return nil
}

func (f *fakeTriggerExecutionStore) GetByID(_ context.Context, tenantID, id string) (*model.TriggerExecution, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.byID != nil {
		if exec, ok := f.byID[id]; ok && exec.TenantID == tenantID {
			return exec, nil
		}
	}
	for _, exec := range f.records {
		if exec.ID == id && exec.TenantID == tenantID {
			return exec, nil
		}
	}
	return nil, model.ErrNotFound
}

func testRedis(t *testing.T) (*redis.Client, func()) {
	t.Helper()

	server, err := miniredis.Run()
	require.NoError(t, err)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	return client, func() {
		require.NoError(t, client.Close())
		server.Close()
	}
}

func testEvent(id, data string) *events.Event {
	return &events.Event{
		ID:              id,
		Source:          "clario360/cyber-service",
		SpecVersion:     "1.0",
		Type:            "com.clario360.alert.created",
		DataContentType: "application/json",
		Time:            time.Now().UTC(),
		TenantID:        "tenant-1",
		CorrelationID:   "correlation-1",
		Data:            json.RawMessage(data),
		Metadata: map[string]string{
			"topic": events.Topics.AlertEvents,
		},
	}
}

func mustEventData(t *testing.T, event *events.Event) map[string]interface{} {
	t.Helper()

	var eventData map[string]interface{}
	require.NoError(t, json.Unmarshal(event.Data, &eventData))
	return eventData
}
