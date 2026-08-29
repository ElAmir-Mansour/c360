package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
)

func TestAnthropicProvider_OmitsTemperatureForClaudeOpus48(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("path = %s, want /v1/messages", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	t.Setenv("ANTHROPIC_API_KEY", "test-key")
	p := NewAnthropicProvider(llmcfg.ProviderConfig{
		APIKeyEnv:      "ANTHROPIC_API_KEY",
		Model:          "claude-opus-4-8",
		BaseURL:        server.URL,
		Temperature:    0.7,
		MaxTokens:      32,
		TimeoutSeconds: 5,
	})

	if _, err := p.Complete(context.Background(), &CompletionRequest{Temperature: 0.2}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if _, ok := payload["temperature"]; ok {
		t.Fatalf("temperature should be omitted for claude-opus-4-8: %#v", payload)
	}
}

func TestAnthropicProvider_IncludesTemperatureForModelsThatAcceptIt(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	t.Setenv("ANTHROPIC_API_KEY", "test-key")
	p := NewAnthropicProvider(llmcfg.ProviderConfig{
		APIKeyEnv:      "ANTHROPIC_API_KEY",
		Model:          "claude-3-haiku-20240307",
		BaseURL:        server.URL,
		Temperature:    0.4,
		MaxTokens:      32,
		TimeoutSeconds: 5,
	})

	if _, err := p.Complete(context.Background(), &CompletionRequest{}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if got, ok := payload["temperature"].(float64); !ok || got != 0.4 {
		t.Fatalf("temperature = %v (%T), want 0.4", payload["temperature"], payload["temperature"])
	}
}

func TestAnthropicProvider_PreservesExplicitZeroTemperature(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer server.Close()

	t.Setenv("ANTHROPIC_API_KEY", "test-key")
	p := NewAnthropicProvider(llmcfg.ProviderConfig{
		APIKeyEnv:      "ANTHROPIC_API_KEY",
		Model:          "claude-3-haiku-20240307",
		BaseURL:        server.URL,
		Temperature:    0.7,
		TemperatureSet: true,
		MaxTokens:      32,
		TimeoutSeconds: 5,
	})

	if _, err := p.Complete(context.Background(), &CompletionRequest{Temperature: 0, TemperatureSet: true}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if got, ok := payload["temperature"].(float64); !ok || got != 0 {
		t.Fatalf("temperature = %v (%T), want explicit 0", payload["temperature"], payload["temperature"])
	}
}

func TestAnthropicProvider_UsesPerCompletionModelOverride(t *testing.T) {
	p := NewAnthropicProvider(llmcfg.ProviderConfig{
		Model:       "claude-opus-4-8",
		MaxTokens:   4096,
		Temperature: 0.7,
	})

	payload := p.buildPayload(&CompletionRequest{
		Model:     "claude-sonnet-5",
		MaxTokens: 2200,
	})

	if payload["model"] != "claude-sonnet-5" {
		t.Fatalf("model = %v, want per-completion override", payload["model"])
	}
	if payload["max_tokens"] != 2200 {
		t.Fatalf("max_tokens = %v, want 2200", payload["max_tokens"])
	}
	if _, ok := payload["temperature"]; ok {
		t.Fatalf("temperature should be omitted for overridden claude-sonnet-5: %#v", payload)
	}
	if _, ok := payload["thinking"]; !ok {
		t.Fatalf("thinking should be explicitly disabled for overridden claude-sonnet-5: %#v", payload)
	}
	if p.Model() != "claude-opus-4-8" {
		t.Fatalf("provider default model changed to %q", p.Model())
	}
}
