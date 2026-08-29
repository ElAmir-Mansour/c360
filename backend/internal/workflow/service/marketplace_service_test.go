package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

// fakeMarketplaceRepo is an in-memory implementation of the marketplaceRepo seam.
// It mirrors the semantics the real repository provides: globals (TenantScope
// "") are visible to every tenant; a tenant sees globals ∪ its own rows;
// UpsertItem is idempotent on (tenant, kind, key, version); CreateInstall is
// idempotent on (tenant, item id).
type fakeMarketplaceRepo struct {
	items    []*model.MarketplaceItem
	installs []*model.MarketplaceInstall
	nextID   int
}

func newFakeMarketplaceRepo() *fakeMarketplaceRepo { return &fakeMarketplaceRepo{} }

func (f *fakeMarketplaceRepo) visible(tenantID string, it *model.MarketplaceItem) bool {
	return it.TenantScope == "" || it.TenantScope == tenantID
}

func (f *fakeMarketplaceRepo) ListItems(_ context.Context, tenantID string, filt MarketplaceBrowseFilter) ([]*model.MarketplaceItem, error) {
	var out []*model.MarketplaceItem
	for _, it := range f.items {
		if !f.visible(tenantID, it) {
			continue
		}
		if filt.Kind != "" && it.Kind != filt.Kind {
			continue
		}
		if filt.Category != "" && it.Category != filt.Category {
			continue
		}
		if filt.Maturity != "" && it.Maturity != filt.Maturity {
			continue
		}
		if filt.Status != "" && it.Status != filt.Status {
			continue
		}
		out = append(out, it)
	}
	// Order by kind, key, semver DESC (mirror the SQL ORDER BY).
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Kind != out[b].Kind {
			return out[a].Kind < out[b].Kind
		}
		if out[a].Key != out[b].Key {
			return out[a].Key < out[b].Key
		}
		sa := model.Semver{Major: out[a].VersionMajor, Minor: out[a].VersionMinor, Patch: out[a].VersionPatch}
		sb := model.Semver{Major: out[b].VersionMajor, Minor: out[b].VersionMinor, Patch: out[b].VersionPatch}
		return sa.Compare(sb) > 0 // DESC
	})
	if filt.LatestPerKey {
		// Keep only the highest-semver row per (kind,key); input already sorted DESC.
		seen := map[string]bool{}
		var collapsed []*model.MarketplaceItem
		for _, it := range out {
			k := it.Kind + "\x00" + it.Key
			if seen[k] {
				continue
			}
			seen[k] = true
			collapsed = append(collapsed, it)
		}
		out = collapsed
	}
	return out, nil
}

func (f *fakeMarketplaceRepo) ListVersions(_ context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error) {
	var out []*model.MarketplaceItem
	for _, it := range f.items {
		if it.Kind == kind && it.Key == key && f.visible(tenantID, it) {
			out = append(out, it)
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		sa := model.Semver{Major: out[a].VersionMajor, Minor: out[a].VersionMinor, Patch: out[a].VersionPatch}
		sb := model.Semver{Major: out[b].VersionMajor, Minor: out[b].VersionMinor, Patch: out[b].VersionPatch}
		return sa.Compare(sb) > 0
	})
	return out, nil
}

func (f *fakeMarketplaceRepo) GetItem(_ context.Context, tenantID, id string) (*model.MarketplaceItem, error) {
	for _, it := range f.items {
		if it.ID == id && f.visible(tenantID, it) {
			return it, nil
		}
	}
	return nil, model.ErrNotFound
}

func (f *fakeMarketplaceRepo) GetVersion(_ context.Context, tenantID, kind, key, version string) (*model.MarketplaceItem, error) {
	for _, it := range f.items {
		if it.Kind == kind && it.Key == key && it.Version == version && it.TenantScope == tenantID {
			return it, nil
		}
	}
	return nil, model.ErrNotFound
}

func (f *fakeMarketplaceRepo) UpsertItem(_ context.Context, item *model.MarketplaceItem) (*model.MarketplaceItem, error) {
	for i, it := range f.items {
		if it.TenantScope == item.TenantScope && it.Kind == item.Kind && it.Key == item.Key && it.Version == item.Version {
			// Update in place, preserving the id.
			item.ID = it.ID
			cp := *item
			f.items[i] = &cp
			return f.items[i], nil
		}
	}
	f.nextID++
	cp := *item
	cp.ID = itemID(f.nextID)
	f.items = append(f.items, &cp)
	return &cp, nil
}

