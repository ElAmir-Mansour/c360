package appconsistent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// stubAPI implements the router's API surface.
type stubAPI struct {
	barrier     *Barrier
	triggerErr  error
	barriers    []*Barrier
	listErr     error
	gotTenant   uuid.UUID
	gotGroup    uuid.UUID
	gotProvider string
}

func (s *stubAPI) TriggerAppConsistentPoint(_ context.Context, tenantID, groupID uuid.UUID, in TriggerRequest) (*Barrier, error) {
	s.gotTenant = tenantID
	s.gotGroup = groupID
	s.gotProvider = in.Provider
	return s.barrier, s.triggerErr
}

func (s *stubAPI) ListConsistencyBarriers(_ context.Context, tenantID, groupID uuid.UUID) ([]*Barrier, error) {
	s.gotTenant = tenantID
	s.gotGroup = groupID
	return s.barriers, s.listErr
}

func withUser(req *http.Request, tenantID, userID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: userID.String(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_Trigger_Created(t *testing.T) {
	groupID := uuid.New()
	rp := uuid.NewString()
	api := &stubAPI{barrier: &Barrier{
		ID:               uuid.NewString(),
		GroupID:          groupID.String(),
		ConsistencyLevel: ConsistencyApplication,
		Provider:         ProviderScript,
		RecoveryPointID:  &rp,
		Success:          true,
		Quiesced:         true,
		Thawed:           true,
	}}
	router := NewHandler(api, zerolog.Nop()).Routes()
	tenantID := uuid.New()

	body := strings.NewReader(`{"provider":"script","script":{"freeze_cmd":"true","thaw_cmd":"true"}}`)
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/app-consistent-point", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: got %d want 201; body=%s", rec.Code, rec.Body.String())
	}
	if api.gotGroup != groupID || api.gotTenant != tenantID {
		t.Fatalf("group/tenant not threaded: group=%s tenant=%s", api.gotGroup, api.gotTenant)
	}
	if api.gotProvider != ProviderScript {
		t.Fatalf("provider not decoded: %q", api.gotProvider)
	}
	var decoded struct {
		Data Barrier `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if decoded.Data.ConsistencyLevel != ConsistencyApplication {
		t.Fatalf("consistency level = %q, want %q", decoded.Data.ConsistencyLevel, ConsistencyApplication)
	}
}

func TestRouter_Trigger_Forbidden(t *testing.T) {
	groupID := uuid.New()
	api := &stubAPI{barrier: &Barrier{}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/app-consistent-point", nil)
	rec := httptest.NewRecorder()
	// viewer has dr:read but NOT dr:failover — the trigger must be gated.
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: got %d want 403; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Trigger_QuiesceFailedConflict(t *testing.T) {
	groupID := uuid.New()
	failed := &Barrier{
		GroupID:          groupID.String(),
		ConsistencyLevel: ConsistencyCrash,
		Provider:         ProviderScript,
		Success:          false,
		Error:            "device busy",
	}
	api := &stubAPI{
		barrier:    failed,
		triggerErr: errors.Join(ErrQuiesceFailed, errors.New("device busy")),
	}
	router := NewHandler(api, zerolog.Nop()).Routes()

	body := strings.NewReader(`{"provider":"script","script":{"freeze_cmd":"false","thaw_cmd":"true"}}`)
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/app-consistent-point", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status: got %d want 409; body=%s", rec.Code, rec.Body.String())
	}
	// The recorded barrier must be returned in the (flat) error details.
	var decoded struct {
		Code    string  `json:"code"`
		Details Barrier `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if decoded.Code != "quiesce_failed" {
		t.Fatalf("error code = %q, want quiesce_failed", decoded.Code)
	}
	if decoded.Details.ConsistencyLevel != ConsistencyCrash {
		t.Fatalf("returned barrier consistency = %q, want crash", decoded.Details.ConsistencyLevel)
	}
}

func TestRouter_ListBarriers(t *testing.T) {
	groupID := uuid.New()
	rp := uuid.NewString()
	api := &stubAPI{barriers: []*Barrier{
		{ID: "b2", GroupID: groupID.String(), ConsistencyLevel: ConsistencyApplication, Provider: ProviderHTTP, RecoveryPointID: &rp, Success: true, Quiesced: true, Thawed: true},
		{ID: "b1", GroupID: groupID.String(), ConsistencyLevel: ConsistencyCrash, Provider: ProviderNone},
	}}
	router := NewHandler(api, zerolog.Nop()).Routes()
	tenantID := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/consistency-barriers", nil)
	rec := httptest.NewRecorder()
	// viewer (dr:read) is sufficient for the listing.
	router.ServeHTTP(rec, withUser(req, tenantID, uuid.New(), "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rec.Code, rec.Body.String())
	}
	if api.gotGroup != groupID || api.gotTenant != tenantID {
		t.Fatalf("group/tenant not threaded: group=%s tenant=%s", api.gotGroup, api.gotTenant)
	}
	var decoded struct {
		Data []Barrier `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if len(decoded.Data) != 2 {
		t.Fatalf("got %d barriers, want 2", len(decoded.Data))
	}
	if decoded.Data[0].ID != "b2" {
		t.Fatalf("first barrier = %q, want b2", decoded.Data[0].ID)
	}
}

func TestRouter_ListBarriers_BadGroupID(t *testing.T) {
	api := &stubAPI{}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/not-a-uuid/consistency-barriers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400; body=%s", rec.Code, rec.Body.String())
	}
}
