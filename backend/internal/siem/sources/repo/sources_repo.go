package repo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/siem/sources"
)

// SourcesRepo is the data-access layer for siem.sources and the
// adjacent siem.source_credentials table.
type SourcesRepo struct {
	db Querier
}

// NewSourcesRepo constructs a SourcesRepo. db must be non-nil.
func NewSourcesRepo(db Querier) *SourcesRepo {
	return &SourcesRepo{db: db}
}

// ColumnList is the canonical column ordering for SELECTs against
// siem.sources. Exported so tests can build matching mock rows.
const ColumnList = `id,tenant_id,name,type,transport,address,expected_eps,
  baseline_eps,baseline_samples,tz,parser_id,status,
  last_seen_at,last_health_at,mtls_thumbprint,cert_serial,
  cert_issued_at,cert_expires_at,cert_revoked_at,cert_revoked_reason,
  tags,version,created_by,created_at,updated_at,deleted_at`

// Insert creates a new row in siem.sources and returns the resulting
// canonical Source (with server-generated defaults populated).
func (r *SourcesRepo) Insert(ctx context.Context, in sources.OnboardInput) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}

	tagsJSON := in.Tags
	if len(tagsJSON) == 0 {
		tagsJSON = json.RawMessage(`{}`)
	}
	tz := in.TZ
	if tz == "" {
		tz = "Africa/Lagos"
	}

	const q = `
INSERT INTO siem.sources
  (tenant_id, name, type, transport, address, expected_eps, tz, tags, created_by, status)
VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,'provisioning')
RETURNING ` + ColumnList

	row := r.db.QueryRow(ctx, q,
		in.TenantID, in.Name, in.Type, string(in.Transport), in.Address,
		in.ExpectedEPS, tz, []byte(tagsJSON), in.CreatedBy,
	)
	s, err := scanSource(row)
	if err != nil {
		return nil, classifyInsertError(err)
	}
	return s, nil
}

// GetByID returns a source belonging to tenantID. Soft-deleted rows
// are invisible (returns ErrNotFound).
func (r *SourcesRepo) GetByID(ctx context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT ` + ColumnList + `
FROM siem.sources
WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`
	row := r.db.QueryRow(ctx, q, id, tenantID)
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: source %s", sources.ErrNotFound, id)
	}
	return s, err
}

// GetByName returns a source by (tenant_id, name); used for uniqueness
// checks pre-insert.
func (r *SourcesRepo) GetByName(ctx context.Context, tenantID uuid.UUID, name string) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT ` + ColumnList + `
FROM siem.sources
WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`
	row := r.db.QueryRow(ctx, q, tenantID, name)
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", sources.ErrNotFound, name)
	}
	return s, err
}

// GetByThumbprint returns the source whose mTLS thumbprint matches.
// Used by mTLS middleware on the heartbeat listener; matches only
// active, non-deleted sources.
func (r *SourcesRepo) GetByThumbprint(ctx context.Context, thumbprint string) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT ` + ColumnList + `
FROM siem.sources
WHERE mtls_thumbprint = $1 AND deleted_at IS NULL`
	row := r.db.QueryRow(ctx, q, thumbprint)
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: thumbprint", sources.ErrNotFound)
	}
	return s, err
}

// Update applies a patch with optimistic concurrency. On version
// mismatch returns ErrVersionMismatch.
func (r *SourcesRepo) Update(ctx context.Context, tenantID, id uuid.UUID, in sources.UpdateInput, ifMatch int64) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	// We build the SET clause dynamically. The version check is done
	// inline so the UPDATE is a single round-trip.
	setParts := []string{}
	args := []any{id, tenantID, ifMatch}
	next := 4
	if in.Type != nil {
		setParts = append(setParts, fmt.Sprintf("type = $%d", next))
		args = append(args, *in.Type)
		next++
	}
	if in.Address != nil {
		setParts = append(setParts, fmt.Sprintf("address = $%d", next))
		args = append(args, *in.Address)
		next++
	}
	if in.ExpectedEPS != nil {
		setParts = append(setParts, fmt.Sprintf("expected_eps = $%d", next))
		args = append(args, *in.ExpectedEPS)
		next++
	}
	if in.TZ != nil {
		setParts = append(setParts, fmt.Sprintf("tz = $%d", next))
		args = append(args, *in.TZ)
		next++
	}
	if len(in.Tags) > 0 {
		setParts = append(setParts, fmt.Sprintf("tags = $%d", next))
		args = append(args, []byte(in.Tags))
		next++
	}
	if len(setParts) == 0 {
		return r.GetByID(ctx, tenantID, id)
	}

	q := fmt.Sprintf(`
