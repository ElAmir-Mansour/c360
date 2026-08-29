package middleware

import (
	"fmt"
	"net/http"
)

// CORSConfig holds CORS configuration.
type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	ExposedHeaders   []string
	AllowCredentials bool
	MaxAge           int

	// AllowLocalhostOrigins opts a production-like environment INTO accepting
	// explicitly-listed localhost origins (see Validate). It exists for staging
	// backends that external frontend teams integrate against from their dev
	// machines. It must be set deliberately (default false), it never relaxes
	// the wildcard-origin ban, and it does not widen the allowlist itself —
	// every localhost origin must still be named in AllowedOrigins.
	AllowLocalhostOrigins bool
}

// DefaultCORSConfig returns a sensible default CORS configuration for development.
// The dev allowlist is localhost-only so this default is never safe for prod.
// Use Validate() before invoking CORS() in any code path that may run in prod.
func DefaultCORSConfig() CORSConfig {
	return CORSConfig{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:8080"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Tenant-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           86400,
	}
}

// Validate enforces invariants on the CORS configuration. Call this from
// service startup (after building the config) so misconfiguration fails fast
// rather than silently weakening security at runtime.
//
// Rules:
//   - AllowCredentials=true with a wildcard origin is forbidden by the CORS
//     spec and by every browser; combining the two is a configuration bug
//     that should fail startup, not at request time.
//   - In production-like environments (anything other than "development" or
//     "test"), localhost origins are rejected unless explicitly allowed.
func (c CORSConfig) Validate(environment string) error {
	hasWildcard := false
	for _, o := range c.AllowedOrigins {
		if o == "*" {
			hasWildcard = true
			break
		}
	}
	if hasWildcard && c.AllowCredentials {
		return fmt.Errorf("cors: wildcard origin '*' cannot be combined with AllowCredentials=true")
	}
	if environment != "" && environment != "development" && environment != "dev" && environment != "test" {
		for _, o := range c.AllowedOrigins {
			if o == "*" {
				return fmt.Errorf("cors: wildcard origin '*' is not allowed in environment %q", environment)
			}
			if isLocalhostOrigin(o) && !c.AllowLocalhostOrigins {
				return fmt.Errorf("cors: localhost origin %q is not allowed in environment %q (set AllowLocalhostOrigins to opt in deliberately)", o, environment)
			}
		}
	}
	return nil
}

func isLocalhostOrigin(o string) bool {
	// Cheap, lower-cased check. We don't parse the URL; treat any of these
	// substrings as evidence of a dev origin slipping into prod config.
	const (
		http  = "http://localhost"
		https = "https://localhost"
		http4 = "http://127.0.0.1"
		htt6  = "http://[::1]"
	)
	if len(o) >= len(http) && o[:len(http)] == http {
		return true
	}
	if len(o) >= len(https) && o[:len(https)] == https {
		return true
	}
	if len(o) >= len(http4) && o[:len(http4)] == http4 {
		return true
	}
	if len(o) >= len(htt6) && o[:len(htt6)] == htt6 {
		return true
	}
	return false
}

// CORS returns a CORS middleware with the given configuration.
func CORS(cfg CORSConfig) func(http.Handler) http.Handler {
	allowedOrigins := make(map[string]bool, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowedOrigins[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			if allowedOrigins[origin] || containsWildcard(cfg.AllowedOrigins) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}

			if cfg.AllowCredentials {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}

			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", joinStrings(cfg.AllowedMethods))
				w.Header().Set("Access-Control-Allow-Headers", joinStrings(cfg.AllowedHeaders))
				if cfg.MaxAge > 0 {
					w.Header().Set("Access-Control-Max-Age", intToStr(cfg.MaxAge))
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}

			if len(cfg.ExposedHeaders) > 0 {
				w.Header().Set("Access-Control-Expose-Headers", joinStrings(cfg.ExposedHeaders))
			}

			next.ServeHTTP(w, r)
		})
	}
}

func containsWildcard(origins []string) bool {
	for _, o := range origins {
		if o == "*" {
			return true
		}
	}
	return false
}

func joinStrings(ss []string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += ", "
		}
		result += s
	}
	return result
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
