package provider

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/google/uuid"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
	llmdto "github.com/clario360/platform/internal/cyber/vciso/llm/dto"
)

// ResolvedCredential is a tenant's decrypted LLM credential plus its provider /
// model overrides and a monotonic version used for cache invalidation. The
// APIKey plaintext is OWNED BY THE CALLER (Manager.Resolve), which copies it into
// the provider config and then zeroes it. It is never cached and never logged.
type ResolvedCredential struct {
	Provider string
	Model    string
	APIKey   []byte // decrypted; Resolve zeroes this after copying into the provider
	Enabled  bool
	// Version is bumped on every credential write (incl. rotation). It is the
	// cache key component so a rotation immediately invalidates a cached provider.
	Version int64
}

// TenantCredentialResolver yields a tenant's enabled+decrypted LLM credential, or
// (nil, nil) when the tenant has no enabled credential (the Manager then falls
// back to the global env key, or fails closed). STAGE 1's credential.Service
// satisfies this interface via its ResolveCredential method.
type TenantCredentialResolver interface {
	ResolveCredential(ctx context.Context, tenantID uuid.UUID) (*ResolvedCredential, error)
}

type Manager struct {
	cfg       *llmcfg.Config
	overrides sync.Map
	// credentials is the per-tenant credential source. It MAY be nil, in which
	// case Resolve behaves EXACTLY as before (env-only, no fail-closed): full
	// back-compat for existing callers (copilot / dr / cyber / lex).
	credentials TenantCredentialResolver
	// providerCache caches constructed providers keyed by "tenantID#version" so a
	// rotation (version bump) invalidates the entry immediately. The plaintext key
	// lives only inside the cached provider instance, never as a standalone copy.
	providerCache sync.Map
}

type TenantOverride struct {
	Provider       string
	Model          string
	Temperature    float64
	TemperatureSet bool `json:"-"`
}

// NewManager builds a credential-UNAWARE manager (nil resolver). Existing call
// sites keep working unchanged: Resolve uses overrides + global env keys exactly
// as it does today.
func NewManager(cfg *llmcfg.Config) *Manager {
	return &Manager{cfg: cfg}
}

// NewManagerWithCredentials builds a credential-AWARE manager. When cr is nil it
// is equivalent to NewManager (env-only behavior).
func NewManagerWithCredentials(cfg *llmcfg.Config, cr TenantCredentialResolver) *Manager {
	return &Manager{cfg: cfg, credentials: cr}
}

// SetCredentialResolver injects (or replaces) the credential resolver after
// construction. Passing nil reverts to env-only behavior.
func (m *Manager) SetCredentialResolver(cr TenantCredentialResolver) {
	if m == nil {
		return
	}
	m.credentials = cr
}

func (m *Manager) Resolve(ctx context.Context, tenantID uuid.UUID) (LLMProvider, error) {
	if m == nil || m.cfg == nil {
		return nil, fmt.Errorf("llm provider manager is unavailable")
	}

	override := m.getOverride(tenantID)
	providerName := m.cfg.DefaultProvider
	if override.Provider != "" {
		providerName = override.Provider
	}

	// Step 1: resolve the per-tenant credential (decrypt) if a resolver is wired.
	var cred *ResolvedCredential
	if m.credentials != nil {
		c, err := m.credentials.ResolveCredential(ctx, tenantID)
		if err != nil {
			return nil, fmt.Errorf("resolve tenant llm credential: %w", err)
		}
		cred = c
	}

	// A per-tenant credential wins over the default/override provider selection.
	if cred != nil && cred.Provider != "" {
		providerName = cred.Provider
	}

	// Serve from the per-(tenant, version) provider cache when a credential is
	// present. The cache key embeds the credential version, so a rotation (version
	// bump) misses the stale entry and forces a rebuild -> immediate invalidation.
	if cred != nil {
		if cached, ok := m.cacheLookup(tenantID, cred.Version); ok {
			zeroBytes(cred.APIKey) // never leave the decrypted plaintext alive
			return cached, nil
		}
	}

	providerCfg, ok := m.cfg.Providers[providerName]
	if !ok {
		zeroCred(cred)
		return nil, fmt.Errorf("%w: llm provider %q is not configured", ErrNotConfigured, providerName)
	}

	if override.Model != "" {
		providerCfg.Model = override.Model
		providerCfg.DeploymentName = override.Model
	}
	if override.TemperatureSet {
		providerCfg.Temperature = override.Temperature
		providerCfg.TemperatureSet = true
	}

	// A per-tenant credential's model override beats the per-tenant config override.
	if cred != nil && cred.Model != "" {
		providerCfg.Model = cred.Model
		providerCfg.DeploymentName = cred.Model
	}

	switch {
	case cred != nil:
		// Step 1 (cont): inject the explicit decrypted key, then zero the plaintext
		// immediately after copying it into the (value-copy) providerCfg. The only
		// surviving in-memory copy is the string field inside the constructed
		// provider instance.
		providerCfg.APIKey = string(cred.APIKey)
		zeroBytes(cred.APIKey)
	default:
		// Step 2: no per-tenant credential. Fall back to the global env key when
		// configured. Step 3: if the provider requires a key and none is set in the
		// env, fail closed -- but ONLY when a resolver is wired (SaaS mode). With a
		// nil resolver we preserve today's exact behavior (no fail-closed).
		if m.credentials != nil && requiresKey(providerName) &&
			strings.TrimSpace(os.Getenv(providerCfg.APIKeyEnv)) == "" {
			return nil, fmt.Errorf("tenant has no LLM credential configured")
		}
	}

	built, err := m.construct(providerName, providerCfg)
	if err != nil {
		return nil, err
	}

	// Cache the constructed provider for this (tenant, version). Only providers
	// backed by an explicit per-tenant credential are cached; env-only providers
	// are cheap and have no version to key on.
	if cred != nil {
		m.cacheStore(tenantID, cred.Version, built)
	}
	return built, nil
}

