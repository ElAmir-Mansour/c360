package apidocs

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

//go:embed phase1.openapi.yaml
var reviewedContractYAML []byte

//go:embed routes.generated.json
var routeInventoryJSON []byte

type routeInventory struct {
	SchemaVersion           int                       `json:"schema_version"`
	Source                  []string                  `json:"source"`
	SuitePrefixes           []string                  `json:"suite_prefixes"`
	RawRegisteredOperations int                       `json:"raw_registered_operations"`
	CanonicalOperations     int                       `json:"canonical_operations"`
	Operations              []routeInventoryOperation `json:"operations"`
}

type routeInventoryOperation struct {
	Method         string   `json:"method"`
	Path           string   `json:"path"`
	Scope          string   `json:"scope"`
	Public         bool     `json:"public"`
	Authentication string   `json:"authentication"`
	Handlers       []string `json:"handlers"`
	Sources        []string `json:"sources"`
	Aliases        []string `json:"aliases"`
}

var (
	documentOnce sync.Once
	documentJSON []byte
	documentYAML []byte
	documentErr  error
)

// Enabled reports whether the runtime Swagger surface should be registered.
// It is enabled by default outside production and can always be controlled
// explicitly with LEX_SWAGGER_ENABLED.
func Enabled() bool {
	if raw := strings.TrimSpace(os.Getenv("LEX_SWAGGER_ENABLED")); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		return err == nil && enabled
	}
	for _, key := range []string{"APP_ENV", "ENVIRONMENT", "CLARIO_ENV"} {
		if strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "production") {
			return false
		}
	}
	return true
}

// DocumentJSON returns the complete developer OpenAPI document: reviewed
// phase-1 schemas plus inventory-generated operations for every registered
// route. The returned slice is a copy and is safe for callers to retain.
func DocumentJSON() ([]byte, error) {
	buildDocument()
	if documentErr != nil {
		return nil, documentErr
	}
	return append([]byte(nil), documentJSON...), nil
}

// DocumentYAML returns the same complete document in YAML form.
func DocumentYAML() ([]byte, error) {
	buildDocument()
	if documentErr != nil {
		return nil, documentErr
	}
	return append([]byte(nil), documentYAML...), nil
}

// RouteInventoryJSON returns the generated route/source inventory used to
// build the full developer document.
func RouteInventoryJSON() []byte {
	return append([]byte(nil), routeInventoryJSON...)
}

// RegisterRoutes exposes Swagger UI and its raw OpenAPI contracts. These routes
// intentionally live outside the Lex JWT chain; production exposure is
// controlled by Enabled/LEX_SWAGGER_ENABLED at service startup.
func RegisterRoutes(r chi.Router) {
	r.Get("/api/docs/watheeq", serveSwaggerUI)
	r.Get("/api/docs/watheeq/", serveSwaggerUI)
	r.Get("/api/docs/watheeq/openapi.json", serveDocument("application/json", DocumentJSON))
	r.Get("/api/docs/watheeq/openapi.yaml", serveDocument("application/yaml", DocumentYAML))
	r.Get("/api/docs/watheeq/routes.json", func(w http.ResponseWriter, _ *http.Request) {
		writeDocumentationHeaders(w, "application/json")
		_, _ = w.Write(routeInventoryJSON)
	})
}

func serveDocument(contentType string, load func() ([]byte, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		body, err := load()
		if err != nil {
			http.Error(w, "OpenAPI document unavailable", http.StatusInternalServerError)
			return
		}
		writeDocumentationHeaders(w, contentType)
		_, _ = w.Write(body)
	}
}

func serveSwaggerUI(w http.ResponseWriter, _ *http.Request) {
	writeDocumentationHeaders(w, "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "+
			"script-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; connect-src 'self'")
	_, _ = w.Write([]byte(swaggerUIHTML))
}

