package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/pkg/crypto"
)

// idpSecretPrefix marks an idp_connections.client_secret value as encrypted with
// the connection FieldCrypto key. Values WITHOUT this prefix are treated as legacy
// plaintext on read (backward compatibility: pre-encryption rows + the staged
// re-encryption migration coexist with no token-exchange downtime — see
// migrations/platform_core/_staging/idp_secret_encryption.up.sql). This mirrors
// the lex FieldCrypto "enc:v1:" envelope convention but is scoped to this column
// because the IAM service custodies the IdP secret key (pkg/crypto), not the lex
// FieldCrypto provider.
const idpSecretPrefix = "enc:idp1:"

// IdPConnectionRepository loads external identity-provider connection configs.
// The client_secret is encrypted at rest with the IdP secret key (NCA/PDPL: a
// real gap was that it was stored PLAINTEXT). Reads decrypt transparently; reads
// that feed API/list surfaces should call RedactSecret to avoid echoing secrets.
type IdPConnectionRepository interface {
	GetByProvider(ctx context.Context, tenantID, provider string) (*model.IdPConnection, error)
	GetByEmailDomain(ctx context.Context, domain string) (*model.IdPConnection, error)
	ListByTenant(ctx context.Context, tenantID string) ([]model.IdPConnection, error)
}

// IdPConnectionWriter is the write half of the IdP connection repository, kept
// SEPARATE from the read interface so existing read-only consumers (and their test
// doubles) are not forced to grow a write method. The concrete DB repo satisfies
// both; an admin/console handler that persists connections takes this interface
// (or type-asserts the read repo to it).
type IdPConnectionWriter interface {
	// UpsertConnection persists (insert or update) an IdP connection, encrypting
	// client_secret at rest when a secret key is wired. A blank/empty incoming
	// client_secret KEEPS the stored ciphertext (merge-on-update), so an admin form
	// that omits the unchanged secret does not wipe it.
	UpsertConnection(ctx context.Context, c *model.IdPConnection) error
	// DeleteConnection removes an IdP connection (keyed on tenant_id+provider).
	// It runs under the caller's tenant RLS context, so a foreign-tenant provider
	// slug matches no row and returns model.ErrNotFound (never a cross-tenant delete).
	DeleteConnection(ctx context.Context, tenantID, provider string) error
}

// IdPConnectionAdminRepository is the full admin surface: read (list/get,
// including disabled connections via GetByProviderAny) plus write (upsert +
// delete). The concrete DB repo satisfies it; the admin service consumes it.
// Kept separate from the login-path read interface so the federation service is
// not forced to grow write methods.
type IdPConnectionAdminRepository interface {
	IdPConnectionRepository
	IdPConnectionWriter
	// GetByProviderAny loads a connection WITHOUT the enabled=true filter, so the
	// admin edit form can load (and re-enable) a disabled connection. The
	// client_secret is decrypted; callers feeding API surfaces must RedactSecret.
	GetByProviderAny(ctx context.Context, tenantID, provider string) (*model.IdPConnection, error)
}

// ExternalIdentityRepository manages the mapping between external IdP subjects
// and platform users.
type ExternalIdentityRepository interface {
	GetBySubject(ctx context.Context, tenantID, provider, externalSubject string) (*model.ExternalIdentity, error)
	ListByUser(ctx context.Context, userID string) ([]model.ExternalIdentity, error)
	Create(ctx context.Context, identity *model.ExternalIdentity) error
	TouchLastLogin(ctx context.Context, id string) error
	Delete(ctx context.Context, tenantID, userID, provider string) error
}

type idpConnectionRepo struct {
	pool *pgxpool.Pool
	// secretKey is the 32-byte AES-256 key used to encrypt/decrypt client_secret
	// at rest. When nil, the repo operates in legacy plaintext mode (reads/writes
	// pass through), so an un-keyed deployment keeps working — but production MUST
	// wire a key (see WithSecretKey + the staged migration).
	secretKey []byte
}

