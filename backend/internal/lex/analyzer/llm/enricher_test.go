package llm

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func testContract() *model.Contract {
	return &model.Contract{
		ID:             uuid.New(),
		TenantID:       uuid.New(),
		Title:          "Master Services Agreement",
		Type:           model.ContractTypeServiceAgreement,
		CurrentVersion: 1,
	}
}

func enabledConfig() Config {
	return Config{
		Enabled:             true,
		MaxTokens:           1024,
		Timeout:             2 * time.Second,
		MaxInputRunes:       1000,
		ModelSlugClause:     "lex-clause-extractor-llm",
		ModelSlugObligation: "lex-obligation-extractor-llm",
	}
}

func validClauseArgs() map[string]any {
	return map[string]any{
		"clauses": []any{
			map[string]any{
				"clause_type":       "indemnification",
				"title":             "Indemnification",
				"text_span":         "The vendor shall indemnify...",
				"section_reference": "5.1",
				"risk_level":        "high",
				"risk_score":        180.0, // out of range -> clamp to 100
				"rationale":         "Broad indemnity",
				"risk_keywords":     []any{"indemnify", "hold harmless"},
				"recommendations":   []any{"Cap liability"},
				"confidence":        0.9,
			},
		},
		"parties": []any{
			map[string]any{"name": "Acme Corp", "role": "party_a", "source": "preamble"},
		},
		"compliance_flags": []any{
			map[string]any{"code": "foreign_governing_law", "title": "Foreign law", "severity": "medium"},
		},
	}
}

func TestSuggestClauses_Success(t *testing.T) {
	contract := testContract()
	prov := &fakeProvider{resp: toolResponse(ToolEmitClauseAnalysis, validClauseArgs())}
	resolver := &fakeResolver{prov: prov}
	gov := &fakeGovernor{}
	e := NewEnricher(resolver, gov, enabledConfig(), nil)

	sug, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "some contract text")
	if err != nil {
		t.Fatalf("SuggestClauses error = %v", err)
	}
	if len(sug.Clauses) != 1 {
		t.Fatalf("clauses = %d, want 1", len(sug.Clauses))
	}
	c := sug.Clauses[0]
	if c.ClauseType != model.ClauseTypeIndemnification {
		t.Fatalf("clause type = %s", c.ClauseType)
	}
	if c.RiskScore != 100 {
		t.Fatalf("risk score not clamped: %v", c.RiskScore)
	}
	if c.RiskLevel != model.RiskLevelHigh {
		t.Fatalf("risk level = %s", c.RiskLevel)
	}
	if len(sug.Parties) != 1 || sug.Parties[0].Role != "party_a" {
		t.Fatalf("parties = %+v", sug.Parties)
	}
	if len(sug.ComplianceFlags) != 1 {
		t.Fatalf("flags = %+v", sug.ComplianceFlags)
	}
	// Governance + tenant threading.
	if !gov.called {
		t.Fatal("governor not called")
	}
	if gov.gotParams.TenantID != contract.TenantID {
		t.Fatalf("tenant not threaded: %v", gov.gotParams.TenantID)
	}
	if gov.gotParams.ModelSlug != "lex-clause-extractor-llm" {
		t.Fatalf("model slug = %s", gov.gotParams.ModelSlug)
	}
	// System prompt forbids prose.
	if !strings.Contains(strings.ToLower(prov.gotReq.SystemPrompt), "do not answer in prose") {
		t.Fatalf("system prompt does not forbid prose: %q", prov.gotReq.SystemPrompt)
	}
	// No sampling params.
	if prov.gotReq.TemperatureSet {
		t.Fatal("temperature must not be set")
	}
	if resolver.gotTenant != contract.TenantID {
		t.Fatalf("resolver tenant = %v", resolver.gotTenant)
	}
}

