package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// defaultSessionListLimit bounds GET /ai/sessions (the chat rail).
const defaultSessionListLimit = 20

// maxSessionListLimit is the ceiling an explicit ?limit may request.
const maxSessionListLimit = 100

// maxHistoryTurns bounds how much of a session's transcript is replayed into
// the model. Older turns are dropped rather than compacted: a legal-portfolio
// question is answered from freshly-read tools each turn, so deep history adds
// tokens without adding grounding.
const maxHistoryTurns = 20

// sessionStore is the persistence surface the service needs (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type sessionStore interface {
	CreateSession(ctx context.Context, sess *Session) error
	GetSession(ctx context.Context, tenantID, userID, id uuid.UUID) (*Session, error)
	ListSessions(ctx context.Context, tenantID, userID uuid.UUID, limit int) ([]Session, error)
	ListMessages(ctx context.Context, tenantID, sessionID uuid.UUID) ([]Message, error)
	AppendTurn(ctx context.Context, turn TurnRecord) (uuid.UUID, error)
}

// Deps wires the assistant service.
type Deps struct {
	Completer     Completer
	Tools         *Tools
	Store         sessionStore
	Metrics       *Metrics
	Logger        zerolog.Logger
	Now           func() time.Time
	MaxIterations int
}

// Service drives assistant conversations: it runs the bounded tool-use loop
// over the grounding tools, persists every turn to the audit log, and returns
// the grounded answer. It has no write path into legal data.
type Service struct {
	completer     Completer
	tools         *Tools
	store         sessionStore
	metrics       *Metrics
	logger        zerolog.Logger
	now           func() time.Time
	maxIterations int
}

// NewService constructs the assistant service.
func NewService(d Deps) *Service {
	now := d.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	maxIter := d.MaxIterations
	if maxIter <= 0 {
		maxIter = defaultMaxIterations
	}
	return &Service{
		completer:     d.Completer,
		tools:         d.Tools,
		store:         d.Store,
		metrics:       d.Metrics,
		logger:        d.Logger.With().Str("service", "lex-ai").Logger(),
		now:           now,
		maxIterations: maxIter,
	}
}

// ChatInput is one caller turn.
type ChatInput struct {
	TenantID  uuid.UUID
	UserID    uuid.UUID
	SessionID *uuid.UUID // nil starts a new session
	Message   string
	// Grants is the caller's effective legal-domain read access, resolved by the
	// handler. The grounding tools mask their output with it.
	Grants Grants
}

// Chat runs one assistant turn: resolve or start the session, run the tool-use
// loop over the caller's permission-masked legal data, persist the whole turn,
// and return the grounded answer.
func (s *Service) Chat(ctx context.Context, in ChatInput) (*ChatResult, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" {
		return nil, ErrEmptyMessage
	}
	if len(message) > MaxMessageLength {
		return nil, fmt.Errorf("%w: %d (max %d)", ErrMessageTooLong, len(message), MaxMessageLength)
	}
	if s.completer == nil {
		return nil, ErrProviderUnavailable
	}
	if !in.Grants.Any() {
		// Answering here would mean answering from the model's own priors —
		// exactly what this surface must never do.
		return nil, ErrNoGroundingAccess
	}
	start := s.now()

	// Resolve the session BEFORE the model call so a bad session id fails fast,
	// but defer CREATING a new one until the turn actually succeeds — otherwise
	// a refused or failed turn leaves an empty conversation in the chat rail.
	session, history, err := s.resolveSession(ctx, in)
	if err != nil {
		return nil, err
	}

	loop := &loopState{messages: historyToChat(history, maxHistoryTurns)}
	loop.messages = append(loop.messages, ChatMessage{Role: RoleUser, Text: message})

	answer, iterations, err := s.runToolLoop(ctx, in, loop)
	if err != nil {
		return nil, err
	}
	latency := int(s.now().Sub(start).Milliseconds())

	if session == nil {
		session = &Session{
			TenantID: in.TenantID,
			UserID:   in.UserID,
			Title:    sessionTitle(message),
			Provider: s.completer.Provider(),
			Model:    s.completer.Model(),
		}
		if err := s.store.CreateSession(ctx, session); err != nil {
			return nil, err
		}
	}

	assistantID, err := s.store.AppendTurn(ctx, TurnRecord{
		Session:   session,
		Question:  message,
		ToolCalls: loop.toolAudit,
		Answer:    answer,
		LatencyMS: latency,
	})
	if err != nil {
		return nil, err
	}

	s.metrics.ObserveChat(s.completer.Provider(), latency, len(loop.toolAudit))

	return &ChatResult{
		SessionID:  session.ID,
		MessageID:  assistantID,
		Answer:     answer,
		ToolCalls:  loop.toolAudit,
		Provider:   s.completer.Provider(),
		Model:      s.completer.Model(),
		LatencyMS:  latency,
		Iterations: iterations,
	}, nil
}

