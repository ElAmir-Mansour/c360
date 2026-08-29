package credential

import "strings"

// supportedProviders are the providers that take an API key and are eligible for
// per-tenant SaaS credentials. local/llamacpp/bitnet are excluded -- they have
// no API key.
var supportedProviders = map[string]struct{}{
	"anthropic": {},
	"openai":    {},
	"azure":     {},
}

// minKeyLen is a lenient floor; real keys are far longer. The intent is to reject
// obvious mistakes (empty, "x") without rejecting any valid key.
const minKeyLen = 20

// normalizeProvider lower-cases and trims a provider name.
func normalizeProvider(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

// validateProvider returns ErrUnsupportedProvider unless provider is in the
// allow-list. The returned string is the normalized provider to store.
func validateProvider(provider string) (string, error) {
	p := normalizeProvider(provider)
	if _, ok := supportedProviders[p]; !ok {
		return "", ErrUnsupportedProvider
	}
	return p, nil
}

// validateKey performs format-only (no network) validation of the API key for the
// given (already-normalized) provider. It returns the trimmed key bytes that
// should be encrypted. The caller still owns/zeroes the original slice.
func validateKey(provider string, key []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(key))
	if trimmed == "" {
		return nil, ErrEmptyKey
	}
	if len(trimmed) < minKeyLen {
		return nil, ErrInvalidKeyFormat
	}
	switch provider {
	case "anthropic":
		if !strings.HasPrefix(trimmed, "sk-ant-") {
			return nil, ErrInvalidKeyFormat
		}
	case "openai":
		if !strings.HasPrefix(trimmed, "sk-") {
			return nil, ErrInvalidKeyFormat
		}
	case "azure":
		// Azure keys have no fixed prefix; minKeyLen check above is sufficient,
		// but require >=32 to match typical Azure key length.
		if len(trimmed) < 32 {
			return nil, ErrInvalidKeyFormat
		}
	}
	return []byte(trimmed), nil
}