func (m *Manager) construct(providerName string, providerCfg llmcfg.ProviderConfig) (LLMProvider, error) {
	switch providerName {
	case "openai":
		return NewOpenAIProvider(providerCfg), nil
	case "anthropic":
		return NewAnthropicProvider(providerCfg), nil
	case "azure":
		return NewAzureProvider(providerCfg), nil
	case "local":
		return NewLocalProvider(providerCfg), nil
	case "llamacpp":
		return NewLlamaCppProvider(providerCfg), nil
	case "bitnet":
		return NewBitNetProvider(providerCfg), nil
	default:
		return nil, fmt.Errorf("unsupported llm provider %q", providerName)
	}
}

func (m *Manager) GetConfig(tenantID uuid.UUID) TenantOverride {
	override := m.getOverride(tenantID)
	if override.Provider == "" && m != nil && m.cfg != nil {
		override.Provider = m.cfg.DefaultProvider
		if cfg, ok := m.cfg.Providers[override.Provider]; ok {
			override.Model = cfg.Model
			if !override.TemperatureSet {
				override.Temperature = cfg.Temperature
				override.TemperatureSet = cfg.TemperatureSet
			}
		}
	}
	return override
}

func (m *Manager) UpdateConfig(tenantID uuid.UUID, req llmdto.UpdateConfigRequest) TenantOverride {
	override := TenantOverride{
		Provider: req.Provider,
		Model:    req.Model,
	}
	if req.Temperature != nil {
		override.Temperature = *req.Temperature
		override.TemperatureSet = true
	}
	m.overrides.Store(tenantID.String(), override)
	// A provider/model/temperature change must not serve a stale cached provider.
	m.invalidateTenant(tenantID)
	return m.GetConfig(tenantID)
}

func (m *Manager) getOverride(tenantID uuid.UUID) TenantOverride {
	if m == nil {
		return TenantOverride{}
	}
	value, _ := m.overrides.Load(tenantID.String())
	override, _ := value.(TenantOverride)
	return override
}

func (m *Manager) cacheKey(tenantID uuid.UUID, version int64) string {
	return fmt.Sprintf("%s#%d", tenantID.String(), version)
}

func (m *Manager) cacheLookup(tenantID uuid.UUID, version int64) (LLMProvider, bool) {
	v, ok := m.providerCache.Load(m.cacheKey(tenantID, version))
	if !ok {
		return nil, false
	}
	p, ok := v.(LLMProvider)
	return p, ok
}

func (m *Manager) cacheStore(tenantID uuid.UUID, version int64, p LLMProvider) {
	// Drop any older-version entries for this tenant so the cache cannot grow
	// unbounded across rotations.
	prefix := tenantID.String() + "#"
	current := m.cacheKey(tenantID, version)
	m.providerCache.Range(func(k, _ any) bool {
		if ks, ok := k.(string); ok && strings.HasPrefix(ks, prefix) && ks != current {
			m.providerCache.Delete(ks)
		}
		return true
	})
	m.providerCache.Store(current, p)
}

func (m *Manager) invalidateTenant(tenantID uuid.UUID) {
	if m == nil {
		return
	}
	prefix := tenantID.String() + "#"
	m.providerCache.Range(func(k, _ any) bool {
		if ks, ok := k.(string); ok && strings.HasPrefix(ks, prefix) {
			m.providerCache.Delete(ks)
		}
		return true
	})
}

// requiresKey reports whether a provider needs an API key. Local self-hosted
// providers legitimately have none, so they never trigger the fail-closed path.
func requiresKey(providerName string) bool {
	switch providerName {
	case "anthropic", "openai", "azure":
		return true
	default:
		return false
	}
}

func zeroCred(c *ResolvedCredential) {
	if c != nil {
		zeroBytes(c.APIKey)
	}
}

// zeroBytes overwrites b with zeros. The explicit loop prevents dead-store
// elimination so the secret is actually wiped from memory.
func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
