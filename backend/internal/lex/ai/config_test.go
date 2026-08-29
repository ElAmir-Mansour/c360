package ai

import (
	"testing"
	"time"
)

// The assistant must be OFF unless a deployment explicitly turns it on. An
// unset, blank, or unparseable LEX_AI_ENABLED all leave it off — the flag never
// fails open.
func TestConfigFromEnvIsOffByDefault(t *testing.T) {
	cases := []struct {
		name  string
		value string
		set   bool
		want  bool
	}{
		{name: "unset", want: false},
		{name: "empty", value: "", set: true, want: false},
		{name: "blank", value: "   ", set: true, want: false},
		{name: "garbage", value: "yes-please", set: true, want: false},
		{name: "false", value: "false", set: true, want: false},
		{name: "zero", value: "0", set: true, want: false},
		{name: "true", value: "true", set: true, want: true},
		{name: "one", value: "1", set: true, want: true},
		{name: "padded true", value: " true ", set: true, want: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.set {
				t.Setenv("LEX_AI_ENABLED", tc.value)
			}
			if got := ConfigFromEnv().Enabled; got != tc.want {
				t.Errorf("LEX_AI_ENABLED=%q -> Enabled = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}

func TestConfigFromEnvReadsKnobs(t *testing.T) {
	t.Setenv("LEX_AI_ENABLED", "true")
	t.Setenv("LEX_AI_ANTHROPIC_API_KEY", "lex-key")
	t.Setenv("LEX_AI_ANTHROPIC_BASE_URL", "https://sovereign.example/api")
	t.Setenv("LEX_AI_MODEL", "claude-sonnet-5")
	t.Setenv("LEX_AI_EFFORT", "HIGH")
	t.Setenv("LEX_AI_MAX_TOKENS", "8000")
	t.Setenv("LEX_AI_MAX_ITERATIONS", "6")
	t.Setenv("LEX_AI_TIMEOUT_SECONDS", "90")

	cfg := ConfigFromEnv()
	if !cfg.Enabled || cfg.APIKey != "lex-key" || cfg.BaseURL != "https://sovereign.example/api" {
		t.Fatalf("cfg = %+v", cfg)
	}
	if cfg.Model != "claude-sonnet-5" || cfg.Effort != "high" || cfg.MaxTokens != 8000 || cfg.MaxIterations != 6 {
		t.Errorf("cfg = %+v, want the environment overrides applied", cfg)
	}
	if cfg.Timeout != 90*time.Second {
		t.Errorf("Timeout = %v, want 90s", cfg.Timeout)
	}
}

// The lex-specific key wins over the platform-wide one, so a deployment can
// scope a separate key to the legal assistant without disturbing other suites.
func TestConfigFromEnvAPIKeyPrecedence(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "platform-key")
	if got := ConfigFromEnv().APIKey; got != "platform-key" {
		t.Errorf("APIKey = %q, want the platform key as fallback", got)
	}
	t.Setenv("LEX_AI_ANTHROPIC_API_KEY", "lex-key")
	if got := ConfigFromEnv().APIKey; got != "lex-key" {
		t.Errorf("APIKey = %q, want the lex-specific key to win", got)
	}
}

func TestConfigDefaults(t *testing.T) {
	cases := []struct {
		name string
		in   Config
		want Config
	}{
		{
			name: "zero value fills every knob but stays disabled",
			in:   Config{},
			want: Config{Model: DefaultModel, Effort: defaultEffort, MaxTokens: defaultMaxTokens, MaxIterations: defaultMaxIterations, Timeout: defaultTimeout},
		},
		{
			name: "invalid effort falls back",
			in:   Config{Effort: "turbo"},
			want: Config{Model: DefaultModel, Effort: defaultEffort, MaxTokens: defaultMaxTokens, MaxIterations: defaultMaxIterations, Timeout: defaultTimeout},
		},
		{
			name: "non-positive numbers fall back",
			in:   Config{MaxTokens: -1, MaxIterations: 0, Timeout: -time.Second},
			want: Config{Model: DefaultModel, Effort: defaultEffort, MaxTokens: defaultMaxTokens, MaxIterations: defaultMaxIterations, Timeout: defaultTimeout},
		},
		{
			name: "valid values are preserved",
			in:   Config{Enabled: true, Model: "claude-opus-4-8", Effort: "max", MaxTokens: 2048, MaxIterations: 2, Timeout: time.Minute},
			want: Config{Enabled: true, Model: "claude-opus-4-8", Effort: "max", MaxTokens: 2048, MaxIterations: 2, Timeout: time.Minute},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.withDefaults(); got != tc.want {
				t.Errorf("withDefaults() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// withDefaults must never flip the flag on: a defaulted config is still an off
// config.
func TestConfigDefaultsNeverEnable(t *testing.T) {
	off := Config{}
	if off.withDefaults().Enabled {
		t.Error("withDefaults() enabled a disabled config")
	}
}

// A nil registry must not panic (the repo convention is per-instance
// registries; duplicate registration on the default one panics).
func TestNewMetricsWithNilRegistryIsSafe(t *testing.T) {
	m := NewMetrics(nil)
	m.ObserveChat("anthropic", 1200, 2)

	var nilMetrics *Metrics
	nilMetrics.ObserveChat("anthropic", 1, 1) // must be a no-op, not a panic
}
