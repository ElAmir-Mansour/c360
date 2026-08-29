package service

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// permissionVersion stamps the effective-permission contract returned to the
// client (Lex_Codebase_RBAC_Map.md §4 LexMeResponse.permission_version). Bump it
// when the authoritative permission map (auth.RolePermissions / expandGrants) or
// the capabilities-derivation rules below change in a way the frontend must
// invalidate its cache for.
const permissionVersion = "2026-07-26.v2"

// dashboardLanding is the §6 fallback landing for a caller with no legal role.
const dashboardLanding = "/dashboard"

// LEX_PERSONA_LANDING is the backend-side copy of the §6 post-login routing map.
// It is defined here (not trusted from the client) so /me and /persona return the
// authoritative landing for the active persona. Keys are the canonical hyphenated
// slugs of the 14 legal-affairs roles.
var LEX_PERSONA_LANDING = map[string]string{
	"legal-requester":     "/lex/service-desk",
	"legal-dept-manager":  "/lex/approvals/requests",
	"legal-bu-ceo":        "/lex/approvals/requests",
	"legal-ceo":           "/lex/executive",
	"legal-director":      "/lex/command-center",
	"legal-cases-manager": "/lex/cases/control",

	"legal-contracts-manager":    "/lex/contracts/control",
	"legal-case-supervisor":      "/lex/cases",
	"legal-contracts-supervisor": "/lex/contracts",
	"legal-officer":              "/lex/my-work",
	"legal-advisor":              "/lex/consultations",

	"legal-shared-services-manager": "/lex/oversight",
	"legal-auditor":                 "/lex/compliance",
	"legal-system-admin":            "/lex/admin",
}

// landingForRole returns the §6 persona landing for a legal role slug, or the
// suite home /lex when the slug is unknown (a defensive default; all 14 roles are
// mapped above).
func landingForRole(slug string) string {
	if l, ok := LEX_PERSONA_LANDING[normalizePersonaSlug(slug)]; ok {
		return l
	}
	return "/lex"
}

// normalizePersonaSlug canonicalizes a slug to the hyphenated form used by the
// landing map and LegalRoleSummary (the matrix slugs are hyphenated). It accepts
// either '-' or '_' separators (the JWT carries hyphenated slugs; some callers
// normalize to underscores).
func normalizePersonaSlug(slug string) string {
	return strings.ReplaceAll(strings.TrimSpace(slug), "_", "-")
}

// Access-state values for LexMeResponse.access_state (§4 resolution algorithm).
const (
	AccessStateReady          = "READY"
	AccessStateNoLexRole      = "NO_LEX_ROLE_ASSIGNED"
	legalRoleSlugPrefixHyphen = "legal-"
	legalRoleSlugPrefixUnders = "legal_"
)

// LegalRoleSummary mirrors the §4 LegalRoleSummary contract.
type LegalRoleSummary struct {
	Slug            string `json:"slug"`
	NameEN          string `json:"name_en"`
	NameAR          string `json:"name_ar"`
	Tier            string `json:"tier"`
	OrgUnit         string `json:"org_unit"`
	EscalationLevel int    `json:"escalation_level"`
}

// LexCapabilities is the §4 boolean capability map derived from the active role's
// effective permissions.
type LexCapabilities struct {
	CanRequest             bool `json:"can_request"`
	CanHandleCases         bool `json:"can_handle_cases"`
	CanHandleContracts     bool `json:"can_handle_contracts"`
	CanApproveRequests     bool `json:"can_approve_requests"`
	CanApproveCases        bool `json:"can_approve_cases"`
	CanApproveContracts    bool `json:"can_approve_contracts"`
	CanCloseMatters        bool `json:"can_close_matters"`
	CanAssignCases         bool `json:"can_assign_cases"`
	CanDistributeContracts bool `json:"can_distribute_contracts"`
	CanAudit               bool `json:"can_audit"`
	CanManageConfiguration bool `json:"can_manage_configuration"`
	CanManageRoles         bool `json:"can_manage_roles"`
	CanManageIntegrations  bool `json:"can_manage_integrations"`
}

// LexMeResponse is the §4 Effective Lex Session Contract returned by
// GET /api/v1/lex/me and POST /api/v1/lex/persona.
type LexMeResponse struct {
	TenantID string `json:"tenant_id"`
	UserID   string `json:"user_id"`

	ActiveLegalRole     *LegalRoleSummary  `json:"active_legal_role"`
	AvailableLegalRoles []LegalRoleSummary `json:"available_legal_roles"`

	EffectivePermissions []string `json:"effective_permissions"`
	PermissionVersion    string   `json:"permission_version"`

	PersonaLanding string `json:"persona_landing"`

	Capabilities LexCapabilities `json:"capabilities"`

	AccessState string `json:"access_state"`
}