// ListSessions returns the caller's recent conversations, newest first.
func (s *Service) ListSessions(ctx context.Context, tenantID, userID uuid.UUID, limit int) (*SessionList, error) {
	if limit <= 0 {
		limit = defaultSessionListLimit
	}
	if limit > maxSessionListLimit {
		limit = maxSessionListLimit
	}
	sessions, err := s.store.ListSessions(ctx, tenantID, userID, limit)
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = []Session{}
	}
	return &SessionList{Sessions: sessions}, nil
}

// GetSession returns the full transcript of one of the caller's own sessions.
func (s *Service) GetSession(ctx context.Context, tenantID, userID, sessionID uuid.UUID) (*SessionTranscript, error) {
	session, err := s.store.GetSession(ctx, tenantID, userID, sessionID)
	if err != nil {
		return nil, err
	}
	messages, err := s.store.ListMessages(ctx, tenantID, sessionID)
	if err != nil {
		return nil, err
	}
	if messages == nil {
		messages = []Message{}
	}
	return &SessionTranscript{Session: *session, Messages: messages}, nil
}

// ---------------------------------------------------------------------------
// Tool-use loop
// ---------------------------------------------------------------------------

type loopState struct {
	messages  []ChatMessage
	toolAudit []ToolCallRecord
}

// runToolLoop runs the bounded model<->tool loop. Returns the final answer and
// the number of model round-trips executed.
func (s *Service) runToolLoop(ctx context.Context, in ChatInput, loop *loopState) (string, int, error) {
	iterations := 0

	for i := 0; i < s.maxIterations; i++ {
		iterations++
		resp, err := s.completer.Complete(ctx, CompletionRequest{
			System:   systemPrompt,
			Messages: loop.messages,
			Tools:    toolSchemas(),
		})
		if err != nil {
			if errors.Is(err, ErrProviderUnavailable) {
				return "", iterations, ErrProviderUnavailable
			}
			return "", iterations, fmt.Errorf("lex ai: completion: %w", err)
		}
		// Check the stop reason BEFORE reading content: a refused turn carries an
		// empty or partial answer, and returning it would look like a real reply.
		if resp.Refused() {
			return "", iterations, ErrAnswerRefused
		}
		if len(resp.ToolCalls) == 0 {
			return strings.TrimSpace(resp.Text), iterations, nil
		}

		// Echo the assistant's tool-request turn back verbatim. The tool_result
		// blocks below are only valid if their tool_use blocks are present.
		loop.messages = append(loop.messages, ChatMessage{
			Role:     RoleAssistant,
			Text:     resp.Text,
			ToolUses: resp.ToolCalls,
		})

		results := make([]ToolResult, 0, len(resp.ToolCalls))
		for _, call := range resp.ToolCalls {
			payload, summary, ok := s.dispatchTool(ctx, in, call)
			loop.toolAudit = append(loop.toolAudit, ToolCallRecord{
				ID:            call.ID,
				Name:          call.Name,
				Arguments:     call.Arguments,
				Success:       ok,
				ResultSummary: summary,
			})
			results = append(results, ToolResult{ToolCallID: call.ID, Content: payload, IsError: !ok})
		}
		loop.messages = append(loop.messages, ChatMessage{Role: RoleUser, ToolResults: results})
	}

	// Hit the iteration cap without a final answer: ask for one tool-less
	// synthesis so the caller still gets a grounded response.
	resp, err := s.completer.Complete(ctx, CompletionRequest{
		System:   systemPrompt + finalSynthesisSuffix,
		Messages: loop.messages,
	})
	if err != nil {
		if errors.Is(err, ErrProviderUnavailable) {
			return "", iterations, ErrProviderUnavailable
		}
		return "", iterations, fmt.Errorf("lex ai: final synthesis: %w", err)
	}
	if resp.Refused() {
		return "", iterations + 1, ErrAnswerRefused
	}
	return strings.TrimSpace(resp.Text), iterations + 1, nil
}

