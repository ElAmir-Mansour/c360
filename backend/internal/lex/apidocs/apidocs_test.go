package apidocs

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestDocumentCoversGeneratedRouteInventory(t *testing.T) {
	body, err := DocumentJSON()
	if err != nil {
		t.Fatalf("DocumentJSON() error = %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatalf("parse complete OpenAPI JSON: %v", err)
	}
	var inventory routeInventory
	if err := json.Unmarshal(RouteInventoryJSON(), &inventory); err != nil {
		t.Fatalf("parse route inventory: %v", err)
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("complete OpenAPI document has no paths object")
	}
	covered := 0
	for _, route := range inventory.Operations {
		pathItem, ok := paths[route.Path].(map[string]any)
		if !ok {
			t.Errorf("missing path %s", route.Path)
			continue
		}
		operation, ok := pathItem[route.Method].(map[string]any)
		if !ok {
			t.Errorf("missing %s %s", strings.ToUpper(route.Method), route.Path)
			continue
		}
		if operation["operationId"] == "" {
			t.Errorf("%s %s has no operationId", strings.ToUpper(route.Method), route.Path)
		}
		covered++
	}
	if covered != inventory.CanonicalOperations {
		t.Fatalf("covered operations = %d, want %d", covered, inventory.CanonicalOperations)
	}
	for _, mounted := range []struct {
		method   string
		path     string
		security string
	}{
		{"get", "/auth/sso/initiate", ""},
		{"post", "/auth/sso/callback", ""},
		{"get", "/scim/v2/Users", "scimBearer"},
		{"patch", "/scim/v2/Groups/{id}", "scimBearer"},
		{"post", "/internal/lex/provision", "serviceToken"},
		{"post", "/intake/email/webhook", "webhookSignature"},
		{"post", "/webhooks/lex/nafath/verify/{tenantID}", "webhookSignature"},
	} {
		pathItem, ok := paths[mounted.path].(map[string]any)
		if !ok {
			t.Fatalf("mounted/root path %s is missing", mounted.path)
		}
		operation, ok := pathItem[mounted.method].(map[string]any)
		if !ok {
			t.Fatalf("mounted/root operation %s %s is missing", mounted.method, mounted.path)
		}
		operationSecurity, _ := operation["security"].([]any)
		if mounted.security == "" {
			if len(operationSecurity) != 0 {
				t.Fatalf("%s %s security = %#v, want public", mounted.method, mounted.path, operationSecurity)
			}
			continue
		}
		if len(operationSecurity) != 1 {
			t.Fatalf("%s %s security = %#v", mounted.method, mounted.path, operationSecurity)
		}
		securityRequirement, _ := operationSecurity[0].(map[string]any)
		if _, ok := securityRequirement[mounted.security]; !ok {
			t.Fatalf("%s %s security = %#v, want %s", mounted.method, mounted.path, operationSecurity, mounted.security)
		}
	}

	security, ok := doc["security"].([]any)
	if !ok || len(security) != 1 {
		t.Fatalf("global security = %#v, want bearer-only", doc["security"])
	}
	if _, promptsForTenant := security[0].(map[string]any)["tenantContext"]; promptsForTenant {
		t.Fatal("Swagger must not prompt browser clients for gateway-owned X-Tenant-ID")
	}
}

func TestSwaggerRoutesServeUIAndContracts(t *testing.T) {
	router := chi.NewRouter()
	RegisterRoutes(router)

	for _, tc := range []struct {
		path        string
		status      int
		contentType string
		contains    string
	}{
		{"/api/docs/watheeq", http.StatusOK, "text/html", "SwaggerUIBundle"},
		{"/api/docs/watheeq/", http.StatusOK, "text/html", "SwaggerUIBundle"},
		{"/api/docs/watheeq/openapi.json", http.StatusOK, "application/json", `"openapi": "3.1.0"`},
		{"/api/docs/watheeq/openapi.yaml", http.StatusOK, "application/yaml", "openapi: 3.1.0"},
		{"/api/docs/watheeq/routes.json", http.StatusOK, "application/json", `"canonical_operations"`},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Errorf("%s status = %d, want %d", tc.path, rec.Code, tc.status)
		}
		if tc.contentType != "" && !strings.HasPrefix(rec.Header().Get("Content-Type"), tc.contentType) {
			t.Errorf("%s Content-Type = %q, want prefix %q", tc.path, rec.Header().Get("Content-Type"), tc.contentType)
		}
		if tc.contains != "" && !strings.Contains(rec.Body.String(), tc.contains) {
			t.Errorf("%s body does not contain %q", tc.path, tc.contains)
		}
	}
}

func TestEnabledDefaultsOffInProductionAndSupportsOverride(t *testing.T) {
	t.Setenv("LEX_SWAGGER_ENABLED", "")
	t.Setenv("APP_ENV", "production")
	if Enabled() {
		t.Fatal("Enabled() = true in production without explicit override")
	}
	t.Setenv("LEX_SWAGGER_ENABLED", "true")
	if !Enabled() {
		t.Fatal("Enabled() = false with explicit true override")
	}
	t.Setenv("LEX_SWAGGER_ENABLED", "false")
	if Enabled() {
		t.Fatal("Enabled() = true with explicit false override")
	}
}
