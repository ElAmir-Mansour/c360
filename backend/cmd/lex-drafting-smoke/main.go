//go:build smoke

// Command lex-drafting-smoke runs a REAL end-to-end claude-opus-4-8 exercise of
// the AID-* generative drafting engine (internal/lex/drafting) — proving the
// real tool-schema + decode path produces grounded drafts, not stubs.
//
// It uses a Claude Code OAuth token via a smoke-only transport that calls
// /v1/messages with Authorization: Bearer + anthropic-beta: oauth-2025-04-20,
// injected through the engine's real ProviderResolver port (the production code
// path is unchanged).
//
// Run:
//
//	SMOKE_OAUTH_TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w \
//	  | python3 -c "import sys,json;print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])") \
//	  GOWORK=off go run -tags=smoke ./cmd/lex-drafting-smoke
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

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	"github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/lex/drafting"
)

func main() {
	token := os.Getenv("SMOKE_OAUTH_TOKEN")
	if token == "" {
		fmt.Println("SMOKE_OAUTH_TOKEN not set; cannot run live drafting smoke")
		os.Exit(1)
	}
	d := drafting.NewDrafter(oauthResolver{token: token}, nil, drafting.Config{
		Enabled: true, MaxTokens: 2048, Timeout: 90 * time.Second,
	})
	ctx := context.Background()
	tenant := uuid.New()
	fmt.Println("transport=oauth-smoke (Bearer + anthropic-beta: oauth-2025-04-20)  model=claude-opus-4-8")
	fmt.Println("===================================================================")

	// AID-01: clause generation
	clause, err := d.GenerateClause(ctx, tenant, drafting.ClauseRequest{
		Intent:       "Cap each party's aggregate liability at the fees paid in the prior 12 months, excluding confidentiality and IP indemnity.",
		ClauseType:   "limitation_of_liability",
		ContractType: "saas",
		Language:     "en",
	})
	must("AID-01 GenerateClause", err)
	check("AID-01 clause non-empty", len(clause.Text) > 80)
	check("AID-01 risk_level set", clause.RiskLevel != "")
	fmt.Printf("  title=%q risk=%s\n  text=%s\n", clause.Title, clause.RiskLevel, oneLine(clause.Text, 220))

	// AID-05: bilingual translation with equivalence
	tr, err := d.Translate(ctx, tenant, drafting.TranslateRequest{
		Text:       clause.Text,
		SourceLang: "en",
		TargetLang: "ar",
	})
	must("AID-05 Translate", err)
	check("AID-05 translation non-empty", len(tr.Translation) > 40)
	check("AID-05 equivalence set", tr.Equivalence != "")
	fmt.Printf("  equivalence=%s  translation=%s\n", tr.Equivalence, oneLine(tr.Translation, 180))

	// AID-06: long-contract key-terms summary
	sum, err := d.Summarize(ctx, tenant, drafting.SummaryRequest{
		Text:         "MASTER SERVICES AGREEMENT between Acme LLC and Globex for cloud hosting. Term: 24 months from 1 March 2026, auto-renews for 12 months unless 60 days notice. Fees: SAR 480,000/year. Liability capped at fees paid. Governing law: KSA. Data hosted in Riyadh.",
		ContractType: "services",
		Language:     "en",
	})
	must("AID-06 Summarize", err)
	check("AID-06 summary non-empty", len(sum.ExecutiveSummary) > 30)
	fmt.Printf("  key_terms=%d  summary=%s\n", len(sum.KeyTerms), oneLine(sum.ExecutiveSummary, 160))

	// AID-08: deterministic assembly (no LLM) — must always work
	asm, err := drafting.Assemble(drafting.AssembleRequest{
		Sections: []drafting.TemplateSection{
			{ID: "intro", Heading: "Agreement", Body: "Between {{party_a}} and {{party_b}}."},
			{ID: "arb", Heading: "Arbitration", Body: "Disputes resolved by arbitration.", Condition: "include_arbitration == true"},
			{ID: "court", Heading: "Courts", Body: "Disputes resolved by courts.", Condition: "include_arbitration != true"},
		},
		Variables: map[string]any{"party_a": "Acme", "party_b": "Globex", "include_arbitration": true},
	})
	must("AID-08 Assemble", err)
	check("AID-08 conditional include", contains(asm.IncludedSections, "arb") && !contains(asm.IncludedSections, "court"))
	check("AID-08 substitution", bytes.Contains([]byte(asm.Document), []byte("Acme")))
	fmt.Printf("  included=%v skipped=%v unresolved=%v\n", asm.IncludedSections, asm.SkippedSections, asm.UnresolvedVars)

	fmt.Println("===================================================================")
	fmt.Println("LIVE DRAFTING SMOKE PASSED: real claude-opus-4-8 produced grounded, structured drafts")
}

func firstConcession(fb *drafting.FallbackSet) string {
	if len(fb.Fallbacks) == 0 {
		return ""
	}
	return fb.Fallbacks[0].ConcessionLevel
}

func must(label string, err error) {
	if err != nil {
		fmt.Printf("FAIL %s: %v\n", label, err)
		os.Exit(1)
	}
}

func check(label string, ok bool) {
	if !ok {
		fmt.Printf("FAIL %s\n", label)
		os.Exit(1)
	}
	fmt.Printf("PASS %s\n", label)
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func oneLine(s string, n int) string {
	out := make([]rune, 0, n+1)
	for _, r := range s {
		if r == '\n' || r == '\r' {
			r = ' '
		}
		out = append(out, r)
		if len(out) >= n {
			out = append(out, '…')
			break
		}
	}
	return string(out)
}

// --- smoke-only OAuth transport (mirrors cmd/lex-llm-smoke) ---

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
		return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, string(raw[:min(len(raw), 400)]))
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