func (f *fakeMarketplaceRepo) MarkReviewed(_ context.Context, tenantID, id, reviewedBy, reason string, _ interface{}) (*model.MarketplaceItem, error) {
	for _, it := range f.items {
		if it.ID == id && f.visible(tenantID, it) {
			it.Status = model.MarketplaceStatusPublished
			rb := reviewedBy
			it.ReviewedBy = &rb
			if reason != "" {
				rr := reason
				it.ReviewReason = &rr
			}
			return it, nil
		}
	}
	return nil, model.ErrNotFound
}

func (f *fakeMarketplaceRepo) GetInstall(_ context.Context, tenantID, marketplaceItemID string) (*model.MarketplaceInstall, error) {
	for _, in := range f.installs {
		if in.TenantID == tenantID && in.MarketplaceItemID == marketplaceItemID {
			return in, nil
		}
	}
	return nil, model.ErrNotFound
}

func (f *fakeMarketplaceRepo) CreateInstall(_ context.Context, inst *model.MarketplaceInstall) (*model.MarketplaceInstall, error) {
	for _, in := range f.installs {
		if in.TenantID == inst.TenantID && in.MarketplaceItemID == inst.MarketplaceItemID {
			return in, nil // idempotent
		}
	}
	f.nextID++
	cp := *inst
	cp.ID = installID(f.nextID)
	f.installs = append(f.installs, &cp)
	return &cp, nil
}

func itemID(n int) string    { return "item-" + strconv.Itoa(n) }
func installID(n int) string { return "inst-" + strconv.Itoa(n) }

// fakeInstantiator records InstantiateFromPayload calls and returns a definition
// stamped with the provenance it was handed.
type fakeInstantiator struct {
	calls []fakeInstantiateCall
	err   error
}

type fakeInstantiateCall struct {
	tenantID string
	userID   string
	payload  []byte
	category string
	itemID   string
	itemVer  string
}

func (f *fakeInstantiator) InstantiateFromPayload(_ context.Context, tenantID, userID string, payload []byte, category, nameOverride, descOverride, marketplaceItemID, marketplaceItemVersion string) (*model.WorkflowDefinition, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.calls = append(f.calls, fakeInstantiateCall{
		tenantID: tenantID, userID: userID, payload: payload, category: category,
		itemID: marketplaceItemID, itemVer: marketplaceItemVersion,
	})
	name := "Installed Definition"
	if nameOverride != "" {
		name = nameOverride
	}
	return &model.WorkflowDefinition{
		ID:                     "def-" + marketplaceItemID,
		TenantID:               tenantID,
		Name:                   name,
		Category:               category,
		MarketplaceItemID:      marketplaceItemID,
		MarketplaceItemVersion: marketplaceItemVersion,
	}, nil
}

// fakeStamper records provenance stamps.
type fakeStamper struct {
	stamps []string // "defID|itemID|version"
}

func (f *fakeStamper) StampMarketplaceProvenance(_ context.Context, tenantID, defID, itemID, version string) error {
	f.stamps = append(f.stamps, defID+"|"+itemID+"|"+version)
	return nil
}

// fakeConnectorRegistrar records connector manifest registrations.
type fakeConnectorRegistrar struct {
	manifests [][]byte
	key       string
}

func (f *fakeConnectorRegistrar) RegisterConnectorManifest(_ context.Context, tenantID, userID string, manifest []byte) (string, error) {
	f.manifests = append(f.manifests, manifest)
	return f.key, nil
}

// recordingPublisher captures emitted audit events by type.
type recordingPublisher struct {
	types []string
}

func (p *recordingPublisher) Publish(_ context.Context, _ string, evt *events.Event) error {
	p.types = append(p.types, evt.Type)
	return nil
}

