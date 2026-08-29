package selfdr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared DR repository so this package's store and
// service speak the same execution-context type: a *pgxpool.Pool for a single
// read, or the caller's open transaction so the assessment header and its outbox
// event commit atomically. This package owns its two tables
// (dr_selfdr_assessment, dr_selfdr_artifact) via raw queries.
type DBTX = repository.DBTX

// Store persists self-DR readiness assessments and the WORM-sealed artifact
// records that back them. It holds no state; the caller supplies the DBTX so a
// request runs under a tenant transaction (RLS backstop).
type Store struct{}

// NewStore constructs a stateless store.
func NewStore() *Store { return &Store{} }

// SaveAssessment inserts an assessment header, storing the findings list and
// restore plan as JSONB. It populates the generated id and created_at on a.
func (s *Store) SaveAssessment(ctx context.Context, db DBTX, a *StoredAssessment) error {
	findingsJSON, err := json.Marshal(a.Findings)
	if err != nil {
		return fmt.Errorf("marshal findings: %w", err)
	}
	planJSON, err := json.Marshal(a.RestorePlan)
	if err != nil {
		return fmt.Errorf("marshal restore plan: %w", err)
	}
	const q = `
INSERT INTO dr_selfdr_assessment
    (tenant_id, profile_id, verdict, critical, warning, info, findings, restore_plan, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING id, created_at`
	if err := db.QueryRow(ctx, q,
		a.TenantID, a.ProfileID, string(a.Verdict), a.Critical, a.Warning, a.Info,
		findingsJSON, planJSON, a.CreatedBy,
	).Scan(&a.ID, &a.CreatedAt); err != nil {
		return fmt.Errorf("insert selfdr assessment: %w", err)
	}
	return nil
}

// GetAssessment loads an assessment header by id within the db's RLS scope.
// Returns ErrAssessmentNotFound when no row matches.
func (s *Store) GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error) {
	const q = `
SELECT id, tenant_id, profile_id, verdict, critical, warning, info, findings, restore_plan, created_by, created_at
FROM dr_selfdr_assessment
WHERE id = $1`
	return scanAssessment(db.QueryRow(ctx, q, id))
}

