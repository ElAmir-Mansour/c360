// automation-service is the platform's Automation engine core service
// (DESIGN_Workflow_Forms_Automation.md §4): it binds triggers
// (event/schedule/threshold/manual/webhook) to priority-ordered rules and a
// multi-step runbook, and drives each firing as a durable, restart-safe,
// leader-singleton Run through the gated FSM (§6).
//
// Boot order (mirrors cmd/license-service + cmd/clario-dr-service):
//
//	bootstrap.Bootstrap (DB pool, metrics, router, admin router, Redis)
//	-> database.RunMigrations(automation_db)
//	-> outbox.EnsureSchema
//	-> JWT manager (validates gateway-issued tokens; mints per-tenant system tokens)
//	-> AutomationService (Batch 3) wired with the REAL action.Dispatcher (WP-12):
//	     start_workflow / dr_runbook / http_call -> HTTP clients + gateway base URLs
//	     integration / notification              -> the live events.Producer
//	-> mount the handler under /api/v1/automation (Auth + Tenant + per-route RBAC),
//	   plus the token-authed inbound webhook route (no JWT)
//	-> start the outbox Relay (staged automation events -> Kafka)
//	-> start the trigger sources: event + threshold bus consumers (every node);
//	   the cron schedule source + the leader run-driver loop + the gate sweeper
//	   (leader singletons); manual + webhook via the API
//	-> svc.Run (serve until signal)
//
// EXECUTE-OUTSIDE-TX (§4.6, auditor-flagged): the orchestrator invokes the
// Dispatcher's executors OUTSIDE any DB transaction — the executors reach their
// targets only via the gateway HTTP API or the event bus (FR-XC-004), so a tx
// rollback can never un-send an external action. See internal/automation/service/
// orchestrator.go for the three-boundary discipline.
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

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	autoaction "github.com/clario360/platform/internal/automation/action"
	autoconfig "github.com/clario360/platform/internal/automation/config"
	autohandler "github.com/clario360/platform/internal/automation/handler"
	autorepo "github.com/clario360/platform/internal/automation/repository"
	autorule "github.com/clario360/platform/internal/automation/rule"
	autoservice "github.com/clario360/platform/internal/automation/service"
	autotrigger "github.com/clario360/platform/internal/automation/trigger"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/leadership"
	sharedmw "github.com/clario360/platform/internal/middleware"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	wfservice "github.com/clario360/platform/internal/workflow/service"
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
	autoCfg, err := autoconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading automation config: " + err.Error() + "\n")
		os.Exit(1)
	}

	svc, err := bootstrap.Bootstrap(ctx, buildBootstrapConfig(baseCfg, autoCfg))
	if err != nil {
		os.Stderr.WriteString("bootstrapping automation-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger

	if err := runMigrations(autoCfg); err != nil {
		logger.Fatal().Err(err).Msg("failed to run automation migrations")
	}
	// Ensure the transactional outbox table exists (automation lifecycle events
	// staged in-tx with every run state change are relayed to Kafka).
	if err := outbox.EnsureSchema(ctx, svc.DBPool); err != nil {
		logger.Fatal().Err(err).Msg("failed to ensure outbox schema")
	}

	if autoCfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(autoCfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", autoCfg.JWTPublicKeyPath).Msg("failed to read AUTO_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	// --- Event publishing: the live Kafka producer backs BOTH the outbox relay
	// (staged automation events -> Kafka) AND the integration/notification action
	// executors (they publish a domain event directly so the platform
	// Integration/Notification consumers fan it out, FR-XC-004). When Kafka is
	// unreachable at boot, the relay accumulates events durably in the outbox and
	// those two action kinds are wired with a nil publisher (a step using them is
	// then unsupported until the broker returns). ---
	var kafkaProducer *events.Producer
	if len(autoCfg.KafkaBrokers) > 0 {
		kp, perr := events.NewProducer(appconfig.KafkaConfig{
			Brokers: autoCfg.KafkaBrokers,
			GroupID: autoCfg.KafkaGroupID,
		}, logger)
		if perr != nil {
			logger.Warn().Err(perr).Msg("kafka producer unavailable — automation events accumulate in the outbox; integration/notification actions disabled until the broker is reachable")
		} else {
			kafkaProducer = kp
			defer kafkaProducer.Close()
		}
	} else {
		logger.Warn().Msg("no kafka brokers configured — automation events accumulate in the outbox; integration/notification actions disabled")
	}

	// --- The real action.Dispatcher (WP-12): the orchestrator's single
	// ActionExecutor. Each executor reaches its target only via the gateway HTTP
	// API or the bus — never another engine's DB — and is invoked OUTSIDE any DB
	// transaction (§4.6). gatewayURL is where workflow/dr/http_call calls are sent;
	// the per-tenant system-token minter is the JWT manager. ---
	gatewayURL := envOr("GW_SVC_URL_GATEWAY", envOr("GATEWAY_URL", "http://localhost:8080"))
	workflowGatewayURL := envOr("GW_SVC_URL_WORKFLOW", gatewayURL)
	drGatewayURL := envOr("GW_SVC_URL_DR", gatewayURL)
	minter := autoaction.TokenMinterFunc(func(tenantID string) (string, error) {
		// A short-lived per-tenant Clario system token, mirroring the integration
		// delivery path (ClarioAPIClient.MintSystemToken): a tenant-admin system
		// identity so downstream services accept the automation engine as the actor.
		pair, mErr := jwtMgr.GenerateTokenPair(
			"00000000-0000-0000-0000-000000000000",
			tenantID,
			"automation@clario360.local",
			[]string{"tenant-admin"},
			"",
		)
		if mErr != nil {
			return "", fmt.Errorf("mint automation system token: %w", mErr)
		}
		return pair.AccessToken, nil
	})

	httpClient := &http.Client{Timeout: 30 * time.Second}

	startWorkflowExec, err := autoaction.NewStartWorkflowExecutor(workflowGatewayURL, minter, httpClient)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct start_workflow executor")
	}
	drRunbookExec, err := autoaction.NewDRRunbookExecutor(drGatewayURL, minter, httpClient)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr_runbook executor")
	}
	httpCallExec := autoaction.NewHTTPCallExecutor(httpClient, minter)

	dispatcherCfg := autoaction.DispatcherConfig{
		StartWorkflow: startWorkflowExec,
		DRRunbook:     drRunbookExec,
		HTTPCall:      httpCallExec,
	}
	if kafkaProducer != nil {
		integrationExec, ierr := autoaction.NewIntegrationExecutor(kafkaProducer)
		if ierr != nil {
			logger.Fatal().Err(ierr).Msg("failed to construct integration executor")
		}
		notificationExec, nerr := autoaction.NewNotificationExecutor(kafkaProducer)
		if nerr != nil {
			logger.Fatal().Err(nerr).Msg("failed to construct notification executor")
		}
		dispatcherCfg.Integration = integrationExec
		dispatcherCfg.Notification = notificationExec
	}
	dispatcher, err := autoaction.NewDispatcher(dispatcherCfg)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct action dispatcher")
	}

	// --- The assembled AutomationService (Batch 3): rule engine + durable
	// repository + the real dispatcher as the orchestrator's ActionExecutor. It
	// owns the orchestrator, the gate service, and the leader loop, and is the
	// TriggerSink the trigger sources dispatch into. The orchestrator/gate
	// lifecycle events are staged in the run's transaction via OutboxSink. ---
	autoSvc, err := autoservice.NewService(autoservice.Config{
		Repository:         autorepo.New(),
		Engine:             autorule.NewEngine(logger, autorule.Options{}),
		Executor:           dispatcher,
		Pool:               svc.DBPool,
		Logger:             logger,
		StepMaxAttempts:    autoCfg.StepMaxAttempts,
		DriverPollInterval: autoCfg.DriverPollInterval,
		DriverBatchSize:    autoCfg.DriverBatchSize,
		GateSweepInterval:  autoCfg.GateSweepInterval,
		Events:             autoservice.OutboxSink{},
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct automation service")
	}

	// --- Trigger sources (WP-9). Every source dispatches a normalized
	// FiredTrigger through the shared exactly-once Dispatcher (the Redis
	// idempotency guard + the automation_runs (tenant_id, source_event_id) DB
	// backstop), into the AutomationService sink. ---
	idemGuard := events.NewIdempotencyGuard(svc.Redis, autoCfg.IdempotencyTTL)
	triggerDispatcher := autotrigger.NewDispatcher(autoSvc, idemGuard, logger)

	manualSource, err := autotrigger.NewManualSource(triggerDispatcher, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct manual trigger source")
	}
	webhookSource, err := autotrigger.NewWebhookSource(autoSvc, triggerDispatcher, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct webhook trigger source")
	}

	// --- HTTP API: mount the handler under /api/v1/automation. The handler's
	// RegisterRoutes mounts the token-authed inbound webhook route FIRST (no JWT),
	// then the Auth+Tenant group with per-route RBAC (read/write/approve). The
	// manual invoker + webhook handler are the trigger sources above. ---
	httpHandler := autohandler.New(autoSvc, manualSource, webhookSource, logger)
	svc.Router.Use(sharedmw.SecurityHeaders())
	autohandler.RegisterRoutes(svc.Router, httpHandler, jwtMgr)

	// --- Outbox relay: automation lifecycle events staged in-transaction are
	// delivered to Kafka; without a reachable broker they accumulate durably. ---
	if kafkaProducer != nil {
		relay := outbox.NewRelay(svc.DBPool, kafkaProducer, outbox.Config{}, logger,
			outbox.NewMetrics(svc.Metrics.Registry()))
		go func() {
			if err := relay.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error().Err(err).Msg("outbox relay stopped with error")
			}
		}()
	}

	// --- Bus-driven trigger sources (event + threshold). These run on EVERY node
	// (the Kafka consumer group balances partitions); no leadership. Each loads the
	// tenant's matching enabled automations per incoming event and dispatches a
	// FiredTrigger per match through the exactly-once gate. ---
	startBusSources(ctx, autoCfg, baseCfg, autoSvc, triggerDispatcher, logger)

	// --- Leader-singleton loops: the cron schedule source (fires due schedules
	// once per window across the fleet), and the run-driver + gate-timeout sweeper
	// loop (claims runnable runs FOR UPDATE SKIP LOCKED and advances them one
	// durable step at a time, executing actions OUTSIDE any tx). Each is held under
	// an independent Redis lease so leadership is per-role. ---
	startLeaderLoops(ctx, autoCfg, autoSvc, triggerDispatcher, svc.Redis, logger)

	logger.Info().
		Int("port", autoCfg.HTTPPort).
		Int("admin_port", autoCfg.AdminPort).
		Str("gateway_url", gatewayURL).
		Str("workflow_gateway_url", workflowGatewayURL).
		Str("dr_gateway_url", drGatewayURL).
		Bool("bus_actions_enabled", kafkaProducer != nil).
		Msg("automation-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("automation-service failed")
	}
}

