package auth

import (
	"strings"
	"testing"
)

// roleDef looks up a legal role definition by slug.
func roleDef(t *testing.T, slug string) LegalRoleDef {
	t.Helper()
	for _, d := range LegalAffairsRoleDefs {
		if d.Slug == slug {
			return d
		}
	}
	t.Fatalf("legal role %q not defined", slug)
	return LegalRoleDef{}
}

// roleHas reports whether the role (by slug) is granted required, resolved
// through the same HasPermission path the middleware uses.
func roleHas(slug, required string) bool {
	return HasPermission([]string{slug}, required)
}

// TestAllFourteenRolesDefined asserts the matrix's 14 roles are present with the
// expected slugs and that each is registered into the enforcement code map.
func TestAllFourteenRolesDefined(t *testing.T) {
	if len(LegalAffairsRoleDefs) != 14 {
		t.Fatalf("expected 14 legal roles, got %d", len(LegalAffairsRoleDefs))
	}
	want := []string{
		"legal-requester", "legal-dept-manager", "legal-bu-ceo", "legal-ceo",
		"legal-director", "legal-cases-manager", "legal-contracts-manager",
		"legal-case-supervisor", "legal-contracts-supervisor", "legal-officer",
		"legal-advisor", "legal-shared-services-manager", "legal-auditor",
		"legal-system-admin",
	}
	seen := map[string]bool{}
	for _, d := range LegalAffairsRoleDefs {
		seen[d.Slug] = true
		if d.NameEN == "" || d.NameAR == "" {
			t.Errorf("role %q missing bilingual name (EN=%q AR=%q)", d.Slug, d.NameEN, d.NameAR)
		}
		if d.Tier == "" {
			t.Errorf("role %q missing tier metadata", d.Slug)
		}
		// Every role must resolve through the code map (normalized slug key).
		key := normalizeRoleSlug(d.Slug)
		if _, ok := RolePermissions[key]; !ok {
			t.Errorf("role %q (key %q) not registered into RolePermissions code map", d.Slug, key)
		}
		// And at least one of its permissions must actually resolve.
		if len(d.Permissions) > 0 && !roleHas(d.Slug, d.Permissions[0]) {
			t.Errorf("role %q does not enforce its own first permission %q via HasPermission", d.Slug, d.Permissions[0])
		}
	}
	for _, w := range want {
		if !seen[w] {
			t.Errorf("expected role %q to be defined", w)
		}
	}
}

func TestSupportResponseAndOversightStayInsideOperationalLegalRoles(t *testing.T) {
	operational := []string{
		"legal-director", "legal-cases-manager", "legal-contracts-manager",
		"legal-case-supervisor", "legal-contracts-supervisor", "legal-officer", "legal-advisor",
	}
	for _, slug := range operational {
		for _, permission := range []string{PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond} {
			if !roleHas(slug, permission) {
				t.Errorf("%s must hold %s", slug, permission)
			}
		}
	}
	for _, slug := range []string{"legal-director", "legal-cases-manager", "legal-contracts-manager", "legal-case-supervisor", "legal-contracts-supervisor"} {
		if !roleHas(slug, PermLexSupportOversee) {
			t.Errorf("%s must hold support oversee", slug)
		}
	}
	for _, permission := range []string{PermLexSupportView, PermLexSupportCreate} {
		if !roleHas("legal-requester", permission) {
			t.Errorf("legal-requester must hold %s for walkthrough support create/track", permission)
		}
	}
	for _, permission := range []string{PermLexSupportRespond, PermLexSupportOversee} {
		if roleHas("legal-requester", permission) {
			t.Errorf("legal-requester must not hold elevated support permission %s", permission)
		}
	}
	for _, slug := range []string{"legal-dept-manager", "legal-bu-ceo", "legal-ceo"} {
		for _, permission := range []string{PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee} {
			if roleHas(slug, permission) {
				t.Errorf("business-tier %s must not gain peer-support permission %s", slug, permission)
			}
		}
	}
}

