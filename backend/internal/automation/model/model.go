// Package model defines the Automation engine domain (DESIGN_Workflow_Forms_
// Automation.md §4). An Automation binds a trigger (event/schedule/threshold/
// manual/webhook) to a set of priority-ordered rules and a multi-step runbook.
// Each runbook step is either an action (start_workflow / integration /
// notification / dr_runbook / http_call) or a human approval gate. Firing an
// automation creates a durable Run that the leader-singleton orchestrator drives
// step by step through an idempotent, restart-safe FSM (§6); every step is logged
// append-only as a RunStep so a completed run can be replayed from recorded
// inputs (§4.7).
//
// This is the Automation Engine's data model only (WP-8). The trigger sources
// (WP-9), rule engine (WP-10), orchestrator (WP-11) and action executors (WP-12)
// consume these types but live in their own packages.
package model

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the handler layer (WP-13) and used
// by callers to branch on outcome without string matching.
var (
	// ErrNotFound is returned when a requested entity does not exist (or is not
	// visible to the caller's tenant under RLS).
	ErrNotFound = errors.New("not found")
	// ErrAlreadyExists is returned on a unique-constraint violation, including
	// the (tenant_id, source_event_id) exactly-once backstop on automation_runs.
	ErrAlreadyExists = errors.New("already exists")
	// ErrInvalidTransition is returned when a run is asked to move to a state
	// that the FSM forbids from its current state (§6).
	ErrInvalidTransition = errors.New("invalid run state transition")
	// ErrConflict is returned for optimistic-concurrency / immutability
	// conflicts (e.g. editing a step row that is append-only).
	ErrConflict = errors.New("conflict")
)

// =============================================================================
// Trigger configuration (§4.3, FR-AUTOMATION-001)
// =============================================================================

// Trigger type constants — the five trigger kinds an automation may declare.
const (
	TriggerTypeEvent     = "event"     // bus event on Topic matching Filter
	TriggerTypeSchedule  = "schedule"  // cron expression, leader-singleton
	TriggerTypeThreshold = "threshold" // alert/metric event crossing a bound
	TriggerTypeManual    = "manual"    // POST /automations/{id}/invoke
	TriggerTypeWebhook   = "webhook"   // inbound POST /webhooks/{token}
)

// ValidTriggerTypes is the closed set of trigger types accepted by validation.
var ValidTriggerTypes = map[string]bool{
	TriggerTypeEvent:     true,
	TriggerTypeSchedule:  true,
	TriggerTypeThreshold: true,
	TriggerTypeManual:    true,
	TriggerTypeWebhook:   true,
}

// Threshold comparison operators for threshold triggers. These mirror the
// expression DSL operator vocabulary so a threshold can also be expressed as a
// rule condition when needed.
const (
	ThresholdOpGT  = "gt"  // >
	ThresholdOpGTE = "gte" // >=
	ThresholdOpLT  = "lt"  // <
	ThresholdOpLTE = "lte" // <=
	ThresholdOpEQ  = "eq"  // ==
	ThresholdOpNEQ = "neq" // !=
)

// ValidThresholdOps is the closed set of threshold operators.
var ValidThresholdOps = map[string]bool{
	ThresholdOpGT:  true,
	ThresholdOpGTE: true,
	ThresholdOpLT:  true,
	ThresholdOpLTE: true,
	ThresholdOpEQ:  true,
	ThresholdOpNEQ: true,
}

// TriggerConfig describes how an automation fires. Only the fields relevant to
// the chosen Type are populated; the shape intentionally mirrors the workflow
// engine's TriggerConfig so authors learn one model.
type TriggerConfig struct {
	Type string `json:"type"` // one of TriggerType*

	// event / threshold
	Topic  string         `json:"topic,omitempty"`  // bus topic to subscribe to
	Filter map[string]any `json:"filter,omitempty"` // exact-match fields on event.data

	// schedule
	Cron string `json:"cron,omitempty"` // standard 5-field cron (internal/cron)

	// threshold
	ThresholdField string  `json:"threshold_field,omitempty"` // dotted path into event.data
	ThresholdOp    string  `json:"threshold_op,omitempty"`    // one of ThresholdOp*
	ThresholdValue float64 `json:"threshold_value,omitempty"` // bound to compare against

	// webhook
	WebhookToken string `json:"webhook_token,omitempty"` // opaque token in the path

	// exactly-once dedupe (§4.3): the stable identity of a trigger occurrence is
	// derived from these fields of the source event (in addition to event.ID).
	DedupeKeyFields []string `json:"dedupe_key_fields,omitempty"`
}

