package provider

import (
	"context"
	"errors"
	"strings"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
)

// ErrNotConfigured signals that a provider cannot serve requests because it is
// missing required configuration (an API key, base URL, or an unknown provider
// name). It is a wrappable sentinel so callers can distinguish an intentionally
// unkeyed environment ("copilot isn't configured here") from a genuine runtime
// failure and degrade gracefully instead of surfacing a raw 500.
var ErrNotConfigured = errors.New("llm provider is not configured")

type LLMProvider interface {
	Complete(ctx context.Context, request *CompletionRequest) (*CompletionResponse, error)
	Name() string
	Model() string
	SupportsParallelToolCalls() bool
	MaxContextTokens() int
	EstimateCost(promptTokens, completionTokens int) float64
	HealthCheck(ctx context.Context) (*HealthStatus, error)
}

// StreamHandler receives incremental deltas from a StreamingProvider as the
// model generates. Either callback may be nil. Returning an error aborts the
// stream (surfaced from StreamComplete). Callbacks fire synchronously on the
// stream-reading goroutine, in order.
type StreamHandler struct {
	// OnText fires for assistant text deltas (non-tool responses).
	OnText func(delta string) error
	// OnToolInput fires with raw partial-JSON fragments of the (single) forced
	// tool call's input as they stream. The caller reassembles/extracts as needed.
	OnToolInput func(partialJSON string) error
}

// StreamingProvider is implemented by providers that can stream a completion.
// It is OPTIONAL: callers type-assert an LLMProvider to StreamingProvider and
// fall back to Complete when it is not implemented. StreamComplete streams
// deltas through h and returns the fully-assembled response (with ToolCalls
// populated) when the stream ends.
type StreamingProvider interface {
	StreamComplete(ctx context.Context, request *CompletionRequest, h StreamHandler) (*CompletionResponse, error)
}

type CompletionRequest struct {
	SystemPrompt string
	Messages     []llmmodel.LLMMessage
	Tools        []llmmodel.ToolSchema
	// Model optionally overrides the provider's configured default for this one
	// completion. It is intended for latency-sensitive interactive work that can
	// use a faster model without downgrading the provider default used by deeper
	// review and analysis calls. An empty value preserves existing behaviour.
	Model          string
	MaxTokens      int
	Temperature    float64
	TemperatureSet bool
	TopP           float64
	ResponseFormat string
}

func completionModel(request *CompletionRequest, fallback string) string {
	if request != nil {
		if model := strings.TrimSpace(request.Model); model != "" {
			return model
		}
	}
	return fallback
}

type CompletionResponse struct {
	Content      string                 `json:"content"`
	ToolCalls    []llmmodel.LLMToolCall `json:"tool_calls,omitempty"`
	FinishReason string                 `json:"finish_reason"`
	Usage        TokenUsage             `json:"usage"`
}

type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type HealthStatus struct {
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	Status             string `json:"status"`
	LatencyMS          int    `json:"latency_ms"`
	RateLimitRemaining int    `json:"rate_limit_remaining"`
}
