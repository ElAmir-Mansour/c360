package handler_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/handler"
	"github.com/clario360/platform/internal/dr/model"
	drservice "github.com/clario360/platform/internal/dr/service"
)

type stubService struct {
	createSiteTenant uuid.UUID
	createSiteInput  drservice.CreateSiteInput
	createSiteCalled bool

	approvedBy     uuid.UUID
	cancelledBy    uuid.UUID
	cancelledRun   uuid.UUID
	approvalInput  drservice.ApproveFailoverRunInput
	sealedGroup    uuid.UUID
	materialized   drservice.MaterializeJournalRecoveryPointInput
	validatedPoint uuid.UUID
	failoverInput  drservice.CreateFailoverRunInput

	sites   []*model.ProtectedSite
	groups  []*model.ConsistencyGroup
	members map[string][]model.ConsistencyGroupMember
	streams []*model.ReplicationStream
	points  map[string][]*model.RecoveryPoint
	runs    []*model.FailoverRun
}

func (s *stubService) CreateSite(_ context.Context, tenantID uuid.UUID, in drservice.CreateSiteInput) (*model.ProtectedSite, error) {
	s.createSiteTenant = tenantID
	s.createSiteInput = in
	s.createSiteCalled = true
	if in.Kind == model.SiteKindIaC {
		return nil, &drservice.ValidationError{Field: "kind", Message: "kind must be one of vm, database, fileset"}
	}
	return &model.ProtectedSite{
		ID:                  uuid.NewString(),
		TenantID:            tenantID.String(),
		Name:                in.Name,
		Kind:                in.Kind,
		PrimaryEndpoint:     in.PrimaryEndpoint,
		RTOObjectiveSeconds: 900,
		RPOObjectiveSeconds: 300,
		CreatedAt:           time.Now(),
		UpdatedAt:           time.Now(),
	}, nil
}

