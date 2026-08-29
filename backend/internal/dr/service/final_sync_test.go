package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/service"
)

func TestFailoverFinalSyncerSealsAndValidatesRealRun(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	ratio := 1.0
	sealedAt := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	rpSvc := &fakeRecoveryPointSyncService{
		sealed: &model.RecoveryPoint{ID: pointID.String()},
		validated: &model.RecoveryPoint{
			ID:              pointID.String(),
			RPOSeconds:      7,
			ValidationRatio: &ratio,
			IsValidated:     true,
			MarkerLSN:       "0/42",
			ContentHash:     "sha256:abc",
			SealedAt:        sealedAt,
		},
	}
	syncer := service.NewFailoverFinalSyncerWithCleanroom(rpSvc, cleanScanner(pointID))

	result, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: tenantID.String(),
		GroupID:  groupID.String(),
		Mode:     model.ModeReal,
	})
	if err != nil {
		t.Fatalf("QuiesceAndSync: %v", err)
	}
	if result.RecoveryPointID != pointID.String() || result.RPOSeconds != 7 || result.ValidationRatio != 1.0 {
		t.Fatalf("result = %+v", result)
	}
	if rpSvc.sealTenant != tenantID || rpSvc.sealGroup != groupID {
		t.Fatalf("seal tenant/group = %s/%s, want %s/%s", rpSvc.sealTenant, rpSvc.sealGroup, tenantID, groupID)
	}
	if rpSvc.validateTenant != tenantID || rpSvc.validatePoint != pointID {
		t.Fatalf("validate tenant/point = %s/%s, want %s/%s", rpSvc.validateTenant, rpSvc.validatePoint, tenantID, pointID)
	}
	if result.Details["final_sync_rp"] != true || result.Details["worm_validated"] != true {
		t.Fatalf("details = %#v", result.Details)
	}
}

func TestFailoverFinalSyncerRequiresCleanroomForRealRun(t *testing.T) {
	t.Parallel()

	syncer := service.NewFailoverFinalSyncer(&fakeRecoveryPointSyncService{})
	_, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: uuid.NewString(),
		GroupID:  uuid.NewString(),
		Mode:     model.ModeReal,
	})
	if !errors.Is(err, service.ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestFailoverFinalSyncerSkipsDrillAndHonorsPreselectedRealRun(t *testing.T) {
	t.Parallel()

	rpSvc := &fakeRecoveryPointSyncService{}
	syncer := service.NewFailoverFinalSyncer(rpSvc)
	result, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{Mode: model.ModeDrill})
	if err != nil {
		t.Fatalf("drill QuiesceAndSync: %v", err)
	}
	if result.RecoveryPointID != "" || rpSvc.sealCalls != 0 || result.Details["drill_noop"] != true {
		t.Fatalf("drill result=%+v sealCalls=%d", result, rpSvc.sealCalls)
	}

	initialPointID := uuid.New()
	ratio := 1.0
	rpSvc.validated = &model.RecoveryPoint{
		ID:              initialPointID.String(),
		RPOSeconds:      3,
		ValidationRatio: &ratio,
		IsValidated:     true,
	}
	syncer = service.NewFailoverFinalSyncerWithCleanroom(rpSvc, cleanScanner(initialPointID))
	result, err = syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		Mode:            model.ModeReal,
		TenantID:        uuid.NewString(),
		GroupID:         uuid.NewString(),
		RecoveryPointID: strPtr(initialPointID.String()),
	})
	if err != nil {
		t.Fatalf("preselected real QuiesceAndSync: %v", err)
	}
	if result.RecoveryPointID != initialPointID.String() || rpSvc.sealCalls != 0 {
		t.Fatalf("preselected real result=%+v sealCalls=%d", result, rpSvc.sealCalls)
	}
	if result.Details["preselected_recovery_point"] != true || result.Details["final_sync_rp"] != false {
		t.Fatalf("preselected detail = %+v", result.Details)
	}
}

func TestFailoverFinalSyncerPropagatesSealAndValidateErrors(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	groupID := uuid.New()
	syncer := service.NewFailoverFinalSyncerWithCleanroom(
		&fakeRecoveryPointSyncService{sealErr: errors.New("minio down")},
		cleanScanner(uuid.New()),
	)
	if _, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: tenantID.String(),
		GroupID:  groupID.String(),
		Mode:     model.ModeReal,
	}); err == nil {
		t.Fatal("expected seal error")
	}

	pointID := uuid.New()
	syncer = service.NewFailoverFinalSyncerWithCleanroom(&fakeRecoveryPointSyncService{
		sealed:      &model.RecoveryPoint{ID: pointID.String()},
		validateErr: errors.New("hash mismatch"),
	}, cleanScanner(pointID))
	if _, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: tenantID.String(),
		GroupID:  groupID.String(),
		Mode:     model.ModeReal,
	}); err == nil {
		t.Fatal("expected validate error")
	}
}

