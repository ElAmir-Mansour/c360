package auth

import "strings"

// Permission constants follow the pattern "resource:action".
const (
	PermUserRead         = "user:read"
	PermUserWrite        = "user:write"
	PermUserDelete       = "user:delete"
	PermRoleRead         = "role:read"
	PermRoleWrite        = "role:write"
	PermTenantRead       = "tenant:read"
	PermTenantWrite      = "tenant:write"
	PermAuditRead        = "audit:read"
	PermCyberRead        = "cyber:read"
	PermCyberWrite       = "cyber:write"
	PermDataRead         = "data:read"
	PermDataWrite        = "data:write"
	PermDataPII          = "data:pii"
	PermDataConfidential = "data:confidential"
	PermDataRestricted   = "data:restricted"
	PermActaRead         = "acta:read"
	PermActaWrite        = "acta:write"
	PermLexRead          = "lex:read"
	PermLexWrite         = "lex:write"
	// Granular Lex approval-policy governance permissions (Feature 5). These
	// scope the workflow approval-policy surface (versions, audit, conflict
	// checks, templates) more finely than the coarse lex:read / lex:write:
	//   - lex:approval:read   gates all approval-policy reads.
	//   - lex:approval:write  gates create / update / template authoring /
	//                          conflict-check / instantiate.
	//   - lex:approval:admin  gates destructive & governance ops (archive/delete,
	//                          version restore, template delete).
	// The wildcard match in HasPermission routes admin:*, lex:* and lex:approval:*
	// without these being listed in every role, so super_admin (admin:*) and
	// tenant_admin (which carries explicit configuration grants below) keeps working.
	PermLexApprovalRead  = "lex:approval:read"
	PermLexApprovalWrite = "lex:approval:write"
	PermLexApprovalAdmin = "lex:approval:admin"
	// Phase 4 reporting permission (CAP-133..151). lex:report:read gates the
	// read-mostly legal-affairs analytics surface. It is ADDITIVE: reporting routes
	// are gated RequireAnyPermission(lex:report:read, lex:read), so existing
	// lex:read / lex:* / admin:* roles keep working with no migration.
	PermLexReportRead = "lex:report:read"
	// Named per-person workforce reporting is more sensitive than aggregate
	// reporting and is never implied by lex:read.
	PermLexWorkforceRead = "lex:workforce:read"
	// lex:ai:use gates the Lex legal AI assistant (LEX-LD-GAP-DESIGN §G4). It is
	// DELIBERATELY not granted to any role below and is NOT implied by lex:read:
	// an LLM surface that can summarise across legal domains needs its own
	// switch, so it ships off until product enables it per tenant (via the
	// role-matrix import or an explicit grant). The lex:* / admin:* wildcards
	// still match it, which is why the whole surface is additionally gated by
	// the LEX_AI_ENABLED deployment flag — a wildcard role cannot switch on a
	// feature the deployment has not mounted.
	PermLexAIUse = "lex:ai:use"
	// Internal support routed to named legal colleagues. Unlike the Service Desk
	// request domain, these permissions expose the internal legal roster and therefore
	// are never implied by a coarse lex:read/lex:write fallback at the routes.
	PermLexSupportView    = "lex:support:view"
	PermLexSupportCreate  = "lex:support:create"
	PermLexSupportRespond = "lex:support:respond"
	PermLexSupportOversee = "lex:support:oversee"
	// Phase 4 cross-cutting granular 5-verb RBAC (CAP-152). These refine the coarse
	// lex:read / lex:write for the attachment-policy / document-FTS / integration
	// surfaces. PURELY ADDITIVE and backward-compatible: every route is gated
	// RequireAnyPermission(granularVerb, coarseVerb), and the existing lex:* / admin:*
	// wildcards already prefix-match all five via HasPermission, so no role regresses.
	PermLexView    = "lex:view"
	PermLexAdd     = "lex:add"
	PermLexEdit    = "lex:edit"
	PermLexApprove = "lex:approve"
	PermLexClose   = "lex:close"
	// Integration Platform granular RBAC (Lex_Integration_Platform_Design.md §"New
	// API surface"). PURELY ADDITIVE: the connector-registry routes are gated
	// RequireAnyPermission(integrationVerb, coarseLexVerb), so existing lex:read /
	// lex:write / lex:* / admin:* roles keep working unchanged. lex:integration:read
	// gates schema/test-status/sync-runs reads; lex:integration:manage gates the
	// write-class configure/test/sync operations. Secrets are never read or returned
	// in cleartext through these surfaces (schema-aware masking in the service).
	PermLexIntegrationRead   = "lex:integration:read"
	PermLexIntegrationManage = "lex:integration:manage"

	// Legal System Role Matrix per-domain granular RBAC (Legal_Role_Matrix_Design.md
	// §2). These implement the BRD's V/A/E/P/C verbs (plus M=manage) on the
	// legal-affairs capability families for the 14 named legal roles. They are
	// PURELY ADDITIVE and BACKWARD-COMPATIBLE: every legal-affairs route is gated
	// RequireAnyPermission(lex:<domain>:<verb>, lex:write|lex:read), so the existing
	// coarse lex:read / lex:write / lex:* / admin:* roles keep working unchanged.
	// The HasPermission wildcard already routes lex:* (e.g. lex:case:*) without each
	// key being listed in every role.
	//
	// Verb mapping (matrix -> key): V->view, A->add, E->edit, P->approve, C->close,
	// M->manage. :approve / :close are the SoD control points; :manage gates config.
	//
	// Domain: request (intake/approvals/SLA-lifecycle/execution).
	PermLexRequestView    = "lex:request:view"
	PermLexRequestAdd     = "lex:request:add"
	PermLexRequestEdit    = "lex:request:edit"
	PermLexRequestApprove = "lex:request:approve"
	PermLexRequestClose   = "lex:request:close"
	// Domain: sla (SLA targets / calendar config — manage-class).
	PermLexSLAView   = "lex:sla:view"
	PermLexSLAManage = "lex:sla:manage"
	// Domain: escalation (escalation-matrix config + routing).
	PermLexEscalationView   = "lex:escalation:view"
	PermLexEscalationManage = "lex:escalation:manage"
	// Domain: case (litigation cases). assign is a RESTRICTED verb (work
	// allocation) the matrix treats as section-manager-only; it is its OWN
	// independent flag and is NOT implied by :edit (design v2 §2.1) — splitting
	// it keeps drafting (edit) and allocation (assign) independent.
	PermLexCaseView    = "lex:case:view"
	PermLexCaseAdd     = "lex:case:add"
	PermLexCaseEdit    = "lex:case:edit"
	PermLexCaseAssign  = "lex:case:assign"
	PermLexCaseApprove = "lex:case:approve"
	PermLexCaseClose   = "lex:case:close"
	// Domain: investigation (violation/misconduct studies).
	PermLexInvestigationView    = "lex:investigation:view"
	PermLexInvestigationAdd     = "lex:investigation:add"
	PermLexInvestigationEdit    = "lex:investigation:edit"
	PermLexInvestigationApprove = "lex:investigation:approve"
	PermLexInvestigationClose   = "lex:investigation:close"
	// Domain: settlement (settlements / ADR / reconciliation). The matrix grants
	// the Legal Officer Add on settlements (§3), so settlement carries a real
	// :add verb (independent flag) alongside view/edit/approve/close.
	PermLexSettlementView    = "lex:settlement:view"
	PermLexSettlementAdd     = "lex:settlement:add"
	PermLexSettlementEdit    = "lex:settlement:edit"
	PermLexSettlementApprove = "lex:settlement:approve"
	PermLexSettlementClose   = "lex:settlement:close"
	// Domain: contract (contract review/sign-off/archive). distribute is a
	// RESTRICTED verb (contract work allocation) the matrix treats as
	// supervisor/manager-only; it is its OWN independent flag and is NOT implied
	// by :edit (design v2 §2.1).
	PermLexContractView       = "lex:contract:view"
	PermLexContractAdd        = "lex:contract:add"
	PermLexContractEdit       = "lex:contract:edit"
	PermLexContractDistribute = "lex:contract:distribute"
	PermLexContractApprove    = "lex:contract:approve"
	PermLexContractClose      = "lex:contract:close"
	// Domain: consultation (legal consultations).
	PermLexConsultationView    = "lex:consultation:view"
	PermLexConsultationAdd     = "lex:consultation:add"
	PermLexConsultationEdit    = "lex:consultation:edit"
	PermLexConsultationApprove = "lex:consultation:approve"
	PermLexConsultationClose   = "lex:consultation:close"
	// Domain: document (attachments / document management).
	PermLexDocumentView = "lex:document:view"
	PermLexDocumentAdd  = "lex:document:add"
	PermLexDocumentEdit = "lex:document:edit"
	// Domain: notification (notification config & receive).
	PermLexNotificationView   = "lex:notification:view"
	PermLexNotificationEdit   = "lex:notification:edit"
	PermLexNotificationManage = "lex:notification:manage"
	// Domain: catalog (service-catalog management).
	PermLexCatalogView   = "lex:catalog:view"
	PermLexCatalogManage = "lex:catalog:manage"
	// Domain: role (users/roles/permissions administration). assign is split from
	// manage (design v2 §4.3): role:assign grants ASSIGNING a system role to a
	// user; role:manage grants editing custom-role permission sets (constrained
	// by anti-escalation downstream). Splitting them lets the System Administrator
	// hand out roles without the blanket authority to rewrite role permission sets.
	PermLexRoleView   = "lex:role:view"
	PermLexRoleAssign = "lex:role:assign"
	PermLexRoleManage = "lex:role:manage"
	// Domain: audit (immutable audit log — READ-ONLY; no write/manage key ever
	// exists, SoD safeguard CAP-155/181).
	PermLexAuditRead = "lex:audit:read"
	// Domain: security (security & data-governance controls).
	PermLexSecurityView   = "lex:security:view"
	PermLexSecurityManage = "lex:security:manage"
	// Domain: reference (WatheeqTech reference library — the GLOBAL, read-only
	// Saudi legal corpus). View-ONLY: there is no write/manage verb (the catalog is
	// provisioned out-of-band by the ingestion job, never through the API). Every
	// reference route is gated RequireAnyPermission(lex:reference:view, lex:read),
	// so the 13 legal roles that hold lex:read see it instantly and the config-only
	// legal-system-admin (which lacks lex:read) is granted lex:reference:view
	// explicitly in legal_roles.go. The HasPermission wildcard routes lex:* /
	// admin:* without this being listed in every role.
	PermLexReferenceView = "lex:reference:view"

	PermVisusRead     = "visus:read"
	PermVisusWrite    = "visus:write"
	PermVCISOLLMAdmin = "vciso:llm:admin"
	PermAdminAll      = "admin:*"

	// SIEM permissions (SIEM-01). The wildcard match logic in
	// HasPermission already routes admin:* and resource:* prefixes
	// without the constants below being mentioned in every role.
	PermSIEMRead             = "siem:read"
	PermSIEMWrite            = "siem:write"
	PermSIEMHunt             = "siem:hunt"
	PermSIEMRespond          = "siem:respond"
	PermSIEMContentAuthor    = "siem:content_author"
	PermSIEMComplianceAttest = "siem:compliance_attest"
	PermSIEMSupervisoryView  = "siem:supervisory_view"
	PermSIEMAdmin            = "siem:admin"

	// DataStream / ClarioDR permissions (DESIGN_DataStream_DR.md §9).
	// dr:failover is the gated, step-up action (initiate / approve / cancel a
	// failover or drill); the wildcard match in HasPermission routes admin:*
	// and dr:* without these being listed in every role.
	PermDRRead     = "dr:read"
	PermDRWrite    = "dr:write"
	PermDRAdmin    = "dr:admin"
	PermDRFailover = "dr:failover"

	// Clario Respond permissions. These gate the major-incident command center
	// independently from the licensing entitlement respond.major_incident.
	PermRespondRead       = "respond:incident:read"
	PermRespondDeclare    = "respond:incident:declare"
	PermRespondUpdate     = "respond:incident:update"
	PermRespondTransition = "respond:incident:transition"
	PermRespondSeverity   = "respond:incident:severity"
	PermRespondTimeline   = "respond:timeline:append"
	PermRespondAdmin      = "respond:admin"

	// Clario Migrate permissions. The license entitlement is
	// migrate.cloud_migration; these permissions govern program planning, CAB
	// approval, cutover execution, rollback authorization, connector management,
	// and evidence export inside the product.
	PermMigrateRead           = "migrate:read"
	PermMigratePlan           = "migrate:plan"
	PermMigrateApprove        = "migrate:approve"
	PermMigrateCutover        = "migrate:cutover"
	PermMigrateRollback       = "migrate:rollback"
	PermMigrateIntegrations   = "migrate:integrations"
	PermMigrateEvidenceExport = "migrate:evidence:export"
	PermMigrateAdmin          = "migrate:admin"

	// Workflow engine permissions. workflow:admin gates the definition
	// lifecycle (activate / publish / archive / delete / promote);
	// workflow:write gates authoring (create / update / clone) and instance
	// control (start / cancel / retry / suspend / resume); workflow:task gates
	// the human-task actions an assignee performs (claim / complete);
	// workflow:read gates all reads. The wildcard match in HasPermission routes
	// admin:* and workflow:* without these being listed in every role.
	PermWorkflowRead  = "workflow:read"
	PermWorkflowWrite = "workflow:write"
	PermWorkflowAdmin = "workflow:admin"
	PermWorkflowTask  = "workflow:task"
	// PermWorkflowIncident gates governed operator intervention on a workflow
	// incident: viewing incidents, requesting/approving a sensitive override, and
	// retry/skip/modify-variables actions on a parked (incident) step. It is a
	// distinct, elevated verb (separate from workflow:write instance control) so an
	// operator entrusted with incident triage can be granted it without full
	// authoring rights. The wildcard match in HasPermission routes admin:* and
	// workflow:* without this being listed in every role.
	PermWorkflowIncident = "workflow:incident"

	// Automation engine permissions (DESIGN_Workflow_Forms_Automation.md §9).
	// automation:write gates authoring (automation/runbook CRUD), manual invoke,
	// and replay; automation:read gates run history + execution-log + definition
	// reads; automation:approve gates the human approval-gate decision
	// (approve / reject). The inbound webhook route is token-authenticated and
	// carries no JWT, so it is NOT permission-gated here. The wildcard match in
	// HasPermission routes admin:* and automation:* without these being listed in
	// every role.
	PermAutomationRead    = "automation:read"
	PermAutomationWrite   = "automation:write"
	PermAutomationApprove = "automation:approve"

	// Platform admin console permissions (platform-admin-console.md §G.1).
	// admin:console gates the frontend /platform section + page shell; because
	// PermAdminAll ("admin:*") prefix-matches "admin:console", super_admin sees
	// the console immediately. The granular platform:* strings exist so the
	// API-level capabilities can later be delegated to a non-super operator role
	// without handing out full admin:*. The wildcard match in HasPermission
	// routes admin:* and platform:* without these being listed in every role.
	PermAdminConsole               = "admin:console"
	PermPlatformFleetRead          = "platform:fleet:read"          // fleet health + metrics rollup
	PermPlatformTenantsRead        = "platform:tenants:read"        // cross-tenant tenant + aggregates
	PermPlatformTenantsWrite       = "platform:tenants:write"       // provision/suspend/deprovision/reprovision/reactivate
	PermPlatformTenantsImpersonate = "platform:tenants:impersonate" // mint act-as token (high-sensitivity)
	PermPlatformSuitesRead         = "platform:suites:read"
	PermPlatformSuitesWrite        = "platform:suites:write"   // enable/disable suite per tenant (override)
	PermPlatformIdentityRead       = "platform:identity:read"  // cross-tenant user/session/key lookup
	PermPlatformIdentityWrite      = "platform:identity:write" // revoke session/key cross-tenant
	PermPlatformABACRead           = "platform:abac:read"
	PermPlatformABACWrite          = "platform:abac:write"
	PermPlatformGatewayRead        = "platform:gateway:read"  // routes, breaker, rate-limit read
	PermPlatformGatewayAdmin       = "platform:gateway:admin" // kill switch, breaker control, rate-limit write
	PermPlatformAIRead             = "platform:ai:read"       // fleet AI rollup

	// Pricing & Quoting permissions (pricing-console-design.md §5). The pricing
	// calculator + versioned config live in the license-service (PRICING is the
	// sibling of LICENSING). pricing:read gates the masked calculator + config
	// reads; pricing:write gates draft config authoring; pricing:admin gates the
	// governance transitions (publish/archive) AND — critically — the INTERNAL
	// margin view (internal_cost / gross_profit / realized_margin / guardrail),
	// which is served only to this verb by DTO-type selection, never by a client
	// flag. The wildcard match in HasPermission routes admin:* and pricing:*
	// without these being listed in every role, so super_admin (admin:*) gets
	// full pricing access — including the internal margin block — with zero DB
	// change. Grant the granular trio to a dedicated commercial/pricing operator
	// role when that role is defined.
	PermPricingRead  = "pricing:read"
	PermPricingWrite = "pricing:write"
	PermPricingAdmin = "pricing:admin"

	// Audit-route hardening permissions (platform-admin-console.md §G.3, G17).
	// Audit routes were previously JWT+TenantGuard only; these granular strings
	// gate the per-route hardening. audit:read (PermAuditRead, defined above) is
	// the single-tenant read; the additions below gate cross-tenant read, export,
	// chain integrity verification, and the destructive partition archive/delete.
	PermAuditReadAll         = "audit:read:all"         // cross-tenant audit query
	PermAuditExport          = "audit:export"           // export audit logs
	PermAuditIntegrityVerify = "audit:integrity:verify" // verify hash-chain integrity
	PermAuditPartitionAdmin  = "audit:partition:admin"  // archive / DELETE partitions

	// Notification control-plane permission. Own-notification reads/marks and a
	// user's own delivery preferences stay open to any authenticated user; this
	// verb gates the tenant-wide integrations/admin surface of the notification
	// service: webhook CRUD/test/rotate, webhook delivery-log inspection + retry,
	// the operational test-send, cross-channel delivery statistics, and the
	// bulk retry-failed action. The wildcard match in HasPermission routes
	// admin:* (super_admin) and notifications:* without this being listed in
	// every role.
	PermNotificationsManage = "notifications:manage"
)

