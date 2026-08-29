package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

// TestPlaybookRoutesCompose proves the WTQ-RSK-02 playbook CRUD routes and the
// clause-deviation route are registered by RegisterRoutes under both the /lex and
// /watheeq prefixes, wired to the PlaybookHandler.
func TestPlaybookRoutesCompose(t *testing.T) {
	logger := zerolog.Nop()
	deps := RouteDependencies{
		Contract:   NewContractHandler(nil, nil, logger),
		Clause:     NewClauseHandler(nil, logger),
		Document:   NewDocumentHandler(nil, logger),
		Compliance: NewComplianceHandler(nil, logger),
		Library:    NewLibraryHandler(nil, logger),
		Matter:     NewMatterHandler(nil, logger),
		Obligation: NewObligationHandler(nil, logger),
		Signature:  NewSignatureHandler(nil, logger),
		Playbook:   NewPlaybookHandler(nil, logger),
		Dashboard:  NewDashboardHandler(nil, logger),
		// JWTManager/Redis left nil: Auth middleware is attached but route
		// registration (the subject under test) does not require them.
		JWTManager:      nil,
		RateLimitPerMin: 60,
	}

	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	type routeCheck struct {
		method string
		path   string
	}
	want := []routeCheck{
		{http.MethodGet, "/api/v1/lex/playbooks"},
		{http.MethodPost, "/api/v1/lex/playbooks"},
		{http.MethodGet, "/api/v1/lex/playbooks/{id}"},
		{http.MethodPut, "/api/v1/lex/playbooks/{id}"},
		{http.MethodDelete, "/api/v1/lex/playbooks/{id}"},
		{http.MethodGet, "/api/v1/lex/contracts/{id}/clause-deviations"},
		// WTQ-RSK-02 #2/#3/#4/#6/#7/#8/#9 net-new playbook routes.
		{http.MethodGet, "/api/v1/lex/contracts/{id}/clause-deviations/export"},
		{http.MethodGet, "/api/v1/lex/contracts/{id}/clause-deviations/reviews"},
		{http.MethodPut, "/api/v1/lex/contracts/{id}/clause-deviations/reviews/{clauseType}"},
		{http.MethodGet, "/api/v1/lex/playbooks/portfolio"},
		{http.MethodGet, "/api/v1/lex/playbooks/templates"},
		{http.MethodPost, "/api/v1/lex/playbooks/templates/{key}/clone"},
		{http.MethodPost, "/api/v1/lex/playbooks/dry-run"},
		{http.MethodPost, "/api/v1/lex/playbooks/{id}/clone"},
		{http.MethodPost, "/api/v1/lex/playbooks/{id}/approval/start"},
		{http.MethodGet, "/api/v1/lex/playbooks/{id}/approval/tasks"},
		{http.MethodPost, "/api/v1/lex/playbooks/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision"},
		{http.MethodGet, "/api/v1/watheeq/playbooks"},
		{http.MethodGet, "/api/v1/watheeq/contracts/{id}/clause-deviations"},
	}

	registered := map[string]bool{}
	walkErr := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	})
	if walkErr != nil {
		t.Fatalf("chi.Walk error = %v", walkErr)
	}

	for _, wc := range want {
		key := wc.method + " " + wc.path
		if !registered[key] {
			t.Errorf("route not registered: %s", key)
		}
	}
}
