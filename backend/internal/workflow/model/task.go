package model

import "time"

// HumanTask represents a task that requires human interaction within a workflow.
// Tasks can be assigned to a specific user or a role, claimed, delegated, and escalated.
type HumanTask struct {
	ID           string  `json:"id" db:"id"`
	TenantID     string  `json:"tenant_id" db:"tenant_id"`
	InstanceID   string  `json:"instance_id" db:"instance_id"`
	StepID       string  `json:"step_id" db:"step_id"`
	StepExecID   string  `json:"step_exec_id" db:"step_exec_id"`
	Name         string  `json:"name" db:"name"`
	Description  string  `json:"description" db:"description"`
	Status       string  `json:"status" db:"status"`
	AssigneeID   *string `json:"assignee_id,omitempty" db:"assignee_id"`
	AssigneeRole *string `json:"assignee_role,omitempty" db:"assignee_role"`
	// CandidateGroups is the set of GROUPS (roles) whose members may see and
	// claim this task from a shared group inbox / work queue while it is
	// unassigned (large-org work-queue primitive). It is ADDITIVE to the legacy
	// single assignee_id / assignee_role: a task with empty CandidateGroups AND
	// empty CandidateUsers behaves exactly as before. A member of any candidate
	// group is matched against the requesting user's Roles (roles == groups in
	// this platform, mirroring the existing assignee_role IN (roles) model).
	CandidateGroups []string `json:"candidate_groups,omitempty" db:"candidate_groups"`
	// CandidateUsers is the set of specific users (in addition to any candidate
	// groups) who may see and claim this task from the pool while it is
	// unassigned. Matched against the requesting user's ID.
	CandidateUsers []string               `json:"candidate_users,omitempty" db:"candidate_users"`
	ClaimedBy      *string                `json:"claimed_by,omitempty" db:"claimed_by"`
	ClaimedAt      *time.Time             `json:"claimed_at,omitempty" db:"claimed_at"`
	FormSchema     []FormField            `json:"form_schema" db:"form_schema"`
	FormData       map[string]interface{} `json:"form_data,omitempty" db:"form_data"`
	SLADeadline    *time.Time             `json:"sla_deadline,omitempty" db:"sla_deadline"`
	SLABreached    bool                   `json:"sla_breached" db:"sla_breached"`
	EscalatedTo    *string                `json:"escalated_to,omitempty" db:"escalated_to"`
	EscalationRole *string                `json:"escalation_role,omitempty" db:"escalation_role"`
	DelegatedBy    *string                `json:"delegated_by,omitempty" db:"delegated_by"`
	DelegatedAt    *time.Time             `json:"delegated_at,omitempty" db:"delegated_at"`
	Priority       int                    `json:"priority" db:"priority"`
	Metadata       map[string]interface{} `json:"metadata" db:"metadata"`
	CompletedAt    *time.Time             `json:"completed_at,omitempty" db:"completed_at"`
	// LateJustification is deliberately stored outside form_data/metadata because
	// those payloads are visible to ordinary task participants. API handlers expose
	// these fields only to the Legal Director or the corresponding manager role.
	LateJustification            *string    `json:"-" db:"late_justification"`
	LateJustificationSubmittedBy *string    `json:"-" db:"late_justification_submitted_by"`
	LateJustificationSubmittedAt *time.Time `json:"-" db:"late_justification_submitted_at"`
	LateJustificationManagerRole *string    `json:"-" db:"late_justification_manager_role"`
	CreatedAt                    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt                    time.Time  `json:"updated_at" db:"updated_at"`
}

// FormField describes a single field in a human task form.
type FormField struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"` // boolean, text, textarea, select, number, date
	Label       string      `json:"label"`
	Required    bool        `json:"required"`
	Options     []string    `json:"options,omitempty"`
	Default     interface{} `json:"default,omitempty"`
	Placeholder string      `json:"placeholder,omitempty"`
	Description string      `json:"description,omitempty"`
	// VisibleWhen is an optional boolean expression (same DSL as
	// internal/workflow/expression.Evaluator) evaluated against the CURRENT
	// submitted form values. When it evaluates to false the field is hidden:
	// hidden fields are excluded from "required" validation and cleared on
	// submit. An empty expression means the field is always visible.
	VisibleWhen string `json:"visible_when,omitempty"`
	// Sensitivity is an OPTIONAL data-classification tag on this field's VALUE
	// (one of pii | sensitive | confidential). When the payload-crypto seam is
	// wired, a field whose Sensitivity is set to a classified level has its
	// submitted value encrypted at rest in the form_data / variables / step_outputs
	// JSONB (an "enc:v1:" envelope) and transparently decrypted on read. An empty
	// Sensitivity means the field is UNCLASSIFIED and stored in plaintext exactly
	// as before, so every existing form is byte-for-byte unchanged. omitempty keeps
	// legacy JSON schemas identical on the wire.
	Sensitivity string `json:"sensitivity,omitempty"`
}

