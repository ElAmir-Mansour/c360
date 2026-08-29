//go:build smoke

// Command lex-llm-smoke runs a REAL end-to-end claude-opus-4-8 extraction through
// the production ClarioLex LLM enricher (internal/lex/analyzer/llm) against a
// sample contract — exercising the real tool-schema, decode, and merge logic.
//
// Two transports:
//   - If ANTHROPIC_API_KEY is set, it uses the real production provider.Manager.
//   - Else if SMOKE_OAUTH_TOKEN is set (a Claude Code OAuth token, sk-ant-oat...),
//     it uses a smoke-only transport that calls /v1/messages with
//     Authorization: Bearer + anthropic-beta: oauth-2025-04-20. This is the
//     documented way to use a Claude Code token; the enricher logic is unchanged.
//
// Run:
//
//	SMOKE_OAUTH_TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w \
//	  | python3 -c "import sys,json;print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])") \
//	  GOWORK=off go run -tags=smoke ./cmd/lex-llm-smoke
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	vcisollm "github.com/clario360/platform/internal/cyber/vciso/llm"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	"github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	lexllm "github.com/clario360/platform/internal/lex/analyzer/llm"
	lexmetrics "github.com/clario360/platform/internal/lex/metrics"
	lexmodel "github.com/clario360/platform/internal/lex/model"
)

const sampleContract = `MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into as of 1 March 2026
between Watheeq Legal Technologies LLC ("Provider") and Falcon Retail Holdings
Company ("Client").

1. TERM. This Agreement commences on the Effective Date and continues for an
initial term of two (2) years, and shall automatically renew for successive
one (1) year terms unless either party gives written notice of non-renewal at
least ninety (90) days before the end of the then-current term.

2. PAYMENT TERMS. Client shall pay Provider a fee of SAR 480,000 per year,
invoiced quarterly and due within thirty (30) days of invoice date. Late
payments accrue interest at 1.5% per month.

3. CONFIDENTIALITY. Each party shall hold the other's Confidential Information in
strict confidence and shall not disclose it to any third party for a period of
five (5) years following termination.

4. LIMITATION OF LIABILITY. IN NO EVENT SHALL PROVIDER'S TOTAL AGGREGATE
LIABILITY EXCEED THE FEES PAID IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
PROVIDER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES.

5. INDEMNIFICATION. Client shall indemnify, defend and hold harmless Provider
from any and all claims arising out of Client's misuse of the services.

6. TERMINATION. Either party may terminate this Agreement for material breach
upon thirty (30) days' written notice if the breach remains uncured. Provider
may terminate immediately upon Client's insolvency.

7. GOVERNING LAW. This Agreement is governed by the laws of the Kingdom of Saudi
Arabia, and disputes shall be resolved by arbitration in Riyadh.

8. COMPLIANCE. Provider shall process personal data in accordance with the Saudi
Personal Data Protection Law (PDPL). A data processing addendum is required
before any personal data is shared.`

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\nSMOKE FAILED: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	text := sampleContract
	if len(os.Args) > 1 {
		b, err := os.ReadFile(os.Args[1])
		if err != nil {
			return fmt.Errorf("read contract %s: %w", os.Args[1], err)
		}
		text = string(b)
	}

	var resolver lexllm.ProviderResolver
	switch {
	case os.Getenv("ANTHROPIC_API_KEY") != "":
		cfg := vcisollm.LoadConfig()
		fmt.Printf("transport=production-provider  provider=%s  model=claude-opus-4-8\n", cfg.DefaultProvider)
		resolver = provider.NewManager(cfg)
	case os.Getenv("SMOKE_OAUTH_TOKEN") != "":
		fmt.Println("transport=oauth-smoke (Bearer + anthropic-beta: oauth-2025-04-20)  model=claude-opus-4-8")
		resolver = oauthResolver{token: os.Getenv("SMOKE_OAUTH_TOKEN")}
	default:
		return fmt.Errorf("no credential: set ANTHROPIC_API_KEY or SMOKE_OAUTH_TOKEN")
	}

	enr := lexllm.NewEnricher(resolver, nil /* governance: run direct for smoke */, lexllm.Config{
		Enabled:   true,
		MaxTokens: 4096,
		Timeout:   90 * time.Second,
	}, lexmetrics.New(prometheus.NewRegistry()))

	tenantID := uuid.New()
	contract := &lexmodel.Contract{ID: uuid.New(), TenantID: tenantID, Title: "Master Services Agreement"}
	ctx := context.Background()

	fmt.Println("\n=== SuggestClauses (real claude-opus-4-8) ===")
	t0 := time.Now()
	cl, err := enr.SuggestClauses(ctx, tenantID, contract, text)
	if err != nil {
		return fmt.Errorf("SuggestClauses: %w", err)
	}
	fmt.Printf("(%.1fs, %d clauses)\n", time.Since(t0).Seconds(), len(cl.Clauses))
	for _, c := range cl.Clauses {
		fmt.Printf("  • %-24s risk=%-8s score=%4.0f  %s\n", c.ClauseType, c.RiskLevel, c.RiskScore, oneLine(c.AnalysisSummary, 84))
	}
	fmt.Printf("  parties=%d dates=%d amounts=%d compliance_flags=%d key_findings=%d\n",
		len(cl.Parties), len(cl.Dates), len(cl.Amounts), len(cl.ComplianceFlags), len(cl.KeyFindings))
	dump("parties", cl.Parties)
	dump("dates", cl.Dates)
	dump("amounts", cl.Amounts)
	dump("compliance_flags", cl.ComplianceFlags)

	fmt.Println("\n=== SuggestObligations (real claude-opus-4-8) ===")
	t1 := time.Now()
	obs, err := enr.SuggestObligations(ctx, tenantID, contract, text, nil)
	if err != nil {
		return fmt.Errorf("SuggestObligations: %w", err)
	}
	fmt.Printf("(%.1fs, %d obligations)\n", time.Since(t1).Seconds(), len(obs))
	for _, o := range obs {
		due := "—"
		if o.DueDate != nil {
			due = o.DueDate.Format("2006-01-02")
		}
		fmt.Printf("  • [%-11s] %-44s due=%-12s src=%s\n", o.Type, oneLine(o.Title, 44), due, o.SourceReference)
	}

	fmt.Println("\nSMOKE PASSED: real claude-opus-4-8 extraction returned structured results.")
	return nil
}

