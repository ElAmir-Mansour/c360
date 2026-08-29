// clario-dr-service is the ClarioDR control plane (DESIGN_DataStream_DR.md §4):
// sovereign failover & recovery — replication manager, RPO monitor, immutable
// recovery-point store, the gated failover state machine, and the NCA-ready
// attestation engine.
//
// This boots against dr_db, runs migrations, ensures the outbox schema, and
// mounts the tenant-scoped DR API under /api/v1/dr behind Auth+Tenant. Request
// path state changes commit in one transaction with their outbox event.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	drseed "github.com/clario360/platform/internal/dr"
	drattest "github.com/clario360/platform/internal/dr/attest"
	"github.com/clario360/platform/internal/dr/attestledger"
	drconfig "github.com/clario360/platform/internal/dr/config"
	drconsumer "github.com/clario360/platform/internal/dr/consumer"
	drenroll "github.com/clario360/platform/internal/dr/enroll"
	"github.com/clario360/platform/internal/dr/failover"
	drhandler "github.com/clario360/platform/internal/dr/handler"
	drhealth "github.com/clario360/platform/internal/dr/health"
	dringest "github.com/clario360/platform/internal/dr/ingest"
	drmetrics "github.com/clario360/platform/internal/dr/metrics"
	"github.com/clario360/platform/internal/dr/model"
	drprovider "github.com/clario360/platform/internal/dr/provider"
	drreadmodel "github.com/clario360/platform/internal/dr/readmodel"
	drecoverytier "github.com/clario360/platform/internal/dr/recoverytier"
	drproof "github.com/clario360/platform/internal/dr/rehearsalproof"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	drrpo "github.com/clario360/platform/internal/dr/rpo"
	drservice "github.com/clario360/platform/internal/dr/service"
	drsovereignty "github.com/clario360/platform/internal/dr/sovereignty"
	"github.com/clario360/platform/internal/dr/topology"
	drworm "github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/leadership"
	sharedmw "github.com/clario360/platform/internal/middleware"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	obshealth "github.com/clario360/platform/internal/observability/health"
	"github.com/clario360/platform/internal/observability/tracing"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
	siemcrypto "github.com/clario360/platform/internal/siem/store/crypto"
	"github.com/clario360/platform/internal/vault"
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
	drCfg, err := drconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading dr config: " + err.Error() + "\n")
		os.Exit(1)
	}
	runtimeValidation := drconfig.ValidateRuntime(drCfg, baseCfg)
	if drCfg.Regulated() && !runtimeValidation.Valid {
		payload, _ := json.Marshal(runtimeValidation)
		os.Stderr.WriteString("validating dr regulated deployment profile: " + runtimeValidation.Error() + "\n")
		if len(payload) > 0 {
			os.Stderr.WriteString(string(payload) + "\n")
		}
		os.Exit(1)
	}

	svc, err := bootstrap.Bootstrap(ctx, buildBootstrapConfig(baseCfg, drCfg))
	if err != nil {
		os.Stderr.WriteString("bootstrapping clario-dr-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger

	if err := runMigrations(drCfg); err != nil {
		logger.Fatal().Err(err).Msg("failed to run dr migrations")
	}
	// Ensure the transactional outbox table exists (events staged in-tx with
	// every DR state change are relayed to Kafka).
	if err := outbox.EnsureSchema(ctx, svc.DBPool); err != nil {
		logger.Fatal().Err(err).Msg("failed to ensure outbox schema")
	}

	// Readiness: report on dr_db (+ Redis when wired). Bootstrap already
	// registered the same dependencies; AddCheckers is a no-op duplicate-safe
	// reinforcement that keeps DR's probe set explicit and self-documenting.
	svc.Health.AddCheckers(drhealth.NewRuntimeConfigHealthChecker(runtimeValidation))
	svc.Health.AddCheckers(drhealth.Checkers(svc.DBPool, svc.Redis)...)

	if drCfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(drCfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", drCfg.JWTPublicKeyPath).Msg("failed to read DR_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	repo := drrepo.New()
	// DR SLO metrics (DESIGN §11) registered on the service registry so they are
	// scraped at :PORT_admin/metrics; injected into the monitor, recovery-point
	// validator, and failover driver where the values are computed.
	drMetrics := drmetrics.New(svc.Metrics.Registry())
	drSvc := drservice.New(svc.DBPool, repo, logger).WithMetrics(drMetrics)
	wormClient, recoveryDEKManager, recoveryWORMDEKs, recoveryHealthCheckers, closeRecoveryStore := configureRecoveryPointStore(ctx, drCfg, svc.DBPool, repo, drSvc, logger)
	svc.Health.AddCheckers(recoveryHealthCheckers...)
	defer closeRecoveryStore()

	// Intelligence plane (predict / registry / ransomware / cleanroom / copilot):
	// constructed with the real DR collaborators and the WORM recovery-point store
	// (nil when not configured). It must be built before the agent plane so the
	// ransomware Monitor can be folded into the frame apply path as an observer.
	intel := configureIntelligencePlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, wormClient, svc.Metrics.Registry(), logger)

	// Clean-recovery-point promotion gate (ransomware-safe promotion). OPT-IN, like
	// the other sovereign hardening (residency, WORM compliance, sealed KEK): only
	// wired when DR_CLEANPOINT_GATE_ENFORCE=true, so default deployments keep the
	// content-hash-fidelity validation behavior and nothing about ValidateRecovery
	// Point changes. When enabled, the gate consults the LATEST STORED clean-room
	// verdict (read-only — see readOnlyCleanPointScanner) instead of triggering a
	// fresh restore+scan inside validation, so validation stays fast and never 500s
	// from a scan it kicked off; a recovery point with no clean-room evidence is
	// held back from promotion (not marked validated) per the ransomware-safe
	// posture. A nil scorer defaults to the production cleanpoint.Scorer.
	if drCfg.CleanPointGateEnforce {
		var cleanPointScanner drservice.CleanPointScanner
		if intel.cleanroomSvc != nil {
			cleanPointScanner = readOnlyCleanPointScanner{svc: intel.cleanroomSvc}
		}
		drSvc.WithCleanPointGate(nil, cleanPointScanner)
		logger.Info().Msg("clean-recovery-point promotion gate ENABLED (ransomware-safe promotion; consults stored clean-room verdicts)")
	}

	// Resilience plane (journal / appconsistent / instant / failback / topology):
	// the five resilience-depth packages, constructed with the same real DR
	// collaborators (DBPool, Redis, repository, drSvc as recovery-point
	// sealer/reader, the WORM/DEK store). Built before the agent plane so the CDP
	// journal Appender can be folded into the frame apply path as a frame observer
	// — the SAME way the ransomware Monitor is — appending each durably-applied
	// frame into the journal segment index.
	resil := configureResiliencePlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, wormClient, svc.Metrics.Registry(), logger)
	defer resil.flushJournal(context.Background())

	// Orchestration plane (runbook studio / drill scheduler / boot graph /
	// game-day): constructed with real DB/Redis/service collaborators so the
	// authored runbooks, scheduled drills, dependency-aware boot plans, and chaos
	// exercises become part of the same tenant-scoped DR control plane.
	orch := configureOrchestrationPlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, svc.Metrics.Registry(), logger)

	// Integrations catalog (external DR integrations: hypervisors, storage arrays,
	// cloud vaults, K8s) with AES-256-GCM envelope-encrypted credentials. It is the
	// bridge that lets the coverage/sovereign factories drive REAL vendor adapters
	// (ONTAP / vSphere / cloud-backup gateways) from live, tenant-scoped, decrypted
	// credentials. Built BEFORE the coverage/sovereign planes so its Resolver can be
	// injected into them; when DR_INTEGRATIONS_ENC_KEY is unset the plane is empty
	// (router + resolver nil) and those planes keep their env-only behavior.
	integrationsPlane := configureIntegrationsPlane(svc.DBPool, svc.Metrics.Registry(), logger)

	// Coverage plane (VM/K8s workload capture, IaC snapshots, storage offload):
	// constructed with the same real DB/Redis/repository collaborators so the
	// broader protected-estate surface feeds the shared DR control plane. The
	// integrations Resolver lets its storage-offload (netapp_ontap) and
	// vm-capture (vmware_vsphere) factories build clients from live integrations.
	coverage := configureCoveragePlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, integrationsPlane.resolver, svc.Metrics.Registry(), logger)

	// Sovereign-moat plane (bcm / byok / attestledger): constructed with the REAL
	// DR collaborators — the live drillsched/attest/recovery-point/clean-room data
	// sources for BCM evidence, the SAME per-tenant DEK manager the WORM store
	// seals with for BYOK rewrap, and the WORM client for attestation-ledger
	// anchoring. The attestation-ledger reconcile consumer it registers consumes
	// the DR attestation/clean-room/drill events and records them exactly once.
	sovereign := configureSovereignPlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, recoveryDEKManager, recoveryWORMDEKs, wormClient, integrationsPlane.resolver, drCfg.DBURL, svc.Metrics.Registry(), logger)
	// Seed the BCM compliance-pack catalog into its dr_bcm_pack reference tables
	// (idempotent upsert from the in-code catalog) so the packs are queryable.
	if err := sovereign.seed(ctx); err != nil {
		logger.Fatal().Err(err).Msg("failed to seed dr bcm compliance-pack catalog")
	}

	// Demo DR data seeder: mirrors the lex in-process seeder. Gated on
	// DR_SEED_DEMO_DATA=true (off by default) and scoped to the demo tenant
	// ("Abdullah Al Othaim Investment Company") so the /dr console is alive in the
	// demo. Idempotent (check-exists + ON CONFLICT DO NOTHING) so restarts never
	// duplicate, and — UNLIKE the BCM catalog seed above — NON-FATAL: a failure is
	// logged and startup continues so a demo-data hiccup can never take the
	// dr-service down.
	if envEnabled("DR_SEED_DEMO_DATA") {
		demoTenant := envOr("DR_SEED_DEMO_TENANT_ID", drseed.DemoTenantID)
		if err := drseed.SeedDRDemo(ctx, svc.DBPool, demoTenant); err != nil {
			logger.Error().Err(err).Str("tenant_id", demoTenant).Msg("dr demo data seed failed (continuing)")
		} else {
			logger.Info().Str("tenant_id", demoTenant).Msg("dr demo data seeded")
		}
	}

	// Fold BOTH planes' frame observers into the apply path: the ransomware
	// detector (intel) and the CDP journal appender (resil) each see exactly the
	// bytes the applier persists, in apply order.
	frameObservers := append(append([]frameObserver{}, intel.frameObservers...), resil.frameObservers...)
	enrollHandler, closeAgentPlane := configureAgentPlane(ctx, drCfg, svc.DBPool, svc.Redis, repo, frameObservers, logger)
	defer closeAgentPlane()
	// Recover productization plane: the "Recover" product with three
	// sub-solutions over the existing dr/* services, resolving per-tenant
	// entitlement through the EXISTING licensing engine (HTTP checker) and
	// persisting per-tenant sub-solution activation in dr_db. Served under its
	// own /api/recover namespace (mounted below), separate from /api/v1/dr.
	recoverPlane, err := configureRecoverPlane(svc.DBPool, drCfg, orch.bootMgr, coverage.workloadSvc, coverage.iacSvc, orch.studioSvc, intel.cleanroomSvc, intel.ransomwareStore, sovereign.attestationLedger, svc.Metrics.Registry(), logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct recover product plane")
	}

	httpHandler := drhandler.New(drSvc, logger)
	readModelSvc, err := drreadmodel.NewService(drreadmodel.ServiceConfig{
		Runner: drreadmodel.PGXRunner{Pool: svc.DBPool},
		Store:  repo,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr readmodel service")
	}
	readModelRouter := drreadmodel.NewRouter(readModelSvc, logger)
	recoveryTierRouter := drecoverytier.NewRouter(drecoverytier.NewServiceWithSites(drecoverytier.NewPGXSiteSource(svc.DBPool)), logger)

	// Rehearsal-proof service: government-readiness proofs over game-day scorecards,
	// runbook runs and failover drills. When a signing key is configured it SIGNS,
	// WORM-SEALS and ANCHORS each proof to the tamper-evident attestation ledger
	// (reusing the sovereign plane's *worm.Client and *attestledger.Recorder) and
	// persists it; without a key it stays compute-only (GET works, sealed POST 501).
	proofRouter := configureRehearsalProof(drCfg, svc.DBPool, orch.gamedaySvc, orch.studioSvc, drSvc, wormClient, sovereign.attestationLedger, logger)

	startRPOMonitor(ctx, svc.DBPool, svc.Redis, repo, drMetrics, logger)

	// Start the intelligence plane's leader-singleton background loops (predict
	// forecaster, clean-room validator, copilot retention prune) under Redis
	// leader election, mirroring startRPOMonitor/startFailoverDriver.
	intel.startLeaderLoops(ctx)

	// Start the resilience plane's leader-singleton background loops (journal
	// segment-roll + retention, instant hydration/finalize, failback driver),
	// each gated by Redis leader election like startRPOMonitor/startFailoverDriver.
	resil.startLeaderLoops(ctx)

	// Start orchestration leader-singletons (drill scheduler, runbook-studio
	// reconciler, game-day runner) using the same Redis election discipline.
	orch.startLeaderLoops(ctx)

	// Start coverage leader-singletons (storage offload and optional workload
	// capture scheduler) under the same Redis election discipline.
	coverage.startLeaderLoops(ctx)

	// Start sovereign-moat leader-singletons (attestation-ledger periodic anchoring
	// + BYOK rotation-recovery) under the same Redis election discipline.
	sovereign.startLeaderLoops(ctx)

	// Start the gated failover state machine (WP-9/10/12) as a leader-singleton:
	// the Driver claims runs across tenants (FOR UPDATE SKIP LOCKED) and advances
	// them through the real recovery executor (restore+decrypt from WORM, boot
	// order, network mappings), the real workload health gate, and the real
	// attestation engine (RTO/RPO/validation + sealed NCA report). No fakes.
	startFailoverDriver(ctx, svc.DBPool, svc.Redis, repo, drSvc, resil.instantRecovery, intel.cleanroomScanner, orch.ingestDrillResult, orch.bootTiers, wormClient, drCfg, drMetrics, logger)

	// Data-residency enforcement (WTQ-SEC-03): when DR_RESIDENCY / RESIDENCY
	// service-region config is set, geo-fence every tenant-scoped DR request to its
	// bound residency region. The middleware runs AFTER Auth+Tenant so the tenant is
	// in context; it is a pass-through when disabled. Fail-closed (403) on any
	// tenant-region lookup error, so svc.DBPool must be able to read
	// platform_core.tenants.
	// Arm the HTTP residency middleware from the SAME resolved region as the
	// data-plane guard: DR_RESIDENCY -> RESIDENCY -> SERVICE_REGION (the Wave-1
	// alias in drCfg.ResidencyRegion). Otherwise an operator who follows the
	// runbook and sets only DR_RESIDENCY would geo-fence every worm.Seal/Get but
	// leave this request-layer middleware silently inert.
	if drCfg.ResidencyRegion != "" {
		baseCfg.Residency.ServiceRegion = drCfg.ResidencyRegion
	}
	residencyEnforcer := drsovereignty.NewResidencyEnforcer(baseCfg.Residency, svc.DBPool, logger)

	svc.Router.Use(sharedmw.SecurityHeaders())
	svc.Router.Route("/api/v1/dr", func(r chi.Router) {
		if enrollHandler != nil {
			r.Post("/agents/enroll", enrollHandler.Exchange)
		}
		r.Group(func(protected chi.Router) {
			protected.Use(sharedmw.Auth(jwtMgr))
			protected.Use(sharedmw.Tenant)
			if residencyEnforcer.Enabled() {
				protected.Use(residencyEnforcer.Middleware)
			}
			// Compose every plane's routes onto this single Auth+Tenant group via
			// route-walking (mountRoutes) rather than repeated Mount("/", ...): chi
			// registers a "/*" subtree per Mount and panics on a second Mount at the
			// same "/" path, so the main DR handler and the intelligence/resilience
			// package routers are merged by re-registering each concrete route,
			// preserving its own RequirePermission middleware and wildcard param names.
			mountRoutes(protected, readModelRouter.Routes())
			mountRoutes(protected, recoveryTierRouter.Routes())
			mountRoutes(protected, httpHandler.Routes())
			// Rehearsal-proof routes (dr:read GET proofs, dr:write POST seal). The
			// router is compute-only or sealing depending on whether a signing key was
			// configured; either way it mounts under the same Auth+Tenant group.
			mountRoutes(protected, proofRouter.Routes())
			// Mount the five intelligence packages' routers under the same
			// Auth+Tenant group; each carries its own RequirePermission gates
			// (dr:read queries, dr:write actions, dr:failover on the copilot's
			// failover-proposing chat route).
			intel.mount(protected)
			// Mount the five resilience packages' routers under the same
			// Auth+Tenant group; each carries its own RequirePermission gates
			// (dr:read queries, dr:write actions, dr:failover on the
			// app-consistent trigger / instant start+finalize / failback cutback).
			resil.mount(protected)
			// Mount the orchestration packages' routers under the same group:
			// runbook authoring/execution, scheduled drills, boot DAGs, and
			// game-day exercises.
			orch.mount(protected)
			// Mount the coverage packages' routers under the same group:
			// VM/K8s workload capture, IaC snapshot/diff/plan, and storage offload.
			coverage.mount(protected)
			// Mount the sovereign-moat packages' routers under the same group:
			// BCM compliance packs (dr:read view/report, dr:write run-assessment),
			// BYOK key custody (dr:read versions/custody-log, dr:admin enroll/rotate),
			// and the attestation ledger (dr:read list/verify/proof, dr:admin anchor).
			sovereign.mount(protected)
			// Mount the external-integrations catalog router (when enabled): list/get
			// (dr:read), create/update/delete (dr:admin), test connectivity (dr:write)
			// under /api/v1/dr/integrations. nil when DR_INTEGRATIONS_ENC_KEY is unset.
			if integrationsPlane.router != nil {
				mountRoutes(protected, integrationsPlane.router.Routes())
			}
			if enrollHandler != nil {
				protected.Post("/agents/{agentID}/enrollment-token", enrollHandler.MintToken)
			}
		})
	})

	// Recover product surface under its own /api/recover namespace, behind the
	// same Auth+Tenant middleware as /api/v1/dr. Each route self-gates with
	// RequirePermission (dr:read for products, dr:admin for activation).
	svc.Router.Route("/api/recover", func(r chi.Router) {
		r.Group(func(protected chi.Router) {
			protected.Use(sharedmw.Auth(jwtMgr))
			protected.Use(sharedmw.Tenant)
			if residencyEnforcer.Enabled() {
				protected.Use(residencyEnforcer.Middleware)
			}
			recoverPlane.mount(protected)
		})
	})

	// Outbox relay: DR lifecycle/alert events staged in-transaction are
	// delivered to Kafka here; without a reachable broker they accumulate
	// durably in event_outbox.
	if len(drCfg.KafkaBrokers) > 0 {
		kafkaProducer, err := events.NewProducer(appconfig.KafkaConfig{
			Brokers: drCfg.KafkaBrokers,
			GroupID: drCfg.KafkaGroupID,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka producer unavailable — dr events will accumulate in the outbox")
		} else {
			defer kafkaProducer.Close()
			relay := outbox.NewRelay(svc.DBPool, kafkaProducer, outbox.Config{}, logger,
				outbox.NewMetrics(svc.Metrics.Registry()))
			go func() {
				if err := relay.Run(ctx); err != nil {
					logger.Error().Err(err).Msg("outbox relay stopped with error")
				}
			}()
		}

		kafkaConsumer, err := events.NewConsumer(appconfig.KafkaConfig{
			Brokers:         drCfg.KafkaBrokers,
			GroupID:         drCfg.KafkaGroupID + "-cross-suite",
			AutoOffsetReset: baseCfg.Kafka.AutoOffsetReset,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka consumer unavailable — DR cross-suite controls disabled")
		} else {
			defer kafkaConsumer.Close()
			crossSuite := drconsumer.New(drSvc, logger)
			for _, topic := range crossSuite.Topics() {
				kafkaConsumer.Subscribe(topic, crossSuite)
			}
			// predict's progress-sample ingest is high-volume telemetry: it runs on
			// EVERY node (the Kafka consumer group balances partitions); no
			// leadership. It appends each datastream.dr.progress sample to the
			// rolling series the forecaster loop reads.
			for topic, handlers := range intel.progressConsumers {
				for _, h := range handlers {
					kafkaConsumer.Subscribe(topic, h)
				}
			}
			// topology's per-edge health rollup is the resilience plane's
			// every-node progress consumer: it reads the SAME datastream.dr.progress
			// telemetry and rolls each sample onto every edge carrying the stream,
			// so the topology-aware failover selection reflects LIVE health.
			for topic, handlers := range resil.progressConsumers {
				for _, h := range handlers {
					kafkaConsumer.Subscribe(topic, h)
				}
			}
			go func() {
				if err := kafkaConsumer.Start(ctx); err != nil {
					logger.Error().Err(err).Msg("dr cross-suite consumer stopped with error")
				}
			}()
		}

		// registry's runbook reconcile consumer, the drill-schedule consumer, and
		// the attestation-ledger reconcile consumer mutate cross-tenant DR state
		// from datastream.dr.events; the design makes them leader singletons in a
		// dedicated consumer group so exactly one node performs each derived write
		// (and each attestation/clean-room verdict/drill outcome is appended to the
		// tamper-evident ledger exactly once).
		reconcileConsumers := mergeReconcileConsumers(intel.reconcileConsumers, orch.reconcileConsumers, sovereign.reconcileConsumers)
		if len(reconcileConsumers) > 0 {
			startReconcileConsumers(ctx, drCfg.KafkaBrokers, drCfg.KafkaGroupID, baseCfg.Kafka.AutoOffsetReset, svc.Redis, reconcileConsumers, logger)
		}
	}

	logger.Info().
		Int("port", drCfg.HTTPPort).
		Int("admin_port", drCfg.AdminPort).
		Str("mtls_listen", drCfg.MTLSListenAddr).
		Msg("clario-dr-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("clario-dr-service failed")
	}
}

func buildBootstrapConfig(baseCfg *appconfig.Config, drCfg *drconfig.Config) *bootstrap.ServiceConfig {
	env := envOr("ENVIRONMENT", "development")
	cfg := &bootstrap.ServiceConfig{
		Name:        "clario-dr-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        drCfg.HTTPPort,
		AdminPort:   drCfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               drCfg.DBURL,
			MinConns:          drCfg.DBMinConns,
			MaxConns:          drCfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "clario-dr-service",
			Version:     serviceVersion,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: baseCfg.Server.ShutdownTimeout,
		ReadTimeout:     baseCfg.Server.ReadTimeout,
		WriteTimeout:    baseCfg.Server.WriteTimeout,
	}
	// Redis backs the leader-singleton election (rpo_monitor, failover.Driver)
	// in later WPs; wire it when configured so /readyz reflects it.
	if addr := baseCfg.Redis.Addr(); addr != "" && baseCfg.Redis.Host != "" {
		cfg.Redis = &bootstrap.RedisConfig{
			Addr:     addr,
			Password: baseCfg.Redis.Password,
			DB:       baseCfg.Redis.DB,
		}
	}
	return cfg
}

func runMigrations(drCfg *drconfig.Config) error {
	migrationsPath := drCfg.MigrationsPath
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "dr_db")
	}
	return database.RunMigrations(drCfg.DBURL, migrationsPath)
}

