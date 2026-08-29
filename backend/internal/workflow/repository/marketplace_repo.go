package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// MarketplaceRepository handles persistence for the governed marketplace catalog
// (workflow_marketplace_items) and the install provenance ledger
// (workflow_marketplace_installs).
//
// Like the workflow_templates catalog (000005), a row with tenant_id IS NULL is
// a GLOBAL, platform-published item visible to every tenant, and a browse must
// read BOTH the globals and the caller's own rows in one query. A single
// FORCE-RLS USING(tenant = current_setting) policy cannot express "globals ∪
// own", so — matching the template convention — these tables are NOT RLS-forced
// and the repository filters by tenant_id in SQL over the BARE pool.
type MarketplaceRepository struct {
	db marketplaceDBTX
}

// marketplaceDBTX is the minimal DB surface the repository needs. *pgxpool.Pool
// and the pgxmock pool both satisfy it, so the repository can be exercised
// against a mock in unit tests and the real pool in production.
type marketplaceDBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// NewMarketplaceRepository creates a MarketplaceRepository backed by the pool.
func NewMarketplaceRepository(pool *pgxpool.Pool) *MarketplaceRepository {
	return &MarketplaceRepository{db: pool}
}

// newMarketplaceRepositoryWithDB is the test seam: inject a pgxmock DBTX.
func newMarketplaceRepositoryWithDB(db marketplaceDBTX) *MarketplaceRepository {
	return &MarketplaceRepository{db: db}
}

const marketplaceItemColumns = `
	id, tenant_id, kind, key, title_i18n, description_i18n, category, tags,
	version, version_major, version_minor, version_patch, maturity, publisher,
	payload, source, checksum, published_by, published_at, status,
	reviewed_by, reviewed_at, review_reason, created_at, updated_at`

// MarketplaceListFilter narrows a browse. Empty fields are ignored. A browse
// always unions the tenant's own rows with the globals (tenant_id IS NULL).
type MarketplaceListFilter struct {
	Kind     string
	Category string
	Maturity string
	// Status, when set, restricts to items in that publish/review status (e.g.
	// only "published" installable items). Empty returns all statuses.
	Status string
	// LatestPerKey collapses the result to the highest semver version of each
	// (kind,key) — the gallery view. When false every version is returned.
	LatestPerKey bool
}

// ListItems returns the marketplace items visible to tenantID (its own rows plus
// all globals) matching the filter, ordered by kind, key, then descending
// semver. An empty tenantID returns the globals only.
func (r *MarketplaceRepository) ListItems(ctx context.Context, tenantID string, f MarketplaceListFilter) ([]*model.MarketplaceItem, error) {
	var conds []string
	args := []any{tenantID}
	conds = append(conds, "(tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)")

	add := func(col, val string) {
		if val == "" {
			return
		}
		args = append(args, val)
		conds = append(conds, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	add("kind", f.Kind)
	add("category", f.Category)
	add("maturity", f.Maturity)
	add("status", f.Status)

	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_marketplace_items
		WHERE %s
		ORDER BY kind, key, version_major DESC, version_minor DESC, version_patch DESC`,
		marketplaceItemColumns, strings.Join(conds, " AND "))

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listing marketplace items: %w", err)
	}
	defer rows.Close()

	items, err := scanMarketplaceItems(rows)
	if err != nil {
		return nil, err
	}
	if f.LatestPerKey {
		items = collapseLatestPerKey(items)
	}
	return items, nil
}

// collapseLatestPerKey keeps only the first (highest-semver, since the query
// orders DESC) row per (kind,key). The input MUST already be sorted by
// kind,key,semver DESC — ListItems guarantees this.
func collapseLatestPerKey(in []*model.MarketplaceItem) []*model.MarketplaceItem {
	seen := make(map[string]bool, len(in))
	out := make([]*model.MarketplaceItem, 0, len(in))
	for _, it := range in {
		k := it.Kind + "\x00" + it.Key
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, it)
	}
	return out
}

// ListVersions returns every version of one logical item (kind,key) visible to
// the tenant, newest semver first. Powers GET /marketplace/{key}.
func (r *MarketplaceRepository) ListVersions(ctx context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_marketplace_items
		WHERE kind = $2 AND key = $3
		  AND (tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)
		ORDER BY version_major DESC, version_minor DESC, version_patch DESC`,
		marketplaceItemColumns)

	rows, err := r.db.Query(ctx, query, tenantID, kind, key)
	if err != nil {
		return nil, fmt.Errorf("listing marketplace item versions: %w", err)
	}
	defer rows.Close()
	return scanMarketplaceItems(rows)
}

// GetItem loads one item version by id, scoped so the tenant can only load a
// global row or its own row. Returns model.ErrNotFound when absent/not visible.
func (r *MarketplaceRepository) GetItem(ctx context.Context, tenantID, id string) (*model.MarketplaceItem, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_marketplace_items
		WHERE id = $2
		  AND (tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)
		LIMIT 1`, marketplaceItemColumns)

	return scanMarketplaceItem(r.db.QueryRow(ctx, query, tenantID, id))
}

// GetVersion loads the specific (tenant/global, kind, key, version) row. Used to
// enforce idempotent publish (a re-publish of the same version updates in place).
// tenantID "" selects the global row.
func (r *MarketplaceRepository) GetVersion(ctx context.Context, tenantID, kind, key, version string) (*model.MarketplaceItem, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_marketplace_items
		WHERE kind = $2 AND key = $3 AND version = $4
		  AND tenant_id IS NOT DISTINCT FROM NULLIF($1, '')::uuid
		LIMIT 1`, marketplaceItemColumns)

	return scanMarketplaceItem(r.db.QueryRow(ctx, query, tenantID, kind, key, version))
}

