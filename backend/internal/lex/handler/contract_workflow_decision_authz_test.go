package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// contractReviewGate replicates EXACTLY the router gate the real contract
// workflow-decision routes carry (routes.go `contractReview`):
//
//	RequireAnyPermission(lex:contract:approve, lex:contract:edit)  — NO lex:write.
//
// design v2 §4.4: these routes (`/workflows/{id}/tasks/{tid}/decision` and
// `/workflows/tasks/bulk-decision`) render an approve/reject contract VERDICT, so
// they MUST leave the coarse lex:write tier. But the contract review workflow is a
// MULTI-TIER chain whose first-tier reviewers (legal-contracts-supervisor /
// legal-advisor) hold only lex:contract:edit, so the gate admits :edit too — the
// (capability key) layer of the §4.2 intersection. A bare-lex:write holder
// (legal-officer carries lex:write but NO contract verb) is DENIED here.
func contractReviewGate() func(http.Handler) http.Handler {
	return sharedmw.RequireAnyPermission(auth.PermLexContractApprove, auth.PermLexContractEdit)
}

func serveContractReview(roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := contractReviewGate()(final)
	req := httptest.NewRequest(http.MethodPost, "/workflows/tasks/bulk-decision", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000a",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

// TestContractWorkflowDecision_NoCoarseLexWriteFallback is the headline assertion
// for the closed leak (design v2 §4.4 / the VIOLATED bullet): a holder of ONLY the
// coarse lex:write (legal-officer, which carries NO contract-domain verb) is now
// DENIED the contract workflow-decision route, while a holder of the final sign-off
// key (lex:contract:approve, legal-contracts-manager) is ALLOWED.
func TestContractWorkflowDecision_NoCoarseLexWriteFallback(t *testing.T) {
	// legal-officer: holds lex:write + lex:read but NO lex:contract:* verb. DENIED.
	if got := serveContractReview([]string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("legal-officer (bare lex:write, no contract verb) on workflow-decision: got %d, want 403", got)
	}
	// legal-contracts-manager: final contract sign-off (lex:contract:approve). ALLOWED.
	if got := serveContractReview([]string{"legal-contracts-manager"}); got != http.StatusOK {
		t.Errorf("legal-contracts-manager (lex:contract:approve) on workflow-decision: got %d, want 200", got)
	}
}

// TestContractWorkflowDecision_FirstTierReviewersAllowed proves the multi-tier
// chain is NOT broken: the legitimate first-tier reviewers, whose only contract
// verb is lex:contract:edit, still pass the (capability key) gate. WHICH tier each
// may actually decide is then narrowed by the chain recipient
// (validateWorkflowDecisionActor) + distinct-actor parity in the service.
func TestContractWorkflowDecision_FirstTierReviewersAllowed(t *testing.T) {
	// legal-contracts-supervisor: contract view/add/edit/distribute, NO approve.
	if got := serveContractReview([]string{"legal-contracts-supervisor"}); got != http.StatusOK {
		t.Errorf("legal-contracts-supervisor (lex:contract:edit) on workflow-decision: got %d, want 200", got)
	}
	// legal-advisor: RECOMMENDS only — contract view/add/edit, NO approve.
	if got := serveContractReview([]string{"legal-advisor"}); got != http.StatusOK {
		t.Errorf("legal-advisor (lex:contract:edit) on workflow-decision: got %d, want 200", got)
	}
}

// TestContractWorkflowDecision_OtherBareWriteHoldersDenied widens the proof: a
// synthetic role carrying ONLY the coarse lex:write (no contract verb at all) — the
// exact bypass shape design v2 §4.4 closes — is DENIED via legal-officer in the
// headline test above. Tenant admins configure the suite but do not inherit the
// legal contract matrix, while a pure lex:read holder remains denied.
func TestContractWorkflowDecision_OtherBareWriteHoldersDenied(t *testing.T) {
	if got := serveContractReview([]string{"tenant_admin"}); got != http.StatusForbidden {
		t.Errorf("tenant_admin (configuration only) on workflow-decision: got %d, want 403", got)
	}
	// legal-auditor is read-only (no lex:write, no contract verb beyond view) -> DENIED.
	if got := serveContractReview([]string{"legal-auditor"}); got != http.StatusForbidden {
		t.Errorf("legal-auditor (view/read only) on workflow-decision: got %d, want 403", got)
	}
	// super_admin (admin:* wildcard) still passes.
	if got := serveContractReview([]string{"super_admin"}); got != http.StatusOK {
		t.Errorf("super_admin (admin:* wildcard) on workflow-decision: got %d, want 200", got)
	}
}

// TestContractWorkflowDecision_RouterWiring is an integration-level check that the
// gate is actually wired onto the route path the handler serves (not just that the
// middleware exists): a legal-officer hitting the decision path through a router
// that uses contractReviewGate is 403'd before the handler runs.
func TestContractWorkflowDecision_RouterWiring(t *testing.T) {
	r := chi.NewRouter()
	gated := r.With(contractReviewGate())
	handlerRan := false
	gated.Post("/workflows/{workflowInstanceID}/tasks/{taskID}/decision", func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/workflows/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000002/decision", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000a",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    []string{"legal-officer"},
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req.WithContext(ctx))

	if rec.Code != http.StatusForbidden {
		t.Errorf("legal-officer on wired decision route: got %d, want 403", rec.Code)
	}
	if handlerRan {
		t.Error("handler ran for a denied legal-officer request; gate did not block before the handler")
	}
}