// Data-classification levels for a FormField value (and definition-level
// sensitive variables). Any non-empty level in ValidSensitivityLevels marks a
// value for encryption at rest; the empty string is UNCLASSIFIED (plaintext).
const (
	// SensitivityPII marks personally identifiable information (names, national
	// IDs, contact details) — encrypted at rest under PDPL.
	SensitivityPII = "pii"
	// SensitivitySensitive marks sensitive-but-not-PII payload (e.g. approval
	// justifications, internal amounts) — encrypted at rest.
	SensitivitySensitive = "sensitive"
	// SensitivityConfidential marks confidential material (legal opinions,
	// settlement figures) — encrypted at rest.
	SensitivityConfidential = "confidential"
)

// ValidSensitivityLevels is the set of classification levels that trigger
// encryption at rest. The empty string is intentionally NOT a member: an
// unclassified field stays plaintext.
var ValidSensitivityLevels = map[string]bool{
	SensitivityPII:          true,
	SensitivitySensitive:    true,
	SensitivityConfidential: true,
}

// IsClassified reports whether the field carries a recognized sensitivity level
// and therefore should be encrypted at rest. An unknown or empty level is
// treated as unclassified (plaintext) — fail-open on CLASSIFICATION only (never
// on decryption of an already-encrypted value).
func (f FormField) IsClassified() bool {
	return ValidSensitivityLevels[f.Sensitivity]
}

// SensitiveFormFieldKeys returns the set of form-field NAMES in a task's schema
// whose values carry a classified sensitivity level and therefore must be
// encrypted at rest in the task's form_data JSONB when a payload codec is wired.
// A submitted form_data map is keyed by field name, so these are exactly the
// top-level keys the codec should envelope. Returns an empty (non-nil) set when
// nothing is classified (the legacy case), so the repository's len()==0 guard
// keeps the write on the exact plaintext path. Nil-safe.
func SensitiveFormFieldKeys(schema []FormField) map[string]bool {
	set := make(map[string]bool, len(schema))
	for _, f := range schema {
		if f.Name != "" && f.IsClassified() {
			set[f.Name] = true
		}
	}
	return set
}

// SLAConfig defines the SLA parameters for a human task step.
type SLAConfig struct {
	Hours          int    `json:"sla_hours"`
	EscalationRole string `json:"escalation_role,omitempty"`
}

// Task status constants.
const (
	TaskStatusPending   = "pending"
	TaskStatusClaimed   = "claimed"
	TaskStatusCompleted = "completed"
	TaskStatusRejected  = "rejected"
	TaskStatusEscalated = "escalated"
	TaskStatusCancelled = "cancelled"
)

// ValidTaskStatuses is the set of allowed task statuses.
var ValidTaskStatuses = map[string]bool{
	TaskStatusPending:   true,
	TaskStatusClaimed:   true,
	TaskStatusCompleted: true,
	TaskStatusRejected:  true,
	TaskStatusEscalated: true,
	TaskStatusCancelled: true,
}

// ValidFormFieldTypes is the set of allowed form field types.
var ValidFormFieldTypes = map[string]bool{
	"boolean":  true,
	"text":     true,
	"textarea": true,
	"select":   true,
	"number":   true,
	"date":     true,
}

// IsClaimable returns true if the task can be claimed by a user.
func (ht *HumanTask) IsClaimable() bool {
	return ht.Status == TaskStatusPending
}

// IsGroupTask reports whether the task is a candidate-group / work-queue task:
// it has at least one candidate group or candidate user, so while unassigned it
// is offered to a shared pool rather than to a single owner. A task with no
// candidates is a legacy single-assignee / single-role task.
func (ht *HumanTask) IsGroupTask() bool {
	return len(ht.CandidateGroups) > 0 || len(ht.CandidateUsers) > 0
}

// UserIsCandidate reports whether the given user (with the given roles/groups)
// is a candidate for this task's pool: they are a named candidate user, or they
// belong to one of the candidate groups. Used to authorize claim-from-pool.
func (ht *HumanTask) UserIsCandidate(userID string, roles []string) bool {
	for _, u := range ht.CandidateUsers {
		if u == userID {
			return true
		}
	}
	for _, g := range ht.CandidateGroups {
		for _, r := range roles {
			if g == r {
				return true
			}
		}
	}
	return false
}

// IsCompletable returns true if the task can be completed.
func (ht *HumanTask) IsCompletable() bool {
	return ht.Status == TaskStatusClaimed
}

// IsCancellable returns true if the task can be cancelled.
func (ht *HumanTask) IsCancellable() bool {
	return ht.Status == TaskStatusPending || ht.Status == TaskStatusClaimed
}
