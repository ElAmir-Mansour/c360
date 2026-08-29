package consumer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// deduplication TTL for trigger events: prevents the same event from starting
// duplicate workflow instances within a 24-hour window.
const triggerDedupTTL = 24 * time.Hour

// definitionRepoReader provides read access to workflow definitions by trigger topic.
type definitionRepoReader interface {
	GetActiveByTriggerTopic(ctx context.Context, topic string) ([]*model.WorkflowDefinition, error)
	GetActiveByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
}

// workflowStarter starts new workflow instances.
type workflowStarter interface {
	StartInstance(ctx context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error)
}

// triggerExecutionStore records and retrieves trigger execution logs.
type triggerExecutionStore interface {
	Create(ctx context.Context, exec *model.TriggerExecution) error
	GetByID(ctx context.Context, tenantID, id string) (*model.TriggerExecution, error)
}

// TriggerConsumer listens for platform events and starts workflow instances
// whose trigger configuration matches the incoming event's source topic.
type TriggerConsumer struct {
	defRepo definitionRepoReader
	engine  workflowStarter
	rdb     *redis.Client
	logs    triggerExecutionStore
	logger  zerolog.Logger
}

// NewTriggerConsumer creates a new TriggerConsumer.
func NewTriggerConsumer(
	defRepo definitionRepoReader,
	engine workflowStarter,
	rdb *redis.Client,
	logger zerolog.Logger,
	logs ...triggerExecutionStore,
) *TriggerConsumer {
	var store triggerExecutionStore
	if len(logs) > 0 {
		store = logs[0]
	}

	return &TriggerConsumer{
		defRepo: defRepo,
		engine:  engine,
		rdb:     rdb,
		logs:    store,
		logger:  logger.With().Str("consumer", "workflow_trigger").Logger(),
	}
}

// Handle processes an incoming event by matching it against active workflow
// definitions that are configured to trigger on the event's source topic.
// For each matching definition whose filter evaluates to true, it deduplicates
// via Redis SET NX and starts a new workflow instance.
func (c *TriggerConsumer) Handle(ctx context.Context, event *events.Event) error {
	if event == nil {
		return fmt.Errorf("trigger consumer: received nil event")
	}

	if err := event.Validate(); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("invalid event received, skipping")
		return nil
	}

	// Extract the source topic from the event type.
	// Event types follow the pattern "com.clario360.<domain>.<entity>.<action>".
	// The trigger topic in definitions maps to the Kafka topic the event came from.
	// We derive the topic from the event source field (e.g., "clario360/workflow-service")
	// or use the event type itself for matching.
	topic := extractTopic(event)

	definitions, err := c.defRepo.GetActiveByTriggerTopic(ctx, topic)
	if err != nil {
		return fmt.Errorf("trigger consumer: fetching definitions for topic %q: %w", topic, err)
	}

	if len(definitions) == 0 {
		c.logger.Debug().
			Str("topic", topic).
			Str("event_id", event.ID).
			Msg("no active definitions for topic")
		return nil
	}

	// Parse event data once for filter evaluation.
	var eventData map[string]interface{}
	if len(event.Data) > 0 {
		if err := json.Unmarshal(event.Data, &eventData); err != nil {
			c.logger.Warn().Err(err).
				Str("event_id", event.ID).
				Msg("failed to unmarshal event data for filter evaluation")
			eventData = make(map[string]interface{})
		}
	} else {
		eventData = make(map[string]interface{})
	}

	var startErrors []error

	for _, def := range definitions {
		logger := c.logger.With().
			Str("definition_id", def.ID).
			Str("event_id", event.ID).
			Str("tenant_id", def.TenantID).
			Logger()

		// Evaluate the trigger filter against the event data.
		if !evaluateFilter(def.TriggerConfig.Filter, eventData) {
			logger.Debug().Msg("event did not match trigger filter, skipping")
			c.recordTriggerExecution(ctx, def, event, topic, model.TriggerExecutionStatusSkipped, "", "filter_not_matched", event.Data, nil, nil)
			continue
		}

		// Deduplicate: ensure the same event or configured business key does
		// not trigger the same definition twice.
		dedupKey := buildDedupKey(def, event, eventData)
		set, err := c.rdb.SetNX(ctx, dedupKey, "1", triggerDedupTTLFor(def)).Result()
		if err != nil {
			logger.Error().Err(err).Str("dedup_key", dedupKey).Msg("redis dedup check failed")
			c.recordTriggerExecution(ctx, def, event, topic, model.TriggerExecutionStatusFailed, dedupKey, "dedupe_check_failed", event.Data, nil, err)
			startErrors = append(startErrors, fmt.Errorf("dedup check for def %s: %w", def.ID, err))
			continue
		}
		if !set {
			logger.Debug().Str("dedup_key", dedupKey).Msg("duplicate trigger detected, skipping")
			c.recordTriggerExecution(ctx, def, event, topic, model.TriggerExecutionStatusDuplicate, dedupKey, "dedupe_key_exists", event.Data, nil, nil)
			continue
		}

		// Start the workflow instance.
		req := dto.StartInstanceRequest{
			DefinitionID:   def.ID,
			InputVariables: buildInputVariables(def, eventData),
			TriggerData:    event.Data,
		}

		instance, err := c.engine.StartInstance(ctx, def.TenantID, "system", req)
		if err != nil {
			logger.Error().Err(err).Msg("failed to start workflow instance from trigger")
			c.recordTriggerExecution(ctx, def, event, topic, model.TriggerExecutionStatusFailed, dedupKey, "start_instance_failed", event.Data, nil, err)
			startErrors = append(startErrors, fmt.Errorf("start instance for def %s: %w", def.ID, err))
			// Clean up the dedup key so the event can be retried.
			_ = c.rdb.Del(ctx, dedupKey).Err()
			continue
		}

		c.recordTriggerExecution(ctx, def, event, topic, model.TriggerExecutionStatusStarted, dedupKey, "instance_started", event.Data, &instance.ID, nil)

		logger.Info().
			Str("instance_id", instance.ID).
			Msg("workflow instance started from trigger event")
	}

	if len(startErrors) > 0 {
		return fmt.Errorf("trigger consumer: %d error(s) processing event %s: %v", len(startErrors), event.ID, startErrors[0])
	}

	return nil
}

