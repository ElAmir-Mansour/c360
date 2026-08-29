package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
)

// fakeRepo implements the repo interface for the DB-free code paths (Compute,
// ComputeWith, and input validation). The tx-bound governance paths (CreateDraft
// / Publish / Archive) run through database.RunInTx and are covered by the
// build-tagged integration tests; here we cover the pure orchestration.
type fakeRepo struct {
	active    *model.PricingConfig
	byVersion map[int]*model.PricingConfig
	activeErr error
}

func (f *fakeRepo) GetActive(ctx context.Context, db repository.DBTX) (*model.PricingConfig, error) {
	if f.activeErr != nil {
		return nil, f.activeErr
	}
	if f.active == nil {
		return nil, model.ErrNoActive
	}
	return f.active, nil
}

func (f *fakeRepo) GetByVersion(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error) {
	if c, ok := f.byVersion[version]; ok {
		return c, nil
	}
	return nil, model.ErrNotFound
}

func (f *fakeRepo) List(ctx context.Context, db repository.DBTX) ([]*model.PricingConfig, error) {
	return nil, nil
}
func (f *fakeRepo) MaxVersion(ctx context.Context, db repository.DBTX) (int, error) { return 0, nil }
func (f *fakeRepo) CreateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (f *fakeRepo) UpdateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (f *fakeRepo) ArchiveActive(ctx context.Context, db repository.DBTX) error { return nil }
func (f *fakeRepo) Activate(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error) {
	return nil, nil
}
func (f *fakeRepo) ArchiveVersion(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error) {
	return nil, nil
}

func newTestService(f *fakeRepo) *Service {
	// nil pool is safe: Compute / ComputeWith / validation never open a tx.
	return New(nil, f, zerolog.Nop())
}

func activeDefault() *fakeRepo {
	return &fakeRepo{
		active: &model.PricingConfig{Version: 1, Status: model.ConfigStatusActive, Rates: model.DefaultConfig()},
		byVersion: map[int]*model.PricingConfig{
			1: {Version: 1, Status: model.ConfigStatusActive, Rates: model.DefaultConfig()},
		},
	}
}

func TestCompute_UsesActiveConfig_PerUserGolden(t *testing.T) {
	s := newTestService(activeDefault())
	in := model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 1, HotStorageGB: 2, ColdStorageGB: 5}
	q, err := s.Compute(context.Background(), in)
	if err != nil {
		t.Fatalf("Compute: %v", err)
	}
	if q.PricingVersion != 1 {
		t.Errorf("pricing_version: got %d, want 1", q.PricingVersion)
	}
	if len(q.Tiers) != 4 {
		t.Fatalf("expected 4 tiers, got %d", len(q.Tiers))
	}
	// Standard TotalMonthly golden = 156.414375.
	var std model.InternalTier
	for _, ti := range q.Tiers {
		if ti.Tier == model.TierStandard {
			std = ti
		}
	}
	if diff := std.TotalMonthly - 156.414375; diff > 0.01 || diff < -0.01 {
		t.Errorf("Standard TotalMonthly: got %.6f, want 156.414375", std.TotalMonthly)
	}
}

func TestCompute_NoActiveConfig(t *testing.T) {
	s := newTestService(&fakeRepo{})
	_, err := s.Compute(context.Background(), model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 1})
	if !errors.Is(err, model.ErrNoActive) {
		t.Fatalf("expected ErrNoActive, got %v", err)
	}
}

func TestCompute_RejectsBadInputs(t *testing.T) {
	s := newTestService(activeDefault())
	cases := map[string]model.Inputs{
		"bad model":      {Model: "nope", Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 1},
		"bad deployment": {Model: model.ModelPerUser, Deployment: 9, TermMonths: 12, Users: 1},
		"zero term":      {Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 0, Users: 1},
		"negative users": {Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: -5},
	}
	for name, in := range cases {
		if _, err := s.Compute(context.Background(), in); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

func TestComputeWith_ExplicitVersion(t *testing.T) {
	s := newTestService(activeDefault())
	in := model.Inputs{Model: model.ModelPerCore, Deployment: model.DeploymentSaaS, TermMonths: 12, Cores: 1, VMs: 1, HotStorageGB: 2, ColdStorageGB: 5}
	q, err := s.ComputeWith(context.Background(), in, 1)
	if err != nil {
		t.Fatalf("ComputeWith: %v", err)
	}
	// per_core Standard TotalMonthly golden = 736.66125.
	for _, ti := range q.Tiers {
		if ti.Tier == model.TierStandard {
			if diff := ti.TotalMonthly - 736.66125; diff > 0.01 || diff < -0.01 {
				t.Errorf("per_core Standard TotalMonthly: got %.6f, want 736.66125", ti.TotalMonthly)
			}
		}
	}
	if _, err := s.ComputeWith(context.Background(), in, 99); !errors.Is(err, model.ErrNotFound) {
		t.Errorf("unknown version: expected ErrNotFound, got %v", err)
	}
}
