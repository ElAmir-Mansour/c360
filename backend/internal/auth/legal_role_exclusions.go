package auth

// Static Separation of Duties (SSD) for the Legal System Role Matrix
// (Legal_Role_Matrix_Design.md v2 §4.2 / changelog #7). A single user may not
// simultaneously hold two mutually-exclusive legal roles for the same org
// entity. This logic lives in internal/auth because it is consumed by BOTH the
// DB seeder (internal/lex/seeder, which seeds legal_role_exclusions and re-checks
// live assignments) AND the role-ASSIGNMENT path (internal/iam, which must reject
// a grant that pairs a conflicting role with one the user already holds). It
// depends only on auth.LegalAffairsRoleDefs and auth.PermLexWrite, so housing it
// here keeps the SoD pairs in lock-step with the matrix without IAM having to
// import a lex sub-package.

import (
	"fmt"
	"sort"
	"strings"
)

// LegalRoleExclusion is one mutually-exclusive-role pair: a single user may not
// hold both A and B for the same org entity. A and B are stored normalized
// (A < B) so the constraint is symmetric.
type LegalRoleExclusion struct {
	A      string
	B      string
	Reason string
}

const (
	legalSlugOfficer          = "legal-officer"
	legalSlugCasesManager     = "legal-cases-manager"
	legalSlugAdvisor          = "legal-advisor"
	legalSlugContractsManager = "legal-contracts-manager"
	legalSlugAuditor          = "legal-auditor"
)

// operationalLegalRoleSlugs returns every legal role that holds at least one
// mutating verb on a legal domain — i.e. a role that is NOT view/read/config
// only. This is the "any-operational" set the §4.2 rule {any-operational ⊥
// legal-auditor} expands against. Derived from LegalAffairsRoleDefs so the
// classification never drifts from the matrix.
//
// "Mutating verb" = add/edit/approve/close/assign/distribute on a lex:<domain>,
// or the coarse lex:write. view/read keys, config-only :manage keys
// (sla/escalation/catalog/notification/role/integration/security), and
// lex:role:assign do NOT make a role operational — an auditor/admin must stay
// excludable from the operational set so it lands on the auditor side of the
// SoD line.
func operationalLegalRoleSlugs() []string {
	mutating := map[string]struct{}{
		"add": {}, "edit": {}, "approve": {}, "close": {}, "assign": {}, "distribute": {},
	}
	legalDomains := map[string]struct{}{
		"request": {}, "case": {}, "investigation": {}, "settlement": {},
		"contract": {}, "consultation": {}, "document": {},
	}
	var out []string
	for _, d := range LegalAffairsRoleDefs {
		if d.Slug == legalSlugAuditor {
			continue // the auditor is the read-only counterparty, never operational
		}
		op := false
		for _, p := range d.Permissions {
			if p == PermLexWrite {
				op = true
				break
			}
			parts := strings.Split(p, ":")
			if len(parts) != 3 || parts[0] != "lex" {
				continue
			}
			if _, isLegal := legalDomains[parts[1]]; !isLegal {
				continue
			}
			if _, isMut := mutating[parts[2]]; isMut {
				op = true
				break
			}
		}
		if op {
			out = append(out, d.Slug)
		}
	}
	sort.Strings(out)
	return out
}

// LegalRoleExclusionPairs returns the SSD conflict pairs (design v2 §4.2):
//   - {legal-officer ⊥ legal-cases-manager}  (drafter vs. its own approver)
//   - {legal-advisor ⊥ legal-contracts-manager} (recommender vs. final sign-off)
//   - {any-operational ⊥ legal-auditor}  (no operator may also be the auditor)
//
// The "any-operational" rule is expanded to explicit pairs from
// operationalLegalRoleSlugs() so the seed table and the checker are concrete and
// the set tracks the matrix. Each pair is normalized so A < B.
func LegalRoleExclusionPairs() []LegalRoleExclusion {
	add := func(set map[string]LegalRoleExclusion, a, b, reason string) {
		if a == b {
			return
		}
		if a > b {
			a, b = b, a
		}
		key := a + "|" + b
		if _, ok := set[key]; !ok {
			set[key] = LegalRoleExclusion{A: a, B: b, Reason: reason}
		}
	}
	set := map[string]LegalRoleExclusion{}
	add(set, legalSlugOfficer, legalSlugCasesManager,
		"SoD: a case drafter (legal-officer) must not also be the section manager who approves/closes the same case (§4.2)")
	add(set, legalSlugAdvisor, legalSlugContractsManager,
		"SoD: a contract recommender (legal-advisor) must not also be the manager who gives final sign-off (§4.2)")
	for _, op := range operationalLegalRoleSlugs() {
		add(set, op, legalSlugAuditor,
			"SoD: an operational legal role must not also be the read-only auditor/compliance role (§4.2)")
	}

	out := make([]LegalRoleExclusion, 0, len(set))
	for _, v := range set {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].A != out[j].A {
			return out[i].A < out[j].A
		}
		return out[i].B < out[j].B
	})
	return out
}

// CheckRoleExclusion is the SSD guard the role-assignment path calls before
// granting a user a new role for an org entity. It rejects assigning `candidate`
// when the user already holds a role that conflicts with it (per §4.2). The
// caller supplies the slugs the user already holds for the SAME org entity; SSD
// is entity-scoped (a user may be an officer in one section and an auditor over
// a different entity is still a conflict only within the same scope — the caller
// owns scoping the `existing` set to the entity).
//
// It is order-independent and symmetric (matches the normalized pair table) and
// returns a descriptive error naming the conflicting pair, or nil when the
// assignment is allowed.
func CheckRoleExclusion(candidate string, existing []string) error {
	if candidate == "" || len(existing) == 0 {
		return nil
	}
	// Build a conflict lookup: for each pair, both directions map to the reason.
	conflicts := map[string]map[string]string{}
	for _, p := range LegalRoleExclusionPairs() {
		if conflicts[p.A] == nil {
			conflicts[p.A] = map[string]string{}
		}
		if conflicts[p.B] == nil {
			conflicts[p.B] = map[string]string{}
		}
		conflicts[p.A][p.B] = p.Reason
		conflicts[p.B][p.A] = p.Reason
	}
	against := conflicts[candidate]
	if against == nil {
		return nil
	}
	for _, held := range existing {
		if held == candidate {
			continue
		}
		if reason, bad := against[held]; bad {
			return fmt.Errorf("role %q conflicts with already-held role %q (SSD): %s", candidate, held, reason)
		}
	}
	return nil
}
