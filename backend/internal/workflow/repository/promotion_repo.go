package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/workflow/model"
)

// PromotionDBTX is the subset of pgx satisfied by both *pgxpool.Pool and pgx.Tx
// (and pgxmock's pool/tx types). Every promotion method takes one so the caller
// chooses the execution context: the pool for single reads, or the promote
// service's open transaction so the stage change commits atomically with the
// workflow.definition.promoted outbox event (DESIGN §3.3, "every state change is
// transactional with its events").
type PromotionDBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Workflow definition lifecycle stages added by migration 000003_promotion. A
// draft is born in StageDev and is advanced one step at a time by the promote
// FSM. The model package owns the existing definition constants; these stage
// constants live with the promotion code that introduced the column.
const (
	StageDev     = "dev"
	StageStaging = "staging"
	StageProd    = "prod"
)

// ValidStages is the set of allowed stage values, mirroring the CHECK
// constraint workflow_definitions_stage_check.
var ValidStages = map[string]bool{
	StageDev:     true,
	StageStaging: true,
	StageProd:    true,
}

// ErrPromotionConflict is the 409-class sentinel for promotion rejections: an
// immutable version, or an illegal FSM move (skip/backwards/no-op/unknown
// stage). It wraps model.ErrConflict so existing errors.Is checks against the
// model sentinel continue to match while callers can also test the more
// specific promotion sentinel.
var ErrPromotionConflict = fmt.Errorf("workflow promotion conflict: %w", model.ErrConflict)

// PromotionRecord is the promotion-relevant projection of a workflow_definitions
// row: the lineage key, the current stage, the immutability flag, and the
// promotion stamps. It deliberately does not carry the JSONB step graph — the
// promote FSM and immutability guard only reason about lifecycle metadata, so
// loading the heavy columns would be wasted work.
type PromotionRecord struct {
	ID            string     `json:"id"`
	TenantID      string     `json:"tenant_id"`
	Name          string     `json:"name"`
	Version       int        `json:"version"`
	Status        string     `json:"status"`
	DefinitionKey string     `json:"definition_key"`
	Stage         string     `json:"stage"`
	Immutable     bool       `json:"immutable"`
	PromotedAt    *time.Time `json:"promoted_at,omitempty"`
	PromotedBy    string     `json:"promoted_by,omitempty"`
}

// PromotionRepository persists the promotion lifecycle of workflow definitions.
// It holds no connection itself; every method takes a PromotionDBTX so the
// service can pass either the pool or an open transaction.
type PromotionRepository struct{}

// NewPromotionRepository constructs a PromotionRepository.
func NewPromotionRepository() *PromotionRepository {
	return &PromotionRepository{}
}

const promotionSelectCols = `id, tenant_id, name, version, status, definition_key, stage, immutable, promoted_at, promoted_by`

// GetByID loads the promotion record for one definition version scoped to a
// tenant. Soft-deleted rows are excluded. Returns model.ErrNotFound when no
// matching live row exists.
func (r *PromotionRepository) GetByID(ctx context.Context, db PromotionDBTX, tenantID, id string) (*PromotionRecord, error) {
	query := `
		SELECT ` + promotionSelectCols + `
		FROM workflow_definitions
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	return scanPromotionRecord(db.QueryRow(ctx, query, id, tenantID))
}

// GetLineageKey returns the stable definition_key for a definition version. It
// is the cheap lookup the service uses to resolve a version id to its lineage
// before listing siblings. Returns model.ErrNotFound when the row is missing.
func (r *PromotionRepository) GetLineageKey(ctx context.Context, db PromotionDBTX, tenantID, id string) (string, error) {
	query := `
		SELECT definition_key
		FROM workflow_definitions
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	var key string
	err := db.QueryRow(ctx, query, id, tenantID).Scan(&key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
		}
		return "", fmt.Errorf("getting lineage key for %s: %w", id, err)
	}
	return key, nil
}

