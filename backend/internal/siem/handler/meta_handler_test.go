package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/siem/handler"
	"github.com/clario360/platform/internal/siem/service"
)

func newTestJWT(t *testing.T) *auth.JWTManager {
	t.Helper()
	m, err := auth.NewJWTManager(config.AuthConfig{
		JWTIssuer:       "siem-test",
		AccessTokenTTL:  10 * time.Minute,
		RefreshTokenTTL: time.Hour,
	})
	require.NoError(t, err)
	return m
}

func mint(t *testing.T, m *auth.JWTManager, tenantID string, roles []string) string {
	t.Helper()
	pair, err := m.GenerateTokenPair("user-1", tenantID, "u@x", roles, "sid")
	require.NoError(t, err)
	return pair.AccessToken
}

func TestMetaHandler_ReturnsJSON(t *testing.T) {
	t.Parallel()
	jwtMgr := newTestJWT(t)
	r := handler.NewRouter(handler.Deps{
		Meta: service.NewMetaService(nil),
		JWT:  jwtMgr,
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/_meta", nil)
	req.Header.Set("Authorization", "Bearer "+mint(t, jwtMgr, "tenant-7", []string{"analyst"}))
	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "siem-service", body["service"])
	require.Equal(t, "tenant-7", body["tenant_id"])
	require.NotEmpty(t, body["version"])
	require.NotEmpty(t, body["go_version"])
}

func TestMetaHandler_RejectsMissingJWT(t *testing.T) {
	t.Parallel()
	r := handler.NewRouter(handler.Deps{
		Meta: service.NewMetaService(nil),
		JWT:  newTestJWT(t),
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/_meta")
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestMetaHandler_RejectsMissingTenant(t *testing.T) {
	t.Parallel()
	jwtMgr := newTestJWT(t)
	r := handler.NewRouter(handler.Deps{
		Meta: service.NewMetaService(nil),
		JWT:  jwtMgr,
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	// Token with empty tenant id.
	tok := mint(t, jwtMgr, "", []string{"analyst"})

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/_meta", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	// The platform tenant middleware returns 400 MISSING_TENANT.
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestMetaHandler_NotReady(t *testing.T) {
	t.Parallel()
	jwtMgr := newTestJWT(t)
	r := handler.NewRouter(handler.Deps{
		Meta:     service.NewMetaService(nil),
		JWT:      jwtMgr,
		NotReady: func() bool { return true },
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/_meta", nil)
	req.Header.Set("Authorization", "Bearer "+mint(t, jwtMgr, "tenant-1", []string{"analyst"}))
	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
}

func TestRouter_AdminPathsRequirePerm(t *testing.T) {
	t.Parallel()
	jwtMgr := newTestJWT(t)
	r := handler.NewRouter(handler.Deps{
		Meta: service.NewMetaService(nil),
		JWT:  jwtMgr,
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	// analyst lacks siem:admin → 403.
	{
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/sources", nil)
		req.Header.Set("Authorization", "Bearer "+mint(t, jwtMgr, "t1", []string{"analyst"}))
		resp, err := srv.Client().Do(req)
		require.NoError(t, err)
		resp.Body.Close()
		require.Equal(t, http.StatusForbidden, resp.StatusCode)
	}

	// super_admin (admin:* wildcard) → 501 NOT_IMPLEMENTED.
	{
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/sources", nil)
		req.Header.Set("Authorization", "Bearer "+mint(t, jwtMgr, "t1", []string{"super_admin"}))
		resp, err := srv.Client().Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusNotImplemented, resp.StatusCode)
		buf := make([]byte, 256)
		n, _ := resp.Body.Read(buf)
		require.True(t, strings.Contains(string(buf[:n]), "NOT_IMPLEMENTED"))
	}
}
