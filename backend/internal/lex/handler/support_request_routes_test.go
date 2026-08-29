package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

func TestSupportRequestRoutesComposeWithStaticDirectoryBeforeDetail(t *testing.T) {
	deps := testRouteDependencies(zerolog.Nop())
	deps.SupportRequest = NewSupportRequestHandler(nil, zerolog.Nop())
	router := chi.NewRouter()
	RegisterRoutes(router, deps)

	registered := map[string]bool{}
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, route := range []string{
			"POST " + prefix + "/support-requests",
			"GET " + prefix + "/support-requests",
			"GET " + prefix + "/support-requests/directory",
			"GET " + prefix + "/support-requests/expiry-preview",
			"GET " + prefix + "/support-requests/{id}",
			"POST " + prefix + "/support-requests/{id}/accept",
			"POST " + prefix + "/support-requests/{id}/decline",
			"POST " + prefix + "/support-requests/{id}/resolve",
			"POST " + prefix + "/support-requests/{id}/cancel",
			// The approval gate: authority is being the approver frozen on the
			// row, enforced in the service. No new permission is minted for it.
			"POST " + prefix + "/support-requests/{id}/approve",
			"POST " + prefix + "/support-requests/{id}/reject",
		} {
			if !registered[route] {
				t.Errorf("support route not registered: %s", route)
			}
		}
	}
}