// RolePermissions maps built-in roles to their permissions.
//
// SIEM-01 augments analyst/viewer/tenant_admin and adds the explicit
// supervisory permission to super_admin. super_admin retains
// PermAdminAll, which the wildcard short-circuit in HasPermission
// already maps to every siem:* check; the explicit
// PermSIEMSupervisoryView entry is preserved so the role's permission
// list documents the cross-tenant capability.
var RolePermissions = map[string][]string{
	"super_admin": {
		PermAdminAll, PermSIEMSupervisoryView,
		// Platform admin console (platform-admin-console.md §G.1). admin:* already
		// prefix-matches every string below; these are listed explicitly so the
		// role's permission set documents the granular cross-tenant capabilities
		// and so they can later be delegated to a non-super operator role verbatim.
		PermAdminConsole,
		PermPlatformFleetRead,
		PermPlatformTenantsRead, PermPlatformTenantsWrite, PermPlatformTenantsImpersonate,
		PermPlatformSuitesRead, PermPlatformSuitesWrite,
		PermPlatformIdentityRead, PermPlatformIdentityWrite,
		PermPlatformABACRead, PermPlatformABACWrite,
		PermPlatformGatewayRead, PermPlatformGatewayAdmin,
		PermPlatformAIRead,
		PermAuditRead, PermAuditReadAll, PermAuditExport,
		PermAuditIntegrityVerify, PermAuditPartitionAdmin,
		// Notification control plane (webhook + operational admin). admin:*
		// already prefix-matches notifications:manage; listed explicitly so the
		// role set documents the capability.
		PermNotificationsManage,
		// Pricing & Quoting (pricing-console-design.md §5). admin:* already
		// prefix-matches pricing:*; listed explicitly so the role set documents
		// the calculator + versioned-config governance capability (including the
		// internal margin view gated on pricing:admin).
		PermPricingRead, PermPricingWrite, PermPricingAdmin,
	},
	"tenant_admin": {
		// Keep the runtime authority for Tenant Admin in lock-step with the
		// tenant-admin role seeded in platform_core. IAM tokens intentionally
		// carry role slugs (not the JSONB permissions stored on roles), so an
		// omitted wildcard here becomes a real backend denial even when the UI
		// correctly shows the tenant-admin as having that capability.
		//
		// These are tenant-scoped suite permissions. They deliberately exclude
		// admin:* and platform:*: those grant platform control-plane / cross-tenant
		// authority and remain exclusive to super_admin.
		"tenant:*", "users:*", "roles:*", "apikeys:*",
		"cyber:*", "alerts:*", "remediation:*",
		"data:*", "quality:*", "lineage:*", "pipelines:*", "dspm:*",
		"acta:*", "visus:*", "dr:*", "bcm:*", "siem:*",
		"reports:*", "files:*", "workflow:*", "workflows:*",
		"automation:*", "respond:*", "migrate:*", "notifications:*",
		PermUserRead, PermUserWrite, PermUserDelete,
		PermRoleRead, PermRoleWrite,
		PermTenantRead, PermTenantWrite,
		// PermAuditPartitionAdmin (and the already-present PermAuditRead) keep the
		// existing tenant /admin/audit flows working after the audit-service route
		// hardening (§G.3) gates partition archive/delete on audit:partition:admin.
		PermAuditRead, PermAuditPartitionAdmin,
		PermCyberRead, PermCyberWrite,
		PermDataRead, PermDataWrite, PermDataPII, PermDataConfidential, PermDataRestricted,
		PermActaRead, PermActaWrite,
		PermLexRead, PermLexWrite,
		PermLexApprovalRead, PermLexApprovalWrite, PermLexApprovalAdmin,
		// Phase 4 additive lex verbs (reporting + cross-cutting 5-verb). tenant_admin
		// already carries lex:read/lex:write which the route fallbacks honour; these
		// are listed explicitly so the role set documents the granular capabilities.
		PermLexReportRead,
		PermLexView, PermLexAdd, PermLexEdit,
		// Integration Platform: tenant_admin already carries lex:write which the
		// route fallbacks honour; list both integration verbs explicitly so the role
		// set documents the configure/test/sync capability.
		PermLexIntegrationRead, PermLexIntegrationManage,
		// Tenant administration covers Watheeq configuration, not legal business
		// decisions. Do not add lex:* or per-domain approve/close/assign/distribute
		// grants here: those belong to the legal role matrix and its SoD controls.
		PermLexSLAManage, PermLexEscalationManage,
		PermLexNotificationManage, PermLexCatalogManage,
		PermLexRoleAssign, PermLexRoleManage,
		PermLexAuditRead, PermLexSecurityManage, PermLexReferenceView,
		PermVisusRead, PermVisusWrite,
		PermVCISOLLMAdmin,
		PermSIEMRead, PermSIEMWrite, PermSIEMHunt, PermSIEMRespond,
		PermSIEMContentAuthor, PermSIEMComplianceAttest, PermSIEMAdmin,
		PermDRRead, PermDRWrite, PermDRAdmin, PermDRFailover,
		PermRespondRead, PermRespondDeclare, PermRespondUpdate,
		PermRespondTransition, PermRespondSeverity, PermRespondTimeline, PermRespondAdmin,
		PermMigrateRead, PermMigratePlan, PermMigrateApprove, PermMigrateCutover,
		PermMigrateRollback, PermMigrateIntegrations, PermMigrateEvidenceExport, PermMigrateAdmin,
		PermWorkflowRead, PermWorkflowWrite, PermWorkflowAdmin, PermWorkflowTask,
		PermWorkflowIncident,
		PermAutomationRead, PermAutomationWrite, PermAutomationApprove,
		// Notification control plane: tenant admins manage their tenant's
		// webhooks and operational notification actions.
		PermNotificationsManage,
	},
	"service:visus": {
		// Visus suite aggregation uses this service account token to read
		// dashboard payloads from the sibling suites. Keep it read-only.
		PermCyberRead, PermDataRead, PermActaRead, PermLexRead,
	},
	"analyst": {
		PermCyberRead, PermDataRead, PermActaRead, PermLexRead, PermVisusRead,
		PermLexApprovalRead,
		// Phase 4: read analytics + the granular read/approve verbs.
		PermLexReportRead, PermLexView, PermLexApprove,
		// Integration Platform: read-only access to schema/test-status/sync-runs.
		PermLexIntegrationRead,
		PermAuditRead,
		PermSIEMRead, PermSIEMHunt,
		PermDRRead,
		PermRespondRead,
		PermMigrateRead,
		PermWorkflowRead, PermWorkflowTask,
		PermAutomationRead, PermAutomationApprove,
	},
	"viewer": {
		PermCyberRead, PermDataRead, PermActaRead, PermLexRead, PermVisusRead,
		PermLexApprovalRead,
		// Phase 4: read-only analytics + granular view.
		PermLexReportRead, PermLexView,
		// Integration Platform: read-only access to schema/test-status/sync-runs.
		PermLexIntegrationRead,
		PermSIEMRead,
		PermDRRead,
		PermMigrateRead,
		PermWorkflowRead,
		PermAutomationRead,
	},
	// pricing_operator is the dedicated commercial/pricing operator role
	// (pricing-console-design.md §5): full pricing authority WITHOUT admin:*.
	// Holding pricing:admin unlocks config publish/archive AND the internal
	// margin view — so this role, unlike an ordinary read/write user, sees
	// cost/margin figures.
	"pricing_operator": {
		PermPricingRead, PermPricingWrite, PermPricingAdmin,
	},
	// pricing_analyst can run the calculator and author draft configs but is NOT
	// a pricing:admin: it can never see the internal margin block (the compute
	// route serves it the masked ClientTier) and cannot publish/archive.
	"pricing_analyst": {
		PermPricingRead, PermPricingWrite,
	},
	// watheeq_workflow_admin — a scoped operator confined to the Watheeq (Lex)
	// legal suite and the Workflow engine, and NOTHING else. lex:* and
	// workflow:*/workflows:* prefix-match every granular verb through
	// HasPermission's wildcard logic, so this role is full-access within those
	// two domains while granting no cyber/data/dr/acta/visus/siem/platform reach.
	// IAM tokens carry the DB role SLUG (watheeq-workflow-admin), which
	// normalizeRoleSlug folds to this key; the matching platform_core role row
	// carries the same permission list for the frontend nav union.
	"watheeq_workflow_admin": {
		"lex:*", "workflow:*", "workflows:*",
	},
}

