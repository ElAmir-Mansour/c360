package provider

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
)

type AnthropicProvider struct {
	model       string
	baseURL     string
	apiKey      string
	timeout     time.Duration
	temperature float64
	tempSet     bool
	maxTokens   int
	client      *http.Client
	// streamClient is used ONLY for StreamComplete. It forces HTTP/1.1 (Go's
	// HTTP/2 transport buffers the response into an internal pipe, coalescing the
	// SSE into bursts) with compression off, and carries NO client-level timeout
	// so a long stream isn't cut mid-flow — the per-request context deadline
	// governs it instead.
	streamClient *http.Client
}

func NewAnthropicProvider(cfg llmcfg.ProviderConfig) *AnthropicProvider {
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv(cfg.APIKeyEnv))
	}
	return &AnthropicProvider{
		model:       cfg.Model,
		baseURL:     baseURL,
		apiKey:      apiKey,
		timeout:     timeout,
		temperature: cfg.Temperature,
		tempSet:     cfg.TemperatureSet,
		maxTokens:   cfg.MaxTokens,
		client:      &http.Client{Timeout: timeout},
		streamClient: &http.Client{
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
				ForceAttemptHTTP2:     false,
				TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{}, // disable HTTP/2 handler
				TLSClientConfig:       &tls.Config{NextProtos: []string{"http/1.1"}},          // force ALPN to HTTP/1.1
				DisableCompression:    true,
				MaxIdleConns:          10,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
			},
		},
	}
}

func (p *AnthropicProvider) Name() string                    { return "anthropic" }
func (p *AnthropicProvider) Model() string                   { return p.model }
func (p *AnthropicProvider) SupportsParallelToolCalls() bool { return true }
func (p *AnthropicProvider) MaxContextTokens() int           { return 200000 }
func (p *AnthropicProvider) EstimateCost(promptTokens, completionTokens int) float64 {
	return float64(promptTokens)*0.000003 + float64(completionTokens)*0.000015
}

func (p *AnthropicProvider) HealthCheck(ctx context.Context) (*HealthStatus, error) {
	if p.apiKey == "" {
		return &HealthStatus{Provider: p.Name(), Model: p.Model(), Status: "unconfigured"}, nil
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := p.client.Do(req)
	if err != nil {
		return &HealthStatus{Provider: p.Name(), Model: p.Model(), Status: "unavailable"}, err
	}
	defer resp.Body.Close()
	status := "healthy"
	if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return &HealthStatus{Provider: p.Name(), Model: p.Model(), Status: status, LatencyMS: int(time.Since(start).Milliseconds())}, nil
}

// buildPayload assembles the shared /v1/messages request body used by both the
// buffered Complete and the streaming StreamComplete paths.
func (p *AnthropicProvider) buildPayload(request *CompletionRequest) map[string]any {
	model := completionModel(request, p.model)
	payload := map[string]any{
		"model":      model,
		"system":     request.SystemPrompt,
		"messages":   p.buildMessages(request.Messages),
		"max_tokens": fallbackInt(request.MaxTokens, p.maxTokens, 4096),
	}
	if anthropicAcceptsSamplingParams(model) {
		payload["temperature"] = fallbackTemperature(request, p.temperature, p.tempSet, 0.1)
	}
	if anthropicDisableThinking(model) {
		// These calls force a tool-schema output (structured drafting/extraction),
		// so extended reasoning adds latency without improving the result. The
		// newest models run adaptive thinking by default when `thinking` is
		// omitted; disable it explicitly for a fast, interactive response that
		// fits within the gateway's upstream timeout.
		payload["thinking"] = map[string]any{"type": "disabled"}
	}
	// Only include tools when the caller supplied them (a plain-text streaming
	// request has none). When the caller demands a structured tool response,
	// force that tool so we always get a tool call rather than prose.
	if len(request.Tools) > 0 {
		payload["tools"] = p.buildTools(request.Tools)
		if request.ResponseFormat == "tool" && len(request.Tools) == 1 {
			payload["tool_choice"] = map[string]any{"type": "tool", "name": request.Tools[0].Name}
		}
	}
	return payload
}

func (p *AnthropicProvider) Complete(ctx context.Context, request *CompletionRequest) (*CompletionResponse, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("%w: anthropic api key is not configured", ErrNotConfigured)
	}
	payload := p.buildPayload(request)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("anthropic completion failed: %s", strings.TrimSpace(string(respBody)))
	}
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
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		return nil, err
	}
	out := &CompletionResponse{
		FinishReason: decoded.StopReason,
		Usage: TokenUsage{
			PromptTokens:     decoded.Usage.InputTokens,
			CompletionTokens: decoded.Usage.OutputTokens,
			TotalTokens:      decoded.Usage.InputTokens + decoded.Usage.OutputTokens,
		},
	}
	textParts := make([]string, 0, len(decoded.Content))
	for _, item := range decoded.Content {
		switch item.Type {
		case "text":
			if strings.TrimSpace(item.Text) != "" {
				textParts = append(textParts, item.Text)
			}
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, llmmodel.LLMToolCall{
				ID:           item.ID,
				FunctionName: item.Name,
				Arguments:    item.Input,
			})
		}
	}
	out.Content = strings.TrimSpace(strings.Join(textParts, "\n"))
	return out, nil
}