// dispatchTool executes one grounding tool. It returns the JSON payload fed
// back to the model, a one-line audit summary, and success. A tool failure is
// NOT a request failure: the error text goes back to the model so it can tell
// the user what it could not see.
func (s *Service) dispatchTool(ctx context.Context, in ChatInput, call ToolCall) (payload, summary string, ok bool) {
	if s.tools == nil {
		return toolError(errors.New("grounding tools are unavailable")), "grounding unavailable", false
	}
	switch call.Name {
	case toolPortfolioSummary:
		result, err := s.tools.PortfolioSummary(ctx, in.TenantID, in.Grants)
		if err != nil {
			return toolError(err), "portfolio summary failed", false
		}
		return mustJSON(result),
			fmt.Sprintf("Portfolio: %d visible domain(s), %d masked", len(result.Domains), len(result.MaskedDomains)),
			true

	case toolDomainDetail:
		domain := argString(call.Arguments, "domain")
		result, err := s.tools.DomainDetail(ctx, in.TenantID, in.Grants, domain)
		if err != nil {
			return toolError(err), fmt.Sprintf("domain detail (%s) failed", domain), false
		}
		return mustJSON(result),
			fmt.Sprintf("Domain %s: %d total, %d resolved (%d%%)", result.Domain, result.Rate.Total, result.Rate.Resolved, result.Rate.ResolutionRatePct),
			true

	case toolTeamWorkload:
		result, err := s.tools.TeamWorkload(ctx, in.TenantID, in.UserID, in.Grants)
		if err != nil {
			return toolError(err), "team workload failed", false
		}
		return mustJSON(result),
			fmt.Sprintf("Team workload: %d member(s), degraded=%t", result.MemberCount, result.Degraded),
			true

	default:
		return toolError(fmt.Errorf("unknown tool %q", call.Name)), "unknown tool", false
	}
}

// ---------------------------------------------------------------------------
// Session + helpers
// ---------------------------------------------------------------------------

// resolveSession loads the caller's existing session and its transcript.
// Returns (nil, nil, nil) when the turn opens a new conversation — the session
// row is then created only once the turn has produced an answer.
func (s *Service) resolveSession(ctx context.Context, in ChatInput) (*Session, []Message, error) {
	if in.SessionID == nil || *in.SessionID == uuid.Nil {
		return nil, nil, nil
	}
	session, err := s.store.GetSession(ctx, in.TenantID, in.UserID, *in.SessionID)
	if err != nil {
		return nil, nil, err
	}
	history, err := s.store.ListMessages(ctx, in.TenantID, session.ID)
	if err != nil {
		return nil, nil, err
	}
	return session, history, nil
}

// historyToChat replays the last maxTurns user/assistant exchanges. Tool rows
// are not replayed: they are audit records whose data the following assistant
// answer already summarises, and re-sending them without their originating
// tool_use blocks would be rejected by the API.
func historyToChat(history []Message, maxTurns int) []ChatMessage {
	out := make([]ChatMessage, 0, len(history))
	for _, m := range history {
		switch m.Role {
		case RoleUser, RoleAssistant:
			if strings.TrimSpace(m.Content) == "" {
				continue
			}
			out = append(out, ChatMessage{Role: m.Role, Text: m.Content})
		}
	}
	if maxTurns > 0 && len(out) > maxTurns {
		out = out[len(out)-maxTurns:]
	}
	// The API requires the transcript to open on a user turn.
	for len(out) > 0 && out[0].Role != RoleUser {
		out = out[1:]
	}
	return out
}

func argString(args map[string]any, key string) string {
	if args == nil {
		return ""
	}
	if value, ok := args[key].(string); ok {
		return strings.TrimSpace(value)
	}
	if value, ok := args[key]; ok && value != nil {
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
	return ""
}

func mustJSON(v any) string {
	encoded, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	return string(encoded)
}

func toolError(err error) string {
	return fmt.Sprintf(`{"error":%q}`, err.Error())
}

// sessionTitle derives the chat-rail label from the opening question.
func sessionTitle(message string) string {
	value := strings.Join(strings.Fields(strings.TrimSpace(message)), " ")
	if value == "" {
		return "Legal assistant session"
	}
	runes := []rune(value)
	if len(runes) <= 80 {
		return value
	}
	trimmed := string(runes[:80])
	if idx := strings.LastIndex(trimmed, " "); idx > 20 {
		trimmed = trimmed[:idx]
	}
	return strings.TrimSpace(trimmed)
}
