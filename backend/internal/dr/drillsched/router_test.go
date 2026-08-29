package drillsched

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeService implements scheduleService so the router's HTTP wiring, permission
// gating and error mapping are tested without a database.
type fakeService struct {
	created    *Schedule
	createErr  error
	listResult []*Schedule
	listErr    error
	nextResult []time.Time
	nextErr    error
	results    []*DrillResult
	resultsErr error
	diffResult DrillDiff
	diffErr    error

	lastCreateInput CreateScheduleInput
	lastNextN       int
	lastGroupID     uuid.UUID
	lastResultID    uuid.UUID
}

func (f *fakeService) CreateSchedule(_ context.Context, _ uuid.UUID, in CreateScheduleInput) (*Schedule, error) {
	f.lastCreateInput = in
	return f.created, f.createErr
}

func (f *fakeService) ListSchedules(_ context.Context, _ uuid.UUID) ([]*Schedule, error) {
	return f.listResult, f.listErr
}

func (f *fakeService) NextRuns(_ context.Context, _, _ uuid.UUID, n int) ([]time.Time, error) {
	f.lastNextN = n
	return f.nextResult, f.nextErr
}

func (f *fakeService) ListResultsByGroup(_ context.Context, _, groupID uuid.UUID) ([]*DrillResult, error) {
	f.lastGroupID = groupID
	return f.results, f.resultsErr
}

func (f *fakeService) DiffResult(_ context.Context, _, resultID uuid.UUID) (DrillDiff, error) {
	f.lastResultID = resultID
	return f.diffResult, f.diffErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func decodeData(t *testing.T, body string, dst any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatalf("decoding envelope: %v; body=%s", err, body)
	}
	if err := json.Unmarshal(env.Data, dst); err != nil {
		t.Fatalf("decoding data: %v; data=%s", err, env.Data)
	}
}

func TestRouter_CreateSchedule(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeService{created: &Schedule{ID: uuid.NewString(), GroupID: groupID.String(), Name: "nightly", CronExpr: "0 2 * * 1"}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := `{"group_id":"` + groupID.String() + `","name":"nightly","cron_expr":"0 2 * * 1"}`
	req := httptest.NewRequest(http.MethodPost, "/drill-schedules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant-admin")) // has dr:write

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastCreateInput.Name != "nightly" || svc.lastCreateInput.CronExpr != "0 2 * * 1" {
		t.Fatalf("create input = %+v, want nightly/0 2 * * 1", svc.lastCreateInput)
	}
	if svc.lastCreateInput.GroupID != groupID {
		t.Fatalf("create group = %s, want %s", svc.lastCreateInput.GroupID, groupID)
	}
}

func TestRouter_CreateSchedule_RequiresWrite(t *testing.T) {
	svc := &fakeService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	body := `{"group_id":"` + uuid.NewString() + `","name":"n","cron_expr":"* * * * *"}`
	req := httptest.NewRequest(http.MethodPost, "/drill-schedules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // only dr:read

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for analyst on a dr:write route", rec.Code)
	}
}

func TestRouter_CreateSchedule_BadCronMapsTo400(t *testing.T) {
	svc := &fakeService{createErr: invalid("cron_expr", "bad")}
	router := newRouter(svc, zerolog.Nop()).Routes()
	body := `{"group_id":"` + uuid.NewString() + `","name":"n","cron_expr":"99 * * * *"}`
	req := httptest.NewRequest(http.MethodPost, "/drill-schedules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant-admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_CreateSchedule_BadGroupID(t *testing.T) {
	svc := &fakeService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	body := `{"group_id":"not-a-uuid","name":"n","cron_expr":"* * * * *"}`
	req := httptest.NewRequest(http.MethodPost, "/drill-schedules", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant-admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a malformed group_id", rec.Code)
	}
}

func TestRouter_ListSchedules(t *testing.T) {
	svc := &fakeService{listResult: []*Schedule{{ID: uuid.NewString(), Name: "a"}, {ID: uuid.NewString(), Name: "b"}}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-schedules", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got []Schedule
	decodeData(t, rec.Body.String(), &got)
	if len(got) != 2 {
		t.Fatalf("got %d schedules, want 2", len(got))
	}
}

func TestRouter_NextRuns(t *testing.T) {
	id := uuid.New()
	svc := &fakeService{nextResult: []time.Time{
		time.Date(2026, 6, 15, 2, 0, 0, 0, time.UTC),
		time.Date(2026, 6, 22, 2, 0, 0, 0, time.UTC),
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-schedules/"+id.String()+"/next-runs?n=2", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastNextN != 2 {
		t.Fatalf("n forwarded = %d, want 2", svc.lastNextN)
	}
	var got struct {
		ScheduleID string      `json:"schedule_id"`
		NextRuns   []time.Time `json:"next_runs"`
		Count      int         `json:"count"`
	}
	decodeData(t, rec.Body.String(), &got)
	if got.Count != 2 || len(got.NextRuns) != 2 {
		t.Fatalf("count/len = %d/%d, want 2/2", got.Count, len(got.NextRuns))
	}
	if got.ScheduleID != id.String() {
		t.Fatalf("schedule_id = %q, want %q", got.ScheduleID, id.String())
	}
}

func TestRouter_NextRuns_BadN(t *testing.T) {
	svc := &fakeService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-schedules/"+uuid.NewString()+"/next-runs?n=abc", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for non-integer n", rec.Code)
	}
}

func TestRouter_ListResults(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeService{results: []*DrillResult{{ID: uuid.NewString(), GroupID: groupID.String()}}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/drill-results", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID != groupID {
		t.Fatalf("group forwarded = %s, want %s", svc.lastGroupID, groupID)
	}
}

func TestRouter_DiffResult(t *testing.T) {
	resultID := uuid.New()
	svc := &fakeService{diffResult: DrillDiff{
		GroupID: "g1", CurrentResultID: resultID.String(), PreviousResultID: "prev",
		RTORegressed: true, RTODeltaSeconds: 120,
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-results/"+resultID.String()+"/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastResultID != resultID {
		t.Fatalf("result forwarded = %s, want %s", svc.lastResultID, resultID)
	}
	var got DrillDiff
	decodeData(t, rec.Body.String(), &got)
	if !got.RTORegressed || got.RTODeltaSeconds != 120 {
		t.Fatalf("diff = %+v, want RTO regressed +120", got)
	}
}

func TestRouter_DiffResult_NoPreviousMapsTo404(t *testing.T) {
	svc := &fakeService{diffErr: ErrNoPrevious}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-results/"+uuid.NewString()+"/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a first result with no predecessor", rec.Code)
	}
}

func TestRouter_Unauthenticated(t *testing.T) {
	svc := &fakeService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/drill-schedules", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req) // no user in context

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 without authentication", rec.Code)
	}
}
