package auth

// Legal System Role Matrix — the 14 named legal-affairs roles (Watheeq /
// Abdullah Al Othaim Investment Company). Transcribed EXACTLY from
// docs/ClarioWatheeq/Legal_Role_Matrix_Design.md §3, which is in turn the
// authoritative reading of "Legal System Role Matrix.xlsx" (14 roles · 6 verbs ·
// ~40 capabilities, with separation-of-duties).
//
// RESOLUTION NOTE (why these live here, in the code map):
// permission resolution in this platform is 100% code-map driven. The IAM
// service issues a JWT carrying only role SLUGS (auth_service.go: roles =
// user.RoleSlugs()); the `perms` JWT claim is never populated and never read.
// RequirePermission / RequireAnyPermission call HasPermission(user.Roles, perm),
// which looks each slug up in RolePermissions ONLY — it does not query the
// platform_core.roles.permissions JSONB. Therefore seeding the 14 roles into the
// database alone enforces NOTHING server-side; the roles' permissions must be
// present in this code map. The LegalAffairsRoleSeeder seeds the SAME definitions
// into platform_core.roles (for the role-management UI, org binding, and audit),
// and registerLegalAffairsRoles() (init below) folds them into RolePermissions so
// HasPermission actually honours them. The two stay in lock-step because both
// read LegalAffairsRoleDefs.

// LegalRoleDef is one row of the Legal System Role Matrix: its slug (used for the
// JWT role claim and the platform_core.roles.slug), bilingual display names, the
// org-hierarchy metadata persisted to roles.metadata, and the EXACT permission
// set from the matrix.
type LegalRoleDef struct {
	Slug        string
	NameEN      string
	NameAR      string
	Description string
	// Metadata carries the Role Roster fields persisted to roles.metadata JSONB.
	Tier            string // Business | Legal | Oversight | Admin
	ReportsTo       string // human-readable superior (org chart)
	OrgUnit         string // unit / section
	EscalationLevel int    // 0 = not an escalation recipient; 1/2/3 = L1/L2/L3
	Permissions     []string
}

