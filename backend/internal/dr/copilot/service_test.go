package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	"github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// ---------------------------------------------------------------------------
// Fake LLM provider — drives the tool loop deterministically with a scripted
// sequence of completion responses. It records exactly what tools were
// requested and the messages it saw, so a test can assert the loop fed real
// tool results back to the model.
// ---------------------------------------------------------------------------

type scriptedProvider struct {
	steps    []provider.CompletionResponse
	calls    int
	lastReq  *provider.CompletionRequest
	requests []*provider.CompletionRequest
}

func (p *scriptedProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	p.lastReq = req
	p.requests = append(p.requests, req)
	if len(req.Tools) == 0 {
		p.calls++
		return &provider.CompletionResponse{Content: "done", FinishReason: "stop"}, nil
	}
	if p.calls >= len(p.steps) {
		// Default: a tool-less final answer so the loop always terminates.
		p.calls++
		return &provider.CompletionResponse{Content: "done", FinishReason: "stop"}, nil
	}
	resp := p.steps[p.calls]
	p.calls++
	return &resp, nil
}

func (p *scriptedProvider) Name() string                    { return "fake" }
func (p *scriptedProvider) Model() string                   { return "fake-model" }
func (p *scriptedProvider) SupportsParallelToolCalls() bool { return true }
func (p *scriptedProvider) MaxContextTokens() int           { return 100000 }
func (p *scriptedProvider) EstimateCost(_, _ int) float64   { return 0 }
func (p *scriptedProvider) HealthCheck(_ context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Provider: "fake", Status: "healthy"}, nil
}

type fakeProviderResolver struct {
	prov provider.LLMProvider
	err  error
}

func (f fakeProviderResolver) Resolve(_ context.Context, _ uuid.UUID) (provider.LLMProvider, error) {
	return f.prov, f.err
}

// ---------------------------------------------------------------------------
// In-memory session store + tenant runner.
// ---------------------------------------------------------------------------

type memStore struct {
	mu       sync.Mutex
	sessions map[string]*Session
	messages map[string][]Message // sessionID -> ordered messages
	seqCtr   int
}

func newMemStore() *memStore {
	return &memStore{sessions: map[string]*Session{}, messages: map[string][]Message{}}
}

func (m *memStore) CreateSession(_ context.Context, _ repository.DBTX, s *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	s.CreatedAt, s.UpdatedAt = now, now
	cp := *s
	m.sessions[s.ID] = &cp
	return nil
}

func (m *memStore) GetSession(_ context.Context, _ repository.DBTX, tenantID, id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok || s.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *s
	return &cp, nil
}

func (m *memStore) AppendMessage(_ context.Context, _ repository.DBTX, msg *Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Enforce the monotonic seq invariant the real UNIQUE(session_id, seq) does.
	for _, existing := range m.messages[msg.SessionID] {
		if existing.Seq == msg.Seq {
			return errors.New("duplicate seq")
		}
	}
	if msg.ID == "" {
		msg.ID = uuid.NewString()
	}
	msg.CreatedAt = time.Now().UTC()
	cp := *msg
	m.messages[msg.SessionID] = append(m.messages[msg.SessionID], cp)
	return nil
}

func (m *memStore) TouchSession(_ context.Context, _ repository.DBTX, tenantID, id string, messageCount int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok || s.TenantID != tenantID {
		return ErrNotFound
	}
	s.MessageCount = messageCount
	s.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *memStore) ListMessages(_ context.Context, _ repository.DBTX, tenantID, sessionID string) ([]Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Message, len(m.messages[sessionID]))
	copy(out, m.messages[sessionID])
	return out, nil
}

// memRunner runs read/write funcs directly with a nil DBTX (the mem store and
// fake reader ignore it). It satisfies both copilot.TenantRunner and the tools'
// readRunner.
type memRunner struct{}