// normalizeRoleSlug canonicalizes a role slug for RolePermissions lookups:
// hyphens become underscores so a JWT slug "legal-officer" matches the
// "legal_officer" map key (and vice-versa for code-map registration).
func normalizeRoleSlug(role string) string {
	return strings.ReplaceAll(role, "-", "_")
}

// lexDomainVerbs enumerates the verbs each lex:<domain> defines. It is the
// authority for two things in expandGrants:
//   - which verbs a lex:<domain>:* wildcard expands to;
//   - the per-domain :view (or :read) key an operational/manage verb implies.
//
// CRITICAL (design v2 §2/§4.1): verbs are INDEPENDENT flags. This table is only
// consulted to add the implied :view (or, for a wildcard, the full verb set of
// the SAME domain) — it never introduces cross-verb implication (no approve⇒edit,
// no close⇒approve). The audit domain deliberately has only "read" (no write key
// ever exists in the catalog).
var lexDomainVerbs = map[string][]string{
	"request":       {"view", "add", "edit", "approve", "close"},
	"case":          {"view", "add", "edit", "assign", "approve", "close"},
	"investigation": {"view", "add", "edit", "approve", "close"},
	"settlement":    {"view", "add", "edit", "approve", "close"},
	"contract":      {"view", "add", "edit", "distribute", "approve", "close"},
	"consultation":  {"view", "add", "edit", "approve", "close"},
	"document":      {"view", "add", "edit"},
	"report":        {"read"},
	"workforce":     {"read"},
	"support":       {"view", "create", "respond", "oversee"},
	"notification":  {"view", "edit", "manage"},
	"sla":           {"view", "manage"},
	"escalation":    {"view", "manage"},
	"catalog":       {"view", "manage"},
	"role":          {"view", "assign", "manage"},
	"audit":         {"read"},
	// integration is the one config domain whose read verb is "read", not "view"
	// (PermLexIntegrationRead = lex:integration:read — the key routes and roles
	// use). Listing "view" here made manage expand to a key nothing checks,
	// leaving the config-only System Administrator 403'd on integration reads.
	"integration": {"read", "manage"},
	"security":    {"view", "manage"},
	"reference":   {"view"},
}

