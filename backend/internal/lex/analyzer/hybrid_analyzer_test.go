package analyzer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/model"
)

// --- minimal fakes for exercising the enricher through the hybrid analyzer ---

type hybridFakeProvider struct {
	resp *provider.CompletionResponse
	err  error
}

func (p *hybridFakeProvider) Complete(context.Context, *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	if p.err != nil {
		return nil, p.err
	}
	return p.resp, nil
}
func (p *hybridFakeProvider) Name() string                    { return "fake" }
func (p *hybridFakeProvider) Model() string                   { return "claude-opus-4-8" }
func (p *hybridFakeProvider) SupportsParallelToolCalls() bool { return false }
func (p *hybridFakeProvider) MaxContextTokens() int           { return 200000 }
func (p *hybridFakeProvider) EstimateCost(int, int) float64   { return 0 }
func (p *hybridFakeProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Status: "ok"}, nil
}

type hybridFakeResolver struct {
	prov provider.LLMProvider
	err  error
}

func (r *hybridFakeResolver) Resolve(context.Context, uuid.UUID) (provider.LLMProvider, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.prov, nil
}

func hybridContract() *model.Contract {
	value := 5_000_000.0
	return &model.Contract{
		ID:             uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
		TenantID:       uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
		Title:          "Hybrid Test Contract",
		Type:           model.ContractTypeServiceAgreement,
		PartyAName:     "Clario Holdings Limited",
		PartyBName:     "Counterparty Ltd.",
		TotalValue:     &value,
		Currency:       "SAR",
		CurrentVersion: 1,
	}
}

const hybridContractText = `Section 1. Confidentiality. Each party shall keep information confidential.
Section 2. Termination. Either party may terminate with notice.
Section 3. Governing Law. This agreement is governed by the laws of Saudi Arabia.`

func enabledEnricherConfig() llm.Config {
	return llm.Config{
		Enabled:             true,
		MaxTokens:           1024,
		Timeout:             2 * time.Second,
		MaxInputRunes:       5000,
		ModelSlugClause:     "lex-clause-extractor-llm",
		ModelSlugObligation: "lex-obligation-extractor-llm",
	}
}

func TestHybridAnalyzer_NilEnricher_IdenticalToBaseline(t *testing.T) {
	base := newTestRiskAnalyzer()
	hybrid := NewHybridAnalyzer(base, nil, zerolog.Nop())
	contract := hybridContract()

	want, err := base.AnalyzeDetailed(contract, hybridContractText)
	if err != nil {
		t.Fatalf("baseline error = %v", err)
	}
	got, err := hybrid.AnalyzeDetailed(contract, hybridContractText)
	if err != nil {
		t.Fatalf("hybrid error = %v", err)
	}
	if got.Analysis.RiskScore != want.Analysis.RiskScore {
		t.Fatalf("risk score differs: %v vs %v", got.Analysis.RiskScore, want.Analysis.RiskScore)
	}
	if len(got.Clauses) != len(want.Clauses) {
		t.Fatalf("clause count differs: %d vs %d", len(got.Clauses), len(want.Clauses))
	}
}

func TestHybridAnalyzer_EnricherError_FallsBackToBaseline(t *testing.T) {
	base := newTestRiskAnalyzer()
	want, err := base.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("baseline error = %v", err)
	}

	// Resolver returns an error -> enricher fails -> fallback to deterministic.
	resolver := &hybridFakeResolver{err: errors.New("resolve failed")}
	enricher := llm.NewEnricher(resolver, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid should not error on fallback: %v", err)
	}
	if got.Analysis.RiskScore != want.Analysis.RiskScore {
		t.Fatalf("fallback should equal baseline: %v vs %v", got.Analysis.RiskScore, want.Analysis.RiskScore)
	}
	if len(got.Clauses) != len(want.Clauses) {
		t.Fatalf("fallback clause count differs: %d vs %d", len(got.Clauses), len(want.Clauses))
	}
}

func TestHybridAnalyzer_EnricherSuccess_MergesEnrichment(t *testing.T) {
	base := newTestRiskAnalyzer()
	det, err := base.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("baseline error = %v", err)
	}

	// LLM adds a net-new high-confidence clause not present deterministically.
	args := map[string]any{
		"clauses": []any{
			map[string]any{
				"clause_type":       "indemnification",
				"title":             "Indemnification",
				"text_span":         "Vendor indemnifies for IP claims",
				"section_reference": "99",
				"risk_level":        "high",
				"risk_score":        75.0,
				"rationale":         "Uncapped indemnity",
				"confidence":        0.9,
			},
		},
	}
	prov := &hybridFakeProvider{resp: &provider.CompletionResponse{
		ToolCalls: []llmmodel.LLMToolCall{{ID: "1", FunctionName: llm.ToolEmitClauseAnalysis, Arguments: args}},
	}}
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid error = %v", err)
	}
	if len(got.Clauses) <= len(det.Clauses) {
		t.Fatalf("hybrid should add a clause: got %d, det %d", len(got.Clauses), len(det.Clauses))
	}
	found := false
	for _, c := range got.Clauses {
		if c.ClauseType == model.ClauseTypeIndemnification && c.SectionReference == "99" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected merged LLM indemnification clause")
	}
}

func TestHybridAnalyzer_BaselineError_LLMNotCalled(t *testing.T) {
	base := newTestRiskAnalyzer()
	// nil contract makes the deterministic analyzer error.
	prov := &hybridFakeProvider{err: errors.New("must not be called")}
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())

	_, err := hybrid.AnalyzeDetailed(nil, hybridContractText)
	if err == nil {
		t.Fatal("expected baseline error to propagate")
	}
}
