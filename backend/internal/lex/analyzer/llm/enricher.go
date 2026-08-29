package llm

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
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
)

// Sentinel errors. All non-nil errors returned by the enricher signal the
// caller to fall back to the deterministic baseline.
var (
	// ErrLLMDisabled is returned when the enricher is disabled by config. The
	// caller must fall back to the deterministic analyzer.
	ErrLLMDisabled = errors.New("lex llm enrichment disabled")
	// ErrNoToolCall is returned when the model answered in prose instead of
	// calling the required tool.
	ErrNoToolCall = errors.New("lex llm enrichment returned no tool call")
)

// minSuggestionConfidence is the floor a net-new LLM-only clause/obligation must
// clear to be considered for merge. (Merge enforces this again; the enricher
// passes everything through and lets merge decide.)
const minSuggestionConfidence = 0.6

// Hard cost-control bounds.
const (
	maxTokensCeiling   = 8192
	defaultMaxTokens   = 4096
	defaultTimeout     = 20 * time.Second
	defaultMaxInputRun = 60000
)

// Config governs the LLM enricher. Safe by default (Enabled == false).
type Config struct {
	Enabled             bool
	MaxTokens           int           // default 4096, hard cap 8192
	Timeout             time.Duration // default 20s
	MaxInputRunes       int           // truncate doc text, default 60000
	ModelSlugClause     string        // e.g. "lex-clause-extractor-llm"
	ModelSlugObligation string        // e.g. "lex-obligation-extractor-llm"
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
		c.MaxInputRunes = defaultMaxInputRun
	}
	if strings.TrimSpace(c.ModelSlugClause) == "" {
		c.ModelSlugClause = "lex-clause-extractor-llm"
	}
	if strings.TrimSpace(c.ModelSlugObligation) == "" {
		c.ModelSlugObligation = "lex-obligation-extractor-llm"
	}
	return c
}

// Enricher performs governed, tool-use LLM enrichment of contract analysis.
type Enricher struct {
	resolver ProviderResolver
	predLog  PredictGovernor // may be nil
	cfg      Config
	metrics  *metrics.Metrics
	now      func() time.Time
}

// ClauseSuggestions is the typed output of SuggestClauses. It is a SUGGESTION
// set: the merge step decides what to keep. It never replaces the deterministic
// baseline.
type ClauseSuggestions struct {
	Clauses         []model.ExtractedClause
	Parties         []model.PartyExtraction
	Dates           []model.ExtractedDate
	Amounts         []model.ExtractedAmount
	ComplianceFlags []model.ComplianceFlag
	KeyFindings     []model.RiskFinding
}

// NewEnricher builds an Enricher. predLog may be nil (the call still respects
// the disabled flag but runs ungoverned, intended for narrow test paths).
// resolver must be non-nil for any real call.
func NewEnricher(resolver ProviderResolver, predLog PredictGovernor, cfg Config, m *metrics.Metrics) *Enricher {
	return &Enricher{
		resolver: resolver,
		predLog:  predLog,
		cfg:      cfg.normalized(),
		metrics:  m,
		now:      time.Now,
	}
}

// SetNow overrides the clock (tests only).
func (e *Enricher) SetNow(now func() time.Time) {
	if now != nil {
		e.now = now
	}
}

// SuggestClauses runs the governed clause/entity/finding extraction.
func (e *Enricher) SuggestClauses(ctx context.Context, tenantID uuid.UUID, contract *model.Contract, text string) (*ClauseSuggestions, error) {
	if contract == nil {
		return nil, fmt.Errorf("contract is required")
	}
	var entityID *uuid.UUID
	if contract.ID != uuid.Nil {
		id := contract.ID
		entityID = &id
	}
	input := e.clauseInput(contract, text)
	out, err := e.call(ctx, tenantID, e.cfg.ModelSlugClause, "clause_extraction_llm", "clause", entityID, input,
		func(c context.Context) (any, float64, map[string]any, error) {
			return e.runClause(c, tenantID, contract, text)
		})
	if err != nil {
		return nil, err
	}
	sug, ok := out.(*ClauseSuggestions)
	if !ok || sug == nil {
		return nil, fmt.Errorf("unexpected clause suggestion type %T", out)
	}
	return sug, nil
}

