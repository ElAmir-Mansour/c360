package lex

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	"github.com/clario360/platform/internal/auth"
	vcisollmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/ai"
	"github.com/clario360/platform/internal/lex/analyzer"
	"github.com/clario360/platform/internal/lex/analyzer/llm"
	lexconfig "github.com/clario360/platform/internal/lex/config"
	lexconsumer "github.com/clario360/platform/internal/lex/consumer"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/eventbus"
	"github.com/clario360/platform/internal/lex/handler"
	"github.com/clario360/platform/internal/lex/metrics"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

type Dependencies struct {
	DB                *pgxpool.Pool
	Redis             *redis.Client
	Publisher         *events.Producer
	Logger            zerolog.Logger
	Registerer        prometheus.Registerer
	WorkflowDefRepo   *workflowrepo.DefinitionRepository
	WorkflowInstRepo  *workflowrepo.InstanceRepository
	WorkflowTaskRepo  *workflowrepo.TaskRepository
	Config            *lexconfig.Config
	DashboardCacheTTL time.Duration
	OrgJurisdiction   string
	KafkaTopic        string
	PredictionLogger  *aigovmiddleware.PredictionLogger
	// CaseAssignmentUsers is the optional platform IAM directory used to validate
	// case assignees. The standalone lex-service wires it after acquiring its
	// long-lived platform_core pool; tests/embedded callers may inject it here.
	CaseAssignmentUsers service.CaseAssignmentUserDirectory
	// LLMProviderManager is the shared vciso LLM provider manager. Optional: when
	// nil (or LLMEnrichmentEnabled is false) the analyzer behaves identically to
	// the deterministic baseline.
	LLMProviderManager *vcisollmprovider.Manager

	// SSOFederation is the canonical platform IAM federation delegate for the lex
	// suite SSO login path (CAP-152). Optional: when nil the SSO routes are still
	// mounted but return 404 SSO_NOT_CONFIGURED, so callers fall back to password /
	// passkey login. A deployment that bootstraps an *iam/service.FederationService
	// (which satisfies service.LexSSOFederation structurally) injects it here.
	SSOFederation service.LexSSOFederation
}

type Application struct {
	Store   *repository.Store
	Metrics *metrics.Metrics
	// Logger is the service logger, retained so post-construction entrypoints
	// (e.g. the per-tenant ProvisionLegalAffairs onboarding hook) can log.
	Logger zerolog.Logger

	// EventBus is the always-on in-process delivery path that every lex service
	// publishes through. It wraps the optional durable Kafka producer (cross-suite
	// fan-out) and synchronously dispatches each event to the in-process reporting
	// + notification consumers, so the runtime chain reacts with or without Kafka.
	// Exposed so main.go can SetDelegate(...) if the durable producer is
	// created/replaced after NewApplication.
	EventBus              *eventbus.InProcessBus
	ClauseExtractor       *analyzer.ClauseExtractor
	RiskAnalyzer          *analyzer.RiskAnalyzer
	ContractService       *service.ContractService
	ClauseService         *service.ClauseService
	DocumentService       *service.DocumentService
	DocumentEditorService *service.DocumentEditorService
	ComplianceService     *service.ComplianceService
	LibraryService        *service.LibraryService
	MatterService         *service.MatterService
	ObligationService     *service.ObligationService
	SignatureService      *service.SignatureService
	PlaybookService       *service.PlaybookService
	WorkflowService       *service.WorkflowService
	DashboardService      *service.DashboardService
	DraftingService       *service.DraftingService
	LegalHoldService      *service.LegalHoldService

	WorkingCalendarService        *service.WorkingCalendarService
	OrgEntityService              *service.OrgEntityService
	LegalRequestService           *service.LegalRequestService
	RequestNoteService            *service.RequestNoteService
	RequestApprovalPolicyService  *service.RequestApprovalPolicyService
	ApprovalOrchestrator          *service.ApprovalOrchestrator
	RequestApprovalService        *service.RequestApprovalService
	LegalRequestAttachmentService *service.LegalRequestAttachmentService

	// Phase 1 modules.
	ServiceCatalogService       *service.ServiceCatalogService
	IntakeService               *service.IntakeService
	SLAService                  *service.SLAService
	ExecutionRuleService        *service.ExecutionRuleService
	DeliveryConfirmationService *service.DeliveryConfirmationService

	// Phase 2 modules: Litigation Case Management + Case Classification taxonomy.
	LegalCaseService          *service.LegalCaseService
	CaseApprovalOrchestrator  *service.CaseApprovalOrchestrator
	LegalCaseIntakeService    *service.LegalCaseIntakeService
	CaseClassificationService *service.CaseClassificationService
	LegalCourtService         *service.LegalCourtService
	caseAssignmentValidator   *service.CaseAssignmentValidator

	// Phase 3 modules: five independent legal verticals.
	LitigationPleadingService  *service.LitigationPleadingService
	LitigationJudgmentService  *service.LitigationJudgmentService
	LitigationDefendantService *service.LitigationDefendantService
	InvestigationService       *service.InvestigationService
	InvestigationApprovalOrch  *service.InvestigationApprovalOrchestrator
	ConsultationService        *service.ConsultationService
	ManagerTaskService         *service.ManagerTaskService
	SupportRequestService      *service.SupportRequestService
	ConsultationApprovalSvc    *service.ConsultationApprovalService
	CaseTimelineService        *service.CaseTimelineService
	SettlementService          *service.SettlementService
	ContractReviewDeskService  *service.ContractReviewDeskService

	// Contract review-desk sub-resource services (CAP-107..123).
	ContractFinalVersionService    *service.ContractFinalVersionService
	ContractClauseCommentService   *service.ContractClauseCommentService
	ContractClauseAmendmentService *service.ContractClauseAmendmentService
	ContractComplianceService      *service.ContractComplianceService
	ContractArchiveService         *service.ContractArchiveService
	ContractCategoryService        *service.ContractCategoryService

	// Matter sub-resource modules (comments, document links, audit feed,
	// cross-domain related links).
	MatterCommentService  *service.MatterCommentService
	MatterDocumentService *service.MatterDocumentService
	MatterAuditService    *service.MatterAuditService
	MatterLinkService     *service.MatterLinkService

	// Contract list-workspace: portfolio-wide audit feed (projected from the
	// governance columns contracts already write; no audit table).
	ContractAuditService *service.ContractAuditService

	// Settlement sub-resource services.
	SettlementDocumentService *service.SettlementDocumentService

	// Phase 4 modules: Reporting/KPIs, Notifications+inbox, Cross-cutting.
	DurationFactService        *service.DurationFactService
	SLAKPIService              *service.SLAKPIService
	ReportingService           *service.ReportingService
	WorkforceService           *service.WorkforceService
	LexNotificationService     *service.LexNotificationService
	AttachmentPolicyService    *service.AttachmentPolicyService
	DocumentSearchService      *service.DocumentSearchService
	IntegrationRegistryService *service.IntegrationRegistryService
	LexAuditEmitter            *service.LexAuditEmitter
	SSOLoginService            *service.LexSSOLoginService

	ContractHandler         *handler.ContractHandler
	ClauseHandler           *handler.ClauseHandler
	DocumentHandler         *handler.DocumentHandler
	DocumentArchiveHandler  *handler.DocumentArchiveHandler
	DocumentEditorHandler   *handler.DocumentEditorHandler
	ComplianceHandler       *handler.ComplianceHandler
	LibraryHandler          *handler.LibraryHandler
	ReferenceLibraryHandler *handler.ReferenceLibraryHandler
	// ReferenceLibraryService is retained so RegisterRoutes can bind the shared
	// JWTManager as the file-service byte-path (Option A) token source once it is
	// in scope (the JWTManager is not available at NewApplication time).
	ReferenceLibraryService *service.ReferenceLibraryService
	MatterHandler           *handler.MatterHandler
	ObligationHandler       *handler.ObligationHandler
	ResolutionRateHandler   *handler.ResolutionRateHandler
	SignatureHandler        *handler.SignatureHandler
	PlaybookHandler         *handler.PlaybookHandler
	DashboardHandler        *handler.DashboardHandler
	DraftingHandler         *handler.DraftingHandler
	LegalHoldHandler        *handler.LegalHoldHandler

	WorkingCalendarHandler        *handler.WorkingCalendarHandler
	OrgEntityHandler              *handler.OrgEntityHandler
	LegalRequestHandler           *handler.LegalRequestHandler
	LegalRequestAttachmentHandler *handler.LegalRequestAttachmentHandler
	RequestNoteHandler            *handler.RequestNoteHandler
	RequestApprovalPolicyHandler  *handler.RequestApprovalPolicyHandler
	RequestApprovalHandler        *handler.RequestApprovalHandler

	// Phase 1 handlers.
	ServiceCatalogHandler *handler.ServiceCatalogHandler
	IntakeHandler         *handler.IntakeHandler
	SLAHandler            *handler.SLAHandler
	ExecutionHandler      *handler.ExecutionHandler

	// Phase 2 handlers.
	LegalCaseHandler          *handler.LegalCaseHandler
	CaseClassificationHandler *handler.CaseClassificationHandler
	LegalCourtHandler         *handler.LegalCourtHandler

	// Phase 3 handlers.
	LitigationHandler         *handler.LitigationHandler
	InvestigationHandler      *handler.InvestigationHandler
	ConsultationHandler       *handler.ConsultationHandler
	ManagerTaskHandler        *handler.ManagerTaskHandler
	SupportRequestHandler     *handler.SupportRequestHandler
	CaseTimelineHandler       *handler.CaseTimelineHandler
	SettlementHandler         *handler.SettlementHandler
	ContractReviewDeskHandler *handler.ContractReviewDeskHandler

	// Contract review-desk sub-resource handlers (CAP-107..123).
	ContractFinalVersionHandler    *handler.ContractFinalVersionHandler
	ContractClauseCommentHandler   *handler.ContractClauseCommentHandler
	ContractClauseAmendmentHandler *handler.ContractClauseAmendmentHandler
	ContractComplianceHandler      *handler.ContractComplianceHandler
	ContractArchiveHandler         *handler.ContractArchiveHandler
	ContractCategoryHandler        *handler.ContractCategoryHandler

	// Matter sub-resource handlers.
	MatterCommentHandler  *handler.MatterCommentHandler
	MatterDocumentHandler *handler.MatterDocumentHandler
	MatterAuditHandler    *handler.MatterAuditHandler
	MatterLinkHandler     *handler.MatterLinkHandler

	// Contract list-workspace handlers: portfolio audit feed, bulk operations,
	// compute-on-read insights, saved list views, and the batched per-contract
	// e-signature roll-up.
	ContractAuditHandler    *handler.ContractAuditHandler
	ContractBulkHandler     *handler.ContractBulkHandler
	ContractInsightsHandler *handler.ContractInsightsHandler
	SavedViewHandler        *handler.SavedViewHandler
	SignatureSummaryHandler *handler.SignatureSummaryHandler

	// Settlement sub-resource handlers.
	SettlementDocumentHandler *handler.SettlementDocumentHandler

	// Phase 4 handlers.
	ReportingHandler *handler.ReportingHandler
	WorkforceHandler *handler.WorkforceHandler
	// AIHandler serves the Lex legal AI assistant (LEX-LD-GAP-DESIGN §G4). It is
	// nil unless LEX_AI_ENABLED is set, and RegisterRoutes then mounts no /ai/*
	// routes at all.
	AIHandler               *ai.Handler
	NotificationHandler     *handler.NotificationHandler
	AttachmentPolicyHandler *handler.AttachmentPolicyHandler
	DocumentSearchHandler   *handler.DocumentSearchHandler
	IntegrationHandler      *handler.IntegrationHandler
	// IntegrationResilienceHandler serves the reliability surfaces (DLQ #11 +
	// circuit-breaker controls #12) over the registry service.
	IntegrationResilienceHandler *handler.IntegrationResilienceHandler
	// IntegrationGovernanceHandler serves the governance surfaces (#13 maker-checker
	// pending changes + #15 data-residency / field-egress policy) over the registry
	// service (which now holds the change gate + egress enforcer via the With* chain).
	IntegrationGovernanceHandler *handler.IntegrationGovernanceHandler
	// IntegrationObservabilityHandler serves the observability surfaces (#16 per-connector
	// metrics + SLOs, #17 inbound-event inspector + replay) over the registry service
	// (which now holds the call-metrics recorder + event log via the With* chain).
	IntegrationObservabilityHandler *handler.IntegrationObservabilityHandler
	// IntegrationExtensibilityHandler serves the extensibility surfaces (#20 conflict
	// queue: list per-endpoint conflicts + resolve one) over the registry service
	// (which now holds the conflict service + mass-change guard via the With* chain).
	// #18 custom connector + #19 sync rules ride the existing config-driven CRUD path.
	IntegrationExtensibilityHandler *handler.IntegrationExtensibilityHandler
	// Phase-2 integration webhook + inbound SCIM server + SCIM-token handler.
	IntegrationWebhookHandler *handler.IntegrationWebhookHandler
	SCIMServer                *integration.SCIMServer
	SCIMTokenHandler          *handler.SCIMTokenHandler
	SSOHandler                *handler.SSOHandler

	// Effective Lex Session Contract (§4 / §17): persona resolution + switch.
	PersonaService *service.PersonaService
	PersonaHandler *handler.PersonaHandler

	// Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md). Both are
	// nil until EnableRoleMatrix wires them against the platform_core pool
	// (the roles table's home); routes are nil-guarded, so a tenant without
	// the pool simply keeps the code-map defaults.
	RoleMatrixService *service.RoleMatrixService
	RoleMatrixHandler *handler.RoleMatrixHandler

	// PlatformCorePool is a PERSISTENT platform_core pool retained for the
	// per-tenant onboarding hook and canonical IAM validation of internal signature
	// recipients. It is set at startup to the long-lived pool (preferring the
	// AI-governance runtime's pool); nil-safe onboarding still applies the lex_db
	// template, while signature user_id recipients fail closed without this pool.
	PlatformCorePool *pgxpool.Pool
}

