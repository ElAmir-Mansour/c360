package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/failover"
	"github.com/clario360/platform/internal/dr/model"
)

type recoveryPointSyncService interface {
	SealRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in SealRecoveryPointInput) (*model.RecoveryPoint, error)
	ValidateRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error)
}

type cleanroomSyncService interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*cleanroom.Scan, error)
}

// FailoverFinalSyncer implements the failover driver's Gate-0 final-sync hook
// using the same WORM-backed recovery-point path that the tenant API uses. Real
// failovers seal and validate a fresh recovery point before Gate 1; drills leave
// the existing recovery point set untouched.
type FailoverFinalSyncer struct {
	svc       recoveryPointSyncService
	cleanroom cleanroomSyncService
}

// NewFailoverFinalSyncer adapts the DR service into failover.FinalSyncer.
func NewFailoverFinalSyncer(svc recoveryPointSyncService) *FailoverFinalSyncer {
	return &FailoverFinalSyncer{svc: svc}
}

// NewFailoverFinalSyncerWithCleanroom adapts the DR service and clean-room
// scanner into failover.FinalSyncer. Production uses this path so a real
// failover's freshly sealed final-sync point is quarantine-scanned before Gate 1
// can pin it.
func NewFailoverFinalSyncerWithCleanroom(svc recoveryPointSyncService, cleanroom cleanroomSyncService) *FailoverFinalSyncer {
	return &FailoverFinalSyncer{svc: svc, cleanroom: cleanroom}
}

// QuiesceAndSync seals and validates a final recovery point for real failovers.
// It is intentionally a no-op for drills so drill mode keeps using an
// already-validated point and does not mutate the production recovery-point set.
func (s *FailoverFinalSyncer) QuiesceAndSync(ctx context.Context, run *model.FailoverRun) (failover.FinalSyncResult, error) {
	if run == nil {
		return failover.FinalSyncResult{}, errors.New("run is required")
	}
	if run.Mode == model.ModeDrill {
		result := failover.FinalSyncResult{Details: map[string]any{"drill_noop": true}}
		if run.RecoveryPointID != nil && *run.RecoveryPointID != "" {
			result.RecoveryPointID = *run.RecoveryPointID
			result.Details["preselected_recovery_point"] = true
		}
		return result, nil
	}
	if s == nil || s.svc == nil {
		return failover.FinalSyncResult{}, fmt.Errorf("%w: final sync recovery-point service", ErrNotConfigured)
	}
	if s.cleanroom == nil {
		return failover.FinalSyncResult{}, fmt.Errorf("%w: final sync clean-room scanner", ErrNotConfigured)
	}
	tenantID, err := uuid.Parse(run.TenantID)
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("parse run tenant id: %w", err)
	}
	groupID, err := uuid.Parse(run.GroupID)
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("parse run group id: %w", err)
	}
	if run.RecoveryPointID != nil && *run.RecoveryPointID != "" {
		pointID, err := uuid.Parse(*run.RecoveryPointID)
		if err != nil {
			return failover.FinalSyncResult{}, fmt.Errorf("parse preselected recovery point id: %w", err)
		}
		return s.validateAndScan(ctx, tenantID, pointID, map[string]any{
			"preselected_recovery_point": true,
			"final_sync_rp":              false,
		})
	}
	point, err := s.svc.SealRecoveryPoint(ctx, tenantID, groupID, SealRecoveryPointInput{})
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("seal final recovery point: %w", err)
	}
	pointID, err := uuid.Parse(point.ID)
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("parse sealed recovery point id: %w", err)
	}
	return s.validateAndScan(ctx, tenantID, pointID, map[string]any{"final_sync_rp": true})
}

func (s *FailoverFinalSyncer) validateAndScan(ctx context.Context, tenantID, pointID uuid.UUID, details map[string]any) (failover.FinalSyncResult, error) {
	validated, err := s.svc.ValidateRecoveryPoint(ctx, tenantID, pointID)
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("validate recovery point: %w", err)
	}
	ratio := 0.0
	if validated.ValidationRatio != nil {
		ratio = *validated.ValidationRatio
	}
	if details == nil {
		details = map[string]any{}
	}
	details["sealed_at"] = validated.SealedAt
	details["marker_lsn"] = validated.MarkerLSN
	details["content_hash"] = validated.ContentHash
	details["worm_validated"] = validated.IsValidated
	scan, err := s.cleanroom.ScanRecoveryPoint(ctx, tenantID, pointID)
	if err != nil {
		return failover.FinalSyncResult{}, fmt.Errorf("clean-room scan recovery point: %w", err)
	}
	if scan == nil || !scan.Clean() {
		verdict := ""
		if scan != nil {
			verdict = scan.Verdict
		}
		return failover.FinalSyncResult{}, fmt.Errorf("clean-room scan recovery point: verdict %q blocks promotion", verdict)
	}
	details["cleanroom_verdict"] = scan.Verdict
	details["cleanroom_scan_id"] = scan.ID
	details["cleanroom_scanner"] = scan.Scanner
	details["cleanroom_chunks_scanned"] = scan.ChunksScanned
	details["cleanroom_bytes_scanned"] = scan.BytesScanned
	return failover.FinalSyncResult{
		RecoveryPointID: validated.ID,
		RPOSeconds:      validated.RPOSeconds,
		ValidationRatio: ratio,
		Details:         details,
	}, nil
}
