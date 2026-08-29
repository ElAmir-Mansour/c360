package config

import (
	"testing"
	"time"
)

func TestDefaultRoutes_ContainsAllServices(t *testing.T) {
	routes := DefaultRoutes()

	expectedPrefixes := map[string]bool{
		"/.well-known":            false,
		"/api/v1/auth":            false,
		"/api/v1/onboarding":      false,
		"/api/v1/invitations":     false,
		"/api/v1/users":           false,
		"/api/v1/roles":           false,
		"/api/v1/tenants":         false,
		"/api/v1/idp-connections": false,
		"/api/v1/api-keys":        false,
		"/api/v1/audit":           false,
		"/api/v1/workflows":       false,
		"/api/v1/notifications":   false,
		"/api/v1/files":           false,
		"/api/v1/licensing":       false,
		"/api/v1/dr":              false,
		"/api/v1/respond":         false,
		"/api/v1/cyber":           false,
		"/api/v1/rca":             false,
		"/api/v1/data":            false,
		"/api/v1/acta":            false,
		"/api/v1/lex":             false,
		"/api/v1/visus":           false,
		"/api/v1/siem":            false,
	}

	for _, route := range routes {
		if _, ok := expectedPrefixes[route.Prefix]; ok {
			expectedPrefixes[route.Prefix] = true
		}
	}

	for prefix, found := range expectedPrefixes {
		if !found {
			t.Errorf("expected route prefix %s not found", prefix)
		}
	}
}

func TestDefaultRoutes_AuthIsPublic(t *testing.T) {
	routes := DefaultRoutes()
	for _, route := range routes {
		if route.Prefix == "/api/v1/auth" {
			if !route.Public {
				t.Error("expected auth route to be public")
			}
			if route.EndpointGroup != EndpointGroupAuth {
				t.Errorf("expected auth endpoint group, got %s", route.EndpointGroup)
			}
			return
		}
	}
	t.Error("auth route not found")
}

func TestDefaultRoutes_ProtectedRoutesNotPublic(t *testing.T) {
	routes := DefaultRoutes()
	publicPrefixes := map[string]bool{
		"/.well-known":                               true,
		"/api/v1/auth":                               true,
		"/api/v1/onboarding/register":                true,
		"/api/v1/onboarding/verify-email":            true,
		"/api/v1/onboarding/resend-otp":              true,
		"/api/v1/onboarding/status":                  true,
		"/api/v1/invitations/validate":               true,
		"/api/v1/invitations/accept":                 true,
		"/api/v1/integrations/slack/oauth/start":     true,
		"/api/v1/integrations/slack/oauth/callback":  true,
		"/api/v1/integrations/slack/events":          true,
		"/api/v1/integrations/slack/commands":        true,
		"/api/v1/integrations/slack/interactions":    true,
		"/api/v1/integrations/teams/messages":        true,
		"/api/v1/integrations/jira/oauth/start":      true,
		"/api/v1/integrations/jira/oauth/callback":   true,
		"/api/v1/integrations/jira/webhook":          true,
		"/api/v1/integrations/servicenow/webhook":    true,
		"/api/v1/integrations/webhook/test-receiver": true,
		// Automation inbound webhook: token-authenticated (the path token IS the
		// credential, resolved cross-tenant by the service); carries no JWT.
		"/api/v1/automation/webhooks": true,
		"/api/v1/respond/stakeholder": true,
		// One-click unsubscribe: HMAC-signed token in the URL is the credential.
		"/api/v1/notifications/unsubscribe": true,
		// Lex pre-auth surfaces: registered OUTSIDE lex's JWT chain — the SSO
		// handshake is anonymous by design, the email-intake webhook is
		// HMAC-authenticated in-handler, and guest-portal routes authenticate via
		// the capability token in the path.
		"/api/v1/lex/auth/sso":                 true,
		"/api/v1/watheeq/auth/sso":             true,
		"/api/v1/lex/intake/email/webhook":     true,
		"/api/v1/watheeq/intake/email/webhook": true,
		"/api/v1/lex/editor/guest-portal":      true,
		"/api/v1/watheeq/editor/guest-portal":  true,
		"/api/docs/watheeq":                    true,
	}
	for _, route := range routes {
		if !publicPrefixes[route.Prefix] && route.Public {
			t.Errorf("expected route %s to not be public", route.Prefix)
		}
	}
}