// Replay starts a new workflow instance from a persisted trigger execution.
// It bypasses Redis deduplication intentionally so admins can replay a known
// trigger payload during incident response or automation debugging.
func (c *TriggerConsumer) Replay(ctx context.Context, tenantID, userID, triggerExecutionID string) (*model.WorkflowInstance, error) {
	if c.logs == nil {
		return nil, fmt.Errorf("trigger execution store is not configured")
	}
	if triggerExecutionID == "" {
		return nil, fmt.Errorf("trigger execution id is required")
	}
	if userID == "" {
		userID = "system"
	}

	source, err := c.logs.GetByID(ctx, tenantID, triggerExecutionID)
	if err != nil {
		return nil, fmt.Errorf("loading trigger execution for replay: %w", err)
	}

	def, err := c.defRepo.GetActiveByID(ctx, tenantID, source.DefinitionID)
	if err != nil {
		return nil, fmt.Errorf("loading active workflow definition for replay: %w", err)
	}

	eventData := make(map[string]interface{})
	if len(source.TriggerData) > 0 {
		if err := json.Unmarshal(source.TriggerData, &eventData); err != nil {
			replayErr := fmt.Errorf("unmarshaling trigger data for replay: %w", err)
			c.recordReplayExecution(ctx, source, model.TriggerExecutionStatusFailed, nil, replayErr)
			return nil, replayErr
		}
	}

	req := dto.StartInstanceRequest{
		DefinitionID:   source.DefinitionID,
		InputVariables: buildInputVariables(def, eventData),
		TriggerData:    source.TriggerData,
	}

	instance, err := c.engine.StartInstance(ctx, tenantID, userID, req)
	if err != nil {
		c.recordReplayExecution(ctx, source, model.TriggerExecutionStatusFailed, nil, err)
		return nil, fmt.Errorf("starting workflow instance from replay: %w", err)
	}

	c.recordReplayExecution(ctx, source, model.TriggerExecutionStatusStarted, &instance.ID, nil)
	return instance, nil
}