// TestRequesterHasNoApproveAnywhere is the core SoD invariant: a Requester
// initiates but never approves. It must hold no :approve key on ANY domain.
func TestRequesterHasNoApproveAnywhere(t *testing.T) {
	d := roleDef(t, "legal-requester")
	for _, p := range d.Permissions {
		if strings.HasSuffix(p, ":approve") {
			t.Errorf("Requester must not hold an :approve permission, found %q", p)
		}
		if strings.HasSuffix(p, ":close") {
			t.Errorf("Requester must not hold a :close permission, found %q", p)
		}
	}
	// Resolved through HasPermission too (defends against a coarse fallback that
	// would smuggle approve in). Requester carries lex:read (not lex:write), so it
	// must be denied every domain :approve.
	for _, dom := range []string{
		PermLexCaseApprove, PermLexContractApprove, PermLexRequestApprove,
		PermLexInvestigationApprove, PermLexSettlementApprove, PermLexConsultationApprove,
		PermLexCaseClose, PermLexContractClose,
	} {
		if roleHas("legal-requester", dom) {
			t.Errorf("Requester must be DENIED %q but HasPermission allowed it", dom)
		}
	}
}

// TestAuditorIsViewOnly asserts the Auditor holds only view/read keys — no
// add/edit/approve/close/manage anywhere (SoD safeguard, CAP-155/181).
func TestAuditorIsViewOnly(t *testing.T) {
	d := roleDef(t, "legal-auditor")
	forbiddenSuffixes := []string{":add", ":edit", ":approve", ":close", ":manage", ":write"}
	for _, p := range d.Permissions {
		for _, suf := range forbiddenSuffixes {
			if strings.HasSuffix(p, suf) {
				t.Errorf("Auditor is view-only but holds a mutating permission %q", p)
			}
		}
	}
	// Must NOT carry coarse lex:write either.
	if roleHas("legal-auditor", PermLexWrite) {
		t.Error("Auditor must not hold the coarse lex:write")
	}
	// Positive: the auditor CAN read the audit log and view the core domains.
	for _, p := range []string{PermLexAuditRead, PermLexCaseView, PermLexContractView, PermLexReportRead} {
		if !roleHas("legal-auditor", p) {
			t.Errorf("Auditor should be able to %q", p)
		}
	}
	// Negative authz: cannot mutate a case or approve a contract.
	for _, p := range []string{PermLexCaseEdit, PermLexCaseAdd, PermLexContractApprove, PermLexCatalogManage} {
		if roleHas("legal-auditor", p) {
			t.Errorf("Auditor must be DENIED %q", p)
		}
	}
}

// TestAdminHasNoOperationalApproveOrClose asserts the System Administrator (ADM)
// is config-only: it may manage catalog/calendar/roles/integrations/security but
// holds NO case/contract approve or close authority.
func TestAdminHasNoOperationalApproveOrClose(t *testing.T) {
	d := roleDef(t, "legal-system-admin")
	for _, p := range d.Permissions {
		if strings.HasPrefix(p, "lex:case:") && (strings.HasSuffix(p, ":approve") || strings.HasSuffix(p, ":close")) {
			t.Errorf("ADM must not hold case approve/close, found %q", p)
		}
		if strings.HasPrefix(p, "lex:contract:") && (strings.HasSuffix(p, ":approve") || strings.HasSuffix(p, ":close")) {
			t.Errorf("ADM must not hold contract approve/close, found %q", p)
		}
	}
	// ADM must not carry coarse lex:write (which would smuggle case/contract verbs
	// in via the route fallback). It is config-only.
	if roleHas("legal-system-admin", PermLexWrite) {
		t.Error("ADM must not hold the coarse lex:write")
	}
	// Negative authz: denied case/contract approve+close.
	for _, p := range []string{
		PermLexCaseApprove, PermLexCaseClose, PermLexContractApprove, PermLexContractClose,
	} {
		if roleHas("legal-system-admin", p) {
			t.Errorf("ADM must be DENIED %q", p)
		}
	}
	// Positive: ADM holds the config-manage keys.
	for _, p := range []string{
		PermLexCatalogManage, PermLexSLAManage, PermLexEscalationManage,
		PermLexRoleManage, PermLexIntegrationManage, PermLexSecurityManage, PermLexNotificationManage,
	} {
		if !roleHas("legal-system-admin", p) {
			t.Errorf("ADM should hold %q", p)
		}
	}
}

