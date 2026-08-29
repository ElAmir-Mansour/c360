package middleware

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
)

// ActorRecord is the minimal projection of a target record the dynamic-SoD
// guard needs: who AUTHORED it (created_by / initiated_by) and who has already
// approved a prior step (so a two-round review cannot be satisfied by a single
// person signing twice). A domain that does not track prior approvers returns a
// nil/empty PriorApprovers slice.
type ActorRecord struct {
	// CreatedBy is the record's author (created_by / initiated_by). uuid.Nil when
	// the record carries no author (treated as "cannot prove distinctness" by the
	// guard — see RequireDistinctActor's fail-safe).
	CreatedBy uuid.UUID
	// PriorApprovers are user ids that have already approved/recorded an approval
	// step on this record. The two-round memo (design v2 §4.2 / CAP Defendant §5.4)
	// requires TWO DISTINCT approvers, so a repeat by a prior approver is rejected.
	PriorApprovers []uuid.UUID
}

// ActorRecordResolver loads the SoD-relevant projection of a record by its id,
// scoped to the tenant. It returns (record, true, nil) when the record exists,
// (_, false, nil) when it does not (the guard then fails CLOSED — deny — because
// it cannot prove author != approver), or (_, _, err) on a hard lookup failure
// (also fail CLOSED). Because each domain stores its record differently, the
// integrator supplies one resolver per domain (cases, contracts, investigations,
// settlements, consultations) in routes.go, reusing that domain's service Get.
type ActorRecordResolver func(ctx context.Context, tenantID, recordID uuid.UUID) (rec ActorRecord, found bool, err error)

// RequireDistinctActor enforces the dynamic Separation-of-Duties invariant of
// design v2 §4.2: the person who AUTHORED a record (or who already approved a
// prior step on it) may NOT approve or close that same record — author != approver
// — REGARDLESS of the capability key they hold. RBAC gives only static SoD (the
// Officer *role* cannot approve); this guard stops the same *user* who drafted a
// record from approving it even when they also hold an approver role.
//
// It is applied on top of the per-domain RequirePermission(:approve|:close) gate
// (which has already proven the actor MAY approve in general). The flow:
//   - read the record id from the {idParam} path param (default "id");
//   - resolve the record's author + prior approvers via resolver;
//   - 403 SoD-conflict when the current userID equals the author OR any prior
//     approver; pass through otherwise.
//
// Fail-safe by design — every error path DENIES:
//   - resolver == nil                       -> 403 (mis-wired guard never opens);
//   - no authenticated user                 -> 401;
//   - malformed/absent record id            -> 403;
//   - record not found / resolver error     -> 403 / 500 (cannot prove distinctness);
//   - record carries no author (uuid.Nil)   -> 403 (cannot prove distinctness).
//
// There is deliberately NO admin bypass: dynamic SoD binds the privileged operator
// too (the v1 gap was that a holder of both roles could self-approve).
func RequireDistinctActor(resolver ActorRecordResolver, idParam string) func(http.Handler) http.Handler {
	if idParam == "" {
		idParam = "id"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// A nil resolver is a wiring bug; fail CLOSED rather than silently
			// allowing an author to approve their own record.
			if resolver == nil {
				writeOrgRBACError(w, http.StatusForbidden, "SOD_CONFLICT", "separation-of-duties check is not available for this action")
				return
			}

			user := auth.UserFromContext(r.Context())
			if user == nil {
				writeOrgRBACError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
				return
			}

			actorID, err := uuid.Parse(user.ID)
			if err != nil || actorID == uuid.Nil {
				writeOrgRBACError(w, http.StatusForbidden, "FORBIDDEN", "actor identity required")
				return
			}

			tenantID, err := uuid.Parse(user.TenantID)
			if err != nil || tenantID == uuid.Nil {
				writeOrgRBACError(w, http.StatusForbidden, "FORBIDDEN", "tenant context required")
				return
			}

			recordID, err := uuid.Parse(chi.URLParam(r, idParam))
			if err != nil || recordID == uuid.Nil {
				// Without a resolvable target there is nothing to prove distinct
				// against; deny (this guard only wraps approve/close control points).
				writeOrgRBACError(w, http.StatusForbidden, "SOD_CONFLICT", "target record could not be resolved for separation-of-duties check")
				return
			}

			rec, found, err := resolver(r.Context(), tenantID, recordID)
			if err != nil {
				writeOrgRBACError(w, http.StatusInternalServerError, "SOD_RESOLVE_FAILED", "failed to resolve target record for separation-of-duties check")
				return
			}
			if !found || rec.CreatedBy == uuid.Nil {
				// Cannot prove author != approver: fail CLOSED.
				writeOrgRBACError(w, http.StatusForbidden, "SOD_CONFLICT", "target record could not be resolved for separation-of-duties check")
				return
			}

			if rec.CreatedBy == actorID {
				writeOrgRBACError(w, http.StatusForbidden, "SOD_CONFLICT", "you authored this record and cannot approve or close it (separation of duties)")
				return
			}
			for _, prior := range rec.PriorApprovers {
				if prior == actorID {
					writeOrgRBACError(w, http.StatusForbidden, "SOD_CONFLICT", "you already approved a prior step on this record; a second distinct approver is required (separation of duties)")
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}
