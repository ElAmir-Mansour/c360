package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
)

const (
	saTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	saRecord = "33333333-0000-0000-0000-000000000001"
	saActor  = "44444444-0000-0000-0000-00000000000a"
	saAuthor = "44444444-0000-0000-0000-00000000000b"
)

// statusGuardRouter exercises enforceStatusElevation exactly as the real
// /legal-cases/{id}/status (caseEdit) route does: the route is gated on the EDIT
// tier upstream, and the handler then re-gates the close/approve-class targets on
// the elevated key. The {id} path param carries the record id so the dynamic-SoD
// (author != actor) parity check can resolve the target.
func statusGuardRouter(elev statusElevation, lookup authorLookup) http.Handler {
	r := chi.NewRouter()
	r.Post("/x/{id}/status", func(w http.ResponseWriter, req *http.Request) {
		status := req.URL.Query().Get("status")
		if !enforceStatusElevation(w, req, elev, status, lookup) {
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	return r
}

func serveStatus(h http.Handler, actor, record, status string, roles []string) int {
	req := httptest.NewRequest(http.MethodPost, "/x/"+record+"/status?status="+status, nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{ID: actor, TenantID: saTenant, Roles: roles})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

// authorIs returns a lookup reporting a fixed author for any record.
func authorIs(author string) authorLookup {
	a := uuid.MustParse(author)
	return func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, bool, error) {
		return a, true, nil
	}
}

// TestStatusElevation_CaseClose is the headline FSM-status-route bypass assertion
// (design v2 §4.4 / acceptance bullets 1, 2, 7): a holder of ONLY lex:case:edit
// (+ coarse lex:write) is DENIED closing a case via /status, while a holder of
// lex:case:close is ALLOWED.
func TestStatusElevation_CaseClose(t *testing.T) {
	h := statusGuardRouter(caseStatusElevation, authorIs(saAuthor))

	// legal-officer holds lex:case:edit AND coarse lex:write but NOT lex:case:close.
	// The edit tier admitted the request to the route; the handler must still 403 a
	// close-class transition. THIS is the closed bypass.
	if got := serveStatus(h, saActor, saRecord, "closed", []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("officer (edit+write, no case:close) closing via /status: got %d, want 403", got)
	}
	// 'cancelled' is also a close-class terminal — same denial.
	if got := serveStatus(h, saActor, saRecord, "cancelled", []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("officer cancelling via /status: got %d, want 403", got)
	}
	// legal-cases-manager holds lex:case:close and is NOT the author -> allowed.
	if got := serveStatus(h, saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("cases-manager (case:close, distinct actor) closing via /status: got %d, want 200", got)
	}
}

// TestStatusElevation_CaseEditClassUnaffected confirms ordinary edit-class
// transitions stay on the edit tier: a legal-officer may still drive intake ->
// open via /status (no elevated key required).
func TestStatusElevation_CaseEditClassUnaffected(t *testing.T) {
	h := statusGuardRouter(caseStatusElevation, authorIs(saAuthor))
	for _, s := range []string{"open", "phase1", "phase2", "under_procedure", "on_hold"} {
		if got := serveStatus(h, saActor, saRecord, s, []string{"legal-officer"}); got != http.StatusOK {
			t.Errorf("officer edit-class transition -> %s: got %d, want 200", s, got)
		}
	}
}

// TestStatusElevation_InvestigationApproveAndClose proves the approve-class vs
// close-class distinction on the investigation /status route: a close-class target
// requires lex:investigation:close and an approve-class target requires
// lex:investigation:approve — NEITHER accepts the edit/lex:write tier.
func TestStatusElevation_InvestigationApproveAndClose(t *testing.T) {
	h := statusGuardRouter(investigationStatusElevation, authorIs(saAuthor))

	// Officer (edit+write only) denied on both an approve-class and a close-class target.
	if got := serveStatus(h, saActor, saRecord, "approved", []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("officer approving investigation via /status: got %d, want 403", got)
	}
	if got := serveStatus(h, saActor, saRecord, "closed", []string{"legal-officer"}); got != http.StatusForbidden {
		t.Errorf("officer closing investigation via /status: got %d, want 403", got)
	}
	// Manager holds investigation:approve + investigation:close -> allowed on both.
	if got := serveStatus(h, saActor, saRecord, "approved", []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("manager approving investigation via /status: got %d, want 200", got)
	}
	if got := serveStatus(h, saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("manager closing investigation via /status: got %d, want 200", got)
	}
}

// TestStatusElevation_DistinctActorParity proves dynamic-SoD parity (design v2
// §4.2): even a holder of the elevated close key is 403'd when they AUTHORED the
// record (author != actor), exactly like lexmw.RequireDistinctActor on the
// dedicated approve/close routes.
func TestStatusElevation_DistinctActorParity(t *testing.T) {
	// The acting cases-manager is ALSO the record's author.
	h := statusGuardRouter(caseStatusElevation, authorIs(saActor))
	if got := serveStatus(h, saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("author with case:close closing own record via /status: got %d, want 403 (SoD)", got)
	}
	// A distinct manager (not the author) is allowed.
	h2 := statusGuardRouter(caseStatusElevation, authorIs(saAuthor))
	if got := serveStatus(h2, saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("distinct manager closing via /status: got %d, want 200", got)
	}
}

// TestStatusElevation_DistinctActorFailsClosed: a close/approve-class transition
// whose author cannot be resolved is DENIED (the guard never opens without proving
// author != actor), and a resolver error surfaces as 500.
func TestStatusElevation_DistinctActorFailsClosed(t *testing.T) {
	notFound := func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, bool, error) {
		return uuid.Nil, false, nil
	}
	if got := serveStatus(statusGuardRouter(caseStatusElevation, notFound), saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusForbidden {
		t.Errorf("unresolved author closing via /status: got %d, want 403", got)
	}

	boom := func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, bool, error) {
		return uuid.Nil, false, errors.New("registry down")
	}
	if got := serveStatus(statusGuardRouter(caseStatusElevation, boom), saActor, saRecord, "closed", []string{"legal-cases-manager"}); got != http.StatusInternalServerError {
		t.Errorf("resolver error closing via /status: got %d, want 500", got)
	}
}
