package middleware

import (
	"context"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
	mw "github.com/clario360/platform/internal/middleware"
)

// KillSwitchEvaluator is satisfied by the gateway admin kill-switch store
// (internal/gateway/admin.KillSwitchStore). It reports whether an enabled kill
// switch matches the supplied request facets. It is defined as an interface here
// to avoid an import cycle between the middleware and admin packages and to keep
// the middleware testable. It fails open (returns false) on any backing-store
// error so an infrastructure problem never blocks all traffic.
type KillSwitchEvaluator interface {
	IsTripped(ctx context.Context, in KillSwitchMatch) (bool, KillSwitchReason)
}

// KillSwitchMatch is the per-request data the evaluator inspects. It mirrors
// admin.MatchInput; the admin package adapts between the two.
type KillSwitchMatch struct {
	RoutePrefix string
	Service     string
	TenantID    string
	Entitlement string
}

// KillSwitchReason carries the human-readable reason of the matching kill switch
// for inclusion in the 503 response. It mirrors the relevant admin.KillSwitch
// fields.
type KillSwitchReason struct {
	Scope  string
	Target string
	Reason string
}

// ProxyKillSwitch short-circuits requests matched by an operator kill switch
// (G19) with 503 KILL_SWITCH_ACTIVE before they reach the backend. It is placed
// early in the per-route proxy chain (after ProxyAuth so the tenant is known,
// before entitlement / rate-limit / proxy execution). Kill switches are
// Redis-backed so they survive restarts and apply across replicas.
//
// A nil evaluator (Redis unconfigured) makes the middleware a no-op.
func ProxyKillSwitch(eval KillSwitchEvaluator, route gwconfig.RouteConfig, logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if eval == nil {
				next.ServeHTTP(w, r)
				return
			}

			tenantID := auth.TenantFromContext(r.Context())

			tripped, reason := eval.IsTripped(r.Context(), KillSwitchMatch{
				RoutePrefix: route.Prefix,
				Service:     route.Service,
				TenantID:    tenantID,
				Entitlement: route.Entitlement,
			})
			if !tripped {
				next.ServeHTTP(w, r)
				return
			}

			reqID := mw.GetRequestID(r.Context())
			logger.Warn().
				Str("request_id", reqID).
				Str("kill_scope", reason.Scope).
				Str("kill_target", reason.Target).
				Str("route_prefix", route.Prefix).
				Str("service", route.Service).
				Str("tenant_id", tenantID).
				Msg("request blocked by active kill switch")

			writeGWError(w, http.StatusServiceUnavailable, "KILL_SWITCH_ACTIVE",
				killSwitchMessage(reason.Reason), reqID)
		})
	}
}

func killSwitchMessage(reason string) string {
	if reason == "" {
		return "this route is temporarily disabled by an operator kill switch"
	}
	return "this route is temporarily disabled by an operator kill switch: " + reason
}
