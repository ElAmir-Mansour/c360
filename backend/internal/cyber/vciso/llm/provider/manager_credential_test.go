package provider

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
	llmdto "github.com/clario360/platform/internal/cyber/vciso/llm/dto"
)

// fakeResolver is an in-memory TenantCredentialResolver -- no crypto, no DB.
type fakeResolver struct {
	byTenant map[uuid.UUID]*ResolvedCredential
	err      error
	calls    int
}

func (f *fakeResolver) ResolveCredential(_ context.Context, tenantID uuid.UUID) (*ResolvedCredential, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	cred, ok := f.byTenant[tenantID]
	if !ok || cred == nil {
		return nil, nil
	}
	// Return a fresh copy each call so the caller can zero APIKey without
	// corrupting the stored fixture (mirrors the real resolver decrypting anew).
	keyCopy := append([]byte(nil), cred.APIKey...)
	return &ResolvedCredential{
		Provider: cred.Provider,
		Model:    cred.Model,
		APIKey:   keyCopy,
		Enabled:  cred.Enabled,
		Version:  cred.Version,
	}, nil
}

func anthropicCfg() *llmcfg.Config {
	return &llmcfg.Config{
		DefaultProvider: "anthropic",
		Providers: map[string]llmcfg.ProviderConfig{
			"anthropic": {
				APIKeyEnv:      "ANTHROPIC_API_KEY",
				Model:          "claude-opus-4-8",
				MaxTokens:      32,
				TimeoutSeconds: 5,
			},
			"openai": {
				APIKeyEnv:      "OPENAI_API_KEY",
				Model:          "gpt-4o",
				MaxTokens:      32,
				TimeoutSeconds: 5,
			},
		},
	}
}

// Back-compat: a nil resolver behaves EXACTLY as today -- env key is used and
// there is NO fail-closed.
func TestManager_NilResolver_UsesEnvKey(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-global-key")
	m := NewManager(anthropicCfg())

	p, err := m.Resolve(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	ap, ok := p.(*AnthropicProvider)
	if !ok {
		t.Fatalf("provider type = %T, want *AnthropicProvider", p)
	}
	if ap.apiKey != "env-global-key" {
		t.Fatalf("apiKey = %q, want env-global-key", ap.apiKey)
	}
}

// Back-compat: nil resolver + no env key must NOT fail closed (today's behavior).
func TestManager_NilResolver_NoEnvKey_DoesNotFailClosed(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	m := NewManager(anthropicCfg())

	p, err := m.Resolve(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Resolve must not fail closed with nil resolver: %v", err)
	}
	if ap, ok := p.(*AnthropicProvider); !ok || ap.apiKey != "" {
		t.Fatalf("expected empty-key anthropic provider, got %T key=%q", p, ap.apiKey)
	}
}

// Resolver present but no per-tenant row: falls back to the global env key.
func TestManager_Resolver_NoRow_FallsBackToEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-global-key")
	m := NewManagerWithCredentials(anthropicCfg(), &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{}})

	p, err := m.Resolve(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	ap, ok := p.(*AnthropicProvider)
	if !ok || ap.apiKey != "env-global-key" {
		t.Fatalf("expected env-global-key fallback, got %T", p)
	}
}

// Step 1 wins: a per-tenant credential overrides the global env key.
func TestManager_PerTenantCredential_WinsOverEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-global-key")
	tenant := uuid.New()
	res := &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{
		tenant: {Provider: "anthropic", Model: "claude-opus-4-8", APIKey: []byte("tenant-secret-key"), Enabled: true, Version: 1},
	}}
	m := NewManagerWithCredentials(anthropicCfg(), res)

	p, err := m.Resolve(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	ap := p.(*AnthropicProvider)
	if ap.apiKey != "tenant-secret-key" {
		t.Fatalf("apiKey = %q, want tenant-secret-key (per-tenant must win over env)", ap.apiKey)
	}
}

// A per-tenant credential's provider/model override the default selection.
func TestManager_PerTenantCredential_OverridesProviderAndModel(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	tenant := uuid.New()
	res := &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{
		tenant: {Provider: "openai", Model: "gpt-4o-mini", APIKey: []byte("tenant-openai-key"), Enabled: true, Version: 1},
	}}
	m := NewManagerWithCredentials(anthropicCfg(), res) // default is anthropic

	p, err := m.Resolve(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	op, ok := p.(*OpenAIProvider)
	if !ok {
		t.Fatalf("provider type = %T, want *OpenAIProvider (credential provider override)", p)
	}
	if op.apiKey != "tenant-openai-key" {
		t.Fatalf("apiKey = %q, want tenant-openai-key", op.apiKey)
	}
	if op.model != "gpt-4o-mini" {
		t.Fatalf("model = %q, want gpt-4o-mini (credential model override)", op.model)
	}
}

