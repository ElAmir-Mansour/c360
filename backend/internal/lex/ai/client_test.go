package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// captureAnthropic stands in for api.anthropic.com and records the request the
// client actually sent, so the wire format is asserted rather than assumed.
type captureAnthropic struct {
	server  *httptest.Server
	payload map[string]any
	headers http.Header
	status  int
	body    string
}

func newCaptureAnthropic(t *testing.T, status int, body string) *captureAnthropic {
	t.Helper()
	c := &captureAnthropic{status: status, body: body}
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.headers = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &c.payload)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(c.status)
		_, _ = io.WriteString(w, c.body)
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *captureAnthropic) client() *AnthropicClient {
	return NewAnthropicClient(Config{APIKey: "test-key", BaseURL: c.server.URL})
}

// The request body must match what THIS model generation accepts. The three
// negative assertions are the load-bearing ones: temperature/top_p/top_k were
// removed (400 if sent) and an explicit `thinking` override is the documented
// cause of tool calls being emitted as prose instead of tool_use blocks.
func TestAnthropicClientRequestShape(t *testing.T) {
	srv := newCaptureAnthropic(t, http.StatusOK, `{"stop_reason":"end_turn","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":10,"output_tokens":3}}`)

	if _, err := srv.client().Complete(context.Background(), CompletionRequest{
		System:   "system prompt",
		Messages: []ChatMessage{{Role: RoleUser, Text: "hello"}},
		Tools:    toolSchemas(),
	}); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	if got := srv.payload["model"]; got != DefaultModel {
		t.Errorf("model = %v, want %s", got, DefaultModel)
	}
	for _, banned := range []string{"temperature", "top_p", "top_k", "thinking"} {
		if _, present := srv.payload[banned]; present {
			t.Errorf("payload carries %q, which this model generation rejects or mis-handles", banned)
		}
	}
	outputConfig, ok := srv.payload["output_config"].(map[string]any)
	if !ok || outputConfig["effort"] != defaultEffort {
		t.Errorf("output_config = %v, want effort %q", srv.payload["output_config"], defaultEffort)
	}
	if srv.payload["max_tokens"] != float64(defaultMaxTokens) {
		t.Errorf("max_tokens = %v, want %d", srv.payload["max_tokens"], defaultMaxTokens)
	}
	if srv.payload["fallbacks"] != "default" {
		t.Errorf("fallbacks = %v, want \"default\"", srv.payload["fallbacks"])
	}
	if srv.payload["system"] != "system prompt" {
		t.Errorf("system = %v", srv.payload["system"])
	}
	if tools, _ := srv.payload["tools"].([]any); len(tools) != 3 {
		t.Errorf("tools = %d, want 3", len(tools))
	}

	if got := srv.headers.Get("x-api-key"); got != "test-key" {
		t.Errorf("x-api-key = %q", got)
	}
	if got := srv.headers.Get("anthropic-version"); got != anthropicVersion {
		t.Errorf("anthropic-version = %q, want %q", got, anthropicVersion)
	}
	if got := srv.headers.Get("anthropic-beta"); got != serverSideFallbackBeta {
		t.Errorf("anthropic-beta = %q, want %q (required by fallbacks:\"default\")", got, serverSideFallbackBeta)
	}
}

