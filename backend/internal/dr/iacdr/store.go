package iacdr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store and service speak
// the same execution-context type: a *pgxpool.Pool for a single read, or the
// caller's open transaction so a snapshot ingest commits atomically with its
// outbox event. This package adds its OWN read/write methods for its two owned
// tables via raw queries rather than editing the shared repository.
type DBTX = repository.DBTX

// Store persists IaC snapshots (dr_iac_snapshot) and their resources
// (dr_iac_resource). It holds no state; the caller chooses the DBTX so a request
// runs under a tenant transaction (RLS backstop).
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// NextVersion returns the version to assign to a new snapshot of an estate:
// max(version)+1 for the (tenant, name), or 1 when none exist. It runs inside the
// ingest transaction so concurrent ingests of the same estate are serialised by
// the snapshot row lock the subsequent insert takes (and the UNIQUE constraint is
// the final backstop).
func (s *Store) NextVersion(ctx context.Context, db DBTX, tenantID, name string) (int, error) {
	var maxVersion *int
	err := db.QueryRow(ctx,
		`SELECT max(version) FROM dr_iac_snapshot WHERE tenant_id = $1 AND name = $2`,
		tenantID, name,
	).Scan(&maxVersion)
	if err != nil {
		return 0, fmt.Errorf("iacdr: reading max version for %q: %w", name, err)
	}
	if maxVersion == nil {
		return 1, nil
	}
	return *maxVersion + 1, nil
}

// InsertSnapshot inserts a snapshot header row and returns the stored row with
// its generated id/created_at. The caller must have set Version, ContentHash and
// ResourceCount.
func (s *Store) InsertSnapshot(ctx context.Context, db DBTX, snap *Snapshot) (*Snapshot, error) {
	metaJSON, err := json.Marshal(snap.Metadata)
	if err != nil {
		return nil, fmt.Errorf("iacdr: marshaling snapshot metadata: %w", err)
	}
	if len(metaJSON) == 0 {
		metaJSON = []byte("{}")
	}
	var stored Snapshot
	var groupID *string
	err = db.QueryRow(ctx, `
		INSERT INTO dr_iac_snapshot
		    (tenant_id, group_id, name, source_kind, version, content_hash, resource_count, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, tenant_id, group_id, name, source_kind, version, content_hash, resource_count, created_at`,
		snap.TenantID, snap.GroupID, snap.Name, snap.SourceKind, snap.Version,
		snap.ContentHash, snap.ResourceCount, metaJSON,
	).Scan(&stored.ID, &stored.TenantID, &groupID, &stored.Name, &stored.SourceKind,
		&stored.Version, &stored.ContentHash, &stored.ResourceCount, &stored.CreatedAt)
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, fmt.Errorf("iacdr: group %v absent: %w", snap.GroupID, ErrInvalidRequest)
		}
		return nil, fmt.Errorf("iacdr: inserting snapshot %q: %w", snap.Name, err)
	}
	stored.GroupID = groupID
	stored.Metadata = snap.Metadata
	return &stored, nil
}