// NewIdPConnectionRepository constructs a DB-backed IdP connection repository.
// Without a secret key, client_secret is stored/read as legacy plaintext.
func NewIdPConnectionRepository(pool *pgxpool.Pool) IdPConnectionRepository {
	return &idpConnectionRepo{pool: pool}
}

// NewIdPConnectionRepositoryWithKey constructs the repository with transparent
// AES-256-GCM encryption of client_secret at rest. key must be exactly 32 bytes
// (a non-conforming key is ignored and the repo falls back to plaintext). The SAME
// key MUST be supplied to the re-encryption migration backfill.
func NewIdPConnectionRepositoryWithKey(pool *pgxpool.Pool, key []byte) IdPConnectionRepository {
	r := &idpConnectionRepo{pool: pool}
	if len(key) == crypto32 {
		r.secretKey = key
	}
	return r
}

// NewIdPConnectionAdminRepository constructs the full admin repository (read +
// write + delete + disabled-connection get) with the same transparent secret
// encryption contract as NewIdPConnectionRepositoryWithKey. The returned value
// also satisfies IdPConnectionRepository, so a single instance can back both the
// login-path federation service and the admin CRUD service.
func NewIdPConnectionAdminRepository(pool *pgxpool.Pool, key []byte) IdPConnectionAdminRepository {
	r := &idpConnectionRepo{pool: pool}
	if len(key) == crypto32 {
		r.secretKey = key
	}
	return r
}

const crypto32 = 32

// Compile-time assertions: the concrete repo satisfies BOTH the read interface and
// the write interface.
var (
	_ IdPConnectionRepository      = (*idpConnectionRepo)(nil)
	_ IdPConnectionWriter          = (*idpConnectionRepo)(nil)
	_ IdPConnectionAdminRepository = (*idpConnectionRepo)(nil)
)

// decryptSecret returns the plaintext client_secret. A value carrying the
// idpSecretPrefix is decrypted; any other value is treated as legacy plaintext and
// returned unchanged (so pre-encryption rows keep working until the migration
// backfills them).
func (r *idpConnectionRepo) decryptSecret(stored string) string {
	if !strings.HasPrefix(stored, idpSecretPrefix) {
		return stored // legacy plaintext (or empty)
	}
	if len(r.secretKey) != crypto32 {
		// Encrypted at rest but no key wired: we cannot decrypt. Return empty rather
		// than leaking ciphertext into a token exchange.
		return ""
	}
	pt, err := crypto.Decrypt(strings.TrimPrefix(stored, idpSecretPrefix), r.secretKey)
	if err != nil {
		return ""
	}
	return string(pt)
}

// encryptSecret returns the value to persist for client_secret. When a key is
// wired and the value is non-empty plaintext, it is encrypted and prefixed; an
// already-encrypted value is returned unchanged (idempotent); without a key it is
// stored as legacy plaintext.
func (r *idpConnectionRepo) encryptSecret(plaintext string) (string, error) {
	if plaintext == "" || strings.HasPrefix(plaintext, idpSecretPrefix) {
		return plaintext, nil
	}
	if len(r.secretKey) != crypto32 {
		return plaintext, nil
	}
	ct, err := crypto.Encrypt([]byte(plaintext), r.secretKey)
	if err != nil {
		return "", fmt.Errorf("encrypt idp client_secret: %w", err)
	}
	return idpSecretPrefix + ct, nil
}

// RedactSecret blanks the client_secret on a connection copy for API/list
// surfaces, so the secret is never echoed to a caller. It returns the same pointer
// for convenience.
func RedactSecret(c *model.IdPConnection) *model.IdPConnection {
	if c != nil {
		c.ClientSecret = ""
	}
	return c
}