// LatestAssessment loads the most recent assessment within the db's RLS scope.
// Returns ErrAssessmentNotFound when the tenant has none.
func (s *Store) LatestAssessment(ctx context.Context, db DBTX) (*StoredAssessment, error) {
	const q = `
SELECT id, tenant_id, profile_id, verdict, critical, warning, info, findings, restore_plan, created_by, created_at
FROM dr_selfdr_assessment
ORDER BY created_at DESC, id DESC
LIMIT 1`
	return scanAssessment(db.QueryRow(ctx, q))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanAssessment(row rowScanner) (*StoredAssessment, error) {
	var (
		a            StoredAssessment
		verdict      string
		findingsJSON []byte
		planJSON     []byte
	)
	err := row.Scan(
		&a.ID, &a.TenantID, &a.ProfileID, &verdict, &a.Critical, &a.Warning,
		&a.Info, &findingsJSON, &planJSON, &a.CreatedBy, &a.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAssessmentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get selfdr assessment: %w", err)
	}
	a.Verdict = Verdict(verdict)
	if len(findingsJSON) > 0 {
		if err := json.Unmarshal(findingsJSON, &a.Findings); err != nil {
			return nil, fmt.Errorf("unmarshal findings: %w", err)
		}
	}
	if a.Findings == nil {
		a.Findings = []Finding{}
	}
	if len(planJSON) > 0 {
		if err := json.Unmarshal(planJSON, &a.RestorePlan); err != nil {
			return nil, fmt.Errorf("unmarshal restore plan: %w", err)
		}
	}
	return &a, nil
}

// SaveArtifact inserts the durable record of one sealed self-DR artifact, storing
// the kind-specific evidence object as JSONB. It populates the generated id and
// created_at on art.
func (s *Store) SaveArtifact(ctx context.Context, db DBTX, art *StoredArtifact) error {
	evidenceJSON, err := json.Marshal(art.Evidence)
	if err != nil {
		return fmt.Errorf("marshal artifact evidence: %w", err)
	}
	const q = `
INSERT INTO dr_selfdr_artifact
    (tenant_id, kind, component_id, component_kind, object_key, uri, version_id,
     sha256, size_bytes, captured_at, retain_until, location_id, immutable, encrypted, evidence, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
RETURNING id, created_at`
	if err := db.QueryRow(ctx, q,
		art.TenantID, string(art.Kind), art.ComponentID, string(art.ComponentKind),
		art.Key, art.URI, art.VersionID, art.SHA256, art.SizeBytes, art.CapturedAt,
		nullableTime(art.RetainUntil), art.LocationID, art.Immutable, art.Encrypted,
		evidenceJSON, art.CreatedBy,
	).Scan(&art.ID, &art.CreatedAt); err != nil {
		return fmt.Errorf("insert selfdr artifact: %w", err)
	}
	return nil
}

// ListArtifacts loads the most recent sealed artifacts (newest first) within the
// db's RLS scope, capped at limit.
func (s *Store) ListArtifacts(ctx context.Context, db DBTX, limit int) ([]StoredArtifact, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
SELECT id, tenant_id, kind, component_id, component_kind, object_key, uri, version_id,
       sha256, size_bytes, captured_at, retain_until, location_id, immutable, encrypted, evidence, created_by, created_at
FROM dr_selfdr_artifact
ORDER BY created_at DESC, id DESC
LIMIT $1`
	rows, err := db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("query selfdr artifacts: %w", err)
	}
	defer rows.Close()
	out := make([]StoredArtifact, 0)
	for rows.Next() {
		art, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, art)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate selfdr artifacts: %w", err)
	}
	return out, nil
}

// LatestBackupEvidence returns the BackupEvidence from the most recent
// control-plane-backup artifact for a component, or ok=false when none exists.
// The service uses it to overlay the real, WORM-sealed backup evidence onto the
// operator-described component before evaluating readiness.
func (s *Store) LatestBackupEvidence(ctx context.Context, db DBTX, componentID string) (BackupEvidence, bool, error) {
	const q = `
SELECT evidence
FROM dr_selfdr_artifact
WHERE kind = $1 AND component_id = $2
ORDER BY captured_at DESC, created_at DESC
LIMIT 1`
	var raw []byte
	err := db.QueryRow(ctx, q, string(ArtifactKindControlPlaneBackup), componentID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return BackupEvidence{}, false, nil
	}
	if err != nil {
		return BackupEvidence{}, false, fmt.Errorf("query latest backup evidence: %w", err)
	}
	var ev BackupEvidence
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &ev); err != nil {
			return BackupEvidence{}, false, fmt.Errorf("unmarshal backup evidence: %w", err)
		}
	}
	return ev, true, nil
}

// LatestBundleEvidence returns the OfflineRestoreBundle from the most recent
// offline-bundle artifact, or ok=false when none exists.
func (s *Store) LatestBundleEvidence(ctx context.Context, db DBTX) (OfflineRestoreBundle, bool, error) {
	const q = `
SELECT evidence
FROM dr_selfdr_artifact
WHERE kind = $1
ORDER BY captured_at DESC, created_at DESC
LIMIT 1`
	var raw []byte
	err := db.QueryRow(ctx, q, string(ArtifactKindOfflineBundle)).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return OfflineRestoreBundle{}, false, nil
	}
	if err != nil {
		return OfflineRestoreBundle{}, false, fmt.Errorf("query latest bundle evidence: %w", err)
	}
	var ev OfflineRestoreBundle
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &ev); err != nil {
			return OfflineRestoreBundle{}, false, fmt.Errorf("unmarshal bundle evidence: %w", err)
		}
	}
	return ev, true, nil
}

func scanArtifact(rows pgx.Rows) (StoredArtifact, error) {
	var (
		art           StoredArtifact
		kind          string
		componentKind string
		retainUntil   *time.Time
		evidenceJSON  []byte
	)
	if err := rows.Scan(
		&art.ID, &art.TenantID, &kind, &art.ComponentID, &componentKind, &art.Key,
		&art.URI, &art.VersionID, &art.SHA256, &art.SizeBytes, &art.CapturedAt,
		&retainUntil, &art.LocationID, &art.Immutable, &art.Encrypted, &evidenceJSON,
		&art.CreatedBy, &art.CreatedAt,
	); err != nil {
		return StoredArtifact{}, fmt.Errorf("scan selfdr artifact: %w", err)
	}
	art.Kind = ArtifactKind(kind)
	art.ComponentKind = ComponentKind(componentKind)
	if retainUntil != nil {
		art.RetainUntil = *retainUntil
	}
	if len(evidenceJSON) > 0 {
		art.Evidence = json.RawMessage(evidenceJSON)
	}
	return art, nil
}

func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
