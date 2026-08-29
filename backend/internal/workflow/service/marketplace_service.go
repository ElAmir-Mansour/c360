package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// Marketplace sentinel errors. They wrap model.ErrConflict / model.ErrNotFound so
// the existing handler error mapping (handleServiceError) turns them into the
// right HTTP status without new mapping arms.
var (
	// ErrMarketplaceSelfReview is the FAIL-CLOSED separation-of-duties error: the
	// reviewer of a marketplace item version is the same actor who published it
	// (publisher == approver). Wraps model.ErrConflict so it maps to 409/Conflict,
	// matching the promotion four-eyes gate's classification.
	ErrMarketplaceSelfReview = fmt.Errorf("marketplace review approver must differ from the publisher (separation of duties): %w", model.ErrConflict)
	// ErrMarketplaceReviewerRequired is returned when a review is attempted with no
	// approver identity. Wraps model.ErrConflict.
	ErrMarketplaceReviewerRequired = fmt.Errorf("marketplace review requires an approver identity: %w", model.ErrConflict)
	// ErrMarketplaceNotReviewed is returned when an INSTALL targets a version that
	// has not passed the four-eyes review gate (status != published). Wraps
	// model.ErrConflict. Fail-closed: an unreviewed item is not installable.
	ErrMarketplaceNotReviewed = fmt.Errorf("marketplace item version is not reviewed/published and cannot be installed: %w", model.ErrConflict)
	// ErrMarketplaceInvalidKind is returned for an unknown item kind.
	ErrMarketplaceInvalidKind = fmt.Errorf("invalid marketplace item kind: %w", model.ErrConflict)
)

// MarketplaceBrowseFilter narrows a marketplace browse. It is the exported,
// package-boundary filter the handler passes to Browse; the repository adapter
// maps it onto repository.MarketplaceListFilter. Empty fields are ignored; a
// browse always unions the tenant's own items with the globals.
type MarketplaceBrowseFilter struct {
	Kind         string
	Category     string
	Maturity     string
	Status       string
	LatestPerKey bool
}

// marketplaceRepo is the persistence surface the marketplace service needs. The
// concrete *repository.MarketplaceRepository satisfies it; tests inject a fake.
type marketplaceRepo interface {
	ListItems(ctx context.Context, tenantID string, f MarketplaceBrowseFilter) ([]*model.MarketplaceItem, error)
	ListVersions(ctx context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error)
	GetItem(ctx context.Context, tenantID, id string) (*model.MarketplaceItem, error)
	GetVersion(ctx context.Context, tenantID, kind, key, version string) (*model.MarketplaceItem, error)
	UpsertItem(ctx context.Context, item *model.MarketplaceItem) (*model.MarketplaceItem, error)
	MarkReviewed(ctx context.Context, tenantID, id, reviewedBy, reason string, reviewedAt interface{}) (*model.MarketplaceItem, error)
	GetInstall(ctx context.Context, tenantID, marketplaceItemID string) (*model.MarketplaceInstall, error)
	CreateInstall(ctx context.Context, inst *model.MarketplaceInstall) (*model.MarketplaceInstall, error)
}

// templateInstantiator is the OPTIONAL seam the marketplace uses to instantiate a
// template item's payload into a tenant workflow definition. *TemplateService
// satisfies it via InstantiateFromPayload. When nil, installing a template item
// records provenance but cannot instantiate (returns a clear error) — so the
// dependency is optional and the marketplace stays additive.
type templateInstantiator interface {
	InstantiateFromPayload(ctx context.Context, tenantID, userID string, payload []byte, category, nameOverride, descOverride, marketplaceItemID, marketplaceItemVersion string) (*model.WorkflowDefinition, error)
}

// provenanceStamper is the OPTIONAL seam to stamp the marketplace origin on the
// created definition row. *repository.DefinitionRepository satisfies it. Best
// effort: a stamp failure never fails the install (the installs ledger is the
// authoritative provenance record).
type provenanceStamper interface {
	StampMarketplaceProvenance(ctx context.Context, tenantID, defID, marketplaceItemID, marketplaceItemVersion string) error
}