// SetCaseAssignmentUserDirectory wires the platform IAM read repository used
// to reject inactive, cross-tenant, or unknown case assignees. The legal-org
// half of the validator is wired from the Lex store during NewApplication.
func (app *Application) SetCaseAssignmentUserDirectory(users service.CaseAssignmentUserDirectory) {
	if app != nil && app.caseAssignmentValidator != nil {
		app.caseAssignmentValidator.SetUserDirectory(users)
	}
}

func (app *Application) SetWorkforceUserDirectory(users service.WorkforceUserDirectory) {
	if app != nil && app.LegalCaseIntakeService != nil {
		app.LegalCaseIntakeService.SetUserDirectory(users)
	}
	if app != nil && app.WorkforceService != nil {
		app.WorkforceService.SetUserDirectory(users)
	}
	if app != nil && app.SupportRequestService != nil {
		app.SupportRequestService.SetUserDirectory(users)
	}
	if app != nil && app.LegalRequestService != nil {
		app.LegalRequestService.SetUserDirectory(users)
	}
}

// SetSupportRequestUserDirectory is the explicit post-platform-pool wiring seam
// for the support directory and list/detail user summaries. It is nil-safe so
// embedded callers without platform_core fail closed at the service boundary.
func (app *Application) SetSupportRequestUserDirectory(users service.WorkforceUserDirectory) {
	if app != nil && app.SupportRequestService != nil {
		app.SupportRequestService.SetUserDirectory(users)
	}
}

// EnableRoleMatrix wires the tenant Role-Matrix Import surface against the
// platform_core pool (where the roles table lives). Called from lex-service
// main AFTER the persistent platform_core pool is established; without it the
// role-matrix routes stay unmounted and enforcement remains the code map.
func (app *Application) EnableRoleMatrix(pool *pgxpool.Pool) {
	if app == nil || pool == nil {
		return
	}
	app.RoleMatrixService = service.NewRoleMatrixService(pool, app.Logger)
	app.RoleMatrixHandler = handler.NewRoleMatrixHandler(app.RoleMatrixService, app.Logger)
	// Surface activated custom import roles as switchable personas (and hide
	// deactivated ones) in the /lex/me contract, so persona UX matches the
	// enforcement overlay for tenants that customise their matrix.
	if app.PersonaService != nil {
		app.PersonaService.SetRoleReader(service.NewRoleMatrixPersonaReader(pool))
	}
}

