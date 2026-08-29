package model

import (
	"encoding/json"
	"time"
)

// WorkflowDefinition represents a versioned workflow blueprint that describes
// trigger conditions, variables, and the ordered steps to execute.
type WorkflowDefinition struct {
	ID            string                 `json:"id" db:"id"`
	TenantID      string                 `json:"tenant_id" db:"tenant_id"`
	Name          string                 `json:"name" db:"name"`
	Description   string                 `json:"description" db:"description"`
	Category      string                 `json:"category,omitempty" db:"category"` // approval, onboarding, review, escalation, notification, data_pipeline, compliance, custom
	Version       int                    `json:"version" db:"version"`
	Status        string                 `json:"status" db:"status"` // draft, active, deprecated, archived
	DefinitionKey string                 `json:"definition_key" db:"definition_key"`
	TriggerConfig TriggerConfig          `json:"trigger_config" db:"trigger_config"`
	Variables     map[string]VariableDef `json:"variables" db:"variables"`
	Steps         []StepDefinition       `json:"steps" db:"steps"`
	CreatedBy     string                 `json:"created_by" db:"created_by"`
	UpdatedBy     string                 `json:"updated_by,omitempty" db:"updated_by"`
	CreatedAt     time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at" db:"updated_at"`
	PublishedAt   *time.Time             `json:"published_at,omitempty" db:"published_at"`
	DeletedAt     *time.Time             `json:"deleted_at,omitempty" db:"deleted_at"`
	InstanceCount int                    `json:"instance_count" db:"-"` // computed, not persisted

	// Stage is the promotion stage of THIS version (dev/staging/prod), added by
	// migration 000003_promotion. It is OPTIONAL on this struct: only the queries
	// that need to reason about the RUNTIME-ACTIVE version of a lineage select it
	// (GetRuntimeActiveByDefinitionKey / the deterministic trigger-topic path); the
	// legacy scan paths leave it "", which StageRank treats as dev. New rows default
	// to StageDev at the DB. Kept omitempty so existing JSON bodies are unchanged.
	Stage string `json:"stage,omitempty" db:"stage"`
	// Immutable mirrors the promotion immutability flag (set once a version reaches
	// staging or prod). Only the version-aware queries select it. omitempty keeps
	// legacy JSON unchanged.
	Immutable bool `json:"immutable,omitempty" db:"immutable"`

	// MarketplaceItemID / MarketplaceItemVersion record the marketplace item
	// VERSION this definition was installed from (Phase 5 marketplace provenance,
	// migration 000016). Empty for hand-authored definitions and legacy rows; set
	// only when a definition is instantiated via a marketplace template install.
	// omitempty keeps existing JSON bodies unchanged.
	MarketplaceItemID      string `json:"marketplace_item_id,omitempty" db:"marketplace_item_id"`
	MarketplaceItemVersion string `json:"marketplace_item_version,omitempty" db:"marketplace_item_version"`

	// SensitiveVariableKeys is an OPTIONAL definition-level classification list:
	// the top-level keys of the instance Variables / StepOutputs maps whose values
	// carry sensitive payload (PII / confidential approval content) and MUST be
	// encrypted at rest when the payload-crypto seam is wired. It is the
	// variable-level companion to FormField.Sensitivity (which classifies human-task
	// form fields). Empty / nil for every legacy definition, so encryption is opt-in
	// and existing definitions are byte-for-byte unchanged. omitempty keeps legacy
	// JSON bodies identical. Marshalled into the definition JSONB via the standard
	// definition serializer — no schema change is required for the keys themselves.
	SensitiveVariableKeys []string `json:"sensitive_variable_keys,omitempty" db:"-"`
}

// SensitiveKeySet returns the definition's declared sensitive variable keys as a
// lookup set, deduplicated and with empty entries dropped. Nil-safe: a definition
// with no declared keys returns an empty (non-nil) set, so callers can range/query
// it unconditionally. This is the classification source the payload-crypto codec
// consults when encrypting an instance's Variables / StepOutputs at rest.
func (d *WorkflowDefinition) SensitiveKeySet() map[string]bool {
	set := make(map[string]bool, len(d.SensitiveVariableKeys))
	for _, k := range d.SensitiveVariableKeys {
		if k != "" {
			set[k] = true
		}
	}
	return set
}

