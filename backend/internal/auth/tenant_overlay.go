package auth

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

// Tenant role-permission OVERLAY (Lex_Role_Matrix_Import_Design.md §3, Option A).
//
// The platform's permission resolution is code-map driven: HasPermission looks
// role slugs up in the global RolePermissions map. The tenant role-matrix import
// capability lets a tenant define its OWN role→permission grants; for those to
// be enforced, the checkers below consult a per-tenant overlay FIRST and fall
// back to the code map for any role the overlay does not define.
//
// Safety properties (deliberate):
//   - No loader registered (every service except lex today) ⇒ the overlay is
//     inert and HasPermissionForTenant is behaviourally IDENTICAL to
//     HasPermission. Registering the loader is the opt-in.
//   - The loader surfaces EVERY role row written by an activated import
//     (roles.source='import'): active roles carry their grants and INACTIVE
//     roles carry an explicit empty set (a tombstone), so deactivating a
//     baseline role truly revokes it instead of falling back to the code-map
//     default. Seeded tenants (no import) keep resolving from the code map
//     exactly as before the feature existed.
//   - Loader failure serves the LAST-KNOWN-GOOD overlay when one exists (an
//     unreachable platform_core cannot silently widen a tenant that narrowed a
//     role) and falls back to the code-map defaults only for tenants that have
//     never loaded successfully — the availability floor, which can hide (not
//     mint) customisation until the next successful load.
//   - Entries expire after overlayTTL so multi-replica deployments converge on
//     an activation even though InvalidateTenantOverlay is process-local.
//   - Invalidation carries a per-tenant GENERATION: a load that started before
//     an invalidation can never overwrite the post-invalidation state.
//
// Matching semantics are IDENTICAL to HasPermission: the same expandGrants
// verb-implication pass and the same admin:* / "resource:*" wildcard rules run
// against overlay grants — see permsSatisfy (rbac.go).

// TenantOverlayLoader loads the tenant's imported role→permission sets, keyed by
// NORMALIZED role slug ('-' → '_', matching normalizeRoleSlug). An entry with an
// EMPTY slice is a tombstone (role deactivated by the import — grants nothing).
// Returning an empty (or nil) map means the tenant has no overlay and the code
// map applies.
type TenantOverlayLoader func(ctx context.Context, tenantID string) (map[string][]string, error)

const (
	// overlayTTL bounds cross-replica staleness after an activation.
	overlayTTL = 5 * time.Minute
	// overlayErrorTTL keeps a failed load from hammering the database on every
	// permission check while staying short enough to recover quickly.
	overlayErrorTTL = 30 * time.Second
)

type tenantOverlayEntry struct {
	perms   map[string][]string // normalized slug → raw grants (nil ⇒ no overlay)
	expires time.Time
	// lastGood retains the most recent successfully loaded overlay so loader
	// errors degrade to it (never silently widening a narrowed tenant).
	lastGood map[string][]string
	// gen is the tenant generation this entry was loaded under.
	gen uint64
}

var (
	overlayMu     sync.RWMutex
	overlayLoader TenantOverlayLoader
	overlayCache  = make(map[string]*tenantOverlayEntry)
	overlayGen    = make(map[string]uint64)
	// overlayLoadMu serializes loads PER TENANT so a cache miss under load does
	// not stampede the database (other tenants proceed unblocked).
	overlayLoadMu sync.Map // tenantID → *sync.Mutex
)

// SetTenantOverlayLoader registers the process-wide overlay source and resets
// the cache. Call once at service startup (lex-service registers the
// platform_core-backed loader); passing nil disables the overlay entirely.
func SetTenantOverlayLoader(loader TenantOverlayLoader) {
	overlayMu.Lock()
	defer overlayMu.Unlock()
	overlayLoader = loader
	overlayCache = make(map[string]*tenantOverlayEntry)
	overlayGen = make(map[string]uint64)
}

// InvalidateTenantOverlay drops the cached overlay for one tenant so the next
// permission check reloads it (called on import activation/rollback). The
// generation bump guarantees an in-flight load started BEFORE the invalidation
// cannot re-install its stale result. Process-local by design; other replicas
// converge within overlayTTL.
func InvalidateTenantOverlay(tenantID string) {
	overlayMu.Lock()
	defer overlayMu.Unlock()
	overlayGen[tenantID]++
	// Force a reload on the next check (mark the entry expired) but PRESERVE the
	// last-known-good map, so if that reload errors we degrade to the last
	// successfully enforced overlay rather than widening to the code map.
	if entry, ok := overlayCache[tenantID]; ok && entry.lastGood != nil {
		overlayCache[tenantID] = &tenantOverlayEntry{
			perms:    entry.lastGood,
			expires:  time.Unix(0, 0),
			lastGood: entry.lastGood,
			gen:      overlayGen[tenantID],
		}
	} else {
		delete(overlayCache, tenantID)
	}
}