func TestSuggestClauses_Disabled(t *testing.T) {
	contract := testContract()
	cfg := enabledConfig()
	cfg.Enabled = false
	e := NewEnricher(&fakeResolver{prov: &fakeProvider{}}, &fakeGovernor{}, cfg, nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if !errors.Is(err, ErrLLMDisabled) {
		t.Fatalf("err = %v, want ErrLLMDisabled", err)
	}
}

func TestSuggestClauses_NoToolCall(t *testing.T) {
	contract := testContract()
	prov := &fakeProvider{resp: proseResponse("Here is my analysis...")}
	e := NewEnricher(&fakeResolver{prov: prov}, &fakeGovernor{}, enabledConfig(), nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if !errors.Is(err, ErrNoToolCall) {
		t.Fatalf("err = %v, want ErrNoToolCall", err)
	}
}

func TestSuggestClauses_MalformedArgs(t *testing.T) {
	contract := testContract()
	// risk_score is a string where a number is expected -> decode error.
	args := map[string]any{"clauses": "not-an-array"}
	prov := &fakeProvider{resp: toolResponse(ToolEmitClauseAnalysis, args)}
	e := NewEnricher(&fakeResolver{prov: prov}, &fakeGovernor{}, enabledConfig(), nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if err == nil {
		t.Fatal("expected decode error, got nil")
	}
}

func TestSuggestClauses_ProviderError(t *testing.T) {
	contract := testContract()
	prov := &fakeProvider{err: errScripted}
	e := NewEnricher(&fakeResolver{prov: prov}, &fakeGovernor{}, enabledConfig(), nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if err == nil {
		t.Fatal("expected provider error")
	}
}

func TestSuggestClauses_NilPredLogRunsDirectly(t *testing.T) {
	contract := testContract()
	prov := &fakeProvider{resp: toolResponse(ToolEmitClauseAnalysis, validClauseArgs())}
	e := NewEnricher(&fakeResolver{prov: prov}, nil, enabledConfig(), nil)
	sug, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if err != nil {
		t.Fatalf("nil predLog path error = %v", err)
	}
	if len(sug.Clauses) != 1 {
		t.Fatalf("clauses = %d", len(sug.Clauses))
	}
}

func TestSuggestClauses_GovernanceUnavailable(t *testing.T) {
	contract := testContract()
	prov := &fakeProvider{resp: toolResponse(ToolEmitClauseAnalysis, validClauseArgs())}
	gov := &fakeGovernor{unavailable: true}
	e := NewEnricher(&fakeResolver{prov: prov}, gov, enabledConfig(), nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if err == nil {
		t.Fatal("expected governance error")
	}
}

func TestSuggestClauses_Timeout(t *testing.T) {
	contract := testContract()
	cfg := enabledConfig()
	cfg.Timeout = 20 * time.Millisecond
	prov := &fakeProvider{resp: toolResponse(ToolEmitClauseAnalysis, validClauseArgs()), delay: 200 * time.Millisecond}
	e := NewEnricher(&fakeResolver{prov: prov}, nil, cfg, nil)
	_, err := e.SuggestClauses(context.Background(), contract.TenantID, contract, "text")
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSuggestObligations_Success(t *testing.T) {
	contract := testContract()
	args := map[string]any{
		"obligations": []any{
			map[string]any{
				"title":            "Submit quarterly report",
				"description":      "Vendor submits report",
				"obligation_type":  "reporting",
				"priority":         "high",
				"due_date":         "2026-09-30",
				"source_reference": "8.2",
				"confidence":       0.85,
			},
			map[string]any{
				// missing due_date -> dropped
				"title":      "No due date",
				"confidence": 0.9,
			},
		},
	}
	prov := &fakeProvider{resp: toolResponse(ToolEmitObligations, args)}
	gov := &fakeGovernor{}
	e := NewEnricher(&fakeResolver{prov: prov}, gov, enabledConfig(), nil)
	items, err := e.SuggestObligations(context.Background(), contract.TenantID, contract, "text", nil)
	if err != nil {
		t.Fatalf("SuggestObligations error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1 (malformed dropped)", len(items))
	}
	if items[0].Type != model.ObligationTypeReporting {
		t.Fatalf("type = %s", items[0].Type)
	}
	if items[0].DueDate == nil || items[0].DueDate.Format("2006-01-02") != "2026-09-30" {
		t.Fatalf("due date = %v", items[0].DueDate)
	}
	if gov.gotParams.ModelSlug != "lex-obligation-extractor-llm" {
		t.Fatalf("model slug = %s", gov.gotParams.ModelSlug)
	}
	if gov.gotParams.TenantID != contract.TenantID {
		t.Fatalf("tenant not threaded")
	}
}
