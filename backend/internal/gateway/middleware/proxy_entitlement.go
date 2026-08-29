package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/gateway/entitlement"
	"github.com/clario360/platform/internal/gateway/metrics"
	mw "github.com/clario360/platform/internal/middleware"
)

// ProxyEntitlement gates a route on a plan entitlement (Solution Architecture
// E2E, slide 13). It runs after ProxyAuth, so the tenant is known from the
// validated token; it forwards that token to the licensing service, which
// derives the same tenant. A denial returns 402 Payment Required, signalling
// the client to upgrade rather than re-authenticate.
//
// failOpen controls behaviour when the licensing service is unreachable.
// Local/dev deployments may allow requests during a licensing outage and record
// fail_open; production routes should pass false so access must be proven before
// proxying, recording fail_closed when the checker cannot verify entitlement.
func ProxyEntitlement(checker entitlement.Checker, key string, failOpen bool, gwMetrics *metrics.GatewayMetrics, logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := mw.GetRequestID(r.Context())

			// API-key callers do not have JWT-derived tenant context at the
			// gateway. Local/dev fail-open preserves passthrough to services
			// that enforce API-key tenancy themselves; fail-closed denies
			// plan-gated routes unless the gateway can verify entitlement.
			if r.Header.Get("X-API-Key") != "" {
				if !failOpen {
					recordEntitlement(gwMetrics, key, "fail_closed")
					logger.Warn().
						Str("request_id", reqID).
						Str("entitlement", key).
						Msg("api-key entitlement check cannot derive tenant; denying request (fail-closed)")
					writeGWError(w, http.StatusForbidden, "ENTITLEMENT_REQUIRED", "tenant context required for entitlement check", reqID)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			user := auth.UserFromContext(r.Context())
			if user == nil || user.TenantID == "" {
				if !failOpen {
					recordEntitlement(gwMetrics, key, "fail_closed")
					logger.Warn().
						Str("request_id", reqID).
						Str("entitlement", key).
						Msg("tenant context missing for entitlement check; denying request (fail-closed)")
					writeGWError(w, http.StatusForbidden, "ENTITLEMENT_REQUIRED", "tenant context required for entitlement check", reqID)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			decision, err := checker.Check(r.Context(), user.TenantID, r.Header.Get("Authorization"), key)
			if gwMetrics != nil {
				gwMetrics.EntitlementCheckDuration.Observe(time.Since(start).Seconds())
			}

			if err != nil {
				if failOpen {
					recordEntitlement(gwMetrics, key, "fail_open")
					logger.Warn().Err(err).
						Str("request_id", reqID).
						Str("tenant_id", user.TenantID).
						Str("entitlement", key).
						Msg("entitlement check failed; allowing request (fail-open)")
					next.ServeHTTP(w, r)
					return
				}
				recordEntitlement(gwMetrics, key, "fail_closed")
				logger.Warn().Err(err).
					Str("request_id", reqID).
					Str("tenant_id", user.TenantID).
					Str("entitlement", key).
					Msg("entitlement check failed; denying request (fail-closed)")
				writeGWError(w, http.StatusServiceUnavailable, "ENTITLEMENT_UNAVAILABLE", "unable to verify license entitlement", reqID)
				return
			}

			if decision.Cached {
				recordEntitlement(gwMetrics, key, "cache_hit")
			}

			if !decision.Allowed {
				recordEntitlement(gwMetrics, key, "denied")
				logger.Info().
					Str("request_id", reqID).
					Str("tenant_id", user.TenantID).
					Str("entitlement", key).
					Str("reason", decision.Reason).
					Msg("request denied: tenant not entitled")
				writeEntitlementRequiredError(w, key, entitlementMessage(decision.Reason), reqID)
				return
			}

			recordEntitlement(gwMetrics, key, "allowed")
			next.ServeHTTP(w, r)
		})
	}
}

func recordEntitlement(m *metrics.GatewayMetrics, key, result string) {
	if m != nil {
		m.EntitlementChecks.WithLabelValues(key, result).Inc()
	}
}

func entitlementMessage(reason string) string {
	if reason == "" {
		return "your plan does not include this feature"
	}
	return "your plan does not include this feature: " + reason
}

func writeEntitlementRequiredError(w http.ResponseWriter, entitlementKey, message, requestID string) {
	errorBody := map[string]any{
		"code":          "ENTITLEMENT_REQUIRED",
		"message":       message,
		"request_id":    requestID,
		"plan_required": entitlementKey,
		"upgrade_url":   entitlementUpgradeURL(entitlementKey),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusPaymentRequired)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": errorBody,
	})
}

func entitlementUpgradeURL(entitlementKey string) string {
	if suite, ok := entitlementToSelfServeSuite[entitlementKey]; ok {
		return fmt.Sprintf("/register?suites=%s&plan=trial", suite)
	}
	return "/pricing"
}

var entitlementToSelfServeSuite = map[string]string{
	"suite.cyber":            "cyber",
	"suite.data":             "data",
	"suite.siem":             "siem",
	"suite.datastream":       "datastream",
	"app.acta":               "acta",
	"app.watheeq":            "lex",
	"app.bosalah":            "visus",
	"recover.it_dr":          "recover",
	"recover.cloud_dr":       "recover",
	"recover.cyber_recovery": "recover",
	"respond.major_incident": "respond",
}
