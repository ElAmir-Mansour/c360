package auth

import "sort"

// EffectivePermissions returns the deduped, expanded permission set granted by
// the given role slugs. It is the SAME expansion that server authorization uses:
// each slug is looked up in the authoritative code map (RolePermissions) and the
// EXISTING verb-implication rules (expandGrants) are applied — there is no fork of
// the expansion logic here.
//
// This helper is purely ADDITIVE and read-only. It exists so a client UX layer
// (the Lex persona contract, Lex_Codebase_RBAC_Map.md §4/§17.2) can be told the
// caller's effective permissions WITHOUT depending on stale roles.permissions
// display metadata from the database. It is NOT a new authorization path: route
// authorization continues to call HasPermission / RequirePermission unchanged, and
// the backend remains the sole authority (§17.4 — active persona is a UX model).
//
// Unknown slugs contribute nothing (they are absent from RolePermissions, exactly
// like HasPermission's lookup). Slug normalization ('-' -> '_') matches
// HasPermission so a JWT slug "legal-director" resolves the "legal_director" key.
// The result is sorted for a deterministic, stable response shape.
func EffectivePermissions(roleSlugs []string) []string {
	set := make(map[string]struct{})
	for _, role := range roleSlugs {
		normalized := normalizeRoleSlug(role)
		perms, ok := RolePermissions[normalized]
		if !ok {
			continue
		}
		// Reuse the EXACT expansion the checker uses (expandGrants); fold every
		// expanded key into the deduped set.
		for k := range expandGrants(perms) {
			set[k] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// LegalRoleDefBySlug returns the LegalRoleDef for the given slug (hyphen- or
// underscore-form), or nil if the slug is not one of the 14 legal-affairs roles.
// It reuses LegalAffairsRoleDefs (the single source of truth) so the persona
// contract does not duplicate role metadata.
func LegalRoleDefBySlug(slug string) *LegalRoleDef {
	normalized := normalizeRoleSlug(slug)
	for i := range LegalAffairsRoleDefs {
		if normalizeRoleSlug(LegalAffairsRoleDefs[i].Slug) == normalized {
			return &LegalAffairsRoleDefs[i]
		}
	}
	return nil
}