func (p *recordingPublisher) has(suffix string) bool {
	for _, t := range p.types {
		if strings.HasSuffix(t, suffix) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	tenantB = "bbbbbbbb-0000-0000-0000-000000000002"
	pubUser = "user-publisher"
	appUser = "user-approver"
)

func templatePayload(name string) json.RawMessage {
	def := map[string]interface{}{
		"name":           name,
		"description":    "seed",
		"trigger_config": map[string]interface{}{"type": "manual"},
		"variables":      map[string]interface{}{},
		"steps": []map[string]interface{}{
			{"id": "end", "type": "end", "name": "End"},
		},
	}
	b, _ := json.Marshal(def)
	return b
}

func newTestMarketplaceService(repo *fakeMarketplaceRepo) (*MarketplaceService, *fakeInstantiator, *recordingPublisher) {
	inst := &fakeInstantiator{}
	pub := &recordingPublisher{}
	svc := NewMarketplaceService(repo, zerolog.Nop()).
		WithTemplateInstantiator(inst).
		WithAuditPublisher(pub)
	return svc, inst, pub
}

func publishTemplate(t *testing.T, svc *MarketplaceService, scope, key, version, publishedBy string) *model.MarketplaceItem {
	t.Helper()
	it, err := svc.Publish(context.Background(), PublishItemRequest{
		TenantScope: scope,
		Kind:        model.MarketplaceKindTemplate,
		Key:         key,
		TitleI18n:   map[string]string{"en": key},
		Category:    "legal",
		Version:     version,
		Payload:     templatePayload(key),
		PublishedBy: publishedBy,
	})
	if err != nil {
		t.Fatalf("Publish(%s@%s) error = %v", key, version, err)
	}
	return it
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Publish creates a versioned item, born unreviewed (draft, not installable),
// with a payload checksum stamped.
func TestMarketplace_PublishCreatesVersionedDraft(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, pub := newTestMarketplaceService(repo)

	it := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)

	if it.Status != model.MarketplaceStatusDraft {
		t.Fatalf("published item status = %q, want draft (unreviewed)", it.Status)
	}
	if it.Version != "1.0.0" || it.VersionMajor != 1 {
		t.Fatalf("version decomposition wrong: %q maj=%d", it.Version, it.VersionMajor)
	}
	if !strings.HasPrefix(it.Checksum, "sha256:") {
		t.Fatalf("expected sha256 checksum, got %q", it.Checksum)
	}
	if it.PublishedBy != pubUser {
		t.Fatalf("published_by = %q, want %q", it.PublishedBy, pubUser)
	}
	if !pub.has("marketplace.item.published") {
		t.Fatalf("expected marketplace.item.published audit event, got %v", pub.types)
	}
}

// Review is the four-eyes gate: the publisher CANNOT self-approve (fail-closed),
// but a distinct approver can, moving the item to published/installable.
func TestMarketplace_ReviewFourEyesFailClosed(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, pub := newTestMarketplaceService(repo)

	it := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)

	// Self-review is rejected fail-closed.
	if _, err := svc.Review(context.Background(), "", it.ID, pubUser, "self"); !errors.Is(err, ErrMarketplaceSelfReview) {
		t.Fatalf("self-review error = %v, want ErrMarketplaceSelfReview", err)
	}
	// It must NOT have been marked published.
	if got, _ := repo.GetItem(context.Background(), "", it.ID); got.Status != model.MarketplaceStatusDraft {
		t.Fatalf("after rejected self-review status = %q, want still draft", got.Status)
	}

	// A distinct approver clears it.
	reviewed, err := svc.Review(context.Background(), "", it.ID, appUser, "ok")
	if err != nil {
		t.Fatalf("distinct-approver review error = %v", err)
	}
	if reviewed.Status != model.MarketplaceStatusPublished {
		t.Fatalf("reviewed status = %q, want published", reviewed.Status)
	}
	if !pub.has("marketplace.item.reviewed") {
		t.Fatalf("expected marketplace.item.reviewed audit event, got %v", pub.types)
	}
}

// Install of a reviewed template instantiates a definition stamped with the
// marketplace provenance, records an install ledger row, and emits the event.
func TestMarketplace_InstallInstantiatesWithProvenance(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, inst, pub := newTestMarketplaceService(repo)
	stamper := &fakeStamper{}
	svc.WithProvenanceStamper(stamper)

	it := publishTemplate(t, svc, "", "tmpl-x", "2.1.0", pubUser)
	if _, err := svc.Review(context.Background(), "", it.ID, appUser, "ok"); err != nil {
		t.Fatalf("review error = %v", err)
	}

	res, err := svc.Install(context.Background(), tenantA, "user-1", it.ID, "", "")
	if err != nil {
		t.Fatalf("Install error = %v", err)
	}
	if res.AlreadyDone {
		t.Fatalf("first install marked AlreadyDone")
	}
	if res.Definition == nil {
		t.Fatalf("install did not produce a definition")
	}
	if res.Definition.MarketplaceItemID != it.ID || res.Definition.MarketplaceItemVersion != "2.1.0" {
		t.Fatalf("definition provenance wrong: id=%q ver=%q", res.Definition.MarketplaceItemID, res.Definition.MarketplaceItemVersion)
	}
	if len(inst.calls) != 1 || inst.calls[0].itemID != it.ID || inst.calls[0].itemVer != "2.1.0" {
		t.Fatalf("instantiator not called with provenance: %+v", inst.calls)
	}
	if res.Install == nil || res.Install.DefinitionID == nil || *res.Install.DefinitionID != res.Definition.ID {
		t.Fatalf("install ledger row missing definition link: %+v", res.Install)
	}
	if len(stamper.stamps) != 1 {
		t.Fatalf("expected one provenance stamp, got %v", stamper.stamps)
	}
	if !pub.has("marketplace.item.installed") {
		t.Fatalf("expected marketplace.item.installed audit event, got %v", pub.types)
	}
}

