package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// Pure planning/validation core for the tenant Role-Matrix Import
// (Lex_Role_Matrix_Import_Design.md §6–§7). DB-free by design: the service
// loads the tenant's current state, then this file computes validation issues,
// the diff, and the COMPLETE target snapshot. Unit tests exercise every gate
// without a database.

var roleMatrixSlugRe = regexp.MustCompile(`^[a-z][a-z0-9-]{1,63}$`)

// roleMatrixCurrentRole is the tenant's current state for one role slug —
// either an activated-import row (enforced), a seeded/manual DB row, or the
// code-map baseline definition materialized for slugs with no DB row.
type roleMatrixCurrentRole struct {
	Snapshot model.RoleMatrixRoleSnapshot
	// Enforced reports whether this state is what the checker enforces today
	// (activated import row, or a code-map baseline). Display-only manual rows
	// are not enforced.
	Enforced bool
}

// roleMatrixPlan is the full outcome of validating one import request.
type roleMatrixPlan struct {
	Errors     []model.RoleMatrixIssue
	Warnings   []model.RoleMatrixIssue
	Diff       model.RoleMatrixDiff
	Snapshot   []model.RoleMatrixRoleSnapshot // complete target state (valid only when len(Errors)==0)
	RoleCount  int
	GrantCount int
}

const roleMatrixMaxRoles = 200

// legalBaselineSlugs returns the 14 baseline slugs (the matrix's built-in scope).
func legalBaselineSlugs() []string {
	out := make([]string, 0, len(auth.LegalAffairsRoleDefs))
	for _, def := range auth.LegalAffairsRoleDefs {
		out = append(out, def.Slug)
	}
	return out
}

// legalBaselineDefs materializes the 14 code-map roles as current-state
// snapshots (the enforcement floor for tenants with no activated import).
func legalBaselineDefs() map[string]model.RoleMatrixRoleSnapshot {
	out := make(map[string]model.RoleMatrixRoleSnapshot, len(auth.LegalAffairsRoleDefs))
	for _, def := range auth.LegalAffairsRoleDefs {
		perms := append([]string(nil), def.Permissions...)
		sort.Strings(perms)
		out[def.Slug] = model.RoleMatrixRoleSnapshot{
			Slug:            def.Slug,
			NameEN:          def.NameEN,
			NameAR:          def.NameAR,
			Description:     def.Description,
			Tier:            def.Tier,
			OrgUnit:         def.OrgUnit,
			ReportsTo:       def.ReportsTo,
			EscalationLevel: def.EscalationLevel,
			IsSystem:        true,
			Active:          true,
			Permissions:     perms,
		}
	}
	return out
}

// roleMatrixImporter carries the identity context used by the §7.4
// self-escalation guard. HeldSlugs is the set of role slugs the importer is
// assigned (normalized to hyphen form); Has reports whether the importer
// EFFECTIVELY holds a permission today (tenant-aware, pre-import). A zero value
// (Has == nil) disables the guard — used by dry-run/unit paths without an actor.
type roleMatrixImporter struct {
	HeldSlugs map[string]bool
	Has       func(perm string) bool
}

