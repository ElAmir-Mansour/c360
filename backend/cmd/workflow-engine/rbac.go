package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
)

// Per-action RBAC for the workflow-engine HTTP surface.
//
// The handler Routes() methods are intentionally left ungated (their unit
// tests drive them directly without role-bearing contexts). Authorization is
// applied here, in the production wiring, as a thin classifier middleware in
// front of each mounted handler group. Each classifier inspects the request
// method and the trailing action segment of the path, resolves the required
// permission, and delegates to middleware.RequirePermission — so the existing
// wildcard / role logic in auth.HasPermission (admin:* and workflow:* short
// circuits) is reused unchanged.
//
// Permission model (matches the workflow permission constants in
// internal/auth/rbac.go):
//
//   - authenticated baseline — the shared workspace's core reads (definitions /
//     instances / tasks / templates GET, incl. /tasks/count) require only an
//     authenticated tenant user, no workflow:* grant. Tenant-created custom
//     roles resolve to zero permissions in the code map (auth.HasPermission
//     skips unknown role slugs), so gating these on workflow:read would 403
//     every custom-role user out of the workspace.
//   - workflow:task  — human-task actions an assignee performs: claim /
//     unclaim / complete. NOT part of the authenticated baseline: role-routed
//     tasks (assignee_role set, no named assignee, no candidate pools — the
//     shape every catalog template emits) skip ALL eligibility checks in
//     TaskService.ClaimTask, so this grant is the only enforced authorization
//     on claiming (and then completing) such approval tasks.
//   - workflow:read  — remaining reads (incidents, trigger-executions, SLA
//     policies / calendars, analytics, substitutions, forms, marketplace).
//   - workflow:write — authoring (create / update / clone, instantiate,
//     trigger replay) and instance control (start / cancel / retry / suspend /
//     pause / resume). Unchanged.
//   - workflow:admin — definition lifecycle: activate / publish / archive /
//     delete / promote. Unchanged.
//   - workflow:incident — governed operator intervention. Unchanged.

// gate wraps next with RequirePermission(perm). It is a tiny helper so the
// classifiers below read as a table.
func gate(perm string, next http.Handler) http.Handler {
	return middleware.RequirePermission(perm)(next)
}

// requireAuthenticated admits any request carrying an authenticated context
// user, regardless of role — the gate for the authenticated-baseline routes
// above. In the production wiring middleware.Auth + middleware.Tenant run in
// front of every classifier (main.go mounts them on /api/v1/workflows), so the
// user is already validated; the nil-user check mirrors the exact 401 that
// middleware.RequirePermission emits, keeping the group fail-closed if it is
// ever exercised without those middlewares.
func requireAuthenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.UserFromContext(r.Context()) == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  401,
				"code":    "UNAUTHENTICATED",
				"message": "authentication required",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// lastSegment returns the final non-empty path segment, lowercased. For
// "/{id}/activate" it returns "activate"; for "/{id}" it returns the id value
// (which never matches an action keyword, so it falls through to the default).
func lastSegment(p string) string {
	p = strings.Trim(p, "/")
	if p == "" {
		return ""
	}
	if i := strings.LastIndex(p, "/"); i >= 0 {
		p = p[i+1:]
	}
	return strings.ToLower(p)
}

