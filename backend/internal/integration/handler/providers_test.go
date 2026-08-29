package handler

import (
	"testing"

	"github.com/clario360/platform/internal/integration/connector/adapters"
	intmodel "github.com/clario360/platform/internal/integration/model"
)

// TestMergeProviders_SurfacesNewConnectors verifies that the providers endpoint
// data reflects the registry: curated entries (slack) keep their OAuth/config
// status while gaining manifest metadata, and the new connectors
// (email/pagerduty/rest) — which have NO curated entry — still appear, with their
// manifest schema and outbound capability.
func TestMergeProviders_SurfacesNewConnectors(t *testing.T) {
	registry := adapters.BuildDefaultRegistry(adapters.Clients{})

	curated := []ProviderStatus{
		{
			Type:             intmodel.IntegrationTypeSlack,
			Name:             "Slack",
			SetupMode:        "oauth",
			OAuthEnabled:     true,
			OAuthStartURL:    "https://gw/api/v1/integrations/slack/oauth/start",
			SupportsInbound:  true,
			SupportsOutbound: true,
		},
	}

	merged := mergeProviders(curated, registry)

	byType := make(map[intmodel.IntegrationType]ProviderStatus, len(merged))
	for _, p := range merged {
		byType[p.Type] = p
	}

	// All eight connectors present.
	if len(merged) != 8 {
		t.Fatalf("expected 8 providers, got %d (%v)", len(merged), byType)
	}

	// Curated slack entry preserved its OAuth metadata AND gained manifest fields.
	slack := byType[intmodel.IntegrationTypeSlack]
	if !slack.OAuthEnabled || slack.OAuthStartURL == "" {
		t.Errorf("slack curated OAuth metadata lost: %+v", slack)
	}
	if slack.Capabilities == "" || len(slack.ConfigSchema) == 0 {
		t.Errorf("slack manifest fields not layered on: %+v", slack)
	}

	// New connectors surfaced with manifest + outbound capability.
	for _, typ := range []intmodel.IntegrationType{
		intmodel.IntegrationTypeEmail,
		intmodel.IntegrationTypePagerDuty,
		intmodel.IntegrationTypeREST,
	} {
		p, ok := byType[typ]
		if !ok {
			t.Fatalf("new connector %q not surfaced in providers", typ)
		}
		if !p.SupportsOutbound {
			t.Errorf("new connector %q should be outbound-capable", typ)
		}
		if len(p.ConfigSchema) == 0 {
			t.Errorf("new connector %q missing config schema", typ)
		}
		if p.Name == "" {
			t.Errorf("new connector %q missing display name", typ)
		}
	}

	// Deterministic ordering by type.
	for i := 1; i < len(merged); i++ {
		if merged[i-1].Type > merged[i].Type {
			t.Fatalf("providers not sorted by type at %d: %q > %q", i, merged[i-1].Type, merged[i].Type)
		}
	}
}

// TestMergeProviders_NilRegistry returns the curated list unchanged.
func TestMergeProviders_NilRegistry(t *testing.T) {
	curated := []ProviderStatus{{Type: intmodel.IntegrationTypeSlack, Name: "Slack"}}
	merged := mergeProviders(curated, nil)
	if len(merged) != 1 || merged[0].Type != intmodel.IntegrationTypeSlack {
		t.Fatalf("nil registry should return curated unchanged, got %+v", merged)
	}
}
