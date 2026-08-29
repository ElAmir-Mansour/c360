package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// anthropicVersion is the required API version header for /v1/messages.
const anthropicVersion = "2023-06-01"

// serverSideFallbackBeta opts the request into server-side refusal fallbacks.
// Claude Opus 5 ships elevated safety classifiers that can decline a request
// with stop_reason "refusal"; with fallbacks:"default" the API re-runs the same
// request on Anthropic's recommended substitute model inside the same call
// instead of handing us an empty answer. See client.buildPayload.
const serverSideFallbackBeta = "server-side-fallback-2026-07-01"

// stopReasonRefusal is returned (with HTTP 200) when safety classifiers decline
// the request. Callers must check the stop reason BEFORE reading content:
// on a refusal the content array is empty or partial.
const stopReasonRefusal = "refusal"

// Completer is the LLM seam the service depends on. *AnthropicClient satisfies
// it in production; tests inject a scripted fake to drive the tool-use loop
// deterministically without a network call.
type Completer interface {
	Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
	Provider() string
	Model() string
}

// CompletionRequest is one model call.
type CompletionRequest struct {
	System   string
	Messages []ChatMessage
	// Tools is the grounding-tool surface offered this call. The final synthesis
	// call passes none, which forces a text answer.
	Tools []ToolSchema
}

// ChatMessage is one Anthropic turn. Text, ToolUses and ToolResults become
// content blocks in that order. An assistant turn that requested tools MUST be
// echoed back with its ToolUses intact — the API rejects a tool_result whose
// tool_use_id has no matching tool_use in the transcript.
type ChatMessage struct {
	Role        string
	Text        string
	ToolUses    []ToolCall
	ToolResults []ToolResult
}

// ToolCall is one tool_use block emitted by the model.
type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

// ToolResult is one tool_result block fed back to the model.
type ToolResult struct {
	ToolCallID string
	Content    string
	IsError    bool
}

// ToolSchema advertises one grounding tool to the model.
type ToolSchema struct {
	Name        string
	Description string
	InputSchema map[string]any
}

// CompletionResponse is the model's reply to one call.
type CompletionResponse struct {
	Text         string
	ToolCalls    []ToolCall
	StopReason   string
	InputTokens  int
	OutputTokens int
}

// Refused reports whether the safety classifiers declined this request.
func (r *CompletionResponse) Refused() bool {
	return r != nil && r.StopReason == stopReasonRefusal
}

// AnthropicClient calls the Anthropic Messages API directly. It is deliberately
// self-contained rather than routed through the vCISO provider manager: that
// manager's request builder still sends `temperature` for models it does not
// recognise, which Claude Opus 5 rejects with a 400.
type AnthropicClient struct {
	cfg  Config
	http *http.Client
}

// NewAnthropicClient constructs the Messages API client. Defaults are applied,
// so a zero-value Config yields a usable (if unkeyed) client.
func NewAnthropicClient(cfg Config) *AnthropicClient {
	cfg = cfg.withDefaults()
	return &AnthropicClient{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}
}

func (c *AnthropicClient) Provider() string { return "anthropic" }
func (c *AnthropicClient) Model() string    { return c.cfg.Model }