// tenantOverlay returns the tenant's overlay map (nil when none / disabled).
func tenantOverlay(ctx context.Context, tenantID string) map[string][]string {
	if tenantID == "" {
		return nil
	}
	overlayMu.RLock()
	loader := overlayLoader
	entry, ok := overlayCache[tenantID]
	overlayMu.RUnlock()
	if loader == nil {
		return nil
	}
	if ok && time.Now().Before(entry.expires) {
		return entry.perms
	}

	// Serialize the (re)load per tenant; everyone queued behind the winner
	// reuses its freshly cached entry.
	lockAny, _ := overlayLoadMu.LoadOrStore(tenantID, &sync.Mutex{})
	lock := lockAny.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	overlayMu.RLock()
	entry, ok = overlayCache[tenantID]
	startGen := overlayGen[tenantID]
	overlayMu.RUnlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.perms
	}

	// Load OUTSIDE the global lock: the loader hits the database and must not
	// stall other tenants' permission checks.
	perms, err := loader(ctx, tenantID)
	ttl := overlayTTL
	var lastGood map[string][]string
	if entry != nil {
		lastGood = entry.lastGood
	}
	switch {
	case err != nil && lastGood != nil:
		// Degrade to the last-known-good overlay: never silently widen a
		// tenant whose active matrix narrowed a role. Retry shortly.
		perms = lastGood
		ttl = overlayErrorTTL
	case err != nil:
		// Never loaded successfully: the code-map defaults are the floor.
		perms = nil
		ttl = overlayErrorTTL
	case len(perms) == 0:
		perms = nil
		lastGood = nil
	default:
		lastGood = perms
	}

	overlayMu.Lock()
	// An invalidation during the load supersedes this result — drop it.
	if overlayGen[tenantID] == startGen {
		overlayCache[tenantID] = &tenantOverlayEntry{
			perms: perms, expires: time.Now().Add(ttl), lastGood: lastGood, gen: startGen,
		}
	}
	overlayMu.Unlock()
	return perms
}

// rolePermsForTenant resolves ONE role slug for a tenant: the overlay's grants
// when the tenant has imported that role, else the global code map's.
func rolePermsForTenant(overlay map[string][]string, normalizedSlug string) ([]string, bool) {
	if overlay != nil {
		if perms, ok := overlay[normalizedSlug]; ok {
			return perms, true
		}
	}
	perms, ok := RolePermissions[normalizedSlug]
	return perms, ok
}

// HasPermissionForTenant is the tenant-aware form of HasPermission: identical
// matching semantics, with the tenant's imported role grants (when any)
// shadowing the code-map defaults per role slug.
func HasPermissionForTenant(ctx context.Context, tenantID string, roles []string, required string) bool {
	overlay := tenantOverlay(ctx, tenantID)
	if overlay == nil {
		return HasPermission(roles, required)
	}
	for _, role := range roles {
		perms, ok := rolePermsForTenant(overlay, normalizeRoleSlug(role))
		if !ok {
			continue
		}
		if permsSatisfy(perms, required) {
			return true
		}
	}
	return false
}

// HasPermissionCtx is the drop-in, tenant-aware form for call sites that carry
// a request context: the tenant is resolved from the context (TenantFromContext)
// so interior authorization checks can never diverge from the route gates. With
// no tenant in context (or no loader registered) it degrades to the code map.
func HasPermissionCtx(ctx context.Context, roles []string, required string) bool {
	return HasPermissionForTenant(ctx, TenantFromContext(ctx), roles, required)
}

// HasAnyPermissionCtx mirrors HasAnyPermission, tenant-resolved from context.
func HasAnyPermissionCtx(ctx context.Context, roles []string, required ...string) bool {
	return HasAnyPermissionForTenant(ctx, TenantFromContext(ctx), roles, required...)
}

// HasAnyPermissionForTenant mirrors HasAnyPermission with the tenant overlay.
func HasAnyPermissionForTenant(ctx context.Context, tenantID string, roles []string, required ...string) bool {
	for _, perm := range required {
		if HasPermissionForTenant(ctx, tenantID, roles, perm) {
			return true
		}
	}
	return false
}

// HasAllPermissionsForTenant mirrors HasAllPermissions with the tenant overlay.
func HasAllPermissionsForTenant(ctx context.Context, tenantID string, roles []string, required ...string) bool {
	for _, perm := range required {
		if !HasPermissionForTenant(ctx, tenantID, roles, perm) {
			return false
		}
	}
	return true
}