// lexConfigDomains are the domains whose single elevated verb is :manage. Holding
// :manage on a config domain implies all of that domain's lower verbs (design v2
// §2/§4.1) — there is no separate add/edit/approve ladder there.
var lexConfigDomains = map[string]bool{
	"sla":          true,
	"escalation":   true,
	"catalog":      true,
	"notification": true,
	"role":         true,
	"integration":  true,
	"security":     true,
}

// lexOperationalVerbs are the verbs whose presence on a domain implies :view on
// that domain (design v2 §4.1). They never imply each other.
var lexOperationalVerbs = map[string]bool{
	"add":        true,
	"edit":       true,
	"approve":    true,
	"close":      true,
	"assign":     true,
	"distribute": true,
	"create":     true,
	"respond":    true,
	"oversee":    true,
}

// expandGrants implements the verb-implication rules of design v2 §4.1 as CODE,
// not as an implicit assumption in the checker. Given a role's raw permission
// set it returns the SAME set augmented with the (and ONLY the) keys these rules
// add:
//
//   - any operational verb {add,edit,approve,close,assign,distribute} on a
//     lex:<domain> ⇒ also lex:<domain>:view;
//   - lex:<config-domain>:manage (sla/escalation/catalog/notification/role/
//     integration/security) ⇒ every lower verb that domain defines (e.g. :view);
//   - lex:<domain>:* ⇒ every verb the domain defines.
//
// There is NO reverse or cross implication: approve does NOT add edit; close does
// NOT add approve. Non-lex keys, coarse lex:read/lex:write, and unknown domains
// pass through untouched. The result is a set (map) so HasPermission can match
// the implied keys without re-deriving them per check.
func expandGrants(perms []string) map[string]struct{} {
	out := make(map[string]struct{}, len(perms)*2)
	add := func(k string) { out[k] = struct{}{} }

	for _, p := range perms {
		add(p)

		// Only lex:<domain>:<verb> keys participate (exactly three segments,
		// "lex" prefix). Coarse "lex:read"/"lex:write" and the broad "lex:*"
		// wildcard are left to HasPermission's existing wildcard logic.
		parts := strings.Split(p, ":")
		if len(parts) != 3 || parts[0] != "lex" {
			continue
		}
		domain, verb := parts[1], parts[2]
		verbs, known := lexDomainVerbs[domain]
		if !known {
			continue
		}

		switch {
		case verb == "*":
			// Wildcard: every verb THIS domain defines (same-domain only).
			for _, v := range verbs {
				add("lex:" + domain + ":" + v)
			}
		case verb == "manage" && lexConfigDomains[domain]:
			// manage on a config domain ⇒ all lower verbs of that domain.
			for _, v := range verbs {
				add("lex:" + domain + ":" + v)
			}
		case lexOperationalVerbs[verb]:
			// Any operational verb ⇒ :view on the same domain (only if the
			// domain actually defines view; report/audit are read-only).
			for _, v := range verbs {
				if v == "view" {
					add("lex:" + domain + ":view")
					break
				}
			}
		}
	}
	return out
}