// A tool round-trip must serialise as tool_use blocks on the assistant turn and
// tool_result blocks on the following user turn. The API rejects a tool_result
// whose tool_use_id has no matching tool_use, so this shape is load-bearing.
func TestAnthropicClientSerialisesToolBlocks(t *testing.T) {
	srv := newCaptureAnthropic(t, http.StatusOK, `{"stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}`)

	_, err := srv.client().Complete(context.Background(), CompletionRequest{
		Messages: []ChatMessage{
			{Role: RoleUser, Text: "how many contracts?"},
			{Role: RoleAssistant, Text: "checking", ToolUses: []ToolCall{{ID: "toolu_1", Name: toolPortfolioSummary, Arguments: map[string]any{}}}},
			{Role: RoleUser, ToolResults: []ToolResult{{ToolCallID: "toolu_1", Content: `{"domains":[]}`}}},
			{Role: RoleUser, ToolResults: []ToolResult{{ToolCallID: "toolu_2", Content: `{"error":"nope"}`, IsError: true}}},
			{Role: RoleAssistant}, // fully empty turn: must be dropped, the API rejects it
		},
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}

	messages, _ := srv.payload["messages"].([]any)
	if len(messages) != 4 {
		t.Fatalf("messages = %d, want 4 (the empty turn must be dropped)", len(messages))
	}

	assistant := messages[1].(map[string]any)
	if assistant["role"] != "assistant" {
		t.Errorf("assistant role = %v", assistant["role"])
	}
	blocks := assistant["content"].([]any)
	if len(blocks) != 2 || blocks[0].(map[string]any)["type"] != "text" {
		t.Fatalf("assistant blocks = %v, want [text, tool_use]", blocks)
	}
	toolUse := blocks[1].(map[string]any)
	if toolUse["type"] != "tool_use" || toolUse["id"] != "toolu_1" || toolUse["name"] != toolPortfolioSummary {
		t.Errorf("tool_use block = %v", toolUse)
	}

	toolResult := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if toolResult["type"] != "tool_result" || toolResult["tool_use_id"] != "toolu_1" {
		t.Errorf("tool_result block = %v", toolResult)
	}
	if _, present := toolResult["is_error"]; present {
		t.Error("a successful tool_result must not carry is_error")
	}
	errorResult := messages[3].(map[string]any)["content"].([]any)[0].(map[string]any)
	if errorResult["is_error"] != true {
		t.Errorf("failed tool_result = %v, want is_error true", errorResult)
	}
}

// Text blocks join, tool_use blocks become ToolCalls, and thinking blocks (which
// carry no answer) are ignored rather than leaking into the transcript.
func TestAnthropicClientDecodesResponse(t *testing.T) {
	body := `{"stop_reason":"tool_use","content":[
		{"type":"thinking","thinking":""},
		{"type":"text","text":"Let me look."},
		{"type":"tool_use","id":"toolu_9","name":"domain_detail","input":{"domain":"contracts"}},
		{"type":"text","text":"  "}
	],"usage":{"input_tokens":120,"output_tokens":45}}`
	srv := newCaptureAnthropic(t, http.StatusOK, body)

	got, err := srv.client().Complete(context.Background(), CompletionRequest{Messages: []ChatMessage{{Role: RoleUser, Text: "q"}}})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if got.Text != "Let me look." {
		t.Errorf("Text = %q, want %q", got.Text, "Let me look.")
	}
	if len(got.ToolCalls) != 1 || got.ToolCalls[0].ID != "toolu_9" || got.ToolCalls[0].Arguments["domain"] != "contracts" {
		t.Errorf("ToolCalls = %+v", got.ToolCalls)
	}
	if got.StopReason != "tool_use" || got.Refused() {
		t.Errorf("StopReason = %q, Refused = %v", got.StopReason, got.Refused())
	}
	if got.InputTokens != 120 || got.OutputTokens != 45 {
		t.Errorf("usage = %d/%d, want 120/45", got.InputTokens, got.OutputTokens)
	}
}

func TestAnthropicClientDetectsRefusal(t *testing.T) {
	srv := newCaptureAnthropic(t, http.StatusOK, `{"stop_reason":"refusal","content":[]}`)

	got, err := srv.client().Complete(context.Background(), CompletionRequest{Messages: []ChatMessage{{Role: RoleUser, Text: "q"}}})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if !got.Refused() {
		t.Errorf("Refused() = false for stop_reason %q, want true", got.StopReason)
	}
}

func TestAnthropicClientErrorHandling(t *testing.T) {
	t.Run("missing api key degrades to provider-unavailable", func(t *testing.T) {
		client := NewAnthropicClient(Config{})
		_, err := client.Complete(context.Background(), CompletionRequest{Messages: []ChatMessage{{Role: RoleUser, Text: "q"}}})
		if !errors.Is(err, ErrProviderUnavailable) {
			t.Fatalf("Complete with no key = %v, want ErrProviderUnavailable", err)
		}
	})

	t.Run("rejected key degrades to provider-unavailable", func(t *testing.T) {
		srv := newCaptureAnthropic(t, http.StatusUnauthorized, `{"error":{"message":"invalid api key"}}`)
		_, err := srv.client().Complete(context.Background(), CompletionRequest{Messages: []ChatMessage{{Role: RoleUser, Text: "q"}}})
		if !errors.Is(err, ErrProviderUnavailable) {
			t.Fatalf("Complete with a rejected key = %v, want ErrProviderUnavailable", err)
		}
	})

	t.Run("other api errors surface verbatim", func(t *testing.T) {
		srv := newCaptureAnthropic(t, http.StatusBadRequest, `{"error":{"message":"temperature is deprecated"}}`)
		_, err := srv.client().Complete(context.Background(), CompletionRequest{Messages: []ChatMessage{{Role: RoleUser, Text: "q"}}})
		if err == nil || errors.Is(err, ErrProviderUnavailable) {
			t.Fatalf("Complete on a 400 = %v, want a plain error", err)
		}
		if !strings.Contains(err.Error(), "temperature is deprecated") {
			t.Errorf("error = %v, want it to carry the upstream message", err)
		}
	})
}

func TestAnthropicClientIdentity(t *testing.T) {
	client := NewAnthropicClient(Config{Model: "claude-sonnet-5"})
	if client.Provider() != "anthropic" {
		t.Errorf("Provider() = %q", client.Provider())
	}
	if client.Model() != "claude-sonnet-5" {
		t.Errorf("Model() = %q, want the configured override", client.Model())
	}
	if NewAnthropicClient(Config{}).Model() != DefaultModel {
		t.Errorf("unconfigured Model() = %q, want %s", NewAnthropicClient(Config{}).Model(), DefaultModel)
	}
}

// *AnthropicClient must satisfy the seam the service depends on.
var _ Completer = (*AnthropicClient)(nil)
