// Package ai implements the Watheeq (Lex) legal AI assistant — the backend for
// the Legal Director dashboard's "My AI Agent" panel (LEX-LD-GAP-DESIGN §G4).
//
// It is modelled on the ClarioDR Recovery Copilot (internal/dr/copilot): a
// bounded LLM tool-use loop answers operator questions from a TYPED grounding
// summary rather than from raw tables. The tools in tools.go read the same
// tenant-scoped dashboard/reporting services the REST surface already exposes,
// masked by the caller's own read grants, so the assistant can never widen what
// its caller could read through the ordinary API. Every turn is persisted to
// lex_ai_sessions / lex_ai_messages (tenant + user scoped, RLS on) as an audit
// trail.
//
// The whole surface is feature-flagged OFF by default (LEX_AI_ENABLED); when
// disabled the routes are not mounted at all.
package ai

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	// ErrNotFound is returned when a session does not exist for the tenant+user.
	ErrNotFound = errors.New("lex ai: not found")
	// ErrEmptyMessage is returned when the caller submits a blank question.
	ErrEmptyMessage = errors.New("lex ai: message is required")
	// ErrMessageTooLong is returned when the question exceeds MaxMessageLength.
	ErrMessageTooLong = errors.New("lex ai: message exceeds maximum length")
	// ErrProviderUnavailable is returned when no LLM provider is configured.
	ErrProviderUnavailable = errors.New("lex ai: llm provider unavailable")
	// ErrAnswerRefused is returned when the model's safety classifiers decline
	// the request (stop_reason "refusal"). It is a content outcome, not a
	// transport failure, so it is surfaced distinctly rather than as a 500.
	ErrAnswerRefused = errors.New("lex ai: the assistant declined to answer this request")
	// ErrNoGroundingAccess is returned when the caller holds lex:ai:use but can
	// read no legal domain. There is nothing to ground on, and answering anyway
	// would mean answering from the model's own priors.
	ErrNoGroundingAccess = errors.New("lex ai: the caller can read no legal domain to ground an answer on")
)

// MaxMessageLength bounds a single question (mirrors dr/copilot).
const MaxMessageLength = 4000

// Message roles. tool rows carry one tool's JSON result; assistant rows carry
// the grounded answer plus the tools the model asked for that turn.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// Session is one assistant conversation (the lex_ai_sessions row). Sessions are
// keyed by (tenant_id, user_id): a legal director never sees another user's
// transcript, in their tenant or any other.
type Session struct {
	ID           uuid.UUID `json:"id"`
	TenantID     uuid.UUID `json:"tenant_id"`
	UserID       uuid.UUID `json:"user_id"`
	Title        string    `json:"title"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	MessageCount int       `json:"message_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Message is one turn in a conversation (the lex_ai_messages row).
type Message struct {
	ID         uuid.UUID `json:"id"`
	SessionID  uuid.UUID `json:"session_id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	UserID     uuid.UUID `json:"user_id"`
	Seq        int       `json:"seq"`
	Role       string    `json:"role"`
	Content    string    `json:"content"`
	ToolName   string    `json:"tool_name,omitempty"`
	ToolCallID string    `json:"tool_call_id,omitempty"`
	// ToolCalls records, on assistant rows, the grounding tools the model
	// invoked that turn — the audit trail of which real legal data was read.
	ToolCalls []ToolCallRecord `json:"tool_calls,omitempty"`
	LatencyMS int              `json:"latency_ms"`
	CreatedAt time.Time        `json:"created_at"`
}

// ToolCallRecord is the audited record of a single grounding-tool invocation.
type ToolCallRecord struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Arguments     map[string]any `json:"arguments,omitempty"`
	Success       bool           `json:"success"`
	ResultSummary string         `json:"result_summary"`
}

// ChatResult is the response returned from one POST /ai/chat turn.
type ChatResult struct {
	SessionID uuid.UUID        `json:"session_id"`
	MessageID uuid.UUID        `json:"message_id"`
	Answer    string           `json:"answer"`
	ToolCalls []ToolCallRecord `json:"tool_calls,omitempty"`
	Provider  string           `json:"provider"`
	Model     string           `json:"model"`
	LatencyMS int              `json:"latency_ms"`
	// Iterations counts the model round-trips this turn consumed (1 = answered
	// without reading any grounding tool).
	Iterations int `json:"iterations"`
}

// SessionList is the caller's recent conversations, newest first — the chat
// rail of the "My AI Agent" panel.
type SessionList struct {
	Sessions []Session `json:"sessions"`
}

// SessionTranscript is the full audit view returned from
// GET /ai/sessions/{id}.
type SessionTranscript struct {
	Session  Session   `json:"session"`
	Messages []Message `json:"messages"`
}

// Grants is the caller's effective legal-domain read access, resolved once per
// request in the handler from the same permission keys the REST surface uses.
// The grounding tools mask their output with it, so holding lex:ai:use can
// never surface data the caller could not already read directly.
type Grants struct {
	Contracts     bool `json:"contracts"`
	Cases         bool `json:"cases"`
	Consultations bool `json:"consultations"`
	Requests      bool `json:"requests"`
	Workforce     bool `json:"workforce"`
}

// Any reports whether the caller can read at least one legal domain. A caller
// with lex:ai:use and nothing else has no grounding data at all, so the service
// rejects the turn rather than letting the model answer from its own priors.
func (g Grants) Any() bool {
	return g.Contracts || g.Cases || g.Consultations || g.Requests || g.Workforce
}