// Installing an unreviewed item is rejected fail-closed.
func TestMarketplace_InstallRejectsUnreviewed(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, _ := newTestMarketplaceService(repo)

	it := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)
	_, err := svc.Install(context.Background(), tenantA, "user-1", it.ID, "", "")
	if !errors.Is(err, ErrMarketplaceNotReviewed) {
		t.Fatalf("install of unreviewed item error = %v, want ErrMarketplaceNotReviewed", err)
	}
}

// Re-install of the same item+version is an idempotent no-op returning the
// existing record without instantiating a second definition.
func TestMarketplace_InstallIdempotent(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, inst, _ := newTestMarketplaceService(repo)

	it := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)
	if _, err := svc.Review(context.Background(), "", it.ID, appUser, "ok"); err != nil {
		t.Fatalf("review error = %v", err)
	}

	first, err := svc.Install(context.Background(), tenantA, "user-1", it.ID, "", "")
	if err != nil {
		t.Fatalf("first install error = %v", err)
	}
	second, err := svc.Install(context.Background(), tenantA, "user-1", it.ID, "", "")
	if err != nil {
		t.Fatalf("second install error = %v", err)
	}
	if !second.AlreadyDone {
		t.Fatalf("re-install not marked AlreadyDone")
	}
	if second.Install.ID != first.Install.ID {
		t.Fatalf("re-install created a new ledger row: %q vs %q", second.Install.ID, first.Install.ID)
	}
	if len(inst.calls) != 1 {
		t.Fatalf("re-install instantiated a second definition: %d calls", len(inst.calls))
	}
}

// A tenant sees global items + its own; another tenant's private items are
// isolated.
func TestMarketplace_GlobalVsTenantVisibility(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, _ := newTestMarketplaceService(repo)

	publishTemplate(t, svc, "", "tmpl-global", "1.0.0", pubUser) // global
	publishTemplate(t, svc, tenantA, "tmpl-a-private", "1.0.0", pubUser)
	publishTemplate(t, svc, tenantB, "tmpl-b-private", "1.0.0", pubUser)

	aItems, err := svc.Browse(context.Background(), tenantA, MarketplaceBrowseFilter{LatestPerKey: true})
	if err != nil {
		t.Fatalf("Browse(A) error = %v", err)
	}
	keys := map[string]bool{}
	for _, it := range aItems {
		keys[it.Key] = true
	}
	if !keys["tmpl-global"] || !keys["tmpl-a-private"] {
		t.Fatalf("tenant A should see global + own, got %v", keys)
	}
	if keys["tmpl-b-private"] {
		t.Fatalf("tenant A leaked tenant B's private item: %v", keys)
	}
}

// Versions of one logical item are returned newest semver first (no lexical
// "1.10.0" < "1.9.0" trap), and Browse's gallery view collapses to the latest.
func TestMarketplace_SemverVersionOrdering(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, _ := newTestMarketplaceService(repo)

	// Publish out of order incl. a two-digit minor to catch lexical sorting bugs.
	for _, v := range []string{"1.0.0", "1.9.0", "1.10.0", "2.0.0", "1.2.0"} {
		publishTemplate(t, svc, "", "tmpl-x", v, pubUser)
	}

	versions, err := svc.Versions(context.Background(), "", model.MarketplaceKindTemplate, "tmpl-x")
	if err != nil {
		t.Fatalf("Versions error = %v", err)
	}
	got := make([]string, len(versions))
	for i, it := range versions {
		got[i] = it.Version
	}
	want := []string{"2.0.0", "1.10.0", "1.9.0", "1.2.0", "1.0.0"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("semver ordering = %v, want %v", got, want)
	}

	// Gallery view: exactly one row (the highest version).
	gallery, err := svc.Browse(context.Background(), "", MarketplaceBrowseFilter{LatestPerKey: true})
	if err != nil {
		t.Fatalf("Browse error = %v", err)
	}
	if len(gallery) != 1 || gallery[0].Version != "2.0.0" {
		t.Fatalf("gallery latest-per-key = %+v, want single 2.0.0", gallery)
	}
}