// ClassifiedVariableKeys returns the FULL set of instance top-level keys that
// must be encrypted at rest for this definition: the explicit
// SensitiveVariableKeys PLUS the names of any CLASSIFIED human-task form fields
// declared inline in the definition's steps. Human-task executors merge submitted
// form values into the instance step_outputs/variables under the field NAME, so a
// classified form field's name is a sensitive top-level key. Returns an empty
// (non-nil) set when nothing is classified — the common legacy case — so the
// engine can stamp it unconditionally and the repository's len()==0 guard keeps
// the write on the exact plaintext path.
func (d *WorkflowDefinition) ClassifiedVariableKeys() map[string]bool {
	set := d.SensitiveKeySet()
	// Definition variables classified via VariableDef.Sensitivity (durably stored
	// in the variables JSONB — no schema change, round-trips through every read).
	for name, v := range d.Variables {
		if v.IsClassified() {
			set[name] = true
		}
	}
	for _, step := range d.Steps {
		if step.Type != StepTypeHumanTask && step.Type != StepTypeApprovalChain {
			continue
		}
		for _, f := range formFieldsFromConfig(step.Config) {
			if f.IsClassified() {
				set[f.Name] = true
			}
		}
	}
	return set
}

// formFieldsFromConfig extracts inline form-field definitions from a step's
// Config["form_fields"] (the inline human-task schema shape). It is defensive:
// any non-conforming entry is skipped, so a malformed config never panics and
// simply contributes no classified keys.
func formFieldsFromConfig(config map[string]interface{}) []FormField {
	raw, ok := config["form_fields"].([]interface{})
	if !ok {
		return nil
	}
	fields := make([]FormField, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		var f FormField
		if name, ok := m["name"].(string); ok {
			f.Name = name
		}
		if sens, ok := m["sensitivity"].(string); ok {
			f.Sensitivity = sens
		}
		if f.Name != "" {
			fields = append(fields, f)
		}
	}
	return fields
}

// Promotion stage constants (mirrors repository.Stage*; the model owns the
// canonical stage set the runtime-active selection ranks over). A draft is born
// in StageDev and is advanced by the promote FSM dev→staging→prod.
const (
	StageDev     = "dev"
	StageStaging = "staging"
	StageProd    = "prod"
)

// StageRank maps a promotion stage to a monotonic rank used to pick the single
// RUNTIME-SELECTED active version of a lineage: prod (3) outranks staging (2)
// outranks dev (1). An empty/unknown stage is treated as dev (1) so a legacy row
// that never carried a stage still ranks deterministically below a promoted one.
// This is the Go mirror of the SQL "CASE stage WHEN 'prod' THEN 3 ..." ordering
// so the service and the repository agree on the winner.
func StageRank(stage string) int {
	switch stage {
	case StageProd:
		return 3
	case StageStaging:
		return 2
	default:
		return 1
	}
}

// RuntimeActiveLess reports whether definition a ranks BELOW definition b for
// runtime-active selection: higher stage rank wins, then higher version wins. It
// is the total order the deterministic selection uses (never name). It is a pure
// helper so the ambiguity check and any in-memory tie-break stay consistent with
// the SQL ORDER BY.
func RuntimeActiveLess(aStage string, aVersion int, bStage string, bVersion int) bool {
	ra, rb := StageRank(aStage), StageRank(bStage)
	if ra != rb {
		return ra < rb
	}
	return aVersion < bVersion
}

// Valid workflow definition categories.
const (
	CategoryApproval     = "approval"
	CategoryOnboarding   = "onboarding"
	CategoryReview       = "review"
	CategoryEscalation   = "escalation"
	CategoryNotification = "notification"
	CategoryDataPipeline = "data_pipeline"
	CategoryCompliance   = "compliance"
	CategoryCustom       = "custom"
)

// ValidCategories is the set of allowed category values.
var ValidCategories = map[string]bool{
	CategoryApproval:     true,
	CategoryOnboarding:   true,
	CategoryReview:       true,
	CategoryEscalation:   true,
	CategoryNotification: true,
	CategoryDataPipeline: true,
	CategoryCompliance:   true,
	CategoryCustom:       true,
}

// TriggerConfig describes how a workflow is initiated.
type TriggerConfig struct {
	Type             string                 `json:"type"` // "manual", "event", "schedule"
	Topic            string                 `json:"topic,omitempty"`
	Filter           map[string]interface{} `json:"filter,omitempty"`
	Cron             string                 `json:"cron,omitempty"`
	DedupeKeyFields  []string               `json:"dedupe_key_fields,omitempty"`
	DedupeTTLSeconds int                    `json:"dedupe_ttl_seconds,omitempty"`
}