// HasPermission checks if any of the user's roles grant the required permission.
//
// Matching runs against the role's grants AFTER expandGrants (design v2 §4.1):
// the verb-implication rules are applied first so a holder of lex:sla:manage
// satisfies a literal lex:sla:view check, while a holder of lex:case:approve does
// NOT satisfy lex:case:edit (no reverse implication). The wildcard ("resource:*")
// and admin:* short-circuits are preserved unchanged.
func HasPermission(roles []string, required string) bool {
	for _, role := range roles {
		normalizedRole := normalizeRoleSlug(role)
		perms, ok := RolePermissions[normalizedRole]
		if !ok {
			continue
		}
		if permsSatisfy(perms, required) {
			return true
		}
	}
	return false
}

// permsSatisfy is the single matching pass shared by the code-map checker
// (HasPermission) and the tenant-overlay checker (HasPermissionForTenant):
// expandGrants first, then exact match, then the admin:* / "resource:*"
// wildcard short-circuits. Extracted so the two paths can NEVER drift.
func permsSatisfy(perms []string, required string) bool {
	expanded := expandGrants(perms)
	if _, ok := expanded[required]; ok {
		return true
	}
	for perm := range expanded {
		if perm == PermAdminAll {
			return true
		}
		// Check wildcard: "resource:*" matches "resource:read"
		if strings.HasSuffix(perm, ":*") {
			prefix := strings.TrimSuffix(perm, "*")
			if strings.HasPrefix(required, prefix) {
				return true
			}
		}
	}
	return false
}

// HasAnyPermission checks if any of the user's roles grant at least one of the required permissions.
func HasAnyPermission(roles []string, required ...string) bool {
	for _, perm := range required {
		if HasPermission(roles, perm) {
			return true
		}
	}
	return false
}

// HasAllPermissions checks if the user's roles grant all of the required permissions.
func HasAllPermissions(roles []string, required ...string) bool {
	for _, perm := range required {
		if !HasPermission(roles, perm) {
			return false
		}
	}
	return true
}
