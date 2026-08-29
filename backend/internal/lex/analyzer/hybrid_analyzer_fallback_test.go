package analyzer

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/aigovernance"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/model"
)

// fixedNow keeps the merge/recompute clock deterministic so a successful hybrid
// run and the deterministic baseline can be compared without time drift.
func fixedNow() time.Time { return time.Date(2026, 3, 7, 9, 0, 0, 0, time.UTC) }

// assertEqualsBaseline asserts that a hybrid fallback result is byte-for-byte
// equal to the deterministic baseline (the strongest form of "falls back to the
// deterministic path" the task requires). The analysis ID is freshly generated
// per AnalyzeDetailed call (uuid.New), so it is normalized away before comparing;
// every other field (score, level, clauses, findings, flags, entities) must match.
func assertEqualsBaseline(t *testing.T, got, want *model.AnalysisResult) {
	t.Helper()
	gotAnalysis := *got.Analysis
	wantAnalysis := *want.Analysis
	gotAnalysis.ID = uuid.Nil
	wantAnalysis.ID = uuid.Nil
	if !reflect.DeepEqual(gotAnalysis, wantAnalysis) {
		t.Fatalf("analysis differs from deterministic baseline:\n got=%+v\nwant=%+v", gotAnalysis, wantAnalysis)
	}
	if !reflect.DeepEqual(got.Clauses, want.Clauses) {
		t.Fatalf("clauses differ from deterministic baseline:\n got=%+v\nwant=%+v", got.Clauses, want.Clauses)
	}
}

func baselineForHybrid(t *testing.T) (*RiskAnalyzer, *model.AnalysisResult) {
	t.Helper()
	base := newTestRiskAnalyzer()
	want, err := base.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("baseline error = %v", err)
	}
	return base, want
}

// TestHybridAnalyzer_Disabled_EqualsDeterministic verifies that when the
// enricher is present but the LLM entitlement flag is OFF (ErrLLMDisabled), the
// hybrid result is identical to the deterministic baseline.
func TestHybridAnalyzer_Disabled_EqualsDeterministic(t *testing.T) {
	base, want := baselineForHybrid(t)

	cfg := enabledEnricherConfig()
	cfg.Enabled = false // safe-by-default: entitlement off
	// Provider would error if ever called; it must not be.
	prov := &countingFakeProvider{err: errMustNotCall}
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, cfg, nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid disabled error = %v", err)
	}
	assertEqualsBaseline(t, got, want)
	if prov.calls != 0 {
		t.Fatalf("provider called %d times while disabled, want 0", prov.calls)
	}
}

// TestHybridAnalyzer_GovernanceUnavailable_EqualsDeterministic verifies that an
// ErrGovernanceUnavailable from the governance layer is treated as a fallback
// and returns the deterministic baseline unchanged.
func TestHybridAnalyzer_GovernanceUnavailable_EqualsDeterministic(t *testing.T) {
	base, want := baselineForHybrid(t)

	prov := &countingFakeProvider{resp: clauseToolResp()}
	// govUnavailableResolver-equivalent: route through a fake governor that
	// reports ErrGovernanceUnavailable. The enricher's call wrapper only invokes
	// the governor when predLog != nil, so inject one here.
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, unavailableGovernor{}, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid governance-unavailable error = %v", err)
	}
	assertEqualsBaseline(t, got, want)
}

// TestHybridAnalyzer_Timeout_EqualsDeterministic verifies that an LLM call that
// exceeds the configured timeout falls back to the deterministic baseline.
func TestHybridAnalyzer_Timeout_EqualsDeterministic(t *testing.T) {
	base, want := baselineForHybrid(t)

	cfg := enabledEnricherConfig()
	cfg.Timeout = 10 * time.Millisecond
	prov := &countingFakeProvider{resp: clauseToolResp(), delay: 200 * time.Millisecond}
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, cfg, nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid timeout error = %v", err)
	}
	assertEqualsBaseline(t, got, want)
}

// TestHybridAnalyzer_ProviderError_EqualsDeterministic verifies that a provider
// (network/API) error falls back to the deterministic baseline exactly.
func TestHybridAnalyzer_ProviderError_EqualsDeterministic(t *testing.T) {
	base, want := baselineForHybrid(t)

	prov := &countingFakeProvider{err: errMustNotCall} // any provider error
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid provider-error error = %v", err)
	}
	assertEqualsBaseline(t, got, want)
}