// planRoleMatrixImport validates the request against the tenant's current state
// and produces the diff + complete target snapshot.
//
// current maps slug → current role state (imports + seeded rows + materialized
// baselines — the service composes it). The returned snapshot covers EVERY role
// the tenant will have after activation, so Activate applies snapshot-only.
func planRoleMatrixImport(
	req dto.RoleMatrixImportRequest,
	current map[string]roleMatrixCurrentRole,
	importer roleMatrixImporter,
) roleMatrixPlan {
	plan := roleMatrixPlan{}
	addErr := func(issue model.RoleMatrixIssue) { plan.Errors = append(plan.Errors, issue) }
	addWarn := func(issue model.RoleMatrixIssue) { plan.Warnings = append(plan.Warnings, issue) }

	if req.Mode != model.RoleMatrixModeMerge && req.Mode != model.RoleMatrixModeReplace {
		addErr(model.RoleMatrixIssue{Field: "mode", CodeKey: "invalid_mode", Message: "mode must be merge or replace"})
		return plan
	}
	if len(req.Grants) == 0 {
		addErr(model.RoleMatrixIssue{Field: "grants", CodeKey: "empty_matrix", Message: "the import contains no role grants"})
		return plan
	}
	if len(req.Grants) > roleMatrixMaxRoles || len(req.Roles) > roleMatrixMaxRoles {
		addErr(model.RoleMatrixIssue{Field: "grants", CodeKey: "row_limit", Message: "the import exceeds the maximum of 200 roles"})
		return plan
	}

	importable := make(map[string]struct{})
	for _, key := range auth.LexMatrixImportableKeys() {
		importable[key] = struct{}{}
	}
	autoGranted := make(map[string]struct{})
	for _, key := range auth.LexMatrixAutoGrantedKeys() {
		autoGranted[key] = struct{}{}
	}

	// Roster: payload roles indexed by slug (validated), duplicate detection.
	payloadRoles := make(map[string]dto.RoleMatrixImportRole, len(req.Roles))
	for _, role := range req.Roles {
		if !roleMatrixSlugRe.MatchString(role.Slug) {
			addErr(model.RoleMatrixIssue{RoleSlug: role.Slug, Field: "slug", CodeKey: "invalid_slug",
				Message: "role slug must be lowercase-kebab (2-64 chars, starting with a letter)"})
			continue
		}
		if auth.IsReservedRoleSlug(role.Slug) {
			addErr(model.RoleMatrixIssue{RoleSlug: role.Slug, Field: "slug", CodeKey: "reserved_role_slug",
				Message: "this slug is a platform role outside the legal matrix and cannot be imported"})
			continue
		}
		if _, dup := payloadRoles[role.Slug]; dup {
			addErr(model.RoleMatrixIssue{RoleSlug: role.Slug, Field: "slug", CodeKey: "duplicate_role",
				Message: "role slug appears more than once in the roster"})
			continue
		}
		payloadRoles[role.Slug] = role
	}

	// Every granted slug must resolve to a roster entry: payload role, or an
	// existing tenant/current role.
	grantSlugs := make([]string, 0, len(req.Grants))
	for slug := range req.Grants {
		grantSlugs = append(grantSlugs, slug)
	}
	sort.Strings(grantSlugs)

	// MERGE-MODE SAFETY: an EMPTY grant column means "no statement about this
	// role" (a blank template column must never strip a role); dropping every
	// grant intentionally is expressed via replace mode or an explicit
	// deactivation. In replace mode an empty column is a real strip and raises
	// a confirm-gated warning below.
	if req.Mode == model.RoleMatrixModeMerge {
		for _, slug := range grantSlugs {
			if len(req.Grants[slug]) == 0 {
				delete(req.Grants, slug)
			}
		}
		grantSlugs = grantSlugs[:0]
		for slug := range req.Grants {
			grantSlugs = append(grantSlugs, slug)
		}
		sort.Strings(grantSlugs)
		if len(req.Grants) == 0 {
			addErr(model.RoleMatrixIssue{Field: "grants", CodeKey: "empty_matrix",
				Message: "the import contains no role grants"})
			return plan
		}
	}

	for _, slug := range grantSlugs {
		if !roleMatrixSlugRe.MatchString(slug) {
			addErr(model.RoleMatrixIssue{RoleSlug: slug, Field: "slug", CodeKey: "invalid_slug",
				Message: "granted role slug must be lowercase-kebab"})
			continue
		}
		if auth.IsReservedRoleSlug(slug) {
			addErr(model.RoleMatrixIssue{RoleSlug: slug, Field: "slug", CodeKey: "reserved_role_slug",
				Message: "this slug is a platform role outside the legal matrix and cannot be imported"})
			continue
		}
		_, inPayload := payloadRoles[slug]
		_, inCurrent := current[slug]
		if !inPayload && !inCurrent {
			addErr(model.RoleMatrixIssue{RoleSlug: slug, Field: "roles", CodeKey: "unknown_role",
				Message: "granted role is neither in the roster nor an existing tenant role"})
		}
		if req.Mode == model.RoleMatrixModeReplace && len(req.Grants[slug]) == 0 {
			addWarn(model.RoleMatrixIssue{RoleSlug: slug, Field: "grants", CodeKey: "warning_role_stripped",
				Message: "this role would keep ZERO grants after the replace — confirm this is intended"})
		}
	}

	// Per-grant validation: catalog membership, auto-granted stripping, the
	// Auditor-archetype guard and the elevated-grant warnings.
	cleanGrants := make(map[string][]string, len(req.Grants))
	for _, slug := range grantSlugs {
		perms := req.Grants[slug]
		clean := make([]string, 0, len(perms))
		for _, perm := range perms {
			if _, isAuto := autoGranted[perm]; isAuto {
				continue // implicit for every role; ignore silently
			}
			if _, ok := importable[perm]; !ok {
				addErr(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "unknown_permission",
					Message: "permission is not in the importable catalog"})
				continue
			}
			clean = append(clean, perm)
		}
		sort.Strings(clean)
		cleanGrants[slug] = clean

		// Auditor archetype: the compliance safeguard role stays read-only.
		if slug == "legal-auditor" {
			for _, perm := range clean {
				if !auth.IsLexViewOnlyPermission(perm) {
					addErr(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "auditor_readonly_violation",
						Message: "the auditor role is a read-only SoD safeguard and cannot receive write/approve/manage grants"})
				}
			}
		}
		// Elevated grants demand explicit confirmation.
		for _, perm := range clean {
			switch perm {
			case auth.PermLexRoleManage, auth.PermLexRoleAssign:
				if slug != "legal-system-admin" {
					addWarn(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "warning_role_admin_grant",
						Message: "granting role administration to a non-system-admin role weakens the admin/legal SoD split"})
				}
			case auth.PermWorkflowWrite:
				if !legalWorkflowAuthorSlug(slug) {
					addWarn(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "warning_workflow_write_grant",
						Message: "workflow:write lets this role start/cancel process instances (baseline grants it to the authoring tier only)"})
				}
			case auth.PermAuditRead:
				if !legalAuditReaderSlug(slug) {
					addWarn(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "warning_audit_read_grant",
						Message: "tenant-wide audit:read exposes the cross-suite audit trail (baseline grants it to oversight roles only)"})
				}
			}
		}
	}

	// New roles must carry roster metadata (a name at minimum).
	for _, slug := range grantSlugs {
		if _, exists := current[slug]; exists {
			continue
		}
		role, ok := payloadRoles[slug]
		if !ok {
			continue // already reported unknown_role
		}
		if role.NameEN == "" && role.NameAR == "" {
			addErr(model.RoleMatrixIssue{RoleSlug: slug, Field: "name_en", CodeKey: "missing_name",
				Message: "a new custom role needs at least an English or Arabic name"})
		}
	}

	// Build the COMPLETE target snapshot.
	target := make(map[string]model.RoleMatrixRoleSnapshot)
	// Start from current state (merge keeps unmentioned roles; replace
	// deactivates them below).
	for slug, cur := range current {
		target[slug] = cur.Snapshot
	}
	// Apply payload roster metadata + grants.
	for _, slug := range grantSlugs {
		snap, exists := target[slug]
		if !exists {
			snap = model.RoleMatrixRoleSnapshot{Slug: slug, Active: true}
		}
		if role, ok := payloadRoles[slug]; ok {
			snap.Code = role.Code
			if role.NameEN != "" {
				snap.NameEN = role.NameEN
			}
			if role.NameAR != "" {
				snap.NameAR = role.NameAR
			}
			if role.Description != "" {
				snap.Description = role.Description
			}
			if role.Tier != "" {
				snap.Tier = role.Tier
			}
			if role.OrgUnit != "" {
				snap.OrgUnit = role.OrgUnit
			}
			if role.ReportsTo != "" {
				snap.ReportsTo = role.ReportsTo
			}
			if role.EscalationLevel != 0 {
				snap.EscalationLevel = role.EscalationLevel
			}
			snap.Active = role.IsActive()
			if !exists {
				snap.IsSystem = role.IsSystem
			}
		}
		snap.Permissions = cleanGrants[slug]
		if snap.NameEN == "" && snap.NameAR == "" {
			snap.NameEN = slug
		}
		target[slug] = snap
	}
	// Roster-only updates (metadata/active changes without a grants row keep the
	// role's current permissions).
	for slug, role := range payloadRoles {
		if _, granted := cleanGrants[slug]; granted {
			continue
		}
		snap, exists := target[slug]
		if !exists {
			// Roster entry with no grants and no current state: only meaningful
			// when explicitly inactive (parking); otherwise it is an empty role.
			snap = model.RoleMatrixRoleSnapshot{Slug: slug, NameEN: role.NameEN, NameAR: role.NameAR, Active: role.IsActive(), IsSystem: role.IsSystem}
		}
		snap.Active = role.IsActive()
		if role.Tier != "" {
			snap.Tier = role.Tier
		}
		target[slug] = snap
	}
	// Replace mode: any current role not mentioned anywhere is deactivated.
	if req.Mode == model.RoleMatrixModeReplace {
		for slug := range current {
			_, granted := cleanGrants[slug]
			_, rostered := payloadRoles[slug]
			if !granted && !rostered {
				snap := target[slug]
				snap.Active = false
				target[slug] = snap
			}
		}
	}

	// Every ACTIVE→INACTIVE transition is a real revocation (the enforcement
	// tombstone strips the role to nothing) — surface it as a confirm-gated
	// warning so an accidental omission in replace mode cannot slip through.
	for slug, snap := range target {
		if cur, exists := current[slug]; exists && cur.Snapshot.Active && !snap.Active {
			addWarn(model.RoleMatrixIssue{RoleSlug: slug, Field: "active", CodeKey: "warning_role_deactivated",
				Message: "this role will be DEACTIVATED: holders keep the role slug but it will grant nothing"})
		}
	}

	// Post-build catalog check (defence in depth): the final snapshot may only
	// carry importable keys, regardless of which path a permission arrived by
	// (payload grants are pre-validated; current-state rows are re-validated
	// here so a legacy row can never smuggle an out-of-catalog key into
	// enforcement).
	for slug, snap := range target {
		if !snap.Active {
			continue
		}
		for _, perm := range snap.Permissions {
			if _, ok := importable[perm]; !ok {
				addErr(model.RoleMatrixIssue{RoleSlug: slug, Permission: perm, CodeKey: "unknown_permission",
					Message: "the resulting matrix would carry a permission outside the importable catalog"})
			}
		}
	}

	// Lockout guard: the FINAL state must keep role administration reachable.
	lockoutOK := false
	for _, snap := range target {
		if !snap.Active {
			continue
		}
		for _, perm := range snap.Permissions {
			if perm == auth.PermLexRoleManage {
				lockoutOK = true
			}
		}
	}
	if !lockoutOK {
		addErr(model.RoleMatrixIssue{Field: "grants", CodeKey: "lockout_role_manage",
			Message: "at least one ACTIVE role must retain lex:role:manage or the tenant loses role administration"})
	}

	// Deterministic snapshot order: baseline definition order first, then
	// customs alphabetically — templates and diffs render stably.
	ordered := make([]model.RoleMatrixRoleSnapshot, 0, len(target))
	seen := make(map[string]struct{}, len(target))
	for _, def := range auth.LegalAffairsRoleDefs {
		if snap, ok := target[def.Slug]; ok {
			ordered = append(ordered, snap)
			seen[def.Slug] = struct{}{}
		}
	}
	rest := make([]string, 0, len(target))
	for slug := range target {
		if _, ok := seen[slug]; !ok {
			rest = append(rest, slug)
		}
	}
	sort.Strings(rest)
	for _, slug := range rest {
		ordered = append(ordered, target[slug])
	}
	plan.Snapshot = ordered

	// Diff vs the ENFORCED current state.
	plan.Diff = diffRoleMatrix(current, ordered)
	plan.RoleCount = len(ordered)
	for _, snap := range ordered {
		plan.GrantCount += len(snap.Permissions)
	}

	// §7.4 SELF-ESCALATION guard: an importer may not use an import to give a
	// role THEY THEMSELVES hold a permission they do not already EFFECTIVELY
	// hold — that would let a single actor bootstrap their own authority.
	// Configuring roles the importer does NOT hold stays allowed (that is the
	// feature; it is gated by four-eyes activation + the elevated-grant
	// warnings), so a config-only System Administrator can still build any
	// operational matrix — they just cannot self-grant.
	//
	// The check is against the FINAL active snapshot and the importer's
	// EFFECTIVE permissions (importer.Has, tenant-aware, pre-import) — NOT the
	// diff's Added set. The diff computes Added against a role's stored grants,
	// which for an inactive/tombstoned import row are RETAINED but not enforced;
	// reactivating such a role with unchanged grants produces an empty Added and
	// would slip past a diff-based guard while silently restoring authority the
	// importer does not currently hold. Comparing every active-snapshot grant of
	// a held role to what the importer effectively holds closes that path (and
	// the general stale-baseline case) with no false positives: a genuinely-held
	// active role's grants all satisfy importer.Has.
	if importer.Has != nil && len(importer.HeldSlugs) > 0 {
		for _, snap := range ordered {
			if !snap.Active || !importer.HeldSlugs[normalizePersonaSlug(snap.Slug)] {
				continue
			}
			for _, perm := range snap.Permissions {
				if !importer.Has(perm) {
					addErr(model.RoleMatrixIssue{RoleSlug: snap.Slug, Permission: perm, CodeKey: "self_escalation",
						Message: "you cannot grant your own role a permission you do not already hold; a different administrator must import this change"})
				}
			}
		}
	}

	return plan
}

