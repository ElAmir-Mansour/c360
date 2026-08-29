package cybervault

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrNotFound is returned when no tenant-scoped cybervault row matches a query.
var ErrNotFound = errors.New("cybervault: not found")

// DBTX is re-exported from the shared repository so callers can pass either a
// pool or the current transaction, matching the surrounding DR stores.
type DBTX = repository.DBTX

// Store persists cybervault inventory and posture assessments. It holds no
// connection state; callers supply the tenant-scoped or system DBTX.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

// StoredPostureAssessment is one persisted posture evaluation. Assessment holds
// the full JSONB round-tripped evaluator output, while the scalar fields support
// efficient latest/list queries.
type StoredPostureAssessment struct {
	ID          string
	TenantID    string
	GroupID     string
	VaultID     string
	Provider    VaultProvider
	Posture     VaultPosture
	Assessment  PostureAssessment
	Score       float64
	Verdict     PostureVerdict
	EvaluatedAt time.Time
	CreatedAt   time.Time
}

const vaultColumns = `
id, tenant_id, group_id, provider, name, external_id, posture, created_at, updated_at`

const upsertVaultSQL = `
INSERT INTO dr_cybervault_vault
    (tenant_id, group_id, provider, name, external_id, posture)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (tenant_id, group_id, provider, external_id) DO UPDATE SET
    name = EXCLUDED.name,
    posture = EXCLUDED.posture,
    updated_at = now()
RETURNING id, tenant_id, group_id, provider, name, external_id, posture, created_at, updated_at`

// UpsertVault creates or refreshes one vault inventory row and back-fills its
// generated fields. The natural key is tenant/group/provider/external_id.
func (s *Store) UpsertVault(ctx context.Context, db DBTX, v *RegisteredVault) error {
	if v == nil {
		return fmt.Errorf("cybervault: vault is nil")
	}
	if v.TenantID == "" || v.GroupID == "" {
		return fmt.Errorf("cybervault: vault requires tenant_id and group_id")
	}
	if v.Provider == "" {
		v.Provider = VaultProviderGeneric
	}
	if v.Name == "" {
		return fmt.Errorf("cybervault: vault requires name")
	}
	if v.ExternalID == "" {
		v.ExternalID = v.Name
	}
	normaliseVaultRecord(v)
	postureJSON, err := json.Marshal(v.Posture)
	if err != nil {
		return fmt.Errorf("cybervault: marshaling vault posture: %w", err)
	}
	stored, err := scanVault(db.QueryRow(ctx, upsertVaultSQL,
		v.TenantID, v.GroupID, v.Provider, v.Name, v.ExternalID, postureJSON,
	))
	if err != nil {
		return fmt.Errorf("cybervault: upserting vault %s: %w", v.ExternalID, err)
	}
	*v = *stored
	return nil
}

const updateVaultSQL = `
UPDATE dr_cybervault_vault
SET provider = $4,
    name = $5,
    external_id = $6,
    posture = $7,
    updated_at = now()
WHERE tenant_id = $1 AND group_id = $2 AND id = $3
RETURNING id, tenant_id, group_id, provider, name, external_id, posture, created_at, updated_at`

// UpdateVault refreshes one existing vault inventory row by its database id.
func (s *Store) UpdateVault(ctx context.Context, db DBTX, v *RegisteredVault) error {
	if v == nil {
		return fmt.Errorf("cybervault: vault is nil")
	}
	if v.TenantID == "" || v.GroupID == "" || v.ID == "" {
		return fmt.Errorf("cybervault: vault update requires tenant_id, group_id, and id")
	}
	if v.Provider == "" {
		v.Provider = VaultProviderGeneric
	}
	if v.Name == "" {
		return fmt.Errorf("cybervault: vault requires name")
	}
	if v.ExternalID == "" {
		v.ExternalID = firstNonEmpty(v.Posture.ID, v.Name)
	}
	normaliseVaultRecord(v)
	postureJSON, err := json.Marshal(v.Posture)
	if err != nil {
		return fmt.Errorf("cybervault: marshaling vault posture: %w", err)
	}
	stored, err := scanVault(db.QueryRow(ctx, updateVaultSQL,
		v.TenantID, v.GroupID, v.ID, v.Provider, v.Name, v.ExternalID, postureJSON,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("vault %s: %w", v.ID, ErrNotFound)
		}
		return fmt.Errorf("cybervault: updating vault %s: %w", v.ID, err)
	}
	*v = *stored
	return nil
}

