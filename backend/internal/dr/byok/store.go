package byok

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists the BYOK custody chain (dr_tenant_kek, dr_wrapped_dek,
// dr_kek_custody_log). Every method takes a repository.DBTX — the same pgx subset
// the rest of dr_db uses — so a write runs inside the caller's tenant-scoped
// transaction (RLS active) or, for the rotation/rewrap loop, a system transaction
// (RLS bypassed). The DB rows are the custody ledger; the KeyProvider owns the
// KEK material.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// --- KEK versions ---------------------------------------------------------

const kekColumns = `
id, tenant_id, key_version, provider, reference, state,
created_at, activated_at, retired_at, updated_at`

const insertKEKSQL = `
INSERT INTO dr_tenant_kek (tenant_id, key_version, provider, reference, state, activated_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, created_at, updated_at`

// CreateKEK inserts a KEK version. When state is active the partial unique index
// uq_dr_tenant_kek_one_active rejects a second active version for the tenant
// (returned as ErrAlreadyEnrolled); a duplicate (tenant, version) is also a
// unique violation.
func (s *Store) CreateKEK(ctx context.Context, db repository.DBTX, k *TenantKEK) error {
	if k.State == "" {
		k.State = KEKStateActive
	}
	var activatedAt *time.Time
	if k.State == KEKStateActive {
		if k.ActivatedAt != nil {
			activatedAt = k.ActivatedAt
		} else {
			now := time.Now().UTC()
			activatedAt = &now
			k.ActivatedAt = &now
		}
	}
	err := db.QueryRow(ctx, insertKEKSQL,
		k.TenantID, k.KeyVersion, k.Provider, k.Reference, k.State, activatedAt,
	).Scan(&k.ID, &k.CreatedAt, &k.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("tenant %s version %d: %w", k.TenantID, k.KeyVersion, ErrAlreadyEnrolled)
		}
		return fmt.Errorf("byok: creating KEK version %d: %w", k.KeyVersion, err)
	}
	return nil
}

const selectActiveKEKSQL = `SELECT ` + kekColumns + `
FROM dr_tenant_kek WHERE tenant_id = $1 AND state = 'active'`

// GetActiveKEK returns the tenant's single active KEK version, or ErrNotEnrolled
// when none exists.
func (s *Store) GetActiveKEK(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error) {
	k, err := scanKEK(db.QueryRow(ctx, selectActiveKEKSQL, tenantID))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotEnrolled
	}
	return k, err
}

const selectActiveKEKSystemSQL = `SELECT ` + kekColumns + `
FROM dr_tenant_kek WHERE tenant_id = $1 AND state = 'active'`

// GetActiveKEKSystem is GetActiveKEK on the system (RLS-bypass) path for the loop.
func (s *Store) GetActiveKEKSystem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error) {
	k, err := scanKEK(db.QueryRow(ctx, selectActiveKEKSystemSQL, tenantID))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotEnrolled
	}
	return k, err
}

const selectKEKByVersionSQL = `SELECT ` + kekColumns + `
FROM dr_tenant_kek WHERE tenant_id = $1 AND key_version = $2`

// GetKEKByVersion returns a specific KEK version regardless of state.
func (s *Store) GetKEKByVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int) (*TenantKEK, error) {
	return scanKEK(db.QueryRow(ctx, selectKEKByVersionSQL, tenantID, version))
}

const listKEKsSQL = `SELECT ` + kekColumns + `
FROM dr_tenant_kek WHERE tenant_id = $1 ORDER BY key_version DESC`