// Step 3: resolver wired + no per-tenant row + no env key + key-requiring
// provider => fail closed with the exact message.
func TestManager_FailClosed_WhenNoCredentialAndNoEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	m := NewManagerWithCredentials(anthropicCfg(), &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{}})

	_, err := m.Resolve(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected fail-closed error")
	}
	if !strings.Contains(err.Error(), "tenant has no LLM credential configured") {
		t.Fatalf("error = %q, want it to contain 'tenant has no LLM credential configured'", err.Error())
	}
}

// A disabled credential (Enabled=false) makes the resolver return (nil,nil); with
// no env key the manager fails closed.
func TestManager_DisabledCredential_FallsThroughToFailClosed(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	tenant := uuid.New()
	// fakeResolver returns (nil,nil) for a missing/disabled tenant; emulate disabled
	// by simply not registering the tenant (the real service returns nil when !Enabled).
	m := NewManagerWithCredentials(anthropicCfg(), &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{}})

	if _, err := m.Resolve(context.Background(), tenant); err == nil {
		t.Fatal("expected fail-closed for disabled/absent credential with no env key")
	}
}

// A resolver error is surfaced (not swallowed) so callers like copilot/cyber can
// handle it; lex degrades to its deterministic analyzer on any Resolve error.
func TestManager_ResolverError_Surfaced(t *testing.T) {
	m := NewManagerWithCredentials(anthropicCfg(), &fakeResolver{err: errors.New("boom")})

	_, err := m.Resolve(context.Background(), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "resolve tenant llm credential") {
		t.Fatalf("error = %v, want wrapped 'resolve tenant llm credential'", err)
	}
}

// Caching: same (tenant, version) returns the SAME provider instance; a version
// bump (rotation) returns a NEW instance carrying the rotated key.
func TestManager_ProviderCache_KeyedByTenantAndVersion(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	tenant := uuid.New()
	res := &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{
		tenant: {Provider: "anthropic", Model: "claude-opus-4-8", APIKey: []byte("key-v1"), Enabled: true, Version: 1},
	}}
	m := NewManagerWithCredentials(anthropicCfg(), res)

	p1, err := m.Resolve(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Resolve v1: %v", err)
	}
	p2, err := m.Resolve(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Resolve v1 again: %v", err)
	}
	if p1 != p2 {
		t.Fatal("same (tenant,version) should return the cached provider instance")
	}
	if p1.(*AnthropicProvider).apiKey != "key-v1" {
		t.Fatalf("v1 key = %q, want key-v1", p1.(*AnthropicProvider).apiKey)
	}

	// Rotate: bump version + change the key. Next Resolve must miss the cache.
	res.byTenant[tenant] = &ResolvedCredential{Provider: "anthropic", Model: "claude-opus-4-8", APIKey: []byte("key-v2"), Enabled: true, Version: 2}
	p3, err := m.Resolve(context.Background(), tenant)
	if err != nil {
		t.Fatalf("Resolve v2: %v", err)
	}
	if p3 == p1 {
		t.Fatal("rotation (version bump) must invalidate the cached provider")
	}
	if p3.(*AnthropicProvider).apiKey != "key-v2" {
		t.Fatalf("v2 key = %q, want key-v2 (rotation must change the resolved key)", p3.(*AnthropicProvider).apiKey)
	}
}

// UpdateConfig (provider/model/temperature change) must invalidate the cache so a
// subsequent Resolve does not serve a stale provider.
func TestManager_UpdateConfig_InvalidatesCache(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	tenant := uuid.New()
	res := &fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{
		tenant: {Provider: "anthropic", Model: "claude-opus-4-8", APIKey: []byte("key-v1"), Enabled: true, Version: 1},
	}}
	m := NewManagerWithCredentials(anthropicCfg(), res)

	p1, _ := m.Resolve(context.Background(), tenant)
	_ = m.GetConfig(tenant)
	// Mutate the override; this calls invalidateTenant internally.
	m.UpdateConfig(tenant, llmdto.UpdateConfigRequest{Provider: "anthropic", Model: "claude-opus-4-8"})
	p2, _ := m.Resolve(context.Background(), tenant)
	if p1 == p2 {
		t.Fatal("UpdateConfig should invalidate the cached provider")
	}
}

// SetCredentialResolver wires a resolver after construction (env-only before).
func TestManager_SetCredentialResolver(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-global-key")
	tenant := uuid.New()
	m := NewManager(anthropicCfg())

	p, _ := m.Resolve(context.Background(), tenant)
	if p.(*AnthropicProvider).apiKey != "env-global-key" {
		t.Fatalf("pre-wire key = %q, want env-global-key", p.(*AnthropicProvider).apiKey)
	}

	m.SetCredentialResolver(&fakeResolver{byTenant: map[uuid.UUID]*ResolvedCredential{
		tenant: {Provider: "anthropic", APIKey: []byte("post-wire-key"), Enabled: true, Version: 1},
	}})
	p2, _ := m.Resolve(context.Background(), tenant)
	if p2.(*AnthropicProvider).apiKey != "post-wire-key" {
		t.Fatalf("post-wire key = %q, want post-wire-key", p2.(*AnthropicProvider).apiKey)
	}
}
