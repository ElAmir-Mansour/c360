//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/handler"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func TestObligationRTMAutonomousExtractionCommitsLLMSuggestions(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contractText := joinSections(
		clauseSection(1, "Reporting", "Supplier shall submit the monthly SLA report by 2026-07-15."),
		clauseSection(2, "Payment", "Customer must pay the implementation invoice no later than 2026-08-01."),
	)
	contract := h.createContractWithText(t, "Watheeq Autonomous Obligation Contract", model.ContractTypeServiceAgreement, 725_000, contractText)

	prov := &integrationTextDrivenObligationProvider{}
	server := newAutonomousObligationExtractionServer(t, h, prov)
	defer server.Close()

	includeRenewal := false
	extraction := mustData[model.ObligationExtractionResult](t, h.doJSONAt(t, server.URL, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/contracts/%s/obligations/extract", contract.ID), dto.ExtractObligationsRequest{
		OwnerUserID:             h.userID,
		OwnerName:               "Integration Owner",
		IncludeContractRenewal:  &includeRenewal,
		DefaultReminderLeadDays: []int{14, 7},
		Tags:                    []string{"watheeq-rtm", "autonomous-extraction"},
		Metadata:                map[string]any{"commit": "autonomous-llm-route"},
	}), http.StatusCreated)

	if !strings.Contains(prov.prompt, contractText) {
		t.Fatal("fake provider did not receive persisted contract text")
	}
	if extraction.DeterministicStrategy != "hybrid_llm_enriched" {
		t.Fatalf("strategy = %q, want hybrid_llm_enriched", extraction.DeterministicStrategy)
	}
	if extraction.CreatedCount != 2 || len(extraction.Created) != 2 {
		t.Fatalf("created = %d/%d, want two autonomous obligations: %+v", extraction.CreatedCount, len(extraction.Created), extraction)
	}
	if len(extraction.Skipped) != 0 {
		t.Fatalf("skipped = %+v, want none", extraction.Skipped)
	}

	for _, created := range extraction.Created {
		if created.ContractID == nil || *created.ContractID != contract.ID {
			t.Fatalf("created contract_id = %v, want %s", created.ContractID, contract.ID)
		}
		if created.OwnerUserID != h.userID {
			t.Fatalf("created owner_user_id = %s, want %s", created.OwnerUserID, h.userID)
		}
		if created.Status != model.ObligationStatusOpen {
			t.Fatalf("created status = %s, want open", created.Status)
		}
		if !created.ReminderEnabled || len(created.ReminderLeadDays) != 2 {
			t.Fatalf("created reminder config = enabled:%v leads:%v, want default [14 7]", created.ReminderEnabled, created.ReminderLeadDays)
		}
		extractionMetadata, ok := created.Metadata["extraction"].(map[string]any)
		if !ok {
			t.Fatalf("created extraction metadata missing: %+v", created.Metadata)
		}
		if extractionMetadata["source"] != "llm" || extractionMetadata["deterministic"] != false {
			t.Fatalf("created extraction metadata = %#v, want llm/non-deterministic", extractionMetadata)
		}
	}
	if !obligationTitlesContain(extraction.Created, "monthly SLA report") || !obligationTitlesContain(extraction.Created, "implementation invoice") {
		t.Fatalf("created titles = %#v, want report and invoice obligations", obligationTitles(extraction.Created))
	}

	contractScoped := mustPaginated[model.Obligation](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/watheeq/contracts/%s/obligations?page=1&per_page=20", contract.ID), nil), http.StatusOK)
	for _, created := range extraction.Created {
		if !obligationSliceContains(contractScoped.Data, created.ID) {
			t.Fatalf("contract-scoped list missing autonomously extracted obligation %s in %+v", created.ID, contractScoped.Data)
		}
	}
}

func newAutonomousObligationExtractionServer(t *testing.T, h *lexHarness, prov provider.LLMProvider) *httptest.Server {
	t.Helper()

	enricher := llm.NewEnricher(&integrationTextDrivenObligationResolver{prov: prov}, nil, llm.Config{
		Enabled:             true,
		MaxTokens:           1024,
		Timeout:             time.Second,
		MaxInputRunes:       5000,
		ModelSlugObligation: "lex-obligation-extractor-llm",
	}, nil)
	obligationService := service.NewObligationService(
		h.env.db,
		h.env.app.Store.Obligations,
		h.env.app.Store.Contracts,
		h.env.app.Store.Matters,
		nil,
		h.env.app.Metrics,
		"",
		h.env.logger,
		enricher,
	)
	obligationHandler := handler.NewObligationHandler(obligationService, h.env.logger)

	router := chi.NewRouter()
	router.Route("/api/v1/watheeq", func(r chi.Router) {
		r.Use(sharedmw.Auth(h.env.jwt))
		r.Use(lexmw.TenantGuard)
		r.Use(lexmw.RateLimiter(h.env.rdb, 10000))
		r.With(sharedmw.RequirePermission(auth.PermLexWrite)).Post("/contracts/{id}/obligations/extract", obligationHandler.ExtractFromContract)
	})
	return httptest.NewServer(router)
}

func (h *lexHarness) doJSONAt(t *testing.T, baseURL, method, path string, body any) *http.Response {
	t.Helper()
	var payload io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body %T: %v", body, err)
		}
		payload = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, baseURL+path, payload)
	if err != nil {
		t.Fatalf("build request %s %s: %v", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer "+h.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("execute request %s %s: %v", method, path, err)
	}
	return resp
}

type integrationTextDrivenObligationProvider struct {
	prompt string
}

func (p *integrationTextDrivenObligationProvider) Complete(_ context.Context, req *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("missing completion request")
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
				"obligations": integrationTextDrivenObligationArgs(p.prompt),
			},
		}},
		FinishReason: "tool_use",
	}, nil
}

func (p *integrationTextDrivenObligationProvider) Name() string                    { return "fake-text-driven" }
func (p *integrationTextDrivenObligationProvider) Model() string                   { return "local-obligation-extractor" }
func (p *integrationTextDrivenObligationProvider) SupportsParallelToolCalls() bool { return false }
func (p *integrationTextDrivenObligationProvider) MaxContextTokens() int           { return 200000 }
func (p *integrationTextDrivenObligationProvider) EstimateCost(int, int) float64   { return 0 }
func (p *integrationTextDrivenObligationProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Provider: p.Name(), Model: p.Model(), Status: "ok"}, nil
}

type integrationTextDrivenObligationResolver struct {
	prov provider.LLMProvider
}

func (r *integrationTextDrivenObligationResolver) Resolve(context.Context, uuid.UUID) (provider.LLMProvider, error) {
	return r.prov, nil
}

func integrationTextDrivenObligationArgs(text string) []any {
	matches := regexp.MustCompile(`(?is)\b(?:shall|must|will)\s+(.{3,160}?)\s+(?:no later than|on or before|by)\s+(\d{4}-\d{2}-\d{2})\b`).FindAllStringSubmatch(text, -1)
	out := make([]any, 0, len(matches))
	for _, match := range matches {
		action := integrationCleanObligationAction(match[1])
		if action == "" {
			continue
		}
		obligationType := string(model.ObligationTypeContractual)
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
			"title":            integrationUppercaseFirst(action),
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

func integrationCleanObligationAction(action string) string {
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

func integrationUppercaseFirst(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.ToUpper(value[:1]) + value[1:]
}

func obligationTitlesContain(items []model.Obligation, needle string) bool {
	needle = strings.ToLower(needle)
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Title), needle) {
			return true
		}
	}
	return false
}

func obligationTitles(items []model.Obligation) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return out
}
