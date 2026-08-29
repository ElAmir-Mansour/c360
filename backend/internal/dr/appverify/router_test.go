package appverify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeQueryService implements appverifyService so the router's wiring, gating and
// error mapping are tested without a database.
type fakeQueryService struct {
	results    []StoredResult
	result     *StoredResult
	listErr    error
	getErr     error
	lastGroup  uuid.UUID
	lastID     uuid.UUID
	lastTenant uuid.UUID
}

func (f *fakeQueryService) ListByGroup(_ context.Context, tenantID, groupID uuid.UUID, _ int) ([]StoredResult, error) {
	f.lastTenant = tenantID
	f.lastGroup = groupID
	return f.results, f.listErr
}

func (f *fakeQueryService) GetByID(_ context.Context, tenantID, id uuid.UUID) (*StoredResult, error) {
	f.lastTenant = tenantID
	f.lastID = id
	return f.result, f.getErr
}

func appverifyUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func appverifyData(t *testing.T, body []byte, dst any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v (body=%s)", err, body)
	}
	if err := json.Unmarshal(env.Data, dst); err != nil {
		t.Fatalf("unmarshal data: %v (data=%s)", err, env.Data)
	}
}

func appverifyTestRouter(svc appverifyService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_ListByGroup(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	svc := &fakeQueryService{results: []StoredResult{
		{ID: uuid.New(), GroupID: groupID, SiteID: "site-a", Passed: true},
		{ID: uuid.New(), GroupID: groupID, SiteID: "site-b", Passed: false},
	}}
	h := appverifyTestRouter(svc)

	req := appverifyUser(httptest.NewRequest(http.MethodGet, "/app-verification?group="+groupID.String(), nil), uuid.New(), "analyst")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastGroup != groupID {
		t.Errorf("ListByGroup called for %s, want %s", svc.lastGroup, groupID)
	}
	var payload struct {
		Results []StoredResult `json:"results"`
		Count   int            `json:"count"`
	}
	appverifyData(t, rr.Body.Bytes(), &payload)
	if payload.Count != 2 || len(payload.Results) != 2 {
		t.Errorf("payload = %+v, want 2 results", payload)
	}
}

func TestRouter_ListByGroupRequiresGroup(t *testing.T) {
	t.Parallel()
	h := appverifyTestRouter(&fakeQueryService{})
	req := appverifyUser(httptest.NewRequest(http.MethodGet, "/app-verification", nil), uuid.New(), "analyst")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when group is missing", rr.Code)
	}
}

func TestRouter_GetResult(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	svc := &fakeQueryService{result: &StoredResult{ID: id, SiteID: "site-a", WorkloadKind: "postgres", Passed: true}}
	h := appverifyTestRouter(svc)

	req := appverifyUser(httptest.NewRequest(http.MethodGet, "/app-verification/"+id.String(), nil), uuid.New(), "analyst")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastID != id {
		t.Errorf("GetByID called for %s, want %s", svc.lastID, id)
	}
	var got StoredResult
	appverifyData(t, rr.Body.Bytes(), &got)
	if got.ID != id || got.WorkloadKind != "postgres" {
		t.Errorf("result = %+v, want id %s postgres", got, id)
	}
}

func TestRouter_GetResultNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeQueryService{getErr: ErrResultNotFound}
	h := appverifyTestRouter(svc)
	req := appverifyUser(httptest.NewRequest(http.MethodGet, "/app-verification/"+uuid.New().String(), nil), uuid.New(), "analyst")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestRouter_RequiresDRRead(t *testing.T) {
	t.Parallel()
	h := appverifyTestRouter(&fakeQueryService{})
	// A user with no DR permission is rejected by the dr:read gate.
	req := appverifyUser(httptest.NewRequest(http.MethodGet, "/app-verification?group="+uuid.New().String(), nil), uuid.New(), "no-dr")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 for a user without dr:read", rr.Code)
	}
}