// connectorRegistrar is the OPTIONAL seam to register/record a connector
// manifest when a connector item is installed. When nil, installing a connector
// records provenance only (the manifest is persisted in the install ledger and
// the item payload); a wired registrar additionally activates it in the tenant's
// integration registry. Kept optional so the marketplace does not hard-depend on
// the integration framework.
type connectorRegistrar interface {
	RegisterConnectorManifest(ctx context.Context, tenantID, userID string, manifest []byte) (connectorKey string, err error)
}

// MarketplaceService runs the governed marketplace lifecycle:
// publish -> review (four-eyes distinct-approver, fail-closed) -> install
// (instantiate a template definition with provenance, or register a connector),
// emitting marketplace.item.published/reviewed/installed audit events via the
// wired event publisher (platform.workflow.events -> hash-chain audit).
type MarketplaceService struct {
	repo         marketplaceRepo
	instantiator templateInstantiator
	stamper      provenanceStamper
	registrar    connectorRegistrar
	publisher    eventPublisher
	logger       zerolog.Logger

	// requireReview, when true, enforces the four-eyes distinct-approver gate on
	// review (publisher != approver). It is ON by default (the governed default);
	// WithReviewGate(false) relaxes it only for tests/tooling.
	requireReview bool
}

// NewMarketplaceService constructs the marketplace service. The four-eyes review
// gate is ON by default. Optional seams (template instantiator, provenance
// stamper, connector registrar, audit publisher) are attached via the With*
// setters so the service stays usable with any subset wired.
func NewMarketplaceService(repo marketplaceRepo, logger zerolog.Logger) *MarketplaceService {
	return &MarketplaceService{
		repo:          repo,
		logger:        logger.With().Str("service", "workflow-marketplace").Logger(),
		requireReview: true,
	}
}

// WithTemplateInstantiator wires the template-instantiation seam (install of a
// template item). Returns the receiver for chaining.
func (s *MarketplaceService) WithTemplateInstantiator(i templateInstantiator) *MarketplaceService {
	s.instantiator = i
	return s
}

// WithProvenanceStamper wires the definition provenance stamper. Returns the receiver.
func (s *MarketplaceService) WithProvenanceStamper(p provenanceStamper) *MarketplaceService {
	s.stamper = p
	return s
}

// WithConnectorRegistrar wires the optional connector registrar. Returns the receiver.
func (s *MarketplaceService) WithConnectorRegistrar(c connectorRegistrar) *MarketplaceService {
	s.registrar = c
	return s
}

// WithAuditPublisher wires the marketplace audit emitter. Returns the receiver.
func (s *MarketplaceService) WithAuditPublisher(p eventPublisher) *MarketplaceService {
	s.publisher = p
	return s
}

// WithReviewGate toggles the four-eyes distinct-approver review gate. ON by
// default; disable only for tooling/tests. Returns the receiver.
func (s *MarketplaceService) WithReviewGate(require bool) *MarketplaceService {
	s.requireReview = require
	return s
}

// PublishItemRequest is the input to Publish. TenantScope empty publishes a
// GLOBAL item (platform-published, visible to all tenants); a tenant UUID
// publishes a tenant-private item. Version is a semver string.
type PublishItemRequest struct {
	TenantScope     string
	Kind            string
	Key             string
	TitleI18n       map[string]string
	DescriptionI18n map[string]string
	Category        string
	Tags            []string
	Version         string
	Maturity        string
	Publisher       string
	Payload         json.RawMessage
	Source          string
	// PublishedBy is the acting user id, stamped as provenance and (critically)
	// compared against the reviewer at review time for the four-eyes gate.
	PublishedBy string
}