// InsertResources bulk-inserts a snapshot's resources in the caller's
// transaction.
func (s *Store) InsertResources(ctx context.Context, db DBTX, tenantID, snapshotID string, resources []Resource) error {
	for i := range resources {
		r := &resources[i]
		attrsJSON, err := json.Marshal(r.Attributes)
		if err != nil {
			return fmt.Errorf("iacdr: marshaling attributes of %s: %w", r.Address, err)
		}
		if len(attrsJSON) == 0 {
			attrsJSON = []byte("{}")
		}
		deps := r.DependsOn
		if deps == nil {
			deps = []string{}
		}
		depsJSON, err := json.Marshal(deps)
		if err != nil {
			return fmt.Errorf("iacdr: marshaling depends_on of %s: %w", r.Address, err)
		}
		if _, err := db.Exec(ctx, `
			INSERT INTO dr_iac_resource
			    (tenant_id, snapshot_id, provider, type, name, address, attributes, depends_on, resource_hash)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			tenantID, snapshotID, r.Provider, r.Type, r.Name, r.Address, attrsJSON, depsJSON, r.Hash,
		); err != nil {
			return fmt.Errorf("iacdr: inserting resource %s: %w", r.Address, err)
		}
	}
	return nil
}

// GetSnapshot loads a snapshot header (RLS-scoped) or ErrSnapshotNotFound.
func (s *Store) GetSnapshot(ctx context.Context, db DBTX, snapshotID string) (*Snapshot, error) {
	var snap Snapshot
	var groupID *string
	var metaJSON []byte
	err := db.QueryRow(ctx, `
		SELECT id, tenant_id, group_id, name, source_kind, version, content_hash, resource_count, metadata, created_at
		  FROM dr_iac_snapshot WHERE id = $1`, snapshotID,
	).Scan(&snap.ID, &snap.TenantID, &groupID, &snap.Name, &snap.SourceKind,
		&snap.Version, &snap.ContentHash, &snap.ResourceCount, &metaJSON, &snap.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("snapshot %s: %w", snapshotID, ErrSnapshotNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("iacdr: reading snapshot %s: %w", snapshotID, err)
	}
	snap.GroupID = groupID
	if len(metaJSON) > 0 {
		if err := json.Unmarshal(metaJSON, &snap.Metadata); err != nil {
			return nil, fmt.Errorf("iacdr: unmarshaling snapshot metadata: %w", err)
		}
	}
	return &snap, nil
}

// ListSnapshots returns the tenant's snapshot headers, newest first.
func (s *Store) ListSnapshots(ctx context.Context, db DBTX, tenantID string) ([]Snapshot, error) {
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, name, source_kind, version, content_hash, resource_count, metadata, created_at
		  FROM dr_iac_snapshot
		 WHERE tenant_id = $1
		 ORDER BY name ASC, version DESC, created_at DESC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("iacdr: listing snapshots: %w", err)
	}
	defer rows.Close()
	var out []Snapshot
	for rows.Next() {
		var snap Snapshot
		var groupID *string
		var metaJSON []byte
		if err := rows.Scan(&snap.ID, &snap.TenantID, &groupID, &snap.Name, &snap.SourceKind,
			&snap.Version, &snap.ContentHash, &snap.ResourceCount, &metaJSON, &snap.CreatedAt); err != nil {
			return nil, fmt.Errorf("iacdr: scanning snapshot: %w", err)
		}
		snap.GroupID = groupID
		if len(metaJSON) > 0 {
			if err := json.Unmarshal(metaJSON, &snap.Metadata); err != nil {
				return nil, fmt.Errorf("iacdr: unmarshaling snapshot metadata: %w", err)
			}
		}
		out = append(out, snap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iacdr: iterating snapshots: %w", err)
	}
	return out, nil
}

// LoadResources loads a snapshot's resources, ordered by address for
// determinism. Returns nil (not an error) when the snapshot has no resources.
func (s *Store) LoadResources(ctx context.Context, db DBTX, snapshotID string) ([]Resource, error) {
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, snapshot_id, provider, type, name, address, attributes, depends_on, resource_hash, created_at
		  FROM dr_iac_resource
		 WHERE snapshot_id = $1
		 ORDER BY address ASC, id ASC`, snapshotID)
	if err != nil {
		return nil, fmt.Errorf("iacdr: reading resources of snapshot %s: %w", snapshotID, err)
	}
	defer rows.Close()
	var out []Resource
	for rows.Next() {
		var r Resource
		var attrsJSON, depsJSON []byte
		if err := rows.Scan(&r.ID, &r.TenantID, &r.SnapshotID, &r.Provider, &r.Type, &r.Name,
			&r.Address, &attrsJSON, &depsJSON, &r.Hash, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("iacdr: scanning resource: %w", err)
		}
		if len(attrsJSON) > 0 {
			if err := json.Unmarshal(attrsJSON, &r.Attributes); err != nil {
				return nil, fmt.Errorf("iacdr: unmarshaling attributes of %s: %w", r.Address, err)
			}
		}
		if r.Attributes == nil {
			r.Attributes = map[string]any{}
		}
		if len(depsJSON) > 0 {
			if err := json.Unmarshal(depsJSON, &r.DependsOn); err != nil {
				return nil, fmt.Errorf("iacdr: unmarshaling depends_on of %s: %w", r.Address, err)
			}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iacdr: iterating resources of snapshot %s: %w", snapshotID, err)
	}
	return out, nil
}

// GroupExists reports whether a consistency group exists (RLS-scoped). Used to
// validate an optional group binding on ingest.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM consistency_group WHERE id = $1)`, groupID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("iacdr: checking group %s: %w", groupID, err)
	}
	return exists, nil
}
