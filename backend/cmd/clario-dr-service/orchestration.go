package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/drillsched"
	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/predict"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/runbookstudio"
	drservice "github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/topology"
	"github.com/clario360/platform/internal/events"
)

// orchestrationPlane bundles the ClarioDR orchestration packages (runbookstudio,
// drillsched, bootgraph, gameday) so main wires them with a single call,
// mirroring the Batch A intelligencePlane and Batch B
// resiliencePlane. Each is constructed with the real DR collaborators (DBPool,
// Redis, repository, drservice.Service as the failover/stream control surface)
// — no fakes — and exposes its HTTP surface for mounting under /api/v1/dr, the
// typed consumers it registers, the leader-singleton background loops it must run
// on exactly one node, and the failover-drill result-ingest hook the failover
// driver invokes when a DRILL run completes.
type orchestrationPlane struct {
	// mount mounts each package's chi.Router under the already-Auth+Tenant
	// protected /api/v1/dr group; each Router carries its own RequirePermission
	// gates (dr:read queries, dr:write authoring/defining, dr:failover run/execute).
	mount func(protected chi.Router)

	// reconcileConsumers are typed handlers that must run as a leader singleton (a
	// dedicated consumer group started only on the elected leader so exactly one
	// node turns each dr.drill.scheduled request into a single DRILL failover run).
	reconcileConsumers map[string][]events.TypedEventHandler

	// startLeaderLoops launches the leader-singleton background loops (drillsched
	// due-schedule firing, runbook-studio stall reconciliation, gameday run claim,
	// storage-offload poll/retention loop), each gated by Redis leader election like startRPOMonitor /
	// startFailoverDriver.
	startLeaderLoops func(ctx context.Context)

	// ingestDrillResult is folded into the failover driver's OnComplete hook: when
	// a DRILL failover run reaches a terminal state, the drillsched service ingests
	// its outcome (achieved RTO/RPO, validation ratio, step timeline) so the run's
	// drift-vs-previous diff is computed. A non-drill (real failover) run is a
	// no-op. It is safe to call outside the advance transaction.
	ingestDrillResult func(ctx context.Context, run *drmodel.FailoverRun)

	// bootTiers maps bootgraph service tiers onto recovery_target site IDs so the
	// failover executor can boot dependency tiers with a health-gate barrier.
	bootTiers drservice.BootTierSource

	// bootMgr is the dependency-aware boot orchestration manager. It is exposed so
	// the Recover product's Cloud DR sub-solution can COMPOSE its boot-plan read
	// surface (Manager.GetPlan) without reconstructing or forking the engine.
	bootMgr *bootgraph.Manager

	// studioSvc is the Runbook Studio orchestration service. It is exposed so the
	// Recover product's Application Metastore (Prompt 7) can COMPOSE runbook
	// authoring (CreateRunbook with import steps) for its "populate from
	// Metastore" action without reconstructing or forking the studio engine.
	studioSvc *runbookstudio.Service

	// gamedaySvc is the game-day orchestration service. It is exposed so main can
	// build the rehearsal-proof service (which reads game-day scorecards) AFTER the
	// sovereign plane's attestation-ledger recorder and WORM client exist, so the
	// proof service can sign+WORM-seal+anchor proofs rather than being compute-only.
	gamedaySvc *gameday.Service
}

