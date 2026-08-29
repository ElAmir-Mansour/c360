//go:build integration

package integration

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestIntegrationConsole drives the lex Integration Platform end-to-end for a
// self-serve connector (kind=internal, the production-ready generic REST/webhook
// adapter that needs no external service). It exercises the full console flow —
// create-with-secret, masked read, sentinel-preserving update, schema, test,
// sync, sync-runs — and asserts the SECRET-REDACTION contract on the wire:
//
//   - a created secret is returned as the __redacted__ sentinel on every read;
//   - the raw secret string NEVER appears anywhere in any response body;
//   - updating with the sentinel preserves the stored secret (test still reaches
//     the configured base_url with valid bearer auth — no "missing secret").
//
// The connector's ConnectionTester / Probe perform a REAL authenticated GET
// against base_url, so we point base_url at a harness-local stub server. Test
// assertions are resilient: we assert the reachable/detail SHAPE against the stub
// rather than hard-coding a verdict that would depend on a live external system.
func TestIntegrationConsole(t *testing.T) {
	h := newLexHarness(t)

	// The plaintext secret that must NEVER surface in a response body. Chosen to be
	// distinctive so a substring search over raw JSON is decisive.
	const bearerSecret = "br-SECRET-2f9c1ad7-do-not-leak"

	// Harness-local stub the internal connector pings on Test/Probe. It records the
	// Authorization header so we can prove the preserved secret is actually applied
	// after a sentinel-only update (the secret is sent as "Bearer <token>").
	var lastAuth atomic.Value // string
	lastAuth.Store("")
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastAuth.Store(r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(stub.Close)

	// ---------------------------------------------------------------------------
	// 1) Create an ACTIVE internal endpoint WITH a secret field.
	// ---------------------------------------------------------------------------
	createReq := dto.CreateIntegrationEndpointRequest{
		Kind:        model.IntegrationKindInternal,
		Code:        "console-internal",
		Name:        "Console Internal Connector",
		Description: "End-to-end console-flow coverage",
		Status:      model.IntegrationStatusActive,
		Config: map[string]any{
			"base_url":     stub.URL,
			"auth_scheme":  "bearer",
			"bearer_token": bearerSecret,
		},
	}
	created := mustData[maskedEndpoint](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/integrations", createReq), http.StatusCreated)
	if created.ID == "" {
		t.Fatal("create returned empty endpoint id")
	}
	if created.Kind != string(model.IntegrationKindInternal) {
		t.Fatalf("created kind = %q, want internal", created.Kind)
	}
	// Secret is masked to the sentinel on the create response; base_url echoes.
	assertSecretSentinel(t, "create", created.Config)
	if got := stringField(created.Config, "base_url"); got != stub.URL {
		t.Fatalf("create: base_url not echoed, got %q want %q", got, stub.URL)
	}
	id := created.ID

	// ---------------------------------------------------------------------------
	// 2) GET single + GET list: secret masked, raw secret absent from raw JSON.
	// ---------------------------------------------------------------------------
	getBody, getEndpoint := rawAndDecode[maskedEndpoint](t, h, http.MethodGet, "/api/v1/lex/integrations/"+id)
	assertSecretSentinel(t, "get", getEndpoint.Config)
	assertNoRawSecret(t, "get", getBody, bearerSecret)

	listBody, listItems := rawAndDecode[[]maskedEndpoint](t, h, http.MethodGet, "/api/v1/lex/integrations")
	assertNoRawSecret(t, "list", listBody, bearerSecret)
	// The created endpoint appears in the list with a masked secret.
	foundInList := false
	for _, ep := range listItems {
		if ep.ID == id {
			foundInList = true
			assertSecretSentinel(t, "list", ep.Config)
		}
	}
	if !foundInList {
		t.Fatalf("created endpoint %s not present in list response: %s", id, listBody)
	}

	// ---------------------------------------------------------------------------
	// 3) PUT leaving the secret as the sentinel -> stored secret preserved.
	//     We change a non-secret field and echo the sentinel for bearer_token.
	// ---------------------------------------------------------------------------
	newDesc := "console-flow updated"
	updateReq := dto.UpdateIntegrationEndpointRequest{
		Description: &newDesc,
		Config: map[string]any{
			"base_url":     stub.URL,
			"auth_scheme":  "bearer",
			"bearer_token": "__redacted__", // sentinel -> keep stored ciphertext
		},
	}
	updBody, updated := rawAndDecodeBody[maskedEndpoint](t, h.doJSON(t, http.MethodPut, "/api/v1/lex/integrations/"+id, updateReq), http.StatusOK)
	assertSecretSentinel(t, "update", updated.Config)
	assertNoRawSecret(t, "update", updBody, bearerSecret)
	if updated.Description != newDesc {
		t.Fatalf("update: description = %q, want %q", updated.Description, newDesc)
	}

	// ---------------------------------------------------------------------------
	// 4) GET /integrations/schema/{kind} returns the FieldSpec list.
	// ---------------------------------------------------------------------------
	schema := mustData[dto.IntegrationSchemaResponse](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/integrations/schema/internal", nil), http.StatusOK)
	if schema.Kind != "internal" {
		t.Fatalf("schema kind = %q, want internal", schema.Kind)
	}
	if len(schema.Fields) == 0 {
		t.Fatal("schema returned no fields")
	}
	var sawBaseURL, sawSecretBearer bool
	for _, f := range schema.Fields {
		switch f.Key {
		case "base_url":
			sawBaseURL = true
			if !f.Required {
				t.Fatal("schema: base_url should be required")
			}
		case "bearer_token":
			sawSecretBearer = true
			if !f.Secret {
				t.Fatal("schema: bearer_token should be marked secret")
			}
		}
	}
	if !sawBaseURL || !sawSecretBearer {
		t.Fatalf("schema missing expected fields (base_url=%v, bearer_token=%v): %+v", sawBaseURL, sawSecretBearer, schema.Fields)
	}

	// ---------------------------------------------------------------------------
	// 5) POST /integrations/{id}/test -> a sanitized TestResult. Because the secret
	//     was preserved through the sentinel-only update, the connector reaches the
	//     stub with valid bearer auth and grades reachable. We assert the SHAPE
	//     (and that the stub saw the Bearer header), not a brittle live verdict.
	// ---------------------------------------------------------------------------
	testBody, testResult := rawAndDecodeBody[dto.IntegrationTestResponse](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/integrations/"+id+"/test", nil), http.StatusOK)
	assertNoRawSecret(t, "test", testBody, bearerSecret)
	if testResult.EndpointID != id {
		t.Fatalf("test: endpoint_id = %q, want %q", testResult.EndpointID, id)
	}
	if strings.Contains(strings.ToLower(testResult.Detail), "not_configured") {
		t.Fatalf("test: connector reported not_configured -> stored secret was NOT preserved through sentinel update: %q", testResult.Detail)
	}
	if !testResult.Reachable {
		t.Fatalf("test: expected the stub (200 OK) to be reachable, got detail=%q", testResult.Detail)
	}
	// The preserved bearer secret was actually applied to the outbound request.
	if auth, _ := lastAuth.Load().(string); auth != "Bearer "+bearerSecret {
		t.Fatalf("test: stub Authorization header = %q, want the preserved bearer token", auth)
	}

	// ---------------------------------------------------------------------------
	// 6) POST /integrations/{id}/sync -> internal is NOT a Syncer, so the registry
	//     returns an honest 422 failure (never a faked sync). The message is
	//     localized by the shared error layer; the status/code shape is the contract.
	// ---------------------------------------------------------------------------
	syncErr := mustError(t, h.doJSON(t, http.MethodPost, "/api/v1/lex/integrations/"+id+"/sync", nil), http.StatusUnprocessableEntity)
	if syncErr.Error.Code == "" || strings.TrimSpace(syncErr.Error.Message) == "" {
		t.Fatalf("sync: expected structured 422 error, got %+v", syncErr.Error)
	}

	// ---------------------------------------------------------------------------
	// 7) GET /integrations/{id}/sync-runs -> the ledger (empty for a non-syncer).
	// ---------------------------------------------------------------------------
	runs := mustData[[]dto.IntegrationSyncRunResponse](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/integrations/"+id+"/sync-runs", nil), http.StatusOK)
	if runs == nil {
		t.Fatal("sync-runs returned nil, want an (empty) ledger slice")
	}
	if len(runs) != 0 {
		t.Fatalf("sync-runs: a non-syncer endpoint should have no ledger rows, got %d", len(runs))
	}

	// Final belt-and-braces: the per-endpoint health probe also masks/sanitizes and
	// must not leak the secret in its raw body.
	healthBody, _ := rawAndDecode[map[string]any](t, h, http.MethodGet, "/api/v1/lex/integrations/"+id+"/health")
	assertNoRawSecret(t, "health", healthBody, bearerSecret)

	// Cleanup the registry rows we created (the shared harness cleanup does not).
	if _, err := h.env.db.Exec(t.Context(), `DELETE FROM lex_integration_sync_runs WHERE tenant_id = $1`, h.tenantID); err != nil {
		t.Fatalf("cleanup sync runs: %v", err)
	}
	if _, err := h.env.db.Exec(t.Context(), `DELETE FROM lex_integration_endpoints WHERE tenant_id = $1`, h.tenantID); err != nil {
		t.Fatalf("cleanup endpoints: %v", err)
	}
}

// maskedEndpoint is the minimal projection of model.IntegrationEndpoint we assert
// over on the wire — id/kind/description plus the masked Config map.
type maskedEndpoint struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Code        string         `json:"code"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Config      map[string]any `json:"config"`
}

// assertSecretSentinel asserts the secret field is exactly the __redacted__
// sentinel — never the real value, never absent.
func assertSecretSentinel(t *testing.T, where string, config map[string]any) {
	t.Helper()
	v, present := config["bearer_token"]
	if !present {
		t.Fatalf("%s: bearer_token missing from masked config %+v", where, config)
	}
	if got, _ := v.(string); got != "__redacted__" {
		t.Fatalf("%s: bearer_token = %v, want the __redacted__ sentinel (LEAK if real value)", where, v)
	}
}

// assertNoRawSecret string-searches a raw response body for the plaintext secret.
func assertNoRawSecret(t *testing.T, where, body, secret string) {
	t.Helper()
	if strings.Contains(body, secret) {
		t.Fatalf("SECRET LEAK: raw %s response body contains the plaintext secret: %s", where, body)
	}
}

func stringField(config map[string]any, key string) string {
	if v, ok := config[key].(string); ok {
		return v
	}
	return ""
}

// rawAndDecode does a GET and returns the raw body string AND a decoded value,
// asserting HTTP 200. It exists because mustData closes the body before we can
// string-search it.
func rawAndDecode[T any](t *testing.T, h *lexHarness, method, path string) (string, T) {
	t.Helper()
	return rawAndDecodeBody[T](t, h.doJSON(t, method, path, nil), http.StatusOK)
}

// rawAndDecodeBody reads the raw body from an already-issued response, asserts the
// status, and decodes the {"data":...} envelope.
func rawAndDecodeBody[T any](t *testing.T, resp *http.Response, wantStatus int) (string, T) {
	t.Helper()
	defer resp.Body.Close()
	raw := readBody(t, resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("response status = %d, want %d, body=%s", resp.StatusCode, wantStatus, raw)
	}
	var env dataEnvelope[T]
	decodeString(t, raw, &env)
	return raw, env.Data
}

func decodeString(t *testing.T, raw string, target any) {
	t.Helper()
	decodeBody(t, strings.NewReader(raw), target)
}
