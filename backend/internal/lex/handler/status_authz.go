package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/suiteapi"
)

// statusClass classifies the TARGET of a generic /status (FSM) transition so the
// transport layer can decide which permission TIER the actor must hold.
//
// The /status routes are gated at the router on the EDIT tier (lex:<domain>:edit
// OR coarse lex:write) for migration compatibility, because most FSM transitions
// are ordinary edit-class moves (intake -> phase1, in_progress -> results, …).
// But the same route can also drive a record into a close-class terminal state
// (closed / cancelled) or an approve/decision-class state (approved / rejected) —
// which would let an edit-tier / lex:write holder bypass the lex:<domain>:close /
// lex:<domain>:approve SoD control points (the FSM-status-route bypass, design v2
// §4.4 / acceptance bullets 1, 2, 7). enforceStatusElevation closes that hole by
// re-gating on the ELEVATED key when the target is close- or approve-class.
type statusClass int

const (
	// statusClassEdit is an ordinary edit-class transition: the route's edit tier
	// (incl. the coarse lex:write fallback) is sufficient.
	statusClassEdit statusClass = iota
	// statusClassApprove is an approve/decision-class transition (approved /
	// rejected). Requires lex:<domain>:approve — NO edit/lex:write fallback.
	statusClassApprove
	// statusClassClose is a close-class TERMINAL transition (closed / cancelled).
	// Requires lex:<domain>:close — NO edit/lex:write fallback.
	statusClassClose
)

// statusElevation describes the per-domain elevated keys + the classifier the
// /status handler consults. closePerm / approvePerm are the lex:<domain>:close /
// lex:<domain>:approve keys; classify maps a target status string to its class.
type statusElevation struct {
	domain      string
	closePerm   string
	approvePerm string
	classify    func(status string) statusClass
}

// authorLookup loads the record's author (created_by / initiated_by) for the
// dynamic-SoD (author != actor) parity check on close/approve status transitions.
// It returns (author, found, err); a not-found / nil author fails CLOSED, exactly
// like lexmw.RequireDistinctActor (design v2 §4.2).
type authorLookup func(ctx context.Context, tenantID, recordID uuid.UUID) (author uuid.UUID, found bool, err error)

// caseStatusElevation classifies a legal_case FSM target. Cases have no
// approve-class status; closed / cancelled are the close-class terminals.
var caseStatusElevation = statusElevation{
	domain:      "case",
	closePerm:   auth.PermLexCaseClose,
	approvePerm: auth.PermLexCaseApprove,
	classify: func(status string) statusClass {
		switch strings.ToLower(strings.TrimSpace(status)) {
		case "closed", "cancelled":
			return statusClassClose
		default:
			return statusClassEdit
		}
	},
}

// investigationStatusElevation classifies an investigation FSM target. closed /
// cancelled are close-class; approved / rejected are approve-class (the service
// also routes these through the approval endpoints, but the elevated gate is
// enforced here too so the verdict is rendered with the correct SoD semantics).
var investigationStatusElevation = statusElevation{
	domain:      "investigation",
	closePerm:   auth.PermLexInvestigationClose,
	approvePerm: auth.PermLexInvestigationApprove,
	classify: func(status string) statusClass {
		switch strings.ToLower(strings.TrimSpace(status)) {
		case "closed", "cancelled":
			return statusClassClose
		case "approved", "rejected":
			return statusClassApprove
		default:
			return statusClassEdit
		}
	},
}

// enforceStatusElevation is the FSM-status-route bypass guard. Given the request,
// the per-domain elevation descriptor, and the target status, it:
//
//   - returns true (proceed) for an edit-class transition — the route's existing
//     edit/lex:write tier already authorised it;
//   - for a close-class transition, requires lex:<domain>:close;
//   - for an approve/decision-class transition, requires lex:<domain>:approve;
//   - in BOTH elevated cases, additionally enforces the dynamic-SoD invariant
//     (author != actor, design v2 §4.2) when an author lookup is supplied, for
//     parity with the lexmw.RequireDistinctActor guard on the dedicated
//     approve/close routes.
//
// On any denial it writes the 403 response and returns false (the caller must
// stop). It writes 401 when there is no authenticated user and fails CLOSED on a
// SoD lookup that cannot prove distinctness.
func enforceStatusElevation(w http.ResponseWriter, r *http.Request, elev statusElevation, status string, lookup authorLookup) bool {
	class := elev.classify(status)
	if class == statusClassEdit {
		return true
	}

	user := auth.UserFromContext(r.Context())
	if user == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required", nil)
		return false
	}

	required := elev.closePerm
	verb := "close"
	if class == statusClassApprove {
		required = elev.approvePerm
		verb = "approve"
	}

	// ELEVATED gate: NO coarse lex:write / edit fallback (design v2 §4.4). Only the
	// exact per-domain key (or a wildcard that prefix-matches it) passes, so an
	// edit-tier / lex:write holder driving the FSM to a terminal close- (or
	// decision-) class state via /status is DENIED — closing the bypass.
	if !auth.HasPermissionCtx(r.Context(), user.Roles, required) {
		suiteapi.WriteError(w, r, http.StatusForbidden, "FORBIDDEN",
			"this status transition requires the "+elev.domain+":"+verb+" permission", nil)
		return false
	}

	// Dynamic-SoD parity (author != actor) on the elevated close/approve path.
	if lookup != nil {
		if !enforceStatusDistinctActor(w, r, user, lookup) {
			return false
		}
	}
	return true
}

// enforceStatusDistinctActor mirrors lexmw.RequireDistinctActor for the
// status-driven close/approve path: the record's AUTHOR may not render the
// close/approve verdict on their own record, regardless of the capability key
// they hold. Fails CLOSED on every path that cannot prove author != actor.
func enforceStatusDistinctActor(w http.ResponseWriter, r *http.Request, user *auth.ContextUser, lookup authorLookup) bool {
	actorID, err := uuid.Parse(user.ID)
	if err != nil || actorID == uuid.Nil {
		suiteapi.WriteError(w, r, http.StatusForbidden, "FORBIDDEN", "actor identity required", nil)
		return false
	}
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil || tenantID == uuid.Nil {
		suiteapi.WriteError(w, r, http.StatusForbidden, "FORBIDDEN", "tenant context required", nil)
		return false
	}
	recordID, err := suiteapi.UUIDParam(r, "id")
	if err != nil || recordID == uuid.Nil {
		suiteapi.WriteError(w, r, http.StatusForbidden, "SOD_CONFLICT", "target record could not be resolved for separation-of-duties check", nil)
		return false
	}
	author, found, err := lookup(r.Context(), tenantID, recordID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "SOD_RESOLVE_FAILED", "failed to resolve target record for separation-of-duties check", nil)
		return false
	}
	if !found || author == uuid.Nil {
		suiteapi.WriteError(w, r, http.StatusForbidden, "SOD_CONFLICT", "target record could not be resolved for separation-of-duties check", nil)
		return false
	}
	if author == actorID {
		suiteapi.WriteError(w, r, http.StatusForbidden, "SOD_CONFLICT",
			"you authored this record and cannot close or approve it via a status transition (separation of duties)", nil)
		return false
	}
	return true
}
