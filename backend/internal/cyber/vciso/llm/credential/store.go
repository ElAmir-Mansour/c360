package credential

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CredentialRecord is the persisted shape of a tenant's LLM credential. It holds
// the ENCRYPTED key (APIKeyCipher, always "enc:v1:...") -- never plaintext. This
// type is internal to the resolver/service and is never serialized to clients.
type CredentialRecord struct {
	TenantID      uuid.UUID
	Provider      string
	Model         string
	APIKeyCipher  string
	DEKRef        string
	KEKVersion    int
	Enabled       bool
	Version       int64
	LastRotatedAt *time.Time
	UpdatedAt     time.Time
}

// Store is the persistence contract for tenant LLM credentials. Every method
// takes tenantID FIRST and filters strictly by it, so a faked Store in tests can
// prove cross-tenant isolation at the data layer without a real database.
type Store interface {
	// Upsert inserts or replaces the tenant's credential, bumping version and
	// stamping last_rotated_at. enabled is forced true on upsert.
	Upsert(ctx context.Context, tenantID uuid.UUID, provider, model, apiKeyCipher, dekRef string, kekVersion int) (CredentialRecord, error)
	// Get returns (rec, true, nil) when a row exists, (zero, false, nil) when not.
	Get(ctx context.Context, tenantID uuid.UUID) (CredentialRecord, bool, error)
	// Delete removes the tenant's credential, returning whether a row existed.
	Delete(ctx context.Context, tenantID uuid.UUID) (bool, error)
	// SetEnabled flips the enabled flag and bumps version.
	SetEnabled(ctx context.Context, tenantID uuid.UUID, enabled bool) (CredentialRecord, error)
}

// pgStore is the pgx-backed Store. It sets the RLS GUC inside each transaction
// (defense in depth on top of the explicit tenant_id = $1 WHERE) so the
// llm_cred_isolation policy is enforced even for the control-plane pool.
type pgStore struct {
	pool *pgxpool.Pool
}

// NewStore builds a Postgres-backed Store.
func NewStore(pool *pgxpool.Pool) Store {
	return &pgStore{pool: pool}
}

func (s *pgStore) withTenantTx(ctx context.Context, tenantID uuid.UUID, readOnly bool, fn func(pgx.Tx) error) error {
	opts := pgx.TxOptions{}
	if readOnly {
		opts.AccessMode = pgx.ReadOnly
	}
	tx, err := s.pool.BeginTx(ctx, opts)
	if err != nil {
		return fmt.Errorf("begin tenant transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String()); err != nil {
		return fmt.Errorf("set tenant context: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tenant transaction: %w", err)
	}
	return nil
}

func scanCredential(row pgx.Row) (CredentialRecord, error) {
	var rec CredentialRecord
	err := row.Scan(
		&rec.TenantID,
		&rec.Provider,
		&rec.Model,
		&rec.APIKeyCipher,
		&rec.DEKRef,
		&rec.KEKVersion,
		&rec.Enabled,
		&rec.Version,
		&rec.LastRotatedAt,
		&rec.UpdatedAt,
	)
	return rec, err
}

const credentialColumns = `tenant_id, provider, model, api_key_cipher, dek_ref, kek_version, enabled, version, last_rotated_at, updated_at`

func (s *pgStore) Upsert(ctx context.Context, tenantID uuid.UUID, provider, model, apiKeyCipher, dekRef string, kekVersion int) (CredentialRecord, error) {
	var rec CredentialRecord
	err := s.withTenantTx(ctx, tenantID, false, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            INSERT INTO llm_tenant_credentials
                (tenant_id, provider, model, api_key_cipher, dek_ref, kek_version, enabled, version, last_rotated_at)
            VALUES ($1, $2, $3, $4, $5, $6, true, 1, now())
            ON CONFLICT (tenant_id) DO UPDATE SET
                provider        = EXCLUDED.provider,
                model           = EXCLUDED.model,
                api_key_cipher  = EXCLUDED.api_key_cipher,
                dek_ref         = EXCLUDED.dek_ref,
                kek_version     = EXCLUDED.kek_version,
                enabled         = true,
                version         = llm_tenant_credentials.version + 1,
                last_rotated_at = now(),
                updated_at      = now()
            RETURNING `+credentialColumns,
			tenantID, provider, model, apiKeyCipher, dekRef, kekVersion)
		var scanErr error
		rec, scanErr = scanCredential(row)
		return scanErr
	})
	if err != nil {
		return CredentialRecord{}, err
	}
	return rec, nil
}

func (s *pgStore) Get(ctx context.Context, tenantID uuid.UUID) (CredentialRecord, bool, error) {
	var rec CredentialRecord
	found := true
	err := s.withTenantTx(ctx, tenantID, true, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            SELECT `+credentialColumns+`
            FROM llm_tenant_credentials
            WHERE tenant_id = $1`, tenantID)
		var scanErr error
		rec, scanErr = scanCredential(row)
		if errors.Is(scanErr, pgx.ErrNoRows) {
			found = false
			return nil
		}
		return scanErr
	})
	if err != nil {
		return CredentialRecord{}, false, err
	}
	return rec, found, nil
}

func (s *pgStore) Delete(ctx context.Context, tenantID uuid.UUID) (bool, error) {
	var existed bool
	err := s.withTenantTx(ctx, tenantID, false, func(tx pgx.Tx) error {
		tag, execErr := tx.Exec(ctx, `DELETE FROM llm_tenant_credentials WHERE tenant_id = $1`, tenantID)
		if execErr != nil {
			return execErr
		}
		existed = tag.RowsAffected() > 0
		return nil
	})
	if err != nil {
		return false, err
	}
	return existed, nil
}

func (s *pgStore) SetEnabled(ctx context.Context, tenantID uuid.UUID, enabled bool) (CredentialRecord, error) {
	var rec CredentialRecord
	err := s.withTenantTx(ctx, tenantID, false, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            UPDATE llm_tenant_credentials
            SET enabled = $2, version = version + 1, updated_at = now()
            WHERE tenant_id = $1
            RETURNING `+credentialColumns, tenantID, enabled)
		var scanErr error
		rec, scanErr = scanCredential(row)
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return ErrNotConfigured
		}
		return scanErr
	})
	if err != nil {
		return CredentialRecord{}, err
	}
	return rec, nil
}