// Publishing a NEW semver of an existing key creates a distinct version row
// (multiple versions per key), while re-publishing the SAME version updates in
// place (idempotent) and resets a reviewed item back to draft (fail-closed).
func TestMarketplace_VersioningAndRepublishResetsReview(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, _ := newTestMarketplaceService(repo)

	v1 := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)
	if _, err := svc.Review(context.Background(), "", v1.ID, appUser, "ok"); err != nil {
		t.Fatalf("review error = %v", err)
	}
	// A second semver → distinct row.
	publishTemplate(t, svc, "", "tmpl-x", "1.1.0", pubUser)
	versions, _ := svc.Versions(context.Background(), "", model.MarketplaceKindTemplate, "tmpl-x")
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions of tmpl-x, got %d", len(versions))
	}

	// Re-publish the SAME version (1.0.0) → in-place update, review RESET to draft.
	republished := publishTemplate(t, svc, "", "tmpl-x", "1.0.0", pubUser)
	if republished.ID != v1.ID {
		t.Fatalf("re-publish created a new row: %q vs %q", republished.ID, v1.ID)
	}
	if republished.Status != model.MarketplaceStatusDraft {
		t.Fatalf("re-published item status = %q, want draft (review reset)", republished.Status)
	}
}

// Installing a connector item registers the manifest and records provenance with
// the connector key (no definition).
func TestMarketplace_InstallConnector(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, pub := newTestMarketplaceService(repo)
	reg := &fakeConnectorRegistrar{key: "conn-registered-1"}
	svc.WithConnectorRegistrar(reg)

	it, err := svc.Publish(context.Background(), PublishItemRequest{
		TenantScope: "",
		Kind:        model.MarketplaceKindConnector,
		Key:         "conn-slack",
		TitleI18n:   map[string]string{"en": "Slack"},
		Version:     "1.0.0",
		Payload:     json.RawMessage(`{"type":"webhook","name":"slack"}`),
		PublishedBy: pubUser,
	})
	if err != nil {
		t.Fatalf("Publish connector error = %v", err)
	}
	if _, err := svc.Review(context.Background(), "", it.ID, appUser, "ok"); err != nil {
		t.Fatalf("review error = %v", err)
	}

	res, err := svc.Install(context.Background(), tenantA, "user-1", it.ID, "", "")
	if err != nil {
		t.Fatalf("install connector error = %v", err)
	}
	if res.Definition != nil {
		t.Fatalf("connector install should not create a definition")
	}
	if res.ConnectorKey != "conn-registered-1" {
		t.Fatalf("connector key = %q, want conn-registered-1", res.ConnectorKey)
	}
	if len(reg.manifests) != 1 {
		t.Fatalf("connector manifest not registered")
	}
	if res.Install.ConnectorKey == nil || *res.Install.ConnectorKey != "conn-registered-1" {
		t.Fatalf("install ledger missing connector key: %+v", res.Install)
	}
	if !pub.has("marketplace.item.installed") {
		t.Fatalf("expected installed audit event, got %v", pub.types)
	}
}

// The seeder registers the embedded legal/DR packs as GLOBAL, four-eyes-reviewed
// (installable) marketplace items — the gallery is populated on day one.
func TestMarketplace_SeedGlobalTemplatesPopulatesGallery(t *testing.T) {
	repo := newFakeMarketplaceRepo()
	svc, _, _ := newTestMarketplaceService(repo)

	n, err := svc.SeedGlobalTemplates(context.Background())
	if err != nil {
		t.Fatalf("SeedGlobalTemplates error = %v", err)
	}
	if n < 3 {
		t.Fatalf("expected the seeder to publish the golden packs, got %d", n)
	}

	// Every seeded item is a GLOBAL, reviewed/published (installable) template.
	items, err := svc.Browse(context.Background(), tenantA, MarketplaceBrowseFilter{
		Kind:         model.MarketplaceKindTemplate,
		LatestPerKey: true,
	})
	if err != nil {
		t.Fatalf("Browse error = %v", err)
	}
	if len(items) != n {
		t.Fatalf("gallery count = %d, want %d seeded", len(items), n)
	}
	for _, it := range items {
		if it.TenantScope != "" {
			t.Fatalf("seeded item %q is not global (tenant=%q)", it.Key, it.TenantScope)
		}
		if it.Status != model.MarketplaceStatusPublished {
			t.Fatalf("seeded item %q status = %q, want published (installable)", it.Key, it.Status)
		}
		if it.PublishedBy != MarketplacePlatformPublisher {
			t.Fatalf("seeded item %q published_by = %q", it.Key, it.PublishedBy)
		}
		if it.ReviewedBy == nil || *it.ReviewedBy != MarketplacePlatformReviewer {
			t.Fatalf("seeded item %q reviewed_by = %v (want distinct platform reviewer)", it.Key, it.ReviewedBy)
		}
	}
}
