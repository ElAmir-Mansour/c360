package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/model"
)

// IntegrationEndpointRepository persists lex_integration_endpoints (CAP-174..178).
// The connection Config map is FieldCrypto-encrypted at rest (CAP-179): on write
// the map is JSON-serialised then encrypted into the config_encrypted TEXT column;
// on read it is decrypted and unmarshalled back into Config. When crypto is nil
// the config is stored as legacy plaintext JSON (the enc:v1: prefix is absent and
// FieldCrypto.Decrypt passes such values through untouched), so existing rows keep
// working.
type IntegrationEndpointRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
	crypto *lexcrypto.FieldCrypto
}

func NewIntegrationEndpointRepository(db *pgxpool.Pool, logger zerolog.Logger) *IntegrationEndpointRepository {
	return &IntegrationEndpointRepository{db: db, logger: logger}
}

// WithFieldCrypto enables transparent encryption of the integration Config blob.
// Passing nil disables it. Returns the receiver for chaining.
func (r *IntegrationEndpointRepository) WithFieldCrypto(fc *lexcrypto.FieldCrypto) *IntegrationEndpointRepository {
	r.crypto = fc
	return r
}

func (r *IntegrationEndpointRepository) encodeConfig(config map[string]any) (string, bool, error) {
	if config == nil {
		config = map[string]any{}
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return "", false, fmt.Errorf("marshal integration config: %w", err)
	}
	if r.crypto == nil {
		return string(raw), false, nil
	}
	enc, err := r.crypto.Encrypt(string(raw))
	if err != nil {
		return "", false, fmt.Errorf("encrypt integration config: %w", err)
	}
	return enc, lexcrypto.IsEncrypted(enc), nil
}

func (r *IntegrationEndpointRepository) decodeConfig(stored string) (map[string]any, bool, error) {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return map[string]any{}, false, nil
	}
	encrypted := lexcrypto.IsEncrypted(stored)
	plaintext := stored
	if r.crypto != nil {
		dec, err := r.crypto.Decrypt(stored)
		if err != nil {
			return nil, encrypted, fmt.Errorf("decrypt integration config: %w", err)
		}
		plaintext = dec
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(plaintext), &out); err != nil {
		return nil, encrypted, fmt.Errorf("unmarshal integration config: %w", err)
	}
	return out, encrypted, nil
}

func (r *IntegrationEndpointRepository) Create(ctx context.Context, q Queryer, endpoint *model.IntegrationEndpoint) error {
	configCipher, encrypted, err := r.encodeConfig(endpoint.Config)
	if err != nil {
		return err
	}
	metadataJSON, err := json.Marshal(orEmptyMap(endpoint.Metadata))
	if err != nil {
		return fmt.Errorf("marshal integration metadata: %w", err)
	}
	query := `
		INSERT INTO lex_integration_endpoints (
			id, tenant_id, kind, code, name, description, status,
			config_encrypted, config_encrypted_flag, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10::jsonb,$11
		)
		RETURNING created_at, updated_at`
	if err := q.QueryRow(ctx, query,
		endpoint.ID, endpoint.TenantID, endpoint.Kind, endpoint.Code, endpoint.Name, endpoint.Description, endpoint.Status,
		configCipher, encrypted, metadataJSON, endpoint.CreatedBy,
	).Scan(&endpoint.CreatedAt, &endpoint.UpdatedAt); err != nil {
		return err
	}
	endpoint.Encrypted = encrypted
	return nil
}

