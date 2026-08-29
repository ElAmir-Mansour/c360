package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
)

// fakeIncidentService is a minimal incidentService double for the handler tests.
type fakeIncidentService struct {
	approveErr error
	skipErr    error
	approvedBy string
}

func (f *fakeIncidentService) ListIncidents(context.Context, string, string) ([]*model.Incident, error) {
	return nil, nil
}
func (f *fakeIncidentService) GetOpenIncident(context.Context, string, string) (*model.Incident, error) {
	return &model.Incident{ID: "inc-1", Status: model.IncidentStatusOpen}, nil
}
func (f *fakeIncidentService) RetryIncident(context.Context, string, string, string) error {
	return nil
}
func (f *fakeIncidentService) SkipIncidentStep(context.Context, string, string, string, string) error {
	return f.skipErr
}
func (f *fakeIncidentService) ModifyVariablesAndRetryIncident(context.Context, string, string, string, string) error {
	return nil
}
func (f *fakeIncidentService) AbandonIncident(context.Context, string, string, string, string) error {
	return nil
}
func (f *fakeIncidentService) RequestOverride(_ context.Context, tenantID, instanceID, requesterID, kind, reason string, _ map[string]interface{}) (*model.IncidentOverride, error) {
	return &model.IncidentOverride{ID: "ov-1", Kind: kind, RequestedBy: requesterID, Status: model.OverrideStatusPending}, nil
}
func (f *fakeIncidentService) ApproveOverride(_ context.Context, _, _, approverID string) (*model.IncidentOverride, error) {
	if f.approveErr != nil {
		return nil, f.approveErr
	}
	f.approvedBy = approverID
	return &model.IncidentOverride{ID: "ov-1", Status: model.OverrideStatusApproved, ApprovedBy: &approverID}, nil
}
func (f *fakeIncidentService) RejectOverride(context.Context, string, string, string, string) error {
	return nil
}
func (f *fakeIncidentService) ListDeadLetters(context.Context, string, int) ([]*model.DeadLetter, error) {
	return []*model.DeadLetter{{ID: "dl-1"}}, nil
}

func incidentReq(method, target, body string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	return r.WithContext(auth.WithUser(r.Context(), &auth.ContextUser{ID: "actor-1", TenantID: "tenant-1"}))
}

// TestIncidentHandler_RequestOverrideThenApprove exercises the happy maker-checker
// HTTP path: request a skip override, then a distinct checker approves.
func TestIncidentHandler_RequestOverrideThenApprove(t *testing.T) {
	svc := &fakeIncidentService{}
	h := NewIncidentHandler(svc, zerolog.Nop())

	// Maker requests a skip override.
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, incidentReq(http.MethodPost, "/instances/inst-1/overrides", `{"kind":"skip","reason":"bad step"}`))
	require.Equal(t, http.StatusCreated, rec.Code)

	// Distinct checker approves.
	rec2 := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec2, incidentReq(http.MethodPost, "/overrides/ov-1/approve", ""))
	require.Equal(t, http.StatusOK, rec2.Code)
	require.Equal(t, "actor-1", svc.approvedBy)
}

// TestIncidentHandler_SameActorApproveIsForbidden proves the fail-closed SoD
// error surfaces as HTTP 403 at the handler boundary.
func TestIncidentHandler_SameActorApproveIsForbidden(t *testing.T) {
	svc := &fakeIncidentService{approveErr: model.ErrSameActorOverride}
	h := NewIncidentHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, incidentReq(http.MethodPost, "/overrides/ov-1/approve", ""))
	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "SOD_VIOLATION")
}

// TestIncidentHandler_SkipWithoutApprovedOverrideIsForbidden proves a sensitive
// skip without an approved override is refused (403 OVERRIDE_REQUIRED).
func TestIncidentHandler_SkipWithoutApprovedOverrideIsForbidden(t *testing.T) {
	svc := &fakeIncidentService{skipErr: model.ErrOverrideRequired}
	h := NewIncidentHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, incidentReq(http.MethodPost, "/instances/inst-1/skip", `{"override_id":""}`))
	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "OVERRIDE_REQUIRED")
}

// TestIncidentHandler_ListDeadLetter returns the tenant dead-letter rows.
func TestIncidentHandler_ListDeadLetter(t *testing.T) {
	h := NewIncidentHandler(&fakeIncidentService{}, zerolog.Nop())
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, incidentReq(http.MethodGet, "/dead-letter", ""))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "dl-1")
}
