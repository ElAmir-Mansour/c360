package failover

import (
	"context"
	"fmt"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// gateValidatorRepo is the read surface the Gate-1 validator needs. The leader
// singleton runs across tenants, so it reads through the system path (§7).
type gateValidatorRepo interface {
	SystemGetRecoveryPoint(ctx context.Context, db repository.DBTX, id string) (*model.RecoveryPoint, error)
	SystemLatestValidatedRecoveryPoint(ctx context.Context, db repository.DBTX, groupID string) (*model.RecoveryPoint, error)
	SystemRecoveryPointPromotionSafety(ctx context.Context, db repository.DBTX, recoveryPointID string) (repository.PromotionSafety, error)
}

// gateValidatorRunner runs the validator's read without a tenant filter.
type gateValidatorRunner interface {
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// DriverGateValidator implements the Driver's Gate-1 GateValidator: it selects
// the recovery point to pin and reports its recorded data-fidelity validation
// ratio. The recovery point is either the one the operator pinned on the run
// (validated at seal time by the recovery-point store, §15.3) or, absent that,
// the newest VALIDATED point for the group. The decision Passes only when the
// point is validated and its ratio meets the 99.9% GA threshold — the real Gate
// 1 (Validate) bar, read from the real recovery_point row, not fabricated.
type DriverGateValidator struct {
	repo   gateValidatorRepo
	runner gateValidatorRunner
}

// NewDriverGateValidator wires the Gate-1 validator over the system read path.
func NewDriverGateValidator(repo gateValidatorRepo, runner gateValidatorRunner) *DriverGateValidator {
	return &DriverGateValidator{repo: repo, runner: runner}
}

// ValidateRecoveryPoint resolves and returns the Gate-1 decision for a run.
func (v *DriverGateValidator) ValidateRecoveryPoint(ctx context.Context, run *model.FailoverRun) (RecoveryPointDecision, error) {
	var point *model.RecoveryPoint
	var safety repository.PromotionSafety
	if err := v.runner.RunSystemRead(ctx, func(tx repository.DBTX) error {
		var rerr error
		if run.RecoveryPointID != nil && *run.RecoveryPointID != "" {
			point, rerr = v.repo.SystemGetRecoveryPoint(ctx, tx, *run.RecoveryPointID)
		} else {
			point, rerr = v.repo.SystemLatestValidatedRecoveryPoint(ctx, tx, run.GroupID)
		}
		if rerr != nil {
			return rerr
		}
		if point == nil {
			return fmt.Errorf("recovery point for group %s: %w", run.GroupID, model.ErrNotFound)
		}
		safety, rerr = v.repo.SystemRecoveryPointPromotionSafety(ctx, tx, point.ID)
		return rerr
	}); err != nil {
		return RecoveryPointDecision{}, fmt.Errorf("gate1: resolving recovery point: %w", err)
	}
	if point == nil {
		return RecoveryPointDecision{}, fmt.Errorf("gate1: no recovery point available for group %s: %w", run.GroupID, model.ErrNotFound)
	}

	ratio := 0.0
	if point.ValidationRatio != nil {
		ratio = *point.ValidationRatio
	}
	decision := RecoveryPointDecision{
		RecoveryPointID: point.ID,
		RPOSeconds:      point.RPOSeconds,
		ValidationRatio: ratio,
		Details: map[string]any{
			"marker_lsn":   point.MarkerLSN,
			"is_validated": point.IsValidated,
			"sealed_at":    point.SealedAt,
			"legal_hold":   point.LegalHold,
		},
	}
	for k, v := range safety.Detail() {
		decision.Details[k] = v
	}
	// A point that is not marked validated can never pass Gate 1 regardless of a
	// stale ratio; force the decision to fail by zeroing the ratio so the
	// Driver's Passed() guard (ratio >= 0.999) rejects it.
	if !point.IsValidated {
		decision.ValidationRatio = 0
	}
	if !safety.Safe() {
		decision.ValidationRatio = 0
		decision.Details["promotion_blocked_reason"] = safety.BlockReason()
	}
	return decision, nil
}
