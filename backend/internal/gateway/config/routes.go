package config

import (
	"os"
	"strconv"
	"time"
)

// EndpointGroup classifies routes for rate limiting purposes.
type EndpointGroup string

const (
	EndpointGroupAuth   EndpointGroup = "auth"
	EndpointGroupRead   EndpointGroup = "read"
	EndpointGroupWrite  EndpointGroup = "write"
	EndpointGroupAdmin  EndpointGroup = "admin"
	EndpointGroupUpload EndpointGroup = "upload"
	EndpointGroupWS     EndpointGroup = "ws"
)

// ContractIntent describes the API contract/version intent a gateway route is
// expected to carry to downstream services and audit taps.
type ContractIntent struct {
	ID         string `yaml:"id"`
	Version    string `yaml:"version"`
	APIVersion string `yaml:"api_version"`
	Phase      string `yaml:"phase"`
	FailClosed bool   `yaml:"fail_closed"`
}

// RouteConfig maps a URL prefix to a backend service.
type RouteConfig struct {
	Prefix        string        `yaml:"prefix"`
	Service       string        `yaml:"service"`
	StripPrefix   bool          `yaml:"strip_prefix"`
	Public        bool          `yaml:"public"`
	EndpointGroup EndpointGroup `yaml:"endpoint_group"`
	MaxBodyMB     int           `yaml:"max_body_mb"` // 0 = use global default
	TimeoutSec    int           `yaml:"timeout_sec"` // 0 = use global default
	// Entitlement is the licensing key a tenant must hold to reach this route
	// (e.g. "app.watheeq"). Empty means the route is not plan-gated: platform
	// services (IAM, audit, files, licensing itself) are always reachable.
	Entitlement string `yaml:"entitlement"`
	// Contract captures the API contract/version metadata for gateway-audited
	// routes. Empty fields keep legacy routes observe-only and compatible.
	Contract ContractIntent `yaml:"contract"`
}

// ServiceConfig holds backend service address configuration.
type ServiceConfig struct {
	Name    string        `yaml:"name"`
	URL     string        `yaml:"url"`
	Timeout time.Duration `yaml:"timeout"`
}

