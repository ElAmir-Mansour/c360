package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// distinctActorChain replicates the real lex approve/close route chain: the
// per-domain RBAC gate (RequirePermission(lex:case:approve), NO coarse fallback —
// design v2 §4.4) followed by the dynamic-SoD guard (RequireDistinctActor,
// §4.2). The {id} path param carries the target record id, exactly as on the live
// /legal-cases/{id}/... approve routes.
func distinctActorChain(resolver ActorRecordResolver) http.Handler {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r := chi.NewRouter()
	r.With(
		sharedmw.RequirePermission(auth.PermLexCaseApprove),
		RequireDistinctActor(resolver, "id"),
	).Post("/legal-cases/{id}/decision", final)
	return r
}

// serveDecision drives a POST .../{recordID}/decision as userID carrying roles.
func serveDecision(h http.Handler, userID, recordID string, roles []string) int {
	req := httptest.NewRequest(http.MethodPost, "/legal-cases/"+recordID+"/decision", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       userID,
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

const (
	daAuthor   = "11111111-0000-0000-0000-00000000000a"
	daApprover = "11111111-0000-0000-0000-00000000000b"
	daRecord   = "22222222-0000-0000-0000-000000000001"
)

// staticResolver returns a fixed author + prior approvers for any record id.
func staticResolver(author uuid.UUID, prior ...uuid.UUID) ActorRecordResolver {
	return func(_ context.Context, _, _ uuid.UUID) (ActorRecord, bool, error) {
		return ActorRecord{CreatedBy: author, PriorApprovers: prior}, true, nil
	}
}

// TestDistinctActor_AuthorDeniedApprove is the headline dynamic-SoD assertion: a
// user who holds the case-approve CAPABILITY (legal-cases-manager) is nonetheless
// 403'd when they are the record's AUTHOR — author != approver, design v2 §4.2.
func TestDistinctActor_AuthorDeniedApprove(t *testing.T) {
	h := distinctActorChain(staticResolver(uuid.MustParse(daAuthor)))

	// The author holds case:approve (manager role) but authored THIS record -> 403.
	if got := serveDecision(h, daAuthor, daRecord, []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("author approving own record: got %d, want 403 (SoD conflict)", got)
	}
	// A DIFFERENT approver with the same capability is allowed -> 200.
	if got := serveDecision(h, daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("distinct approver: got %d, want 200", got)
	}
}

// TestDistinctActor_PriorApproverDeniedRepeat: the two-round memo needs two
// DISTINCT approvers — a user who already approved a prior step cannot approve
// again (design v2 §4.2 / CAP Defendant §5.4).
func TestDistinctActor_PriorApproverDeniedRepeat(t *testing.T) {
	// Author is someone else; daApprover already signed a prior step.
	h := distinctActorChain(staticResolver(uuid.MustParse(daAuthor), uuid.MustParse(daApprover)))

	if got := serveDecision(h, daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("prior approver repeating: got %d, want 403 (two distinct approvers required)", got)
	}
	// A third, fresh approver passes.
	fresh := "11111111-0000-0000-0000-00000000000c"
	if got := serveDecision(h, fresh, daRecord, []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("fresh second approver: got %d, want 200", got)
	}
}

// TestDistinctActor_RBACStillGates confirms the guard layers ON TOP of RBAC and
// does not weaken it: a legal-officer (no case:approve, only edit) is blocked by
// the RBAC gate BEFORE the SoD guard runs — even on a record they did NOT author.
func TestDistinctActor_RBACStillGates(t *testing.T) {
	h := distinctActorChain(staticResolver(uuid.MustParse(daAuthor)))
	if got := serveDecision(h, daApprover, daRecord, []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("officer (no case:approve) on decision: got %d, want 403", got)
	}
}

// TestDistinctActor_FailsClosed: every unresolved-record path DENIES (the guard
// can never prove author != approver, so it must not open).
func TestDistinctActor_FailsClosed(t *testing.T) {
	// Record not found -> 403.
	notFound := func(_ context.Context, _, _ uuid.UUID) (ActorRecord, bool, error) {
		return ActorRecord{}, false, nil
	}
	if got := serveDecision(distinctActorChain(notFound), daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("record not found: got %d, want 403", got)
	}

	// Resolver error -> 500 (fail closed, but distinct from a SoD verdict).
	boom := func(_ context.Context, _, _ uuid.UUID) (ActorRecord, bool, error) {
		return ActorRecord{}, false, errors.New("registry down")
	}
	if got := serveDecision(distinctActorChain(boom), daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusInternalServerError {
		t.Errorf("resolver error: got %d, want 500", got)
	}

	// Record with no author (uuid.Nil) -> 403 (cannot prove distinctness).
	noAuthor := staticResolver(uuid.Nil)
	if got := serveDecision(distinctActorChain(noAuthor), daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("record without author: got %d, want 403", got)
	}

	// Nil resolver (mis-wired guard) -> 403, never open.
	if got := serveDecision(distinctActorChain(nil), daApprover, daRecord, []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("nil resolver: got %d, want 403", got)
	}
}