// StreamComplete streams a /v1/messages completion (stream:true). Text deltas
// fire h.OnText; forced-tool-call input fragments fire h.OnToolInput. It
// accumulates every content block and returns the fully-assembled response
// (ToolCalls populated with the parsed tool input) when the SSE stream ends.
// AnthropicProvider satisfies StreamingProvider.
func (p *AnthropicProvider) StreamComplete(ctx context.Context, request *CompletionRequest, h StreamHandler) (*CompletionResponse, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("%w: anthropic api key is not configured", ErrNotConfigured)
	}
	payload := p.buildPayload(request)
	payload["stream"] = true
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "text/event-stream")
	// Force an uncompressed response. If we leave Accept-Encoding unset, Go's
	// transport auto-adds gzip and transparently decompresses via a gzip.Reader
	// that buffers whole DEFLATE blocks — which coalesces the SSE into a couple
	// of big bursts instead of a per-token flow. Requesting identity keeps the
	// event stream flowing token-by-token to the client.
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := p.streamClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		return nil, fmt.Errorf("anthropic stream failed: %s", strings.TrimSpace(string(b)))
	}

	type blockState struct {
		typ  string
		id   string
		name string
		text strings.Builder
		json strings.Builder
	}
	blocks := map[int]*blockState{}
	var stopReason string
	var inTok, outTok int

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue // skip `event:` lines and blank separators
		}
		data := strings.TrimSpace(line[len("data:"):])
		if data == "" {
			continue
		}
		var ev struct {
			Type         string `json:"type"`
			Index        int    `json:"index"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
				StopReason  string `json:"stop_reason"`
			} `json:"delta"`
			Message struct {
				Usage struct {
					InputTokens int `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if jerr := json.Unmarshal([]byte(data), &ev); jerr != nil {
			continue
		}
		switch ev.Type {
		case "message_start":
			inTok = ev.Message.Usage.InputTokens
		case "content_block_start":
			blocks[ev.Index] = &blockState{typ: ev.ContentBlock.Type, id: ev.ContentBlock.ID, name: ev.ContentBlock.Name}
		case "content_block_delta":
			b := blocks[ev.Index]
			if b == nil {
				b = &blockState{}
				blocks[ev.Index] = b
			}
			switch ev.Delta.Type {
			case "text_delta":
				b.text.WriteString(ev.Delta.Text)
				if h.OnText != nil && ev.Delta.Text != "" {
					if cbErr := h.OnText(ev.Delta.Text); cbErr != nil {
						return nil, cbErr
					}
				}
			case "input_json_delta":
				b.json.WriteString(ev.Delta.PartialJSON)
				if h.OnToolInput != nil && ev.Delta.PartialJSON != "" {
					if cbErr := h.OnToolInput(ev.Delta.PartialJSON); cbErr != nil {
						return nil, cbErr
					}
				}
			}
		case "message_delta":
			if ev.Delta.StopReason != "" {
				stopReason = ev.Delta.StopReason
			}
			if ev.Usage.OutputTokens > 0 {
				outTok = ev.Usage.OutputTokens
			}
		case "error":
			return nil, fmt.Errorf("anthropic stream error: %s", strings.TrimSpace(data))
		}
	}
	if serr := scanner.Err(); serr != nil {
		return nil, serr
	}

	out := &CompletionResponse{
		FinishReason: stopReason,
		Usage: TokenUsage{
			PromptTokens:     inTok,
			CompletionTokens: outTok,
			TotalTokens:      inTok + outTok,
		},
	}
	idx := make([]int, 0, len(blocks))
	for i := range blocks {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	textParts := make([]string, 0, len(idx))
	for _, i := range idx {
		b := blocks[i]
		switch b.typ {
		case "text":
			if strings.TrimSpace(b.text.String()) != "" {
				textParts = append(textParts, b.text.String())
			}
		case "tool_use":
			var input map[string]any
			if raw := strings.TrimSpace(b.json.String()); raw != "" {
				_ = json.Unmarshal([]byte(raw), &input)
			}
			if input == nil {
				input = map[string]any{}
			}
			out.ToolCalls = append(out.ToolCalls, llmmodel.LLMToolCall{
				ID:           b.id,
				FunctionName: b.name,
				Arguments:    input,
			})
		}
	}
	out.Content = strings.TrimSpace(strings.Join(textParts, "\n"))
	return out, nil
}

