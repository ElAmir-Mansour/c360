package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/aigovernance"
	aigovconsumer "github.com/clario360/platform/internal/aigovernance/consumer"
	aigovintegration "github.com/clario360/platform/internal/aigovernance/integration"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/authz"
	appconfig "github.com/clario360/platform/internal/config"
	vcisollm "github.com/clario360/platform/internal/cyber/vciso/llm"
	vcisollmcredential "github.com/clario360/platform/internal/cyber/vciso/llm/credential"
	vcisollmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/leadership"
	lexapp "github.com/clario360/platform/internal/lex"
	lexapidocs "github.com/clario360/platform/internal/lex/apidocs"
	lexconfig "github.com/clario360/platform/internal/lex/config"
	lexconsumer "github.com/clario360/platform/internal/lex/consumer"
	lexdto "github.com/clario360/platform/internal/lex/dto"
	lexhealth "github.com/clario360/platform/internal/lex/health"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	lexmonitor "github.com/clario360/platform/internal/lex/monitor"
	lexseeder "github.com/clario360/platform/internal/lex/seeder"
	lexservice "github.com/clario360/platform/internal/lex/service"
	sharedmw "github.com/clario360/platform/internal/middleware"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	"github.com/clario360/platform/internal/residency"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
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
	lexCfg, err := lexconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading lex config: " + err.Error() + "\n")
		os.Exit(1)
	}

	bootstrapCfg := buildBootstrapConfig(baseCfg, lexCfg)
	svc, err := bootstrap.Bootstrap(ctx, bootstrapCfg)
	if err != nil {
		os.Stderr.WriteString("bootstrapping lex-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger

	if err := runMigrations(lexCfg.DBURL); err != nil {
		logger.Fatal().Err(err).Msg("failed to run lex migrations")
	}
	if err := workflowrepo.RunMigration(ctx, svc.DBPool); err != nil {
		logger.Fatal().Err(err).Msg("failed to run workflow schema migration")
	}

	if lexCfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(lexCfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", lexCfg.JWTPublicKeyPath).Msg("failed to read LEX_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	var producer *events.Producer
	if len(lexCfg.KafkaBrokers) > 0 {
		producer, err = events.NewProducer(appconfig.KafkaConfig{
			Brokers: lexCfg.KafkaBrokers,
			GroupID: lexCfg.KafkaGroupID,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka producer unavailable; lex events will not be published")
		} else {
			defer producer.Close()
		}
	}
	aiRuntime, aiErr := aigovintegration.NewLexRuntime(ctx, baseCfg, svc.Metrics.Registry(), producer, logger)
	if aiErr != nil {
		logger.Warn().Err(aiErr).Msg("ai governance runtime unavailable for lex-service")
	} else {
		defer aiRuntime.Close()
	}

	// Shared vciso LLM provider manager (model defaults to claude-opus-4-8 via the
	// shared loader). Only built when LLM enrichment is enabled; otherwise the
	// hybrid analyzer runs in pure-deterministic mode.
	var lexLLMProviderManager *vcisollmprovider.Manager
	if lexCfg.LLMEnrichmentEnabled {
		// Per-tenant LLM credential resolver (Vault-backed), bound to the SHARED
		// platform_core pool — NOT lex_db — so a tenant configures one LLM key that
		// every suite resolves (SaaS-correct). The credential table + DEK-envelope
		// table (siem.index_metadata) live in platform_core (migration 000017).
		// Reuse the governance runtime's platform_core pool when present; otherwise
		// open a dedicated connection from PLATFORM_CORE_DB_URL (fallback: derived
		// platform_core DSN).
		var lexPlatformPool *pgxpool.Pool
		lexPlatformPoolOwned := false
		if aiRuntime != nil && aiRuntime.Pool != nil {
			lexPlatformPool = aiRuntime.Pool
		} else {
			dsn := os.Getenv("PLATFORM_CORE_DB_URL")
			if dsn == "" {
				dsn = aigovernance.BuildPlatformCoreDSN(baseCfg.Database)
			}
			if pcfg, perr := pgxpool.ParseConfig(dsn); perr != nil {
				logger.Warn().Err(perr).Msg("platform_core pool unavailable for lex llm credentials; staying env-only")
			} else if pool, oerr := pgxpool.NewWithConfig(ctx, pcfg); oerr != nil {
				logger.Warn().Err(oerr).Msg("platform_core pool unavailable for lex llm credentials; staying env-only")
			} else if pingErr := pool.Ping(ctx); pingErr != nil {
				logger.Warn().Err(pingErr).Msg("platform_core pool unavailable for lex llm credentials; staying env-only")
				pool.Close()
			} else {
				lexPlatformPool = pool
				lexPlatformPoolOwned = true
			}
		}
		if lexPlatformPoolOwned {
			defer lexPlatformPool.Close()
		}
		// Nil-safe: when lexPlatformPool is nil OR Vault is unconfigured the
		// resolver is nil and the Manager stays env-only; the enricher's existing
		// deterministic fallback handles fail-closed.
		lexLLMCredentialSvc, lexLLMCredentialCleanup, lexLLMCredentialErr := vcisollmcredential.BuildResolver(ctx, lexPlatformPool, nil, logger)
		if lexLLMCredentialErr != nil {
			logger.Fatal().Err(lexLLMCredentialErr).Msg("failed to build lex llm credential resolver")
		}
		if lexLLMCredentialCleanup != nil {
			defer lexLLMCredentialCleanup()
		}
		if lexLLMCredentialSvc != nil {
			lexLLMProviderManager = vcisollmprovider.NewManagerWithCredentials(vcisollm.LoadConfig(), lexLLMCredentialSvc)
		} else {
			lexLLMProviderManager = vcisollmprovider.NewManager(vcisollm.LoadConfig())
		}
		logger.Info().Msg("lex llm enrichment enabled; governed clause/obligation analysis active per-tenant entitlement")
	}

	app, err := lexapp.NewApplication(lexapp.Dependencies{
		DB:                svc.DBPool,
		Redis:             svc.Redis,
		Publisher:         producer,
		Logger:            logger,
		Registerer:        svc.Metrics.Registry(),
		WorkflowDefRepo:   workflowrepo.NewDefinitionRepository(svc.DBPool),
		WorkflowInstRepo:  workflowrepo.NewInstanceRepository(svc.DBPool),
		WorkflowTaskRepo:  workflowrepo.NewTaskRepository(svc.DBPool),
		Config:            lexCfg,
		DashboardCacheTTL: lexCfg.DashboardCacheTTL,
		OrgJurisdiction:   lexCfg.OrgJurisdiction,
		KafkaTopic:        lexCfg.KafkaTopic,
		PredictionLogger: func() *aigovmiddleware.PredictionLogger {
			if aiRuntime == nil {
				return nil
			}
			return aiRuntime.PredictionLogger
		}(),
		LLMProviderManager: lexLLMProviderManager,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to initialize lex application")
	}

	// Retain a PERSISTENT platform_core pool on the application for the per-tenant
	// onboarding hook and internal-signature IAM validation. ProvisionLegalAffairs
	// seeds the 14 legal roles + assigns the tenant admin the legal-system-admin
	// role in platform_core (the shared IAM database, distinct from lex_db). Prefer
	// the AI-governance runtime's
	// long-lived pool (closed by its deferred Close); otherwise open a dedicated
	// long-lived pool from PLATFORM_CORE_DB_URL (fallback: derived DSN) that lives
	// for the process lifetime. nil-safe: when platform_core is unreachable the
	// pool stays nil and the onboarding hook degrades to the lex_db template only.
	if aiRuntime != nil && aiRuntime.Pool != nil {
		app.PlatformCorePool = aiRuntime.Pool
	} else {
		dsn := os.Getenv("PLATFORM_CORE_DB_URL")
		if dsn == "" {
			dsn = aigovernance.BuildPlatformCoreDSN(baseCfg.Database)
		}
		if pool, perr := pgxpool.New(ctx, dsn); perr != nil {
			logger.Warn().Err(perr).Msg("platform_core pool unavailable for lex provisioning hook; onboarding will apply lex_db template only")
		} else if pingErr := pool.Ping(ctx); pingErr != nil {
			logger.Warn().Err(pingErr).Msg("platform_core pool unavailable for lex provisioning hook; onboarding will apply lex_db template only")
			pool.Close()
		} else {
			app.PlatformCorePool = pool
			defer pool.Close()
		}
	}
	if app.PlatformCorePool != nil {
		app.SetCaseAssignmentUserDirectory(lexservice.NewPlatformCoreCaseAssignmentUserDirectory(app.PlatformCorePool))
		app.SetWorkforceUserDirectory(lexservice.NewPlatformCoreWorkforceUserDirectory(app.PlatformCorePool))

		// Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md): mount the
		// import/version surface and register the enforcement overlay loader so
		// ACTIVATED per-tenant matrices are actually enforced. The overlay only
		// ever loads roles written by an activated import (source='import'), so a
		// tenant that never imports keeps the code-map defaults byte-for-byte.
		// LEX_ROLE_MATRIX_OVERLAY_ENABLED=false parks enforcement (imports then
		// stay display-only) without unmounting the import surface.
		app.EnableRoleMatrix(app.PlatformCorePool)
		if strings.ToLower(strings.TrimSpace(os.Getenv("LEX_ROLE_MATRIX_OVERLAY_ENABLED"))) != "false" {
			auth.SetTenantOverlayLoader(lexservice.NewRoleMatrixOverlayLoader(app.PlatformCorePool))
			logger.Info().Msg("tenant role-matrix enforcement overlay enabled (platform_core-backed)")
		} else {
			logger.Warn().Msg("tenant role-matrix enforcement overlay DISABLED by env; imports are display-only")
		}
	}

	if lexCfg.SeedDemoData {
		seedOpts, err := buildSeedOptions(lexCfg)
		if err != nil {
			logger.Fatal().Err(err).Msg("invalid lex seed configuration")
		}
		seededTenant, err := lexapp.SeedDemoDataWithOptions(ctx, app, logger, seedOpts)
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to seed lex legal-company data")
		}

		// Legal System Role Matrix (Legal_Role_Matrix_Design.md §5 / changelog
		// #10). Seeds the 14 named legal roles + the SSD role-exclusion pairs
		// (§4.2) into platform_core for the seeded tenant, AFTER the org registry
		// (seeded above by ensureOrgRegistry) so the roles bind to the existing
		// org hierarchy. The roles table lives in platform_core, so this uses the
		// platform_core pool (the AI-governance runtime's pool when present, else
		// a dedicated connection).
		//
		// ASSERTED, not best-effort: when platform_core IS reachable, a failing
		// seed OR a post-seed verify that finds any of the 14 roles / the SSD
		// pairs missing FAILS startup (logger.Fatal). A silent no-op must not be
		// allowed to leave the tenant relying on the coarse lex:write fallback for
		// security-critical roles. platform_core being unreachable is the only
		// degraded path (roles still enforced via the code map, auth.RolePermissions).
		rolePool := lexPlatformCorePool(ctx, aiRuntime, baseCfg, logger)
		if rolePool != nil {
			roleSeeder := lexseeder.NewLegalAffairsRoleSeeder(rolePool.pool, seededTenant, logger)
			n, serr := roleSeeder.Seed(ctx)
			if serr != nil {
				if rolePool.owned {
					rolePool.pool.Close()
				}
				logger.Fatal().Err(serr).Msg("legal role-matrix seed failed; refusing to start (asserted seeding, §5)")
			}
			if verr := roleSeeder.Verify(ctx, rolePool.pool); verr != nil {
				if rolePool.owned {
					rolePool.pool.Close()
				}
				logger.Fatal().Err(verr).Msg("legal role-matrix readiness check failed; refusing to start (asserted seeding, §5)")
			}
			logger.Info().Int("roles", n).Msg("legal role-matrix seeded + verified in platform_core")

			// Demo legal-role ASSIGNMENTS (Lex_Codebase_RBAC_Map.md §16). Runs
			// AFTER the role-matrix seed+verify above, so the 14 role rows the
			// slug->id lookup needs are guaranteed present. This binds the Apex
			// demo users to legal personas so the demo tenant actually exercises
			// the persona-aware login/landing/nav model. It is a UX-enablement
			// seed, NOT a security boundary (§17.4: backend auth stays the code
			// map), and is best-effort: SoD-forbidden pairs and absent demo users
			// are skipped+logged, never written, and a failure here is logged
			// (not Fatal) so it can never down the service the way the asserted
			// role-matrix seed does.
			assignSeeder := lexseeder.NewLegalAffairsAssignmentSeeder(rolePool.pool, seededTenant, logger)
			if _, aerr := assignSeeder.Seed(ctx); aerr != nil {
				logger.Warn().Err(aerr).Msg("demo legal-role assignment seeding hit a DB error; personas may be incomplete (non-fatal, §16)")
			}

			if rolePool.owned {
				rolePool.pool.Close()
			}
		} else {
			logger.Warn().Msg("platform_core pool unavailable; legal role-matrix not seeded (enforced via code map)")
		}
	}

	// Bind internal signature recipients to canonical, active IAM accounts. This
	// is intentionally wired after optional legacy demo seeding (whose historical
	// signature fixtures use synthetic contacts); every runtime-created recipient
	// carrying user_id is fail-closed when platform_core is unavailable.
	if app.PlatformCorePool != nil {
		app.SignatureService.SetUserDirectory(lexservice.NewPlatformCoreSignatureUserDirectory(app.PlatformCorePool))
		logger.Info().Msg("internal signature recipient IAM validation enabled")
	} else {
		logger.Warn().Msg("platform_core unavailable; internal signature recipients will be rejected")
	}

	svc.Router.Use(sharedmw.SecurityHeaders())
	lexhealth.Register(svc.Router, svc.Health, bootstrapCfg.Name, bootstrapCfg.Version)
	residencyEnforcer := residency.NewEnforcer(baseCfg.Residency, residency.NewPGLoader(svc.DBPool)).
		WithAuditLogger(logger)

	// WTQ-SEC-01: wire the ABAC attribute-policy engine into the lex route chain
	// (additive, after RBAC). Policies live in platform_core (abac_policies);
	// nil-safe — when platform_core is unavailable the chain stays RBAC-only.
	var abacMW func(http.Handler) http.Handler
	var abacPool *pgxpool.Pool
	abacPoolOwned := false
	if aiRuntime != nil && aiRuntime.Pool != nil {
		abacPool = aiRuntime.Pool
	} else {
		dsn := os.Getenv("PLATFORM_CORE_DB_URL")
		if dsn == "" {
			dsn = aigovernance.BuildPlatformCoreDSN(baseCfg.Database)
		}
		if pool, perr := pgxpool.New(ctx, dsn); perr != nil {
			logger.Warn().Err(perr).Msg("abac: platform_core pool unavailable; lex stays RBAC-only")
		} else if pingErr := pool.Ping(ctx); pingErr != nil {
			logger.Warn().Err(pingErr).Msg("abac: platform_core pool unavailable; lex stays RBAC-only")
			pool.Close()
		} else {
			abacPool = pool
			abacPoolOwned = true
		}
	}
	if abacPool != nil {
		abacEngine := authz.NewEngine(authz.NewRepository(abacPool, 30*time.Second))
		abacMW = sharedmw.EnforceABAC(abacEngine, lexmw.ABACResourceExtractor)
		logger.Info().Msg("lex ABAC attribute-policy enforcement enabled (platform_core-backed)")
	}
	if abacPoolOwned {
		defer abacPool.Close()
	}

	if lexapidocs.Enabled() {
		lexapidocs.RegisterRoutes(svc.Router)
		logger.Info().
			Str("swagger_ui", "/api/docs/watheeq/").
			Str("openapi", "/api/docs/watheeq/openapi.json").
			Msg("Watheeq API documentation enabled")
	}
	app.RegisterRoutes(svc.Router, jwtMgr, svc.Redis, lexCfg.RateLimitPerMinute, residencyEnforcer.Middleware, abacMW)
	dlqTracker := events.NewDLQTracker(svc.Redis)
	crossSuiteMetrics := events.NewCrossSuiteMetrics(svc.Metrics.Registry())
	// DLQ count is an ops-plane probe: it must live on the ADMIN router
	// (separate, non-public port, next to /metrics and /healthz), not on the
	// public service router where it was reachable without authentication.
	svc.AdminRouter.Get("/api/v1/admin/dlq/count", events.DLQCountHandler("lex-service", dlqTracker, logger))

	expiryMonitor := lexmonitor.NewExpiryMonitor(
		svc.DBPool,
		app.Store.Contracts,
		app.Store.Alerts,
		app.Store.Compliance,
		app.ContractService,
		app.Metrics,
		producer,
		lexCfg.KafkaTopic,
		lexCfg.ExpiryMonitorInterval,
		logger,
	)
	complianceMonitor := lexmonitor.NewComplianceMonitor(
		app.Store.Contracts,
		app.ComplianceService,
		lexCfg.ComplianceMonitorInterval,
		logger,
	)
	renewalReminder := lexmonitor.NewRenewalReminder(
		svc.DBPool,
		app.Store.Contracts,
		app.Store.Alerts,
		app.Store.Compliance,
		producer,
		lexCfg.KafkaTopic,
		lexCfg.RenewalReminderInterval,
		logger,
	)

	// Phase 1 background monitors. SLAMonitor sweeps due SLA clocks (ack-overdue /
	// breach / escalation) and enqueues the outbox; DeliveryAutoCloseMonitor
	// expires unanswered delivery confirmations past their working-calendar
	// deadline. SupportExpiryMonitor atomically expires bounded batches of due
	// open/accepted support requests. All mirror ExpiryMonitor's ticker and
	// cross-tenant fan-out shape.
	slaMonitor := lexmonitor.NewSLAMonitor(app.SLAService, lexCfg.SLAMonitorInterval, logger)
	deliveryAutoCloseMonitor := lexmonitor.NewDeliveryAutoCloseMonitor(app.DeliveryConfirmationService, lexCfg.DeliveryAutoCloseInterval, logger)
	supportExpiryMonitor := lexmonitor.NewSupportExpiryMonitor(app.SupportRequestService, app.Metrics, lexCfg.SupportExpiryInterval, logger)

	// Phase 4 (CAP-162): ProximityMonitor sweeps upcoming hearings cross-tenant and
	// fires approaching-hearing-date reminders into the in-app inbox (+ email seam),
	// deduped per (hearing, horizon). Mirrors SLAMonitor's ticker + fan-out shape.
	proximityMonitor := lexmonitor.NewProximityMonitor(
		app.LexNotificationService,
		app.Store.NotificationSubscriptions,
		lexCfg.ProximityMonitorInterval,
		logger,
	)

	// Integration Platform pull scheduler. The HR / Najiz-read / archiving-reconcile
	// connectors implement the Syncer capability but nothing ran them on a schedule;
	// this monitor fans out cross-tenant each tick, finds active Syncer-capable
	// endpoints whose per-endpoint sync_interval_minutes has elapsed since their last
	// successful sync, and dispatches IntegrationRegistryService.SyncNow (full on the
	// first pull, delta after). Per-endpoint errors are logged + skipped; the loop
	// never panics. Mirrors SLAMonitor's ticker + fan-out shape.
	integrationSyncMonitor := lexmonitor.NewIntegrationSyncMonitor(
		app.IntegrationRegistryService,
		lexCfg.IntegrationSyncInterval,
		logger,
	)

	// Integration secret ROTATION scheduler (governance #14). Mirrors the sync
	// monitor: each tick it fans out cross-tenant, evaluates every active endpoint's
	// secret fields against its rotate_every_days cadence (vs the recorded
	// last_rotated stamps), emits rotation reminders / expiry alerts (always,
	// secret-free), and AUTO-ROTATES overdue external-reference secrets when the
	// endpoint opted in (auto_rotate=true). Per-endpoint errors are logged + skipped;
	// the loop never panics. reminderDays=7 (due-soon look-ahead). A non-positive
	// interval defaults to 6h inside the monitor.
	integrationRotationMonitor := lexmonitor.NewIntegrationRotationMonitor(
		app.IntegrationRegistryService,
		lexCfg.IntegrationRotationInterval,
		7,
		logger,
	)

	go runBackground(ctx, logger, "lex-expiry-monitor", expiryMonitor.Run)
	go runBackground(ctx, logger, "lex-compliance-monitor", complianceMonitor.Run)
	go runBackground(ctx, logger, "lex-renewal-reminder", renewalReminder.Run)
	go runBackground(ctx, logger, "lex-sla-monitor", slaMonitor.Run)
	go runBackground(ctx, logger, "lex-delivery-autoclose-monitor", deliveryAutoCloseMonitor.Run)
	go runBackground(ctx, logger, "lex-support-expiry-monitor", supportExpiryMonitor.Run)
	go runBackground(ctx, logger, "lex-proximity-monitor", proximityMonitor.Run)
	// Leader-gate the two MUTATING integration monitors. The sync monitor
	// dispatches IntegrationRegistryService.SyncNow (which can create/update/
	// deactivate mapped org entities) and the rotation monitor can AUTO-ROTATE
	// provider secrets — running their bare .Run on every replica means N
	// replicas fire the same scheduled sync/rotation concurrently (duplicate
	// upstream pulls, racing watermarks, N simultaneous secret rotations against
	// one provider). They must run on exactly one replica at a time. Each gets
	// its OWN Redis-backed elector keyed by a distinct role so leadership is held
	// independently per loop. When Redis is unavailable (dev / single replica),
	// the elector is nil and RunLeader degrades to the un-gated Run, preserving
	// the prior behaviour. Mirrors workflow-engine's startLeaderSingleton.
	leaderInstance := leaderInstanceID()
	const (
		integLeaderTTL   = 15 * time.Second
		integLeaderRenew = 5 * time.Second
	)
	var syncElector, rotationElector leadership.Elector
	if svc.Redis != nil {
		syncElector = leadership.NewRedisElection(svc.Redis, "lex:integration-sync", leaderInstance, integLeaderTTL, integLeaderRenew, &logger)
		rotationElector = leadership.NewRedisElection(svc.Redis, "lex:integration-rotation", leaderInstance, integLeaderTTL, integLeaderRenew, &logger)
	} else {
		logger.Warn().Msg("lex-service: Redis unavailable — integration sync/rotation monitors run UN-GATED (safe only for single-replica deployments)")
	}
	go runBackground(ctx, logger, "lex-integration-sync-monitor",
		func(ctx context.Context) error {
			return integrationSyncMonitor.RunLeader(ctx, syncElector, leaderInstance)
		})
	go runBackground(ctx, logger, "lex-integration-rotation-monitor",
		func(ctx context.Context) error {
			return integrationRotationMonitor.RunLeader(ctx, rotationElector, leaderInstance)
		})

	// Round 1 maturation: outbox-dispatcher ticker. The SLA monitor and the
	// obligation reminder planner ENQUEUE rows into the lex outbox tables; before
	// this ticker, nothing DRAINED them (the only callers were the on-demand admin
	// HTTP dispatch endpoints). This ticker periodically dispatches every tenant's
	// pending SLA-notification and obligation-reminder outbox rows. Dispatch is
	// idempotent (MarkDelivery guards a status precondition; lost races become
	// no-ops), so overlapping ticks across replicas are safe. Interval is the
	// LEX_OUTBOX_DISPATCH_INTERVAL knob (default 60s). The in-process bus needs no
	// ticker — its Publish is synchronous; this only drains the DB outbox tables.
	go runBackground(ctx, logger, "lex-outbox-dispatcher", func(ctx context.Context) error {
		dispatchOutboxes(ctx, app, logger)
		ticker := time.NewTicker(lexCfg.OutboxDispatchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
				dispatchOutboxes(ctx, app, logger)
			}
		}
	})

	if len(lexCfg.KafkaBrokers) > 0 {
		kafkaConsumer, err := events.NewConsumer(appconfig.KafkaConfig{
			Brokers:         lexCfg.KafkaBrokers,
			GroupID:         lexCfg.KafkaGroupID + "-consumer",
			AutoOffsetReset: baseCfg.Kafka.AutoOffsetReset,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka consumer unavailable; lex cross-suite sync disabled")
		} else {
			defer kafkaConsumer.Close()
			kafkaConsumer.SetDeadLetterProducer(producer)
			kafkaConsumer.SetCrossSuiteMetrics(crossSuiteMetrics)
			kafkaConsumer.SetDLQTracker(dlqTracker, "lex-service")
			handler := lexconsumer.NewLexConsumer(app.ComplianceService, app.WorkflowService, kafkaConsumer, logger)
			if aiRuntime != nil && aiRuntime.PredictionLogger != nil {
				kafkaConsumer.Subscribe(events.Topics.AIEvents, aigovconsumer.NewCacheInvalidationConsumer(aiRuntime.PredictionLogger, logger))
			}
			// NOTE: the reporting + notification consumers are NO LONGER Kafka-subscribed
			// here. As of Round 1 maturation they are constructed inside NewApplication
			// and registered on the always-on in-process bus (app.EventBus), which is the
			// publisher every lex service emits through. Subscribing them to Kafka too
			// would double-process every lex event (the in-process path already delivered
			// it synchronously when the originating service published). Only the
			// cross-suite LexConsumer (compliance/workflow) and the AI cache-invalidation
			// consumer remain Kafka-driven; the single "lex-consumer" Start below drives
			// them.
			go runBackground(ctx, logger, "lex-consumer", handler.Start)
		}
	}

	logger.Info().Int("port", bootstrapCfg.Port).Msg("lex-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("lex-service failed")
	}
}

func buildBootstrapConfig(baseCfg *appconfig.Config, lexCfg *lexconfig.Config) *bootstrap.ServiceConfig {
	env := envOr("ENVIRONMENT", "development")
	cfg := &bootstrap.ServiceConfig{
		Name:        "lex-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        lexCfg.HTTPPort,
		AdminPort:   lexCfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               lexCfg.DBURL,
			MinConns:          lexCfg.DBMinConns,
			MaxConns:          lexCfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Redis: &bootstrap.RedisConfig{
			Addr:     lexCfg.RedisAddr,
			Password: lexCfg.RedisPassword,
			DB:       lexCfg.RedisDB,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "lex-service",
			Version:     serviceVersion,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: baseCfg.Server.ShutdownTimeout,
		ReadTimeout:     baseCfg.Server.ReadTimeout,
		WriteTimeout:    baseCfg.Server.WriteTimeout,
	}
	if len(lexCfg.KafkaBrokers) > 0 {
		cfg.Kafka = &bootstrap.KafkaConfig{
			Brokers: lexCfg.KafkaBrokers,
			GroupID: lexCfg.KafkaGroupID,
		}
	}
	return cfg
}

func runMigrations(dsn string) error {
	migrationsPath := envOr("LEX_MIGRATIONS_PATH", filepath.Join("migrations", "lex_db"))
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "lex_db")
	}
	return database.RunMigrations(dsn, migrationsPath)
}

// dispatchOutboxes drains the lex SLA-notification and obligation-reminder outbox
// tables for every tenant once. It is invoked on a ticker (lex-outbox-dispatcher)
// so rows enqueued by the SLA monitor / reminder planner are actually delivered.
// Dispatch is idempotent (status-precondition guards make lost races no-ops), so a
// per-tenant error is logged and skipped rather than aborting the whole sweep. The
// system actor is uuid.Nil (event attribution only).
func dispatchOutboxes(ctx context.Context, app *lexapp.Application, logger zerolog.Logger) {
	if app == nil {
		return
	}

	// SLA-notification outbox: tenants that own at least one SLA clock.
	if app.SLAService != nil {
		slaTenants, err := app.SLAService.ListTenantIDs(ctx)
		if err != nil {
			logger.Error().Err(err).Msg("lex-outbox-dispatcher: list SLA tenants failed")
		} else {
			for _, tenantID := range slaTenants {
				if ctx.Err() != nil {
					return
				}
				if _, err := app.SLAService.DispatchOutbox(ctx, tenantID, uuid.Nil, lexdto.DispatchSLAOutboxRequest{}); err != nil {
					logger.Warn().Err(err).Str("tenant_id", tenantID.String()).Msg("lex-outbox-dispatcher: SLA outbox dispatch failed")
				}
			}
		}
	}

	// Obligation-reminder outbox: tenants are enumerated from the contracts table
	// (obligations are tenant-scoped lex_db data alongside contracts; this is the
	// available cross-tenant lister).
	if app.ObligationService != nil && app.Store != nil && app.Store.Contracts != nil {
		oblTenants, err := app.Store.Contracts.ListTenantIDs(ctx)
		if err != nil {
			logger.Error().Err(err).Msg("lex-outbox-dispatcher: list obligation tenants failed")
		} else {
			for _, tenantID := range oblTenants {
				if ctx.Err() != nil {
					return
				}
				if _, err := app.ObligationService.DispatchReminderOutbox(ctx, tenantID, uuid.Nil, lexdto.DispatchObligationReminderOutboxRequest{}); err != nil {
					logger.Warn().Err(err).Str("tenant_id", tenantID.String()).Msg("lex-outbox-dispatcher: obligation reminder outbox dispatch failed")
				}
			}
		}
	}
}

func runBackground(ctx context.Context, logger zerolog.Logger, name string, fn func(context.Context) error) {
	if err := fn(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error().Err(err).Str("job", name).Msg("background job exited")
	}
}

// leaderInstanceID returns a stable-per-process identity for leadership locks:
// "<hostname>-<pid>". It uniquely identifies this replica so the elector can
// distinguish "I still hold the lock" from "another replica holds it". Mirrors
// workflow-engine's leaderInstanceID.
func leaderInstanceID() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "lex-service"
	}
	return fmt.Sprintf("%s-%d", host, os.Getpid())
}

