package service

import (
	"context"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/seed"
)

// Platform provenance identities for the seeded gallery. The publisher and
// reviewer are DISTINCT so the seeded ceremony satisfies the SAME four-eyes
// gate a tenant publish must pass — the platform does not self-approve. These
// are stable system identities (not real users) recorded on the provenance and
// audit trail.
const (
	MarketplacePlatformPublisher = "platform-publisher"
	MarketplacePlatformReviewer  = "platform-reviewer"
	// MarketplaceSeedVersion is the initial semver stamped on every seeded pack.
	// Later content revisions publish a higher semver of the same key.
	MarketplaceSeedVersion = "1.0.0"
)

// SeedGlobalTemplates registers the embedded legal/DR template packs (the ~76
// golden templates in internal/workflow/seed) as GLOBAL marketplace items and
// clears them through the four-eyes review so the gallery is POPULATED and
// installable on day one — the sovereign vertical moat. It mirrors the existing
// template-catalog seeding (main.go's LegalTemplates -> templateRepo.Upsert): it
// is idempotent (publish is an upsert on (kind,key,version)), so it self-heals on
// every boot and across deploys.
//
// Each pack becomes a template-kind item; the WorkflowTemplate.DefinitionJSON is
// the item payload the installer instantiates. The publish is stamped
// MarketplacePlatformPublisher and then reviewed by MarketplacePlatformReviewer
// (a DISTINCT approver), so the seeded items land as MarketplaceStatusPublished.
//
// Returns the number of items published (the number reviewed equals it on
// success). A per-item failure is logged and skipped so one bad pack does not
// abort the whole gallery.
func (s *MarketplaceService) SeedGlobalTemplates(ctx context.Context) (int, error) {
	tmpls, err := seed.LegalTemplates()
	if err != nil {
		return 0, err
	}

	seeded := 0
	for _, t := range tmpls {
		if t.ID == "" || len(t.DefinitionJSON) == 0 {
			continue
		}
		item, perr := s.Publish(ctx, PublishItemRequest{
			// Global: platform-published, visible to every tenant. Preserve the
			// template's own tenant scope (empty for the golden packs == global).
			TenantScope:     t.TenantScope,
			Kind:            model.MarketplaceKindTemplate,
			Key:             t.ID,
			TitleI18n:       t.NameI18n,
			DescriptionI18n: t.DescriptionI18n,
			Category:        t.Category,
			Tags:            t.Tags,
			Version:         MarketplaceSeedVersion,
			Maturity:        model.MarketplaceMaturityGA,
			Publisher:       "Clario360",
			Payload:         t.DefinitionJSON,
			Source:          "seed:legal_templates",
			PublishedBy:     MarketplacePlatformPublisher,
		})
		if perr != nil {
			s.logger.Error().Err(perr).Str("key", t.ID).Msg("seeding global marketplace template (publish)")
			continue
		}
		// Clear the four-eyes review with a DISTINCT platform reviewer so the item
		// is installable. Idempotent: re-reviewing a published item is harmless.
		if _, rerr := s.Review(ctx, item.TenantScope, item.ID, MarketplacePlatformReviewer, "platform-seeded golden pack"); rerr != nil {
			s.logger.Error().Err(rerr).Str("key", t.ID).Str("marketplace_item_id", item.ID).Msg("seeding global marketplace template (review)")
			continue
		}
		seeded++
	}

	s.logger.Info().Int("count", seeded).Msg("seeded global marketplace template gallery")
	return seeded, nil
}