// Validate reports a configuration error for the trigger, or nil if usable.
// It checks only structural validity (required fields per type); semantic
// validity (e.g. cron parseability) is enforced by the service layer using the
// shared internal/cron parser.
func (tc TriggerConfig) Validate() error {
	if !ValidTriggerTypes[tc.Type] {
		return errInvalid("trigger type %q is not one of event|schedule|threshold|manual|webhook", tc.Type)
	}
	switch tc.Type {
	case TriggerTypeEvent:
		if tc.Topic == "" {
			return errInvalid("event trigger requires a topic")
		}
	case TriggerTypeSchedule:
		if tc.Cron == "" {
			return errInvalid("schedule trigger requires a cron expression")
		}
	case TriggerTypeThreshold:
		if tc.Topic == "" {
			return errInvalid("threshold trigger requires a topic")
		}
		if tc.ThresholdField == "" {
			return errInvalid("threshold trigger requires threshold_field")
		}
		if !ValidThresholdOps[tc.ThresholdOp] {
			return errInvalid("threshold trigger op %q is not one of gt|gte|lt|lte|eq|neq", tc.ThresholdOp)
		}
	case TriggerTypeWebhook:
		if tc.WebhookToken == "" {
			return errInvalid("webhook trigger requires a webhook_token")
		}
	case TriggerTypeManual:
		// no extra config required
	}
	return nil
}

// =============================================================================
// Rules (§4.4, FR-AUTOMATION-002)
// =============================================================================

// Condition is a single boolean expression in the workflow expression DSL
// (internal/workflow/expression). It is evaluated against the trigger/variable
// context; a Rule matches when ALL of its conditions evaluate true. Using the
// DSL string verbatim means automation rules and workflow transitions share one
// grammar (design §15.1).
type Condition struct {
	// Expr is a DSL expression, e.g. `trigger.data.severity == "critical"`.
	Expr string `json:"expr"`
}

// Rule binds a priority-ordered match (When) to the action to run (ActionRef).
// The rule engine (WP-10) evaluates an automation's rules in ascending Priority
// order (lower number = higher precedence) and, on conflict, the higher-priority
// rule wins and the conflict is logged.
type Rule struct {
	ID        string      `json:"id,omitempty"`
	Priority  int         `json:"priority"`
	When      []Condition `json:"when,omitempty"` // empty = always matches
	ActionRef ActionRef   `json:"action_ref"`
}

// =============================================================================
// Action reference (§4.6, FR-AUTOMATION-005)
// =============================================================================

// Action kind constants — the five orchestration targets. Each is reached only
// via API or event (FR-XC-004); no executor reads another engine's database.
const (
	ActionStartWorkflow = "start_workflow" // POST /api/v1/workflows/instances
	ActionIntegration   = "integration"    // publish domain event → IntegrationConsumer
	ActionNotification  = "notification"   // publish domain event → NotificationConsumer
	ActionDRRunbook     = "dr_runbook"     // POST /api/v1/dr/studio/.../tasks/{action}
	ActionHTTPCall      = "http_call"      // generic gateway HTTP call
)

// ValidActionKinds is the closed set of action kinds.
var ValidActionKinds = map[string]bool{
	ActionStartWorkflow: true,
	ActionIntegration:   true,
	ActionNotification:  true,
	ActionDRRunbook:     true,
	ActionHTTPCall:      true,
}

// ActionRef names an action and carries its opaque configuration. Config is
// interpreted by the matching action executor (WP-12); the model only records
// it. Secrets (webhook/http tokens) are stored encrypted, never in plaintext
// Config (§5).
type ActionRef struct {
	Kind   string         `json:"kind"`   // one of Action*
	Config map[string]any `json:"config"` // executor-specific parameters
}

// Validate reports whether the action kind is recognized.
func (a ActionRef) Validate() error {
	if !ValidActionKinds[a.Kind] {
		return errInvalid("action kind %q is not one of start_workflow|integration|notification|dr_runbook|http_call", a.Kind)
	}
	return nil
}

// =============================================================================
// Automation (the trigger→rules→runbook binding)
// =============================================================================