// startBusSources wires and starts the event + threshold bus consumers. They run
// on every node; a missing broker logs a warning and disables them (manual,
// webhook, and the cron schedule source still work).
func startBusSources(ctx context.Context, autoCfg *autoconfig.Config, baseCfg *appconfig.Config, autoSvc *autoservice.AutomationService, dispatcher *autotrigger.Dispatcher, logger zerolog.Logger) {
	if len(autoCfg.KafkaBrokers) == 0 {
		logger.Warn().Msg("no kafka brokers configured — event/threshold trigger sources disabled")
		return
	}

	// Event source: subscribe to the platform-wide domain event topics so any
	// enabled event-trigger automation can match. Subscribing to a superset is
	// harmless — an event with no matching automation resolves to zero runs.
	eventConsumer, err := events.NewConsumer(appconfig.KafkaConfig{
		Brokers:         autoCfg.KafkaBrokers,
		GroupID:         autoCfg.KafkaGroupID + "-event-source",
		AutoOffsetReset: baseCfg.Kafka.AutoOffsetReset,
	}, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka consumer unavailable — event trigger source disabled")
	} else {
		eventSource, esErr := autotrigger.NewEventSource(autotrigger.EventSourceConfig{
			Consumer:   eventConsumer,
			Lister:     autoSvc,
			Dispatcher: dispatcher,
			Topics:     events.AllTopics(),
			Logger:     logger,
		})
		if esErr != nil {
			logger.Fatal().Err(esErr).Msg("failed to construct event trigger source")
		}
		go func() {
			if err := eventSource.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error().Err(err).Msg("automation event trigger source stopped with error")
			}
		}()
	}

	// Threshold source: subscribe to the alert/risk/DR-alert topics and fire when
	// a configured metric field crosses its bound.
	thresholdConsumer, err := events.NewConsumer(appconfig.KafkaConfig{
		Brokers:         autoCfg.KafkaBrokers,
		GroupID:         autoCfg.KafkaGroupID + "-threshold-source",
		AutoOffsetReset: baseCfg.Kafka.AutoOffsetReset,
	}, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka consumer unavailable — threshold trigger source disabled")
	} else {
		thresholdSource, tsErr := autotrigger.NewThresholdSource(autotrigger.ThresholdSourceConfig{
			Consumer:   thresholdConsumer,
			Lister:     autoSvc,
			Dispatcher: dispatcher,
			Logger:     logger,
		})
		if tsErr != nil {
			logger.Fatal().Err(tsErr).Msg("failed to construct threshold trigger source")
		}
		go func() {
			if err := thresholdSource.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error().Err(err).Msg("automation threshold trigger source stopped with error")
			}
		}()
	}
}