// Publish creates or versions a marketplace item. The item is born in
// MarketplaceStatusDraft (published-but-unreviewed): it is visible in the
// catalog but NOT installable until it passes the four-eyes review. Publish is
// idempotent on (tenant, kind, key, version) — re-publishing the same version
// refreshes it in place (and, if it had been reviewed, resets it to draft so the
// changed payload must be re-reviewed — fail-closed). Emits
// marketplace.item.published.
func (s *MarketplaceService) Publish(ctx context.Context, req PublishItemRequest) (*model.MarketplaceItem, error) {
	if !model.ValidMarketplaceKinds[req.Kind] {
		return nil, ErrMarketplaceInvalidKind
	}
	if req.Key == "" {
		return nil, fmt.Errorf("marketplace item key is required")
	}
	if len(req.Payload) == 0 {
		return nil, fmt.Errorf("marketplace item payload is required")
	}
	sv, err := model.ParseSemver(req.Version)
	if err != nil {
		return nil, fmt.Errorf("marketplace item version: %w", err)
	}
	maturity := req.Maturity
	if maturity == "" {
		maturity = model.MarketplaceMaturityGA
	}
	if !model.ValidMarketplaceMaturities[maturity] {
		return nil, fmt.Errorf("invalid marketplace maturity %q: %w", maturity, model.ErrConflict)
	}

	now := time.Now().UTC()
	item := &model.MarketplaceItem{
		TenantScope:     req.TenantScope,
		Kind:            req.Kind,
		Key:             req.Key,
		TitleI18n:       req.TitleI18n,
		DescriptionI18n: req.DescriptionI18n,
		Category:        req.Category,
		Tags:            req.Tags,
		Version:         sv.String(),
		VersionMajor:    sv.Major,
		VersionMinor:    sv.Minor,
		VersionPatch:    sv.Patch,
		Maturity:        maturity,
		Publisher:       req.Publisher,
		Payload:         req.Payload,
		Source:          req.Source,
		Checksum:        checksumPayload(req.Payload),
		PublishedBy:     req.PublishedBy,
		PublishedAt:     &now,
		// Born unreviewed. A re-publish resets to draft so a changed payload must
		// be re-reviewed (the review stamps are cleared here, fail-closed).
		Status:       model.MarketplaceStatusDraft,
		ReviewedBy:   nil,
		ReviewedAt:   nil,
		ReviewReason: nil,
	}

	saved, err := s.repo.UpsertItem(ctx, item)
	if err != nil {
		return nil, fmt.Errorf("publishing marketplace item: %w", err)
	}

	s.emit(ctx, "marketplace.item.published", scopeTenant(req.TenantScope), map[string]interface{}{
		"marketplace_item_id": saved.ID,
		"kind":                saved.Kind,
		"key":                 saved.Key,
		"version":             saved.Version,
		"maturity":            saved.Maturity,
		"global":              saved.TenantScope == "",
		"published_by":        saved.PublishedBy,
		"checksum":            saved.Checksum,
	})

	s.logger.Info().
		Str("marketplace_item_id", saved.ID).
		Str("kind", saved.Kind).
		Str("key", saved.Key).
		Str("version", saved.Version).
		Str("published_by", saved.PublishedBy).
		Msg("marketplace item published (awaiting review)")

	return saved, nil
}

// Review is the GOVERNED four-eyes gate. It clears an item version for install
// only when the reviewer is a DISTINCT actor from the publisher (separation of
// duties, fail-closed — reusing the same maker != checker primitive the
// promotion prod gate enforces). On success it sets status=published and stamps
// the reviewer; emits marketplace.item.reviewed.
func (s *MarketplaceService) Review(ctx context.Context, tenantID, itemID, reviewedBy, reason string) (*model.MarketplaceItem, error) {
	if itemID == "" {
		return nil, fmt.Errorf("marketplace item id is required")
	}

	item, err := s.repo.GetItem(ctx, tenantID, itemID)
	if err != nil {
		return nil, err
	}

	if s.requireReview {
		if reviewedBy == "" {
			return nil, ErrMarketplaceReviewerRequired
		}
		// Fail-closed separation of duties: the approver MUST differ from the
		// publisher. Enforced BEFORE the write so a rejected review never mutates
		// the row or emits an event.
		if item.PublishedBy != "" && reviewedBy == item.PublishedBy {
			return nil, ErrMarketplaceSelfReview
		}
	}

	now := time.Now().UTC()
	reviewed, err := s.repo.MarkReviewed(ctx, tenantID, itemID, reviewedBy, reason, now)
	if err != nil {
		return nil, fmt.Errorf("recording marketplace review: %w", err)
	}

	s.emit(ctx, "marketplace.item.reviewed", scopeTenant(reviewed.TenantScope), map[string]interface{}{
		"marketplace_item_id": reviewed.ID,
		"kind":                reviewed.Kind,
		"key":                 reviewed.Key,
		"version":             reviewed.Version,
		"published_by":        reviewed.PublishedBy,
		"reviewed_by":         reviewedBy,
		"review_reason":       reason,
		"status":              reviewed.Status,
	})

	s.logger.Info().
		Str("marketplace_item_id", reviewed.ID).
		Str("published_by", reviewed.PublishedBy).
		Str("reviewed_by", reviewedBy).
		Msg("marketplace item reviewed and published")

	return reviewed, nil
}

