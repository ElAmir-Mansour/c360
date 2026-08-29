package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	"github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/dr/repository"
)

// Default bounds on the LLM tool-use loop. Each iteration is one model call; the
// loop ends when the model stops requesting tools or the cap is hit.
const (
	defaultMaxIterations = 6
	defaultMaxTokens     = 1500
	defaultTemperature   = 0.1
)

// ProviderResolver resolves an LLM provider for a tenant. *provider.Manager
// satisfies this; tests inject a fake to drive the tool loop deterministically.
type ProviderResolver interface {
	Resolve(ctx context.Context, tenantID uuid.UUID) (provider.LLMProvider, error)
}

// TenantRunner runs read/write functions against the tenant-scoped DB so RLS
// sees app.current_tenant_id. The copilot persists its audit log on the write
// path and reads DR state + transcripts on the read path.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error
}

// sessionStore is the persistence surface the service needs (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type sessionStore interface {
	CreateSession(ctx context.Context, db repository.DBTX, sess *Session) error
	GetSession(ctx context.Context, db repository.DBTX, tenantID, id string) (*Session, error)
	AppendMessage(ctx context.Context, db repository.DBTX, m *Message) error
	TouchSession(ctx context.Context, db repository.DBTX, tenantID, id string, messageCount int) error
	ListMessages(ctx context.Context, db repository.DBTX, tenantID, sessionID string) ([]Message, error)
}

// Deps wires the copilot service.
type Deps struct {
	Providers ProviderResolver
	Tools     *Tools
	Store     sessionStore
	Runner    TenantRunner
	Metrics   *Metrics
	Logger    zerolog.Logger
	Now       func() time.Time
	// MaxIterations bounds the tool-use loop (default defaultMaxIterations).
	MaxIterations int
}

// Service drives copilot conversations: it runs the bounded LLM tool-use loop
// over the real DR tools, persists every turn to the audit log, and returns the
// grounded answer plus any proposed (un-executed) action.
type Service struct {
	providers     ProviderResolver
	tools         *Tools
	store         sessionStore
	runner        TenantRunner
	metrics       *Metrics
	logger        zerolog.Logger
	now           func() time.Time
	maxIterations int
}

// NewService constructs the copilot service.
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
		providers:     d.Providers,
		tools:         d.Tools,
		store:         d.Store,
		runner:        d.Runner,
		metrics:       d.Metrics,
		logger:        d.Logger.With().Str("component", "dr_copilot").Logger(),
		now:           now,
		maxIterations: maxIter,
	}
}

// ChatInput is one operator turn.
type ChatInput struct {
	TenantID  uuid.UUID
	UserID    uuid.UUID
	SessionID *uuid.UUID // nil starts a new session
	Message   string
}

// Chat runs one copilot turn: resolve/start the session, run the LLM tool-use
// loop over real DR state, persist the full turn (question, tool calls, answer),
// and return the grounded answer. A proposed failover is returned as a plan; it
// is never executed.
func (s *Service) Chat(ctx context.Context, in ChatInput) (*ChatResult, error) {
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		return nil, ErrEmptyMessage
	}
	if len(msg) > MaxMessageLength {
		return nil, fmt.Errorf("%w: %d (max %d)", ErrMessageTooLong, len(msg), MaxMessageLength)
	}
	if s.providers == nil {
		return nil, ErrProviderUnavailable
	}
	start := s.now()

	prov, err := s.providers.Resolve(ctx, in.TenantID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
	}
	if prov == nil {
		return nil, ErrProviderUnavailable
	}

	tenant := in.TenantID.String()

	// Resolve or create the session and load prior transcript for context.
	session, history, err := s.loadOrCreateSession(ctx, tenant, in, prov)
	if err != nil {
		return nil, err
	}

	// Run the tool-use loop. This calls the LLM, dispatches the real DR tools it
	// requests, feeds results back, and repeats until the model answers.
	loop := &loopState{
		messages:  historyToLLM(history),
		toolAudit: nil,
	}
	loop.messages = append(loop.messages, llmmodel.LLMMessage{Role: RoleUser, Content: msg})

	answer, proposed, iterations, err := s.runToolLoop(ctx, prov, tenant, loop)
	if err != nil {
		return nil, err
	}

	latency := int(s.now().Sub(start).Milliseconds())

	// Persist the whole turn (user question, tool rows, assistant answer) in one
	// tenant-scoped transaction so the audit log is atomic.
	assistantID, err := s.persistTurn(ctx, tenant, session, msg, loop, answer, proposed, latency)
	if err != nil {
		return nil, err
	}

	s.metrics.ObserveChat(prov.Name(), latency, len(loop.toolAudit), proposed != nil)

	return &ChatResult{
		SessionID:      session.ID,
		MessageID:      assistantID,
		Answer:         answer,
		ToolCalls:      loop.toolAudit,
		ProposedAction: proposed,
		Provider:       prov.Name(),
		Model:          prov.Model(),
		LatencyMS:      latency,
		Iterations:     iterations,
	}, nil
}