func mergeReconcileConsumers(groups ...map[string][]events.TypedEventHandler) map[string][]events.TypedEventHandler {
	merged := map[string][]events.TypedEventHandler{}
	for _, group := range groups {
		for topic, handlers := range group {
			if len(handlers) == 0 {
				continue
			}
			merged[topic] = append(merged[topic], handlers...)
		}
	}
	return merged
}

// configureRehearsalProof builds the rehearsal-proof HTTP surface. When a signing
// key PEM is configured it constructs the full sign+WORM-seal+ledger-anchor+persist
// pipeline (reusing the sovereign plane's *worm.Client and *attestledger.Recorder)
// and returns a sealing-capable router; otherwise it returns the compute-only
// router (GET proofs work; the sealed POST routes report sealing-not-configured).
// A misconfigured signing key or a missing WORM/ledger dependency when a key IS set
// is fatal — a government-readiness deployment must not silently downgrade.
func configureRehearsalProof(
	drCfg *drconfig.Config,
	db *pgxpool.Pool,
	gameday drproof.GameDayReader,
	runbooks drproof.RunbookReader,
	failover drproof.FailoverReader,
	wormClient *drworm.Client,
	ledger *attestledger.Recorder,
	logger zerolog.Logger,
) *drproof.Router {
	keyPEM := strings.TrimSpace(drCfg.RehearsalProofSigningKeyPEM)
	if keyPEM == "" {
		logger.Warn().Msg("dr rehearsal-proof: DR_REHEARSAL_PROOF_SIGNING_KEY_PEM unset; proof service is compute-only (sealed proofs unavailable)")
		return drproof.NewRouter(drproof.NewService(gameday, runbooks, failover), logger)
	}
	if wormClient == nil {
		logger.Fatal().Msg("dr rehearsal-proof: signing key configured but WORM store is not; sealed proofs require the recovery-point WORM store (configure MinIO + Vault)")
	}
	if ledger == nil {
		logger.Fatal().Msg("dr rehearsal-proof: signing key configured but the attestation ledger is not available")
	}

	signer, err := drproof.NewPEMSigner([]byte(keyPEM))
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to parse DR_REHEARSAL_PROOF_SIGNING_KEY_PEM")
	}
	wormSealer, err := drproof.NewWORMClientSealer(wormClient, time.Time{})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr rehearsal-proof WORM sealer")
	}
	ledgerAnchor, err := drproof.NewLedgerRecorderAdapter(ledger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr rehearsal-proof ledger anchor")
	}
	sealer, err := drproof.NewSealer(drproof.SealerConfig{
		TX:     drproof.PGXRunner{Pool: db},
		Signer: signer,
		WORM:   wormSealer,
		Ledger: ledgerAnchor,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr rehearsal-proof sealer")
	}
	proofSvc, err := drproof.NewSealingService(drproof.SealingConfig{
		GameDay:  gameday,
		Runbooks: runbooks,
		Failover: failover,
		Sealer:   sealer,
		TX:       drproof.PGXRunner{Pool: db},
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr rehearsal-proof sealing service")
	}
	logger.Info().Msg("dr rehearsal-proof: sealing service wired (sign + WORM-seal + ledger-anchor + persist)")
	return drproof.NewRouter(proofSvc, logger)
}

func configureRecoveryPointStore(ctx context.Context, drCfg *drconfig.Config, db *pgxpool.Pool, repo *drrepo.Repository, drSvc *drservice.Service, logger zerolog.Logger) (*drworm.Client, siemcrypto.DEKManager, *sovereignWORMDEKProvider, []obshealth.HealthChecker, func()) {
	minioReady := drCfg.MinIOEndpoint != "" && drCfg.MinIOAccessKey != "" && drCfg.MinIOSecretKey != ""
	vaultReady := drCfg.VaultAddr != ""
	if !minioReady && !vaultReady {
		logger.Warn().Msg("dr recovery-point WORM store not configured; seal/validate endpoints will return dependency_not_configured")
		return nil, nil, nil, nil, func() {}
	}
	if !minioReady || !vaultReady {
		logger.Fatal().
			Bool("minio_ready", minioReady).
			Bool("vault_ready", vaultReady).
			Msg("incomplete DR recovery-point store configuration")
	}

	vaultEnvironment := envOr("ENVIRONMENT", "development")
	if vaultEnvironment == "production" {
		vaultEnvironment = "prod"
	}
	vaultCfg := vault.Config{
		Addr:            drCfg.VaultAddr,
		AuthMethod:      drCfg.VaultAuthMethod,
		Token:           drCfg.VaultToken,
		AppRoleRoleID:   drCfg.VaultAppRoleRoleID,
		AppRoleSecretID: drCfg.VaultAppRoleSecretID,
		TransitPath:     drCfg.VaultTransitPath,
		Namespace:       drCfg.VaultNamespace,
		Environment:     vaultEnvironment,
	}
	vaultClient, err := vault.NewClient(ctx, vaultCfg)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create DR Vault client")
	}

	dekMgr, err := siemcrypto.NewDEKManager(siemcrypto.DEKManagerConfig{
		TransitKeyForTenant: func(tenantID uuid.UUID) string {
			return "dr-tenant-" + tenantID.String()
		},
	}, siemcrypto.DEKManagerDeps{
		Pool:    db,
		Transit: siemcrypto.NewTransit(vaultClient),
	})
	if err != nil {
		_ = vaultClient.Close()
		logger.Fatal().Err(err).Msg("failed to create DR DEK manager")
	}

	// Bind the WORM object-store region to the deployment's residency region when
	// no explicit MinIO region is set. This makes the physical location a sealed
	// chunk lands in track the sovereignty binding, so the data-plane guard below
	// (tenant residency region vs. bucket region) is comparing against the region
	// this deployment is actually bound to.
	wormRegion := drCfg.MinIORegion
	if strings.TrimSpace(wormRegion) == "" {
		wormRegion = drCfg.ResidencyRegion
	}
	wormDEKs := newSovereignWORMDEKProvider(dekMgr)
	wormClient, err := drworm.New(drworm.Config{
		Endpoint:              drCfg.MinIOEndpoint,
		AccessKey:             drCfg.MinIOAccessKey,
		SecretKey:             drCfg.MinIOSecretKey,
		UseSSL:                drCfg.MinIOUseSSL,
		Region:                wormRegion, // residency-bound; may be "" — worm applies DefaultRegion unless RequireExplicitRegion
		RequireExplicitRegion: drCfg.WORMRequireExplicitRegion,
		Bucket:                drCfg.WORMBucket,
		DefaultRetention:      drCfg.RecoveryRetention,
		RetentionMode:         drCfg.WORMRetentionMode, // "" => governance
	}, wormDEKs, logger)
	if err != nil {
		_ = dekMgr.Close()
		_ = vaultClient.Close()
		logger.Fatal().Err(err).Msg("failed to create DR WORM client")
	}

	// Data-plane data-residency enforcement (WTQ-SEC-03, data plane): when a
	// residency region is configured, attach a tenant-region resolver so EVERY
	// seal (write) and Get (restore/read) — across the recovery-point, attest,
	// attestledger, rehearsal-proof and self-DR sealers — refuses (fail-closed)
	// any cross-region operation. It resolves the tenant region from the SAME
	// platform_core.tenants source the control-plane middleware uses, so the two
	// planes can never drift. Off (unchanged behavior) when no region is set.
	if strings.TrimSpace(drCfg.ResidencyRegion) != "" {
		wormClient.WithRegionResolver(drsovereignty.NewRegionResolver(db))
		logger.Info().
			Str("residency_region", drCfg.ResidencyRegion).
			Str("residency_region_source", drCfg.ResidencyRegionSource).
			Str("worm_region", wormRegion).
			Msg("dr recovery-point WORM store: data-plane data-residency enforcement ENABLED (cross-region seal/restore fail-closed)")
	}

	// Wire the real recovery-point store: WORM/DEK object storage plus the
	// durable applied-frame chunk source. Recovery points seal the exact bytes
	// the ingest/apply path has stored for each stream through applied_seq; the
	// validator is left nil so ValidateRecoveryPoint re-downloads and decrypts
	// every sealed chunk through the per-tenant DEK (§15.3).
	drSvc.WithRecoveryPoint(wormClient, drSvc.AppliedFrameChunkSource(repo), nil, drCfg.LegalHoldCount)
	logger.Info().
		Str("bucket", drCfg.WORMBucket).
		Int("legal_hold_count", drCfg.LegalHoldCount).
		Msg("dr recovery-point WORM store wired (object-lock GOVERNANCE + per-tenant DEK)")

	healthCheckers := drhealth.RecoveryPointCheckers(wormClient, drCfg.MinIOEndpoint, vault.NewHealthChecker(vaultClient, vaultCfg))
	// dekMgr is returned so the sovereign plane's BYOK custody service can rewrap
	// the SAME per-tenant DEKs the WORM recovery-point store seals with (one DEK
	// manager, one Vault client). It is closed by the cleanup closure at shutdown.
	return wormClient, dekMgr, wormDEKs, healthCheckers, func() {
		if err := dekMgr.Close(); err != nil {
			logger.Warn().Err(err).Msg("failed to close DR DEK manager")
		}
		if err := vaultClient.Close(); err != nil {
			logger.Warn().Err(err).Msg("failed to close DR Vault client")
		}
	}
}