// PersonaStore is the minimal persistence the persona service needs (satisfied by
// *repository.UserPersonaRepository). It records the caller's last-selected active
// persona per (tenant, user). Nil-safe at the call sites.
type PersonaStore interface {
	GetActiveRoleSlug(ctx context.Context, tenantID, userID uuid.UUID) (string, error)
	SetActiveRoleSlug(ctx context.Context, tenantID, userID uuid.UUID, roleSlug string) error
}

// PersonaImportRole is the persona view of one tenant role written by an
// activated Role-Matrix import (a CUSTOM role, or a baseline role the tenant
// reshaped). Active=false is a tombstone — a role the tenant deactivated.
type PersonaImportRole struct {
	Slug            string
	NameEN          string
	NameAR          string
	Tier            string
	OrgUnit         string
	EscalationLevel int
	Active          bool
}

// PersonaRoleReader surfaces the tenant's activated-import roles so the persona
// contract can offer CUSTOM roles (not in the 14 built-in defs) as switchable
// personas, and hide roles the tenant deactivated. Nil-safe: without a reader
// the contract resolves from the built-in defs exactly as before (the built-in
// Watheeq roles are unaffected either way). Satisfied by
// *RoleMatrixPersonaReader against the platform_core pool.
type PersonaRoleReader interface {
	ImportRoles(ctx context.Context, tenantID uuid.UUID, heldSlugs []string) ([]PersonaImportRole, error)
}

// PersonaService resolves the effective Lex session contract from the caller's
// JWT role slugs (§4 / §17.2) and persists the active-persona preference (§17.3).
//
// IMPORTANT (§17.4): this is a UX model, not a backend security boundary. The
// effective permissions returned here are computed by the SAME authoritative code
// map server authorization uses (auth.EffectivePermissions over the active role),
// but route authorization still evaluates the caller's assigned role slugs
// unchanged. Switching persona does not change what the backend allows.
type PersonaService struct {
	store  PersonaStore
	roles  PersonaRoleReader
	logger zerolog.Logger
}

func NewPersonaService(store PersonaStore, logger zerolog.Logger) *PersonaService {
	return &PersonaService{store: store, logger: logger}
}

// SetRoleReader wires the tenant import-role reader so custom imported roles are
// offered as personas (and deactivated roles hidden). Nil-tolerant; called at
// startup once the platform_core pool is available.
func (s *PersonaService) SetRoleReader(reader PersonaRoleReader) {
	if s != nil {
		s.roles = reader
	}
}

var errPersonaNotAvailable = errors.New("role_slug is not one of the caller's available legal roles")

// ErrPersonaNotAvailable is returned by SetPersona when the caller asks to switch
// to a legal role they do not hold.
func ErrPersonaNotAvailable() error { return errPersonaNotAvailable }

// isLegalRoleSlug reports whether a slug is a legal-affairs role (§4: slugs
// starting "legal-"). Accepts the underscore-normalized form too.
func isLegalRoleSlug(slug string) bool {
	s := strings.TrimSpace(slug)
	return strings.HasPrefix(s, legalRoleSlugPrefixHyphen) || strings.HasPrefix(s, legalRoleSlugPrefixUnders)
}

// summaryFor builds a LegalRoleSummary from the authoritative LegalAffairsRoleDefs
// (auth.LegalRoleDefBySlug). Returns nil for a non-legal-affairs slug.
func summaryFor(slug string) *LegalRoleSummary {
	def := auth.LegalRoleDefBySlug(slug)
	if def == nil {
		return nil
	}
	return &LegalRoleSummary{
		Slug:            def.Slug,
		NameEN:          def.NameEN,
		NameAR:          def.NameAR,
		Tier:            def.Tier,
		OrgUnit:         def.OrgUnit,
		EscalationLevel: def.EscalationLevel,
	}
}

