package middleware

import (
	"net/http"
	"os"
	"strings"
)

// WSOriginChecker returns a CheckOrigin function suitable for gorilla/websocket Upgrader.
// It rejects cross-origin upgrade requests in non-development environments.
//
// allowedOrigins is the explicit allowlist of acceptable Origin header values.
// When the WSORIGIN_ALLOW_ANY environment variable is set to "true" the checker
// allows any origin — only intended for local development. Setting this in
// production is a Cross-Site WebSocket Hijacking (CSWSH) vulnerability.
//
// A request without an Origin header (typical for non-browser clients) is allowed
// because browsers always set Origin on cross-origin XHR/WebSocket requests, so a
// missing Origin indicates a same-origin or non-browser client.
func WSOriginChecker(allowedOrigins []string) func(r *http.Request) bool {
	allowAny := strings.EqualFold(os.Getenv("WSORIGIN_ALLOW_ANY"), "true")
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed[o] = struct{}{}
		}
	}
	return func(r *http.Request) bool {
		if allowAny {
			return true
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		_, ok := allowed[origin]
		return ok
	}
}
