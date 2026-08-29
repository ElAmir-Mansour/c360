package provider

import (
	"context"
	"testing"

	"github.com/google/uuid"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
	llmdto "github.com/clario360/platform/internal/cyber/vciso/llm/dto"
)

func TestManager_PreservesExplicitZeroTemperatureOverride(t *testing.T) {
	tenantID := uuid.New()
	zero := 0.0
	m := NewManager(&llmcfg.Config{
		DefaultProvider: "anthropic",
		Providers: map[string]llmcfg.ProviderConfig{
			"anthropic": {
				APIKeyEnv:      "ANTHROPIC_API_KEY",
				Model:          "claude-3-haiku-20240307",
				Temperature:    0.7,
				TemperatureSet: true,
				MaxTokens:      32,
				TimeoutSeconds: 5,
			},
		},
	})

	override := m.UpdateConfig(tenantID, llmdto.UpdateConfigRequest{
		Provider:    "anthropic",
		Model:       "claude-3-haiku-20240307",
		Temperature: &zero,
	})
	if !override.TemperatureSet || override.Temperature != 0 {
		t.Fatalf("override temperature = %v set=%v, want explicit 0", override.Temperature, override.TemperatureSet)
	}

	resolved, err := m.Resolve(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	anthropic, ok := resolved.(*AnthropicProvider)
	if !ok {
		t.Fatalf("resolved provider = %T, want *AnthropicProvider", resolved)
	}
	if !anthropic.tempSet || anthropic.temperature != 0 {
		t.Fatalf("provider temperature = %v set=%v, want explicit 0", anthropic.temperature, anthropic.tempSet)
	}
}