// availableLegalRoles filters the caller's role slugs to the legal-affairs roles
// known to LegalAffairsRoleDefs, mapped to summaries and de-duplicated. The order
// is deterministic: the matrix-definition order in LegalAffairsRoleDefs.
func availableLegalRoles(roleSlugs []string) []LegalRoleSummary {
	held := make(map[string]struct{})
	for _, slug := range roleSlugs {
		if !isLegalRoleSlug(slug) {
			continue
		}
		if summaryFor(slug) == nil {
			continue // legal-prefixed but not a known matrix role
		}
		held[normalizePersonaSlug(slug)] = struct{}{}
	}
	out := make([]LegalRoleSummary, 0, len(held))
	for i := range auth.LegalAffairsRoleDefs {
		def := auth.LegalAffairsRoleDefs[i]
		if _, ok := held[normalizePersonaSlug(def.Slug)]; !ok {
			continue
		}
		out = append(out, LegalRoleSummary{
			Slug:            def.Slug,
			NameEN:          def.NameEN,
			NameAR:          def.NameAR,
			Tier:            def.Tier,
			OrgUnit:         def.OrgUnit,
			EscalationLevel: def.EscalationLevel,
		})
	}
	return out
}

// resolveAvailable is the tenant-aware persona roster: the built-in legal roles
// the caller holds, PLUS any active custom role an import granted them, MINUS
// any baseline role the tenant deactivated. Without a role reader (or on a read
// error) it degrades to the built-in defs — the built-in Watheeq roles are
// always offered, so a reader outage can never lock a baseline user out.
func (s *PersonaService) resolveAvailable(ctx context.Context, tenantID uuid.UUID, roleSlugs []string) []LegalRoleSummary {
	available := availableLegalRoles(roleSlugs)
	if s.roles == nil {
		return available
	}
	importRoles, err := s.roles.ImportRoles(ctx, tenantID, roleSlugs)
	if err != nil {
		s.logger.Warn().Err(err).Str("tenant_id", tenantID.String()).Msg("lex persona: import-role read failed; using built-in defs only")
		return available
	}

	// Index the current roster by normalized slug for merge/removal.
	index := make(map[string]int, len(available))
	for i := range available {
		index[normalizePersonaSlug(available[i].Slug)] = i
	}
	deactivated := make(map[string]bool)
	for _, ir := range importRoles {
		key := normalizePersonaSlug(ir.Slug)
		if !ir.Active {
			deactivated[key] = true
			continue
		}
		summary := LegalRoleSummary{
			Slug: ir.Slug, NameEN: ir.NameEN, NameAR: ir.NameAR,
			Tier: ir.Tier, OrgUnit: ir.OrgUnit, EscalationLevel: ir.EscalationLevel,
		}
		if i, ok := index[key]; ok {
			available[i] = summary // reshaped baseline: prefer the tenant's names/metadata
		} else {
			available = append(available, summary) // custom role
		}
	}
	if len(deactivated) == 0 {
		return available
	}
	filtered := available[:0]
	for _, r := range available {
		if deactivated[normalizePersonaSlug(r.Slug)] {
			continue
		}
		filtered = append(filtered, r)
	}
	return filtered
}

// selectActiveRole picks the active persona deterministically (§4
// selectActiveRole): the persisted last-selected role if it is still held,
// otherwise the first available role in matrix order. available must be non-empty.
func selectActiveRole(available []LegalRoleSummary, lastSelected string) LegalRoleSummary {
	if lastSelected != "" {
		want := normalizePersonaSlug(lastSelected)
		for _, r := range available {
			if normalizePersonaSlug(r.Slug) == want {
				return r
			}
		}
	}
	return available[0]
}

// capabilitiesFor derives the §4 boolean capability map from a set of effective
// permissions. Each flag is the disjunction the §4 matrix implies; the set is the
// expanded effective permissions of the ACTIVE role.
func capabilitiesFor(perms []string) LexCapabilities {
	has := func(p string) bool { return hasPerm(perms, p) }
	return LexCapabilities{
		CanRequest:          has(auth.PermLexRequestAdd),
		CanHandleCases:      has(auth.PermLexCaseAdd) || has(auth.PermLexCaseEdit),
		CanHandleContracts:  has(auth.PermLexContractAdd) || has(auth.PermLexContractEdit),
		CanApproveRequests:  has(auth.PermLexRequestApprove),
		CanApproveCases:     has(auth.PermLexCaseApprove),
		CanApproveContracts: has(auth.PermLexContractApprove),
		CanCloseMatters: has(auth.PermLexCaseClose) || has(auth.PermLexInvestigationClose) ||
			has(auth.PermLexSettlementClose) || has(auth.PermLexContractClose) ||
			has(auth.PermLexConsultationClose) || has(auth.PermLexRequestClose),
		CanAssignCases:         has(auth.PermLexCaseAssign),
		CanDistributeContracts: has(auth.PermLexContractDistribute),
		CanAudit:               has(auth.PermLexAuditRead),
		CanManageConfiguration: has(auth.PermLexCatalogManage) || has(auth.PermLexSLAManage) ||
			has(auth.PermLexEscalationManage) || has(auth.PermLexNotificationManage) ||
			has(auth.PermLexSecurityManage),
		CanManageRoles:        has(auth.PermLexRoleManage) || has(auth.PermLexRoleAssign),
		CanManageIntegrations: has(auth.PermLexIntegrationManage),
	}
}

