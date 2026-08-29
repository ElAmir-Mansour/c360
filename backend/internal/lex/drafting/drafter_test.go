package drafting

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// fakeProvider is a test double for the external LLM. It echoes the requested
// tool name (so requireToolArgs always matches) and returns canned arguments.
// This exercises the REAL engine decode/governance/timeout logic without a
// network call — it is a dependency double, not a feature stub.
type fakeProvider struct {
	args    map[string]any
	err     error
	lastReq *provider.CompletionRequest
}

func (f *fakeProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	f.lastReq = req
	if f.err != nil {
		return nil, f.err
	}
	name := ""
	if len(req.Tools) > 0 {
		name = req.Tools[0].Name
	}
	return &provider.CompletionResponse{
		ToolCalls: []llmmodel.LLMToolCall{{FunctionName: name, Arguments: f.args}},
		Usage:     provider.TokenUsage{TotalTokens: 42},
	}, nil
}

func (f *fakeProvider) Name() string                    { return "fake" }
func (f *fakeProvider) Model() string                   { return "claude-opus-4-8" }
func (f *fakeProvider) SupportsParallelToolCalls() bool { return false }
func (f *fakeProvider) MaxContextTokens() int           { return 200000 }
func (f *fakeProvider) EstimateCost(_, _ int) float64   { return 0 }
func (f *fakeProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Provider: "fake", Status: "ok"}, nil
}

type fakeResolver struct{ prov provider.LLMProvider }

func (f fakeResolver) Resolve(context.Context, uuid.UUID) (provider.LLMProvider, error) {
	return f.prov, nil
}

func enabledDrafter(p provider.LLMProvider) *Drafter {
	// predLog nil => ungoverned narrow path (still per-tenant resolver).
	return NewDrafter(fakeResolver{prov: p}, nil, Config{Enabled: true})
}

func TestGenerateClause_DecodesToolOutput(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title": "Limitation of Liability", "clause_type": "limitation_of_liability",
		"text": "Neither party shall be liable...", "risk_level": "medium",
		"assumptions": []any{"mutual cap"},
	}}
	d := enabledDrafter(fp)
	out, err := d.GenerateClause(context.Background(), uuid.New(), ClauseRequest{Intent: "cap our liability", Language: "en"})
	if err != nil {
		t.Fatalf("GenerateClause: %v", err)
	}
	if out.Title != "Limitation of Liability" || out.Text == "" || out.RiskLevel != "medium" {
		t.Fatalf("unexpected clause: %+v", out)
	}
	if out.Language != "en" {
		t.Fatalf("language not normalized: %q", out.Language)
	}
	// The request must demand the structured tool and omit sampling params.
	if fp.lastReq.ResponseFormat != "tool" || fp.lastReq.TemperatureSet {
		t.Fatalf("request not tool-mode/temperature-omitted: %+v", fp.lastReq)
	}
}

func TestDraftContractRejectsNullSections(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title":      "Master Services Agreement",
		"sections":   nil,
		"summary":    "Managed services agreement.",
		"open_items": nil,
	}}
	d := enabledDrafter(fp)

	_, err := d.DraftContract(context.Background(), uuid.New(), ContractDraftRequest{
		ContractType: "service_agreement",
		DealTerms:    map[string]any{"customer": "Watheeq"},
		Language:     "en",
	})
	if !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("want ErrInvalidOutput for null sections, got %v", err)
	}
}

func TestDraftContractCanonicalizesEmptyOpenItems(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{
		"title": "Master Services Agreement",
		"sections": []any{
			map[string]any{"heading": "Services", "body": "Supplier will provide the services."},
		},
		"summary":    "Managed services agreement.",
		"open_items": nil,
	}}
	d := enabledDrafter(fp)

	out, err := d.DraftContract(context.Background(), uuid.New(), ContractDraftRequest{
		ContractType: "service_agreement",
		DealTerms:    map[string]any{"customer": "Watheeq"},
		Language:     "en",
	})
	if err != nil {
		t.Fatalf("DraftContract: %v", err)
	}
	if out.OpenItems == nil || len(out.OpenItems) != 0 {
		t.Fatalf("open_items = %#v, want canonical empty slice", out.OpenItems)
	}
}