// platformCorePoolRef wraps a platform_core pool with whether the caller owns it
// (and must Close it). When the pool is borrowed from the AI-governance runtime,
// owned is false and the runtime's deferred Close handles cleanup.
type platformCorePoolRef struct {
	pool  *pgxpool.Pool
	owned bool
}

// lexPlatformCorePool resolves a platform_core pool for one-shot startup seeding:
// it reuses the AI-governance runtime's pool when present, otherwise opens a
// dedicated connection from PLATFORM_CORE_DB_URL (fallback: derived DSN). Returns
// nil when platform_core is unreachable so callers degrade gracefully.
func lexPlatformCorePool(ctx context.Context, aiRuntime *aigovintegration.Runtime, baseCfg *appconfig.Config, logger zerolog.Logger) *platformCorePoolRef {
	if aiRuntime != nil && aiRuntime.Pool != nil {
		return &platformCorePoolRef{pool: aiRuntime.Pool, owned: false}
	}
	dsn := os.Getenv("PLATFORM_CORE_DB_URL")
	if dsn == "" {
		dsn = aigovernance.BuildPlatformCoreDSN(baseCfg.Database)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		logger.Warn().Err(err).Msg("platform_core pool open failed for role seeding")
		return nil
	}
	if pingErr := pool.Ping(ctx); pingErr != nil {
		logger.Warn().Err(pingErr).Msg("platform_core ping failed for role seeding")
		pool.Close()
		return nil
	}
	return &platformCorePoolRef{pool: pool, owned: true}
}

func buildSeedOptions(cfg *lexconfig.Config) (lexapp.SeedDemoOptions, error) {
	opts := lexapp.SeedDemoOptions{}
	if cfg.SeedTenantID != "" {
		tenantID, err := uuid.Parse(cfg.SeedTenantID)
		if err != nil {
			return opts, fmt.Errorf("LEX_SEED_TENANT_ID: %w", err)
		}
		opts.TenantID = tenantID
	}
	if cfg.SeedSystemUserID != "" {
		systemUserID, err := uuid.Parse(cfg.SeedSystemUserID)
		if err != nil {
			return opts, fmt.Errorf("LEX_SEED_SYSTEM_USER_ID: %w", err)
		}
		opts.SystemUserID = systemUserID
	}
	return opts, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