func writeDocumentationHeaders(w http.ResponseWriter, contentType string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

func buildDocument() {
	documentOnce.Do(func() {
		var doc map[string]any
		if err := yaml.Unmarshal(reviewedContractYAML, &doc); err != nil {
			documentErr = fmt.Errorf("parse reviewed OpenAPI contract: %w", err)
			return
		}
		var inventory routeInventory
		if err := json.Unmarshal(routeInventoryJSON, &inventory); err != nil {
			documentErr = fmt.Errorf("parse generated route inventory: %w", err)
			return
		}

		enrichDocument(doc, inventory)
		documentJSON, documentErr = json.MarshalIndent(doc, "", "  ")
		if documentErr != nil {
			documentErr = fmt.Errorf("marshal complete OpenAPI JSON: %w", documentErr)
			return
		}
		documentJSON = append(documentJSON, '\n')
		documentYAML, documentErr = yaml.Marshal(doc)
		if documentErr != nil {
			documentErr = fmt.Errorf("marshal complete OpenAPI YAML: %w", documentErr)
		}
	})
}

func enrichDocument(doc map[string]any, inventory routeInventory) {
	info := mapValue(doc, "info")
	info["version"] = "1.1.0"
	info["summary"] = "Complete Watheeq / Lex developer API reference."
	info["x-documentation-view"] = "reviewed-contract-plus-route-inventory"
	info["x-route-coverage"] = map[string]any{
		"raw_registrations":    inventory.RawRegisteredOperations,
		"canonical_operations": inventory.CanonicalOperations,
		"inventory_source":     inventory.Source,
	}
	description, _ := info["description"].(string)
	info["description"] = strings.TrimSpace(description) + "\n\n" +
		"This developer view includes every direct and mounted Lex route. Operations marked " +
		"`reviewed` have precise request/response schemas; operations marked " +
		"`inventory-generated` expose the live path, method, handler and authentication " +
		"surface with generic payload schemas until their detailed contract is reviewed."

	// The gateway derives tenant context from the bearer token and overwrites
	// X-Tenant-ID. It must not be presented as a client-supplied authorization
	// credential in Swagger.
	doc["security"] = []any{map[string]any{"bearerAuth": []any{}}}

	components := mapValue(doc, "components")
	securitySchemes := mapValue(components, "securitySchemes")
	delete(securitySchemes, "tenantContext")
	securitySchemes["serviceToken"] = map[string]any{
		"type": "apiKey", "in": "header", "name": "X-Service-Token",
		"description": "Internal service-to-service authentication; not used by browser clients.",
	}
	securitySchemes["webhookSignature"] = map[string]any{
		"type": "apiKey", "in": "header", "name": "X-Signature",
		"description": "Provider-specific HMAC signature for public callback routes.",
	}
	securitySchemes["scimBearer"] = map[string]any{
		"type": "http", "scheme": "bearer",
		"description": "Per-tenant SCIM provisioning token; this is distinct from a Clario360 user JWT.",
	}

	schemas := mapValue(components, "schemas")
	schemas["InventoryGeneratedRequest"] = map[string]any{
		"type":                 "object",
		"additionalProperties": true,
		"description":          "Route-inventory placeholder. Use x-handler and x-source to locate the concrete Go DTO.",
	}
	schemas["InventoryGeneratedDataEnvelope"] = map[string]any{
		"type":     "object",
		"required": []any{"data"},
		"properties": map[string]any{
			"data": map[string]any{"description": "Operation-specific response data"},
			"meta": map[string]any{
				"type":                 "object",
				"additionalProperties": true,
				"description":          "Pagination or operation metadata when applicable.",
			},
		},
	}

	responses := mapValue(components, "responses")
	responses["PaymentRequired"] = errorResponse("Watheeq entitlement or plan access is required.")
	responses["TooManyRequests"] = errorResponse("The request exceeded the applicable rate limit.")
	responses["InternalServerError"] = errorResponse("The service could not complete the request.")

	paths := mapValue(doc, "paths")
	operationIDs := existingOperationIDs(paths)
	tagNames := existingTagNames(doc)

	for _, route := range inventory.Operations {
		pathItem := mapValue(paths, route.Path)
		if route.Scope == "root" {
			pathItem["servers"] = []any{map[string]any{"url": "/", "description": "Service root"}}
		}
		if existing, ok := pathItem[route.Method].(map[string]any); ok {
			existing["x-documentation-status"] = "reviewed"
			existing["x-handler"] = route.Handlers
			existing["x-source"] = route.Sources
			if len(route.Aliases) > 0 {
				existing["x-route-aliases"] = route.Aliases
			}
			continue
		}

		tag := routeTag(route.Path)
		if _, exists := tagNames[tag]; !exists {
			tagNames[tag] = struct{}{}
		}
		opID := uniqueOperationID(route, operationIDs)
		pathItem[route.Method] = inventoryOperation(route, tag, opID)
	}

	tags := make([]string, 0, len(tagNames))
	for tag := range tagNames {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	documentTags := make([]any, 0, len(tags))
	for _, tag := range tags {
		documentTags = append(documentTags, map[string]any{
			"name":        tag,
			"description": tag + " API operations.",
		})
	}
	doc["tags"] = documentTags
}

func inventoryOperation(route routeInventoryOperation, tag, operationID string) map[string]any {
	operation := map[string]any{
		"tags":                   []any{tag},
		"operationId":            operationID,
		"summary":                strings.ToUpper(route.Method) + " " + route.Path,
		"description":            "Automatically discovered from the live Chi route registry. The concrete handler and source are included for schema enrichment.",
		"x-documentation-status": "inventory-generated",
		"x-handler":              route.Handlers,
		"x-source":               route.Sources,
		"x-route-scope":          route.Scope,
	}
	if len(route.Aliases) > 0 {
		operation["x-route-aliases"] = route.Aliases
	}
	switch route.Authentication {
	case "public":
		operation["security"] = []any{}
	case "service_token":
		operation["security"] = []any{map[string]any{"serviceToken": []any{}}}
	case "scim_bearer":
		operation["security"] = []any{map[string]any{"scimBearer": []any{}}}
	case "webhook_signature":
		operation["security"] = []any{map[string]any{"webhookSignature": []any{}}}
	}

	if parameters := pathParameters(route.Path); len(parameters) > 0 {
		operation["parameters"] = parameters
	}
	if route.Method == "post" || route.Method == "put" || route.Method == "patch" {
		operation["requestBody"] = map[string]any{
			"required": false,
			"content": map[string]any{
				"application/json": map[string]any{
					"schema": map[string]any{"$ref": "#/components/schemas/InventoryGeneratedRequest"},
				},
			},
		}
	}

	success := map[string]any{
		"200": map[string]any{
			"description": "Successful response.",
			"content": map[string]any{
				"application/json": map[string]any{
					"schema": map[string]any{"$ref": "#/components/schemas/InventoryGeneratedDataEnvelope"},
				},
			},
		},
	}
	if route.Method == "post" {
		success["201"] = success["200"]
	}
	if route.Method == "delete" {
		success["204"] = map[string]any{"$ref": "#/components/responses/NoContent"}
	}
	for status, response := range map[string]string{
		"400": "BadRequest",
		"401": "Unauthorized",
		"402": "PaymentRequired",
		"403": "Forbidden",
		"404": "NotFound",
		"409": "Conflict",
		"429": "TooManyRequests",
		"500": "InternalServerError",
	} {
		success[status] = map[string]any{"$ref": "#/components/responses/" + response}
	}
	operation["responses"] = success
	return operation
}

func errorResponse(description string) map[string]any {
	return map[string]any{
		"description": description,
		"content": map[string]any{
			"application/json": map[string]any{
				"schema": map[string]any{"$ref": "#/components/schemas/ErrorResponse"},
			},
		},
	}
}

var pathParameterPattern = regexp.MustCompile(`\{([^}]+)\}`)

func pathParameters(path string) []any {
	matches := pathParameterPattern.FindAllStringSubmatch(path, -1)
	parameters := make([]any, 0, len(matches))
	for _, match := range matches {
		parameters = append(parameters, map[string]any{
			"name": match[1], "in": "path", "required": true,
			"schema": map[string]any{"type": "string"},
		})
	}
	return parameters
}

func existingOperationIDs(paths map[string]any) map[string]struct{} {
	ids := map[string]struct{}{}
	for _, rawPathItem := range paths {
		pathItem, ok := rawPathItem.(map[string]any)
		if !ok {
			continue
		}
		for _, method := range []string{"get", "post", "put", "patch", "delete"} {
			if operation, ok := pathItem[method].(map[string]any); ok {
				if id, _ := operation["operationId"].(string); id != "" {
					ids[id] = struct{}{}
				}
			}
		}
	}
	return ids
}

func existingTagNames(doc map[string]any) map[string]struct{} {
	names := map[string]struct{}{}
	if tags, ok := doc["tags"].([]any); ok {
		for _, rawTag := range tags {
			if tag, ok := rawTag.(map[string]any); ok {
				if name, _ := tag["name"].(string); name != "" {
					names[name] = struct{}{}
				}
			}
		}
	}
	return names
}

func uniqueOperationID(route routeInventoryOperation, used map[string]struct{}) string {
	var builder strings.Builder
	builder.WriteString("inventory")
	builder.WriteString(titleToken(route.Method))
	for _, token := range strings.FieldsFunc(route.Path, func(r rune) bool {
		return r == '/' || r == '-' || r == '_' || r == '{' || r == '}'
	}) {
		if token != "" {
			builder.WriteString(titleToken(token))
		}
	}
	candidate := builder.String()
	if _, exists := used[candidate]; exists {
		candidate += fmt.Sprintf("%08x", crc32.ChecksumIEEE([]byte(route.Method+" "+route.Path)))
	}
	used[candidate] = struct{}{}
	return candidate
}

func titleToken(value string) string {
	runes := []rune(value)
	if len(runes) == 0 {
		return ""
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func routeTag(path string) string {
	for _, segment := range strings.Split(strings.Trim(path, "/"), "/") {
		if segment == "" || strings.HasPrefix(segment, "{") {
			continue
		}
		return titleToken(strings.ReplaceAll(strings.ReplaceAll(segment, "-", " "), "_", " "))
	}
	return "General"
}

func mapValue(parent map[string]any, key string) map[string]any {
	if value, ok := parent[key].(map[string]any); ok {
		return value
	}
	value := map[string]any{}
	parent[key] = value
	return value
}

const swaggerUIHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watheeq / Lex API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>body{margin:0;background:#f6f8f7}.topbar{display:none}.swagger-ui .info{margin:32px 0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/docs/watheeq/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
      requestInterceptor: function (request) {
        request.headers["X-Request-ID"] = request.headers["X-Request-ID"] || crypto.randomUUID();
        request.headers["X-Locale"] = request.headers["X-Locale"] || "en";
        return request;
      }
    });
  </script>
</body>
</html>`
