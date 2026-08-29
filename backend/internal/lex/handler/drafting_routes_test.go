package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
)

// TestDraftingRoutesCompose proves the AID-* generative drafting routes are
// registered by RegisterRoutes under both the /lex and /watheeq prefixes, wired
// to the DraftingHandler.
func TestDraftingRoutesCompose(t *testing.T) {
	logger := zerolog.Nop()
	// A disabled service (nil drafter) is sufficient: route registration does not
	// invoke the handler, only mounts it.
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
		"POST /api/v1/lex/drafting/clauses",
		"POST /api/v1/lex/drafting/contracts",
		"POST /api/v1/lex/drafting/clauses/rewrite",
		"POST /api/v1/lex/drafting/clauses/fallbacks",
		"POST /api/v1/lex/drafting/translate",
		"POST /api/v1/lex/drafting/summary",
		"POST /api/v1/lex/drafting/glossary",
		"POST /api/v1/lex/drafting/assemble",
		"POST /api/v1/lex/drafting/rfp-response",
		"POST /api/v1/lex/drafting/obligations/qa-review",
		// alias surface
		"POST /api/v1/watheeq/drafting/clauses",
		"POST /api/v1/watheeq/drafting/obligations/qa-review",
	}

	registered := map[string]bool{}
	if err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	}); err != nil {
		t.Fatalf("chi.Walk error = %v", err)
	}

	for _, key := range want {
		if !registered[key] {
			t.Errorf("drafting route not registered: %s", key)
		}
	}
}
