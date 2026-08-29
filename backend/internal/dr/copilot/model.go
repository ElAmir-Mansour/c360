// Package copilot implements ClarioDR capability #5 — the AI Recovery Copilot.
//
// The copilot answers operator questions over REAL DR control-plane state and
// can PROPOSE recovery actions behind the existing approval gates. It never
// executes a failover and never auto-approves one: ProposeFailover returns a
// plan plus the exact API call the operator must make, leaving the gated
// failover FSM (internal/dr/failover) untouched.
//
// Architecture mirrors the vCISO chat engine (internal/cyber/vciso): the LLM
// provider manager (internal/cyber/vciso/llm/provider) drives a bounded
// tool-use loop; the tools defined here read real DR state through
// internal/dr/repository over a repository.DBTX. Every turn is persisted to
// dr_copilot_session / dr_copilot_message as a tamper-evident audit log.
package copilot

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	// ErrNotFound is returned when a session does not exist for the tenant.
	ErrNotFound = errors.New("copilot: not found")
	// ErrEmptyMessage is returned when the operator submits a blank question.
	ErrEmptyMessage = errors.New("copilot: message is required")
	// ErrMessageTooLong is returned when the question exceeds MaxMessageLength.
	ErrMessageTooLong = errors.New("copilot: message exceeds maximum length")
	// ErrProviderUnavailable is returned when no LLM provider can be resolved.
	ErrProviderUnavailable = errors.New("copilot: llm provider unavailable")
)

// MaxMessageLength bounds a single operator question (mirrors vCISO).
const MaxMessageLength = 4000

// Message roles. tool rows carry one tool's JSON result; assistant rows carry
// the grounded answer plus the tools the model asked for that turn.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// Session is one copilot conversation (the dr_copilot_session row).
type Session struct {
	ID           string    `json:"id"`
	TenantID     string    `json:"tenant_id"`
	UserID       string    `json:"user_id"`
	Title        string    `json:"title"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	MessageCount int       `json:"message_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Message is one turn in a copilot conversation (the dr_copilot_message row).
type Message struct {
	ID         string `json:"id"`
	SessionID  string `json:"session_id"`
	TenantID   string `json:"tenant_id"`
	Seq        int    `json:"seq"`
	Role       string `json:"role"`
	Content    string `json:"content"`
	ToolName   string `json:"tool_name,omitempty"`
	ToolCallID string `json:"tool_call_id,omitempty"`
	// ToolCalls records, on assistant rows, the tools the model invoked that
	// turn (audit trail of which real DR state was read).
	ToolCalls []ToolCallRecord `json:"tool_calls,omitempty"`
	// ProposedAction is non-nil only when the assistant proposed a gated action
	// the operator must approve (e.g. a failover plan + its approval API call).
	ProposedAction *ProposedAction `json:"proposed_action,omitempty"`
	LatencyMS      int             `json:"latency_ms"`
	CreatedAt      time.Time       `json:"created_at"`
}

// ToolCallRecord is the audited record of a single tool invocation.
type ToolCallRecord struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Arguments     map[string]any `json:"arguments,omitempty"`
	Success       bool           `json:"success"`
	ResultSummary string         `json:"result_summary"`
	LatencyMS     int            `json:"latency_ms"`
}

// ProposedAction is a recovery action the copilot recommends but will NOT
// execute. The operator performs APICall to act on it; the action stays behind
// the existing approval gates (a failover plan still parks at AWAITING_APPROVAL
// and requires the human /approve call).
type ProposedAction struct {
	// Kind identifies the action class, e.g. "failover".
	Kind string `json:"kind"`
	// Summary is a one-line human description of what the action does.
	Summary string `json:"summary"`
	// RequiresApproval is always true for gated actions — the copilot can never
	// auto-approve, so the operator must explicitly perform the approval step.
	RequiresApproval bool `json:"requires_approval"`
	// APICall is the exact request the operator must issue to initiate the
	// action (it creates a run that PARKS at AWAITING_APPROVAL).
	APICall APICall `json:"api_call"`
	// ApprovalCall is the follow-up call that releases the approval gate. It is
	// shown for transparency; the copilot does not and cannot issue it.
	ApprovalCall *APICall `json:"approval_call,omitempty"`
	// Plan carries the structured recovery plan (boot order, recovery point,
	// blast radius) so the operator can review impact before approving.
	Plan map[string]any `json:"plan,omitempty"`
	// Warnings surfaces blocking or cautionary findings (e.g. no validated
	// recovery point available, streams degraded).
	Warnings []string `json:"warnings,omitempty"`
}

// APICall is a concrete HTTP request the operator can copy and execute.
type APICall struct {
	Method string         `json:"method"`
	Path   string         `json:"path"`
	Body   map[string]any `json:"body,omitempty"`
}

// ChatResult is the response returned from one POST /copilot/chat turn.
type ChatResult struct {
	SessionID      string           `json:"session_id"`
	MessageID      string           `json:"message_id"`
	Answer         string           `json:"answer"`
	ToolCalls      []ToolCallRecord `json:"tool_calls,omitempty"`
	ProposedAction *ProposedAction  `json:"proposed_action,omitempty"`
	Provider       string           `json:"provider"`
	Model          string           `json:"model"`
	LatencyMS      int              `json:"latency_ms"`
	Iterations     int              `json:"iterations"`
}

// SessionTranscript is the full audit view returned from
// GET /copilot/sessions/{id}.
type SessionTranscript struct {
	Session  Session   `json:"session"`
	Messages []Message `json:"messages"`
}