func configureAgentPlane(ctx context.Context, drCfg *drconfig.Config, db *pgxpool.Pool, redisClient *redis.Client, repo *drrepo.Repository, frameObservers []frameObserver, logger zerolog.Logger) (*drenroll.Handler, func()) {
	agents := drAgentRuntime{pool: db, repo: repo}
	tokenStore := &drEnrollmentTokenStore{pool: db}
	tokenSigner, err := configureDREnrollmentSigner(drCfg, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to configure DR enrollment-token signer")
	}
	rawTokens := siemenroll.NewTokenManager(tokenSigner, redisClient)
	durableTokens := durableDRTokenManager{tokens: rawTokens, store: tokenStore}
	revocations := drRevocationStore{pool: db, repo: repo}
	crlCache := pki.NewCRLCache(revocations, drCfg.MTLSCRLRefresh, logger)
	go func() {
		if err := crlCache.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("dr mTLS CRL cache stopped")
		}
	}()

	var (
		vaultClient vault.Client
		dekMgr      siemcrypto.DEKManager
	)
	pkiBackend := pki.VaultPKI(noopDRVaultPKI{})
	if drCfg.VaultAddr != "" {
		vc, err := vault.NewClient(ctx, vault.Config{
			Addr:            drCfg.VaultAddr,
			AuthMethod:      drCfg.VaultAuthMethod,
			Token:           drCfg.VaultToken,
			AppRoleRoleID:   drCfg.VaultAppRoleRoleID,
			AppRoleSecretID: drCfg.VaultAppRoleSecretID,
			TransitPath:     drCfg.VaultTransitPath,
			Namespace:       drCfg.VaultNamespace,
			Environment:     envOr("ENVIRONMENT", "development"),
		})
		if err != nil {
			logger.Warn().Err(err).Msg("dr agent plane: Vault unavailable; enrollment exchange and mTLS ingest will fail closed")
		} else {
			vaultClient = vc
			pkiBackend = drVaultPKIAdapter{vc: vc}
			var derr error
			dekMgr, derr = siemcrypto.NewDEKManager(siemcrypto.DEKManagerConfig{
				TransitKeyForTenant: func(tenantID uuid.UUID) string {
					return "dr-tenant-" + tenantID.String()
				},
			}, siemcrypto.DEKManagerDeps{
				Pool:    db,
				Transit: siemcrypto.NewTransit(vc),
			})
			if derr != nil {
				logger.Warn().Err(derr).Msg("dr agent plane: ingest DEK manager unavailable; mTLS ingest will not start")
			}
		}
	} else {
		logger.Warn().Msg("dr agent plane: DR_VAULT_ADDR unset; enrollment exchange and mTLS ingest will fail closed")
	}

	pkiMgr := pki.New(pkiBackend, pki.Config{
		RootMount:           envOr("DR_PKI_ROOT_MOUNT", "pki-dr-root"),
		IntermediatePrefix:  envOr("DR_PKI_INTERMEDIATE_PREFIX", "pki-dr-intermediate-"),
		LeafTTL:             durationEnv("DR_AGENT_CERT_TTL", 365*24*time.Hour),
		IntermediateTTL:     durationEnv("DR_AGENT_INTERMEDIATE_TTL", 5*365*24*time.Hour),
		RoleName:            envOr("DR_PKI_ROLE_NAME", "dr-agent-leaf"),
		DefaultDomainSuffix: envOr("DR_AGENT_CERT_DOMAIN_SUFFIX", "agents.dr.clario360.local"),
	}, logger)

	sourceAdapter := drenroll.NewSourceAdapter(agents, nil, nil)
	exchangeSvc := siemenroll.New(
		rawTokens,
		sourceAdapter,
		tokenStore,
		revocations,
		pkiMgr,
		crlCache,
		noopDREnrollEmitter{},
		durationEnv("DR_AGENT_CERT_ROTATION_OVERLAP", 5*time.Minute),
		logger,
	)
	enrollSvc := drenroll.NewService(durableTokens, durableTokens, exchangeSvc, agents, drenroll.Config{
		Issuer:     drenroll.DefaultIssuer,
		Audience:   drenroll.DefaultAudience,
		DefaultTTL: durationEnv("DR_ENROLL_TOKEN_TTL", 15*time.Minute),
		MaxTTL:     durationEnv("DR_ENROLL_TOKEN_MAX_TTL", time.Hour),
		Logger:     logger,
	})
	enrollHandler := drenroll.NewHandler(enrollSvc, logger)

	startedMTLS := false
	if reason := mtlsIngestBlockedReason(drCfg, dekMgr != nil); reason != "" {
		logger.Warn().Str("reason", reason).Msg("dr mTLS ingest listener not started")
	} else {
		ingestHandler := dringest.NewHandler(dringest.Dependencies{
			AgentLookup: agents,
			CRL:         crlCache,
			DEKProvider: drTransportDEKProvider{mgr: dekMgr},
			Appliers:    drFrameApplierFactory{repo: repo, db: db, observers: frameObservers},
			Checkpoints: drCheckpointFactory{repo: repo, db: db},
			Authorizer:  drStreamAuthorizer{repo: repo, db: db},
			Logger:      logger,
		})
		listener := dringest.NewListener(dringest.ListenerConfig{
			Addr:           drCfg.MTLSListenAddr,
			CABundlePath:   drCfg.MTLSCABundlePath,
			ServerCertPath: drCfg.MTLSServerCertPath,
			ServerKeyPath:  drCfg.MTLSServerKeyPath,
			ReadTimeout:    durationEnv("DR_MTLS_READ_TIMEOUT", 30*time.Second),
			WriteTimeout:   durationEnv("DR_MTLS_WRITE_TIMEOUT", 30*time.Second),
		}, ingestHandler.Routes(), logger)
		startedMTLS = true
		go func() {
			if err := listener.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Error().Err(err).Msg("dr mTLS ingest listener stopped")
			}
		}()
	}

	logger.Info().Bool("mtls_started", startedMTLS).Msg("dr agent enrollment/ingest plane wired")
	return enrollHandler, func() {
		if dekMgr != nil {
			if err := dekMgr.Close(); err != nil {
				logger.Warn().Err(err).Msg("failed to close DR ingest DEK manager")
			}
		}
		if vaultClient != nil {
			if err := vaultClient.Close(); err != nil {
				logger.Warn().Err(err).Msg("failed to close DR agent Vault client")
			}
		}
	}
}