// TestOfficerCannotApproveCase asserts a Legal Officer can add/edit a case but
// cannot approve or close it (officer drafts; supervisor/manager approve/close).
func TestOfficerCannotApproveCase(t *testing.T) {
	// Positive: officer can add + edit a case + investigation.
	for _, p := range []string{
		PermLexCaseAdd, PermLexCaseEdit, PermLexCaseView,
		PermLexInvestigationAdd, PermLexInvestigationEdit,
		PermLexConsultationView,
	} {
		if !roleHas("legal-officer", p) {
			t.Errorf("Legal Officer should hold %q", p)
		}
	}
	// SoD: officer holds NO approve/close/ASSIGN on case, investigation, contract.
	// case:assign is a restricted (section-manager-only) verb; v2 §2.1 splits it
	// from :edit precisely so granting the officer :edit (which they need) does
	// not smuggle in assignment.
	for _, p := range []string{
		PermLexCaseApprove, PermLexCaseClose, PermLexCaseAssign,
		PermLexInvestigationApprove, PermLexInvestigationClose,
		PermLexContractApprove, PermLexContractClose, PermLexContractDistribute,
		PermLexConsultationAdd, PermLexConsultationEdit, PermLexConsultationApprove, PermLexConsultationClose,
		PermLexSettlementApprove, PermLexSettlementClose,
	} {
		if roleHas("legal-officer", p) {
			t.Errorf("Legal Officer must be DENIED %q (SoD: officer drafts, manager approves/assigns)", p)
		}
	}
	// Defence-in-depth: NO :approve/:close/:assign suffix on ANY of the officer's
	// raw keys (proves the SoD does not rest on the coarse lex:write fallback).
	dOff := roleDef(t, "legal-officer")
	for _, p := range dOff.Permissions {
		if strings.HasSuffix(p, ":approve") || strings.HasSuffix(p, ":close") ||
			strings.HasSuffix(p, ":assign") || strings.HasSuffix(p, ":distribute") {
			t.Errorf("Legal Officer must hold no elevated verb, found %q", p)
		}
	}
	// The officer carries coarse lex:write; confirm the SoD relies on the lex:*
	// keys NOT containing approve — i.e. lex:case:approve is genuinely absent from
	// the officer's set (not merely shadowed). HasPermission for lex:write does not
	// grant lex:case:approve because lex:write is not a wildcard.
	d := roleDef(t, "legal-officer")
	for _, p := range d.Permissions {
		if p == PermLexCaseApprove || p == PermLexCaseClose {
			t.Errorf("Legal Officer permission set must not literally contain %q", p)
		}
	}
}

// TestSupervisorAndManagerCanApprove asserts the approve/close authority sits
// with supervisor/manager (the counterpart to the officer SoD test).
func TestSupervisorAndManagerCanApprove(t *testing.T) {
	if !roleHas("legal-case-supervisor", PermLexCaseApprove) {
		t.Error("Case Supervisor should be able to approve a case (first-tier)")
	}
	if !roleHas("legal-cases-manager", PermLexCaseApprove) || !roleHas("legal-cases-manager", PermLexCaseClose) {
		t.Error("Cases Section Manager should approve AND close cases")
	}
	if !roleHas("legal-contracts-manager", PermLexContractApprove) || !roleHas("legal-contracts-manager", PermLexContractClose) {
		t.Error("Contracts Section Manager should approve AND close contracts (final sign-off CAP-120)")
	}
	if !roleHas("legal-contracts-manager", PermLexConsultationEdit) || !roleHas("legal-contracts-manager", PermLexConsultationApprove) {
		t.Error("Contracts Section Manager should assign and approve consultations in the unified workspace")
	}
	if !roleHas("legal-director", PermLexCaseClose) || !roleHas("legal-director", PermLexCatalogManage) {
		t.Error("Legal Director should hold full operational + config authority")
	}
}

