package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/repository"
)

func nowFn() time.Time { return time.Now().UTC() }

func scimTokenRecord(tenantID, endpointID uuid.UUID) *repository.SCIMToken {
	return &repository.SCIMToken{
		ID: uuid.New(), TenantID: tenantID, EndpointID: endpointID, TokenPrefix: "lexscim_test",
	}
}

// scimTestServer wires the SCIMServer with in-memory fakes and an httptest server.
func scimTestServer(t *testing.T) (*httptest.Server, *fakeIDStore, *fakeOrgStore, uuid.UUID, uuid.UUID, string) {
	t.Helper()
	idMap := newFakeIDStore()
	org := newFakeOrgStore()
	s := NewSCIMServer(idMap, org, zerolog.Nop())

	tenantID := uuid.New()
	endpointID := uuid.New()
	const rawToken = "lexscim_unit-test-token"
	idMap.tokens[hashTok(rawToken)] = scimTokenRecord(tenantID, endpointID)

	root := chi.NewRouter()
	root.Mount("/scim/v2", s.Routes())
	srv := httptest.NewServer(root)
	t.Cleanup(srv.Close)
	return srv, idMap, org, tenantID, endpointID, rawToken
}

func hashTok(raw string) string { return repository.HashSCIMToken(raw) }

func doSCIM(t *testing.T, srv *httptest.Server, method, path, token string, body any) *http.Response {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/scim+json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	return resp
}

// =============================================================================
// Bearer auth: accept valid, reject missing / malformed / unknown / revoked.
// =============================================================================

func TestSCIM_BearerAuth_AcceptsValid(t *testing.T) {
	srv, _, _, _, _, token := scimTestServer(t)
	resp := doSCIM(t, srv, http.MethodGet, "/scim/v2/ServiceProviderConfig", token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("valid token should reach discovery, got %d", resp.StatusCode)
	}
}

func TestSCIM_BearerAuth_RejectsMissingAndBad(t *testing.T) {
	srv, idMap, _, tenantID, endpointID, _ := scimTestServer(t)
	cases := []struct {
		name, header string
	}{
		{"missing", ""},
		{"not-bearer", "Basic abc"},
		{"empty-bearer", "Bearer "},
		{"unknown-token", "Bearer lexscim_does-not-exist"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, srv.URL+"/scim/v2/ServiceProviderConfig", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			resp, err := srv.Client().Do(req)
			if err != nil {
				t.Fatalf("do: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s: want 401, got %d", tc.name, resp.StatusCode)
			}
		})
	}

	// A revoked token must be rejected (fail-closed).
	revoked := "lexscim_revoked"
	rec := scimTokenRecord(tenantID, endpointID)
	now := nowFn()
	rec.RevokedAt = &now
	idMap.tokens[hashTok(revoked)] = rec
	resp := doSCIM(t, srv, http.MethodGet, "/scim/v2/ServiceProviderConfig", revoked, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("revoked token must be rejected, got %d", resp.StatusCode)
	}
}

// =============================================================================
// User + Group provisioning and idempotency.
// =============================================================================

func TestSCIM_CreateGroup_UpsertsOrgEntity(t *testing.T) {
	srv, _, org, tenantID, _, token := scimTestServer(t)
	resp := doSCIM(t, srv, http.MethodPost, "/scim/v2/Groups", token, map[string]any{
		"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:Group"},
		"externalId":  "G-LEGAL",
		"displayName": "Legal",
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create group: want 201, got %d", resp.StatusCode)
	}
	if _, err := org.GetByCode(context.Background(), tenantID, "G-LEGAL"); err != nil {
		t.Errorf("expected org entity for the group: %v", err)
	}
}

func TestSCIM_CreateUser_RecordsMapping(t *testing.T) {
	srv, idMap, _, tenantID, endpointID, token := scimTestServer(t)
	resp := doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, map[string]any{
		"schemas":    []string{"urn:ietf:params:scim:schemas:core:2.0:User"},
		"externalId": "ext-1",
		"userName":   "alice@example.com",
		"active":     true,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user: want 201, got %d", resp.StatusCode)
	}
	m, err := idMap.GetMapping(context.Background(), nil, tenantID, endpointID, "ext-1")
	if err != nil {
		t.Fatalf("expected mapping for ext-1: %v", err)
	}
	if !m.Active {
		t.Errorf("new user mapping should be active")
	}
}

func TestSCIM_CreateUser_BoundRoleWhenResolvable(t *testing.T) {
	srv, _, org, _, _, token := scimTestServer(t)
	// Pre-create the org entity the role binds to.
	doSCIM(t, srv, http.MethodPost, "/scim/v2/Groups", token, map[string]any{
		"externalId": "LEGAL", "displayName": "Legal",
	}).Body.Close()
	lexUser := uuid.New().String()
	resp := doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, map[string]any{
		"externalId": "ext-2", "userName": "boss",
		"urn:clario360:lex:1.0:User": map[string]any{
			"orgCode": "LEGAL", "roleKey": "legal_director", "lexUserId": lexUser,
		},
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user: want 201, got %d", resp.StatusCode)
	}
	if org.roleUpsert != 1 {
		t.Errorf("expected a role binding, got %d UpsertRole calls", org.roleUpsert)
	}
}