func TestDefaultRoutes_SuiteRoutesDeclareEntitlements(t *testing.T) {
	routes := DefaultRoutes()
	expected := map[string]string{
		"/api/v1/cyber":   "suite.cyber",
		"/api/v1/rca":     "suite.cyber",
		"/api/v1/data":    "suite.data",
		"/api/v1/dr":      "suite.datastream",
		"/api/v1/respond": "respond.major_incident",
		"/api/v1/acta":    "app.acta",
		"/api/v1/lex":     "app.watheeq",
		"/api/v1/visus":   "app.bosalah",
		"/api/v1/siem":    "suite.siem",
	}

	found := make(map[string]bool, len(expected))
	for _, route := range routes {
		want, ok := expected[route.Prefix]
		if !ok {
			continue
		}
		found[route.Prefix] = true
		if route.Entitlement != want {
			t.Errorf("route %s entitlement = %q, want %q", route.Prefix, route.Entitlement, want)
		}
	}

	for prefix := range expected {
		if !found[prefix] {
			t.Errorf("expected entitlement-gated route %s not found", prefix)
		}
	}
}

func TestDefaultRoutes_LexPreAuthSurfacesArePublicAndNotPlanGated(t *testing.T) {
	// lex-service registers these routes OUTSIDE its JWT/TenantGuard chain
	// (lex/handler/routes.go): the SAML SSO handshake carries no session yet, the
	// email-intake webhook authenticates via HMAC inside the handler, and the
	// guest-portal routes authenticate via the capability token in the path.
	// Without public, non-plan-gated gateway entries the generic /api/v1/lex
	// route would 401/402 their anonymous callers, breaking SSO login,
	// email intake, and external guest review through the gateway.
	routes := DefaultRoutes()
	expected := map[string]EndpointGroup{
		"/api/v1/lex/auth/sso":                 EndpointGroupAuth,
		"/api/v1/watheeq/auth/sso":             EndpointGroupAuth,
		"/api/v1/lex/intake/email/webhook":     EndpointGroupWrite,
		"/api/v1/watheeq/intake/email/webhook": EndpointGroupWrite,
		"/api/v1/lex/editor/guest-portal":      EndpointGroupWrite,
		"/api/v1/watheeq/editor/guest-portal":  EndpointGroupWrite,
		"/api/docs/watheeq":                    EndpointGroupRead,
	}

	found := make(map[string]bool, len(expected))
	for _, route := range routes {
		wantGroup, ok := expected[route.Prefix]
		if !ok {
			continue
		}
		found[route.Prefix] = true
		if route.Service != "lex-service" {
			t.Errorf("route %s service = %s, want lex-service", route.Prefix, route.Service)
		}
		if !route.Public {
			t.Errorf("route %s must be public (pre-auth caller)", route.Prefix)
		}
		if route.Entitlement != "" {
			t.Errorf("route %s entitlement = %q, want empty (no tenant context pre-auth)", route.Prefix, route.Entitlement)
		}
		if route.EndpointGroup != wantGroup {
			t.Errorf("route %s endpoint group = %s, want %s", route.Prefix, route.EndpointGroup, wantGroup)
		}
	}

	for prefix := range expected {
		if !found[prefix] {
			t.Errorf("expected lex pre-auth route %s not found", prefix)
		}
	}
}

func TestDefaultRoutes_RecoverProductIsAuthedButNotPlanGated(t *testing.T) {
	// GET /api/recover/products must be reachable by every authenticated tenant
	// (so an unlicensed tenant can discover the product and request access), with
	// per-sub-solution entitlement resolved live in the response body. The route
	// is therefore authenticated (Public:false) but carries no gateway plan gate.
	routes := DefaultRoutes()
	for _, route := range routes {
		if route.Prefix != "/api/recover" {
			continue
		}
		if route.Service != "clario-dr-service" {
			t.Errorf("recover route service = %s, want clario-dr-service", route.Service)
		}
		if route.Public {
			t.Error("recover route must require authentication")
		}
		if route.Entitlement != "" {
			t.Errorf("recover route entitlement = %q, want empty (self-gated, live per-tenant resolution)", route.Entitlement)
		}
		return
	}
	t.Fatal("recover route /api/recover not found")
}