// SuggestObligations runs the governed obligation extraction. det is the
// deterministic baseline (used only for input context); the returned slice is
// the LLM-suggested items, which the caller merges via MergeObligations.
func (e *Enricher) SuggestObligations(ctx context.Context, tenantID uuid.UUID, contract *model.Contract, text string, det []dto.ObligationExtractionItem) ([]dto.ObligationExtractionItem, error) {
	if contract == nil {
		return nil, fmt.Errorf("contract is required")
	}
	var entityID *uuid.UUID
	if contract.ID != uuid.Nil {
		id := contract.ID
		entityID = &id
	}
	input := e.obligationInput(contract, text, det)
	out, err := e.call(ctx, tenantID, e.cfg.ModelSlugObligation, "obligation_extraction_llm", "obligation", entityID, input,
		func(c context.Context) (any, float64, map[string]any, error) {
			return e.runObligations(c, tenantID, contract, text)
		})
	if err != nil {
		return nil, err
	}
	items, ok := out.([]dto.ObligationExtractionItem)
	if !ok {
		return nil, fmt.Errorf("unexpected obligation suggestion type %T", out)
	}
	return items, nil
}

// call is the core governed-call wrapper used by both methods. It applies the
// kill switch, a context timeout, and routes through the prediction logger so
// the LLM call is tenant-scoped and audited under its own model slug.
func (e *Enricher) call(
	ctx context.Context,
	tenantID uuid.UUID,
	slug, useCase, operation string,
	entityID *uuid.UUID,
	in any,
	run func(ctx context.Context) (any, float64, map[string]any, error),
) (any, error) {
	if !e.cfg.Enabled {
		e.observe(operation, "disabled", 0)
		return nil, ErrLLMDisabled
	}
	start := e.now()
	cctx, cancel := context.WithTimeout(ctx, e.cfg.Timeout)
	defer cancel()

	// No prediction logger configured: run directly but still respect the
	// disabled flag and timeout. This is a narrow path (ungoverned).
	if e.predLog == nil {
		out, _, _, err := run(cctx)
		e.finish(operation, start, err)
		return out, err
	}

	res, err := e.predLog.Predict(cctx, aigovernance.PredictParams{
		TenantID:     tenantID,
		ModelSlug:    slug,
		UseCase:      useCase,
		EntityType:   "contract",
		EntityID:     entityID,
		Input:        in,
		InputSummary: aigovernance.SummarizeInput(in),
		ModelFunc: func(c context.Context, _ any) (*aigovernance.ModelOutput, error) {
			out, conf, meta, runErr := run(c)
			if runErr != nil {
				return nil, runErr
			}
			return &aigovernance.ModelOutput{Output: out, Confidence: conf, Metadata: meta}, nil
		},
	})
	if err != nil {
		// ErrGovernanceUnavailable and any other error both mean fallback.
		e.finish(operation, start, err)
		if errors.Is(err, aigovmiddleware.ErrGovernanceUnavailable) {
			return nil, err
		}
		return nil, err
	}
	e.finish(operation, start, nil)
	return res.Output, nil
}

func (e *Enricher) finish(operation string, start time.Time, err error) {
	outcome := "success"
	if err != nil {
		outcome = "fallback"
	}
	e.observe(operation, outcome, e.now().Sub(start))
}

func (e *Enricher) observe(operation, outcome string, d time.Duration) {
	if e.metrics == nil {
		return
	}
	e.metrics.LLMEnrichmentTotal.WithLabelValues(operation, outcome).Inc()
	if d > 0 {
		e.metrics.LLMEnrichmentDuration.Observe(d.Seconds())
	}
}