func (c *TriggerConsumer) recordTriggerExecution(
	ctx context.Context,
	def *model.WorkflowDefinition,
	event *events.Event,
	topic string,
	status string,
	dedupKey string,
	reason string,
	triggerData json.RawMessage,
	instanceID *string,
	execErr error,
) {
	if c.logs == nil || def == nil || event == nil {
		return
	}

	var errMsg *string
	if execErr != nil {
		msg := execErr.Error()
		errMsg = &msg
	}

	exec := &model.TriggerExecution{
		TenantID:     def.TenantID,
		DefinitionID: def.ID,
		InstanceID:   instanceID,
		EventID:      event.ID,
		Topic:        topic,
		Status:       status,
		DedupeKey:    dedupKey,
		Reason:       reason,
		TriggerData:  copyRawMessage(triggerData),
		ErrorMessage: errMsg,
	}

	if err := c.logs.Create(ctx, exec); err != nil {
		c.logger.Warn().Err(err).
			Str("definition_id", def.ID).
			Str("event_id", event.ID).
			Str("status", status).
			Msg("failed to record trigger execution")
	}
}

func (c *TriggerConsumer) recordReplayExecution(ctx context.Context, source *model.TriggerExecution, status string, instanceID *string, execErr error) {
	if c.logs == nil || source == nil {
		return
	}

	var errMsg *string
	if execErr != nil {
		msg := execErr.Error()
		errMsg = &msg
	}

	reason := "replay_started"
	if status == model.TriggerExecutionStatusFailed {
		reason = "replay_failed"
	}

	exec := &model.TriggerExecution{
		TenantID:     source.TenantID,
		DefinitionID: source.DefinitionID,
		InstanceID:   instanceID,
		EventID:      source.EventID,
		Topic:        source.Topic,
		Status:       status,
		DedupeKey:    "replay:" + source.ID,
		Reason:       reason,
		TriggerData:  copyRawMessage(source.TriggerData),
		ErrorMessage: errMsg,
	}

	if err := c.logs.Create(ctx, exec); err != nil {
		c.logger.Warn().Err(err).
			Str("source_trigger_execution_id", source.ID).
			Str("status", status).
			Msg("failed to record trigger replay execution")
	}
}

func copyRawMessage(data json.RawMessage) json.RawMessage {
	if len(data) == 0 {
		return nil
	}
	copied := make([]byte, len(data))
	copy(copied, data)
	return json.RawMessage(copied)
}

// extractTopic derives the topic string used for matching trigger configurations.
// It first checks if the event type contains a recognizable topic pattern, then
// falls back to mapping from the event source.
func extractTopic(event *events.Event) string {
	// The event type follows "com.clario360.{domain}.{entity}.{action}".
	// The trigger_config.topic in definitions stores the Kafka topic name like
	// "platform.iam.events" or "cyber.alert.events".
	// We need to resolve from the event metadata or source to the actual Kafka topic.

	// Check if the event has an explicit topic in metadata.
	if topic, ok := event.Metadata["topic"]; ok && topic != "" {
		return topic
	}

	// Map from event type prefix to topic.
	// "com.clario360.iam.user.created" -> domain = "iam"
	eventType := event.Type
	eventType = strings.TrimPrefix(eventType, "com.clario360.")

	parts := strings.SplitN(eventType, ".", 3)
	if len(parts) < 2 {
		return event.Type
	}

	domain := parts[0]

	// Map known domains to their Kafka topic names.
	domainTopicMap := map[string]string{
		"iam":           events.Topics.IAMEvents,
		"audit":         events.Topics.AuditEvents,
		"notification":  events.Topics.NotificationEvents,
		"workflow":      events.Topics.WorkflowEvents,
		"asset":         events.Topics.AssetEvents,
		"threat":        events.Topics.ThreatEvents,
		"alert":         events.Topics.AlertEvents,
		"remediation":   events.Topics.RemediationEvents,
		"datasource":    events.Topics.DataSourceEvents,
		"pipeline":      events.Topics.PipelineEvents,
		"quality":       events.Topics.QualityEvents,
		"contradiction": events.Topics.ContradictionEvents,
		"lineage":       events.Topics.LineageEvents,
		"acta":          events.Topics.ActaEvents,
		"lex":           events.Topics.LexEvents,
		"visus":         events.Topics.VisusEvents,
	}

	if topic, ok := domainTopicMap[domain]; ok {
		return topic
	}

	return event.Type
}

