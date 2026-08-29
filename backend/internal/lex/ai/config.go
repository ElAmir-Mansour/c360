package ai

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// DefaultModel is the Anthropic model the assistant runs on. Confirmed against
// the claude-api skill at implementation time rather than copied from another
// service's pin (sea_cso / vciso pin their own, older, ids).
//
// Claude Opus 5 notes that shape client.go:
//   - temperature / top_p / top_k were REMOVED — sending any returns 400.
//   - thinking is ON by default; we leave it at the default (adaptive) and use
//     output_config.effort as the cost lever. Explicitly disabling thinking is
//     the documented cause of two failure modes (tool calls emitted as plain
//     text, <thinking> tags leaking into the answer), so we never disable it.
const DefaultModel = "claude-opus-5"

// Default bounds on the tool-use loop and the model call. Each iteration is one
// model round-trip; the loop ends when the model stops requesting tools.
const (
	defaultMaxIterations = 4
	// defaultMaxTokens caps thinking + answer for one call. It is a ceiling, not
	// a target — only generated tokens are billed — and it must leave headroom
	// for adaptive thinking or the answer truncates mid-sentence.
	defaultMaxTokens = 16000
	// defaultEffort is the real cost/latency lever. "low" is a strong setting on
	// this model and keeps an interactive dashboard panel responsive.
	defaultEffort  = "low"
	defaultTimeout = 60 * time.Second
)

// Config wires the Lex AI assistant. The zero value is DISABLED, which is the
// point: the whole surface ships off until product turns it on per environment.
type Config struct {
	// Enabled gates route mounting. When false the handler is never constructed
	// and /api/v1/lex/ai/* does not exist (404, not 403).
	Enabled bool
	// APIKey is the Anthropic API key. Empty means the surface degrades to a
	// clean 503 "AI_UNAVAILABLE" rather than a 500.
	APIKey string
	// BaseURL overrides the Anthropic API host (proxy / sovereign gateway).
	BaseURL string
	// Model is the Anthropic model id (DefaultModel when blank).
	Model string
	// Effort is output_config.effort: low | medium | high | xhigh | max.
	Effort string
	// MaxTokens caps thinking + answer per model call.
	MaxTokens int
	// MaxIterations bounds the tool-use loop.
	MaxIterations int
	// Timeout bounds one model call.
	Timeout time.Duration
}

// ConfigFromEnv reads the assistant configuration from the environment. Every
// knob is optional except LEX_AI_ENABLED, which must be explicitly truthy —
// an unset or unparseable value leaves the surface off.
func ConfigFromEnv() Config {
	cfg := Config{
		Enabled:       envBool("LEX_AI_ENABLED"),
		APIKey:        strings.TrimSpace(os.Getenv("LEX_AI_ANTHROPIC_API_KEY")),
		BaseURL:       strings.TrimSpace(os.Getenv("LEX_AI_ANTHROPIC_BASE_URL")),
		Model:         strings.TrimSpace(os.Getenv("LEX_AI_MODEL")),
		Effort:        strings.ToLower(strings.TrimSpace(os.Getenv("LEX_AI_EFFORT"))),
		MaxTokens:     envInt("LEX_AI_MAX_TOKENS"),
		MaxIterations: envInt("LEX_AI_MAX_ITERATIONS"),
	}
	if cfg.APIKey == "" {
		// Fall back to the platform-wide key so an operator does not have to set
		// the same secret twice; the lex-specific name still wins when present.
		cfg.APIKey = strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
	}
	if seconds := envInt("LEX_AI_TIMEOUT_SECONDS"); seconds > 0 {
		cfg.Timeout = time.Duration(seconds) * time.Second
	}
	return cfg.withDefaults()
}

// withDefaults fills unset knobs. It never flips Enabled — a defaulted config
// is still an off config.
func (c Config) withDefaults() Config {
	if strings.TrimSpace(c.Model) == "" {
		c.Model = DefaultModel
	}
	switch c.Effort {
	case "low", "medium", "high", "xhigh", "max":
	default:
		c.Effort = defaultEffort
	}
	if c.MaxTokens <= 0 {
		c.MaxTokens = defaultMaxTokens
	}
	if c.MaxIterations <= 0 {
		c.MaxIterations = defaultMaxIterations
	}
	if c.Timeout <= 0 {
		c.Timeout = defaultTimeout
	}
	return c
}

func envBool(key string) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return false
	}
	return value
}

func envInt(key string) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return 0
	}
	return value
}
