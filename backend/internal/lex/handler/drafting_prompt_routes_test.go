package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
)

// TestDraftingPromptRoutesCompose proves the AID-09 prompt-library routes are
// registered under both /lex and /watheeq, wired to the DraftingHandler.
func TestDraftingPromptRoutesCompose(t *testing.T) {
	logger := zerolog.Nop()
	drafting := NewDraftingHandler(service.NewDraftingService(nil, logger), logger)
	deps := RouteDependencies{
		Contract:        NewContractHandler(nil, nil, logger),
		Clause:          NewClauseHandler(nil, logger),
		Document:        NewDocumentHandler(nil, logger),
		Compliance:      NewComplianceHandler(nil, logger),
		Library:         NewLibraryHandler(nil, logger),
		Matter:          NewMatterHandler(nil, logger),
		Obligation:      NewObligationHandler(nil, logger),
		Signature:       NewSignatureHandler(nil, logger),
		Playbook:        NewPlaybookHandler(nil, logger),
		Dashboard:       NewDashboardHandler(nil, logger),
		Drafting:        drafting,
		RateLimitPerMin: 60,
	}
	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	want := []string{
		"GET /api/v1/lex/drafting/prompts",
		"POST /api/v1/lex/drafting/prompts",
		"GET /api/v1/lex/drafting/prompts/{id}",
		"PUT /api/v1/lex/drafting/prompts/{id}",
		"DELETE /api/v1/lex/drafting/prompts/{id}",
		"POST /api/v1/lex/drafting/prompts/{id}/run",
		"POST /api/v1/watheeq/drafting/prompts/{id}/run",
	}
	registered := map[string]bool{}
	if err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	}); err != nil {
		t.Fatalf("chi.Walk: %v", err)
	}
	for _, key := range want {
		if !registered[key] {
			t.Errorf("prompt route not registered: %s", key)
		}
	}
}