// evaluateFilter checks whether the event data satisfies all key-value conditions
// defined in the trigger filter. An empty or nil filter matches all events.
// Filter values support simple equality matching.
func evaluateFilter(filter map[string]interface{}, eventData map[string]interface{}) bool {
	if len(filter) == 0 {
		return true
	}

	for key, expected := range filter {
		actual, exists := resolveNestedField(eventData, key)
		if !matchRule(expected, actual, exists) {
			return false
		}
	}

	return true
}

// resolveNestedField resolves a potentially dot-separated key path in a nested map.
// For example, "user.role" resolves eventData["user"]["role"].
func resolveNestedField(data map[string]interface{}, key string) (interface{}, bool) {
	parts := strings.Split(key, ".")

	var current interface{} = data
	for _, part := range parts {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil, false
		}
		current, ok = m[part]
		if !ok {
			return nil, false
		}
	}

	return current, true
}

// matchValue compares an expected filter value against an actual event data value.
// It supports string, float64 (JSON numbers), and bool comparison.
// For slice expected values, it checks whether the actual value is contained in the slice.
func matchValue(expected, actual interface{}) bool {
	// Handle slice-based "in" matching: filter value is a list, actual must be in it.
	if expSlice, ok := expected.([]interface{}); ok {
		for _, v := range expSlice {
			if matchValue(v, actual) {
				return true
			}
		}
		return false
	}
	if expSlice, ok := expected.([]string); ok {
		for _, v := range expSlice {
			if matchValue(v, actual) {
				return true
			}
		}
		return false
	}

	// Compare as strings for simplicity and JSON interop.
	return fmt.Sprintf("%v", expected) == fmt.Sprintf("%v", actual)
}

type triggerRule struct {
	operator string
	value    interface{}
}

// matchRule evaluates a trigger filter entry. In addition to legacy equality
// filters, values may be rule objects such as {"operator":"in","value":[...]}
// or shorthand objects such as {"gte":90}.
func matchRule(expected, actual interface{}, exists bool) bool {
	rule, ok := normalizeTriggerRule(expected)
	if !ok {
		if !exists {
			return false
		}
		return matchValue(expected, actual)
	}

	switch rule.operator {
	case "eq":
		return exists && matchValue(rule.value, actual)
	case "ne", "neq":
		return exists && !matchValue(rule.value, actual)
	case "in":
		return exists && matchValue(rule.value, actual)
	case "not_in":
		return exists && !matchValue(rule.value, actual)
	case "exists":
		wantExists := true
		if rule.value != nil {
			if parsed, ok := boolValue(rule.value); ok {
				wantExists = parsed
			} else {
				return false
			}
		}
		return exists == wantExists
	case "contains":
		return exists && containsValue(actual, rule.value)
	case "gt", "gte", "lt", "lte":
		return exists && compareNumeric(actual, rule.value, rule.operator)
	default:
		return false
	}
}

func normalizeTriggerRule(expected interface{}) (triggerRule, bool) {
	ruleMap, ok := expected.(map[string]interface{})
	if !ok {
		return triggerRule{}, false
	}

	if op, ok := stringMapValue(ruleMap, "operator"); ok {
		return triggerRule{operator: normalizeOperator(op), value: ruleMap["value"]}, true
	}
	if op, ok := stringMapValue(ruleMap, "op"); ok {
		return triggerRule{operator: normalizeOperator(op), value: ruleMap["value"]}, true
	}

	for _, op := range []string{"eq", "ne", "neq", "in", "not_in", "exists", "contains", "gt", "gte", "lt", "lte"} {
		if value, ok := ruleMap[op]; ok {
			return triggerRule{operator: op, value: value}, true
		}
	}

	return triggerRule{}, false
}