// InstallResult carries the outcome of an install: the source item, the created
// definition (template kind) or registered connector key (connector kind), and
// whether the call was idempotent (the tenant had already installed this exact
// version).
type InstallResult struct {
	Item         *model.MarketplaceItem
	Install      *model.MarketplaceInstall
	Definition   *model.WorkflowDefinition
	ConnectorKey string
	AlreadyDone  bool
}

// Install installs a reviewed marketplace item version into a tenant. For a
// template item it INSTANTIATES a workflow definition from the payload (reusing
// the template instantiation path), stamped with the marketplace provenance; for
// a connector item it registers/records the manifest. Install is IDEMPOTENT: a
// re-install of the same (tenant, item version) is a no-op that returns the
// existing install record (AlreadyDone=true). Fail-closed: only a reviewed
// (status=published) version is installable. Emits marketplace.item.installed.
func (s *MarketplaceService) Install(ctx context.Context, tenantID, userID, itemID, nameOverride, descOverride string) (*InstallResult, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}
	if itemID == "" {
		return nil, fmt.Errorf("marketplace item id is required")
	}

	item, err := s.repo.GetItem(ctx, tenantID, itemID)
	if err != nil {
		return nil, err
	}
	// Fail-closed: an unreviewed version is not installable.
	if item.Status != model.MarketplaceStatusPublished {
		return nil, ErrMarketplaceNotReviewed
	}

	// Idempotency: if this tenant already installed this exact item version,
	// return the existing record without re-instantiating.
	if existing, gerr := s.repo.GetInstall(ctx, tenantID, item.ID); gerr == nil {
		s.logger.Info().
			Str("marketplace_item_id", item.ID).
			Str("tenant_id", tenantID).
			Msg("marketplace item already installed; idempotent no-op")
		return &InstallResult{Item: item, Install: existing, AlreadyDone: true}, nil
	} else if !errors.Is(gerr, model.ErrNotFound) {
		return nil, fmt.Errorf("checking existing marketplace install: %w", gerr)
	}

	res := &InstallResult{Item: item}

	switch item.Kind {
	case model.MarketplaceKindTemplate:
		if s.instantiator == nil {
			return nil, fmt.Errorf("template instantiation is not wired; cannot install template item")
		}
		def, ierr := s.instantiator.InstantiateFromPayload(
			ctx, tenantID, userID, item.Payload, item.Category, nameOverride, descOverride, item.ID, item.Version)
		if ierr != nil {
			return nil, fmt.Errorf("instantiating template item: %w", ierr)
		}
		res.Definition = def
		// Best-effort provenance stamp on the definition row (the installs ledger
		// is the authoritative record; a stamp failure must not fail the install).
		if s.stamper != nil {
			if serr := s.stamper.StampMarketplaceProvenance(ctx, tenantID, def.ID, item.ID, item.Version); serr != nil {
				s.logger.Warn().Err(serr).Str("definition_id", def.ID).Msg("stamping marketplace provenance on definition")
			}
		}
		defID := def.ID
		inst := &model.MarketplaceInstall{
			TenantID:          tenantID,
			MarketplaceItemID: item.ID,
			Kind:              item.Kind,
			ItemKey:           item.Key,
			ItemVersion:       item.Version,
			DefinitionID:      &defID,
			InstalledBy:       userID,
		}
		saved, cerr := s.repo.CreateInstall(ctx, inst)
		if cerr != nil {
			return nil, fmt.Errorf("recording template install: %w", cerr)
		}
		res.Install = saved

	case model.MarketplaceKindConnector:
		connectorKey := item.Key // default: the manifest key is the item key.
		if s.registrar != nil {
			ck, rerr := s.registrar.RegisterConnectorManifest(ctx, tenantID, userID, item.Payload)
			if rerr != nil {
				return nil, fmt.Errorf("registering connector item: %w", rerr)
			}
			if ck != "" {
				connectorKey = ck
			}
		}
		res.ConnectorKey = connectorKey
		inst := &model.MarketplaceInstall{
			TenantID:          tenantID,
			MarketplaceItemID: item.ID,
			Kind:              item.Kind,
			ItemKey:           item.Key,
			ItemVersion:       item.Version,
			ConnectorKey:      &connectorKey,
			InstalledBy:       userID,
		}
		saved, cerr := s.repo.CreateInstall(ctx, inst)
		if cerr != nil {
			return nil, fmt.Errorf("recording connector install: %w", cerr)
		}
		res.Install = saved

	default:
		return nil, ErrMarketplaceInvalidKind
	}

	payload := map[string]interface{}{
		"marketplace_item_id": item.ID,
		"kind":                item.Kind,
		"key":                 item.Key,
		"version":             item.Version,
		"installed_by":        userID,
		"source_global":       item.TenantScope == "",
	}
	if res.Definition != nil {
		payload["definition_id"] = res.Definition.ID
	}
	if res.ConnectorKey != "" {
		payload["connector_key"] = res.ConnectorKey
	}
	s.emit(ctx, "marketplace.item.installed", tenantID, payload)

	s.logger.Info().
		Str("marketplace_item_id", item.ID).
		Str("tenant_id", tenantID).
		Str("kind", item.Kind).
		Str("version", item.Version).
		Msg("marketplace item installed")

	return res, nil
}

