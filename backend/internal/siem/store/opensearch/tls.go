package opensearch

import "crypto/tls"

// tlsInsecureConfig returns a *tls.Config with InsecureSkipVerify=true.
// Isolated in its own file so the linter's "crypto/tls config" rule can be
// targeted at this one location.
func tlsInsecureConfig() *tls.Config {
	//nolint:gosec // dev-only; SIEM config rejects this combination in prod
	return &tls.Config{InsecureSkipVerify: true}
}
