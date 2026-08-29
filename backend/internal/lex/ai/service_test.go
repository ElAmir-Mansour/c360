package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// scriptedCompleter replays a fixed sequence of model replies so the tool-use
// loop is exercised deterministically, and records every request it received so
// tests can assert on the transcript the model would actually have seen.
type scriptedCompleter struct {
	replies  []*CompletionResponse
	err      error
	requests []CompletionRequest
}

func (c *scriptedCompleter) Complete(_ context.Context, req CompletionRequest) (*CompletionResponse, error) {
	c.requests = append(c.requests, req)
	if c.err != nil {
		return nil, c.err
	}
	if len(c.replies) == 0 {
		return &CompletionResponse{Text: "no more scripted replies", StopReason: "end_turn"}, nil
	}
	next := c.replies[0]
	c.replies = c.replies[1:]
	return next, nil
}

func (c *scriptedCompleter) Provider() string { return "anthropic" }
func (c *scriptedCompleter) Model() string    { return DefaultModel }

// memStore is an in-memory sessionStore that enforces the same (tenant, user)
// scoping the SQL store does, so a cross-user read fails in tests too.
type memStore struct {
	sessions map[uuid.UUID]*Session
	messages map[uuid.UUID][]Message
	turns    []TurnRecord
	failOn   string
}

func newMemStore() *memStore {
	return &memStore{sessions: map[uuid.UUID]*Session{}, messages: map[uuid.UUID][]Message{}}
}

func (s *memStore) CreateSession(_ context.Context, sess *Session) error {
	if s.failOn == "create" {
		return errors.New("create failed")
	}
	sess.ID = uuid.New()
	sess.CreatedAt = testNow
	sess.UpdatedAt = testNow
	stored := *sess
	s.sessions[sess.ID] = &stored
	return nil
}

func (s *memStore) GetSession(_ context.Context, tenantID, userID, id uuid.UUID) (*Session, error) {
	sess, ok := s.sessions[id]
	if !ok || sess.TenantID != tenantID || sess.UserID != userID {
		return nil, ErrNotFound
	}
	out := *sess
	return &out, nil
}

