package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	auditcfg "github.com/clario360/platform/internal/audit/config"
	"github.com/clario360/platform/internal/audit/consumer"
	"github.com/clario360/platform/internal/audit/handler"
	"github.com/clario360/platform/internal/audit/health"
	auditmw "github.com/clario360/platform/internal/audit/middleware"
	"github.com/clario360/platform/internal/audit/repository"
	"github.com/clario360/platform/internal/audit/service"
	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/observability"
	"github.com/clario360/platform/internal/server"
	"github.com/rs/zerolog"
)

func main() {
	// 1. Load platform config
	cfg, err := config.Load()
	if err != nil {
		panic("loading config: " + err.Error())
	}

	// Load audit-specific config from env
	auditCfg := auditcfg.LoadFromEnv()
	if err := auditCfg.Validate(); err != nil {
		panic("invalid audit config: " + err.Error())
	}
	cfg.Server.Port = auditCfg.HTTPPort

	// 2. Initialize structured logger
	logger := observability.NewLogger(
		cfg.Observability.LogLevel,
		cfg.Observability.LogFormat,
		"audit-service",
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 3. Initialize tracer
	shutdownTracer, err := observability.InitTracer(ctx, "audit-service", cfg.Observability.OTLPEndpoint)
	if err != nil {
		logger.Warn().Err(err).Msg("failed to initialize tracer")
	} else {
		defer shutdownTracer(ctx)
	}

	// 4. Run audit_db migrations, then connect the runtime pool to the same
	// database. AUDIT_DB_URL used to be honored only for migrations while the
	// service pool still used the shared DATABASE_NAME; that made production
	// query the wrong database after successfully migrating audit_db.
	auditDSN := buildAuditDSN(cfg)
	if err := runAuditMigrations(auditDSN); err != nil {
		logger.Fatal().Err(err).Msg("failed to run audit_db migrations")
	}
	logger.Info().Msg("audit_db migrations applied")

	db, err := database.Connect(ctx, buildAuditPoolConfig(cfg, auditCfg, auditDSN))
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to connect to audit database")
	}
	defer db.Close()
	logger.Info().
		Int("min_conns", auditCfg.DBMinConns).
		Int("max_conns", auditCfg.DBMaxConns).
		Msg("audit database connection pool established")

	// 7. Connect Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr(),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn().Err(err).Msg("redis connection failed — continuing with degraded functionality")
	}

	// 6. Create HTTP server with middleware stack
	srv, err := server.New(cfg, db, rdb, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create server")
	}

	// 7. Initialize Kafka producer (for DLQ)
	var producer *events.Producer
	kafkaProducer, err := events.NewProducer(cfg.Kafka, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka producer unavailable — DLQ events will not be published")
	} else {
		producer = kafkaProducer
		defer producer.Close()
	}

	// 8. Initialize repositories
	auditRepo := repository.NewAuditRepository(db, logger)
	partitionMgr := repository.NewPartitionManager(db, logger)

	// 9. Run partition ensure on startup
	created, err := partitionMgr.EnsurePartitions(ctx)
	if err != nil {
		logger.Error().Err(err).Msg("failed to ensure partitions on startup")
	} else if len(created) > 0 {
		logger.Info().Strs("created", created).Msg("partitions created on startup")
	}

	// 10. Initialize services
	maskingSvc := service.NewMaskingService()
	auditSvc := service.NewAuditService(auditRepo, rdb, logger, auditCfg.BatchSize, auditCfg.BatchWindow)
	querySvc := service.NewQueryService(auditRepo, maskingSvc, logger)
	integritySvc := service.NewIntegrityService(auditRepo, logger)
	exportSvc := service.NewExportService(auditRepo, maskingSvc, logger, auditCfg.ExportAsyncThreshold)
	exportJobs := service.NewExportJobStore(exportSvc, logger)

	// Start audit service batch flusher + async export worker
	auditSvc.Start(ctx)
	exportJobs.Start(ctx)

	// Hash-chain integrity runner: scheduled verification across all tenants.
	// Interval and window are env-tunable (AUDIT_INTEGRITY_INTERVAL,
	// AUDIT_INTEGRITY_WINDOW). Defaults: every 30 min, scan last 24h. Built here
	// (not inside the errgroup) so the platform handler can expose its last pass
	// via GET /admin/integrity/status.
	integrityInterval := durationFromEnv("AUDIT_INTEGRITY_INTERVAL", 30*time.Minute)
	integrityWindow := durationFromEnv("AUDIT_INTEGRITY_WINDOW", 24*time.Hour)
	integrityRunner := service.NewIntegrityRunner(integritySvc, auditRepo, integrityInterval, integrityWindow, logger)

	// 11. Initialize handlers
	auditHandler := handler.NewAuditHandler(querySvc, logger)
	exportHandler := handler.NewExportHandler(exportSvc, logger)
	adminHandler := handler.NewAdminHandler(partitionMgr, integritySvc, logger)
	platformHandler := handler.NewPlatformAuditHandler(auditRepo, integritySvc, exportSvc, exportJobs, integrityRunner, logger)

	// 12. Initialize health checker
	healthChecker := health.NewChecker(db, rdb, cfg.Kafka.Brokers, logger)

	// Override health endpoints with audit-specific checks
	srv.Router.Get("/healthz", health.LivenessHandler())
	srv.Router.Get("/readyz", healthChecker.ReadinessHandler())

	// 13. Register routes
	//
	// G17 hardening: every audit route now carries an explicit RequirePermission
	// gate (previously JWT + TenantGuard only — any authenticated tenant user
	// could export logs and even DELETE partitions). Reads require "audit:read";
	// partition mutations require "audit:partition:admin". The platform-console
	// (cross-tenant) routes carry their own narrower grants.
	srv.Router.Route("/api/v1/audit", func(r chi.Router) {
		r.Use(middleware.Auth(srv.JWTManager))
		r.Use(auditmw.TenantGuard)
		r.Use(auditmw.RateLimiter(rdb, auditCfg.RateLimitPerMinute, logger))

		// Query endpoints — read
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/logs", auditHandler.ListLogs)
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/logs/stats", auditHandler.GetStats)
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/logs/export", exportHandler.Export)
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/logs/timeline/{resourceId}", auditHandler.GetTimeline)
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/logs/{id}", auditHandler.GetLog)

		// Single-tenant integrity verify — read
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Post("/verify", adminHandler.VerifyChain)

		// Partition management — read to list, partition-admin to mutate
		r.With(middleware.RequirePermission(auth.PermAuditRead)).Get("/partitions", adminHandler.ListPartitions)
		r.With(middleware.RequirePermission(auth.PermAuditPartitionAdmin)).Post("/partitions", adminHandler.CreatePartition)
		r.With(middleware.RequirePermission(auth.PermAuditPartitionAdmin)).Post("/partitions/{name}/archive", adminHandler.ArchivePartition)
		r.With(middleware.RequirePermission(auth.PermAuditPartitionAdmin)).Delete("/partitions/{name}", adminHandler.DeletePartition)

		// G14: cross-tenant log query — audit:read:all
		r.With(middleware.RequirePermission(auth.PermAuditReadAll)).Get("/admin/logs", platformHandler.ListLogs)

		// G15: cross-tenant integrity verify + last-pass status — audit:integrity:verify
		r.With(middleware.RequirePermission(auth.PermAuditIntegrityVerify)).Post("/admin/verify", platformHandler.Verify)
		r.With(middleware.RequirePermission(auth.PermAuditIntegrityVerify)).Get("/admin/integrity/status", platformHandler.IntegrityStatus)

		// G16: async export jobs — audit:export
		r.With(middleware.RequirePermission(auth.PermAuditExport)).Post("/exports", platformHandler.CreateExport)
		r.With(middleware.RequirePermission(auth.PermAuditExport)).Get("/exports/{job_id}", platformHandler.GetExport)
		r.With(middleware.RequirePermission(auth.PermAuditExport)).Get("/exports/{job_id}/download", platformHandler.DownloadExport)
	})

	// 14. Initialize Kafka consumer
	var auditConsumer *consumer.AuditConsumer
	kafkaConsumer, err := events.NewConsumer(cfg.Kafka, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka consumer unavailable — audit event ingestion disabled")
	} else {
		var dlq *consumer.DeadLetterProducer
		if producer != nil {
			dlq = consumer.NewDeadLetterProducer(producer, logger)
		}
		auditConsumer = consumer.NewAuditConsumer(kafkaConsumer, auditSvc, dlq, logger)
	}

	// 15. Start all components via errgroup
	g, gCtx := errgroup.WithContext(ctx)

	// HTTP server
	g.Go(func() error {
		logger.Info().Int("port", cfg.Server.Port).Msg("audit-service HTTP server starting")
		if err := srv.HTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	})

	// Kafka consumer
	if auditConsumer != nil {
		g.Go(func() error {
			return auditConsumer.Start(gCtx)
		})
	}

	// Partition maintenance ticker (daily)
	g.Go(func() error {
		return runPartitionTicker(gCtx, partitionMgr, logger)
	})

	// Hash-chain integrity runner (constructed above): scheduled verification
	// across all tenants, surfaced via GET /admin/integrity/status.
	g.Go(func() error {
		integrityRunner.Start(gCtx)
		return nil
	})

	// 16. Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case <-gCtx.Done():
		logger.Info().Msg("context cancelled")
	}

	// 17. Graceful shutdown sequence
	cancel()

	// Flush audit buffer
	flushCtx, flushCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer flushCancel()
	if err := auditSvc.Stop(flushCtx); err != nil {
		logger.Error().Err(err).Msg("failed to flush audit buffer on shutdown")
	}

	// Shutdown HTTP server
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.HTTPServer.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("HTTP server shutdown error")
	}

	// Stop Kafka consumer
	if auditConsumer != nil {
		if err := auditConsumer.Stop(); err != nil {
			logger.Error().Err(err).Msg("kafka consumer shutdown error")
		}
	}

	if err := g.Wait(); err != nil {
		logger.Error().Err(err).Msg("errgroup finished with error")
	}

	logger.Info().Msg("audit-service stopped")
}