// TestNoLegalRoleHoldsAdminWildcard guards against a role accidentally being
// granted admin:* or a bare lex:* wildcard that would defeat least-privilege.
func TestNoLegalRoleHoldsAdminWildcard(t *testing.T) {
	for _, d := range LegalAffairsRoleDefs {
		for _, p := range d.Permissions {
			if p == PermAdminAll || p == "lex:*" {
				t.Errorf("role %q must not hold the broad wildcard %q", d.Slug, p)
			}
		}
	}
}

// TestSupervisorCannotCloseCase asserts the first-tier supervisor approves but
// does NOT close (closure authority concentrates at the section manager). v2 also
// asserts the supervisor holds NO case:assign (work allocation is manager-only).
func TestSupervisorCannotCloseCase(t *testing.T) {
	if roleHas("legal-case-supervisor", PermLexCaseClose) {
		t.Error("Case Supervisor must not hold lex:case:close (closure is section-manager authority)")
	}
	if roleHas("legal-case-supervisor", PermLexCaseAssign) {
		t.Error("Case Supervisor must not hold lex:case:assign (allocation is section-manager authority)")
	}
}

// TestBusinessTierOnlyApproveIsRequest is the v2 SoD invariant from §3/changelog
// #4: no business-tier role (requester, dept-manager, bu-ceo, ceo) holds a
// case/contract/consultation :approve — their ONLY approve is lex:request:approve
// (DOA). v1 inverted this by letting business managers approve legal work-product.
func TestBusinessTierOnlyApproveIsRequest(t *testing.T) {
	business := []string{"legal-requester", "legal-dept-manager", "legal-bu-ceo", "legal-ceo"}
	forbidden := []string{
		PermLexCaseApprove, PermLexContractApprove, PermLexConsultationApprove,
		PermLexInvestigationApprove, PermLexSettlementApprove,
		PermLexCaseClose, PermLexContractClose,
	}
	for _, slug := range business {
		d := roleDef(t, slug)
		// Raw set: the only :approve key permitted is request:approve.
		for _, p := range d.Permissions {
			if strings.HasSuffix(p, ":approve") && p != PermLexRequestApprove {
				t.Errorf("business role %q holds a non-request approve key %q", slug, p)
			}
			if strings.HasSuffix(p, ":close") {
				t.Errorf("business role %q must hold no :close key, found %q", slug, p)
			}
		}
		// Resolved through HasPermission (business roles carry only lex:read, so a
		// coarse fallback cannot smuggle approve in).
		for _, p := range forbidden {
			if roleHas(slug, p) {
				t.Errorf("business role %q must be DENIED %q (only approve is request:approve)", slug, p)
			}
		}
	}
	// dept-manager / bu-ceo / ceo DO hold the DOA request approve.
	for _, slug := range []string{"legal-dept-manager", "legal-bu-ceo", "legal-ceo"} {
		if !roleHas(slug, PermLexRequestApprove) {
			t.Errorf("business role %q should hold lex:request:approve (DOA)", slug)
		}
	}
}

// TestAdvisorRecommendsOnly asserts the Legal Advisor recommends but does not
// sign off (design v2 changelog #2): contract view/add/edit and consultation
// view/add/edit, but NO contract/consultation :approve, NO :distribute, NO
// :close. The v1 governance bundle (catalog/role/audit/integration/security view)
// is gone (changelog #3).
func TestAdvisorRecommendsOnly(t *testing.T) {
	// Positive: advisor can draft contracts and respond to consultations.
	for _, p := range []string{
		PermLexContractView, PermLexContractAdd, PermLexContractEdit,
		PermLexConsultationView, PermLexConsultationAdd, PermLexConsultationEdit,
	} {
		if !roleHas("legal-advisor", p) {
			t.Errorf("Legal Advisor should hold %q (recommends/responds)", p)
		}
	}
	// SoD: no approve on contract or consultation, no distribute, no close.
	for _, p := range []string{
		PermLexContractApprove, PermLexConsultationApprove,
		PermLexContractDistribute, PermLexContractClose, PermLexConsultationClose,
	} {
		if roleHas("legal-advisor", p) {
			t.Errorf("Legal Advisor must be DENIED %q (recommends only; manager signs off)", p)
		}
	}
	// Governance bundle stripped: LA is operational-only.
	d := roleDef(t, "legal-advisor")
	for _, p := range d.Permissions {
		switch p {
		case PermLexCatalogView, PermLexRoleView, PermLexAuditRead,
			PermLexIntegrationRead, PermLexSecurityView:
			t.Errorf("Legal Advisor must not carry the governance key %q (v2 strips the bundle)", p)
		}
	}
}

