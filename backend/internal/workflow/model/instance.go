package model

import (
	"encoding/json"
	"time"
)

// WorkflowInstance represents a single execution of a workflow definition.
// LockVersion is used for optimistic concurrency control on updates.
type WorkflowInstance struct {
	ID            string                 `json:"id" db:"id"`
	TenantID      string                 `json:"tenant_id" db:"tenant_id"`
	DefinitionID  string                 `json:"definition_id" db:"definition_id"`
	DefinitionVer int                    `json:"definition_ver" db:"definition_ver"`
	Status        string                 `json:"status" db:"status"`
	CurrentStepID *string                `json:"current_step_id,omitempty" db:"current_step_id"`
	Variables     map[string]interface{} `json:"variables" db:"variables"`
	StepOutputs   map[string]interface{} `json:"step_outputs" db:"step_outputs"`
	TriggerData   json.RawMessage        `json:"trigger_data,omitempty" db:"trigger_data"`
	ErrorMessage  *string                `json:"error_message,omitempty" db:"error_message"`
	StartedBy     *string                `json:"started_by,omitempty" db:"started_by"`
	StartedAt     time.Time              `json:"started_at" db:"started_at"`
	CompletedAt   *time.Time             `json:"completed_at,omitempty" db:"completed_at"`
	UpdatedAt     time.Time              `json:"updated_at" db:"updated_at"`
	LockVersion   int                    `json:"lock_version" db:"lock_version"`

	// ParentInstanceID / ParentStepID link a CHILD instance back to the parent
	// instance + step that spawned it (BPMN call-activity / sub-process, and each
	// fan-out child of a multi_instance step). Both are nil for a top-level
	// instance started directly (StartInstance with no parent), so every existing
	// instance and every legacy start path is byte-for-byte unchanged. When set,
	// completeInstance maps the child's outputs back and resumes the parent.
	ParentInstanceID *string `json:"parent_instance_id,omitempty" db:"parent_instance_id"`
	ParentStepID     *string `json:"parent_step_id,omitempty" db:"parent_step_id"`

	// SensitiveKeys is a TRANSIENT classification hint (never persisted, never
	// serialized — json:"-" db:"-"): the top-level keys of Variables / StepOutputs
	// whose values carry sensitive payload and must be encrypted at rest. The
	// engine derives it from the instance's definition (SensitiveVariableKeys +
	// classified human-task form fields) and stamps it on the struct before a
	// write; the repository consults it (only when a payload codec is wired) to
	// decide which values to envelope. It is nil for every legacy write path and
	// every test double, so those persist plaintext exactly as before.
	SensitiveKeys map[string]bool `json:"-" db:"-"`
}

// DefaultMaxCallDepth bounds the depth of a composition (call_activity /
// multi_instance) parent->child spawn chain. A top-level instance is depth 0;
// each nested child adds 1. It fails closed BEFORE the child instance row is
// created, so a definition whose call_activity definition_key resolves back to
// its own lineage (self-recursion) — or a mutually-recursive pair — raises an
// incident on the parent step instead of spawning an unbounded child->grandchild
// chain (each a real workflow_instances row + park), which would self-DoS the
// DB/process. This bounds the ASYNC spawn chain, which the synchronous
// drainDeferred guard does not cover. Chosen generously (16 == MaxSubstitutionDepth)
// so legitimate nested sub-processes are unaffected while a runaway cycle is
// caught long before it exhausts resources.
const DefaultMaxCallDepth = 16

// HasParent reports whether this instance was spawned by a parent instance/step
// (a call-activity child or a multi_instance fan-out child). A parented child
// resumes its parent on completion / failure.
func (wi *WorkflowInstance) HasParent() bool {
	return wi.ParentInstanceID != nil && *wi.ParentInstanceID != "" &&
		wi.ParentStepID != nil && *wi.ParentStepID != ""
}

// ActivityExecution is a persisted idempotency-ledger row for a single outbound
// activity attempt (e.g. a service_task HTTP call). The engine records it BEFORE
// the outbound call so a recovered or retried instance can detect a prior attempt
// and replay its cached result instead of re-issuing the external effect.
//
// The IdempotencyKey is stable and deterministic: instance_id:step_id:attempt.
type ActivityExecution struct {
	IdempotencyKey string          `json:"idempotency_key" db:"idempotency_key"`
	InstanceID     string          `json:"instance_id" db:"instance_id"`
	StepID         string          `json:"step_id" db:"step_id"`
	Attempt        int             `json:"attempt" db:"attempt"`
	Status         string          `json:"status" db:"status"`
	ResponseData   json.RawMessage `json:"response_data,omitempty" db:"response_data"`
	ErrorMessage   *string         `json:"error_message,omitempty" db:"error_message"`
	CreatedAt      time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at" db:"updated_at"`
}

// Activity execution (idempotency ledger) status constants.
const (
	ActivityStatusPending   = "pending"
	ActivityStatusCompleted = "completed"
	ActivityStatusFailed    = "failed"
)

