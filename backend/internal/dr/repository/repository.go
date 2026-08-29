// Package repository persists the ClarioDR domain. Every method takes a DBTX so
// callers choose the execution context: a pool for single reads, or the
// service's open transaction so state changes commit atomically with their
// outbox events (DESIGN_DataStream_DR.md §4.1, §6.2).
//
// Tenant isolation: every request-path method filters by tenant_id AND runs
// under SET LOCAL app.current_tenant_id, so RLS is the backstop (§7). The ONLY
// cross-tenant reads are the systemQuery* methods used by the leader-singletons
// (failover.Driver, rpo_monitor); they are documented "background-loop only;
// bypasses tenant RLS by design" and no request-path code may call them.
package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/model"
)

// DBTX is the subset of pgx satisfied by both *pgxpool.Pool and pgx.Tx (and
// pgxmock's pool/tx interfaces). Passing the caller's open transaction is what
// makes a write transactional with its outbox event.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repository holds no state; it exists so the service can depend on an
// interface-shaped value and tests can substitute it.
type Repository struct{}

// New constructs a Repository.
func New() *Repository { return &Repository{} }

// isUniqueViolation reports whether err is a PostgreSQL unique constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}

func optionalString(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}

func optionalTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func optionalInt(i sql.NullInt64) *int {
	if !i.Valid {
		return nil
	}
	v := int(i.Int64)
	return &v
}

func optionalFloat(f sql.NullFloat64) *float64 {
	if !f.Valid {
		return nil
	}
	return &f.Float64
}

// --- Protected sites -----------------------------------------------------

const insertSiteSQL = `
INSERT INTO protected_site (tenant_id, name, kind, primary_endpoint, rto_objective_seconds, rpo_objective_seconds)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, created_at, updated_at`

// CreateSite inserts a protected site and populates its generated fields.
func (r *Repository) CreateSite(ctx context.Context, db DBTX, s *model.ProtectedSite) error {
	err := db.QueryRow(ctx, insertSiteSQL,
		s.TenantID, s.Name, s.Kind, s.PrimaryEndpoint, s.RTOObjectiveSeconds, s.RPOObjectiveSeconds,
	).Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("site %s: %w", s.Name, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating site %s: %w", s.Name, err)
	}
	return nil
}

const selectSiteSQL = `
SELECT id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds, rpo_objective_seconds, created_at, updated_at
FROM protected_site WHERE tenant_id = $1 AND id = $2`

// GetSite loads one protected site scoped to the tenant.
func (r *Repository) GetSite(ctx context.Context, db DBTX, tenantID, id string) (*model.ProtectedSite, error) {
	var s model.ProtectedSite
	err := db.QueryRow(ctx, selectSiteSQL, tenantID, id).Scan(
		&s.ID, &s.TenantID, &s.Name, &s.Kind, &s.PrimaryEndpoint,
		&s.RTOObjectiveSeconds, &s.RPOObjectiveSeconds, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("site %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading site %s: %w", id, err)
	}
	return &s, nil
}

const listSitesSQL = `
SELECT id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds, rpo_objective_seconds, created_at, updated_at
FROM protected_site WHERE tenant_id = $1 ORDER BY name`

