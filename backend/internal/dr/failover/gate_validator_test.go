package failover

import (
	"context"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

type gateValidatorFakeRepo struct {
	point  *model.RecoveryPoint
	safety repository.PromotionSafety
}

func (r gateValidatorFakeRepo) SystemGetRecoveryPoint(context.Context, repository.DBTX, string) (*model.RecoveryPoint, error) {
	return r.point, nil
}

func (r gateValidatorFakeRepo) SystemLatestValidatedRecoveryPoint(context.Context, repository.DBTX, string) (*model.RecoveryPoint, error) {
	return r.point, nil
}

func (r gateValidatorFakeRepo) SystemRecoveryPointPromotionSafety(context.Context, repository.DBTX, string) (repository.PromotionSafety, error) {
	return r.safety, nil
}

type gateValidatorFakeRunner struct{}

func (gateValidatorFakeRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func TestDriverGateValidator_PassesOnlyWhenValidatedCleanroomAndRansomwareClear(t *testing.T) {
	ratio := 1.0
	point := &model.RecoveryPoint{
		ID:              "rp-1",
		TenantID:        "tenant-1",
		GroupID:         "group-1",
		MarkerLSN:       "0/ABC",
		RPOSeconds:      4,
		ValidationRatio: &ratio,
		IsValidated:     true,
		SealedAt:        time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC),
	}
	validator := NewDriverGateValidator(gateValidatorFakeRepo{
		point: point,
		safety: repository.PromotionSafety{
			CleanroomScanFound: true,
			CleanroomVerdict:   "clean",
		},
	}, gateValidatorFakeRunner{})

	decision, err := validator.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{
		ID:      "run-1",
		GroupID: "group-1",
	})
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if !decision.Passed() {
		t.Fatalf("decision should pass: %+v", decision)
	}
	if decision.Details["cleanroom_clean"] != true || decision.Details["ransomware_clear"] != true {
		t.Fatalf("missing safety details: %#v", decision.Details)
	}
}

func TestDriverGateValidator_BlocksMissingCleanroomScan(t *testing.T) {
	ratio := 1.0
	validator := NewDriverGateValidator(gateValidatorFakeRepo{
		point: &model.RecoveryPoint{
			ID:              "rp-1",
			GroupID:         "group-1",
			ValidationRatio: &ratio,
			IsValidated:     true,
		},
		safety: repository.PromotionSafety{},
	}, gateValidatorFakeRunner{})

	decision, err := validator.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{GroupID: "group-1"})
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if decision.Passed() {
		t.Fatalf("decision should not pass without clean-room scan: %+v", decision)
	}
	if got := decision.Details["promotion_blocked_reason"]; got != "clean-room scan is required before recovery-point promotion" {
		t.Fatalf("blocked reason = %v", got)
	}
}

func TestDriverGateValidator_BlocksRansomwareSignals(t *testing.T) {
	ratio := 1.0
	validator := NewDriverGateValidator(gateValidatorFakeRepo{
		point: &model.RecoveryPoint{
			ID:              "rp-1",
			GroupID:         "group-1",
			ValidationRatio: &ratio,
			IsValidated:     true,
		},
		safety: repository.PromotionSafety{
			CleanroomScanFound:        true,
			CleanroomVerdict:          "clean",
			RansomwareBlockingSignals: 2,
		},
	}, gateValidatorFakeRunner{})

	decision, err := validator.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{GroupID: "group-1"})
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if decision.Passed() {
		t.Fatalf("decision should not pass with ransomware blockers: %+v", decision)
	}
	if got := decision.Details["ransomware_blocking_signals"]; got != 2 {
		t.Fatalf("ransomware_blocking_signals = %v", got)
	}
}
