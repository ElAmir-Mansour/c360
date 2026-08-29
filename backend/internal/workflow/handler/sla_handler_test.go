package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

const (
	slaHTenant = "tenant-1"
	slaHUser   = "user-1"
)

// ---------------------------------------------------------------------------
// Fakes implementing the handler's service interfaces.
// ---------------------------------------------------------------------------

type fakePolicyService struct {
	created                                          *repository.SLAPolicyRecord
	got                                              *repository.SLAPolicyRecord
	list                                             []*repository.SLAPolicyRecord
	updated                                          *repository.SLAPolicyRecord
	createErr, getErr, updateErr, deleteErr, listErr error

	gotTenant, gotUser, gotID string
	deletedID                 string
}

func (f *fakePolicyService) CreatePolicy(_ context.Context, tenantID, userID string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error) {
	f.gotTenant, f.gotUser = tenantID, userID
	if f.createErr != nil {
		return nil, f.createErr
	}
	p.ID = "policy-new"
	p.TenantID = tenantID
	p.CreatedBy = userID
	f.created = p
	return p, nil
}

func (f *fakePolicyService) GetPolicy(_ context.Context, tenantID, id string) (*repository.SLAPolicyRecord, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.got, nil
}

func (f *fakePolicyService) ListPolicies(_ context.Context, tenantID string) ([]*repository.SLAPolicyRecord, error) {
	f.gotTenant = tenantID
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.list, nil
}

func (f *fakePolicyService) UpdatePolicy(_ context.Context, tenantID, id string, p *repository.SLAPolicyRecord) (*repository.SLAPolicyRecord, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	p.ID = id
	f.updated = p
	return p, nil
}

func (f *fakePolicyService) DeletePolicy(_ context.Context, tenantID, id string) error {
	f.gotTenant, f.deletedID = tenantID, id
	return f.deleteErr
}

type fakeCalendarService struct {
	got                                              *repository.CalendarRecord
	list                                             []*repository.CalendarRecord
	createErr, getErr, updateErr, deleteErr, listErr error

	gotTenant, gotUser, gotID string
}

func (f *fakeCalendarService) CreateCalendar(_ context.Context, tenantID, userID string, c *repository.CalendarRecord) (*repository.CalendarRecord, error) {
	f.gotTenant, f.gotUser = tenantID, userID
	if f.createErr != nil {
		return nil, f.createErr
	}
	c.ID = "cal-new"
	c.TenantID = tenantID
	c.CreatedBy = userID
	return c, nil
}

func (f *fakeCalendarService) GetCalendar(_ context.Context, tenantID, id string) (*repository.CalendarRecord, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.got, nil
}

func (f *fakeCalendarService) ListCalendars(_ context.Context, tenantID string) ([]*repository.CalendarRecord, error) {
	f.gotTenant = tenantID
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.list, nil
}

func (f *fakeCalendarService) UpdateCalendar(_ context.Context, tenantID, id string, c *repository.CalendarRecord) (*repository.CalendarRecord, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	c.ID = id
	return c, nil
}

func (f *fakeCalendarService) DeleteCalendar(_ context.Context, tenantID, id string) error {
	f.gotTenant, f.gotID = tenantID, id
	return f.deleteErr
}

func withUser(req *http.Request) *http.Request {
	return req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: slaHUser, TenantID: slaHTenant}))
}

func newSLAHandler(p slaPolicyService, c slaCalendarService) *SLAHandler {
	return NewSLAHandler(p, c, zerolog.Nop())
}

// ---------------------------------------------------------------------------
// SLA policy routes.
// ---------------------------------------------------------------------------

