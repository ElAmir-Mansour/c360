package llm

import "testing"

func TestLoadConfig_DefaultsToCurrentAnthropicModel(t *testing.T) {
	t.Setenv("VCISO_LLM_CONFIG_PATH", "/does/not/exist")
	t.Setenv("VCISO_LLM_CONFIG_DIR", "")
	t.Setenv("VCISO_LLM_PROVIDER", "")

	cfg := LoadConfig()
	if cfg.DefaultProvider != "anthropic" {
		t.Fatalf("DefaultProvider = %q, want anthropic", cfg.DefaultProvider)
	}
	anthropic := cfg.Providers["anthropic"]
	if anthropic.Model != "claude-opus-4-8" {
		t.Fatalf("anthropic model = %q, want claude-opus-4-8", anthropic.Model)
	}
	if anthropic.Temperature != 0 {
		t.Fatalf("anthropic temperature = %v, want omitted/zero default", anthropic.Temperature)
	}
	if anthropic.TemperatureSet {
		t.Fatal("anthropic TemperatureSet = true, want false so claude-opus-4-8 omits sampling params by default")
	}
}