func (r *IntegrationEndpointRepository) Update(ctx context.Context, q Queryer, endpoint *model.IntegrationEndpoint) error {
	configCipher, encrypted, err := r.encodeConfig(endpoint.Config)
	if err != nil {
		return err
	}
	metadataJSON, err := json.Marshal(orEmptyMap(endpoint.Metadata))
	if err != nil {
		return fmt.Errorf("marshal integration metadata: %w", err)
	}
	query := `
		UPDATE lex_integration_endpoints
		SET name = $3,
		    description = $4,
		    status = $5,
		    config_encrypted = $6,
		    config_encrypted_flag = $7,
		    metadata = $8::jsonb,
		    last_checked_at = $9,
		    last_error = $10,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	if err := q.QueryRow(ctx, query,
		endpoint.TenantID, endpoint.ID, endpoint.Name, endpoint.Description, endpoint.Status,
		configCipher, encrypted, metadataJSON, endpoint.LastCheckedAt, endpoint.LastError,
	).Scan(&endpoint.UpdatedAt); err != nil {
		return err
	}
	endpoint.Encrypted = encrypted
	return nil
}

func (r *IntegrationEndpointRepository) scan(row pgx.Row) (*model.IntegrationEndpoint, error) {
	var (
		endpoint    model.IntegrationEndpoint
		configBlob  string
		encFlag     bool
		metadataRaw []byte
	)
	if err := row.Scan(
		&endpoint.ID, &endpoint.TenantID, &endpoint.Kind, &endpoint.Code, &endpoint.Name,
		&endpoint.Description, &endpoint.Status, &configBlob, &encFlag, &metadataRaw,
		&endpoint.LastCheckedAt, &endpoint.LastError, &endpoint.CreatedBy,
		&endpoint.CreatedAt, &endpoint.UpdatedAt, &endpoint.DeletedAt,
	); err != nil {
		return nil, err
	}
	config, encrypted, err := r.decodeConfig(configBlob)
	if err != nil {
		return nil, err
	}
	endpoint.Config = config
	endpoint.Encrypted = encFlag || encrypted
	if len(metadataRaw) > 0 {
		if err := json.Unmarshal(metadataRaw, &endpoint.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal integration metadata: %w", err)
		}
	}
	if endpoint.Metadata == nil {
		endpoint.Metadata = map[string]any{}
	}
	return &endpoint, nil
}

const integrationSelectColumns = `
	id, tenant_id, kind, code, name, description, status,
	config_encrypted, config_encrypted_flag,
	COALESCE(metadata, '{}'::jsonb) AS metadata,
	last_checked_at, last_error, created_by, created_at, updated_at, deleted_at`

func (r *IntegrationEndpointRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationEndpoint, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+integrationSelectColumns+` FROM lex_integration_endpoints WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id)
	return r.scan(row)
}

func (r *IntegrationEndpointRepository) List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"tenant_id = $1", "deleted_at IS NULL"}
	if kind != "" {
		conditions = append(conditions, fmt.Sprintf("kind = $%d", arg))
		args = append(args, kind)
		arg++
	}
	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", arg))
		args = append(args, status)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	rows, err := r.db.Query(ctx,
		`SELECT `+integrationSelectColumns+` FROM lex_integration_endpoints WHERE `+where+` ORDER BY kind, code`,
		args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.IntegrationEndpoint, 0)
	for rows.Next() {
		endpoint, err := r.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *endpoint)
	}
	return out, rows.Err()
}

// ListTenantIDs returns every tenant that owns at least one live (non-deleted)
// integration endpoint. It is the cross-tenant fan-out source for the
// IntegrationSyncMonitor (mirrors SLAClockRepository.ListTenantIDs).
func (r *IntegrationEndpointRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT tenant_id FROM lex_integration_endpoints WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		out = append(out, tenantID)
	}
	return out, rows.Err()
}

func (r *IntegrationEndpointRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE lex_integration_endpoints SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// MarkChecked records a health-probe result without rotating other fields.
func (r *IntegrationEndpointRepository) MarkChecked(ctx context.Context, tenantID, id uuid.UUID, status model.IntegrationStatus, checkedAt time.Time, lastError *string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE lex_integration_endpoints SET status = $3, last_checked_at = $4, last_error = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, checkedAt.UTC(), lastError)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