// Automation is the top-level configurable unit: a named, tenant-scoped binding
// of a trigger to rules and a runbook. Disabled automations never fire.
type Automation struct {
	ID        string        `json:"id"`
	TenantID  string        `json:"tenant_id"`
	Name      string        `json:"name"`
	Enabled   bool          `json:"enabled"`
	Trigger   TriggerConfig `json:"trigger"`
	Rules     []Rule        `json:"rules,omitempty"`
	RunbookID string        `json:"runbook_id"`
	CreatedBy string        `json:"created_by,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// =============================================================================
// Runbook (the ordered step list, §4.5)
// =============================================================================

// Runbook step type constants.
const (
	StepTypeAction       = "action"        // execute an ActionRef
	StepTypeApprovalGate = "approval_gate" // park the run for human decision
)

// ValidStepTypes is the closed set of runbook step types.
var ValidStepTypes = map[string]bool{
	StepTypeAction:       true,
	StepTypeApprovalGate: true,
}

// Timeout actions for an approval gate that breaches its SLA (§4.5).
const (
	TimeoutActionAbort       = "abort"        // fail the run
	TimeoutActionEscalate    = "escalate"     // notify higher tier, keep waiting
	TimeoutActionAutoApprove = "auto_approve" // proceed as if approved (rarely used)
)

// ValidTimeoutActions is the closed set of gate timeout actions.
var ValidTimeoutActions = map[string]bool{
	TimeoutActionAbort:       true,
	TimeoutActionEscalate:    true,
	TimeoutActionAutoApprove: true,
}

// RunbookStep is one ordered step. An action step carries an ActionRef; an
// approval_gate step carries the approver policy (roles, quorum, timeout).
type RunbookStep struct {
	ID        string    `json:"id,omitempty"`
	RunbookID string    `json:"runbook_id,omitempty"`
	Index     int       `json:"index"` // 0-based position in the runbook
	Type      string    `json:"type"`  // one of StepType*
	Action    ActionRef `json:"action,omitempty"`

	// approval_gate fields
	ApproverRoles  []string `json:"approver_roles,omitempty"`
	Quorum         int      `json:"quorum,omitempty"`          // approvals needed; 0 → 1
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"` // 0 → no timeout
	TimeoutAction  string   `json:"timeout_action,omitempty"`  // one of TimeoutAction*
}

