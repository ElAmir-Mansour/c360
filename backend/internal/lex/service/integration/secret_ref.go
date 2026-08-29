package integration

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Secret references (#14 — KMS/Vault-backed secret resolution).
//
// A SECRET config field value may be stored as an EXTERNAL REFERENCE rather than
// the cleartext secret:
//
//   - "kms://<keyId>"            — resolve <keyId> from a KMS secret store.
//   - "vault://<path>#<field>"   — resolve the <field> entry at <path> in Vault.
//
// The stored value stays the REFERENCE (never the secret); the SecretRefResolver
// resolves it to the actual secret AT CALL TIME, just before a connector reads
// plaintext config. A plain (non-reference) secret value still works unchanged.
//
// CUSTODY. Resolution delegates to an injected ExternalSecretProvider seam (the
// honest KMS/Vault seam, mirroring crypto.ExternalKeyProvider). The resolved
// secret is handed to the connector in-memory only; it is NEVER logged, returned
// to an API caller, or written back to the stored config. The registry calls
// Resolve on the DECRYPTED endpoint config (the repo already FieldCrypto-decrypts
// on read) before dispatching Sync/Invoke/TestConnection, so adapters transparently
// receive the resolved secret with zero connector changes.
// =============================================================================

// Secret-reference scheme prefixes (the stored value's leading token).
const (
	// SecretRefSchemeKMS is the "kms://<keyId>" external-reference scheme.
	SecretRefSchemeKMS = "kms://"
	// SecretRefSchemeVault is the "vault://<path>#<field>" external-reference scheme.
	SecretRefSchemeVault = "vault://"
)

// SecretRefProvider is the per-endpoint non-secret config field naming which
// external secret backend resolves this endpoint's references. It is NOT a secret
// (it echoes its value on read) and gates which provider the resolver dispatches
// to; "none" (or unset) disables reference resolution for the endpoint.
const SecretRefProviderKey = "secret_ref_provider"

// Secret-ref provider values (SecretRefProviderKey domain).
const (
	SecretRefProviderNone  = "none"
	SecretRefProviderKMS   = "kms"
	SecretRefProviderVault = "vault"
)

// IsSecretRef reports whether a stored config value is an external secret
// reference (kms:// or vault://) rather than a cleartext / sentinel value.
func IsSecretRef(value string) bool {
	v := strings.TrimSpace(value)
	return strings.HasPrefix(v, SecretRefSchemeKMS) || strings.HasPrefix(v, SecretRefSchemeVault)
}

// ParsedSecretRef is the decomposed form of an external secret reference.
type ParsedSecretRef struct {
	// Scheme is "kms" or "vault".
	Scheme string
	// Key is the KMS key id (kms://<keyId>) or the Vault path (vault://<path>#field).
	Key string
	// Field is the Vault entry field (the part after '#'); empty for kms.
	Field string
}

// ParseSecretRef decomposes a "kms://<keyId>" or "vault://<path>#<field>" value.
// It returns (ref, true) when the value is a recognised reference, else (_, false).
func ParseSecretRef(value string) (ParsedSecretRef, bool) {
	v := strings.TrimSpace(value)
	switch {
	case strings.HasPrefix(v, SecretRefSchemeKMS):
		key := strings.TrimSpace(strings.TrimPrefix(v, SecretRefSchemeKMS))
		if key == "" {
			return ParsedSecretRef{}, false
		}
		return ParsedSecretRef{Scheme: SecretRefProviderKMS, Key: key}, true
	case strings.HasPrefix(v, SecretRefSchemeVault):
		rest := strings.TrimSpace(strings.TrimPrefix(v, SecretRefSchemeVault))
		path := rest
		field := ""
		if i := strings.LastIndex(rest, "#"); i >= 0 {
			path = strings.TrimSpace(rest[:i])
			field = strings.TrimSpace(rest[i+1:])
		}
		if path == "" {
			return ParsedSecretRef{}, false
		}
		return ParsedSecretRef{Scheme: SecretRefProviderVault, Key: path, Field: field}, true
	default:
		return ParsedSecretRef{}, false
	}
}

// ExternalSecretProvider is the honest KMS/Vault seam SecretRefResolver delegates
// to. An implementation fetches the cleartext secret for a parsed reference. It is
// NOT a fake: a real deployment injects a provider that talks to AWS KMS / HashiCorp
// Vault out-of-band; tests inject an in-memory provider. The provider must never log
// the returned secret.
type ExternalSecretProvider interface {
	// ResolveSecret fetches the cleartext secret for a parsed reference. The
	// returned value is the actual secret and must be handled in-memory only.
	ResolveSecret(ctx context.Context, ref ParsedSecretRef) (string, error)
	// Provider returns a short label identifying the backend (e.g. "kms", "vault").
	Provider() string
}

// FuncSecretProvider adapts a plain resolver function to ExternalSecretProvider, so
// a deployment can wire a closure (the crypto.ExternalKeyProvider style) without a
// bespoke type. label names the backend.
type FuncSecretProvider struct {
	label   string
	resolve func(ctx context.Context, ref ParsedSecretRef) (string, error)
}

// NewFuncSecretProvider builds a provider over a resolver closure.
func NewFuncSecretProvider(label string, resolve func(ctx context.Context, ref ParsedSecretRef) (string, error)) *FuncSecretProvider {
	if strings.TrimSpace(label) == "" {
		label = "external"
	}
	return &FuncSecretProvider{label: label, resolve: resolve}
}

// ResolveSecret implements ExternalSecretProvider.
func (p *FuncSecretProvider) ResolveSecret(ctx context.Context, ref ParsedSecretRef) (string, error) {
	if p == nil || p.resolve == nil {
		return "", fmt.Errorf("lex/integration: secret provider %q has no resolver", p.label)
	}
	return p.resolve(ctx, ref)
}

// Provider implements ExternalSecretProvider.
func (p *FuncSecretProvider) Provider() string { return p.label }

var _ ExternalSecretProvider = (*FuncSecretProvider)(nil)

// SecretRefResolver resolves external secret references in an endpoint's DECRYPTED
// config to the actual secrets, just before a connector reads plaintext config. It
// holds one provider per backend label (kms / vault). A resolver with no providers
// is a safe pass-through: a config with no references is returned unchanged, and a
// reference whose backend is unwired surfaces a clear error rather than leaking the
// raw reference to the connector (which would treat "vault://..." as the credential).
type SecretRefResolver struct {
	providers map[string]ExternalSecretProvider
}

// NewSecretRefResolver builds an empty resolver. Providers are registered via
// WithProvider. A nil/empty resolver is a no-op pass-through (Resolve returns the
// config unchanged when it carries no references).
func NewSecretRefResolver() *SecretRefResolver {
	return &SecretRefResolver{providers: map[string]ExternalSecretProvider{}}
}

// WithProvider registers a provider under its scheme label (kms / vault). The label
// is taken from the provided ref scheme, not the provider's own label, so a single
// FuncSecretProvider can be registered for a specific scheme. Returns the receiver
// for chaining. A nil provider is ignored.
func (r *SecretRefResolver) WithProvider(scheme string, provider ExternalSecretProvider) *SecretRefResolver {
	if r == nil {
		return r
	}
	scheme = strings.ToLower(strings.TrimSpace(scheme))
	if provider == nil || scheme == "" {
		return r
	}
	if r.providers == nil {
		r.providers = map[string]ExternalSecretProvider{}
	}
	r.providers[scheme] = provider
	return r
}

// HasProviders reports whether any backend is wired. The registry uses this to skip
// the resolve pass entirely when no external custody is configured (the common case),
// keeping the existing plaintext path untouched.
func (r *SecretRefResolver) HasProviders() bool {
	return r != nil && len(r.providers) > 0
}

// Resolve returns a COPY of the endpoint's config with every SECRET field whose
// value is an external reference (kms:// or vault://) replaced by the resolved
// cleartext secret. Non-secret fields, plain secret values, and the redaction
// sentinel pass through unchanged. The original config map is never mutated, and
// the stored value stays the reference — only the in-memory copy handed to the
// connector carries the resolved secret.
//
// A reference on a NON-secret field is left as-is (only schema secret fields are
// resolved, so a reference accidentally placed on a URL field is not fetched). A
// reference whose backend provider is unwired, or whose resolution fails, returns a
// secret-free error so the connector never receives the raw reference as if it were
// the credential.
func (r *SecretRefResolver) Resolve(ctx context.Context, endpoint model.IntegrationEndpoint) (map[string]any, error) {
	if endpoint.Config == nil {
		return map[string]any{}, nil
	}
	// Fast path: no providers wired ⇒ nothing to resolve. Return the config as-is.
	if r == nil || !r.HasProviders() {
		return endpoint.Config, nil
	}
	schema, _ := SchemaFor(endpoint.Kind)
	secretKeys := map[string]bool{}
	for _, f := range schema {
		if f.IsSecret() {
			secretKeys[f.Key] = true
		}
	}
	out := make(map[string]any, len(endpoint.Config))
	for k, v := range endpoint.Config {
		out[k] = v
	}
	for key := range secretKeys {
		raw, ok := out[key]
		if !ok {
			continue
		}
		strVal, ok := raw.(string)
		if !ok {
			continue
		}
		ref, isRef := ParseSecretRef(strVal)
		if !isRef {
			// Plain secret (or the sentinel): leave untouched.
			continue
		}
		provider := r.providers[ref.Scheme]
		if provider == nil {
			return nil, fmt.Errorf("lex/integration: no %s secret provider wired to resolve a %s reference for field %q", ref.Scheme, ref.Scheme, key)
		}
		secret, err := provider.ResolveSecret(ctx, ref)
		if err != nil {
			// Never echo the reference or the field's stored value in the error.
			return nil, fmt.Errorf("lex/integration: resolve %s secret reference for field %q: %w", ref.Scheme, key, err)
		}
		out[key] = secret
	}
	return out, nil
}

// ResolvedEndpoint returns a COPY of the endpoint with its Config replaced by the
// reference-resolved config (Resolve). It is the convenience the registry uses to
// hand a connector an endpoint whose secret fields hold resolved cleartext while the
// stored row keeps the references. The copy is shallow except for Config, which is a
// fresh map; the original endpoint is never mutated.
func (r *SecretRefResolver) ResolvedEndpoint(ctx context.Context, endpoint model.IntegrationEndpoint) (model.IntegrationEndpoint, error) {
	resolved, err := r.Resolve(ctx, endpoint)
	if err != nil {
		return endpoint, err
	}
	endpoint.Config = resolved
	return endpoint, nil
}
