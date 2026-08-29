package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// internalRequestHeaders are headers injected by the gateway that must be stripped
// from incoming client requests to prevent spoofing.
var internalRequestHeaders = []string{
	"X-Tenant-ID",
	"X-User-ID",
	"X-User-Email",
	"X-User-Roles",
	"X-User-Permissions",
	"X-Gateway-API-Version",
	"X-Gateway-Contract-ID",
	"X-Gateway-Contract-Version",
	"X-Gateway-Contract-Phase",
	"X-Gateway-Route-Prefix",
	"X-Gateway-Route-Service",
}

// internalResponseHeaders are headers that must be stripped from backend responses
// before returning to the client.
var internalResponseHeaders = []string{
	"X-Powered-By",
	"Server",
	"X-AspNet-Version",
	"X-Runtime",
	"X-Tenant-ID",
	"X-User-ID",
	"X-User-Email",
	"X-User-Roles",
	"X-User-Permissions",
	"X-Gateway-API-Version",
	"X-Gateway-Contract-ID",
	"X-Gateway-Contract-Version",
	"X-Gateway-Contract-Phase",
	"X-Gateway-Route-Prefix",
	"X-Gateway-Route-Service",
	// Strip upstream CORS headers — the gateway's own CORS middleware is the
	// single authoritative source. Letting upstream CORS headers pass through
	// causes duplicate Access-Control-Allow-Origin values which browsers reject.
	"Access-Control-Allow-Origin",
	"Access-Control-Allow-Methods",
	"Access-Control-Allow-Headers",
	"Access-Control-Allow-Credentials",
	"Access-Control-Expose-Headers",
	"Access-Control-Max-Age",
}

// ReverseProxy wraps httputil.ReverseProxy with circuit breaker support.
type ReverseProxy struct {
	serviceName string
	target      *url.URL
	proxy       *httputil.ReverseProxy
	breaker     *CircuitBreaker
	logger      zerolog.Logger
}

// NewReverseProxy creates a reverse proxy for a backend service.
// The timeout parameter controls ResponseHeaderTimeout for upstream requests.
func NewReverseProxy(serviceName string, target *url.URL, timeout time.Duration, breaker *CircuitBreaker, logger zerolog.Logger) *ReverseProxy {
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	rp := &ReverseProxy{
		serviceName: serviceName,
		target:      target,
		breaker:     breaker,
		logger:      logger,
	}

	p := &httputil.ReverseProxy{
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			MaxIdleConns:          100,
			MaxIdleConnsPerHost:   20,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: timeout,
		},
		Director: func(req *http.Request) {
			// NOTE: internal header stripping and re-injection from JWT is handled
			// upstream by the ProxyHeaders middleware before this Director runs.
			// Do NOT strip them here — that would remove the JWT-injected values.

			// Rewrite destination.
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host

			// X-Forwarded-For: deliberately NOT appended here — after Director
			// returns, httputil.ReverseProxy itself appends the peer IP to
			// X-Forwarded-For exactly once. Appending here too duplicated the
			// client IP in the chain seen by services.

			// X-Forwarded-Host preserves the original host.
			req.Header.Set("X-Forwarded-Host", req.Header.Get("Host"))

			// X-Forwarded-Proto: trust upstream proxy header or infer.
			if req.Header.Get("X-Forwarded-Proto") == "" {
				proto := "http"
				if req.TLS != nil {
					proto = "https"
				}
				req.Header.Set("X-Forwarded-Proto", proto)
			}

			// X-Real-IP: first non-proxy IP in the chain.
			req.Header.Set("X-Real-IP", extractClientIP(req))
		},
		ModifyResponse: func(resp *http.Response) error {
			// Strip internal/server-identifying headers from the response.
			for _, h := range internalResponseHeaders {
				resp.Header.Del(h)
			}
			// Strip any X-Debug-* headers.
			for key := range resp.Header {
				if strings.HasPrefix(strings.ToLower(key), "x-debug-") {
					resp.Header.Del(key)
				}
			}

			// Record outcome for circuit breaker.
			if resp.StatusCode >= 500 {
				rp.breaker.RecordFailure()
			} else if isCircuitRecoveryProbe(rp.serviceName, resp.Request.URL.Path) {
				rp.breaker.RecordProbeSuccess()
			} else {
				rp.breaker.RecordSuccess()
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			rp.breaker.RecordFailure()

			status := http.StatusBadGateway
			code := "BAD_GATEWAY"
			message := "upstream service is unavailable"

			if err != nil {
				switch {
				case isContextError(err):
					status = http.StatusGatewayTimeout
					code = "GATEWAY_TIMEOUT"
					message = "upstream service did not respond in time"
				case isConnectionError(err):
					status = http.StatusBadGateway
					code = "BAD_GATEWAY"
					message = "upstream service is unavailable"
				}
			}

			// Log at ERROR but never expose service name, host, or port to the client.
			reqID, _ := r.Context().Value(requestIDKey).(string)
			rp.logger.Error().
				Err(err).
				Str("service", rp.serviceName).
				Str("path", r.URL.Path).
				Str("request_id", reqID).
				Msg("proxy error")

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": gatewayError{
					Code:      code,
					Message:   message,
					RequestID: reqID,
				},
			})
		},
	}

	rp.proxy = p
	return rp
}