// GetSession returns the full audit transcript of a session for the tenant.
func (s *Service) GetSession(ctx context.Context, tenantID uuid.UUID, sessionID uuid.UUID) (*SessionTranscript, error) {
	tenant := tenantID.String()
	id := sessionID.String()
	var out *SessionTranscript
	err := s.runner.RunReadWithTenant(ctx, tenant, func(db repository.DBTX) error {
		sess, gerr := s.store.GetSession(ctx, db, tenant, id)
		if gerr != nil {
			return gerr
		}
		msgs, merr := s.store.ListMessages(ctx, db, tenant, id)
		if merr != nil {
			return merr
		}
		out = &SessionTranscript{Session: *sess, Messages: msgs}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Tool-use loop
// ---------------------------------------------------------------------------

type loopState struct {
	messages  []llmmodel.LLMMessage
	toolAudit []ToolCallRecord
	// nextSeq is set during persistence; not used during the loop.
}

// runToolLoop runs the bounded model<->tool loop. Returns the final answer, any
// proposed action surfaced by a ProposeFailover tool call, and the number of
// model iterations executed.
func (s *Service) runToolLoop(ctx context.Context, prov provider.LLMProvider, tenant string, loop *loopState) (string, *ProposedAction, int, error) {
	var proposed *ProposedAction
	iterations := 0

	for i := 0; i < s.maxIterations; i++ {
		iterations++
		resp, err := prov.Complete(ctx, &provider.CompletionRequest{
			SystemPrompt: systemPrompt,
			Messages:     loop.messages,
			Tools:        toolSchemas(),
			MaxTokens:    defaultMaxTokens,
			Temperature:  defaultTemperature,
		})
		if err != nil {
			// A missing/misconfigured provider key is only detected at completion
			// time (not at Resolve), so it surfaces here. Reclassify it as an
			// unavailable provider so the handler returns a clean 503
			// "llm_unavailable" the UI renders as an intentional "copilot isn't
			// configured in this environment" state rather than a raw 500.
			if errors.Is(err, provider.ErrNotConfigured) {
				return "", nil, iterations, ErrProviderUnavailable
			}
			return "", nil, iterations, fmt.Errorf("copilot: llm completion: %w", err)
		}

		// No tool calls => final answer.
		if len(resp.ToolCalls) == 0 {
			return strings.TrimSpace(resp.Content), proposed, iterations, nil
		}

		// Record the assistant's tool-request turn so the next model call sees it.
		loop.messages = append(loop.messages, llmmodel.LLMMessage{
			Role:    RoleAssistant,
			Content: resp.Content,
		})

		for _, call := range resp.ToolCalls {
			result, action, summary, ok := s.dispatchTool(ctx, tenant, call)
			if action != nil {
				proposed = action
			}
			loop.toolAudit = append(loop.toolAudit, ToolCallRecord{
				ID:            call.ID,
				Name:          call.FunctionName,
				Arguments:     call.Arguments,
				Success:       ok,
				ResultSummary: summary,
			})
			loop.messages = append(loop.messages, llmmodel.LLMMessage{
				Role:       RoleTool,
				Content:    result,
				Name:       call.FunctionName,
				ToolCallID: call.ID,
			})
		}
	}

	// Hit the iteration cap without a final answer: ask for one final, tool-less
	// synthesis so the operator still gets a grounded response.
	resp, err := prov.Complete(ctx, &provider.CompletionRequest{
		SystemPrompt: systemPrompt + "\n\nYou have gathered enough data. Provide your final answer now without calling more tools.",
		Messages:     loop.messages,
		MaxTokens:    defaultMaxTokens,
		Temperature:  defaultTemperature,
	})
	if err != nil {
		return "", proposed, iterations, fmt.Errorf("copilot: llm final synthesis: %w", err)
	}
	return strings.TrimSpace(resp.Content), proposed, iterations + 1, nil
}

// dispatchTool executes one tool the LLM requested over real DR state. It
// returns the JSON result fed back to the model, any proposed action,
// a one-line audit summary, and success.
func (s *Service) dispatchTool(ctx context.Context, tenant string, call llmmodel.LLMToolCall) (result string, action *ProposedAction, summary string, ok bool) {
	args := call.Arguments
	switch call.FunctionName {
	case toolDRStateSummary:
		res, err := s.tools.DRStateSummary(ctx, tenant)
		if err != nil {
			return toolError(err), nil, "DR state summary failed", false
		}
		return mustJSON(res),
			nil,
			fmt.Sprintf("DR state: %d sites, %d groups, %d streams, %d RPO breach(es)", res.SiteCount, res.GroupCount, res.StreamCount, len(res.RPOBreaches)),
			true

	case toolBlastRadius:
		siteID := argString(args, "site_id")
		res, err := s.tools.BlastRadius(ctx, tenant, siteID)
		if err != nil {
			return toolError(err), nil, "blast radius failed", false
		}
		return mustJSON(res),
			nil,
			fmt.Sprintf("Blast radius of %s: %d impacted member(s) across %d group(s)", res.SiteName, res.TotalMemberCount, len(res.ImpactedGroups)),
			true

	case toolDrillSummary:
		runID := argString(args, "run_id")
		res, err := s.tools.DrillSummary(ctx, tenant, runID)
		if err != nil {
			return toolError(err), nil, "drill summary failed", false
		}
		return mustJSON(res),
			nil,
			fmt.Sprintf("Run %s: status=%s, %d step(s), attested=%t", res.Run.RunID, res.Run.Status, len(res.Steps), res.Attestation != nil),
			true

	case toolAttestationSummary:
		runID := argString(args, "run_id")
		res, err := s.tools.AttestationSummary(ctx, tenant, runID)
		if err != nil {
			return toolError(err), nil, "attestation summary failed", false
		}
		return mustJSON(res),
			nil,
			fmt.Sprintf("Attestation for run %s: RTO %ds/%ds, validation %.4f", res.RunID, res.RTOActual, res.RTOObjective, res.ValidationRatio),
			true

	case toolProposeFailover:
		groupID := argString(args, "group_id")
		res, err := s.tools.ProposeFailover(ctx, tenant, groupID)
		if err != nil {
			return toolError(err), nil, "propose failover failed", false
		}
		return mustJSON(res),
			res,
			fmt.Sprintf("Proposed failover plan for group %s (PROPOSAL ONLY, %d warning(s))", groupID, len(res.Warnings)),
			true

	default:
		return toolError(fmt.Errorf("unknown tool %q", call.FunctionName)), nil, "unknown tool", false
	}
}

// ---------------------------------------------------------------------------
// Session + persistence
// ---------------------------------------------------------------------------

func (s *Service) loadOrCreateSession(ctx context.Context, tenant string, in ChatInput, prov provider.LLMProvider) (*Session, []Message, error) {
	if in.SessionID != nil && *in.SessionID != uuid.Nil {
		id := in.SessionID.String()
		var sess *Session
		var history []Message
		err := s.runner.RunReadWithTenant(ctx, tenant, func(db repository.DBTX) error {
			loaded, gerr := s.store.GetSession(ctx, db, tenant, id)
			if gerr != nil {
				return gerr
			}
			sess = loaded
			msgs, merr := s.store.ListMessages(ctx, db, tenant, id)
			if merr != nil {
				return merr
			}
			history = msgs
			return nil
		})
		if err != nil {
			return nil, nil, err
		}
		return sess, history, nil
	}

	// New session.
	sess := &Session{
		TenantID: tenant,
		UserID:   in.UserID.String(),
		Title:    sessionTitle(in.Message),
		Provider: prov.Name(),
		Model:    prov.Model(),
	}
	err := s.runner.RunWithTenant(ctx, tenant, func(db repository.DBTX) error {
		return s.store.CreateSession(ctx, db, sess)
	})
	if err != nil {
		return nil, nil, err
	}
	return sess, nil, nil
}

// persistTurn writes the user question, every tool result, and the assistant
// answer to the audit log atomically, then updates the session counter. Returns
// the assistant message id.
func (s *Service) persistTurn(ctx context.Context, tenant string, session *Session, question string, loop *loopState, answer string, proposed *ProposedAction, latencyMS int) (string, error) {
	var assistantID string
	err := s.runner.RunWithTenant(ctx, tenant, func(db repository.DBTX) error {
		seq := session.MessageCount

		userMsg := &Message{
			SessionID: session.ID,
			TenantID:  tenant,
			Seq:       seq,
			Role:      RoleUser,
			Content:   question,
		}
		if aerr := s.store.AppendMessage(ctx, db, userMsg); aerr != nil {
			return aerr
		}
		seq++

		for _, rec := range loop.toolAudit {
			toolMsg := &Message{
				SessionID:  session.ID,
				TenantID:   tenant,
				Seq:        seq,
				Role:       RoleTool,
				Content:    rec.ResultSummary,
				ToolName:   rec.Name,
				ToolCallID: rec.ID,
			}
			if aerr := s.store.AppendMessage(ctx, db, toolMsg); aerr != nil {
				return aerr
			}
			seq++
		}

		assistantMsg := &Message{
			SessionID:      session.ID,
			TenantID:       tenant,
			Seq:            seq,
			Role:           RoleAssistant,
			Content:        answer,
			ToolCalls:      loop.toolAudit,
			ProposedAction: proposed,
			LatencyMS:      latencyMS,
		}
		if aerr := s.store.AppendMessage(ctx, db, assistantMsg); aerr != nil {
			return aerr
		}
		seq++
		assistantID = assistantMsg.ID

		return s.store.TouchSession(ctx, db, tenant, session.ID, seq)
	})
	if err != nil {
		return "", fmt.Errorf("copilot: persisting turn: %w", err)
	}
	session.MessageCount = -1 // invalidate; caller no longer relies on it
	return assistantID, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func historyToLLM(history []Message) []llmmodel.LLMMessage {
	out := make([]llmmodel.LLMMessage, 0, len(history))
	for _, m := range history {
		switch m.Role {
		case RoleUser:
			out = append(out, llmmodel.LLMMessage{Role: RoleUser, Content: m.Content})
		case RoleAssistant:
			if strings.TrimSpace(m.Content) != "" {
				out = append(out, llmmodel.LLMMessage{Role: RoleAssistant, Content: m.Content})
			}
		}
		// tool rows are not replayed; their data is summarised in the assistant
		// answer that follows, keeping the replayed context compact.
	}
	return out
}

func argString(args map[string]any, key string) string {
	if args == nil {
		return ""
	}
	if v, ok := args[key].(string); ok {
		return strings.TrimSpace(v)
	}
	if v, ok := args[key]; ok && v != nil {
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	return ""
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	return string(b)
}

func toolError(err error) string {
	return fmt.Sprintf(`{"error":%q}`, err.Error())
}

func sessionTitle(message string) string {
	value := strings.Join(strings.Fields(strings.TrimSpace(message)), " ")
	if value == "" {
		return "DR Copilot session"
	}
	if len(value) <= 80 {
		return value
	}
	trimmed := value[:80]
	if idx := strings.LastIndex(trimmed, " "); idx > 20 {
		trimmed = trimmed[:idx]
	}
	return strings.TrimSpace(trimmed)
}