func mtlsIngestBlockedReason(drCfg *drconfig.Config, dekReady bool) string {
	if drCfg == nil {
		return "DR config is not loaded"
	}
	if reason := disabledFeatureFlagReason("DR_MTLS_INGEST_ENABLED"); reason != "" {
		return reason
	}
	if drCfg.MTLSCABundlePath == "" || drCfg.MTLSServerCertPath == "" || drCfg.MTLSServerKeyPath == "" {
		return "DR_MTLS_CA_BUNDLE_PATH, DR_MTLS_SERVER_CERT_PATH, and DR_MTLS_SERVER_KEY_PATH are required"
	}
	if !dekReady {
		return "ingest DEK manager is unavailable"
	}
	return ""
}

func startRPOMonitor(ctx context.Context, db *pgxpool.Pool, redisClient *redis.Client, repo *drrepo.Repository, drMetrics *drmetrics.Metrics, logger zerolog.Logger) {
	interval := durationEnv("DR_RPO_MONITOR_INTERVAL", 30*time.Second)
	monitor := drrpo.NewMonitor(db, repo, drrpo.OutboxSink{}, drrpo.Config{
		TxRunner: drrpo.PGXTxRunner{Pool: db},
		Metrics:  drMetrics,
	})

	if redisClient == nil {
		logger.Warn().Dur("interval", interval).Msg("dr rpo monitor: Redis unavailable, running without leader election")
		go runRPOMonitorLoop(ctx, monitor, interval, logger)
		return
	}

	instanceID := envOr("DR_RPO_MONITOR_INSTANCE_ID", "")
	if instanceID == "" {
		hostname, err := os.Hostname()
		if err != nil || hostname == "" {
			hostname = "clario-dr-service"
		}
		instanceID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}
	ttl := durationEnv("DR_RPO_MONITOR_LEADER_TTL", 30*time.Second)
	renew := durationEnv("DR_RPO_MONITOR_LEADER_RENEW", 10*time.Second)
	elector := leadership.NewRedisElection(redisClient, "dr-rpo-monitor", instanceID, ttl, renew, &logger)

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
				logger.Info().Str("instance", instanceID).Dur("interval", interval).Msg("dr rpo monitor: acquired leadership")
				go runRPOMonitorLoop(leaderCtx, monitor, interval, logger)
			},
			OnLose: func() {
				mu.Lock()
				if stopLeader != nil {
					stopLeader()
					stopLeader = nil
				}
				mu.Unlock()
				logger.Warn().Str("instance", instanceID).Msg("dr rpo monitor: lost leadership")
			},
		})
		mu.Lock()
		if stopLeader != nil {
			stopLeader()
			stopLeader = nil
		}
		mu.Unlock()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("dr rpo monitor leadership loop stopped")
		}
	}()
}

