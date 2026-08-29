package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// HRIdentityMapRepository persists the HR/identity connector's idempotency map
// (lex_hr_identity_map) and the inbound SCIM server bearer-token store
// (lex_scim_tokens). Both back the Phase-2 HR connector (hr_connector.go +
// scim_server.go).
//
// lex_hr_identity_map records (tenant_id, endpoint_id, external_id) ->
// (lex_kind, lex_id) so user/group/worker/org-unit reconciliation is idempotent
// across full + delta syncs and across SCIM PUT/PATCH replays. A content_hash
// lets the syncer/server skip no-op updates.
//
// lex_scim_tokens stores ONLY a sha256 hash of each issued bearer token (never
// the cleartext): the inbound SCIM middleware hashes the presented bearer and
// resolves the owning tenant+endpoint. Token issue/rotate returns the raw value
// exactly once.
type HRIdentityMapRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewHRIdentityMapRepository builds the repository over the shared pool.
func NewHRIdentityMapRepository(db *pgxpool.Pool, logger zerolog.Logger) *HRIdentityMapRepository {
	return &HRIdentityMapRepository{db: db, logger: logger.With().Str("repository", "lex-hr-identity-map").Logger()}
}

// =============================================================================
// HR identity map
// =============================================================================

// HRExternalKind enumerates the upstream resource type a mapping row covers.
type HRExternalKind string

const (
	HRExternalKindUser    HRExternalKind = "user"
	HRExternalKindGroup   HRExternalKind = "group"
	HRExternalKindWorker  HRExternalKind = "worker"
	HRExternalKindOrgUnit HRExternalKind = "org_unit"
)

// HRLexKind enumerates the lex object an external record reconciles onto.
type HRLexKind string

const (
	HRLexKindOrgEntity HRLexKind = "org_entity"
	HRLexKindOrgRole   HRLexKind = "org_role"
)

