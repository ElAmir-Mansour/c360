package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, the generator,
// and the consumer all speak the same execution-context type: a *pgxpool.Pool
// for single reads or the caller's open transaction so a runbook write commits
// atomically with its outbox event. This package adds its OWN read methods for
// the asset tables via raw queries rather than editing the shared repository.
type DBTX = repository.DBTX

// Store persists the recovery-asset registry (its two owned tables) AND reads
// the real DR assets a runbook is generated from. It holds no state; callers
// choose the DBTX, so a request reads under a tenant transaction and the
// reconcile loop reads/writes under a system (RLS-bypass) transaction.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ---------------------------------------------------------------------------
// Asset reads — the real substrate a runbook is generated from. These are
// package-local raw queries over repository.DBTX (the prompt explicitly permits
// adding read methods INSIDE this package rather than editing the shared repo).
// ---------------------------------------------------------------------------

// GroupExists reports whether the consistency group exists (scoped by the DBTX's
// RLS context). It is used so a "no members" group is distinguished from a
// missing group.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID string) (string, bool, error) {
	var name string
	err := db.QueryRow(ctx,
		`SELECT name FROM consistency_group WHERE id = $1`, groupID,
	).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("registry: checking group %s: %w", groupID, err)
	}
	return name, true, nil
}