// runClause performs the actual provider call and decodes the clause tool args.
func (e *Enricher) runClause(ctx context.Context, tenantID uuid.UUID, contract *model.Contract, text string) (any, float64, map[string]any, error) {
	if e.resolver == nil {
		return nil, 0, nil, fmt.Errorf("llm provider resolver is not configured")
	}
	prov, err := e.resolver.Resolve(ctx, tenantID)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("resolve llm provider: %w", err)
	}
	schema := ClauseAnalysisSchema()
	req := &provider.CompletionRequest{
		SystemPrompt: clauseSystemPrompt,
		Messages: []llmmodel.LLMMessage{{
			Role:    "user",
			Content: e.clauseUserPrompt(contract, text),
		}},
		Tools:          []llmmodel.ToolSchema{schema},
		MaxTokens:      e.cfg.MaxTokens,
		TemperatureSet: false, // omit sampling params for claude-opus-4-8
		ResponseFormat: "tool",
	}
	resp, err := prov.Complete(ctx, req)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("llm complete: %w", err)
	}
	args, err := requireToolArgs(resp, ToolEmitClauseAnalysis)
	if err != nil {
		return nil, 0, nil, err
	}
	var decoded clauseToolArgs
	if err := decodeArgs(args, &decoded); err != nil {
		return nil, 0, nil, fmt.Errorf("decode clause tool args: %w", err)
	}
	sug, conf := decoded.toSuggestions(e.now())
	meta := map[string]any{
		"clause_count": len(sug.Clauses),
		"model":        prov.Model(),
		"provider":     prov.Name(),
	}
	return sug, conf, meta, nil
}

// runObligations performs the actual provider call and decodes the obligation
// tool args.
func (e *Enricher) runObligations(ctx context.Context, tenantID uuid.UUID, contract *model.Contract, text string) (any, float64, map[string]any, error) {
	if e.resolver == nil {
		return nil, 0, nil, fmt.Errorf("llm provider resolver is not configured")
	}
	prov, err := e.resolver.Resolve(ctx, tenantID)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("resolve llm provider: %w", err)
	}
	schema := ObligationSchema()
	req := &provider.CompletionRequest{
		SystemPrompt: obligationSystemPrompt,
		Messages: []llmmodel.LLMMessage{{
			Role:    "user",
			Content: e.obligationUserPrompt(contract, text),
		}},
		Tools:          []llmmodel.ToolSchema{schema},
		MaxTokens:      e.cfg.MaxTokens,
		TemperatureSet: false,
		ResponseFormat: "tool",
	}
	resp, err := prov.Complete(ctx, req)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("llm complete: %w", err)
	}
	args, err := requireToolArgs(resp, ToolEmitObligations)
	if err != nil {
		return nil, 0, nil, err
	}
	var decoded obligationToolArgs
	if err := decodeArgs(args, &decoded); err != nil {
		return nil, 0, nil, fmt.Errorf("decode obligation tool args: %w", err)
	}
	items, conf := decoded.toItems()
	meta := map[string]any{
		"obligation_count": len(items),
		"model":            prov.Model(),
		"provider":         prov.Name(),
	}
	return items, conf, meta, nil
}

// requireToolArgs extracts the arguments of exactly the named tool call. It is
// an error if the model produced no tool calls (prose answer) or called a
// different tool.
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

// decodeArgs marshals the loosely-typed tool arguments and unmarshals into a
// strict DTO mirroring the schema.
func decodeArgs(args map[string]any, dst any) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}

// truncateRunes truncates text to at most n runes (cost control).
func truncateRunes(text string, n int) string {
	if n <= 0 {
		return text
	}
	r := []rune(text)
	if len(r) <= n {
		return text
	}
	return string(r[:n])
}

func (e *Enricher) clauseInput(contract *model.Contract, text string) map[string]any {
	return map[string]any{
		"contract_id":     contract.ID.String(),
		"contract_type":   string(contract.Type),
		"document_length": len([]rune(text)),
		"current_version": contract.CurrentVersion,
		"document_text":   truncateRunes(text, e.cfg.MaxInputRunes), // redacted by InputSummary
	}
}

func (e *Enricher) obligationInput(contract *model.Contract, text string, det []dto.ObligationExtractionItem) map[string]any {
	return map[string]any{
		"contract_id":         contract.ID.String(),
		"contract_type":       string(contract.Type),
		"document_length":     len([]rune(text)),
		"deterministic_count": len(det),
		"document_text":       truncateRunes(text, e.cfg.MaxInputRunes),
	}
}
