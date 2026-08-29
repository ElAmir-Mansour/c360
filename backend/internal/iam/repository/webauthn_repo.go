package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/iam/model"
)

// WebAuthnCredential is a stored WebAuthn (FIDO2) credential record, mapping the
// webauthn_credentials table (migration 000021).
//
// CredentialID is the authenticator's credential id stored base64url-encoded;
// PublicKey is the COSE public key stored base64 (std)-encoded. The service
// layer owns the encode/decode of these binary values.
type WebAuthnCredential struct {
	ID           string
	TenantID     string
	UserID       string
	CredentialID string // base64url-encoded credential id
	PublicKey    string // base64 (std)-encoded COSE public key
	Counter      int64
	Transports   []string
	AAGUID       *string // UUID string, nullable
	CreatedAt    time.Time
	LastUsedAt   *time.Time
}

// WebAuthnRepository persists WebAuthn (FIDO2) credential records.
//
// Binary values are stored in their TEXT columns base64url-encoded by the
// service layer (credential_id) and base64-encoded (public_key); this
// repository treats both as opaque strings.
type WebAuthnRepository interface {
	// CreateCredential inserts a new credential record.
	CreateCredential(ctx context.Context, cred *WebAuthnCredential) error
	// ListCredentialsByUser returns all credentials owned by a user.
	ListCredentialsByUser(ctx context.Context, userID string) ([]WebAuthnCredential, error)
	// ListCredentialsByCredentialID returns the credential matching a
	// base64url-encoded credential id, regardless of tenant. This supports the
	// usernameless/discoverable flow where the user is resolved from the
	// credential returned by the authenticator.
	GetCredentialByCredentialID(ctx context.Context, credentialID string) (*WebAuthnCredential, error)
	// UpdateCounter advances the stored signature counter and last_used_at.
	UpdateCounter(ctx context.Context, id string, counter int64) error
}

type webAuthnRepo struct {
	pool *pgxpool.Pool
}

// NewWebAuthnRepository constructs the Postgres-backed WebAuthnRepository.
func NewWebAuthnRepository(pool *pgxpool.Pool) WebAuthnRepository {
	return &webAuthnRepo{pool: pool}
}

func (r *webAuthnRepo) CreateCredential(ctx context.Context, cred *WebAuthnCredential) error {
	query := `
		INSERT INTO webauthn_credentials
			(tenant_id, user_id, credential_id, public_key, counter, transports, aaguid)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at`

	transports := cred.Transports
	if transports == nil {
		transports = []string{}
	}

	return r.pool.QueryRow(ctx, query,
		cred.TenantID, cred.UserID, cred.CredentialID, cred.PublicKey,
		cred.Counter, transports, cred.AAGUID,
	).Scan(&cred.ID, &cred.CreatedAt)
}

func (r *webAuthnRepo) ListCredentialsByUser(ctx context.Context, userID string) ([]WebAuthnCredential, error) {
	query := `
		SELECT id, tenant_id, user_id, credential_id, public_key, counter,
		       transports, aaguid, created_at, last_used_at
		FROM webauthn_credentials
		WHERE user_id = $1
		ORDER BY created_at DESC`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("listing webauthn credentials: %w", err)
	}
	defer rows.Close()

	var creds []WebAuthnCredential
	for rows.Next() {
		c, err := scanCredential(rows)
		if err != nil {
			return nil, err
		}
		creds = append(creds, *c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating webauthn credentials: %w", err)
	}
	return creds, nil
}

func (r *webAuthnRepo) GetCredentialByCredentialID(ctx context.Context, credentialID string) (*WebAuthnCredential, error) {
	query := `
		SELECT id, tenant_id, user_id, credential_id, public_key, counter,
		       transports, aaguid, created_at, last_used_at
		FROM webauthn_credentials
		WHERE credential_id = $1
		LIMIT 1`

	c, err := scanCredential(r.pool.QueryRow(ctx, query, credentialID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("webauthn credential: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying webauthn credential: %w", err)
	}
	return c, nil
}

func (r *webAuthnRepo) UpdateCounter(ctx context.Context, id string, counter int64) error {
	_, err := r.pool.Exec(ctx,
		"UPDATE webauthn_credentials SET counter = $2, last_used_at = NOW() WHERE id = $1",
		id, counter)
	if err != nil {
		return fmt.Errorf("updating webauthn counter: %w", err)
	}
	return nil
}

// rowScanner abstracts pgx.Row and pgx.Rows so a single scan helper serves both
// single-row and multi-row queries.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanCredential(row rowScanner) (*WebAuthnCredential, error) {
	c := &WebAuthnCredential{}
	if err := row.Scan(
		&c.ID, &c.TenantID, &c.UserID, &c.CredentialID, &c.PublicKey, &c.Counter,
		&c.Transports, &c.AAGUID, &c.CreatedAt, &c.LastUsedAt,
	); err != nil {
		return nil, err
	}
	return c, nil
}