func (p *AnthropicProvider) buildMessages(items []llmmodel.LLMMessage) []map[string]any {
	messages := make([]map[string]any, 0, len(items))
	for _, item := range items {
		content := []map[string]any{{"type": "text", "text": item.Content}}
		if item.Role == "tool" {
			content = []map[string]any{{
				"type":        "tool_result",
				"tool_use_id": item.ToolCallID,
				"content":     item.Content,
			}}
		}
		messages = append(messages, map[string]any{
			"role":    normalizeAnthropicRole(item.Role),
			"content": content,
		})
	}
	return messages
}

func (p *AnthropicProvider) buildTools(items []llmmodel.ToolSchema) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"name":         item.Name,
			"description":  item.Description,
			"input_schema": item.Parameters,
		})
	}
	return out
}

func normalizeAnthropicRole(role string) string {
	switch role {
	case "assistant", "user":
		return role
	default:
		return "user"
	}
}

// anthropicAcceptsSamplingParams reports whether a model still accepts the
// temperature/top_p/top_k sampling params. The newest Claude generation removed
// them and returns HTTP 400 ("`temperature` is deprecated for this model") if any
// is sent: the Opus 4.7/4.8 family, Sonnet 5, and Fable 5 / Mythos 5. Older
// models (Opus 4.6, Sonnet 4.6, Haiku 4.5, and earlier) still accept them.
// Keep this list in sync as new sampling-less models ship.
func anthropicAcceptsSamplingParams(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	samplingRemoved := []string{
		"claude-opus-4-8",
		"claude-opus-4-7",
		"claude-sonnet-5",
		"claude-fable-5",
		"claude-mythos-5",
	}
	for _, p := range samplingRemoved {
		if strings.HasPrefix(m, p) {
			return false
		}
	}
	return true
}

// anthropicDisableThinking reports whether to send `thinking: {type:"disabled"}`
// for a model. The Opus 4.7/4.8 family and Sonnet 5 run adaptive thinking BY
// DEFAULT when `thinking` is omitted, adding many seconds of latency that these
// forced-tool-call requests don't need. They accept an explicit disable, so turn
// it off for speed. Fable 5 / Mythos 5 reject `{type:"disabled"}` (thinking is
// always on) and older models don't think by default, so both are left untouched.
func anthropicDisableThinking(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	adaptiveByDefault := []string{
		"claude-opus-4-8",
		"claude-opus-4-7",
		"claude-sonnet-5",
	}
	for _, p := range adaptiveByDefault {
		if strings.HasPrefix(m, p) {
			return true
		}
	}
	return false
}