const listVaultsSQL = `SELECT ` + vaultColumns + `
FROM dr_cybervault_vault
WHERE tenant_id = $1 AND group_id = $2
ORDER BY provider ASC, name ASC, id ASC`

// ListVaults returns all registered vaults for a tenant/group.
func (s *Store) ListVaults(ctx context.Context, db DBTX, tenantID, groupID string) ([]RegisteredVault, error) {
	rows, err := db.Query(ctx, listVaultsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("cybervault: listing vaults for group %s: %w", groupID, err)
	}
	defer rows.Close()

	out := []RegisteredVault{}
	for rows.Next() {
		v, err := scanVault(rows)
		if err != nil {
			return nil, fmt.Errorf("cybervault: scanning vault: %w", err)
		}
		out = append(out, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cybervault: reading vaults for group %s: %w", groupID, err)
	}
	return out, nil
}

const getVaultSQL = `SELECT ` + vaultColumns + `
FROM dr_cybervault_vault
WHERE tenant_id = $1 AND id = $2`

// GetVault loads a registered vault by id within a tenant.
func (s *Store) GetVault(ctx context.Context, db DBTX, tenantID, vaultID string) (*RegisteredVault, error) {
	v, err := scanVault(db.QueryRow(ctx, getVaultSQL, tenantID, vaultID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vault %s: %w", vaultID, ErrNotFound)
		}
		return nil, fmt.Errorf("cybervault: getting vault %s: %w", vaultID, err)
	}
	return v, nil
}

const assessmentColumns = `
id, tenant_id, group_id, vault_id, provider, posture, assessment, score, verdict, evaluated_at, created_at`

const insertAssessmentSQL = `
INSERT INTO dr_cybervault_assessment
    (tenant_id, group_id, vault_id, provider, posture, assessment, score, verdict, evaluated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, tenant_id, group_id, vault_id, provider, posture, assessment, score, verdict, evaluated_at, created_at`

// SaveAssessment persists one evaluator result with the posture evidence that
// produced it, then returns the stored row.
func (s *Store) SaveAssessment(ctx context.Context, db DBTX, tenantID, groupID string, posture VaultPosture, assessment PostureAssessment) (*StoredPostureAssessment, error) {
	if tenantID == "" || groupID == "" {
		return nil, fmt.Errorf("cybervault: assessment requires tenant_id and group_id")
	}
	if assessment.VaultID == "" {
		assessment.VaultID = posture.ID
	}
	if assessment.Provider == "" {
		assessment.Provider = posture.Provider
	}
	if assessment.EvaluatedAt.IsZero() {
		assessment.EvaluatedAt = time.Now().UTC()
	}
	if posture.Provider == "" {
		posture.Provider = assessment.Provider
	}
	if posture.ID == "" {
		posture.ID = assessment.VaultID
	}
	postureJSON, err := json.Marshal(posture)
	if err != nil {
		return nil, fmt.Errorf("cybervault: marshaling assessment posture: %w", err)
	}
	assessmentJSON, err := json.Marshal(assessment)
	if err != nil {
		return nil, fmt.Errorf("cybervault: marshaling assessment: %w", err)
	}
	stored, err := scanAssessment(db.QueryRow(ctx, insertAssessmentSQL,
		tenantID, groupID, assessment.VaultID, assessment.Provider,
		postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, assessment.EvaluatedAt.UTC(),
	))
	if err != nil {
		return nil, fmt.Errorf("cybervault: saving assessment for vault %s: %w", assessment.VaultID, err)
	}
	return stored, nil
}

const listAssessmentsSQL = `SELECT ` + assessmentColumns + `
FROM dr_cybervault_assessment
WHERE tenant_id = $1 AND vault_id = $2
ORDER BY evaluated_at DESC, created_at DESC
LIMIT $3`

// ListAssessments returns a vault's posture assessments, newest first.
func (s *Store) ListAssessments(ctx context.Context, db DBTX, tenantID, vaultID string, limit int) ([]StoredPostureAssessment, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := db.Query(ctx, listAssessmentsSQL, tenantID, vaultID, limit)
	if err != nil {
		return nil, fmt.Errorf("cybervault: listing assessments for vault %s: %w", vaultID, err)
	}
	defer rows.Close()

	out := []StoredPostureAssessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, fmt.Errorf("cybervault: scanning assessment: %w", err)
		}
		out = append(out, *a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cybervault: reading assessments for vault %s: %w", vaultID, err)
	}
	return out, nil
}