// Complete performs one non-streaming /v1/messages call.
func (c *AnthropicClient) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
	if strings.TrimSpace(c.cfg.APIKey) == "" {
		return nil, fmt.Errorf("%w: anthropic api key is not configured", ErrProviderUnavailable)
	}
	body, err := json.Marshal(c.buildPayload(req))
	if err != nil {
		return nil, fmt.Errorf("lex ai: encoding completion request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("lex ai: building completion request: %w", err)
	}
	httpReq.Header.Set("x-api-key", c.cfg.APIKey)
	httpReq.Header.Set("anthropic-version", anthropicVersion)
	httpReq.Header.Set("anthropic-beta", serverSideFallbackBeta)
	httpReq.Header.Set("content-type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("lex ai: anthropic request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("lex ai: reading anthropic response: %w", err)
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("%w: anthropic rejected the api key (%d)", ErrProviderUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("lex ai: anthropic completion failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return decodeCompletion(raw)
}

func (c *AnthropicClient) endpoint() string {
	base := strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/")
	if base == "" {
		base = "https://api.anthropic.com"
	}
	return base + "/v1/messages"
}

// buildPayload assembles the /v1/messages body.
//
// Deliberately absent: temperature / top_p / top_k (removed on this model
// generation — sending any returns 400) and any `thinking` override (thinking
// is on by default; disabling it is the documented cause of tool calls being
// emitted as prose). Depth is controlled through output_config.effort.
func (c *AnthropicClient) buildPayload(req CompletionRequest) map[string]any {
	payload := map[string]any{
		"model":         c.cfg.Model,
		"max_tokens":    c.cfg.MaxTokens,
		"messages":      buildMessages(req.Messages),
		"output_config": map[string]any{"effort": c.cfg.Effort},
		"fallbacks":     "default",
	}
	if system := strings.TrimSpace(req.System); system != "" {
		payload["system"] = system
	}
	if len(req.Tools) > 0 {
		payload["tools"] = buildTools(req.Tools)
	}
	return payload
}

func buildMessages(items []ChatMessage) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		blocks := make([]map[string]any, 0, 1+len(item.ToolUses)+len(item.ToolResults))
		if strings.TrimSpace(item.Text) != "" {
			blocks = append(blocks, map[string]any{"type": "text", "text": item.Text})
		}
		for _, call := range item.ToolUses {
			input := call.Arguments
			if input == nil {
				input = map[string]any{}
			}
			blocks = append(blocks, map[string]any{
				"type":  "tool_use",
				"id":    call.ID,
				"name":  call.Name,
				"input": input,
			})
		}
		for _, result := range item.ToolResults {
			block := map[string]any{
				"type":        "tool_result",
				"tool_use_id": result.ToolCallID,
				"content":     result.Content,
			}
			if result.IsError {
				block["is_error"] = true
			}
			blocks = append(blocks, block)
		}
		if len(blocks) == 0 {
			continue // an empty turn is rejected by the API; drop it
		}
		out = append(out, map[string]any{
			"role":    normalizeRole(item.Role),
			"content": blocks,
		})
	}
	return out
}

func buildTools(items []ToolSchema) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		schema := item.InputSchema
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out = append(out, map[string]any{
			"name":         item.Name,
			"description":  item.Description,
			"input_schema": schema,
		})
	}
	return out
}

// normalizeRole maps our transcript roles onto the two the API accepts. Tool
// results ride on a user turn, which is where the API expects them.
func normalizeRole(role string) string {
	if role == RoleAssistant {
		return RoleAssistant
	}
	return RoleUser
}

func decodeCompletion(raw []byte) (*CompletionResponse, error) {
	var decoded struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type  string         `json:"type"`
			Text  string         `json:"text,omitempty"`
			ID    string         `json:"id,omitempty"`
			Name  string         `json:"name,omitempty"`
			Input map[string]any `json:"input,omitempty"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("lex ai: decoding anthropic response: %w", err)
	}
	out := &CompletionResponse{
		StopReason:   decoded.StopReason,
		InputTokens:  decoded.Usage.InputTokens,
		OutputTokens: decoded.Usage.OutputTokens,
	}
	texts := make([]string, 0, len(decoded.Content))
	for _, block := range decoded.Content {
		switch block.Type {
		case "text":
			if strings.TrimSpace(block.Text) != "" {
				texts = append(texts, block.Text)
			}
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, ToolCall{
				ID:        block.ID,
				Name:      block.Name,
				Arguments: block.Input,
			})
		}
		// thinking / fallback blocks carry no answer text and are ignored here;
		// they are never persisted to the transcript.
	}
	out.Text = strings.TrimSpace(strings.Join(texts, "\n"))
	return out, nil
}