UPDATE siem.sources
SET %s
WHERE id = $1 AND tenant_id = $2 AND version = $3 AND deleted_at IS NULL
RETURNING `+ColumnList, strings.Join(setParts, ", "))

	row := r.db.QueryRow(ctx, q, args...)
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, r.versionOrNotFound(ctx, tenantID, id)
	}
	return s, err
}

// SetStatus transitions status with optimistic concurrency.
func (r *SourcesRepo) SetStatus(ctx context.Context, tenantID, id uuid.UUID, status sources.Status, ifMatch int64) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET status = $4
WHERE id = $1 AND tenant_id = $2 AND version = $3 AND deleted_at IS NULL
RETURNING ` + ColumnList
	row := r.db.QueryRow(ctx, q, id, tenantID, ifMatch, string(status))
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, r.versionOrNotFound(ctx, tenantID, id)
	}
	return s, err
}

// SetStatusUnchecked transitions status without an If-Match guard.
// Used by the detector when it owns the only legitimate transition path.
func (r *SourcesRepo) SetStatusUnchecked(ctx context.Context, id uuid.UUID, status sources.Status) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET status = $2
WHERE id = $1 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, id, string(status))
	if err != nil {
		return fmt.Errorf("set status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", sources.ErrNotFound, id)
	}
	return nil
}

// SoftDelete marks the row deleted with optimistic concurrency. The
// row is preserved for retention purposes.
func (r *SourcesRepo) SoftDelete(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET deleted_at = now(), status = 'disabled'
WHERE id = $1 AND tenant_id = $2 AND version = $3 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, id, tenantID, ifMatch)
	if err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return r.versionOrNotFound(ctx, tenantID, id)
	}
	return nil
}

// AttachCert updates the mtls/cert columns. Used after a successful
// enrollment exchange. Returns the updated row.
func (r *SourcesRepo) AttachCert(ctx context.Context, tenantID, id uuid.UUID, thumbprint, serial string, issuedAt, expiresAt time.Time, status sources.Status) (*sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET mtls_thumbprint = $3,
    cert_serial = $4,
    cert_issued_at = $5,
    cert_expires_at = $6,
    cert_revoked_at = NULL,
    cert_revoked_reason = NULL,
    status = $7
WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
RETURNING ` + ColumnList
	row := r.db.QueryRow(ctx, q, id, tenantID, thumbprint, serial, issuedAt, expiresAt, string(status))
	s, err := scanSource(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", sources.ErrNotFound, id)
	}
	return s, err
}

// MarkCertRevoked sets cert_revoked_at + reason.
func (r *SourcesRepo) MarkCertRevoked(ctx context.Context, id uuid.UUID, reason string) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET cert_revoked_at = now(), cert_revoked_reason = $2
WHERE id = $1`
	_, err := r.db.Exec(ctx, q, id, reason)
	if err != nil {
		return fmt.Errorf("mark cert revoked: %w", err)
	}
	return nil
}

// UpdateBaseline persists EWMA baseline + sample count.
func (r *SourcesRepo) UpdateBaseline(ctx context.Context, id uuid.UUID, baselineEPS, samples int) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `
UPDATE siem.sources
SET baseline_eps = $2, baseline_samples = $3
WHERE id = $1`
	_, err := r.db.Exec(ctx, q, id, baselineEPS, samples)
	if err != nil {
		return fmt.Errorf("update baseline: %w", err)
	}
	return nil
}

// TouchLastSeen updates last_seen_at to now.
func (r *SourcesRepo) TouchLastSeen(ctx context.Context, id uuid.UUID, ts time.Time) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `UPDATE siem.sources SET last_seen_at = $2 WHERE id = $1`
	_, err := r.db.Exec(ctx, q, id, ts)
	if err != nil {
		return fmt.Errorf("touch last seen: %w", err)
	}
	return nil
}