// LegalAffairsRoleDefs is the single source of truth for the 14 roles. It feeds
// BOTH the code-map resolver (registerLegalAffairsRoles, below) and the DB seeder
// (internal/lex/seeder). Permission sets are transcribed from design v2 §3 with
// verbs as INDEPENDENT flags — nothing is rounded up to "highest authority per
// domain", which is the v1 leak v2 closes. SoD invariants (§3, §7) are asserted
// in legal_roles_test.go.
var LegalAffairsRoleDefs = []LegalRoleDef{
	{
		Slug: "legal-requester", NameEN: "Requester / Employee", NameAR: "الموظف / مقدّم الطلب",
		Description: "Base requester; raises only services they are eligible for.",
		Tier:        "Business", ReportsTo: "Line Manager", OrgUnit: "Requesting BU", EscalationLevel: 0,
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			// Business requesters may ask a named legal colleague for help and
			// track what they sent. They cannot accept, resolve, or oversee support.
			PermLexSupportView, PermLexSupportCreate,
			PermLexRequestView, PermLexRequestAdd, PermLexRequestEdit,
			PermLexContractView, PermLexContractAdd,
			PermLexConsultationView, PermLexConsultationAdd,
			PermLexDocumentView, PermLexDocumentAdd,
			PermLexReportRead,

			// Coarse fallback so own-scope reads/writes through the spine keep
			// working on view/add/edit routes (never on elevated verbs — the
			// routes agent strips the coarse fallback there).
			PermLexRead,
		},
	},
	{
		Slug: "legal-dept-manager", NameEN: "Department Manager (Requesting)", NameAR: "مدير الإدارة الطالبة",
		Description: "Requester-side approver (DOA); escalation Level-2 recipient.",
		Tier:        "Business", ReportsTo: "Business Unit CEO", OrgUnit: "Requesting BU", EscalationLevel: 2,
		// v2: business-tier's ONLY approve is request:approve (DOA). NO case or
		// consultation approve — those matrix "P"s are DOA request-level, not legal
		// work-product sign-off (design v2 changelog #4). case:add is initiate-only.
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexRequestView, PermLexRequestAdd, PermLexRequestEdit, PermLexRequestApprove,
			PermLexCaseView, PermLexCaseAdd,
			PermLexConsultationView, PermLexConsultationAdd,
			PermLexContractView, PermLexContractAdd, PermLexContractEdit,
			PermLexDocumentAdd,
			PermLexReportRead,
			PermLexRead,
		},
	},
	{
		Slug: "legal-bu-ceo", NameEN: "Business Unit CEO", NameAR: "الرئيس التنفيذي للقطاع",
		Description: "High-value requester-side approver per DOA matrix.",
		Tier:        "Business", ReportsTo: "CEO", OrgUnit: "Business Unit", EscalationLevel: 0,
		// v2: NO case:approve (business "P" maps to request:approve only).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexRequestView, PermLexRequestAdd, PermLexRequestEdit, PermLexRequestApprove,
			PermLexCaseView,
			PermLexContractView,
			PermLexDocumentView,
			PermLexReportRead, PermLexWorkforceRead,
			PermLexRead,
		},
	},
	{
		Slug: "legal-ceo", NameEN: "CEO / Executive Management", NameAR: "الرئيس التنفيذي للشركة",
		Description: "Issues directive to commence legal action; top DOA.",
		Tier:        "Business", ReportsTo: "Board", OrgUnit: "Executive", EscalationLevel: 0,
		// v2: NO case:approve. case:add is the "issues directive" initiate.
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexRequestView, PermLexRequestAdd, PermLexRequestEdit, PermLexRequestApprove,
			PermLexCaseView, PermLexCaseAdd,
			PermLexContractView,
			PermLexReportRead, PermLexWorkforceRead,
			PermLexRead,
		},
	},
	{
		Slug: "legal-director", NameEN: "Legal Director (Head of Legal)", NameAR: "مدير الإدارة القانونية",
		Description: "Owns service catalog; top legal authority & approver.",
		Tier:        "Legal", ReportsTo: "Shared Services Manager", OrgUnit: "Legal Department", EscalationLevel: 0,
		// Full operational authority incl. the restricted verbs case:assign and
		// contract:distribute (design v2 §3). role is VIEW only (management is ADM).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee,
			PermLexRequestView, PermLexRequestAdd, PermLexRequestEdit, PermLexRequestApprove, PermLexRequestClose,
			PermLexCaseView, PermLexCaseAdd, PermLexCaseEdit, PermLexCaseAssign, PermLexCaseApprove, PermLexCaseClose,
			PermLexInvestigationView, PermLexInvestigationAdd, PermLexInvestigationEdit, PermLexInvestigationApprove, PermLexInvestigationClose,
			PermLexSettlementView, PermLexSettlementAdd, PermLexSettlementEdit, PermLexSettlementApprove, PermLexSettlementClose,
			PermLexContractView, PermLexContractAdd, PermLexContractEdit, PermLexContractDistribute, PermLexContractApprove, PermLexContractClose,
			PermLexConsultationView, PermLexConsultationAdd, PermLexConsultationEdit, PermLexConsultationApprove, PermLexConsultationClose,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexNotificationEdit,
			PermLexReportRead, PermLexWorkforceRead,
			// Config-class manage rights the Director holds (design v2 §3).
			PermLexSLAManage, PermLexEscalationManage, PermLexCatalogManage,
			// role: VIEW only — management is the System Administrator's, not the
			// Director's (design v2 §3).
			PermLexRoleView,
			PermLexAuditRead, PermLexIntegrationRead, PermLexSecurityView,
			PermLexApprovalAdmin,
			// Coarse fallbacks: the Director is the top legal operator.
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-cases-manager", NameEN: "Cases & Investigations Section Manager", NameAR: "مدير قسم القضايا والتحقيقات",
		Description: "Runs cases/investigations; assigns work & approves outputs.",
		Tier:        "Legal", ReportsTo: "Legal Director", OrgUnit: "Legal Department", EscalationLevel: 0,
		// v2: holds the restricted case:assign verb (work allocation). Full
		// case/investigation/settlement approve+close authority (design v2 §3).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee,
			PermLexRequestView, PermLexRequestEdit, PermLexRequestApprove,
			PermLexCaseView, PermLexCaseAdd, PermLexCaseEdit, PermLexCaseAssign, PermLexCaseApprove, PermLexCaseClose,
			PermLexInvestigationView, PermLexInvestigationApprove, PermLexInvestigationClose,
			PermLexSettlementView, PermLexSettlementApprove, PermLexSettlementClose,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexReportRead,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-contracts-manager", NameEN: "Contracts Section Manager", NameAR: "مدير قسم العقود",
		Description: "Runs contract review; final contract sign-off (CAP-120).",
		Tier:        "Legal", ReportsTo: "Legal Director", OrgUnit: "Legal Department", EscalationLevel: 0,
		// v2: holds the restricted contract:distribute verb AND final sign-off
		// (approve+close, CAP-120) — design v2 §3.
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee,
			PermLexRequestView, PermLexRequestApprove,
			PermLexContractView, PermLexContractAdd, PermLexContractEdit, PermLexContractDistribute, PermLexContractApprove, PermLexContractClose,
			// The manager owns the unified Contracts & Consultations workspace:
			// view approved consultation intake, assign an advisor, approve the
			// response, and close the completed record.
			PermLexConsultationView, PermLexConsultationAdd, PermLexConsultationEdit, PermLexConsultationApprove, PermLexConsultationClose,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexReportRead,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-case-supervisor", NameEN: "Case Supervisor", NameAR: "مشرف القضايا",
		Description: "Follow-up & first-tier review; escalation Level-1 recipient.",
		Tier:        "Legal", ReportsTo: "Cases Section Manager", OrgUnit: "Cases Section", EscalationLevel: 1,
		// v2: case view/edit/approve (first-tier) but NO assign and NO close.
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee,
			PermLexRequestView, PermLexRequestApprove,
			PermLexCaseView, PermLexCaseEdit, PermLexCaseApprove,
			PermLexInvestigationView, PermLexInvestigationEdit,
			PermLexSettlementView, PermLexSettlementEdit,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-contracts-supervisor", NameEN: "Contracts Supervisor", NameAR: "مشرف العقود",
		Description: "Distributes & first-tier contract review.",
		Tier:        "Legal", ReportsTo: "Contracts Section Manager", OrgUnit: "Contracts Section", EscalationLevel: 0,
		// v2: contract view/add/edit + the restricted distribute verb, but NO
		// approve and NO close (design v2 §3).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee,
			PermLexRequestView, PermLexRequestApprove,
			PermLexContractView, PermLexContractAdd, PermLexContractEdit, PermLexContractDistribute,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-officer", NameEN: "Legal Officer / Handling Lawyer", NameAR: "الموظف المختص / المحامي",
		Description: "Direct handler: pleadings, memos, hearings, investigations, and consultation visibility.",
		Tier:        "Legal", ReportsTo: "Case Supervisor", OrgUnit: "Cases Section", EscalationLevel: 0,
		// v2: case view/add/edit but NO assign/approve/close (officer drafts;
		// supervisor/manager approve, manager assigns/closes). Design v2 §3.
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond,
			PermLexRequestView, PermLexRequestEdit,
			PermLexCaseView, PermLexCaseAdd, PermLexCaseEdit,
			PermLexInvestigationView, PermLexInvestigationAdd, PermLexInvestigationEdit,
			PermLexSettlementView, PermLexSettlementAdd, PermLexSettlementEdit,
			// Handling lawyers need consultation visibility from the shared
			// Contracts & Consultations menu, but response authoring/approval stays
			// with the Legal Advisor / Legal Director tiers.
			PermLexConsultationView,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-advisor", NameEN: "Legal Advisor / Consultant", NameAR: "المستشار القانوني",
		Description: "Reviews contracts & answers legal consultations.",
		Tier:        "Legal", ReportsTo: "Contracts Section Manager", OrgUnit: "Advisory / Contracts", EscalationLevel: 0,
		// v2: LA RECOMMENDS only — contract view/add/edit (NO approve, NO
		// distribute, NO close) and consultation view/add/edit (NO approve). The
		// v1 governance bundle (catalog/role/audit/integration/security view) is
		// STRIPPED — LA is operational-only (design v2 changelog #2,#3).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond,
			PermLexContractView, PermLexContractAdd, PermLexContractEdit,
			PermLexConsultationView, PermLexConsultationAdd, PermLexConsultationEdit,
			PermLexRequestView,
			PermLexDocumentView, PermLexDocumentAdd, PermLexDocumentEdit,
			PermLexReportRead,
			PermLexRead, PermLexWrite,
		},
	},
	{
		Slug: "legal-shared-services-manager", NameEN: "Shared Services Unit Manager", NameAR: "مدير وحدة الخدمات المشتركة",
		Description: "System-owner oversight; escalation Level-3 recipient.",
		Tier:        "Oversight", ReportsTo: "Executive", OrgUnit: "Shared Services", EscalationLevel: 3,
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexRequestView,
			PermLexCaseView,
			PermLexInvestigationView,
			PermLexSettlementView,
			PermLexContractView,
			PermLexConsultationView,
			PermLexSLAView, PermLexEscalationView,
			PermLexReportRead, PermLexAuditRead,
			PermLexRead,
		},
	},
	{
		Slug: "legal-auditor", NameEN: "Auditor / Compliance Officer", NameAR: "المدقق / مسؤول الالتزام",
		Description: "Read-only audit & compliance — SoD safeguard, no edit (CAP-155/181).",
		Tier:        "Oversight", ReportsTo: "Shared Services Manager", OrgUnit: "Governance", EscalationLevel: 0,
		// VIEW/READ ONLY everywhere. No add/edit/approve/close/assign/distribute/
		// manage key, and NO coarse lex:write — enforced by SoD test (design v2 §3).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexRequestView,
			PermLexCaseView,
			PermLexInvestigationView,
			PermLexSettlementView,
			PermLexContractView,
			PermLexConsultationView,
			PermLexDocumentView,
			PermLexReportRead, PermLexAuditRead,
			PermLexCatalogView, PermLexRoleView,
			PermLexIntegrationRead, PermLexSecurityView,
			PermLexRead,
		},
	},
	{
		Slug: "legal-system-admin", NameEN: "System Administrator", NameAR: "مسؤول النظام",
		Description: "Configures catalog, calendar, roles, integrations & security.",
		Tier:        "Admin", ReportsTo: "Shared Services Manager", OrgUnit: "IT / Shared Services", EscalationLevel: 0,
		// Config authority only + role:assign,manage (constrained downstream by
		// anti-escalation) + audit:read. NO legal-operational add/edit/approve/
		// close/assign/distribute (ADM is configuration, not case/contract
		// authority) and NO coarse lex:write. Enforced by SoD test (design v2 §3).
		Permissions: []string{
			PermLexAIUse, // AI assistant access — granted to every legal role.
			PermLexCatalogManage,
			PermLexSLAManage, PermLexEscalationManage,
			PermLexNotificationManage,
			PermLexRoleAssign, PermLexRoleManage,
			PermLexIntegrationManage,
			PermLexSecurityManage,
			PermLexAuditRead,
		},
	},
}

