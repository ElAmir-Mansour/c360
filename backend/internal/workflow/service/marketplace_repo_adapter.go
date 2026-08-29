package service

import (
	"context"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// marketplaceRepoAdapter adapts the concrete *repository.MarketplaceRepository to
// the service's marketplaceRepo seam. The only real work it does is map the
// service-level filter (repositoryMarketplaceFilter) onto the repository filter
// (repository.MarketplaceListFilter); every other method delegates directly.
// This keeps the service interface free of a repository import in its signatures
// so tests can inject a lightweight fake, while production wires the real repo.
type marketplaceRepoAdapter struct {
	repo *repository.MarketplaceRepository
}

// NewMarketplaceRepoAdapter wraps a concrete MarketplaceRepository as the seam
// the MarketplaceService consumes.
func NewMarketplaceRepoAdapter(repo *repository.MarketplaceRepository) *marketplaceRepoAdapter {
	return &marketplaceRepoAdapter{repo: repo}
}

func (a *marketplaceRepoAdapter) ListItems(ctx context.Context, tenantID string, f MarketplaceBrowseFilter) ([]*model.MarketplaceItem, error) {
	return a.repo.ListItems(ctx, tenantID, repository.MarketplaceListFilter{
		Kind:         f.Kind,
		Category:     f.Category,
		Maturity:     f.Maturity,
		Status:       f.Status,
		LatestPerKey: f.LatestPerKey,
	})
}

func (a *marketplaceRepoAdapter) ListVersions(ctx context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error) {
	return a.repo.ListVersions(ctx, tenantID, kind, key)
}

func (a *marketplaceRepoAdapter) GetItem(ctx context.Context, tenantID, id string) (*model.MarketplaceItem, error) {
	return a.repo.GetItem(ctx, tenantID, id)
}

func (a *marketplaceRepoAdapter) GetVersion(ctx context.Context, tenantID, kind, key, version string) (*model.MarketplaceItem, error) {
	return a.repo.GetVersion(ctx, tenantID, kind, key, version)
}

func (a *marketplaceRepoAdapter) UpsertItem(ctx context.Context, item *model.MarketplaceItem) (*model.MarketplaceItem, error) {
	return a.repo.UpsertItem(ctx, item)
}

func (a *marketplaceRepoAdapter) MarkReviewed(ctx context.Context, tenantID, id, reviewedBy, reason string, reviewedAt interface{}) (*model.MarketplaceItem, error) {
	return a.repo.MarkReviewed(ctx, tenantID, id, reviewedBy, reason, reviewedAt)
}

func (a *marketplaceRepoAdapter) GetInstall(ctx context.Context, tenantID, marketplaceItemID string) (*model.MarketplaceInstall, error) {
	return a.repo.GetInstall(ctx, tenantID, marketplaceItemID)
}

func (a *marketplaceRepoAdapter) CreateInstall(ctx context.Context, inst *model.MarketplaceInstall) (*model.MarketplaceInstall, error) {
	return a.repo.CreateInstall(ctx, inst)
}