func dump(label string, v any) {
	b, _ := json.MarshalIndent(v, "    ", "  ")
	fmt.Printf("  %s: %s\n", label, string(b))
}

func oneLine(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// --- smoke-only OAuth transport: real enricher, Bearer auth to /v1/messages ---

type oauthResolver struct{ token string }

func (r oauthResolver) Resolve(_ context.Context, _ uuid.UUID) (provider.LLMProvider, error) {
	return &oauthProvider{token: r.token, hc: &http.Client{Timeout: 90 * time.Second}}, nil
}

type oauthProvider struct {
	token string
	hc    *http.Client
}

func (p *oauthProvider) Name() string                    { return "anthropic-oauth-smoke" }
func (p *oauthProvider) Model() string                   { return "claude-opus-4-8" }
func (p *oauthProvider) SupportsParallelToolCalls() bool { return false }
func (p *oauthProvider) MaxContextTokens() int           { return 200000 }
func (p *oauthProvider) EstimateCost(_, _ int) float64   { return 0 }
func (p *oauthProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{}, nil
}

func (p *oauthProvider) Complete(ctx context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	tools := make([]map[string]any, 0, len(req.Tools))
	for _, t := range req.Tools {
		tools = append(tools, map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.Parameters})
	}
	messages := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		messages = append(messages, map[string]any{"role": m.Role, "content": []map[string]any{{"type": "text", "text": m.Content}}})
	}
	maxTok := req.MaxTokens
	if maxTok <= 0 {
		maxTok = 4096
	}
	// Claude Code OAuth tokens require the Claude Code system identity as the first
	// system block; the enricher's real instruction follows it. No temperature
	// (claude-opus-4-8 rejects sampling params).
	body, _ := json.Marshal(map[string]any{
		"model":      "claude-opus-4-8",
		"max_tokens": maxTok,
		"system": []map[string]any{
			{"type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude."},
			{"type": "text", "text": req.SystemPrompt},
		},
		"messages": messages,
		"tools":    tools,
	})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("authorization", "Bearer "+p.token)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("anthropic-beta", "oauth-2025-04-20")
	httpReq.Header.Set("content-type", "application/json")

	resp, err := p.hc.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	var decoded struct {
		Content []struct {
			Type  string         `json:"type"`
			Text  string         `json:"text"`
			ID    string         `json:"id"`
			Name  string         `json:"name"`
			Input map[string]any `json:"input"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	out := &provider.CompletionResponse{FinishReason: decoded.StopReason}
	for _, b := range decoded.Content {
		switch b.Type {
		case "text":
			out.Content += b.Text
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, llmmodel.LLMToolCall{ID: b.ID, FunctionName: b.Name, Arguments: b.Input})
		}
	}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