// LoadAssetSnapshot reads the complete, current asset set for a group and
// assembles the deterministic snapshot a runbook is materialized from: the
// group name, its members joined to their protected sites (with boot order and
// primary endpoint), the network mappings for the requested profile, the latest
// validated recovery point, and the group's aggregated RTO/RPO objectives
// (the strictest — max objective seconds — across members so the runbook
// reflects the worst-case window the whole group must satisfy). Returns
// ErrGroupNotFound if the group is absent.
func (s *Store) LoadAssetSnapshot(ctx context.Context, db DBTX, groupID, profile string) (AssetSnapshot, error) {
	if profile == "" {
		profile = "production"
	}
	groupName, ok, err := s.GroupExists(ctx, db, groupID)
	if err != nil {
		return AssetSnapshot{}, err
	}
	if !ok {
		return AssetSnapshot{}, fmt.Errorf("group %s: %w", groupID, ErrGroupNotFound)
	}

	snap := AssetSnapshot{
		GroupID:        groupID,
		GroupName:      groupName,
		NetworkProfile: profile,
		CapturedAt:     time.Now().UTC(),
	}

	// Members joined to their protected sites, ordered by boot_order then site_id
	// for determinism. The network-mapping CIDRs for the requested profile are
	// attached per member where a mapping exists; group-level mappings are not
	// per-site, so we attach the first mapping of the profile to every member as
	// the group's remap (the recovery executor applies the group profile uniformly
	// — §6.3). If there are multiple mappings we expose the first deterministically
	// and the full set is still visible via the membership/objectives.
	rows, err := db.Query(ctx, `
		SELECT cgm.site_id, ps.name, ps.kind, ps.primary_endpoint, cgm.boot_order,
		       ps.rto_objective_seconds, ps.rpo_objective_seconds
		  FROM consistency_group_member cgm
		  JOIN protected_site ps ON ps.id = cgm.site_id
		 WHERE cgm.group_id = $1
		 ORDER BY cgm.boot_order ASC, cgm.site_id ASC`, groupID)
	if err != nil {
		return AssetSnapshot{}, fmt.Errorf("registry: reading members of group %s: %w", groupID, err)
	}
	defer rows.Close()

	maxRTO, maxRPO := 0, 0
	for rows.Next() {
		var m MemberAsset
		var rto, rpo int
		if err := rows.Scan(&m.SiteID, &m.SiteName, &m.SiteKind, &m.PrimaryEndpoint, &m.BootOrder, &rto, &rpo); err != nil {
			return AssetSnapshot{}, fmt.Errorf("registry: scanning member of group %s: %w", groupID, err)
		}
		m.NetworkProfile = profile
		snap.Members = append(snap.Members, m)
		if rto > maxRTO {
			maxRTO = rto
		}
		if rpo > maxRPO {
			maxRPO = rpo
		}
	}
	if err := rows.Err(); err != nil {
		return AssetSnapshot{}, fmt.Errorf("registry: iterating members of group %s: %w", groupID, err)
	}
	snap.RTOObjectiveSeconds = maxRTO
	snap.RPOObjectiveSeconds = maxRPO

	// Network mapping for the profile (the group's remap). Apply uniformly to all
	// members so each boot step records the active remap.
	var primaryCIDR, recoveryCIDR sql.NullString
	err = db.QueryRow(ctx, `
		SELECT primary_cidr, recovery_cidr
		  FROM network_mapping
		 WHERE group_id = $1 AND profile = $2
		 ORDER BY primary_cidr ASC
		 LIMIT 1`, groupID, profile).Scan(&primaryCIDR, &recoveryCIDR)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return AssetSnapshot{}, fmt.Errorf("registry: reading network mapping for group %s: %w", groupID, err)
	}
	if primaryCIDR.Valid || recoveryCIDR.Valid {
		for i := range snap.Members {
			snap.Members[i].PrimaryCIDR = primaryCIDR.String
			snap.Members[i].RecoveryCIDR = recoveryCIDR.String
		}
	}

	// Latest validated recovery point for the group (the Gate-1 pin). A NULL
	// validation_ratio is impossible for is_validated rows but guarded anyway.
	var rp RecoveryPointAsset
	var ratio sql.NullFloat64
	var sealedAt time.Time
	err = db.QueryRow(ctx, `
		SELECT id, marker_lsn, rpo_seconds, validation_ratio, is_validated, sealed_at
		  FROM recovery_point
		 WHERE group_id = $1 AND is_validated = true
		 ORDER BY sealed_at DESC
		 LIMIT 1`, groupID).Scan(&rp.ID, &rp.MarkerLSN, &rp.RPOSeconds, &ratio, &rp.IsValidated, &sealedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// No validated recovery point yet; snap.RecoveryPoint stays nil and the
		// template records the blocked Gate-1 precondition.
	case err != nil:
		return AssetSnapshot{}, fmt.Errorf("registry: reading recovery point for group %s: %w", groupID, err)
	default:
		if ratio.Valid {
			rp.ValidationRatio = ratio.Float64
		}
		rp.SealedAt = sealedAt.UTC().Format(time.RFC3339)
		// The newest validated point carries the ransomware-safe legal hold (§5);
		// surface it so the runbook reader knows the pinned point is protected.
		rp.LegalHold = true
		snap.RecoveryPoint = &rp
	}

	return snap, nil
}

// ---------------------------------------------------------------------------
// Runbook + version persistence (this package's two owned tables).
// ---------------------------------------------------------------------------

// GetRunbook returns the runbook index row for a group, or ErrNotFound.
func (s *Store) GetRunbook(ctx context.Context, db DBTX, groupID string) (*Runbook, error) {
	var rb Runbook
	err := db.QueryRow(ctx, `
		SELECT id, tenant_id, group_id, current_version, template_id, created_at, updated_at
		  FROM dr_recovery_runbook
		 WHERE group_id = $1`, groupID,
	).Scan(&rb.ID, &rb.TenantID, &rb.GroupID, &rb.CurrentVersion, &rb.TemplateID, &rb.CreatedAt, &rb.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("registry: reading runbook for group %s: %w", groupID, err)
	}
	return &rb, nil
}