// ListKEKs returns every KEK version for the tenant, newest first.
func (s *Store) ListKEKs(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*TenantKEK, error) {
	rows, err := db.Query(ctx, listKEKsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("byok: listing KEKs: %w", err)
	}
	defer rows.Close()
	var out []*TenantKEK
	for rows.Next() {
		k, serr := scanKEK(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("byok: iterating KEKs: %w", err)
	}
	return out, nil
}

const rotatingTenantsSystemSQL = `
SELECT DISTINCT tenant_id FROM dr_tenant_kek WHERE state = 'rotating'
ORDER BY tenant_id ASC
LIMIT $1`

// RotatingTenantsSystem returns up to limit tenant IDs that have a KEK version
// stuck in 'rotating' state — a rotation that began but did not complete (e.g. a
// crash). The recovery loop resumes these. System (RLS-bypass) path only.
func (s *Store) RotatingTenantsSystem(ctx context.Context, db repository.DBTX, limit int) ([]uuid.UUID, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := db.Query(ctx, rotatingTenantsSystemSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("byok: listing rotating tenants: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if serr := rows.Scan(&id); serr != nil {
			return nil, fmt.Errorf("byok: scanning rotating tenant: %w", serr)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("byok: iterating rotating tenants: %w", err)
	}
	return out, nil
}

const maxKEKVersionSQL = `
SELECT COALESCE(MAX(key_version), 0) FROM dr_tenant_kek WHERE tenant_id = $1`

// MaxKEKVersion returns the highest KEK version for the tenant (0 if none),
// used to compute the next version during enroll/rotate.
func (s *Store) MaxKEKVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int, error) {
	var v int
	if err := db.QueryRow(ctx, maxKEKVersionSQL, tenantID).Scan(&v); err != nil {
		return 0, fmt.Errorf("byok: reading max KEK version: %w", err)
	}
	return v, nil
}

const setKEKStateSQL = `
UPDATE dr_tenant_kek
   SET state = $3,
       activated_at = CASE WHEN $3 = 'active' AND activated_at IS NULL THEN now() ELSE activated_at END,
       retired_at   = CASE WHEN $3 = 'retired' THEN now() ELSE retired_at END,
       updated_at   = now()
 WHERE tenant_id = $1 AND key_version = $2`

// SetKEKState transitions a KEK version's state, stamping activated_at/retired_at
// as appropriate. Returns whether a row changed.
func (s *Store) SetKEKState(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int, state string) (bool, error) {
	tag, err := db.Exec(ctx, setKEKStateSQL, tenantID, version, state)
	if err != nil {
		return false, fmt.Errorf("byok: setting KEK %d state %s: %w", version, state, err)
	}
	return tag.RowsAffected() == 1, nil
}

// --- Wrapped DEKs ---------------------------------------------------------

const wrappedColumns = `
id, tenant_id, dek_id, kek_version, wrapped_dek, nonce,
created_at, rewrapped_at, updated_at`

const upsertWrappedDEKSQL = `
INSERT INTO dr_wrapped_dek (tenant_id, dek_id, kek_version, wrapped_dek, nonce)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (tenant_id, dek_id) DO UPDATE
   SET kek_version = EXCLUDED.kek_version,
       wrapped_dek = EXCLUDED.wrapped_dek,
       nonce       = EXCLUDED.nonce,
       rewrapped_at = now(),
       updated_at  = now()
RETURNING id, created_at, rewrapped_at, updated_at`

// UpsertWrappedDEK inserts or rewraps a DEK record. On first wrap it inserts; on
// rotation it updates the existing (tenant, dek_id) row to the new version,
// ciphertext, nonce, stamping rewrapped_at. This is the persistence half of a
// rewrap — done in the same transaction that advances the active KEK so the
// rewrap is atomic.
func (s *Store) UpsertWrappedDEK(ctx context.Context, db repository.DBTX, w *WrappedDEK) error {
	if len(w.WrappedDEK) == 0 || len(w.Nonce) == 0 {
		return fmt.Errorf("byok: wrapped DEK and nonce are required")
	}
	var rewrapped sql.NullTime
	err := db.QueryRow(ctx, upsertWrappedDEKSQL,
		w.TenantID, w.DEKID, w.KEKVersion, w.WrappedDEK, w.Nonce,
	).Scan(&w.ID, &w.CreatedAt, &rewrapped, &w.UpdatedAt)
	if err != nil {
		return fmt.Errorf("byok: upserting wrapped DEK %q: %w", w.DEKID, err)
	}
	w.RewrappedAt = nullTime(rewrapped)
	return nil
}

const getWrappedDEKSQL = `SELECT ` + wrappedColumns + `
FROM dr_wrapped_dek WHERE tenant_id = $1 AND dek_id = $2`

// GetWrappedDEK returns the wrapped DEK record for (tenant, dek_id).
func (s *Store) GetWrappedDEK(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, dekID string) (*WrappedDEK, error) {
	return scanWrappedDEK(db.QueryRow(ctx, getWrappedDEKSQL, tenantID, dekID))
}

const listWrappedDEKsSystemSQL = `SELECT ` + wrappedColumns + `
FROM dr_wrapped_dek WHERE tenant_id = $1 ORDER BY created_at ASC`

// ListWrappedDEKsSystem returns every wrapped DEK for the tenant on the system
// (RLS-bypass) path, used by the rotation loop to enumerate what must be rewrapped.
func (s *Store) ListWrappedDEKsSystem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*WrappedDEK, error) {
	rows, err := db.Query(ctx, listWrappedDEKsSystemSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("byok: listing wrapped DEKs: %w", err)
	}
	defer rows.Close()
	var out []*WrappedDEK
	for rows.Next() {
		w, serr := scanWrappedDEK(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("byok: iterating wrapped DEKs: %w", err)
	}
	return out, nil
}

const countWrappedNotAtVersionSQL = `
SELECT COUNT(*) FROM dr_wrapped_dek WHERE tenant_id = $1 AND kek_version <> $2`

// CountWrappedNotAtVersion returns how many of the tenant's DEKs are NOT yet at
// version. Rotation may retire the old KEK only once this reaches 0.
func (s *Store) CountWrappedNotAtVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int) (int, error) {
	var n int
	if err := db.QueryRow(ctx, countWrappedNotAtVersionSQL, tenantID, version).Scan(&n); err != nil {
		return 0, fmt.Errorf("byok: counting un-rewrapped DEKs: %w", err)
	}
	return n, nil
}