func (s *stubService) GetSite(context.Context, uuid.UUID, uuid.UUID) (*model.ProtectedSite, error) {
	return nil, model.ErrNotFound
}
func (s *stubService) ListSites(context.Context, uuid.UUID) ([]*model.ProtectedSite, error) {
	if s.sites != nil {
		return s.sites, nil
	}
	return []*model.ProtectedSite{}, nil
}
func (s *stubService) CreateGroup(context.Context, uuid.UUID, drservice.CreateGroupInput) (*model.ConsistencyGroup, error) {
	return nil, nil
}
func (s *stubService) GetGroup(_ context.Context, _ uuid.UUID, groupID uuid.UUID) (*model.ConsistencyGroup, error) {
	for _, group := range s.groups {
		if group.ID == groupID.String() {
			return group, nil
		}
	}
	return nil, model.ErrNotFound
}
func (s *stubService) ListGroups(context.Context, uuid.UUID) ([]*model.ConsistencyGroup, error) {
	if s.groups != nil {
		return s.groups, nil
	}
	return []*model.ConsistencyGroup{}, nil
}
func (s *stubService) AddGroupMember(context.Context, uuid.UUID, uuid.UUID, drservice.AddGroupMemberInput) (*model.ConsistencyGroupMember, error) {
	return nil, nil
}
func (s *stubService) ListGroupMembers(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error) {
	if s.members != nil {
		return s.members[groupID.String()], nil
	}
	return []model.ConsistencyGroupMember{}, nil
}
func (s *stubService) CreateStream(context.Context, uuid.UUID, drservice.CreateStreamInput) (*model.ReplicationStream, error) {
	return nil, nil
}
func (s *stubService) GetStream(context.Context, uuid.UUID, uuid.UUID) (*model.ReplicationStream, error) {
	return nil, model.ErrNotFound
}
func (s *stubService) ListStreams(context.Context, uuid.UUID) ([]*model.ReplicationStream, error) {
	if s.streams != nil {
		return s.streams, nil
	}
	return []*model.ReplicationStream{}, nil
}
func (s *stubService) PauseStream(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
func (s *stubService) ResumeStream(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
func (s *stubService) GetStreamRPO(context.Context, uuid.UUID, uuid.UUID) (*model.StreamRPO, error) {
	return &model.StreamRPO{Status: model.StreamStatusStreaming, HasData: true, MeasuredAt: time.Now()}, nil
}
func (s *stubService) GetRecoveryPoint(context.Context, uuid.UUID, uuid.UUID) (*model.RecoveryPoint, error) {
	return nil, model.ErrNotFound
}
func (s *stubService) ListRecoveryPoints(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]*model.RecoveryPoint, error) {
	if s.points != nil {
		return s.points[groupID.String()], nil
	}
	return []*model.RecoveryPoint{}, nil
}
func (s *stubService) SealRecoveryPoint(_ context.Context, tenantID, groupID uuid.UUID, _ drservice.SealRecoveryPointInput) (*model.RecoveryPoint, error) {
	s.sealedGroup = groupID
	return &model.RecoveryPoint{
		ID:             uuid.NewString(),
		TenantID:       tenantID.String(),
		GroupID:        groupID.String(),
		MarkerLSN:      "0/16B6248",
		ObjectKeys:     map[string]string{},
		ContentHash:    "deadbeef",
		RetentionUntil: time.Now().Add(7 * 24 * time.Hour),
	}, nil
}
func (s *stubService) MaterializeJournalRecoveryPoint(_ context.Context, tenantID, groupID uuid.UUID, in drservice.MaterializeJournalRecoveryPointInput) (*model.RecoveryPoint, error) {
	s.sealedGroup = groupID
	s.materialized = in
	return &model.RecoveryPoint{
		ID:             uuid.NewString(),
		TenantID:       tenantID.String(),
		GroupID:        groupID.String(),
		MarkerLSN:      "0/16B6248",
		ObjectKeys:     map[string]string{},
		ContentHash:    "deadbeef",
		RetentionUntil: time.Now().Add(7 * 24 * time.Hour),
	}, nil
}
func (s *stubService) ValidateRecoveryPoint(_ context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error) {
	s.validatedPoint = pointID
	ratio := 0.9995
	return &model.RecoveryPoint{
		ID:              pointID.String(),
		TenantID:        tenantID.String(),
		MarkerLSN:       "0/16B6248",
		ObjectKeys:      map[string]string{},
		ContentHash:     "deadbeef",
		ValidationRatio: &ratio,
		IsValidated:     true,
		LegalHold:       true,
		RetentionUntil:  time.Now().Add(7 * 24 * time.Hour),
	}, nil
}
func (s *stubService) CreateNetworkMapping(context.Context, uuid.UUID, uuid.UUID, drservice.CreateNetworkMappingInput) (*model.NetworkMapping, error) {
	return nil, nil
}
func (s *stubService) ListNetworkMappings(context.Context, uuid.UUID, uuid.UUID) ([]*model.NetworkMapping, error) {
	return []*model.NetworkMapping{}, nil
}
func (s *stubService) CreateAgent(context.Context, uuid.UUID, drservice.CreateAgentInput) (*model.DRAgent, error) {
	return nil, nil
}
func (s *stubService) GetAgent(context.Context, uuid.UUID, uuid.UUID) (*model.DRAgent, error) {
	return nil, model.ErrNotFound
}
func (s *stubService) ListAgents(context.Context, uuid.UUID) ([]*model.DRAgent, error) {
	return []*model.DRAgent{}, nil
}
func (s *stubService) CreateFailoverRun(_ context.Context, tenantID uuid.UUID, in drservice.CreateFailoverRunInput) (*model.FailoverRun, error) {
	s.failoverInput = in
	return &model.FailoverRun{
		ID:          uuid.NewString(),
		TenantID:    tenantID.String(),
		GroupID:     in.GroupID.String(),
		Mode:        in.Mode,
		Status:      model.StatusInitiated,
		InitiatedBy: in.InitiatedBy.String(),
		InitiatedAt: time.Now(),
		UpdatedAt:   time.Now(),
	}, nil
}
func (s *stubService) GetFailoverRun(context.Context, uuid.UUID, uuid.UUID) (*model.FailoverRun, error) {
	return nil, model.ErrNotFound
}
func (s *stubService) ListFailoverRuns(context.Context, uuid.UUID) ([]*model.FailoverRun, error) {
	if s.runs != nil {
		return s.runs, nil
	}
	return []*model.FailoverRun{}, nil
}
func (s *stubService) ApproveFailoverRun(_ context.Context, tenantID, runID, approvedBy uuid.UUID, inputs ...drservice.ApproveFailoverRunInput) (*model.FailoverRun, error) {
	s.approvedBy = approvedBy
	if len(inputs) > 0 {
		s.approvalInput = inputs[0]
	}
	return &model.FailoverRun{
		ID:          runID.String(),
		TenantID:    tenantID.String(),
		Status:      model.StatusApproved,
		ApprovedBy:  ptr(approvedBy.String()),
		InitiatedAt: time.Now(),
		UpdatedAt:   time.Now(),
	}, nil
}
func (s *stubService) CancelFailoverRun(_ context.Context, tenantID, runID, cancelledBy uuid.UUID) (*model.FailoverRun, error) {
	s.cancelledBy = cancelledBy
	s.cancelledRun = runID
	return &model.FailoverRun{
		ID:          runID.String(),
		TenantID:    tenantID.String(),
		Status:      model.StatusCancelled,
		InitiatedAt: time.Now(),
		UpdatedAt:   time.Now(),
	}, nil
}
func (s *stubService) ListFailoverSteps(context.Context, uuid.UUID, uuid.UUID) ([]*model.FailoverStep, error) {
	return []*model.FailoverStep{}, nil
}
func (s *stubService) GetAttestationByRun(context.Context, uuid.UUID, uuid.UUID) (*model.Attestation, error) {
	return nil, model.ErrNotFound
}

func ptr[T any](v T) *T { return &v }

func withUser(req *http.Request, tenantID, userID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: userID.String(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestCreateSiteRoute(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()

	body := []byte(`{"name":"prod-db","kind":"database","primary_endpoint":"pg://primary"}`)
	req := httptest.NewRequest(http.MethodPost, "/sites", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !svc.createSiteCalled {
		t.Fatal("CreateSite was not called")
	}
	if svc.createSiteTenant != tenantID {
		t.Fatalf("tenant = %s, want %s", svc.createSiteTenant, tenantID)
	}
	if svc.createSiteInput.Name != "prod-db" || svc.createSiteInput.Kind != model.SiteKindDatabase {
		t.Fatalf("input = %+v", svc.createSiteInput)
	}
}

func TestCreateSiteRouteRejectsIaC(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()

	body := []byte(`{"name":"tf-state","kind":"iac","primary_endpoint":"git://infra"}`)
	req := httptest.NewRequest(http.MethodPost, "/sites", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !svc.createSiteCalled {
		t.Fatal("CreateSite was not called")
	}
	if svc.createSiteInput.Kind != model.SiteKindIaC {
		t.Fatalf("kind = %q, want %q", svc.createSiteInput.Kind, model.SiteKindIaC)
	}
}

func TestWriteRouteRequiresDRWrite(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()

	body := []byte(`{"name":"prod-db","kind":"database","primary_endpoint":"pg://primary"}`)
	req := httptest.NewRequest(http.MethodPost, "/sites", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "viewer"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if svc.createSiteCalled {
		t.Fatal("CreateSite was called despite missing dr:write")
	}
}

func TestMaterializeJournalRecoveryPointRoute(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	groupID := uuid.New()

	body := []byte(`{"seq":42}`)
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/journal/materialize", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if svc.sealedGroup != groupID {
		t.Fatalf("group = %s, want %s", svc.sealedGroup, groupID)
	}
	if svc.materialized.Target.Seq == nil || *svc.materialized.Target.Seq != 42 {
		t.Fatalf("journal target = %+v", svc.materialized.Target)
	}
}

func TestCreateFailoverRunAcceptsJournalTarget(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	groupID := uuid.New()

	body := []byte(`{"group_id":"` + groupID.String() + `","mode":"real","journal_target":{"lsn":"0/16B6248"}}`)
	req := httptest.NewRequest(http.MethodPost, "/failover-runs", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if svc.failoverInput.GroupID != groupID || svc.failoverInput.JournalTarget == nil || svc.failoverInput.JournalTarget.LSN != "0/16B6248" {
		t.Fatalf("failover input = %+v", svc.failoverInput)
	}
}

func TestApproveFailoverRunUsesAuthenticatedUser(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	runID := uuid.New()

	req := httptest.NewRequest(http.MethodPost, "/failover-runs/"+runID.String()+"/approve", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if svc.approvedBy != userID {
		t.Fatalf("approvedBy = %s, want %s", svc.approvedBy, userID)
	}
}

func TestApproveFailoverRunAcceptsApprovalBody(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	runID := uuid.New()
	stepUp := time.Now().UTC().Format(time.RFC3339Nano)

	body := []byte(`{"decision":"approve","reason":"regional outage","break_glass":true,"step_up_verified_at":"` + stepUp + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/failover-runs/"+runID.String()+"/approve", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if svc.approvalInput.Decision != "approve" || svc.approvalInput.Reason != "regional outage" || !svc.approvalInput.BreakGlass {
		t.Fatalf("approval input = %+v", svc.approvalInput)
	}
	if svc.approvalInput.StepUpVerifiedAt == nil {
		t.Fatalf("step_up_verified_at was not decoded")
	}
}

func TestCancelFailoverRunUsesAuthenticatedUser(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	runID := uuid.New()

	tests := []struct {
		name string
		path string
	}{
		{name: "canonical failover-runs route", path: "/failover-runs/" + runID.String() + "/cancel"},
		{name: "ga failover id route", path: "/failover/" + runID.String() + "/cancel"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &stubService{}
			router := handler.New(svc, zerolog.Nop()).Routes()
			req := httptest.NewRequest(http.MethodPost, tc.path, nil)
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, withUser(req, tenantID, userID, "tenant_admin"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if svc.cancelledBy != userID {
				t.Fatalf("cancelledBy = %s, want %s", svc.cancelledBy, userID)
			}
			if svc.cancelledRun != runID {
				t.Fatalf("runID = %s, want %s", svc.cancelledRun, runID)
			}
		})
	}
}

func TestFailoverTransitionRouteIsNotPublic(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	runID := uuid.New()

	body := []byte(`{"expected_status":"INITIATED","new_status":"EXECUTING"}`)
	req := httptest.NewRequest(http.MethodPost, "/failover-runs/"+runID.String()+"/transitions", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestStreamStatusRouteIsNotPublic(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	streamID := uuid.New()

	body := []byte(`{"status":"streaming"}`)
	req := httptest.NewRequest(http.MethodPost, "/streams/"+streamID.String()+"/status", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestRecoveryPointSealAndValidateRoutes(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()

	tests := []struct {
		name       string
		req        *http.Request
		wantStatus int
	}{
		{
			name:       "seal recovery point",
			req:        httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/recovery-points", bytes.NewReader([]byte(`{}`))),
			wantStatus: http.StatusCreated,
		},
		{
			name:       "validate recovery point",
			req:        httptest.NewRequest(http.MethodPost, "/recovery-points/"+pointID.String()+"/validate", nil),
			wantStatus: http.StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, withUser(tc.req, tenantID, userID, "tenant_admin"))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
	if svc.sealedGroup != groupID {
		t.Fatalf("sealedGroup = %s, want %s", svc.sealedGroup, groupID)
	}
	if svc.validatedPoint != pointID {
		t.Fatalf("validatedPoint = %s, want %s", svc.validatedPoint, pointID)
	}
}