func (s *memStore) ListSessions(_ context.Context, tenantID, userID uuid.UUID, limit int) ([]Session, error) {
	out := make([]Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if sess.TenantID == tenantID && sess.UserID == userID {
			out = append(out, *sess)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *memStore) ListMessages(_ context.Context, tenantID, sessionID uuid.UUID) ([]Message, error) {
	sess, ok := s.sessions[sessionID]
	if !ok || sess.TenantID != tenantID {
		return nil, ErrNotFound
	}
	return s.messages[sessionID], nil
}

func (s *memStore) AppendTurn(_ context.Context, turn TurnRecord) (uuid.UUID, error) {
	if s.failOn == "append" {
		return uuid.Nil, errors.New("append failed")
	}
	s.turns = append(s.turns, turn)
	sess := turn.Session
	seq := sess.MessageCount
	s.messages[sess.ID] = append(s.messages[sess.ID], Message{SessionID: sess.ID, TenantID: sess.TenantID, UserID: sess.UserID, Seq: seq, Role: RoleUser, Content: turn.Question})
	seq++
	for _, record := range turn.ToolCalls {
		s.messages[sess.ID] = append(s.messages[sess.ID], Message{SessionID: sess.ID, TenantID: sess.TenantID, UserID: sess.UserID, Seq: seq, Role: RoleTool, Content: record.ResultSummary, ToolName: record.Name, ToolCallID: record.ID})
		seq++
	}
	assistantID := uuid.New()
	s.messages[sess.ID] = append(s.messages[sess.ID], Message{ID: assistantID, SessionID: sess.ID, TenantID: sess.TenantID, UserID: sess.UserID, Seq: seq, Role: RoleAssistant, Content: turn.Answer, ToolCalls: turn.ToolCalls})
	seq++
	sess.MessageCount = seq
	s.sessions[sess.ID].MessageCount = seq
	return assistantID, nil
}

type serviceHarness struct {
	svc       *Service
	store     *memStore
	completer *scriptedCompleter
	dashboard *fakeDashboard
	rates     *fakeRates
	workforce *fakeWorkforce
}

func newServiceHarness(t *testing.T, replies ...*CompletionResponse) *serviceHarness {
	t.Helper()
	h := &serviceHarness{
		store:     newMemStore(),
		completer: &scriptedCompleter{replies: replies},
		dashboard: &fakeDashboard{dashboard: sampleDashboard()},
		rates:     &fakeRates{report: sampleRates()},
		workforce: &fakeWorkforce{report: &model.WorkforceReport{Team: []model.TeamMember{{DisplayName: "Sara"}}}},
	}
	h.svc = NewService(Deps{
		Completer: h.completer,
		Tools:     NewTools(h.dashboard, h.rates, h.workforce, fixedNow),
		Store:     h.store,
		Logger:    zerolog.Nop(),
		Now:       fixedNow,
	})
	return h
}

func chatInput(message string) ChatInput {
	return ChatInput{TenantID: testTenantID, UserID: testUserID, Message: message, Grants: allGrants()}
}

// The happy path: the model asks for a grounding tool, the tool reads real
// data, the model answers, and the whole turn is persisted as one audit record.
func TestChatRunsGroundingLoopAndPersistsTurn(t *testing.T) {
	h := newServiceHarness(t,
		&CompletionResponse{StopReason: "tool_use", ToolCalls: []ToolCall{{ID: "toolu_1", Name: toolPortfolioSummary}}},
		&CompletionResponse{Text: "You have 45 active contracts and 33 open litigation cases.", StopReason: "end_turn"},
	)

	result, err := h.svc.Chat(context.Background(), chatInput("How is the portfolio doing?"))
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if result.Iterations != 2 {
		t.Errorf("Iterations = %d, want 2", result.Iterations)
	}
	if !strings.Contains(result.Answer, "45 active contracts") {
		t.Errorf("Answer = %q, want the model's grounded text", result.Answer)
	}
	if result.Model != DefaultModel || result.Provider != "anthropic" {
		t.Errorf("provider/model = %s/%s, want anthropic/%s", result.Provider, result.Model, DefaultModel)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != toolPortfolioSummary || !result.ToolCalls[0].Success {
		t.Fatalf("tool audit = %+v, want one successful %s call", result.ToolCalls, toolPortfolioSummary)
	}
	if h.rates.calls != 1 {
		t.Errorf("resolution rates read %d time(s), want 1", h.rates.calls)
	}

	if len(h.store.turns) != 1 {
		t.Fatalf("persisted turns = %d, want 1", len(h.store.turns))
	}
	turn := h.store.turns[0]
	if turn.Question != "How is the portfolio doing?" || turn.Answer != result.Answer {
		t.Errorf("persisted turn = %+v, want the question and the answer", turn)
	}
	if len(turn.ToolCalls) != 1 {
		t.Errorf("persisted tool rows = %d, want 1", len(turn.ToolCalls))
	}
}

// The assistant's tool-request turn must be echoed back with its tool_use
// blocks intact and the results returned on the following user turn. Dropping
// the tool_use blocks is a 400 from the Messages API, so this is a wire-format
// regression lock, not a style preference.
func TestChatEchoesToolUseBlocksBeforeToolResults(t *testing.T) {
	h := newServiceHarness(t,
		&CompletionResponse{Text: "Let me check.", StopReason: "tool_use", ToolCalls: []ToolCall{
			{ID: "toolu_1", Name: toolDomainDetail, Arguments: map[string]any{"domain": "contracts"}},
			{ID: "toolu_2", Name: toolTeamWorkload},
		}},
		&CompletionResponse{Text: "Done.", StopReason: "end_turn"},
	)

	if _, err := h.svc.Chat(context.Background(), chatInput("Who is overloaded?")); err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(h.completer.requests) != 2 {
		t.Fatalf("model calls = %d, want 2", len(h.completer.requests))
	}
	second := h.completer.requests[1].Messages
	if len(second) != 3 {
		t.Fatalf("second-call transcript = %d messages, want 3 (user, assistant+tool_use, user+tool_results)", len(second))
	}
	if second[1].Role != RoleAssistant || len(second[1].ToolUses) != 2 {
		t.Fatalf("assistant turn = %+v, want the two tool_use blocks echoed back", second[1])
	}
	if second[2].Role != RoleUser || len(second[2].ToolResults) != 2 {
		t.Fatalf("tool-result turn = %+v, want two tool_result blocks on a user turn", second[2])
	}
	for i, want := range []string{"toolu_1", "toolu_2"} {
		if second[1].ToolUses[i].ID != want {
			t.Errorf("tool_use[%d].ID = %q, want %q", i, second[1].ToolUses[i].ID, want)
		}
		if second[2].ToolResults[i].ToolCallID != want {
			t.Errorf("tool_result[%d].ToolCallID = %q, want %q", i, second[2].ToolResults[i].ToolCallID, want)
		}
	}
}

// A tool the caller is not permitted to run must come back as a tool ERROR the
// model can explain, not as a failed request — and the audit row must record
// the failure.
func TestChatSurfacesPermissionMaskedToolAsToolError(t *testing.T) {
	h := newServiceHarness(t,
		&CompletionResponse{StopReason: "tool_use", ToolCalls: []ToolCall{{ID: "toolu_1", Name: toolTeamWorkload}}},
		&CompletionResponse{Text: "I cannot see named workload for your account.", StopReason: "end_turn"},
	)
	in := chatInput("Who is overloaded?")
	in.Grants = Grants{Contracts: true, Cases: true} // no workforce grant

	result, err := h.svc.Chat(context.Background(), in)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Success {
		t.Fatalf("tool audit = %+v, want one FAILED tool row", result.ToolCalls)
	}
	toolResults := h.completer.requests[1].Messages[2].ToolResults
	if len(toolResults) != 1 || !toolResults[0].IsError {
		t.Fatalf("tool result = %+v, want is_error true", toolResults)
	}
	if !strings.Contains(toolResults[0].Content, "not permitted") {
		t.Errorf("tool result content = %q, want the not-permitted explanation", toolResults[0].Content)
	}
	if h.workforce.calls != 0 {
		t.Errorf("workforce service called %d time(s) without the grant, want 0", h.workforce.calls)
	}
}

// An unknown tool name must never reach a dispatcher default that silently
// succeeds; it is reported back to the model as an error.
func TestChatRejectsUnknownTool(t *testing.T) {
	h := newServiceHarness(t,
		&CompletionResponse{StopReason: "tool_use", ToolCalls: []ToolCall{{ID: "toolu_1", Name: "run_sql"}}},
		&CompletionResponse{Text: "Sorry.", StopReason: "end_turn"},
	)

	result, err := h.svc.Chat(context.Background(), chatInput("Select everything"))
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if result.ToolCalls[0].Success || result.ToolCalls[0].ResultSummary != "unknown tool" {
		t.Errorf("tool audit = %+v, want an unknown-tool failure", result.ToolCalls[0])
	}
}

// The loop is bounded. When the model keeps asking for tools, the service stops
// at MaxIterations and forces one tool-less synthesis so the caller still gets
// a grounded answer instead of an empty turn.
func TestChatBoundsToolLoopAndForcesSynthesis(t *testing.T) {
	replies := make([]*CompletionResponse, 0, 4)
	for i := 0; i < 3; i++ {
		replies = append(replies, &CompletionResponse{StopReason: "tool_use", ToolCalls: []ToolCall{{ID: "toolu", Name: toolPortfolioSummary}}})
	}
	replies = append(replies, &CompletionResponse{Text: "Final grounded answer.", StopReason: "end_turn"})

	h := newServiceHarness(t, replies...)
	h.svc.maxIterations = 3

	result, err := h.svc.Chat(context.Background(), chatInput("Keep digging"))
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if result.Answer != "Final grounded answer." {
		t.Errorf("Answer = %q, want the forced synthesis", result.Answer)
	}
	if result.Iterations != 4 {
		t.Errorf("Iterations = %d, want 4 (3 capped + 1 synthesis)", result.Iterations)
	}
	if len(h.completer.requests) != 4 {
		t.Fatalf("model calls = %d, want 4", len(h.completer.requests))
	}
	last := h.completer.requests[3]
	if len(last.Tools) != 0 {
		t.Errorf("synthesis call offered %d tool(s), want 0", len(last.Tools))
	}
	if !strings.Contains(last.System, "without calling more tools") {
		t.Error("synthesis call did not carry the tool-less system suffix")
	}
}

// Input bounds and grounding preconditions are checked before any model call,
// so a bad request never spends a token.
func TestChatRejectsBadInputBeforeCallingTheModel(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*ChatInput)
		wantErr error
	}{
		{name: "blank message", mutate: func(in *ChatInput) { in.Message = "   " }, wantErr: ErrEmptyMessage},
		{name: "oversized message", mutate: func(in *ChatInput) { in.Message = strings.Repeat("x", MaxMessageLength+1) }, wantErr: ErrMessageTooLong},
		{name: "no readable legal domain", mutate: func(in *ChatInput) { in.Grants = Grants{} }, wantErr: ErrNoGroundingAccess},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newServiceHarness(t, &CompletionResponse{Text: "should not be reached", StopReason: "end_turn"})
			in := chatInput("How are we doing?")
			tc.mutate(&in)

			_, err := h.svc.Chat(context.Background(), in)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("Chat = %v, want %v", err, tc.wantErr)
			}
			if len(h.completer.requests) != 0 {
				t.Errorf("model called %d time(s) on an invalid request, want 0", len(h.completer.requests))
			}
			if len(h.store.turns) != 0 {
				t.Errorf("persisted %d turn(s) on an invalid request, want 0", len(h.store.turns))
			}
		})
	}
}

