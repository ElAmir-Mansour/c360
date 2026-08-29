package drafting

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

func TestDraftPleadingUsesDedicatedSchemaFastModelAndTokenCap(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title": "Statement of Claim",
		"body":  "To the competent court\n\nFacts\n1. The supplied facts...",
		"sections": []any{
			map[string]any{"heading": "Facts", "body": "1. The supplied facts..."},
			map[string]any{"heading": "Relief", "body": "The claimant requests..."},
		},
		"review_flags": []any{"Confirm the filing date."},
	}}
	d := NewDrafter(fakeResolver{prov: fp}, nil, Config{
		Enabled:          true,
		MaxTokens:        4096,
		InteractiveModel: "claude-sonnet-5",
	})

	out, err := d.DraftPleading(context.Background(), uuid.New(), PleadingDraftRequest{
		PleadingType:    "statement_of_claim",
		Direction:       "outgoing",
		PleadingTitle:   "Statement of Claim",
		CaseNumber:      "CASE-2026-001",
		CaseType:        "commercial",
		CompanyStatus:   "plaintiff",
		CaseDescription: "The counterparty did not pay the supplied invoice.",
		Language:        "en",
	})
	if err != nil {
		t.Fatalf("DraftPleading: %v", err)
	}
	if out.Body == "" || len(out.Sections) != 2 || out.Language != "en" {
		t.Fatalf("unexpected pleading: %+v", out)
	}
	if fp.lastReq == nil {
		t.Fatal("provider request was not captured")
	}
	if fp.lastReq.Model != "claude-sonnet-5" {
		t.Fatalf("model = %q, want interactive model", fp.lastReq.Model)
	}
	if fp.lastReq.MaxTokens != PleadingMaxOutputTokens {
		t.Fatalf("max tokens = %d, want %d", fp.lastReq.MaxTokens, PleadingMaxOutputTokens)
	}
	if len(fp.lastReq.Tools) != 1 || fp.lastReq.Tools[0].Name != "emit_pleading" {
		t.Fatalf("tool = %+v, want dedicated emit_pleading schema", fp.lastReq.Tools)
	}
	properties, _ := fp.lastReq.Tools[0].Parameters["properties"].(map[string]any)
	for _, field := range []string{"title", "body", "sections", "review_flags"} {
		if _, ok := properties[field]; !ok {
			t.Fatalf("pleading schema missing %q: %#v", field, properties)
		}
	}
	if !strings.Contains(fp.lastReq.SystemPrompt, "Saudi litigation counsel") {
		t.Fatalf("system prompt is not pleading-specific: %q", fp.lastReq.SystemPrompt)
	}
	if strings.Contains(fp.lastReq.SystemPrompt, "commercial contracts attorney") {
		t.Fatalf("pleading used generic contract system prompt: %q", fp.lastReq.SystemPrompt)
	}
}

func TestDraftPleadingDefaultsToArabicAndRejectsEmptyBody(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title": "صحيفة دعوى",
		"body":  " ",
	}}
	d := NewDrafter(fakeResolver{prov: fp}, nil, Config{
		Enabled:          true,
		InteractiveModel: "claude-sonnet-5",
	})

	_, err := d.DraftPleading(context.Background(), uuid.New(), PleadingDraftRequest{
		PleadingType:  "statement_of_claim",
		PleadingTitle: "صحيفة دعوى",
	})
	if err == nil || !strings.Contains(err.Error(), "pleading body is empty") {
		t.Fatalf("error = %v, want empty pleading body validation", err)
	}
	if !strings.Contains(fp.lastReq.Messages[0].Content, "Modern Standard Arabic") {
		t.Fatalf("default language prompt is not Arabic: %q", fp.lastReq.Messages[0].Content)
	}
}

func TestDraftContractKeepsProviderDefaultModel(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title": "Services Agreement",
		"sections": []any{
			map[string]any{"heading": "Services", "body": "The supplier provides services."},
		},
		"summary":    "A services agreement.",
		"open_items": []any{},
	}}
	d := NewDrafter(fakeResolver{prov: fp}, nil, Config{
		Enabled:          true,
		MaxTokens:        4096,
		InteractiveModel: "claude-sonnet-5",
	})

	if _, err := d.DraftContract(context.Background(), uuid.New(), ContractDraftRequest{
		ContractType: "services",
		DealTerms:    map[string]any{"supplier": "Example"},
		Language:     "en",
	}); err != nil {
		t.Fatalf("DraftContract: %v", err)
	}
	if fp.lastReq.Model != "" {
		t.Fatalf("generic contract model override = %q, want provider default", fp.lastReq.Model)
	}
	if fp.lastReq.MaxTokens != 4096 {
		t.Fatalf("generic contract max tokens = %d, want configured 4096", fp.lastReq.MaxTokens)
	}
}

type pleadingStreamingProvider struct {
	fakeProvider
	chunks []string
}

func (p *pleadingStreamingProvider) StreamComplete(
	_ context.Context,
	req *provider.CompletionRequest,
	handler provider.StreamHandler,
) (*provider.CompletionResponse, error) {
	p.lastReq = req
	var full strings.Builder
	for _, chunk := range p.chunks {
		full.WriteString(chunk)
		if handler.OnText != nil {
			if err := handler.OnText(chunk); err != nil {
				return nil, err
			}
		}
	}
	return &provider.CompletionResponse{
		Content: full.String(),
		Usage:   provider.TokenUsage{TotalTokens: 73},
	}, nil
}

func TestDraftPleadingStreamEmitsPlainTextWithInteractiveRouting(t *testing.T) {
	fp := &pleadingStreamingProvider{
		fakeProvider: fakeProvider{},
		chunks:       []string{"To the competent court\n\n", "Facts\n1. Supplied fact.", "\n\nRelief\n1. Payment."},
	}
	d := NewDrafter(fakeResolver{prov: fp}, nil, Config{
		Enabled:          true,
		MaxTokens:        4096,
		InteractiveModel: "claude-sonnet-5",
	})
	var emitted strings.Builder

	out, err := d.DraftPleadingStream(
		context.Background(),
		uuid.New(),
		PleadingDraftRequest{
			PleadingType:  "statement_of_claim",
			PleadingTitle: "Statement of Claim",
			Language:      "en",
		},
		func(delta string) { emitted.WriteString(delta) },
	)
	if err != nil {
		t.Fatalf("DraftPleadingStream: %v", err)
	}
	if out.Body != emitted.String() {
		t.Fatalf("body = %q, emitted = %q", out.Body, emitted.String())
	}
	if out.Meta["streamed"] != true || out.Meta["model"] != "claude-sonnet-5" {
		t.Fatalf("stream metadata = %#v", out.Meta)
	}
	if fp.lastReq.Model != "claude-sonnet-5" ||
		fp.lastReq.MaxTokens != PleadingMaxOutputTokens ||
		fp.lastReq.ResponseFormat != "text" {
		t.Fatalf("stream request = %+v", fp.lastReq)
	}
	if len(fp.lastReq.Tools) != 0 {
		t.Fatalf("stream must emit editor text rather than partial tool JSON: %+v", fp.lastReq.Tools)
	}
}

var _ provider.StreamingProvider = (*pleadingStreamingProvider)(nil)
var _ provider.LLMProvider = (*pleadingStreamingProvider)(nil)