// HRIdentityMapping is one reconciliation row. ExternalID is the upstream stable
// identifier; LexKind/LexID identify the reconciled lex object. ContentHash is a
// sha256 of the normalized upstream payload so an unchanged delta/PUT is skipped.
type HRIdentityMapping struct {
	ID            uuid.UUID      `json:"id"`
	TenantID      uuid.UUID      `json:"tenant_id"`
	EndpointID    uuid.UUID      `json:"endpoint_id"`
	ExternalID    string         `json:"external_id"`
	ExternalKind  HRExternalKind `json:"external_kind"`
	LexKind       HRLexKind      `json:"lex_kind"`
	LexID         uuid.UUID      `json:"lex_id"`
	ExternalCode  string         `json:"external_code"`
	ContentHash   string         `json:"content_hash"`
	Active        bool           `json:"active"`
	Metadata      map[string]any `json:"metadata"`
	LastSyncedAt  time.Time      `json:"last_synced_at"`
	DeactivatedAt *time.Time     `json:"deactivated_at,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// HashContent returns the canonical sha256 (hex) content hash for a normalized
// payload, used to short-circuit no-op upserts. Callers pass an already-stable
// (sorted/serialized) representation.
func HashContent(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return hex.EncodeToString(h[:])
}

// GetMapping returns the mapping for (tenant, endpoint, external_id), or
// pgx.ErrNoRows when absent. It is tenant + endpoint scoped.
func (r *HRIdentityMapRepository) GetMapping(ctx context.Context, q Queryer, tenantID, endpointID uuid.UUID, externalID string) (*HRIdentityMapping, error) {
	const sel = `
		SELECT id, tenant_id, endpoint_id, external_id, external_kind, lex_kind, lex_id,
		       external_code, content_hash, active, COALESCE(metadata, '{}'::jsonb),
		       last_synced_at, deactivated_at, created_at, updated_at
		FROM lex_hr_identity_map
		WHERE tenant_id = $1 AND endpoint_id = $2 AND external_id = $3`
	row := q.QueryRow(ctx, sel, tenantID, endpointID, strings.TrimSpace(externalID))
	return scanHRMapping(row)
}

// UpsertMapping inserts or updates a mapping keyed on (tenant, endpoint,
// external_id). On conflict it refreshes the lex linkage, code, content hash,
// active flag, metadata and last_synced_at. It returns the persisted row and a
// bool reporting whether the row was newly created.
func (r *HRIdentityMapRepository) UpsertMapping(ctx context.Context, q Queryer, m *HRIdentityMapping) (created bool, err error) {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.LastSyncedAt.IsZero() {
		m.LastSyncedAt = time.Now().UTC()
	}
	metaJSON, err := json.Marshal(orEmptyMap(m.Metadata))
	if err != nil {
		return false, fmt.Errorf("marshal hr identity map metadata: %w", err)
	}
	var deactivatedAt any
	if m.Active {
		deactivatedAt = nil
	} else if m.DeactivatedAt != nil {
		deactivatedAt = m.DeactivatedAt.UTC()
	} else {
		deactivatedAt = m.LastSyncedAt.UTC()
	}
	const up = `
		INSERT INTO lex_hr_identity_map (
			id, tenant_id, endpoint_id, external_id, external_kind, lex_kind, lex_id,
			external_code, content_hash, active, metadata, last_synced_at, deactivated_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11::jsonb,$12,$13
		)
		ON CONFLICT (tenant_id, endpoint_id, external_id)
		DO UPDATE SET
			external_kind  = EXCLUDED.external_kind,
			lex_kind       = EXCLUDED.lex_kind,
			lex_id         = EXCLUDED.lex_id,
			external_code  = EXCLUDED.external_code,
			content_hash   = EXCLUDED.content_hash,
			active         = EXCLUDED.active,
			metadata       = EXCLUDED.metadata,
			last_synced_at = EXCLUDED.last_synced_at,
			deactivated_at = EXCLUDED.deactivated_at,
			updated_at     = now()
		RETURNING (xmax = 0) AS inserted, created_at, updated_at`
	err = q.QueryRow(ctx, up,
		m.ID, m.TenantID, m.EndpointID, strings.TrimSpace(m.ExternalID), m.ExternalKind, m.LexKind, m.LexID,
		m.ExternalCode, m.ContentHash, m.Active, metaJSON, m.LastSyncedAt.UTC(), deactivatedAt,
	).Scan(&created, &m.CreatedAt, &m.UpdatedAt)
	return created, err
}

// SoftDeactivate flips a mapping (and stamps deactivated_at) for a SCIM
// active=false or an HR delta tombstone, keeping the row for audit/reactivation.
// Returns pgx.ErrNoRows when no matching active row exists.
func (r *HRIdentityMapRepository) SoftDeactivate(ctx context.Context, q Queryer, tenantID, endpointID uuid.UUID, externalID string, at time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE lex_hr_identity_map
		SET active = false, deactivated_at = $4, last_synced_at = $4, updated_at = now()
		WHERE tenant_id = $1 AND endpoint_id = $2 AND external_id = $3`,
		tenantID, endpointID, strings.TrimSpace(externalID), at.UTC())
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanHRMapping(row pgx.Row) (*HRIdentityMapping, error) {
	var (
		m       HRIdentityMapping
		metaRaw []byte
	)
	if err := row.Scan(
		&m.ID, &m.TenantID, &m.EndpointID, &m.ExternalID, &m.ExternalKind, &m.LexKind, &m.LexID,
		&m.ExternalCode, &m.ContentHash, &m.Active, &metaRaw,
		&m.LastSyncedAt, &m.DeactivatedAt, &m.CreatedAt, &m.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(metaRaw) > 0 {
		_ = json.Unmarshal(metaRaw, &m.Metadata)
	}
	if m.Metadata == nil {
		m.Metadata = map[string]any{}
	}
	return &m, nil
}

// =============================================================================
// SCIM bearer tokens
// =============================================================================

// SCIMToken is one inbound-SCIM bearer credential. Only the hash + a non-secret
// prefix are persisted; the raw value is returned by IssueToken exactly once.
type SCIMToken struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	EndpointID  uuid.UUID  `json:"endpoint_id"`
	TokenPrefix string     `json:"token_prefix"`
	Label       string     `json:"label"`
	CreatedBy   *uuid.UUID `json:"created_by,omitempty"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// HashSCIMToken returns the sha256 (hex) of a raw bearer token. The same function
// is used at issue time (to store) and at resolve time (to look up), so the raw
// token never touches the database.
func HashSCIMToken(raw string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(h[:])
}

// IssueToken persists a new SCIM bearer token's hash + prefix for an endpoint and
// returns the stored row. The caller is responsible for generating the random raw
// token, computing tokenHash via HashSCIMToken, and returning the raw value to the
// operator exactly once. This method NEVER receives or stores the raw token.
func (r *HRIdentityMapRepository) IssueToken(ctx context.Context, q Queryer, tok *SCIMToken, tokenHash string) error {
	if tok.ID == uuid.Nil {
		tok.ID = uuid.New()
	}
	const ins = `
		INSERT INTO lex_scim_tokens (
			id, tenant_id, endpoint_id, token_hash, token_prefix, label, created_by, expires_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, ins,
		tok.ID, tok.TenantID, tok.EndpointID, tokenHash, tok.TokenPrefix, tok.Label, tok.CreatedBy, tok.ExpiresAt,
	).Scan(&tok.CreatedAt, &tok.UpdatedAt)
}

