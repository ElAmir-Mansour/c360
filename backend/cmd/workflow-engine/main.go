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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/aigovernance"
	"github.com/clario360/platform/internal/config"
	vcisollmcredential "github.com/clario360/platform/internal/cyber/vciso/llm/credential"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/leadership"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/observability"
	"github.com/clario360/platform/internal/server"

	wfcfg "github.com/clario360/platform/internal/workflow/config"
	"github.com/clario360/platform/internal/workflow/consumer"
	wfengine "github.com/clario360/platform/internal/workflow/engine"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/handler"
	"github.com/clario360/platform/internal/workflow/health"
	_ "github.com/clario360/platform/internal/workflow/metrics" // registers Prometheus metrics on import
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/payloadcrypto"
	"github.com/clario360/platform/internal/workflow/repository"
	"github.com/clario360/platform/internal/workflow/seed"
	"github.com/clario360/platform/internal/workflow/service"
)

func main() {
	// 1. Load platform config
	cfg, err := config.Load()
	if err != nil {
		panic("loading config: " + err.Error())
	}

	// Load workflow-specific config from env
	wfCfg := wfcfg.LoadFromEnv()
	if err := wfCfg.Validate(); err != nil {
		panic("invalid workflow config: " + err.Error())
	}
	cfg.Server.Port = wfCfg.HTTPPort

	// 2. Initialize structured logger
	logger := observability.NewLogger(
		cfg.Observability.LogLevel,
		cfg.Observability.LogFormat,
		"workflow-engine",
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 3. Initialize tracer
	shutdownTracer, err := observability.InitTracer(ctx, "workflow-engine", cfg.Observability.OTLPEndpoint)
	if err != nil {
		logger.Warn().Err(err).Msg("failed to initialize tracer")
	} else {
		defer shutdownTracer(ctx)
	}

	// 4. Connect PostgreSQL
	db, err := database.NewPostgresPool(ctx, cfg.Database, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer db.Close()

	// 5. Run schema migration via the central migrator. The workflow schema,
	// historically self-managed by repository.RunMigration (SchemaSQL), now
	// lives under migrations/workflow_db as a versioned, idempotent migration
	// (every statement uses IF NOT EXISTS, so applying it over an existing
	// deployed workflow DB is a safe no-op). DSN comes from the platform DB
	// config the service already connects with; the backend/-prefixed fallback
	// path mirrors cmd/license-service so the binary works from either the repo
	// root or the backend/ working directory.
	if err := runMigrations(cfg.Database.DSN()); err != nil {
		logger.Fatal().Err(err).Msg("failed to run workflow schema migration")
	}
	logger.Info().Msg("workflow schema migration completed")

	// 6. Connect Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr(),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn().Err(err).Msg("redis connection failed — continuing with degraded functionality")
	}

	// 7. Create HTTP server with middleware stack
	srv, err := server.New(cfg, db, rdb, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create server")
	}

	// 8. Event publishing via the transactional outbox: services stage events
	// in PostgreSQL and the relay delivers them to Kafka. Events survive
	// broker outages and service crashes; if Kafka is down at boot they
	// accumulate in the outbox until the relay can drain them.
	if err := outbox.EnsureSchema(ctx, db); err != nil {
		logger.Fatal().Err(err).Msg("failed to ensure event outbox schema")
	}
	producer := outbox.NewStaged(db)

	var relay *outbox.Relay
	kafkaProducer, err := events.NewProducer(cfg.Kafka, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka producer unavailable — events will accumulate in the outbox until the broker is reachable")
	} else {
		defer kafkaProducer.Close()
		relay = outbox.NewRelay(db, kafkaProducer, outbox.Config{}, logger,
			outbox.NewMetrics(prometheus.DefaultRegisterer))
	}

	// 9. Initialize repositories
	defRepo := repository.NewDefinitionRepository(db)
	instRepo := repository.NewInstanceRepository(db)
	// GOVERNANCE / PDPL: field-level payload encryption at rest for the sensitive
	// workflow JSONB (variables / step_outputs). OPT-IN via WF_PAYLOAD_ENCRYPTION_MODE
	// (default off == legacy plaintext). Reuses the platform field crypto
	// (internal/lex/crypto) — no new cipher. Fail-closed: a wiring error here aborts
	// startup rather than silently persisting plaintext when encryption was asked for.
	var payloadCodec *payloadcrypto.Codec
	if wfCfg.PayloadEncryptionEnabled() {
		codec, cerr := buildPayloadCodec(wfCfg)
		if cerr != nil {
			panic("wiring workflow payload encryption: " + cerr.Error())
		}
		payloadCodec = codec
		instRepo = instRepo.WithPayloadCodec(codec)
		logger.Info().
			Str("provider", codec.Provider()).
			Msg("workflow payload encryption at rest ENABLED (variables/step_outputs)")
	}
	taskRepo := repository.NewTaskRepository(db)
	// Same codec protects the classified fields in workflow_tasks.form_data (the
	// primary at-rest home of a submitted approval's content). Enabled by the same
	// WF_PAYLOAD_ENCRYPTION_MODE flag; nil == legacy plaintext.
	if payloadCodec != nil {
		taskRepo = taskRepo.WithPayloadCodec(payloadCodec)
		logger.Info().
			Str("provider", payloadCodec.Provider()).
			Msg("workflow payload encryption at rest ENABLED (task form_data)")
	}
	triggerExecRepo := repository.NewTriggerExecutionRepository(db)
	// Durable-execution: persisted at-most-once ledger for outbound activities.
	activityRepo := repository.NewActivityExecutionRepository(db)
	// GAP 4: incident / governed-override / dead-letter store. Retry exhaustion
	// raises a governed incident that parks the failed step instead of terminating
	// the whole instance.
	incidentRepo := repository.NewIncidentRepository(db)

	// PROCESS INTELLIGENCE: READ-ONLY analytics read model over the already-
	// persisted instance + step-execution event trail (cycle time / bottlenecks /
	// rework / throughput). No engine or state-model interaction — every query is
	// tenant-scoped (RLS) through the scopedPool. Reversible: without the mounted
	// /analytics routes below the engine behaves exactly as before.
	analyticsRepo := repository.NewWorkflowAnalyticsRepository(db)

	// PROCESS INTELLIGENCE (moat): READ-ONLY process-MINING read model over the
	// SAME persisted event trail + the model step graph. Variant discovery,
	// conformance checking, path-frequency heatmap, what-if simulation. NO engine
	// or state-model interaction; every query is tenant-scoped (RLS) through the
	// scopedPool. Reversible: without the mounted mining routes below the engine
	// behaves exactly as before.
	miningRepo := repository.NewWorkflowMiningRepository(db)

	// WP-3: forms adapter — by-ref form loader for the human-task executor and
	// the submission re-validator for task completion. Reads the canonical
	// forms.Store through tenant-scoped (RLS) transactions.
	formsAdapter := newFormsAdapter(db)

	// HUMAN-SCALE: out-of-office / substitute (deputy) engine. A task that WOULD be
	// assigned to a user who is out of office in the current window is auto-routed
	// to their active deputy (bounded, loop-detected chain). Reuses the SLA/calendar
	// store for the window timezone. Reversible: without SetSubstitutionResolver
	// (below) the human-task executor assigns tasks exactly as before.
	substitutionRepo := repository.NewSubstitutionRepository(db)
	substitutionSvc := service.NewSubstitutionService(substitutionRepo, logger).
		WithCalendarProvider(service.NewSLACalendarProvider(db))

	// 11. Initialize executor registry
	execRegistry := executor.NewExecutorRegistry()
	// The service-task executor is the only step type with an external (non-DB)
	// side effect, so it carries the idempotency ledger to guarantee at-most-once
	// outbound calls across recoveries and retries.
	serviceTaskExec := executor.NewServiceTaskExecutor(wfCfg.ServiceURLs, logger)
	serviceTaskExec.SetIdempotencyStore(activityRepo)
	execRegistry.Register(model.StepTypeServiceTask, serviceTaskExec)
	humanTaskExec := executor.NewHumanTaskExecutor(taskRepo, producer, logger)
	humanTaskExec.SetFormLoader(formsAdapter) // WP-3: enable the by-ref form path.
	// HUMAN-SCALE: consult the OOO/substitute registry so a task headed for an
	// out-of-office approver is re-routed to their deputy (emits reassigned_ooo).
	humanTaskExec.SetSubstitutionResolver(substitutionSvc.AsExecutorResolver())
	execRegistry.Register(model.StepTypeHumanTask, humanTaskExec)
	// WP-5: approval-chain executor (multi-approver, sequential/parallel, quorum).
	execRegistry.Register(model.StepTypeApprovalChain, executor.NewApprovalChainExecutor(taskRepo, producer, logger))
	execRegistry.Register(model.StepTypeEventTask, executor.NewEventTaskExecutor(producer, rdb, logger))
	execRegistry.Register(model.StepTypeCondition, executor.NewConditionExecutor())
	// DMN decision-table step (business rules). Pure/deterministic; evaluates a
	// decision table against instance data via the FEEL-subset evaluator and
	// writes the outputs into step output + variables for downstream routing.
	// Additive: no existing definition references decision_task.
	execRegistry.Register(model.StepTypeDecisionTask, executor.NewDecisionExecutor())
	execRegistry.Register(model.StepTypeTimer, executor.NewTimerTaskExecutor(rdb, taskRepo, logger))
	// EXTENSIBILITY: connector_task dispatches through the platform's integration
	// connector framework instead of raw net/http, so authored flows can invoke
	// governed connectors. It inherits the SAME governance as service_task — the
	// per-connector circuit breaker + bounded backoff (built into the executor) and
	// the Wave-1 at-most-once idempotency ledger (wired here) — and emits
	// workflow.connector.invoked/failed audit events (publisher wired here). The
	// actual secret-resolving, egress/SSRF-guarded connector call is delegated to a
	// ConnectorDispatcher over the integration registry, installed via
	// SetConnectorDispatcher by the integration wiring layer (which owns the
	// per-tenant endpoint repo + config decryption + secret-ref custody). Until a
	// dispatcher is wired the step FAILS CLOSED with a clear error rather than
	// calling out — so registering it is fully reversible and additive: no existing
	// definition references connector_task.
	connectorTaskExec := executor.NewConnectorTaskExecutor(logger)
	connectorTaskExec.SetIdempotencyStore(activityRepo)
	connectorTaskExec.SetEventPublisher(producer)
	execRegistry.Register(model.StepTypeConnectorTask, connectorTaskExec)
	// Parallel gateway (fork/join). It drives its branch sub-steps back through
	// this same registry and resolves their step IDs via a repository-backed
	// StepLookup over the active definitions. Registered last so the registry it
	// closes over already holds the leaf executors above.
	execRegistry.Register(model.StepTypeParallelGateway,
		executor.NewParallelGatewayExecutor(execRegistry, executor.RepositoryStepLookup(ctx, defRepo), logger))

	// BPMN COMPOSITION: call_activity (sub-process) + multi_instance (for-each).
	// Both start CHILD instances and park the parent on the EXISTING durable
	// park/resume engine. The child starter is the engine service itself
	// (wired below, after it is constructed). The multi_instance fan-in ledger
	// records one row per fan-out child so the parent resumes exactly once when
	// its completion policy is met. Additive: no existing definition references
	// these step types.
	miChildRepo := repository.NewMIChildRepository(db)

	// 12. Initialize services
	defSvc := service.NewDefinitionService(defRepo, logger)
	// GAP B: emit definition-lifecycle audit events (create/update/activate/archive)
	// to platform.workflow.events so the platform hash-chain audit subsystem records
	// them as tamper-evident entries. Reversible: without the publisher these
	// transitions only log (legacy behaviour).
	defSvc.WithAuditPublisher(producer)
	engineSvc := service.NewEngineService(instRepo, defRepo, taskRepo, execRegistry, producer, logger)
	// GAP 4: wire the incident store so retry exhaustion parks the failed step
	// under a governed incident (Camunda-incident pattern) instead of failing the
	// whole instance. Reversible: without it the engine keeps the legacy
	// fail-the-instance behaviour.
	engineSvc.WithIncidentStore(incidentRepo)
	// READ-MODEL BRIDGE (temporary): federate the admin instance list/detail READS
	// over suite databases that still hold embedded-engine instances (e.g. lex_db),
	// so the shared console surfaces them until suites consolidate onto this store
	// (see docs/workflow-instance-visibility.md). Read-only, off unless
	// WF_FEDERATED_DB_URLS is set, and NEVER touches the write/execution paths — it
	// wraps only the instance READER the admin InstanceHandler uses.
	instReader := repository.NewFederatedInstanceReader(instRepo, logger)
	instDefReader := repository.NewFederatedDefinitionReader(defRepo)
	// Task-side companion: federate the user-visible task READ paths (task list /
	// my-queues / counts) over the same suite databases, so a human task a suite's
	// embedded engine writes to its OWN database — e.g. a Lex settlement-approval
	// task written to lex_db — is surfaced through the shared engine's task list
	// even though the engine primary store is a different database. Read-only and
	// off unless WF_FEDERATED_DB_URLS is set; the primary task store still owns
	// every task write/lifecycle path (this wraps only the task READER the task
	// service uses).
	taskReader := repository.NewFederatedTaskReader(taskRepo, logger)
	for _, dsn := range wfCfg.FederatedReadDBURLs {
		fpool, ferr := pgxpool.New(ctx, dsn)
		if ferr != nil {
			logger.Warn().Err(ferr).Msg("federated read pool unavailable; skipping source")
			continue
		}
		defer fpool.Close()
		instReader.AddSource(repository.NewInstanceRepository(fpool))
		instDefReader.AddSource(repository.NewDefinitionRepository(fpool))
		taskReader.AddSource(repository.NewTaskRepository(fpool))
	}
	if n := len(wfCfg.FederatedReadDBURLs); n > 0 {
		logger.Info().Int("sources", n).Msg("workflow admin reads federated over suite database(s)")
	}
	// BPMN COMPOSITION: wire the multi_instance fan-in ledger, then register the
	// call_activity + multi_instance executors with the engine as their child
	// starter. Registered here (after the engine exists) because both step types
	// start CHILD instances through the engine. The definition repo already
	// satisfies the engine's child-definition resolver (GetActiveByDefinitionKey),
	// discovered at construction. Reversible: without these registrations the two
	// step types are simply unavailable and every existing definition is unchanged.
	engineSvc.WithCompositionStores(miChildRepo)
	execRegistry.Register(model.StepTypeCallActivity,
		executor.NewCallActivityExecutor(engineSvc, logger))
	execRegistry.Register(model.StepTypeMultiInstance,
		executor.NewMultiInstanceExecutor(engineSvc, execRegistry, executor.RepositoryStepLookup(ctx, defRepo), logger))
	// The task service reads through the FederatedTaskReader (suite-database task
	// visibility); its writes/lifecycle still target the primary task store. With no
	// WF_FEDERATED_DB_URLS sources the reader behaves exactly like taskRepo.
	taskSvc := service.NewTaskService(taskReader, engineSvc, logger)
	taskSvc.SetFormValidator(formsAdapter) // WP-3: re-validate by-ref submissions on complete.
	// PROCESS INTELLIGENCE: read-only analytics aggregator over the read model.
	analyticsSvc := service.NewAnalyticsService(analyticsRepo, logger)
	// PROCESS INTELLIGENCE (moat): read-only process-mining aggregator/estimator
	// (variant discovery / conformance / heatmap / what-if simulation).
	miningSvc := service.NewMiningService(miningRepo, logger)
	// GAP B: emit task-lifecycle audit events (claim/complete/reject/delegate) to
	// the hash-chain audit subsystem via platform.workflow.events.
	taskSvc.WithAuditPublisher(producer)
	templateSvc := service.NewTemplateService(defRepo, logger)
	// WS-1: attach the data-driven template catalog so templates are loaded from
	// workflow_db.workflow_templates first (global + per-tenant), falling back to
	// the in-process built-ins. See internal/workflow/seed for the legal pack.
	templateRepo := repository.NewTemplateRepository(db)
	templateSvc.SetCatalogRepository(templateRepo)
	// WS-1: seed the embedded legal template pack (~76 templates) into the GLOBAL
	// catalog on boot so ListTemplates actually serves them. Idempotent (Upsert by
	// id), so it self-heals on every start and across deploys.
	if legalTmpls, lerr := seed.LegalTemplates(); lerr != nil {
		logger.Error().Err(lerr).Msg("loading embedded legal template pack")
	} else {
		seeded := 0
		for _, t := range legalTmpls {
			if uerr := templateRepo.Upsert(ctx, t); uerr != nil {
				logger.Error().Err(uerr).Str("template_id", t.ID).Msg("seeding global legal template")
				continue
			}
			seeded++
		}
		logger.Info().Int("count", seeded).Msg("seeded global legal template catalog")
	}

	// PHASE 5 (moat) — governed template/connector MARKETPLACE. Layers
	// publish -> review (four-eyes distinct-approver, fail-closed) -> install
	// (instantiate a template definition with provenance / register a connector)
	// on top of the data-driven template catalog. Additive: it reuses the
	// template instantiation path (InstantiateFromPayload), stamps provenance on
	// the definition (StampMarketplaceProvenance), and emits
	// marketplace.item.published/reviewed/installed to platform.workflow.events
	// (hash-chain audit). Reversible: without the marketplace routes mounted the
	// engine behaves exactly as before, and every existing definition is untouched.
	marketplaceRepo := repository.NewMarketplaceRepository(db)
	marketplaceSvc := service.NewMarketplaceService(service.NewMarketplaceRepoAdapter(marketplaceRepo), logger).
		WithTemplateInstantiator(templateSvc).
		WithProvenanceStamper(defRepo).
		WithAuditPublisher(producer)
	// Seed the embedded legal/DR packs as GLOBAL, four-eyes-reviewed marketplace
	// items so the gallery is populated + installable on day one (the sovereign
	// vertical moat). Idempotent (publish upserts on (kind,key,version)), so it
	// self-heals on every boot and across deploys.
	if n, merr := marketplaceSvc.SeedGlobalTemplates(ctx); merr != nil {
		logger.Error().Err(merr).Msg("seeding global marketplace gallery")
	} else {
		logger.Info().Int("count", n).Msg("seeded global marketplace gallery")
	}

	schedulerSvc := service.NewSchedulerService(rdb, taskRepo, engineSvc, producer, logger,
		wfCfg.TimerPollIntervalSec, wfCfg.SLACheckIntervalSec)
	// CONTROL-FLOW (Phase 5): interrupting boundary events + event-based gateway.
	// The scheduler is the durable BoundaryRegistrar — it arms/cancels boundary
	// timers on the SAME Redis sorted set as timer steps, and boundary message
	// waits on the SAME event-wait keys as event_task WAIT. Wiring it on the engine
	// lets a parked step's timer/message boundaries INTERRUPT it, and lets an
	// event-based gateway race its arms to a single winner. The gateway executor is
	// registered with the scheduler as its registrar. Reversible/additive: no
	// existing definition carries boundary_events or uses event_based_gateway, so
	// this changes nothing for existing workflows; the timer poller + event-wait
	// consumer route boundary fires to engineSvc.FireBoundaryEvent (interrupt +
	// route) and everything else advances exactly as before.
	engineSvc.SetBoundaryRegistrar(schedulerSvc)
	execRegistry.Register(model.StepTypeEventGateway,
		executor.NewEventGatewayExecutor(schedulerSvc, rdb, logger))
	recoverySvc := service.NewRecoveryService(instRepo, defRepo, taskRepo, rdb, engineSvc, logger,
		wfCfg.InstanceRecoveryBatch)
	triggerConsumer := consumer.NewTriggerConsumer(defRepo, engineSvc, rdb, logger, triggerExecRepo)

	// WAVE-2 durability nit: stale-pending idempotency reconciler. A crash between
	// a service-task's ledger Claim (row 'pending') and its Mark* leaves a pending
	// row that can never replay (the executor refuses to re-fire an in-flight
	// claim), stalling the step. This background sweep expires such rows past a
	// configurable age so the engine's retry path re-drives them or escalates to a
	// governed incident. Runs as a leader singleton (below).
	activityReconciler := service.NewActivityReconciler(service.ActivityReconcilerConfig{
		Store:  activityRepo,
		Logger: logger,
	})

	// WP-4: promotion service (dev→staging→prod FSM + immutability guard). The
	// guard is installed on the definition service so Update/Archive reject edits
	// to a promoted (immutable) version with 409 Conflict before any work.
	promoStore := repository.NewPromotionRepository()
	promoSvc := service.NewPromotionService(promoStore, service.NewPoolTxRunner(db), logger)
	// GAP C: gate staging→prod promotion behind a distinct second approver. Opt-in
	// and reversible via WORKFLOW_REQUIRE_PROD_APPROVAL (default OFF preserves the
	// single-transition behaviour); when ON, a staging→prod promote without a
	// distinct approver is rejected with 409/403. Regardless of the gate, the real
	// acting user is now stamped as promoted_by (was hardcoded "").
	if os.Getenv("WORKFLOW_REQUIRE_PROD_APPROVAL") == "true" {
		promoSvc.WithProdApprovalGate(true)
		logger.Info().Msg("staging→prod promotion approval gate ENABLED")
	}
	defSvc.SetImmutableGuard(promoSvc)

	// WP-5 INTEGRATE: tiered SLA. Wire the DB-backed SLAPolicyResolver into the
	// scheduler seam so the tiered escalation path is LIVE — for an overdue task
	// it loads the applicable policy + tenant business calendar from
	// workflow_sla_policies / workflow_calendars (RLS, via RunReadWithTenant) and
	// EvaluateSLA acts on the due tiers. Tasks with no configured policy still use
	// the original single-tier breach behavior (resolver returns ok=false).
	slaSvc := service.NewSLAService(db, logger)
	slaResolver := service.NewDBSLAPolicyResolver(db, logger)
	schedulerSvc.SetSLAPolicyResolver(slaResolver)

	// 13. Initialize handlers
	defHandler := handler.NewDefinitionHandler(defSvc, logger)
	defHandler.SetTemplateService(templateSvc)
	defHandler.SetPromotionService(newPromotionHandlerAdapter(promoSvc))                       // WP-4: /promote, /lineage.
	defHandler.SetSimulator(newSimulationHandlerAdapter(wfengine.NewSimulationOrchestrator())) // WP-6: /simulate.
	instHandler := handler.NewInstanceHandler(engineSvc, instReader, instDefReader, logger)
	incidentHandler := handler.NewIncidentHandler(engineSvc, logger) // GAP 4: operator intervention.
	// VERSIONING/LIFECYCLE: in-flight instance migration. Migrates a running /
	// suspended / incident instance from its pinned definition version to a target
	// version (single + bulk), with compatibility validation + step/variable remap,
	// atomic commit under the per-instance serialization, and a
	// workflow.instance.migrated audit event. The service discovers the instance
	// repo's SerializeInstance and the definition repo's runtime-active resolver via
	// type-assertion seams. Reversible/additive: no existing instance is touched
	// until an admin explicitly migrates it.
	migrationSvc := service.NewInstanceMigrationService(instRepo, defRepo, producer, logger)
	migrationHandler := handler.NewMigrationHandler(migrationSvc, logger)
	taskHandler := handler.NewTaskHandler(taskSvc, instRepo, defRepo, logger)
	templateHandler := handler.NewTemplateHandler(templateSvc, logger)
	// PHASE 5 (moat): governed marketplace gallery + lifecycle handler.
	marketplaceHandler := handler.NewMarketplaceHandler(marketplaceSvc, logger)
	triggerExecHandler := handler.NewTriggerExecutionHandler(triggerExecRepo, triggerConsumer, logger)
	slaHandler := handler.NewSLAHandler(slaSvc, slaSvc, logger) // WP-5: SLA policy + calendar CRUD.
	formHandler := handler.NewFormHandler(service.NewFormService(db), logger)
	// HUMAN-SCALE: out-of-office / substitute (deputy) registry endpoints.
	substitutionHandler := handler.NewSubstitutionHandler(substitutionSvc, logger)
	// PROCESS INTELLIGENCE: read-only analytics handler (cycle time / bottlenecks
	// / rework / throughput). All GET, gated on workflow:read (analyticsRBAC).
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc, logger)
	// PROCESS INTELLIGENCE (moat): read-only process-mining handler
	// (variants / conformance / map / simulate). GET + one estimate-only POST,
	// gated on workflow:read (analyticsRBAC). Registered onto the SAME /analytics
	// router as analyticsHandler so the {definitionKey} wildcard is shared.
	miningHandler := handler.NewMiningHandler(miningSvc, logger)

	// 14. Initialize health checker
	healthChecker := health.NewChecker(db, rdb, logger)

	// Override health endpoints
	srv.Router.Get("/healthz", healthChecker.LivenessHandler())
	srv.Router.Get("/readyz", healthChecker.ReadinessHandler())
	srv.Router.Handle("/metrics", promhttp.Handler())

	// Per-tenant LLM credential management (SaaS). Bound to the SHARED
	// platform_core pool (NOT workflow_db) so a tenant configures ONE LLM key that
	// every suite resolves; the credential + DEK-envelope tables live in
	// platform_core (migration 000017). workflow-engine hosts the management API
	// only — it constructs no LLM provider Manager, so it does not itself resolve
	// keys for inference. Nil-safe: if platform_core or Vault is unavailable the
	// management endpoint is simply not mounted.
	credDSN := os.Getenv("PLATFORM_CORE_DB_URL")
	if credDSN == "" {
		credDSN = aigovernance.BuildPlatformCoreDSN(cfg.Database)
	}
	var credPool *pgxpool.Pool
	if pcfg, perr := pgxpool.ParseConfig(credDSN); perr != nil {
		logger.Warn().Err(perr).Msg("platform_core pool unavailable for llm credentials; management endpoint disabled")
	} else if pool, oerr := pgxpool.NewWithConfig(ctx, pcfg); oerr != nil {
		logger.Warn().Err(oerr).Msg("platform_core pool unavailable for llm credentials; management endpoint disabled")
	} else if pingErr := pool.Ping(ctx); pingErr != nil {
		logger.Warn().Err(pingErr).Msg("platform_core pool unavailable for llm credentials; management endpoint disabled")
		pool.Close()
	} else {
		credPool = pool
	}
	if credPool != nil {
		defer credPool.Close()
		credSvc, credCleanup, credErr := vcisollmcredential.BuildResolver(ctx, credPool, nil, logger)
		if credErr != nil {
			logger.Error().Err(credErr).Msg("llm credential resolver unavailable")
		} else if credSvc != nil {
			if credCleanup != nil {
				defer credCleanup()
			}
			credHandler := vcisollmcredential.NewHandler(credSvc, logger)
			srv.Router.Route("/api/v1/llm-credentials", func(r chi.Router) {
				r.Use(middleware.Auth(srv.JWTManager))
				r.Use(middleware.Tenant)
				r.Get("/", credHandler.GetStatus)
				r.Put("/", credHandler.Set)
				r.Post("/rotate", credHandler.Rotate)
				r.Delete("/", credHandler.Delete)
			})
			logger.Info().Msg("per-tenant LLM credential management mounted at /api/v1/llm-credentials (platform_core-backed)")
		} else {
			logger.Info().Msg("vault not configured; per-tenant llm credential management disabled (env-only)")
		}
	}

	// 15. Register API routes. Auth + Tenant gate the whole surface; each group
	// additionally carries a per-action RBAC classifier (see rbac.go) that maps
	// the request's method + action to the required workflow:* permission and
	// delegates to middleware.RequirePermission. Core reads (definitions /
	// instances / tasks / templates) and assignee task actions (claim / unclaim /
	// complete) are an authenticated baseline — any tenant user, no workflow:*
	// grant (the task service enforces assignee/candidate eligibility);
	// authoring/clone/instance control -> workflow:write; definition lifecycle
	// (activate/publish/archive/delete/promote) -> workflow:admin.
	srv.Router.Route("/api/v1/workflows", func(r chi.Router) {
		r.Use(middleware.Auth(srv.JWTManager))
		r.Use(middleware.Tenant)

		r.Route("/definitions", func(r chi.Router) {
			r.Use(definitionRBAC)
			r.Mount("/", defHandler.Routes())
		})

		r.Route("/instances", func(r chi.Router) {
			r.Use(instanceRBAC)
			r.Mount("/", instHandler.Routes())
		})

		// GAP 4: governed operator intervention on workflow incidents (retry /
		// skip / modify-retry / abandon + maker-checker overrides + dead-letter).
		// GET -> workflow:read, POST -> workflow:incident (see incidentRBAC).
		r.Route("/incidents", func(r chi.Router) {
			r.Use(incidentRBAC)
			r.Mount("/", incidentHandler.Routes())
		})

		// VERSIONING/LIFECYCLE: in-flight instance version migration (single +
		// bulk). Every route is a POST gated on workflow:admin (see migrationRBAC):
		// re-pinning running work across definition versions is a governance action.
		r.Route("/migrations", func(r chi.Router) {
			r.Use(migrationRBAC)
			r.Mount("/", migrationHandler.Routes())
		})

		r.Route("/tasks", func(r chi.Router) {
			r.Use(taskRBAC)
			r.Mount("/", taskHandler.Routes())
		})

		r.Route("/templates", func(r chi.Router) {
			r.Use(templateRBAC)
			r.Mount("/", templateHandler.Routes())
		})

		// PHASE 5 (moat): governed template/connector marketplace. browse -> read,
		// publish/install -> write, review (four-eyes gate) -> admin (marketplaceRBAC).
		r.Route("/marketplace", func(r chi.Router) {
			r.Use(marketplaceRBAC)
			r.Mount("/", marketplaceHandler.Routes())
		})

		r.Route("/trigger-executions", func(r chi.Router) {
			r.Use(triggerExecutionRBAC)
			r.Mount("/", triggerExecHandler.Routes())
		})

		// WP-5: tiered SLA policy + business calendar authoring. read -> view,
		// write -> author (slaRBAC).
		r.Route("/sla-policies", func(r chi.Router) {
			r.Use(slaRBAC)
			r.Mount("/", slaHandler.PolicyRoutes())
		})

		r.Route("/calendars", func(r chi.Router) {
			r.Use(slaRBAC)
			r.Mount("/", slaHandler.CalendarRoutes())
		})

		r.Route("/forms", func(r chi.Router) {
			r.Use(formsRBAC)
			r.Mount("/", formHandler.Routes())
		})

		// HUMAN-SCALE: out-of-office / substitute (deputy) registry. A user sets a
		// deputy for a date window; the human-task assignment path re-routes tasks
		// away from out-of-office approvers. read -> view, write -> set/clear.
		r.Route("/substitutions", func(r chi.Router) {
			r.Use(substitutionRBAC)
			r.Mount("/", substitutionHandler.Routes())
		})

		// PROCESS INTELLIGENCE: read-only analytics (cycle time / bottlenecks /
		// rework / throughput) mined from the persisted event trail. All GET,
		// gated on workflow:read (analyticsRBAC). No engine/state-model change.
		r.Route("/analytics", func(r chi.Router) {
			r.Use(analyticsRBAC)
			r.Mount("/", analyticsHandler.Routes())
			// PROCESS INTELLIGENCE (moat): process-mining routes registered onto
			// the SAME router so /{definitionKey}/{variants,conformance,map} and
			// POST /{definitionKey}/simulate share the wildcard segment with
			// /{definitionKey}/cycle-time. All read-only (the simulate POST is an
			// estimate); gated on workflow:read by analyticsRBAC.
			miningHandler.RegisterRoutes(r)
		})
	})

	// D-9 execution seam: construct the FSMOrchestrator over the existing engine
	// and instance repository. It is a thin, behavior-preserving adapter (it
	// owns no traversal logic — Start/Advance/Signal delegate to engineSvc) that
	// freezes the swap boundary for a future BPMN core. Building it here proves
	// the wiring compiles against the real dependencies; current request flow is
	// unchanged (handlers still call engineSvc directly).
	orchestrator, err := wfengine.NewFSMOrchestrator(engineSvc, instRepo)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct FSM orchestrator")
	}
	var _ wfengine.Orchestrator = orchestrator
	logger.Info().Msg("workflow FSM orchestrator initialized (D-9 execution seam)")

	// 16. Initialize Kafka consumers
	eventWaitConsumer := consumer.NewEventWaitConsumer(rdb, engineSvc, logger)

	// WP-7: cron-trigger scheduler — fires schedule-triggered definitions. Built
	// here so it can be started as a leader singleton alongside the other
	// background loops below.
	cronScheduler, err := service.NewCronTriggerScheduler(service.CronTriggerConfig{
		Defs:   defRepo,
		Engine: engineSvc,
		RDB:    rdb,
		Logger: logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct cron trigger scheduler")
	}

	// 17. Start all components via errgroup
	g, gCtx := errgroup.WithContext(ctx)

	// HTTP server
	g.Go(func() error {
		logger.Info().Int("port", cfg.Server.Port).Msg("workflow-engine HTTP server starting")
		if err := srv.HTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	})

	// WP-7: leader-elected singletons. The scheduler timer/SLA loops, the
	// instance recovery pass, and the cron-trigger scheduler must run on exactly
	// one replica at a time; otherwise N replicas would each poll timers, fire
	// schedules, and recover instances, producing duplicate work. Each is wrapped
	// with service.RunLeaderSingleton over a Redis-backed elector keyed by a
	// distinct role, so leadership is held independently per loop and the loop
	// starts on acquire / stops on loss. instanceID identifies this replica.
	instanceID := leaderInstanceID()
	const (
		leaderTTL   = 15 * time.Second
		leaderRenew = 5 * time.Second
	)
	startLeaderSingleton := func(role string, fn func(ctx context.Context)) {
		elector := leadership.NewRedisElection(rdb, role, instanceID, leaderTTL, leaderRenew, &logger)
		g.Go(func() error {
			if err := service.RunLeaderSingleton(gCtx, elector, role, instanceID, logger, fn); err != nil {
				logger.Error().Err(err).Str("role", role).Msg("leader singleton terminated with error")
			}
			return nil
		})
	}

	// Scheduler (timer poller + SLA monitor) — leader only.
	startLeaderSingleton("workflow-scheduler", schedulerSvc.RunLeader)

	// Cron-trigger scheduler — leader only.
	startLeaderSingleton("workflow-cron-trigger", cronScheduler.Run)

	// Instance recovery — leader only; runs one recovery pass per acquisition.
	startLeaderSingleton("workflow-recovery", func(leaderCtx context.Context) {
		if err := recoverySvc.Recover(leaderCtx); err != nil {
			logger.Error().Err(err).Msg("instance recovery encountered errors")
		}
		// Recovery is a one-shot pass; block until leadership/ctx ends so the
		// singleton does not flap into a tight re-acquire loop.
		<-leaderCtx.Done()
	})

	// Stale-pending activity reconciler — leader only (periodic sweep). Nil when no
	// activity ledger is wired, in which case the singleton is not registered.
	if activityReconciler != nil {
		startLeaderSingleton("workflow-activity-reconciler", activityReconciler.Run)
	}

	// Outbox relay: delivers staged events to Kafka with retries; without a
	// reachable broker, events remain durably staged in the outbox.
	if relay != nil {
		g.Go(func() error {
			return relay.Run(gCtx)
		})
	}

	// Kafka consumers
	var kafkaConsumerClient *events.Consumer
	if len(cfg.Kafka.Brokers) > 0 {
		kc, err := events.NewConsumer(cfg.Kafka, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka consumer unavailable — event consumers disabled")
		} else {
			kafkaConsumerClient = kc

			// Subscribe trigger consumer to domain event topics
			kc.Subscribe("platform.workflow.events", triggerConsumer)
			kc.Subscribe("platform.cyber.events", triggerConsumer)
			kc.Subscribe("platform.iam.events", triggerConsumer)
			kc.Subscribe("platform.data.events", triggerConsumer)
			kc.Subscribe("platform.enterprise.events", triggerConsumer)

			// Event wait consumer for correlation matching
			kc.Subscribe("platform.workflow.events", eventWaitConsumer)

			g.Go(func() error {
				if err := kc.Start(gCtx); err != nil {
					logger.Error().Err(err).Msg("kafka consumer error")
				}
				return nil
			})
		}
	}

	// 18. Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case <-gCtx.Done():
		logger.Info().Msg("context cancelled")
	}

	cancel()

	// The scheduler timer/SLA loops, cron scheduler, and recovery pass run as
	// leader singletons (RunLeader/Run, ctx-driven); cancel() above stops them
	// via gCtx. schedulerSvc.Stop() is intentionally not called — it is the
	// teardown for the Start()/stopCh lifecycle, which this binary no longer uses.

	if kafkaConsumerClient != nil {
		kafkaConsumerClient.Stop()
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.HTTPServer.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("HTTP server shutdown error")
	}

	if err := g.Wait(); err != nil {
		logger.Error().Err(err).Msg("errgroup error during shutdown")
	}

	logger.Info().Msg("workflow-engine stopped gracefully")
}

// leaderInstanceID returns a stable-per-process identity for leadership locks:
// "<hostname>-<pid>". It uniquely identifies this replica so the elector can
// distinguish "I still hold the lock" from "another replica holds it".
func leaderInstanceID() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "workflow-engine"
	}
	return fmt.Sprintf("%s-%d", host, os.Getpid())
}

// runMigrations applies the versioned workflow_db migration chain via the
// shared migrator. It resolves the migrations directory the same way
// cmd/license-service does: the in-repo path first, falling back to the
// backend/-prefixed path so the binary works from either the repo root or the
// backend/ working directory.
func runMigrations(dsn string) error {
	migrationsPath := filepath.Join("migrations", "workflow_db")
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "workflow_db")
	}
	return database.RunMigrations(dsn, migrationsPath)
}