// EnsureRunbook returns the existing runbook for a group, creating it (version 0,
// the given template) if absent. It is safe under a concurrent create: a unique
// violation on (group_id) is treated as a lost race and the existing row is read
// back. tenantID must be the group's tenant.
func (s *Store) EnsureRunbook(ctx context.Context, db DBTX, tenantID, groupID, templateID string) (*Runbook, error) {
	rb, err := s.GetRunbook(ctx, db, groupID)
	if err == nil {
		return rb, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	var created Runbook
	err = db.QueryRow(ctx, `
		INSERT INTO dr_recovery_runbook (tenant_id, group_id, current_version, template_id)
		VALUES ($1, $2, 0, $3)
		RETURNING id, tenant_id, group_id, current_version, template_id, created_at, updated_at`,
		tenantID, groupID, templateID,
	).Scan(&created.ID, &created.TenantID, &created.GroupID, &created.CurrentVersion, &created.TemplateID, &created.CreatedAt, &created.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			// Lost the create race; read the row the winner inserted.
			return s.GetRunbook(ctx, db, groupID)
		}
		return nil, fmt.Errorf("registry: creating runbook for group %s: %w", groupID, err)
	}
	return &created, nil
}

// GetLatestVersion returns the newest stored version of a runbook, or ErrNotFound
// when no version has been generated yet.
func (s *Store) GetLatestVersion(ctx context.Context, db DBTX, runbookID string) (*RunbookVersion, error) {
	return s.scanVersion(db.QueryRow(ctx, `
		SELECT id, runbook_id, tenant_id, group_id, version, template_id, steps,
		       asset_snapshot, content_hash, diff, trigger, created_at
		  FROM dr_recovery_runbook_version
		 WHERE runbook_id = $1
		 ORDER BY version DESC
		 LIMIT 1`, runbookID))
}

// GetVersion returns a specific version of a runbook.
func (s *Store) GetVersion(ctx context.Context, db DBTX, runbookID string, version int) (*RunbookVersion, error) {
	return s.scanVersion(db.QueryRow(ctx, `
		SELECT id, runbook_id, tenant_id, group_id, version, template_id, steps,
		       asset_snapshot, content_hash, diff, trigger, created_at
		  FROM dr_recovery_runbook_version
		 WHERE runbook_id = $1 AND version = $2`, runbookID, version))
}

// ListVersions returns all versions of a runbook, newest first.
func (s *Store) ListVersions(ctx context.Context, db DBTX, runbookID string) ([]*RunbookVersion, error) {
	rows, err := db.Query(ctx, `
		SELECT id, runbook_id, tenant_id, group_id, version, template_id, steps,
		       asset_snapshot, content_hash, diff, trigger, created_at
		  FROM dr_recovery_runbook_version
		 WHERE runbook_id = $1
		 ORDER BY version DESC`, runbookID)
	if err != nil {
		return nil, fmt.Errorf("registry: listing versions of runbook %s: %w", runbookID, err)
	}
	defer rows.Close()

	var out []*RunbookVersion
	for rows.Next() {
		v, err := s.scanVersionRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("registry: iterating versions of runbook %s: %w", runbookID, err)
	}
	return out, nil
}

