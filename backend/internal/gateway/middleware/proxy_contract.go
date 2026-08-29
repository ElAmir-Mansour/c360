package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/gateway/audittap"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
	mw "github.com/clario360/platform/internal/middleware"
)

const (
	HeaderAPIVersion             = "X-API-Version"
	HeaderGatewayAPIVersion      = "X-Gateway-API-Version"
	HeaderGatewayContractID      = "X-Gateway-Contract-ID"
	HeaderGatewayContractVersion = "X-Gateway-Contract-Version"
	HeaderGatewayContractPhase   = "X-Gateway-Contract-Phase"
	HeaderGatewayRoutePrefix     = "X-Gateway-Route-Prefix"
	HeaderGatewayRouteService    = "X-Gateway-Route-Service"
)

// ProxyContract records contract intent for proxied requests and optionally
// rejects requests whose requested API version is missing or unsupported.
func ProxyContract(route gwconfig.RouteConfig, tap audittap.Tap, logger zerolog.Logger) func(http.Handler) http.Handler {
	if tap == nil {
		tap = audittap.NoopTap{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			event := contractEvent(route, r)

			if ok, reason := contractVersionAllowed(route.Contract, event.RequestedVersion); !ok {
				event.Outcome = "version_observed"
				if route.Contract.FailClosed {
					event.Outcome = "version_rejected"
				}
				event.Reason = reason
				if !recordContractEvent(r, event, route.Contract.FailClosed, tap, logger, w) {
					return
				}
				if route.Contract.FailClosed {
					writeGWError(w, http.StatusUpgradeRequired, "UNSUPPORTED_API_VERSION", reason, event.RequestID)
					return
				}

				logger.Debug().
					Str("request_id", event.RequestID).
					Str("route_prefix", route.Prefix).
					Str("api_version", route.Contract.APIVersion).
					Str("requested_api_version", event.RequestedVersion).
					Str("reason", reason).
					Msg("gateway contract version mismatch observed")
			} else {
				event.Outcome = "allowed"
				if !recordContractEvent(r, event, route.Contract.FailClosed, tap, logger, w) {
					return
				}
			}

			injectContractHeaders(r, route)
			next.ServeHTTP(w, r)
		})
	}
}

func contractEvent(route gwconfig.RouteConfig, r *http.Request) audittap.Event {
	userID := ""
	tenantID := ""
	if user := auth.UserFromContext(r.Context()); user != nil {
		userID = user.ID
		tenantID = user.TenantID
	}

	return audittap.Event{
		RequestID:        mw.GetRequestID(r.Context()),
		Method:           r.Method,
		Path:             r.URL.Path,
		RoutePrefix:      route.Prefix,
		Service:          route.Service,
		EndpointGroup:    string(route.EndpointGroup),
		Public:           route.Public,
		ContractID:       route.Contract.ID,
		ContractVersion:  route.Contract.Version,
		ContractPhase:    route.Contract.Phase,
		APIVersion:       route.Contract.APIVersion,
		RequestedVersion: strings.TrimSpace(r.Header.Get(HeaderAPIVersion)),
		FailClosed:       route.Contract.FailClosed,
		TenantID:         tenantID,
		UserID:           userID,
		Headers:          captureContractHeaders(r),
	}
}

func captureContractHeaders(r *http.Request) map[string]string {
	headers := make(map[string]string)
	for _, name := range []string{HeaderAPIVersion, "Accept", "Content-Type"} {
		if value := strings.TrimSpace(r.Header.Get(name)); value != "" {
			headers[name] = value
		}
	}
	return headers
}

func contractVersionAllowed(contract gwconfig.ContractIntent, requested string) (bool, string) {
	expected := strings.TrimSpace(contract.APIVersion)
	if expected == "" {
		return true, ""
	}
	if requested == "" {
		return false, fmt.Sprintf("request API version is required; expected %s", expected)
	}
	if !strings.EqualFold(requested, expected) {
		return false, fmt.Sprintf("unsupported API version %q; expected %s", requested, expected)
	}
	return true, ""
}

func recordContractEvent(r *http.Request, event audittap.Event, failClosed bool, tap audittap.Tap, logger zerolog.Logger, w http.ResponseWriter) bool {
	if err := tap.Record(r.Context(), event); err != nil {
		logger.Warn().
			Err(err).
			Str("request_id", event.RequestID).
			Str("route_prefix", event.RoutePrefix).
			Str("contract_id", event.ContractID).
			Bool("fail_closed", failClosed).
			Msg("gateway contract audit tap failed")
		if failClosed {
			writeGWError(w, http.StatusServiceUnavailable, "AUDIT_TAP_UNAVAILABLE", "unable to record gateway contract audit event", event.RequestID)
			return false
		}
	}
	return true
}

func injectContractHeaders(r *http.Request, route gwconfig.RouteConfig) {
	setIfPresent(r, HeaderGatewayRoutePrefix, route.Prefix)
	setIfPresent(r, HeaderGatewayRouteService, route.Service)
	setIfPresent(r, HeaderGatewayContractID, route.Contract.ID)
	setIfPresent(r, HeaderGatewayContractVersion, route.Contract.Version)
	setIfPresent(r, HeaderGatewayContractPhase, route.Contract.Phase)
	setIfPresent(r, HeaderGatewayAPIVersion, route.Contract.APIVersion)
}

func setIfPresent(r *http.Request, name, value string) {
	if strings.TrimSpace(value) == "" {
		r.Header.Del(name)
		return
	}
	r.Header.Set(name, value)
}
