// Package drafting provides governed, generative LLM drafting for the
// Watheeq/Lex suite (AID-* requirements): clause generation, full-contract
// auto-draft, clause rewrite/re-leveling, fallback-clause suggestion, bilingual
// translation with legal-equivalence notes, long-contract key-terms summary,
// defined-term/glossary analysis, RFP/tender response drafting, and AI
// obligation-extraction QA review.
//
// It wraps the shared vciso LLM provider with the AI governance prediction
// logger so every generation is tenant-scoped, audited, and uses the per-tenant
// credential resolved by the provider Manager. It is self-contained and does
// NOT import the lex service/analyzer, avoiding import cycles (provider does not
// import lex; lex/drafting imports provider).
//
// Unlike the analysis enricher, drafting has NO deterministic fallback — you
// cannot deterministically generate a clause. When governance is not configured
// (ErrGovernanceUnavailable) the call degrades to an ungoverned but still
// per-tenant-credentialled LLM call so drafting keeps working; all other errors
// surface to the caller.
package drafting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/aigovernance"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// ProviderResolver is the narrow port over *provider.Manager so tests can inject
// a fake. *provider.Manager satisfies it.
type ProviderResolver interface {
	Resolve(ctx context.Context, tenantID uuid.UUID) (provider.LLMProvider, error)
}

// PredictGovernor is the narrow port over the AI governance prediction logger.
// *aigovmiddleware.PredictionLogger satisfies it via Predict(...).
type PredictGovernor interface {
	Predict(ctx context.Context, params aigovernance.PredictParams) (*aigovernance.PredictionResult, error)
}

// Compile-time assertions that the real shared types satisfy the narrow ports.
var (
	_ ProviderResolver = (*provider.Manager)(nil)
	_ PredictGovernor  = (*aigovmiddleware.PredictionLogger)(nil)
)

// Sentinel errors.
var (
	// ErrDraftingDisabled is returned when the LLM drafting engine is disabled by
	// config (no provider manager / LLM enrichment off). Handlers map it to 503.
	ErrDraftingDisabled = errors.New("lex llm drafting disabled")
	// ErrNoToolCall is returned when the model answered in prose instead of
	// calling the required structured tool.
	ErrNoToolCall = errors.New("lex llm drafting returned no tool call")
	// ErrInvalidOutput is returned when a provider calls the requested tool but
	// violates its required result schema (for example, contract sections=null).
	// Treating that payload as a success pushes an impossible value through the
	// API contract and can crash clients that correctly trust the schema.
	ErrInvalidOutput = errors.New("lex llm drafting returned invalid structured output")
)

// Hard cost-control bounds (mirror the analysis enricher).
const (
	maxTokensCeiling = 8192
	defaultMaxTokens = 4096
	defaultTimeout   = 30 * time.Second
	defaultMaxInput  = 60000
)

// Config governs the drafting engine. Safe by default (Enabled == false).
type Config struct {
	Enabled       bool
	MaxTokens     int
	Timeout       time.Duration
	MaxInputRunes int
	// InteractiveModel is an optional per-request model override for
	// latency-sensitive drafting flows (currently dedicated pleading drafting).
	// Empty preserves the provider's stronger default model.
	InteractiveModel string
}

func (c Config) normalized() Config {
	if c.MaxTokens <= 0 {
		c.MaxTokens = defaultMaxTokens
	}
	if c.MaxTokens > maxTokensCeiling {
		c.MaxTokens = maxTokensCeiling
	}
	if c.Timeout <= 0 {
		c.Timeout = defaultTimeout
	}
	if c.MaxInputRunes <= 0 {
		c.MaxInputRunes = defaultMaxInput
	}
	return c
}

// Drafter is the governed generative drafting engine.
type Drafter struct {
	resolver ProviderResolver
	predLog  PredictGovernor // may be nil (ungoverned narrow path)
	cfg      Config
}

// NewDrafter builds a Drafter. resolver must be non-nil for any real call;
// predLog may be nil (ungoverned). When resolver is nil the engine reports
// Enabled()==false and every method returns ErrDraftingDisabled.
func NewDrafter(resolver ProviderResolver, predLog PredictGovernor, cfg Config) *Drafter {
	return &Drafter{resolver: resolver, predLog: predLog, cfg: cfg.normalized()}
}

// Enabled reports whether the engine can actually draft.
func (d *Drafter) Enabled() bool {
	return d != nil && d.cfg.Enabled && d.resolver != nil
}

// genResult is the raw structured output of a single governed generation: the
// decoded tool arguments plus provenance metadata.
type genResult struct {
	args map[string]any
	meta map[string]any
}

type generationOptions struct {
	model     string
	maxTokens int
}

// generate is the core governed-call wrapper. It applies the kill switch, a
// context timeout, and routes through the prediction logger so the call is
// tenant-scoped and audited under its own model slug. On ErrGovernanceUnavailable
// it degrades to an ungoverned (but per-tenant-credentialled) call.
func (d *Drafter) generate(
	ctx context.Context,
	tenantID uuid.UUID,
	slug, useCase string,
	entityID *uuid.UUID,
	inputSummary map[string]any,
	systemPrompt, userPrompt string,
	tool llmmodel.ToolSchema,
) (*genResult, error) {
	return d.generateWithOptions(
		ctx,
		tenantID,
		slug,
		useCase,
		entityID,
		inputSummary,
		systemPrompt,
		userPrompt,
		tool,
		generationOptions{},
	)
}

