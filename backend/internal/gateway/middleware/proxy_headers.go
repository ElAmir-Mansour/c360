package middleware

import (
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/auth"
	mw "github.com/clario360/platform/internal/middleware"
)

// internalRequestHeaders are trusted internal headers that must be STRIPPED from
// incoming client requests before any processing. A malicious client could inject
// X-Tenant-ID to impersonate another tenant — we strip and re-inject from JWT.
var internalRequestHeaders = []string{
	"X-Tenant-ID",
	"X-User-ID",
	"X-User-Email",
	"X-User-Roles",
	"X-User-Permissions",
	HeaderGatewayAPIVersion,
	HeaderGatewayContractID,
	HeaderGatewayContractVersion,
	HeaderGatewayContractPhase,
	HeaderGatewayRoutePrefix,
	HeaderGatewayRouteService,
}

// internalResponseHeaders must be stripped from backend responses before the
// client sees them to prevent leaking internal routing data.
var internalResponseHeaders = []string{
	"X-Tenant-ID",
	"X-User-ID",
	"X-User-Email",
	"X-User-Roles",
	"X-User-Permissions",
	HeaderGatewayAPIVersion,
	HeaderGatewayContractID,
	HeaderGatewayContractVersion,
	HeaderGatewayContractPhase,
	HeaderGatewayRoutePrefix,
	HeaderGatewayRouteService,
	"X-Powered-By",
	"Server",
}

// ProxyHeaders strips incoming internal headers (anti-spoofing), then injects
// trusted headers derived from the validated JWT claims before proxying.
// It also wraps the response writer to strip internal headers from the response.
func ProxyHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// ── STRIP INCOMING INTERNAL HEADERS ──────────────────────────────────────
		// Must happen before we set them so clients cannot spoof tenant/user context.
		for _, h := range internalRequestHeaders {
			r.Header.Del(h)
		}

		// ── X-Request-ID ─────────────────────────────────────────────────────────
		if reqID := mw.GetRequestID(r.Context()); reqID != "" {
			r.Header.Set("X-Request-ID", reqID)
		}

		// ── X-Tenant-ID, X-User-ID, and friends (from validated JWT) ─────────────
		if user := auth.UserFromContext(r.Context()); user != nil {
			r.Header.Set("X-Tenant-ID", user.TenantID)
			r.Header.Set("X-User-ID", user.ID)
			r.Header.Set("X-User-Email", user.Email)

			if len(user.Roles) > 0 {
				r.Header.Set("X-User-Roles", strings.Join(user.Roles, ","))
			}

			// Permissions come from the JWT claims if present.
			if claims := auth.ClaimsFromContext(r.Context()); claims != nil && len(claims.Permissions) > 0 {
				r.Header.Set("X-User-Permissions", strings.Join(claims.Permissions, ","))
			}
		}

		// ── X-Forwarded-For ───────────────────────────────────────────────────────
		// Deliberately NOT appended here: httputil.ReverseProxy appends the peer
		// IP (RemoteAddr) to X-Forwarded-For exactly once when proxying. A manual
		// append here (and previously another in the proxy Director) made the
		// client IP appear two or three times in the chain seen by services.

		// ── X-Real-IP ─────────────────────────────────────────────────────────────
		r.Header.Set("X-Real-IP", getClientIP(r))

		// Wrap ResponseWriter to strip internal headers from the backend response.
		wrapped := &headerStrippingResponseWriter{ResponseWriter: w}
		next.ServeHTTP(wrapped, r)
	})
}

// headerStrippingResponseWriter intercepts WriteHeader to strip internal headers
// before they reach the client.
type headerStrippingResponseWriter struct {
	http.ResponseWriter
	headersCleaned bool
}

// Flush forwards to the underlying writer so streaming (SSE) responses flush
// through this wrapper instead of buffering. The reverse proxy flushes
// text/event-stream immediately only if the response writer is an http.Flusher.
func (w *headerStrippingResponseWriter) Flush() {
	w.stripInternalHeaders()
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *headerStrippingResponseWriter) WriteHeader(code int) {
	w.stripInternalHeaders()
	w.ResponseWriter.WriteHeader(code)
}

func (w *headerStrippingResponseWriter) Write(b []byte) (int, error) {
	if !w.headersCleaned {
		w.stripInternalHeaders()
	}
	return w.ResponseWriter.Write(b)
}

func (w *headerStrippingResponseWriter) stripInternalHeaders() {
	if w.headersCleaned {
		return
	}
	w.headersCleaned = true
	h := w.ResponseWriter.Header()
	for _, name := range internalResponseHeaders {
		h.Del(name)
	}
	// Strip any X-Debug-* headers from the backend.
	for key := range h {
		if strings.HasPrefix(strings.ToLower(key), "x-debug-") {
			h.Del(key)
		}
	}
}
