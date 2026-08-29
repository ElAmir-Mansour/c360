// Command siem-service is the SIEM ingestion + correlation peer service.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/auth"
	platformconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/leadership"
	platformmw "github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/observability/bootstrap"
	siemadmin "github.com/clario360/platform/internal/siem/admin"
	siemaudit "github.com/clario360/platform/internal/siem/audit"
	siemconfig "github.com/clario360/platform/internal/siem/config"
	siemconsumer "github.com/clario360/platform/internal/siem/consumer"
	siemhandler "github.com/clario360/platform/internal/siem/handler"
	siemproducer "github.com/clario360/platform/internal/siem/producer"
	siemrepo "github.com/clario360/platform/internal/siem/repository"
	siemservice "github.com/clario360/platform/internal/siem/service"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/detector"
	"github.com/clario360/platform/internal/siem/sources/enroll"
	srchandler "github.com/clario360/platform/internal/siem/sources/handler"
	"github.com/clario360/platform/internal/siem/sources/mtls"
	"github.com/clario360/platform/internal/siem/sources/pki"
	srcrepo "github.com/clario360/platform/internal/siem/sources/repo"
	srcservice "github.com/clario360/platform/internal/siem/sources/service"
	siemstore "github.com/clario360/platform/internal/siem/store"
	siemminio "github.com/clario360/platform/internal/siem/store/minio"
	siemos "github.com/clario360/platform/internal/siem/store/opensearch"
	"github.com/clario360/platform/internal/vault"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "siem-service failed: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := siemconfig.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc, err := bootstrap.Bootstrap(ctx, cfg.ServiceConfig)
	if err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	logger := svc.Logger
	logger.Info().Str("config", cfg.String()).Msg("siem-service starting")

	// Run migrations BEFORE the readiness probe flips green. Failure
	// is fatal.
	migPath := findMigrationsPath()
	if err := database.RunMigrations(cfg.PGDSN, migPath); err != nil {
		return fmt.Errorf("run migrations from %s: %w", migPath, err)
	}
	logger.Info().Str("path", migPath).Msg("siem_db migrations applied")

	// JWT validator. We only verify (no signing) — public key only.
	jwtPubPEM, err := os.ReadFile(cfg.JWTPublicKeyPath)
	if err != nil {
		return fmt.Errorf("read JWT public key %q: %w", cfg.JWTPublicKeyPath, err)
	}
	jwtMgr, err := auth.NewJWTManager(platformconfig.AuthConfig{
		RSAPublicKeyPEM: string(jwtPubPEM),
		JWTIssuer:       cfg.JWTIssuer,
		AccessTokenTTL:  15 * time.Minute, // unused (validation only)
		RefreshTokenTTL: 24 * time.Hour,
	})
	if err != nil {
		return fmt.Errorf("init JWT manager: %w", err)
	}

	// Repository: prove the schema is reachable. Failure is logged
	// but not fatal so we still serve /healthz for liveness probes.
	healthRepo := siemrepo.NewHealthCheckRepository(svc.DBPool)
	if err := healthRepo.Ping(ctx); err != nil {
		logger.Warn().Err(err).Msg("siem schema ping failed — readiness will report degraded")
	}

	// Per-instance metric set.
	siemMetrics := siemservice.NewSIEMMetrics(svc.Metrics)
	siemMetrics.StartTime.Set(float64(time.Now().Unix()))
	if svc.DBPool != nil {
		siemMetrics.SetReadiness("postgres", true)
	}
	if svc.Redis != nil {
		siemMetrics.SetReadiness("redis", true)
	}
	// Kafka readiness is best-effort: bootstrap doesn't open a connection,
	// it just records the brokers. We start optimistic and let SIEM-04
	// wire a real probe.
	siemMetrics.SetReadiness("kafka", len(cfg.KafkaBrokers) > 0)

	// Audit emitter. SIEM-01 has no admin actions to emit, but the
	// wiring must be in place so SIEM-03 onwards plugs cleanly. The
	// emitter is a no-op until SIEM-04 introduces the Kafka path.
	auditEmitter := siemaudit.NewNoOp()
	// Smoke-test the wiring at boot. This is the "synthetic
	// siem.bootstrap audit entry" called out in the carry-over.
	bootEntry := siemaudit.NewSyntheticBootstrapEntry("system", "siem-service@bootstrap")
	if err := auditEmitter.Emit(ctx, bootEntry); err != nil {
		logger.Error().Err(err).Msg("synthetic bootstrap audit emit failed")
		siemMetrics.AuditEmitTotal.WithLabelValues("error").Inc()
	} else {
		siemMetrics.AuditEmitTotal.WithLabelValues("ok").Inc()
	}

	var prod *siemproducer.Producer
	if len(cfg.KafkaBrokers) > 0 {
		eventProducer, prodErr := events.NewProducer(platformconfig.KafkaConfig{
			Brokers: cfg.KafkaBrokers,
			GroupID: cfg.KafkaClientID,
		}, logger)
		if prodErr != nil {
			logger.Warn().Err(prodErr).Strs("brokers", cfg.KafkaBrokers).Msg("siem Kafka producer unavailable; source event emission degraded")
		} else {
			prod = siemproducer.New(eventProducer, "clario360/siem-service")
		}
	}

	// Meta service powers /_meta.
	metaSvc := siemservice.NewMetaService(nil)

	// SIEM-02 store wiring. We build the Vault client and the Store on a
	// best-effort basis: a missing OpenSearch/MinIO/Vault dependency does
	// NOT abort startup — readiness will reflect the missing dep through
	// the registered health checkers. This keeps SIEM-01 smoke tests
	// happy in environments that don't have the full stack yet.
	var storeClient *siemstore.Store
	vaultCfg := vault.Config{
		Addr:        os.Getenv("SIEM_VAULT_ADDR"),
		AuthMethod:  os.Getenv("SIEM_VAULT_AUTH_METHOD"),
		Token:       os.Getenv("SIEM_VAULT_TOKEN"),
		Environment: os.Getenv("SIEM_ENV"),
	}
	vc, vcErr := vault.NewClient(ctx, vaultCfg)
	if vcErr != nil {
		logger.Warn().Err(vcErr).Msg("vault client init failed — SIEM-02 store disabled")
	} else if cfg.Store.MinIOEndpoint != "" && len(cfg.Store.OpenSearchAddresses) > 0 {
		s, err := siemstore.New(ctx, siemstore.Dependencies{
			DB:         svc.DBPool,
			Logger:     &svc.Logger,
			Registerer: svc.Metrics.Registry(),
			Vault:      vc,
		}, siemstore.WithConfig(siemstore.Config{
			OpenSearch: siemos.Config{
				Addresses:                   cfg.Store.OpenSearchAddresses,
				Username:                    cfg.Store.OpenSearchUsername,
				Password:                    cfg.Store.OpenSearchPassword,
				InsecureTLS:                 cfg.Store.OpenSearchInsecureTLS,
				HealthMinStatus:             cfg.Store.OpenSearchHealthMinStatus,
				MaxBulkBytes:                cfg.Store.OpenSearchMaxBulkBytes,
				RolloverMaxAge:              cfg.Store.OpenSearchRolloverMaxAge,
				RolloverMaxPrimaryShardSize: cfg.Store.OpenSearchRolloverMaxShardSize,
			},
			MinIO: siemminio.Config{
				Endpoint:                      cfg.Store.MinIOEndpoint,
				AccessKey:                     cfg.Store.MinIOAccessKey,
				SecretKey:                     cfg.Store.MinIOSecretKey,
				UseSSL:                        cfg.Store.MinIOUseSSL,
				Region:                        cfg.Store.MinIORegion,
				Bucket:                        cfg.Store.MinIOBucket,
				WORMSelfTestBucket:            cfg.Store.MinIOWORMSelfTestBucket,
				ZstdLevel:                     cfg.Store.MinIOZstdLevel,
				SkipServerSideEncryptionCheck: cfg.Store.MinIOSkipSSECheck,
			},
			SelfTestEnabled: cfg.Store.SelfTestEnabled,
			Environment:     cfg.Store.Environment,
		}))
		if err != nil {
			logger.Warn().Err(err).Msg("siem-02 store init failed — store disabled")
		} else {
			storeClient = s
			svc.Health.AddCheckers(s.HealthCheckers()...)
			// Vault HealthChecker is registered separately because Store.HealthCheckers
			// composes opensearch + minio only; vault is a sibling cryptographic root.
			svc.Health.AddCheckers(vault.NewHealthChecker(vc, vaultCfg))
		}
	}

	// ---------- SIEM sources control-plane wiring ----------
	sourcesMetrics := sources.NewMetrics(prometheus.NewRegistry())

	// Phase 4: real Vault PKI when the client is up; no-op fallback when not.
	// The pki.Manager performs lazy mount/intermediate/role provisioning on
	// the first IssueLeaf call per tenant, so siem-service can still serve
	// CRUD/health endpoints when Vault is temporarily unreachable.
	var pkiBackend pki.VaultPKI
	if vc != nil {
		pkiBackend = newVaultPKIAdapter(vc, &svc.Logger)
		logger.Info().Msg("siem sources: real Vault PKI adapter wired")
	} else {
		pkiBackend = noopVaultPKI{logger: &svc.Logger}
		logger.Warn().Msg("siem sources: vault.Client unavailable — using no-op PKI fallback (IssueLeaf will fail)")
	}
	sourcesPKI := pki.New(pkiBackend, pki.Config{
		RootMount:           cfg.Sources.PKIRootMount,
		IntermediatePrefix:  cfg.Sources.PKIIntermediatePrefix,
		LeafTTL:             cfg.Sources.PKILeafTTL,
		IntermediateTTL:     5 * 365 * 24 * time.Hour,
		RoleName:            "collector-leaf",
		DefaultDomainSuffix: "collectors.siem.clario360.local",
	}, svc.Logger)

	sourcesRepoSet := struct {
		s    *srcrepo.SourcesRepo
		eps  *srcrepo.EPSRepo
		toks *srcrepo.EnrollmentTokensRepo
		rev  *srcrepo.RevocationRepo
	}{
		s:    srcrepo.NewSourcesRepo(svc.DBPool),
		eps:  srcrepo.NewEPSRepo(svc.DBPool),
		toks: srcrepo.NewEnrollmentTokensRepo(svc.DBPool),
		rev:  srcrepo.NewRevocationRepo(svc.DBPool),
	}

	tokenSigner, err := newEnrollmentSigner(
		cfg.Sources.EnrollTokenKeyName,
		cfg.Sources.EnrollTokenPrivateKeyB64,
		cfg.Sources.EnrollTokenPrivateKeyPath,
		cfg.Store.Environment,
		&svc.Logger,
	)
	if err != nil {
		return fmt.Errorf("init enrollment-token signer: %w", err)
	}
	tokenMgr := enroll.NewTokenManager(tokenSigner, svc.Redis)

	crlCache := pki.NewCRLCache(sourcesRepoSet.rev, time.Minute, svc.Logger)

	emitter := &kafkaEmitter{producer: prod, logger: &svc.Logger}

	enrollSvc := enroll.New(tokenMgr, sourcesRepoSet.s, sourcesRepoSet.toks, sourcesRepoSet.rev,
		sourcesPKI, crlCache, emitter, cfg.Sources.PKILeafOverlap, svc.Logger)

	sourcesSvc := srcservice.New(srcservice.Deps{
		Sources: sourcesRepoSet.s, EPS: sourcesRepoSet.eps,
		Tokens: sourcesRepoSet.toks, Revocations: sourcesRepoSet.rev,
		TokenMgr: tokenMgr, PKI: sourcesPKI,
		Emitter: emitter, Audit: auditEmitter, Metrics: sourcesMetrics,
		Logger: svc.Logger,
		Config: srcservice.Config{
			EnrollTokenTTL:           cfg.Sources.EnrollTokenTTL,
			LeafRotationWindow:       cfg.Sources.PKILeafRotationWindow,
			HeartbeatRateLimitPerMin: cfg.Sources.HeartbeatRateLimitPerMin,
			BaselineMinSamples:       cfg.Sources.DetectorBaselineMin,
		},
	})

	// Detector + leader election.
	//
	// Redis-backed leadership is wired when svc.Redis is available. Local
	// single-replica deployments without Redis use a deterministic single-leader
	// elector so detector scheduling still runs.
	var elector detector.Elector
	var leadershipRun func(context.Context) error
	if svc.Redis != nil {
		instanceID := os.Getenv("SIEM_LEADERSHIP_INSTANCE_ID")
		if instanceID == "" {
			hostname, hostErr := os.Hostname()
			if hostErr != nil || hostname == "" {
				hostname = "siem-service"
			}
			instanceID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
		}
		ttl := 30 * time.Second
		if v := os.Getenv("SIEM_LEADERSHIP_TTL"); v != "" {
			if d, err := time.ParseDuration(v); err == nil && d > 0 {
				ttl = d
			}
		}
		renew := 10 * time.Second
		if v := os.Getenv("SIEM_LEADERSHIP_RENEW"); v != "" {
			if d, err := time.ParseDuration(v); err == nil && d > 0 {
				renew = d
			}
		}
		redisElect := leadership.NewRedisElection(svc.Redis, "siem-detector", instanceID, ttl, renew, &svc.Logger)
		elector = redisElect
		leadershipRun = func(ctx context.Context) error {
			return redisElect.Run(ctx, leadership.RunOpts{
				OnAcquire: func(_ context.Context) {
					logger.Info().Str("role", "siem-detector").Str("instance", instanceID).Msg("siem-detector: acquired leadership")
				},
				OnLose: func() {
					logger.Warn().Str("role", "siem-detector").Str("instance", instanceID).Msg("siem-detector: lost leadership")
				},
			})
		}
		logger.Info().Str("instance", instanceID).Dur("ttl", ttl).Dur("renew", renew).Msg("siem sources: Redis leader election wired")
	} else {
		elector = singleLeader{}
		logger.Warn().Msg("siem sources: Redis unavailable — using local single-leader elector")
	}

	detectorCfg := detector.DefaultConfig()
	detectorCfg.Interval = cfg.Sources.DetectorInterval
	detectorCfg.BaselineMinSamples = cfg.Sources.DetectorBaselineMin
	detectorCfg.DriftThreshold = cfg.Sources.DetectorDriftThreshold
	detectorCfg.RecoveryThreshold = cfg.Sources.DetectorRecoveryThreshold
	detectorCfg.HeartbeatGap = cfg.Sources.DetectorHeartbeatGap
	det := detector.New(sourcesRepoSet.s, sourcesRepoSet.eps, elector, emitter, svc.Redis, sourcesMetrics, detectorCfg, svc.Logger)
	cleanup := detector.NewCleanupJob(sourcesRepoSet.eps, cfg.Sources.EPSSamplesRetention, 6*time.Hour, svc.Logger)

	// mTLS middleware + heartbeat mux on the dedicated listener.
	mtlsMW := mtls.NewMiddleware(sourcesRepoSet.s, crlCache, 60*time.Second)
	hbMux := srchandler.MountHeartbeatRouter(sourcesSvc, svc.Redis, mtlsMW, cfg.Sources.HeartbeatRateLimitPerMin)
	mtlsListener := mtls.New(mtls.ListenerConfig{
		Addr:           cfg.Sources.MTLSListenAddr,
		CABundlePath:   cfg.Sources.MTLSCABundlePath,
		ServerCertPath: cfg.Sources.MTLSServerCertPath,
		ServerKeyPath:  cfg.Sources.MTLSServerKeyPath,
	}, hbMux, svc.Logger)

	// Health checker: reports detector running, mTLS listener bound, leader state.
	svc.Health.AddCheckers(&sourcesHealth{detector: det, mtlsCABundle: cfg.Sources.MTLSCABundlePath, elector: elector})

	// Build the /sources router.
	sourcesRouter := srchandler.NewRouter(srchandler.Deps{
		Service: sourcesSvc, Enroller: enrollSvc, MTLS: mtlsMW,
		Redis: svc.Redis, Logger: svc.Logger,
		AdminRequired: platformmw.RequirePermission("siem:admin"),
		ReadRequired:  platformmw.RequirePermission("siem:read"),
	})

	// Parser catalogue and tenant settings admin routes.
	adminRepo := siemadmin.NewRepo(svc.DBPool)
	adminSvc := siemadmin.NewService(adminRepo)
	parsersRouter := siemadmin.NewParsersRouter(adminSvc)
	settingsRouter := siemadmin.NewSettingsRouter(adminSvc)

	// Mount /api/v1/siem.
	var notReady atomic.Bool
	siemRouter := siemhandler.NewRouter(siemhandler.Deps{
		Meta:            metaSvc,
		JWT:             jwtMgr,
		NotReady:        notReady.Load,
		Store:           storeClient,
		SelfTestEnabled: cfg.Store.SelfTestEnabled,
		SourcesRouter:   sourcesRouter,
		ParsersRouter:   parsersRouter,
		SettingsRouter:  settingsRouter,
	})
	svc.Router.Mount("/api/v1/siem", siemRouter)

	// Kafka consumer. SIEM-01 has no subscriptions, but the lifecycle
	// is exercised to confirm Start/Stop wiring works.
	cons := siemconsumer.New(logger)

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error { return cons.Start(gCtx) })
	g.Go(func() error { return svc.Run(gCtx) })

	// SIEM-03 long-running goroutines.
	g.Go(func() error { return crlCache.Run(gCtx) })
	g.Go(func() error { return det.Start(gCtx) })
	g.Go(func() error { return cleanup.Start(gCtx) })

	// Leader election loop (Phase 4). Returns ctx.Err() on shutdown, which
	// errgroup treats as the cooperative-cancel sentinel — same as the
	// other goroutines.
	if leadershipRun != nil {
		g.Go(func() error { return leadershipRun(gCtx) })
	}

	// mTLS listener: optional. If the CA bundle path isn't set or
	// isn't readable, skip and log a warning so SIEM-03 doesn't
	// abort SIEM-02 startups in dev. The sourcesHealth checker
	// surfaces the degraded state via /readyz.
	if cfg.Sources.MTLSCABundlePath != "" {
		if _, err := os.Stat(cfg.Sources.MTLSCABundlePath); err == nil {
			g.Go(func() error { return mtlsListener.Start(gCtx) })
		} else {
			logger.Warn().Err(err).Str("path", cfg.Sources.MTLSCABundlePath).Msg("mTLS CA bundle unreadable; heartbeat listener disabled")
		}
	} else {
		logger.Info().Msg("SIEM_MTLS_CA_BUNDLE_PATH not set; mTLS heartbeat listener disabled")
	}
	// Silence unused-import linter when no body uses http directly.
	_ = http.StatusOK

	// Signal handler: translate SIGINT/SIGTERM into context cancel so
	// bootstrap's Run() can perform an ordered shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")
		cancel()
	case <-gCtx.Done():
	}

	cons.Stop()
	if prod != nil {
		if err := prod.Close(); err != nil {
			logger.Warn().Err(err).Msg("producer close failed")
		}
	}

	if err := g.Wait(); err != nil && err != context.Canceled {
		logger.Error().Err(err).Msg("siem-service exited with error")
		return err
	}
	logger.Info().Str("commit", siemservice.Build().Commit).Msg("siem-service stopped")
	return nil
}

// findMigrationsPath looks for the siem_db migrations folder relative
// to whatever directory the binary was invoked from. PM2 invokes the
// binary from `backend/`; `make siem-run` invokes from repo root.
func findMigrationsPath() string {
	candidates := []string{
		"backend/migrations/siem_db",
		"migrations/siem_db",
		"../migrations/siem_db",
		"../../migrations/siem_db",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	// Last-resort default; RunMigrations will error clearly if missing.
	return "backend/migrations/siem_db"
}