func (d *Drafter) generateWithOptions(
	ctx context.Context,
	tenantID uuid.UUID,
	slug, useCase string,
	entityID *uuid.UUID,
	inputSummary map[string]any,
	systemPrompt, userPrompt string,
	tool llmmodel.ToolSchema,
	options generationOptions,
) (*genResult, error) {
	if !d.Enabled() {
		return nil, ErrDraftingDisabled
	}
	cctx, cancel := context.WithTimeout(ctx, d.cfg.Timeout)
	defer cancel()

	run := func(c context.Context) (map[string]any, float64, map[string]any, error) {
		return d.runTool(c, tenantID, systemPrompt, userPrompt, tool, options)
	}

	// Ungoverned narrow path.
	if d.predLog == nil {
		args, _, meta, err := run(cctx)
		if err != nil {
			return nil, err
		}
		return &genResult{args: args, meta: meta}, nil
	}

	res, err := d.predLog.Predict(cctx, aigovernance.PredictParams{
		TenantID:     tenantID,
		ModelSlug:    slug,
		UseCase:      useCase,
		EntityType:   "contract",
		EntityID:     entityID,
		Input:        inputSummary,
		InputSummary: aigovernance.SummarizeInput(inputSummary),
		ModelFunc: func(c context.Context, _ any) (*aigovernance.ModelOutput, error) {
			args, conf, meta, runErr := run(c)
			if runErr != nil {
				return nil, runErr
			}
			return &aigovernance.ModelOutput{Output: args, Confidence: conf, Metadata: meta}, nil
		},
	})
	if err != nil {
		// Governance not configured -> degrade to an ungoverned call so drafting
		// still works. Any other error (incl. LLM failure) surfaces.
		if errors.Is(err, aigovmiddleware.ErrGovernanceUnavailable) {
			args, _, meta, rErr := run(cctx)
			if rErr != nil {
				return nil, rErr
			}
			if meta == nil {
				meta = map[string]any{}
			}
			meta["governed"] = false
			return &genResult{args: args, meta: meta}, nil
		}
		return nil, err
	}
	args, _ := res.Output.(map[string]any)
	if args == nil {
		return nil, fmt.Errorf("governed drafting returned unexpected output type %T", res.Output)
	}
	return &genResult{args: args, meta: map[string]any{"governed": true, "model_id": res.ModelID.String()}}, nil
}

// runTool resolves the per-tenant provider, makes the completion call demanding
// the named structured tool, and returns the decoded tool arguments.
func (d *Drafter) runTool(
	ctx context.Context,
	tenantID uuid.UUID,
	systemPrompt, userPrompt string,
	tool llmmodel.ToolSchema,
	options generationOptions,
) (map[string]any, float64, map[string]any, error) {
	if d.resolver == nil {
		return nil, 0, nil, fmt.Errorf("llm provider resolver is not configured")
	}
	prov, err := d.resolver.Resolve(ctx, tenantID)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("resolve llm provider: %w", err)
	}
	req := &provider.CompletionRequest{
		SystemPrompt: systemPrompt,
		Messages: []llmmodel.LLMMessage{{
			Role:    "user",
			Content: userPrompt,
		}},
		Tools:          []llmmodel.ToolSchema{tool},
		Model:          strings.TrimSpace(options.model),
		MaxTokens:      generationMaxTokens(d.cfg.MaxTokens, options.maxTokens),
		TemperatureSet: false, // omit sampling params for claude-opus-4-8
		ResponseFormat: "tool",
	}
	resp, err := prov.Complete(ctx, req)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("llm complete: %w", err)
	}
	args, err := requireToolArgs(resp, tool.Name)
	if err != nil {
		return nil, 0, nil, err
	}
	model := prov.Model()
	if req.Model != "" {
		model = req.Model
	}
	meta := map[string]any{
		"model":    model,
		"provider": prov.Name(),
		"tokens":   resp.Usage.TotalTokens,
	}
	return args, 0.85, meta, nil
}

func generationMaxTokens(configured, requested int) int {
	if requested > 0 {
		if requested > maxTokensCeiling {
			return maxTokensCeiling
		}
		return requested
	}
	return configured
}

// requireToolArgs extracts the arguments of exactly the named tool call.
func requireToolArgs(resp *provider.CompletionResponse, name string) (map[string]any, error) {
	if resp == nil || len(resp.ToolCalls) == 0 {
		return nil, ErrNoToolCall
	}
	call := resp.ToolCalls[0]
	if call.FunctionName != name {
		return nil, fmt.Errorf("expected tool %q, got %q", name, call.FunctionName)
	}
	if call.Arguments == nil {
		return map[string]any{}, nil
	}
	return call.Arguments, nil
}

// decodeArgs marshals the loosely-typed tool arguments into a strict result DTO.
func decodeArgs(args map[string]any, dst any) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}

func (d *Drafter) truncate(text string) string {
	r := []rune(text)
	if len(r) <= d.cfg.MaxInputRunes {
		return text
	}
	return string(r[:d.cfg.MaxInputRunes])
}

func cleanLang(lang string) string {
	l := strings.ToLower(strings.TrimSpace(lang))
	switch l {
	case "ar", "arabic", "ar-sa":
		return "ar"
	case "en", "english", "en-us", "en-gb":
		return "en"
	default:
		return l
	}
}
