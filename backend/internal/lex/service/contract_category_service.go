package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractCategoryService owns the manual contract-categorization surface
// (CAP-123): it exposes a tenant's category catalog and applies operator-selected
// categories onto a contract's tags + a metadata{categorized_at, categorized_by}
// stamp. It is deliberately SEPARATE from ContractService.ClassifyContract (the
// AI ClassificationResult path): categorization writes a human-curated vocabulary,
// never an inferred recommended_type, and runs no analyzer.
type ContractCategoryService struct {
	db         *pgxpool.Pool
	contracts  *repository.ContractRepository
	categories *repository.ContractCategoryRepository
	publisher  Publisher
	topic      string
	now        func() time.Time
	logger     zerolog.Logger
}

func NewContractCategoryService(db *pgxpool.Pool, contracts *repository.ContractRepository, categories *repository.ContractCategoryRepository, publisher Publisher, topic string, logger zerolog.Logger) *ContractCategoryService {
	return &ContractCategoryService{
		db:         db,
		contracts:  contracts,
		categories: categories,
		publisher:  publisherOrNoop(publisher),
		topic:      topic,
		now:        time.Now,
		logger:     logger.With().Str("service", "lex-contract-categories").Logger(),
	}
}

// ListCategories returns the tenant's manual category catalog (the dropdown feed).
func (s *ContractCategoryService) ListCategories(ctx context.Context, tenantID uuid.UUID) ([]model.ContractCategory, error) {
	items, err := s.categories.ListByTenant(ctx, tenantID)
	if err != nil {
		return nil, internalError("list contract categories", err)
	}
	return items, nil
}

// CategorizeContract applies the operator-selected category slugs to a contract.
// Selected slugs are validated against the tenant catalog, merged into the
// contract's existing tags (de-duplicated), and a categorization stamp is written
// into metadata. This NEVER touches contract.Type — that is the AI classify path.
func (s *ContractCategoryService) CategorizeContract(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.CategorizeContractRequest) (*model.ContractCategorizationResult, error) {
	req.Normalize()

	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}

	// Validate the requested slugs against the tenant catalog so a contract can
	// only be categorized with a curated vocabulary entry.
	catalog, err := s.categories.ListByTenant(ctx, tenantID)
	if err != nil {
		return nil, internalError("list contract categories", err)
	}
	valid := make(map[string]struct{}, len(catalog))
	for _, c := range catalog {
		valid[c.Slug] = struct{}{}
	}
	for _, slug := range req.CategoryTags {
		if _, ok := valid[slug]; !ok {
			return nil, validationError("category_tags contains an unknown category", map[string]string{"category_tags": "unknown category: " + slug})
		}
	}

	// Merge category slugs into the contract's existing tags, de-duplicated and
	// stably ordered (existing tags first, then any newly-selected categories).
	contract.Tags = mergeContractTags(contract.Tags, req.CategoryTags)

	categorizedAt := s.now().UTC()
	contract.Metadata = normalizeContractMetadata(contract.Metadata)
	contract.Metadata["categorization"] = map[string]any{
		"category_tags":  req.CategoryTags,
		"categorized_at": categorizedAt.Format(time.RFC3339Nano),
		"categorized_by": userID.String(),
	}
	// Top-level stamp mirroring the contract-classify convention so consumers can
	// read the categorization time/actor without unwrapping the nested object.
	contract.Metadata["categorized_at"] = categorizedAt.Format(time.RFC3339Nano)
	contract.Metadata["categorized_by"] = userID.String()

	if err := s.contracts.Update(ctx, s.db, contract); err != nil {
		return nil, internalError("apply contract categorization", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.categorized", tenantID, &userID, map[string]any{
		"id":            contract.ID,
		"category_tags": req.CategoryTags,
		"tags":          contract.Tags,
	}, s.logger)

	return &model.ContractCategorizationResult{
		ContractID:    contract.ID,
		CategoryTags:  req.CategoryTags,
		Tags:          contract.Tags,
		CategorizedAt: categorizedAt,
		CategorizedBy: userID,
	}, nil
}

// mergeContractTags returns existing tags with any new tags appended, preserving
// existing order and de-duplicating. Inputs are assumed already normalized
// (trim/lower) by the DTO/contract layer.
func mergeContractTags(existing, added []string) []string {
	out := make([]string, 0, len(existing)+len(added))
	seen := make(map[string]struct{}, len(existing)+len(added))
	for _, t := range existing {
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	for _, t := range added {
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}
