package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/gateway/entitlement"
	"github.com/clario360/platform/internal/middleware"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	"github.com/clario360/platform/internal/respond"
	respondconfig "github.com/clario360/platform/internal/respond/config"
)

const serviceVersion = "1.0.0"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	baseCfg, err := appconfig.Load()
	if err != nil {
		os.Stderr.WriteString("loading platform config: " + err.Error() + "\n")
		os.Exit(1)
	}
	respondCfg, err := respondconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading respond config: " + err.Error() + "\n")
		os.Exit(1)
	}

	svc, err := bootstrap.Bootstrap(ctx, buildBootstrapConfig(baseCfg, respondCfg))
	if err != nil {
		os.Stderr.WriteString("bootstrapping respond-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger

	if err := runMigrations(respondCfg); err != nil {
		logger.Fatal().Err(err).Msg("failed to run respond migrations")
	}

	if respondCfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(respondCfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", respondCfg.JWTPublicKeyPath).Msg("failed to read RESPOND_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	httpChecker := entitlement.NewHTTPChecker(respondCfg.LicenseServiceURL, respondCfg.EntitlementTimeout)
	entitlementResolver, err := respond.NewCheckerResolver(httpChecker, respondCfg.EntitlementFailOpen)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create respond entitlement resolver")
	}

	respondSvc := respond.NewService(svc.DBPool, logger, entitlementResolver)
	if strings.TrimSpace(respondCfg.NotificationServiceURL) != "" {
		notificationSender, err := respond.NewHTTPNotificationSender(respond.HTTPNotificationSenderConfig{
			BaseURL: respondCfg.NotificationServiceURL,
			Token:   respondCfg.NotificationServiceToken,
			Timeout: respondCfg.NotificationTimeout,
		})
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to configure respond notification sender")
		}
		notificationEngine, err := respond.NewPersistentNotificationEngine(
			svc.DBPool,
			notificationSender,
			respond.WithDefaultAckTimeout(respondCfg.MobilizationAckTimeout),
		)
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to configure respond notification engine")
		}
		responderResolver, err := respond.NewPersistentResponderResolverForPool(svc.DBPool)
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to configure respond responder resolver")
		}
		respondSvc.EnableNotificationMobilization(notificationEngine, responderResolver, respondCfg.MobilizationAckTimeout)
		logger.Info().Str("notification_service_url", respondCfg.NotificationServiceURL).Msg("respond mobilization notifications enabled")
	}
	respondRouter := respond.NewRouter(respondSvc, logger)
	integrationOpts, err := buildIntegrationOptions(respondCfg)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to configure respond integrations")
	}
	integrationSvc := respond.NewRespondIntegrationService(svc.DBPool, logger, integrationOpts...)
	integrationRouter := respond.NewIntegrationRouter(integrationSvc, logger)

	svc.Router.Use(middleware.SecurityHeaders())
	svc.Router.Route("/api/v1/respond", func(r chi.Router) {
		mountRoutes(r, respondRouter.PublicRoutes())
		mountRoutes(r, integrationRouter.PublicRoutes())
		r.Group(func(r chi.Router) {
			r.Use(middleware.Auth(jwtMgr))
			r.Use(middleware.Tenant)
			mountRoutes(r, respondRouter.Routes())
			mountRoutes(r, integrationRouter.Routes())
		})
	})

	logger.Info().
		Int("port", respondCfg.HTTPPort).
		Int("admin_port", respondCfg.AdminPort).
		Msg("respond-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("respond-service failed")
	}
}

func buildBootstrapConfig(baseCfg *appconfig.Config, respondCfg *respondconfig.Config) *bootstrap.ServiceConfig {
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
	}
	return &bootstrap.ServiceConfig{
		Name:        "respond-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        respondCfg.HTTPPort,
		AdminPort:   respondCfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               respondCfg.DBURL,
			MinConns:          respondCfg.DBMinConns,
			MaxConns:          respondCfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "respond-service",
			Version:     serviceVersion,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: baseCfg.Server.ShutdownTimeout,
		ReadTimeout:     baseCfg.Server.ReadTimeout,
		WriteTimeout:    baseCfg.Server.WriteTimeout,
	}
}

func runMigrations(cfg *respondconfig.Config) error {
	migrationsPath := cfg.MigrationsPath
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "respond_db")
	}
	return database.RunMigrations(cfg.DBURL, migrationsPath)
}

func buildIntegrationOptions(cfg *respondconfig.Config) ([]respond.RespondIntegrationOption, error) {
	opts := []respond.RespondIntegrationOption{
		respond.WithRespondIntegrationSecretRefResolver(respond.EnvironmentIntegrationSecretRefResolver{}),
	}
	if cfg.IntegrationSecretKey == "" {
		return opts, nil
	}
	cipher, err := respond.NewConfigIntegrationSecretCipher(cfg.IntegrationSecretKey, cfg.IntegrationSecretKeyID)
	if err != nil {
		return nil, fmt.Errorf("RESPOND_INTEGRATION_SECRET_KEY: %w", err)
	}
	opts = append(opts, respond.WithRespondIntegrationSecretCipher(cipher))
	return opts, nil
}

func mountRoutes(parent chi.Router, sub chi.Router) {
	if err := chi.Walk(sub, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		if route != "/" {
			route = strings.TrimSuffix(route, "/")
		}
		h := handler
		for i := len(middlewares) - 1; i >= 0; i-- {
			h = middlewares[i](h)
		}
		parent.Method(method, route, h)
		return nil
	}); err != nil {
		panic(fmt.Sprintf("respond-service: walking routes: %v", err))
	}
}