// configureOrchestrationPlane constructs the orchestration packages with
// their real collaborators. drSvc is the failover/stream control surface: the
// drill-scheduled consumer creates DRILL failover runs through it, and the
// gameday pause/resume fault drives its replication-stream control. wormClient is
// not required by this plane (the failover driver owns the recovery-point store);
// it is omitted from the signature.
func configureOrchestrationPlane(
	ctx context.Context,
	db *pgxpool.Pool,
	redisClient *redis.Client,
	repo *drrepo.Repository,
	drSvc *drservice.Service,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *orchestrationPlane {
	plane := &orchestrationPlane{
		reconcileConsumers: map[string][]events.TypedEventHandler{},
	}

	// ---- runbookstudio: editable recovery runbooks + live runs ----------
	// The AUTOMATED-task Executor is a REAL command/HTTP action runner: an
	// automation_action of "cmd:<argv>" runs a local provisioner command and
	// "http(s)://..." POSTs the task context to a webhook, both with a bounded
	// timeout. It is invoked inside the task-action transaction, so the timeout
	// keeps a slow action from holding the row lock open indefinitely.
	studioStore := runbookstudio.NewStore()
	studioMetrics := runbookstudio.NewMetrics(metricsReg)
	studioExecutor := newRunbookActionExecutor(drSvc, durationEnv("DR_STUDIO_ACTION_TIMEOUT", 2*time.Minute), logger)
	studioRunner := runbookstudio.PGXRunner{Pool: db}
	studioSvc, err := runbookstudio.NewService(runbookstudio.Config{
		Store:    studioStore,
		Runner:   studioRunner,
		Executor: studioExecutor,
		Metrics:  studioMetrics,
		Logger:   logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr runbook-studio service")
	}
	studioRouter := runbookstudio.NewRouter(studioSvc, logger)
	studioLoop, err := runbookstudio.NewLoop(runbookstudio.LoopConfig{
		Reader:     studioRunner,
		Lister:     studioStore,
		Reconciler: studioSvc,
		Logger:     logger,
		Interval:   durationEnv("DR_STUDIO_RECONCILE_INTERVAL", 15*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr runbook-studio reconciliation loop")
	}

	// ---- drillsched: scheduled DR drills (cron) + drift diffs ------------
	drillStore := drillsched.NewStore()
	drillMetrics := drillsched.NewMetrics(metricsReg)
	drillSvc, err := drillsched.NewService(drillsched.Config{
		Store:   drillStore,
		Runner:  drillsched.PGXRunner{Pool: db},
		Metrics: drillMetrics,
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr drill-schedule service")
	}
	drillRouter := drillsched.NewRouter(drillSvc, logger)
	// The scheduler is the leader-singleton loop that fires due schedules onto the
	// outbox (dr.drill.scheduled). It constructs its own pool/system-tx runner and
	// outbox sink; we only supply the pool, store, metrics, and cadence.
	drillScheduler, err := drillsched.NewScheduler(drillsched.SchedulerConfig{
		Pool:      db,
		Store:     drillStore,
		Metrics:   drillMetrics,
		Logger:    logger,
		Interval:  durationEnv("DR_DRILL_SCHEDULER_INTERVAL", 30*time.Second),
		BatchSize: intEnv("DR_DRILL_SCHEDULER_BATCH", 0),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr drill scheduler")
	}
	// The drill-scheduled consumer turns each fired dr.drill.scheduled outbox event
	// into a DRILL failover run via the EXISTING failover service. It is a leader
	// singleton (registered on reconcileConsumers) so a single node creates exactly
	// one run per fired schedule even if the event is delivered on multiple nodes.
	drillConsumer := newDrillScheduledConsumer(drSvc, logger)
	plane.reconcileConsumers[events.Topics.DREvents] = append(
		plane.reconcileConsumers[events.Topics.DREvents], drillConsumer)
	// The result-ingest is wired to the failover DRILL outcome: when a drill run
	// completes, its sealed attestation (RTO/RPO/validation) + step timeline are
	// read back and ingested as a DrillResult, computing the drift diff.
	plane.ingestDrillResult = newDrillResultIngestor(db, repo, drillSvc, logger).ingest

	// ---- bootgraph: dependency-aware boot orchestration ------------------
	// The orchestrator issues each service's boot through the REAL Booter
	// (bootActionBooter → "cmd:<argv>" provisioner command / "http(s)://..."
	// recovery webhook), then gates the tier on the REAL HealthChecker
	// (bootgraph.CheckerFor → the HTTP/TCP/script probes). A service with an empty
	// boot_action is booted out-of-band, so the orchestrator degrades to a pure
	// health barrier for it (the historic NoopBooter behaviour, now per-service).
	// The boot run executes synchronously inside the request (Manager.StartRun
	// drives the orchestrator tier-by-tier), so there is NO background claim loop —
	// it is request-driven, gated by dr:failover.
	bootMetrics := bootgraph.NewMetrics(metricsReg)
	bootStore := bootgraph.NewStore()
	bootMgr, err := bootgraph.NewService(bootgraph.Config{
		Store:        bootStore,
		Runner:       bootgraph.PGXRunner{Pool: db},
		Metrics:      bootMetrics,
		Booter:       newBootActionBooter(durationEnv("DR_BOOTGRAPH_ACTION_TIMEOUT", 2*time.Minute), logger),
		CheckerFor:   bootgraph.CheckerFor, // real HTTP/TCP/script probes
		RetryBackoff: durationEnv("DR_BOOTGRAPH_PROBE_BACKOFF", 0),
		Logger:       logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr bootgraph manager")
	}
	bootRouter := bootgraph.NewRouter(bootMgr, logger)
	plane.bootTiers = bootgraphTierSource{store: bootStore, planner: bootgraph.Planner{}}
	plane.bootMgr = bootMgr
	plane.studioSvc = studioSvc

	// ---- gameday: controlled chaos / DR fire drills ----------------------
	// StreamController is wired to the REAL replication-stream pause/resume control
	// (drservice.Service.PauseStream/ResumeStream). SiteBlocker is the drill-scope
	// reachability sandbox (the design forbids touching the production network), so
	// it is an in-process sandbox that records blocked sites. SignalSource reads the
	// REAL DR signal stores (ransomware signals, breach predictions, topology edge
	// health) so detection latency is scored against the platform's real response.
	gamedayStore := gameday.NewStore()
	gamedayMetrics := gameday.NewMetrics(metricsReg)
	gamedayRegistry := gameday.NewRegistry(
		gameday.NewPauseStreamFault(drStreamController{drSvc: drSvc, pool: db}),
		// Default induced lag must exceed the GA RPO objective (300s) so the
		// forecaster's smoothed lag crosses the breach line and the lag_alert /
		// predicted_breach signal genuinely fires; a step may override via
		// params["lag"]. 30s would never breach a 5-minute objective.
		gameday.NewInduceLagFault(drLagController{pool: db, store: predict.NewStore()}, durationEnv("DR_GAMEDAY_DEFAULT_LAG", 10*time.Minute)),
		gameday.NewBlockSiteFault(drSiteBlocker{pool: db, store: topology.NewStore()}),
	)
	gamedaySignals := drSignalSource{pool: db}
	gamedayOrch, err := gameday.NewOrchestrator(gameday.OrchestratorConfig{
		Store:     gamedayStore,
		Runner:    gameday.PGXRunner{Pool: db},
		Registry:  gamedayRegistry,
		Signals:   gamedaySignals,
		Metrics:   gamedayMetrics,
		PollEvery: durationEnv("DR_GAMEDAY_SIGNAL_POLL", 0),
		Logger:    logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr gameday orchestrator")
	}
	gamedaySvc, err := gameday.NewService(gameday.ServiceConfig{
		Store:        gamedayStore,
		Runner:       gameday.PGXRunner{Pool: db},
		Orchestrator: gamedayOrch,
		Logger:       logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr gameday service")
	}
	gamedayRouter := gameday.NewRouter(gamedaySvc, logger)
	plane.gamedaySvc = gamedaySvc
	gamedayLoop, err := gameday.NewLoop(gameday.LoopConfig{
		Pool:         db,
		Claimer:      gamedayStore,
		Orchestrator: gamedayOrch,
		Logger:       logger,
		Interval:     durationEnv("DR_GAMEDAY_CLAIM_INTERVAL", 2*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr gameday claim loop")
	}

	// The coverage-breadth packages (vmcapture / iacdr / storageoffload) are wired
	// separately in configureCoveragePlane (coverage.go), so they are NOT
	// constructed here; this plane owns runbook authoring, drills, boot graphs and
	// game-day chaos.

	// ---- HTTP mounting --------------------------------------------------
	// Each package's Router self-gates with RequirePermission per route, so all
	// orchestration routers mount under the already-Auth+Tenant /api/v1/dr group at "/":
	//   - runbookstudio: dr:read (view runbook/run), dr:write (author/import/add task),
	//                     dr:failover (start a run + every task action, incl. the
	//                     APPROVAL-gate sign-off, since a run drives a recovery).
	//   - drillsched:    dr:read (schedules/results/diff), dr:write (create schedule).
	//   - bootgraph:     dr:read (plan/run), dr:write (define DAG), dr:failover (boot run).
	//   - gameday:       dr:read (scenarios/scorecard), dr:write (define scenario),
	//                     dr:failover (execute a run — it injects faults).
	plane.mount = func(protected chi.Router) {
		mountRoutes(protected, studioRouter.Routes())
		mountRoutes(protected, drillRouter.Routes())
		mountRoutes(protected, bootRouter.Routes())
		mountRoutes(protected, gamedayRouter.Routes())
	}

	// ---- leader-singleton background loops ------------------------------
	plane.startLeaderLoops = func(loopCtx context.Context) {
		// drillsched scheduler: fires due cron schedules onto the outbox. Role
		// dr-drill-scheduler, mirroring the RPO monitor / failover driver singletons.
		runLeaderSingleton(loopCtx, redisClient, "dr-drill-scheduler",
			"DR_DRILL_SCHEDULER", logger, drillScheduler.Run, nil)
		// runbook-studio stall reconciliation: a single leader fails runs that became
		// un-progressable between operator actions (required task failed → blocked).
		runLeaderSingleton(loopCtx, redisClient, "dr-studio-reconciler",
			"DR_STUDIO_RECONCILER", logger, studioLoop.Run, nil)
		// gameday claim loop: a single leader claims and executes pending game-day
		// runs (inject → observe → score → revert), disjoint from the failover driver.
		runLeaderSingleton(loopCtx, redisClient, "dr-gameday-orchestrator",
			"DR_GAMEDAY_ORCHESTRATOR", logger, gamedayLoop.Run, nil)
	}

	return plane
}

// ---------------------------------------------------------------------------
// runbookstudio collaborators
// ---------------------------------------------------------------------------

// failoverControl is the typed DR control surface Runbook Studio automation can
// call without shelling out. *drservice.Service satisfies it.
type failoverControl interface {
	CreateFailoverRun(ctx context.Context, tenantID uuid.UUID, in drservice.CreateFailoverRunInput) (*drmodel.FailoverRun, error)
	ApproveFailoverRun(ctx context.Context, tenantID, runID, approvedBy uuid.UUID, inputs ...drservice.ApproveFailoverRunInput) (*drmodel.FailoverRun, error)
	CancelFailoverRun(ctx context.Context, tenantID, runID, cancelledBy uuid.UUID) (*drmodel.FailoverRun, error)
	GetFailoverRun(ctx context.Context, tenantID, runID uuid.UUID) (*drmodel.FailoverRun, error)
}

// runbookActionExecutor is the REAL AUTOMATED-task action runner for Runbook
// Studio. An automation_action is dispatched by typed action or scheme:
//
//   - "dr.failover.create"   creates a real/drill failover run through drservice.
//
//   - "dr.failover.approve"  records Gate-2 approval for a failover run.
//
//   - "dr.failover.cancel"   cancels a pre-execution failover run.
//
//   - "dr.failover.status"   reads a failover run status.
//
//   - "cmd:<argv...>"            runs a local command (space-split argv) with a
//     bounded timeout, recording its stdout tail as the outcome message.
//
//   - "http://" / "https://..."  POSTs the task context as JSON to the URL and
//     records the response status + body tail.
//
// Both are real side effects against real systems (a provisioner CLI or a
// recovery webhook), so AUTOMATED runbook tasks actually drive recovery actions
// rather than being recorded as no-ops. The bounded timeout matters because the
// service invokes Run INSIDE the task-action transaction, so a hung action must
// not hold the task-run row lock open forever.
type runbookActionExecutor struct {
	dr         failoverControl
	httpClient *http.Client
	timeout    time.Duration
	logger     zerolog.Logger
}

func newRunbookActionExecutor(dr failoverControl, timeout time.Duration, logger zerolog.Logger) *runbookActionExecutor {
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	return &runbookActionExecutor{
		dr:         dr,
		httpClient: &http.Client{Timeout: timeout},
		timeout:    timeout,
		logger:     logger.With().Str("component", "dr-studio-executor").Logger(),
	}
}

// Run dispatches the named action. An empty action is rejected so a task marked
// AUTOMATED without an action surfaces a clear failure rather than silently
// succeeding.
func (e *runbookActionExecutor) Run(ctx context.Context, action string, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	action = strings.TrimSpace(action)
	if action == "" {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: automated task has no automation_action")
	}
	runCtx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	switch {
	case action == "dr.failover.create":
		return e.createFailover(runCtx, in)
	case action == "dr.failover.approve":
		return e.approveFailover(runCtx, in)
	case action == "dr.failover.cancel":
		return e.cancelFailover(runCtx, in)
	case action == "dr.failover.status":
		return e.failoverStatus(runCtx, in)
	case strings.HasPrefix(action, "cmd:"):
		return e.runCommand(runCtx, strings.TrimSpace(strings.TrimPrefix(action, "cmd:")), in)
	case strings.HasPrefix(action, "http://"), strings.HasPrefix(action, "https://"):
		return e.runHTTP(runCtx, action, in)
	default:
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: unsupported automation_action %q (want cmd:<argv> or http(s)://...)", action)
	}
}

func (e *runbookActionExecutor) createFailover(ctx context.Context, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	if e.dr == nil {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: failover control is not configured")
	}
	tenantID, err := uuid.Parse(in.TenantID)
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr.failover.create: tenant_id: %w", err)
	}
	groupID, err := uuid.Parse(firstNonEmpty(paramString(in.Params, "group_id"), in.GroupID))
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr.failover.create: group_id is required and must be a UUID: %w", err)
	}
	initiatedBy, err := actorUUID(in.ActedBy, "dr.failover.create")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	mode := paramString(in.Params, "mode")
	if mode == "" {
		mode = drModeFromStudioMode(in.RunMode)
	}
	recoveryPointID, err := optionalUUIDParam(in.Params, "recovery_point_id")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr.failover.create: recovery_point_id: %w", err)
	}
	rto, err := intParam(in.Params, "rto_objective_seconds")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr.failover.create: rto_objective_seconds: %w", err)
	}
	run, err := e.dr.CreateFailoverRun(ctx, tenantID, drservice.CreateFailoverRunInput{
		GroupID:             groupID,
		Mode:                mode,
		RecoveryPointID:     recoveryPointID,
		RTOObjectiveSeconds: rto,
		InitiatedBy:         initiatedBy,
	})
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	return failoverOutcome(run, "failover run created"), nil
}

func (e *runbookActionExecutor) approveFailover(ctx context.Context, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	if e.dr == nil {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: failover control is not configured")
	}
	tenantID, runID, err := tenantAndRunID(in, "dr.failover.approve")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	approvedBy, err := actorUUID(in.ActedBy, "dr.failover.approve")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	run, err := e.dr.ApproveFailoverRun(ctx, tenantID, runID, approvedBy)
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	return failoverOutcome(run, "failover run approved"), nil
}

func (e *runbookActionExecutor) cancelFailover(ctx context.Context, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	if e.dr == nil {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: failover control is not configured")
	}
	tenantID, runID, err := tenantAndRunID(in, "dr.failover.cancel")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	cancelledBy, err := actorUUID(in.ActedBy, "dr.failover.cancel")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	run, err := e.dr.CancelFailoverRun(ctx, tenantID, runID, cancelledBy)
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	return failoverOutcome(run, "failover run cancelled"), nil
}

func (e *runbookActionExecutor) failoverStatus(ctx context.Context, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	if e.dr == nil {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: failover control is not configured")
	}
	tenantID, runID, err := tenantAndRunID(in, "dr.failover.status")
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	run, err := e.dr.GetFailoverRun(ctx, tenantID, runID)
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, err
	}
	return failoverOutcome(run, "failover run status read"), nil
}

func failoverOutcome(run *drmodel.FailoverRun, message string) runbookstudio.ExecutorOutcome {
	if run == nil {
		return runbookstudio.ExecutorOutcome{Message: message}
	}
	return runbookstudio.ExecutorOutcome{
		ExternalID: run.ID,
		Message:    message,
		Data: map[string]any{
			"run_id":            run.ID,
			"group_id":          run.GroupID,
			"mode":              run.Mode,
			"status":            run.Status,
			"recovery_point_id": run.RecoveryPointID,
		},
	}
}

func tenantAndRunID(in runbookstudio.ExecutorInput, action string) (uuid.UUID, uuid.UUID, error) {
	tenantID, err := uuid.Parse(in.TenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("%s: tenant_id: %w", action, err)
	}
	runID, err := uuid.Parse(firstNonEmpty(paramString(in.Params, "failover_run_id"), paramString(in.Params, "run_id")))
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("%s: failover_run_id is required and must be a UUID: %w", action, err)
	}
	return tenantID, runID, nil
}

func actorUUID(actor *string, action string) (uuid.UUID, error) {
	if actor == nil || strings.TrimSpace(*actor) == "" {
		return uuid.Nil, fmt.Errorf("%s: acted_by is required", action)
	}
	id, err := uuid.Parse(strings.TrimSpace(*actor))
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s: acted_by must be a UUID: %w", action, err)
	}
	return id, nil
}

func drModeFromStudioMode(mode string) string {
	if mode == runbookstudio.RunModeRehearsal {
		return drmodel.ModeDrill
	}
	return drmodel.ModeReal
}

func paramString(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	switch v := params[key].(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	case nil:
		return ""
	}
}

func optionalUUIDParam(params map[string]any, key string) (*uuid.UUID, error) {
	raw := paramString(params, key)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func intParam(params map[string]any, key string) (int, error) {
	if params == nil {
		return 0, nil
	}
	v, ok := params[key]
	if !ok || v == nil {
		return 0, nil
	}
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case float64:
		return int(n), nil
	case json.Number:
		i, err := n.Int64()
		return int(i), err
	case string:
		if strings.TrimSpace(n) == "" {
			return 0, nil
		}
		parsed, err := strconv.Atoi(strings.TrimSpace(n))
		return parsed, err
	default:
		return 0, fmt.Errorf("unsupported numeric type %T", v)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (e *runbookActionExecutor) runCommand(ctx context.Context, line string, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	argv := strings.Fields(line)
	if len(argv) == 0 {
		return runbookstudio.ExecutorOutcome{}, errors.New("dr studio executor: cmd action has empty command")
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	// Pass the run/task context to the provisioner via the environment so a script
	// can be idempotent on re-run (keyed by run+task).
	cmd.Env = append(os.Environ(),
		"DR_STUDIO_TENANT_ID="+in.TenantID,
		"DR_STUDIO_RUN_ID="+in.RunID,
		"DR_STUDIO_TASK_ID="+in.TaskID,
		"DR_STUDIO_TASK_KEY="+in.TaskKey,
		"DR_STUDIO_RUNBOOK_ID="+in.RunbookID,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: command %q failed: %w: %s", argv[0], err, tail(out.String(), 512))
	}
	return runbookstudio.ExecutorOutcome{
		ExternalID: in.RunID + ":" + in.TaskID,
		Message:    tail(strings.TrimSpace(out.String()), 512),
		Data:       map[string]any{"command": argv[0]},
	}, nil
}

func (e *runbookActionExecutor) runHTTP(ctx context.Context, url string, in runbookstudio.ExecutorInput) (runbookstudio.ExecutorOutcome, error) {
	body, err := json.Marshal(map[string]any{
		"tenant_id":  in.TenantID,
		"run_id":     in.RunID,
		"task_id":    in.TaskID,
		"task_key":   in.TaskKey,
		"runbook_id": in.RunbookID,
		"params":     in.Params,
	})
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: encoding action body: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.httpClient.Do(req)
	if err != nil {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: POST %s: %w", url, err)
	}
	defer resp.Body.Close()
	var respBody bytes.Buffer
	_, _ = respBody.ReadFrom(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return runbookstudio.ExecutorOutcome{}, fmt.Errorf("dr studio executor: POST %s returned %d: %s", url, resp.StatusCode, tail(respBody.String(), 512))
	}
	return runbookstudio.ExecutorOutcome{
		ExternalID: resp.Header.Get("X-Resource-Id"),
		Message:    fmt.Sprintf("HTTP %d", resp.StatusCode),
		Data:       map[string]any{"status_code": resp.StatusCode, "response": tail(respBody.String(), 512)},
	}, nil
}

// tail returns the last n bytes of s (so a long command output / response body is
// bounded in the durable task-run detail).
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

// ---------------------------------------------------------------------------
// bootgraph collaborators
// ---------------------------------------------------------------------------

// bootActionBooter is the REAL bootgraph.Booter for dependency-aware boot
// orchestration: it ISSUES each service's boot (not just health-gates one done
// out-of-band) by dispatching the service's boot_action by scheme — the same
// "cmd:<argv>" / "http(s)://..." contract the runbook-studio executor uses, so
// an operator declares one boot mechanism across both planes.
//
//   - "cmd:<argv>"            runs a local provisioner command (space-split argv).
//   - "http://"/"https://..." POSTs the service context as JSON to the URL.
//   - ""  (empty)             treats the boot as performed out-of-band and returns
//     nil, so the orchestrator degrades to a pure health
//     barrier for that service (historic NoopBooter
//     behaviour, now decided per service).
//
// Each boot is bounded by the per-attempt context the orchestrator derives from
// the service's boot timeout; the executor's own timeout is a backstop. TearDown
// is a best-effort no-op: a generic boot action has no defined inverse, so a
// rollback records the service as rolled-back (orchestrator side) but does not
// run a teardown command — surfaced as a debug log rather than silently claimed.
type bootActionBooter struct {
	httpClient         *http.Client
	timeout            time.Duration
	rejectNoopTeardown bool
	logger             zerolog.Logger
}

func newBootActionBooter(timeout time.Duration, logger zerolog.Logger) *bootActionBooter {
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	return &bootActionBooter{
		httpClient:         &http.Client{Timeout: timeout},
		timeout:            timeout,
		rejectNoopTeardown: bootgraphRejectNoopTeardown(),
		logger:             logger.With().Str("component", "dr-bootgraph-booter").Logger(),
	}
}

// Boot issues the service's boot. An empty boot_action is an out-of-band boot
// (nil), so the orchestrator's health gate is the only barrier.
func (b *bootActionBooter) Boot(ctx context.Context, svc bootgraph.Service) error {
	action := strings.TrimSpace(svc.BootAction)
	if action == "" {
		return nil // booted out-of-band; the health probe is the gate
	}
	runCtx, cancel := context.WithTimeout(ctx, b.timeout)
	defer cancel()

	switch {
	case strings.HasPrefix(action, "cmd:"):
		return b.runCommand(runCtx, strings.TrimSpace(strings.TrimPrefix(action, "cmd:")), svc)
	case strings.HasPrefix(action, "http://"), strings.HasPrefix(action, "https://"):
		return b.runHTTP(runCtx, action, svc)
	default:
		return fmt.Errorf("dr bootgraph booter: unsupported boot_action %q (want cmd:<argv> or http(s)://...)", action)
	}
}

// TearDown is a best-effort no-op: a generic boot action has no defined inverse.
func (b *bootActionBooter) TearDown(_ context.Context, svc bootgraph.Service) error {
	if strings.TrimSpace(svc.BootAction) != "" {
		if b.rejectNoopTeardown {
			return fmt.Errorf("dr bootgraph booter: teardown for %q would be a no-op; configure provider recovery teardown or disable regulated/provider bootgraph teardown enforcement", svc.Name)
		}
		b.logger.Debug().Str("service", svc.Name).Msg("bootgraph teardown is a no-op for boot_action services")
	}
	return nil
}

func bootgraphRejectNoopTeardown() bool {
	if enabled, ok := boolEnvValue("DR_BOOTGRAPH_REJECT_NOOP_TEARDOWN"); ok {
		return enabled
	}
	return regulatedEnvEnabled() && providerRecoveryDriverEnv()
}

func regulatedEnvEnabled() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("DR_DEPLOYMENT_PROFILE")), "regulated") {
		return true
	}
	enabled, ok := boolEnvValue("DR_REGULATED_MODE")
	return ok && enabled
}

func providerRecoveryDriverEnv() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DR_RECOVERY_DRIVER"))) {
	case "provider", "vsphere", "kubernetes", "cloud", "netapp":
		return true
	default:
		return false
	}
}

func boolEnvValue(key string) (bool, bool) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return false, false
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false, false
	}
	return enabled, true
}

func (b *bootActionBooter) runCommand(ctx context.Context, line string, svc bootgraph.Service) error {
	argv := strings.Fields(line)
	if len(argv) == 0 {
		return errors.New("dr bootgraph booter: cmd action has empty command")
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(),
		"DR_BOOT_TENANT_ID="+svc.TenantID,
		"DR_BOOT_GROUP_ID="+svc.GroupID,
		"DR_BOOT_SERVICE_ID="+svc.ID,
		"DR_BOOT_SERVICE_NAME="+svc.Name,
		"DR_BOOT_SERVICE_KIND="+svc.Kind,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("dr bootgraph booter: boot command %q for %q failed: %w: %s", argv[0], svc.Name, err, tail(out.String(), 512))
	}
	return nil
}

func (b *bootActionBooter) runHTTP(ctx context.Context, url string, svc bootgraph.Service) error {
	body, err := json.Marshal(map[string]any{
		"tenant_id":    svc.TenantID,
		"group_id":     svc.GroupID,
		"service_id":   svc.ID,
		"service_name": svc.Name,
		"service_kind": svc.Kind,
	})
	if err != nil {
		return fmt.Errorf("dr bootgraph booter: encoding boot body for %q: %w", svc.Name, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("dr bootgraph booter: building boot request for %q: %w", svc.Name, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dr bootgraph booter: POST %s for %q: %w", url, svc.Name, err)
	}
	defer resp.Body.Close()
	var respBody bytes.Buffer
	_, _ = respBody.ReadFrom(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dr bootgraph booter: POST %s for %q returned %d: %s", url, svc.Name, resp.StatusCode, tail(respBody.String(), 512))
	}
	return nil
}

// bootgraphTierSource resolves a group's dependency-aware boot tiers from the
// bootgraph DAG, keyed by recovery_target site id, so the §6.3 recovery executor
// can boot in dependency order with a health-gate barrier
// (drservice.BootTierSource). It reads through the executor's own system
// transaction (bypass_rls). It reports ok=false whenever the group has no usable
// mapping — no DAG, no services, a cycle, or no site links — so the executor falls
// back to the flat recovery_target boot_order. A malformed/cyclic graph must never
// block recovery, so a planner error degrades to the fallback rather than
// propagating.
type bootgraphTierSource struct {
	store   *bootgraph.Store
	planner bootgraph.Planner
}

func newBootgraphTierSource() bootgraphTierSource {
	return bootgraphTierSource{store: bootgraph.NewStore(), planner: bootgraph.Planner{}}
}

func (s bootgraphTierSource) TierBySite(ctx context.Context, db drrepo.DBTX, groupID string) (map[string]int, bool, error) {
	services, err := s.store.LoadServices(ctx, db, groupID)
	if err != nil {
		if errors.Is(err, bootgraph.ErrGroupNotFound) {
			return nil, false, nil // no DAG defined for this group
		}
		return nil, false, err
	}
	if len(services) == 0 {
		return nil, false, nil
	}
	deps, err := s.store.LoadDependencies(ctx, db, groupID)
	if err != nil {
		return nil, false, err
	}
	plan, perr := s.planner.Plan(groupID, services, deps)
	if perr != nil {
		return nil, false, nil // cyclic/malformed graph -> fall back, never block recovery
	}
	tiers := make(map[string]int)
	for tierIdx, tier := range plan.Tiers {
		for _, svc := range tier {
			if svc.SiteID != "" {
				tiers[svc.SiteID] = tierIdx
			}
		}
	}
	if len(tiers) == 0 {
		return nil, false, nil // DAG exists but no service links to a recovery site
	}
	return tiers, true, nil
}

// ---------------------------------------------------------------------------
// drillsched collaborators
// ---------------------------------------------------------------------------

// drillScheduledConsumer turns each dr.drill.scheduled outbox event (emitted by
// the drillsched scheduler when a cron schedule fires) into a DRILL failover run
// via the EXISTING failover service. It does NOT re-implement the failover
// driver: it only REQUESTS the drill (CreateFailoverRun Mode=drill); the gated
// failover driver then advances it exactly as a human-initiated drill. It is run
// as a leader singleton so exactly one node creates one run per fired schedule.
type drillScheduledConsumer struct {
	drSvc  *drservice.Service
	logger zerolog.Logger
}

func newDrillScheduledConsumer(drSvc *drservice.Service, logger zerolog.Logger) *drillScheduledConsumer {
	return &drillScheduledConsumer{
		drSvc:  drSvc,
		logger: logger.With().Str("consumer", "dr-drill-scheduled").Logger(),
	}
}

// EventTypes filters the shared datastream.dr.events topic to this package's own
// dr.drill.scheduled type, so it ignores every other DR lifecycle event.
func (c *drillScheduledConsumer) EventTypes() []string {
	return []string{drillsched.DrillRequestedEventType}
}

// drillScheduledPayload mirrors the drillsched scheduler's drill-request payload.
// It is decoded from the event data (the scheduler stages it via events.NewEvent).
type drillScheduledPayload struct {
	ScheduleID          string `json:"schedule_id"`
	GroupID             string `json:"group_id"`
	Mode                string `json:"mode"`
	Profile             string `json:"profile"`
	RTOObjectiveSeconds int    `json:"rto_objective_seconds"`
	InitiatedBy         string `json:"initiated_by"`
}

// Handle creates a DRILL failover run for the requested group. The event's
// tenant id scopes the run. A missing/zero initiated_by falls back to the
// well-known system actor the scheduler stamps, so the failover service's
// non-nil-initiator invariant is satisfied.
func (c *drillScheduledConsumer) Handle(ctx context.Context, event *events.Event) error {
	if event == nil || event.Type != drillsched.DrillRequestedEventType {
		return nil
	}
	if c.drSvc == nil {
		return errors.New("dr drill-scheduled consumer: failover service is required")
	}
	var payload drillScheduledPayload
	if err := event.Unmarshal(&payload); err != nil {
		return fmt.Errorf("dr drill-scheduled consumer: decoding payload: %w", err)
	}
	tenantID, err := uuid.Parse(event.TenantID)
	if err != nil {
		return fmt.Errorf("dr drill-scheduled consumer: parsing tenant id %q: %w", event.TenantID, err)
	}
	groupID, err := uuid.Parse(payload.GroupID)
	if err != nil {
		return fmt.Errorf("dr drill-scheduled consumer: parsing group id %q: %w", payload.GroupID, err)
	}
	initiatedBy, err := uuid.Parse(strings.TrimSpace(payload.InitiatedBy))
	if err != nil {
		// The scheduler stamps the nil-UUID system actor; an unparseable id falls
		// back to it so the drill is still attributable to "the scheduler".
		initiatedBy = uuid.Nil
	}
	if initiatedBy == uuid.Nil {
		initiatedBy = drillSchedulerActor
	}

	run, err := c.drSvc.CreateFailoverRun(ctx, tenantID, drservice.CreateFailoverRunInput{
		GroupID:             groupID,
		Mode:                drmodel.ModeDrill,
		RTOObjectiveSeconds: payload.RTOObjectiveSeconds,
		InitiatedBy:         initiatedBy,
	})
	if err != nil {
		return fmt.Errorf("dr drill-scheduled consumer: creating drill run for group %s: %w", groupID, err)
	}
	c.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("group_id", groupID.String()).
		Str("schedule_id", payload.ScheduleID).
		Str("run_id", run.ID).
		Msg("created drill failover run from scheduled-drill request")
	return nil
}

// drillSchedulerActor is the non-nil initiator recorded on a scheduler-fired
// drill when the event carries the nil-UUID system actor (CreateFailoverRun
// requires a non-nil initiated_by). It is a stable, well-known UUID distinct from
// any real operator so the audit trail reads "fired by the drill scheduler".
var drillSchedulerActor = uuid.MustParse("00000000-0000-0000-0000-00000000d111")

// drillResultIngestor reads a completed DRILL failover run's sealed attestation
// and step timeline back through the repository (system path — the run spans the
// failover tables, the loop is cross-tenant) and ingests them into the drillsched
// service as a DrillResult, which computes the drift diff against the previous
// drill for the same group. It is wired into the failover driver's OnComplete
// hook; a non-drill (real failover) run is skipped.
type drillResultIngestor struct {
	pool     *pgxpool.Pool
	repo     *drrepo.Repository
	drillSvc *drillsched.Service
	logger   zerolog.Logger
}

func newDrillResultIngestor(pool *pgxpool.Pool, repo *drrepo.Repository, drillSvc *drillsched.Service, logger zerolog.Logger) *drillResultIngestor {
	return &drillResultIngestor{
		pool:     pool,
		repo:     repo,
		drillSvc: drillSvc,
		logger:   logger.With().Str("component", "dr-drill-result-ingest").Logger(),
	}
}

// ingest records the completed drill's outcome. It is best-effort: an ingest
// failure is logged but never blocks the failover driver (the run is already
// terminal and attested; the drill-trend table is a secondary index).
func (i *drillResultIngestor) ingest(ctx context.Context, run *drmodel.FailoverRun) {
	if run == nil || run.Mode != drmodel.ModeDrill {
		return // only DRILL runs feed the drill-trend table
	}
	tenantID, err := uuid.Parse(run.TenantID)
	if err != nil {
		i.logger.Error().Err(err).Str("run_id", run.ID).Msg("drill result ingest: bad tenant id")
		return
	}
	groupID, err := uuid.Parse(run.GroupID)
	if err != nil {
		i.logger.Error().Err(err).Str("run_id", run.ID).Msg("drill result ingest: bad group id")
		return
	}

	// Read the attestation (authoritative achieved RTO/RPO/validation) and the
	// step timeline for the run through the system (RLS-bypass) read path, since
	// the OnComplete hook runs outside any tenant-scoped request.
	var (
		attestation *drmodel.Attestation
		steps       []*drmodel.FailoverStep
	)
	if rerr := database.RunSystemRead(ctx, i.pool, func(tx pgx.Tx) error {
		att, aerr := i.repo.GetAttestationByRun(ctx, tx, run.TenantID, run.ID)
		if aerr != nil && !errors.Is(aerr, drmodel.ErrNotFound) {
			return aerr
		}
		attestation = att
		st, serr := i.repo.SystemListFailoverSteps(ctx, tx, run.ID)
		if serr != nil {
			return serr
		}
		steps = st
		return nil
	}); rerr != nil {
		i.logger.Error().Err(rerr).Str("run_id", run.ID).Msg("drill result ingest: reading run artifacts failed")
		return
	}

	in := drillsched.IngestResultInput{
		GroupID:             groupID,
		RunID:               run.ID,
		Passed:              run.Status == drmodel.StatusCompleted,
		RTOObjectiveSeconds: run.RTOObjectiveSeconds,
		ValidationOutcome:   run.Status,
		Steps:               mapDrillSteps(steps),
		ObservedAt:          drillObservedAt(run),
	}
	if run.RTOActualSeconds != nil {
		in.RTOAchievedSeconds = *run.RTOActualSeconds
	}
	if run.RecoveryPointID != nil {
		if rp, perr := uuid.Parse(*run.RecoveryPointID); perr == nil {
			in.RecoveryPointID = &rp
		}
	}
	if attestation != nil {
		in.RTOAchievedSeconds = attestation.RTOActualSeconds
		in.RPOAchievedSeconds = attestation.RPOSeconds
		in.RTOObjectiveSeconds = attestation.RTOObjectiveSeconds
		ratio := attestation.ValidationRatio
		in.ValidationRatio = &ratio
	}

	if _, _, err := i.drillSvc.IngestResult(ctx, tenantID, in); err != nil {
		i.logger.Error().Err(err).Str("run_id", run.ID).Str("group_id", groupID.String()).Msg("drill result ingest failed")
		return
	}
	i.logger.Info().Str("run_id", run.ID).Str("group_id", groupID.String()).Bool("passed", in.Passed).Msg("ingested drill result")
}

// mapDrillSteps projects the failover step timeline onto the drillsched step
// shape (key + duration in ms), so the drift diff can compare per-step durations
// across drills. The failover step status vocabulary (running/passed/failed) is
// the same drillsched uses, so it carries over unchanged.
func mapDrillSteps(steps []*drmodel.FailoverStep) []drillsched.DrillStep {
	if len(steps) == 0 {
		return nil
	}
	out := make([]drillsched.DrillStep, 0, len(steps))
	for _, s := range steps {
		if s == nil {
			continue
		}
		ds := drillsched.DrillStep{
			Key:    s.Step,
			Title:  s.Step,
			Status: s.Status,
		}
		if s.FinishedAt != nil {
			d := s.FinishedAt.Sub(s.StartedAt).Milliseconds()
			if d < 0 {
				d = 0
			}
			ds.DurationMS = d
		}
		out = append(out, ds)
	}
	return out
}

// drillObservedAt is the drill's observation time: its completion time, falling
// back to the initiation time when the run has no completed_at (defensive — a
// terminal run normally has one).
func drillObservedAt(run *drmodel.FailoverRun) time.Time {
	if run.CompletedAt != nil {
		return run.CompletedAt.UTC()
	}
	return run.InitiatedAt.UTC()
}

// ---------------------------------------------------------------------------
// gameday collaborators
// ---------------------------------------------------------------------------

// drStreamController drives the gameday pause/resume fault against the REAL
// replication-stream control surface (drservice.Service.PauseStream /
// ResumeStream). The fault's revert resumes the exact stream it paused, so a
// game-day exercise never leaves a stream paused. The target (stream id) is a
// per-step value; the tenant is resolved from the stream's row via a system
// (RLS-bypass) read because the orchestrator executes cross-tenant under the
// leader-singleton loop, then the tenant-scoped service call performs the change.
type drStreamController struct {
	drSvc *drservice.Service
	pool  *pgxpool.Pool
}

func (c drStreamController) PauseStream(ctx context.Context, streamID string) error {
	tenantID, sid, err := c.resolve(ctx, streamID)
	if err != nil {
		return err
	}
	return c.drSvc.PauseStream(ctx, tenantID, sid)
}

func (c drStreamController) ResumeStream(ctx context.Context, streamID string) error {
	tenantID, sid, err := c.resolve(ctx, streamID)
	if err != nil {
		return err
	}
	return c.drSvc.ResumeStream(ctx, tenantID, sid)
}

const selectStreamTenantSQL = `SELECT tenant_id FROM replication_stream WHERE id = $1`

// resolve loads a stream's tenant by id through the system path so the
// tenant-scoped PauseStream/ResumeStream can be called from the game-day
// orchestrator's system (cross-tenant) execution context.
func (c drStreamController) resolve(ctx context.Context, streamID string) (uuid.UUID, uuid.UUID, error) {
	sid, err := uuid.Parse(streamID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("dr gameday stream controller: parsing stream id %q: %w", streamID, err)
	}
	var tenant uuid.UUID
	if rerr := database.RunSystemRead(ctx, c.pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, selectStreamTenantSQL, sid.String()).Scan(&tenant)
	}); rerr != nil {
		if errors.Is(rerr, pgx.ErrNoRows) {
			return uuid.Nil, uuid.Nil, fmt.Errorf("dr gameday stream controller: stream %s not found", streamID)
		}
		return uuid.Nil, uuid.Nil, fmt.Errorf("dr gameday stream controller: resolving tenant for stream %s: %w", streamID, rerr)
	}
	return tenant, sid, nil
}

// drLagController writes the durable drill-scope lag marker that predict.Store's
// forecaster query honors. It makes an induce_lag game-day step observable by
// the platform's real breach-forecast path without delaying production traffic.
type drLagController struct {
	pool  *pgxpool.Pool
	store *predict.Store
}

func (c drLagController) InduceLag(ctx context.Context, streamID string, d time.Duration) error {
	streamID = strings.TrimSpace(streamID)
	if streamID == "" {
		return errors.New("dr gameday lag controller: stream id is required")
	}
	if c.store == nil {
		return errors.New("dr gameday lag controller: predict store is required")
	}
	return database.RunSystemTx(ctx, c.pool, func(tx pgx.Tx) error {
		return c.store.SystemSetLagMarker(ctx, tx, streamID, d.Seconds())
	})
}

func (c drLagController) ClearLag(ctx context.Context, streamID string) error {
	streamID = strings.TrimSpace(streamID)
	if streamID == "" {
		return nil
	}
	if c.store == nil {
		return errors.New("dr gameday lag controller: predict store is required")
	}
	return database.RunSystemTx(ctx, c.pool, func(tx pgx.Tx) error {
		return c.store.SystemClearLagMarker(ctx, tx, streamID)
	})
}

// drSiteBlocker writes the durable drill-scope reachability marker and flips
// topology edge health through topology.Store, making block_site observable by
// topology-aware failover selection and the topology_degraded signal path.
type drSiteBlocker struct {
	pool  *pgxpool.Pool
	store *topology.Store
}

func (b drSiteBlocker) BlockSite(ctx context.Context, siteID string) error {
	siteID = strings.TrimSpace(siteID)
	if siteID == "" {
		return errors.New("dr gameday site blocker: site id is required")
	}
	if b.store == nil {
		return errors.New("dr gameday site blocker: topology store is required")
	}
	return database.RunSystemTx(ctx, b.pool, func(tx pgx.Tx) error {
		return b.store.SystemBlockSite(ctx, tx, siteID)
	})
}

func (b drSiteBlocker) UnblockSite(ctx context.Context, siteID string) error {
	siteID = strings.TrimSpace(siteID)
	if siteID == "" {
		return nil
	}
	if b.store == nil {
		return errors.New("dr gameday site blocker: topology store is required")
	}
	return database.RunSystemTx(ctx, b.pool, func(tx pgx.Tx) error {
		return b.store.SystemRestoreSite(ctx, tx, siteID)
	})
}

// drSignalSource reads the REAL DR signal stores so the game-day orchestrator
// scores detection latency against the platform's actual response, not a stub. It
// dispatches by the expected signal kind:
//
//   - "ransomware":        the latest dr_ransomware_signals row for the target
//     stream observed at/after `since`.
//   - "predicted_breach" / "lag_alert": the dr_predictions row for the target
//     stream whose forecast flipped to a breach forecast at/after `since` (the
//     forecaster's lag-driven early-warning).
//   - "topology_degraded": the latest dr_topology_edge health rollup for an edge
//     touching the target SITE that went non-healthy at/after `since` (the
//     block_site fault targets a site, so the signal is keyed by site, not stream).
//
// All reads run on the system (RLS-bypass) path because the orchestrator executes
// cross-tenant under the leader-singleton loop. An unknown kind returns
// (zero, false) so the step simply scores "signal not observed".
type drSignalSource struct {
	pool *pgxpool.Pool
}

const latestRansomwareSignalSQL = `
SELECT observed_at FROM dr_ransomware_signals
WHERE stream_id = $1 AND observed_at >= $2
ORDER BY observed_at DESC
LIMIT 1`

const latestBreachForecastSQL = `
SELECT forecast_at FROM dr_predictions
WHERE stream_id = $1 AND breach_forecast = true AND forecast_at >= $2
ORDER BY forecast_at DESC
LIMIT 1`

// latestTopologyDegradedSQL finds the most recent edge for the target SITE that
// went non-healthy at/after `since`. The block_site fault flips the blocked
// site's edges to 'unhealthy', so the signal is keyed by site (resolved to its
// edges via dr_topology_node), NOT by stream id.
const latestTopologyDegradedSQL = `
SELECT e.updated_at FROM dr_topology_edge e
WHERE EXISTS (
    SELECT 1 FROM dr_topology_node n
     WHERE n.site_id = $1 AND (n.id = e.from_node_id OR n.id = e.to_node_id)
) AND e.health IN ('degraded','unhealthy') AND e.updated_at >= $2
ORDER BY e.updated_at DESC
LIMIT 1`

func (s drSignalSource) LatestSignal(ctx context.Context, kind, target string, since time.Time) (gameday.Signal, bool, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return gameday.Signal{}, false, nil
	}
	var query string
	switch kind {
	case "ransomware":
		query = latestRansomwareSignalSQL
	case "predicted_breach", "lag_alert":
		query = latestBreachForecastSQL
	case "topology_degraded":
		query = latestTopologyDegradedSQL
	default:
		return gameday.Signal{}, false, nil
	}

	var observedAt time.Time
	err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, target, since.UTC()).Scan(&observedAt)
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return gameday.Signal{}, false, nil
	case err != nil:
		return gameday.Signal{}, false, fmt.Errorf("dr gameday signal source (%s): %w", kind, err)
	}
	return gameday.Signal{Kind: kind, Target: target, ObservedAt: observedAt.UTC()}, true, nil
}

// Compile-time checks that the orchestration collaborators satisfy the package
// contracts they are wired into.
var (
	_ runbookstudio.Executor   = (*runbookActionExecutor)(nil)
	_ bootgraph.Booter         = (*bootActionBooter)(nil)
	_ drservice.BootTierSource = bootgraphTierSource{}
	_ events.TypedEventHandler = (*drillScheduledConsumer)(nil)
	_ gameday.StreamController = drStreamController{}
	_ gameday.LagController    = drLagController{}
	_ gameday.SiteBlocker      = drSiteBlocker{}
	_ gameday.SignalSource     = drSignalSource{}
)