// UpsertItem inserts or (on the unique version key) updates a marketplace item
// version. It is the publish/seed primitive: idempotent by
// (tenant, kind, key, version). tenantID "" stores a GLOBAL item. The decomposed
// semver columns are derived from item.Version by the service before calling.
func (r *MarketplaceRepository) UpsertItem(ctx context.Context, item *model.MarketplaceItem) (*model.MarketplaceItem, error) {
	titleJSON, err := json.Marshal(orEmptyMap(item.TitleI18n))
	if err != nil {
		return nil, fmt.Errorf("marshaling title_i18n: %w", err)
	}
	descJSON, err := json.Marshal(orEmptyMap(item.DescriptionI18n))
	if err != nil {
		return nil, fmt.Errorf("marshaling description_i18n: %w", err)
	}
	tags := item.Tags
	if tags == nil {
		tags = []string{}
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return nil, fmt.Errorf("marshaling tags: %w", err)
	}
	payload := []byte(item.Payload)
	if len(payload) == 0 {
		payload = []byte("{}")
	}

	// ON CONFLICT targets the same expression as the unique index
	// uq_workflow_marketplace_items_version.
	query := fmt.Sprintf(`
		INSERT INTO workflow_marketplace_items (
			tenant_id, kind, key, title_i18n, description_i18n, category, tags,
			version, version_major, version_minor, version_patch, maturity,
			publisher, payload, source, checksum, published_by, published_at,
			status, reviewed_by, reviewed_at, review_reason
		) VALUES (
			NULLIF($1, '')::uuid, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12,
			$13, $14, $15, $16, $17, $18,
			$19, $20, $21, $22
		)
		ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, key, version)
		DO UPDATE SET
			title_i18n       = EXCLUDED.title_i18n,
			description_i18n = EXCLUDED.description_i18n,
			category         = EXCLUDED.category,
			tags             = EXCLUDED.tags,
			version_major    = EXCLUDED.version_major,
			version_minor    = EXCLUDED.version_minor,
			version_patch    = EXCLUDED.version_patch,
			maturity         = EXCLUDED.maturity,
			publisher        = EXCLUDED.publisher,
			payload          = EXCLUDED.payload,
			source           = EXCLUDED.source,
			checksum         = EXCLUDED.checksum,
			published_by     = EXCLUDED.published_by,
			published_at     = EXCLUDED.published_at,
			status           = EXCLUDED.status,
			reviewed_by      = EXCLUDED.reviewed_by,
			reviewed_at      = EXCLUDED.reviewed_at,
			review_reason    = EXCLUDED.review_reason,
			updated_at       = now()
		RETURNING %s`, marketplaceItemColumns)

	return scanMarketplaceItem(r.db.QueryRow(ctx, query,
		item.TenantScope, item.Kind, item.Key, titleJSON, descJSON, item.Category, tagsJSON,
		item.Version, item.VersionMajor, item.VersionMinor, item.VersionPatch, item.Maturity,
		item.Publisher, payload, item.Source, item.Checksum, item.PublishedBy, item.PublishedAt,
		item.Status, item.ReviewedBy, item.ReviewedAt, item.ReviewReason,
	))
}

// MarkReviewed records the four-eyes review clearance on a version: sets status
// to published and stamps the distinct reviewer + timestamp + reason. Scoped so
// a tenant can only review its own row or a global row. Returns the refreshed row.
func (r *MarketplaceRepository) MarkReviewed(ctx context.Context, tenantID, id, reviewedBy, reason string, reviewedAt interface{}) (*model.MarketplaceItem, error) {
	query := fmt.Sprintf(`
		UPDATE workflow_marketplace_items
		SET status = $4, reviewed_by = $5, reviewed_at = $6, review_reason = NULLIF($7, ''), updated_at = now()
		WHERE id = $2
		  AND (tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)
		RETURNING %s`, marketplaceItemColumns)

	return scanMarketplaceItem(r.db.QueryRow(ctx, query,
		tenantID, id, model.MarketplaceStatusPublished, reviewedBy, reviewedAt, reason,
	))
}