// TestNoLexAuditWriteVerbInCatalog asserts the SoD invariant of §3/§4.5: the
// audit domain has NO write verb anywhere — not in the permission catalog and
// not held by any of the 14 roles. The only audit key is lex:audit:read.
func TestNoLexAuditWriteVerbInCatalog(t *testing.T) {
	if _, ok := lexDomainVerbs["audit"]; !ok {
		t.Fatal("audit domain missing from lexDomainVerbs")
	}
	for _, v := range lexDomainVerbs["audit"] {
		if v != "read" {
			t.Errorf("audit domain must define only 'read', found verb %q", v)
		}
	}
	for _, d := range LegalAffairsRoleDefs {
		for _, p := range d.Permissions {
			if strings.HasPrefix(p, "lex:audit:") && p != PermLexAuditRead {
				t.Errorf("role %q holds a non-read audit key %q (no audit write verb ever)", d.Slug, p)
			}
		}
	}
	// And no expansion path mints one: lex:audit:read must not resolve any
	// audit write/manage key.
	RolePermissions["audit_write_probe_role"] = []string{PermLexAuditRead}
	defer delete(RolePermissions, "audit_write_probe_role")
	for _, probe := range []string{"lex:audit:write", "lex:audit:manage", "lex:audit:edit"} {
		if roleHas("audit_write_probe_role", probe) {
			t.Errorf("lex:audit:read must not resolve %q (audit is read-only)", probe)
		}
	}
}

// TestExpandGrantsForwardImplicationOnly proves both directions of the §4.1
// verb-implication contract — the property that prevents the v1 leak:
//   - manage on a config domain ⇒ satisfies that domain's :view (forward);
//   - an operational verb ⇒ satisfies :view on its domain (forward);
//   - approve does NOT satisfy edit, close does NOT satisfy approve (no reverse).
func TestExpandGrantsForwardImplicationOnly(t *testing.T) {
	// Forward: lex:sla:manage satisfies lex:sla:view.
	RolePermissions["expand_sla_probe"] = []string{PermLexSLAManage}
	defer delete(RolePermissions, "expand_sla_probe")
	if !roleHas("expand_sla_probe", PermLexSLAView) {
		t.Error("lex:sla:manage must satisfy lex:sla:view (manage⇒lower verbs on config domain)")
	}

	// Forward: an operational verb implies :view on the same domain.
	RolePermissions["expand_edit_probe"] = []string{PermLexCaseEdit}
	defer delete(RolePermissions, "expand_edit_probe")
	if !roleHas("expand_edit_probe", PermLexCaseView) {
		t.Error("lex:case:edit must satisfy lex:case:view (operational verb⇒view)")
	}

	// NO reverse: lex:case:approve must NOT satisfy lex:case:edit.
	RolePermissions["expand_approve_probe"] = []string{PermLexCaseApprove}
	defer delete(RolePermissions, "expand_approve_probe")
	if roleHas("expand_approve_probe", PermLexCaseEdit) {
		t.Error("lex:case:approve must NOT satisfy lex:case:edit (no reverse implication)")
	}
	// approve does still imply :view (forward), but nothing higher than view.
	if !roleHas("expand_approve_probe", PermLexCaseView) {
		t.Error("lex:case:approve should still satisfy lex:case:view (operational⇒view)")
	}
	if roleHas("expand_approve_probe", PermLexCaseClose) {
		t.Error("lex:case:approve must NOT satisfy lex:case:close (no cross implication)")
	}

	// NO cross: lex:case:close must NOT satisfy lex:case:approve.
	RolePermissions["expand_close_probe"] = []string{PermLexCaseClose}
	defer delete(RolePermissions, "expand_close_probe")
	if roleHas("expand_close_probe", PermLexCaseApprove) {
		t.Error("lex:case:close must NOT satisfy lex:case:approve (no cross implication)")
	}

	// Wildcard: lex:case:* expands to every verb the case domain defines,
	// including the restricted :assign — but stays within the case domain.
	RolePermissions["expand_wildcard_probe"] = []string{"lex:case:*"}
	defer delete(RolePermissions, "expand_wildcard_probe")
	for _, p := range []string{PermLexCaseView, PermLexCaseEdit, PermLexCaseAssign, PermLexCaseApprove, PermLexCaseClose} {
		if !roleHas("expand_wildcard_probe", p) {
			t.Errorf("lex:case:* must satisfy %q", p)
		}
	}
	if roleHas("expand_wildcard_probe", PermLexContractApprove) {
		t.Error("lex:case:* must NOT bleed into the contract domain")
	}
}