// VariableDef describes a workflow-level variable with its type and default value.
type VariableDef struct {
	Type    string      `json:"type"` // string, boolean, number, object, array
	Source  string      `json:"source,omitempty"`
	Default interface{} `json:"default,omitempty"`
	// Sensitivity is an OPTIONAL data-classification tag on this variable's VALUE
	// (pii | sensitive | confidential — see ValidSensitivityLevels). A classified
	// variable's value is encrypted at rest in the instance variables / step_outputs
	// JSONB when the payload-crypto seam is wired, and transparently decrypted on
	// read. Empty means UNCLASSIFIED (plaintext, exactly as before). It rides the
	// EXISTING variables JSONB column, so it durably round-trips through every
	// definition read/write with NO schema change. omitempty keeps legacy JSON
	// bodies byte-for-byte unchanged.
	Sensitivity string `json:"sensitivity,omitempty"`
}

// IsClassified reports whether this variable carries a recognized sensitivity
// level and so should be encrypted at rest. Unknown/empty is unclassified.
func (v VariableDef) IsClassified() bool {
	return ValidSensitivityLevels[v.Sensitivity]
}

// StepDefinition represents a single step within a workflow definition.
type StepDefinition struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"` // human_task, service_task, event_task, condition, parallel_gateway, timer, end
	Name        string                 `json:"name"`
	Config      map[string]interface{} `json:"config"`
	Transitions []Transition           `json:"transitions"`

	// BoundaryEvents attaches BPMN interrupting boundary events to THIS step
	// (Phase 5 control-flow). While the step is PARKED/active, a boundary event
	// (a timer expiring, the step failing with an error, or a correlated inbound
	// message) INTERRUPTS the step — cancelling its pending task/wait/timer — and
	// routes the flow to the boundary's handler step. It is OPTIONAL and omitempty:
	// a step that declares none behaves exactly as before, so every existing
	// definition and instance is byte-for-byte unchanged. See BoundaryEvent.
	BoundaryEvents []BoundaryEvent `json:"boundary_events,omitempty"`
}

// BoundaryEvent is an INTERRUPTING boundary event attached to a step. When it
// fires while the step it is attached to is still active/parked, it cancels the
// step's pending work and routes the flow to HandlerStepID. Exactly one outcome
// is guaranteed per parked step (boundary fire vs. normal completion) via the
// engine's per-instance serialization (SerializeInstance + lock_version).
//
// Reuse of existing subsystems: a timer boundary rides the durable timer
// subsystem (Redis sorted set + workflow_timers), and a message boundary rides
// the event-wait correlation subsystem (Redis event-wait key + the event-wait
// consumer). An error boundary is evaluated inline in the step-failure path.
type BoundaryEvent struct {
	// ID uniquely identifies this boundary within its attached step.
	ID string `json:"id"`
	// Type is one of timer | error | message.
	Type string `json:"type"`
	// HandlerStepID is the step the flow routes to when this boundary fires. It
	// must reference an existing step in the definition.
	HandlerStepID string `json:"handler_step_id"`
	// Config carries the boundary's type-specific parameters:
	//   - timer:   { "duration": "PT30M" } or { "fire_at": "..." } (same shape as
	//              a timer step's config).
	//   - message: { "topic": "...", "correlation_value": "..."|"${...}",
	//              "timeout_seconds": <n> } (same shape as an event_task WAIT).
	//   - error:   { "error_code": "..." } optional; when set the boundary fires
	//              only when the step failure message contains the code, otherwise
	//              any failure fires it (a catch-all error boundary).
	Config map[string]interface{} `json:"config,omitempty"`
}

// Boundary event type constants.
const (
	BoundaryEventTypeTimer   = "timer"
	BoundaryEventTypeError   = "error"
	BoundaryEventTypeMessage = "message"
)

// ValidBoundaryEventTypes is the set of allowed boundary event types.
var ValidBoundaryEventTypes = map[string]bool{
	BoundaryEventTypeTimer:   true,
	BoundaryEventTypeError:   true,
	BoundaryEventTypeMessage: true,
}

// Transition defines the link from one step to another, optionally gated by a condition.
type Transition struct {
	Condition string `json:"condition,omitempty"`
	Target    string `json:"target"`
}

// MarshalJSON implements custom JSON marshalling for TriggerConfig.
func (tc TriggerConfig) MarshalJSON() ([]byte, error) {
	type Alias TriggerConfig
	return json.Marshal((*Alias)(&tc))
}

// Status constants for WorkflowDefinition.
const (
	DefinitionStatusDraft      = "draft"
	DefinitionStatusActive     = "active"
	DefinitionStatusDeprecated = "deprecated"
	DefinitionStatusArchived   = "archived"
)