const listLatestAssessmentsSQL = `
WITH latest AS (
    SELECT DISTINCT ON (vault_id) ` + assessmentColumns + `
    FROM dr_cybervault_assessment
    WHERE tenant_id = $1 AND group_id = $2
    ORDER BY vault_id, evaluated_at DESC, created_at DESC
)
SELECT ` + assessmentColumns + `
FROM latest
ORDER BY evaluated_at DESC, created_at DESC`

// ListLatestAssessments returns the newest assessment for each assessed vault
// in a tenant/group.
func (s *Store) ListLatestAssessments(ctx context.Context, db DBTX, tenantID, groupID string) ([]StoredPostureAssessment, error) {
	rows, err := db.Query(ctx, listLatestAssessmentsSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("cybervault: listing latest assessments for group %s: %w", groupID, err)
	}
	defer rows.Close()

	out := []StoredPostureAssessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, fmt.Errorf("cybervault: scanning latest assessment: %w", err)
		}
		out = append(out, *a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cybervault: reading latest assessments for group %s: %w", groupID, err)
	}
	return out, nil
}

const latestAssessmentSQL = `SELECT ` + assessmentColumns + `
FROM dr_cybervault_assessment
WHERE tenant_id = $1 AND vault_id = $2
ORDER BY evaluated_at DESC, created_at DESC
LIMIT 1`

// GetLatestAssessment returns the newest posture assessment for a vault.
func (s *Store) GetLatestAssessment(ctx context.Context, db DBTX, tenantID, vaultID string) (*StoredPostureAssessment, error) {
	a, err := scanAssessment(db.QueryRow(ctx, latestAssessmentSQL, tenantID, vaultID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vault %s assessment: %w", vaultID, ErrNotFound)
		}
		return nil, fmt.Errorf("cybervault: getting latest assessment for vault %s: %w", vaultID, err)
	}
	return a, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanVault(row scanner) (*RegisteredVault, error) {
	var v RegisteredVault
	var postureJSON []byte
	if err := row.Scan(
		&v.ID, &v.TenantID, &v.GroupID, &v.Provider, &v.Name, &v.ExternalID,
		&postureJSON, &v.CreatedAt, &v.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(postureJSON) > 0 {
		if err := json.Unmarshal(postureJSON, &v.Posture); err != nil {
			return nil, fmt.Errorf("unmarshal posture: %w", err)
		}
	}
	normaliseVaultRecord(&v)
	return &v, nil
}

func scanAssessment(row scanner) (*StoredPostureAssessment, error) {
	var a StoredPostureAssessment
	var postureJSON, assessmentJSON []byte
	if err := row.Scan(
		&a.ID, &a.TenantID, &a.GroupID, &a.VaultID, &a.Provider,
		&postureJSON, &assessmentJSON, &a.Score, &a.Verdict, &a.EvaluatedAt, &a.CreatedAt,
	); err != nil {
		return nil, err
	}
	if len(postureJSON) > 0 {
		if err := json.Unmarshal(postureJSON, &a.Posture); err != nil {
			return nil, fmt.Errorf("unmarshal posture: %w", err)
		}
	}
	if len(assessmentJSON) > 0 {
		if err := json.Unmarshal(assessmentJSON, &a.Assessment); err != nil {
			return nil, fmt.Errorf("unmarshal assessment: %w", err)
		}
	}
	if a.Assessment.VaultID == "" {
		a.Assessment.VaultID = a.VaultID
	}
	if a.Assessment.Provider == "" {
		a.Assessment.Provider = a.Provider
	}
	if a.Assessment.EvaluatedAt.IsZero() {
		a.Assessment.EvaluatedAt = a.EvaluatedAt
	}
	return &a, nil
}