// Runbook is the named, ordered, tenant-scoped list of steps an automation runs.
type Runbook struct {
	ID        string        `json:"id"`
	TenantID  string        `json:"tenant_id"`
	Name      string        `json:"name"`
	Steps     []RunbookStep `json:"steps,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// =============================================================================
// Run FSM (§6, FR-AUTOMATION-003/004) — durable, restart-safe, idempotent.
// =============================================================================

// Run status constants — the persisted FSM states (§6):
//
//	PENDING → RUNNING → (per step) RUNNING | AWAITING_APPROVAL → RUNNING → … → COMPLETED
//	                                          │ (timeout)
//	                                          ESCALATED → (policy) RUNNING | ABORTED
//	RUNNING → FAILED ; any non-terminal → CANCELLED
const (
	RunStatusPending          = "PENDING"           // created, not yet claimed
	RunStatusRunning          = "RUNNING"           // a step is (or is about to be) executing
	RunStatusAwaitingApproval = "AWAITING_APPROVAL" // parked on an approval gate
	RunStatusEscalated        = "ESCALATED"         // gate timed out, escalation in flight
	RunStatusCompleted        = "COMPLETED"         // all steps done
	RunStatusFailed           = "FAILED"            // an action failed past its retry policy
	RunStatusAborted          = "ABORTED"           // gate timeout policy aborted the run
	RunStatusCancelled        = "CANCELLED"         // operator-cancelled
)

// terminalRunStatuses are the states the driver never advances past.
var terminalRunStatuses = map[string]bool{
	RunStatusCompleted: true,
	RunStatusFailed:    true,
	RunStatusAborted:   true,
	RunStatusCancelled: true,
}

// runnableRunStatuses are the states the leader driver may claim and advance.
// AWAITING_APPROVAL and ESCALATED are deliberately EXCLUDED — an approval gate
// never auto-advances (§6); a human decision (or the timeout sweeper) moves it
// back to RUNNING before the driver will touch it again.
var runnableRunStatuses = map[string]bool{
	RunStatusPending: true,
	RunStatusRunning: true,
}

// Run is a single durable execution of an automation's runbook. The leader
// driver re-derives its state from this row on restart; CurrentStep is the index
// of the next step to execute.
type Run struct {
	ID            string         `json:"id"`
	TenantID      string         `json:"tenant_id"`
	AutomationID  string         `json:"automation_id"`
	RunbookID     string         `json:"runbook_id"`
	Status        string         `json:"status"`
	SourceEventID string         `json:"source_event_id"` // exactly-once backstop key
	ReplayOf      *string        `json:"replay_of,omitempty"`
	CurrentStep   int            `json:"current_step"`
	Trigger       map[string]any `json:"trigger,omitempty"` // recorded trigger payload (replay input)
	Variables     map[string]any `json:"variables,omitempty"`
	LastError     string         `json:"last_error,omitempty"`
	ClaimedAt     *time.Time     `json:"claimed_at,omitempty"` // driver lease
	StartedAt     time.Time      `json:"started_at"`
	CompletedAt   *time.Time     `json:"completed_at,omitempty"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// IsTerminal reports whether the run has reached a final state and the driver
// should ignore it.
func (r *Run) IsTerminal() bool { return terminalRunStatuses[r.Status] }

// IsRunnable reports whether the leader driver may claim and advance this run.
// Mirrors the partial-index predicate on automation_runs (§7): PENDING|RUNNING
// only — never AWAITING_APPROVAL/ESCALATED (the gate never auto-advances) and
// never a terminal state.
func (r *Run) IsRunnable() bool { return runnableRunStatuses[r.Status] }

// IsReplayable reports whether the run is in a state from which a replay may be
// initiated: only a terminal run can be replayed (a live run is still producing
// its log). A run whose log has a gap is marked non-replayable by the service
// layer (§4.7) and would fail this check via Status, not here.
func (r *Run) IsReplayable() bool {
	return r.Status == RunStatusCompleted || r.Status == RunStatusFailed || r.Status == RunStatusAborted
}

// =============================================================================
// RunStep (append-only execution log, §4.7)
// =============================================================================

// RunStep status constants — per-step outcome in the append-only log.
const (
	StepStatusRunning  = "RUNNING"
	StepStatusOK       = "OK"       // action succeeded
	StepStatusFailed   = "FAILED"   // action failed
	StepStatusAwaiting = "AWAITING" // approval gate opened, awaiting decision
	StepStatusApproved = "APPROVED" // gate quorum met
	StepStatusRejected = "REJECTED" // gate rejected
	StepStatusSkipped  = "SKIPPED"  // step skipped per policy
)

// RunStep is one append-only record of a step execution. The UNIQUE(run_id,
// step_index) constraint makes a crash-restart re-execution idempotent: the
// driver Ensures-not-Creates a step, so a re-claimed run never double-fires an
// action. InputJSON records the resolved config + trigger payload so a replay
// re-executes from recorded inputs (§4.7).
type RunStep struct {
	ID         string         `json:"id,omitempty"`
	RunID      string         `json:"run_id"`
	Index      int            `json:"index"` // step_index, matches RunbookStep.Index
	Action     ActionRef      `json:"action"`
	InputJSON  map[string]any `json:"input,omitempty"`
	OutputJSON map[string]any `json:"output,omitempty"`
	Status     string         `json:"status"`
	Attempt    int            `json:"attempt"`
	Error      string         `json:"error,omitempty"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at,omitempty"`
}

// =============================================================================
// ApprovalGate (§4.5 — the parked human-decision record)
// =============================================================================

// Approval gate status constants.
const (
	GateStatusOpen      = "OPEN"      // awaiting decisions
	GateStatusApproved  = "APPROVED"  // quorum of approvals reached
	GateStatusRejected  = "REJECTED"  // a rejection (or quorum impossible)
	GateStatusEscalated = "ESCALATED" // timed out, escalated
	GateStatusExpired   = "EXPIRED"   // timed out, aborted
)

// Decision records one approver's vote on a gate.
type Decision struct {
	UserID    string    `json:"user_id"`
	Approved  bool      `json:"approved"`
	Comment   string    `json:"comment,omitempty"`
	DecidedAt time.Time `json:"decided_at"`
}

// ApprovalGate is the durable record of a parked approval step. It mirrors the
// DR cutback gate: the run sits in AWAITING_APPROVAL and the driver's claim query
// excludes it until a human decision (or the timeout sweeper) resolves the gate
// and moves the run back to RUNNING.
type ApprovalGate struct {
	ID         string     `json:"id,omitempty"`
	RunID      string     `json:"run_id"`
	TenantID   string     `json:"tenant_id"`
	StepIndex  int        `json:"step_index"`
	Status     string     `json:"status"`
	Quorum     int        `json:"quorum"`
	Decisions  []Decision `json:"decisions,omitempty"`
	OpenedAt   time.Time  `json:"opened_at"`
	DeadlineAt *time.Time `json:"deadline_at,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
}

// Approvals counts the affirmative decisions recorded on the gate.
func (g *ApprovalGate) Approvals() int {
	n := 0
	for _, d := range g.Decisions {
		if d.Approved {
			n++
		}
	}
	return n
}

// QuorumMet reports whether the gate has gathered enough approvals to proceed.
// A Quorum of 0 is treated as 1 (a single approval suffices).
func (g *ApprovalGate) QuorumMet() bool {
	need := g.Quorum
	if need < 1 {
		need = 1
	}
	return g.Approvals() >= need
}

// HasRejection reports whether any approver has rejected the gate.
func (g *ApprovalGate) HasRejection() bool {
	for _, d := range g.Decisions {
		if !d.Approved {
			return true
		}
	}
	return false
}