func runRPOMonitorLoop(ctx context.Context, monitor *drrpo.Monitor, interval time.Duration, logger zerolog.Logger) {
	run := func() {
		result, err := monitor.RunOnce(ctx)
		if err != nil {
			logger.Error().Err(err).Msg("dr rpo monitor scan failed")
			return
		}
		logger.Info().
			Int("checked", result.Checked).
			Int("breached", result.Breached).
			Int("recovered", result.Recovered).
			Int("unchanged", result.Unchanged).
			Msg("dr rpo monitor scan completed")
	}
	run()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

// startFailoverDriver wires the gated failover/drill state machine (§6) and runs
// its claim loop as a leader-singleton, mirroring startRPOMonitor. The Driver is
// constructed with the REAL collaborators — no fakes in production wiring:
//
//   - Executor:  drservice.RecoveryExecutor — boots the consistency group in
//     boot order, restores+decrypts the pinned recovery point's sealed chunks
//     from WORM, applies the network-mapping profile (production|isolated), and
//     provisions each member via a pluggable RecoveryTargetDriver. Idempotent on
//     re-claim; rolls back partial boots on failure.
//   - Health:    drservice.WorkloadHealthValidator — runs each member's REAL
//     health probe (http/tcp/sql/k8s_ready) until green or a deadline trips.
//   - Attester:  drattest.Builder — computes RTO objective-vs-actual,
//     achieved RPO, validation ratio, and the step timeline from the real rows,
//     then seals an NCA-ready report immutably to the WORM bucket.
//
// The WORM store is required for the executor (restore) and attester (seal); if
// it is not configured the driver is not started (the API still serves; a real
// failover needs the sealed recovery points).
func startFailoverDriver(ctx context.Context, db *pgxpool.Pool, redisClient *redis.Client, repo *drrepo.Repository, drSvc *drservice.Service, instantRecovery drservice.InstantRecoveryService, cleanroomScanner cleanroomSyncScanner, ingestDrillResult func(context.Context, *model.FailoverRun), bootTiers drservice.BootTierSource, wormClient *drworm.Client, drCfg *drconfig.Config, drMetrics *drmetrics.Metrics, logger zerolog.Logger) {
	if reason := failoverDriverBlockedReason(drCfg, wormClient != nil); reason != "" {
		logger.Warn().Str("reason", reason).Msg("dr failover driver not started")
		return
	}

	systemRunner := drservice.NewPGXSystemRunner(db)

	targetDriver := buildRecoveryTargetDriver(drCfg, logger)
	healthProber := drservice.NewHealthProber()
	executor := drservice.NewRecoveryExecutor(repo, systemRunner, drSvc, targetDriver)
	if instantRecovery != nil {
		executor.WithInstantRecovery(instantRecovery)
	}
	// Dependency-aware boot: when a group's bootgraph DAG links every recovery
	// target to a boot service, boot in dependency tiers with a health-gate barrier
	// (the workload prober) instead of the flat boot_order; otherwise fall back.
	if bootTiers == nil {
		bootTiers = newBootgraphTierSource()
	}
	executor.WithBootTiers(bootTiers, healthProber)
	healthDeadline := durationEnv("DR_HEALTH_PROBE_DEADLINE", 2*time.Minute)
	health := drservice.NewWorkloadHealthValidator(repo, systemRunner, healthProber, healthDeadline).
		WithAppVerification(drservice.NewRecoveryTargetAppPlanner(), nil)
	attester, err := drattest.NewBuilder(drattest.Config{
		Repository: repo,
		Runner:     systemRunner,
		Sealer:     drattest.WORMReportSealer{Client: wormClient},
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct attestation builder")
	}

	// Gate-1 validator: re-derive the recovery point to pin. The driver pins the
	// run's recovery point and only advances when its validation ratio meets the
	// GA threshold. drservice.DriverGateValidator reads the pinned/latest
	// validated point for the run's group.
	gateValidator := newTopologyAwareGateValidator(failover.NewDriverGateValidator(repo, systemRunner), systemRunner, topology.NewStore())

	driver, err := failover.New(failover.Config{
		Repository:  repo,
		FinalSyncer: drservice.NewFailoverFinalSyncerWithCleanroom(drSvc, cleanroomScanner),
		Validator:   gateValidator,
		Executor:    executor,
		Health:      health,
		Attester:    attester,
		Events:      failover.OutboxSink{},
		Metrics:     drMetrics,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct failover driver")
	}

	loop, err := failover.NewLoop(failover.LoopConfig{
		Pool:     db,
		Claimer:  repo,
		Driver:   driver,
		Logger:   logger,
		Interval: durationEnv("DR_FAILOVER_DRIVER_INTERVAL", 2*time.Second),
		OnComplete: func(hookCtx context.Context, run *model.FailoverRun) {
			// Drill teardown (WP-11): discard the isolated environment once the
			// attestation has committed. A real failover is a no-op here.
			if err := executor.TeardownDrill(hookCtx, run); err != nil {
				logger.Error().Err(err).Str("run_id", run.ID).Msg("drill teardown failed")
			}
			// Scheduled-drill trend ingestion is best-effort and runs after the
			// failover transaction commits, using the sealed attestation and step
			// timeline as the authoritative result.
			if ingestDrillResult != nil {
				ingestDrillResult(hookCtx, run)
			}
			// The run's sealed attestation is appended to the tamper-evident
			// attestation ledger by the sovereign plane's leader-singleton reconcile
			// consumer (it subscribes to datastream.dr.attestation.issued), not from
			// this in-process hook, so the append happens exactly once across nodes.
		},
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct failover driver loop")
	}

	if redisClient == nil {
		if envOr("DR_FAILOVER_DRIVER_UNSAFE_SINGLE_NODE", "") != "true" {
			logger.Error().Msg("dr failover driver not started: Redis leadership is unavailable; set DR_FAILOVER_DRIVER_UNSAFE_SINGLE_NODE=true only for single-node development")
			return
		}
		logger.Warn().Msg("dr failover driver: Redis unavailable, running in explicit unsafe single-node mode")
		go loop.Run(ctx)
		return
	}

	instanceID := envOr("DR_FAILOVER_DRIVER_INSTANCE_ID", "")
	if instanceID == "" {
		hostname, err := os.Hostname()
		if err != nil || hostname == "" {
			hostname = "clario-dr-service"
		}
		instanceID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}
	ttl := durationEnv("DR_FAILOVER_DRIVER_LEADER_TTL", 30*time.Second)
	renew := durationEnv("DR_FAILOVER_DRIVER_LEADER_RENEW", 10*time.Second)
	elector := leadership.NewRedisElection(redisClient, "dr-failover-driver", instanceID, ttl, renew, &logger)

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
				logger.Info().Str("instance", instanceID).Msg("dr failover driver: acquired leadership")
				go loop.Run(leaderCtx)
			},
			OnLose: func() {
				mu.Lock()
				if stopLeader != nil {
					stopLeader()
					stopLeader = nil
				}
				mu.Unlock()
				logger.Warn().Str("instance", instanceID).Msg("dr failover driver: lost leadership")
			},
		})
		mu.Lock()
		if stopLeader != nil {
			stopLeader()
			stopLeader = nil
		}
		mu.Unlock()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("dr failover driver leadership loop stopped")
		}
	}()
}

