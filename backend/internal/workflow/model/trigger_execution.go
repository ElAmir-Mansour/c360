package model

import (
	"encoding/json"
	"time"
)

// TriggerExecution records a workflow trigger evaluation for automation
// observability and later replay/debugging support.
type TriggerExecution struct {
	ID           string          `json:"id" db:"id"`
	TenantID     string          `json:"tenant_id" db:"tenant_id"`
	DefinitionID string          `json:"definition_id" db:"definition_id"`
	InstanceID   *string         `json:"instance_id,omitempty" db:"instance_id"`
	EventID      string          `json:"event_id" db:"event_id"`
	Topic        string          `json:"topic" db:"topic"`
	Status       string          `json:"status" db:"status"`
	DedupeKey    string          `json:"dedupe_key,omitempty" db:"dedupe_key"`
	Reason       string          `json:"reason,omitempty" db:"reason"`
	TriggerData  json.RawMessage `json:"trigger_data,omitempty" db:"trigger_data"`
	ErrorMessage *string         `json:"error_message,omitempty" db:"error_message"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
}

// Trigger execution status constants.
const (
	TriggerExecutionStatusMatched   = "matched"
	TriggerExecutionStatusSkipped   = "skipped"
	TriggerExecutionStatusDuplicate = "duplicate"
	TriggerExecutionStatusStarted   = "started"
	TriggerExecutionStatusFailed    = "failed"
)

// ValidTriggerExecutionStatuses is the set of allowed trigger execution states.
var ValidTriggerExecutionStatuses = map[string]bool{
	TriggerExecutionStatusMatched:   true,
	TriggerExecutionStatusSkipped:   true,
	TriggerExecutionStatusDuplicate: true,
	TriggerExecutionStatusStarted:   true,
	TriggerExecutionStatusFailed:    true,
}
