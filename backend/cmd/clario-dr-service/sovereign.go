package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/assurance"
	"github.com/clario360/platform/internal/dr/attestledger"
	"github.com/clario360/platform/internal/dr/bcm"
	"github.com/clario360/platform/internal/dr/byok"
	"github.com/clario360/platform/internal/dr/cybervault"
	"github.com/clario360/platform/internal/dr/integrations"
	drmodel "github.com/clario360/platform/internal/dr/model"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/selfdr"
	drservice "github.com/clario360/platform/internal/dr/service"
	drworm "github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events"
	siemcrypto "github.com/clario360/platform/internal/siem/store/crypto"
)

// sovereignPlane bundles the ClarioDR sovereign-moat packages (bcm, assurance,
// selfdr, appverify, byok, attestledger, cybervault) so main wires them with a single call, mirroring the Batch A
// intelligencePlane, Batch B resiliencePlane, Batch C orchestrationPlane and
// Batch D coveragePlane. Each is constructed with the REAL DR collaborators —
// the live drillsched/attest/recovery-point/clean-room data sources for BCM
// evidence, the per-tenant DEK manager for BYOK rewrap, the WORM client for
// attestation-ledger anchoring, and tenant-scoped cyber-vault posture storage — no fakes, and exposes its HTTP surface for
// mounting under /api/v1/dr plus the leader-singleton loops and reconcile
// consumers it must run.
type sovereignPlane struct {
	// mount mounts each package's chi.Router onto the already-Auth+Tenant
	// protected /api/v1/dr group via route-walking (mountRoutes), preserving each
	// router's own RequirePermission gates.
	mount func(protected chi.Router)

	// startLeaderLoops launches the leader-singleton background loops, each gated
	// by Redis leader election like startRPOMonitor/startFailoverDriver:
	//   - attestledger periodic anchoring (role dr-attest-anchor, always), and
	//   - the BYOK rotation-recovery loop (role dr-byok-rotation), which completes
	//     rotations left stuck mid-flight.
	startLeaderLoops func(ctx context.Context)

	// reconcileConsumers are typed handlers that MUST run as a leader singleton
	// (cross-tenant derived writes): the attestation-ledger reconcile consumer,
	// which appends each DR attestation / clean-room verdict / drill outcome to the
	// tenant's tamper-evident ledger exactly once. Merged into the dr_db reconcile
	// consumer group alongside the registry/drill reconcile consumers.
	reconcileConsumers map[string][]events.TypedEventHandler

	// seed materializes the static BCM compliance-pack catalog into the
	// dr_bcm_pack / dr_bcm_pack_control reference tables (idempotent upsert) so the
	// packs are queryable/auditable in dr_db. Invoked once at startup.
	seed func(ctx context.Context) error

	// attestationLedger is shared with Recover evidence so generated procurement
	// reports append to the same tamper-evident DR attestation ledger.
	attestationLedger *attestledger.Recorder
}