// registerLegalAffairsRoles folds the 14 legal-affairs role definitions into the
// RolePermissions code map so HasPermission (and therefore RequirePermission /
// RequireAnyPermission) enforce them. Keys are the slug normalized with '-' -> '_'
// to match HasPermission's normalization. This runs at package init so the
// resolver knows the roles regardless of whether the DB seeder has run.
// legalWorkflowAuthors are the roles that AUTHOR/run legal processes and
// additionally get workflow:write (instantiate templates; start/cancel/retry/
// suspend instances). Keys are NORMALIZED slugs ('-' -> '_', matching
// normalizeRoleSlug / HasPermission). The junior/requester roles keep
// read+task only — they participate in the flow but do not start or control
// process instances.
var legalWorkflowAuthors = map[string]bool{
	"legal_system_admin":         true,
	"legal_director":             true,
	"legal_cases_manager":        true,
	"legal_contracts_manager":    true,
	"legal_case_supervisor":      true,
	"legal_contracts_supervisor": true,
}

// legalAuditReaders are the roles that lead the function or own compliance and
// get tenant audit:read (the dashboard self-activity timeline + the audit
// views). Others keep only lex:audit:read (the Lex-scoped audit), so this is
// not a blanket grant.
var legalAuditReaders = map[string]bool{
	"legal_system_admin": true,
	"legal_director":     true,
	"legal_auditor":      true,
}