// ServeHTTP handles the proxied request with circuit breaker check.
func (rp *ReverseProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /lex/me is the authenticated session spine and is intentionally able to
	// degrade when its optional databases are unavailable. Let it probe an
	// automatically-open Lex circuit so a healthy service can recover
	// immediately instead of returning a stale 503 until OpenTimeout elapses.
	// A force-open is an explicit operator decision and remains authoritative.
	if isCircuitRecoveryProbe(rp.serviceName, r.URL.Path) {
		snapshot := rp.breaker.Snapshot()
		if !snapshot.Forced && snapshot.State == CircuitOpen {
			rp.proxy.ServeHTTP(w, r)
			return
		}
	}

	if !rp.breaker.Allow() {
		rp.logger.Warn().
			Str("service", rp.serviceName).
			Str("state", rp.breaker.State().String()).
			Msg("circuit breaker open, rejecting request")

		reqID, _ := r.Context().Value(requestIDKey).(string)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "30")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": gatewayError{
				Code:      "SERVICE_UNAVAILABLE",
				Message:   "service is temporarily unavailable, please retry later",
				RequestID: reqID,
			},
		})
		return
	}

	rp.proxy.ServeHTTP(w, r)
}

func isCircuitRecoveryProbe(serviceName, path string) bool {
	if serviceName != "lex-service" {
		return false
	}
	return path == "/api/v1/lex/me" || path == "/api/v1/watheeq/me"
}

// ServiceName returns the name of the backend service.
func (rp *ReverseProxy) ServiceName() string {
	return rp.serviceName
}

// CircuitState returns the circuit breaker state.
func (rp *ReverseProxy) CircuitState() CircuitState {
	return rp.breaker.State()
}

// Breaker returns the underlying circuit breaker so the gateway admin API can
// read its snapshot and force state transitions (G18).
func (rp *ReverseProxy) Breaker() *CircuitBreaker {
	return rp.breaker
}

type gatewayError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
}

// requestIDKey is used to retrieve X-Request-ID from context.
// It matches the key used in the requestid middleware.
type ctxKey string

const requestIDKey ctxKey = "request_id"

func isContextError(err error) bool {
	return err == context.Canceled || err == context.DeadlineExceeded ||
		strings.Contains(err.Error(), "context canceled") ||
		strings.Contains(err.Error(), "context deadline exceeded")
}

func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "connection refused") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "no such host") ||
		strings.Contains(s, "dial tcp")
}

func extractClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Return the rightmost non-proxy IP that we trust.
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// WriteGatewayError writes a structured gateway error response.
func WriteGatewayError(w http.ResponseWriter, status int, code, message, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": gatewayError{
			Code:      code,
			Message:   message,
			RequestID: requestID,
		},
	})
}

// NewWebSocketHTTPProxy creates a simple WebSocket-capable reverse proxy using httputil.
// For real gorilla-based WebSocket proxying, use NewWebSocketProxy instead.
func NewWebSocketHTTPProxy(target *url.URL, logger zerolog.Logger) http.Handler {
	p := httputil.NewSingleHostReverseProxy(target)

	originalDirector := p.Director
	p.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
		if strings.EqualFold(req.Header.Get("Upgrade"), "websocket") {
			req.Header.Set("Connection", "Upgrade")
		}
	}

	p.Transport = &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		MaxIdleConns:        50,
		IdleConnTimeout:     120 * time.Second,
		TLSHandshakeTimeout: 5 * time.Second,
	}

	p.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Error().Err(err).Str("path", r.URL.Path).Msg("websocket proxy error")
		fmt.Fprintf(w, "websocket upstream unavailable")
	}

	return p
}