// TestHybridAnalyzer_NoToolCall_EqualsDeterministic verifies that a prose answer
// (no structured tool call) falls back to the deterministic baseline.
func TestHybridAnalyzer_NoToolCall_EqualsDeterministic(t *testing.T) {
	base, want := baselineForHybrid(t)

	prov := &countingFakeProvider{resp: &provider.CompletionResponse{Content: "Here is my analysis...", FinishReason: "stop"}}
	enricher := llm.NewEnricher(&hybridFakeResolver{prov: prov}, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	got, err := hybrid.AnalyzeDetailed(hybridContract(), hybridContractText)
	if err != nil {
		t.Fatalf("hybrid no-tool-call error = %v", err)
	}
	assertEqualsBaseline(t, got, want)
}

// TestHybridAnalyzer_TenantScopedToResolver verifies the contract's tenant ID is
// threaded through to the provider resolver on the hybrid (ctx) path.
func TestHybridAnalyzer_TenantScopedToResolver(t *testing.T) {
	base := newTestRiskAnalyzer()
	contract := hybridContract()

	prov := &countingFakeProvider{resp: clauseToolResp()}
	resolver := &tenantCapturingResolver{prov: prov}
	enricher := llm.NewEnricher(resolver, nil, enabledEnricherConfig(), nil)
	hybrid := NewHybridAnalyzer(base, enricher, zerolog.Nop())
	hybrid.SetNow(fixedNow)

	if _, err := hybrid.AnalyzeDetailedCtx(context.Background(), contract, hybridContractText); err != nil {
		t.Fatalf("hybrid ctx error = %v", err)
	}
	if resolver.gotTenant != contract.TenantID {
		t.Fatalf("resolver tenant = %v, want %v (tenant not threaded)", resolver.gotTenant, contract.TenantID)
	}
}

// --- local fakes (named to avoid colliding with hybrid_analyzer_test.go) ---

var errMustNotCall = mustNotCallErr{}

type mustNotCallErr struct{}

func (mustNotCallErr) Error() string { return "provider error / must not be called" }

// countingFakeProvider records how many times Complete is invoked and supports a
// scripted delay/error/response. No network.
type countingFakeProvider struct {
	resp  *provider.CompletionResponse
	err   error
	delay time.Duration
	calls int
}

func (p *countingFakeProvider) Complete(ctx context.Context, _ *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	p.calls++
	if p.delay > 0 {
		select {
		case <-time.After(p.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if p.err != nil {
		return nil, p.err
	}
	return p.resp, nil
}
func (p *countingFakeProvider) Name() string                    { return "fake" }
func (p *countingFakeProvider) Model() string                   { return "claude-opus-4-8" }
func (p *countingFakeProvider) SupportsParallelToolCalls() bool { return false }
func (p *countingFakeProvider) MaxContextTokens() int           { return 200000 }
func (p *countingFakeProvider) EstimateCost(int, int) float64   { return 0 }
func (p *countingFakeProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Status: "ok"}, nil
}

// tenantCapturingResolver records the tenant ID it was resolved with.
type tenantCapturingResolver struct {
	prov      provider.LLMProvider
	gotTenant uuid.UUID
}

func (r *tenantCapturingResolver) Resolve(_ context.Context, tenantID uuid.UUID) (provider.LLMProvider, error) {
	r.gotTenant = tenantID
	return r.prov, nil
}

// unavailableGovernor satisfies llm.PredictGovernor and always reports the
// governance layer as unavailable, so the enricher must fall back.
type unavailableGovernor struct{}

func (unavailableGovernor) Predict(context.Context, aigovernance.PredictParams) (*aigovernance.PredictionResult, error) {
	return nil, govUnavailable{}
}

type govUnavailable struct{}

func (govUnavailable) Error() string { return "ai governance unavailable" }
func (govUnavailable) Is(target error) bool {
	return target == aigovmiddleware.ErrGovernanceUnavailable
}

// Compile-time assertion that the fake satisfies the enricher's narrow port.
var _ llm.PredictGovernor = unavailableGovernor{}

// clauseToolResp returns a valid clause-analysis tool response (used where the
// call should succeed at the provider layer but fail/short-circuit elsewhere,
// e.g. governance unavailable).
func clauseToolResp() *provider.CompletionResponse {
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
	return &provider.CompletionResponse{
		ToolCalls: []llmmodel.LLMToolCall{{ID: "1", FunctionName: llm.ToolEmitClauseAnalysis, Arguments: args}},
	}
}