// configureSovereignPlane constructs the three sovereign-moat packages with their
// real collaborators. dekMgr may be nil (Vault/WORM not configured): BYOK still
// enrolls/rotates software KEKs, but its rewrap path that touches the real
// per-tenant DEKs only operates when a DEK manager is wired. wormDEKs is the
// WORM-facing provider built over the same DEK manager; when present it is
// attached to the BYOK service so recovery-point, journal, instant-finalize, and
// attestation-ledger WORM seal/read all unwrap DEKs through the tenant KEK for
// enrolled tenants. wormClient may be nil too, in which case attestation-ledger
// anchoring records the Merkle root in dr_db (verifiable) without sealing the
// checkpoint object to WORM.
func configureSovereignPlane(
	ctx context.Context,
	db *pgxpool.Pool,
	redisClient *redis.Client,
	repo *drrepo.Repository,
	drSvc *drservice.Service,
	dekMgr siemcrypto.DEKManager,
	wormDEKs *sovereignWORMDEKProvider,
	wormClient *drworm.Client,
	resolver integrations.Resolver,
	dbURL string,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *sovereignPlane {
	plane := &sovereignPlane{
		reconcileConsumers: map[string][]events.TypedEventHandler{},
	}

	tenantRunner := sovereignTenantRunner{pool: db}
	systemRunner := drservice.NewPGXSystemRunner(db)

	// ---- bcm: business-continuity compliance packs ----------------------
	// The EvidenceCollector reads REAL DR data through narrow source interfaces,
	// each backed by a raw tenant-scoped query (the DBTX is the caller's open
	// tenant transaction, so RLS filters by tenant):
	//   - drills:          dr_drill_result (drillsched store output)
	//   - attestations:    attestation (internal/dr/attest builder output)
	//   - recovery points: recovery_point + WORM object-lock horizon (immutability)
	//   - failovers:       failover_run (completed runs)
	//   - clean-room:      dr_cleanroom_scan (cleanroom store verdicts)
	//   - topology:        consistency_group + members + replication_stream
	// A nil source would fail any control requiring it; every source is wired, so
	// the scorer evaluates against live evidence end to end.
	bcmCollector := bcm.NewEvidenceCollector(bcm.Sources{
		Drills:         bcmDrillSource{},
		Failovers:      bcmFailoverSource{},
		RecoveryPoints: bcmRecoveryPointSource{},
		Attestations:   bcmAttestationSource{},
		CleanRoom:      bcmCleanRoomSource{},
		Topology:       bcmTopologySource{},
	})
	bcmSvc := bcm.NewService(bcm.Config{
		Store:     bcm.NewStore(),
		Collector: bcmCollector,
		Runner:    bcm.PGXRunner{Pool: db},
		Metrics:   bcm.NewMetrics(metricsReg),
		Topic:     events.Topics.DREvents,
		Logger:    logger,
	})
	bcmRouter := bcm.NewRouter(bcmSvc, logger)
	plane.seed = func(seedCtx context.Context) error {
		return seedBCMPacks(seedCtx, db, logger)
	}

	// ---- assurance: continuous recovery-assurance scoring -----------------
	// Where bcm maps controls to regulatory standards, assurance scores the
	// group's continuous OPERATIONAL recovery KPIs (drill cadence/non-disruptive
	// success, app + clean-room verification, RPO-breach status, runbook
	// freshness, dependency/bootgraph validation, last failback test, evidence
	// recency) against the SAME live DR tables, through narrow per-kind sources:
	//   - drills:               dr_drill_result (also app-verification via its
	//                           validation_ratio/validation_outcome)
	//   - clean-room:           dr_cleanroom_scan
	//   - runbook review:       dr_recovery_runbook_version (current version)
	//   - dependency/bootgraph: dr_boot_run (terminal runs)
	//   - failback:             dr_failback_run (terminal runs)
	//   - rpo:                  dr_replication_samples joined to the group's
	//                           member streams (objective from protected_site)
	// Infrastructure-drift evidence is NOT yet persisted (the iacdr drift diff is
	// computed in-memory, not stored), so the Drift source is intentionally left
	// nil: the infra_drift control then reports a real "no drift evidence" gap
	// rather than vacuously passing — wire a DriftSource once drift snapshots are
	// persisted.
	assuranceCollector := assurance.NewCollector(assurance.Sources{
		Drills:    assuranceDrillSource{},
		App:       assuranceAppVerificationSource{},
		CleanRoom: assuranceCleanRoomSource{},
		Runbook:   assuranceRunbookReviewSource{},
		BootGraph: assuranceBootGraphSource{},
		Failback:  assuranceFailbackSource{},
		RPO:       assuranceRPOSource{},
	})
	assuranceSvc := assurance.NewService(assurance.Config{
		Store:     assurance.NewStore(),
		Collector: assuranceCollector,
		Runner:    assurance.PGXRunner{Pool: db},
		Metrics:   assurance.NewMetrics(metricsReg),
		Topic:     events.Topics.DREvents,
		Logger:    logger,
	})
	assuranceRouter := assurance.NewRouter(assuranceSvc, logger)

	// ---- selfdr: control-plane meta-DR (readiness + operational seal) ------
	// Self-DR answers "can the DR control plane recover ITSELF?" The service
	// assesses readiness by overlaying the REAL WORM-sealed evidence it holds onto
	// an operator-described (or baseline) profile, and performs two operational
	// capabilities, both sealing to the SAME DR WORM store the recovery-point
	// pipeline uses:
	//   - control-plane backup: pg_dump of dr_db -> sealed immutable artifact.
	//     Opt-in (DR_SELFDR_PGDUMP=1) because it shells out to pg_dump and embeds
	//     the dr_db DSN; off by default. Other component kinds are backed up by
	//     their own means (object replication, registry, git) — wire additional
	//     sources here as they are persisted.
	//   - offline restore bundle: deterministic tar.gz (profile + assessment +
	//     restore plan + runbook) -> sealed immutable artifact. Needs only WORM.
	// When WORM is not configured, readiness assessment still works; only the seal
	// paths return ErrSealingNotConfigured (the router maps this to 503).
	var selfdrSealer selfdr.Sealer
	if wormClient != nil {
		sealer, serr := selfdr.NewWORMSealer(wormClient, envOr("DR_SELFDR_LOCATION_ID", "dr-worm-primary"))
		if serr != nil {
			logger.Fatal().Err(serr).Msg("failed to construct dr selfdr WORM sealer")
		}
		selfdrSealer = sealer
	} else {
		logger.Warn().Msg("dr selfdr: WORM store not configured; readiness assessment works, but control-plane backup / offline-bundle sealing is unavailable")
	}

	selfdrCfg := selfdr.Config{
		Store:   selfdr.NewStore(),
		Runner:  selfdr.PGXRunner{Pool: db},
		Metrics: selfdr.NewMetrics(metricsReg),
		Topic:   events.Topics.DREvents,
		Logger:  logger,
	}
	if selfdrSealer != nil {
		bundleGen, gerr := selfdr.NewOfflineBundleGenerator(selfdr.OfflineBundleGeneratorConfig{Sealer: selfdrSealer})
		if gerr != nil {
			logger.Fatal().Err(gerr).Msg("failed to construct dr selfdr offline-bundle generator")
		}
		selfdrCfg.Bundle = bundleGen

		if envEnabled("DR_SELFDR_PGDUMP") && dbURL != "" {
			pgDump := selfdr.BackupCommand{
				Name: envOr("DR_SELFDR_PGDUMP_BIN", "pg_dump"),
				Args: []string{"--format=custom", "--no-owner", "--dbname", dbURL},
			}
			backupMgr, berr := selfdr.NewBackupManager(selfdr.BackupManagerConfig{
				Source: selfdr.NewCommandBackupSource(pgDump, selfdr.ExecCommandRunner{}),
				Sealer: selfdrSealer,
			})
			if berr != nil {
				logger.Fatal().Err(berr).Msg("failed to construct dr selfdr backup manager")
			}
			selfdrCfg.Backup = backupMgr
			logger.Info().Msg("dr selfdr: control-plane pg_dump backup capture enabled")
		}
	}
	selfdrSvc := selfdr.NewService(selfdrCfg)
	selfdrRouter := selfdr.NewRouter(selfdrSvc, logger)

	// ---- cybervault: external cyber-recovery vault posture ----------------
	// The service persists group-scoped vault inventory, scores vault-lock /
	// isolation / restore-drill posture with the deterministic evaluator, and
	// records latest assessments through the tenant RLS runner.
	//
	// Live posture refresh is attached as a PostureSource. When the integrations
	// catalog is enabled AND the deployment opts in (DR_CYBERVAULT_USE_INTEGRATIONS
	// =true), a resolver-backed source refreshes each vault's posture from the
	// cloud-backup posture GATEWAY whose URL/credentials come from the tenant's
	// active cloud_vault integration (aws_backup/azure_backup/gcp_backup_dr). With
	// the opt-in set, evaluating a vault requires an active cloud_vault integration
	// for the tenant (otherwise the refresh reports ErrSourceUnavailable). Leave the
	// opt-in OFF (the default) for manual/API-registered posture: no source is
	// attached and stored posture is scored directly, exactly as before.
	var cyberVaultSource cybervault.PostureSource
	if resolver != nil && envEnabled("DR_CYBERVAULT_USE_INTEGRATIONS") {
		cyberVaultSource = newResolverPostureSource(resolver, logger)
		logger.Info().Msg("dr cybervault: live posture refresh wired from the integrations catalog (cloud_vault gateway per tenant)")
	}
	cyberVaultSvc, err := cybervault.NewService(cybervault.Config{
		Store:  cybervault.NewStore(),
		Runner: cybervault.PGXRunner{Pool: db},
		Source: cyberVaultSource,
		Logger: logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr cybervault posture service")
	}
	cyberVaultRouter := cybervault.NewRouter(cyberVaultSvc, logger)

	// ---- byok: sovereign bring-your-own-key custody ---------------------
	// The SoftwareKeyProvider (MemoryProviderFactory) is the default custody mode;
	// when DR_BYOK_KMS_ENDPOINT is configured the factory ALSO custodies hsm/kms
	// KEKs via the RemoteKeyProvider, with software remaining the fallback for
	// software-provider enrollments. The DEK source is the REAL per-tenant DEK
	// manager (internal/siem/store/crypto) via an adapter, so rotation rewraps the
	// ACTUAL DEKs (unwrap-with-old -> wrap-with-new) rather than synthetic keys.
	byokFactory, err := newSovereignKeyProviderFactory(tenantRunner, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr byok key provider factory")
	}
	byokDeps := byok.Deps{
		Store:   byok.NewStore(),
		Runner:  tenantRunner,
		System:  systemRunner,
		Factory: byokFactory,
		Metrics: byok.NewMetrics(metricsReg),
		Logger:  logger,
	}
	if dekMgr != nil {
		// Wire the real DEK source so WrapDEK/rewrap operate on the live per-tenant
		// DEKs the WORM recovery-point store seals with.
		byokDeps.DEKSource = sovereignDEKSource{mgr: dekMgr}
	} else {
		logger.Warn().Msg("dr byok: no DEK manager configured (Vault/WORM unset); enroll/rotate of software KEKs works, but wrap/rewrap of real DEKs is unavailable until a DEK source is wired")
	}
	byokSvc, err := byok.NewService(byokDeps)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr byok custody service")
	}
	if wormDEKs != nil {
		wormDEKs.AttachBYOK(byokSvc)
		logger.Info().Msg("dr byok: WORM recovery-point encryption path gated by tenant KEK for enrolled tenants")
	}
	byokRouter := byok.NewRouter(byokSvc, logger)
	// Rotation is request-driven via POST /byok/keys/rotate. The background
	// rotation-recovery loop only completes rotations a crash left mid-flight; it
	// runs as a leader-singleton (role dr-byok-rotation).
	byokLoop, err := byok.NewRotationLoop(byok.RotationLoopConfig{
		Driver:   byokSvc,
		Store:    byok.NewStore(),
		System:   systemRunner,
		Logger:   logger,
		Interval: durationEnv("DR_BYOK_ROTATION_INTERVAL", 5*time.Second),
		Batch:    intEnv("DR_BYOK_ROTATION_BATCH", 0),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr byok rotation loop")
	}

	// ---- attestledger: tamper-evident attestation ledger ----------------
	// The Recorder is the recorder + verifier (Append / Verify / Anchor /
	// inclusion proofs). The REAL WORM client anchors each Merkle checkpoint as a
	// GOVERNANCE-locked object; when WORM is not configured the root is still
	// recorded in dr_db (DB-verifiable). The reconcile consumer CONSUMES the DR
	// attestation sources (attestation.issued / clean-room verdict / drill
	// outcome) and Appends them to the ledger exactly once (leader singleton).
	var ledgerSealer attestledger.Sealer
	if wormClient != nil {
		sealer, serr := attestledger.NewWORMSealer(wormClient)
		if serr != nil {
			logger.Fatal().Err(serr).Msg("failed to construct dr attestation-ledger WORM sealer")
		}
		ledgerSealer = sealer
	} else {
		logger.Warn().Msg("dr attestation-ledger: WORM store not configured; checkpoints record the Merkle root in dr_db (verifiable) but are not sealed to object storage")
	}
	ledgerRunner := attestledger.PGXRunner{Pool: db}
	recorder, err := attestledger.NewRecorder(attestledger.Config{
		TX:      ledgerRunner,
		System:  ledgerRunner,
		Store:   attestledger.NewStore(),
		Stager:  attestledger.OutboxStager{},
		Sealer:  ledgerSealer,
		Metrics: attestledger.NewMetrics(metricsReg),
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr attestation-ledger recorder")
	}
	plane.attestationLedger = recorder
	ledgerHandler := attestledger.NewHandler(recorder, logger)
	ledgerLoop, err := attestledger.NewLoop(attestledger.LoopConfig{
		Service:  recorder,
		Logger:   logger,
		Interval: durationEnv("DR_ATTEST_ANCHOR_INTERVAL", 5*time.Minute),
		Batch:    intEnv("DR_ATTEST_ANCHOR_BATCH", 0),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr attestation-ledger anchor loop")
	}
	ledgerConsumer := newAttestLedgerConsumer(recorder, db, logger)
	plane.reconcileConsumers[events.Topics.DREvents] = append(
		plane.reconcileConsumers[events.Topics.DREvents], ledgerConsumer)

	// ---- appverify: application-verification result projection ------------
	// App-level verification is already load-bearing in the failover gate
	// (WorkloadHealthValidator: a recovered workload must pass its app checks
	// before attestation); the gate emits datastream.dr.failover.recovery.validated
	// carrying the per-workload results. This reconcile consumer projects those
	// results into the dedicated, queryable dr_appverify_result table (leader
	// singleton + idempotent (run_id, site_id) upsert), and the read router exposes
	// the history per group. Nothing here touches the hot failover path — it only
	// consumes an event the gate already published.
	appverifyStore := appverify.NewStore()
	appverifyRunner := appverify.PGXRunner{Pool: db}
	appverifyRouter := appverify.NewRouter(appverify.NewQueryService(appverifyStore, appverifyRunner), logger)
	appverifyProjector := appverify.NewResultProjector(appverifyStore, appverifyRunner, events.Topics.DREvents, logger)
	plane.reconcileConsumers[events.Topics.DREvents] = append(
		plane.reconcileConsumers[events.Topics.DREvents], appverifyProjector)

	// ---- HTTP mounting --------------------------------------------------
	// Each package's Router self-gates with RequirePermission per route, so all
	// sovereign routers mount under the already-Auth+Tenant /api/v1/dr group
	// at "/" via route-walking (mountRoutes) rather than repeated Mount("/", ...):
	//   - bcm:          dr:read (packs/report), dr:write (run-assessment).
	//   - assurance:    dr:read (controls/report/latest), dr:write (run-evaluation).
	//   - selfdr:       dr:read (components/report/artifacts), dr:write (assess), dr:admin (backup/bundle).
	//   - cybervault:   dr:read (inventory/assessments), dr:write (register/evaluate).
	//   - appverify:    dr:read (app-verification result history).
	//   - byok:         dr:read (versions/custody-log), dr:admin (enroll/rotate).
	//   - attestledger: dr:read (list/verify/proof), dr:admin (force an anchor).
	plane.mount = func(protected chi.Router) {
		mountRoutes(protected, bcmRouter.Routes())
		mountRoutes(protected, assuranceRouter.Routes())
		mountRoutes(protected, selfdrRouter.Routes())
		mountRoutes(protected, cyberVaultRouter.Routes())
		mountRoutes(protected, appverifyRouter.Routes())
		mountRoutes(protected, byokRouter.Routes())
		mountRoutes(protected, ledgerHandler.Routes())
	}

	// ---- leader-singleton background loops ------------------------------
	plane.startLeaderLoops = func(loopCtx context.Context) {
		// attestation-ledger anchoring: a single leader seals a fresh Merkle
		// checkpoint per tenant with unanchored entries, so the WORM-anchored
		// tamper-proof checkpoints advance without a human pressing "anchor".
		runLeaderSingleton(loopCtx, redisClient, "dr-attest-anchor",
			"DR_ATTEST_ANCHOR", logger, ledgerLoop.Run, nil)
		// byok rotation-recovery: a single leader resumes rotations a crash left in
		// the 'rotating' state (rewrap remaining DEKs + atomic flip).
		runLeaderSingleton(loopCtx, redisClient, "dr-byok-rotation",
			"DR_BYOK_ROTATION", logger, byokLoop.Run, nil)
	}

	return plane
}

// ---------------------------------------------------------------------------
// shared sovereign collaborators
// ---------------------------------------------------------------------------

// sovereignTenantRunner adapts the DR pool to the tenant-scoped transaction
// runner the byok service expects (RLS SET LOCAL app.current_tenant_id). It is
// one adapter satisfying byok.TenantRunner.
type sovereignTenantRunner struct{ pool *pgxpool.Pool }

func (r sovereignTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	if r.pool == nil {
		return errors.New("dr sovereign: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r sovereignTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	if r.pool == nil {
		return errors.New("dr sovereign: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// ---------------------------------------------------------------------------
// byok: provider factory (software default, remote hsm/kms when configured) +
// real per-tenant DEK source adapter
// ---------------------------------------------------------------------------

// sovereignKeyProviderFactory is the production byok.ProviderFactory. It always
// custodies software KEKs through the bundled fully-real MemoryProviderFactory
// (AES-256-GCM envelope encryption), and ALSO custodies hsm/kms KEKs through the
// RemoteKeyProvider when DR_BYOK_KMS_ENDPOINT is configured. A hsm/kms
// enrollment when no remote endpoint is configured is rejected, so a KEK row can
// never reference a custody backend that has no client.
type sovereignKeyProviderFactory struct {
	software   byok.ProviderFactory // sealed persistent keystore in prod; memory only in dev
	remoteURL  string
	remoteAuth string
	logger     zerolog.Logger
}

// newSovereignKeyProviderFactory builds the factory, reading the optional remote
// custody endpoint from the environment. When DR_BYOK_KMS_ENDPOINT is set, hsm
// and kms enrollments are routed to the RemoteKeyProvider against it.
//
// Software KEK custody defaults to the SEALED, persistent keystore when
// DR_BYOK_ROOT_KEY is set: each minted tenant KEK is envelope-encrypted under the
// operator root key and persisted to dr_sealed_kek, so a restart recovers every
// KEK (no orphaned DEKs). It falls back to the volatile in-memory keystore only
// when no root key is present (dev/non-prod); config.Load already blocks that in
// production. The tenant runner is the same one the byok Service uses, so the
// sealed store's RLS-scoped reads/writes match the rest of dr_db.
func newSovereignKeyProviderFactory(runner sovereignTenantRunner, logger zerolog.Logger) (*sovereignKeyProviderFactory, error) {
	scoped := logger.With().Str("component", "dr_byok_factory").Logger()

	var software byok.ProviderFactory
	if b64 := strings.TrimSpace(envOr("DR_BYOK_ROOT_KEY", "")); b64 != "" {
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(raw) != byok.RootKeyBytes {
			return nil, fmt.Errorf("dr byok: DR_BYOK_ROOT_KEY must be base64 %d bytes: %v", byok.RootKeyBytes, err)
		}
		sum := sha256.Sum256(raw)
		rootID := "env:" + hex.EncodeToString(sum[:8]) // non-secret fingerprint label
		store, err := byok.NewPGSealedKEKStore(runner)
		if err != nil {
			return nil, err
		}
		software, err = byok.NewSealedProviderFactory(byok.RootKey{ID: rootID, Key: raw}, store)
		if err != nil {
			return nil, err
		}
		scoped.Info().Str("root_key_id", rootID).Msg("dr byok: SEALED persistent software keystore wired (restart-safe)")
	} else {
		software = byok.NewMemoryProviderFactory() // dev/non-prod only; config.Load blocks this in production
		scoped.Warn().Msg("dr byok: using VOLATILE in-memory software keystore (dev only); set DR_BYOK_ROOT_KEY for restart-safe sealed custody")
	}

	f := &sovereignKeyProviderFactory{
		software:   software,
		remoteURL:  strings.TrimSpace(envOr("DR_BYOK_KMS_ENDPOINT", "")),
		remoteAuth: envOr("DR_BYOK_KMS_AUTH_HEADER", ""),
		logger:     scoped,
	}
	if f.remoteURL != "" {
		f.logger.Info().Str("endpoint", f.remoteURL).Msg("dr byok remote custody (hsm/kms) wired from config")
	}
	return f, nil
}

// Provider implements byok.ProviderFactory. Software KEKs delegate to the
// in-process keystore; hsm/kms KEKs build a RemoteKeyProvider against the
// configured endpoint. For a remote enroll/rotate (newKEK) the returned newRef
// is a deterministic per-tenant key handle the custodian materializes behind.
func (f *sovereignKeyProviderFactory) Provider(ctx context.Context, tenantID uuid.UUID, provider, ref string, version int, newKEK bool) (byok.KeyProvider, string, error) {
	switch provider {
	case "", byok.ProviderSoftware:
		return f.software.Provider(ctx, tenantID, byok.ProviderSoftware, ref, version, newKEK)
	case byok.ProviderHSM, byok.ProviderKMS:
		if f.remoteURL == "" {
			return nil, "", fmt.Errorf("dr byok: %s custody requires DR_BYOK_KMS_ENDPOINT to be configured", provider)
		}
		keyRef := ref
		if newKEK || keyRef == "" {
			// Deterministic per-tenant key handle the remote custodian materializes
			// the requested version behind; stable across rotations so the custodian
			// versions one logical key.
			keyRef = fmt.Sprintf("dr-byok/%s", tenantID.String())
		}
		kp, err := byok.NewRemoteKeyProvider(byok.RemoteKeyProviderConfig{
			Kind:       provider,
			BaseURL:    f.remoteURL,
			KeyRef:     keyRef,
			Version:    version,
			AuthHeader: f.remoteAuth,
		})
		if err != nil {
			return nil, "", err
		}
		return kp, keyRef, nil
	default:
		return nil, "", fmt.Errorf("dr byok: unknown provider %q", provider)
	}
}

// sovereignDEKSource adapts the platform's per-tenant DEKManager
// (internal/siem/store/crypto) to byok.DEKSource WITHOUT importing/modifying it:
// GetDEK delegates to DEKManager.Get(ctx, tenantID, dekID), returning a COPY of
// the DEK plaintext. DEKManager owns/cache-manages its returned slice, while BYOK
// deliberately zeroes the slice it receives after wrapping; copying keeps BYOK's
// zeroing discipline from corrupting the live DEK cache. The KEK version the
// manager reports is its own Vault-transit KEK and is irrelevant to BYOK's
// sovereign KEK wrapping.
type sovereignDEKSource struct{ mgr siemcrypto.DEKManager }

func (s sovereignDEKSource) GetDEK(ctx context.Context, tenantID uuid.UUID, dekID string) ([]byte, error) {
	if s.mgr == nil {
		return nil, errors.New("dr byok: nil DEK manager")
	}
	dek, _, err := s.mgr.Get(ctx, tenantID, dekID)
	if err != nil {
		return nil, fmt.Errorf("dr byok: fetching DEK %q: %w", dekID, err)
	}
	out := make([]byte, len(dek))
	copy(out, dek)
	return out, nil
}

// ---------------------------------------------------------------------------
// bcm: REAL evidence sources backed by raw tenant-scoped queries
// ---------------------------------------------------------------------------
// Each source runs its read through the DBTX the collector passes (the caller's
// open tenant transaction), so RLS filters by tenant. They are coverage-owned
// reads of the live DR tables — they never write — so they reuse the existing
// stores' data without coupling to those packages' Go APIs.

// bcmDrillSource yields drill results for a group from dr_drill_result (the
// drillsched store output).
type bcmDrillSource struct{}

const bcmDrillsSQL = `
SELECT id, group_id, passed, rto_achieved_seconds, rto_objective_seconds,
       rpo_achieved_seconds, observed_at
FROM dr_drill_result
WHERE tenant_id = $1 AND group_id = $2
ORDER BY observed_at DESC`

func (bcmDrillSource) DrillEvidence(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) ([]bcm.DrillEvidence, error) {
	rows, err := db.Query(ctx, bcmDrillsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query dr drill evidence: %w", err)
	}
	defer rows.Close()
	var out []bcm.DrillEvidence
	for rows.Next() {
		var e bcm.DrillEvidence
		if err := rows.Scan(&e.ID, &e.GroupID, &e.Passed, &e.RTOActualSeconds,
			&e.RTOObjectiveSeconds, &e.RPOSeconds, &e.ExecutedAt); err != nil {
			return nil, fmt.Errorf("scan dr drill evidence: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// bcmFailoverSource yields completed failover/drill runs for a group from
// failover_run (completed runs carry an actual RTO).
type bcmFailoverSource struct{}

const bcmFailoversSQL = `
SELECT id, group_id, mode, status,
       COALESCE(rto_actual_seconds, EXTRACT(EPOCH FROM (completed_at - initiated_at))::INT, 0),
       rto_objective_seconds, completed_at
FROM failover_run
WHERE tenant_id = $1 AND group_id = $2 AND status = $3 AND completed_at IS NOT NULL
ORDER BY completed_at DESC`

func (bcmFailoverSource) FailoverEvidence(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) ([]bcm.FailoverEvidence, error) {
	rows, err := db.Query(ctx, bcmFailoversSQL, tenantID, groupID, drmodel.StatusCompleted)
	if err != nil {
		return nil, fmt.Errorf("query dr failover evidence: %w", err)
	}
	defer rows.Close()
	var out []bcm.FailoverEvidence
	for rows.Next() {
		var e bcm.FailoverEvidence
		if err := rows.Scan(&e.ID, &e.GroupID, &e.Mode, &e.Status,
			&e.RTOActualSeconds, &e.RTOObjectiveSeconds, &e.CompletedAt); err != nil {
			return nil, fmt.Errorf("scan dr failover evidence: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// bcmRecoveryPointSource yields recovery points for a group from recovery_point,
// deriving immutability from the WORM object-lock horizon: a point is immutable
// when its retention_until is still in the future (the sealed objects are under
// object-lock until then).
type bcmRecoveryPointSource struct{}

const bcmRecoveryPointsSQL = `
SELECT id, group_id, rpo_seconds, COALESCE(validation_ratio, 0), is_validated,
       (retention_until > now()) AS immutable, sealed_at, retention_until
FROM recovery_point
WHERE tenant_id = $1 AND group_id = $2
ORDER BY sealed_at DESC`

func (bcmRecoveryPointSource) RecoveryPointEvidence(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) ([]bcm.RecoveryPointEvidence, error) {
	rows, err := db.Query(ctx, bcmRecoveryPointsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query dr recovery-point evidence: %w", err)
	}
	defer rows.Close()
	var out []bcm.RecoveryPointEvidence
	for rows.Next() {
		var e bcm.RecoveryPointEvidence
		if err := rows.Scan(&e.ID, &e.GroupID, &e.RPOSeconds, &e.ValidationRatio,
			&e.IsValidated, &e.Immutable, &e.SealedAt, &e.RetentionUntil); err != nil {
			return nil, fmt.Errorf("scan dr recovery-point evidence: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// bcmAttestationSource yields immutable attestations for a group by joining
// attestation to its failover_run (attestation has no group_id of its own; the
// run carries the group). The attestation table is the internal/dr/attest
// builder output.
type bcmAttestationSource struct{}

const bcmAttestationsSQL = `
SELECT a.id, r.group_id, a.run_id, a.rto_objective_seconds, a.rto_actual_seconds,
       a.rpo_seconds, a.validation_ratio, a.created_at
FROM attestation a
JOIN failover_run r ON r.id = a.run_id AND r.tenant_id = a.tenant_id
WHERE a.tenant_id = $1 AND r.group_id = $2
ORDER BY a.created_at DESC`

func (bcmAttestationSource) AttestationEvidence(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) ([]bcm.AttestationEvidence, error) {
	rows, err := db.Query(ctx, bcmAttestationsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query dr attestation evidence: %w", err)
	}
	defer rows.Close()
	var out []bcm.AttestationEvidence
	for rows.Next() {
		var e bcm.AttestationEvidence
		if err := rows.Scan(&e.ID, &e.GroupID, &e.RunID, &e.RTOObjectiveSeconds,
			&e.RTOActualSeconds, &e.RPOSeconds, &e.ValidationRatio, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan dr attestation evidence: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// bcmCleanRoomSource yields clean-room scan verdicts for a group from
// dr_cleanroom_scan (the cleanroom store output). Clean is true only for the
// 'clean' verdict.
type bcmCleanRoomSource struct{}

const bcmCleanRoomSQL = `
SELECT id, group_id, verdict, (verdict = 'clean') AS clean, finished_at
FROM dr_cleanroom_scan
WHERE tenant_id = $1 AND group_id = $2
ORDER BY finished_at DESC`

func (bcmCleanRoomSource) CleanRoomEvidence(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) ([]bcm.CleanRoomEvidence, error) {
	rows, err := db.Query(ctx, bcmCleanRoomSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query dr clean-room evidence: %w", err)
	}
	defer rows.Close()
	var out []bcm.CleanRoomEvidence
	for rows.Next() {
		var e bcm.CleanRoomEvidence
		if err := rows.Scan(&e.ID, &e.GroupID, &e.Verdict, &e.Clean, &e.VerifiedAt); err != nil {
			return nil, fmt.Errorf("scan dr clean-room evidence: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// bcmTopologySource yields the group's structural topology: its member-site
// count and whether any member has a replication stream. Exists is false when no
// group of the requested id is found in the tenant's scope.
type bcmTopologySource struct{}

const bcmTopologySQL = `
SELECT g.name,
       COUNT(DISTINCT ps.id)::INT AS member_count,
       COUNT(DISTINCT s.id)::INT > 0 AS has_stream
FROM consistency_group g
LEFT JOIN consistency_group_member m ON m.group_id = g.id
LEFT JOIN protected_site ps ON ps.id = m.site_id AND ps.tenant_id = g.tenant_id
LEFT JOIN replication_stream s ON s.tenant_id = g.tenant_id AND s.site_id = ps.id
WHERE g.tenant_id = $1 AND g.id = $2
GROUP BY g.id, g.name`

func (bcmTopologySource) GroupTopology(ctx context.Context, db bcm.DBTX, tenantID, groupID uuid.UUID) (bcm.GroupTopology, error) {
	topo := bcm.GroupTopology{GroupID: groupID}
	err := db.QueryRow(ctx, bcmTopologySQL, tenantID, groupID).Scan(&topo.Name, &topo.MemberCount, &topo.HasStream)
	if errors.Is(err, pgx.ErrNoRows) {
		topo.Exists = false
		return topo, nil
	}
	if err != nil {
		return topo, fmt.Errorf("query dr group topology: %w", err)
	}
	topo.Exists = true
	return topo, nil
}

// ---------------------------------------------------------------------------
// assurance: REAL evidence sources backed by raw tenant-scoped queries
// ---------------------------------------------------------------------------
// Like the bcm sources, each runs through the DBTX the collector passes (the
// caller's open tenant transaction, so RLS filters by tenant) and only READS the
// live DR tables — never writes. The assurance evidence model is per-kind, so
// there is one narrow source per verification class. uuid columns destined for
// the assurance model's string ids are cast ::text in SQL so they scan straight
// into plain strings.

// assuranceDrillStep is one timeline step decoded from dr_drill_result.steps to
// derive per-drill warnings and failed-step keys (the JSONB shape the drill diff
// engine records: {"key","title","status","duration_ms"}).
type assuranceDrillStep struct {
	Key    string `json:"key"`
	Status string `json:"status"`
}

// assuranceDrillStepStatus decodes the step timeline and returns the warning
// count and the keys of steps that did not pass. A malformed/empty timeline
// yields zero warnings and no failed steps (the drill's overall passed flag still
// governs the cadence verdict).
func assuranceDrillStepStatus(raw []byte) (warnings int, failed []string) {
	if len(raw) == 0 {
		return 0, nil
	}
	var steps []assuranceDrillStep
	if err := json.Unmarshal(raw, &steps); err != nil {
		return 0, nil
	}
	for _, s := range steps {
		switch strings.ToLower(strings.TrimSpace(s.Status)) {
		case "", "passed", "pass", "success", "succeeded", "ok", "completed", "complete", "done", "skipped", "skip":
			// step is healthy
		case "warning", "warn", "degraded":
			warnings++
		default:
			key := s.Key
			if key == "" {
				key = "step"
			}
			failed = append(failed, key)
		}
	}
	return warnings, failed
}

// assuranceDrillSource yields recovery-drill results for a group from
// dr_drill_result. A scheduled drill is a non-disruptive recovery rehearsal, so
// NonDisruptive is true; warnings and failed-step keys are derived from the
// recorded step timeline.
type assuranceDrillSource struct{}

const assuranceDrillsSQL = `
SELECT id::text, run_id, COALESCE(schedule_id::text, ''), passed,
       rto_objective_seconds, rto_achieved_seconds,
       rpo_objective_seconds, rpo_achieved_seconds, observed_at, steps
FROM dr_drill_result
WHERE tenant_id = $1 AND group_id = $2
ORDER BY observed_at DESC`

func (assuranceDrillSource) DrillEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.DrillEvidence, error) {
	rows, err := db.Query(ctx, assuranceDrillsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance drill evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.DrillEvidence
	for rows.Next() {
		var (
			e        assurance.DrillEvidence
			stepsRaw []byte
		)
		if err := rows.Scan(&e.ID, &e.RunID, &e.ScheduleID, &e.Passed,
			&e.RTOObjectiveSeconds, &e.RTOAchievedSeconds,
			&e.RPOObjectiveSeconds, &e.RPOAchievedSeconds, &e.ExecutedAt, &stepsRaw); err != nil {
			return nil, fmt.Errorf("scan assurance drill evidence: %w", err)
		}
		e.CompletedAt = e.ExecutedAt
		e.NonDisruptive = true
		e.Warnings, e.FailedSteps = assuranceDrillStepStatus(stepsRaw)
		out = append(out, e)
	}
	return out, rows.Err()
}

// assuranceAppVerificationSource yields application-layer verification evidence
// for a group from the validation outcome a drill recorded against the recovered
// workload (dr_drill_result.validation_ratio / validation_outcome). The pass
// ratio is carried as checks_passed/checks_total over a 10000-point scale so the
// evaluator compares it against the profile's minimum app-verification ratio.
type assuranceAppVerificationSource struct{}

const assuranceAppVerificationSQL = `
SELECT id::text, run_id, passed, COALESCE(validation_ratio, 0)::float8,
       validation_outcome, observed_at
FROM dr_drill_result
WHERE tenant_id = $1 AND group_id = $2
  AND (validation_ratio IS NOT NULL OR validation_outcome <> '')
ORDER BY observed_at DESC`

func (assuranceAppVerificationSource) AppVerificationEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.VerificationEvidence, error) {
	rows, err := db.Query(ctx, assuranceAppVerificationSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance app-verification evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.VerificationEvidence
	for rows.Next() {
		var (
			e      assurance.VerificationEvidence
			passed bool
			ratio  float64
		)
		if err := rows.Scan(&e.ID, &e.RunID, &passed, &ratio, &e.Message, &e.VerifiedAt); err != nil {
			return nil, fmt.Errorf("scan assurance app-verification evidence: %w", err)
		}
		e.Kind = assurance.VerificationApp
		e.ChecksTotal = 10000
		e.ChecksPassed = clampRatioChecks(ratio, e.ChecksTotal)
		e.Passed = passed && ratio > 0
		out = append(out, e)
	}
	return out, rows.Err()
}

// clampRatioChecks maps a 0..1 ratio onto an integer checks-passed count over
// total, rounding to nearest and clamping into [0,total].
func clampRatioChecks(ratio float64, total int) int {
	if ratio <= 0 {
		return 0
	}
	if ratio >= 1 {
		return total
	}
	return int(ratio*float64(total) + 0.5)
}

// assuranceCleanRoomSource yields clean-room verification evidence for a group
// from dr_cleanroom_scan. Only the 'clean' verdict passes; chunks_scanned is the
// work quantum so a verdict is not mistaken for a vacuous "nothing scanned" pass.
type assuranceCleanRoomSource struct{}

const assuranceCleanRoomSQL = `
SELECT id::text, COALESCE(recovery_point_id::text, ''), verdict, chunks_scanned,
       finished_at, detail
FROM dr_cleanroom_scan
WHERE tenant_id = $1 AND group_id = $2
ORDER BY finished_at DESC`

func (assuranceCleanRoomSource) CleanRoomVerificationEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.VerificationEvidence, error) {
	rows, err := db.Query(ctx, assuranceCleanRoomSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance clean-room evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.VerificationEvidence
	for rows.Next() {
		var (
			e       assurance.VerificationEvidence
			verdict string
			chunks  int
		)
		if err := rows.Scan(&e.ID, &e.RunID, &verdict, &chunks, &e.VerifiedAt, &e.Message); err != nil {
			return nil, fmt.Errorf("scan assurance clean-room evidence: %w", err)
		}
		e.Kind = assurance.VerificationCleanRoom
		e.Passed = verdict == "clean"
		e.ChecksTotal = chunks
		if e.Passed {
			e.ChecksPassed = chunks
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// assuranceRunbookReviewSource yields runbook-review evidence for a group: the
// existence of the current materialized runbook version (dr_recovery_runbook_version
// joined to its runbook's current_version) is the review/refresh proof, dated by
// when that version was generated.
type assuranceRunbookReviewSource struct{}

const assuranceRunbookReviewSQL = `
SELECT v.id::text, v.version, v.created_at
FROM dr_recovery_runbook_version v
JOIN dr_recovery_runbook r ON r.id = v.runbook_id AND r.current_version = v.version
WHERE v.tenant_id = $1 AND v.group_id = $2
ORDER BY v.created_at DESC`

func (assuranceRunbookReviewSource) RunbookReviewEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.VerificationEvidence, error) {
	rows, err := db.Query(ctx, assuranceRunbookReviewSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance runbook-review evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.VerificationEvidence
	for rows.Next() {
		var (
			e       assurance.VerificationEvidence
			version int
		)
		if err := rows.Scan(&e.ID, &version, &e.VerifiedAt); err != nil {
			return nil, fmt.Errorf("scan assurance runbook-review evidence: %w", err)
		}
		e.Kind = assurance.VerificationRunbookReview
		e.Passed = true
		e.Message = fmt.Sprintf("current recovery runbook version %d", version)
		out = append(out, e)
	}
	return out, rows.Err()
}

// assuranceBootGraphSource yields dependency/bootgraph validation evidence for a
// group from terminal boot runs (dr_boot_run). A 'completed' run passed; the
// tiers-booted/total ratio is carried as the check counts.
type assuranceBootGraphSource struct{}

const assuranceBootGraphSQL = `
SELECT id::text, status, total_tiers, tiers_booted,
       COALESCE(completed_at, started_at), COALESCE(last_error, '')
FROM dr_boot_run
WHERE tenant_id = $1 AND group_id = $2
  AND status IN ('completed', 'failed', 'rolled_back')
ORDER BY COALESCE(completed_at, started_at) DESC`

func (assuranceBootGraphSource) BootGraphVerificationEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.VerificationEvidence, error) {
	rows, err := db.Query(ctx, assuranceBootGraphSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance bootgraph evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.VerificationEvidence
	for rows.Next() {
		var (
			e      assurance.VerificationEvidence
			status string
			total  int
			booted int
		)
		if err := rows.Scan(&e.ID, &status, &total, &booted, &e.VerifiedAt, &e.Message); err != nil {
			return nil, fmt.Errorf("scan assurance bootgraph evidence: %w", err)
		}
		e.Kind = assurance.VerificationDependencyBootGraph
		e.Passed = status == "completed"
		e.ChecksTotal = total
		e.ChecksPassed = booted
		if e.Passed && total > 0 && booted < total {
			e.Warnings = 1
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// assuranceFailbackSource yields failback-test evidence for a group from terminal
// failback runs (dr_failback_run). A 'COMPLETED' run passed.
type assuranceFailbackSource struct{}

const assuranceFailbackSQL = `
SELECT id::text, COALESCE(failover_run_id::text, ''), status,
       COALESCE(completed_at, initiated_at), COALESCE(last_error, '')
FROM dr_failback_run
WHERE tenant_id = $1 AND group_id = $2
  AND status IN ('COMPLETED', 'FAILED')
ORDER BY COALESCE(completed_at, initiated_at) DESC`

func (assuranceFailbackSource) FailbackVerificationEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.VerificationEvidence, error) {
	rows, err := db.Query(ctx, assuranceFailbackSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance failback evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.VerificationEvidence
	for rows.Next() {
		var (
			e      assurance.VerificationEvidence
			status string
		)
		if err := rows.Scan(&e.ID, &e.RunID, &status, &e.VerifiedAt, &e.Message); err != nil {
			return nil, fmt.Errorf("scan assurance failback evidence: %w", err)
		}
		e.Kind = assurance.VerificationFailback
		e.Passed = status == "COMPLETED"
		out = append(out, e)
	}
	return out, rows.Err()
}

// assuranceRPOSource yields observed replication-lag (RPO) samples for a group by
// joining dr_replication_samples to the group's member streams (stream -> site ->
// consistency_group_member) and taking each site's RPO objective from
// protected_site. The evaluator scores the most recent sample.
type assuranceRPOSource struct{}

const assuranceRPOSQL = `
SELECT s.id::text, st.id::text, ps.rpo_objective_seconds, s.lag_seconds, s.observed_at
FROM dr_replication_samples s
JOIN replication_stream st ON st.id = s.stream_id AND st.tenant_id = s.tenant_id
JOIN consistency_group_member m ON m.site_id = st.site_id
JOIN protected_site ps ON ps.id = st.site_id AND ps.tenant_id = s.tenant_id
WHERE s.tenant_id = $1 AND m.group_id = $2
ORDER BY s.observed_at DESC
LIMIT 200`

func (assuranceRPOSource) RPOEvidence(ctx context.Context, db assurance.DBTX, tenantID, groupID uuid.UUID) ([]assurance.RPOEvidence, error) {
	rows, err := db.Query(ctx, assuranceRPOSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("query assurance rpo evidence: %w", err)
	}
	defer rows.Close()
	var out []assurance.RPOEvidence
	for rows.Next() {
		var (
			e   assurance.RPOEvidence
			lag float64
		)
		if err := rows.Scan(&e.ID, &e.ReplicationStreamID, &e.ObjectiveSeconds, &lag, &e.MeasuredAt); err != nil {
			return nil, fmt.Errorf("scan assurance rpo evidence: %w", err)
		}
		e.ActualLagSeconds = int(lag + 0.5)
		e.Breached = e.ObjectiveSeconds > 0 && e.ActualLagSeconds > e.ObjectiveSeconds
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// bcm: startup pack seeder (static catalog -> dr_bcm_pack reference tables)
// ---------------------------------------------------------------------------

// seedBCMPacks idempotently materializes the in-code BCM compliance-pack catalog
// into the dr_bcm_pack / dr_bcm_pack_control reference tables so the packs (and
// their controls) are queryable/auditable in dr_db and FK-referenceable. The
// catalog itself remains code-of-record (deterministic, validated at init); this
// is a derived reference projection, upserted on every startup so a catalog
// change converges the rows. It runs on the system (RLS-bypass) path because the
// reference tables are tenant-independent global catalog data.
func seedBCMPacks(ctx context.Context, db *pgxpool.Pool, logger zerolog.Logger) error {
	packs := bcm.Packs()
	err := database.RunSystemTx(ctx, db, func(tx pgx.Tx) error {
		for _, p := range packs {
			if _, err := tx.Exec(ctx, seedPackSQL,
				p.Key, p.Standard, p.Version, p.Authority, p.Title, p.Description, len(p.Controls),
			); err != nil {
				return fmt.Errorf("upsert bcm pack %q: %w", p.Key, err)
			}
			for _, c := range p.Controls {
				required, merr := json.Marshal(c.RequiredEvidence)
				if merr != nil {
					return fmt.Errorf("marshal required evidence for %s/%s: %w", p.Key, c.Code, merr)
				}
				rule, merr := json.Marshal(c.Rule)
				if merr != nil {
					return fmt.Errorf("marshal rule for %s/%s: %w", p.Key, c.Code, merr)
				}
				if _, err := tx.Exec(ctx, seedPackControlSQL,
					p.Key, c.Code, c.Title, c.Description, required, rule, c.Weight, c.Mandatory,
				); err != nil {
					return fmt.Errorf("upsert bcm pack control %s/%s: %w", p.Key, c.Code, err)
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	logger.Info().Int("packs", len(packs)).Msg("dr bcm compliance-pack catalog seeded to dr_bcm_pack reference tables")
	return nil
}

const seedPackSQL = `
INSERT INTO dr_bcm_pack (pack_key, standard, version, authority, title, description, control_count)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (pack_key) DO UPDATE SET
    standard = EXCLUDED.standard,
    version = EXCLUDED.version,
    authority = EXCLUDED.authority,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    control_count = EXCLUDED.control_count,
    updated_at = now()`

const seedPackControlSQL = `
INSERT INTO dr_bcm_pack_control
    (pack_key, control_code, title, description, required_evidence, rule, weight, mandatory)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (pack_key, control_code) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    required_evidence = EXCLUDED.required_evidence,
    rule = EXCLUDED.rule,
    weight = EXCLUDED.weight,
    mandatory = EXCLUDED.mandatory,
    updated_at = now()`

// ---------------------------------------------------------------------------
// attestledger: reconcile consumer that CONSUMES DR attestation sources and
// Appends them to the ledger exactly once (leader singleton)
// ---------------------------------------------------------------------------

// DR event types the attestation-ledger reconcile consumer records. They are the
// NORMALISED wire types (events.NewEvent prepends "com.clario360."), which is
// what the shared consumer's type filter compares against event.Type:
//   - attestation.issued: a Gate-4 failover/drill attestation was sealed.
//   - cleanroom.passed/failed: a clean-room verdict was recorded.
//   - recovery_point.validated / validation_recorded: a recovery point's
//     validation ratio was recorded.
const (
	evtAttestationIssued    = "com.clario360.datastream.dr.attestation.issued"
	evtCleanroomPassed      = "com.clario360.dr.cleanroom.passed"
	evtCleanroomFailed      = "com.clario360.dr.cleanroom.failed"
	evtRPValidated          = "com.clario360.dr.recovery_point.validated"
	evtRPValidationRecorded = "com.clario360.dr.recovery_point.validation_recorded"
)

// ledgerAppender is the recorder surface the consumer drives. *attestledger.Recorder
// satisfies it. ListEntries is used for the idempotency (exactly-once) check; a
// leader-singleton consumer plus this list-then-append guard means each source
// attestation is appended at most once even across redelivery/restart.
type ledgerAppender interface {
	Append(ctx context.Context, req attestledger.AppendRequest) (*attestledger.Entry, error)
	ListEntries(ctx context.Context, tenantID uuid.UUID, f attestledger.ListFilter) ([]*attestledger.Entry, error)
}

// attestLedgerConsumer subscribes to datastream.dr.events and Appends each DR
// attestation / clean-room verdict / recovery-point validation to the tenant's
// tamper-evident attestation ledger. It implements events.TypedEventHandler so
// it plugs into the shared reconcile consumer exactly like the registry runbook
// reconcile consumer; running it as a leader singleton (a dedicated consumer
// group) means exactly one node performs the derived append. The pool is held
// only for the existence (idempotency) check the recorder cannot perform alone.
type attestLedgerConsumer struct {
	rec    ledgerAppender
	logger zerolog.Logger
}

// newAttestLedgerConsumer constructs the consumer over a recorder. The db is
// accepted to mirror the other reconcile consumers' construction and is reserved
// for any future direct-read enrichment; the recorder owns all DB access today.
func newAttestLedgerConsumer(rec ledgerAppender, _ *pgxpool.Pool, logger zerolog.Logger) *attestLedgerConsumer {
	return &attestLedgerConsumer{
		rec:    rec,
		logger: logger.With().Str("consumer", "dr-attestledger-reconcile").Logger(),
	}
}

// Topics returns the bus topics this consumer subscribes to.
func (c *attestLedgerConsumer) Topics() []string { return []string{events.Topics.DREvents} }

// EventTypes returns the attestation-source event types this consumer records,
// so the shared consumer's type filter skips everything else on the busy
// datastream.dr.events topic — including this package's own
// dr.attestation_ledger.* events, preventing a feedback loop.
func (c *attestLedgerConsumer) EventTypes() []string {
	return []string{
		evtAttestationIssued,
		evtCleanroomPassed,
		evtCleanroomFailed,
		evtRPValidated,
		evtRPValidationRecorded,
	}
}

// Handle records one DR attestation-source event in the ledger. It maps the
// event to a ledger entry type + subject id, then Appends it idempotently (skip
// when an entry of the same type already exists for the subject). A malformed
// event is dropped (logged, nil) so a single bad message does not wedge the
// consumer group; an Append failure is returned so the bus retries.
func (c *attestLedgerConsumer) Handle(ctx context.Context, event *events.Event) error {
	tenantID, err := uuid.Parse(event.TenantID)
	if err != nil || tenantID == uuid.Nil {
		c.logger.Warn().Str("event_type", event.Type).Str("tenant_id", event.TenantID).Msg("attestation-ledger: event missing/invalid tenant id; dropping")
		return nil
	}

	var data map[string]any
	if len(event.Data) > 0 {
		if uerr := json.Unmarshal(event.Data, &data); uerr != nil {
			c.logger.Warn().Err(uerr).Str("event_type", event.Type).Msg("attestation-ledger: undecodable event data; dropping")
			return nil
		}
	}

	entryType, subjectID := c.classify(event.Type, data)
	if entryType == "" || subjectID == "" {
		c.logger.Warn().Str("event_type", event.Type).Msg("attestation-ledger: event carries no recordable subject; dropping")
		return nil
	}

	// Idempotency / exactly-once: skip when an entry of this type already exists
	// for the subject. A leader-singleton consumer serializes appends, so this
	// list-then-append guard is race-free against itself and survives redelivery.
	existing, lerr := c.rec.ListEntries(ctx, tenantID, attestledger.ListFilter{EntryType: entryType, SubjectID: subjectID, Limit: 1})
	if lerr != nil {
		return fmt.Errorf("attestation-ledger: dedup check for %s/%s: %w", entryType, subjectID, lerr)
	}
	if len(existing) > 0 {
		return nil
	}

	if data == nil {
		data = map[string]any{}
	}
	data["_event_type"] = event.Type
	if _, err := c.rec.Append(ctx, attestledger.AppendRequest{
		TenantID:  tenantID,
		EntryType: entryType,
		SubjectID: subjectID,
		Payload:   data,
	}); err != nil {
		return fmt.Errorf("attestation-ledger: appending %s/%s: %w", entryType, subjectID, err)
	}
	c.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Str("entry_type", entryType).
		Str("subject_id", subjectID).
		Msg("attestation-ledger: recorded DR attestation source")
	return nil
}

// classify maps a DR event to a ledger entry type and subject id from the event
// payload. The subject id is the id of the attested DR object so an auditor can
// trace the ledger entry back to its source row.
func (c *attestLedgerConsumer) classify(eventType string, data map[string]any) (entryType, subjectID string) {
	switch eventType {
	case evtAttestationIssued:
		// Failover/drill Gate-4 attestation; subject is the attestation id.
		return attestledger.EntryTypeFailoverAttestation, stringField(data, "attestation_id")
	case evtCleanroomPassed, evtCleanroomFailed:
		// Clean-room verdict; subject is the scanned recovery point id.
		return attestledger.EntryTypeCleanroomVerdict, stringField(data, "recovery_point_id")
	case evtRPValidated, evtRPValidationRecorded:
		// Recovery-point validation; subject is the recovery point id.
		return attestledger.EntryTypeRecoveryPointValidation, stringField(data, "recovery_point_id")
	default:
		return "", ""
	}
}

// stringField reads a string value from event data, tolerating the JSON number
// vs string ambiguity (ids are always strings in DR events but be defensive).
func stringField(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	switch v := data[key].(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		return ""
	}
}

// Compile-time checks that the sovereign collaborators satisfy the package
// contracts they are wired into.
var (
	_ byok.TenantRunner        = sovereignTenantRunner{}
	_ byok.ProviderFactory     = (*sovereignKeyProviderFactory)(nil)
	_ byok.DEKSource           = sovereignDEKSource{}
	_ bcm.DrillSource          = bcmDrillSource{}
	_ bcm.FailoverSource       = bcmFailoverSource{}
	_ bcm.RecoveryPointSource  = bcmRecoveryPointSource{}
	_ bcm.AttestationSource    = bcmAttestationSource{}
	_ bcm.CleanRoomSource      = bcmCleanRoomSource{}
	_ bcm.TopologySource       = bcmTopologySource{}
	_ events.TypedEventHandler = (*attestLedgerConsumer)(nil)
	_ ledgerAppender           = (*attestledger.Recorder)(nil)

	_ assurance.DrillSource                 = assuranceDrillSource{}
	_ assurance.AppVerificationSource       = assuranceAppVerificationSource{}
	_ assurance.CleanRoomVerificationSource = assuranceCleanRoomSource{}
	_ assurance.RunbookReviewSource         = assuranceRunbookReviewSource{}
	_ assurance.BootGraphVerificationSource = assuranceBootGraphSource{}
	_ assurance.FailbackVerificationSource  = assuranceFailbackSource{}
	_ assurance.RPOSource                   = assuranceRPOSource{}

	_ selfdr.Sealer         = (*selfdr.WORMSealer)(nil)
	_ selfdr.WORMSealClient = (*drworm.Client)(nil)
)