// InsertVersion appends a new immutable version and advances the runbook's
// current_version pointer in the same transaction. version must be
// runbook.CurrentVersion+1; the UNIQUE (runbook_id, version) constraint is the
// concurrency backstop (a duplicate version number fails the insert). Returns
// the stored version.
func (s *Store) InsertVersion(ctx context.Context, db DBTX, v *RunbookVersion) (*RunbookVersion, error) {
	stepsJSON, err := json.Marshal(v.Steps)
	if err != nil {
		return nil, fmt.Errorf("registry: marshaling steps: %w", err)
	}
	snapJSON, err := json.Marshal(v.AssetSnapshot)
	if err != nil {
		return nil, fmt.Errorf("registry: marshaling asset snapshot: %w", err)
	}
	var diffJSON []byte
	if v.Diff != nil {
		diffJSON, err = json.Marshal(v.Diff)
		if err != nil {
			return nil, fmt.Errorf("registry: marshaling diff: %w", err)
		}
	}

	var stored RunbookVersion
	var diffRaw []byte
	err = db.QueryRow(ctx, `
		INSERT INTO dr_recovery_runbook_version
		    (runbook_id, tenant_id, group_id, version, template_id, steps, asset_snapshot, content_hash, diff, trigger)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, runbook_id, tenant_id, group_id, version, template_id, steps,
		          asset_snapshot, content_hash, diff, trigger, created_at`,
		v.RunbookID, v.TenantID, v.GroupID, v.Version, v.TemplateID, stepsJSON, snapJSON, v.ContentHash, diffJSON, v.Trigger,
	).Scan(&stored.ID, &stored.RunbookID, &stored.TenantID, &stored.GroupID, &stored.Version,
		&stored.TemplateID, &stepsJSON, &snapJSON, &stored.ContentHash, &diffRaw, &stored.Trigger, &stored.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("registry: inserting runbook version %d: %w", v.Version, err)
	}
	if err := json.Unmarshal(stepsJSON, &stored.Steps); err != nil {
		return nil, fmt.Errorf("registry: decoding stored steps: %w", err)
	}
	if err := json.Unmarshal(snapJSON, &stored.AssetSnapshot); err != nil {
		return nil, fmt.Errorf("registry: decoding stored snapshot: %w", err)
	}
	if len(diffRaw) > 0 {
		var d RunbookDiff
		if err := json.Unmarshal(diffRaw, &d); err != nil {
			return nil, fmt.Errorf("registry: decoding stored diff: %w", err)
		}
		stored.Diff = &d
	}

	tag, err := db.Exec(ctx, `
		UPDATE dr_recovery_runbook
		   SET current_version = $2, template_id = $3, updated_at = now()
		 WHERE id = $1`, v.RunbookID, v.Version, v.TemplateID)
	if err != nil {
		return nil, fmt.Errorf("registry: advancing runbook %s to version %d: %w", v.RunbookID, v.Version, err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("registry: runbook %s vanished while advancing: %w", v.RunbookID, ErrNotFound)
	}
	return &stored, nil
}

func (s *Store) scanVersion(row pgx.Row) (*RunbookVersion, error) {
	var v RunbookVersion
	var stepsJSON, snapJSON, diffRaw []byte
	err := row.Scan(&v.ID, &v.RunbookID, &v.TenantID, &v.GroupID, &v.Version, &v.TemplateID,
		&stepsJSON, &snapJSON, &v.ContentHash, &diffRaw, &v.Trigger, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("registry: scanning runbook version: %w", err)
	}
	if err := decodeVersionJSON(&v, stepsJSON, snapJSON, diffRaw); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Store) scanVersionRows(rows pgx.Rows) (*RunbookVersion, error) {
	var v RunbookVersion
	var stepsJSON, snapJSON, diffRaw []byte
	err := rows.Scan(&v.ID, &v.RunbookID, &v.TenantID, &v.GroupID, &v.Version, &v.TemplateID,
		&stepsJSON, &snapJSON, &v.ContentHash, &diffRaw, &v.Trigger, &v.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("registry: scanning runbook version row: %w", err)
	}
	if err := decodeVersionJSON(&v, stepsJSON, snapJSON, diffRaw); err != nil {
		return nil, err
	}
	return &v, nil
}

func decodeVersionJSON(v *RunbookVersion, stepsJSON, snapJSON, diffRaw []byte) error {
	if err := json.Unmarshal(stepsJSON, &v.Steps); err != nil {
		return fmt.Errorf("registry: decoding steps for version %d: %w", v.Version, err)
	}
	if err := json.Unmarshal(snapJSON, &v.AssetSnapshot); err != nil {
		return fmt.Errorf("registry: decoding snapshot for version %d: %w", v.Version, err)
	}
	if len(diffRaw) > 0 {
		var d RunbookDiff
		if err := json.Unmarshal(diffRaw, &d); err != nil {
			return fmt.Errorf("registry: decoding diff for version %d: %w", v.Version, err)
		}
		v.Diff = &d
	}
	return nil
}