// ListSites returns all protected sites for the tenant.
func (r *Repository) ListSites(ctx context.Context, db DBTX, tenantID string) ([]*model.ProtectedSite, error) {
	rows, err := db.Query(ctx, listSitesSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing sites: %w", err)
	}
	defer rows.Close()

	var sites []*model.ProtectedSite
	for rows.Next() {
		var s model.ProtectedSite
		if err := rows.Scan(
			&s.ID, &s.TenantID, &s.Name, &s.Kind, &s.PrimaryEndpoint,
			&s.RTOObjectiveSeconds, &s.RPOObjectiveSeconds, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning site: %w", err)
		}
		sites = append(sites, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading sites: %w", err)
	}
	return sites, nil
}

// --- Consistency groups + members ----------------------------------------

const insertGroupSQL = `
INSERT INTO consistency_group (tenant_id, name)
VALUES ($1, $2)
RETURNING id, created_at`

// CreateGroup inserts a consistency group and populates generated fields.
func (r *Repository) CreateGroup(ctx context.Context, db DBTX, g *model.ConsistencyGroup) error {
	err := db.QueryRow(ctx, insertGroupSQL, g.TenantID, g.Name).Scan(&g.ID, &g.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("group %s: %w", g.Name, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating group %s: %w", g.Name, err)
	}
	return nil
}

const selectGroupSQL = `
SELECT id, tenant_id, name, created_at
FROM consistency_group WHERE tenant_id = $1 AND id = $2`

// GetGroup loads one consistency group scoped to the tenant.
func (r *Repository) GetGroup(ctx context.Context, db DBTX, tenantID, id string) (*model.ConsistencyGroup, error) {
	var g model.ConsistencyGroup
	err := db.QueryRow(ctx, selectGroupSQL, tenantID, id).Scan(&g.ID, &g.TenantID, &g.Name, &g.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("group %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading group %s: %w", id, err)
	}
	return &g, nil
}

const listGroupsSQL = `
SELECT id, tenant_id, name, created_at
FROM consistency_group WHERE tenant_id = $1 ORDER BY name`

// ListGroups returns all consistency groups for the tenant.
func (r *Repository) ListGroups(ctx context.Context, db DBTX, tenantID string) ([]*model.ConsistencyGroup, error) {
	rows, err := db.Query(ctx, listGroupsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing groups: %w", err)
	}
	defer rows.Close()

	var groups []*model.ConsistencyGroup
	for rows.Next() {
		var g model.ConsistencyGroup
		if err := rows.Scan(&g.ID, &g.TenantID, &g.Name, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning group: %w", err)
		}
		groups = append(groups, &g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading groups: %w", err)
	}
	return groups, nil
}

const upsertGroupMemberSQL = `
INSERT INTO consistency_group_member (group_id, site_id, boot_order)
VALUES ($1, $2, $3)
ON CONFLICT (group_id, site_id) DO UPDATE SET boot_order = EXCLUDED.boot_order`

// AddGroupMember adds (or re-orders) a site in a consistency group.
func (r *Repository) AddGroupMember(ctx context.Context, db DBTX, m *model.ConsistencyGroupMember) error {
	if _, err := db.Exec(ctx, upsertGroupMemberSQL, m.GroupID, m.SiteID, m.BootOrder); err != nil {
		return fmt.Errorf("adding group member: %w", err)
	}
	return nil
}

const listGroupMembersSQL = `
SELECT group_id, site_id, boot_order
FROM consistency_group_member WHERE group_id = $1 ORDER BY boot_order, site_id`

// ListGroupMembers returns a group's members in boot order.
func (r *Repository) ListGroupMembers(ctx context.Context, db DBTX, groupID string) ([]model.ConsistencyGroupMember, error) {
	rows, err := db.Query(ctx, listGroupMembersSQL, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing group members: %w", err)
	}
	defer rows.Close()

	var members []model.ConsistencyGroupMember
	for rows.Next() {
		var m model.ConsistencyGroupMember
		if err := rows.Scan(&m.GroupID, &m.SiteID, &m.BootOrder); err != nil {
			return nil, fmt.Errorf("scanning group member: %w", err)
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading group members: %w", err)
	}
	return members, nil
}

// --- Replication streams --------------------------------------------------

const insertStreamSQL = `
INSERT INTO replication_stream (tenant_id, site_id, status)
VALUES ($1, $2, $3)
RETURNING id, applied_seq, created_at, updated_at`

// CreateStream inserts a replication stream for a site (one per site).
func (r *Repository) CreateStream(ctx context.Context, db DBTX, s *model.ReplicationStream) error {
	if s.Status == "" {
		s.Status = model.StreamStatusPending
	}
	err := db.QueryRow(ctx, insertStreamSQL, s.TenantID, s.SiteID, s.Status).
		Scan(&s.ID, &s.AppliedSeq, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("stream for site %s: %w", s.SiteID, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating stream for site %s: %w", s.SiteID, err)
	}
	return nil
}

const selectStreamSQL = `
SELECT id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at, source_committed_at, last_error, created_at, updated_at
FROM replication_stream WHERE tenant_id = $1 AND id = $2`

// GetStream loads one replication stream scoped to the tenant.
func (r *Repository) GetStream(ctx context.Context, db DBTX, tenantID, id string) (*model.ReplicationStream, error) {
	var s model.ReplicationStream
	var sourceLSN, lastError sql.NullString
	var appliedAt, sourceCommittedAt sql.NullTime
	err := db.QueryRow(ctx, selectStreamSQL, tenantID, id).Scan(
		&s.ID, &s.TenantID, &s.SiteID, &s.Status, &s.AppliedSeq,
		&sourceLSN, &appliedAt, &sourceCommittedAt, &lastError, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("stream %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading stream %s: %w", id, err)
	}
	s.SourceLSN = optionalString(sourceLSN)
	s.AppliedAt = optionalTime(appliedAt)
	s.SourceCommittedAt = optionalTime(sourceCommittedAt)
	s.LastError = optionalString(lastError)
	return &s, nil
}

const selectStreamBySiteSQL = `
SELECT id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at, source_committed_at, last_error, created_at, updated_at
FROM replication_stream WHERE tenant_id = $1 AND site_id = $2`

// GetStreamBySite loads the (unique) replication stream for a protected site.
// The recovery-point store uses it to map a consistency-group member (a site)
// to the stream whose current chunk must be sealed.
func (r *Repository) GetStreamBySite(ctx context.Context, db DBTX, tenantID, siteID string) (*model.ReplicationStream, error) {
	var s model.ReplicationStream
	var sourceLSN, lastError sql.NullString
	var appliedAt, sourceCommittedAt sql.NullTime
	err := db.QueryRow(ctx, selectStreamBySiteSQL, tenantID, siteID).Scan(
		&s.ID, &s.TenantID, &s.SiteID, &s.Status, &s.AppliedSeq,
		&sourceLSN, &appliedAt, &sourceCommittedAt, &lastError, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("stream for site %s: %w", siteID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading stream for site %s: %w", siteID, err)
	}
	s.SourceLSN = optionalString(sourceLSN)
	s.AppliedAt = optionalTime(appliedAt)
	s.SourceCommittedAt = optionalTime(sourceCommittedAt)
	s.LastError = optionalString(lastError)
	return &s, nil
}

const listStreamsSQL = `
SELECT id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at, source_committed_at, last_error, created_at, updated_at
FROM replication_stream WHERE tenant_id = $1 ORDER BY created_at`

// ListStreams returns all replication streams for the tenant.
func (r *Repository) ListStreams(ctx context.Context, db DBTX, tenantID string) ([]*model.ReplicationStream, error) {
	rows, err := db.Query(ctx, listStreamsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing streams: %w", err)
	}
	defer rows.Close()
	return scanStreams(rows)
}

func scanStreams(rows pgx.Rows) ([]*model.ReplicationStream, error) {
	var streams []*model.ReplicationStream
	for rows.Next() {
		var s model.ReplicationStream
		var sourceLSN, lastError sql.NullString
		var appliedAt, sourceCommittedAt sql.NullTime
		if err := rows.Scan(
			&s.ID, &s.TenantID, &s.SiteID, &s.Status, &s.AppliedSeq,
			&sourceLSN, &appliedAt, &sourceCommittedAt, &lastError, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning stream: %w", err)
		}
		s.SourceLSN = optionalString(sourceLSN)
		s.AppliedAt = optionalTime(appliedAt)
		s.SourceCommittedAt = optionalTime(sourceCommittedAt)
		s.LastError = optionalString(lastError)
		streams = append(streams, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading streams: %w", err)
	}
	return streams, nil
}

const setStreamStatusSQL = `
UPDATE replication_stream SET status = $3, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// SetStreamStatus pauses/resumes/marks a stream (request-path, tenant-scoped).
func (r *Repository) SetStreamStatus(ctx context.Context, db DBTX, tenantID, id, status string) error {
	tag, err := db.Exec(ctx, setStreamStatusSQL, tenantID, id, status)
	if err != nil {
		return fmt.Errorf("setting stream status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("stream %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const pauseTenantStreamsSQL = `
UPDATE replication_stream
SET status = 'paused', last_error = $2, updated_at = now()
WHERE tenant_id = $1 AND status <> 'paused'`

// PauseTenantStreams pauses every non-paused stream for one tenant. It is used
// by the cross-suite license consumer when entitlement state changes require DR
// replication to stop promptly.
func (r *Repository) PauseTenantStreams(ctx context.Context, db DBTX, tenantID, reason string) (int64, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "paused by cross-suite control event"
	}
	tag, err := db.Exec(ctx, pauseTenantStreamsSQL, tenantID, reason)
	if err != nil {
		return 0, fmt.Errorf("pausing tenant streams: %w", err)
	}
	return tag.RowsAffected(), nil
}

// updateStreamCheckpointSQL advances the RPO ledger. $7 is the optional source
// emit/commit timestamp; COALESCE keeps the prior source_committed_at when the
// caller passes NULL (e.g. the streaming core adapter that cannot yet supply an
// emit time), so an in-flight source-lag value is never clobbered by a plain
// checkpoint advance.
const updateStreamCheckpointSQL = `
UPDATE replication_stream
SET applied_seq = $3, source_lsn = $4, applied_at = $5,
    status = $6,
    source_committed_at = COALESCE($7, source_committed_at),
    last_error = NULL, updated_at = now()
WHERE id = $2 AND tenant_id = $1`

// UpdateStreamCheckpoint advances the RPO ledger (applied_seq, source_lsn,
// applied_at) for a stream after a contiguous apply. The Checkpointer (WP-3)
// calls this; it is the live-RPO source. Tenant-scoped on the request path.
//
// sourceCommittedAt is variadic and optional: pass the source emit/commit wall
// clock (core.Frame.EmittedAt) of the last applied frame to record the true
// source-to-target lag (applied_at - source_committed_at). Passing nothing (or a
// nil/zero value) leaves the existing source_committed_at untouched, so the
// fixed-signature core StreamCheckpointStore adapter keeps compiling and the
// monitor falls back to the apply-side RPO for streams that never supply it.
func (r *Repository) UpdateStreamCheckpoint(ctx context.Context, db DBTX, tenantID, id string, appliedSeq int64, sourceLSN string, appliedAt time.Time, status string, sourceCommittedAt ...*time.Time) error {
	var srcCommitted *time.Time
	for _, t := range sourceCommittedAt {
		if t != nil && !t.IsZero() {
			srcCommitted = t
		}
	}
	tag, err := db.Exec(ctx, updateStreamCheckpointSQL, tenantID, id, appliedSeq, sourceLSN, appliedAt, status, srcCommitted)
	if err != nil {
		return fmt.Errorf("updating stream checkpoint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("stream %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const systemListStreamsForMonitorSQL = `
SELECT
    rs.id, rs.tenant_id, rs.site_id, rs.status, rs.applied_seq,
    rs.source_lsn, rs.applied_at, rs.source_committed_at, rs.last_error,
    rs.created_at, rs.updated_at,
    ps.name, ps.kind, ps.rpo_objective_seconds,
    COALESCE(grp.name, ps.name) AS group_name
FROM replication_stream rs
JOIN protected_site ps ON ps.id = rs.site_id AND ps.tenant_id = rs.tenant_id
LEFT JOIN LATERAL (
    SELECT cg.name
    FROM consistency_group_member cgm
    JOIN consistency_group cg ON cg.id = cgm.group_id
    WHERE cgm.site_id = rs.site_id
    ORDER BY cg.name
    LIMIT 1
) grp ON true
WHERE rs.status IN ('streaming','seeding','degraded','error')
ORDER BY rs.applied_at NULLS FIRST, rs.updated_at`

// SystemListStreamsForMonitor returns active streams ACROSS ALL TENANTS for the
// RPO monitor, enriched with the site's RPO objective.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton rpo_monitor may call this; never the request path.
func (r *Repository) SystemListStreamsForMonitor(ctx context.Context, db DBTX) ([]*model.StreamMonitorSnapshot, error) {
	rows, err := db.Query(ctx, systemListStreamsForMonitorSQL)
	if err != nil {
		return nil, fmt.Errorf("system listing streams for monitor: %w", err)
	}
	defer rows.Close()
	return scanStreamMonitorSnapshots(rows)
}

func scanStreamMonitorSnapshots(rows pgx.Rows) ([]*model.StreamMonitorSnapshot, error) {
	var snapshots []*model.StreamMonitorSnapshot
	for rows.Next() {
		var s model.StreamMonitorSnapshot
		var sourceLSN, lastError sql.NullString
		var appliedAt, sourceCommittedAt sql.NullTime
		if err := rows.Scan(
			&s.ID, &s.TenantID, &s.SiteID, &s.Status, &s.AppliedSeq,
			&sourceLSN, &appliedAt, &sourceCommittedAt, &lastError, &s.CreatedAt, &s.UpdatedAt,
			&s.SiteName, &s.SiteKind, &s.RPOObjectiveSeconds, &s.GroupName,
		); err != nil {
			return nil, fmt.Errorf("scanning stream monitor snapshot: %w", err)
		}
		s.SourceLSN = optionalString(sourceLSN)
		s.AppliedAt = optionalTime(appliedAt)
		s.SourceCommittedAt = optionalTime(sourceCommittedAt)
		s.LastError = optionalString(lastError)
		snapshots = append(snapshots, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading stream monitor snapshots: %w", err)
	}
	return snapshots, nil
}

const systemUpdateStreamMonitorStatusSQL = `
UPDATE replication_stream
SET status = $4, last_error = $5, updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = $3`

// SystemUpdateStreamStatusForMonitor performs a guarded background status
// transition. The expected-status predicate prevents duplicate RPO events when
// multiple monitor loops or retries observe the same stale snapshot.
func (r *Repository) SystemUpdateStreamStatusForMonitor(ctx context.Context, db DBTX, tenantID, id, expectedStatus, status string, lastError *string) (bool, error) {
	tag, err := db.Exec(ctx, systemUpdateStreamMonitorStatusSQL, tenantID, id, expectedStatus, status, lastError)
	if err != nil {
		return false, fmt.Errorf("system updating stream monitor status: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// --- Recovery points ------------------------------------------------------

const insertRecoveryPointSQL = `
INSERT INTO recovery_point (tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, retention_until)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, sealed_at`

// CreateRecoveryPoint inserts an immutable recovery-point index row.
func (r *Repository) CreateRecoveryPoint(ctx context.Context, db DBTX, rp *model.RecoveryPoint) error {
	keys := rp.ObjectKeys
	if keys == nil {
		keys = map[string]string{}
	}
	keysJSON, err := json.Marshal(keys)
	if err != nil {
		return fmt.Errorf("marshaling recovery-point object keys: %w", err)
	}
	err = db.QueryRow(ctx, insertRecoveryPointSQL,
		rp.TenantID, rp.GroupID, rp.MarkerLSN, rp.RPOSeconds, keysJSON,
		rp.ContentHash, rp.ValidationRatio, rp.IsValidated, rp.LegalHold, rp.RetentionUntil,
	).Scan(&rp.ID, &rp.SealedAt)
	if err != nil {
		return fmt.Errorf("creating recovery point: %w", err)
	}
	return nil
}

const selectRecoveryPointSQL = `
SELECT id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, sealed_at, retention_until
FROM recovery_point WHERE tenant_id = $1 AND id = $2`

// GetRecoveryPoint loads one recovery point scoped to the tenant.
func (r *Repository) GetRecoveryPoint(ctx context.Context, db DBTX, tenantID, id string) (*model.RecoveryPoint, error) {
	row := db.QueryRow(ctx, selectRecoveryPointSQL, tenantID, id)
	rp, err := scanRecoveryPoint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("recovery point %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading recovery point %s: %w", id, err)
	}
	return rp, nil
}

const listRecoveryPointsByGroupSQL = `
SELECT id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, sealed_at, retention_until
FROM recovery_point WHERE tenant_id = $1 AND group_id = $2 ORDER BY sealed_at DESC`

// ListRecoveryPointsByGroup returns a group's recovery points, newest first.
func (r *Repository) ListRecoveryPointsByGroup(ctx context.Context, db DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error) {
	rows, err := db.Query(ctx, listRecoveryPointsByGroupSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing recovery points: %w", err)
	}
	defer rows.Close()

	var points []*model.RecoveryPoint
	for rows.Next() {
		rp, err := scanRecoveryPoint(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning recovery point: %w", err)
		}
		points = append(points, rp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading recovery points: %w", err)
	}
	return points, nil
}

// scanRows is the minimal interface both pgx.Row and pgx.Rows satisfy for Scan.
type scanRows interface {
	Scan(dest ...any) error
}

func scanRecoveryPoint(row scanRows) (*model.RecoveryPoint, error) {
	var rp model.RecoveryPoint
	var keysJSON []byte
	var validationRatio sql.NullFloat64
	if err := row.Scan(
		&rp.ID, &rp.TenantID, &rp.GroupID, &rp.MarkerLSN, &rp.RPOSeconds,
		&keysJSON, &rp.ContentHash, &validationRatio, &rp.IsValidated,
		&rp.LegalHold, &rp.SealedAt, &rp.RetentionUntil,
	); err != nil {
		return nil, err
	}
	rp.ValidationRatio = optionalFloat(validationRatio)
	if len(keysJSON) > 0 {
		keys, err := unmarshalObjectKeys(keysJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshaling object keys: %w", err)
		}
		rp.ObjectKeys = keys
	}
	return &rp, nil
}

// unmarshalObjectKeys decodes a recovery_point.object_keys JSONB column into the
// public map[string]string shape consumers (attest/pdf) rely on. It is tolerant
// of two on-disk encodings: the current scalar form {"<site>":"<key>"} AND the
// historical array form {"<site>":["<key>", ...]} written by older seeds/agents.
// Array values are flattened to their first element; an empty array is skipped
// (no key for that site). Because the rows are WORM-sealed (the immutability
// trigger blocks UPDATE), the legacy array rows cannot be rewritten, so the read
// path must accept both — see internal/dr/attest/builder.go (ObjectKeys type).
func unmarshalObjectKeys(raw []byte) (map[string]string, error) {
	// Fast path: the canonical scalar encoding.
	var scalar map[string]string
	if err := json.Unmarshal(raw, &scalar); err == nil {
		return scalar, nil
	}
	// Tolerant path: legacy array encoding, flatten to the first element.
	var arrays map[string][]string
	if err := json.Unmarshal(raw, &arrays); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(arrays))
	for site, vals := range arrays {
		if len(vals) == 0 {
			continue
		}
		out[site] = vals[0]
	}
	return out, nil
}

// PromotionSafety is the non-data-fidelity safety state that must be true
// before a recovery point can be pinned for failover or restored into
// production. It deliberately lives with the repository because it is assembled
// from multiple DR-owned tables (recovery_point, dr_cleanroom_scan,
// dr_ransomware_signals, group membership, and streams) on the system path.
type PromotionSafety struct {
	TenantID                  string
	GroupID                   string
	CleanroomScanFound        bool
	CleanroomVerdict          string
	RansomwareBlockingSignals int
}

// CleanroomClean reports whether the latest recorded clean-room verdict allows
// promotion. Missing verdicts are not clean: the point has not been proven safe
// in quarantine yet.
func (s PromotionSafety) CleanroomClean() bool {
	return s.CleanroomScanFound && s.CleanroomVerdict == "clean"
}

// RansomwareClear reports whether no confirmed ransomware signal blocks this
// point. Blocking signals are confirmed anomalies on member streams observed at
// or before the recovery point was sealed, unless the signal specifically
// curated this point as the clean recovery target.
func (s PromotionSafety) RansomwareClear() bool {
	return s.RansomwareBlockingSignals == 0
}

// Safe reports whether all non-data-fidelity promotion gates pass.
func (s PromotionSafety) Safe() bool {
	return s.CleanroomClean() && s.RansomwareClear()
}

// BlockReason is a compact operator-facing reason for a failed promotion gate.
func (s PromotionSafety) BlockReason() string {
	switch {
	case !s.CleanroomScanFound:
		return "clean-room scan is required before recovery-point promotion"
	case !s.CleanroomClean():
		return fmt.Sprintf("latest clean-room verdict is %q", s.CleanroomVerdict)
	case !s.RansomwareClear():
		return fmt.Sprintf("%d confirmed ransomware signal(s) block this recovery point", s.RansomwareBlockingSignals)
	default:
		return ""
	}
}

// Detail renders the safety state into a stable failover_step JSON shape.
func (s PromotionSafety) Detail() map[string]any {
	return map[string]any{
		"cleanroom_scan_found":        s.CleanroomScanFound,
		"cleanroom_verdict":           s.CleanroomVerdict,
		"cleanroom_clean":             s.CleanroomClean(),
		"ransomware_clear":            s.RansomwareClear(),
		"ransomware_blocking_signals": s.RansomwareBlockingSignals,
		"promotion_safe":              s.Safe(),
	}
}

const systemRecoveryPointPromotionSafetySQL = `
WITH rp AS (
    SELECT id, tenant_id, group_id, sealed_at
      FROM recovery_point
     WHERE id = $1
),
latest_scan AS (
    SELECT cs.verdict
      FROM dr_cleanroom_scan cs
      JOIN rp ON rp.id = cs.recovery_point_id AND rp.tenant_id = cs.tenant_id
     ORDER BY cs.finished_at DESC, cs.id DESC
     LIMIT 1
),
blocking_ransomware AS (
    SELECT count(*)::int AS n
      FROM dr_ransomware_signals sig
      JOIN rp ON rp.tenant_id = sig.tenant_id
      JOIN replication_stream rs ON rs.id = sig.stream_id AND rs.tenant_id = sig.tenant_id
      JOIN consistency_group_member cgm ON cgm.site_id = rs.site_id AND cgm.group_id = rp.group_id
     WHERE sig.severity = 'confirmed'
       AND sig.observed_at <= rp.sealed_at
       AND (sig.curated_recovery_point_id IS NULL OR sig.curated_recovery_point_id <> rp.id)
)
SELECT rp.tenant_id::text,
       rp.group_id::text,
       EXISTS (SELECT 1 FROM latest_scan),
       COALESCE((SELECT verdict FROM latest_scan), ''),
       COALESCE((SELECT n FROM blocking_ransomware), 0)
  FROM rp`

// SystemRecoveryPointPromotionSafety loads the load-bearing safety gates for a
// recovery point WITHOUT a tenant filter. It is for leader-singleton failover
// paths only: Gate 1 uses it before pinning and Gate 3 re-checks it before
// restoring bytes into production.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemRecoveryPointPromotionSafety(ctx context.Context, db DBTX, recoveryPointID string) (PromotionSafety, error) {
	var safety PromotionSafety
	err := db.QueryRow(ctx, systemRecoveryPointPromotionSafetySQL, recoveryPointID).Scan(
		&safety.TenantID,
		&safety.GroupID,
		&safety.CleanroomScanFound,
		&safety.CleanroomVerdict,
		&safety.RansomwareBlockingSignals,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PromotionSafety{}, fmt.Errorf("recovery point %s: %w", recoveryPointID, model.ErrNotFound)
		}
		return PromotionSafety{}, fmt.Errorf("system loading recovery-point promotion safety %s: %w", recoveryPointID, err)
	}
	return safety, nil
}

const setRecoveryPointValidationSQL = `
UPDATE recovery_point SET validation_ratio = $3, is_validated = $4
WHERE tenant_id = $1 AND id = $2`

// SetRecoveryPointValidation records a validation result on a recovery point.
func (r *Repository) SetRecoveryPointValidation(ctx context.Context, db DBTX, tenantID, id string, ratio float64, validated bool) error {
	tag, err := db.Exec(ctx, setRecoveryPointValidationSQL, tenantID, id, ratio, validated)
	if err != nil {
		return fmt.Errorf("setting recovery-point validation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("recovery point %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const setRecoveryPointLegalHoldSQL = `
UPDATE recovery_point SET legal_hold = $3
WHERE tenant_id = $1 AND id = $2`

// SetRecoveryPointLegalHold toggles the ransomware-safe legal-hold flag on a
// recovery-point row, mirroring the object-lock legal-hold we set on the WORM
// objects (§5). legal_hold is outside the immutability trigger's frozen set, so
// it can move held -> released as a newer validated point supersedes it.
func (r *Repository) SetRecoveryPointLegalHold(ctx context.Context, db DBTX, tenantID, id string, hold bool) error {
	tag, err := db.Exec(ctx, setRecoveryPointLegalHoldSQL, tenantID, id, hold)
	if err != nil {
		return fmt.Errorf("setting recovery-point legal hold: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("recovery point %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const reconcileRecoveryPointLegalHoldsSQL = `
WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY sealed_at DESC, id DESC) AS rn
    FROM recovery_point
    WHERE tenant_id = $1 AND group_id = $2 AND is_validated = true
),
held AS (
    SELECT id FROM ranked WHERE rn <= $3
)
UPDATE recovery_point rp
SET legal_hold = EXISTS (SELECT 1 FROM held WHERE held.id = rp.id)
WHERE rp.tenant_id = $1 AND rp.group_id = $2`

// ReconcileRecoveryPointLegalHolds enforces the ransomware-safe floor for a
// consistency group: only the newest keepCount validated recovery points carry
// legal hold; superseded or invalidated points are released for normal retention
// lifecycle processing.
func (r *Repository) ReconcileRecoveryPointLegalHolds(ctx context.Context, db DBTX, tenantID, groupID string, keepCount int) error {
	if keepCount < 0 {
		keepCount = 0
	}
	if _, err := db.Exec(ctx, reconcileRecoveryPointLegalHoldsSQL, tenantID, groupID, keepCount); err != nil {
		return fmt.Errorf("reconciling recovery-point legal holds: %w", err)
	}
	return nil
}

// --- Network mappings -----------------------------------------------------

const insertNetworkMappingSQL = `
INSERT INTO network_mapping (tenant_id, group_id, profile, primary_cidr, recovery_cidr)
VALUES ($1, $2, $3, $4, $5)
RETURNING id`

// CreateNetworkMapping inserts a primary->recovery mapping for a group.
func (r *Repository) CreateNetworkMapping(ctx context.Context, db DBTX, m *model.NetworkMapping) error {
	if m.Profile == "" {
		m.Profile = model.NetworkProfileProduction
	}
	err := db.QueryRow(ctx, insertNetworkMappingSQL, m.TenantID, m.GroupID, m.Profile, m.PrimaryCIDR, m.RecoveryCIDR).Scan(&m.ID)
	if err != nil {
		return fmt.Errorf("creating network mapping: %w", err)
	}
	return nil
}

const listNetworkMappingsSQL = `
SELECT id, tenant_id, group_id, profile, primary_cidr, recovery_cidr
FROM network_mapping WHERE tenant_id = $1 AND group_id = $2 ORDER BY profile, primary_cidr`

// ListNetworkMappings returns a group's network mappings.
func (r *Repository) ListNetworkMappings(ctx context.Context, db DBTX, tenantID, groupID string) ([]*model.NetworkMapping, error) {
	rows, err := db.Query(ctx, listNetworkMappingsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing network mappings: %w", err)
	}
	defer rows.Close()

	var mappings []*model.NetworkMapping
	for rows.Next() {
		var m model.NetworkMapping
		if err := rows.Scan(&m.ID, &m.TenantID, &m.GroupID, &m.Profile, &m.PrimaryCIDR, &m.RecoveryCIDR); err != nil {
			return nil, fmt.Errorf("scanning network mapping: %w", err)
		}
		mappings = append(mappings, &m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading network mappings: %w", err)
	}
	return mappings, nil
}

// --- Recovery targets -----------------------------------------------------

const upsertRecoveryTargetSQL = `
INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (group_id, site_id) DO UPDATE SET
    boot_order = EXCLUDED.boot_order,
    recovery_endpoint = EXCLUDED.recovery_endpoint,
    health_probe = EXCLUDED.health_probe,
    updated_at = now()
RETURNING id, created_at, updated_at`

// UpsertRecoveryTarget creates or re-configures a recovery target for a group
// member (its boot order, recovery endpoint, and workload health probe, §6.3).
func (r *Repository) UpsertRecoveryTarget(ctx context.Context, db DBTX, t *model.RecoveryTarget) error {
	probeJSON, err := json.Marshal(t.HealthProbe)
	if err != nil {
		return fmt.Errorf("marshaling health probe: %w", err)
	}
	err = db.QueryRow(ctx, upsertRecoveryTargetSQL,
		t.TenantID, t.GroupID, t.SiteID, t.BootOrder, t.RecoveryEndpoint, probeJSON,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upserting recovery target: %w", err)
	}
	return nil
}

const recoveryTargetColumns = `
id, tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe, created_at, updated_at`

func scanRecoveryTarget(row scanRows) (*model.RecoveryTarget, error) {
	var t model.RecoveryTarget
	var endpoint sql.NullString
	var probeJSON []byte
	if err := row.Scan(
		&t.ID, &t.TenantID, &t.GroupID, &t.SiteID, &t.BootOrder,
		&endpoint, &probeJSON, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	t.RecoveryEndpoint = optionalString(endpoint)
	if len(probeJSON) > 0 {
		if err := json.Unmarshal(probeJSON, &t.HealthProbe); err != nil {
			return nil, fmt.Errorf("unmarshaling health probe: %w", err)
		}
	}
	return &t, nil
}

var listRecoveryTargetsByGroupSQL = `SELECT ` + recoveryTargetColumns + `
FROM recovery_target WHERE tenant_id = $1 AND group_id = $2 ORDER BY boot_order, site_id`

// ListRecoveryTargetsByGroup returns a group's recovery targets in boot order
// (the order the recovery executor boots them, §6.3). Tenant-scoped.
func (r *Repository) ListRecoveryTargetsByGroup(ctx context.Context, db DBTX, tenantID, groupID string) ([]*model.RecoveryTarget, error) {
	rows, err := db.Query(ctx, listRecoveryTargetsByGroupSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("listing recovery targets: %w", err)
	}
	defer rows.Close()
	return scanRecoveryTargets(rows)
}

func scanRecoveryTargets(rows pgx.Rows) ([]*model.RecoveryTarget, error) {
	var targets []*model.RecoveryTarget
	for rows.Next() {
		t, err := scanRecoveryTarget(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning recovery target: %w", err)
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading recovery targets: %w", err)
	}
	return targets, nil
}

var systemListRecoveryTargetsByGroupSQL = `SELECT ` + recoveryTargetColumns + `
FROM recovery_target WHERE group_id = $1 ORDER BY boot_order, site_id`

// SystemListRecoveryTargetsByGroup returns a group's recovery targets in boot
// order WITHOUT a tenant filter, for the leader-singleton failover.Driver which
// claims runs across all tenants and must boot their members.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton recovery executor (driven by failover.Driver) may call
// this; never the request path.
func (r *Repository) SystemListRecoveryTargetsByGroup(ctx context.Context, db DBTX, groupID string) ([]*model.RecoveryTarget, error) {
	rows, err := db.Query(ctx, systemListRecoveryTargetsByGroupSQL, groupID)
	if err != nil {
		return nil, fmt.Errorf("system listing recovery targets: %w", err)
	}
	defer rows.Close()
	return scanRecoveryTargets(rows)
}

var systemListNetworkMappingsByGroupSQL = `
SELECT id, tenant_id, group_id, profile, primary_cidr, recovery_cidr
FROM network_mapping WHERE group_id = $1 AND profile = $2 ORDER BY primary_cidr`

// SystemListNetworkMappingsByProfile returns a group's network mappings for one
// profile (production|isolated) WITHOUT a tenant filter, for the recovery
// executor running under the leader-singleton driver.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemListNetworkMappingsByProfile(ctx context.Context, db DBTX, groupID, profile string) ([]*model.NetworkMapping, error) {
	rows, err := db.Query(ctx, systemListNetworkMappingsByGroupSQL, groupID, profile)
	if err != nil {
		return nil, fmt.Errorf("system listing network mappings: %w", err)
	}
	defer rows.Close()

	var mappings []*model.NetworkMapping
	for rows.Next() {
		var m model.NetworkMapping
		if err := rows.Scan(&m.ID, &m.TenantID, &m.GroupID, &m.Profile, &m.PrimaryCIDR, &m.RecoveryCIDR); err != nil {
			return nil, fmt.Errorf("scanning network mapping: %w", err)
		}
		mappings = append(mappings, &m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading network mappings: %w", err)
	}
	return mappings, nil
}

const systemSelectStreamBySiteSQL = `
SELECT id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at, last_error, created_at, updated_at
FROM replication_stream WHERE site_id = $1`

// SystemGetStreamBySite loads the (unique) replication stream for a protected
// site WITHOUT a tenant filter, for the recovery executor under the
// leader-singleton driver. It maps a consistency-group member (a site) to the
// stream whose sealed recovery-point chunk must be restored.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemGetStreamBySite(ctx context.Context, db DBTX, siteID string) (*model.ReplicationStream, error) {
	var s model.ReplicationStream
	var sourceLSN, lastError sql.NullString
	var appliedAt sql.NullTime
	err := db.QueryRow(ctx, systemSelectStreamBySiteSQL, siteID).Scan(
		&s.ID, &s.TenantID, &s.SiteID, &s.Status, &s.AppliedSeq,
		&sourceLSN, &appliedAt, &lastError, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("stream for site %s: %w", siteID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("system loading stream for site %s: %w", siteID, err)
	}
	s.SourceLSN = optionalString(sourceLSN)
	s.AppliedAt = optionalTime(appliedAt)
	s.LastError = optionalString(lastError)
	return &s, nil
}

const systemLatestValidatedRecoveryPointSQL = `
SELECT id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, sealed_at, retention_until
FROM recovery_point WHERE group_id = $1 AND is_validated = true ORDER BY sealed_at DESC LIMIT 1`

// SystemLatestValidatedRecoveryPoint returns the newest VALIDATED recovery point
// for a group WITHOUT a tenant filter, for the recovery executor under the
// leader-singleton driver. When a run pins a recovery point at Gate 1, the
// driver uses the pinned point instead; this is the fallback selection.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemLatestValidatedRecoveryPoint(ctx context.Context, db DBTX, groupID string) (*model.RecoveryPoint, error) {
	rp, err := scanRecoveryPoint(db.QueryRow(ctx, systemLatestValidatedRecoveryPointSQL, groupID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("validated recovery point for group %s: %w", groupID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("system loading validated recovery point: %w", err)
	}
	return rp, nil
}

const systemGetRecoveryPointSQL = `
SELECT id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, validation_ratio, is_validated, legal_hold, sealed_at, retention_until
FROM recovery_point WHERE id = $1`

// SystemGetRecoveryPoint loads one recovery point by id WITHOUT a tenant filter,
// for the recovery executor and attestation engine under the leader-singleton
// driver (they read the run's pinned recovery point across tenants).
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemGetRecoveryPoint(ctx context.Context, db DBTX, id string) (*model.RecoveryPoint, error) {
	rp, err := scanRecoveryPoint(db.QueryRow(ctx, systemGetRecoveryPointSQL, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("recovery point %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("system loading recovery point %s: %w", id, err)
	}
	return rp, nil
}

const systemListFailoverStepsSQL = `
SELECT id, run_id, step, status, detail, started_at, finished_at
FROM failover_step WHERE run_id = $1 ORDER BY started_at`

// SystemListFailoverSteps returns a run's step timeline WITHOUT a tenant filter,
// for the recovery executor (idempotent re-claim: read prior step outcomes) and
// the attestation engine (timeline assembly) under the leader-singleton driver.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemListFailoverSteps(ctx context.Context, db DBTX, runID string) ([]*model.FailoverStep, error) {
	rows, err := db.Query(ctx, systemListFailoverStepsSQL, runID)
	if err != nil {
		return nil, fmt.Errorf("system listing failover steps: %w", err)
	}
	defer rows.Close()

	var steps []*model.FailoverStep
	for rows.Next() {
		var s model.FailoverStep
		var detailJSON []byte
		if err := rows.Scan(&s.ID, &s.RunID, &s.Step, &s.Status, &detailJSON, &s.StartedAt, &s.FinishedAt); err != nil {
			return nil, fmt.Errorf("scanning failover step: %w", err)
		}
		if len(detailJSON) > 0 {
			if err := json.Unmarshal(detailJSON, &s.Detail); err != nil {
				return nil, fmt.Errorf("unmarshaling step detail: %w", err)
			}
		}
		steps = append(steps, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading failover steps: %w", err)
	}
	return steps, nil
}

const systemLatestAttestationForGroupSQL = `
SELECT a.content_hash
FROM attestation a
JOIN failover_run f ON f.id = a.run_id
WHERE f.group_id = $1
ORDER BY a.created_at DESC
LIMIT 1`

// SystemLatestAttestationHash returns the content hash of the most recent
// attestation for a group (for the local hash chain: a new attestation chains
// to its predecessor), WITHOUT a tenant filter. Empty string when none exists.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemLatestAttestationHash(ctx context.Context, db DBTX, groupID string) (string, error) {
	var hash string
	err := db.QueryRow(ctx, systemLatestAttestationForGroupSQL, groupID).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("system loading latest attestation hash: %w", err)
	}
	return hash, nil
}

// --- Failover runs + steps ------------------------------------------------

const insertFailoverRunSQL = `
INSERT INTO failover_run (tenant_id, group_id, mode, status, recovery_point_id, rto_objective_seconds, initiated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, initiated_at, updated_at`

// CreateFailoverRun starts a gated failover/drill run.
func (r *Repository) CreateFailoverRun(ctx context.Context, db DBTX, run *model.FailoverRun) error {
	if run.Status == "" {
		run.Status = model.StatusInitiated
	}
	err := db.QueryRow(ctx, insertFailoverRunSQL,
		run.TenantID, run.GroupID, run.Mode, run.Status, run.RecoveryPointID,
		run.RTOObjectiveSeconds, run.InitiatedBy,
	).Scan(&run.ID, &run.InitiatedAt, &run.UpdatedAt)
	if err != nil {
		return fmt.Errorf("creating failover run: %w", err)
	}
	return nil
}

const failoverRunColumns = `
id, tenant_id, group_id, mode, status, recovery_point_id, rto_objective_seconds,
initiated_by, approved_by, initiated_at, completed_at, rto_actual_seconds,
last_error, claimed_at, updated_at`

func scanFailoverRun(row scanRows) (*model.FailoverRun, error) {
	var run model.FailoverRun
	var recoveryPointID, approvedBy, lastError sql.NullString
	var completedAt, claimedAt sql.NullTime
	var rtoActualSeconds sql.NullInt64
	if err := row.Scan(
		&run.ID, &run.TenantID, &run.GroupID, &run.Mode, &run.Status,
		&recoveryPointID, &run.RTOObjectiveSeconds, &run.InitiatedBy,
		&approvedBy, &run.InitiatedAt, &completedAt, &rtoActualSeconds,
		&lastError, &claimedAt, &run.UpdatedAt,
	); err != nil {
		return nil, err
	}
	run.RecoveryPointID = optionalString(recoveryPointID)
	run.ApprovedBy = optionalString(approvedBy)
	run.CompletedAt = optionalTime(completedAt)
	run.RTOActualSeconds = optionalInt(rtoActualSeconds)
	run.LastError = optionalString(lastError)
	run.ClaimedAt = optionalTime(claimedAt)
	return &run, nil
}

var selectFailoverRunSQL = `SELECT ` + failoverRunColumns + `
FROM failover_run WHERE tenant_id = $1 AND id = $2`

// GetFailoverRun loads one run scoped to the tenant.
func (r *Repository) GetFailoverRun(ctx context.Context, db DBTX, tenantID, id string) (*model.FailoverRun, error) {
	run, err := scanFailoverRun(db.QueryRow(ctx, selectFailoverRunSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failover run %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading failover run %s: %w", id, err)
	}
	return run, nil
}

var systemSelectFailoverRunSQL = `SELECT ` + failoverRunColumns + `
FROM failover_run WHERE id = $1`

// SystemGetFailoverRun loads one run by id WITHOUT a tenant filter, for the
// leader-singleton failover.Driver and its collaborators (recovery executor /
// drill teardown) which operate across tenants.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemGetFailoverRun(ctx context.Context, db DBTX, id string) (*model.FailoverRun, error) {
	run, err := scanFailoverRun(db.QueryRow(ctx, systemSelectFailoverRunSQL, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failover run %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("system loading failover run %s: %w", id, err)
	}
	return run, nil
}

var listFailoverRunsSQL = `SELECT ` + failoverRunColumns + `
FROM failover_run WHERE tenant_id = $1 ORDER BY initiated_at DESC`

// ListFailoverRuns returns all runs for the tenant, newest first.
func (r *Repository) ListFailoverRuns(ctx context.Context, db DBTX, tenantID string) ([]*model.FailoverRun, error) {
	rows, err := db.Query(ctx, listFailoverRunsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing failover runs: %w", err)
	}
	defer rows.Close()

	var runs []*model.FailoverRun
	for rows.Next() {
		run, err := scanFailoverRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning failover run: %w", err)
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading failover runs: %w", err)
	}
	return runs, nil
}

const failoverApprovalOperation = "failover"

const selectFailoverApprovalPolicySQL = `
SELECT id, tenant_id, operation, mode, quorum, require_reason, prevent_initiator_approval,
       require_step_up, step_up_max_age_seconds, allow_break_glass,
       break_glass_requires_reason, break_glass_requires_step_up, break_glass_min_approvers,
       created_at, updated_at
FROM dr_approval_policy
WHERE tenant_id = $1 AND operation = $2 AND mode = $3`

// GetFailoverApprovalPolicy loads the tenant policy override for a failover mode.
func (r *Repository) GetFailoverApprovalPolicy(ctx context.Context, db DBTX, tenantID, mode string) (*model.ApprovalPolicy, error) {
	var p model.ApprovalPolicy
	err := db.QueryRow(ctx, selectFailoverApprovalPolicySQL, tenantID, failoverApprovalOperation, mode).Scan(
		&p.ID, &p.TenantID, &p.Operation, &p.Mode, &p.Quorum, &p.RequireReason, &p.PreventInitiatorApproval,
		&p.RequireStepUp, &p.StepUpMaxAgeSeconds, &p.AllowBreakGlass,
		&p.BreakGlassRequiresReason, &p.BreakGlassRequiresStepUp, &p.BreakGlassMinApprovers,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if isNoRows(err) {
			return nil, fmt.Errorf("approval policy %s/%s: %w", failoverApprovalOperation, mode, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading failover approval policy: %w", err)
	}
	return &p, nil
}

const selectFailoverApprovalByApproverSQL = `
SELECT id, tenant_id, run_id, approver_id, decision, reason, break_glass, step_up_verified_at, decided_at
FROM dr_failover_approval
WHERE tenant_id = $1 AND run_id = $2 AND approver_id = $3`

func scanFailoverApproval(row scanRows) (*model.FailoverApproval, error) {
	var a model.FailoverApproval
	var stepUpVerifiedAt sql.NullTime
	if err := row.Scan(
		&a.ID, &a.TenantID, &a.RunID, &a.ApproverID, &a.Decision, &a.Reason,
		&a.BreakGlass, &stepUpVerifiedAt, &a.DecidedAt,
	); err != nil {
		return nil, err
	}
	a.StepUpVerifiedAt = optionalTime(stepUpVerifiedAt)
	return &a, nil
}

// GetFailoverApprovalByApprover returns an existing immutable approval
// submission for duplicate/idempotent approval attempts.
func (r *Repository) GetFailoverApprovalByApprover(ctx context.Context, db DBTX, tenantID, runID, approverID string) (*model.FailoverApproval, error) {
	approval, err := scanFailoverApproval(db.QueryRow(ctx, selectFailoverApprovalByApproverSQL, tenantID, runID, approverID))
	if err != nil {
		if isNoRows(err) {
			return nil, fmt.Errorf("failover approval %s/%s: %w", runID, approverID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading failover approval: %w", err)
	}
	return approval, nil
}

const insertFailoverApprovalSQL = `
INSERT INTO dr_failover_approval
    (tenant_id, run_id, approver_id, decision, reason, break_glass, step_up_verified_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (tenant_id, run_id, approver_id) DO NOTHING
RETURNING id, decided_at`

// CreateFailoverApproval appends one approval submission. Duplicate approvers
// return the existing row with inserted=false.
func (r *Repository) CreateFailoverApproval(ctx context.Context, db DBTX, approval *model.FailoverApproval) (bool, error) {
	err := db.QueryRow(ctx, insertFailoverApprovalSQL,
		approval.TenantID, approval.RunID, approval.ApproverID, approval.Decision,
		approval.Reason, approval.BreakGlass, approval.StepUpVerifiedAt,
	).Scan(&approval.ID, &approval.DecidedAt)
	if err == nil {
		return true, nil
	}
	if !isNoRows(err) {
		return false, fmt.Errorf("creating failover approval: %w", err)
	}
	existing, err := r.GetFailoverApprovalByApprover(ctx, db, approval.TenantID, approval.RunID, approval.ApproverID)
	if err != nil {
		return false, err
	}
	*approval = *existing
	return false, nil
}

const countFailoverApprovalsSQL = `
SELECT count(*)
FROM dr_failover_approval
WHERE tenant_id = $1 AND run_id = $2 AND decision = $3`

// CountFailoverApprovals returns the number of submissions for a decision.
func (r *Repository) CountFailoverApprovals(ctx context.Context, db DBTX, tenantID, runID, decision string) (int, error) {
	var count int
	if err := db.QueryRow(ctx, countFailoverApprovalsSQL, tenantID, runID, decision).Scan(&count); err != nil {
		return 0, fmt.Errorf("counting failover approvals: %w", err)
	}
	return count, nil
}

const insertBreakGlassEventSQL = `
INSERT INTO dr_break_glass_event (tenant_id, run_id, approval_id, actor_id, reason_hash)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (tenant_id, approval_id) DO NOTHING
RETURNING id, recorded_at`

// CreateBreakGlassEvent appends the emergency override ledger row for a
// break-glass approval. Duplicate approval submissions are idempotent.
func (r *Repository) CreateBreakGlassEvent(ctx context.Context, db DBTX, event *model.BreakGlassEvent) (bool, error) {
	err := db.QueryRow(ctx, insertBreakGlassEventSQL,
		event.TenantID, event.RunID, event.ApprovalID, event.ActorID, event.ReasonHash,
	).Scan(&event.ID, &event.RecordedAt)
	if err == nil {
		return true, nil
	}
	if isNoRows(err) {
		return false, nil
	}
	return false, fmt.Errorf("creating break-glass event: %w", err)
}

const updateFailoverRunStatusSQL = `
UPDATE failover_run
SET status = $3, last_error = $4, updated_at = now()
WHERE id = $2 AND tenant_id = $1 AND status = $5`

// UpdateFailoverRunStatus performs a guarded FSM transition: it advances only
// when the row is still in expectedStatus, so a concurrent transition is a
// no-op (the WHERE guard from §6.2 — e.g. /approve guarding AWAITING_APPROVAL).
// Returns ErrInvalidState when the guard does not match (and the row exists).
func (r *Repository) UpdateFailoverRunStatus(ctx context.Context, db DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error {
	tag, err := db.Exec(ctx, updateFailoverRunStatusSQL, tenantID, id, newStatus, lastError, expectedStatus)
	if err != nil {
		return fmt.Errorf("updating failover run status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failover run %s not in expected state %s: %w", id, expectedStatus, model.ErrInvalidState)
	}
	return nil
}

const completeFailoverRunSQL = `
UPDATE failover_run
SET status = $3, completed_at = now(),
    rto_actual_seconds = EXTRACT(EPOCH FROM (now() - initiated_at))::INT,
    updated_at = now()
WHERE id = $2 AND tenant_id = $1`

// CompleteFailoverRun marks a run terminal and stamps the achieved RTO.
func (r *Repository) CompleteFailoverRun(ctx context.Context, db DBTX, tenantID, id, finalStatus string) error {
	tag, err := db.Exec(ctx, completeFailoverRunSQL, tenantID, id, finalStatus)
	if err != nil {
		return fmt.Errorf("completing failover run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failover run %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const completeFailoverRunFromStatusSQL = `
UPDATE failover_run
SET status = $3, last_error = $4, completed_at = now(),
    rto_actual_seconds = EXTRACT(EPOCH FROM (now() - initiated_at))::INT,
    updated_at = now()
WHERE id = $2 AND tenant_id = $1 AND status = $5`

// CompleteFailoverRunFromStatus marks a run terminal only if the row is still
// in expectedStatus. This is the terminal-state counterpart to
// UpdateFailoverRunStatus, preserving the guarded FSM while stamping RTO.
func (r *Repository) CompleteFailoverRunFromStatus(ctx context.Context, db DBTX, tenantID, id, finalStatus, expectedStatus string, lastError *string) error {
	tag, err := db.Exec(ctx, completeFailoverRunFromStatusSQL, tenantID, id, finalStatus, lastError, expectedStatus)
	if err != nil {
		return fmt.Errorf("completing failover run from status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failover run %s not in expected state %s: %w", id, expectedStatus, model.ErrInvalidState)
	}
	return nil
}

const setFailoverApproverSQL = `
UPDATE failover_run SET approved_by = $3, status = $4, updated_at = now()
WHERE id = $2 AND tenant_id = $1 AND status = 'AWAITING_APPROVAL'`

// ApproveFailoverRun records the quorum-satisfying approver summary and
// transitions AWAITING_APPROVAL -> APPROVED only if still awaiting.
func (r *Repository) ApproveFailoverRun(ctx context.Context, db DBTX, tenantID, id, approvedBy string) error {
	tag, err := db.Exec(ctx, setFailoverApproverSQL, tenantID, id, approvedBy, model.StatusApproved)
	if err != nil {
		return fmt.Errorf("approving failover run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failover run %s not awaiting approval: %w", id, model.ErrInvalidState)
	}
	return nil
}

const pinRecoveryPointSQL = `
UPDATE failover_run SET recovery_point_id = $3, updated_at = now()
WHERE id = $2 AND tenant_id = $1`

// PinRecoveryPoint writes the recovery point validated at Gate 1 (§6.2); later
// ingest does not mutate it, so an arbitrarily long approval wait is safe.
func (r *Repository) PinRecoveryPoint(ctx context.Context, db DBTX, tenantID, id, recoveryPointID string) error {
	tag, err := db.Exec(ctx, pinRecoveryPointSQL, tenantID, id, recoveryPointID)
	if err != nil {
		return fmt.Errorf("pinning recovery point: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failover run %s: %w", id, model.ErrNotFound)
	}
	return nil
}

var systemClaimFailoverRunSQL = `
WITH claimable AS (
    SELECT id FROM failover_run
    WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED','AWAITING_APPROVAL','ROLLED_BACK')
    ORDER BY initiated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE failover_run f
SET claimed_at = now(), updated_at = now()
FROM claimable c
WHERE f.id = c.id
RETURNING ` + prefixed("f", failoverRunColumns)

// SystemClaimFailoverRun atomically claims the next advanceable run ACROSS ALL
// TENANTS for the failover Driver (FOR UPDATE SKIP LOCKED, §6.2). Returns
// (nil, nil) when there is nothing to claim.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton failover.Driver may call this; never the request path.
func (r *Repository) SystemClaimFailoverRun(ctx context.Context, db DBTX) (*model.FailoverRun, error) {
	run, err := scanFailoverRun(db.QueryRow(ctx, systemClaimFailoverRunSQL))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("system claiming failover run: %w", err)
	}
	return run, nil
}

const upsertFailoverStepSQL = `
INSERT INTO failover_step (run_id, step, status, detail, finished_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (run_id, step) DO UPDATE SET
    status = EXCLUDED.status,
    detail = EXCLUDED.detail,
    finished_at = EXCLUDED.finished_at
RETURNING id, started_at`

// UpsertFailoverStep records (or updates) a per-step audit/idempotency row. The
// UNIQUE (run_id, step) constraint makes a re-claim after crash idempotent
// (§6.2): the driver reads detail to decide a no-op vs a side-effecting step.
func (r *Repository) UpsertFailoverStep(ctx context.Context, db DBTX, step *model.FailoverStep) error {
	var detailJSON []byte
	if step.Detail != nil {
		b, err := json.Marshal(step.Detail)
		if err != nil {
			return fmt.Errorf("marshaling step detail: %w", err)
		}
		detailJSON = b
	}
	err := db.QueryRow(ctx, upsertFailoverStepSQL, step.RunID, step.Step, step.Status, detailJSON, step.FinishedAt).
		Scan(&step.ID, &step.StartedAt)
	if err != nil {
		return fmt.Errorf("upserting failover step %s: %w", step.Step, err)
	}
	return nil
}

const listFailoverStepsSQL = `
SELECT id, run_id, step, status, detail, started_at, finished_at
FROM failover_step WHERE run_id = $1 ORDER BY started_at`

// ListFailoverSteps returns a run's step timeline (used by the attestation and
// the GET /failover/{id} timeline).
func (r *Repository) ListFailoverSteps(ctx context.Context, db DBTX, runID string) ([]*model.FailoverStep, error) {
	rows, err := db.Query(ctx, listFailoverStepsSQL, runID)
	if err != nil {
		return nil, fmt.Errorf("listing failover steps: %w", err)
	}
	defer rows.Close()

	var steps []*model.FailoverStep
	for rows.Next() {
		var s model.FailoverStep
		var detailJSON []byte
		if err := rows.Scan(&s.ID, &s.RunID, &s.Step, &s.Status, &detailJSON, &s.StartedAt, &s.FinishedAt); err != nil {
			return nil, fmt.Errorf("scanning failover step: %w", err)
		}
		if len(detailJSON) > 0 {
			if err := json.Unmarshal(detailJSON, &s.Detail); err != nil {
				return nil, fmt.Errorf("unmarshaling step detail: %w", err)
			}
		}
		steps = append(steps, &s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading failover steps: %w", err)
	}
	return steps, nil
}

// --- Attestations ---------------------------------------------------------

const insertAttestationSQL = `
INSERT INTO attestation (tenant_id, run_id, rto_objective_seconds, rto_actual_seconds, rpo_seconds, validation_ratio, report_object_key, content_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at`

// CreateAttestation inserts the immutable Gate-4 attestation index row.
func (r *Repository) CreateAttestation(ctx context.Context, db DBTX, a *model.Attestation) error {
	err := db.QueryRow(ctx, insertAttestationSQL,
		a.TenantID, a.RunID, a.RTOObjectiveSeconds, a.RTOActualSeconds, a.RPOSeconds,
		a.ValidationRatio, a.ReportObjectKey, a.ContentHash,
	).Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("attestation for run %s: %w", a.RunID, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating attestation: %w", err)
	}
	return nil
}

const selectAttestationByRunSQL = `
SELECT id, tenant_id, run_id, rto_objective_seconds, rto_actual_seconds, rpo_seconds, validation_ratio, report_object_key, content_hash, created_at
FROM attestation WHERE tenant_id = $1 AND run_id = $2`

// GetAttestationByRun loads a run's attestation scoped to the tenant.
func (r *Repository) GetAttestationByRun(ctx context.Context, db DBTX, tenantID, runID string) (*model.Attestation, error) {
	var a model.Attestation
	err := db.QueryRow(ctx, selectAttestationByRunSQL, tenantID, runID).Scan(
		&a.ID, &a.TenantID, &a.RunID, &a.RTOObjectiveSeconds, &a.RTOActualSeconds,
		&a.RPOSeconds, &a.ValidationRatio, &a.ReportObjectKey, &a.ContentHash, &a.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("attestation for run %s: %w", runID, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading attestation for run %s: %w", runID, err)
	}
	return &a, nil
}

// --- DR agents ------------------------------------------------------------

const insertAgentSQL = `
INSERT INTO dr_agent (tenant_id, site_id, status)
VALUES ($1, $2, $3)
RETURNING id, created_at`

// CreateAgent inserts a provisioning DR agent record.
func (r *Repository) CreateAgent(ctx context.Context, db DBTX, a *model.DRAgent) error {
	if a.Status == "" {
		a.Status = model.AgentStatusProvisioning
	}
	err := db.QueryRow(ctx, insertAgentSQL, a.TenantID, a.SiteID, a.Status).Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		return fmt.Errorf("creating dr agent: %w", err)
	}
	return nil
}

const agentColumns = `
id, tenant_id, site_id, status, mtls_thumbprint, cert_serial, cert_issued_at,
cert_expires_at, cert_revoked_at, cert_revoked_reason, last_seen_at, created_at`

func scanAgent(row scanRows) (*model.DRAgent, error) {
	var a model.DRAgent
	if err := row.Scan(
		&a.ID, &a.TenantID, &a.SiteID, &a.Status, &a.MTLSThumbprint, &a.CertSerial,
		&a.CertIssuedAt, &a.CertExpiresAt, &a.CertRevokedAt, &a.CertRevokedReason,
		&a.LastSeenAt, &a.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &a, nil
}

var selectAgentSQL = `SELECT ` + agentColumns + `
FROM dr_agent WHERE tenant_id = $1 AND id = $2`

// GetAgent loads one DR agent scoped to the tenant.
func (r *Repository) GetAgent(ctx context.Context, db DBTX, tenantID, id string) (*model.DRAgent, error) {
	a, err := scanAgent(db.QueryRow(ctx, selectAgentSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("dr agent %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading dr agent %s: %w", id, err)
	}
	return a, nil
}

var listAgentsSQL = `SELECT ` + agentColumns + `
FROM dr_agent WHERE tenant_id = $1 ORDER BY created_at`

// ListAgents returns all DR agents for the tenant.
func (r *Repository) ListAgents(ctx context.Context, db DBTX, tenantID string) ([]*model.DRAgent, error) {
	rows, err := db.Query(ctx, listAgentsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing dr agents: %w", err)
	}
	defer rows.Close()

	var agents []*model.DRAgent
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning dr agent: %w", err)
		}
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading dr agents: %w", err)
	}
	return agents, nil
}

var selectAgentByThumbprintSQL = `SELECT ` + agentColumns + `
FROM dr_agent WHERE mtls_thumbprint = $1`

// GetAgentByThumbprint loads a DR agent by mTLS certificate thumbprint. This is
// used only by the dedicated mTLS ingest listener after TLS has verified the
// client certificate chain.
func (r *Repository) GetAgentByThumbprint(ctx context.Context, db DBTX, thumbprint string) (*model.DRAgent, error) {
	a, err := scanAgent(db.QueryRow(ctx, selectAgentByThumbprintSQL, thumbprint))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("dr agent thumbprint %s: %w", thumbprint, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading dr agent by thumbprint: %w", err)
	}
	return a, nil
}

const setAgentCertSQL = `
UPDATE dr_agent
SET status = $3, mtls_thumbprint = $4, cert_serial = $5,
    cert_issued_at = $6, cert_expires_at = $7
WHERE tenant_id = $1 AND id = $2`

// SetAgentCert records an issued leaf cert and activates the agent.
func (r *Repository) SetAgentCert(ctx context.Context, db DBTX, tenantID, id, status, thumbprint, serial string, issuedAt, expiresAt time.Time) error {
	tag, err := db.Exec(ctx, setAgentCertSQL, tenantID, id, status, thumbprint, serial, issuedAt, expiresAt)
	if err != nil {
		return fmt.Errorf("setting agent cert: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("dr agent %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const markAgentCertRevokedSQL = `
UPDATE dr_agent
SET status = $2, cert_revoked_at = now(), cert_revoked_reason = $3
WHERE id = $1`

// MarkAgentCertRevoked marks an agent certificate revoked without a tenant
// predicate. It is used by the background enrollment rotation worker after the
// overlap window elapses; request paths must not call it.
func (r *Repository) MarkAgentCertRevoked(ctx context.Context, db DBTX, id, reason string) error {
	tag, err := db.Exec(ctx, markAgentCertRevokedSQL, id, model.AgentStatusRevoked, reason)
	if err != nil {
		return fmt.Errorf("marking agent cert revoked: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("dr agent %s: %w", id, model.ErrNotFound)
	}
	return nil
}

const insertAgentCertRevocationSQL = `
INSERT INTO dr_agent_cert_revocation (thumbprint, agent_id, tenant_id, cert_serial, revoked_at, reason)
SELECT $1, a.id, a.tenant_id, $3, $4, $5
FROM dr_agent a
WHERE a.id = $2
ON CONFLICT (thumbprint) DO UPDATE
SET cert_serial = EXCLUDED.cert_serial,
    revoked_at = EXCLUDED.revoked_at,
    reason = EXCLUDED.reason`

// InsertAgentCertRevocation records a single certificate thumbprint on the DR
// mTLS denylist without disabling the whole agent row. This is used for
// rotation overlap expiry where only the retired leaf must stop authenticating.
func (r *Repository) InsertAgentCertRevocation(ctx context.Context, db DBTX, rv model.AgentCertRevocation) error {
	rv.Thumbprint = strings.TrimSpace(rv.Thumbprint)
	rv.AgentID = strings.TrimSpace(rv.AgentID)
	rv.CertSerial = strings.TrimSpace(rv.CertSerial)
	rv.Reason = strings.TrimSpace(rv.Reason)
	if rv.Thumbprint == "" {
		return fmt.Errorf("agent cert revocation: thumbprint is required")
	}
	if rv.AgentID == "" {
		return fmt.Errorf("agent cert revocation: agent_id is required")
	}
	if rv.Reason == "" {
		rv.Reason = "unspecified"
	}
	if rv.RevokedAt.IsZero() {
		rv.RevokedAt = time.Now().UTC()
	}
	tag, err := db.Exec(ctx, insertAgentCertRevocationSQL, rv.Thumbprint, rv.AgentID, rv.CertSerial, rv.RevokedAt, rv.Reason)
	if err != nil {
		return fmt.Errorf("inserting agent cert revocation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("dr agent %s: %w", rv.AgentID, model.ErrNotFound)
	}
	return nil
}

const listAgentCertRevocationsSinceSQL = `
SELECT thumbprint, agent_id, tenant_id, cert_serial, revoked_at, reason
FROM dr_agent_cert_revocation
WHERE revoked_at > $1
ORDER BY revoked_at ASC, thumbprint ASC`

// ListAgentCertRevocationsSince returns CRL entries newer than since.
func (r *Repository) ListAgentCertRevocationsSince(ctx context.Context, db DBTX, since time.Time) ([]model.AgentCertRevocation, error) {
	rows, err := db.Query(ctx, listAgentCertRevocationsSinceSQL, since)
	if err != nil {
		return nil, fmt.Errorf("listing agent cert revocations: %w", err)
	}
	defer rows.Close()

	out := []model.AgentCertRevocation{}
	for rows.Next() {
		var rv model.AgentCertRevocation
		if err := rows.Scan(&rv.Thumbprint, &rv.AgentID, &rv.TenantID, &rv.CertSerial, &rv.RevokedAt, &rv.Reason); err != nil {
			return nil, fmt.Errorf("scanning agent cert revocation: %w", err)
		}
		out = append(out, rv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading agent cert revocations: %w", err)
	}
	return out, nil
}

// prefixed rewrites a comma-separated column list to alias.column form for use
// in a RETURNING clause from an aliased UPDATE target.
func prefixed(alias, columns string) string {
	parts := strings.Split(columns, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, alias+"."+trimmed)
		}
	}
	return strings.Join(out, ", ")
}
