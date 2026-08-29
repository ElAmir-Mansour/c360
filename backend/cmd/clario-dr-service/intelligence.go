package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	vcisollm "github.com/clario360/platform/internal/cyber/vciso/llm"
	vcisollmcredential "github.com/clario360/platform/internal/cyber/vciso/llm/credential"
	vcisollmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/copilot"
	"github.com/clario360/platform/internal/dr/predict"
	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/dr/registry"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	drservice "github.com/clario360/platform/internal/dr/service"
	drworm "github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/leadership"
	"github.com/clario360/platform/internal/middleware"
)

// intelligencePlane bundles the five ClarioDR AI/intelligence packages
// (predict, registry, ransomware, cleanroom, copilot) so main wires them with a
// single call. Each is constructed with the real DR collaborators (DBPool,
// Redis, repository, the LLM provider manager, and the WORM recovery-point
// store) — no fakes — and exposes its HTTP surface for mounting under
// /api/v1/dr and any Kafka typed consumers it registers.
type intelligencePlane struct {
	// routers carries each package's chi.Router and the permission-aware mount
	// closure so main mounts them alongside the existing DR handler.
	mount func(protected chi.Router)

	// progressConsumers are the typed handlers that subscribe to a Kafka topic on
	// EVERY node (high-volume telemetry ingest — no leadership). predict's
	// progress-sample ingest is the only one today.
	progressConsumers map[string][]events.TypedEventHandler

	// reconcileConsumers are typed handlers that must run as a leader singleton
	// (cross-tenant DB writes). registry's runbook reconcile is the only one.
	reconcileConsumers map[string][]events.TypedEventHandler

	// frameObservers are folded into the apply path so a per-frame intelligence
	// loop (ransomware detection) sees the same bytes the applier persists.
	frameObservers []frameObserver

	// cleanroomScanner is used by the failover final-sync path to scan the fresh
	// final recovery point before Gate 1 pins it.
	cleanroomScanner cleanroomSyncScanner

	// cleanroomSvc and ransomwareStore are the CONCRETE composed services the
	// Recover Cyber Recovery workspace (Prompt 6) reuses: the clean-room service
	// is its mandatory integrity gate, the ransomware store its early-warning
	// signal source. Exposed so configureCyberRecovery composes them without
	// rebuilding their dependencies.
	cleanroomSvc    *cleanroom.Service
	ransomwareStore *ransomware.Store

	// startLeaderLoops launches the leader-singleton background loops (predict
	// forecaster, cleanroom validator, copilot retention prune). Each is started
	// only on the elected leader, mirroring startRPOMonitor/startFailoverDriver.
	startLeaderLoops func(ctx context.Context)
}

// frameObserver observes one applied frame for a stream. The ransomware Monitor
// satisfies it; the apply path calls Observe after a durable append so detection
// runs on exactly the bytes that were stored.
type frameObserver interface {
	Observe(ctx context.Context, db drrepo.DBTX, tenantID string, f core.Frame) error
}

type cleanroomSyncScanner interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*cleanroom.Scan, error)
}

