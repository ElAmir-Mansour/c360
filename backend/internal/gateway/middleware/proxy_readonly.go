package middleware

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	mw "github.com/clario360/platform/internal/middleware"
)

// ProxyReadonly is the single, non-bypassable chokepoint that makes
// impersonation tokens read-only at the gateway (platform-admin-console §E /
// security call-out, OQ-1). When the validated JWT carries Readonly==true, any
// state-changing HTTP method is rejected with 403 READONLY_SESSION before the
// request can reach a backend service. Safe (non-mutating) methods —
// GET/HEAD/OPTIONS — are passed through untouched.
//
// It must run AFTER ProxyAuth (which validates the token and populates
// auth.Claims in the context) and as early as possible in the per-route proxy
// chain so the guard precedes entitlement, rate-limit and proxy execution.
// Requests without claims (public routes, API-key passthrough) are unaffected:
// only a token explicitly marked Readonly is constrained.
func ProxyReadonly(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := auth.ClaimsFromContext(r.Context())
			if claims == nil || !claims.Readonly {
				next.ServeHTTP(w, r)
				return
			}

			if isSafeMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}

			reqID := mw.GetRequestID(r.Context())
			logger.Warn().
				Str("request_id", reqID).
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Str("user_id", claims.UserID).
				Str("tenant_id", claims.TenantID).
				Str("impersonated_by", claims.ImpersonatedBy).
				Msg("read-only session attempted a state-changing request; rejected")

			writeGWError(w, http.StatusForbidden, "READONLY_SESSION",
				"this session is read-only; state-changing requests are not permitted", reqID)
		})
	}
}

// isSafeMethod reports whether m is a non-mutating HTTP method that a read-only
// session is allowed to perform.
func isSafeMethod(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}