// diffRoleMatrix compares the enforced current state to the target snapshot.
func diffRoleMatrix(current map[string]roleMatrixCurrentRole, target []model.RoleMatrixRoleSnapshot) model.RoleMatrixDiff {
	diff := model.RoleMatrixDiff{}
	for _, snap := range target {
		cur, exists := current[snap.Slug]
		switch {
		case !exists:
			diff.RolesAdded = append(diff.RolesAdded, snap.Slug)
			diff.GrantsAdded += len(snap.Permissions)
		case cur.Snapshot.Active && !snap.Active:
			diff.RolesDeactivated = append(diff.RolesDeactivated, snap.Slug)
			diff.GrantsRemoved += len(cur.Snapshot.Permissions)
		default:
			added, removed := diffStringSets(cur.Snapshot.Permissions, snap.Permissions)
			if len(added) == 0 && len(removed) == 0 {
				diff.RolesUnchanged++
				continue
			}
			diff.RolesChanged = append(diff.RolesChanged, model.RoleMatrixRoleDiff{
				RoleSlug: snap.Slug, Added: added, Removed: removed,
			})
			diff.GrantsAdded += len(added)
			diff.GrantsRemoved += len(removed)
		}
	}
	sort.Strings(diff.RolesAdded)
	sort.Strings(diff.RolesDeactivated)
	sort.Slice(diff.RolesChanged, func(i, j int) bool { return diff.RolesChanged[i].RoleSlug < diff.RolesChanged[j].RoleSlug })
	return diff
}