// GetInstall loads the install ledger row for (tenant, marketplace item id).
// Returns model.ErrNotFound when the tenant has not installed that version.
func (r *MarketplaceRepository) GetInstall(ctx context.Context, tenantID, marketplaceItemID string) (*model.MarketplaceInstall, error) {
	query := `
		SELECT id, tenant_id, marketplace_item_id, kind, item_key, item_version,
		       definition_id, connector_key, installed_by, installed_at, updated_at
		FROM workflow_marketplace_installs
		WHERE tenant_id = $1 AND marketplace_item_id = $2
		LIMIT 1`
	return scanMarketplaceInstall(r.db.QueryRow(ctx, query, tenantID, marketplaceItemID))
}

// CreateInstall records an install provenance row (idempotent on
// (tenant, marketplace_item_id) — a re-install returns the existing row via the
// DO UPDATE that refreshes updated_at). Returns the persisted row.
func (r *MarketplaceRepository) CreateInstall(ctx context.Context, inst *model.MarketplaceInstall) (*model.MarketplaceInstall, error) {
	query := `
		INSERT INTO workflow_marketplace_installs (
			tenant_id, marketplace_item_id, kind, item_key, item_version,
			definition_id, connector_key, installed_by
		) VALUES ($1, $2, $3, $4, $5, NULLIF($6,'')::uuid, NULLIF($7,''), $8)
		ON CONFLICT (tenant_id, marketplace_item_id) DO UPDATE SET
			updated_at = now()
		RETURNING id, tenant_id, marketplace_item_id, kind, item_key, item_version,
		          definition_id, connector_key, installed_by, installed_at, updated_at`

	defID := ""
	if inst.DefinitionID != nil {
		defID = *inst.DefinitionID
	}
	connKey := ""
	if inst.ConnectorKey != nil {
		connKey = *inst.ConnectorKey
	}
	return scanMarketplaceInstall(r.db.QueryRow(ctx, query,
		inst.TenantID, inst.MarketplaceItemID, inst.Kind, inst.ItemKey, inst.ItemVersion,
		defID, connKey, inst.InstalledBy,
	))
}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

func scanMarketplaceItem(row pgx.Row) (*model.MarketplaceItem, error) {
	item, err := scanMarketplaceItemRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("marketplace item: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning marketplace item: %w", err)
	}
	return item, nil
}

func scanMarketplaceItems(rows pgx.Rows) ([]*model.MarketplaceItem, error) {
	var out []*model.MarketplaceItem
	for rows.Next() {
		item, err := scanMarketplaceItemRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning marketplace item row: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating marketplace item rows: %w", err)
	}
	return out, nil
}

func scanMarketplaceItemRow(s rowScanner) (*model.MarketplaceItem, error) {
	var (
		item      model.MarketplaceItem
		tenantID  *string
		titleJSON []byte
		descJSON  []byte
		tagsJSON  []byte
		payload   []byte
	)
	if err := s.Scan(
		&item.ID,
		&tenantID,
		&item.Kind,
		&item.Key,
		&titleJSON,
		&descJSON,
		&item.Category,
		&tagsJSON,
		&item.Version,
		&item.VersionMajor,
		&item.VersionMinor,
		&item.VersionPatch,
		&item.Maturity,
		&item.Publisher,
		&payload,
		&item.Source,
		&item.Checksum,
		&item.PublishedBy,
		&item.PublishedAt,
		&item.Status,
		&item.ReviewedBy,
		&item.ReviewedAt,
		&item.ReviewReason,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if tenantID != nil {
		item.TenantScope = *tenantID
	}
	if err := json.Unmarshal(titleJSON, &item.TitleI18n); err != nil {
		return nil, fmt.Errorf("unmarshaling title_i18n: %w", err)
	}
	if err := json.Unmarshal(descJSON, &item.DescriptionI18n); err != nil {
		return nil, fmt.Errorf("unmarshaling description_i18n: %w", err)
	}
	if len(tagsJSON) > 0 {
		if err := json.Unmarshal(tagsJSON, &item.Tags); err != nil {
			return nil, fmt.Errorf("unmarshaling tags: %w", err)
		}
	}
	item.Payload = payload
	item.Title = localize(item.TitleI18n)
	item.Description = localize(item.DescriptionI18n)
	return &item, nil
}

func scanMarketplaceInstall(row pgx.Row) (*model.MarketplaceInstall, error) {
	var (
		inst  model.MarketplaceInstall
		defID *string
		conn  *string
	)
	if err := row.Scan(
		&inst.ID,
		&inst.TenantID,
		&inst.MarketplaceItemID,
		&inst.Kind,
		&inst.ItemKey,
		&inst.ItemVersion,
		&defID,
		&conn,
		&inst.InstalledBy,
		&inst.InstalledAt,
		&inst.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("marketplace install: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning marketplace install: %w", err)
	}
	inst.DefinitionID = defID
	inst.ConnectorKey = conn
	return &inst, nil
}