func stringMapValue(values map[string]interface{}, key string) (string, bool) {
	raw, ok := values[key]
	if !ok {
		return "", false
	}
	value, ok := raw.(string)
	if !ok || strings.TrimSpace(value) == "" {
		return "", false
	}
	return value, true
}

func normalizeOperator(op string) string {
	normalized := strings.ToLower(strings.TrimSpace(op))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	return normalized
}

func boolValue(value interface{}) (bool, bool) {
	switch v := value.(type) {
	case bool:
		return v, true
	case string:
		parsed, err := strconv.ParseBool(v)
		return parsed, err == nil
	default:
		return false, false
	}
}

func containsValue(actual, expected interface{}) bool {
	switch v := actual.(type) {
	case string:
		return strings.Contains(v, fmt.Sprintf("%v", expected))
	case []interface{}:
		for _, item := range v {
			if matchValue(expected, item) {
				return true
			}
		}
		return false
	case []string:
		for _, item := range v {
			if matchValue(expected, item) {
				return true
			}
		}
		return false
	case map[string]interface{}:
		_, ok := v[fmt.Sprintf("%v", expected)]
		return ok
	default:
		return matchValue(expected, actual)
	}
}

func compareNumeric(actual, expected interface{}, op string) bool {
	actualNum, ok := numericValue(actual)
	if !ok {
		return false
	}
	expectedNum, ok := numericValue(expected)
	if !ok {
		return false
	}

	switch op {
	case "gt":
		return actualNum > expectedNum
	case "gte":
		return actualNum >= expectedNum
	case "lt":
		return actualNum < expectedNum
	case "lte":
		return actualNum <= expectedNum
	default:
		return false
	}
}

func numericValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	case string:
		n, err := strconv.ParseFloat(v, 64)
		return n, err == nil
	default:
		return 0, false
	}
}

func triggerDedupTTLFor(def *model.WorkflowDefinition) time.Duration {
	if def != nil && def.TriggerConfig.DedupeTTLSeconds > 0 {
		return time.Duration(def.TriggerConfig.DedupeTTLSeconds) * time.Second
	}
	return triggerDedupTTL
}

func buildDedupKey(def *model.WorkflowDefinition, event *events.Event, eventData map[string]interface{}) string {
	if def == nil || event == nil {
		return "workflow:trigger:unknown"
	}

	fields := make([]string, 0, len(def.TriggerConfig.DedupeKeyFields))
	for _, field := range def.TriggerConfig.DedupeKeyFields {
		field = strings.TrimSpace(field)
		if field != "" {
			fields = append(fields, field)
		}
	}
	if len(fields) == 0 {
		return defaultDedupKey(def.ID, event.ID)
	}

	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		value, ok := resolveNestedField(eventData, field)
		if !ok {
			return defaultDedupKey(def.ID, event.ID)
		}
		parts = append(parts, field+"="+canonicalDedupeValue(value))
	}

	sum := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return fmt.Sprintf("workflow:trigger:%s:fields:%s", def.ID, hex.EncodeToString(sum[:16]))
}

func defaultDedupKey(definitionID, eventID string) string {
	return fmt.Sprintf("workflow:trigger:%s:%s", definitionID, eventID)
}

func canonicalDedupeValue(value interface{}) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(encoded)
}

// buildInputVariables constructs the initial variable map for a new workflow instance
// by extracting values from the event data according to the definition's variable
// source configuration.
func buildInputVariables(def *model.WorkflowDefinition, eventData map[string]interface{}) map[string]interface{} {
	vars := make(map[string]interface{})

	for name, varDef := range def.Variables {
		if varDef.Source != "" {
			// Resolve the variable value from event data using the source path.
			if val, ok := resolveNestedField(eventData, varDef.Source); ok {
				vars[name] = val
				continue
			}
		}
		// Fall back to the default value.
		if varDef.Default != nil {
			vars[name] = varDef.Default
		}
	}

	return vars
}