func diffStringSets(before, after []string) (added, removed []string) {
	b := make(map[string]struct{}, len(before))
	for _, v := range before {
		b[v] = struct{}{}
	}
	a := make(map[string]struct{}, len(after))
	for _, v := range after {
		a[v] = struct{}{}
		if _, ok := b[v]; !ok {
			added = append(added, v)
		}
	}
	for _, v := range before {
		if _, ok := a[v]; !ok {
			removed = append(removed, v)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	return added, removed
}

// roleMatrixChecksum is the canonical content hash of a snapshot (stable JSON).
func roleMatrixChecksum(snapshot []model.RoleMatrixRoleSnapshot) string {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// legalWorkflowAuthorSlug / legalAuditReaderSlug mirror the baseline fold-in
// tiers (auth.ApplyLegalRoleBaselines) for warning classification.
func legalWorkflowAuthorSlug(slug string) bool {
	switch strings.ReplaceAll(slug, "-", "_") {
	case "legal_system_admin", "legal_director", "legal_cases_manager",
		"legal_contracts_manager", "legal_case_supervisor", "legal_contracts_supervisor":
		return true
	}
	return false
}

func legalAuditReaderSlug(slug string) bool {
	switch strings.ReplaceAll(slug, "-", "_") {
	case "legal_system_admin", "legal_director", "legal_auditor":
		return true
	}
	return false
}