// configureIntelligencePlane constructs all five packages. wormClient may be nil
// (WORM store not configured): cleanroom then serves but its scans return
// dependency_not_configured, and ransomware curation simply does not mirror the
// object-lock legal hold. The copilot is wired against the same LLM provider
// manager the vCISO chat engine uses.
func configureIntelligencePlane(
	ctx context.Context,
	db *pgxpool.Pool,
	redisClient *redis.Client,
	repo *drrepo.Repository,
	drSvc *drservice.Service,
	wormClient *drworm.Client,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *intelligencePlane {
	plane := &intelligencePlane{
		progressConsumers:  map[string][]events.TypedEventHandler{},
		reconcileConsumers: map[string][]events.TypedEventHandler{},
	}

	// ---- predict: failure prediction ------------------------------------
	predictStore := predict.NewStore()
	predictMetrics := predict.NewMetrics(metricsReg)
	predictSvc := predict.NewService(db, predictStore, predict.OutboxSink{}, predict.ServiceConfig{
		TxRunner: predict.PGXTxRunner{Pool: db},
		Metrics:  predictMetrics,
	})
	predictLoop := predict.NewLoop(predictSvc, predict.LoopConfig{
		Interval: durationEnv("DR_PREDICT_FORECAST_INTERVAL", 30*time.Second),
		Logger:   logger,
	})
	predictIngest := predict.NewIngestHandler(predictStore, predict.IngestConfig{DB: db})
	predictAPI := predict.NewAPI(predictStore, predict.PGXTenantRunner{Pool: db})
	plane.progressConsumers[events.Topics.DRProgress] = append(
		plane.progressConsumers[events.Topics.DRProgress], predictIngest)

	// ---- registry: self-maintaining recovery runbooks -------------------
	registryStore := registry.NewStore()
	registryMetrics := registry.NewMetrics(metricsReg)
	registryGen, err := registry.NewGenerator(registry.GeneratorConfig{
		Store:    registryStore,
		Template: registry.NewTemplate(),
		Runner:   registry.PGXRunner{Pool: db},
		Metrics:  registryMetrics,
		Logger:   logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr runbook generator")
	}
	registryRouter := registry.NewRouter(registryGen, logger)
	registryConsumer := registry.NewConsumer(registryGen, logger)
	plane.reconcileConsumers[events.Topics.DREvents] = append(
		plane.reconcileConsumers[events.Topics.DREvents], registryConsumer)

	// ---- ransomware: streaming early-warning detector -------------------
	ransomwareStore := ransomware.NewStore()
	ransomwareMetrics := ransomware.NewMetrics(metricsReg)
	ransomwareDetector := ransomware.NewDetector(ransomware.DefaultConfig())
	ransomwareCfg := ransomware.MonitorConfig{Metrics: ransomwareMetrics}
	if wormClient != nil {
		// Mirror the curated clean-point legal-hold onto its sealed WORM objects.
		ransomwareCfg.PinWORM = wormClient
	}
	ransomwareMonitor := ransomware.NewMonitor(
		ransomwareDetector, ransomwareStore, ransomware.OutboxSink{},
		ransomware.PGXTxRunner{Pool: db}, ransomwareCfg, logger,
	)
	ransomwareHandler := ransomware.NewHandler(ransomwareStore, drReadRunner{pool: db}, logger)
	plane.frameObservers = append(plane.frameObservers, ransomwareMonitor)

	// ---- cleanroom: recovery validation in quarantine -------------------
	cleanroomStore := cleanroom.NewStore()
	cleanroomMetrics := cleanroom.NewMetrics(metricsReg)
	cleanroomEngine := cleanroom.NewEngine(drSvc, cleanroom.NewSignatureScanner())
	cleanroomLookup := cleanroom.NewRepoLookup(drSvc.GetRecoveryPoint)
	cleanroomSvc, err := cleanroom.NewService(cleanroom.Config{
		TX:      cleanroom.PGXRunner{Pool: db},
		Store:   cleanroomStore,
		Lookup:  cleanroomLookup,
		Engine:  cleanroomEngine,
		Metrics: cleanroomMetrics,
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr clean-room service")
	}
	plane.cleanroomScanner = cleanroomSvc
	plane.cleanroomSvc = cleanroomSvc
	plane.ransomwareStore = ransomwareStore
	cleanroomHandler := cleanroom.NewHandler(cleanroomSvc, logger)
	cleanroomLoop, err := cleanroom.NewLoop(cleanroom.LoopConfig{
		Source:   drCleanroomPendingSource{pool: db},
		Service:  cleanroomSvc,
		Logger:   logger,
		Interval: durationEnv("DR_CLEANROOM_SCAN_INTERVAL", 15*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr clean-room loop")
	}

	// ---- copilot: AI recovery copilot -----------------------------------
	// Per-tenant LLM credential resolver (Vault-backed). Nil-safe: when Vault is
	// not configured BuildResolver returns nil and the copilot's Manager stays
	// env-only (existing behavior). The Vault client + DEK manager it owns live
	// for the process lifetime, matching the plane's lifetime.
	llmCredentialSvc, _, llmCredentialErr := vcisollmcredential.BuildResolver(ctx, db, nil, logger)
	if llmCredentialErr != nil {
		logger.Fatal().Err(llmCredentialErr).Msg("failed to build dr llm credential resolver")
	}
	var llmManager *vcisollmprovider.Manager
	if llmCredentialSvc != nil {
		llmManager = vcisollmprovider.NewManagerWithCredentials(vcisollm.LoadConfig(), llmCredentialSvc)
	} else {
		llmManager = vcisollmprovider.NewManager(vcisollm.LoadConfig())
	}
	copilotStore := copilot.NewStore()
	copilotMetrics := copilot.NewMetrics(metricsReg)
	copilotRunner := copilot.NewPGXRunner(db)
	copilotTools := copilot.NewTools(repo, copilotRunner, nil)
	copilotSvc := copilot.NewService(copilot.Deps{
		Providers: llmManager,
		Tools:     copilotTools,
		Store:     copilotStore,
		Runner:    copilotRunner,
		Metrics:   copilotMetrics,
		Logger:    logger,
	})
	copilotHandler := copilot.NewHandler(copilotSvc, logger)
	copilotPrune, err := copilot.NewPruneLoop(copilot.PruneLoopConfig{
		Runner:  copilotRunner,
		Store:   copilotStore,
		Metrics: copilotMetrics,
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr copilot prune loop")
	}

	// ---- HTTP mounting --------------------------------------------------
	// All five packages mount under the already-Auth+Tenant-protected
	// /api/v1/dr group; each Router carries its own RequirePermission gates
	// (dr:read for queries, dr:write for the regenerate/scan actions). The
	// copilot chat route — the only route that can PROPOSE a failover — is
	// additionally gated with dr:failover.
	plane.mount = func(protected chi.Router) {
		// Compose via route-walking (mountRoutes) instead of repeated
		// Mount("/", ...): chi panics on a second handler mounted at the same "/"
		// path, so each package router's concrete routes are re-registered onto the
		// shared group, preserving their own RequirePermission middleware.
		mountRoutes(protected, predictAPI.Routes())
		mountRoutes(protected, registryRouter.Routes())
		mountRoutes(protected, ransomwareHandler.Routes())
		mountRoutes(protected, cleanroomHandler.Routes())
		mountRoutes(protected, copilotHandler.FailoverGatedRoutes(middleware.RequirePermission(auth.PermDRFailover)))
	}

	// ---- leader-singleton background loops ------------------------------
	plane.startLeaderLoops = func(loopCtx context.Context) {
		// Restore each known ransomware baseline so the detector resumes its
		// learned steady-state after a restart, then start the per-frame Monitor
		// behind the apply path (frame observers are attached separately).
		runLeaderSingleton(loopCtx, redisClient, "dr-predict-forecaster",
			"DR_PREDICT_FORECASTER", logger, predictLoop.Start, predictLoop.Stop)
		runLeaderSingleton(loopCtx, redisClient, "dr-cleanroom-validator",
			"DR_CLEANROOM_VALIDATOR", logger, cleanroomLoop.Run, nil)
		runLeaderSingleton(loopCtx, redisClient, "dr-copilot-prune",
			"DR_COPILOT_PRUNE", logger, copilotPrune.Run, nil)
	}

	return plane
}

// startReconcileConsumers starts the leader-singleton Kafka consumer(s) that
// must run on exactly one node (registry's runbook reconcile). A fresh consumer
// is created inside the leader callback so the consumer group is joined only
// while this node is leader and is closed on loss of leadership; the same Redis
// leader election that singletons the RPO monitor/failover driver gates it. When
// Redis is unavailable the consumer runs without election (single-node dev),
// matching the documented RPO-monitor fallback.
func startReconcileConsumers(
	ctx context.Context,
	brokers []string,
	groupID string,
	autoOffsetReset string,
	redisClient *redis.Client,
	consumers map[string][]events.TypedEventHandler,
	logger zerolog.Logger,
) {
	run := func(loopCtx context.Context) {
		consumer, err := events.NewConsumer(appconfig.KafkaConfig{
			Brokers:         brokers,
			GroupID:         groupID + "-reconcile",
			AutoOffsetReset: autoOffsetReset,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("dr reconcile consumer unavailable")
			return
		}
		defer consumer.Close()
		for topic, handlers := range consumers {
			for _, h := range handlers {
				consumer.Subscribe(topic, h)
			}
		}
		if err := consumer.Start(loopCtx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("dr reconcile consumer stopped with error")
		}
	}
	runLeaderSingleton(ctx, redisClient, "dr-runbook-reconcile", "DR_RUNBOOK_RECONCILE", logger, run, nil)
}

// runLeaderSingleton runs start(ctx) only while this instance holds leadership
// for role, mirroring startRPOMonitor/startFailoverDriver. start MUST block
// until its ctx is cancelled (e.g. loop.Run) OR be a non-blocking launcher whose
// matching stop is supplied (e.g. predict Loop.Start/Stop). When Redis is
// unavailable the loop runs without election (single-node development), matching
// the RPO monitor's documented fallback.
func runLeaderSingleton(
	ctx context.Context,
	redisClient *redis.Client,
	role, instanceEnvPrefix string,
	logger zerolog.Logger,
	start func(context.Context),
	stop func(),
) {
	if redisClient == nil {
		logger.Warn().Str("role", role).Msg("dr intelligence loop: Redis unavailable, running without leader election")
		go start(ctx)
		return
	}

	instanceID := envOr(instanceEnvPrefix+"_INSTANCE_ID", "")
	if instanceID == "" {
		hostname, herr := os.Hostname()
		if herr != nil || hostname == "" {
			hostname = "clario-dr-service"
		}
		instanceID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}
	ttl := durationEnv(instanceEnvPrefix+"_LEADER_TTL", 30*time.Second)
	renew := durationEnv(instanceEnvPrefix+"_LEADER_RENEW", 10*time.Second)
	elector := leadership.NewRedisElection(redisClient, role, instanceID, ttl, renew, &logger)

	var mu sync.Mutex
	var stopLeader context.CancelFunc
	go func() {
		err := elector.Run(ctx, leadership.RunOpts{
			OnAcquire: func(parent context.Context) {
				mu.Lock()
				if stopLeader != nil {
					stopLeader()
				}
				leaderCtx, cancel := context.WithCancel(parent)
				stopLeader = cancel
				mu.Unlock()
				logger.Info().Str("instance", instanceID).Str("role", role).Msg("dr intelligence loop: acquired leadership")
				go func() {
					start(leaderCtx)
					if stop != nil {
						<-leaderCtx.Done()
						stop()
					}
				}()
			},
			OnLose: func() {
				mu.Lock()
				if stopLeader != nil {
					stopLeader()
					stopLeader = nil
				}
				mu.Unlock()
				logger.Warn().Str("instance", instanceID).Str("role", role).Msg("dr intelligence loop: lost leadership")
			},
		})
		mu.Lock()
		if stopLeader != nil {
			stopLeader()
			stopLeader = nil
		}
		mu.Unlock()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Str("role", role).Msg("dr intelligence leadership loop stopped")
		}
	}()
}

// drReadRunner adapts the DR pool to the ransomware handler's TenantReader and
// any other tenant-scoped read runner.
type drReadRunner struct{ pool *pgxpool.Pool }

func (r drReadRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// drCleanroomPendingSource resolves validated-but-unscanned recovery points
// across all tenants (system path) for the clean-room validator loop. A point is
// pending when it is validated and has no CLEAN clean-room verdict yet. This is
// the DB-backed cleanroom.PendingSource the design reserves for the integration
// phase; it joins recovery_point LEFT JOIN dr_cleanroom_scan and never edits the
// shared repository.
type drCleanroomPendingSource struct{ pool *pgxpool.Pool }

const pendingCleanroomScansSQL = `
SELECT rp.tenant_id, rp.id, rp.group_id
FROM recovery_point rp
WHERE rp.is_validated = true
  AND NOT EXISTS (
    SELECT 1 FROM dr_cleanroom_scan cs
    WHERE cs.recovery_point_id = rp.id AND cs.verdict = 'clean'
  )
ORDER BY rp.sealed_at ASC
LIMIT $1`

func (s drCleanroomPendingSource) PendingCleanroomScans(ctx context.Context, limit int) ([]cleanroom.PendingPoint, error) {
	if limit <= 0 {
		limit = 4
	}
	var points []cleanroom.PendingPoint
	err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(ctx, pendingCleanroomScansSQL, limit)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		for rows.Next() {
			var tenantID, pointID, groupID uuid.UUID
			if scanErr := rows.Scan(&tenantID, &pointID, &groupID); scanErr != nil {
				return scanErr
			}
			points = append(points, cleanroom.PendingPoint{
				TenantID:        tenantID,
				RecoveryPointID: pointID,
				GroupID:         groupID,
			})
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("dr cleanroom pending source: %w", err)
	}
	return points, nil
}