func (memRunner) RunWithTenant(_ context.Context, _ string, fn func(repository.DBTX) error) error {
	return fn(nil)
}
func (memRunner) RunReadWithTenant(_ context.Context, _ string, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func toolCall(id, name string, args map[string]any) llmmodel.LLMToolCall {
	return llmmodel.LLMToolCall{ID: id, FunctionName: name, Arguments: args}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func newServiceFixture(t *testing.T, d *fakeData, steps []provider.CompletionResponse) (*Service, *scriptedProvider, *memStore) {
	t.Helper()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	runner := memRunner{}
	tools := NewTools(fakeReader{d: d}, runner, func() time.Time { return now })
	store := newMemStore()
	prov := &scriptedProvider{steps: steps}
	svc := NewService(Deps{
		Providers: fakeProviderResolver{prov: prov},
		Tools:     tools,
		Store:     store,
		Runner:    runner,
		Logger:    zerolog.Nop(),
		Now:       func() time.Time { return now },
	})
	return svc, prov, store
}

func TestChat_RunsToolLoopOverRealStateAndPersistsAudit(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addGroup("grp-1", "Core", map[string]int{"site-a": 1})
	applied := time.Date(2026, 6, 13, 11, 59, 0, 0, time.UTC)
	d.addStream("str-a", "site-a", model.StreamStatusStreaming, &applied)

	// Step 1: the model asks for dr_state_summary. Step 2: it answers.
	steps := []provider.CompletionResponse{
		{ToolCalls: []llmmodel.LLMToolCall{toolCall("c1", toolDRStateSummary, nil)}, FinishReason: "tool_use"},
		{Content: "You have 1 site and 1 group; replication is healthy.", FinishReason: "stop"},
	}
	svc, prov, store := newServiceFixture(t, d, steps)

	tenant := uuid.MustParse(d.tenantID)
	res, err := svc.Chat(context.Background(), ChatInput{TenantID: tenant, UserID: uuid.New(), Message: "How is DR doing?"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Answer == "" || !strings.Contains(res.Answer, "1 site") {
		t.Fatalf("unexpected answer: %q", res.Answer)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].Name != toolDRStateSummary || !res.ToolCalls[0].Success {
		t.Fatalf("expected 1 successful dr_state_summary tool call, got %+v", res.ToolCalls)
	}
	if res.Provider != "fake" || res.Model != "fake-model" {
		t.Fatalf("provider/model not propagated: %+v", res)
	}

	// The loop must have fed the REAL tool result back to the model on the second
	// call. Inspect the second request's messages for a tool message containing
	// real data (site_count:1).
	if len(prov.requests) < 2 {
		t.Fatalf("expected at least 2 LLM calls, got %d", len(prov.requests))
	}
	secondReq := prov.requests[1]
	var sawRealToolResult bool
	for _, m := range secondReq.Messages {
		if m.Role == RoleTool && strings.Contains(m.Content, `"site_count":1`) {
			sawRealToolResult = true
		}
	}
	if !sawRealToolResult {
		t.Fatalf("the loop did not feed the real tool result back to the model: %+v", secondReq.Messages)
	}

	// Audit log: user + tool + assistant rows persisted, session touched.
	msgs, _ := store.ListMessages(context.Background(), nil, d.tenantID, res.SessionID)
	if len(msgs) != 3 {
		t.Fatalf("expected 3 persisted messages (user/tool/assistant), got %d: %+v", len(msgs), msgs)
	}
	if msgs[0].Role != RoleUser || msgs[1].Role != RoleTool || msgs[2].Role != RoleAssistant {
		t.Fatalf("audit roles/order wrong: %v %v %v", msgs[0].Role, msgs[1].Role, msgs[2].Role)
	}
	if msgs[0].Seq != 0 || msgs[1].Seq != 1 || msgs[2].Seq != 2 {
		t.Fatalf("audit seq wrong: %d %d %d", msgs[0].Seq, msgs[1].Seq, msgs[2].Seq)
	}
	if len(msgs[2].ToolCalls) != 1 {
		t.Fatalf("assistant row should record the tool call audit, got %+v", msgs[2].ToolCalls)
	}
}

func TestChat_ProposeFailoverDoesNotExecuteAndIsAudited(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addGroup("grp-1", "Core", map[string]int{"site-a": 1})
	applied := time.Date(2026, 6, 13, 11, 59, 30, 0, time.UTC)
	d.addStream("str-a", "site-a", model.StreamStatusStreaming, &applied)
	d.addPoint("grp-1", "rp-1", ptrFloat(0.9999), true, time.Date(2026, 6, 13, 11, 50, 0, 0, time.UTC), 20)

	steps := []provider.CompletionResponse{
		{ToolCalls: []llmmodel.LLMToolCall{toolCall("c1", toolProposeFailover, map[string]any{"group_id": "grp-1"})}, FinishReason: "tool_use"},
		{Content: "I have prepared a failover PLAN. It requires your explicit approval before anything executes.", FinishReason: "stop"},
	}
	svc, _, store := newServiceFixture(t, d, steps)

	tenant := uuid.MustParse(d.tenantID)
	res, err := svc.Chat(context.Background(), ChatInput{TenantID: tenant, UserID: uuid.New(), Message: "Fail over Core."})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	// A proposed action surfaced, requiring approval and NOT executed.
	if res.ProposedAction == nil {
		t.Fatal("expected a proposed action")
	}
	if !res.ProposedAction.RequiresApproval || res.ProposedAction.Kind != "failover" {
		t.Fatalf("proposed action must require approval: %+v", res.ProposedAction)
	}
	if res.ProposedAction.APICall.Path != "/api/v1/dr/failover-runs" {
		t.Fatalf("must return the initiate API call, not execute: %+v", res.ProposedAction.APICall)
	}
	// The fake reader exposes NO mutation method, so by construction no run was
	// created. Assert the surfaced plan is real (chosen recovery point present).
	if got := res.ProposedAction.APICall.Body["recovery_point_id"]; got != "rp-1" {
		t.Fatalf("plan should reference the validated recovery point rp-1, got %v", got)
	}

	// The proposed action is persisted on the assistant audit row.
	msgs, _ := store.ListMessages(context.Background(), nil, d.tenantID, res.SessionID)
	var assistant *Message
	for i := range msgs {
		if msgs[i].Role == RoleAssistant {
			assistant = &msgs[i]
		}
	}
	if assistant == nil || assistant.ProposedAction == nil {
		t.Fatalf("assistant audit row must carry the proposed action: %+v", assistant)
	}
	// Round-trip the proposed action through JSON to ensure it serialises (the
	// store marshals it to JSONB in production).
	if _, err := json.Marshal(assistant.ProposedAction); err != nil {
		t.Fatalf("proposed action not serialisable: %v", err)
	}
}

func TestChat_ContinuesExistingSessionWithMonotonicSeq(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)

	steps := []provider.CompletionResponse{
		{Content: "first answer", FinishReason: "stop"},
		{Content: "second answer", FinishReason: "stop"},
	}
	svc, _, store := newServiceFixture(t, d, steps)
	tenant := uuid.MustParse(d.tenantID)
	user := uuid.New()

	first, err := svc.Chat(context.Background(), ChatInput{TenantID: tenant, UserID: user, Message: "Q1"})
	if err != nil {
		t.Fatalf("first chat: %v", err)
	}
	sid := uuid.MustParse(first.SessionID)
	second, err := svc.Chat(context.Background(), ChatInput{TenantID: tenant, UserID: user, SessionID: &sid, Message: "Q2"})
	if err != nil {
		t.Fatalf("second chat: %v", err)
	}
	if second.SessionID != first.SessionID {
		t.Fatalf("expected same session, got %s vs %s", second.SessionID, first.SessionID)
	}
	msgs, _ := store.ListMessages(context.Background(), nil, d.tenantID, first.SessionID)
	// Two turns, no tool calls => 4 messages (user/assistant x2) with seq 0..3.
	if len(msgs) != 4 {
		t.Fatalf("expected 4 messages across 2 turns, got %d", len(msgs))
	}
	for i, m := range msgs {
		if m.Seq != i {
			t.Fatalf("seq not monotonic: msg %d has seq %d", i, m.Seq)
		}
	}
}

func TestChat_RejectsEmptyMessage(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	svc, _, _ := newServiceFixture(t, d, nil)
	_, err := svc.Chat(context.Background(), ChatInput{TenantID: uuid.MustParse(d.tenantID), UserID: uuid.New(), Message: "   "})
	if !errors.Is(err, ErrEmptyMessage) {
		t.Fatalf("expected ErrEmptyMessage, got %v", err)
	}
}

func TestChat_ProviderUnavailable(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	now := time.Now().UTC()
	runner := memRunner{}
	svc := NewService(Deps{
		Providers: fakeProviderResolver{err: errors.New("no key")},
		Tools:     NewTools(fakeReader{d: d}, runner, func() time.Time { return now }),
		Store:     newMemStore(),
		Runner:    runner,
		Logger:    zerolog.Nop(),
		Now:       func() time.Time { return now },
	})
	_, err := svc.Chat(context.Background(), ChatInput{TenantID: uuid.MustParse(d.tenantID), UserID: uuid.New(), Message: "hi"})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("expected ErrProviderUnavailable, got %v", err)
	}
}

func TestGetSession_ReturnsTranscript(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	steps := []provider.CompletionResponse{{Content: "answer", FinishReason: "stop"}}
	svc, _, _ := newServiceFixture(t, d, steps)
	tenant := uuid.MustParse(d.tenantID)
	res, err := svc.Chat(context.Background(), ChatInput{TenantID: tenant, UserID: uuid.New(), Message: "hello"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	tr, err := svc.GetSession(context.Background(), tenant, uuid.MustParse(res.SessionID))
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if tr.Session.ID != res.SessionID || len(tr.Messages) != 2 {
		t.Fatalf("transcript wrong: session=%s messages=%d", tr.Session.ID, len(tr.Messages))
	}
}

func TestGetSession_UnknownReturnsNotFound(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	svc, _, _ := newServiceFixture(t, d, nil)
	_, err := svc.GetSession(context.Background(), uuid.MustParse(d.tenantID), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// The loop must terminate even if the model keeps requesting tools forever.
func TestChat_ToolLoopRespectsIterationCap(t *testing.T) {
	t.Parallel()
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)

	// Every scripted step requests a tool; the loop must hit the cap and force a
	// final tool-less synthesis.
	steps := make([]provider.CompletionResponse, 20)
	for i := range steps {
		steps[i] = provider.CompletionResponse{ToolCalls: []llmmodel.LLMToolCall{toolCall("c", toolDRStateSummary, nil)}, FinishReason: "tool_use"}
	}
	now := time.Now().UTC()
	runner := memRunner{}
	prov := &scriptedProvider{steps: steps}
	svc := NewService(Deps{
		Providers:     fakeProviderResolver{prov: prov},
		Tools:         NewTools(fakeReader{d: d}, runner, func() time.Time { return now }),
		Store:         newMemStore(),
		Runner:        runner,
		Logger:        zerolog.Nop(),
		Now:           func() time.Time { return now },
		MaxIterations: 3,
	})
	res, err := svc.Chat(context.Background(), ChatInput{TenantID: uuid.MustParse(d.tenantID), UserID: uuid.New(), Message: "loop forever"})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	// 3 loop iterations + 1 forced synthesis call.
	if res.Iterations != 4 {
		t.Fatalf("expected 4 iterations (cap 3 + synthesis), got %d", res.Iterations)
	}
	if res.Answer != "done" { // scriptedProvider default once steps exhausted
		t.Fatalf("expected forced synthesis answer, got %q", res.Answer)
	}
}
