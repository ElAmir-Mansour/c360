package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
)

// fakeSubstitutionService is a minimal substitutionService double. It records the
// last set/clear target so the tests can assert the write actually reached the
// service (i.e. was NOT rejected by the fail-closed cross-user guard).
type fakeSubstitutionService struct {
	setForUser   string
	clearForUser string
	setCalls     int
	clearCalls   int
}

func (f *fakeSubstitutionService) SetSubstitution(_ context.Context, tenantID, userID, deputyID string, from, to time.Time, reason, createdBy string) (*model.Substitution, error) {
	f.setCalls++
	f.setForUser = userID
	return &model.Substitution{ID: "sub-1", TenantID: tenantID, UserID: userID, DeputyID: deputyID}, nil
}

func (f *fakeSubstitutionService) ClearSubstitution(_ context.Context, tenantID, userID string) error {
	f.clearCalls++
	f.clearForUser = userID
	return nil
}

func (f *fakeSubstitutionService) ListForUser(context.Context, string, string) ([]*model.Substitution, error) {
	return []*model.Substitution{}, nil
}

const (
	subTenant = "tenant-1"
	subSelf   = "user-self"
	subOther  = "user-other"
	subDeputy = "user-deputy"
)

// subReq builds a request carrying an authenticated caller with the given roles,
// served through the handler's own chi router so /users/{userId} resolves the
// URL param exactly as in production.
func serveSub(h *SubstitutionHandler, method, target, body string, caller *auth.ContextUser) *httptest.ResponseRecorder {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	r = r.WithContext(auth.WithUser(r.Context(), caller))
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, r)
	return rec
}

func setBody(deputyID string) string {
	return `{"deputy_id":"` + deputyID + `","from":"2026-07-02T00:00:00Z","to":"2026-07-09T00:00:00Z","reason":"vacation"}`
}

// TestSubstitution_SelfServiceSucceeds proves a non-admin caller with only the
// base write verb may set/clear their OWN deputy window via /me.
func TestSubstitution_SelfServiceSucceeds(t *testing.T) {
	svc := &fakeSubstitutionService{}
	h := NewSubstitutionHandler(svc, zerolog.Nop())
	// A caller carrying no admin role — pure self-service.
	caller := &auth.ContextUser{ID: subSelf, TenantID: subTenant, Roles: []string{"analyst"}}

	rec := serveSub(h, http.MethodPut, "/me", setBody(subDeputy), caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /me self-service: status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.setCalls != 1 || svc.setForUser != subSelf {
		t.Fatalf("PUT /me should set for self: calls=%d target=%q", svc.setCalls, svc.setForUser)
	}

	rec = serveSub(h, http.MethodDelete, "/me", "", caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE /me self-service: status = %d, want 200", rec.Code)
	}
	if svc.clearCalls != 1 || svc.clearForUser != subSelf {
		t.Fatalf("DELETE /me should clear for self: calls=%d target=%q", svc.clearCalls, svc.clearForUser)
	}
}

// TestSubstitution_SelfViaUsersRouteSucceeds proves that even the admin-style
// /users/{userId} route succeeds without workflow:admin when the target IS the
// caller (targetUserID == caller.ID falls under self-service).
func TestSubstitution_SelfViaUsersRouteSucceeds(t *testing.T) {
	svc := &fakeSubstitutionService{}
	h := NewSubstitutionHandler(svc, zerolog.Nop())
	caller := &auth.ContextUser{ID: subSelf, TenantID: subTenant, Roles: []string{"analyst"}}

	rec := serveSub(h, http.MethodPut, "/users/"+subSelf, setBody(subDeputy), caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /users/{self}: status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.setForUser != subSelf {
		t.Fatalf("PUT /users/{self} target = %q, want %q", svc.setForUser, subSelf)
	}
}

// TestSubstitution_NonAdminTargetingOtherForbidden is the core fail-closed test:
// a caller WITHOUT workflow:admin gets 403 when setting OR clearing ANOTHER
// user's deputy, and the service is never invoked.
func TestSubstitution_NonAdminTargetingOtherForbidden(t *testing.T) {
	svc := &fakeSubstitutionService{}
	h := NewSubstitutionHandler(svc, zerolog.Nop())
	// workflow:write floor but NOT workflow:admin.
	caller := &auth.ContextUser{ID: subSelf, TenantID: subTenant, Roles: []string{"analyst"}}

	rec := serveSub(h, http.MethodPut, "/users/"+subOther, setBody(subDeputy), caller)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PUT /users/{other} non-admin: status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	rec = serveSub(h, http.MethodDelete, "/users/"+subOther, "", caller)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("DELETE /users/{other} non-admin: status = %d, want 403", rec.Code)
	}
	if svc.setCalls != 0 || svc.clearCalls != 0 {
		t.Fatalf("service must not be invoked on forbidden cross-user write: set=%d clear=%d", svc.setCalls, svc.clearCalls)
	}
}

// TestSubstitution_AdminTargetingOtherSucceeds proves a caller holding
// workflow:admin may set/clear ANOTHER user's deputy, and the write reaches the
// service with the correct (other) target.
func TestSubstitution_AdminTargetingOtherSucceeds(t *testing.T) {
	svc := &fakeSubstitutionService{}
	h := NewSubstitutionHandler(svc, zerolog.Nop())
	// A role that grants workflow:admin (via HasPermission).
	caller := &auth.ContextUser{ID: subSelf, TenantID: subTenant, Roles: []string{"tenant_admin"}}
	if !auth.HasPermission(caller.Roles, auth.PermWorkflowAdmin) {
		t.Fatalf("test setup: role %v should grant %s", caller.Roles, auth.PermWorkflowAdmin)
	}

	rec := serveSub(h, http.MethodPut, "/users/"+subOther, setBody(subDeputy), caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /users/{other} admin: status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.setForUser != subOther {
		t.Fatalf("admin PUT /users/{other} target = %q, want %q", svc.setForUser, subOther)
	}

	rec = serveSub(h, http.MethodDelete, "/users/"+subOther, "", caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE /users/{other} admin: status = %d, want 200", rec.Code)
	}
	if svc.clearForUser != subOther {
		t.Fatalf("admin DELETE /users/{other} target = %q, want %q", svc.clearForUser, subOther)
	}
}