func TestSLAHandler_CreatePolicy(t *testing.T) {
	pol := &fakePolicyService{}
	h := newSLAHandler(pol, &fakeCalendarService{})

	body := `{"name":"Approval SLA","description":"d","tiers":[{"after_seconds":3600,"notify":"role:lead","action":"notify"}],"remind_before":[900]}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body)))
	rec := httptest.NewRecorder()

	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, slaHTenant, pol.gotTenant)
	require.Equal(t, slaHUser, pol.gotUser)
	require.NotNil(t, pol.created)
	require.Len(t, pol.created.Tiers, 1)
	require.Equal(t, int64(3600), pol.created.Tiers[0].AfterSeconds)
	require.Equal(t, "role:lead", pol.created.Tiers[0].Notify)
	require.Equal(t, []int64{900}, pol.created.RemindBefore)

	var resp slaPolicyResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, "policy-new", resp.ID)
	require.Len(t, resp.Tiers, 1)
}

func TestSLAHandler_CreatePolicy_ValidationError(t *testing.T) {
	pol := &fakePolicyService{createErr: errorString("policy must declare at least one tier (invalid empty tiers)")}
	h := newSLAHandler(pol, &fakeCalendarService{})

	req := withUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"X","tiers":[]}`)))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSLAHandler_CreatePolicy_Conflict(t *testing.T) {
	pol := &fakePolicyService{createErr: model.ErrConflict}
	h := newSLAHandler(pol, &fakeCalendarService{})

	body := `{"name":"dup","tiers":[{"after_seconds":3600,"notify":"role:lead","action":"notify"}]}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body)))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusConflict, rec.Code)
}

func TestSLAHandler_CreatePolicy_Unauthorized(t *testing.T) {
	h := newSLAHandler(&fakePolicyService{}, &fakeCalendarService{})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`)) // no user
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestSLAHandler_ListPolicies(t *testing.T) {
	pol := &fakePolicyService{list: []*repository.SLAPolicyRecord{
		{ID: "p1", Name: "P1", Tiers: []repository.SLATierJSON{{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"}}},
		{ID: "p2", Name: "P2"},
	}}
	h := newSLAHandler(pol, &fakeCalendarService{})

	req := withUser(httptest.NewRequest(http.MethodGet, "/", nil))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, slaHTenant, pol.gotTenant)
	var resp struct {
		Policies []slaPolicyResponse `json:"sla_policies"`
		Total    int                 `json:"total"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, 2, resp.Total)
	require.Len(t, resp.Policies, 2)
}

func TestSLAHandler_GetPolicy(t *testing.T) {
	pol := &fakePolicyService{got: &repository.SLAPolicyRecord{ID: "p1", Name: "P1"}}
	h := newSLAHandler(pol, &fakeCalendarService{})

	req := withUser(httptest.NewRequest(http.MethodGet, "/p1", nil))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "p1", pol.gotID)
}

func TestSLAHandler_GetPolicy_NotFound(t *testing.T) {
	pol := &fakePolicyService{getErr: model.ErrNotFound}
	h := newSLAHandler(pol, &fakeCalendarService{})

	req := withUser(httptest.NewRequest(http.MethodGet, "/missing", nil))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSLAHandler_UpdatePolicy(t *testing.T) {
	pol := &fakePolicyService{}
	h := newSLAHandler(pol, &fakeCalendarService{})

	body := `{"name":"Updated","tiers":[{"after_seconds":7200,"notify":"role:ops","action":"reassign"}]}`
	req := withUser(httptest.NewRequest(http.MethodPut, "/p1", bytes.NewBufferString(body)))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "p1", pol.gotID)
	require.NotNil(t, pol.updated)
	require.Equal(t, "Updated", pol.updated.Name)
	require.Equal(t, "reassign", pol.updated.Tiers[0].Action)
}

func TestSLAHandler_DeletePolicy(t *testing.T) {
	pol := &fakePolicyService{}
	h := newSLAHandler(pol, &fakeCalendarService{})

	req := withUser(httptest.NewRequest(http.MethodDelete, "/p1", nil))
	rec := httptest.NewRecorder()
	h.PolicyRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, "p1", pol.deletedID)
}

// ---------------------------------------------------------------------------
// Calendar routes.
// ---------------------------------------------------------------------------

func TestSLAHandler_CreateCalendar(t *testing.T) {
	cal := &fakeCalendarService{}
	h := newSLAHandler(&fakePolicyService{}, cal)

	body := `{"name":"Riyadh","timezone":"Asia/Riyadh","working_days":{"0":{"start_minute":540,"end_minute":1020}},"holidays":["2026-09-23"],"is_default":true}`
	req := withUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body)))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, slaHTenant, cal.gotTenant)
	require.Equal(t, slaHUser, cal.gotUser)

	var resp calendarResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, "cal-new", resp.ID)
	require.Equal(t, "Asia/Riyadh", resp.Timezone)
	require.Equal(t, 540, resp.WorkingDays["0"].StartMinute)
	require.Equal(t, []string{"2026-09-23"}, resp.Holidays)
	require.True(t, resp.IsDefault)
}

func TestSLAHandler_CreateCalendar_ValidationError(t *testing.T) {
	cal := &fakeCalendarService{createErr: errorString("invalid timezone")}
	h := newSLAHandler(&fakePolicyService{}, cal)

	req := withUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"x","timezone":"Bad/Zone","working_days":{"0":{"start_minute":540,"end_minute":1020}}}`)))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSLAHandler_ListCalendars(t *testing.T) {
	cal := &fakeCalendarService{list: []*repository.CalendarRecord{
		{ID: "c1", Name: "C1", Timezone: "UTC"},
	}}
	h := newSLAHandler(&fakePolicyService{}, cal)

	req := withUser(httptest.NewRequest(http.MethodGet, "/", nil))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Calendars []calendarResponse `json:"calendars"`
		Total     int                `json:"total"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, 1, resp.Total)
	require.Equal(t, "c1", resp.Calendars[0].ID)
}

func TestSLAHandler_GetCalendar_NotFound(t *testing.T) {
	cal := &fakeCalendarService{getErr: model.ErrNotFound}
	h := newSLAHandler(&fakePolicyService{}, cal)

	req := withUser(httptest.NewRequest(http.MethodGet, "/missing", nil))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSLAHandler_UpdateCalendar(t *testing.T) {
	cal := &fakeCalendarService{}
	h := newSLAHandler(&fakePolicyService{}, cal)

	body := `{"name":"Updated","timezone":"UTC","working_days":{"1":{"start_minute":480,"end_minute":960}}}`
	req := withUser(httptest.NewRequest(http.MethodPut, "/c1", bytes.NewBufferString(body)))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "c1", cal.gotID)
}

func TestSLAHandler_DeleteCalendar(t *testing.T) {
	cal := &fakeCalendarService{}
	h := newSLAHandler(&fakePolicyService{}, cal)

	req := withUser(httptest.NewRequest(http.MethodDelete, "/c1", nil))
	rec := httptest.NewRecorder()
	h.CalendarRoutes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, "c1", cal.gotID)
}

// errorString is a tiny error whose message contains "invalid"/"required" so
// handleServiceError classifies it as a 400 VALIDATION_ERROR.
type errorString string

func (e errorString) Error() string { return string(e) }