func failoverDriverBlockedReason(drCfg *drconfig.Config, recoveryStoreReady bool) string {
	if drCfg == nil {
		return "DR config is not loaded"
	}
	if reason := disabledFeatureFlagReason("DR_FAILOVER_DRIVER_ENABLED"); reason != "" {
		return reason
	}
	if !recoveryStoreReady {
		return "WORM recovery-point store is not configured (restore + attestation seal require it)"
	}
	return ""
}

func disabledFeatureFlagReason(key string) string {
	raw := os.Getenv(key)
	if raw == "" {
		return key + " is false"
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return fmt.Sprintf("%s has invalid value %q", key, raw)
	}
	if !enabled {
		return key + " is false"
	}
	return ""
}

func buildRecoveryTargetDriver(drCfg *drconfig.Config, logger zerolog.Logger) drservice.RecoveryTargetDriver {
	switch drCfg.RecoveryDriver {
	case "", "verify":
		env := envOr("ENVIRONMENT", "development")
		if (env == "production" || env == "prod") && envOr("DR_RECOVERY_ALLOW_VERIFY_IN_PRODUCTION", "") != "true" {
			logger.Fatal().Msg("DR_RECOVERY_DRIVER=verify is not allowed in production; configure DR_RECOVERY_DRIVER=command with ensure/teardown provisioner commands")
		}
		logger.Warn().Msg("dr recovery target driver using restore-verify mode; configure DR_RECOVERY_DRIVER=command for production workload provisioning")
		driver := drservice.NewRestoreVerifyDriver()
		validateRecoveryDriverCompatibility(driver, drCfg, logger)
		return driver
	case "command":
		driver, err := drservice.NewCommandRecoveryTargetDriver(drservice.CommandRecoveryTargetDriverConfig{
			EnsureCommand:   drCfg.RecoveryEnsureCommand,
			TeardownCommand: drCfg.RecoveryTeardownCommand,
			Timeout:         drCfg.RecoveryCommandTimeout,
		})
		if err != nil {
			logger.Fatal().Err(err).Msg("failed to configure command recovery target driver")
		}
		logger.Info().
			Str("ensure", drCfg.RecoveryEnsureCommand[0]).
			Str("teardown", drCfg.RecoveryTeardownCommand[0]).
			Dur("timeout", drCfg.RecoveryCommandTimeout).
			Msg("dr recovery target driver using external command provisioner")
		validateRecoveryDriverCompatibility(driver, drCfg, logger)
		return driver
	case "provider", drprovider.KindVSphere, drprovider.KindKubernetes, drprovider.KindCloud, drprovider.KindNetApp:
		providerCfg := drCfg.RecoveryProvider
		if drCfg.RecoveryDriver != "provider" {
			providerCfg.Kind = drCfg.RecoveryDriver
		}
		adapter, err := drprovider.NewRegistry().Build(providerCfg)
		if err != nil {
			logger.Fatal().Err(err).Str("provider", providerCfg.Kind).Msg("failed to configure recovery provider adapter")
		}
		if err := adapter.Validate(providerCfg); err != nil {
			logger.Fatal().Err(err).Str("provider", providerCfg.Kind).Msg("recovery provider adapter is not configured")
		}
		driver, err := drservice.NewProviderRecoveryTargetDriver(adapter)
		if err != nil {
			logger.Fatal().Err(err).Str("provider", providerCfg.Kind).Msg("failed to configure recovery provider driver")
		}
		caps := driver.RecoveryCapabilities()
		logger.Info().
			Str("provider", caps.Kind).
			Bool("regulated_compatible", caps.RegulatedCompatible).
			Bool("sdk_backed", caps.SDKBacked).
			Msg("dr recovery target driver using provider adapter")
		validateRecoveryDriverCompatibility(driver, drCfg, logger)
		return driver
	default:
		logger.Fatal().Str("driver", drCfg.RecoveryDriver).Msg("unsupported DR_RECOVERY_DRIVER")
		return nil
	}
}

func validateRecoveryDriverCompatibility(driver drservice.RecoveryTargetDriver, drCfg *drconfig.Config, logger zerolog.Logger) {
	if drCfg == nil || !drCfg.Regulated() {
		return
	}
	if err := drservice.ValidateRecoveryDriverCompatibility(driver, true); err != nil {
		caps := drservice.RecoveryCapabilities(driver)
		logger.Fatal().Err(err).Str("driver", caps.Kind).Msg("recovery target driver is not compatible with regulated mode")
	}
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return fallback
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// intEnv parses a non-negative integer override from the environment, returning
// fallback when unset, empty, or unparseable. A zero override is returned as 0 so
// callers can pass it through to a package's own "<=0 => default" handling.
func intEnv(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return fallback
}

// envEnabled reports whether an environment variable is set to a truthy value
// ("1", "true", "yes", "on"; case-insensitive). Used to gate opt-in features.
func envEnabled(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