// EffectivePermissionsForTenant mirrors EffectivePermissions with the tenant
// overlay, so the UX layer (GET /lex/me) reports EXACTLY what the tenant-aware
// checkers enforce — the two must never disagree.
func EffectivePermissionsForTenant(ctx context.Context, tenantID string, roleSlugs []string) []string {
	overlay := tenantOverlay(ctx, tenantID)
	if overlay == nil {
		return EffectivePermissions(roleSlugs)
	}
	set := make(map[string]struct{})
	for _, role := range roleSlugs {
		perms, ok := rolePermsForTenant(overlay, normalizeRoleSlug(role))
		if !ok {
			continue
		}
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

/* ------------------------------------------------------------------------- *
 * Importable-permission catalog (consumed by the role-matrix import validator
 * and the template builder — single source: lexDomainVerbs).
 * ------------------------------------------------------------------------- */

// lexMatrixCoarseKeys are the coarse/cross-cutting keys a tenant matrix may
// grant IN ADDITION to the granular lex:<domain>:<verb> set. lex:read/lex:write
// are the spine fallbacks many routes accept; the approval trio gates policy
// governance; workflow:write / audit:read are the elevated fold-ins the
// baseline gives authoring/oversight roles (import warns on both).
var lexMatrixCoarseKeys = []string{
	PermLexRead,
	PermLexWrite,
	PermLexApprovalRead,
	PermLexApprovalWrite,
	PermLexApprovalAdmin,
	PermWorkflowWrite,
	PermAuditRead,
}

// LexMatrixImportableKeys returns every permission key a tenant role-matrix
// import may grant: the full lex:<domain>:<verb> catalog plus the coarse keys.
// Sorted and deduped — deterministic for templates and validation messages.
func LexMatrixImportableKeys() []string {
	set := make(map[string]struct{})
	for domain, verbs := range lexDomainVerbs {
		for _, verb := range verbs {
			set["lex:"+domain+":"+verb] = struct{}{}
		}
	}
	for _, key := range lexMatrixCoarseKeys {
		set[key] = struct{}{}
	}
	// Auto-granted baselines are appended to every role by the loader/seeder and
	// are therefore NOT importable — a template listing them as grantable would
	// suggest they can be revoked, which they cannot.
	for _, key := range LexMatrixAutoGrantedKeys() {
		delete(set, key)
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// LexMatrixAutoGrantedKeys are appended to EVERY legal role automatically (the
// registerLegalAffairsRoles baselines); they are not importable — the loader
// and seeder add them so the approval inbox and reference library always work.
func LexMatrixAutoGrantedKeys() []string {
	return []string{PermWorkflowRead, PermWorkflowTask, PermLexReferenceView}
}

// LexDomainVerbCatalog exposes the domain→verbs table (copy) for template
// builders so the grants grid renders in the same authoritative order.
func LexDomainVerbCatalog() map[string][]string {
	out := make(map[string][]string, len(lexDomainVerbs))
	for domain, verbs := range lexDomainVerbs {
		out[domain] = append([]string(nil), verbs...)
	}
	return out
}

// IsLegalMatrixRoleSlug reports whether a slug is one of the 14 baseline
// legal-affairs roles (the matrix's built-in scope).
func IsLegalMatrixRoleSlug(slug string) bool {
	normalized := normalizeRoleSlug(slug)
	for i := range LegalAffairsRoleDefs {
		if normalizeRoleSlug(LegalAffairsRoleDefs[i].Slug) == normalized {
			return true
		}
	}
	return false
}

// IsReservedRoleSlug reports whether a slug is a PLATFORM role registered in
// the code map that is NOT part of the legal matrix (super-admin, tenant-admin,
// viewer, analyst, workflow admins, …). A tenant role-matrix import must never
// shadow these: an overlay entry under such a slug would rewrite platform
// authority far beyond the legal suite.
func IsReservedRoleSlug(slug string) bool {
	if IsLegalMatrixRoleSlug(slug) {
		return false
	}
	_, exists := RolePermissions[normalizeRoleSlug(slug)]
	return exists
}

// IsLexViewOnlyPermission reports whether a key is a pure read/view grant —
// the Auditor-archetype guard admits only these (plus lex:read).
func IsLexViewOnlyPermission(key string) bool {
	if key == PermLexRead {
		return true
	}
	parts := strings.Split(key, ":")
	verb := parts[len(parts)-1]
	return verb == "view" || verb == "read"
}
