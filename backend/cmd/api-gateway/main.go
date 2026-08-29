package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog/log"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/events"
	gwadmin "github.com/clario360/platform/internal/gateway/admin"
	"github.com/clario360/platform/internal/gateway/audittap"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
	"github.com/clario360/platform/internal/gateway/entitlement"
	"github.com/clario360/platform/internal/gateway/health"
	gwmetrics "github.com/clario360/platform/internal/gateway/metrics"
	gwmw "github.com/clario360/platform/internal/gateway/middleware"
	"github.com/clario360/platform/internal/gateway/proxy"
	"github.com/clario360/platform/internal/gateway/ratelimit"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
)

var gatewayCORSAllowedHeaders = []string{
	"Authorization",
	"Content-Type",
	"X-Request-ID",
	"X-API-Key",
	"X-API-Version",
	"X-Device-Id",
	"X-CSRF-Token",
	"X-Locale",
}

func main() {
	ctx := context.Background()

	// ── 1. Load config ────────────────────────────────────────────────────────
	legacyCfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("loading config")
	}

	gCfg, err := gwconfig.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("loading gateway config")
	}

	env := gCfg.Environment

	// ── 2. Bootstrap infrastructure ──────────────────────────────────────────
	svcCfg := &bootstrap.ServiceConfig{
		Name:        "api-gateway",
		Version:     "1.0.0",
		Environment: env,
		Port:        gCfg.HTTPPort,
		AdminPort:   gCfg.AdminPort,
		LogLevel:    legacyCfg.Observability.LogLevel,
		// Pass the gateway's configured CORS allowlist into the bootstrap so its
		// CORS middleware uses the real origins (GW_CORS_ALLOWED_ORIGINS) instead
		// of the localhost-only DefaultCORSConfig, which Validate() rejects in
		// production and would Fatal the gateway at boot.
		CORSAllowedOrigins: gCfg.CORSAllowedOrigins,
		// Deliberate opt-in so the staging backend can accept the external
		// frontend team's localhost origins while GW_ENVIRONMENT stays
		// "production" (keeping entitlement enforcement and the wildcard ban).
		AllowLocalhostCORSOrigins: gCfg.CORSAllowLocalhostOrigins,
		Redis: &bootstrap.RedisConfig{
			Addr:     legacyCfg.Redis.Addr(),
			Password: legacyCfg.Redis.Password,
			DB:       legacyCfg.Redis.DB,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     legacyCfg.Observability.OTLPEndpoint != "",
			Endpoint:    legacyCfg.Observability.OTLPEndpoint,
			ServiceName: "api-gateway",
			Version:     "1.0.0",
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: legacyCfg.Server.ShutdownTimeout,
		ReadTimeout:     gCfg.ReadTimeout,
		WriteTimeout:    gCfg.WriteTimeout,
	}

	svc, err := bootstrap.Bootstrap(ctx, svcCfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to bootstrap api-gateway")
	}

	// ── 3. JWT Manager ────────────────────────────────────────────────────────
	jwtMgr, err := auth.NewJWTManager(legacyCfg.Auth)
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	// ── 4. Service Registry ───────────────────────────────────────────────────
	registry, err := proxy.NewServiceRegistry(gwconfig.DefaultServices())
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to create service registry")
	}

	// ── 5. Circuit Breakers + Proxy Router ────────────────────────────────────
	routes := gwconfig.DefaultRoutes()
	cbCfg := proxy.CircuitBreakerConfig{
		FailureThreshold:   gCfg.CBFailureThreshold,
		FailureRateWindow:  time.Duration(gCfg.CBIntervalSec) * time.Second,
		FailureRatePercent: 50,
		OpenTimeout:        time.Duration(gCfg.CBTimeoutSec) * time.Second,
		HalfOpenSuccesses:  gCfg.CBMaxRequests,
	}
	proxyRouter, err := proxy.NewRouter(routes, registry, cbCfg, svc.Logger)
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to create proxy router")
	}

	// ── 6. Rate Limiter ───────────────────────────────────────────────────────
	rlCfg := ratelimit.ConfigFromGateway(
		gCfg.RateLimitAuthPerMin,
		gCfg.RateLimitReadPerMin,
		gCfg.RateLimitWritePerMin,
		gCfg.RateLimitAdminPerMin,
		gCfg.RateLimitUploadPerMin,
		gCfg.RateLimitWSPerMin,
	)
	// Per-tenant tier resolution (G20): tenant rate-limit tiers are stored in
	// Redis under tenant_tier:<id> and managed via the gateway admin API. The
	// resolver falls back to the professional tier when unset or Redis is down.
	tierResolver := ratelimit.NewRedisTierResolver(svc.Redis)
	limiter := ratelimit.NewLimiterWithTierResolver(svc.Redis, rlCfg, tierResolver)

	// ── 7. Gateway Metrics ────────────────────────────────────────────────────
	gwMetrics := gwmetrics.NewGatewayMetrics()
	auditTap := audittap.NoopTap{}

	// G18 metrics fix: keep gw_circuit_breaker_state / _trips_total accurate by
	// reacting to every breaker transition (automatic and operator-forced). On a
	// transition into Open we count a trip; on every transition we set the state
	// gauge. Previously the gauge was only refreshed on the status endpoint poll
	// and trips were never counted.
	for name, rp := range proxyRouter.Proxies() {
		service := name
		breaker := rp.Breaker()
		// Initialise the gauge to the current (closed) state.
		gwMetrics.CircuitBreakerState.WithLabelValues(service).Set(float64(breaker.State()))
		breaker.SetOnTransition(func(from, to proxy.CircuitState) {
			gwMetrics.CircuitBreakerState.WithLabelValues(service).Set(float64(to))
			if to == proxy.CircuitOpen {
				gwMetrics.CircuitBreakerTrips.WithLabelValues(service).Inc()
			}
		})
	}

	// G19: Redis-backed kill-switch store (survives restarts, shared across
	// replicas). A nil Redis client makes it a no-op (fails open).
	killSwitchStore := gwadmin.NewKillSwitchStore(svc.Redis)

	// ── 7b. Entitlement checker (licensing enforcement) ───────────────────────
	// Resolves plan entitlements via the licensing service, cached in Redis.
	var entitlementChecker entitlement.Checker
	// cachedChecker is the concrete cache so the cache-bust consumer (7c) can
	// drive its Invalidate* methods; nil when enforcement/license-service is off.
	var cachedChecker *entitlement.CachedChecker
	if gCfg.EntitlementEnabled {
		if licenseURL, _, ok := registry.Resolve("license-service"); ok {
			httpChecker := entitlement.NewHTTPChecker(licenseURL.String(), 3*time.Second)
			cachedChecker = entitlement.NewCachedChecker(httpChecker, svc.Redis,
				time.Duration(gCfg.EntitlementCacheSec)*time.Second)
			entitlementChecker = cachedChecker
			svc.Logger.Info().
				Str("license_service", licenseURL.String()).
				Str("environment", gCfg.Environment).
				Bool("fail_open", gCfg.EntitlementFailOpen).
				Int("cache_sec", gCfg.EntitlementCacheSec).
				Msg("entitlement enforcement enabled")
		} else if gCfg.IsProduction() {
			svc.Logger.Fatal().Msg("entitlement enforcement enabled but license-service is not in registry; refusing to start with ungated suite routes")
		} else {
			svc.Logger.Warn().Msg("entitlement enforcement enabled but license-service not in registry; suite routes will not be plan-gated")
		}
	}

	// ── 7c. Entitlement cache-bust consumer ──────────────────────────────────
	// The entitlement cache is TTL-only (GW_ENTITLEMENT_CACHE_SEC, default 30s):
	// after a license is corrected, a tenant can keep getting 402 until the
	// cached decision expires. Consume the license-service
	// license.entitlements_changed event and drop the affected cache entries
	// immediately (whole tenant on invalidate_all, one key otherwise).
	//
	// Strictly best-effort: a missing/broken kafka connection only logs and is
	// skipped — the TTL is the correctness backstop, so the consumer never
	// blocks or crashes the gateway. Runs in its own goroutine; svc.Run below
	// owns the blocking lifecycle and shutdown signal.
	if cachedChecker != nil {
		if kafkaConsumer, kerr := events.NewConsumerWithConfig(events.ConsumerConfig{
			Brokers:             legacyCfg.Kafka.Brokers,
			GroupID:             "api-gateway-entitlement-cache-bust",
			AutoOffsetReset:     "latest",
			WorkersPerPartition: 1,
		}, svc.Logger); kerr != nil {
			svc.Logger.Warn().Err(kerr).Msg("entitlement cache-bust consumer unavailable — falling back to TTL-only invalidation")
		} else {
			cacheBust := entitlement.NewCacheBustConsumer(kafkaConsumer, cachedChecker, svc.Logger)
			go func() {
				if err := cacheBust.Start(ctx); err != nil {
					svc.Logger.Warn().Err(err).Msg("entitlement cache-bust consumer stopped — TTL remains the invalidation backstop")
				}
			}()
		}
	}

	// ── 8. Health Checker ─────────────────────────────────────────────────────
	healthChecker := health.NewChecker(registry, proxyRouter, svc.Logger)

	// ── 9. Build main router ──────────────────────────────────────────────────
	// Build per-route body size and timeout override maps.
	bodyOverrides := make(map[string]int)
	timeoutOverrides := make(map[string]time.Duration)
	for _, r := range routes {
		if r.MaxBodyMB > 0 {
			bodyOverrides[r.Prefix] = r.MaxBodyMB
		}
		if r.TimeoutSec > 0 {
			timeoutOverrides[r.Prefix] = time.Duration(r.TimeoutSec) * time.Second
		}
	}

	svc.Router = chi.NewRouter()

	// Middleware chain in security-critical order:
	// Recovery → RequestID → SecurityHeaders → CORS → BodyLimit → Logging → Metrics → Timeout → (Auth per-route) → ProxyHeaders → Contract → RateLimit
	svc.Router.Use(middleware.RecoveryWithLogger(svc.Logger))
	svc.Router.Use(middleware.RequestID)
	svc.Router.Use(middleware.SecurityHeaders())
	svc.Router.Use(middleware.CORS(middleware.CORSConfig{
		AllowedOrigins:   gCfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   gatewayCORSAllowedHeaders,
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"},
		AllowCredentials: true,
		MaxAge:           3600,
	}))
	svc.Router.Use(gwmw.BodyLimit(gCfg.MaxRequestBodyMB, bodyOverrides))
	svc.Router.Use(middleware.Logging(svc.Logger))
	svc.Router.Use(tracing.ChiTracingMiddleware(svcCfg.Name))
	svc.Router.Use(gwmw.Timeout(gCfg.ProxyTimeout, timeoutOverrides))

	// ── 10. Health endpoints (no auth) ────────────────────────────────────────
	svc.Router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
	})

	svc.Router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		// Check Redis connectivity (rate limiter depends on it).
		ctx2, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := svc.Redis.Ping(ctx2).Err(); err != nil {
			svc.Logger.Warn().Err(err).Msg("readyz: redis unavailable")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "degraded", "reason": "redis unavailable"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	})

	// ── 11. Gateway status (proxied to admin port via Bootstrap) ─────────────
	svc.Router.Get("/api/v1/gateway/status", func(w http.ResponseWriter, r *http.Request) {
		type serviceStatus struct {
			Name           string `json:"name"`
			CircuitBreaker string `json:"circuit_breaker"`
		}
		proxies := proxyRouter.Proxies()
		statuses := make([]serviceStatus, 0, len(proxies))
		for name, rp := range proxies {
			cbState := rp.CircuitState()
			statuses = append(statuses, serviceStatus{
				Name:           name,
				CircuitBreaker: cbState.String(),
			})
			gwMetrics.CircuitBreakerState.WithLabelValues(name).Set(float64(cbState))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"services": statuses})
	})

	// ── 11b. Authenticated gateway admin API (G13/G18/G19/G20) ────────────────
	// Distinct from the unauthenticated /api/v1/gateway/status surface above: the
	// whole group is JWT-authenticated, and each route applies its own granular
	// platform:gateway:read / platform:gateway:admin permission gate.
	gwAdmin := gwadmin.NewHandler(routes, proxyRouter, killSwitchStore, rlCfg, svc.Redis, svc.Logger)
	svc.Router.Route("/api/v1/gateway/admin", func(r chi.Router) {
		r.Use(middleware.Auth(jwtMgr))
		gwAdmin.Mount(r)
	})

	// ── 12. Register HTTP proxy routes ────────────────────────────────────────
	for _, route := range routes {
		route := route // capture
		match := proxyRouter.Match(route.Prefix)
		if !match.Matched {
			svc.Logger.Warn().Str("prefix", route.Prefix).Msg("no proxy found for route, skipping")
			continue
		}
		rp := match.Proxy

		svc.Router.Route(route.Prefix, func(sub chi.Router) {
			// Auth middleware: validate JWT for protected routes; optional for public.
			if !route.Public {
				sub.Use(gwmw.ProxyAuth(jwtMgr, gwMetrics, svc.Logger))
			} else {
				sub.Use(middleware.OptionalAuth(jwtMgr))
			}

			// Read-only impersonation enforcement: the single chokepoint that
			// rejects state-changing methods when the validated token carries
			// Readonly==true. Runs immediately after auth so claims are present.
			sub.Use(gwmw.ProxyReadonly(svc.Logger))

			// G19 kill switch: short-circuit operator-disabled routes/services/
			// tenants/entitlements with 503 before the request reaches a backend.
			sub.Use(gwmw.ProxyKillSwitch(killSwitchStore, route, svc.Logger))

			// Inject/strip gateway headers.
			sub.Use(gwmw.ProxyHeaders)

			// Record gateway contract/version intent and inject trusted metadata.
			sub.Use(gwmw.ProxyContract(route, auditTap, svc.Logger))

			// Rate limiting (uses tenant_id from context set by ProxyAuth).
			sub.Use(gwmw.ProxyRateLimit(limiter, route.EndpointGroup, gwMetrics, svc.Logger))

			// Entitlement enforcement: plan-gate suite routes (slide 13).
			// Only applied to routes that declare an entitlement key.
			if entitlementChecker != nil && route.Entitlement != "" {
				sub.Use(gwmw.ProxyEntitlement(entitlementChecker, route.Entitlement, gCfg.EntitlementFailOpen, gwMetrics, svc.Logger))
			}

			// Metrics (no tenant_id label).
			sub.Use(gwmw.ProxyMetrics(gwMetrics, route.Service))

			// Structured logging per proxied request.
			sub.Use(gwmw.ProxyLogging(svc.Logger, route.Service))

			sub.Use(tracing.SpanEnricher())

			sub.HandleFunc("/*", rp.ServeHTTP)
			sub.HandleFunc("/", rp.ServeHTTP)
		})
	}

	// ── 13. WebSocket proxy routes ────────────────────────────────────────────
	for _, wsRoute := range gwconfig.DefaultWSRoutes() {
		wsRoute := wsRoute // capture
		target, _, ok := registry.Resolve(wsRoute.Service)
		if !ok {
			svc.Logger.Warn().Str("service", wsRoute.Service).Msg("WS service not found in registry")
			continue
		}

		wsProxy := proxy.NewWebSocketProxy(
			target,
			jwtMgr,
			gCfg.CORSAllowedOrigins,
			nil, // limiter — implement WSLimiter adapter if needed
			gwMetrics,
			svc.Logger,
		)

		svc.Router.HandleFunc(wsRoute.Prefix+"/*", wsProxy.ServeHTTP)
		svc.Router.HandleFunc(wsRoute.Prefix, wsProxy.ServeHTTP)
	}

	// Aggregated backend health (on admin router to avoid public exposure of topology).
	svc.AdminRouter.Get("/health", healthChecker.Handler())

	// ── G21: expose gateway gw_* metrics on a scrape surface ──────────────────
	// The gateway keeps its metrics in a dedicated per-instance registry
	// (gwMetrics.Registry) isolated from the bootstrap/observability registry that
	// backs /metrics. Without this the gw_* series (requests, circuit-breaker
	// state/trips, rate-limit, entitlement, upstream errors) are never scrapeable
	// (C-8). Serve them on the admin port at /metrics/gateway.
	svc.AdminRouter.Handle("/metrics/gateway", promhttp.HandlerFor(gwMetrics.Registry, promhttp.HandlerOpts{}))

	// 404 handler with structured error.
	svc.Router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":       "NOT_FOUND",
				"message":    "no route matches " + r.URL.Path,
				"request_id": middleware.GetRequestID(r.Context()),
			},
		})
	})

	svc.Logger.Info().Int("port", gCfg.HTTPPort).Int("admin_port", gCfg.AdminPort).Msg("api-gateway starting")
	if err := svc.Run(ctx); err != nil {
		svc.Logger.Fatal().Err(err).Msg("api-gateway failed")
		os.Exit(1)
	}
}