// DefaultRoutes returns the standard route configuration. Routes with longer prefixes
// should appear before shorter ones — the router sorts by prefix length descending at startup.
func DefaultRoutes() []RouteConfig {
	return []RouteConfig{
		// IAM - OIDC discovery
		{Prefix: "/.well-known", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},

		// IAM — Auth (public). The authenticated trusted-device routes need a
		// longer, more specific prefix so JWT is enforced/injected (longest-prefix
		// match wins); it MUST precede the generic public /api/v1/auth entry.
		{Prefix: "/api/v1/auth/devices", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/auth", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/onboarding/register", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/onboarding/verify-email", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/onboarding/resend-otp", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/onboarding/status", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/invitations/validate", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/invitations/accept", Service: "iam-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/ai", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},

		// IAM — User/Role/Tenant management
		{Prefix: "/api/v1/onboarding", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/invitations", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/users", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/roles", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},
		{Prefix: "/api/v1/tenants", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},
		// Tenant SSO / external IdP connection admin (Othaim PRD 12.0). A DISTINCT
		// prefix (NOT under the public /api/v1/auth catch-all) so JWT injection +
		// tenant scoping apply — the login-path /api/v1/auth/sso/* stays public.
		{Prefix: "/api/v1/idp-connections", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},
		{Prefix: "/api/v1/api-keys", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/notebooks", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupWrite},
		// Platform Administrative Console — cross-tenant control plane (iam-hosted; super-admin gated in-handler)
		{Prefix: "/api/v1/platform", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},
		{Prefix: "/api/v1/admin", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},
		{Prefix: "/api/v1/abac", Service: "iam-service", Public: false, EndpointGroup: EndpointGroupAdmin},

		// Audit
		{Prefix: "/api/v1/audit", Service: "audit-service", Public: false, EndpointGroup: EndpointGroupRead},

		// Workflow
		{Prefix: "/api/v1/workflows", Service: "workflow-engine", Public: false, EndpointGroup: EndpointGroupWrite},

		// Automation engine (DESIGN_Workflow_Forms_Automation.md §9). Ungated-core
		// like the workflow engine (no suite entitlement). The inbound webhook route
		// is token-authenticated (the path token IS the credential), so it is Public
		// (no JWT) and MUST precede the generic automation route — longer prefix wins.
		{Prefix: "/api/v1/automation/webhooks", Service: "automation", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/automation", Service: "automation", Public: false, EndpointGroup: EndpointGroupWrite},

		// Notifications (REST)
		// Public RFC 8058 one-click unsubscribe (#17): reached from an email link,
		// so it carries no session — trust comes from the HMAC-signed token in the
		// URL. Longer prefix precedes the authenticated /api/v1/notifications route
		// below (routes sort by prefix length descending) so it wins the match.
		{Prefix: "/api/v1/notifications/unsubscribe", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/notifications", Service: "notification-service", Public: false, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/slack/oauth/start", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/integrations/slack/oauth/callback", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/integrations/slack/events", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/slack/commands", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/slack/interactions", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/teams/messages", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/jira/oauth/start", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/integrations/jira/oauth/callback", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/integrations/jira/webhook", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/servicenow/webhook", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations/webhook/test-receiver", Service: "notification-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/integrations", Service: "notification-service", Public: false, EndpointGroup: EndpointGroupWrite},

		// Files — upload route MUST come before the generic files route (longer prefix wins).
		{Prefix: "/api/v1/files/upload", Service: "file-service", Public: false, EndpointGroup: EndpointGroupUpload, MaxBodyMB: 100, TimeoutSec: 120},
		{Prefix: "/api/v1/files", Service: "file-service", Public: false, EndpointGroup: EndpointGroupRead},

		// Licensing & Billing — the enforcement API itself is never plan-gated.
		{Prefix: "/api/v1/licensing", Service: "license-service", Public: false, EndpointGroup: EndpointGroupWrite, Contract: ContractIntent{ID: "license-entitlement", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},

		// Pricing & Quoting console — sibling of licensing on the same service
		// (pricing-console-design.md). Platform-admin surface; never plan-gated —
		// each route self-gates on the pricing:read/write/admin verbs.
		{Prefix: "/api/v1/pricing", Service: "license-service", Public: false, EndpointGroup: EndpointGroupWrite},

		// DataStream Suite — ClarioDR (DESIGN_DataStream_DR.md §9).
		{Prefix: "/api/v1/dr", Service: "clario-dr-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "suite.datastream", Contract: ContractIntent{ID: "clario-dr-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},

		// Clario Recover — product surface over DR (RECOVER_CONTRACT.md §3).
		// Intentionally NOT plan-gated at the gateway: GET /api/recover/products
		// must be reachable by every authenticated tenant so an unlicensed tenant
		// can still discover the product and see "request access". Per-sub-solution
		// entitlement is resolved live in the response body (entitlement.active),
		// and each route self-gates with RequirePermission (dr:read for products,
		// dr:admin for activation). The three recover.* keys remain enforced on the
		// underlying /api/v1/dr capability traffic.
		{Prefix: "/api/recover", Service: "clario-dr-service", Public: false, EndpointGroup: EndpointGroupWrite, Contract: ContractIntent{ID: "clario-dr-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},

		// Clario Respond — Major Incident Command Center.
		{Prefix: "/api/v1/respond/stakeholder", Service: "respond-service", Public: true, EndpointGroup: EndpointGroupRead, Contract: ContractIntent{ID: "respond-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},
		{Prefix: "/api/v1/respond", Service: "respond-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "respond.major_incident", Contract: ContractIntent{ID: "respond-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},

		// Clario Migrate — Cloud Migration Orchestration.
		{Prefix: "/api/v1/migrate/product", Service: "migrate-service", Public: false, EndpointGroup: EndpointGroupRead, Contract: ContractIntent{ID: "migrate-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},
		{Prefix: "/api/v1/migrate", Service: "migrate-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "migrate.cloud_migration", Contract: ContractIntent{ID: "migrate-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}},

		// Cybersecurity Suite
		{Prefix: "/api/v1/cyber", Service: "cyber-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "suite.cyber", TimeoutSec: intSecEnvOrDefault("GW_SVC_TIMEOUT_CYBER_SEC", 0)},
		{Prefix: "/api/v1/rca", Service: "cyber-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "suite.cyber", TimeoutSec: intSecEnvOrDefault("GW_SVC_TIMEOUT_CYBER_SEC", 0)},

		// Data Suite
		{Prefix: "/api/v1/data", Service: "data-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "suite.data"},

		// Governance Suite (Acta)
		{Prefix: "/api/v1/acta", Service: "acta-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "app.acta"},

		// Legal Suite (Lex / Watheeq) — pre-auth surfaces first. lex-service
		// registers these OUTSIDE its JWT/TenantGuard chain (lex/handler/routes.go):
		// the SAML SSO handshake carries no session yet, the email-intake webhook
		// authenticates via HMAC inside the handler, and the guest-portal routes
		// authenticate via the capability token in the path. They need public,
		// non-plan-gated entries with longer prefixes so the generic JWT+entitlement
		// lex routes below don't 401/402 their anonymous callers (same pattern as
		// /api/v1/notifications/unsubscribe and /api/v1/automation/webhooks).
		{Prefix: "/api/v1/lex/auth/sso", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/watheeq/auth/sso", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupAuth},
		{Prefix: "/api/v1/lex/intake/email/webhook", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/watheeq/intake/email/webhook", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/lex/editor/guest-portal", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupWrite},
		{Prefix: "/api/v1/watheeq/editor/guest-portal", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupWrite},
		// Developer Swagger/OpenAPI surface. lex-service enables it by default in
		// local/staging and requires LEX_SWAGGER_ENABLED=true in production.
		{Prefix: "/api/docs/watheeq", Service: "lex-service", Public: true, EndpointGroup: EndpointGroupRead},

		// Legal Suite (Lex / Watheeq). lex-service runs governed AI drafting whose
		// own budget is LEX_LLM_TIMEOUT (~60s); the default per-request gateway
		// deadline (GW_PROXY_TIMEOUT_SEC) is shorter and would cut a buffered
		// draft mid-generation, so both mounts carry an explicit override above
		// that budget (120s default, env-overridable like cyber via the same
		// GW_SVC_TIMEOUT_LEX_SEC used for the upstream Transport timeout). SSE
		// drafting streams bypass this deadline entirely (see middleware.Timeout).
		// Keep GW_WRITE_TIMEOUT_SEC strictly greater than this value at deploy —
		// config.Validate rejects the global proxy timeout ≥ write timeout.
		{Prefix: "/api/v1/watheeq", Service: "lex-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "app.watheeq", TimeoutSec: intSecEnvOrDefault("GW_SVC_TIMEOUT_LEX_SEC", 120)},
		{Prefix: "/api/v1/lex", Service: "lex-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "app.watheeq", TimeoutSec: intSecEnvOrDefault("GW_SVC_TIMEOUT_LEX_SEC", 120)},

		// Executive Intelligence (Visus360 / BOSALAH)
		{Prefix: "/api/v1/visus", Service: "visus-service", Public: false, EndpointGroup: EndpointGroupRead, Entitlement: "app.bosalah"},

		// SIEM Suite (SIEM-01). Single prefix; admin-only sub-paths
		// (/sources, /parsers, /settings) are enforced inside the
		// siem-service chi router via RequirePermission("siem:admin").
		// See RECON.md §3.2 for the rationale.
		{Prefix: "/api/v1/siem", Service: "siem-service", Public: false, EndpointGroup: EndpointGroupWrite, Entitlement: "suite.siem"},
	}
}

// DefaultWSRoutes returns authenticated WebSocket proxy routes.
func DefaultWSRoutes() []RouteConfig {
	return []RouteConfig{
		{Prefix: "/ws/v1/notifications", Service: "notification-service", Public: false, EndpointGroup: EndpointGroupWS},
		{Prefix: "/ws/v1/cyber", Service: "cyber-service", Public: false, EndpointGroup: EndpointGroupWS},
		{Prefix: "/ws/v1/visus", Service: "visus-service", Public: false, EndpointGroup: EndpointGroupWS},
	}
}

// DefaultServices returns the backend service configs, preferring GW_SVC_URL_* env vars.
func DefaultServices() []ServiceConfig {
	return []ServiceConfig{
		{Name: "iam-service", URL: envOrDefault("GW_SVC_URL_IAM", "http://localhost:8081"), Timeout: 30 * time.Second},
		{Name: "audit-service", URL: envOrDefault("GW_SVC_URL_AUDIT", "http://localhost:8084"), Timeout: 30 * time.Second},
		{Name: "workflow-engine", URL: envOrDefault("GW_SVC_URL_WORKFLOW", "http://localhost:8083"), Timeout: 60 * time.Second},
		{Name: "notification-service", URL: envOrDefault("GW_SVC_URL_NOTIFICATION", "http://localhost:8090"), Timeout: 30 * time.Second},
		{Name: "file-service", URL: envOrDefault("GW_SVC_URL_FILE", "http://localhost:8091"), Timeout: 120 * time.Second},
		{Name: "cyber-service", URL: envOrDefault("GW_SVC_URL_CYBER", "http://localhost:8085"), Timeout: durationSecEnvOrDefault("GW_SVC_TIMEOUT_CYBER_SEC", 30*time.Second)},
		{Name: "data-service", URL: envOrDefault("GW_SVC_URL_DATA", "http://localhost:8086"), Timeout: 60 * time.Second},
		{Name: "acta-service", URL: envOrDefault("GW_SVC_URL_ACTA", "http://localhost:8087"), Timeout: 30 * time.Second},
		// lex-service runs governed AI drafting/analysis (a generate + review pass
		// = multiple upstream LLM calls, ~25-40s), so it needs a higher upstream
		// ResponseHeaderTimeout than the 30s default. Env-overridable like cyber.
		{Name: "lex-service", URL: envOrDefault("GW_SVC_URL_LEX", "http://localhost:8088"), Timeout: durationSecEnvOrDefault("GW_SVC_TIMEOUT_LEX_SEC", 120*time.Second)},
		{Name: "visus-service", URL: envOrDefault("GW_SVC_URL_VISUS", "http://localhost:8089"), Timeout: 30 * time.Second},
		{Name: "siem-service", URL: envOrDefault("GW_SVC_URL_SIEM", "http://localhost:8094"), Timeout: 30 * time.Second},
		{Name: "license-service", URL: envOrDefault("GW_SVC_URL_LICENSE", "http://localhost:8096"), Timeout: 30 * time.Second},
		{Name: "clario-dr-service", URL: envOrDefault("GW_SVC_URL_DR", "http://localhost:8097"), Timeout: 30 * time.Second},
		{Name: "automation", URL: envOrDefault("GW_SVC_URL_AUTOMATION", "http://localhost:8098"), Timeout: 60 * time.Second},
		{Name: "respond-service", URL: envOrDefault("GW_SVC_URL_RESPOND", "http://localhost:8099"), Timeout: 30 * time.Second},
		{Name: "migrate-service", URL: envOrDefault("GW_SVC_URL_MIGRATE", "http://localhost:8100"), Timeout: 60 * time.Second},
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func durationSecEnvOrDefault(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if seconds, err := strconv.Atoi(v); err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return def
}

func intSecEnvOrDefault(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if seconds, err := strconv.Atoi(v); err == nil && seconds > 0 {
			return seconds
		}
	}
	return def
}