func TestTranslate_DecodesEquivalence(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{"translation": "نص", "equivalence": "partial", "caveats": []any{"term X differs"}}}
	d := enabledDrafter(fp)
	out, err := d.Translate(context.Background(), uuid.New(), TranslateRequest{Text: "text", SourceLang: "english", TargetLang: "arabic"})
	if err != nil {
		t.Fatalf("Translate: %v", err)
	}
	if out.Equivalence != "partial" || out.TargetLang != "ar" || out.SourceLang != "en" {
		t.Fatalf("unexpected translation: %+v", out)
	}
}

func TestSuggestFallbacks_DecodesList(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{"fallbacks": []any{
		map[string]any{"label": "A", "text": "...", "concession_level": "minimal"},
		map[string]any{"label": "B", "text": "...", "concession_level": "moderate"},
	}}}
	d := enabledDrafter(fp)
	out, err := d.SuggestFallbacks(context.Background(), uuid.New(), FallbackRequest{ClauseText: "indemnity clause"})
	if err != nil {
		t.Fatalf("SuggestFallbacks: %v", err)
	}
	if len(out.Fallbacks) != 2 || out.Fallbacks[0].ConcessionLevel != "minimal" {
		t.Fatalf("unexpected fallbacks: %+v", out)
	}
}

func TestDrafter_DisabledReturnsSentinel(t *testing.T) {
	d := NewDrafter(nil, nil, Config{Enabled: false})
	if d.Enabled() {
		t.Fatal("drafter should be disabled with nil resolver")
	}
	_, err := d.GenerateClause(context.Background(), uuid.New(), ClauseRequest{Intent: "x"})
	if !errors.Is(err, ErrDraftingDisabled) {
		t.Fatalf("want ErrDraftingDisabled, got %v", err)
	}
}

func TestDrafter_NoToolCallSurfaces(t *testing.T) {
	// Provider returns an error -> method must surface it (no silent empty draft).
	fp := &fakeProvider{err: errors.New("boom")}
	d := enabledDrafter(fp)
	_, err := d.Summarize(context.Background(), uuid.New(), SummaryRequest{Text: "long contract"})
	if err == nil {
		t.Fatal("expected error from provider failure")
	}
}

func TestAssemble_ConditionalLogicAndSubstitution(t *testing.T) {
	req := AssembleRequest{
		Sections: []TemplateSection{
			{ID: "intro", Heading: "Agreement", Body: "Between {{party_a}} and {{party_b}}."},
			{ID: "arb", Heading: "Arbitration", Body: "Disputes go to arbitration.", Condition: "include_arbitration == true"},
			{ID: "court", Heading: "Courts", Body: "Disputes go to courts.", Condition: "include_arbitration != true"},
			{ID: "missing", Heading: "Gap", Body: "Owner: {{owner}}"},
		},
		Variables: map[string]any{"party_a": "Acme", "party_b": "Globex", "include_arbitration": true},
	}
	out, err := Assemble(req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	if !contains(out.IncludedSections, "arb") || contains(out.IncludedSections, "court") {
		t.Fatalf("conditional selection wrong: included=%v skipped=%v", out.IncludedSections, out.SkippedSections)
	}
	if !contains(out.UnresolvedVars, "owner") {
		t.Fatalf("expected unresolved var 'owner', got %v", out.UnresolvedVars)
	}
	if want := "Between Acme and Globex."; !containsStr(out.Document, want) {
		t.Fatalf("substitution failed, document=%q", out.Document)
	}
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func containsStr(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle || indexOf(haystack, needle) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