func TestFailoverFinalSyncerScansFinalPointBeforeGate1(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	ratio := 1.0
	rpSvc := &fakeRecoveryPointSyncService{
		sealed: &model.RecoveryPoint{ID: pointID.String()},
		validated: &model.RecoveryPoint{
			ID:              pointID.String(),
			RPOSeconds:      3,
			ValidationRatio: &ratio,
			IsValidated:     true,
		},
	}
	scanner := &fakeCleanroomSyncService{scan: &cleanroom.Scan{
		ID:              "scan-1",
		RecoveryPointID: pointID.String(),
		Verdict:         cleanroom.VerdictClean,
		Scanner:         "signature",
		ChunksScanned:   2,
		BytesScanned:    512,
	}}
	syncer := service.NewFailoverFinalSyncerWithCleanroom(rpSvc, scanner)

	result, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: tenantID.String(),
		GroupID:  groupID.String(),
		Mode:     model.ModeReal,
	})
	if err != nil {
		t.Fatalf("QuiesceAndSync: %v", err)
	}
	if scanner.tenantID != tenantID || scanner.pointID != pointID {
		t.Fatalf("cleanroom scan tenant/point = %s/%s, want %s/%s", scanner.tenantID, scanner.pointID, tenantID, pointID)
	}
	if result.Details["cleanroom_verdict"] != cleanroom.VerdictClean || result.Details["cleanroom_scan_id"] != "scan-1" {
		t.Fatalf("missing cleanroom details: %#v", result.Details)
	}
}

func TestFailoverFinalSyncerBlocksDirtyCleanroomVerdict(t *testing.T) {
	t.Parallel()

	pointID := uuid.New()
	rpSvc := &fakeRecoveryPointSyncService{
		sealed:    &model.RecoveryPoint{ID: pointID.String()},
		validated: &model.RecoveryPoint{ID: pointID.String(), IsValidated: true},
	}
	syncer := service.NewFailoverFinalSyncerWithCleanroom(rpSvc, &fakeCleanroomSyncService{scan: &cleanroom.Scan{
		RecoveryPointID: pointID.String(),
		Verdict:         cleanroom.VerdictMalware,
		Scanner:         "signature",
	}})

	_, err := syncer.QuiesceAndSync(context.Background(), &model.FailoverRun{
		TenantID: uuid.NewString(),
		GroupID:  uuid.NewString(),
		Mode:     model.ModeReal,
	})
	if err == nil {
		t.Fatal("expected dirty clean-room verdict to block final sync")
	}
}

type fakeRecoveryPointSyncService struct {
	sealed    *model.RecoveryPoint
	validated *model.RecoveryPoint

	sealErr     error
	validateErr error

	sealCalls      int
	sealTenant     uuid.UUID
	sealGroup      uuid.UUID
	validateTenant uuid.UUID
	validatePoint  uuid.UUID
}

func (s *fakeRecoveryPointSyncService) SealRecoveryPoint(_ context.Context, tenantID, groupID uuid.UUID, _ service.SealRecoveryPointInput) (*model.RecoveryPoint, error) {
	s.sealCalls++
	s.sealTenant = tenantID
	s.sealGroup = groupID
	if s.sealErr != nil {
		return nil, s.sealErr
	}
	if s.sealed == nil {
		return &model.RecoveryPoint{ID: uuid.NewString()}, nil
	}
	return s.sealed, nil
}

func (s *fakeRecoveryPointSyncService) ValidateRecoveryPoint(_ context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error) {
	s.validateTenant = tenantID
	s.validatePoint = pointID
	if s.validateErr != nil {
		return nil, s.validateErr
	}
	if s.validated == nil {
		return &model.RecoveryPoint{ID: pointID.String()}, nil
	}
	return s.validated, nil
}

type fakeCleanroomSyncService struct {
	scan     *cleanroom.Scan
	err      error
	tenantID uuid.UUID
	pointID  uuid.UUID
}

func cleanScanner(pointID uuid.UUID) *fakeCleanroomSyncService {
	return &fakeCleanroomSyncService{scan: &cleanroom.Scan{
		ID:              "scan-clean",
		RecoveryPointID: pointID.String(),
		Verdict:         cleanroom.VerdictClean,
		Scanner:         "signature",
	}}
}

func (s *fakeCleanroomSyncService) ScanRecoveryPoint(_ context.Context, tenantID, pointID uuid.UUID) (*cleanroom.Scan, error) {
	s.tenantID = tenantID
	s.pointID = pointID
	if s.err != nil {
		return nil, s.err
	}
	return s.scan, nil
}

func strPtr(s string) *string { return &s }
