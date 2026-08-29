package analyzer

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/model"
)

// HybridAnalyzer wraps the deterministic RiskAnalyzer with a governed LLM
// enricher. It satisfies the same inline interface (AnalyzeDetailed) the
// ContractService depends on, plus the context-aware AnalyzeDetailedCtx. The
// deterministic baseline always runs first and is the only thing that can fail
// the request; the LLM enriches on success and is bypassed on any error.
type HybridAnalyzer struct {
	base     *RiskAnalyzer
	enricher *llm.Enricher // may be nil
	logger   zerolog.Logger
	now      func() time.Time
}

// NewHybridAnalyzer builds a HybridAnalyzer. enricher may be nil, in which case
// the analyzer behaves identically to the wrapped deterministic RiskAnalyzer.
func NewHybridAnalyzer(base *RiskAnalyzer, enricher *llm.Enricher, logger zerolog.Logger) *HybridAnalyzer {
	return &HybridAnalyzer{
		base:     base,
		enricher: enricher,
		logger:   logger.With().Str("component", "lex-hybrid-analyzer").Logger(),
		now:      time.Now,
	}
}

// SetNow overrides the clock (tests only).
func (h *HybridAnalyzer) SetNow(now func() time.Time) {
	if now != nil {
		h.now = now
	}
}

// AnalyzeDetailed satisfies the legacy interface by delegating to the
// context-aware path with a background context.
func (h *HybridAnalyzer) AnalyzeDetailed(contract *model.Contract, text string) (*model.AnalysisResult, error) {
	return h.AnalyzeDetailedCtx(context.Background(), contract, text)
}

// AnalyzeDetailedCtx runs the deterministic analysis, then enriches with the
// governed LLM enricher when available. Any LLM failure (disabled, governance
// unavailable, timeout, provider error, no tool call, decode/validation error)
// is logged and the deterministic result is returned unchanged.
func (h *HybridAnalyzer) AnalyzeDetailedCtx(ctx context.Context, contract *model.Contract, text string) (*model.AnalysisResult, error) {
	det, err := h.base.AnalyzeDetailedCtx(ctx, contract, text)
	if err != nil {
		return nil, err // baseline failure is the only hard failure
	}
	if h.enricher == nil || contract == nil {
		return det, nil
	}
	sug, lerr := h.enricher.SuggestClauses(ctx, contract.TenantID, contract, text)
	if lerr != nil {
		h.logger.Debug().Err(lerr).Str("contract_id", contract.ID.String()).Msg("llm clause enrichment fell back to deterministic result")
		return det, nil
	}
	return llm.MergeClauses(det, sug, h.now().UTC()), nil
}