// buildAuditDSN constructs the DSN for audit_db, preferring the AUDIT_DB_URL
// env var and falling back to the standard database config.
func buildAuditDSN(cfg *config.Config) string {
	if v := os.Getenv("AUDIT_DB_URL"); v != "" {
		return v
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/audit_db?sslmode=%s",
		cfg.Database.User, cfg.Database.Password,
		cfg.Database.Host, cfg.Database.Port,
		cfg.Database.SSLMode,
	)
}

func buildAuditPoolConfig(cfg *config.Config, auditCfg *auditcfg.Config, auditDSN string) database.PoolConfig {
	return database.PoolConfig{
		URL:               auditDSN,
		MinConns:          auditCfg.DBMinConns,
		MaxConns:          auditCfg.DBMaxConns,
		MaxConnLife:       cfg.Database.ConnMaxLifetime,
		MaxConnIdle:       5 * time.Minute,
		HealthCheckPeriod: 30 * time.Second,
	}
}

// runAuditMigrations applies all pending audit_db file-based migrations.
func runAuditMigrations(dsn string) error {
	migrationsPath := "migrations/audit_db"
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "audit_db")
	}
	return database.RunMigrations(dsn, migrationsPath)
}

// runPartitionTicker runs daily partition maintenance.
func durationFromEnv(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func runPartitionTicker(ctx context.Context, pm *repository.PartitionManager, logger zerolog.Logger) error {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if created, err := pm.EnsurePartitions(ctx); err != nil {
				logger.Warn().Err(err).Msg("partition maintenance failed")
			} else if len(created) > 0 {
				logger.Info().Strs("created", created).Msg("partitions created by daily ticker")
			}
		}
	}
}
