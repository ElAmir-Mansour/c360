package model

import (
	"encoding/json"
	"time"
)

// Incident is the Camunda-incident-pattern record raised when a step's retries
// are exhausted. Instead of terminating the whole instance (the old
// failInstance behaviour), the engine PARKS the failed step and opens an
// incident that captures enough context (step, attempt, error) for a governed
// operator to diagnose and act on it (retry / skip / modify-variables). The rest
// of the instance and any sibling parallel branches are preserved.
//
// An incident is OPEN until an operator resolves it (retry/skip/modify succeed)
// or it is dead-lettered (abandoned / permanently failed).
type Incident struct {
	ID         string `json:"id" db:"id"`
	TenantID   string `json:"tenant_id" db:"tenant_id"`
	InstanceID string `json:"instance_id" db:"instance_id"`
	StepID     string `json:"step_id" db:"step_id"`
	// StepExecID is the failed step-execution row that triggered the incident
	// (may be empty if the failure predates a step-execution write).
	StepExecID *string `json:"step_exec_id,omitempty" db:"step_exec_id"`
	StepType   string  `json:"step_type" db:"step_type"`
	// Status is one of the IncidentStatus* constants.
	Status string `json:"status" db:"status"`
	// ErrorMessage is the terminal error that exhausted the retries.
	ErrorMessage string `json:"error_message" db:"error_message"`
	// Attempt is the attempt number that failed last (retries exhausted at this
	// count).
	Attempt int `json:"attempt" db:"attempt"`
	// Details carries additional diagnostic context (max_retries, definition
	// version, etc.) as JSON.
	Details json.RawMessage `json:"details,omitempty" db:"details"`

	// Resolution bookkeeping — populated when the incident leaves the open state.
	ResolvedBy     *string    `json:"resolved_by,omitempty" db:"resolved_by"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty" db:"resolved_at"`
	ResolutionKind *string    `json:"resolution_kind,omitempty" db:"resolution_kind"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// Incident status constants.
const (
	// IncidentStatusOpen is a live incident awaiting operator intervention.
	IncidentStatusOpen = "open"
	// IncidentStatusResolved is an incident an operator successfully cleared
	// (the instance resumed).
	IncidentStatusResolved = "resolved"
	// IncidentStatusDeadLettered is an incident that was abandoned / permanently
	// failed; a dead-letter row captures the full context for replay.
	IncidentStatusDeadLettered = "dead_lettered"
)

// Incident resolution-kind constants (the operator action that cleared it).
const (
	IncidentResolutionRetry       = "retry"
	IncidentResolutionSkip        = "skip"
	IncidentResolutionModifyRetry = "modify_variables_retry"
	IncidentResolutionDeadLetter  = "dead_letter"
)

// ValidIncidentStatuses is the set of allowed incident statuses.
var ValidIncidentStatuses = map[string]bool{
	IncidentStatusOpen:         true,
	IncidentStatusResolved:     true,
	IncidentStatusDeadLettered: true,
}

// IsOpen reports whether the incident is still awaiting resolution.
func (i *Incident) IsOpen() bool { return i.Status == IncidentStatusOpen }

// IncidentOverride is a maker-checker (four-eyes) override request against an
// open incident for a SENSITIVE operator action (skip, and modify-variables
// retry). The operator who REQUESTS the override (RequestedBy) may NOT also
// APPROVE it — the distinct-actor / separation-of-duties primitive reused from
// the approval-chain executor enforces this, fail-closed. Only after a distinct
// approver approves does the engine apply the override.
//
// A plain retry (re-run the same step, no state mutation) is NOT sensitive and
// does not require an override; skip and modify-variables do.
type IncidentOverride struct {
	ID         string `json:"id" db:"id"`
	TenantID   string `json:"tenant_id" db:"tenant_id"`
	IncidentID string `json:"incident_id" db:"incident_id"`
	InstanceID string `json:"instance_id" db:"instance_id"`
	// Kind is the sensitive action being requested (IncidentResolutionSkip or
	// IncidentResolutionModifyRetry).
	Kind string `json:"kind" db:"kind"`
	// Status is one of the OverrideStatus* constants.
	Status string `json:"status" db:"status"`
	// RequestedBy is the operator that requested the override (the MAKER).
	RequestedBy string `json:"requested_by" db:"requested_by"`
	// Reason is the operator-supplied justification (audited).
	Reason string `json:"reason" db:"reason"`
	// OldVariables / NewVariables capture the before/after for a modify-variables
	// override (nil for a skip) so the audit trail records who/what/old/new.
	OldVariables json.RawMessage `json:"old_variables,omitempty" db:"old_variables"`
	NewVariables json.RawMessage `json:"new_variables,omitempty" db:"new_variables"`

	// ApprovedBy / ApprovedAt are populated when a DISTINCT checker approves.
	ApprovedBy *string    `json:"approved_by,omitempty" db:"approved_by"`
	ApprovedAt *time.Time `json:"approved_at,omitempty" db:"approved_at"`
	// RejectedBy / RejectedAt / RejectReason capture a checker rejection.
	RejectedBy   *string    `json:"rejected_by,omitempty" db:"rejected_by"`
	RejectedAt   *time.Time `json:"rejected_at,omitempty" db:"rejected_at"`
	RejectReason *string    `json:"reject_reason,omitempty" db:"reject_reason"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// Override status constants.
const (
	// OverrideStatusPending is a requested override awaiting a distinct approver.
	OverrideStatusPending = "pending"
	// OverrideStatusApproved is an override a distinct checker approved and the
	// engine applied.
	OverrideStatusApproved = "approved"
	// OverrideStatusRejected is an override a checker declined.
	OverrideStatusRejected = "rejected"
)

// ValidOverrideStatuses is the set of allowed override statuses.
var ValidOverrideStatuses = map[string]bool{
	OverrideStatusPending:  true,
	OverrideStatusApproved: true,
	OverrideStatusRejected: true,
}

// RequiresMakerChecker reports whether an incident resolution kind is a
// SENSITIVE action that must go through the maker-checker override flow. A plain
// retry does not mutate state and is not sensitive; skip and modify-variables
// alter the workflow's committed path / data and therefore require four-eyes.
func RequiresMakerChecker(kind string) bool {
	switch kind {
	case IncidentResolutionSkip, IncidentResolutionModifyRetry:
		return true
	default:
		return false
	}
}

// DeadLetter captures an instance/step that is permanently failed or explicitly
// abandoned by an operator. It carries enough context to diagnose and replay:
// the full instance snapshot (variables, step outputs, current step), the failed
// step + error, and the originating incident.
type DeadLetter struct {
	ID         string  `json:"id" db:"id"`
	TenantID   string  `json:"tenant_id" db:"tenant_id"`
	InstanceID string  `json:"instance_id" db:"instance_id"`
	IncidentID *string `json:"incident_id,omitempty" db:"incident_id"`
	StepID     string  `json:"step_id" db:"step_id"`
	StepType   string  `json:"step_type" db:"step_type"`
	// Reason is one of the DeadLetterReason* constants.
	Reason string `json:"reason" db:"reason"`
	// ErrorMessage is the terminal error.
	ErrorMessage string `json:"error_message" db:"error_message"`
	// DefinitionID / DefinitionVer pin the exact definition for replay.
	DefinitionID  string `json:"definition_id" db:"definition_id"`
	DefinitionVer int    `json:"definition_ver" db:"definition_ver"`
	// Snapshot is the instance state at dead-letter time (variables, step
	// outputs, current step) so a replay can be reconstructed off-line.
	Snapshot json.RawMessage `json:"snapshot,omitempty" db:"snapshot"`
	// AbandonedBy is the operator id when the reason is an explicit abandon
	// (nil for an automatic permanent-failure dead-letter).
	AbandonedBy *string   `json:"abandoned_by,omitempty" db:"abandoned_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// Dead-letter reason constants.
const (
	// DeadLetterReasonAbandoned is an operator explicitly abandoning an incident.
	DeadLetterReasonAbandoned = "abandoned"
	// DeadLetterReasonPermanentFailure is an automatic dead-letter for a failure
	// with no viable recovery path.
	DeadLetterReasonPermanentFailure = "permanent_failure"
)