// A refused turn (stop_reason "refusal") carries an empty or partial answer.
// It must be surfaced as its own error rather than returned as a real reply.
func TestChatSurfacesRefusalAndPersistsNothing(t *testing.T) {
	h := newServiceHarness(t, &CompletionResponse{Text: "", StopReason: "refusal"})

	_, err := h.svc.Chat(context.Background(), chatInput("Do something disallowed"))
	if !errors.Is(err, ErrAnswerRefused) {
		t.Fatalf("Chat on a refusal = %v, want ErrAnswerRefused", err)
	}
	if len(h.store.turns) != 0 {
		t.Errorf("persisted %d turn(s) after a refusal, want 0", len(h.store.turns))
	}
	// A failed turn must not leave an empty conversation in the chat rail.
	if len(h.store.sessions) != 0 {
		t.Errorf("created %d session(s) after a refusal, want 0", len(h.store.sessions))
	}
}

// A provider that is not configured must degrade to ErrProviderUnavailable so
// the handler answers 503 rather than 500.
func TestChatMapsProviderUnavailable(t *testing.T) {
	h := newServiceHarness(t)
	h.completer.err = ErrProviderUnavailable

	if _, err := h.svc.Chat(context.Background(), chatInput("Hello")); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("Chat = %v, want ErrProviderUnavailable", err)
	}

	h = newServiceHarness(t)
	h.svc.completer = nil
	if _, err := h.svc.Chat(context.Background(), chatInput("Hello")); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("Chat with no completer = %v, want ErrProviderUnavailable", err)
	}
}

