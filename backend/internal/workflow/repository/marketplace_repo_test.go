package repository

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/workflow/model"
)

const (
	mktTenantID = "aaaaaaaa-0000-0000-0000-000000000001"
	mktItemID   = "cccccccc-0000-0000-0000-00000000000a"
)

// marketplaceItemRows builds a pgxmock rows set matching marketplaceItemColumns.
func marketplaceItemRows(id, tenantID, kind, key, version string, status string) *pgxmock.Rows {
	cols := []string{
		"id", "tenant_id", "kind", "key", "title_i18n", "description_i18n", "category", "tags",
		"version", "version_major", "version_minor", "version_patch", "maturity", "publisher",
		"payload", "source", "checksum", "published_by", "published_at", "status",
		"reviewed_by", "reviewed_at", "review_reason", "created_at", "updated_at",
	}
	now := time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC)
	var tid interface{}
	if tenantID != "" {
		tid = tenantID
	}
	return pgxmock.NewRows(cols).AddRow(
		id, tid, kind, key, []byte(`{"en":"X"}`), []byte(`{"en":"desc"}`), "legal", []byte(`["legal"]`),
		version, 1, 0, 0, "ga", "Clario360",
		[]byte(`{"name":"X"}`), "seed", "sha256:abc", "user-p", &now, status,
		nil, nil, nil, now, now,
	)
}

func TestMarketplaceRepo_ListItemsUnionsGlobalsAndOwnWithFilters(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := newMarketplaceRepositoryWithDB(mock)

	// The union predicate + kind + status filters must appear in the SQL, and the
	// ORDER BY must rank by decomposed semver DESC (not lexical version).
	mock.ExpectQuery(`(?s)FROM workflow_marketplace_items.*tenant_id IS NULL OR tenant_id = NULLIF\(\$1, ''\)::uuid.*kind = \$2.*status = \$3.*ORDER BY kind, key, version_major DESC`).
		WithArgs(mktTenantID, model.MarketplaceKindTemplate, model.MarketplaceStatusPublished).
		WillReturnRows(marketplaceItemRows(mktItemID, "", model.MarketplaceKindTemplate, "tmpl-x", "1.0.0", model.MarketplaceStatusPublished))

	items, err := repo.ListItems(context.Background(), mktTenantID, MarketplaceListFilter{
		Kind:   model.MarketplaceKindTemplate,
		Status: model.MarketplaceStatusPublished,
	})
	if err != nil {
		t.Fatalf("ListItems error = %v", err)
	}
	if len(items) != 1 || items[0].Key != "tmpl-x" {
		t.Fatalf("ListItems returned %+v", items)
	}
	if items[0].TenantScope != "" {
		t.Fatalf("global row should scan empty TenantScope, got %q", items[0].TenantScope)
	}
	if items[0].Title != "X" { // localized from title_i18n
		t.Fatalf("Title not localized: %q", items[0].Title)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMarketplaceRepo_UpsertItemIsVersionKeyedIdempotent(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := newMarketplaceRepositoryWithDB(mock)

	now := time.Now().UTC()
	item := &model.MarketplaceItem{
		TenantScope:  "", // global
		Kind:         model.MarketplaceKindTemplate,
		Key:          "tmpl-x",
		TitleI18n:    map[string]string{"en": "X"},
		Category:     "legal",
		Version:      "1.2.0",
		VersionMajor: 1, VersionMinor: 2, VersionPatch: 0,
		Maturity:    model.MarketplaceMaturityGA,
		Payload:     []byte(`{"name":"X"}`),
		PublishedBy: "user-p",
		PublishedAt: &now,
		Status:      model.MarketplaceStatusDraft,
	}

	// ON CONFLICT on the COALESCE(tenant,zero-uuid),kind,key,version key makes the
	// upsert idempotent per version.
	mock.ExpectQuery(`(?s)INSERT INTO workflow_marketplace_items.*ON CONFLICT \(COALESCE\(tenant_id.*kind, key, version\).*DO UPDATE SET.*RETURNING`).
		WithArgs(
			"", model.MarketplaceKindTemplate, "tmpl-x", pgxmock.AnyArg(), pgxmock.AnyArg(), "legal", pgxmock.AnyArg(),
			"1.2.0", 1, 2, 0, model.MarketplaceMaturityGA,
			"", pgxmock.AnyArg(), "", "", "user-p", item.PublishedAt,
			model.MarketplaceStatusDraft, (*string)(nil), (*time.Time)(nil), (*string)(nil),
		).
		WillReturnRows(marketplaceItemRows(mktItemID, "", model.MarketplaceKindTemplate, "tmpl-x", "1.2.0", model.MarketplaceStatusDraft))

	saved, err := repo.UpsertItem(context.Background(), item)
	if err != nil {
		t.Fatalf("UpsertItem error = %v", err)
	}
	if saved.ID != mktItemID {
		t.Fatalf("UpsertItem returned id %q", saved.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMarketplaceRepo_MarkReviewedSetsPublished(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := newMarketplaceRepositoryWithDB(mock)

	now := time.Now().UTC()
	mock.ExpectQuery(`(?s)UPDATE workflow_marketplace_items.*SET status = \$4, reviewed_by = \$5.*RETURNING`).
		WithArgs(mktTenantID, mktItemID, model.MarketplaceStatusPublished, "user-approver", now, "ok").
		WillReturnRows(marketplaceItemRows(mktItemID, "", model.MarketplaceKindTemplate, "tmpl-x", "1.0.0", model.MarketplaceStatusPublished))

	reviewed, err := repo.MarkReviewed(context.Background(), mktTenantID, mktItemID, "user-approver", "ok", now)
	if err != nil {
		t.Fatalf("MarkReviewed error = %v", err)
	}
	if reviewed.Status != model.MarketplaceStatusPublished {
		t.Fatalf("MarkReviewed status = %q", reviewed.Status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMarketplaceRepo_CreateInstallIsIdempotentOnConflict(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := newMarketplaceRepositoryWithDB(mock)

	now := time.Now().UTC()
	defID := "dddddddd-0000-0000-0000-00000000000d"
	installCols := []string{
		"id", "tenant_id", "marketplace_item_id", "kind", "item_key", "item_version",
		"definition_id", "connector_key", "installed_by", "installed_at", "updated_at",
	}

	mock.ExpectQuery(`(?s)INSERT INTO workflow_marketplace_installs.*ON CONFLICT \(tenant_id, marketplace_item_id\) DO UPDATE SET.*RETURNING`).
		WithArgs(mktTenantID, mktItemID, model.MarketplaceKindTemplate, "tmpl-x", "1.0.0", defID, "", "user-1").
		WillReturnRows(pgxmock.NewRows(installCols).AddRow(
			"inst-1", mktTenantID, mktItemID, model.MarketplaceKindTemplate, "tmpl-x", "1.0.0",
			&defID, nil, "user-1", now, now,
		))

	inst := &model.MarketplaceInstall{
		TenantID:          mktTenantID,
		MarketplaceItemID: mktItemID,
		Kind:              model.MarketplaceKindTemplate,
		ItemKey:           "tmpl-x",
		ItemVersion:       "1.0.0",
		DefinitionID:      &defID,
		InstalledBy:       "user-1",
	}
	saved, err := repo.CreateInstall(context.Background(), inst)
	if err != nil {
		t.Fatalf("CreateInstall error = %v", err)
	}
	if saved.DefinitionID == nil || *saved.DefinitionID != defID {
		t.Fatalf("CreateInstall definition link wrong: %+v", saved)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