// definitionRBAC gates the /definitions group.
//
//	GET    *                                  -> any authenticated user
//	POST   /, /from-template, /{id}/clone     -> workflow:write
//	PUT    /{id}                              -> workflow:write
//	POST   /{id}/activate|publish|archive|promote, DELETE /{id} -> workflow:admin
func definitionRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireAuthenticated(next).ServeHTTP(w, r)
		case http.MethodPut:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		case http.MethodDelete:
			gate(auth.PermWorkflowAdmin, next).ServeHTTP(w, r)
		case http.MethodPost:
			switch lastSegment(r.URL.Path) {
			case "activate", "publish", "archive", "promote":
				gate(auth.PermWorkflowAdmin, next).ServeHTTP(w, r)
			default: // create ("/"), from-template, clone
				gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
			}
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// instanceRBAC gates the /instances group.
//
//	GET    *           -> any authenticated user (the /workflows hub reads
//	                      instance lists/stats)
//	POST   / + control -> workflow:write (start / cancel / retry / suspend / pause / resume)
//	PUT    /{id}        -> workflow:write
//	DELETE /{id}        -> workflow:admin
func instanceRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireAuthenticated(next).ServeHTTP(w, r)
		case http.MethodPost, http.MethodPut:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		case http.MethodDelete:
			gate(auth.PermWorkflowAdmin, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// incidentRBAC gates the /incidents group (GAP 4 — governed operator
// intervention). Viewing incidents / dead-letter is workflow:read; every
// mutating operator action (retry / skip / modify-retry / abandon, override
// request / approve / reject) requires the elevated workflow:incident verb. The
// separation-of-duties (maker != checker) guard on a sensitive override is
// enforced deeper, in the engine service, fail-closed — this classifier only
// authorizes that the actor may perform incident actions at all.
//
//	GET  *  -> workflow:read
//	POST *  -> workflow:incident
func incidentRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPost:
			gate(auth.PermWorkflowIncident, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// migrationRBAC gates the /migrations group (in-flight instance version
// migration). Re-pinning running work across definition versions is a governance
// action, so every route (all POST) requires the elevated workflow:admin verb —
// the same tier as the definition lifecycle. There are no read routes.
//
//	POST *  -> workflow:admin
func migrationRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			gate(auth.PermWorkflowAdmin, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// taskRBAC gates the /tasks group.
//
//	GET    * (incl. /tasks/count and /queues group inbox) -> any authenticated user
//	POST   /{id}/claim|unclaim|complete         -> workflow:task
//	POST   /{id}/delegate|assign|reject|comment -> workflow:write
//
// claim / unclaim / complete keep the workflow:task gate: for role-routed
// tasks (assignee_role set, no named assignee, no candidate pools) the task
// service skips every eligibility check on claim, and complete only requires
// being the claimant — so without this grant any authenticated user could
// claim-then-complete a role-restricted approval task.
func taskRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireAuthenticated(next).ServeHTTP(w, r)
		case http.MethodPost:
			switch lastSegment(r.URL.Path) {
			case "claim", "unclaim", "complete":
				gate(auth.PermWorkflowTask, next).ServeHTTP(w, r)
			default: // delegate / assign / reject / comment
				gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
			}
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// templateRBAC gates the /templates group.
//
//	GET    *                  -> any authenticated user
//	POST   /{id}/instantiate  -> workflow:write
func templateRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			requireAuthenticated(next).ServeHTTP(w, r)
		case http.MethodPost:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// marketplaceRBAC gates the /marketplace group (Phase 5 governed gallery).
//
//	GET    * (browse, versions)  -> workflow:read
//	POST   / (publish)           -> workflow:write
//	POST   /{id}/install         -> workflow:write
//	POST   /{id}/review          -> workflow:admin (the four-eyes governance gate)
//
// The four-eyes distinct-approver (publisher != reviewer) is additionally
// enforced fail-closed in the service; this classifier only authorizes that the
// actor may perform the review action at all.
func marketplaceRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPost:
			switch lastSegment(r.URL.Path) {
			case "review":
				gate(auth.PermWorkflowAdmin, next).ServeHTTP(w, r)
			default: // publish ("/") and install ("/{id}/install")
				gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
			}
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// triggerExecutionRBAC gates the /trigger-executions group.
//
//	GET    *             -> workflow:read
//	POST   /{id}/replay  -> workflow:write
func triggerExecutionRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPost:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// slaRBAC gates the WP-5 /sla-policies and /calendars groups: SLA-policy and
// business-calendar authoring is workflow:write, viewing is workflow:read.
//
//	GET             *  -> workflow:read
//	POST/PUT/DELETE *  -> workflow:write
func slaRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPost, http.MethodPut, http.MethodDelete:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// analyticsRBAC gates the READ-ONLY /analytics group (process intelligence:
// cycle time / bottlenecks / rework / throughput; and the process-MINING moat:
// variants / conformance / map / simulate). Everything under /analytics is
// read-only — including POST /{definitionKey}/simulate, which takes a what-if
// body but performs NO state change (it is a Monte-Carlo ESTIMATE over the
// historical event log). So BOTH GET and the simulate POST require workflow:read.
// Any other method (none today) falls through ungated to the handler, which 405s
// on unmounted methods.
//
//	GET  *          -> workflow:read
//	POST .../simulate -> workflow:read (estimate-only, no state change)
func analyticsRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodPost:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// substitutionRBAC gates the /substitutions (out-of-office / deputy) group:
// viewing a user's OOO history is workflow:read; setting or clearing a deputy
// window (PUT/DELETE) requires workflow:write as the floor. The self-vs-admin
// split (setting/clearing ANOTHER user's window additionally requires
// workflow:admin) is enforced in the handler (SubstitutionHandler.set/clear via
// canTargetOtherUser), because only the handler can compare the caller identity
// to the /users/{userId} target — this classifier sees only the method + path.
//
//	GET         *  -> workflow:read
//	PUT/DELETE  *  -> workflow:write (self); +workflow:admin for another user
func substitutionRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPut, http.MethodPost, http.MethodDelete:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// formsRBAC gates the /forms group: viewing form definitions is workflow:read;
// authoring, version edits, and deletes are workflow:write.
//
//	GET             *  -> workflow:read
//	POST/PUT/DELETE *  -> workflow:write
func formsRBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			gate(auth.PermWorkflowRead, next).ServeHTTP(w, r)
		case http.MethodPost, http.MethodPut, http.MethodDelete:
			gate(auth.PermWorkflowWrite, next).ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}