func TestSCIM_Idempotent_Replay(t *testing.T) {
	srv, idMap, _, _, _, token := scimTestServer(t)
	payload := map[string]any{"externalId": "ext-9", "userName": "carol", "active": true}
	doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, payload).Body.Close()
	first := idMap.upserts
	// Replaying the identical PUT must be a no-op (same content hash).
	resp := doSCIM(t, srv, http.MethodPut, "/scim/v2/Users/ext-9", token, payload)
	resp.Body.Close()
	if idMap.upserts != first {
		t.Errorf("idempotent replay should not re-upsert: %d -> %d", first, idMap.upserts)
	}
}

// =============================================================================
// Deprovision: PATCH active=false + DELETE soft-deactivate.
// =============================================================================

func TestSCIM_PatchActiveFalse_SoftDeactivates(t *testing.T) {
	srv, idMap, _, tenantID, endpointID, token := scimTestServer(t)
	doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, map[string]any{
		"externalId": "ext-d", "userName": "dan", "active": true,
	}).Body.Close()

	resp := doSCIM(t, srv, http.MethodPatch, "/scim/v2/Users/ext-d", token, map[string]any{
		"schemas":    []string{"urn:ietf:params:scim:api:messages:2.0:PatchOp"},
		"Operations": []map[string]any{{"op": "replace", "path": "active", "value": false}},
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch: want 200, got %d", resp.StatusCode)
	}
	m, err := idMap.GetMapping(context.Background(), nil, tenantID, endpointID, "ext-d")
	if err != nil {
		t.Fatalf("get mapping: %v", err)
	}
	if m.Active {
		t.Errorf("active=false PATCH should soft-deactivate the mapping")
	}
}

func TestSCIM_Delete_SoftDeactivates(t *testing.T) {
	srv, idMap, _, tenantID, endpointID, token := scimTestServer(t)
	doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, map[string]any{
		"externalId": "ext-x", "userName": "x", "active": true,
	}).Body.Close()

	resp := doSCIM(t, srv, http.MethodDelete, "/scim/v2/Users/ext-x", token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: want 204, got %d", resp.StatusCode)
	}
	m, err := idMap.GetMapping(context.Background(), nil, tenantID, endpointID, "ext-x")
	if err != nil {
		t.Fatalf("mapping should still exist (soft delete): %v", err)
	}
	if m.Active {
		t.Errorf("DELETE should soft-deactivate, not hard-delete")
	}
}

// =============================================================================
// Discovery is well-formed SCIM.
// =============================================================================

func TestSCIM_ServiceProviderConfig_Shape(t *testing.T) {
	srv, _, _, _, _, token := scimTestServer(t)
	resp := doSCIM(t, srv, http.MethodGet, "/scim/v2/ServiceProviderConfig", token, nil)
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "scim+json") {
		t.Errorf("content-type should be scim+json, got %q", ct)
	}
	var cfg map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	schemas, _ := cfg["schemas"].([]any)
	if len(schemas) == 0 {
		t.Errorf("ServiceProviderConfig must carry a schemas array")
	}
	if _, ok := cfg["authenticationSchemes"]; !ok {
		t.Errorf("ServiceProviderConfig must advertise authenticationSchemes")
	}
}

// =============================================================================
// Token issuance round-trips through the resolver (rotate revokes the old).
// =============================================================================

func TestIssueSCIMToken_ResolvesAndRotates(t *testing.T) {
	idMap := newFakeIDStore()
	s := NewSCIMServer(idMap, newFakeOrgStore(), zerolog.Nop())
	tenantID, endpointID := uuid.New(), uuid.New()

	issued, err := s.IssueSCIMToken(context.Background(), nil, tenantID, endpointID, nil, "ci", false, nil)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if !strings.HasPrefix(issued.RawToken, "lexscim_") {
		t.Errorf("raw token should carry the brand prefix: %q", issued.RawToken)
	}
	// The raw token resolves.
	if _, err := idMap.ResolveTokenByHash(context.Background(), repository.HashSCIMToken(issued.RawToken), nowFn()); err != nil {
		t.Errorf("issued token should resolve: %v", err)
	}
	// Rotate: a new token revokes the previous one.
	issued2, err := s.IssueSCIMToken(context.Background(), nil, tenantID, endpointID, nil, "ci2", true, nil)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if _, err := idMap.ResolveTokenByHash(context.Background(), repository.HashSCIMToken(issued.RawToken), nowFn()); err == nil {
		t.Errorf("rotated-out token must no longer resolve")
	}
	if _, err := idMap.ResolveTokenByHash(context.Background(), repository.HashSCIMToken(issued2.RawToken), nowFn()); err != nil {
		t.Errorf("new token after rotate should resolve: %v", err)
	}
}