// RevokeTokensForEndpoint revokes every non-revoked token on an endpoint (used by
// rotate: issue-new-then-revoke-old, or by explicit revoke). Tenant scoped.
func (r *HRIdentityMapRepository) RevokeTokensForEndpoint(ctx context.Context, q Queryer, tenantID, endpointID uuid.UUID, at time.Time) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_scim_tokens
		SET revoked_at = $3, updated_at = now()
		WHERE tenant_id = $1 AND endpoint_id = $2 AND revoked_at IS NULL`,
		tenantID, endpointID, at.UTC())
	return err
}

// ListTokens returns the (non-secret) token rows for an endpoint, newest first.
func (r *HRIdentityMapRepository) ListTokens(ctx context.Context, q Queryer, tenantID, endpointID uuid.UUID) ([]SCIMToken, error) {
	const sel = `
		SELECT id, tenant_id, endpoint_id, token_prefix, label, created_by,
		       last_used_at, expires_at, revoked_at, created_at, updated_at
		FROM lex_scim_tokens
		WHERE tenant_id = $1 AND endpoint_id = $2
		ORDER BY created_at DESC`
	rows, err := q.Query(ctx, sel, tenantID, endpointID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SCIMToken, 0)
	for rows.Next() {
		var t SCIMToken
		if err := rows.Scan(
			&t.ID, &t.TenantID, &t.EndpointID, &t.TokenPrefix, &t.Label, &t.CreatedBy,
			&t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ResolveTokenByHash resolves a presented bearer (hashed) to its owning, active
// (non-revoked, unexpired) token row. The inbound SCIM middleware calls this
// BEFORE a tenant is known, so it queries by the globally-unique token_hash on the
// shared pool. Returns pgx.ErrNoRows when no active token matches.
//
// SECURITY: the caller MUST hash the presented bearer with HashSCIMToken and pass
// the hash here; the raw token is never compared in SQL. On success the resolved
// tenant_id is used to scope all subsequent SCIM work.
func (r *HRIdentityMapRepository) ResolveTokenByHash(ctx context.Context, tokenHash string, now time.Time) (*SCIMToken, error) {
	const sel = `
		SELECT id, tenant_id, endpoint_id, token_prefix, label, created_by,
		       last_used_at, expires_at, revoked_at, created_at, updated_at
		FROM lex_scim_tokens
		WHERE token_hash = $1
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > $2)
		LIMIT 1`
	row := r.db.QueryRow(ctx, sel, tokenHash, now.UTC())
	var t SCIMToken
	if err := row.Scan(
		&t.ID, &t.TenantID, &t.EndpointID, &t.TokenPrefix, &t.Label, &t.CreatedBy,
		&t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &t, nil
}

// TouchTokenUsed stamps last_used_at after a successful inbound SCIM request.
// Best-effort; resolves by id (tenant already known at this point).
func (r *HRIdentityMapRepository) TouchTokenUsed(ctx context.Context, tenantID, tokenID uuid.UUID, at time.Time) error {
	_, err := r.db.Exec(ctx,
		`UPDATE lex_scim_tokens SET last_used_at = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
		tenantID, tokenID, at.UTC())
	return err
}

// Pool exposes the underlying pool so the SCIM server can open a tenant-scoped
// transaction (set app.current_tenant_id) once a token resolves a tenant.
func (r *HRIdentityMapRepository) Pool() *pgxpool.Pool { return r.db }