// Browse lists the marketplace items visible to a tenant (its own + globals),
// filtered. The repository adapter maps the filter onto the repository filter.
func (s *MarketplaceService) Browse(ctx context.Context, tenantID string, f MarketplaceBrowseFilter) ([]*model.MarketplaceItem, error) {
	return s.repo.ListItems(ctx, tenantID, f)
}

// Versions lists every version of one logical item (kind,key) visible to the tenant.
func (s *MarketplaceService) Versions(ctx context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error) {
	if kind == "" {
		kind = model.MarketplaceKindTemplate
	}
	return s.repo.ListVersions(ctx, tenantID, kind, key)
}

// GetItem loads a single item version by id.
func (s *MarketplaceService) GetItem(ctx context.Context, tenantID, id string) (*model.MarketplaceItem, error) {
	return s.repo.GetItem(ctx, tenantID, id)
}

// emit publishes a marketplace audit event when a publisher is wired. Best
// effort: an emit failure is logged, never failing the operation.
func (s *MarketplaceService) emit(ctx context.Context, eventType, tenantID string, data map[string]interface{}) {
	if s.publisher == nil {
		return
	}
	evt, err := events.NewEvent(eventType, "workflow-engine", tenantID, data)
	if err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to build marketplace audit event")
		return
	}
	if err := s.publisher.Publish(ctx, events.Topics.WorkflowEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to publish marketplace audit event")
	}
}

// checksumPayload returns the hex SHA-256 of the payload for tamper-evidence
// provenance. Deterministic over the raw bytes as published.
func checksumPayload(payload []byte) string {
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// scopeTenant maps an item's tenant scope onto the audit-event tenant field: a
// global item ("") is emitted under the empty (platform) tenant.
func scopeTenant(tenantScope string) string {
	return tenantScope
}