// UpsertConnection inserts or updates an IdP connection (keyed on
// tenant_id+provider), encrypting client_secret at rest. Merge-on-update: a blank
// incoming client_secret keeps the stored ciphertext so an admin form that omits
// the unchanged secret does not wipe it. Scopes default to the standard OIDC set
// when empty. The write runs under the caller's tenant RLS context.
func (r *idpConnectionRepo) UpsertConnection(ctx context.Context, c *model.IdPConnection) error {
	if c == nil {
		return fmt.Errorf("idp upsert: nil connection")
	}
	if strings.TrimSpace(c.TenantID) == "" || strings.TrimSpace(c.Provider) == "" {
		return fmt.Errorf("idp upsert: tenant_id and provider are required")
	}

	// Resolve the secret to persist: a non-empty incoming secret is (re)encrypted;
	// a blank incoming secret keeps whatever is already stored (merge-on-update).
	secretToStore := ""
	if strings.TrimSpace(c.ClientSecret) == "" {
		var existing string
		err := r.pool.QueryRow(ctx,
			`SELECT COALESCE(client_secret,'') FROM idp_connections WHERE tenant_id = $1 AND provider = $2`,
			c.TenantID, c.Provider).Scan(&existing)
		if err != nil && err != pgx.ErrNoRows {
			return fmt.Errorf("idp upsert: load existing secret: %w", err)
		}
		secretToStore = existing // already-encrypted ciphertext (or empty); kept verbatim
	} else {
		enc, err := r.encryptSecret(c.ClientSecret)
		if err != nil {
			return err
		}
		secretToStore = enc
	}

	scopes := c.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}
	defaultRole := c.DefaultRoleSlug
	if strings.TrimSpace(defaultRole) == "" {
		defaultRole = "viewer"
	}
	kind := c.Kind
	if strings.TrimSpace(string(kind)) == "" {
		kind = model.IdPKindOIDC
	}

	const q = `
		INSERT INTO idp_connections (
			tenant_id, provider, display_name, kind, enabled,
			issuer, client_id, client_secret,
			authorize_url, token_url, jwks_url, userinfo_url, redirect_url,
			scopes, default_role_slug, allow_jit_provisioning, saml_metadata_xml
		) VALUES (
			$1,$2,$3,$4,$5,
			$6,$7,$8,
			$9,$10,$11,$12,$13,
			$14,$15,$16,$17
		)
		ON CONFLICT (tenant_id, provider) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			kind = EXCLUDED.kind,
			enabled = EXCLUDED.enabled,
			issuer = EXCLUDED.issuer,
			client_id = EXCLUDED.client_id,
			client_secret = EXCLUDED.client_secret,
			authorize_url = EXCLUDED.authorize_url,
			token_url = EXCLUDED.token_url,
			jwks_url = EXCLUDED.jwks_url,
			userinfo_url = EXCLUDED.userinfo_url,
			redirect_url = EXCLUDED.redirect_url,
			scopes = EXCLUDED.scopes,
			default_role_slug = EXCLUDED.default_role_slug,
			allow_jit_provisioning = EXCLUDED.allow_jit_provisioning,
			saml_metadata_xml = EXCLUDED.saml_metadata_xml,
			updated_at = now()
		RETURNING id, created_at, updated_at`

	return r.pool.QueryRow(ctx, q,
		c.TenantID, c.Provider, c.DisplayName, kind, c.Enabled,
		c.Issuer, c.ClientID, secretToStore,
		c.AuthorizeURL, c.TokenURL, c.JWKSURL, c.UserInfoURL, c.RedirectURL,
		scopes, defaultRole, c.AllowJITProvisioning, c.SAMLMetadataXML,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

const idpConnectionColumns = `
	id, tenant_id, provider, display_name, kind, enabled,
	COALESCE(issuer,''), COALESCE(client_id,''), COALESCE(client_secret,''),
	COALESCE(authorize_url,''), COALESCE(token_url,''), COALESCE(jwks_url,''),
	COALESCE(userinfo_url,''), COALESCE(redirect_url,''), scopes,
	default_role_slug, allow_jit_provisioning, COALESCE(saml_metadata_xml,''),
	created_at, updated_at`

func (r *idpConnectionRepo) scanIdPConnection(row pgx.Row, c *model.IdPConnection) error {
	if err := row.Scan(
		&c.ID, &c.TenantID, &c.Provider, &c.DisplayName, &c.Kind, &c.Enabled,
		&c.Issuer, &c.ClientID, &c.ClientSecret,
		&c.AuthorizeURL, &c.TokenURL, &c.JWKSURL,
		&c.UserInfoURL, &c.RedirectURL, &c.Scopes,
		&c.DefaultRoleSlug, &c.AllowJITProvisioning, &c.SAMLMetadataXML,
		&c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return err
	}
	// Decrypt client_secret at rest (NCA/PDPL). Legacy plaintext passes through.
	c.ClientSecret = r.decryptSecret(c.ClientSecret)
	return nil
}

func (r *idpConnectionRepo) GetByProvider(ctx context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	query := `SELECT ` + idpConnectionColumns + `
		FROM idp_connections
		WHERE tenant_id = $1 AND provider = $2 AND enabled = true`

	c := &model.IdPConnection{}
	if err := r.scanIdPConnection(r.pool.QueryRow(ctx, query, tenantID, provider), c); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("idp connection %s/%s: %w", tenantID, provider, model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying idp connection: %w", err)
	}
	return c, nil
}

// GetByProviderAny loads a connection by tenant+provider WITHOUT the enabled=true
// filter (admin edit path), so a disabled connection can be loaded and re-enabled.
func (r *idpConnectionRepo) GetByProviderAny(ctx context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	query := `SELECT ` + idpConnectionColumns + `
		FROM idp_connections
		WHERE tenant_id = $1 AND provider = $2`

	c := &model.IdPConnection{}
	if err := r.scanIdPConnection(r.pool.QueryRow(ctx, query, tenantID, provider), c); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("idp connection %s/%s: %w", tenantID, provider, model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying idp connection: %w", err)
	}
	return c, nil
}

// DeleteConnection removes the connection for tenant+provider. Runs under the
// caller's tenant RLS context, so a foreign-tenant slug affects no rows and
// resolves to model.ErrNotFound rather than a cross-tenant delete.
func (r *idpConnectionRepo) DeleteConnection(ctx context.Context, tenantID, provider string) error {
	ct, err := r.pool.Exec(ctx,
		`DELETE FROM idp_connections WHERE tenant_id = $1 AND provider = $2`,
		tenantID, provider)
	if err != nil {
		return fmt.Errorf("deleting idp connection: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("idp connection %s/%s: %w", tenantID, provider, model.ErrNotFound)
	}
	return nil
}

// GetByEmailDomain resolves the enabled IdP connection mapped to an email
// domain (e.g. "acme.com"). The email_domain column is unique per tenant; a
// single match is returned. Returns model.ErrNotFound when no mapping exists.
func (r *idpConnectionRepo) GetByEmailDomain(ctx context.Context, domain string) (*model.IdPConnection, error) {
	query := `SELECT ` + idpConnectionColumns + `
		FROM idp_connections
		WHERE email_domain = $1 AND enabled = true
		ORDER BY updated_at DESC
		LIMIT 1`

	c := &model.IdPConnection{}
	if err := r.scanIdPConnection(r.pool.QueryRow(ctx, query, domain), c); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("idp connection for domain %s: %w", domain, model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying idp connection by domain: %w", err)
	}
	return c, nil
}

func (r *idpConnectionRepo) ListByTenant(ctx context.Context, tenantID string) ([]model.IdPConnection, error) {
	// No tenant scope (e.g. an unauthenticated provider-discovery call with no
	// tenant_id and no configured default tenant): there is nothing to list.
	// Returning empty avoids passing "" to a uuid column, which Postgres rejects
	// with "invalid input syntax for type uuid", surfacing as a 500.
	if tenantID == "" {
		return []model.IdPConnection{}, nil
	}

	query := `SELECT ` + idpConnectionColumns + `
		FROM idp_connections
		WHERE tenant_id = $1
		ORDER BY provider`

	rows, err := r.pool.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing idp connections: %w", err)
	}
	defer rows.Close()

	var out []model.IdPConnection
	for rows.Next() {
		var c model.IdPConnection
		if err := r.scanIdPConnection(rows, &c); err != nil {
			return nil, fmt.Errorf("scanning idp connection: %w", err)
		}
		// ListByTenant feeds admin/console list surfaces — never echo the secret.
		// Per-provider login resolution uses GetByProvider, which keeps the secret.
		RedactSecret(&c)
		out = append(out, c)
	}
	return out, rows.Err()
}

type externalIdentityRepo struct {
	pool *pgxpool.Pool
}

// NewExternalIdentityRepository constructs a DB-backed external identity repository.
func NewExternalIdentityRepository(pool *pgxpool.Pool) ExternalIdentityRepository {
	return &externalIdentityRepo{pool: pool}
}

func (r *externalIdentityRepo) GetBySubject(ctx context.Context, tenantID, provider, externalSubject string) (*model.ExternalIdentity, error) {
	query := `
		SELECT id, tenant_id, user_id, provider, external_subject, email, display_name, created_at, last_login_at
		FROM external_identities
		WHERE tenant_id = $1 AND provider = $2 AND external_subject = $3`

	e := &model.ExternalIdentity{}
	err := r.pool.QueryRow(ctx, query, tenantID, provider, externalSubject).Scan(
		&e.ID, &e.TenantID, &e.UserID, &e.Provider, &e.ExternalSubject,
		&e.Email, &e.DisplayName, &e.CreatedAt, &e.LastLoginAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("external identity %s/%s: %w", provider, externalSubject, model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying external identity: %w", err)
	}
	return e, nil
}

func (r *externalIdentityRepo) ListByUser(ctx context.Context, userID string) ([]model.ExternalIdentity, error) {
	query := `
		SELECT id, tenant_id, user_id, provider, external_subject, email, display_name, created_at, last_login_at
		FROM external_identities
		WHERE user_id = $1
		ORDER BY provider`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("listing external identities: %w", err)
	}
	defer rows.Close()

	var out []model.ExternalIdentity
	for rows.Next() {
		var e model.ExternalIdentity
		if err := rows.Scan(
			&e.ID, &e.TenantID, &e.UserID, &e.Provider, &e.ExternalSubject,
			&e.Email, &e.DisplayName, &e.CreatedAt, &e.LastLoginAt,
		); err != nil {
			return nil, fmt.Errorf("scanning external identity: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *externalIdentityRepo) Create(ctx context.Context, identity *model.ExternalIdentity) error {
	query := `
		INSERT INTO external_identities (tenant_id, user_id, provider, external_subject, email, display_name)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at`
	return r.pool.QueryRow(ctx, query,
		identity.TenantID, identity.UserID, identity.Provider,
		identity.ExternalSubject, identity.Email, identity.DisplayName,
	).Scan(&identity.ID, &identity.CreatedAt)
}

func (r *externalIdentityRepo) TouchLastLogin(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `UPDATE external_identities SET last_login_at = NOW() WHERE id = $1`, id)
	return err
}

func (r *externalIdentityRepo) Delete(ctx context.Context, tenantID, userID, provider string) error {
	ct, err := r.pool.Exec(ctx,
		`DELETE FROM external_identities WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`,
		tenantID, userID, provider)
	if err != nil {
		return fmt.Errorf("deleting external identity: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("external identity %s/%s: %w", userID, provider, model.ErrNotFound)
	}
	return nil
}