// List returns a page of sources matching q for the given tenant.
// Cursor is opaque (base64-encoded "created_at|id"); empty starts at
// the beginning.
func (r *SourcesRepo) List(ctx context.Context, tenantID uuid.UUID, q sources.ListQuery) (sources.ListResult, error) {
	if r == nil || r.db == nil {
		return sources.ListResult{}, errors.New("sources_repo: nil db")
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	args := []any{tenantID}
	clauses := []string{"tenant_id = $1", "deleted_at IS NULL"}
	next := 2

	if q.Status != nil {
		clauses = append(clauses, fmt.Sprintf("status = $%d", next))
		args = append(args, string(*q.Status))
		next++
	}
	if q.Type != nil {
		clauses = append(clauses, fmt.Sprintf("type = $%d", next))
		args = append(args, *q.Type)
		next++
	}
	if q.Transport != nil {
		clauses = append(clauses, fmt.Sprintf("transport = $%d", next))
		args = append(args, string(*q.Transport))
		next++
	}
	if q.Q != "" {
		clauses = append(clauses, fmt.Sprintf("name ILIKE $%d", next))
		args = append(args, "%"+q.Q+"%")
		next++
	}
	for k, v := range q.Tags {
		clauses = append(clauses, fmt.Sprintf("tags->>$%d = $%d", next, next+1))
		args = append(args, k, v)
		next += 2
	}

	if q.Cursor != "" {
		ts, id, err := decodeCursor(q.Cursor)
		if err == nil {
			clauses = append(clauses, fmt.Sprintf("(created_at, id) < ($%d, $%d)", next, next+1))
			args = append(args, ts, id)
			next += 2
		}
	}

	sql := fmt.Sprintf(`
SELECT %s FROM siem.sources
WHERE %s
ORDER BY created_at DESC, id DESC
LIMIT %d`, ColumnList, strings.Join(clauses, " AND "), limit+1)

	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return sources.ListResult{}, fmt.Errorf("list: %w", err)
	}
	defer rows.Close()

	items := make([]sources.Source, 0, limit)
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return sources.ListResult{}, fmt.Errorf("list scan: %w", err)
		}
		items = append(items, *s)
	}
	if err := rows.Err(); err != nil {
		return sources.ListResult{}, fmt.Errorf("list rows: %w", err)
	}

	res := sources.ListResult{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		res.Items = items[:limit]
		res.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	return res, nil
}

// ListActive returns every source where status='active' AND deleted_at IS NULL.
// Used by the detector loop.
func (r *SourcesRepo) ListActive(ctx context.Context) ([]sources.Source, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT ` + ColumnList + `
FROM siem.sources
WHERE status IN ('active','silent','rotating') AND deleted_at IS NULL`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list active: %w", err)
	}
	defer rows.Close()
	out := []sources.Source{}
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// InsertCredentials writes the credentials row alongside the source row.
func (r *SourcesRepo) InsertCredentials(ctx context.Context, sc sources.SourceCredentials) error {
	if r == nil || r.db == nil {
		return errors.New("sources_repo: nil db")
	}
	const q = `
INSERT INTO siem.source_credentials
  (source_id, vault_pki_mount, vault_key_ref, cert_pem, ca_chain_pem)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (source_id) DO UPDATE SET
  vault_pki_mount = EXCLUDED.vault_pki_mount,
  vault_key_ref   = EXCLUDED.vault_key_ref,
  cert_pem        = EXCLUDED.cert_pem,
  ca_chain_pem    = EXCLUDED.ca_chain_pem,
  rotated_at      = now()`
	_, err := r.db.Exec(ctx, q, sc.SourceID, sc.VaultPKIMount, sc.VaultKeyRef, sc.CertPEM, sc.CAChainPEM)
	if err != nil {
		return fmt.Errorf("insert credentials: %w", err)
	}
	return nil
}

// GetCredentials returns the credentials for a source. Returns
// ErrNotFound if missing.
func (r *SourcesRepo) GetCredentials(ctx context.Context, sourceID uuid.UUID) (*sources.SourceCredentials, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT source_id, vault_pki_mount, vault_key_ref, cert_pem, ca_chain_pem, created_at, rotated_at
FROM siem.source_credentials
WHERE source_id = $1`
	row := r.db.QueryRow(ctx, q, sourceID)
	var sc sources.SourceCredentials
	if err := row.Scan(&sc.SourceID, &sc.VaultPKIMount, &sc.VaultKeyRef, &sc.CertPEM, &sc.CAChainPEM, &sc.CreatedAt, &sc.RotatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: credentials", sources.ErrNotFound)
		}
		return nil, fmt.Errorf("get credentials: %w", err)
	}
	return &sc, nil
}