// ApplyLegalRoleBaselines appends the platform baselines every legal persona
// receives on top of its matrix grants, WITHOUT duplicating keys the grants
// already carry:
//   - workflow:read + workflow:task — the approval flow runs on the SHARED
//     workflow engine (Lex human tasks ARE workflow tasks); the inbox baseline
//     lets the "my tasks" badge resolve and an assignee action a task routed to
//     them (the engine still gates by assignment).
//   - lex:reference:view — the WatheeqTech Reference Library is visible to all
//     legal personas (a pure VIEW verb; cannot violate any SoD invariant).
//   - workflow:write for the authoring tier and tenant audit:read for the
//     oversight tier (legalWorkflowAuthors / legalAuditReaders above).
//
// SINGLE SOURCE for both resolution paths: registerLegalAffairsRoles folds
// these into the code map at init, and the tenant role-matrix overlay loader
// applies the SAME function to imported grants — so an imported matrix keeps
// the exact baseline semantics of the seeded one.
func ApplyLegalRoleBaselines(slug string, perms []string) []string {
	key := normalizeRoleSlug(slug)
	have := make(map[string]struct{}, len(perms)+5)
	out := make([]string, 0, len(perms)+5)
	add := func(keys ...string) {
		for _, k := range keys {
			if _, ok := have[k]; ok {
				continue
			}
			have[k] = struct{}{}
			out = append(out, k)
		}
	}
	add(perms...)
	add(PermWorkflowRead, PermWorkflowTask, PermLexReferenceView)
	if legalWorkflowAuthors[key] {
		add(PermWorkflowWrite)
	}
	if legalAuditReaders[key] {
		add(PermAuditRead)
	}
	return out
}

func registerLegalAffairsRoles() {
	// Baselines are folded in HERE rather than into the 14 LegalAffairsRoleDefs
	// so the SoD matrix defs and their invariant tests stay untouched; DB-seeded
	// role perms are display-only (enforcement is 100% code-map — see the
	// resolution note above). ApplyLegalRoleBaselines is the single source of the
	// fold-in for BOTH the code map and the tenant role-matrix overlay loader.
	for _, def := range LegalAffairsRoleDefs {
		key := normalizeRoleSlug(def.Slug)
		// Copy to avoid aliasing the def's backing array.
		perms := make([]string, len(def.Permissions))
		copy(perms, def.Permissions)
		RolePermissions[key] = ApplyLegalRoleBaselines(def.Slug, perms)
	}
}

func init() { registerLegalAffairsRoles() }
