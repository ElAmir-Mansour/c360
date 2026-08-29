package bcm

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

// fakeService implements bcmService so the router's HTTP wiring, permission
// gating and error mapping are tested without a database.
type fakeService struct {
	packs      []Pack
	pack       Pack
	packErr    error
	assessHdr  *StoredAssessment
	assessScrd *Assessment
	assessErr  error
	report     *AssessmentReport
	reportErr  error

	lastAssessGroup uuid.UUID
	lastAssessKey   string
	lastReportID    uuid.UUID
}

func (f *fakeService) ListPacks() []Pack { return f.packs }

func (f *fakeService) GetPack(key string) (Pack, error) {
	if f.packErr != nil {
		return Pack{}, f.packErr
	}
	return f.pack, nil
}

func (f *fakeService) Assess(_ context.Context, _, groupID, _ uuid.UUID, key string) (*StoredAssessment, *Assessment, error) {
	f.lastAssessGroup = groupID
	f.lastAssessKey = key
	return f.assessHdr, f.assessScrd, f.assessErr
}

func (f *fakeService) GetReport(_ context.Context, _, id uuid.UUID) (*AssessmentReport, error) {
	f.lastReportID = id
	return f.report, f.reportErr
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

func newTestRouter(svc bcmService) http.Handler {
	return newRouter(svc, zerolog.Nop()).Routes()
}

func TestRouter_ListPacks(t *testing.T) {
	t.Parallel()
	svc := &fakeService{packs: []Pack{{Key: "iso22301", Standard: "ISO 22301:2019"}}}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/bcm/packs", nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var packs []Pack
	decodeData(t, rr.Body.Bytes(), &packs)
	if len(packs) != 1 || packs[0].Key != "iso22301" {
		t.Errorf("packs = %+v, want one iso22301", packs)
	}
}

func TestRouter_GetPackNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{packErr: ErrPackNotFound}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/bcm/packs/nope", nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestRouter_AssessRequiresGroupParam(t *testing.T) {
	t.Parallel()
	svc := &fakeService{}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/bcm/packs/iso22301/assess", nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when group param missing", rr.Code)
	}
}

func TestRouter_AssessSuccess(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	hdr := &StoredAssessment{ID: uuid.New(), PackKey: "iso22301", GroupID: groupID, Score: 85, Compliant: true}
	scored := &Assessment{
		Score:     85,
		Compliant: true,
		ControlResults: []ControlResult{
			{Code: "C1", Verdict: VerdictSatisfied},
			{Code: "C2", Verdict: VerdictFailed, Reason: "no evidence"},
		},
		Gaps: []Gap{{Code: "C2", Verdict: VerdictFailed, Reason: "no evidence"}},
	}
	svc := &fakeService{assessHdr: hdr, assessScrd: scored}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/bcm/packs/iso22301/assess?group="+groupID.String(), nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if svc.lastAssessGroup != groupID || svc.lastAssessKey != "iso22301" {
		t.Errorf("Assess called with group=%s key=%s, want %s/iso22301", svc.lastAssessGroup, svc.lastAssessKey, groupID)
	}
	var payload struct {
		Score     float64 `json:"score"`
		Compliant bool    `json:"compliant"`
		Gaps      []Gap   `json:"gaps"`
	}
	decodeData(t, rr.Body.Bytes(), &payload)
	if payload.Score != 85 || !payload.Compliant || len(payload.Gaps) != 1 {
		t.Errorf("payload = %+v, want score 85 compliant 1-gap", payload)
	}
}

func TestRouter_AssessGroupNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{assessErr: ErrGroupNotFound}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodPost, "/bcm/packs/iso22301/assess?group="+uuid.New().String(), nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestRouter_GetAssessmentReport(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	svc := &fakeService{report: &AssessmentReport{
		Assessment: StoredAssessment{ID: id, Score: 70},
		Gaps:       []Gap{{Code: "C2"}},
	}}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/bcm/assessments/"+id.String(), nil)
	req = withUser(req, uuid.New(), "super-admin")
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
	if report.Assessment.ID != id || len(report.Gaps) != 1 {
		t.Errorf("report = %+v, want id %s with one gap", report, id)
	}
}

func TestRouter_GetAssessmentNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{reportErr: ErrAssessmentNotFound}
	h := newTestRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/bcm/assessments/"+uuid.New().String(), nil)
	req = withUser(req, uuid.New(), "super-admin")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

// TestRouter_PermissionGating asserts a user lacking dr:write cannot run an
// assessment (the RequirePermission middleware rejects it) while a dr:read user
// can list packs.
func TestRouter_PermissionGating(t *testing.T) {
	t.Parallel()
	svc := &fakeService{packs: []Pack{{Key: "iso22301"}}}
	h := newTestRouter(svc)

	// dr:read-only user can list packs.
	listReq := httptest.NewRequest(http.MethodGet, "/bcm/packs", nil)
	listReq = withReadOnlyUser(listReq, uuid.New())
	listRR := httptest.NewRecorder()
	h.ServeHTTP(listRR, listReq)
	if listRR.Code != http.StatusOK {
		t.Errorf("dr:read list status = %d, want 200", listRR.Code)
	}

	// Same dr:read-only user cannot assess (needs dr:write).
	assessReq := httptest.NewRequest(http.MethodPost, "/bcm/packs/iso22301/assess?group="+uuid.New().String(), nil)
	assessReq = withReadOnlyUser(assessReq, uuid.New())
	assessRR := httptest.NewRecorder()
	h.ServeHTTP(assessRR, assessReq)
	if assessRR.Code != http.StatusForbidden {
		t.Errorf("dr:read assess status = %d, want 403", assessRR.Code)
	}
}

// withReadOnlyUser attaches a user with the "viewer" role, which grants dr:read
// but not dr:write, so RequirePermission("dr:write") rejects it.
func withReadOnlyUser(req *http.Request, tenantID uuid.UUID) *http.Request {
	return withUser(req, tenantID, "viewer")
}
