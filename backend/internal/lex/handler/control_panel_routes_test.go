package handler

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

// Keep the consolidated production read mounted on both suite aliases so a
// router refactor cannot silently break the panel while frontend mocks pass.
func TestCasesControlPanelRouteIsRegisteredOnBothSuiteAliases(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, testRouteDependencies(zerolog.Nop()))
	registered := registeredRoutes(t, r)

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		key := http.MethodGet + " " + prefix + "/dashboard/cases-control"
		if !registered[key] {
			t.Errorf("Cases Control Panel route is not registered: %s", key)
		}
	}
}