func TestDefaultRoutes_LicensingRouteIsReachableWithoutPlanGate(t *testing.T) {
	routes := DefaultRoutes()
	for _, route := range routes {
		if route.Prefix != "/api/v1/licensing" {
			continue
		}
		if route.Service != "license-service" {
			t.Errorf("licensing service = %s, want license-service", route.Service)
		}
		if route.Public {
			t.Error("licensing route must require authentication")
		}
		if route.Entitlement != "" {
			t.Errorf("licensing route entitlement = %q, want empty", route.Entitlement)
		}
		return
	}
	t.Fatal("licensing route not found")
}

func TestDefaultRoutes_Phase1ContractsDeclareGatewayMetadata(t *testing.T) {
	routes := DefaultRoutes()
	expected := map[string]ContractIntent{
		"/api/v1/licensing": {
			ID:         "license-entitlement",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
		"/api/v1/dr": {
			ID:         "clario-dr-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
		"/api/v1/respond": {
			ID:         "respond-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
		"/api/v1/respond/stakeholder": {
			ID:         "respond-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
		"/api/v1/migrate": {
			ID:         "migrate-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
		"/api/v1/migrate/product": {
			ID:         "migrate-service",
			Version:    "1.0.0",
			APIVersion: "v1",
			Phase:      "phase-1-foundation",
		},
	}

	found := make(map[string]bool, len(expected))
	for _, route := range routes {
		want, ok := expected[route.Prefix]
		if !ok {
			continue
		}
		found[route.Prefix] = true
		if route.Contract != want {
			t.Errorf("route %s contract = %#v, want %#v", route.Prefix, route.Contract, want)
		}
	}

	for prefix := range expected {
		if !found[prefix] {
			t.Errorf("expected contract route %s not found", prefix)
		}
	}
}

func TestDefaultServices_ContainsAllBackends(t *testing.T) {
	services := DefaultServices()

	expectedServices := map[string]bool{
		"iam-service":          false,
		"audit-service":        false,
		"workflow-engine":      false,
		"notification-service": false,
		"file-service":         false,
		"cyber-service":        false,
		"data-service":         false,
		"acta-service":         false,
		"lex-service":          false,
		"visus-service":        false,
		"siem-service":         false,
		"license-service":      false,
		"clario-dr-service":    false,
		"respond-service":      false,
		"migrate-service":      false,
	}

	for _, svc := range services {
		if _, ok := expectedServices[svc.Name]; ok {
			expectedServices[svc.Name] = true
		}
		if svc.URL == "" {
			t.Errorf("service %s has empty URL", svc.Name)
		}
		if svc.Timeout == 0 {
			t.Errorf("service %s has zero timeout", svc.Name)
		}
	}

	for name, found := range expectedServices {
		if !found {
			t.Errorf("expected service %s not found", name)
		}
	}
}

func TestDefaultServices_CyberTimeoutEnvOverride(t *testing.T) {
	t.Setenv("GW_SVC_TIMEOUT_CYBER_SEC", "75")

	services := DefaultServices()
	for _, svc := range services {
		if svc.Name != "cyber-service" {
			continue
		}
		if svc.Timeout != 75*time.Second {
			t.Fatalf("cyber-service timeout = %s, want 75s", svc.Timeout)
		}
		return
	}

	t.Fatal("cyber-service not found")
}

func TestDefaultRoutes_CyberTimeoutEnvOverride(t *testing.T) {
	t.Setenv("GW_SVC_TIMEOUT_CYBER_SEC", "75")

	routes := DefaultRoutes()
	found := 0
	for _, route := range routes {
		if route.Prefix != "/api/v1/cyber" && route.Prefix != "/api/v1/rca" {
			continue
		}
		found++
		if route.TimeoutSec != 75 {
			t.Fatalf("%s timeout = %d, want 75", route.Prefix, route.TimeoutSec)
		}
	}

	if found != 2 {
		t.Fatalf("found %d cyber routes, want 2", found)
	}
}