// TestRestrictedVerbsAreManagerScoped pins the v2 acceptance bullets (§7): the
// section managers hold the restricted allocation verbs; first-tier supervisors
// and drafting officers do not.
func TestRestrictedVerbsAreManagerScoped(t *testing.T) {
	// case:assign — Cases Section Manager (and Director) yes; officer/supervisor no.
	if !roleHas("legal-cases-manager", PermLexCaseAssign) {
		t.Error("Cases Section Manager should hold lex:case:assign")
	}
	if !roleHas("legal-director", PermLexCaseAssign) {
		t.Error("Legal Director should hold lex:case:assign (full operational)")
	}
	for _, slug := range []string{"legal-officer", "legal-case-supervisor"} {
		if roleHas(slug, PermLexCaseAssign) {
			t.Errorf("%q must not hold lex:case:assign", slug)
		}
	}
	// contract:distribute — Contracts Supervisor, Contracts Manager, Director yes.
	for _, slug := range []string{"legal-contracts-supervisor", "legal-contracts-manager", "legal-director"} {
		if !roleHas(slug, PermLexContractDistribute) {
			t.Errorf("%q should hold lex:contract:distribute", slug)
		}
	}
	// Contracts Supervisor distributes but does NOT approve or close.
	if roleHas("legal-contracts-supervisor", PermLexContractApprove) || roleHas("legal-contracts-supervisor", PermLexContractClose) {
		t.Error("Contracts Supervisor must distribute but NOT approve/close")
	}
	// Advisor (drafts contracts) holds no distribute.
	if roleHas("legal-advisor", PermLexContractDistribute) {
		t.Error("Legal Advisor must not hold lex:contract:distribute")
	}
}

// TestSystemAdminNoOperationalElevatedVerb extends the existing ADM test to the
// full set of operational elevated verbs (add/edit/approve/close/assign/
// distribute) across every legal domain — ADM is configuration, not authority.
func TestSystemAdminNoOperationalElevatedVerb(t *testing.T) {
	d := roleDef(t, "legal-system-admin")
	legalDomains := []string{"request", "case", "investigation", "settlement", "contract", "consultation", "document"}
	elevated := map[string]bool{"add": true, "edit": true, "approve": true, "close": true, "assign": true, "distribute": true}
	for _, p := range d.Permissions {
		parts := strings.Split(p, ":")
		if len(parts) != 3 || parts[0] != "lex" {
			continue
		}
		for _, dom := range legalDomains {
			if parts[1] == dom && elevated[parts[2]] {
				t.Errorf("ADM must hold no operational elevated verb, found %q", p)
			}
		}
	}
	// ADM does hold role:assign + role:manage (constrained downstream) and the
	// config-manage keys.
	for _, p := range []string{PermLexRoleAssign, PermLexRoleManage} {
		if !roleHas("legal-system-admin", p) {
			t.Errorf("ADM should hold %q", p)
		}
	}
}
