package integrations

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

// Store persists the dr_integration catalog over a repository.DBTX — the same
// pgx subset the rest of dr_db uses — so every method runs inside the caller's
// tenant-scoped transaction (SET LOCAL app.current_tenant_id; RLS as the
// backstop), mirroring internal/dr/storageoffload.Store. The encrypted
// credential bundle is opaque to the store: it stores and returns the sealed
// bytes verbatim and never decrypts.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// record is the full DB row including the sealed credential bytes. The service
// folds it into an Integration (secrets stripped) for the API surface.
type record struct {
	Integration
	EncryptedCredentials []byte
}

const integrationColumns = `
id, tenant_id, name, kind, vendor, endpoint, status, enabled,
encrypted_credentials, last_tested_at, last_test_error, created_at, updated_at`

const insertIntegrationSQL = `
INSERT INTO dr_integration
    (tenant_id, name, kind, vendor, endpoint, status, enabled, encrypted_credentials)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at, updated_at`

// Create inserts an integration row with its sealed credential bundle. tenant_id
// must match the surrounding transaction's app.current_tenant_id or RLS rejects
// it. A reused (tenant_id, name) returns ErrAlreadyExists.
func (s *Store) Create(ctx context.Context, db repository.DBTX, rec *record) error {
	if rec.Status == "" {
		rec.Status = StatusConfigured
	}
	err := db.QueryRow(ctx, insertIntegrationSQL,
		rec.TenantID, rec.Name, string(rec.Kind), rec.Vendor, rec.Endpoint,
		rec.Status, rec.Enabled, rec.EncryptedCredentials,
	).Scan(&rec.ID, &rec.CreatedAt, &rec.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("integration %q: %w", rec.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("integrations: creating %q: %w", rec.Name, err)
	}
	return nil
}

const selectIntegrationSQL = `SELECT ` + integrationColumns + `
FROM dr_integration WHERE tenant_id = $1 AND id = $2`

// Get loads one integration (with its sealed bundle) by id within the tenant.
func (s *Store) Get(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*record, error) {
	return scanRecord(db.QueryRow(ctx, selectIntegrationSQL, tenantID, id))
}

const listIntegrationsSQL = `SELECT ` + integrationColumns + `
FROM dr_integration WHERE tenant_id = $1 ORDER BY created_at DESC`

// List returns every integration for the tenant, newest first.
func (s *Store) List(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*record, error) {
	rows, err := db.Query(ctx, listIntegrationsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("integrations: listing: %w", err)
	}
	defer rows.Close()
	var out []*record
	for rows.Next() {
		rec, serr := scanRecord(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("integrations: iterating: %w", err)
	}
	return out, nil
}

const resolveActiveSQL = `SELECT ` + integrationColumns + `
FROM dr_integration
WHERE tenant_id = $1 AND vendor = $2 AND enabled = TRUE AND status = 'active'
ORDER BY created_at DESC
LIMIT 1`

// ResolveActive returns the newest enabled+active integration for a (tenant,
// vendor), or ErrNotFound when none qualifies.
func (s *Store) ResolveActive(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, vendor string) (*record, error) {
	return scanRecord(db.QueryRow(ctx, resolveActiveSQL, tenantID, vendor))
}

const updateIntegrationSQL = `
UPDATE dr_integration
   SET name = $3, kind = $4, vendor = $5, endpoint = $6, status = $7,
       enabled = $8, encrypted_credentials = $9, last_test_error = '',
       last_tested_at = NULL, updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING ` + integrationColumns

// Update replaces an integration's mutable fields and its sealed credential
// bundle, resetting the test status (the credentials may have changed, so the
// integration must be re-tested). Returns ErrNotFound when no row matches, and
// ErrAlreadyExists when the new name collides with another row.
func (s *Store) Update(ctx context.Context, db repository.DBTX, rec *record) error {
	updated, err := scanRecord(db.QueryRow(ctx, updateIntegrationSQL,
		rec.TenantID, rec.ID, rec.Name, string(rec.Kind), rec.Vendor, rec.Endpoint,
		rec.Status, rec.Enabled, rec.EncryptedCredentials,
	))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("integration %s: %w", rec.ID, ErrNotFound)
		}
		if isUniqueViolation(err) {
			return fmt.Errorf("integration %q: %w", rec.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("integrations: updating %s: %w", rec.ID, err)
	}
	*rec = *updated
	return nil
}

const deleteIntegrationSQL = `DELETE FROM dr_integration WHERE tenant_id = $1 AND id = $2`

// Delete removes an integration by id within the tenant. Returns ErrNotFound
// when no row matched.
func (s *Store) Delete(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) error {
	tag, err := db.Exec(ctx, deleteIntegrationSQL, tenantID, id)
	if err != nil {
		return fmt.Errorf("integrations: deleting %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const updateTestResultSQL = `
UPDATE dr_integration
   SET status = $3, last_test_error = $4, last_tested_at = $5, updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING ` + integrationColumns

// UpdateTestResult records a TestConnection outcome: the new status (active on
// success, error on failure), the error text (empty on success), and the test
// timestamp. It does NOT touch the credential bundle. Returns ErrNotFound when
// the row vanished.
func (s *Store) UpdateTestResult(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID, status, testErr string, testedAt time.Time) (*record, error) {
	rec, err := scanRecord(db.QueryRow(ctx, updateTestResultSQL, tenantID, id, status, testErr, testedAt))
	if err != nil {
		return nil, err
	}
	return rec, nil
}

// --- scanning ---------------------------------------------------------------

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecord(sc rowScanner) (*record, error) {
	var (
		rec          record
		kind         string
		lastTestedAt sql.NullTime
	)
	err := sc.Scan(
		&rec.ID, &rec.TenantID, &rec.Name, &kind, &rec.Vendor, &rec.Endpoint,
		&rec.Status, &rec.Enabled, &rec.EncryptedCredentials, &lastTestedAt,
		&rec.LastTestError, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("integrations: scanning row: %w", err)
	}
	rec.Kind = Kind(kind)
	if lastTestedAt.Valid {
		t := lastTestedAt.Time
		rec.LastTestedAt = &t
	}
	return &rec, nil
}
