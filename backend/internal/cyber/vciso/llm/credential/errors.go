package credential

import "errors"

var (
	// ErrNotConfigured is returned when an operation requires an existing
	// credential row but none exists for the tenant (e.g. Rotate, or Resolve
	// fail-closed paths surface this through the manager).
	ErrNotConfigured = errors.New("llm credential: tenant has no LLM credential configured")
	// ErrUnsupportedProvider is returned for a provider outside the allow-list.
	ErrUnsupportedProvider = errors.New("llm credential: unsupported provider")
	// ErrInvalidKeyFormat is returned when the API key fails minimal format
	// validation (length / provider prefix). No network call is made.
	ErrInvalidKeyFormat = errors.New("llm credential: invalid api key format")
	// ErrEmptyKey is returned when the supplied API key is empty after trimming.
	ErrEmptyKey = errors.New("llm credential: empty api key")
)
