package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/handler"
	"github.com/clario360/platform/internal/siem/service"
)

// TestRouter_NoJWTRouterStillRejectsAtTenant exercises the case where
// no JWTManager is wired (e.g., in a unit test): tenant middleware
// then rejects with 400 because no tenant has been resolved.
func TestRouter_NoJWTRouterStillRejectsAtTenant(t *testing.T) {
	t.Parallel()
	r := handler.NewRouter(handler.Deps{
		Meta: service.NewMetaService(nil),
		// JWT intentionally nil
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/_meta")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}
