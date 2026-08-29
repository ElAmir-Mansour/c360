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
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/gateway/entitlement"
	"github.com/clario360/platform/internal/middleware"
	migrate "github.com/clario360/platform/internal/migrate"
	migrateconfig "github.com/clario360/platform/internal/migrate/config"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	"github.com/clario360/platform/internal/recover/metastore"
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
	cfg, err := migrateconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading migrate config: " + err.Error() + "\n")
		os.Exit(1)
	}
	svc, err := bootstrap.Bootstrap(ctx, buildBootstrapConfig(baseCfg, cfg))
	if err != nil {
		os.Stderr.WriteString("bootstrapping migrate-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger
	if err := runMigrations(cfg); err != nil {
		logger.Fatal().Err(err).Msg("failed to run migrate migrations")
	}
	if cfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(cfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", cfg.JWTPublicKeyPath).Msg("failed to read MIGRATE_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}
	httpChecker := entitlement.NewHTTPChecker(cfg.LicenseServiceURL, cfg.EntitlementTimeout)
	entitlementResolver, err := migrate.NewCheckerResolver(httpChecker, cfg.EntitlementFailOpen)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create migrate entitlement resolver")
	}

	var drPool *pgxpool.Pool
	var meta metastore.MetastoreClient
	if strings.TrimSpace(cfg.DRDBURL) != "" {
		drPool, err = pgxpool.New(ctx, cfg.DRDBURL)
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to connect to dr_db for Recover Metastore")
		}
		defer drPool.Close()
		meta, err = metastore.NewDefaultRegistry(metastore.Config{
			Store:  metastore.NewStore(),
			Runner: metastore.PGXRunner{Pool: drPool},
			Logger: logger,
		})
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to configure Recover Metastore seam")
		}
	}

	opts := []migrate.Option{
		migrate.WithMetastore(meta),
		migrate.WithConnectorExecutor(migrate.NewHTTPConnectorExecutor(migrate.EnvironmentSecretResolver{}, cfg.ConnectorTimeout)),
	}
	// Wave 6, P10a: wire the connector-invocation webhook so generated wave/rollback
	// runbooks emit AUTOMATED connector-invocation tasks the DR engine's Executor
	// drives during a real cutover/rollback run. Requires migrate's own reachable
	// self URL AND a shared webhook token (defaults to the service token). Without
	// both, runbooks are still generated but carry no connector tasks (fail closed).
	if webhookURL := cfg.ConnectorWebhookURL(); webhookURL != "" && strings.TrimSpace(cfg.ConnectorWebhookToken) != "" {
		opts = append(opts, migrate.WithConnectorWebhook(migrate.ConnectorWebhookConfig{
			WebhookURL:   webhookURL,
			WebhookToken: cfg.ConnectorWebhookToken,
		}))
		logger.Info().Str("connector_webhook_url", webhookURL).Msg("migrate connector-invocation webhook enabled (runbooks emit connector tasks)")
	} else {
		logger.Warn().Msg("MIGRATE_SELF_URL/MIGRATE_CONNECTOR_WEBHOOK_TOKEN not set; generated runbooks will not invoke connectors")
	}
	if strings.TrimSpace(cfg.DRServiceURL) != "" {
		// Wire the DR Runbook Studio + Topology bridge so wave runbook generation
		// REUSES the existing DR engine over its internal HTTP API.
		opts = append(opts, migrate.WithDRBridge(
			migrate.NewHTTPDRBridge(cfg.DRServiceURL, cfg.InternalToken, cfg.DRBridgeTimeout),
		))
		logger.Info().Str("dr_service_url", cfg.DRServiceURL).Msg("migrate DR runbook bridge enabled")
	} else {
		logger.Warn().Msg("MIGRATE_DR_SERVICE_URL not set; wave runbook generation disabled (503)")
	}
	if strings.TrimSpace(cfg.WorkflowServiceURL) != "" {
		// Wave 5, H2: wire the shared workflow-engine approval client so move-group /
		// gate / rollback-plan approvals REUSE the real human-task approval workflow
		// instead of the local status flip the audit flagged as a bypass.
		opts = append(opts, migrate.WithApprovalWorkflowClient(
			migrate.NewHTTPApprovalWorkflowClient(cfg.WorkflowServiceURL, cfg.InternalToken, cfg.ApprovalWorkflowDefinitionID, cfg.WorkflowClientTimeout),
		))
		logger.Info().
			Str("workflow_service_url", cfg.WorkflowServiceURL).
			Str("approval_definition_id", cfg.ApprovalWorkflowDefinitionID).
			Msg("migrate workflow-backed approval enabled")
	} else {
		logger.Warn().Msg("MIGRATE_WORKFLOW_SERVICE_URL not set; move-group approvals fall back to the guarded manual-override path")
	}
	migrateSvc := migrate.NewService(svc.DBPool, logger, entitlementResolver, opts...)
	router := migrate.NewRouter(migrateSvc, logger)

	// Outbox relay (Wave 5, H1): migrate wave/cutover/rollback/gate events are
	// staged transactionally into migrate_db.event_outbox by the service; this
	// relay claims pending rows and publishes them to the migrate.events Kafka
	// topic, from which the notification-service consumer produces notifications.
	// It REUSES the shared relay + producer — no second event bus. Without a
	// reachable broker the events accumulate durably in the outbox.
	if len(baseCfg.Kafka.Brokers) > 0 {
		kafkaProducer, err := events.NewProducer(baseCfg.Kafka, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka producer unavailable — migrate events will accumulate in the outbox")
		} else {
			defer kafkaProducer.Close()
			relay := outbox.NewRelay(svc.DBPool, kafkaProducer, outbox.Config{}, logger,
				outbox.NewMetrics(svc.Metrics.Registry()))
			go func() {
				if err := relay.Run(ctx); err != nil {
					logger.Error().Err(err).Msg("migrate outbox relay stopped with error")
				}
			}()
			logger.Info().Strs("brokers", baseCfg.Kafka.Brokers).Str("topic", events.Topics.MigrateEvents).Msg("migrate outbox relay enabled")
		}
	} else {
		logger.Warn().Msg("no kafka brokers configured; migrate events will accumulate in the outbox until a relay is available")
	}

	svc.Router.Use(middleware.SecurityHeaders())
	svc.Router.Route("/api/v1/migrate", func(r chi.Router) {
		r.Use(middleware.Auth(jwtMgr))
		r.Use(middleware.Tenant)
		mountRoutes(r, router.Routes())
	})

	// Wave 5, H2: the service-token-guarded approval callback surface. The workflow
	// engine (or its notification consumer) POSTs here when an approval workflow
	// completes; migrate re-reads the instance to confirm the decision and drives
	// its FSM. Mounted only when a service token is configured so the internal
	// surface stays off unless explicitly enabled.
	if strings.TrimSpace(cfg.ServiceToken) != "" {
		svc.Router.Route("/internal/migrate", func(r chi.Router) {
			r.Use(middleware.ServiceToken(cfg.ServiceToken))
			mountRoutes(r, router.InternalRoutes())
		})
		logger.Info().Msg("migrate internal approval-callback surface enabled (/internal/migrate/approve-callback)")
	} else {
		logger.Warn().Msg("MIGRATE_SERVICE_TOKEN not set; approval callback surface disabled (use POST /move-groups/{id}/sync-approval to pull decisions)")
	}

	// Wave 6, P10a: the connector-invocation webhook the DR engine's Executor calls
	// during a cutover/rollback run. Mounted WITHOUT the X-Service-Token header
	// middleware (the DR Executor's HTTP action runner posts only a JSON body); the
	// call is authenticated by the per-task webhook token in the body. Enabled only
	// when the webhook is configured so the surface stays off otherwise.
	if webhookURL := cfg.ConnectorWebhookURL(); webhookURL != "" && strings.TrimSpace(cfg.ConnectorWebhookToken) != "" {
		svc.Router.Route("/internal/migrate/webhook", func(r chi.Router) {
			mountRoutes(r, router.WebhookRoutes())
		})
		logger.Info().Str("path", "/internal/migrate/webhook/connectors/invoke").Msg("migrate connector-invocation webhook surface enabled")
	}

	logger.Info().Int("port", cfg.HTTPPort).Int("admin_port", cfg.AdminPort).Msg("migrate-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("migrate-service failed")
	}
}

func buildBootstrapConfig(baseCfg *appconfig.Config, cfg *migrateconfig.Config) *bootstrap.ServiceConfig {
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "development"
	}
	return &bootstrap.ServiceConfig{
		Name:        "migrate-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        cfg.HTTPPort,
		AdminPort:   cfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               cfg.DBURL,
			MinConns:          cfg.DBMinConns,
			MaxConns:          cfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "migrate-service",
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

func runMigrations(cfg *migrateconfig.Config) error {
	migrationsPath := cfg.MigrationsPath
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "migrate_db")
	}
	return database.RunMigrations(cfg.DBURL, migrationsPath)
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
		panic(fmt.Sprintf("migrate-service: walking routes: %v", err))
	}
}