func NewApplication(deps Dependencies) (*Application, error) {
	if deps.DB == nil {
		return nil, fmt.Errorf("database pool is required")
	}
	reg := deps.Registerer
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	cfg := deps.Config
	if cfg == nil {
		cfg = lexconfig.Default()
	}
	// WS5 security fail-fast: a PROTECTED (non-development) profile MUST NOT run
	// with PII field encryption disabled. lexconfig.Load already calls Validate, but
	// re-assert it here so the guard also fires for a caller-supplied Config or the
	// Default() fallback above — boot is refused rather than running plaintext-at-rest.
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("lex security config: %w", err)
	}
	store := repository.NewStore(deps.DB, deps.Logger)
	appMetrics := metrics.New(reg)

	// WTQ-SEC-04 (at-rest): enable field-level encryption of sensitive contract
	// fields when configured. Software mode custodies an AES-256 key in process;
	// the KeyProvider seam also supports an external (Vault/KMS) resolver.
	if cfg.ContractFieldEncryptionMode == "software" || cfg.ContractFieldEncryptionMode == "external" {
		fieldCrypto, err := newContractFieldCrypto(cfg)
		if err != nil {
			return nil, fmt.Errorf("configure contract field encryption: %w", err)
		}
		store.Contracts.WithFieldCrypto(fieldCrypto)
	}

	recommendationEngine := analyzer.NewRecommendationEngine(deps.OrgJurisdiction)
	clauseExtractor := analyzer.NewClauseExtractor(recommendationEngine)
	riskAnalyzer := analyzer.NewRiskAnalyzer(
		clauseExtractor,
		analyzer.NewMissingClauseDetector(),
		analyzer.NewEntityExtractor(),
		analyzer.NewComplianceChecker(deps.OrgJurisdiction),
		recommendationEngine,
		appMetrics,
	)

	// Governed LLM enricher (safe by default: only constructed when explicitly
	// enabled AND a provider manager is supplied). nil enricher => deterministic.
	var enricher *llm.Enricher
	if cfg.LLMEnrichmentEnabled && deps.LLMProviderManager != nil {
		enricher = llm.NewEnricher(
			deps.LLMProviderManager,
			deps.PredictionLogger,
			llm.Config{
				Enabled:             true,
				MaxTokens:           cfg.LLMMaxTokens,
				Timeout:             cfg.LLMTimeout,
				MaxInputRunes:       cfg.LLMMaxInputRunes,
				ModelSlugClause:     "lex-clause-extractor-llm",
				ModelSlugObligation: "lex-obligation-extractor-llm",
			},
			appMetrics,
		)
	}
	hybridAnalyzer := analyzer.NewHybridAnalyzer(riskAnalyzer, enricher, deps.Logger)

	// Feature 3: cryptographic Delegation-of-Authority evidence validation. Build
	// the validator only when trusted roots are configured; otherwise log a clear
	// warning and leave it unwired so the workflow service falls back to plain-text
	// evidence acceptance (strict validation is preferred when roots are present).
	var authorityValidator service.AuthorityEvidenceValidator
	authorityRootsConfigured := strings.TrimSpace(cfg.ApprovalAuthorityTrustedRootsPEM) != ""
	if authorityRootsConfigured {
		opts := []lexcrypto.EvidenceOption{}
		if cfg.ApprovalAuthorityRevocationEnabled {
			opts = append(opts, lexcrypto.WithRevocationCheck(true))
			if len(cfg.ApprovalAuthorityRevokedSerials) > 0 {
				opts = append(opts, lexcrypto.WithRevokedSerials(cfg.ApprovalAuthorityRevokedSerials...))
			}
		}
		validator, err := lexcrypto.NewAuthorityEvidenceValidator(cfg.ApprovalAuthorityTrustedRootsPEM, opts...)
		if err != nil {
			return nil, fmt.Errorf("configure approval authority evidence validator: %w", err)
		}
		authorityValidator = validator
	} else {
		deps.Logger.Warn().Msg("lex: no approval authority trusted roots configured (LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM/_FILE); Delegation-of-Authority evidence is accepted un-verified")
	}

	// Always-on in-process event bus. It wraps the optional durable Kafka producer
	// (deps.Publisher; a typed-nil *events.Producer is normalized to no-delegate by
	// eventbus.New) and is passed as the service.Publisher to EVERY lex service
	// constructor below. Every writeEvent(...) call therefore delivers synchronously
	// to the in-process reporting + notification consumers (registered after their
	// backing services are built, ~lines 730/750) regardless of whether Kafka is
	// configured — closing the dev-default dead-runtime gap. When a producer IS
	// present the bus still forwards each event to it for cross-suite fan-out.
	bus := eventbus.New(deps.Publisher, deps.Logger)
	var publisher service.Publisher = bus
	workflowService := service.NewWorkflowService(
		deps.DB,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		store.Contracts,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithPolicyGov(store.PolicyGov).
		WithAuthorityEvidenceValidator(authorityValidator, authorityRootsConfigured)
	contractService := service.NewContractService(
		deps.DB,
		store.Contracts,
		store.Clauses,
		store.Documents,
		store.Compliance,
		store.Alerts,
		workflowService,
		hybridAnalyzer,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
		deps.PredictionLogger,
	)
	clauseService := service.NewClauseService(store.Contracts, store.Clauses, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	documentService := service.NewDocumentService(deps.DB, store.Contracts, store.Documents, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	documentEditorService := service.NewDocumentEditorService(deps.DB, store.DocumentEditors, publisher, deps.KafkaTopic, deps.Logger)
	libraryService := service.NewLibraryService(store.Libraries, publisher, deps.KafkaTopic, deps.Logger)
	// WatheeqTech Reference Library (WatheeqTech_Library_Design.md §5.3). Read-only,
	// global; no publisher. Two byte paths are wired and selected per-row by
	// byte_source:
	//   - Option A file-service (design §2.3): LEX_FILE_SERVICE_URL points at the
	//     platform file-service; the download proxy fetches bytes as the canonical
	//     library tenant (LEX_REFERENCE_LIBRARY_TENANT_ID, or the row's own
	//     library_tenant_id) using a short-lived JWT minted from the shared RS256
	//     key (bound in RegisterRoutes). Empty ⇒ file-service path disabled.
	//   - Volume fallback (design §2.4): LEX_REFERENCE_LIBRARY_DIR is the mounted
	//     read-only corpus the download route streams from, defaulting to the repo
	//     working copy for dev.
	// LEX_AI_SERVICE_URL wires the Second-Brain /search + /ask proxies (unset ⇒
	// those routes 503). Metrics register on the lex per-instance registry (reg);
	// the audit repo persists the per-access log (best-effort, nil-safe).
	referenceLibraryDir := os.Getenv("LEX_REFERENCE_LIBRARY_DIR")
	if referenceLibraryDir == "" {
		referenceLibraryDir = "docs/ClarioWatheeq/WatheeqTech Library"
	}
	referenceLibraryMetrics := service.NewReferenceLibraryMetrics(reg)
	referenceLibraryAuditRepo := repository.NewReferenceLibraryAuditRepository(deps.DB, deps.Logger)
	referenceLibraryFileClient := service.NewFileServiceClient(service.FileServiceClientConfig{
		BaseURL: os.Getenv("LEX_FILE_SERVICE_URL"),
	}, deps.Logger)
	referenceLibraryService := service.NewReferenceLibraryService(store.ReferenceLibraries, service.ReferenceLibraryConfig{
		AIServiceURL:           os.Getenv("LEX_AI_SERVICE_URL"),
		StorageDir:             referenceLibraryDir,
		DefaultLibraryTenantID: os.Getenv("LEX_REFERENCE_LIBRARY_TENANT_ID"),
		FileServiceURL:         os.Getenv("LEX_FILE_SERVICE_URL"),
	}, deps.Logger).
		WithAudit(referenceLibraryAuditRepo).
		WithFeedback(store.ReferenceLibraryFeedback).
		WithFileService(referenceLibraryFileClient).
		WithMetrics(referenceLibraryMetrics)
	complianceService := service.NewComplianceService(
		deps.DB,
		store.Contracts,
		store.Clauses,
		store.Documents,
		store.Compliance,
		store.Alerts,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	matterAuditRepo := repository.NewMatterAuditRepository(deps.DB, deps.Logger)
	contractAuditRepo := repository.NewContractAuditRepository(deps.DB, deps.Logger)
	matterService := service.NewMatterService(deps.DB, store.Matters, store.Contracts, matterAuditRepo, publisher, appMetrics, deps.KafkaTopic, deps.Logger)

	// FR-WATHEEQ-005 Legal Hold. The hold service owns apply/release/list and the
	// EnsureSubjectMutable guard. Wire the guard into the contract, matter, and
	// document services so destructive operations on a held subject are refused.
	legalHoldService := service.NewLegalHoldService(
		deps.DB,
		store.LegalHolds,
		store.Contracts,
		store.Matters,
		store.Documents,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	contractService.WithLegalHoldGuard(legalHoldService)
	matterService.WithLegalHoldGuard(legalHoldService)
	documentService.WithLegalHoldGuard(legalHoldService)
	obligationService := service.NewObligationService(deps.DB, store.Obligations, store.Contracts, store.Matters, publisher, appMetrics, deps.KafkaTopic, deps.Logger, enricher)
	if cfg.ObligationReminderProviderMode == "http" {
		dispatcher, err := service.NewHTTPObligationReminderNotificationDispatcher(service.HTTPObligationReminderNotificationDispatcherConfig{
			Endpoint: cfg.ObligationReminderProviderEndpoint,
			APIKey:   cfg.ObligationReminderProviderAPIKey,
			Timeout:  cfg.ObligationReminderProviderTimeout,
		})
		if err != nil {
			return nil, fmt.Errorf("configure obligation reminder provider dispatcher: %w", err)
		}
		obligationService.SetReminderNotificationDispatcher(dispatcher)
	}
	signatureService := service.NewSignatureService(deps.DB, store.Signatures, store.Contracts, store.Documents, publisher, deps.KafkaTopic, deps.Logger)
	if cfg.SignatureProviderMode == "http" {
		dispatcher, err := service.NewHTTPSignatureProviderDispatcher(service.HTTPSignatureProviderDispatcherConfig{
			Endpoint: cfg.SignatureProviderEndpoint,
			APIKey:   cfg.SignatureProviderAPIKey,
			Timeout:  cfg.SignatureProviderTimeout,
		})
		if err != nil {
			return nil, fmt.Errorf("configure signature provider dispatcher: %w", err)
		}
		signatureService.SetProviderDispatcher(dispatcher)
	}
	playbookService := service.NewPlaybookService(
		deps.DB,
		store.Playbooks,
		store.Contracts,
		store.Clauses,
		clauseExtractor,
		publisher,
		deps.KafkaTopic,
		deps.Logger,
	)
	// Contract list-workspace read models: the batched per-contract e-signature
	// roll-up (single round-trip over signature_envelopes/recipients/events) and
	// the compute-on-read portfolio insight cards (contracts + playbook
	// compliance; both pure reads, no schema changes).
	signatureSummaryService := service.NewSignatureSummaryService(repository.NewSignatureSummaryRepository(deps.DB, deps.Logger), deps.Logger)
	contractInsightsService := service.NewContractInsightsService(store.Contracts, playbookService, deps.Logger)
	// Contract bulk operations (bulk status transition + bulk re-analyze) fan out
	// per item over the existing ContractService so FSM validation, legal-hold
	// guards, SoD (author != actor) and event publication are preserved.
	contractBulkService := service.NewContractBulkService(contractService)
	dashboardService := service.NewDashboardService(
		deps.DB,
		deps.Redis,
		store.Contracts,
		store.Documents,
		store.Alerts,
		complianceService,
		appMetrics,
		deps.Logger,
		deps.DashboardCacheTTL,
	)
	// Compliance mutations (rule/alert changes, check runs) bust the cached
	// dashboard so the hero KPIs reflect fresh state. Wired post-construction
	// because the dashboard service itself depends on the compliance service.
	complianceService.WithDashboardInvalidator(dashboardService)

	// AID-* generative drafting engine. Generation requires an LLM provider
	// manager + LLM enrichment enabled; otherwise generation endpoints return 503
	// while the deterministic template-assembly endpoint (AID-08) still works.
	var draftResolver drafting.ProviderResolver
	if deps.LLMProviderManager != nil {
		draftResolver = deps.LLMProviderManager
	}
	var draftGovernor drafting.PredictGovernor
	if deps.PredictionLogger != nil {
		draftGovernor = deps.PredictionLogger
	}
	drafter := drafting.NewDrafter(draftResolver, draftGovernor, drafting.Config{
		Enabled:          cfg.LLMEnrichmentEnabled && deps.LLMProviderManager != nil,
		MaxTokens:        cfg.LLMMaxTokens,
		Timeout:          cfg.LLMTimeout,
		MaxInputRunes:    cfg.LLMMaxInputRunes,
		InteractiveModel: cfg.LLMInteractiveDraftingModel,
	})
	draftingService := service.NewDraftingService(drafter, deps.Logger).
		WithPromptLibrary(deps.DB, store.Prompts).
		WithReviewEngine(
			deps.DB,
			deps.WorkflowDefRepo,
			deps.WorkflowInstRepo,
			store.DraftReviews,
			appMetrics,
			publisher,
			deps.KafkaTopic,
		)

	// Legal-affairs foundation modules (CAP-006/007/008..031): working-calendar
	// engine, org/entity master-data registry, the LegalRequest spine, the
	// subject-agnostic request-approval policy stack, and the reusable approval
	// orchestrator + two-stage RequestApprovalService. All reuse the same
	// publisher/appMetrics/topic/logger plumbing as the contract services.
	workingCalendarService := service.NewWorkingCalendarService(deps.DB, store.WorkingCalendars, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	orgEntityService := service.NewOrgEntityService(deps.DB, store.OrgEntities, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	legalRequestService := service.NewLegalRequestService(deps.DB, store.LegalRequests, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	requestApprovalPolicyService := service.NewRequestApprovalPolicyService(deps.DB, store.RequestApprovalPolicies, publisher, appMetrics, deps.KafkaTopic, deps.Logger)
	approvalOrchestrator := service.NewApprovalOrchestrator(
		deps.DB,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithAuthorityEvidenceValidator(authorityValidator, authorityRootsConfigured)
	requestApprovalService := service.NewRequestApprovalService(
		deps.DB,
		store.LegalRequests,
		requestApprovalPolicyService,
		approvalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	requestFileServiceURL := strings.TrimSpace(os.Getenv("LEX_REQUEST_FILE_SERVICE_URL"))
	if requestFileServiceURL == "" {
		requestFileServiceURL = strings.TrimSpace(os.Getenv("LEX_FILE_SERVICE_URL"))
	}
	requestFileClient := service.NewRequestFileClient(requestFileServiceURL)
	legalRequestAttachmentService := service.NewLegalRequestAttachmentService(
		deps.DB,
		store.LegalRequestAttachments,
		store.LegalRequests,
		store.AttachmentPolicies,
		store.ServiceCatalog,
		requestFileClient,
		deps.Logger,
	)
	managerTaskService := service.NewManagerTaskService(deps.DB, store.ManagerTasks, requestFileClient, deps.Logger)
	legalRequestAttachmentService.SetApprovalService(requestApprovalService)
	legalRequestService.SetAttachmentService(legalRequestAttachmentService)
	requestApprovalService.SetRequestAttachments(legalRequestAttachmentService)

	// -------------------------------------------------------------------------
	// Phase 1 modules: Service Catalog & Intake, SLA/Escalation, Execution Rules.
	// All reuse the same publisher/appMetrics/topic/logger plumbing. Cross-domain
	// coordination is via the legal_requests spine + CloudEvents only (no Go
	// cross-imports between the three modules).
	// -------------------------------------------------------------------------

	// Reuse the contract FieldCrypto so the intake mailbox HMAC ingest secret is
	// encrypted at rest. When field encryption is off, intakeFieldCrypto is nil and
	// secrets persist as legacy plaintext (the decrypt path honours both).
	var intakeFieldCrypto *lexcrypto.FieldCrypto
	if cfg.ContractFieldEncryptionMode == "software" || cfg.ContractFieldEncryptionMode == "external" {
		fc, err := newContractFieldCrypto(cfg)
		if err != nil {
			return nil, fmt.Errorf("configure intake field encryption: %w", err)
		}
		intakeFieldCrypto = fc
	}

	serviceCatalogService := service.NewServiceCatalogService(
		deps.DB,
		store.ServiceCatalog,
		orgEntityService,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	intakeService := service.NewIntakeService(
		deps.DB,
		store.IntakeMailboxes,
		store.IntakeMessages,
		store.ServiceCatalog,
		legalRequestService,
		orgEntityService,
		intakeFieldCrypto,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)

	escalationService := service.NewEscalationService(orgEntityService)
	slaCalendar := service.NewSLABusinessCalendar(workingCalendarService)
	slaService := service.NewSLAService(
		deps.DB,
		store.SLATargets,
		store.SLAClocks,
		store.LegalRequests,
		store.SLAOutbox,
		escalationService,
		slaCalendar,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	if cfg.SLANotificationProviderMode == "http" {
		dispatcher, err := service.NewHTTPSLANotificationDispatcher(service.HTTPSLANotificationDispatcherConfig{
			Endpoint: cfg.SLANotificationProviderEndpoint,
			APIKey:   cfg.SLANotificationProviderAPIKey,
			Timeout:  cfg.SLANotificationProviderTimeout,
		})
		if err != nil {
			return nil, fmt.Errorf("configure sla notification provider dispatcher: %w", err)
		}
		slaService.SetNotificationDispatcher(dispatcher)
	}
	// WS7 SLA lifecycle counters, registered on the per-instance registry `reg`
	// (never the global default — project pitfall). Nil-safe for unit-test callers
	// that construct SLAService without metrics.
	slaService.SetSLAMetrics(service.NewSLAMetrics(reg))

	executionRuleService := service.NewExecutionRuleService(
		deps.DB,
		store.Execution,
		legalRequestService,
		workingCalendarService,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	executionRuleService.SetRequestAttachments(store.LegalRequestAttachments)
	// CAP-024 substantial-edit change-detection. The constructor already installs
	// the default detector (requirement-churn delta = 3); override it only when the
	// deployment configures a custom threshold. LegalRequestService.Revise calls
	// executionRuleService.EvaluateSubstantialEdit(...) to re-open the completeness
	// gate on a substantial edit of an in-execution request.
	if cfg.ExecutionSubstantialRequirementDelta > 0 {
		executionRuleService.SetChangeDetector(service.NewRequestChangeDetectorWithDelta(cfg.ExecutionSubstantialRequirementDelta))
	}
	// Back-reference so Revise can run the CAP-024 re-evaluation (same-package
	// seam, wired after both services exist to avoid a constructor cycle).
	legalRequestService.SetExecutionRuleService(executionRuleService)
	// WS7 runtime domain metrics (execution clock / intake pipeline / working
	// calendar), one shared instance on the per-instance registry `reg`. Each seam
	// is nil-safe so unwired services keep their prior behavior.
	lexDomainMetrics := service.NewLexDomainMetrics(reg)
	workingCalendarService.SetDomainMetrics(lexDomainMetrics)
	intakeService.SetDomainMetrics(lexDomainMetrics)
	executionRuleService.SetDomainMetrics(lexDomainMetrics)
	deliveryConfirmationService := service.NewDeliveryConfirmationService(
		deps.DB,
		store.Execution,
		legalRequestService,
		workingCalendarService,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)

	// Maturation WS1/WS2: wire the in-process SLA clock bridges + the requirement
	// catalog so the runtime chain is end-to-end. All three are nil-safe idempotent
	// setters (no constructor-arg change):
	//   1) ExecutionRuleService.ConfirmCompleteness auto-starts the SLA clock via
	//      SLAService.StartClock (SLAService satisfies service.SLAStarter) the moment
	//      the completeness gate passes — previously execution emitted
	//      com.clario360.lex.execution.clock_started but NOTHING called StartClock.
	//   2) ExecutionRuleService seeds + enforces requirement items from the routed
	//      service's active attachment policy (store.AttachmentPolicies satisfies
	//      service.RequirementCatalog via FindApplicable), closing the
	//      zero-requirement completeness bypass.
	//   3) DeliveryConfirmationService.Respond/AutoClose resolve the SLA clock via
	//      SLAService.ResolveClockForRequest (satisfies service.SLAResolver), giving
	//      the >=90% quarterly on-time KPI a non-zero denominator (Resolve had ZERO
	//      callers before).
	executionRuleService.SetSLAService(slaService)
	executionRuleService.SetRequirementCatalog(store.AttachmentPolicies)
	deliveryConfirmationService.SetSLAService(slaService)

	// -------------------------------------------------------------------------
	// Phase 2 modules: Litigation Case Management (LegalCase aggregate,
	// CAP-032..051) + the admin-extensible Case Classification taxonomy
	// (CAP-074..076). The case Phase-1 directive/approval chain REUSES the shared
	// subject-agnostic approvalOrchestrator constructed above (subject_type=
	// legal_case) — which already has the DoA X.509 authority-evidence validator
	// (authorityValidator/authorityRootsConfigured) wired — via the thin
	// CaseApprovalOrchestrator wrapper. No second orchestrator is built and
	// WorkflowService is untouched.
	// -------------------------------------------------------------------------
	legalCaseService := service.NewLegalCaseService(
		deps.DB,
		store.LegalCases,
		store.Contracts,
		store.LegalRequests,
		store.CaseClassifications,
		store.LegalCourts,
		store.CaseParties,
		store.CaseHearings,
		store.CaseTasks,
		store.CaseComments,
		store.CaseDocuments,
		store.Documents,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	caseAssignmentValidator := service.NewCaseAssignmentValidator(deps.CaseAssignmentUsers, store.OrgEntities)
	legalCaseService.SetAssignmentValidator(caseAssignmentValidator)
	supportRequestService := service.NewSupportRequestService(
		deps.DB,
		store.SupportRequests,
		store.OrgEntities,
		caseAssignmentValidator,
		workingCalendarService,
		publisher,
		deps.KafkaTopic,
		deps.Logger,
	)
	caseApprovalOrchestrator := service.NewCaseApprovalOrchestrator(approvalOrchestrator, store.LegalCases)
	legalCaseIntakeService := service.NewLegalCaseIntakeService(
		deps.DB,
		store.LegalCases,
		store.CaseIntakes,
		caseApprovalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	legalCaseIntakeService.SetAssignmentValidator(caseAssignmentValidator)
	caseClassificationService := service.NewCaseClassificationService(
		deps.DB,
		store.CaseClassifications,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	legalCourtService := service.NewLegalCourtService(store.LegalCourts)

	// -------------------------------------------------------------------------
	// Phase 3 modules: five mutually-independent legal verticals. Each REUSES the
	// shared subject-agnostic approvalOrchestrator (already DoA-X.509-wired) for
	// its approval surface — EXCEPT the Contracts review-desk, whose subject IS
	// contracts and therefore reuses the existing contract-bound workflowService +
	// approval-policy engine directly. The drafting.Drafter, ObligationService and
	// LegalHold guard are reused; no new config knobs, no new timers (deadline
	// reminders ride the existing obligation reminder outbox + monitor).
	// -------------------------------------------------------------------------

	// Field-level PII encryption at rest for investigation + settlement modules
	// reuses the same contract FieldCrypto custody (nil when encryption is off; the
	// repositories' decrypt path honours legacy plaintext for forward-compat).
	if intakeFieldCrypto != nil {
		store.Investigations.WithFieldCrypto(intakeFieldCrypto)
		// Phase 4 CAP-179: encrypt integration-endpoint connection config at rest,
		// reusing the same contract FieldCrypto custody (the repo's decrypt path
		// honours legacy plaintext for forward-compat when encryption is off).
		store.IntegrationEndpoints.WithFieldCrypto(intakeFieldCrypto)
	}

	// 1) Plaintiff/Defendant litigation flows.
	litigationPleadingService := service.NewLitigationPleadingService(
		deps.DB,
		store.Pleadings,
		store.Experts,
		store.LegalCases,
		drafter,
		approvalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)
	litigationJudgmentService := service.NewLitigationJudgmentService(
		deps.DB,
		store.Judgments,
		store.LegalCases,
		store.CaseTasks,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)
	// CAP-069/CAP-175: the defendant service's SetNajizRepresentative path is now
	// backed by the Najiz court-portal adapter. The adapter resolves the active
	// najiz endpoint directly via the FieldCrypto-enabled IntegrationEndpoints repo
	// (decrypted base_url/api_key); when no active endpoint is configured it returns
	// ErrNajizNotConfigured and the service falls back to manual entry transparently.
	litigationDefendantService := service.NewLitigationDefendantService(
		deps.DB,
		store.Defendants,
		store.LegalCases,
		store.CaseTasks,
		drafter,
		approvalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithNajizCourtPort(service.NewHTTPNajizCourtAdapter(service.HTTPNajizCourtAdapterConfig{
		Endpoints: store.IntegrationEndpoints,
		Logger:    deps.Logger,
	}))

	// 2) Investigations.
	investigationApprovalOrch := service.NewInvestigationApprovalOrchestrator(approvalOrchestrator, store.Investigations)
	investigationService := service.NewInvestigationService(
		deps.DB,
		store.Investigations,
		investigationApprovalOrch,
		obligationService,
		drafter,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)
	investigationService.SetEvidenceFileValidator(requestFileClient)

	// 3) Legal Consultations.
	consultationService := service.NewConsultationService(
		deps.DB,
		store.Consultations,
		store.LegalRequests,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService).WithLegalHoldQuerier(legalHoldService).WithDrafter(drafter)

	// Maturation WS3: activate the previously-dead approved->routed FSM edge.
	// LegalRequestService.Route auto-spawns a LegalCase, Consultation, or Contract
	// from the routed request_type and back-links it onto the spine.
	legalRequestService.SetCaseSpawner(legalCaseService)
	legalRequestService.SetConsultationSpawner(consultationService)
	legalRequestService.SetContractSpawner(contractService)
	// Auto-route on approval completion: when the final approver resolves a request
	// to approved, advance it to routed + auto-spawn its subject in-process.
	requestApprovalService.SetRouter(legalRequestService)
	// Auto-start on submit: an approval-required request opens its approval pipeline
	// on submit (under the submitter's permission) instead of dead-ending at
	// `submitted` until a separate, more-privileged POST /approval/start.
	legalRequestService.SetApprovalStarter(requestApprovalService)
	// Return→SLA-stop: moving a request back to the requester halts the running
	// SLA cycle, so the department is not charged for time the requester holds.
	// The next cycle is materialised on resubmission by the normal clock-start
	// path (000110).
	legalRequestService.SetSLAStopper(slaService)
	consultationApprovalService := service.NewConsultationApprovalService(
		deps.DB,
		store.Consultations,
		approvalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)

	// WTQ-RSK-02 #9: playbook activation approval over the SAME subject-agnostic
	// ApprovalOrchestrator. A draft playbook must be approved before it becomes
	// active. Built only when the workflow repos are wired (otherwise the handler
	// endpoints return 503).
	var playbookApprovalService *service.PlaybookApprovalService
	if deps.WorkflowDefRepo != nil && deps.WorkflowInstRepo != nil && deps.WorkflowTaskRepo != nil {
		playbookApprovalService = service.NewPlaybookApprovalService(
			deps.DB,
			store.Playbooks,
			approvalOrchestrator,
			deps.WorkflowDefRepo,
			deps.WorkflowInstRepo,
			deps.WorkflowTaskRepo,
			publisher,
			appMetrics,
			deps.KafkaTopic,
			deps.Logger,
		)
	}

	// 4) Case Timelines (external delay/hold) + Settlements/ADR.
	caseTimelineService := service.NewCaseTimelineService(
		deps.DB,
		store.CaseDelays,
		store.Matters,
		store.Obligations,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)
	settlementService := service.NewSettlementService(
		deps.DB,
		store.Settlements,
		store.Matters,
		store.CaseDelays,
		approvalOrchestrator,
		deps.WorkflowDefRepo,
		deps.WorkflowInstRepo,
		deps.WorkflowTaskRepo,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	)
	if intakeFieldCrypto != nil {
		settlementService = settlementService.WithFieldCrypto(intakeFieldCrypto)
	}
	settlementService = settlementService.WithLegalHoldGuard(legalHoldService)

	// 5) Contracts review-desk (subject IS contracts: reuses workflowService +
	// the existing approval-policy engine directly, NOT approvalOrchestrator).
	contractReviewDeskService := service.NewContractReviewDeskService(
		deps.DB,
		store.Contracts,
		store.ContractIntakes,
		store.ContractAttachments,
		store.ContractCorrespondence,
		store.ContractRecommendations,
		workflowService,
		publisher,
		appMetrics,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)

	// -------------------------------------------------------------------------
	// Contract review-desk sub-resource modules (CAP-107..123). Each builds its
	// own sub-resource repo from the shared pool and reuses the existing
	// store.Clauses / store.Contracts / store.Compliance / store.ContractRecommendations
	// repos plus the shared publisher / topic / logger plumbing.
	// -------------------------------------------------------------------------
	// CAP-117 final-version ceremony: gates on an approved recommendation, writes
	// the new current version, stamps contracts.final_uploaded_at, activates.
	contractFinalVersionService := service.NewContractFinalVersionService(
		deps.DB,
		store.Contracts,
		store.ContractRecommendations,
		publisher,
		deps.KafkaTopic,
		deps.Logger,
	).WithLegalHoldGuard(legalHoldService)

	// CAP-110 legal @mention comments on a contract clause.
	contractClauseCommentRepo := repository.NewContractClauseCommentRepository(deps.DB, deps.Logger)
	contractClauseCommentService := service.NewContractClauseCommentService(deps.DB, store.Clauses, contractClauseCommentRepo, publisher, deps.KafkaTopic, deps.Logger)

	// CAP-111 proposed clause amendments.
	contractClauseAmendmentRepo := repository.NewContractClauseAmendmentRepository(deps.DB, deps.Logger)
	contractClauseAmendmentService := service.NewContractClauseAmendmentService(deps.DB, store.Clauses, contractClauseAmendmentRepo, publisher, deps.KafkaTopic, deps.Logger)

	// CAP-109 regulatory compliance check (latest analysis flags ⨝ compliance rules).
	contractComplianceReviewRepo := repository.NewContractComplianceReviewRepository(deps.DB, deps.Logger)
	contractComplianceService := service.NewContractComplianceService(deps.DB, store.Contracts, store.Compliance, contractComplianceReviewRepo, publisher, deps.KafkaTopic, deps.Logger)

	// CAP-122 archive lifecycle + advanced archived search (owns its own SQL).
	contractArchiveService := service.NewContractArchiveService(deps.DB, publisher, deps.KafkaTopic, deps.Logger)

	// CAP-123 manual category catalog + categorize (distinct from AI /classify).
	contractCategoryRepo := repository.NewContractCategoryRepository(deps.DB, deps.Logger)
	contractCategoryService := service.NewContractCategoryService(deps.DB, store.Contracts, contractCategoryRepo, publisher, deps.KafkaTopic, deps.Logger)

	// Saved list-workspace views (namespace-scoped UX preference store; opaque
	// JSONB payload). Share-scope / role-default write authorization lives inside
	// the service (owner-only personal, owner-or-lex:catalog:manage team/org).
	savedViewRepo := repository.NewSavedViewRepository(deps.DB, deps.Logger)
	savedViewService := service.NewSavedViewService(deps.DB, savedViewRepo, deps.Logger)

	// -------------------------------------------------------------------------
	// Matter sub-resource modules: collaboration comments, document links, the
	// append-only audit/activity feed, and cross-domain related-items links. All
	// reuse the EXISTING store.Matters / store.Documents repos and the shared
	// publisher / appMetrics / topic / logger plumbing. Each builds its own
	// sub-resource repo from the same pool.
	// -------------------------------------------------------------------------
	matterCommentRepo := repository.NewMatterCommentRepository(deps.DB, deps.Logger)
	matterCommentService := service.NewMatterCommentService(deps.DB, store.Matters, matterCommentRepo, publisher, deps.KafkaTopic, deps.Logger)

	// Internal collaboration notes on a request (Al Othaim PRD request detail
	// right rail). Reuses the existing store.LegalRequests repo for the parent
	// existence check; its own note repo is built from the same pool.
	requestNoteRepo := repository.NewRequestNoteRepository(deps.DB, deps.Logger)
	requestNoteService := service.NewRequestNoteService(deps.DB, store.LegalRequests, requestNoteRepo, publisher, deps.KafkaTopic, deps.Logger)

	matterDocumentRepo := repository.NewMatterDocumentRepository(deps.DB, deps.Logger)
	matterDocumentService := service.NewMatterDocumentService(deps.DB, store.Matters, matterDocumentRepo, store.Documents, publisher, appMetrics, deps.KafkaTopic, deps.Logger)

	matterAuditService := service.NewMatterAuditService(store.Matters, matterAuditRepo)

	// Portfolio-wide contract audit feed. Read-only projection over the durable
	// governance columns contracts already write (no audit table, no migration).
	contractAuditService := service.NewContractAuditService(contractAuditRepo)

	matterLinkRepo := repository.NewMatterLinkRepository(deps.DB, deps.Logger)
	matterLinkService := service.NewMatterLinkService(store.Matters, matterLinkRepo, publisher, deps.KafkaTopic, deps.Logger)

	settlementDocumentRepo := repository.NewSettlementDocumentRepository(deps.DB, deps.Logger)
	settlementDocumentService := service.NewSettlementDocumentService(deps.DB, store.Settlements, settlementDocumentRepo, store.Documents, publisher, appMetrics, deps.KafkaTopic, deps.Logger)

	// -------------------------------------------------------------------------
	// Phase 4 modules: Reporting & KPIs, Notifications + in-app inbox, and the
	// cross-cutting layer (attachment policies, document FTS, integration
	// registry, lex audit emitter). All three modules are mutually independent
	// and reuse the existing publisher / store / calendar plumbing.
	// -------------------------------------------------------------------------

	// 1) Reporting & KPIs (CAP-133..151). Quarter/working-day math flows through
	// the working-calendar engine via the narrow ReportingCalendarPort seam. The
	// DurationFactService is exposed on the Application so main.go can hand it to
	// the reporting consumer (which refines processing-time averages from events).
	reportingCalPort := service.NewReportingCalendarPort(workingCalendarService)
	durationFactService := service.NewDurationFactService(store.DurationFacts, reportingCalPort, deps.Logger)
	slaKPIService := service.NewSLAKPIService(store.Reporting, reportingCalPort, deps.Logger)
	reportingService := service.NewReportingService(
		store.Reporting,
		durationFactService,
		slaKPIService,
		deps.Redis,
		deps.Logger,
		60*time.Second,
	).WithCaseControlSources(legalCaseService, investigationService)
	workforceService := service.NewWorkforceService(
		service.NewWorkforceScopeResolver(store.WorkforceScopes),
		store.Workforce,
		reportingCalPort,
	)
	workforceService.SetDomainMetrics(lexDomainMetrics)
	resolutionRateService := service.NewResolutionRateService(store.Reporting, deps.Logger)

	// 2) Notification triggers + in-app inbox (CAP-156..164). The in-app inbox is
	// lex-owned; email reuses the obligation-reminder dispatcher seam (nil emailer
	// => DeterministicLexEmailDispatcher). The HTTP email adapter is injected only
	// when the obligation reminder provider is configured in HTTP mode, mirroring
	// the existing obligation reminder seam.
	lexNotificationService := service.NewLexNotificationService(
		store.NotificationInbox,
		store.NotificationSubscriptions,
		nil,
		publisher,
		deps.KafkaTopic,
		deps.Logger,
	)
	// CAP-157: resolve each recipient's deliverable email address from platform_core
	// (tenant-RLS scoped) just before an email is dispatched. Wired in EVERY provider
	// mode — the address is used only for the outbound email and is never persisted
	// onto the inbox row, so no PII enters the durable record. Reuses the same
	// directory seam SignatureService uses.
	lexNotificationService.SetUserDirectory(service.NewPlatformCoreSignatureUserDirectory(deps.DB))

	// Register the two lex consumers as in-process handlers on the bus now that
	// their backing services exist. The consumers are constructed with a NIL
	// events.Consumer (their constructors are nil-safe and skip the Kafka
	// Subscribe), so the in-process bus is their single delivery path; main.go must
	// NOT also Kafka-subscribe them (double-processing). Their Handle method
	// signature is identical to eventbus.Handler, so it is passed by method value
	// with no adapter. Idempotency is preserved at the consumer layer (notification
	// inbox dedup_key, reporting upsert), so synchronous redelivery is safe.
	reportingConsumer := lexconsumer.NewReportingConsumer(durationFactService, nil, deps.Logger)
	lexNotificationConsumer := lexconsumer.NewLexNotificationConsumer(lexNotificationService, nil, deps.Logger)
	bus.Subscribe("com.clario360.lex.", reportingConsumer.Handle)
	bus.Subscribe("com.clario360.lex.", lexNotificationConsumer.Handle)
	// CAP-157 live email dispatch. When LEX_LEX_NOTIFICATION_PROVIDER_MODE=http the
	// in-app notification service POSTs email through the production
	// notification-service adapter (otherwise the DeterministicLexEmailDispatcher
	// default stays in force). The SAME notification-service endpoint also backs the
	// SLA ack-overdue/breach/escalation notifications — but only if a dedicated
	// LEX_SLA_NOTIFICATION_PROVIDER_* block has NOT already wired its own SLA
	// dispatcher above (that dedicated seam wins, to honour the per-seam override).
	if cfg.LexNotificationProviderMode == "http" {
		emailDispatcher, err := service.NewHTTPLexEmailDispatcher(service.HTTPLexEmailDispatcherConfig{
			Endpoint: cfg.LexNotificationProviderEndpoint,
			APIKey:   cfg.LexNotificationProviderAPIKey,
			Timeout:  cfg.LexNotificationProviderTimeout,
			Provider: cfg.LexNotificationProviderName,
		})
		if err != nil {
			return nil, fmt.Errorf("configure lex notification email dispatcher: %w", err)
		}
		lexNotificationService.SetEmailDispatcher(emailDispatcher)

		// Keep email + SLA on one notification-service HTTP path unless the
		// dedicated SLA provider already claimed it (cfg.SLANotificationProviderMode
		// == "http" wired slaService.SetNotificationDispatcher above). The SLA seam
		// uses a DIFFERENT interface (SLAReminderNotificationDispatcher), so we
		// construct an HTTPSLANotificationDispatcher pointed at the SAME endpoint.
		if cfg.SLANotificationProviderMode != "http" {
			slaDispatcher, err := service.NewHTTPSLANotificationDispatcher(service.HTTPSLANotificationDispatcherConfig{
				Endpoint: cfg.LexNotificationProviderEndpoint,
				APIKey:   cfg.LexNotificationProviderAPIKey,
				Timeout:  cfg.LexNotificationProviderTimeout,
			})
			if err != nil {
				return nil, fmt.Errorf("configure sla notification dispatcher (shared lex notification path): %w", err)
			}
			slaService.SetNotificationDispatcher(slaDispatcher)
		}
	} else if cfg.LexNotificationProviderMode == "smtp" {
		// Self-contained SMTP delivery (SMTPLexEmailDispatcher). The demo path points
		// HOST/PORT at a local MailHog container (localhost:1025, no auth); production
		// points them at a real relay with USERNAME/PASSWORD + TLS. Recipient addresses
		// are resolved from platform_core via the directory wired above, so no external
		// UUID→email service is needed.
		emailDispatcher, err := service.NewSMTPLexEmailDispatcher(service.SMTPLexEmailDispatcherConfig{
			Host:     cfg.LexNotificationSMTPHost,
			Port:     cfg.LexNotificationSMTPPort,
			From:     cfg.LexNotificationSMTPFrom,
			Username: cfg.LexNotificationSMTPUsername,
			Password: cfg.LexNotificationSMTPPassword,
			StartTLS: cfg.LexNotificationSMTPTLS,
			Timeout:  cfg.LexNotificationProviderTimeout,
		})
		if err != nil {
			return nil, fmt.Errorf("configure lex notification SMTP dispatcher: %w", err)
		}
		lexNotificationService.SetEmailDispatcher(emailDispatcher)
	}

	// 3) Cross-cutting: lex audit emitter (PRODUCER onto the audit topic; the
	// platform audit-service consumer hash-chains entries into audit_db), the
	// attachment-policy engine, the document FTS search service, and the external
	// integration registry. The audit emitter is built first and injected into the
	// two services that emit audit entries.
	lexAuditEmitter := service.NewLexAuditEmitter(publisher, events.Topics.AuditEvents, deps.Logger)
	attachmentPolicyService := service.NewAttachmentPolicyService(
		deps.DB,
		store.AttachmentPolicies,
		publisher,
		lexAuditEmitter,
		deps.KafkaTopic,
		deps.Logger,
	)
	documentSearchService := service.NewDocumentSearchService(store.DocumentSearch, store.Documents, deps.Logger)
	integrationRegistryService := service.NewIntegrationRegistryService(
		deps.DB,
		store.IntegrationEndpoints,
		publisher,
		lexAuditEmitter,
		deps.KafkaTopic,
		deps.Logger,
	)
	// Integration Platform (Phase 1) framework wiring. The sync-run ledger persists
	// one append-only row per SyncNow dispatch (and backs GET /integrations/{id}/sync-runs);
	// WithSyncLedger is a nil-safe chainable setter. The endpoint repo is already
	// FieldCrypto-wired above, so Phase-2 connectors registered via
	// integrationRegistryService.RegisterAdapter(...) read DECRYPTED config through
	// the repo. Phase-2 connectors register their ConnectionTester/Syncer/Invoker
	// adapters here; the bundled stubs keep HealthAll honest until then.
	integrationRegistryService = integrationRegistryService.WithSyncLedger(integration.NewSyncLedger(deps.DB))

	// -------------------------------------------------------------------------
	// Integration Platform (Phase 2) — Round B connectors. Each connector reads
	// DECRYPTED config through the FieldCrypto-wired store.IntegrationEndpoints
	// repo (the najiz_court_adapter pattern, never the redacting service) and
	// overrides the bundled stub for its kind. Gov-gated connectors (najiz,
	// nafath_verify, plus esign's gov providers) ship configurable + sandbox-mock
	// and grade not_configured until real creds land; self-serve connectors (sso,
	// hr SCIM/HRIS, archiving, email, internal REST, esign native/DocuSign/Adobe)
	// implement real transports. A shared OAuth client-credentials cache and a
	// generic-purpose HTTP client back the connectors that mint tokens.
	integrationOAuthCache := integration.NewOAuthTokenCache(&http.Client{Timeout: 20 * time.Second}, 30*time.Second)

	// HR identity-map repo (idempotency map) + inbound SCIM 2.0 server. The repo is
	// also held on the Application for the scim-token issue/list handler.
	hrIdentityRepo := repository.NewHRIdentityMapRepository(deps.DB, deps.Logger)
	scimServer := integration.NewSCIMServer(hrIdentityRepo, store.OrgEntities, deps.Logger)

	integrationRegistryService = integrationRegistryService.
		// 1) Najiz court-portal (MoJ Takamul) — gov-gated framework adapter
		// (ConnectionTester + Syncer + Invoker). Coexists with the Phase-1
		// HTTPNajizCourtAdapter wired at the defendant service (left unchanged).
		RegisterAdapter(integration.NewNajizConnector(integration.NajizConnectorConfig{
			Tokens: integrationOAuthCache,
			Logger: deps.Logger,
		})).
		// 2) Nafath identity-confirmation — gov-gated (ConnectionTester + Invoker).
		// Stateless; reads plaintext config via the repo. The inbound callback is
		// served by the public /webhooks/lex/nafath/verify route.
		RegisterAdapter(integration.NewNafathVerifyConnector(integration.NafathVerifyConnectorConfig{
			Repo:   store.IntegrationEndpoints,
			Logger: deps.Logger,
		})).
		// 3) SSO (OIDC/SAML) — self-serve (ConnectionTester + Invoker). BuildProvider
		// is left nil: Test/Probe (live discovery/JWKS or SAML metadata) and config
		// resolution work fully now; invoke:login honestly reports "login delegation
		// not wired" until a federation provider seam is injected. SAML's primary
		// login path (FederationService.Callback) is unaffected.
		RegisterAdapter(integration.NewSSOConnector(integration.SSOConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
		})).
		// 4) HR / identity — self-serve SCIM-client + HRIS-REST (real transports);
		// csv_sftp + ldap grade not_configured honestly until SFTP/LDAP transports
		// are injected. Reconciles to OrgEntity + the idempotency map.
		RegisterAdapter(integration.NewHRConnector(integration.HRConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
			OrgRepo:   store.OrgEntities,
			IDMap:     hrIdentityRepo,
			OAuth:     integrationOAuthCache,
			Logger:    deps.Logger,
		})).
		// 5) e-Archiving — self-serve CMIS / S3 object-lock / SharePoint with WORM +
		// legal-hold + PDPL in_kingdom_only fail-closed. Fetcher left nil (archives a
		// canonical content descriptor honestly labelled metadata_only until a
		// file-storage objectFetcher is injected).
		RegisterAdapter(integration.NewEArchiveConnector(integration.EArchiveConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
			Documents: store.Documents,
			Holds:     store.LegalHolds,
			DB:        deps.DB,
			Logger:    deps.Logger,
		})).
		// 6) Email — self-serve SMTP / SES / Graph / generic_webhook (real transports).
		// Inbound intake leg reuses legal_intake_mailboxes (HMAC secret presence via
		// FieldCrypto); the public intake webhook is unchanged.
		RegisterAdapter(integration.NewEmailConnector(integration.EmailConnectorConfig{
			Endpoints:   store.IntegrationEndpoints,
			Mailboxes:   store.IntakeMailboxes,
			FieldCrypto: intakeFieldCrypto,
			Logger:      deps.Logger,
		})).
		// 7) e-signature — native/DocuSign/Adobe/external real transports; gov
		// najiz/emdha sandbox-mock. Dispatch port left nil: Test/Probe + config
		// resolution work now and invoke:dispatch_envelope reports "dispatch not
		// wired" honestly — envelope dispatch remains reachable through the existing
		// SignatureService.Send (/signatures/{id}/send) seam.
		RegisterAdapter(integration.NewEsignConnector(integration.EsignConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
			Tokens:    integrationOAuthCache,
			Breaker:   integration.NewBreaker(integration.BreakerConfig{Name: "lex-esign"}),
			Logger:    deps.Logger,
		})).
		// 8) Internal generic REST/webhook (catch-all, CAP-177) — self-serve, real
		// HTTP transport, no onboarding gate. The inbound generic receiver is served
		// by VerifyInboundWebhook (route deferred to Round D — not yet mounted).
		RegisterAdapter(integration.NewInternalRESTConnector(integration.InternalRESTConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
			Logger:    deps.Logger,
		})).
		// EXTENSIBILITY #18: the no-code generic "custom" REST connector. Created/
		// edited via the existing POST /integrations (kind=custom) + GET
		// /integrations/schema/custom and tested via /integrations/{id}/test; this
		// adapter executes the declarative REST spec carried in config. It installs
		// its OWN SSRF-guarding http.Transport (DialContext rejects resolved internal/
		// metadata IPs, closing DNS-rebinding), so no http.Client is injected.
		RegisterAdapter(integration.NewCustomConnector(integration.CustomConnectorConfig{
			Endpoints: store.IntegrationEndpoints,
			OAuth:     integrationOAuthCache,
			Logger:    deps.Logger,
		})).
		// Othaim PRD 14.2: first-class Yardi Voyager/Interface property-management &
		// real-estate ERP connector (ConnectionTester + Syncer + Invoker +
		// SandboxInvoker). Self-serve REST pull (leases/properties) with a small
		// write-back surface; reads DECRYPTED config via the repo like the other
		// connectors and shares the OAuth client-credentials cache. Ships fully
		// configurable + sandbox-testable and grades not_configured until the tenant's
		// real Yardi base URL + credentials land. The lease→lex reconciliation writer
		// is a nil drop-in seam in v1 (honest metadata_only), matching the EArchive/SSO
		// deferred-seam pattern.
		RegisterAdapter(integration.NewYardiConnector(integration.YardiConnectorConfig{
			Tokens: integrationOAuthCache,
			Logger: deps.Logger,
		}))

	// Feature 6: integration endpoint health-check history + degrade detection.
	// The recorder persists one health row per probe (Health/HealthAll) and detects
	// healthy->outage grade transitions. The degrade NOTIFIER is left nil for now
	// (the contract sanctions nil to disable alerting): targeting the tenant's
	// integration administrators needs an admin-recipient resolver that the lex
	// service does not yet receive in its dependencies. History persistence and the
	// degrade-edge detection (logged) run regardless; alert fan-out is a drop-in
	// once a recipient resolver is wired here. Best-effort: a recorder error never
	// fails a probe.
	integrationHealthRepo := repository.NewIntegrationHealthRepository(deps.DB, deps.Logger)
	integrationHealthRecorder := integration.NewHealthRecorder(integrationHealthRepo, nil, deps.Logger)
	integrationRegistryService = integrationRegistryService.WithHealthRecorder(integrationHealthRecorder)

	// Reliability features #11 (DLQ) + #12 (circuit-breaker controls). WithDLQ
	// self-registers the registry as the DLQ ReplayRunner (ReplayOperation); WithBreaker
	// self-registers it as the Quarantiner (Quarantine/Unquarantine) — no extra calls.
	// Both are nil-safe chainable setters mirroring WithSyncLedger/WithHealthRecorder.
	integrationDLQRepo := repository.NewIntegrationDLQRepository(deps.DB, deps.Logger)
	integrationDLQ := integration.NewDLQService(integrationDLQRepo, deps.Logger)
	integrationBreaker := integration.NewBreakerController(deps.Logger)
	integrationRegistryService = integrationRegistryService.
		WithDLQ(integrationDLQ).
		WithBreaker(integrationBreaker)

	// Governance features #13 (maker-checker pending changes), #14 (KMS/Vault
	// secret references + rotation policy), #15 (data-residency / field-egress).
	// All three setters are nil-safe + chainable, mirroring WithDLQ/WithBreaker:
	//   * WithChangeGate self-registers the registry as the gate's EndpointUpdater
	//     (ApplyProposedConfig) — the maker-checker apply seam.
	//   * WithEgress installs the EgressEnforcer; the enforcer audits denials back
	//     through the registry (which satisfies integration.EgressAuditEmitter via
	//     EmitEgressBlocked).
	//   * WithSecretRef installs the kms://|vault:// reference resolver. With NO
	//     providers registered it is a transparent pass-through (a plain stored
	//     secret still works); a real KMS/Vault provider is injected later via
	//     integrationSecretRef.WithProvider(...) once external custody is wired —
	//     until then an external reference fails CLOSED (never leaks the reference).
	// enforceSoD=true requires the approver to differ from the requester.
	integrationGovRepo := repository.NewIntegrationGovernanceRepository(deps.DB, deps.Logger)
	integrationChangeGate := integration.NewChangeGateService(integrationGovRepo, true, deps.Logger)
	integrationEgress := integration.NewEgressEnforcer(integrationRegistryService)
	integrationSecretRef := integration.NewSecretRefResolver()
	integrationRegistryService = integrationRegistryService.
		WithChangeGate(integrationChangeGate).
		WithEgress(integrationEgress).
		WithSecretRef(integrationSecretRef)

	// Observability features #16 (per-connector metrics + SLOs) + #17 (inbound-event
	// inspector + replay). WithCallMetrics self-wires the recorder's endpoint-identity
	// + sync-throughput lookups (the latter reads the sync ledger wired by WithSyncLedger
	// above, so this MUST come after line 983); WithEventLog self-registers the registry
	// as the event log's EventDispatcher (DispatchInboundEvent) for replay — no extra
	// calls, mirroring WithDLQ's self-registration. Both setters are nil-safe + chainable.
	integrationMetricsRepo := repository.NewIntegrationMetricsRepository(deps.DB, deps.Logger)
	integrationEventRepo := repository.NewIntegrationEventRepository(deps.DB, deps.Logger)
	integrationCallMetrics := integration.NewCallMetricsRecorder(integrationMetricsRepo, deps.Logger)
	integrationEventLog := integration.NewEventLog(integrationEventRepo, deps.Logger)
	integrationRegistryService = integrationRegistryService.
		WithCallMetrics(integrationCallMetrics).
		WithEventLog(integrationEventLog)

	// Extensibility feature #20 (conflict queue + mass-change guard). WithConflicts is
	// nil-safe + chainable like WithDLQ/WithBreaker. Reconcile records OPEN conflicts
	// via the ConflictService; SyncNow consults the MassChangeGuard before applying a
	// run that would deactivate more than mass_change_threshold_pct of the mapped org
	// entities, returning 409 with a guard summary unless ?force=true. The guard's
	// deactivation denominator is the HR identity map (hrIdentityRepo, already built
	// above at the HR-connector wiring), the only kind that deactivates mapped org
	// entities today.
	integrationConflictRepo := repository.NewIntegrationConflictRepository(deps.DB, deps.Logger)
	integrationConflicts := integration.NewConflictService(integrationConflictRepo, hrIdentityRepo, deps.Logger)
	integrationMassGuard := integration.NewMassChangeGuard(deps.DB, deps.Logger)
	integrationRegistryService = integrationRegistryService.
		WithConflicts(integrationConflicts, integrationMassGuard)

	// CAP-152 lex suite SSO login. Thin, correct delegation to the canonical
	// platform IAM FederationService (deps.SSOFederation). Session minting / Redis
	// flow state / JIT provisioning all stay in the single IAM implementation; this
	// service only adds lex-suite audit records around the handshake. When the
	// delegate is nil the service reports Configured()==false and the handler
	// returns 404, a safe no-op that lets callers fall back to password login.
	ssoLoginService := service.NewLexSSOLoginService(deps.SSOFederation, lexAuditEmitter, deps.Logger)

	// -------------------------------------------------------------------------
	// Round 2 maturation wiring (BUSINESS RULES + AUDIT + facts). Every setter
	// below is nil-safe/idempotent and was authored post-construction so omitting
	// any one degrades gracefully to the prior behavior. They install:
	//   * the immutable audit_db ledger relay (LexAuditEmitter) onto every service
	//     that gained a SetAuditEmitter seam (spine, SLA, litigation x3,
	//     investigations, consultations + approval, settlements, legal cases);
	//   * the SHARED SLA engine bridge into investigations / consultations / cases;
	//   * the in-process duration-fact recorders (C-2).
	// lexAuditEmitter, slaService, workingCalendarService, durationFactService,
	// reportingCalPort and store.DurationFacts are all already constructed above.
	// -------------------------------------------------------------------------

	// Spine + SLA append-only audit -> audit_db ledger relay (WS4).
	legalRequestService.SetAuditEmitter(lexAuditEmitter)
	slaService.SetAuditEmitter(lexAuditEmitter)

	// Litigation depth (audit ledger relay; in-tx append-only rows always written).
	litigationJudgmentService.SetAuditEmitter(lexAuditEmitter)
	litigationPleadingService.SetAuditEmitter(lexAuditEmitter)
	litigationDefendantService.SetAuditEmitter(lexAuditEmitter)

	// Investigations depth: SHARED SLA engine (StartClock + ResolveClockForRequest),
	// audit ledger relay, and the C-2 duration-fact writer (raw repo seam +
	// working-calendar port). *SLAService satisfies InvestigationSLAService.
	investigationService.SetSLAService(slaService)
	investigationService.SetAuditEmitter(lexAuditEmitter)
	investigationService.SetDurationFactWriter(store.DurationFacts, reportingCalPort)

	// Consultations depth: self-contained ack/response clock via the working
	// calendar, idempotent nudge of the linked request clock, audit ledger relay,
	// and the in-process consultation_answer duration fact (C-2). The approval
	// service relays its resolved decision to the ledger too.
	consultationService.
		SetSLAService(workingCalendarService, nil).
		SetRequestSLAStarter(slaService).
		SetAuditEmitter(lexAuditEmitter).
		SetDurationFactRecorder(durationFactService)
	consultationApprovalService.SetAuditEmitter(lexAuditEmitter)

	// Settlements depth: audit ledger relay + in-process settlement/case
	// resolution duration facts (C-2). *DurationFactService satisfies
	// SettlementDurationRecorder (UpsertFromTransition).
	settlementService.SetAuditEmitter(lexAuditEmitter)
	settlementService.SetDurationFactRecorder(durationFactService)

	// LegalCase depth: SHARED SLA clock on open + audit ledger relay (WS3/WS4).
	legalCaseService.SetSLAService(slaService)
	legalCaseService.SetAuditEmitter(lexAuditEmitter)

	app := &Application{
		Store:                 store,
		Metrics:               appMetrics,
		Logger:                deps.Logger,
		EventBus:              bus,
		ClauseExtractor:       clauseExtractor,
		RiskAnalyzer:          riskAnalyzer,
		ContractService:       contractService,
		ClauseService:         clauseService,
		DocumentService:       documentService,
		DocumentEditorService: documentEditorService,
		ComplianceService:     complianceService,
		LibraryService:        libraryService,
		MatterService:         matterService,
		ObligationService:     obligationService,
		SignatureService:      signatureService,
		PlaybookService:       playbookService,
		WorkflowService:       workflowService,
		DashboardService:      dashboardService,
		DraftingService:       draftingService,
		LegalHoldService:      legalHoldService,

		WorkingCalendarService:        workingCalendarService,
		OrgEntityService:              orgEntityService,
		LegalRequestService:           legalRequestService,
		RequestNoteService:            requestNoteService,
		RequestApprovalPolicyService:  requestApprovalPolicyService,
		ApprovalOrchestrator:          approvalOrchestrator,
		RequestApprovalService:        requestApprovalService,
		LegalRequestAttachmentService: legalRequestAttachmentService,

		ServiceCatalogService:       serviceCatalogService,
		IntakeService:               intakeService,
		SLAService:                  slaService,
		ExecutionRuleService:        executionRuleService,
		DeliveryConfirmationService: deliveryConfirmationService,

		LegalCaseService:          legalCaseService,
		CaseApprovalOrchestrator:  caseApprovalOrchestrator,
		LegalCaseIntakeService:    legalCaseIntakeService,
		CaseClassificationService: caseClassificationService,
		LegalCourtService:         legalCourtService,
		caseAssignmentValidator:   caseAssignmentValidator,

		LitigationPleadingService:  litigationPleadingService,
		LitigationJudgmentService:  litigationJudgmentService,
		LitigationDefendantService: litigationDefendantService,
		InvestigationService:       investigationService,
		InvestigationApprovalOrch:  investigationApprovalOrch,
		ConsultationService:        consultationService,
		ManagerTaskService:         managerTaskService,
		SupportRequestService:      supportRequestService,
		ConsultationApprovalSvc:    consultationApprovalService,
		CaseTimelineService:        caseTimelineService,
		SettlementService:          settlementService,
		ContractReviewDeskService:  contractReviewDeskService,

		ContractFinalVersionService:    contractFinalVersionService,
		ContractClauseCommentService:   contractClauseCommentService,
		ContractClauseAmendmentService: contractClauseAmendmentService,
		ContractComplianceService:      contractComplianceService,
		ContractArchiveService:         contractArchiveService,
		ContractCategoryService:        contractCategoryService,

		MatterCommentService:  matterCommentService,
		MatterDocumentService: matterDocumentService,

		SettlementDocumentService: settlementDocumentService,
		MatterAuditService:        matterAuditService,
		MatterLinkService:         matterLinkService,
		ContractAuditService:      contractAuditService,

		DurationFactService:        durationFactService,
		SLAKPIService:              slaKPIService,
		ReportingService:           reportingService,
		WorkforceService:           workforceService,
		LexNotificationService:     lexNotificationService,
		AttachmentPolicyService:    attachmentPolicyService,
		DocumentSearchService:      documentSearchService,
		IntegrationRegistryService: integrationRegistryService,
		LexAuditEmitter:            lexAuditEmitter,
		SSOLoginService:            ssoLoginService,
	}

	app.ContractHandler = handler.NewContractHandler(contractService, workflowService, deps.Logger)
	app.ClauseHandler = handler.NewClauseHandler(clauseService, deps.Logger)
	app.DocumentHandler = handler.NewDocumentHandler(documentService, deps.Logger)
	app.DocumentEditorHandler = handler.NewDocumentEditorHandler(documentEditorService, deps.Logger)
	app.ComplianceHandler = handler.NewComplianceHandler(complianceService, deps.Logger)
	app.LibraryHandler = handler.NewLibraryHandler(libraryService, deps.Logger)
	app.ReferenceLibraryService = referenceLibraryService
	app.ReferenceLibraryHandler = handler.NewReferenceLibraryHandler(referenceLibraryService, referenceLibraryMetrics, deps.Logger)
	app.MatterHandler = handler.NewMatterHandler(matterService, deps.Logger)
	app.ObligationHandler = handler.NewObligationHandler(obligationService, deps.Logger)
	app.SignatureHandler = handler.NewSignatureHandler(signatureService, deps.Logger)
	app.PlaybookHandler = handler.NewPlaybookHandler(playbookService, deps.Logger).WithApproval(playbookApprovalService)
	app.DashboardHandler = handler.NewDashboardHandler(dashboardService, deps.Logger)
	app.DraftingHandler = handler.NewDraftingHandler(draftingService, deps.Logger)
	app.LegalHoldHandler = handler.NewLegalHoldHandler(legalHoldService, deps.Logger)

	app.WorkingCalendarHandler = handler.NewWorkingCalendarHandler(workingCalendarService, deps.Logger)
	app.OrgEntityHandler = handler.NewOrgEntityHandler(orgEntityService, deps.Logger)
	app.LegalRequestHandler = handler.NewLegalRequestHandler(legalRequestService, deps.Logger)
	app.LegalRequestAttachmentHandler = handler.NewLegalRequestAttachmentHandler(legalRequestAttachmentService, deps.Logger)
	app.RequestNoteHandler = handler.NewRequestNoteHandler(requestNoteService, deps.Logger)
	app.RequestApprovalPolicyHandler = handler.NewRequestApprovalPolicyHandler(requestApprovalPolicyService, deps.Logger)
	app.RequestApprovalHandler = handler.NewRequestApprovalHandler(requestApprovalService, deps.Logger)

	app.ServiceCatalogHandler = handler.NewServiceCatalogHandler(serviceCatalogService, deps.Logger)
	app.IntakeHandler = handler.NewIntakeHandler(intakeService, deps.Logger).
		WithInboundProviderSecrets(cfg.InboundEmailProviderSecrets)
	app.SLAHandler = handler.NewSLAHandler(slaService, deps.Logger)
	app.ExecutionHandler = handler.NewExecutionHandler(executionRuleService, deliveryConfirmationService, deps.Logger)

	app.LegalCaseHandler = handler.NewLegalCaseHandler(legalCaseService, legalCaseIntakeService, deps.Logger)
	app.CaseClassificationHandler = handler.NewCaseClassificationHandler(caseClassificationService, deps.Logger)
	app.LegalCourtHandler = handler.NewLegalCourtHandler(legalCourtService, deps.Logger)

	app.LitigationHandler = handler.NewLitigationHandler(litigationPleadingService, litigationJudgmentService, litigationDefendantService, deps.Logger)
	app.InvestigationHandler = handler.NewInvestigationHandler(investigationService, deps.Logger)
	app.ConsultationHandler = handler.NewConsultationHandler(consultationService, consultationApprovalService, deps.Logger)
	app.ManagerTaskHandler = handler.NewManagerTaskHandler(managerTaskService, deps.Logger)
	app.SupportRequestHandler = handler.NewSupportRequestHandler(supportRequestService, deps.Logger)
	app.CaseTimelineHandler = handler.NewCaseTimelineHandler(caseTimelineService, deps.Logger)
	app.SettlementHandler = handler.NewSettlementHandler(settlementService, deps.Logger)
	app.ContractReviewDeskHandler = handler.NewContractReviewDeskHandler(contractReviewDeskService, deps.Logger)

	// Contract review-desk sub-resource handlers (CAP-107..123).
	app.ContractFinalVersionHandler = handler.NewContractFinalVersionHandler(contractFinalVersionService, deps.Logger)
	app.ContractClauseCommentHandler = handler.NewContractClauseCommentHandler(contractClauseCommentService, deps.Logger)
	app.ContractClauseAmendmentHandler = handler.NewContractClauseAmendmentHandler(contractClauseAmendmentService, deps.Logger)
	app.ContractComplianceHandler = handler.NewContractComplianceHandler(contractComplianceService, deps.Logger)
	app.ContractArchiveHandler = handler.NewContractArchiveHandler(contractArchiveService, deps.Logger)
	app.ContractCategoryHandler = handler.NewContractCategoryHandler(contractCategoryService, deps.Logger)

	// Matter sub-resource handlers.
	app.MatterCommentHandler = handler.NewMatterCommentHandler(matterCommentService, deps.Logger)
	app.MatterDocumentHandler = handler.NewMatterDocumentHandler(matterDocumentService, deps.Logger)
	app.MatterAuditHandler = handler.NewMatterAuditHandler(matterAuditService, deps.Logger)
	app.MatterLinkHandler = handler.NewMatterLinkHandler(matterLinkService, deps.Logger)

	// Settlement sub-resource handlers.
	app.SettlementDocumentHandler = handler.NewSettlementDocumentHandler(settlementDocumentService, deps.Logger)

	// Contract list-workspace handlers: portfolio audit feed, bulk operations,
	// compute-on-read insights, saved list views, and the batched per-contract
	// e-signature roll-up.
	app.ContractAuditHandler = handler.NewContractAuditHandler(contractAuditService, deps.Logger)
	app.ContractBulkHandler = handler.NewContractBulkHandler(contractBulkService, deps.Logger)
	app.ContractInsightsHandler = handler.NewContractInsightsHandler(contractInsightsService, deps.Logger)
	app.SavedViewHandler = handler.NewSavedViewHandler(savedViewService, deps.Logger)
	app.SignatureSummaryHandler = handler.NewSignatureSummaryHandler(signatureSummaryService, deps.Logger)

	// Phase 4 handlers.
	app.ReportingHandler = handler.NewReportingHandler(reportingService, deps.Logger)
	app.WorkforceHandler = handler.NewWorkforceHandler(workforceService, deps.Logger)
	// Lex legal AI assistant (LEX-LD-GAP-DESIGN §G4). OFF by default: when
	// LEX_AI_ENABLED is unset the handler stays nil and RegisterRoutes mounts no
	// /ai/* routes at all. Its grounding tools read the SAME tenant-scoped
	// dashboard / resolution-rate / workforce services the REST surface exposes,
	// masked per-domain by the caller's own view permissions, so the assistant
	// can never widen what its caller could already read.
	if aiConfig := ai.ConfigFromEnv(); aiConfig.Enabled {
		aiService := ai.NewService(ai.Deps{
			Completer:     ai.NewAnthropicClient(aiConfig),
			Tools:         ai.NewTools(dashboardService, resolutionRateService, workforceService, nil),
			Store:         ai.NewStore(deps.DB, deps.Logger),
			Metrics:       ai.NewMetrics(deps.Registerer),
			Logger:        deps.Logger,
			MaxIterations: aiConfig.MaxIterations,
		})
		app.AIHandler = ai.NewHandler(aiService, deps.Logger)
	}
	app.ResolutionRateHandler = handler.NewResolutionRateHandler(resolutionRateService, deps.Logger)
	app.NotificationHandler = handler.NewNotificationHandler(lexNotificationService, deps.Logger)
	app.AttachmentPolicyHandler = handler.NewAttachmentPolicyHandler(attachmentPolicyService, deps.Logger)
	app.DocumentSearchHandler = handler.NewDocumentSearchHandler(documentSearchService, deps.Logger)
	app.IntegrationHandler = handler.NewIntegrationHandler(integrationRegistryService, deps.Logger)
	// Othaim PRD 14.1 — document-scoped e-archive action. Routes through the same
	// integration registry Invoke (breaker/egress/DLQ/metrics/audit) at the document
	// write tier; store.Documents powers the GET archive-status read.
	app.DocumentArchiveHandler = handler.NewDocumentArchiveHandler(integrationRegistryService, store.IntegrationEndpoints, store.Documents, deps.Logger)
	// Reliability handler (#11 DLQ + #12 breaker) over the same registry service (which
	// now holds the DLQ service + breaker controller via WithDLQ/WithBreaker above).
	app.IntegrationResilienceHandler = handler.NewIntegrationResilienceHandler(integrationRegistryService, deps.Logger)
	// Governance handler (#13 maker-checker pending changes + #15 egress policy) over
	// the same registry service (which now holds the change gate + egress enforcer via
	// WithChangeGate/WithEgress above).
	app.IntegrationGovernanceHandler = handler.NewIntegrationGovernanceHandler(integrationRegistryService, deps.Logger)
	// Observability handler (#16 per-connector metrics + SLOs, #17 inbound-event
	// inspector + replay) over the same registry service (which now holds the
	// call-metrics recorder + event log via WithCallMetrics/WithEventLog above).
	app.IntegrationObservabilityHandler = handler.NewIntegrationObservabilityHandler(integrationRegistryService, deps.Logger)
	// Extensibility handler (#20 conflict queue) over the same registry service (which
	// now holds the conflict service + mass-change guard via WithConflicts above).
	app.IntegrationExtensibilityHandler = handler.NewIntegrationExtensibilityHandler(integrationRegistryService, deps.Logger)
	// Phase-2 integration webhook (public, HMAC) + inbound SCIM 2.0 server + the
	// per-endpoint SCIM-token issue/list handler. The webhook handler resolves the
	// active endpoint + plaintext webhook secret via the FieldCrypto-wired repo.
	app.IntegrationWebhookHandler = handler.NewIntegrationWebhookHandler(store.IntegrationEndpoints, deps.Logger).
		// Feature 8: stamp metadata.last_received_event_at on a verified inbound event
		// so the console shows "last event received". Best-effort, nil-safe.
		WithRegistry(integrationRegistryService).
		// GAP 2: enable the e-signature provider callback webhooks (DocuSign / Adobe /
		// emdha). The HMAC over the raw body is verified fail-closed inside
		// SignatureService.ProviderEvent; the translators are otherwise dead code.
		WithSignatureService(signatureService)
	app.SCIMServer = scimServer
	app.SCIMTokenHandler = handler.NewSCIMTokenHandler(scimServer, hrIdentityRepo, deps.DB, deps.Logger)

	// CAP-152: pre-auth SSO handler. successRedirect is optional (empty => the
	// callback returns the platform session JSON). Mounted OUTSIDE the JWT chain in
	// RegisterRoutes (login is pre-session).
	app.SSOHandler = handler.NewSSOHandler(ssoLoginService, cfg.SSOSuccessRedirect, deps.Logger)

	// Effective Lex Session Contract (§4 / §17). The persona store persists the
	// last-selected active persona per (tenant, user); the service resolves the
	// contract from the caller's JWT role slugs using the AUTHORITATIVE auth code
	// map (auth.EffectivePermissions). Active persona is a UX model, not a backend
	// security boundary (§17.4).
	personaStore := repository.NewUserPersonaRepository(deps.DB, deps.Logger)
	app.PersonaService = service.NewPersonaService(personaStore, deps.Logger)
	app.PersonaHandler = handler.NewPersonaHandler(app.PersonaService, deps.Logger)

	return app, nil
}

func (a *Application) RegisterRoutes(r chi.Router, jwtMgr *auth.JWTManager, rdb *redis.Client, rateLimitPerMinute int, residencyMW, abacMW func(http.Handler) http.Handler) {
	// Bind the shared RS256 JWTManager as the reference-library file-service byte
	// path (Option A) token source now that it is in scope. Nil-safe end to end: a
	// nil manager (or a file client with no base URL) leaves the file-service path
	// not-ready, so downloads use the volume fallback / return a clear 502.
	if a.ReferenceLibraryService != nil {
		a.ReferenceLibraryService.BindFileServiceTokenSource(service.NewJWTFileServiceTokenSource(jwtMgr))
	}
	if a.LegalRequestAttachmentService != nil {
		a.LegalRequestAttachmentService.BindFileTokenSource(service.NewJWTRequestFileServiceTokenSource(jwtMgr))
	}
	if a.ManagerTaskService != nil {
		a.ManagerTaskService.BindFileTokenSource(service.NewJWTRequestFileServiceTokenSource(jwtMgr))
	}
	handler.RegisterRoutes(r, handler.RouteDependencies{
		Contract:                 a.ContractHandler,
		Clause:                   a.ClauseHandler,
		Document:                 a.DocumentHandler,
		DocumentArchive:          a.DocumentArchiveHandler,
		DocumentEditor:           a.DocumentEditorHandler,
		Compliance:               a.ComplianceHandler,
		Library:                  a.LibraryHandler,
		ReferenceLibrary:         a.ReferenceLibraryHandler,
		Matter:                   a.MatterHandler,
		Obligation:               a.ObligationHandler,
		ResolutionRate:           a.ResolutionRateHandler,
		Signature:                a.SignatureHandler,
		Playbook:                 a.PlaybookHandler,
		Dashboard:                a.DashboardHandler,
		Drafting:                 a.DraftingHandler,
		LegalHold:                a.LegalHoldHandler,
		WorkingCalendar:          a.WorkingCalendarHandler,
		OrgEntity:                a.OrgEntityHandler,
		RoleMatrix:               a.RoleMatrixHandler,
		RoleMatrixActorResolver:  roleMatrixActorResolver(a.RoleMatrixService),
		LegalRequest:             a.LegalRequestHandler,
		LegalRequestAttachment:   a.LegalRequestAttachmentHandler,
		RequestNote:              a.RequestNoteHandler,
		RequestApprovalPolicy:    a.RequestApprovalPolicyHandler,
		RequestApproval:          a.RequestApprovalHandler,
		ServiceCatalog:           a.ServiceCatalogHandler,
		Intake:                   a.IntakeHandler,
		SLA:                      a.SLAHandler,
		Execution:                a.ExecutionHandler,
		LegalCase:                a.LegalCaseHandler,
		CaseClassification:       a.CaseClassificationHandler,
		LegalCourt:               a.LegalCourtHandler,
		Litigation:               a.LitigationHandler,
		Investigation:            a.InvestigationHandler,
		Consultation:             a.ConsultationHandler,
		ManagerTask:              a.ManagerTaskHandler,
		SupportRequest:           a.SupportRequestHandler,
		CaseTimeline:             a.CaseTimelineHandler,
		Settlement:               a.SettlementHandler,
		ContractReviewDesk:       a.ContractReviewDeskHandler,
		ContractFinalVersion:     a.ContractFinalVersionHandler,
		ContractClauseComment:    a.ContractClauseCommentHandler,
		ContractClauseAmendment:  a.ContractClauseAmendmentHandler,
		ContractCompliance:       a.ContractComplianceHandler,
		ContractArchive:          a.ContractArchiveHandler,
		ContractCategory:         a.ContractCategoryHandler,
		MatterComment:            a.MatterCommentHandler,
		MatterDocument:           a.MatterDocumentHandler,
		MatterAudit:              a.MatterAuditHandler,
		MatterLink:               a.MatterLinkHandler,
		ContractAudit:            a.ContractAuditHandler,
		ContractBulk:             a.ContractBulkHandler,
		ContractInsights:         a.ContractInsightsHandler,
		SavedView:                a.SavedViewHandler,
		SignatureSummary:         a.SignatureSummaryHandler,
		SettlementDocument:       a.SettlementDocumentHandler,
		Reporting:                a.ReportingHandler,
		Workforce:                a.WorkforceHandler,
		AI:                       a.AIHandler,
		Notifications:            a.NotificationHandler,
		AttachmentPolicy:         a.AttachmentPolicyHandler,
		DocumentSearch:           a.DocumentSearchHandler,
		Integration:              a.IntegrationHandler,
		IntegrationResilience:    a.IntegrationResilienceHandler,
		IntegrationGovernance:    a.IntegrationGovernanceHandler,
		IntegrationObservability: a.IntegrationObservabilityHandler,
		IntegrationExtensibility: a.IntegrationExtensibilityHandler,
		IntegrationWebhook:       a.IntegrationWebhookHandler,
		SCIMServer:               a.SCIMServer,
		SCIMToken:                a.SCIMTokenHandler,
		SSO:                      a.SSOHandler,
		Persona:                  a.PersonaHandler,
		JWTManager:               jwtMgr,
		Redis:                    rdb,
		RateLimitPerMin:          rateLimitPerMinute,
		ResidencyMW:              residencyMW,
		ABACMW:                   abacMW,
		// WS5 granular org-RBAC resolver. *OrgEntityService satisfies
		// lexmw.OrgRoleResolver with no adapter; nil-safe (the inner gate degrades
		// to a pass-through when unset). The public webhook rate limiter is built
		// inside RegisterRoutes from the same rdb, so no extra wiring is needed here.
		OrgRoleResolver: a.OrgEntityService,
		// Dynamic-SoD (author != approver, design v2 §4.2) record resolvers. Each
		// reuses the domain service's by-id Get to project the record's author
		// (created_by) and, where the record tracks it, the prior-step approver
		// (settlement / consultation ApprovedBy) so the guard rejects a second sign-off
		// by the same person (two distinct approvers). Nil-safe: a nil service yields a
		// nil resolver, leaving the approve/close routes RBAC-only.
		CaseActorResolver:          legalCaseActorResolver(a.LegalCaseService),
		ContractActorResolver:      contractActorResolver(a.ContractService),
		InvestigationActorResolver: investigationActorResolver(a.InvestigationService),
		SettlementActorResolver:    settlementActorResolver(a.SettlementService),
		ConsultationActorResolver:  consultationActorResolver(a.ConsultationService),

		// Service-to-service Legal Affairs provisioning hook (onboarding → lex).
		// Gated by the shared LEX_INTERNAL_TOKEN; when unset the /internal route is
		// not registered (safe default). The closure applies the reusable starter
		// template to the named tenant.
		InternalServiceToken: os.Getenv("LEX_INTERNAL_TOKEN"),
		ProvisionLegalAffairs: func(ctx context.Context, tenantID, adminUserID uuid.UUID, includeSampleData bool) (uuid.UUID, error) {
			return ProvisionLegalAffairs(ctx, a, a.Logger, ProvisionLegalAffairsOptions{
				TenantID:          tenantID,
				AdminUserID:       adminUserID,
				IncludeSampleData: includeSampleData,
			})
		},
	})
}

// --- Dynamic-SoD record resolvers (design v2 §4.2) --------------------------
//
// Each adapter wraps a domain service's by-id Get into the transport-agnostic
// lexmw.ActorRecordResolver the RequireDistinctActor guard consumes. They live
// here (the composition root) so the middleware stays decoupled from the lex
// service/model packages. A nil service yields a nil resolver (the route family
// then runs RBAC-only); a not-found Get yields found=false so the guard fails
// CLOSED (deny) rather than silently allowing a self-approval.

// roleMatrixActorResolver resolves a role-matrix version's author for the
// four-eyes activation guard (importer != activator). Nil service ⇒ nil
// resolver ⇒ withDistinctActor leaves the tier unchanged — but the service
// ALSO re-asserts the distinct actor, so activation can never self-approve
// even if the guard is unwired.
func roleMatrixActorResolver(svc *service.RoleMatrixService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return handler.NewRoleMatrixVersionActorResolver(svc)
}

func legalCaseActorResolver(svc *service.LegalCaseService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		rec, err := svc.Get(ctx, tenantID, recordID)
		if err != nil {
			if apperrors.IsNotFound(err) {
				return lexmw.ActorRecord{}, false, nil
			}
			return lexmw.ActorRecord{}, false, err
		}
		if rec == nil {
			return lexmw.ActorRecord{}, false, nil
		}
		return lexmw.ActorRecord{CreatedBy: rec.CreatedBy}, true, nil
	}
}

func contractActorResolver(svc *service.ContractService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		detail, err := svc.GetContract(ctx, tenantID, recordID)
		if err != nil {
			if apperrors.IsNotFound(err) {
				return lexmw.ActorRecord{}, false, nil
			}
			return lexmw.ActorRecord{}, false, err
		}
		if detail == nil || detail.Contract == nil {
			return lexmw.ActorRecord{}, false, nil
		}
		return lexmw.ActorRecord{CreatedBy: detail.Contract.CreatedBy}, true, nil
	}
}

func investigationActorResolver(svc *service.InvestigationService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		rec, err := svc.Get(ctx, tenantID, recordID)
		if err != nil {
			if apperrors.IsNotFound(err) {
				return lexmw.ActorRecord{}, false, nil
			}
			return lexmw.ActorRecord{}, false, err
		}
		if rec == nil {
			return lexmw.ActorRecord{}, false, nil
		}
		return lexmw.ActorRecord{CreatedBy: rec.CreatedBy}, true, nil
	}
}

func settlementActorResolver(svc *service.SettlementService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		rec, err := svc.Get(ctx, tenantID, recordID)
		if err != nil {
			if apperrors.IsNotFound(err) {
				return lexmw.ActorRecord{}, false, nil
			}
			return lexmw.ActorRecord{}, false, err
		}
		if rec == nil {
			return lexmw.ActorRecord{}, false, nil
		}
		ar := lexmw.ActorRecord{CreatedBy: rec.CreatedBy}
		// A prior approver on the record blocks a repeat sign-off (two distinct
		// approvers, design v2 §4.2 / CAP Defendant §5.4).
		if rec.ApprovedBy != nil {
			ar.PriorApprovers = append(ar.PriorApprovers, *rec.ApprovedBy)
		}
		return ar, true, nil
	}
}

func consultationActorResolver(svc *service.ConsultationService) lexmw.ActorRecordResolver {
	if svc == nil {
		return nil
	}
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		rec, err := svc.Get(ctx, tenantID, recordID)
		if err != nil {
			if apperrors.IsNotFound(err) {
				return lexmw.ActorRecord{}, false, nil
			}
			return lexmw.ActorRecord{}, false, err
		}
		if rec == nil {
			return lexmw.ActorRecord{}, false, nil
		}
		ar := lexmw.ActorRecord{CreatedBy: rec.CreatedBy}
		// The advisor who AUTHORED the response cannot approve their own
		// response (dynamic SoD, design v2 §4.2): block responded_by alongside
		// created_by so a single person cannot both answer and sign off.
		if rec.RespondedBy != nil {
			ar.PriorApprovers = append(ar.PriorApprovers, *rec.RespondedBy)
		}
		if rec.ApprovedBy != nil {
			ar.PriorApprovers = append(ar.PriorApprovers, *rec.ApprovedBy)
		}
		return ar, true, nil
	}
}

// newContractFieldCrypto builds the lex contract field encryptor from config.
// Software mode decodes a base64 32-byte AES-256 key into the bundled software
// key provider. The same FieldCrypto would accept an ExternalKeyProvider for a
// Vault/KMS deployment without changing the repository call sites.
func newContractFieldCrypto(cfg *lexconfig.Config) (*lexcrypto.FieldCrypto, error) {
	if cfg.ContractFieldEncryptionMode == "external" {
		// External custody: the 32-byte AES key (base64) is sourced at runtime
		// from a file the deployment mounts from an external key store (KMS/Vault
		// via External-Secrets/CSI), so key material lives out of process and
		// config. The resolver re-reads on each Key() call so a remounted rotated
		// key is picked up. Production KMS-region attestation remains an infra gate.
		path := cfg.ContractFieldEncryptionKeyFile
		provider, err := lexcrypto.NewExternalKeyProvider("external-file", func() ([]byte, error) {
			raw, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil, fmt.Errorf("read contract field encryption key file: %w", readErr)
			}
			key, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
			if decErr != nil {
				return nil, fmt.Errorf("decode contract field encryption key file (base64): %w", decErr)
			}
			return key, nil
		})
		if err != nil {
			return nil, err
		}
		// Fail fast at startup if the externally-custodied key is missing/invalid,
		// rather than on the first encrypted write.
		if _, err := provider.Key(); err != nil {
			return nil, err
		}
		fc, err := lexcrypto.NewFieldCrypto(provider)
		if err != nil {
			return nil, err
		}
		return withContractFieldPreviousKeys(fc, cfg)
	}

	key, err := base64.StdEncoding.DecodeString(cfg.ContractFieldEncryptionKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode LEX_CONTRACT_FIELD_ENCRYPTION_KEY (base64): %w", err)
	}
	provider, err := lexcrypto.NewSoftwareKeyProvider(key)
	if err != nil {
		return nil, err
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		return nil, err
	}
	return withContractFieldPreviousKeys(fc, cfg)
}

// withContractFieldPreviousKeys registers the optional key-rotation fallback keys
// (LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS, already split into a base64 list
// by config.Load) as DECRYPT-ONLY software key providers on fc, newest-first.
// Each entry is a SUPERSEDED base64 32-byte AES-256 key: supplying them lets rows
// sealed under a rotated key stay readable until re-written under the current key
// (F50 / WTQ-SEC-04). Encrypt never consults these. An empty/unset list leaves fc
// unchanged — the current, no-rotation behavior.
func withContractFieldPreviousKeys(fc *lexcrypto.FieldCrypto, cfg *lexconfig.Config) (*lexcrypto.FieldCrypto, error) {
	if len(cfg.ContractFieldEncryptionPreviousKeysB64) == 0 {
		return fc, nil
	}
	providers := make([]lexcrypto.KeyProvider, 0, len(cfg.ContractFieldEncryptionPreviousKeysB64))
	for i, b64 := range cfg.ContractFieldEncryptionPreviousKeysB64 {
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
		if err != nil {
			return nil, fmt.Errorf("decode LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS[%d] (base64): %w", i, err)
		}
		provider, err := lexcrypto.NewSoftwareKeyProvider(key)
		if err != nil {
			return nil, fmt.Errorf("LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS[%d]: %w", i, err)
		}
		providers = append(providers, provider)
	}
	return fc.WithPreviousKeys(providers...), nil
}

func mustUUID(raw string) uuid.UUID {
	return uuid.MustParse(raw)
}