// startLeaderLoops starts the leader-singleton background loops: the cron
// schedule source and the run-driver/gate-sweeper loop. Each runs under its own
// Redis lease (a distinct role) via workflow service.RunLeaderSingleton, so
// exactly one node drives each loop. When Redis is unavailable the loops fall
// back to running unconditionally on this node (single-node development), which
// is safe because the FSM is idempotent and the schedule source derives a stable
// EventID per fire window (a brief multi-node overlap is deduped).
func startLeaderLoops(ctx context.Context, autoCfg *autoconfig.Config, autoSvc *autoservice.AutomationService, dispatcher *autotrigger.Dispatcher, rdb *redis.Client, logger zerolog.Logger) {
	scheduleSource, err := autotrigger.NewScheduleSource(autotrigger.ScheduleSourceConfig{
		Lister:     autoSvc,
		Dispatcher: dispatcher,
		Interval:   autoCfg.ScheduleTickInterval,
		Logger:     logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct schedule trigger source")
	}

	runLoop := func(role string, fn func(context.Context)) {
		if rdb == nil {
			logger.Warn().Str("role", role).Msg("redis unavailable — running leader loop unconditionally on this node (single-node mode)")
			go fn(ctx)
			return
		}
		instanceID := leaderInstanceID()
		elector := leadership.NewRedisElection(rdb, role, instanceID, autoCfg.LeaderTTL, autoCfg.LeaderRenew, &logger)
		go func() {
			if err := wfservice.RunLeaderSingleton(ctx, elector, role, instanceID, logger, fn); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error().Err(err).Str("role", role).Msg("automation leader singleton terminated with error")
			}
		}()
	}

	// The cron schedule source — leader only (a schedule fires once per window).
	runLoop("automation-schedule-source", func(leaderCtx context.Context) {
		if err := scheduleSource.Run(leaderCtx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("automation schedule source stopped with error")
		}
	})

	// The run-driver + gate-timeout sweeper loop — leader only (single-writer run
	// advancement; the claim is FOR UPDATE SKIP LOCKED so a brief two-leader
	// overlap is still safe, but a singleton keeps work non-duplicative).
	runLoop("automation-run-driver", autoSvc.Loop().Run)
}