func hasPerm(perms []string, want string) bool {
	for _, p := range perms {
		if p == want {
			return true
		}
	}
	return false
}

// Resolve builds the effective Lex session contract for the caller (§4). roleSlugs
// are the slugs from the JWT (auth.ClaimsFromContext -> Claims.Roles). When the
// caller holds no legal-affairs role it returns the NO_LEX_ROLE_ASSIGNED state with
// the /dashboard landing. The active role defaults to the persisted preference (if
// still held) else a deterministic primary-role pick.
func (s *PersonaService) Resolve(ctx context.Context, tenantID, userID uuid.UUID, roleSlugs []string) (*LexMeResponse, error) {
	available := s.resolveAvailable(ctx, tenantID, roleSlugs)
	resp := &LexMeResponse{
		TenantID:             tenantID.String(),
		UserID:               userID.String(),
		AvailableLegalRoles:  available,
		EffectivePermissions: []string{},
		PermissionVersion:    permissionVersion,
	}

	if len(available) == 0 {
		resp.ActiveLegalRole = nil
		resp.PersonaLanding = dashboardLanding
		resp.AccessState = AccessStateNoLexRole
		resp.Capabilities = LexCapabilities{}
		return resp, nil
	}

	lastSelected := ""
	if s.store != nil {
		if slug, err := s.store.GetActiveRoleSlug(ctx, tenantID, userID); err != nil {
			// A preference read failure must not fail the whole contract — fall
			// back to the deterministic primary pick.
			s.logger.Warn().Err(err).Str("user_id", userID.String()).Msg("lex persona: read preference failed; using primary role")
		} else {
			lastSelected = slug
		}
	}

	active := selectActiveRole(available, lastSelected)
	activeCopy := active
	resp.ActiveLegalRole = &activeCopy

	// Effective permissions are expanded by the SAME authoritative source server
	// authorization uses, over the ACTIVE role only (§4 / §17.2) — including the
	// tenant role-matrix overlay when one is active, so the UX layer and the
	// tenant-aware checkers can never disagree.
	perms := auth.EffectivePermissionsForTenant(ctx, tenantID.String(), []string{active.Slug})
	sort.Strings(perms)
	resp.EffectivePermissions = perms
	resp.PersonaLanding = landingForRole(active.Slug)
	resp.Capabilities = capabilitiesFor(perms)
	resp.AccessState = AccessStateReady
	return resp, nil
}

// SetPersona validates that roleSlug is one of the caller's available legal roles,
// persists it as the active persona, and returns the refreshed contract (§17.3). It
// returns ErrPersonaNotAvailable when the caller does not hold the requested role.
func (s *PersonaService) SetPersona(ctx context.Context, tenantID, userID uuid.UUID, roleSlugs []string, roleSlug string) (*LexMeResponse, error) {
	roleSlug = strings.TrimSpace(roleSlug)
	if roleSlug == "" {
		return nil, errPersonaNotAvailable
	}
	// Validate against the tenant-aware roster (built-in + active custom import
	// roles), so a custom persona can be selected and a built-in-prefix check no
	// longer excludes legitimately-imported roles.
	available := s.resolveAvailable(ctx, tenantID, roleSlugs)
	want := normalizePersonaSlug(roleSlug)
	var matched *LegalRoleSummary
	for i := range available {
		if normalizePersonaSlug(available[i].Slug) == want {
			matched = &available[i]
			break
		}
	}
	if matched == nil {
		return nil, errPersonaNotAvailable
	}
	if s.store != nil {
		if err := s.store.SetActiveRoleSlug(ctx, tenantID, userID, matched.Slug); err != nil {
			return nil, err
		}
	}
	return s.Resolve(ctx, tenantID, userID, roleSlugs)
}
