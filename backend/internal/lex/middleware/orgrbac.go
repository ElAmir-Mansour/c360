package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

// OrgRoleResolver resolves the org-registry side of CAP-153 five-verb RBAC:
// given a tenant + target org entity + the verbs in play, it returns the role
// bindings (resolved nearest-ancestry) that can satisfy each verb. This is the
// EXACT seam *service.OrgEntityService.ResolveOrgRBACPrerequisites already
// implements, so the integrator passes the OrgEntityService here with no
// adapter. The resolver returns BINDINGS, not a verdict — enforcement lives in
// this middleware.
type OrgRoleResolver interface {
	ResolveOrgRBACPrerequisites(ctx context.Context, tenantID, entityID uuid.UUID, verbs []model.OrgRBACVerb) (*model.OrgRBACPrerequisiteResolution, error)
}

// OrgEntityResolver maps an in-flight request to the TARGET org entity the
// org-RBAC check is scoped to (the beneficiary/owning entity of the resource
// being mutated). It returns (entityID, true, nil) when a target entity is
// known, (uuid.Nil, false, nil) when the route has NO org-entity scope (in which
// case the middleware is a transparent pass-through and the coarse lex:* gate is
// the only authority), or (_, _, err) on a hard lookup failure.
//
// Because target-entity resolution differs per resource (a case, an
// investigation, a settlement each store their beneficiary entity differently),
// the integrator supplies one resolver per route family. A safe default,
// EntityFromURLParam, is provided for routes that carry the entity id directly
// in the path.
type OrgEntityResolver func(r *http.Request) (entityID uuid.UUID, ok bool, err error)

// orgRBACAdminPermissions are the platform/admin grants that BYPASS org-RBAC.
// A holder of admin:* (super_admin) or tenant:write (tenant_admin) is a
// privileged operator whose access is governed by the coarse RBAC layer, not by
// per-entity org role bindings. The latter is deliberately tenant-scoped by the
// JWT's tenant claim; it does not grant the cross-tenant control-plane access
// reserved for admin:*.
//
// Keeping tenant:write here matters for full-tenant admins: without it, the UI and
// coarse route gate correctly grant an operation but the inner org registry
// layer incorrectly rejects the same account for lacking a per-entity binding.
// Using tenant:write instead of lex:* is deliberate: a broad legal role must not
// bypass entity bindings merely because it has suite-wide legal permissions.
var orgRBACAdminPermissions = []string{auth.PermAdminAll, auth.PermTenantWrite}

// RequireOrgVerb returns middleware that enforces a single org-scoped verb
// (lex:view/add/edit/approve/close, expressed as a model.OrgRBACVerb) for the
// target entity of the request, AFTER the coarse lex:read/lex:write gate that
// already runs on the route.
//
// Design guarantees (all ADDITIVE and BACKWARD-COMPATIBLE):
//   - resolver == nil OR entityResolver == nil  -> transparent pass-through.
//   - the route resolves NO target entity (ok == false) -> pass-through (the
//     coarse lex:* gate already authorized; there is nothing org-scoped to check).
//   - the actor holds an admin bypass permission (admin:*) -> pass-through.
//   - a target entity IS resolved AND the actor's user id is NOT among the
//     recipients that can satisfy verb for that entity's ancestry -> 403.
//   - resolver/entityResolver returns an error -> 500 (fail CLOSED on the
//     destructive routes this guards; a registry outage must not silently allow
//     a delete).
//
// The flat lex:read/lex:write remains the coarse OUTER gate (applied in
// routes.go); this is the granular INNER gate the integrator layers on top of
// destructive/admin routes only.
func RequireOrgVerb(resolver OrgRoleResolver, entityResolver OrgEntityResolver, verb model.OrgRBACVerb) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Pass-through when the org-RBAC layer is not wired for this route.
			if resolver == nil || entityResolver == nil || !verb.Valid() {
				next.ServeHTTP(w, r)
				return
			}

			user := auth.UserFromContext(r.Context())
			if user == nil {
				// Defensive: RequireOrgVerb must run AFTER Auth + RequirePermission.
				writeOrgRBACError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
				return
			}

			// Admin bypass: privileged operators are governed by coarse RBAC.
			if auth.HasAnyPermissionCtx(r.Context(), user.Roles, orgRBACAdminPermissions...) {
				next.ServeHTTP(w, r)
				return
			}

			entityID, ok, err := entityResolver(r)
			if err != nil {
				writeOrgRBACError(w, http.StatusInternalServerError, "ORG_RBAC_RESOLVE_FAILED", "failed to resolve target entity")
				return
			}
			if !ok || entityID == uuid.Nil {
				// No org-entity scope on this request: coarse gate already decided.
				next.ServeHTTP(w, r)
				return
			}

			tenantID, err := uuid.Parse(user.TenantID)
			if err != nil || tenantID == uuid.Nil {
				writeOrgRBACError(w, http.StatusForbidden, "FORBIDDEN", "tenant context required")
				return
			}

			actorID, err := uuid.Parse(user.ID)
			if err != nil || actorID == uuid.Nil {
				writeOrgRBACError(w, http.StatusForbidden, "FORBIDDEN", "actor identity required")
				return
			}

			resolution, err := resolver.ResolveOrgRBACPrerequisites(r.Context(), tenantID, entityID, []model.OrgRBACVerb{verb})
			if err != nil {
				// Fail CLOSED: this gate only wraps destructive/admin routes.
				writeOrgRBACError(w, http.StatusInternalServerError, "ORG_RBAC_RESOLVE_FAILED", "failed to resolve org role bindings")
				return
			}

			if !actorSatisfiesVerb(resolution, verb, actorID) {
				writeOrgRBACError(w, http.StatusForbidden, "FORBIDDEN", "no org role binding authorizes this action for the target entity")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// actorSatisfiesVerb reports whether actorID holds one of the org roles that can
// satisfy verb for the resolved entity. A verb whose prerequisites resolved to
// NO recipients at all (no binding anywhere in the ancestry) is treated as
// UNSATISFIED for a non-admin actor — the action is denied rather than silently
// allowed — so an unconfigured org node cannot be used to escalate.
func actorSatisfiesVerb(resolution *model.OrgRBACPrerequisiteResolution, verb model.OrgRBACVerb, actorID uuid.UUID) bool {
	if resolution == nil {
		return false
	}
	for _, prereq := range resolution.Prerequisites {
		if prereq.Verb != verb {
			continue
		}
		for _, recipient := range prereq.Recipients {
			if recipient.UserID == actorID {
				return true
			}
		}
	}
	return false
}

// EntityFromURLParam builds an OrgEntityResolver that reads a uuid from a chi
// URL parameter (e.g. "entityId"). A missing/blank param yields (Nil, false, nil)
// — pass-through — while a present-but-malformed value is a hard 400-class error
// surfaced as a resolver error. Routes whose target entity is NOT in the path
// (it must be loaded from the resource row) should supply a bespoke resolver
// instead; this default exists only for the org-entity routes themselves.
func EntityFromURLParam(param string) OrgEntityResolver {
	return func(r *http.Request) (uuid.UUID, bool, error) {
		raw := chi.URLParam(r, param)
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

func writeOrgRBACError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  status,
		"code":    code,
		"message": message,
	})
}