// Continuing an existing session must load it under the caller's OWN id: a
// session belonging to another user is invisible, not merely unreadable.
func TestChatSessionIsScopedToTenantAndUser(t *testing.T) {
	h := newServiceHarness(t, &CompletionResponse{Text: "First answer.", StopReason: "end_turn"})
	first, err := h.svc.Chat(context.Background(), chatInput("Opening question"))
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	cases := []struct {
		name     string
		tenantID uuid.UUID
		userID   uuid.UUID
		wantErr  bool
	}{
		{name: "same tenant and user continues", tenantID: testTenantID, userID: testUserID},
		{name: "same tenant, different user is invisible", tenantID: testTenantID, userID: uuid.New(), wantErr: true},
		{name: "different tenant is invisible", tenantID: uuid.New(), userID: testUserID, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h.completer.replies = []*CompletionResponse{{Text: "Second answer.", StopReason: "end_turn"}}
			in := chatInput("Follow-up")
			in.TenantID, in.UserID, in.SessionID = tc.tenantID, tc.userID, &first.SessionID

			_, err := h.svc.Chat(context.Background(), in)
			if tc.wantErr {
				if !errors.Is(err, ErrNotFound) {
					t.Fatalf("Chat = %v, want ErrNotFound", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Chat: %v", err)
			}
		})
	}
}

// Prior turns are replayed as plain user/assistant text. Tool rows are audit
// records, not transcript: replaying them without their originating tool_use
// blocks would be rejected by the Messages API.
func TestHistoryToChatReplaysOnlyUserAndAssistantTurns(t *testing.T) {
	history := []Message{
		{Role: RoleUser, Content: "First question"},
		{Role: RoleTool, Content: "Portfolio: 4 visible domain(s)", ToolName: toolPortfolioSummary},
		{Role: RoleAssistant, Content: "First answer"},
		{Role: RoleAssistant, Content: "   "},
	}
	got := historyToChat(history, 20)

	if len(got) != 2 {
		t.Fatalf("replayed %d message(s), want 2: %+v", len(got), got)
	}
	if got[0].Role != RoleUser || got[1].Role != RoleAssistant {
		t.Errorf("replayed roles = %s,%s, want user,assistant", got[0].Role, got[1].Role)
	}
}

// The replayed transcript must open on a user turn (the API rejects anything
// else) and must be bounded so a long session cannot grow the prompt without
// limit.
func TestHistoryToChatBoundsAndOpensOnUserTurn(t *testing.T) {
	history := make([]Message, 0, 10)
	for i := 0; i < 5; i++ {
		history = append(history,
			Message{Role: RoleUser, Content: "q"},
			Message{Role: RoleAssistant, Content: "a"},
		)
	}
	got := historyToChat(history, 3)

	if len(got) > 3 {
		t.Fatalf("replayed %d message(s), want at most 3", len(got))
	}
	if len(got) == 0 || got[0].Role != RoleUser {
		t.Fatalf("replayed transcript = %+v, want it to open on a user turn", got)
	}
}

func TestListSessionsClampsLimit(t *testing.T) {
	h := newServiceHarness(t)
	for _, tc := range []struct{ in, want int }{{0, defaultSessionListLimit}, {-5, defaultSessionListLimit}, {7, 7}, {1000, maxSessionListLimit}} {
		limiting := &limitRecordingStore{memStore: h.store}
		h.svc.store = limiting
		if _, err := h.svc.ListSessions(context.Background(), testTenantID, testUserID, tc.in); err != nil {
			t.Fatalf("ListSessions(%d): %v", tc.in, err)
		}
		if limiting.limit != tc.want {
			t.Errorf("ListSessions(%d) used limit %d, want %d", tc.in, limiting.limit, tc.want)
		}
	}
}

type limitRecordingStore struct {
	*memStore
	limit int
}

func (s *limitRecordingStore) ListSessions(ctx context.Context, tenantID, userID uuid.UUID, limit int) ([]Session, error) {
	s.limit = limit
	return s.memStore.ListSessions(ctx, tenantID, userID, limit)
}

func TestGetSessionReturnsTranscript(t *testing.T) {
	h := newServiceHarness(t,
		&CompletionResponse{StopReason: "tool_use", ToolCalls: []ToolCall{{ID: "toolu_1", Name: toolPortfolioSummary}}},
		&CompletionResponse{Text: "Answer.", StopReason: "end_turn"},
	)
	result, err := h.svc.Chat(context.Background(), chatInput("Question"))
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	transcript, err := h.svc.GetSession(context.Background(), testTenantID, testUserID, result.SessionID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	wantRoles := []string{RoleUser, RoleTool, RoleAssistant}
	if len(transcript.Messages) != len(wantRoles) {
		t.Fatalf("transcript = %d message(s), want %d", len(transcript.Messages), len(wantRoles))
	}
	for i, want := range wantRoles {
		if transcript.Messages[i].Role != want {
			t.Errorf("message[%d].Role = %q, want %q", i, transcript.Messages[i].Role, want)
		}
	}
	if transcript.Session.ID != result.SessionID {
		t.Errorf("transcript session = %s, want %s", transcript.Session.ID, result.SessionID)
	}
}

// The session title is the chat-rail label. It must survive Arabic input, which
// is byte-wise longer than it is character-wise.
func TestSessionTitle(t *testing.T) {
	cases := []struct {
		name    string
		message string
		want    string
	}{
		{name: "blank falls back", message: "  ", want: "Legal assistant session"},
		{name: "whitespace collapses", message: "  How   are we   doing? ", want: "How are we doing?"},
		{name: "arabic is not truncated mid-character", message: strings.Repeat("ع", 40), want: strings.Repeat("ع", 40)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sessionTitle(tc.message); got != tc.want {
				t.Errorf("sessionTitle(%q) = %q, want %q", tc.message, got, tc.want)
			}
		})
	}
	long := sessionTitle(strings.Repeat("ن", 200))
	if runes := []rune(long); len(runes) > 80 {
		t.Errorf("long arabic title = %d runes, want at most 80", len(runes))
	}
	if !isValidUTF8(long) {
		t.Error("long arabic title was cut mid-rune")
	}
}

func isValidUTF8(s string) bool {
	return strings.ToValidUTF8(s, "�") == s
}

// The tool payload handed to the model must be the typed summary struct, not a
// raw row dump — this is the grounding contract.
func TestDispatchToolReturnsTypedSummaryJSON(t *testing.T) {
	h := newServiceHarness(t)

	payload, summary, ok := h.svc.dispatchTool(context.Background(), chatInput("q"), ToolCall{ID: "t", Name: toolPortfolioSummary})
	if !ok {
		t.Fatalf("dispatchTool failed: %s", payload)
	}
	var decoded PortfolioSummary
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("payload is not a PortfolioSummary: %v (%s)", err, payload)
	}
	if len(decoded.Domains) != 4 || decoded.Contracts == nil || decoded.Contracts.ActiveContracts != 45 {
		t.Errorf("decoded summary = %+v, want the four domains and contract KPIs", decoded)
	}
	if !strings.Contains(summary, "4 visible domain(s)") {
		t.Errorf("audit summary = %q, want the visible/masked counts", summary)
	}
}

func TestNewServiceDefaultsIterationsAndClock(t *testing.T) {
	svc := NewService(Deps{Completer: &scriptedCompleter{}, Store: newMemStore(), Logger: zerolog.Nop()})
	if svc.maxIterations != defaultMaxIterations {
		t.Errorf("maxIterations = %d, want %d", svc.maxIterations, defaultMaxIterations)
	}
	if svc.now == nil || svc.now().IsZero() {
		t.Error("now() must default to a real clock")
	}
	if time.Since(svc.now()) > time.Minute {
		t.Error("default clock is not current")
	}
}