// Step type constants.
const (
	StepTypeHumanTask       = "human_task"
	StepTypeServiceTask     = "service_task"
	StepTypeEventTask       = "event_task"
	StepTypeCondition       = "condition"
	StepTypeParallelGateway = "parallel_gateway"
	StepTypeTimer           = "timer"
	StepTypeEnd             = "end"
	// StepTypeApprovalChain is the WP-5 multi-approver step. Its executor lives in
	// internal/workflow/executor (executor.StepTypeApprovalChain mirrors this
	// literal; the model owns the canonical step-type set, which executor cannot
	// import without a cycle).
	StepTypeApprovalChain = "approval_chain"
	// StepTypeCallActivity is the BPMN call-activity / sub-process step: it starts
	// a CHILD workflow instance from another definition (resolved by
	// definition_key), maps input variables in, records a parent->child link, and
	// PARKS the parent until the child completes — at which point the child's
	// mapped outputs flow back and the parent resumes. Additive; existing
	// definitions never reference it, so they are unaffected.
	StepTypeCallActivity = "call_activity"
	// StepTypeMultiInstance is the BPMN multi-instance (for-each) step: it resolves
	// a COLLECTION (${...}) and fans out N inner activities — either N child
	// call-activities (async, park + completion-counter fan-in) or N inline
	// sync sub-steps — under an all / any / n_of_m completion policy, aggregating
	// their outputs into a result collection. Additive; existing definitions never
	// reference it.
	StepTypeMultiInstance = "multi_instance"
	// StepTypeDecisionTask is the DMN decision-table step: it holds a decision
	// table (input columns, rules, output columns) and a hit policy
	// (UNIQUE/FIRST/COLLECT/PRIORITY). It evaluates the input expressions against
	// the instance data, matches rule rows using the FEEL-subset evaluator, and
	// writes the resulting output(s) into the step output AND (by default) the
	// instance variables so downstream transitions can ROUTE on the decision.
	// Deterministic + fail-closed. Additive; existing definitions never reference
	// it, so registering it changes nothing for existing workflows.
	StepTypeDecisionTask = "decision_task"
	// StepTypeConnectorTask is the GOVERNED connector-invocation step: instead of
	// service_task's raw net/http against a fixed first-party service map, it
	// DISPATCHES through the platform's integration connector framework (the
	// generic connector Registry + its delivery/action connectors, or the lex
	// custom-REST connector). It inherits the SAME governance as service_task —
	// circuit breaker, bounded backoff, the Wave-1 at-most-once idempotency ledger
	// — plus the framework's secret-ref custody and egress/SSRF policy (enforced in
	// the injected dispatcher), and emits workflow.connector.invoked/failed audit
	// events. Additive + fail-closed: no existing definition references it, and
	// when no dispatcher is wired the step errors clearly rather than calling out.
	StepTypeConnectorTask = "connector_task"
	// StepTypeEventGateway is the BPMN event-based gateway: it waits for one of N
	// events (timer / message) and routes to whichever fires FIRST, cancelling the
	// others (racing timers/message-waits, resolved to EXACTLY ONE winner via the
	// per-instance serialization). Each event names a target step to route to when
	// it wins. It reuses the durable timer subsystem for timer events and the
	// event-wait correlation subsystem for message events (the same seams the
	// timer step + event_task WAIT use). Additive + fail-closed: no existing
	// definition references it, so registering it changes nothing for existing
	// workflows.
	StepTypeEventGateway = "event_based_gateway"
)

// Trigger type constants.
const (
	TriggerTypeManual   = "manual"
	TriggerTypeEvent    = "event"
	TriggerTypeSchedule = "schedule"
)

// ValidDefinitionStatuses is the set of allowed definition statuses.
var ValidDefinitionStatuses = map[string]bool{
	DefinitionStatusDraft:      true,
	DefinitionStatusActive:     true,
	DefinitionStatusDeprecated: true,
	DefinitionStatusArchived:   true,
}

// ValidStepTypes is the set of allowed step types.
var ValidStepTypes = map[string]bool{
	StepTypeHumanTask:       true,
	StepTypeServiceTask:     true,
	StepTypeEventTask:       true,
	StepTypeCondition:       true,
	StepTypeParallelGateway: true,
	StepTypeTimer:           true,
	StepTypeEnd:             true,
	StepTypeApprovalChain:   true,
	StepTypeCallActivity:    true,
	StepTypeMultiInstance:   true,
	StepTypeDecisionTask:    true,
	StepTypeConnectorTask:   true,
	StepTypeEventGateway:    true,
}

// ValidTriggerTypes is the set of allowed trigger types.
var ValidTriggerTypes = map[string]bool{
	TriggerTypeManual:   true,
	TriggerTypeEvent:    true,
	TriggerTypeSchedule: true,
}

// ValidVariableTypes is the set of allowed variable types.
var ValidVariableTypes = map[string]bool{
	"string":  true,
	"boolean": true,
	"number":  true,
	"object":  true,
	"array":   true,
}
