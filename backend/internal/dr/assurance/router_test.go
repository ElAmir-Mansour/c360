package assurance

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

// fakeService implements assuranceService so the router's HTTP wiring,
// permission gating and error mapping are tested without a database.
type fakeService struct {
	controls   []ControlInfo
	evalHdr    *StoredAssessment
	evalScored *AssuranceAssessment
	evalErr    error
	report     *AssessmentReport
	reportErr  error
	latest     *AssessmentReport
	latestErr  error

	lastEvalGroup uuid.UUID
	lastReportID  uuid.UUID
	lastLatest    uuid.UUID
}

func (f *fakeService) ListControls() []ControlInfo { return f.controls }

func (f *fakeService) Evaluate(_ context.Context, _, groupID, _ uuid.UUID) (*StoredAssessment, *AssuranceAssessment, error) {
	f.lastEvalGroup = groupID
	return f.evalHdr, f.evalScored, f.evalErr
}

func (f *fakeService) GetReport(_ context.Context, _, id uuid.UUID) (*AssessmentReport, error) {
	f.lastReportID = id
	return f.report, f.reportErr
}

func (f *fakeService) GetLatest(_ context.Context, _, groupID uuid.UUID) (*AssessmentReport, error) {
	f.lastLatest = groupID
	return f.latest, f.latestErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func decodeData(t *testing.T, body []byte, dst any) {
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

func newTestRouter(svc assuranceService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_ListControls(t *testing.T) {
	t.Parallel()
	svc := &fakeService{controls: Controls()}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodGet, "/assurance/controls", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var controls []ControlInfo
	decodeData(t, rr.Body.Bytes(), &controls)
	if len(controls) != len(assuranceControls) {
		t.Errorf("controls = %d, want %d", len(controls), len(assuranceControls))
	}
}

func TestRouter_EvaluateSuccess(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	hdr := &StoredAssessment{ID: uuid.New(), GroupID: groupID, Score: 80, Verdict: VerdictPartial}
	scored := &AssuranceAssessment{
		Score:   80,
		Verdict: VerdictPartial,
		Results: []CheckResult{{Code: "drill_cadence", Verdict: VerdictSatisfied}},
		Findings: []Finding{
			{Code: "rpo_breach_status", Verdict: VerdictFailed, Severity: SeverityCritical},
		},
		Recommendations: []string{RecommendationInvestigateRPO},
	}
	svc := &fakeService{evalHdr: hdr, evalScored: scored}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/"+groupID.String()+"/evaluate", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastEvalGroup != groupID {
		t.Errorf("Evaluate called with group %s, want %s", svc.lastEvalGroup, groupID)
	}
	var payload struct {
		Score           float64   `json:"score"`
		Verdict         Verdict   `json:"verdict"`
		Findings        []Finding `json:"findings"`
		Recommendations []string  `json:"recommendations"`
	}
	decodeData(t, rr.Body.Bytes(), &payload)
	if payload.Score != 80 || payload.Verdict != VerdictPartial || len(payload.Findings) != 1 || len(payload.Recommendations) != 1 {
		t.Errorf("payload = %+v, want score 80 partial with 1 finding/recommendation", payload)
	}
}

func TestRouter_EvaluateBadGroup(t *testing.T) {
	t.Parallel()
	h := newTestRouter(&fakeService{})
	req := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/not-a-uuid/evaluate", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for a non-UUID group", rr.Code)
	}
}

func TestRouter_EvaluateGroupNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{evalErr: ErrGroupNotFound}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/"+uuid.New().String()+"/evaluate", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestRouter_EvaluateServiceUnavailable(t *testing.T) {
	t.Parallel()
	svc := &fakeService{evalErr: ErrServiceUnavailable}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/"+uuid.New().String()+"/evaluate", nil), uuid.New(), "tenant_admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rr.Code)
	}
}

func TestRouter_EvaluateAllowsAdminPermission(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	svc := &fakeService{
		evalHdr:    &StoredAssessment{ID: uuid.New(), GroupID: groupID},
		evalScored: &AssuranceAssessment{},
	}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/"+groupID.String()+"/evaluate", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 for dr:admin-compatible user (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastEvalGroup != groupID {
		t.Errorf("Evaluate called with group %s, want %s", svc.lastEvalGroup, groupID)
	}
}

func TestRouter_GetAssessmentReport(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	svc := &fakeService{report: &AssessmentReport{
		Assessment: StoredAssessment{ID: id, Score: 70},
		Findings:   []Finding{{Code: "infra_drift"}},
	}}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodGet, "/assurance/assessments/"+id.String(), nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastReportID != id {
		t.Errorf("GetReport called with %s, want %s", svc.lastReportID, id)
	}
	var report AssessmentReport
	decodeData(t, rr.Body.Bytes(), &report)
	if report.Assessment.ID != id || len(report.Findings) != 1 {
		t.Errorf("report = %+v, want id %s with one finding", report, id)
	}
}

func TestRouter_GetLatest(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	svc := &fakeService{latest: &AssessmentReport{Assessment: StoredAssessment{GroupID: groupID, Score: 55}}}
	h := newTestRouter(svc)

	req := withUser(httptest.NewRequest(http.MethodGet, "/assurance/groups/"+groupID.String()+"/latest", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastLatest != groupID {
		t.Errorf("GetLatest called with %s, want %s", svc.lastLatest, groupID)
	}
}

func TestRouter_GetLatestNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{latestErr: ErrAssessmentNotFound}
	h := newTestRouter(svc)
	req := withUser(httptest.NewRequest(http.MethodGet, "/assurance/groups/"+uuid.New().String()+"/latest", nil), uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

// TestRouter_PermissionGating asserts a dr:read-only user can read controls but
// cannot run an evaluation (it needs dr:write or dr:admin).
func TestRouter_PermissionGating(t *testing.T) {
	t.Parallel()
	svc := &fakeService{controls: Controls()}
	h := newTestRouter(svc)

	readReq := withUser(httptest.NewRequest(http.MethodGet, "/assurance/controls", nil), uuid.New(), "viewer")
	readRR := httptest.NewRecorder()
	h.ServeHTTP(readRR, readReq)
	if readRR.Code != http.StatusOK {
		t.Errorf("dr:read controls status = %d, want 200", readRR.Code)
	}

	evalReq := withUser(httptest.NewRequest(http.MethodPost, "/assurance/groups/"+uuid.New().String()+"/evaluate", nil), uuid.New(), "viewer")
	evalRR := httptest.NewRecorder()
	h.ServeHTTP(evalRR, evalReq)
	if evalRR.Code != http.StatusForbidden {
		t.Errorf("dr:read evaluate status = %d, want 403", evalRR.Code)
	}
}