// --- Custody log (hash chain) --------------------------------------------

const insertCustodySQL = `
INSERT INTO dr_kek_custody_log (tenant_id, seq, action, kek_version, dek_id, detail, prev_hash, entry_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at`

// AppendCustody appends a custody-log entry. The caller must have computed
// PrevHash/EntryHash via ComputeEntryHash over the prior tip; this method
// persists it. A unique (tenant, seq) violation surfaces as ErrInvalidState
// (a concurrent writer raced the same sequence).
func (s *Store) AppendCustody(ctx context.Context, db repository.DBTX, e *CustodyEntry) error {
	err := db.QueryRow(ctx, insertCustodySQL,
		e.TenantID, e.Seq, e.Action, e.KEKVersion, e.DEKID, e.Detail, e.PrevHash, e.EntryHash,
	).Scan(&e.ID, &e.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("custody seq %d: %w", e.Seq, ErrInvalidState)
		}
		return fmt.Errorf("byok: appending custody entry: %w", err)
	}
	return nil
}

const custodyTipSQL = `
SELECT seq, entry_hash FROM dr_kek_custody_log
WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1`

// CustodyTip returns the current head (seq, entry_hash) of the tenant's custody
// chain, or (0, "") when the chain is empty (the genesis case).
func (s *Store) CustodyTip(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (seq int64, hash string, err error) {
	row := db.QueryRow(ctx, custodyTipSQL, tenantID)
	scanErr := row.Scan(&seq, &hash)
	if errors.Is(scanErr, pgx.ErrNoRows) {
		return 0, "", nil
	}
	if scanErr != nil {
		return 0, "", fmt.Errorf("byok: reading custody tip: %w", scanErr)
	}
	return seq, hash, nil
}

const custodyColumns = `
id, tenant_id, seq, action, kek_version, dek_id, detail, prev_hash, entry_hash, created_at`

const listCustodySQL = `SELECT ` + custodyColumns + `
FROM dr_kek_custody_log WHERE tenant_id = $1 ORDER BY seq ASC`

// ListCustody returns the tenant's custody entries in ascending seq order, the
// order required to verify the hash chain and fold the Merkle root.
func (s *Store) ListCustody(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*CustodyEntry, error) {
	rows, err := db.Query(ctx, listCustodySQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("byok: listing custody log: %w", err)
	}
	defer rows.Close()
	var out []*CustodyEntry
	for rows.Next() {
		e, serr := scanCustody(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("byok: iterating custody log: %w", err)
	}
	return out, nil
}

// --- scanning -------------------------------------------------------------

type rowScanner interface {
	Scan(dest ...any) error
}

func scanKEK(sc rowScanner) (*TenantKEK, error) {
	var (
		k           TenantKEK
		activatedAt sql.NullTime
		retiredAt   sql.NullTime
	)
	err := sc.Scan(
		&k.ID, &k.TenantID, &k.KeyVersion, &k.Provider, &k.Reference, &k.State,
		&k.CreatedAt, &activatedAt, &retiredAt, &k.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("byok: scanning KEK: %w", err)
	}
	k.ActivatedAt = nullTime(activatedAt)
	k.RetiredAt = nullTime(retiredAt)
	return &k, nil
}

func scanWrappedDEK(sc rowScanner) (*WrappedDEK, error) {
	var (
		w         WrappedDEK
		rewrapped sql.NullTime
	)
	err := sc.Scan(
		&w.ID, &w.TenantID, &w.DEKID, &w.KEKVersion, &w.WrappedDEK, &w.Nonce,
		&w.CreatedAt, &rewrapped, &w.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("byok: scanning wrapped DEK: %w", err)
	}
	w.RewrappedAt = nullTime(rewrapped)
	return &w, nil
}

func scanCustody(sc rowScanner) (*CustodyEntry, error) {
	var e CustodyEntry
	err := sc.Scan(
		&e.ID, &e.TenantID, &e.Seq, &e.Action, &e.KEKVersion, &e.DEKID,
		&e.Detail, &e.PrevHash, &e.EntryHash, &e.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("byok: scanning custody entry: %w", err)
	}
	return &e, nil
}

func nullTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}
