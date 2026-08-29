package main

import (
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/cleanroom"
	drconfig "github.com/clario360/platform/internal/dr/config"
	"github.com/clario360/platform/internal/dr/iacdr"
	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/dr/runbookstudio"
	"github.com/clario360/platform/internal/dr/vmcapture"
	"github.com/clario360/platform/internal/gateway/entitlement"
	recoverproduct "github.com/clario360/platform/internal/recover"
	"github.com/clario360/platform/internal/recover/cyberrecovery"
	"github.com/clario360/platform/internal/recover/metastore"
)

// recoverPlane bundles the Clario Recover productization layer (the "Recover"
// product, its three sub-solutions, and the per-tenant entitlement+activation
// state) so main wires it with a single call, mirroring the orchestration /
// intelligence / resilience planes. It COMPOSES the existing dr/* services via
// the capability registry and resolves entitlement through the EXISTING
// licensing engine (HTTP checker) — it does not own any recovery logic and
// never builds a second entitlement system.
type recoverPlane struct {
	// mount registers the Recover router. Unlike the dr/* planes (which mount
	// under /api/v1/dr), the Recover product is served under its own
	// /api/recover namespace; main mounts it on a separate Auth+Tenant group.
	mount func(group chi.Router)
}

// configureRecoverPlane constructs the Recover product service over the dr_db
// pool (activation persistence) and an entitlement resolver that wraps the
// existing licensing-service HTTP checker. The checker forwards the caller's
// validated bearer token to the licensing service, so the licensing engine
// derives the same tenant — there is exactly one entitlement system.
func configureRecoverPlane(
	db *pgxpool.Pool,
	cfg *drconfig.Config,
	bootMgr *bootgraph.Manager,
	workloadSvc *vmcapture.Service,
	iacSvc *iacdr.Service,
	studioSvc *runbookstudio.Service,
	cleanroomSvc *cleanroom.Service,
	ransomwareStore *ransomware.Store,
	evidenceLedger recoverproduct.EvidenceLedger,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) (*recoverPlane, error) {
	httpChecker := entitlement.NewHTTPChecker(cfg.LicenseServiceURL, cfg.RecoverEntitlementTimeout)
	resolver, err := recoverproduct.NewCheckerResolver(httpChecker, cfg.RecoverEntitlementFailOpen)
	if err != nil {
		return nil, err
	}

	svc, err := recoverproduct.NewService(recoverproduct.Config{
		Runner:       recoverproduct.PGXRunner{Pool: db},
		Store:        recoverproduct.NewActivationStore(),
		Entitlements: resolver,
		Logger:       logger,
		Now:          func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}

	// IT Disaster Recovery sub-solution workspace: a read-only aggregation over
	// the EXISTING runbook-studio and drill-scheduler state (inventory, readiness
	// score computed from real records, last/upcoming rehearsal, open approvals).
	// It composes those dr/* services — it owns no recovery logic — and gates on
	// the recover.it_dr entitlement (the same resolver the product view uses).
	itdrSvc, err := recoverproduct.NewITDRService(recoverproduct.ITDRConfig{
		Runner:       recoverproduct.PGXRunner{Pool: db},
		Store:        recoverproduct.NewITDROverviewStore(),
		Entitlements: resolver,
		Logger:       logger,
		Now:          func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}

	// Cloud Disaster Recovery sub-solution workspace: a read-only aggregation that
	// COMPOSES the existing dr/* services — the bootgraph engine (Manager.GetPlan
	// for the real dependency-aware boot sequence), vmcapture + iacdr (workloads),
	// and the DR repository (recovery scopes, sites, failover-run history). It owns
	// no recovery logic and reuses the bootgraph plan verbatim. The failover
	// EXECUTION paths remain the existing dr:failover-gated endpoints under
	// /api/v1/dr (boot-runs, the failover FSM); Cloud DR only surfaces reads.
	cloudDRSvc, err := recoverproduct.NewCloudDRService(recoverproduct.CloudDRConfig{
		Planner:   bootMgr,
		Estate:    recoverproduct.NewRepositoryEstateReader(db, nil),
		Workloads: recoverproduct.NewServiceWorkloadReader(workloadSvc, iacSvc),
		Logger:    logger,
	})
	if err != nil {
		return nil, err
	}

	// Application Metastore seam (Prompt 7): the COMPLETE, persistence-backed
	// default registry behind the metastore.MetastoreClient interface — a real
	// CMDB-like source of truth for the recovery metadata (owners, environments,
	// dependencies, recovery tier, RTO target, cloud accounts, linked runbooks) a
	// runbook is built from. Its "populate from Metastore" action COMPOSES the
	// EXISTING Runbook Studio service (CreateRunbook with import steps) — it never
	// reimplements runbook authoring; its "sync" action diffs an application's
	// current metadata revision against the revision a linked runbook was populated
	// from and FLAGS drift. Served under the same /api/recover namespace.
	metastoreRegistry, err := metastore.NewDefaultRegistry(metastore.Config{
		Store:   metastore.NewStore(),
		Runner:  metastore.PGXRunner{Pool: db},
		Metrics: metastore.NewMetrics(metricsReg),
		Logger:  logger,
		Now:     func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}
	metastorePopulator, err := metastore.NewPopulator(metastoreRegistry, studioSvc)
	if err != nil {
		return nil, err
	}
	metastoreRouter := metastore.NewRouter(metastoreRegistry, metastorePopulator, logger)

	// Cross-sub-solution RTO/RTA & recovery analytics (Prompt 8): the REAL
	// portfolio endpoint the landing page and every sub-solution overview consume.
	// It sources the RTO TARGET + application universe from the Metastore seam (the
	// same metastoreRegistry above — never a hardcoded RTO) and the captured RTA
	// from the EXISTING runbookstudio execution records joined via the Metastore
	// runbook link; it persists only an append-only readiness-trend snapshot. It
	// gates server-side on a Recover entitlement (any of the three sub-solution
	// keys) via the same resolver the product view uses.
	analyticsSvc, err := recoverproduct.NewAnalyticsService(recoverproduct.AnalyticsConfig{
		Runner:       recoverproduct.PGXRunner{Pool: db},
		Metastore:    metastoreRegistry,
		Store:        recoverproduct.NewAnalyticsStore(),
		Entitlements: resolver,
		Metrics:      recoverproduct.NewAnalyticsMetrics(metricsReg),
		Logger:       logger,
		Now:          func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}

	// Onboarding sub-solution selection + demo templates (Prompt 9): a tenant
	// selects which sub-solutions to activate; the service records the activation
	// via the SAME product Service (the Prompt 1 entitlement model) and SEEDS real
	// demo content per selected sub-solution — demo applications via the REAL
	// Metastore CreateApplication path and a real runbook materialized from each
	// via the metastore populator (which composes Runbook Studio) — so the product
	// lands populated and navigable. Seeding is idempotent (a demo-seed ledger) and
	// the demo content is namespaced and fully removable. It COMPOSES the existing
	// services; it owns no recovery/seeding logic of its own.
	onboardingSvc, err := recoverproduct.NewOnboardingService(recoverproduct.OnboardingConfig{
		Activator:      svc,
		Registry:       metastoreRegistry,
		Populator:      metastorePopulator,
		Runner:         recoverproduct.PGXRunner{Pool: db},
		SeedStore:      recoverproduct.NewDemoSeedStore(),
		RunbookDeleter: recoverproduct.NewRunbookDeleter(),
		Logger:         logger,
		Now:            func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}

	// Audit trail & regulatory evidence export (Prompt 10): the "Prove" surface.
	// The append-only audit log (recover_audit_event) records who/what/when/which
	// for every recovery/rehearsal action across all three sub-solutions; it has NO
	// update/delete code path (and the table grants no UPDATE/DELETE RLS policy), so
	// it is immutable at both layers. The evidence export COMPOSES the Metastore RTO
	// seam (the same metastoreRegistry — never a hardcoded RTO), the EXISTING
	// runbookstudio + cyber-recovery execution records (the runbook executed, RTA,
	// approvals, integrity-check results), and the audit timeline into a
	// regulator-ready CSV/PDF report. It gates server-side on a Recover entitlement
	// (any of the three sub-solution keys) via the same resolver the product uses.
	evidenceMetrics := recoverproduct.NewEvidenceMetrics(metricsReg)
	auditSvc, err := recoverproduct.NewAuditService(recoverproduct.AuditConfig{
		Runner:  recoverproduct.PGXRunner{Pool: db},
		Store:   recoverproduct.NewAuditStore(),
		Metrics: evidenceMetrics,
		Logger:  logger,
		Now:     func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}
	evidenceSvc, err := recoverproduct.NewEvidenceService(recoverproduct.EvidenceConfig{
		Runner:       recoverproduct.PGXRunner{Pool: db},
		Store:        recoverproduct.NewEvidenceStore(),
		Metastore:    metastoreRegistry,
		Audit:        auditSvc,
		Entitlements: resolver,
		Metrics:      evidenceMetrics,
		Ledger:       evidenceLedger,
		Logger:       logger,
		Now:          func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, err
	}

	router := recoverproduct.NewRouter(svc, logger)
	router.ITDR = recoverproduct.NewITDRHandler(itdrSvc, logger)
	router.CloudDR = recoverproduct.NewCloudDRRouter(cloudDRSvc, logger)
	router.Analytics = recoverproduct.NewAnalyticsHandler(analyticsSvc, logger)
	router.Onboarding = recoverproduct.NewOnboardingHandler(onboardingSvc, logger)
	router.Evidence = recoverproduct.NewEvidenceHandler(evidenceSvc, logger)

	// Cyber Recovery sub-solution. The cyberrecovery service + router + the
	// GET /cyber-recovery/overview route already exist; recover.Router.Routes()
	// only mounts /cyber-recovery/* when router.CyberRecovery is non-nil. Wiring
	// the already-composed cleanroom + ransomware services here closes the live
	// 404 on /api/recover/cyber-recovery/overview. forbidSelfApproval=true keeps
	// the recovery-approval separation-of-duties invariant.
	cyberRouter, err := configureCyberRecovery(
		cyberrecovery.PGXRunner{Pool: db}, cleanroomSvc, ransomwareStore, recoverproduct.NewCyberAuditSink(auditSvc), metricsReg, true, logger,
	)
	if err != nil {
		return nil, err
	}
	router.CyberRecovery = cyberRouter

	return &recoverPlane{
		mount: func(group chi.Router) {
			mountRoutes(group, router.Routes())
			mountRoutes(group, metastoreRouter.Routes())
		},
	}, nil
}
