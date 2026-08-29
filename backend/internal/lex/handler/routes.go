package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/ai"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service/integration"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// orgEntityFromQueryParam builds a lexmw.OrgEntityResolver that reads the target
// org entity id from a request query parameter (the owning/beneficiary org node
// of the resource being mutated). A missing/blank value yields (Nil,false,nil) so
// the granular org-RBAC gate is a transparent pass-through; a present-but-
// malformed value is surfaced as a resolver error (the gate fails closed).
func orgEntityFromQueryParam(param string) lexmw.OrgEntityResolver {
	return func(r *http.Request) (uuid.UUID, bool, error) {
		raw := r.URL.Query().Get(param)
		if raw == "" {
			return uuid.Nil, false, nil
		}
		id, err := uuid.Parse(raw)
		if err != nil {
			return uuid.Nil, false, err
		}
		return id, true, nil
	}
}

type RouteDependencies struct {
	Contract *ContractHandler
	Clause   *ClauseHandler
	Document *DocumentHandler
	// DocumentArchive is the document-scoped e-archive action (Othaim PRD 14.1):
	// push a document/version to the active e-archive connector + read its stamped
	// archive reference. Nil-safe (no routes when unset).
	DocumentArchive *DocumentArchiveHandler
	DocumentEditor  *DocumentEditorHandler
	Compliance      *ComplianceHandler
	Library         *LibraryHandler
	// ReferenceLibrary serves the GLOBAL, read-only WatheeqTech reference library
	// (cross-tenant Saudi legal corpus). Nil-safe: no routes when unset.
	ReferenceLibrary *ReferenceLibraryHandler
	Matter           *MatterHandler
	Obligation       *ObligationHandler
	ResolutionRate   *ResolutionRateHandler
	Signature        *SignatureHandler
	Playbook         *PlaybookHandler
	Dashboard        *DashboardHandler
	Drafting         *DraftingHandler
	LegalHold        *LegalHoldHandler
	WorkingCalendar  *WorkingCalendarHandler
	OrgEntity        *OrgEntityHandler
	// RoleMatrix is the tenant role-matrix import surface (template export,
	// dry-run/commit imports, versions, four-eyes activation). Nil when the
	// platform_core pool is unavailable — its routes are then not mounted and
	// enforcement stays on the code-map defaults.
	RoleMatrix *RoleMatrixHandler
	// RoleMatrixActorResolver resolves a matrix version's author for the
	// dynamic-SoD guard on activation (importer != activator).
	RoleMatrixActorResolver lexmw.ActorRecordResolver
	LegalRequest            *LegalRequestHandler
	LegalRequestAttachment  *LegalRequestAttachmentHandler
	RequestNote             *RequestNoteHandler
	RequestApprovalPolicy   *RequestApprovalPolicyHandler
	RequestApproval         *RequestApprovalHandler
	// Phase 1 modules.
	ServiceCatalog *ServiceCatalogHandler
	Intake         *IntakeHandler
	SLA            *SLAHandler
	Execution      *ExecutionHandler
	// Phase 2 modules.
	LegalCase          *LegalCaseHandler
	CaseClassification *CaseClassificationHandler
	LegalCourt         *LegalCourtHandler
	// Phase 3 modules.
	Litigation         *LitigationHandler
	Investigation      *InvestigationHandler
	Consultation       *ConsultationHandler
	ManagerTask        *ManagerTaskHandler
	SupportRequest     *SupportRequestHandler
	CaseTimeline       *CaseTimelineHandler
	Settlement         *SettlementHandler
	ContractReviewDesk *ContractReviewDeskHandler
	// Contract review-desk sub-resources (CAP-107..123). Each is nil-safe (no
	// routes when unset).
	ContractFinalVersion    *ContractFinalVersionHandler    // CAP-117 final-version ceremony.
	ContractClauseComment   *ContractClauseCommentHandler   // CAP-110 clause @mention comments.
	ContractClauseAmendment *ContractClauseAmendmentHandler // CAP-111 proposed clause amendments.
	ContractCompliance      *ContractComplianceHandler      // CAP-109 regulatory compliance check.
	ContractArchive         *ContractArchiveHandler         // CAP-122 archive lifecycle + search.
	ContractCategory        *ContractCategoryHandler        // CAP-123 manual categorize.
	// Contract list-workspace surfaces: portfolio-wide audit feed, bulk operations
	// (status transition + re-analyze), compute-on-read insight cards, saved list
	// views, and the batched per-contract e-signature roll-up. Each is nil-safe
	// (no routes when unset).
	ContractAudit    *ContractAuditHandler
	ContractBulk     *ContractBulkHandler
	ContractInsights *ContractInsightsHandler
	SavedView        *SavedViewHandler
	SignatureSummary *SignatureSummaryHandler
	// Matter sub-resources: collaboration comments, document links, audit feed,
	// and cross-domain related-items links. Each is nil-safe (no routes when unset).
	MatterComment  *MatterCommentHandler
	MatterDocument *MatterDocumentHandler
	MatterAudit    *MatterAuditHandler
	MatterLink     *MatterLinkHandler
	// Settlement sub-resource: document-registry links.
	SettlementDocument *SettlementDocumentHandler
	// Phase 4 modules.
	Reporting *ReportingHandler
	Workforce *WorkforceHandler
	// AI is the Lex legal AI assistant (LEX-LD-GAP-DESIGN §G4). Nil unless the
	// deployment sets LEX_AI_ENABLED, in which case none of its routes are
	// mounted at all — the surface 404s rather than 403s when switched off.
	AI               *ai.Handler
	Notifications    *NotificationHandler
	AttachmentPolicy *AttachmentPolicyHandler
	DocumentSearch   *DocumentSearchHandler
	Integration      *IntegrationHandler
	// IntegrationResilience serves the integration RELIABILITY surfaces (DLQ #11 +
	// circuit-breaker controls #12). Gated read for lists/state, manage for replay +
	// reset. Nil-safe: when unset, no reliability routes.
	IntegrationResilience *IntegrationResilienceHandler
	// IntegrationGovernance serves the integration GOVERNANCE surfaces (#13 maker-
	// checker pending changes + #15 data-residency / field-egress policy). Reads gate
	// the read tier, propose/approve/reject + egress-policy PUT gate manage. Nil-safe:
	// when unset, no governance routes.
	IntegrationGovernance *IntegrationGovernanceHandler
	// IntegrationObservability serves the integration OBSERVABILITY surfaces (#16
	// per-connector metrics + SLOs, #17 inbound-event inspector + replay). Reads gate
	// the read tier (metrics/overview/event lists), replay gates manage. Nil-safe:
	// when unset, no observability routes.
	IntegrationObservability *IntegrationObservabilityHandler
	// IntegrationExtensibility serves the integration EXTENSIBILITY surfaces (#20
	// conflict queue: list per-endpoint conflicts + resolve one). Reads gate the read
	// tier, resolve gates manage. The #18 custom connector and #19 sync rules ride the
	// existing config-driven CRUD path and need no extra route. Nil-safe: when unset,
	// no conflict routes.
	IntegrationExtensibility *IntegrationExtensibilityHandler
	// IntegrationWebhook serves the PUBLIC pre-auth integration webhooks (Nafath
	// identity callback). Mounted OUTSIDE the JWT chain (HMAC-authenticated).
	// Nil-safe: when unset, no integration-webhook routes.
	IntegrationWebhook *IntegrationWebhookHandler
	// SCIMServer is the inbound SCIM 2.0 server (kind=hr). Routes() carries its own
	// per-tenant SCIM-bearer middleware, so it is mounted OUTSIDE the JWT chain.
	// Nil-safe: when unset, no /scim/v2 routes.
	SCIMServer *integration.SCIMServer
	// SCIMToken issues + lists the per-endpoint inbound SCIM bearer tokens. Gated
	// lex:integration:manage inside the JWT chain. Nil-safe.
	SCIMToken *SCIMTokenHandler
	// SSO is the pre-auth lex suite SSO login handler (CAP-152). Mounted OUTSIDE
	// the JWT chain (login is pre-session). Nil-safe: when unset, no SSO routes.
	SSO *SSOHandler
	// Persona serves the Effective Lex Session Contract (§4 / §17): GET /me +
	// POST /persona. Gated on auth only (any authenticated user; a non-legal user
	// gets NO_LEX_ROLE_ASSIGNED). Nil-safe: when unset, no persona routes.
	Persona         *PersonaHandler
	JWTManager      *auth.JWTManager
	Redis           *redis.Client
	RateLimitPerMin int
	// ResidencyMW enforces WTQ-SEC-03 data residency after tenant resolution.
	// Nil when residency enforcement is not wired (pass-through).
	ResidencyMW func(http.Handler) http.Handler
	// ABACMW applies the WTQ-SEC-01 attribute-policy layer after RBAC. Nil when
	// the ABAC engine is not configured (pass-through, RBAC-only).
	ABACMW func(http.Handler) http.Handler
	// OrgRoleResolver is the CAP-153 org-registry RBAC resolver (WS5). Satisfied by
	// *service.OrgEntityService with no adapter. When nil the granular org-verb gate
	// on destructive/admin routes is a transparent pass-through (the coarse
	// lex:read/lex:write tier remains the sole authority), so wiring it cannot
	// regress existing flows. The inner gate also passes through whenever a route
	// resolves NO target org entity (admin:* holders bypass entirely).
	OrgRoleResolver lexmw.OrgRoleResolver
	// Dynamic-SoD (author != approver) record resolvers, one per legal-affairs
	// domain whose :approve/:close routes carry the record id as the {id} path
	// param (design v2 §4.2). Each loads the record's author (+ any prior-step
	// approver) so RequireDistinctActor can 403 a user who is approving/closing a
	// record they themselves authored — REGARDLESS of the capability key they hold.
	// Nil-safe: when a resolver is unset the corresponding approve/close routes are
	// gated by RBAC only (no dynamic-SoD layer), so wiring it cannot regress flows.
	CaseActorResolver          lexmw.ActorRecordResolver
	ContractActorResolver      lexmw.ActorRecordResolver
	InvestigationActorResolver lexmw.ActorRecordResolver
	SettlementActorResolver    lexmw.ActorRecordResolver
	ConsultationActorResolver  lexmw.ActorRecordResolver

	// InternalServiceToken gates the service-to-service /internal/lex/* routes
	// (X-Service-Token, like the license-service internal API). Empty disables
	// them — the routes are simply not registered.
	InternalServiceToken string
	// ProvisionLegalAffairs applies the Legal Affairs starter template to a tenant
	// (the onboarding hook). adminUserID (uuid.Nil = none) is granted the
	// legal-system-admin role for the tenant when platform_core is reachable. Nil
	// disables the /internal/lex/provision route.
	ProvisionLegalAffairs func(ctx context.Context, tenantID, adminUserID uuid.UUID, includeSampleData bool) (uuid.UUID, error)
}

func RegisterRoutes(r chi.Router, deps RouteDependencies) {
	// CAP-002 public email webhook. Registered OUTSIDE the JWT/TenantGuard chain:
	// it carries NO bearer token and NO tenant context. Authentication is the
	// HMAC signature header, verified inside the handler against the addressed
	// mailbox's decrypted ingest secret; the handler then resolves the tenant from
	// the mailbox via an RLS-bypass system read before running in tenant context.
	// Mounted on both suite prefixes to mirror the JWT routes.
	if deps.Intake != nil {
		// WS5: per-source-IP fixed-window rate limit on the unauthenticated webhook
		// (60/min/IP default). Blunts brute-force HMAC probing / mailbox enumeration
		// without impacting a well-behaved upstream mail provider. Fails OPEN to an
		// in-process limiter on any Redis error, and is a transparent pass-through
		// when the limit is non-positive — so a single legitimate call still reaches
		// the handler's body validation (preserving the public 400 contract).
		webhookRL := lexmw.WebhookRateLimiter(deps.Redis, lexmw.WebhookRateLimitDefaults())
		r.With(webhookRL).Post("/api/v1/lex/intake/email/webhook", deps.Intake.IngestEmail)
		r.With(webhookRL).Post("/api/v1/watheeq/intake/email/webhook", deps.Intake.IngestEmail)

		// Provider inbound-parse receiver (SES / Mailgun / SendGrid / Postmark). Also
		// PRE-AUTH and rate-limited exactly like the webhook, but its authentication is
		// the PROVIDER'S OWN signature/shared-secret verified inside the handler (NOT the
		// per-mailbox HMAC). It FAILS CLOSED: an unknown or unconfigured {provider}
		// returns 404 (receiver disabled), a bad signature returns 401 — so a provider
		// with no configured secret is never an unauthenticated ingest. Going live also
		// needs the provider inbound route + DNS MX + LEX_INBOUND_EMAIL_<PROVIDER>_SECRET
		// (an operator/deploy gate, not code). Mirrors the webhook on both suite prefixes.
		r.With(webhookRL).Post("/api/v1/lex/intake/email/inbound/{provider}", deps.Intake.IngestInboundParsed)
		r.With(webhookRL).Post("/api/v1/watheeq/intake/email/inbound/{provider}", deps.Intake.IngestInboundParsed)
	}

	// CAP-152 SSO login. PRE-AUTH (no bearer token / no tenant context yet): the
	// browser hits /initiate to be redirected to the external IdP, and the IdP
	// redirects back to /callback where the canonical platform IAM federation path
	// mints the session. Registered OUTSIDE the JWT/TenantGuard chain on both suite
	// prefixes, exactly like the public email webhook above. Nil-safe.
	if deps.SSO != nil {
		r.Mount("/api/v1/lex/auth/sso", deps.SSO.Routes())
		r.Mount("/api/v1/watheeq/auth/sso", deps.SSO.Routes())
	}

	// Phase-2 integration webhooks. PRE-AUTH (no bearer token / no tenant context):
	// authentication is the per-endpoint HMAC signature, verified inside the handler
	// against the endpoint's DECRYPTED webhook secret; the tenant is taken from the
	// path. Registered OUTSIDE the JWT/TenantGuard chain and rate-limited exactly
	// like the public email webhook above. Nil-safe.
	if deps.IntegrationWebhook != nil {
		webhookRL := lexmw.WebhookRateLimiter(deps.Redis, lexmw.WebhookRateLimitDefaults())
		// Nafath identity-confirmation callback (NafathVerificationCompleted).
		r.With(webhookRL).Post("/webhooks/lex/nafath/verify/{tenantID}", deps.IntegrationWebhook.NafathVerify)
		r.With(webhookRL).Post("/webhooks/watheeq/nafath/verify/{tenantID}", deps.IntegrationWebhook.NafathVerify)

		// E-signature provider status callbacks (DocuSign Connect / Adobe Sign /
		// emdha). PRE-AUTH: authentication is the per-endpoint HMAC over the raw
		// body, verified FAIL-CLOSED inside SignatureService.ProviderEvent (a bad or
		// missing signature is rejected 403). {provider} selects the translator;
		// {tenantID}/{id} resolve the lex envelope (matches the catalog
		// EnvelopeStatusChanged template). Registered only when the signature
		// service is wired on the handler.
		r.With(webhookRL).Post("/webhooks/lex/esign/{provider}/{tenantID}/{id}", deps.IntegrationWebhook.EsignProviderEvent)
		r.With(webhookRL).Post("/webhooks/watheeq/esign/{provider}/{tenantID}/{id}", deps.IntegrationWebhook.EsignProviderEvent)
	}

	// Phase-2 inbound SCIM 2.0 server (kind=hr). Routes() carries its OWN per-tenant
	// SCIM-bearer middleware (resolves the tenant by token hash), so it must NOT be
	// wrapped in the JWT chain. Mounted at a single top-level /scim/v2. Nil-safe.
	if deps.SCIMServer != nil {
		r.Mount("/scim/v2", deps.SCIMServer.Routes())
	}

	if deps.DocumentEditor != nil {
		r.Get("/api/v1/lex/editor/guest-portal/{token}", deps.DocumentEditor.GuestPortalToken)
		r.Post("/api/v1/lex/editor/guest-portal/{token}/session", deps.DocumentEditor.GuestPortalTokenSession)
		r.Post("/api/v1/lex/editor/guest-portal/{token}/comments", deps.DocumentEditor.GuestPortalTokenComment)
		r.Get("/api/v1/watheeq/editor/guest-portal/{token}", deps.DocumentEditor.GuestPortalToken)
		r.Post("/api/v1/watheeq/editor/guest-portal/{token}/session", deps.DocumentEditor.GuestPortalTokenSession)
		r.Post("/api/v1/watheeq/editor/guest-portal/{token}/comments", deps.DocumentEditor.GuestPortalTokenComment)
	}

	// Service-to-service provisioning hook (onboarding → lex). Registered OUTSIDE
	// the JWT chain and gated by the shared X-Service-Token (like the license
	// internal API). Applies the Legal Affairs starter template to a tenant that
	// subscribed to Watheeq. Registered only when both the token and the hook are
	// wired (env-driven), so it is a safe no-op when LEX_INTERNAL_TOKEN is unset.
	if deps.InternalServiceToken != "" && deps.ProvisionLegalAffairs != nil {
		r.With(sharedmw.ServiceToken(deps.InternalServiceToken)).
			Post("/internal/lex/provision", provisionLegalAffairsHandler(deps))
	}

	r.Route("/api/v1/lex", func(r chi.Router) {
		registerLexHandlers(r, deps)
	})
	r.Route("/api/v1/watheeq", func(r chi.Router) {
		registerLexHandlers(r, deps)
	})
}

