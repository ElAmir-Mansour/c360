package dto

import (
	"encoding/json"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

// TriggerExecutionResponse wraps a workflow trigger execution log entry.
type TriggerExecutionResponse struct {
	ID           string          `json:"id"`
	TenantID     string          `json:"tenant_id"`
	DefinitionID string          `json:"definition_id"`
	InstanceID   *string         `json:"instance_id,omitempty"`
	EventID      string          `json:"event_id"`
	Topic        string          `json:"topic"`
	Status       string          `json:"status"`
	DedupeKey    string          `json:"dedupe_key,omitempty"`
	Reason       string          `json:"reason,omitempty"`
	TriggerData  json.RawMessage `json:"trigger_data,omitempty"`
	ErrorMessage *string         `json:"error_message,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

// ListTriggerExecutionsResponse is the paginated response for trigger logs.
type ListTriggerExecutionsResponse struct {
	Data []TriggerExecutionResponse `json:"data"`
	Meta PaginationMeta             `json:"meta"`
}

// ReplayTriggerExecutionResponse is returned after replaying a trigger execution.
type ReplayTriggerExecutionResponse struct {
	SourceTriggerExecutionID string           `json:"source_trigger_execution_id"`
	Instance                 InstanceResponse `json:"instance"`
}

// TriggerExecutionToResponse converts a trigger execution model to its API response form.
func TriggerExecutionToResponse(exec *model.TriggerExecution) TriggerExecutionResponse {
	return TriggerExecutionResponse{
		ID:           exec.ID,
		TenantID:     exec.TenantID,
		DefinitionID: exec.DefinitionID,
		InstanceID:   exec.InstanceID,
		EventID:      exec.EventID,
		Topic:        exec.Topic,
		Status:       exec.Status,
		DedupeKey:    exec.DedupeKey,
		Reason:       exec.Reason,
		TriggerData:  exec.TriggerData,
		ErrorMessage: exec.ErrorMessage,
		CreatedAt:    exec.CreatedAt,
	}
}
