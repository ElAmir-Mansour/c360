package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestExtractionChain_EnricherProducesDraftsFromContractTextWithoutManualItems(t *testing.T) {
	contract := &model.Contract{
		ID:             uuid.New(),
		TenantID:       uuid.New(),
		Title:          "Autonomous Obligation Contract",
		Type:           model.ContractTypeServiceAgreement,
		CurrentVersion: 2,
		DocumentText: strings.Join([]string{
			"Section 7 Reporting. Supplier shall submit the monthly SLA report by 2026-07-15.",
			"Section 8 Payment. Customer must pay the implementation invoice no later than 2026-08-01.",
		}, "\n"),
	}
	includeRenewal := false
	req := dto.ExtractObligationsRequest{
		OwnerUserID:            uuid.New(),
		OwnerName:              "Contract Owner",
		IncludeContractRenewal: &includeRenewal,
	}
	req.Normalize()

	detItems := buildExtractionItems(contract, req)
	if len(detItems) != 0 {
		t.Fatalf("deterministic items = %d, want none without payload/metadata/renewal", len(detItems))
	}

	prov := &textDrivenObligationProvider{}
	enricher := llm.NewEnricher(&textDrivenObligationResolver{prov: prov}, nil, llm.Config{
		Enabled:             true,
		MaxTokens:           1024,
		Timeout:             time.Second,
		MaxInputRunes:       5000,
		ModelSlugObligation: "lex-obligation-extractor-llm",
	}, nil)
	llmItems, err := enricher.SuggestObligations(context.Background(), contract.TenantID, contract, contract.DocumentText, detItems)
	if err != nil {
		t.Fatalf("SuggestObligations() error = %v", err)
	}
	if !strings.Contains(prov.prompt, contract.DocumentText) {
		t.Fatal("fake provider did not receive contract text in the obligation prompt")
	}
	if len(llmItems) != 2 {
		t.Fatalf("llm items = %d, want 2 autonomous candidates: %#v", len(llmItems), llmItems)
	}

	merged := llm.MergeObligations(detItems, llmItems)
	drafts, skipped := draftsFromItems(contract, req, merged, time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC))
	if len(skipped) != 0 {
		t.Fatalf("skipped = %#v, want none", skipped)
	}
	if len(drafts) != 2 {
		t.Fatalf("drafts = %d, want 2 committable drafts", len(drafts))
	}
	for i, draft := range drafts {
		if err := validateObligationCreate(draft); err != nil {
			t.Fatalf("draft[%d] would fail Create validation: %v", i, err)
		}
		if draft.ContractID == nil || *draft.ContractID != contract.ID {
			t.Fatalf("draft[%d] contract_id = %v, want %s", i, draft.ContractID, contract.ID)
		}
		ext, ok := draft.Metadata["extraction"].(map[string]any)
		if !ok {
			t.Fatalf("draft[%d] extraction metadata missing: %#v", i, draft.Metadata)
		}
		if ext["source"] != "llm" || ext["deterministic"] != false || ext["extraction_strategy"] != "hybrid_llm_enriched" {
			t.Fatalf("draft[%d] extraction metadata = %#v, want llm hybrid source", i, ext)
		}
	}
	if !draftTitlesContain(drafts, "monthly SLA report") || !draftTitlesContain(drafts, "implementation invoice") {
		t.Fatalf("draft titles = %#v, want report and invoice obligations", draftTitles(drafts))
	}
}

type textDrivenObligationProvider struct {
	prompt string
}

func (p *textDrivenObligationProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("missing completion request")
	}
	if req.ResponseFormat != "tool" {
		return nil, fmt.Errorf("response format = %q, want tool", req.ResponseFormat)
	}
	if len(req.Tools) != 1 || req.Tools[0].Name != llm.ToolEmitObligations {
		return nil, fmt.Errorf("unexpected tool schema: %#v", req.Tools)
	}
	for _, msg := range req.Messages {
		if msg.Role == "user" {
			p.prompt = msg.Content
			break
		}
	}
	return &provider.CompletionResponse{
		ToolCalls: []llmmodel.LLMToolCall{{
			ID:           "autonomous_obligations",
			FunctionName: llm.ToolEmitObligations,
			Arguments: map[string]any{
				"obligations": textDrivenObligationArgs(p.prompt),
			},
		}},
		FinishReason: "tool_use",
	}, nil
}

func (p *textDrivenObligationProvider) Name() string                    { return "fake-text-driven" }
func (p *textDrivenObligationProvider) Model() string                   { return "local-obligation-extractor" }
func (p *textDrivenObligationProvider) SupportsParallelToolCalls() bool { return false }
func (p *textDrivenObligationProvider) MaxContextTokens() int           { return 200000 }
func (p *textDrivenObligationProvider) EstimateCost(int, int) float64   { return 0 }
func (p *textDrivenObligationProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Provider: p.Name(), Model: p.Model(), Status: "ok"}, nil
}

type textDrivenObligationResolver struct {
	prov provider.LLMProvider
}

func (r *textDrivenObligationResolver) Resolve(context.Context, uuid.UUID) (provider.LLMProvider, error) {
	return r.prov, nil
}

func textDrivenObligationArgs(text string) []any {
	matches := regexp.MustCompile(`(?is)\b(?:shall|must|will)\s+(.{3,160}?)\s+(?:no later than|on or before|by)\s+(\d{4}-\d{2}-\d{2})\b`).FindAllStringSubmatch(text, -1)
	out := make([]any, 0, len(matches))
	for _, match := range matches {
		action := cleanObligationAction(match[1])
		if action == "" {
			continue
		}
		obligationType := "contractual"
		lower := strings.ToLower(action)
		switch {
		case strings.Contains(lower, "report"):
			obligationType = string(model.ObligationTypeReporting)
		case strings.Contains(lower, "pay") || strings.Contains(lower, "invoice"):
			obligationType = string(model.ObligationTypePayment)
		case strings.Contains(lower, "notice"):
			obligationType = string(model.ObligationTypeNotice)
		}
		out = append(out, map[string]any{
			"title":            uppercaseFirst(action),
			"description":      "Autonomous obligation candidate extracted from contract text.",
			"obligation_type":  obligationType,
			"priority":         string(model.LegalPriorityHigh),
			"due_date":         match[2],
			"source_reference": "contract_text",
			"confidence":       0.88,
		})
	}
	return out
}

func cleanObligationAction(action string) string {
	action = strings.TrimSpace(action)
	action = strings.Trim(action, " .;:")
	action = strings.Join(strings.Fields(action), " ")
	for _, prefix := range []string{"the ", "a ", "an "} {
		if strings.HasPrefix(strings.ToLower(action), prefix) {
			return strings.TrimSpace(action[len(prefix):])
		}
	}
	return action
}

func uppercaseFirst(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.ToUpper(value[:1]) + value[1:]
}

func draftTitlesContain(drafts []dto.CreateObligationRequest, needle string) bool {
	needle = strings.ToLower(needle)
	for _, draft := range drafts {
		if strings.Contains(strings.ToLower(draft.Title), needle) {
			return true
		}
	}
	return false
}

func draftTitles(drafts []dto.CreateObligationRequest) []string {
	out := make([]string, 0, len(drafts))
	for _, draft := range drafts {
		out = append(out, draft.Title)
	}
	return out
}