func registerLexHandlers(r chi.Router, deps RouteDependencies) {
	r.Use(sharedmw.Auth(deps.JWTManager))
	r.Use(lexmw.TenantGuard)
	if deps.ResidencyMW != nil {
		r.Use(deps.ResidencyMW)
	}
	r.Use(lexmw.RateLimiter(deps.Redis, deps.RateLimitPerMin))

	read := r.With(sharedmw.RequirePermission(auth.PermLexRead))
	write := r.With(sharedmw.RequirePermission(auth.PermLexWrite))
	// Reporting workspaces are intentionally usable by the granular report
	// reader without requiring the broad legacy lex:read grant. Keep this router
	// available to the row-report exports and report-definition preference store,
	// as well as the Phase-4 analytics endpoints below.
	reportRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexReportRead, auth.PermLexRead))

	// Effective Lex Session Contract (§4 / §17.1 / §17.3). Registered on the bare
	// authenticated group `r` (Auth + TenantGuard + RateLimiter already applied) —
	// NOT behind lex:read — because ANY authenticated user must be able to discover
	// their Lex access: a non-legal caller gets NO_LEX_ROLE_ASSIGNED + /dashboard
	// rather than a 403 (§2.4 no silent denial). Active persona is a UX model, not a
	// new authorization boundary (§17.4); these routes do not change any existing
	// route's authorization. Nil-safe.
	if deps.Persona != nil {
		r.Get("/me", deps.Persona.Me)
		r.Post("/persona", deps.Persona.SetPersona)
	}

	// WTQ-SEC-01: ABAC attribute-policy layer AFTER RBAC. Additive and
	// backward-compatible: with no matching tenant policy the engine allows, so
	// routes are unaffected until a tenant configures an attribute policy.
	if deps.ABACMW != nil {
		read = read.With(deps.ABACMW)
		write = write.With(deps.ABACMW)
		reportRead = reportRead.With(deps.ABACMW)
	}

	// WS5 granular org-RBAC inner gates. These layer the CAP-153 five-verb
	// org-registry check on top of the coarse lex:write tier for destructive /
	// admin-config routes ONLY. All are ADDITIVE and BACKWARD-COMPATIBLE:
	//   * deps.OrgRoleResolver == nil            -> transparent pass-through.
	//   * the request resolves NO target entity  -> pass-through.
	//   * the actor holds admin:*                -> bypass.
	// The target org entity is taken from an optional `entity_id` query parameter
	// (the owning/beneficiary org node of the resource); when it is absent the
	// gate is a no-op, so existing clients that do not yet send it keep working
	// while a client that DOES send it gets the per-entity verb enforced. Delete
	// routes map to the `close` verb; admin-config create/update/delete map to
	// `edit` (SLA targets, being an approval-config surface, map to `approve`).
	orgEntityFromQuery := orgEntityFromQueryParam("entity_id")
	requireOrgClose := func(rt chi.Router) chi.Router {
		return rt.With(lexmw.RequireOrgVerb(deps.OrgRoleResolver, orgEntityFromQuery, model.OrgRBACVerbClose))
	}
	requireOrgEdit := func(rt chi.Router) chi.Router {
		return rt.With(lexmw.RequireOrgVerb(deps.OrgRoleResolver, orgEntityFromQuery, model.OrgRBACVerbEdit))
	}
	requireOrgApprove := func(rt chi.Router) chi.Router {
		return rt.With(lexmw.RequireOrgVerb(deps.OrgRoleResolver, orgEntityFromQuery, model.OrgRBACVerbApprove))
	}
	// Admin-config edit/approve tiers. These are EDIT-class admin-config surfaces
	// (working-calendar / mailbox CRUD), where design v2 §4.4 intentionally RETAINS
	// the coarse lex:write fallback for migration compat — so they keep the coarse
	// `write` tier with the org-RBAC `edit` recipient check layered on top.
	//
	// F7: the working-calendar surface is a CATALOG-class admin-config surface owned
	// by the System Administrator (legal-system-admin) persona, which holds
	// lex:catalog:manage but NO coarse lex:write — so on the bare `write` tier the
	// persona designated to configure the calendar was 403'd on every CRUD row. Gate
	// its writes on the granular catalog:manage verb with the coarse lex:write kept as
	// a RequireAnyPermission fallback (mirroring the 8c7b3ba9 integration fix), then
	// layer the SAME org-RBAC `edit` recipient check on top; reads move onto catalogView
	// at the registration site below. Intake mailbox CRUD is the SAME class of
	// admin-config surface (CAP-002 email intake) naturally owned by the same
	// legal-system-admin persona, so it reuses the identical catalog:manage-OR-write
	// tier (calendarWrite) with the org-RBAC `edit` check layered on top; its reads
	// likewise move onto catalogView at the registration site below.
	calendarWrite := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexWrite))
	if deps.ABACMW != nil {
		calendarWrite = calendarWrite.With(deps.ABACMW)
	}
	calendarAdmin := requireOrgEdit(calendarWrite)
	mailboxAdmin := requireOrgEdit(calendarWrite)
	// NOTE: the destructive close-verb tiers for the five core verticals
	// (caseClose/investigationClose/settlementClose/consultationClose/requestClose)
	// are built further down, AFTER the per-domain elevated helpers, on the per-domain
	// lex:<domain>:close key (NO coarse lex:write fallback — design v2 §4.4) with the
	// org-RBAC `close` recipient check still layered on top.

	// ---------------------------------------------------------------------------
	// Legal System Role Matrix per-domain RBAC (Legal_Role_Matrix_Design.md §4).
	// Each tier gates a capability family on its granular lex:<domain>:<verb> key
	// OR a coarse legacy fallback (lex:read / lex:write), so the 14 named legal
	// roles get least-privilege per-domain enforcement while existing lex:read /
	// lex:write / lex:* / admin:* roles keep working unchanged. The :approve /
	// :close tiers are the SoD control points — an officer role (which carries
	// only :add/:edit/:view on a domain) is denied the approve/close routes.
	//
	// These layer the matrix verb on top of the coarse outer gate; where a route
	// also has an org-RBAC inner gate (the close-verb tiers built above), that gate
	// still applies — the matrix tier replaces the COARSE outer gate, not the
	// org-scoped recipient check.
	domainView := func(domainKey string) chi.Router {
		return r.With(sharedmw.RequireAnyPermission(domainKey, auth.PermLexRead))
	}
	domainWrite := func(domainKey string) chi.Router {
		return r.With(sharedmw.RequireAnyPermission(domainKey, auth.PermLexWrite))
	}
	// SoD control points (:approve / :close / :assign / :distribute / :manage).
	// design v2 §4.4 / changelog #5: these elevated verbs accept NO coarse fallback
	// at all — not lex:write, AND not the granular cross-cutting lex:approve /
	// lex:close. A legacy lex:write (or lex:approve / lex:close) holder is therefore
	// DENIED on every approve/close/assign/distribute/manage route; only the exact
	// per-domain key (or a wildcard that prefix-matches it, e.g. lex:case:* /
	// lex:* / admin:*) passes. This is what makes the §7 acceptance bullets provable:
	// an officer holding lex:write cannot approve/close, and a manage-only ADM cannot
	// approve a case. (The coarse-fallback domainView/domainWrite above remain for
	// the view/add/edit routes, where migration compat is intentionally retained.)
	domainElevated := func(domainKey string) chi.Router {
		return r.With(sharedmw.RequirePermission(domainKey))
	}
	domainApprove := domainElevated
	domainClose := domainElevated
	applyABAC := func(rt chi.Router) chi.Router {
		if deps.ABACMW != nil {
			return rt.With(deps.ABACMW)
		}
		return rt
	}
	// Peer support is intentionally its own granular permission family. It has no
	// coarse lex:read/lex:write fallback: only roles explicitly granted support
	// access (including the walkthrough requester's create/track tier) may reach
	// the legal-staff directory.
	supportView := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexSupportView)))
	supportCreate := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexSupportCreate)))
	supportRespond := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexSupportRespond)))
	// Dynamic SoD (author != approver, design v2 §4.2). Wrap an already-RBAC-gated
	// elevated tier with the RequireDistinctActor guard for the given domain when its
	// record resolver is wired; the guard loads the target {id} record and 403s if the
	// acting user authored it (or already approved a prior step). Nil-safe: with no
	// resolver the tier is returned unchanged (RBAC-only), so this cannot regress.
	//
	// IMPORTANT: the guard is layered onto the actual approval DECISION and CLOSE
	// routes only — NOT onto the "start approval" / "submit for approval" kickoff
	// routes, which are author-initiated BY DESIGN (the drafter submits their own work
	// into the chain). Those kickoffs keep the plain RBAC :approve tier; the distinct
	// approver is enforced where the verdict is rendered.
	withDistinctActor := func(rt chi.Router, resolver lexmw.ActorRecordResolver) chi.Router {
		if resolver == nil {
			return rt
		}
		return rt.With(lexmw.RequireDistinctActor(resolver, "id"))
	}
	// Case domain.
	caseView := applyABAC(domainView(auth.PermLexCaseView))
	caseAdd := applyABAC(domainWrite(auth.PermLexCaseAdd))
	caseEdit := applyABAC(domainWrite(auth.PermLexCaseEdit))
	// Restricted verb assign (work allocation) is its OWN elevated gate — NOT implied
	// by :edit (design v2 §2.1). An officer holding case:edit (for drafting) must NOT
	// reach case assignment; only case:assign (section-manager/director) does.
	caseAssign := applyABAC(domainElevated(auth.PermLexCaseAssign))
	caseApprove := applyABAC(domainApprove(auth.PermLexCaseApprove))
	caseDecision := withDistinctActor(caseApprove, deps.CaseActorResolver)
	// Contract domain.
	contractView := applyABAC(domainView(auth.PermLexContractView))
	contractAdd := applyABAC(domainWrite(auth.PermLexContractAdd))
	contractEdit := applyABAC(domainWrite(auth.PermLexContractEdit))
	// Marking delivered contract work achieved is restricted to an actual
	// contract editor. Unlike ordinary edit routes, there is no coarse lex:write
	// fallback: a non-contract legal operator must not achieve contract work.
	contractAchievement := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexContractEdit)))
	// Starting a review is a drafter-initiated submission, not an approval
	// verdict. Admit contract creators (:add) as well as the existing editors and
	// coarse-write compatibility roles. StartReview narrows an add-only actor to
	// their own draft; workflow decisions remain on contractReview below and still
	// require :edit/:approve plus the service-level assignee + distinct-actor checks.
	contractReviewStart := applyABAC(r.With(sharedmw.RequireAnyPermission(
		auth.PermLexContractAdd,
		auth.PermLexContractEdit,
		auth.PermLexWrite,
	)))
	// Preparing a review request (opening intake and managing its attachments) is
	// part of the creator workflow too. The service narrows add-only callers to
	// their own draft contract; editors and coarse-write compatibility roles keep
	// their existing cross-record access.
	contractReviewPrepare := applyABAC(r.With(sharedmw.RequireAnyPermission(
		auth.PermLexContractAdd,
		auth.PermLexContractEdit,
		auth.PermLexWrite,
	)))
	// Restricted verb distribute (contract work allocation) is its OWN elevated gate —
	// NOT implied by :edit (design v2 §2.1). Supervisor/manager only.
	contractDistribute := applyABAC(domainElevated(auth.PermLexContractDistribute))
	// Contract sign-off (PUT status) and close (DELETE) ARE the decision points, so
	// both carry the dynamic-SoD guard (the contract drafter cannot self-sign-off).
	contractApprove := withDistinctActor(applyABAC(domainApprove(auth.PermLexContractApprove)), deps.ContractActorResolver)
	contractClose := withDistinctActor(applyABAC(domainClose(auth.PermLexContractClose)), deps.ContractActorResolver)
	// Contract-review WORKFLOW decision tier (the /workflows/.../decision and
	// /workflows/tasks/bulk-decision routes). design v2 §4.4: these routes render an
	// approve/reject VERDICT on a contract (approve -> pending_signature, reject ->
	// cancelled) and MUST NOT sit on the coarse lex:write fallback — a bare lex:write
	// holder (e.g. legal-officer, who carries NO contract verb) was previously able to
	// decide a contract review task. But the contract review workflow is a MULTI-TIER
	// approval chain: the SAME route also carries the legitimate FIRST-TIER reviewers
	// (legal-contracts-supervisor / legal-advisor) whose only contract verb is
	// lex:contract:edit (they review/recommend; they hold NO :approve). Gating on bare
	// RequirePermission(lex:contract:approve) would lock those reviewers out of their
	// own chain step, so we gate on RequireAnyPermission(lex:contract:approve,
	// lex:contract:edit) — NO lex:write. This is the (capability key) layer of the
	// §4.2 intersection: a bare-lex:write actor is excluded here, while the per-tier
	// authority (WHICH step each may decide) is still decided by the chain recipient
	// (validateWorkflowDecisionActor: assignee / claimed-by / assignee-role) and the
	// distinct-actor parity (decider != contract author) is enforced in the service
	// (DecideTask, see workflow_service.go) since the contract id is not a URL param
	// on these routes (only {workflowInstanceID}/{taskID}; bulk carries neither), so
	// the URL-keyed lexmw.RequireDistinctActor cannot be wired at the router.
	contractReview := applyABAC(r.With(sharedmw.RequireAnyPermission(auth.PermLexContractApprove, auth.PermLexContractEdit)))
	// Request approval-decision tier (the /requests/{id}/approval/.../decision route).
	// design v2 §4.4: this route renders the DOA approve/reject VERDICT on a legal
	// request and MUST NOT sit on the coarse approvalWrite (lex:approval:write OR
	// lex:write) fallback — a bare lex:write holder (e.g. legal-officer, whose only
	// request verb is request:edit, i.e. a drafter/reviser, NOT an approver) was
	// previously able to render it. The request approval chain is a chain of PURE
	// approve steps (requester-side DOA → provider-side DOA); every legitimate decider
	// (legal-dept-manager / legal-bu-ceo / legal-ceo and the legal-side approvers) holds
	// lex:request:approve, and NO legitimate decider holds only request:edit, so the
	// strictest gate that excludes the leak without locking out a real approver is
	// RequirePermission(lex:request:approve) — no lex:write, no request:edit. This is the
	// (capability key) layer of the §4.2 intersection; WHICH step routes to whom is still
	// decided by the chain recipient (orchestrator validateOrchestratorActor) and the
	// distinct-actor parity (decider != request author) is enforced in the service
	// (RequestApprovalService.DecideTask), where the request row's created_by is loaded.
	requestDecision := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexRequestApprove)))
	// Case workflow-decision tier (the litigation pleading-approval and defendant
	// response-review decision routes). design v2 §4.4: both render an approve/reject
	// VERDICT on a case-domain record and MUST NOT sit on the coarse approvalWrite
	// fallback. Unlike the request chain, the case-domain review chains carry a
	// legitimate first-tier reviewer whose only case verb is lex:case:edit (the
	// defendant memo's tier-1 supervisor reviews on :edit; the section-manager tier-2
	// approves on :approve), so — exactly like contractReview — the gate admits :edit
	// too: RequireAnyPermission(lex:case:approve, lex:case:edit), NO lex:write. The
	// per-tier authority (WHICH tier each may decide) is then narrowed by the chain
	// recipient (orchestrator validateOrchestratorActor: assignee-role section_manager /
	// supervisor) and, for the two-tier memo, the engine's require_distinct_approvers
	// flag (tier-1 != tier-2). Distinct-actor parity (decider != record author) is
	// enforced in the services (DecidePleadingApproval / DecideResponseReview).
	caseDecisionWorkflow := applyABAC(r.With(sharedmw.RequireAnyPermission(auth.PermLexCaseApprove, auth.PermLexCaseEdit)))
	// Investigation domain.
	investigationView := applyABAC(domainView(auth.PermLexInvestigationView))
	investigationAdd := applyABAC(domainWrite(auth.PermLexInvestigationAdd))
	investigationEdit := applyABAC(domainWrite(auth.PermLexInvestigationEdit))
	investigationApprove := applyABAC(domainApprove(auth.PermLexInvestigationApprove))
	investigationDecision := withDistinctActor(investigationApprove, deps.InvestigationActorResolver)
	// The shared status endpoint carries both edit-class edges and the elevated
	// approved->closed edge. Admit either tier here; UpdateStatus re-gates a close
	// target on the exact close permission and dynamic SoD. This avoids forcing a
	// legitimate close-only actor to also hold the unrelated edit verb.
	investigationStatus := applyABAC(r.With(sharedmw.RequireAnyPermission(
		auth.PermLexInvestigationEdit,
		auth.PermLexInvestigationClose,
		auth.PermLexWrite,
	)))
	// Settlement domain (no standalone add; create maps to edit per design §3).
	settlementView := applyABAC(domainView(auth.PermLexSettlementView))
	settlementEdit := applyABAC(domainWrite(auth.PermLexSettlementEdit))
	settlementApprove := applyABAC(domainApprove(auth.PermLexSettlementApprove))
	settlementDecision := withDistinctActor(settlementApprove, deps.SettlementActorResolver)
	// Consultation domain.
	consultationView := applyABAC(domainView(auth.PermLexConsultationView))
	consultationAdd := applyABAC(domainWrite(auth.PermLexConsultationAdd))
	consultationEdit := applyABAC(domainWrite(auth.PermLexConsultationEdit))
	consultationApprove := applyABAC(domainApprove(auth.PermLexConsultationApprove))
	consultationDecision := withDistinctActor(consultationApprove, deps.ConsultationActorResolver)
	managerTaskDecision := applyABAC(r.With(sharedmw.RequireAnyPermission(
		auth.PermLexCaseApprove,
		auth.PermLexContractApprove,
		auth.PermLexWrite,
	)))
	// Request domain.
	requestView := applyABAC(domainView(auth.PermLexRequestView))
	requestAdd := applyABAC(domainWrite(auth.PermLexRequestAdd))
	requestEdit := applyABAC(domainWrite(auth.PermLexRequestEdit))
	requestRequirementUpdate := applyABAC(r.With(sharedmw.RequireAnyPermission(
		auth.PermLexRequestEdit,
		auth.PermLexWrite,
	)))
	requestApprove := applyABAC(domainApprove(auth.PermLexRequestApprove))

	// Destructive close-verb tiers (DELETE on the five core verticals + request).
	// design v2 §4.4: `close` is an ELEVATED verb — gate on the per-domain
	// lex:<domain>:close key with NO coarse lex:write fallback (a legacy lex:write
	// holder cannot delete/close), and keep the org-RBAC `close` recipient check
	// layered on top (transparent pass-through when no entity_id is supplied), so the
	// prior org-scoped behaviour is preserved while the coarse bypass is removed.
	caseClose := requireOrgClose(applyABAC(domainClose(auth.PermLexCaseClose)))
	investigationClose := requireOrgClose(applyABAC(domainClose(auth.PermLexInvestigationClose)))
	settlementClose := requireOrgClose(applyABAC(domainClose(auth.PermLexSettlementClose)))
	consultationClose := requireOrgClose(applyABAC(domainClose(auth.PermLexConsultationClose)))
	requestClose := requireOrgClose(applyABAC(domainClose(auth.PermLexRequestClose)))
	// Catalog (manage-class config). View for reads; manage is an ELEVATED verb with
	// no coarse lex:write fallback (design v2 §4.4) — a legacy lex:write holder cannot
	// manage the service catalog.
	catalogView := applyABAC(domainView(auth.PermLexCatalogView))
	catalogManage := applyABAC(domainElevated(auth.PermLexCatalogManage))
	// Security / data-governance config (manage-class). F8: the Org & Entity Registry
	// (CAP-008/017/018/019/106/153) is a security surface owned by the System
	// Administrator (legal-system-admin) persona, which holds lex:security:manage but
	// NO coarse lex:read/lex:write — so on the bare read/write tiers it was 403'd on its
	// own surface. Gate reads on the granular security:view verb and writes on
	// security:manage, each keeping the coarse lex:read/lex:write as a RequireAnyPermission
	// fallback so all 13 coarse-access roles keep working (mirrors the 8c7b3ba9 integration
	// fix). ADM's security:manage expands to security:view via expandGrants (security is a
	// config domain), so it passes the reads too. Additive — nothing loses access.
	securityView := applyABAC(domainView(auth.PermLexSecurityView))
	securityManage := applyABAC(domainWrite(auth.PermLexSecurityManage))
	// SLA config (manage-class). manage is elevated (no coarse lex:write fallback).
	slaTargetView := applyABAC(domainView(auth.PermLexSLAView))
	slaManage := applyABAC(domainElevated(auth.PermLexSLAManage))
	// SLA-target config is BOTH a matrix manage-class surface (lex:sla:manage /
	// coarse lex:write) AND an approval-config org-RBAC surface: layer the org
	// `approve` recipient check on top of the manage gate (transparent pass-through
	// when no entity_id is supplied), preserving the prior slaTargetAdmin behaviour.
	slaTargetAdmin := requireOrgApprove(slaManage)

	// Matrix domain `contract` (CAP-094..125, §F). The core contract aggregate
	// routes gate on the contract verbs: reads -> :view, create/intake -> :add,
	// review/distribute/mutate -> :edit, final sign-off (status transition) ->
	// :approve. Each falls back to coarse lex:read/lex:write so existing roles keep
	// access; the deep CLM sub-resources (clause comments/amendments/deviations/
	// compliance) stay on the coarse tier as they are outside the matrix's contract
	// verbs.
	contractView.Get("/contracts/expiring", deps.Contract.Expiring)
	contractView.Get("/contracts/renewal-warnings", deps.Contract.RenewalWarnings)
	contractView.Get("/contracts/stats", deps.Contract.Stats)
	contractView.Get("/contracts/search", deps.Contract.Search)
	// CAP-123 manual category catalog. Static /contracts/categories segment routes
	// distinctly from the bare list + /contracts/{id} param below.
	if deps.ContractCategory != nil {
		contractView.Get("/contracts/categories", deps.ContractCategory.ListCategories)
	}
	// Portfolio-wide contract audit feed. Static /contracts/audit segment routes
	// distinctly from /contracts/{id}, following the /contracts/archived precedent.
	// Same effective read tier as every other /contracts GET (lex:contract:view
	// with the coarse lex:read fallback).
	if deps.ContractAudit != nil {
		contractView.Get("/contracts/audit", deps.ContractAudit.ListPortfolioAudit)
	}
	// Compute-on-read portfolio insight cards (read-only, no mutation verbs).
	if deps.ContractInsights != nil {
		contractView.Get("/contracts/insights", deps.ContractInsights.Insights)
	}
	// Org-entity roll-up over the contract list filter surface. EntityRollup is a
	// method on the existing ContractHandler; the static /contracts/entity-rollup
	// segment routes distinctly from /contracts/{id}.
	contractView.Get("/contracts/entity-rollup", deps.Contract.EntityRollup)
	contractAdd.Post("/contracts", deps.Contract.Create)
	// Contract bulk operations. The static /contracts/bulk-* segments route
	// distinctly from /contracts/{id} under chi, but register before the {id}
	// routes per file convention. bulk-status carries the SAME capability key as
	// the single PUT /contracts/{id}/status (lex:contract:approve, no coarse
	// fallback) but WITHOUT the withDistinctActor wrapper: the bulk route has no
	// {id} path param, so the URL-keyed lexmw.RequireDistinctActor would 403
	// everything — per-item author != actor SoD is enforced inside
	// ContractBulkService instead (same precedent as /workflows/tasks/bulk-decision
	// above). bulk-analyze mirrors the single POST /contracts/{id}/analyze tier
	// (contractEdit; no SoD layer — analyze is not a decision point).
	if deps.ContractBulk != nil {
		contractBulkApprove := applyABAC(domainApprove(auth.PermLexContractApprove))
		contractBulkApprove.Post("/contracts/bulk-status", deps.ContractBulk.BulkStatus)
		contractEdit.Post("/contracts/bulk-analyze", deps.ContractBulk.BulkAnalyze)
	}
	contractView.Get("/contracts", deps.Contract.List)
	contractView.Get("/contracts/{id}/analysis", deps.Contract.Analysis)
	contractEdit.Post("/contracts/{id}/upload", deps.Contract.UploadDocument)
	contractEdit.Post("/contracts/{id}/analyze", deps.Contract.Analyze)
	contractEdit.Post("/contracts/{id}/classify", deps.Contract.Classify)
	// CAP-123 manual categorize (distinct from the AI /classify path above).
	if deps.ContractCategory != nil {
		write.Post("/contracts/{id}/categorize", deps.ContractCategory.Categorize)
	}
	write.Post("/contracts/{id}/obligations/extract", deps.Obligation.ExtractFromContract)
	// Final sign-off / status transition is the contract SoD control point (CAP-120).
	contractApprove.Put("/contracts/{id}/status", deps.Contract.UpdateStatus)
	contractView.Get("/contracts/{id}/brief", deps.Contract.Brief)
	contractView.Get("/contracts/{id}/timeline", deps.Contract.Timeline)
	contractView.Get("/contracts/{id}/versions", deps.Contract.Versions)
	contractView.Get("/contracts/{id}/redline", deps.Contract.Redline)
	read.Get("/contracts/{id}/obligations", deps.Obligation.ListByContract)
	contractEdit.Post("/contracts/{id}/renew", deps.Contract.Renew)
	contractReviewStart.Post("/contracts/{id}/review", deps.Contract.StartReview)
	read.Get("/contracts/{id}/clauses/risks", deps.Clause.RiskSummary)
	read.Get("/contracts/{id}/clauses/{clauseId}", deps.Clause.Get)
	write.Put("/contracts/{id}/clauses/{clauseId}/review", deps.Clause.Review)
	// CAP-110 clause comments. Static /comments segment after {clauseId} routes
	// distinctly from {clauseId}/review. Reads lex:read; mutations lex:write.
	if deps.ContractClauseComment != nil {
		read.Get("/contracts/{id}/clauses/{clauseId}/comments", deps.ContractClauseComment.ListComments)
		write.Post("/contracts/{id}/clauses/{clauseId}/comments", deps.ContractClauseComment.AddComment)
		write.Put("/contracts/{id}/clauses/{clauseId}/comments/{commentId}", deps.ContractClauseComment.UpdateComment)
		write.Delete("/contracts/{id}/clauses/{clauseId}/comments/{commentId}", deps.ContractClauseComment.DeleteComment)
	}
	// CAP-111 proposed clause amendments. lex:read list, lex:write propose +
	// decide. Static /amendments segment routes distinctly from {clauseId}/review.
	if deps.ContractClauseAmendment != nil {
		read.Get("/contracts/{id}/clauses/{clauseId}/amendments", deps.ContractClauseAmendment.List)
		write.Post("/contracts/{id}/clauses/{clauseId}/amendments", deps.ContractClauseAmendment.Propose)
		write.Put("/contracts/{id}/clauses/{clauseId}/amendments/{amendmentId}/decide", deps.ContractClauseAmendment.Decide)
	}
	read.Get("/contracts/{id}/clauses", deps.Clause.List)
	// CAP-122 contract archive lifecycle + advanced archived search. /contracts/archived
	// is a static path registered before /contracts/{id} so chi routes it distinctly.
	if deps.ContractArchive != nil {
		read.Get("/contracts/archived", deps.ContractArchive.ListArchived)
		write.Post("/contracts/{id}/archive", deps.ContractArchive.Archive)
		write.Post("/contracts/{id}/unarchive", deps.ContractArchive.Unarchive)
	}
	// CAP-109 contract regulatory compliance check. Static compliance-* segments
	// route distinctly from the bare /contracts/{id} below.
	if deps.ContractCompliance != nil {
		read.Get("/contracts/{id}/compliance-check", deps.ContractCompliance.Check)
		write.Post("/contracts/{id}/compliance-reviews", deps.ContractCompliance.CreateReview)
		write.Put("/contracts/{id}/compliance-reviews/{reviewId}", deps.ContractCompliance.UpdateReview)
	}
	// WTQ-RSK-02 clause-deviation sub-resources. Static /export and /reviews paths
	// are registered BEFORE the bare /clause-deviations route so chi routes them
	// distinctly. Reviews are the deviation-triage status (lex:read list, lex:write
	// upsert).
	read.Get("/contracts/{id}/clause-deviations/export", deps.Playbook.ExportClauseDeviations)
	read.Get("/contracts/{id}/clause-deviations/reviews", deps.Playbook.ListDeviationReviews)
	write.Put("/contracts/{id}/clause-deviations/reviews/{clauseType}", deps.Playbook.UpsertDeviationReview)
	read.Get("/contracts/{id}/clause-deviations", deps.Playbook.ContractClauseDeviations)
	contractView.Get("/contracts/{id}", deps.Contract.Get)
	contractEdit.Put("/contracts/{id}", deps.Contract.Update)
	// Destructive contract delete -> contract :close (SoD control point).
	contractClose.Delete("/contracts/{id}", deps.Contract.Delete)

	write.Post("/documents", deps.Document.Create)
	write.Post("/documents/bulk-import", deps.Document.BulkImport)
	read.Get("/documents", deps.Document.List)
	read.Get("/documents/repository-summary", deps.Document.RepositorySummary)
	write.Post("/documents/{id}/upload", deps.Document.UploadVersion)
	read.Get("/documents/{id}/versions", deps.Document.Versions)
	if deps.DocumentEditor != nil {
		editorSession := r.With(sharedmw.RequireAnyPermission(auth.PermLexRead, auth.PermLexWrite))
		if deps.ABACMW != nil {
			editorSession = editorSession.With(deps.ABACMW)
		}
		editorSession.Post("/documents/{id}/editor/session", deps.DocumentEditor.OpenSession)
		write.Post("/documents/{id}/editor/callback", deps.DocumentEditor.Callback)
		write.Post("/documents/{id}/editor/lock", deps.DocumentEditor.AcquireLock)
		write.Delete("/documents/{id}/editor/lock", deps.DocumentEditor.ReleaseLock)
		read.Get("/documents/{id}/editor/audit", deps.DocumentEditor.Audit)
		write.Post("/documents/{id}/editor/preflight", deps.DocumentEditor.Preflight)
		write.Post("/documents/{id}/editor/snapshot", deps.DocumentEditor.Snapshot)
		read.Get("/documents/{id}/editor/negotiation-room", deps.DocumentEditor.NegotiationRoom)
		write.Put("/documents/{id}/editor/negotiation-room", deps.DocumentEditor.UpsertNegotiationRoom)
		write.Post("/documents/{id}/editor/negotiation-room/messages", deps.DocumentEditor.AddNegotiationMessage)
		read.Get("/documents/{id}/editor/playbook-enforcement", deps.DocumentEditor.PlaybookEnforcement)
		write.Post("/documents/{id}/editor/playbook-enforcement", deps.DocumentEditor.RunPlaybookEnforcement)
		read.Get("/documents/{id}/editor/navigator", deps.DocumentEditor.Navigator)
		read.Get("/documents/{id}/editor/terms-cross-references", deps.DocumentEditor.Navigator)
		write.Post("/documents/{id}/editor/terms-cross-references", deps.DocumentEditor.AnalyzeTermsCrossReferences)
		read.Get("/documents/{id}/editor/section-assignments", deps.DocumentEditor.SectionAssignmentList)
		write.Put("/documents/{id}/editor/section-assignments", deps.DocumentEditor.UpsertSectionAssignments)
		write.Post("/documents/{id}/editor/guest-review-link", deps.DocumentEditor.GuestReviewLink)
		read.Get("/documents/{id}/editor/guest-review-links", deps.DocumentEditor.GuestReviewLinks)
		write.Post("/documents/{id}/editor/guest-review-links", deps.DocumentEditor.GuestReviewLink)
		write.Delete("/documents/{id}/editor/guest-review-links/{linkId}", deps.DocumentEditor.RevokeGuestReviewLink)
		read.Get("/documents/{id}/editor/legal-issues", deps.DocumentEditor.LegalIssueList)
		write.Post("/documents/{id}/editor/legal-issues", deps.DocumentEditor.CreateLegalIssue)
		write.Patch("/documents/{id}/editor/legal-issues/{issueId}", deps.DocumentEditor.UpdateLegalIssue)
		write.Post("/documents/{id}/editor/legal-issues/{issueId}/resolve", deps.DocumentEditor.ResolveLegalIssue)
		read.Get("/documents/{id}/editor/signature-readiness", deps.DocumentEditor.SignatureReadiness)
		write.Post("/documents/{id}/editor/signature-readiness", deps.DocumentEditor.RunSignatureReadiness)
		write.Post("/documents/{id}/editor/clause-ai-actions", deps.DocumentEditor.ClauseAIAction)
		read.Get("/documents/{id}/editor/health", deps.DocumentEditor.Health)
		read.Get("/documents/{id}/editor/health-score", deps.DocumentEditor.Health)
		write.Post("/documents/{id}/editor/health-score", deps.DocumentEditor.RefreshHealth)
		read.Get("/documents/{id}/editor/privileged-controls", deps.DocumentEditor.PrivilegedControls)
		write.Put("/documents/{id}/editor/privileged-controls", deps.DocumentEditor.UpdatePrivilegedControls)
		write.Post("/documents/{id}/editor/privileged-controls/request", deps.DocumentEditor.PrivilegedControlRequest)
		read.Get("/documents/{id}/editor/provider-events", deps.DocumentEditor.ProviderEvents)
		write.Post("/documents/{id}/editor/provider-events", deps.DocumentEditor.RecordProviderEvent)
		write.Post("/documents/{id}/editor/provider-events/{provider}", deps.DocumentEditor.RecordProviderEvent)
		read.Get("/documents/{id}/editor/guest-portal", deps.DocumentEditor.GuestPortal)
		write.Post("/documents/{id}/editor/guest-portal/validate", deps.DocumentEditor.ValidateGuestPortal)
		read.Get("/documents/{id}/editor/guest-review-links/{linkId}/portal", deps.DocumentEditor.GuestPortal)
		write.Post("/documents/{id}/editor/guest-review-links/{linkId}/portal/validate", deps.DocumentEditor.ValidateGuestPortal)
		write.Post("/documents/{id}/editor/guest-review-links/{linkId}/portal/comments", deps.DocumentEditor.AddGuestPortalComment)
		read.Get("/documents/{id}/editor/tasks", deps.DocumentEditor.EditorTasks)
		write.Post("/documents/{id}/editor/tasks", deps.DocumentEditor.CreateEditorTask)
		write.Patch("/documents/{id}/editor/tasks/{taskId}", deps.DocumentEditor.UpdateEditorTask)
		read.Get("/documents/{id}/editor/clause-anchors", deps.DocumentEditor.ClauseAnchors)
		write.Put("/documents/{id}/editor/clause-anchors", deps.DocumentEditor.UpsertClauseAnchors)
		write.Post("/documents/{id}/editor/clause-anchors/extract", deps.DocumentEditor.ExtractClauseAnchors)
		read.Get("/documents/{id}/editor/redline-packages", deps.DocumentEditor.RedlinePackages)
		write.Post("/documents/{id}/editor/redline-packages", deps.DocumentEditor.GenerateRedlinePackage)
		read.Get("/documents/{id}/editor/approval-matrix", deps.DocumentEditor.ApprovalMatrix)
		write.Put("/documents/{id}/editor/approval-matrix", deps.DocumentEditor.UpdateApprovalMatrix)
		write.Post("/documents/{id}/editor/approval-matrix/check", deps.DocumentEditor.RequestApprovalMatrix)
		write.Post("/documents/{id}/editor/approval-matrix/requests", deps.DocumentEditor.RequestApprovalMatrix)
		write.Post("/documents/{id}/editor/approval-requests", deps.DocumentEditor.RequestApprovalMatrix)
		read.Get("/documents/{id}/editor/compare", deps.DocumentEditor.CompareWorkspace)
		write.Post("/documents/{id}/editor/compare", deps.DocumentEditor.CompareDocument)
		read.Get("/documents/{id}/editor/compare-workspace", deps.DocumentEditor.CompareWorkspace)
		write.Post("/documents/{id}/editor/compare-workspace", deps.DocumentEditor.CompareDocument)
		read.Get("/documents/{id}/editor/collaboration-inbox", deps.DocumentEditor.CollaborationInbox)
		write.Post("/documents/{id}/editor/collaboration-inbox/{itemId}/read", deps.DocumentEditor.MarkCollaborationInboxItemRead)
		read.Get("/documents/{id}/editor/playbook-rules", deps.DocumentEditor.PlaybookRules)
		write.Post("/documents/{id}/editor/playbook-rules", deps.DocumentEditor.CreatePlaybookRule)
		write.Put("/documents/{id}/editor/playbook-rules", deps.DocumentEditor.UpsertPlaybookRules)
		read.Get("/documents/{id}/editor/defined-term-repairs", deps.DocumentEditor.DefinedTermRepairs)
		write.Post("/documents/{id}/editor/defined-term-repairs", deps.DocumentEditor.RepairDefinedTerm)
		read.Get("/documents/{id}/editor/terms-cross-references/repairs", deps.DocumentEditor.DefinedTermRepairs)
		write.Post("/documents/{id}/editor/terms-cross-references/repair", deps.DocumentEditor.RepairDefinedTerm)
		read.Get("/documents/{id}/editor/term-repairs", deps.DocumentEditor.DefinedTermRepairs)
		write.Post("/documents/{id}/editor/term-repairs", deps.DocumentEditor.RepairDefinedTerm)
		read.Get("/documents/{id}/editor/citations", deps.DocumentEditor.Citations)
		write.Post("/documents/{id}/editor/citations", deps.DocumentEditor.CreateCitation)
		read.Get("/documents/{id}/editor/citation-bindings", deps.DocumentEditor.Citations)
		write.Post("/documents/{id}/editor/citation-bindings", deps.DocumentEditor.CreateCitation)
		read.Get("/documents/{id}/editor/evidence-bindings", deps.DocumentEditor.Citations)
		write.Post("/documents/{id}/editor/evidence-bindings", deps.DocumentEditor.CreateCitation)
		read.Get("/documents/{id}/editor/ai-change-safety", deps.DocumentEditor.AIChangeSafety)
		write.Post("/documents/{id}/editor/ai-change-safety", deps.DocumentEditor.RequestAIChange)
		write.Put("/documents/{id}/editor/ai-change-safety", deps.DocumentEditor.UpdateAIChangeSafety)
		read.Get("/documents/{id}/editor/offline-recovery", deps.DocumentEditor.OfflineRecovery)
		write.Post("/documents/{id}/editor/offline-recovery", deps.DocumentEditor.SaveOfflineRecovery)
		write.Put("/documents/{id}/editor/offline-recovery", deps.DocumentEditor.SaveOfflineRecovery)
		write.Post("/documents/{id}/editor/offline-recovery/restore", deps.DocumentEditor.RestoreOfflineRecovery)
		write.Post("/documents/{id}/editor/offline-recovery/{recoveryId}/restore", deps.DocumentEditor.RestoreOfflineRecovery)
		write.Delete("/documents/{id}/editor/offline-recovery/{recoveryId}", deps.DocumentEditor.DeleteOfflineRecovery)
		read.Get("/documents/{id}/editor/analytics", deps.DocumentEditor.Analytics)
	}
	read.Get("/documents/{id}", deps.Document.Get)
	write.Put("/documents/{id}", deps.Document.Update)
	write.Delete("/documents/{id}", deps.Document.Delete)

	// Document-scoped e-archive action (Othaim PRD 14.1). Mounted at the document
	// write tier (lex:write): a document owner archives their own document without
	// integration-admin rights. Routes through the integration registry Invoke so
	// breaker/egress/DLQ/metrics/audit all apply unchanged.
	if deps.DocumentArchive != nil {
		write.Post("/documents/{id}/archive", deps.DocumentArchive.Archive)
		read.Get("/documents/{id}/archive", deps.DocumentArchive.Status)
	}

	write.Post("/matters", deps.Matter.Create)
	write.Post("/matters/conflict-check", deps.Matter.ConflictCheck)
	read.Get("/matters", deps.Matter.List)
	read.Get("/matters/{id}/obligations", deps.Obligation.ListByMatter)
	write.Post("/matters/{id}/triage", deps.Matter.Triage)
	write.Put("/matters/{id}/status", deps.Matter.UpdateStatus)
	write.Post("/matters/{id}/contracts", deps.Matter.LinkContract)
	write.Delete("/matters/{id}/contracts/{contractId}", deps.Matter.UnlinkContract)
	read.Get("/matters/{id}", deps.Matter.Get)
	write.Put("/matters/{id}", deps.Matter.Update)
	write.Delete("/matters/{id}", deps.Matter.Delete)

	// Matter sub-resources. All hang off /matters/{id}/<static-segment>, so chi
	// routes them distinctly from /matters/{id} and the CaseTimeline /matters/{id}/...
	// routes. Reads are lex:read; mutations lex:write. WORM: comment + link rows are
	// soft/hard-deletable, document DELETE removes only the LINK (never the document).
	if deps.MatterComment != nil {
		read.Get("/matters/{id}/comments", deps.MatterComment.ListComments)
		write.Post("/matters/{id}/comments", deps.MatterComment.AddComment)
		write.Put("/matters/{id}/comments/{commentId}", deps.MatterComment.UpdateComment)
		write.Delete("/matters/{id}/comments/{commentId}", deps.MatterComment.DeleteComment)
	}
	if deps.MatterDocument != nil {
		read.Get("/matters/{id}/documents", deps.MatterDocument.ListDocuments)
		write.Post("/matters/{id}/documents", deps.MatterDocument.AddDocument)
		write.Delete("/matters/{id}/documents/{documentLinkId}", deps.MatterDocument.DeleteDocument)
	}
	if deps.MatterAudit != nil {
		read.Get("/matters/{id}/audit", deps.MatterAudit.ListAudit)
	}
	if deps.MatterLink != nil {
		read.Get("/matters/{id}/related", deps.MatterLink.ListRelated)
		write.Post("/matters/{id}/related", deps.MatterLink.AddRelated)
		write.Delete("/matters/{id}/related/{linkId}", deps.MatterLink.DeleteRelated)
	}

	// FR-WATHEEQ-005 Legal Hold. Apply/release mutate preservation state
	// (lex:write); list/get are read-only (lex:read). Holds enforce that a held
	// contract/matter/document cannot be deleted, archived, or modified away.
	if deps.LegalHold != nil {
		write.Post("/legal-holds", deps.LegalHold.Apply)
		read.Get("/legal-holds", deps.LegalHold.List)
		read.Get("/legal-holds/{id}", deps.LegalHold.Get)
		write.Post("/legal-holds/{id}/release", deps.LegalHold.Release)
	}

	write.Post("/obligations", deps.Obligation.Create)
	read.Get("/obligations", deps.Obligation.List)
	read.Get("/obligations/reminders", deps.Obligation.ReminderPlan)
	write.Post("/obligations/reminders/enqueue", deps.Obligation.EnqueueReminders)
	write.Post("/obligations/reminders/outbox/dispatch", deps.Obligation.DispatchReminderOutbox)
	write.Post("/obligations/reminders/outbox/{outboxId}/dispatch", deps.Obligation.DispatchReminderOutboxItem)
	write.Post("/obligations/reminders/outbox/{outboxId}/delivery", deps.Obligation.MarkReminderDelivery)
	write.Put("/obligations/{id}/status", deps.Obligation.UpdateStatus)
	write.Post("/obligations/{id}/reminders/sent", deps.Obligation.MarkReminderSent)
	read.Get("/obligations/{id}", deps.Obligation.Get)
	write.Put("/obligations/{id}", deps.Obligation.Update)
	write.Delete("/obligations/{id}", deps.Obligation.Delete)

	write.Post("/signatures", deps.Signature.Create)
	read.Get("/signatures", deps.Signature.List)
	// User-owned native signature assets. These are self-service profile
	// preferences, so they ride the read tier like saved views; handlers only read
	// or mutate the authenticated user's own row.
	read.Get("/signatures/me/profile", deps.Signature.GetUserProfile)
	read.Put("/signatures/me/profile", deps.Signature.UpsertUserProfile)
	read.Delete("/signatures/me/profile", deps.Signature.DeleteUserProfile)
	// Batched per-contract e-signature roll-up for the contracts list workspace
	// (?contract_ids=a,b,c). Same read tier as GET /signatures. The static
	// /signatures/summary segment wins over /signatures/{id} regardless of order
	// (chi static-segment precedence); registered above it for readability.
	if deps.SignatureSummary != nil {
		read.Get("/signatures/summary", deps.SignatureSummary.Summary)
	}
	write.Post("/signatures/{id}/send", deps.Signature.Send)
	write.Put("/signatures/{id}/placements", deps.Signature.UpsertPlacements)
	// Self-service signing: a Lex reader may view/sign/decline only their own
	// recipient row. The handler enforces recipient.user_id/email ownership before
	// delegating to the normal signature FSM.
	read.Post("/signatures/{id}/recipients/{recipientId}/self-actions", deps.Signature.SelfRecipientAction)
	write.Post("/signatures/{id}/recipients/{recipientId}/actions", deps.Signature.RecipientAction)
	read.Get("/signatures/{id}/recipients/{recipientId}/rendering", deps.Signature.RecipientRendering)
	write.Post("/signatures/{id}/provider-events", deps.Signature.ProviderEvent)
	write.Post("/signatures/{id}/custody", deps.Signature.RecordCustody)
	write.Post("/signatures/{id}/cancel", deps.Signature.Cancel)
	read.Get("/signatures/{id}", deps.Signature.Get)

	// Saved list-workspace views (namespace-scoped UX preference store; the JSONB
	// payload is opaque to the backend). ALL FOUR routes sit on the coarse read
	// tier deliberately: read-only personas must be able to save their own
	// personal views — gating mutations on lex:write would lock them out. Real
	// write authorization is enforced inside SavedViewService:
	// personal views are owner-only for read AND write; team/org views are
	// writable by owner OR lex:catalog:manage; any role_slug change additionally
	// requires lex:catalog:manage.
	if deps.SavedView != nil {
		read.Get("/saved-views", deps.SavedView.List)
		read.Post("/saved-views", deps.SavedView.Create)
		read.Put("/saved-views/{id}", deps.SavedView.Update)
		read.Delete("/saved-views/{id}", deps.SavedView.Delete)

		// Report-builder definitions reuse the same tenant-scoped persistence and
		// share rules through a FIXED namespace. The dedicated route prevents a
		// lex:report:read-only caller from probing unrelated saved-view namespaces.
		reportRead.Get("/report-definitions", deps.SavedView.ListReportDefinitions)
		reportRead.Post("/report-definitions", deps.SavedView.CreateReportDefinition)
		reportRead.Put("/report-definitions/{id}", deps.SavedView.UpdateReportDefinition)
		reportRead.Delete("/report-definitions/{id}", deps.SavedView.DeleteReportDefinition)
	}

	read.Get("/clause-library", deps.Library.ListClauses)
	read.Get("/clause-library/search", deps.Library.SearchClauses)
	write.Post("/clause-library", deps.Library.CreateClause)
	read.Get("/clause-library/{id}", deps.Library.GetClause)
	write.Post("/clause-library/{id}/governance", deps.Library.DecideClauseGovernance)
	write.Put("/clause-library/{id}", deps.Library.UpdateClause)
	write.Delete("/clause-library/{id}", deps.Library.DeleteClause)

	// WTQ-RSK-02 playbooks. Static segments (/portfolio, /dry-run, /templates) are
	// registered BEFORE the parameterized /{id} routes so chi routes them distinctly.
	read.Get("/playbooks/portfolio", deps.Playbook.Portfolio)
	read.Get("/playbooks/templates", deps.Playbook.ListTemplates)
	write.Post("/playbooks/templates/{key}/clone", deps.Playbook.CloneTemplate)
	write.Post("/playbooks/dry-run", deps.Playbook.DryRun)
	read.Get("/playbooks", deps.Playbook.List)
	write.Post("/playbooks", deps.Playbook.Create)
	write.Post("/playbooks/{id}/clone", deps.Playbook.Clone)
	read.Get("/playbooks/{id}", deps.Playbook.Get)
	write.Put("/playbooks/{id}", deps.Playbook.Update)
	write.Delete("/playbooks/{id}", deps.Playbook.Delete)

	// AID-* generative drafting (write permission: these produce/transform legal
	// text). Generation calls the governed per-tenant LLM; assembly is deterministic.
	if deps.Drafting != nil {
		write.Post("/drafting/clauses", deps.Drafting.GenerateClause)                           // AID-01
		write.Post("/drafting/clauses/stream", deps.Drafting.GenerateClauseStream)              // AID-01 (SSE)
		write.Post("/drafting/contracts", deps.Drafting.DraftContract)                          // AID-02
		write.Post("/drafting/clauses/rewrite", deps.Drafting.RewriteClause)                    // AID-03
		write.Post("/drafting/clauses/fallbacks", deps.Drafting.SuggestFallbacks)               // AID-04
		write.Post("/drafting/translate", deps.Drafting.Translate)                              // AID-05
		write.Post("/drafting/summary", deps.Drafting.Summarize)                                // AID-06
		write.Post("/drafting/glossary", deps.Drafting.Glossary)                                // AID-07
		write.Post("/drafting/assemble", deps.Drafting.Assemble)                                // AID-08
		write.Post("/drafting/rfp-response", deps.Drafting.DraftRFPResponse)                    // AID-10
		write.Post("/drafting/obligations/qa-review", deps.Drafting.ReviewObligationExtraction) // AID-11

		// AID-09: prompt library — reusable prompt templates + run.
		read.Get("/drafting/prompts", deps.Drafting.ListPrompts)
		write.Post("/drafting/prompts", deps.Drafting.CreatePrompt)
		read.Get("/drafting/prompts/{id}", deps.Drafting.GetPrompt)
		write.Put("/drafting/prompts/{id}", deps.Drafting.UpdatePrompt)
		write.Delete("/drafting/prompts/{id}", deps.Drafting.DeletePrompt)
		write.Post("/drafting/prompts/{id}/run", deps.Drafting.RunPrompt)

		// Feature 4: submit an AI draft as a first-class engine-tracked human task
		// and read its review status. Submit is gated lex:approval:write (with the
		// legacy lex:write fallback so existing roles are not locked out); the
		// status read is gated lex:approval:read (with the legacy lex:read fallback).
		draftReviewWrite := r.With(sharedmw.RequireAnyPermission(auth.PermLexApprovalWrite, auth.PermLexWrite))
		draftReviewRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexApprovalRead, auth.PermLexRead))
		if deps.ABACMW != nil {
			draftReviewWrite = draftReviewWrite.With(deps.ABACMW)
			draftReviewRead = draftReviewRead.With(deps.ABACMW)
		}
		draftReviewWrite.Post("/drafting/{id}/submit-for-review", deps.Drafting.SubmitDraftForReview)
		draftReviewRead.Get("/drafting/{id}/review", deps.Drafting.GetDraftReview)
	}

	read.Get("/regulations", deps.Library.ListRegulations)
	read.Get("/regulations/search", deps.Library.SearchRegulations)
	write.Post("/regulations", deps.Library.CreateRegulation)
	read.Get("/regulations/{id}", deps.Library.GetRegulation)
	write.Post("/regulations/{id}/governance", deps.Library.DecideRegulationGovernance)
	write.Put("/regulations/{id}", deps.Library.UpdateRegulation)
	write.Delete("/regulations/{id}", deps.Library.DeleteRegulation)
	write.Post("/regulations/{id}/clauses", deps.Library.LinkRegulationClause)
	write.Delete("/regulations/{id}/clauses", deps.Library.UnlinkRegulationClause)

	// WatheeqTech Reference Library (WatheeqTech_Library_Design.md §4/§5). A GLOBAL,
	// read-only Saudi legal corpus visible to every authenticated Watheeq user.
	// Gated RequireAnyPermission(lex:reference:view, lex:read): all 14 legal roles
	// carry lex:read (or the granular lex:reference:view we grant them), so the
	// library lights up for every persona with no migration. Static /facets +
	// /search segments register BEFORE /{id} so chi routes them distinctly. No
	// write routes exist — read-only is structural. Nil-safe.
	if deps.ReferenceLibrary != nil {
		referenceView := applyABAC(r.With(sharedmw.RequireAnyPermission(auth.PermLexReferenceView, auth.PermLexRead)))
		referenceView.Get("/reference-library", deps.ReferenceLibrary.List)
		referenceView.Get("/reference-library/facets", deps.ReferenceLibrary.Facets)
		referenceView.Get("/reference-library/{id}", deps.ReferenceLibrary.Get)
		referenceView.Get("/reference-library/{id}/download", deps.ReferenceLibrary.Download)
		// The article/section index is read metadata (proxied from the AI service but
		// gracefully empty when the AI is unset/errors — never the LLM cost path), so
		// it goes on the plain read group, NOT the stricter AI rate-limit group.
		referenceView.Get("/reference-library/{id}/articles", deps.ReferenceLibrary.Articles)

		// The Second-Brain /search + /ask proxies drive a per-call LLM cost, so they
		// carry a DEDICATED, stricter per-tenant rate limit ON TOP of the coarse
		// suite-wide limiter (a distinct Redis key namespace). When Redis is unwired
		// the limiter is omitted (it fails-open anyway) so the routes still function.
		aiRoutes := referenceView
		if deps.Redis != nil {
			aiRoutes = referenceView.With(sharedmw.RateLimit(deps.Redis, sharedmw.RateLimitConfig{
				RequestsPerWindow: referenceLibraryAIRateLimitPerMin,
				Window:            time.Minute,
				KeyPrefix:         "lex:reference:ai",
			}))
		}
		aiRoutes.Get("/reference-library/search", deps.ReferenceLibrary.Search)
		aiRoutes.Post("/reference-library/ask", deps.ReferenceLibrary.Ask)
		// Streaming twin of /ask: proxies the Second-Brain SSE stream to the browser
		// so tokens arrive live. Same gating + dedicated AI rate limit + audit.
		aiRoutes.Post("/reference-library/ask/stream", deps.ReferenceLibrary.AskStream)
		// Answer feedback (thumbs up/down) relates to AI answers, so it rides the same
		// dedicated AI rate-limit group for light protection; it persists best-effort
		// and returns 204.
		aiRoutes.Post("/reference-library/ask/feedback", deps.ReferenceLibrary.AskFeedback)
	}

	read.Get("/compliance/rules", deps.Compliance.ListRules)
	write.Post("/compliance/rules", deps.Compliance.CreateRule)
	write.Put("/compliance/rules/{id}", deps.Compliance.UpdateRule)
	write.Delete("/compliance/rules/{id}", deps.Compliance.DeleteRule)
	write.Post("/compliance/run", deps.Compliance.Run)
	read.Get("/compliance/alerts/{id}", deps.Compliance.GetAlert)
	write.Put("/compliance/alerts/{id}/status", deps.Compliance.UpdateAlertStatus)
	read.Get("/compliance/alerts", deps.Compliance.ListAlerts)
	read.Get("/compliance/dashboard", deps.Compliance.Dashboard)
	read.Get("/compliance/score", deps.Compliance.Score)

	// Granular approval-policy RBAC (Feature 5). Each tier accepts the granular
	// lex:approval:* permission OR the legacy coarse lex:read / lex:write so
	// existing roles (lex:* wildcard, plain lex:read/lex:write, admin:* wildcard)
	// are never locked out:
	//   - approvalRead  : reads (list, recommend, analytics, versions, audit, get).
	//   - approvalWrite : create / update / conflict-check / template authoring /
	//                     template instantiate.
	//   - approvalAdmin : destructive & governance ops (archive/delete, version
	//                     restore, template delete).
	approvalRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexApprovalRead, auth.PermLexRead))
	approvalWrite := r.With(sharedmw.RequireAnyPermission(auth.PermLexApprovalWrite, auth.PermLexWrite))
	approvalAdmin := r.With(sharedmw.RequireAnyPermission(auth.PermLexApprovalAdmin, auth.PermLexWrite))
	if deps.ABACMW != nil {
		approvalRead = approvalRead.With(deps.ABACMW)
		approvalWrite = approvalWrite.With(deps.ABACMW)
		approvalAdmin = approvalAdmin.With(deps.ABACMW)
	}

	// Templates and conflict-check are registered BEFORE the parameterized
	// /{id} routes so the static path segments win over the {id} wildcard.
	approvalRead.Get("/workflow-policies/approval/templates", deps.Contract.ListApprovalPolicyTemplates)
	approvalWrite.Post("/workflow-policies/approval/templates", deps.Contract.CreateApprovalPolicyTemplate)
	approvalRead.Get("/workflow-policies/approval/templates/{id}", deps.Contract.GetApprovalPolicyTemplate)
	approvalWrite.Patch("/workflow-policies/approval/templates/{id}", deps.Contract.UpdateApprovalPolicyTemplate)
	approvalAdmin.Delete("/workflow-policies/approval/templates/{id}", deps.Contract.DeleteApprovalPolicyTemplate)
	approvalWrite.Post("/workflow-policies/approval/templates/{id}/instantiate", deps.Contract.InstantiateApprovalPolicyTemplate)

	approvalWrite.Post("/workflow-policies/approval/conflict-check", deps.Contract.ConflictCheckApprovalPolicy)

	approvalRead.Get("/workflow-policies/approval", deps.Contract.ListApprovalPolicies)
	approvalWrite.Post("/workflow-policies/approval", deps.Contract.CreateApprovalPolicy)
	approvalRead.Get("/workflow-policies/approval/recommend", deps.Contract.RecommendApprovalPolicy)
	approvalRead.Get("/workflow-policies/approval/analytics", deps.Contract.ApprovalPolicyAnalytics)

	// Version history + audit log.
	approvalRead.Get("/workflow-policies/approval/{id}/versions", deps.Contract.ListApprovalPolicyVersions)
	approvalRead.Get("/workflow-policies/approval/{id}/versions/{version}", deps.Contract.GetApprovalPolicyVersion)
	approvalAdmin.Post("/workflow-policies/approval/{id}/versions/{version}/restore", deps.Contract.RestoreApprovalPolicyVersion)
	approvalRead.Get("/workflow-policies/approval/{id}/audit", deps.Contract.ListApprovalPolicyAudit)

	approvalWrite.Patch("/workflow-policies/approval/{id}", deps.Contract.UpdateApprovalPolicy)
	approvalAdmin.Delete("/workflow-policies/approval/{id}", deps.Contract.DeleteApprovalPolicy)

	// WTQ-RSK-02 playbook approval (#9). A DRAFT playbook is gated through the
	// shared subject-agnostic ApprovalOrchestrator before it can become active.
	// Gated with the granular lex:approval:* permission OR the legacy coarse
	// lex:read/lex:write (same RequireAnyPermission pattern as the consultation /
	// investigation approval blocks). The static /approval/tasks sub-path precedes
	// the {workflowInstanceId} decision route. Nil-safe: PlaybookApproval handler is
	// only invoked when wired; the handler returns 503 when its service is unset.
	approvalWrite.Post("/playbooks/{id}/approval/start", deps.Playbook.StartApproval)
	approvalRead.Get("/playbooks/{id}/approval/tasks", deps.Playbook.ListApprovalTasks)
	approvalWrite.Post("/playbooks/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision", deps.Playbook.DecideApprovalTask)

	read.Get("/workflows", deps.Contract.ListWorkflows)
	// design v2 §4.4: the workflow-decision routes render an approve/reject contract
	// verdict, so they leave the coarse lex:write tier for the contract-domain
	// review tier (lex:contract:approve OR :edit, no lex:write). See contractReview.
	contractReview.Post("/workflows/tasks/bulk-decision", deps.Contract.BulkDecideWorkflowTasks)
	contractReview.Post("/workflows/{workflowInstanceID}/tasks/{taskID}/decision", deps.Contract.DecideWorkflowTask)
	reportRead.Get("/reports/contracts", deps.Contract.ContractReport)
	reportRead.Get("/reports/matters", deps.Matter.Report)
	reportRead.Get("/reports/obligations", deps.Obligation.Report)
	reportRead.Get("/reports/resolution-rates", deps.ResolutionRate.Report)
	read.Get("/dashboard", deps.Dashboard.Get)

	// ---------------------------------------------------------------------------
	// Legal-affairs foundation modules (Phase 0). All reuse the existing
	// lex:read/lex:write (and lex:approval:* for the approval surfaces) tiers; no
	// new RBAC verbs are introduced. Static path segments are registered before
	// the parameterized /{id} routes so they win over the wildcard.
	// ---------------------------------------------------------------------------

	// Working Calendar Engine (CAP-020, CAP-021, CAP-029).
	if deps.WorkingCalendar != nil {
		// Admin-config: create/update/delete go through the org-RBAC `edit` gate on the
		// catalog:manage write tier (calendarAdmin, F7); reads gate on catalogView
		// (catalog:view OR coarse lex:read) so the config-only System Administrator, whose
		// catalog:manage expands to catalog:view, can load the table it manages.
		calendarAdmin.Post("/working-calendars", deps.WorkingCalendar.Create)
		catalogView.Get("/working-calendars", deps.WorkingCalendar.List)
		catalogView.Get("/working-calendars/{id}", deps.WorkingCalendar.Get)
		calendarAdmin.Put("/working-calendars/{id}", deps.WorkingCalendar.Update)
		calendarAdmin.Delete("/working-calendars/{id}", deps.WorkingCalendar.Delete)
		calendarAdmin.Post("/working-calendars/{id}/holidays", deps.WorkingCalendar.AddHoliday)
		calendarAdmin.Delete("/working-calendars/{id}/holidays/{holidayId}", deps.WorkingCalendar.DeleteHoliday)
	}

	// Org & Entity Master-Data Registry (CAP-008, CAP-017, CAP-018, CAP-019,
	// CAP-106, CAP-153). /lookup and /escalation static/sub paths precede /{id}.
	if deps.OrgEntity != nil {
		// F8: the org-entity registry gates on the security verbs (securityView reads /
		// securityManage writes), each with the coarse lex:read/lex:write fallback, so the
		// System Administrator persona (security:manage, no coarse keys) can operate its
		// own registry while every existing coarse-access role keeps working unchanged.
		securityManage.Post("/org-entities", deps.OrgEntity.Create)
		securityView.Get("/org-entities", deps.OrgEntity.List)
		securityView.Get("/org-entities/lookup", deps.OrgEntity.GetByCode)
		securityView.Get("/org-entities/import-template", deps.OrgEntity.ImportTemplate)
		securityManage.Post("/org-entities/imports", deps.OrgEntity.ImportStructure)
		securityView.Get("/org-entities/imports", deps.OrgEntity.ListImports)
		securityView.Get("/org-entities/imports/{jobId}", deps.OrgEntity.GetImport)
		securityView.Get("/org-entities/imports/{jobId}/errors", deps.OrgEntity.ImportErrors)
		// Static read paths (audit / platform-units) precede /{id} so the
		// wildcard does not shadow them, mirroring /lookup above.
		securityView.Get("/org-entities/audit", deps.OrgEntity.Audit)
		securityView.Get("/org-entities/platform-units", deps.OrgEntity.PlatformUnits)
		securityView.Get("/org-entities/{id}/audit", deps.OrgEntity.EntityAudit)
		securityView.Get("/org-entities/{id}/escalation", deps.OrgEntity.Escalation)
		securityView.Get("/org-entities/{id}/memberships", deps.OrgEntity.ListMemberships)
		securityManage.Post("/org-entities/{id}/roles", deps.OrgEntity.AssignRole)
		securityManage.Delete("/org-entities/{id}/roles/{roleKey}", deps.OrgEntity.RemoveRole)

		// Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md §8).
		securityView.Get("/org-entities/{id}", deps.OrgEntity.Get)
		securityManage.Put("/org-entities/{id}", deps.OrgEntity.Update)
		securityManage.Delete("/org-entities/{id}", deps.OrgEntity.Delete)
	}

	// Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md §8) — its own
	// nil-guard, independent of any other handler. Review (template/versions/
	// jobs) admits the role reviewers (Director/Auditor hold lex:role:view);
	// every WRITE requires the exact lex:role:manage key with NO coarse
	// lex:write fallback — role administration is the System Administrator's,
	// and the Director's lex:write must NOT open it (admin/legal SoD split).
	// Activation and rollback additionally carry the dynamic-SoD guard so the
	// importer can never activate their own version (four-eyes), with a
	// service-level re-check as defence in depth.
	if deps.RoleMatrix != nil {
		roleMatrixView := applyABAC(r.With(sharedmw.RequireAnyPermission(auth.PermLexRoleView, auth.PermLexRoleManage)))
		roleMatrixManage := applyABAC(r.With(sharedmw.RequirePermission(auth.PermLexRoleManage)))
		roleMatrixActivate := withDistinctActor(roleMatrixManage, deps.RoleMatrixActorResolver)

		roleMatrixView.Get("/role-matrix/import-template", deps.RoleMatrix.ImportTemplate)
		roleMatrixManage.Post("/role-matrix/imports", deps.RoleMatrix.Import)
		roleMatrixView.Get("/role-matrix/imports", deps.RoleMatrix.ListImports)
		roleMatrixView.Get("/role-matrix/imports/{jobId}", deps.RoleMatrix.GetImport)
		roleMatrixView.Get("/role-matrix/imports/{jobId}/errors", deps.RoleMatrix.ImportErrors)
		roleMatrixView.Get("/role-matrix/versions", deps.RoleMatrix.ListVersions)
		roleMatrixView.Get("/role-matrix/versions/{id}", deps.RoleMatrix.GetVersion)
		roleMatrixActivate.Post("/role-matrix/versions/{id}/activate", deps.RoleMatrix.Activate)
		roleMatrixActivate.Post("/role-matrix/versions/{id}/rollback", deps.RoleMatrix.Activate)
	}

	// LegalRequest spine + Priority (CAP-009, CAP-010, CAP-011, CAP-030, CAP-031).
	if deps.LegalRequest != nil {
		// Matrix domain `request`: create/submit -> :add, reads -> :view, mutate ->
		// :edit, route (provider-side accept/assign) -> :approve, delete -> :close.
		requestAdd.Post("/legal-requests", deps.LegalRequest.Create)
		requestView.Get("/legal-requests", deps.LegalRequest.List)
		requestView.Get("/legal-requests/{id}/priority-changes", deps.LegalRequest.PriorityHistory)
		requestView.Get("/legal-requests/{id}/audit", deps.LegalRequest.Audit)
		requestView.Get("/legal-requests/{id}/feedback", deps.LegalRequest.GetFeedback)
		requestView.Post("/legal-requests/{id}/feedback", deps.LegalRequest.SubmitFeedback)
		requestAdd.Post("/legal-requests/{id}/submit", deps.LegalRequest.Submit)
		requestApprove.Post("/legal-requests/{id}/route", deps.LegalRequest.Route)
		requestEdit.Post("/legal-requests/{id}/revise", deps.LegalRequest.Revise)
		requestEdit.Post("/legal-requests/{id}/priority", deps.LegalRequest.ReclassifyPriority)
		requestView.Get("/legal-requests/{id}", deps.LegalRequest.Get)
		requestEdit.Put("/legal-requests/{id}", deps.LegalRequest.Update)
		// Destructive delete -> org-RBAC `close` gate (requestClose).
		requestClose.Delete("/legal-requests/{id}", deps.LegalRequest.Delete)
	}
	if deps.LegalRequestAttachment != nil {
		requestView.Get("/legal-requests/{id}/attachments", deps.LegalRequestAttachment.List)
		requestView.Get("/legal-requests/{id}/attachments/{attachmentId}/download", deps.LegalRequestAttachment.Download)
	}

	// Internal collaboration notes on a request (Al Othaim PRD request detail
	// right rail). Same tiers as the sibling case/matter comment threads: reads
	// gate on requestView (lex:request:view), the note write gates on requestEdit
	// (lex:request:edit) — the same tier as the request's other free-form
	// mutations (revise/reclassify), never the coarse lex:write alone.
	if deps.RequestNote != nil {
		requestView.Get("/legal-requests/{id}/notes", deps.RequestNote.ListNotes)
		requestEdit.Post("/legal-requests/{id}/notes", deps.RequestNote.AddNote)
	}

	// Subject-agnostic Request-Approval Policy stack + governance (CAP-006,
	// CAP-007). Same approvalRead/approvalWrite/approvalAdmin tiers as the
	// contract policy block; static sub-paths first so /{id} does not shadow them.
	if deps.RequestApprovalPolicy != nil {
		approvalRead.Get("/request-approval/policies/templates", deps.RequestApprovalPolicy.ListTemplates)
		approvalWrite.Post("/request-approval/policies/templates", deps.RequestApprovalPolicy.CreateTemplate)
		approvalRead.Get("/request-approval/policies/templates/{id}", deps.RequestApprovalPolicy.GetTemplate)
		approvalWrite.Patch("/request-approval/policies/templates/{id}", deps.RequestApprovalPolicy.UpdateTemplate)
		approvalAdmin.Delete("/request-approval/policies/templates/{id}", deps.RequestApprovalPolicy.DeleteTemplate)
		approvalWrite.Post("/request-approval/policies/templates/{id}/instantiate", deps.RequestApprovalPolicy.InstantiateTemplate)

		approvalWrite.Post("/request-approval/policies/conflict-check", deps.RequestApprovalPolicy.ConflictCheck)

		approvalRead.Get("/request-approval/policies", deps.RequestApprovalPolicy.List)
		approvalWrite.Post("/request-approval/policies", deps.RequestApprovalPolicy.Create)
		approvalRead.Get("/request-approval/policies/recommend", deps.RequestApprovalPolicy.Recommend)

		approvalRead.Get("/request-approval/policies/{id}/versions", deps.RequestApprovalPolicy.ListVersions)
		approvalRead.Get("/request-approval/policies/{id}/versions/{version}", deps.RequestApprovalPolicy.GetVersion)
		approvalAdmin.Post("/request-approval/policies/{id}/versions/{version}/restore", deps.RequestApprovalPolicy.RestoreVersion)
		approvalRead.Get("/request-approval/policies/{id}/audit", deps.RequestApprovalPolicy.ListAudit)

		approvalRead.Get("/request-approval/policies/{id}", deps.RequestApprovalPolicy.Get)
		approvalWrite.Patch("/request-approval/policies/{id}", deps.RequestApprovalPolicy.Update)
		approvalAdmin.Post("/request-approval/policies/{id}/archive", deps.RequestApprovalPolicy.Archive)
		approvalAdmin.Delete("/request-approval/policies/{id}", deps.RequestApprovalPolicy.Delete)
	}

	// Two-stage requester→provider approval orchestration over a legal request
	// (CAP-006, CAP-007, CAP-030, CAP-031). Gated with the granular approval
	// permission OR the legacy coarse lex:read/lex:write so existing roles keep
	// access. Static /tasks sub-path precedes the {workflowInstanceID} route.
	if deps.RequestApproval != nil {
		approvalWrite.Post("/requests/{id}/approval/start", deps.RequestApproval.StartApproval)
		// design v2 §4.4: the approval DECISION renders the DOA approve/reject verdict,
		// so it leaves the coarse approvalWrite tier for the request-approve tier
		// (lex:request:approve only, no lex:write). The /approval/start kickoff above
		// stays on approvalWrite (author-initiated by design — the requester submits
		// their own request into the chain). See requestDecision.
		requestDecision.Post("/requests/{id}/approval/{workflowInstanceID}/tasks/{taskID}/decision", deps.RequestApproval.DecideTask)
		approvalRead.Get("/requests/{id}/approval/tasks", deps.RequestApproval.ListTasks)
		approvalRead.Get("/requests/{id}/approval", deps.RequestApproval.Get)
	}

	// ---------------------------------------------------------------------------
	// Phase 1 modules (no new RBAC verbs). All reuse the existing read/write
	// tiers. Static path segments precede the parameterized /{id} routes so they
	// win over the wildcard. The CAP-002 email webhook is NOT here — it is public
	// and registered outside this JWT chain in RegisterRoutes.
	// ---------------------------------------------------------------------------

	// Service Catalog & Intake (CAP-001..005, 008, 015, 174). The eligibility-check
	// is non-mutating but its handler needs an authenticated user, so it is gated
	// with lex:read OR lex:write (RequireAnyPermission) rather than the bare read
	// tier — either permission yields a user in context.
	if deps.ServiceCatalog != nil {
		eligibility := r.With(sharedmw.RequireAnyPermission(auth.PermLexRead, auth.PermLexWrite))
		if deps.ABACMW != nil {
			eligibility = eligibility.With(deps.ABACMW)
		}
		// Matrix domain `catalog` (CAP-005): manage-class config (LD/ADM) for
		// create/update/delete; reads gate on :view. Coarse fallbacks preserved.
		catalogManage.Post("/service-catalog", deps.ServiceCatalog.Create)
		eligibility.Post("/service-catalog/eligibility-check", deps.ServiceCatalog.CheckEligibility)
		catalogView.Get("/service-catalog", deps.ServiceCatalog.List)
		catalogView.Get("/service-catalog/{id}", deps.ServiceCatalog.Get)
		catalogManage.Put("/service-catalog/{id}", deps.ServiceCatalog.Update)
		catalogManage.Delete("/service-catalog/{id}", deps.ServiceCatalog.Delete)
	}

	if deps.Intake != nil {
		// Admin-config mailbox CRUD goes through the catalog:manage-OR-write tier
		// plus the org-RBAC `edit` gate (mailboxAdmin); reads gate on catalogView
		// (catalog:view OR coarse lex:read) so the legal-system-admin persona can
		// list mailboxes. /intake/submit + message reads keep the coarse tiers.
		mailboxAdmin.Post("/intake/mailboxes", deps.Intake.CreateMailbox)
		catalogView.Get("/intake/mailboxes", deps.Intake.ListMailboxes)
		catalogView.Get("/intake/mailboxes/{id}", deps.Intake.GetMailbox)
		mailboxAdmin.Put("/intake/mailboxes/{id}", deps.Intake.UpdateMailbox)
		mailboxAdmin.Delete("/intake/mailboxes/{id}", deps.Intake.DeleteMailbox)
		// Simulate-Inbound admin action: exercises the full inbound-email bridge
		// (classify→route→legal_request) against an owned mailbox with no external
		// mail provider and no per-mailbox HMAC — the caller is already JWT-authed and
		// gated on the same mailbox-admin tier as mailbox CRUD. Tagged
		// intake_source="simulated" so demo data stays auditable/filterable.
		mailboxAdmin.Post("/intake/mailboxes/{id}/simulate", deps.Intake.SimulateInbound)
		write.Post("/intake/submit", deps.Intake.Submit)
		read.Get("/intake/messages", deps.Intake.ListMessages)
		read.Get("/intake/messages/{id}", deps.Intake.GetMessage)
	}

	// SLA, Acknowledgement & Escalation (CAP-012..014, 016..019). All JWT-gated.
	// Static /targets, /clocks, /requests/{requestId}/clock, /outbox sub-paths
	// precede their parameterized children.
	if deps.SLA != nil {
		// SLA target config is an approval-config surface -> org-RBAC `approve`
		// gate (slaTargetAdmin). Clocks/outbox stay on the coarse write tier.
		slaTargetAdmin.Post("/sla/targets", deps.SLA.CreateTarget)
		slaTargetView.Get("/sla/targets", deps.SLA.ListTargets)
		slaTargetView.Get("/sla/targets/{id}", deps.SLA.GetTarget)
		slaTargetAdmin.Patch("/sla/targets/{id}", deps.SLA.UpdateTarget)
		slaTargetAdmin.Delete("/sla/targets/{id}", deps.SLA.DeleteTarget)
		write.Post("/sla/clocks", deps.SLA.StartClock)
		read.Get("/sla/requests/{requestId}/clock", deps.SLA.GetClockByRequest)
		// WS9 operations-board computed clock view. chi treats /sla/clocks and
		// /sla/clocks/{id} as distinct patterns (literal precedes wildcard) — no conflict.
		read.Get("/sla/clocks", deps.SLA.ListClocks)
		read.Get("/sla/clocks/{id}", deps.SLA.GetClock)
		write.Post("/sla/clocks/{id}/acknowledge", deps.SLA.Acknowledge)
		write.Post("/sla/clocks/{id}/escalate", deps.SLA.TriggerEscalation)
		write.Post("/sla/outbox/dispatch", deps.SLA.DispatchOutbox)
	}

	// Execution Rules (CAP-022..029). All routes hang off /requests/{requestId}/
	// execution; GET is read, mutations are write.
	if deps.Execution != nil {
		read.Get("/requests/{requestId}/execution", deps.Execution.GetState)
		write.Post("/requests/{requestId}/execution/confirm-completeness", deps.Execution.ConfirmCompleteness)
		write.Post("/requests/{requestId}/execution/return-incomplete", deps.Execution.ReturnIncomplete)
		write.Post("/requests/{requestId}/execution/requirements", deps.Execution.AddRequirement)
		// Request owners may satisfy an existing requirement (including the final
		// signed-contract upload). UpdateRequirement narrows non-lex:write actors
		// to their own request and fulfillment-only fields server-side.
		requestRequirementUpdate.Patch("/requests/{requestId}/execution/requirements/{itemId}", deps.Execution.UpdateRequirement)
		write.Delete("/requests/{requestId}/execution/requirements/{itemId}", deps.Execution.DeleteRequirement)
		write.Post("/requests/{requestId}/execution/delivery-confirmation", deps.Execution.RequestDeliveryConfirmation)
		// Respond is the requester/intended-recipient side of the handshake. The
		// request:edit tier admits the base requester; the service then enforces
		// exact persisted-recipient ownership before changing lifecycle state.
		requestEdit.Post("/requests/{requestId}/execution/delivery-confirmation/{confirmationId}/respond", deps.Execution.RespondDeliveryConfirmation)
		// Contract requests never auto-close. A contracts operator (contract:edit)
		// marks the legal work achieved while the request remains open; the intended
		// requester later supplies final delivery notes and closes it.
		contractAchievement.Post("/requests/{requestId}/execution/delivery-confirmation/{confirmationId}/achieve", deps.Execution.AchieveDeliveryConfirmation)
	}

	// ---------------------------------------------------------------------------
	// Phase 2 modules (no new RBAC verbs). Both reuse the existing read/write
	// tiers. Static path segments precede the parameterized /{id} routes so they
	// win over the wildcard. Case sub-resources use distinct {partyId}/{hearingId}/
	// {taskId} keys; the case root and intake routes use {id} (kept consistent with
	// the /requests/{id} convention enforced by router_compose_test.go). The intake
	// decision route reuses the {workflowInstanceID}/{taskID} keys of the existing
	// request-approval decision route.
	// ---------------------------------------------------------------------------

	// Case Classification taxonomy (CAP-074/075/076). Static /tree, /lookup and
	// /{id}/cascade precede the bare /{id} route.
	if deps.CaseClassification != nil {
		// F9: the case-classification taxonomy is a catalog-class config surface. Align
		// the backend to the shipped FE policy (canWrite = lex:catalog:manage): reads gate
		// on catalogView (catalog:view OR coarse lex:read) and mutations on catalogManage
		// (catalog:manage ONLY, NO coarse lex:write fallback). This fixes BOTH directions —
		// the System Administrator (catalog:manage) can now manage the tree, and the six
		// lex:write-but-not-catalog:manage roles (cases/contracts managers, supervisors,
		// officer, advisor) can no longer POST/PUT/DELETE/merge the tenant taxonomy through
		// the API (the read-only UI is no longer the only guard). ADM's catalog:manage
		// expands to catalog:view via expandGrants, so the reads pass too.
		catalogManage.Post("/case-classifications", deps.CaseClassification.Create)
		catalogView.Get("/case-classifications", deps.CaseClassification.List)
		catalogView.Get("/case-classifications/tree", deps.CaseClassification.Tree)
		catalogView.Get("/case-classifications/selectable", deps.CaseClassification.Selectable)
		catalogView.Get("/case-classifications/lookup", deps.CaseClassification.GetByCode)
		catalogView.Get("/case-classifications/usage", deps.CaseClassification.Usage)
		catalogView.Get("/case-classifications/{id}/cascade", deps.CaseClassification.Cascade)
		catalogView.Get("/case-classifications/{id}/audit", deps.CaseClassification.Audit)
		catalogView.Get("/case-classifications/{id}", deps.CaseClassification.Get)
		// Static /reorder and /bulk precede the bare /{id} write routes so they win
		// over the wildcard.
		catalogManage.Post("/case-classifications/reorder", deps.CaseClassification.Reorder)
		catalogManage.Post("/case-classifications/bulk", deps.CaseClassification.Bulk)
		catalogManage.Post("/case-classifications/{id}/merge", deps.CaseClassification.Merge)
		catalogManage.Put("/case-classifications/{id}", deps.CaseClassification.Update)
		catalogManage.Delete("/case-classifications/{id}", deps.CaseClassification.Delete)
	}

	// Tenant-maintained bilingual court catalog. The initial migration is
	// intentionally unseeded until the customer supplies its approved list, so the
	// CRUD tier below is the ONLY way rows ever appear — without it the competent-
	// court dropdown can never stop being empty. Reads gate on catalogView, writes
	// on catalogManage (catalog:manage only), matching the case-classification
	// reference-data precedent above. Static /legacy-values precedes /{id}.
	if deps.LegalCourt != nil {
		catalogView.Get("/legal-courts", deps.LegalCourt.List)
		catalogView.Get("/legal-courts/legacy-values", deps.LegalCourt.LegacyValues)
		catalogView.Get("/legal-courts/{id}", deps.LegalCourt.Get)
		catalogManage.Post("/legal-courts", deps.LegalCourt.Create)
		catalogManage.Put("/legal-courts/{id}", deps.LegalCourt.Update)
		catalogManage.Delete("/legal-courts/{id}", deps.LegalCourt.Delete)
	}

	// Litigation Case Management — first-class LegalCase aggregate (CAP-032..051):
	// CRUD, FSM/management actions, the two-phase intake pipeline (the directive
	// chain delegates to the shared ApprovalOrchestrator with the DoA X.509
	// authority-evidence seam), and the parties/hearings/tasks sub-resources.
	if deps.LegalCase != nil {
		// Matrix domain `case`: reads -> :view, create -> :add, mutate ->
		// :edit, the intake-directive decision -> :approve, destructive delete keeps
		// the org-RBAC :close gate. Each tier falls back to coarse lex:read/write.
		caseView.Get("/legal-cases", deps.LegalCase.List)
		caseAdd.Post("/legal-cases", deps.LegalCase.Create)
		// Global case-intake decision queue. This is an approval surface, so unlike
		// ordinary case reads it requires the exact case:approve capability. The
		// service then narrows rows to the actor's assignee/role/claim visibility.
		// Keep the static path ahead of /legal-cases/{id}/... routes.
		caseApprove.Get("/legal-cases/intake/tasks", deps.LegalCase.ListIntakeTasks)
		caseView.Get("/legal-cases/{id}/audit", deps.LegalCase.ListAudit)
		caseView.Get("/legal-cases/{id}/versions", deps.LegalCase.ListVersions)
		caseView.Get("/legal-cases/{id}/intake", deps.LegalCase.GetIntake)
		caseEdit.Post("/legal-cases/{id}/intake/start", deps.LegalCase.StartIntake)
		// The intake directive decision is the case-approval SoD control point. It
		// carries the dynamic-SoD guard (caseDecision): the case author cannot render
		// the approval verdict on their own case (design v2 §4.2). The /intake/start
		// kickoff above stays on the plain :approve tier (author-initiated by design).
		caseDecision.Post("/legal-cases/{id}/intake/{workflowInstanceID}/tasks/{taskID}/decision", deps.LegalCase.DecideIntake)
		// Completing phase 2 allocates the section manager and optional case team,
		// so it carries the same restricted case:assign gate as later reassignments.
		caseAssign.Post("/legal-cases/{id}/intake/handoff", deps.LegalCase.CompleteIntakeHandoff)
		caseEdit.Post("/legal-cases/{id}/status", deps.LegalCase.UpdateStatus)
		caseEdit.Post("/legal-cases/{id}/strength", deps.LegalCase.SetStrength)
		caseEdit.Post("/legal-cases/{id}/risk-rating", deps.LegalCase.SetRiskRating)
		caseEdit.Post("/legal-cases/{id}/priority", deps.LegalCase.SetPriority)
		// Case work allocation is the RESTRICTED `assign` verb (section-manager /
		// director only, design v2 §2.1 / §3) — split off the coarse-fallback caseEdit
		// tier onto caseAssign (RequirePermission(lex:case:assign), no fallback). An
		// officer holding lex:case:edit for drafting cannot reach assignment.
		caseAssign.Post("/legal-cases/{id}/transfer-section-manager", deps.LegalCase.TransferToSectionManager)
		caseAssign.Post("/legal-cases/{id}/assign-supervisor", deps.LegalCase.AssignSupervisor)
		caseAssign.Post("/legal-cases/{id}/assign-officer", deps.LegalCase.AssignOfficer)
		caseEdit.Post("/legal-cases/{id}/parties", deps.LegalCase.AddParty)
		// WS9 bulk party create — literal /parties/bulk precedes wildcard /parties/{partyId}.
		caseEdit.Post("/legal-cases/{id}/parties/bulk", deps.LegalCase.BulkAddParties)
		caseEdit.Put("/legal-cases/{id}/parties/{partyId}", deps.LegalCase.UpdateParty)
		caseEdit.Delete("/legal-cases/{id}/parties/{partyId}", deps.LegalCase.DeleteParty)
		caseEdit.Post("/legal-cases/{id}/hearings", deps.LegalCase.AddHearing)
		caseEdit.Put("/legal-cases/{id}/hearings/{hearingId}", deps.LegalCase.UpdateHearing)
		caseEdit.Delete("/legal-cases/{id}/hearings/{hearingId}", deps.LegalCase.DeleteHearing)
		caseEdit.Post("/legal-cases/{id}/tasks", deps.LegalCase.DefineTask)
		// WS9 bulk task define — literal /tasks/bulk precedes wildcard /tasks/{taskId}.
		caseEdit.Post("/legal-cases/{id}/tasks/bulk", deps.LegalCase.BulkDefineTasks)
		caseEdit.Put("/legal-cases/{id}/tasks/{taskId}", deps.LegalCase.UpdateTask)
		caseEdit.Delete("/legal-cases/{id}/tasks/{taskId}", deps.LegalCase.DeleteTask)
		caseView.Get("/legal-cases/{id}/milestones", deps.LegalCase.ListMilestones)
		caseEdit.Post("/legal-cases/{id}/milestones", deps.LegalCase.AddMilestone)
		caseEdit.Put("/legal-cases/{id}/milestones/{milestoneId}", deps.LegalCase.UpdateMilestone)
		caseEdit.Delete("/legal-cases/{id}/milestones/{milestoneId}", deps.LegalCase.DeleteMilestone)
		caseView.Get("/legal-cases/{id}/comments", deps.LegalCase.ListComments)
		caseEdit.Post("/legal-cases/{id}/comments", deps.LegalCase.AddComment)
		caseEdit.Put("/legal-cases/{id}/comments/{commentId}", deps.LegalCase.UpdateComment)
		caseEdit.Delete("/legal-cases/{id}/comments/{commentId}", deps.LegalCase.DeleteComment)
		caseView.Get("/legal-cases/{id}/documents", deps.LegalCase.ListDocuments)
		caseEdit.Post("/legal-cases/{id}/documents", deps.LegalCase.AddDocument)
		caseEdit.Put("/legal-cases/{id}/documents/{documentLinkId}", deps.LegalCase.UpdateDocument)
		caseEdit.Delete("/legal-cases/{id}/documents/{documentLinkId}", deps.LegalCase.DeleteDocument)
		caseView.Get("/legal-cases/{id}", deps.LegalCase.Get)
		caseEdit.Put("/legal-cases/{id}", deps.LegalCase.Update)
		// Destructive delete -> org-RBAC `close` gate (caseClose) PLUS the dynamic-SoD
		// guard (withDistinctActor): a hard-close is a close verb, so the case author
		// cannot delete-close their own case — parity with the /status close path
		// (design v2 §4.2). Without this, DELETE bypasses the SoD control that the
		// status close enforces.
		withDistinctActor(caseClose, deps.CaseActorResolver).Delete("/legal-cases/{id}", deps.LegalCase.Delete)
	}

	// ---------------------------------------------------------------------------
	// Phase 3 modules (no new RBAC verbs). Five mutually-independent verticals.
	// All reuse the existing read/write tiers and the approvalRead/approvalWrite
	// tiers defined above. Static path segments precede the parameterized /{id}
	// routes so they win over the wildcard; the case-scoped litigation routes hang
	// off /legal-cases/{id}/... and are registered AFTER the LegalCase block, with
	// distinct {pleadingId}/{hearingId}/{expertId}/{judgmentId}/{defendantId}/
	// {reportId} sub-keys and the shared {workflowInstanceID}/{taskID} decision keys.
	// ---------------------------------------------------------------------------

	// 1) Plaintiff & Defendant litigation flows (CAP-052..073).
	if deps.Litigation != nil {
		// Pleadings.
		write.Post("/legal-cases/{id}/pleadings", deps.Litigation.CreatePleading)
		read.Get("/legal-cases/{id}/pleadings", deps.Litigation.ListPleadings)
		write.Post("/legal-cases/{id}/pleadings/{pleadingId}/attachments", deps.Litigation.AddPleadingAttachment)
		write.Post("/legal-cases/{id}/pleadings/{pleadingId}/generation", deps.Litigation.GeneratePleading)
		write.Post("/legal-cases/{id}/pleadings/{pleadingId}/generation/retry", deps.Litigation.RetryPleadingGeneration)
		read.Get("/legal-cases/{id}/pleadings/{pleadingId}/generation", deps.Litigation.GetPleadingGeneration)
		read.Get("/legal-cases/{id}/pleadings/{pleadingId}/generation/events", deps.Litigation.StreamPleadingGeneration)
		write.Delete("/legal-cases/{id}/pleadings/{pleadingId}/generation", deps.Litigation.CancelPleadingGeneration)
		approvalWrite.Post("/legal-cases/{id}/pleadings/{pleadingId}/submit", deps.Litigation.SubmitPleading)
		// design v2 §4.4: the pleading-approval DECISION renders an approve/reject
		// verdict on a case-domain record, so it leaves the coarse approvalWrite tier
		// for the case workflow-decision tier (lex:case:approve OR :edit, no lex:write).
		// The /submit kickoff above stays on approvalWrite (author-initiated by design —
		// the officer submits their own draft pleading into the chain). See
		// caseDecisionWorkflow. Distinct-actor parity (decider != pleading author) is
		// enforced in DecidePleadingApproval.
		caseDecisionWorkflow.Post("/legal-cases/{id}/pleadings/{pleadingId}/approvals/{workflowInstanceID}/tasks/{taskID}/decision", deps.Litigation.DecidePleading)
		write.Post("/legal-cases/{id}/pleadings/{pleadingId}/file", deps.Litigation.FilePleading)
		read.Get("/legal-cases/{id}/pleadings/{pleadingId}", deps.Litigation.GetPleading)
		write.Put("/legal-cases/{id}/pleadings/{pleadingId}", deps.Litigation.UpdatePleading)
		write.Delete("/legal-cases/{id}/pleadings/{pleadingId}", deps.Litigation.DeletePleading)

		// Hearing reports (CAP-058..061).
		write.Post("/legal-cases/{id}/hearings/{hearingId}/reports", deps.Litigation.CreateHearingReport)
		read.Get("/legal-cases/{id}/hearings/{hearingId}/reports", deps.Litigation.ListHearingReports)
		write.Put("/legal-cases/{id}/hearings/{hearingId}/reports/{reportId}", deps.Litigation.UpdateHearingReport)
		write.Delete("/legal-cases/{id}/hearings/{hearingId}/reports/{reportId}", deps.Litigation.DeleteHearingReport)

		// Experts.
		write.Post("/legal-cases/{id}/experts", deps.Litigation.CreateExpert)
		read.Get("/legal-cases/{id}/experts", deps.Litigation.ListExperts)
		write.Post("/legal-cases/{id}/experts/{expertId}/documents", deps.Litigation.AddExpertDocument)
		read.Get("/legal-cases/{id}/experts/{expertId}", deps.Litigation.GetExpert)
		write.Put("/legal-cases/{id}/experts/{expertId}", deps.Litigation.UpdateExpert)
		write.Delete("/legal-cases/{id}/experts/{expertId}", deps.Litigation.DeleteExpert)

		// Judgments (CAP-062..066). Study(object) creates a linked legal_obligation.
		write.Post("/legal-cases/{id}/judgments", deps.Litigation.CreateJudgment)
		read.Get("/legal-cases/{id}/judgments", deps.Litigation.ListJudgments)
		write.Post("/legal-cases/{id}/judgments/{judgmentId}/study", deps.Litigation.StudyJudgment)
		read.Get("/legal-cases/{id}/judgments/{judgmentId}", deps.Litigation.GetJudgment)
		write.Delete("/legal-cases/{id}/judgments/{judgmentId}", deps.Litigation.DeleteJudgment)

		// Defendant cases (CAP-067..073).
		write.Post("/legal-cases/{id}/defendant", deps.Litigation.RegisterDefendant)
		read.Get("/legal-cases/{id}/defendant", deps.Litigation.ListDefendant)
		write.Post("/legal-cases/{id}/defendant/{defendantId}/najiz", deps.Litigation.SetNajizRepresentative)
		// CAP-069 Najiz READ sync (write tier — reconciles the local row) + honest
		// health (read tier). The adapter never fabricates live MoJ success.
		write.Post("/legal-cases/{id}/defendant/{defendantId}/najiz/sync", deps.Litigation.SyncNajizCase)
		read.Get("/legal-cases/{id}/defendant/{defendantId}/najiz/health", deps.Litigation.NajizCourtHealth)
		write.Post("/legal-cases/{id}/defendant/{defendantId}/attachments", deps.Litigation.AddDefendantAttachment)
		write.Post("/legal-cases/{id}/defendant/{defendantId}/notify-department", deps.Litigation.NotifyDepartment)
		write.Post("/legal-cases/{id}/defendant/{defendantId}/response-memo", deps.Litigation.DraftResponseMemo)
		// design v2 §4.4: the defendant response-review DECISION renders an approve/
		// reject verdict on the two-tier memo (a case-domain record), so it leaves the
		// coarse approvalWrite tier for the case workflow-decision tier (lex:case:approve
		// OR :edit, no lex:write) — the tier-1 supervisor reviews on :edit, the tier-2
		// section-manager approves on :approve, and the engine's require_distinct_approvers
		// flag already enforces the two distinct tiers. The /response-review start kickoff
		// below stays on approvalWrite (author-initiated by design). See
		// caseDecisionWorkflow. Distinct-actor parity (decider != defendant-case author)
		// is enforced in DecideResponseReview.
		caseDecisionWorkflow.Post("/legal-cases/{id}/defendant/{defendantId}/response-review/{workflowInstanceID}/tasks/{taskID}/decision", deps.Litigation.DecideResponseReview)
		approvalWrite.Post("/legal-cases/{id}/defendant/{defendantId}/response-review", deps.Litigation.StartResponseReview)
		read.Get("/legal-cases/{id}/defendant/{defendantId}", deps.Litigation.GetDefendant)
		write.Put("/legal-cases/{id}/defendant/{defendantId}", deps.Litigation.UpdateDefendant)
		write.Delete("/legal-cases/{id}/defendant/{defendantId}", deps.Litigation.DeleteDefendant)
	}

	// 2) Investigations (CAP-077..083). Static sub-paths precede the bare /{id}.
	if deps.Investigation != nil {
		// Matrix domain `investigation`: create -> :add, reads -> :view, record/
		// mutate -> :edit, the approval decision (results sign-off) -> :approve,
		// delete -> :close. SoD: the officer records; the manager approves results.
		investigationAdd.Post("/investigations", deps.Investigation.Create)
		investigationView.Get("/investigations", deps.Investigation.List)
		investigationView.Get("/investigations/{id}/audit", deps.Investigation.ListAudit)
		investigationEdit.Post("/investigations/{id}/parties", deps.Investigation.AddParty)
		investigationEdit.Put("/investigations/{id}/parties/{partyId}", deps.Investigation.UpdateParty)
		investigationEdit.Delete("/investigations/{id}/parties/{partyId}", deps.Investigation.DeleteParty)
		investigationEdit.Post("/investigations/{id}/statements", deps.Investigation.RecordStatement)
		investigationEdit.Delete("/investigations/{id}/statements/{statementId}", deps.Investigation.DeleteStatement)
		investigationEdit.Post("/investigations/{id}/evidence", deps.Investigation.UploadEvidence)
		investigationEdit.Delete("/investigations/{id}/evidence/{evidenceId}", deps.Investigation.DeleteEvidence)
		investigationEdit.Post("/investigations/{id}/results", deps.Investigation.RecordResults)
		investigationEdit.Post("/investigations/{id}/recommendations", deps.Investigation.RecordRecommendations)
		investigationStatus.Post("/investigations/{id}/status", deps.Investigation.UpdateStatus)
		investigationEdit.Post("/investigations/{id}/reminders", deps.Investigation.ScheduleDeadlineReminder)
		// Submission is an author/editor action. Only the decision route is an
		// approval control point and retains approve permission + distinct actor.
		investigationEdit.Post("/investigations/{id}/approval/start", deps.Investigation.StartApproval)
		investigationView.Get("/investigations/{id}/approval/tasks", deps.Investigation.ListApprovalTasks)
		// Results sign-off decision is the SoD control point (investigationDecision):
		// the officer who recorded the results cannot also approve them.
		investigationDecision.Post("/investigations/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision", deps.Investigation.DecideApproval)
		investigationView.Get("/investigations/{id}", deps.Investigation.Get)
		investigationEdit.Put("/investigations/{id}", deps.Investigation.Update)
		// Destructive delete -> org-RBAC `close` gate (investigationClose).
		withDistinctActor(investigationClose, deps.InvestigationActorResolver).Delete("/investigations/{id}", deps.Investigation.Delete)
	}

	// 3) Legal Consultations (CAP-126..132).
	if deps.Consultation != nil {
		// Matrix domain `consultation`: submit -> :add, reads -> :view, classify/
		// route/respond/archive -> :edit (the advisor AUTHORS the response), the
		// approval decision -> :approve. SoD: responder ≠ approver (design §3).
		consultationAdd.Post("/consultations", deps.Consultation.Submit)
		consultationView.Get("/consultations", deps.Consultation.List)
		consultationView.Get("/consultations/count", deps.Consultation.Count)
		// Literal sub-paths registered before /consultations/{id} so chi does not
		// route "stats"/"tags"/"advisor-workload" into the {id} param.
		consultationView.Get("/consultations/stats", deps.Consultation.Stats)
		consultationView.Get("/consultations/tags", deps.Consultation.Tags)
		consultationView.Get("/consultations/advisor-workload", deps.Consultation.AdvisorWorkload)
		// Bulk operations share the single-delete gate (lex:write + org `close`):
		// the delete action requires org:close, and the org gate is a transparent
		// pass-through for the other actions when no entity_id is supplied.
		consultationClose.Post("/consultations/bulk", deps.Consultation.Bulk)
		consultationView.Get("/consultations/{id}/audit", deps.Consultation.ListAudit)
		consultationView.Get("/consultations/{id}/legal-hold", deps.Consultation.LegalHold)
		consultationEdit.Post("/consultations/{id}/classify", deps.Consultation.Classify)
		consultationEdit.Post("/consultations/{id}/route", deps.Consultation.Route)
		consultationEdit.Post("/consultations/{id}/respond/draft", deps.Consultation.DraftResponse)
		consultationEdit.Post("/consultations/{id}/respond", deps.Consultation.Respond)
		consultationEdit.Post("/consultations/{id}/archive", deps.Consultation.Archive)
		consultationEdit.Post("/consultations/{id}/documents", deps.Consultation.AttachDocument)
		consultationView.Get("/consultations/{id}/documents", deps.Consultation.ListDocuments)
		consultationEdit.Delete("/consultations/{id}/documents/{documentId}", deps.Consultation.DetachDocument)
		consultationApprove.Post("/consultations/{id}/approval/start", deps.Consultation.StartApproval)
		consultationView.Get("/consultations/{id}/approval/tasks", deps.Consultation.ListApprovalTasks)
		// Consultation-answer sign-off decision is the SoD control point
		// (consultationDecision): the advisor who AUTHORED the response cannot also
		// approve it (responder != approver, design v2 §3 / §4.2).
		consultationDecision.Post("/consultations/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision", deps.Consultation.DecideApprovalTask)
		consultationView.Get("/consultations/{id}", deps.Consultation.Get)
		// Destructive delete -> org-RBAC `close` gate (consultationClose).
		consultationClose.Delete("/consultations/{id}", deps.Consultation.Delete)
	}
	if deps.ManagerTask != nil {
		read.Get("/manager-tasks", deps.ManagerTask.List)
		read.Get("/manager-tasks/{id}", deps.ManagerTask.Get)
		// Manager-task authority is role- and actor-scoped in the service. Using
		// contract:edit here incorrectly locked the Cases Manager out of the same
		// task workflow and coupled a cross-domain feature to Contracts RBAC.
		read.Post("/manager-tasks", deps.ManagerTask.Create)
		read.Post("/manager-tasks/{id}/start", deps.ManagerTask.Start)
		read.Post("/manager-tasks/{id}/submit", deps.ManagerTask.Submit)
		managerTaskDecision.Post("/manager-tasks/{id}/decision", deps.ManagerTask.Decide)
	}
	if deps.SupportRequest != nil {
		supportCreate.Post("/support-requests", deps.SupportRequest.Create)
		supportView.Get("/support-requests", deps.SupportRequest.List)
		// Static routes must precede the parameterized detail route.
		supportCreate.Get("/support-requests/directory", deps.SupportRequest.Directory)
		supportCreate.Get("/support-requests/expiry-preview", deps.SupportRequest.PreviewExpiry)
		supportView.Get("/support-requests/{id}", deps.SupportRequest.Get)
		supportRespond.Post("/support-requests/{id}/accept", deps.SupportRequest.Accept)
		supportRespond.Post("/support-requests/{id}/decline", deps.SupportRequest.Decline)
		supportRespond.Post("/support-requests/{id}/resolve", deps.SupportRequest.Resolve)
		supportCreate.Post("/support-requests/{id}/cancel", deps.SupportRequest.Cancel)
		// The approval gate invents no permission of its own: authority is being
		// the approver frozen on the row, which the service enforces. The route
		// sits behind the broadest support gate so an approving manager is never
		// locked out by lacking `respond` (which is the colleague's grant).
		supportView.Post("/support-requests/{id}/approve", deps.SupportRequest.Approve)
		supportView.Post("/support-requests/{id}/reject", deps.SupportRequest.Reject)
	}

	// 4) Case Timelines (external dependency/delay) — extends legal_matters.
	if deps.CaseTimeline != nil {
		// Cross-matter portfolio summary (#15). Registered before the /matters/{id}
		// routes; chi prefers the static "timelines" segment over the {id} wildcard.
		read.Get("/matters/timelines", deps.CaseTimeline.ListTimelineSummaries)
		read.Get("/matters/{id}/timeline", deps.CaseTimeline.GetTimeline)
		write.Put("/matters/{id}/timeline", deps.CaseTimeline.UpdateTimeline)
		write.Post("/matters/{id}/timeline/external-hold", deps.CaseTimeline.SetExternalHold)
		read.Get("/matters/{id}/hold-history", deps.CaseTimeline.ListHoldHistory)
		read.Get("/matters/{id}/delay-events", deps.CaseTimeline.ListDelayEvents)
		write.Post("/matters/{id}/delay-events", deps.CaseTimeline.RecordDelayEvent)
		write.Patch("/matters/{id}/delay-events/{eventId}", deps.CaseTimeline.UpdateDelayEvent)
		write.Post("/matters/{id}/delay-events/{eventId}/resolve", deps.CaseTimeline.ResolveDelayEvent)
		write.Post("/matters/{id}/delay-events/{eventId}/reopen", deps.CaseTimeline.ReopenDelayEvent)
		read.Get("/matters/{id}/deadlines", deps.CaseTimeline.ListDeadlines)
		write.Post("/matters/{id}/deadlines", deps.CaseTimeline.CreateDeadline)
	}

	// 5) Settlements / ADR (CAP-084..093). Approval reuses the shared orchestrator.
	if deps.Settlement != nil {
		// Matrix domain `settlement`: open/record/rounds -> :edit (no standalone add
		// in the scheme; create maps to edit per design §3), reads -> :view, submit/
		// decide -> :approve, close-by-reconciliation -> :approve (the settlement
		// approval that precedes case closure). SoD: handler edits; manager approves.
		settlementEdit.Post("/settlements", deps.Settlement.Open)
		settlementView.Get("/settlements", deps.Settlement.List)
		settlementView.Get("/reports/settlements", deps.Settlement.Report)
		settlementView.Get("/settlements/{id}/audit", deps.Settlement.ListAudit)
		settlementEdit.Post("/settlements/{id}/rounds", deps.Settlement.AddRound)
		// Submit-for-approval is author-initiated (the handler pushes their own
		// settlement into the chain) -> plain :approve tier. The decision and the
		// close-by-reconciliation ARE the verdict points -> settlementDecision (dynamic
		// SoD: the settlement author cannot approve/close their own settlement).
		settlementApprove.Post("/settlements/{id}/submit", deps.Settlement.SubmitForApproval)
		settlementDecision.Post("/settlements/{id}/workflows/{workflowId}/tasks/{taskId}/decision", deps.Settlement.Decide)
		settlementDecision.Post("/settlements/{id}/close", deps.Settlement.CloseByReconciliation)
		settlementView.Get("/settlements/{id}", deps.Settlement.Get)
		settlementEdit.Put("/settlements/{id}", deps.Settlement.Record)
		// Destructive delete -> org-RBAC `close` gate (settlementClose).
		settlementClose.Delete("/settlements/{id}", deps.Settlement.Delete)
	}

	// Settlement document-registry links (FEATURE 12). Mirrors
	// /matters/{id}/documents; deletes remove the LINK only (WORM).
	if deps.SettlementDocument != nil {
		read.Get("/settlements/{id}/documents", deps.SettlementDocument.ListDocuments)
		write.Post("/settlements/{id}/documents", deps.SettlementDocument.AddDocument)
		write.Delete("/settlements/{id}/documents/{documentLinkId}", deps.SettlementDocument.DeleteDocument)
	}

	// 6) Contracts review-desk (CAP-094..125). Subject IS contracts: hangs off
	// /contracts/{id}/review-desk and reuses the contract-bound WorkflowService for
	// the Contracts-Manager approval (no approval_orchestrator). Distribute +
	// recommendation accept the approval-write tier (role-guarded CAP-106 inside).
	if deps.ContractReviewDesk != nil {
		read.Get("/contracts/{id}/review-desk", deps.ContractReviewDesk.Overview)
		contractReviewPrepare.Post("/contracts/{id}/review-desk/intake", deps.ContractReviewDesk.OpenIntake)
		write.Post("/contracts/{id}/review-desk/intake/acknowledge", deps.ContractReviewDesk.Acknowledge)
		write.Post("/contracts/{id}/review-desk/intake/route", deps.ContractReviewDesk.RouteToLegal)
		write.Post("/contracts/{id}/review-desk/intake/return", deps.ContractReviewDesk.Return)
		// Contract distribution is the RESTRICTED `distribute` verb (supervisor /
		// manager / director only, design v2 §2.1 / §3) — gate it on lex:contract:distribute
		// with NO coarse fallback (an advisor holding contract:edit cannot distribute).
		contractDistribute.Post("/contracts/{id}/review-desk/distribute", deps.ContractReviewDesk.Distribute)
		read.Get("/contracts/{id}/review-desk/attachments", deps.ContractReviewDesk.ListAttachments)
		contractReviewPrepare.Post("/contracts/{id}/review-desk/attachments", deps.ContractReviewDesk.UploadAttachment)
		contractReviewPrepare.Delete("/contracts/{id}/review-desk/attachments/{attachmentId}", deps.ContractReviewDesk.DeleteAttachment)
		write.Post("/contracts/{id}/review-desk/requirements", deps.ContractReviewDesk.SetRequirement)
		write.Post("/contracts/{id}/review-desk/completeness", deps.ContractReviewDesk.CheckCompleteness)
		read.Get("/contracts/{id}/review-desk/correspondence", deps.ContractReviewDesk.ListCorrespondence)
		write.Post("/contracts/{id}/review-desk/correspondence", deps.ContractReviewDesk.AddCorrespondence)
		read.Get("/contracts/{id}/review-desk/recommendations", deps.ContractReviewDesk.ListRecommendations)
		approvalWrite.Post("/contracts/{id}/review-desk/recommendation", deps.ContractReviewDesk.RecordRecommendation)
	}

	// 6b) Contracts review-desk FINAL version (CAP-117). Gated on an approved
	// review-desk recommendation inside the service (409 otherwise). The static
	// /final-version segment routes distinctly from the other review-desk routes.
	if deps.ContractFinalVersion != nil {
		write.Post("/contracts/{id}/review-desk/final-version", deps.ContractFinalVersion.UploadFinalVersion)
	}

	// ---------------------------------------------------------------------------
	// Phase 4 modules. ADDITIVE/backward-compatible RBAC: every route is gated with
	// RequireAnyPermission(granularVerb, coarseVerb) so the new granular lex verbs
	// (lex:report:read, lex:view/add/edit/close) AND the legacy coarse
	// lex:read/lex:write (and lex:* / admin:* wildcards) all keep working with no
	// role migration. Static path segments precede the parameterized /{id} routes
	// so they win over the wildcard. Each block is nil-guarded.
	// ---------------------------------------------------------------------------

	// Reporting & KPIs (CAP-133..151). Read-only analytics over the Phase-0..3
	// source tables. Gated lex:report:read OR lex:read.
	if deps.Reporting != nil {
		// The case-control payload includes decrypted investigation PII. Requiring
		// BOTH exact domain-view capabilities prevents a report-only or legacy
		// coarse-read actor from gaining investigation subject/findings data.
		// Wildcard roles (lex:* / admin:*) continue to satisfy both checks.
		caseControlRead := applyABAC(r.With(
			sharedmw.RequirePermission(auth.PermLexCaseView),
			sharedmw.RequirePermission(auth.PermLexInvestigationView),
		))
		caseControlRead.Get("/dashboard/cases-control", deps.Reporting.CaseControlDashboard)
		reportRead.Get("/reports/cases", deps.Reporting.CaseReport)
		reportRead.Get("/reports/investigations", deps.Reporting.InvestigationReport)
		// /reports/contracts is already owned by deps.Contract.ContractReport (the
		// existing contract CSV export); the Phase-4 analytics variant is mounted at
		// /reports/contracts-analytics to preserve that export (collision resolved).
		reportRead.Get("/reports/contracts-analytics", deps.Reporting.ContractReport)
		reportRead.Get("/reports/consultations", deps.Reporting.ConsultationReport)
		reportRead.Get("/reports/performance", deps.Reporting.PerformanceKPIs)
		reportRead.Get("/reports/detailed-analytics/contributors", deps.Reporting.DetailedAnalyticsContributors)
		reportRead.Get("/reports/detailed-analytics", deps.Reporting.DetailedAnalytics)
		reportRead.Get("/kpis/sla-compliance", deps.Reporting.SLACompliance)
		reportRead.Get("/dashboard/legal-affairs", deps.Reporting.LegalAffairsDashboard)
	}
	if deps.Workforce != nil {
		workforceRead := r.With(lexmw.RequireWorkforceAccess(auth.PermLexWorkforceRead))
		if deps.ABACMW != nil {
			workforceRead = workforceRead.With(deps.ABACMW)
		}
		workforceRead.Get("/reports/workforce", deps.Workforce.Report)
	}

	// Lex legal AI assistant (LEX-LD-GAP-DESIGN §G4). Mounted ONLY when the
	// deployment enabled it, so an un-enabled environment has no /ai/* surface
	// to probe. Gated on the dedicated lex:ai:use permission — deliberately NOT
	// lex:read: an LLM surface that can summarise across legal domains needs its
	// own switch. The assistant's answers are additionally masked per domain by
	// the caller's own view permissions inside the service.
	if deps.AI != nil {
		aiUse := r.With(sharedmw.RequirePermission(auth.PermLexAIUse))
		if deps.ABACMW != nil {
			aiUse = aiUse.With(deps.ABACMW)
		}
		aiUse.Post("/ai/chat", deps.AI.Chat)
		aiUse.Get("/ai/sessions", deps.AI.ListSessions)
		aiUse.Get("/ai/sessions/{sessionID}", deps.AI.GetSession)
	}

	// Notification triggers + in-app inbox (CAP-156..164). Reads accept lex:read OR
	// lex:write (self-scoped); subscription mutations require lex:write. Static
	// /inbox/read-all + /inbox/counts precede the /inbox/{id} routes.
	if deps.Notifications != nil {
		inboxRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexRead, auth.PermLexWrite))
		if deps.ABACMW != nil {
			inboxRead = inboxRead.With(deps.ABACMW)
		}
		inboxRead.Get("/notifications/inbox/counts", deps.Notifications.Counts)
		inboxRead.Get("/notifications/inbox", deps.Notifications.ListInbox)
		inboxRead.Post("/notifications/inbox/read-all", deps.Notifications.MarkAllRead)
		inboxRead.Post("/notifications/inbox/{id}/read", deps.Notifications.MarkRead)
		inboxRead.Get("/notifications/inbox/{id}", deps.Notifications.GetInbox)
		inboxRead.Get("/notifications/subscriptions", deps.Notifications.ListSubscriptions)
		write.Put("/notifications/subscriptions", deps.Notifications.UpsertSubscription)
		write.Delete("/notifications/subscriptions/{id}", deps.Notifications.DeleteSubscription)
	}

	// Cross-cutting tiers (document FTS, integrations): granular 5-verb RBAC with
	// coarse fallbacks. lex:view => reads; lex:edit => index-update. The tier vars are
	// built inside this guard so they are never declared-and-unused when none of the
	// three cross-cutting handlers are wired (e.g. the legacy phase-0 route tests).
	// Attachment policies (F10) build their OWN catalog-aware tiers inside their block.
	if deps.DocumentSearch != nil || deps.AttachmentPolicy != nil || deps.Integration != nil {
		crossRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexView, auth.PermLexRead))
		crossEdit := r.With(sharedmw.RequireAnyPermission(auth.PermLexEdit, auth.PermLexWrite))
		if deps.ABACMW != nil {
			crossRead = crossRead.With(deps.ABACMW)
			crossEdit = crossEdit.With(deps.ABACMW)
		}

		// Document full-text search (CAP-169/182/183). Search is read; extracted-text
		// indexing is an edit.
		if deps.DocumentSearch != nil {
			crossRead.Post("/documents/search", deps.DocumentSearch.Search)
			crossRead.Get("/documents/search", deps.DocumentSearch.Search)
			crossEdit.Post("/documents/{id}/extracted-text", deps.DocumentSearch.IndexText)
		}

		// Attachment policies (CAP-165..170). Static /evaluate precedes /{id}.
		//
		// F10: this admin surface is a CATALOG-class config surface owned by the System
		// Administrator (legal-system-admin) persona, which holds lex:catalog:manage but
		// NONE of lex:view/add/edit/close/read/write — so on the shared cross-cutting
		// tiers above it was 403'd from its own surface (a DIFFERENT slug pair than the
		// coarse read/write groups). Gate reads on catalog:view (plus the cross-cutting
		// lex:view/lex:read fallbacks) and writes on catalog:manage (plus the cross-cutting
		// add/edit/close + lex:write fallbacks), mirroring the 8c7b3ba9 integration fix.
		// ADM's catalog:manage expands to catalog:view via expandGrants, so it passes the
		// reads too; every existing lex:view/add/edit/close/read/write role keeps access.
		if deps.AttachmentPolicy != nil {
			apRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogView, auth.PermLexView, auth.PermLexRead))
			apAdd := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexAdd, auth.PermLexWrite))
			apEdit := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexEdit, auth.PermLexWrite))
			apClose := r.With(sharedmw.RequireAnyPermission(auth.PermLexCatalogManage, auth.PermLexClose, auth.PermLexWrite))
			if deps.ABACMW != nil {
				apRead = apRead.With(deps.ABACMW)
				apAdd = apAdd.With(deps.ABACMW)
				apEdit = apEdit.With(deps.ABACMW)
				apClose = apClose.With(deps.ABACMW)
			}
			apRead.Get("/attachment-policies", deps.AttachmentPolicy.List)
			apRead.Post("/attachment-policies/evaluate", deps.AttachmentPolicy.Evaluate)
			apAdd.Post("/attachment-policies", deps.AttachmentPolicy.Create)
			apRead.Get("/attachment-policies/{id}", deps.AttachmentPolicy.Get)
			apEdit.Put("/attachment-policies/{id}", deps.AttachmentPolicy.Update)
			apClose.Delete("/attachment-policies/{id}", deps.AttachmentPolicy.Delete)
		}

		// Integration registry (CAP-174..178). Static /health precedes /{id}; the
		// per-endpoint /{id}/health precedes the bare /{id}.
		if deps.Integration != nil {
			// Integration Platform connector-framework surfaces gate on the granular
			// lex:integration:read / lex:integration:manage verbs, with the existing
			// coarse cross-cutting lex:read / lex:write as RequireAnyPermission
			// fallbacks so lex:* / admin:* roles keep working unchanged.
			integrationRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexIntegrationRead, auth.PermLexRead))
			integrationManage := r.With(sharedmw.RequireAnyPermission(auth.PermLexIntegrationManage, auth.PermLexWrite))
			if deps.ABACMW != nil {
				integrationRead = integrationRead.With(deps.ABACMW)
				integrationManage = integrationManage.With(deps.ABACMW)
			}

			integrationRead.Get("/integrations/health", deps.Integration.HealthAll)
			// Static /schema/{kind} must register before the /{id} routes so "schema"
			// is not swallowed as an {id} param.
			integrationRead.Get("/integrations/schema/{kind}", deps.Integration.Schema)
			// Feature 7: static connector catalog. MUST register before the /{id}
			// routes (same ordering rule as /schema/{kind} and /health) so "catalog"
			// is not captured as an {id} param. Tenant-agnostic, secret-free, read tier.
			integrationRead.Get("/integrations/catalog", deps.Integration.Catalog)
			// Bare CRUD sits on the SAME granular tiers as the rest of the connector
			// framework (§13: integrations = lex:integration:read / :manage, coarse
			// lex:read / lex:write kept as fallbacks). The config-only System
			// Administrator holds lex:integration:manage but NO coarse lex:read /
			// lex:write / lex:view — on the old crossRead/crossAdd/crossEdit/crossClose
			// tiers the persona §13 designates to operate connectors could rotate
			// secrets yet was 403'd from list/create/update/delete.
			integrationRead.Get("/integrations", deps.Integration.List)
			integrationManage.Post("/integrations", deps.Integration.Create)
			integrationRead.Get("/integrations/{id}/health", deps.Integration.Health)
			// Connector-framework verbs (test/sync) and the sync-runs ledger. The
			// /{id}/<verb> paths register ahead of the bare /{id}, mirroring /health.
			integrationManage.Post("/integrations/{id}/test", deps.Integration.Test)
			integrationManage.Post("/integrations/{id}/sync", deps.Integration.Sync)
			// Phase-2 action connectors (najiz add_representative/issue_wakala, esign
			// dispatch_envelope, e-archive archive/apply_legal_hold/dispose, internal
			// notify/post, email send, nafath request/status/details) are reachable
			// through the generic Invoker passthrough. The registry type-asserts the
			// integration.Invoker capability and returns a clean 422 for kinds that do
			// not implement it.
			integrationManage.Post("/integrations/{id}/invoke", deps.Integration.Invoke)
			integrationRead.Get("/integrations/{id}/sync-runs", deps.Integration.SyncRuns)
			// Integration-console UX features (round B). All /{id}/<verb> paths register
			// ahead of the bare /{id} below, mirroring test/sync/invoke. The existing
			// /{id}/sync route additionally honors ?mode=preview (dry-run) inside the
			// handler — no separate route is needed.
			// Feature 3: read-only source-vs-lex reconciliation compare (never mutates).
			integrationRead.Get("/integrations/{id}/reconciliation", deps.Integration.Reconcile)
			// Feature 5: rotate ONE secret config field. The field key rides the path;
			// the new value is write-only in the body and never echoed.
			integrationManage.Post("/integrations/{id}/secrets/{field}/rotate", deps.Integration.RotateSecret)
			// Feature 8/1: dispatch a synthetic inbound webhook event to prove wiring.
			integrationManage.Post("/integrations/{id}/webhook-test", deps.Integration.WebhookTest)
			// Feature 9: run a connector op in sandbox/mock mode (no real upstream, no
			// mutation).
			integrationManage.Post("/integrations/{id}/sandbox", deps.Integration.Sandbox)
			// Feature 1/8: recent activity trail (sourced from the sync-run ledger).
			integrationRead.Get("/integrations/{id}/activity", deps.Integration.Activity)
			// Feature 6: health-check history for the uptime sparkline.
			integrationRead.Get("/integrations/{id}/health-history", deps.Integration.HealthHistory)
			// Inbound SCIM bearer-token issue/list for kind=hr endpoints. Issue mints a
			// raw token shown EXACTLY ONCE; list returns only non-secret metadata.
			if deps.SCIMToken != nil {
				integrationManage.Post("/integrations/{id}/scim-token", deps.SCIMToken.Issue)
				integrationRead.Get("/integrations/{id}/scim-tokens", deps.SCIMToken.List)
			}
			// Reliability features #11 (DLQ) + #12 (circuit-breaker controls). The
			// cross-tenant /integrations/dlq and the static /integrations/dlq/{dlqId}/...
			// prefix MUST register BEFORE the bare /integrations/{id} routes so "dlq" is
			// not captured as an {id} param (same ordering rule as /schema/{kind} and
			// /catalog). Reads gate read tier; replay + breaker reset gate manage.
			if deps.IntegrationResilience != nil {
				integrationRead.Get("/integrations/dlq", deps.IntegrationResilience.DLQListAll)
				integrationManage.Post("/integrations/dlq/{dlqId}/replay", deps.IntegrationResilience.DLQReplay)
				integrationRead.Get("/integrations/{id}/dlq", deps.IntegrationResilience.DLQList)
				integrationManage.Post("/integrations/{id}/dlq/replay-failed", deps.IntegrationResilience.DLQReplayFailed)
				integrationRead.Get("/integrations/{id}/breaker", deps.IntegrationResilience.BreakerGet)
				integrationManage.Post("/integrations/{id}/breaker/reset", deps.IntegrationResilience.BreakerReset)
			}
			// Governance features #13 (maker-checker pending changes) + #15 (data-
			// residency / field-egress policy). The static /integrations/pending-changes
			// list and the /integrations/changes/{changeId}/... approve/reject prefix MUST
			// register BEFORE the bare /integrations/{id} routes so "pending-changes" and
			// "changes" are not captured as an {id} param (same ordering rule as /dlq,
			// /schema/{kind} and /catalog). Reads gate read tier; propose/approve/reject +
			// egress-policy PUT gate manage. SoD (approver != requester) is enforced in the
			// service where configured.
			if deps.IntegrationGovernance != nil {
				integrationRead.Get("/integrations/pending-changes", deps.IntegrationGovernance.PendingChanges)
				integrationManage.Post("/integrations/changes/{changeId}/approve", deps.IntegrationGovernance.ApproveChange)
				integrationManage.Post("/integrations/changes/{changeId}/reject", deps.IntegrationGovernance.RejectChange)
				integrationManage.Post("/integrations/{id}/changes", deps.IntegrationGovernance.ProposeChange)
				integrationRead.Get("/integrations/{id}/egress-policy", deps.IntegrationGovernance.EgressPolicyGet)
				integrationManage.Put("/integrations/{id}/egress-policy", deps.IntegrationGovernance.EgressPolicyPut)
			}
			// Observability features #16 (per-connector metrics + SLOs) + #17 (inbound-
			// event inspector + replay). The static cross-tenant /integrations/metrics +
			// /integrations/events lists and the /integrations/events/{eventId}/replay
			// prefix MUST register BEFORE the bare /integrations/{id} routes so "metrics"
			// and "events" are not captured as an {id} param (same ordering rule as /dlq,
			// /pending-changes, /schema/{kind} and /catalog). Metrics + event lists gate
			// read tier; event replay gates manage.
			if deps.IntegrationObservability != nil {
				integrationRead.Get("/integrations/metrics", deps.IntegrationObservability.Overview)
				integrationRead.Get("/integrations/events", deps.IntegrationObservability.EventsAll)
				integrationManage.Post("/integrations/events/{eventId}/replay", deps.IntegrationObservability.EventReplay)
				integrationRead.Get("/integrations/{id}/metrics", deps.IntegrationObservability.Metrics)
				integrationRead.Get("/integrations/{id}/events", deps.IntegrationObservability.Events)
			}

			// EXTENSIBILITY #20: per-endpoint conflict queue + resolve. The static
			// /integrations/conflicts/{conflictId}/resolve prefix MUST register BEFORE
			// the bare /integrations/{id} routes so "conflicts" is not captured as an
			// {id} param (same ordering rule as /dlq, /metrics, /pending-changes). List
			// gates read; resolve gates manage. (#18 custom connector + #19 sync rules
			// ride the existing CRUD path; the #20 mass-change guard rides the existing
			// /integrations/{id}/sync handler via its ?force query flag.)
			if deps.IntegrationExtensibility != nil {
				integrationRead.Get("/integrations/{id}/conflicts", deps.IntegrationExtensibility.Conflicts)
				integrationManage.Post("/integrations/conflicts/{conflictId}/resolve", deps.IntegrationExtensibility.ResolveConflict)
			}
			integrationRead.Get("/integrations/{id}", deps.Integration.Get)
			integrationManage.Put("/integrations/{id}", deps.Integration.Update)
			integrationManage.Delete("/integrations/{id}", deps.Integration.Delete)
		}
	}
}