// MIChild is one fan-out child of a multi_instance (for-each) parent step — a
// row in the workflow_mi_children completion-counter fan-in ledger. The parent
// step parks after fanning out; each child completion marks its row terminal and
// the engine re-checks the parent's completion policy (all / any / n_of_m),
// resuming the parent EXACTLY ONCE when the policy is satisfied. ChildInstanceID
// is nil for an inline sync sub-step child (which never becomes its own
// instance). Output carries the child's mapped result for aggregation into the
// parent's result collection.
type MIChild struct {
	ID               string                 `json:"id" db:"id"`
	TenantID         string                 `json:"tenant_id" db:"tenant_id"`
	ParentInstanceID string                 `json:"parent_instance_id" db:"parent_instance_id"`
	ParentStepID     string                 `json:"parent_step_id" db:"parent_step_id"`
	ChildIndex       int                    `json:"child_index" db:"child_index"`
	ChildInstanceID  *string                `json:"child_instance_id,omitempty" db:"child_instance_id"`
	Status           string                 `json:"status" db:"status"`
	Output           map[string]interface{} `json:"output,omitempty" db:"output"`
	ErrorMessage     *string                `json:"error_message,omitempty" db:"error_message"`
	CreatedAt        time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at" db:"updated_at"`
}

// Multi-instance child (fan-in ledger) status constants. These mirror the
// terminal states the parent cares about; a child that is still executing is
// 'running'.
const (
	MIChildStatusRunning   = "running"
	MIChildStatusCompleted = "completed"
	MIChildStatusFailed    = "failed"
)

// StepExecution records the execution of a single step within a workflow instance.
// Attempt tracks retry count for the same step.
type StepExecution struct {
	ID           string          `json:"id" db:"id"`
	InstanceID   string          `json:"instance_id" db:"instance_id"`
	StepID       string          `json:"step_id" db:"step_id"`
	StepType     string          `json:"step_type" db:"step_type"`
	Status       string          `json:"status" db:"status"`
	InputData    json.RawMessage `json:"input_data,omitempty" db:"input_data"`
	OutputData   json.RawMessage `json:"output_data,omitempty" db:"output_data"`
	ErrorMessage *string         `json:"error_message,omitempty" db:"error_message"`
	Attempt      int             `json:"attempt" db:"attempt"`
	StartedAt    *time.Time      `json:"started_at,omitempty" db:"started_at"`
	CompletedAt  *time.Time      `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
}

// Instance status constants.
const (
	InstanceStatusRunning   = "running"
	InstanceStatusCompleted = "completed"
	InstanceStatusFailed    = "failed"
	InstanceStatusCancelled = "cancelled"
	InstanceStatusSuspended = "suspended"
	// InstanceStatusIncident marks an instance that has an OPEN incident on a
	// failed step (Camunda-incident pattern). Unlike InstanceStatusFailed, an
	// incident does NOT terminate the whole instance: the failed step is parked
	// with the failure captured, other parallel branches keep their state, and a
	// governed operator can retry / skip / modify-variables to resolve it. Once
	// resolved the instance returns to running; if abandoned it is dead-lettered
	// and transitions to failed.
	InstanceStatusIncident = "incident"
)

// Step execution status constants.
const (
	StepStatusPending   = "pending"
	StepStatusRunning   = "running"
	StepStatusCompleted = "completed"
	StepStatusFailed    = "failed"
	StepStatusSkipped   = "skipped"
	StepStatusCancelled = "cancelled"
	// StepStatusIncident marks a step whose retries were exhausted and which is
	// now parked under an open incident awaiting operator intervention. It is a
	// distinct terminal-for-now state (the failed attempt row keeps status
	// 'failed'); the incident carries the operator-facing failure context.
	StepStatusIncident = "incident"
)

// ValidInstanceStatuses is the set of allowed instance statuses.
var ValidInstanceStatuses = map[string]bool{
	InstanceStatusRunning:   true,
	InstanceStatusCompleted: true,
	InstanceStatusFailed:    true,
	InstanceStatusCancelled: true,
	InstanceStatusSuspended: true,
	InstanceStatusIncident:  true,
}

// ValidStepStatuses is the set of allowed step execution statuses.
var ValidStepStatuses = map[string]bool{
	StepStatusPending:   true,
	StepStatusRunning:   true,
	StepStatusCompleted: true,
	StepStatusFailed:    true,
	StepStatusSkipped:   true,
	StepStatusCancelled: true,
	StepStatusIncident:  true,
}

// IsTerminal returns true if the instance is in a terminal state.
func (wi *WorkflowInstance) IsTerminal() bool {
	return wi.Status == InstanceStatusCompleted ||
		wi.Status == InstanceStatusFailed ||
		wi.Status == InstanceStatusCancelled
}

// IsRunnable returns true if the instance can accept new step transitions.
// An incident instance is deliberately NOT runnable: it will not auto-advance
// (a racing timer fire or task resume no-ops) until an operator resolves the
// incident, at which point it is put back to running.
func (wi *WorkflowInstance) IsRunnable() bool {
	return wi.Status == InstanceStatusRunning
}

// HasOpenIncident reports whether the instance is currently parked on an
// unresolved incident.
func (wi *WorkflowInstance) HasOpenIncident() bool {
	return wi.Status == InstanceStatusIncident
}
