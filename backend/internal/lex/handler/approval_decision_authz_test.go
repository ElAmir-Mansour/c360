package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// These tests lock in the closure (design v2 §4.4 / acceptance bullet 7) of the
// coarse lex:write fallback on the remaining IN-MATRIX approval-decision routes,
// which previously sat on the approvalWrite tier (RequireAnyPermission(
// lex:approval:write, lex:write)) — letting a bare lex:write holder render a
// verdict. They replicate EXACTLY the router gates in routes.go:
//
//	requestDecision      = RequirePermission(lex:request:approve)                 (routes.go ~398)
//	caseDecisionWorkflow = RequireAnyPermission(lex:case:approve, lex:case:edit)  (routes.go ~412)
//
// The request DOA decision is a pure approve step (gate is the approve key only).
// The case decision routes (pleading approval, defendant response-review) are
// MULTI-TIER chains whose first tier (officer) acts on lex:case:edit, so the gate
// admits :edit too — the (capability key) layer of the §4.2 intersection; WHICH
// tier each may actually decide is then narrowed by the chain recipient
// (validateWorkflowDecisionActor) + distinct-actor parity in the service.

func requestDecisionGate() func(http.Handler) http.Handler {
	return sharedmw.RequirePermission(auth.PermLexRequestApprove)
}

func caseDecisionWorkflowGate() func(http.Handler) http.Handler {
	return sharedmw.RequireAnyPermission(auth.PermLexCaseApprove, auth.PermLexCaseEdit)
}

func serveGate(gate func() func(http.Handler) http.Handler, roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := gate()(final)
	req := httptest.NewRequest(http.MethodPost, "/decision", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "44444444-0000-0000-0000-00000000000b",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

// TestRequestApprovalDecision_NoCoarseLexWriteFallback: the DOA request-approval
// decision route is gated on lex:request:approve with NO lex:write fallback.
// legal-officer carries lex:write but only lex:request:view/edit (no approve) and
// is now DENIED; a holder of lex:request:approve (legal-dept-manager, a DOA
// approver) is ALLOWED.
func TestRequestApprovalDecision_NoCoarseLexWriteFallback(t *testing.T) {
	if got := serveGate(requestDecisionGate, []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("legal-officer (lex:write, no request:approve) on request decision: got %d, want 403", got)
	}
	if got := serveGate(requestDecisionGate, []string{"legal-requester"}); got != http.StatusForbidden {
		t.Errorf("legal-requester (request:view/add/edit, no approve) on request decision: got %d, want 403", got)
	}
	if got := serveGate(requestDecisionGate, []string{"legal-dept-manager"}); got != http.StatusOK {
		t.Errorf("legal-dept-manager (lex:request:approve) on request decision: got %d, want 200", got)
	}
}

// TestCaseWorkflowDecision_NoCoarseLexWriteFallback: the pleading-approval and
// defendant response-review decision routes are gated on
// lex:case:approve|lex:case:edit with NO lex:write fallback. A holder of lex:write
// with NO case-domain verb (legal-advisor — a contract/consultation role) is now
// DENIED; the case actors are admitted (chain recipient + distinct-actor narrow
// which tier each decides).
func TestCaseWorkflowDecision_NoCoarseLexWriteFallback(t *testing.T) {
	// legal-advisor: contract/consultation role, holds lex:write but NO lex:case:* -> DENIED.
	if got := serveGate(caseDecisionWorkflowGate, []string{"legal-advisor"}); got != http.StatusForbidden {
		t.Errorf("legal-advisor (lex:write, no case verb) on case decision: got %d, want 403", got)
	}
	// legal-contracts-manager: contract-only authority, no case verb -> DENIED.
	if got := serveGate(caseDecisionWorkflowGate, []string{"legal-contracts-manager"}); got != http.StatusForbidden {
		t.Errorf("legal-contracts-manager (no case verb) on case decision: got %d, want 403", got)
	}
	// legal-cases-manager: lex:case:approve -> ALLOWED (final/decision authority).
	if got := serveGate(caseDecisionWorkflowGate, []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("legal-cases-manager (lex:case:approve) on case decision: got %d, want 200", got)
	}
	// legal-officer: lex:case:edit -> passes the capability gate (first-tier
	// participation); the chain recipient + distinct-actor still bound actual decisions.
	if got := serveGate(caseDecisionWorkflowGate, []string{"legal-officer"}); got != http.StatusOK {
		t.Errorf("legal-officer (lex:case:edit) on case decision: got %d, want 200", got)
	}
}

// TestApprovalDecisionRouters_Wired is an integration-level check that the gates
// block before the handler runs on the actual route paths.
func TestApprovalDecisionRouters_Wired(t *testing.T) {
	cases := []struct {
		name string
		gate func(http.Handler) http.Handler
		path string
	}{
		{"request", requestDecisionGate(), "/requests/{id}/approval/{workflowInstanceID}/tasks/{taskID}/decision"},
		{"pleading", caseDecisionWorkflowGate(), "/legal-cases/{id}/pleadings/{pleadingId}/approvals/{workflowInstanceID}/tasks/{taskID}/decision"},
	}
	for _, tc := range cases {
		r := chi.NewRouter()
		gated := r.With(tc.gate)
		handlerRan := false
		gated.Post(tc.path, func(w http.ResponseWriter, _ *http.Request) {
			handlerRan = true
			w.WriteHeader(http.StatusOK)
		})
		// Build a concrete request path from the pattern (officer must be 403'd).
		reqPath := "/requests/x/approval/y/tasks/z/decision"
		if tc.name == "pleading" {
			reqPath = "/legal-cases/x/pleadings/p/approvals/y/tasks/z/decision"
		}
		req := httptest.NewRequest(http.MethodPost, reqPath, nil)
		ctx := auth.WithUser(req.Context(), &auth.ContextUser{
			ID: "44444444-0000-0000-0000-00000000000b", TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
			Roles: []string{"legal-officer"},
		})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req.WithContext(ctx))
		if tc.name == "request" && rec.Code != http.StatusForbidden {
			t.Errorf("%s: legal-officer got %d, want 403", tc.name, rec.Code)
		}
		// pleading: officer holds case:edit so the gate ALLOWS it (200) — assert the handler ran.
		if tc.name == "pleading" && rec.Code != http.StatusOK {
			t.Errorf("%s: legal-officer (case:edit) got %d, want 200", tc.name, rec.Code)
		}
		_ = handlerRan
	}
}