// SetStage advances a definition version to a new stage. The WHERE clause pins
// id+tenant and excludes soft-deleted rows; ErrNotFound is returned when nothing
// is updated. Stage validation and FSM ordering are enforced by the service —
// this method is the plain persistence primitive.
func (r *PromotionRepository) SetStage(ctx context.Context, db PromotionDBTX, tenantID, id, stage string) error {
	query := `
		UPDATE workflow_definitions
		SET stage = $3, updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query, id, tenantID, stage)
	if err != nil {
		return fmt.Errorf("setting stage for definition %s: %w", id, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// SetImmutable flips the immutable flag on a definition version. Once true, the
// INTEGRATE-wired ImmutableGuard blocks Update/Archive on the version.
func (r *PromotionRepository) SetImmutable(ctx context.Context, db PromotionDBTX, tenantID, id string, immutable bool) error {
	query := `
		UPDATE workflow_definitions
		SET immutable = $3, updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query, id, tenantID, immutable)
	if err != nil {
		return fmt.Errorf("setting immutable for definition %s: %w", id, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// StampPromotion records who promoted a version and when. promotedAt is passed
// explicitly (rather than now()) so the service can use a single timestamp
// across the whole promote transaction and so tests are deterministic.
func (r *PromotionRepository) StampPromotion(ctx context.Context, db PromotionDBTX, tenantID, id, promotedBy string, promotedAt time.Time) error {
	query := `
		UPDATE workflow_definitions
		SET promoted_at = $3, promoted_by = $4, updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query, id, tenantID, promotedAt, nilIfEmpty(promotedBy))
	if err != nil {
		return fmt.Errorf("stamping promotion for definition %s: %w", id, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// ListByLineage returns every live version that shares a definition_key within a
// tenant, newest version first, so callers see the full lineage with each
// version's stage and immutability. Returns an empty slice (not an error) when
// the lineage has no live rows.
func (r *PromotionRepository) ListByLineage(ctx context.Context, db PromotionDBTX, tenantID, definitionKey string) ([]*PromotionRecord, error) {
	query := `
		SELECT ` + promotionSelectCols + `
		FROM workflow_definitions
		WHERE tenant_id = $1 AND definition_key = $2 AND deleted_at IS NULL
		ORDER BY version DESC`

	rows, err := db.Query(ctx, query, tenantID, definitionKey)
	if err != nil {
		return nil, fmt.Errorf("listing lineage %s: %w", definitionKey, err)
	}
	defer rows.Close()

	var records []*PromotionRecord
	for rows.Next() {
		rec, err := scanPromotionRowValues(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating lineage rows: %w", err)
	}
	if records == nil {
		records = []*PromotionRecord{}
	}
	return records, nil
}

// CountProdActiveSiblings returns how many OTHER live versions of the same
// lineage (definition_key) are BOTH stage='prod' AND status='active', excluding
// the version identified by excludeID. It is the cross-check the promote FSM runs
// before advancing a version into prod: a lineage may have at most ONE
// prod-promoted active version at a time, so a non-zero count fails the promote
// closed (ErrPromotionConflict). Runs on whatever PromotionDBTX the caller
// supplies (the open promote transaction) so the check and the stage change are
// atomic. Soft-deleted rows are excluded.
func (r *PromotionRepository) CountProdActiveSiblings(ctx context.Context, db PromotionDBTX, tenantID, definitionKey, excludeID string) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM workflow_definitions
		WHERE tenant_id = $1
		  AND definition_key = $2
		  AND id <> $3
		  AND stage = 'prod'
		  AND status = 'active'
		  AND deleted_at IS NULL`

	var n int
	if err := db.QueryRow(ctx, query, tenantID, definitionKey, excludeID).Scan(&n); err != nil {
		return 0, fmt.Errorf("counting prod-active siblings for lineage %s: %w", definitionKey, err)
	}
	return n, nil
}

// scanPromotionRecord scans a single row (pgx.Row) into a PromotionRecord,
// translating pgx.ErrNoRows into model.ErrNotFound.
func scanPromotionRecord(row pgx.Row) (*PromotionRecord, error) {
	rec, err := scanPromotionRowValues(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("definition: %w", model.ErrNotFound)
		}
		return nil, err
	}
	return rec, nil
}

// rowScanner is the shared scan surface of pgx.Row and pgx.Rows so a single
// scan helper serves both the single-row and iteration paths.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanPromotionRowValues maps the promotionSelectCols column order onto a
// PromotionRecord, normalizing the nullable promoted_by/promoted_at columns.
func scanPromotionRowValues(s rowScanner) (*PromotionRecord, error) {
	var (
		rec                PromotionRecord
		promotedByNullable *string
	)
	if err := s.Scan(
		&rec.ID,
		&rec.TenantID,
		&rec.Name,
		&rec.Version,
		&rec.Status,
		&rec.DefinitionKey,
		&rec.Stage,
		&rec.Immutable,
		&rec.PromotedAt,
		&promotedByNullable,
	); err != nil {
		return nil, fmt.Errorf("scanning promotion record: %w", err)
	}
	if promotedByNullable != nil {
		rec.PromotedBy = *promotedByNullable
	}
	return &rec, nil
}
