package ai

import (
	"testing"

	"github.com/clario360/platform/internal/lex/service"
)

// Compile-time locks on the seams app.go wires. If a lex service's signature
// drifts, this fails at build time rather than at runtime in a deployment that
// has the assistant switched on.
var (
	_ DashboardReader      = (*service.DashboardService)(nil)
	_ ResolutionRateReader = (*service.ResolutionRateService)(nil)
	_ WorkforceReader      = (*service.WorkforceService)(nil)

	_ ChatService  = (*Service)(nil)
	_ sessionStore = (*Store)(nil)
)

// Every tool the model is told about must be dispatchable, and every
// dispatchable tool must be advertised. A schema/dispatcher drift means either
// a tool the model can never successfully call, or a capability it never
// discovers.
func TestAdvertisedToolsMatchDispatcher(t *testing.T) {
	advertised := map[string]bool{}
	for _, schema := range toolSchemas() {
		if schema.Name == "" {
			t.Fatal("a tool schema has no name")
		}
		if schema.Description == "" {
			t.Errorf("tool %q has no description; the model selects tools from descriptions", schema.Name)
		}
		if schema.InputSchema == nil {
			t.Errorf("tool %q has no input schema", schema.Name)
		}
		advertised[schema.Name] = true
	}

	dispatchable := []string{toolPortfolioSummary, toolDomainDetail, toolTeamWorkload}
	if len(advertised) != len(dispatchable) {
		t.Fatalf("advertised %d tool(s), dispatcher handles %d", len(advertised), len(dispatchable))
	}
	for _, name := range dispatchable {
		if !advertised[name] {
			t.Errorf("tool %q is dispatchable but never advertised to the model", name)
		}
	}
}

// The domain enum advertised to the model must be exactly the set the grounding
// layer accepts, or the model will be told to ask for a domain that errors.
func TestDomainEnumMatchesGroundingDomains(t *testing.T) {
	var enum []string
	for _, schema := range toolSchemas() {
		if schema.Name != toolDomainDetail {
			continue
		}
		properties := schema.InputSchema["properties"].(map[string]any)
		domain := properties["domain"].(map[string]any)
		enum = domain["enum"].([]string)
	}
	if len(enum) != len(legalDomains) {
		t.Fatalf("advertised %d domain(s), grounding accepts %d", len(enum), len(legalDomains))
	}
	for _, domain := range enum {
		if !knownDomain(domain) {
			t.Errorf("advertised domain %q is not accepted by the grounding layer", domain)
		}
	}
}

// The assistant is strictly read-only. This locks the promise: nothing in the
// tool surface may name a write verb.
func TestNoToolAdvertisesAWriteVerb(t *testing.T) {
	writeVerbs := []string{"create", "update", "delete", "approve", "assign", "close", "sign", "execute", "sql", "query"}
	for _, schema := range toolSchemas() {
		for _, verb := range writeVerbs {
			if containsFold(schema.Name, verb) {
				t.Errorf("tool %q names the write/free-query verb %q; the assistant has no write or SQL path", schema.Name, verb)
			}
		}
	}
}

func containsFold(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexFold(haystack, needle) >= 0
}

func indexFold(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			a, b := haystack[i+j], needle[j]
			if a >= 'A' && a <= 'Z' {
				a += 'a' - 'A'
			}
			if b >= 'A' && b <= 'Z' {
				b += 'a' - 'A'
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