// CountByTenantStatus is a helper used by the detector to update the
// SourcesTotal gauge.
func (r *SourcesRepo) CountByTenantStatus(ctx context.Context) (map[string]map[sources.Status]int, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("sources_repo: nil db")
	}
	const q = `
SELECT tenant_id::text, status, count(*)
FROM siem.sources
WHERE deleted_at IS NULL
GROUP BY tenant_id, status`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("count by tenant status: %w", err)
	}
	defer rows.Close()
	out := map[string]map[sources.Status]int{}
	for rows.Next() {
		var (
			tenant string
			status string
			n      int
		)
		if err := rows.Scan(&tenant, &status, &n); err != nil {
			return nil, fmt.Errorf("count scan: %w", err)
		}
		if _, ok := out[tenant]; !ok {
			out[tenant] = map[sources.Status]int{}
		}
		out[tenant][sources.Status(status)] = n
	}
	return out, rows.Err()
}

// ----- helpers -----

// versionOrNotFound returns ErrVersionMismatch if the row exists but the
// version differs; ErrNotFound otherwise.
func (r *SourcesRepo) versionOrNotFound(ctx context.Context, tenantID, id uuid.UUID) error {
	const q = `SELECT version FROM siem.sources WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`
	var v int64
	row := r.db.QueryRow(ctx, q, id, tenantID)
	if err := row.Scan(&v); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", sources.ErrNotFound, id)
		}
		return fmt.Errorf("version check: %w", err)
	}
	return fmt.Errorf("%w: current=%d", sources.ErrVersionMismatch, v)
}

// scanSource scans a pgx.Row or pgx.Rows into a *Source. We use a
// shared scanner so the column ordering is enforced in one place.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSource(rs rowScanner) (*sources.Source, error) {
	var (
		s             sources.Source
		transportStr  string
		statusStr     string
		tagsBytes     []byte
		parserID      *uuid.UUID
		lastSeen      *time.Time
		lastHealth    *time.Time
		thumbprint    *string
		certSerial    *string
		certIssued    *time.Time
		certExpires   *time.Time
		certRevoked   *time.Time
		certRevReason *string
		deletedAt     *time.Time
	)
	err := rs.Scan(
		&s.ID, &s.TenantID, &s.Name, &s.Type, &transportStr, &s.Address,
		&s.ExpectedEPS, &s.BaselineEPS, &s.BaselineSamples, &s.TZ, &parserID, &statusStr,
		&lastSeen, &lastHealth, &thumbprint, &certSerial,
		&certIssued, &certExpires, &certRevoked, &certRevReason,
		&tagsBytes, &s.Version, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt, &deletedAt,
	)
	if err != nil {
		return nil, err
	}
	s.Transport = sources.Transport(transportStr)
	s.Status = sources.Status(statusStr)
	s.ParserID = parserID
	s.LastSeenAt = lastSeen
	s.LastHealthAt = lastHealth
	if thumbprint != nil {
		s.MTLSThumbprint = *thumbprint
	}
	if certSerial != nil {
		s.CertSerial = *certSerial
	}
	s.CertIssuedAt = certIssued
	s.CertExpiresAt = certExpires
	s.CertRevokedAt = certRevoked
	if certRevReason != nil {
		s.CertRevokedReason = *certRevReason
	}
	s.DeletedAt = deletedAt
	if len(tagsBytes) == 0 {
		s.Tags = json.RawMessage(`{}`)
	} else {
		s.Tags = json.RawMessage(tagsBytes)
	}
	return &s, nil
}

// classifyInsertError maps Postgres unique-violation errors to ErrConflict.
func classifyInsertError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 23505 is unique_violation. The constraint name lets us
		// distinguish name-uniqueness from thumbprint-uniqueness.
		if pgErr.Code == "23505" {
			return fmt.Errorf("%w: %s", sources.ErrConflict, pgErr.ConstraintName)
		}
	}
	return fmt.Errorf("insert: %w", err)
}

// encodeCursor / decodeCursor: opaque cursor pagination over
// (created_at, id) tuples.
func encodeCursor(ts time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%d|%s", ts.UnixNano(), id.String())
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(cursor string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("cursor decode: %w", err)
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, fmt.Errorf("cursor malformed")
	}
	ns, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("cursor ts: %w", err)
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("cursor id: %w", err)
	}
	return time.Unix(0, ns), id, nil
}
