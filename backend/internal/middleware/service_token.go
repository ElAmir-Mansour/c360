package middleware

import (
	"crypto/subtle"
	"net/http"
)

// ServiceToken guards internal service-to-service routes with a shared secret
// presented in the X-Service-Token header. It is deliberately separate from JWT
// Auth/RequirePermission: the caller is a trusted backend service (e.g. the
// onboarding provisioner assigning a tenant's default license), not an end user
// or a human admin holding "licensing:admin".
//
// The expected token must be non-empty; callers should not mount a guarded
// route when the configured token is empty (so the internal surface stays off
// unless explicitly enabled).
func ServiceToken(expected string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := r.Header.Get("X-Service-Token")
			if expected == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
				writeAuthError(w, "INVALID_SERVICE_TOKEN", "a valid X-Service-Token is required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