func buildBootstrapConfig(baseCfg *appconfig.Config, autoCfg *autoconfig.Config) *bootstrap.ServiceConfig {
	env := envOr("ENVIRONMENT", "development")
	cfg := &bootstrap.ServiceConfig{
		Name:        "automation-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        autoCfg.HTTPPort,
		AdminPort:   autoCfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               autoCfg.DBURL,
			MinConns:          autoCfg.DBMinConns,
			MaxConns:          autoCfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "automation-service",
			Version:     serviceVersion,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: baseCfg.Server.ShutdownTimeout,
		ReadTimeout:     baseCfg.Server.ReadTimeout,
		WriteTimeout:    baseCfg.Server.WriteTimeout,
	}
	// Redis backs the leader-singleton election (schedule source, run driver) and
	// the trigger idempotency guard; wire it when configured so /readyz reflects it.
	if addr := baseCfg.Redis.Addr(); addr != "" && baseCfg.Redis.Host != "" {
		cfg.Redis = &bootstrap.RedisConfig{
			Addr:     addr,
			Password: baseCfg.Redis.Password,
			DB:       baseCfg.Redis.DB,
		}
	}
	return cfg
}

func runMigrations(autoCfg *autoconfig.Config) error {
	migrationsPath := autoCfg.MigrationsPath
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "automation_db")
	}
	return database.RunMigrations(autoCfg.DBURL, migrationsPath)
}

// leaderInstanceID returns a stable-per-process identity for leadership locks:
// "<hostname>-<pid>". It uniquely identifies this replica so the elector can
// distinguish "I still hold the lock" from "another replica holds it".
func leaderInstanceID() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "automation-service"
	}
	return fmt.Sprintf("%s-%d", host, os.Getpid())
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
