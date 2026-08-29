package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalHoldRepository persists litigation/regulatory holds (FR-WATHEEQ-005).
// Every query is tenant-scoped explicitly and is additionally protected by the
// RLS policies declared in migration 000014.
type LegalHoldRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalHoldRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalHoldRepository {
	return &LegalHoldRepository{db: db, logger: logger}
}

// Create inserts a new legal hold. The partial unique index on
// (tenant_id, subject_type, subject_id) WHERE status = 'active' guarantees a
// single active hold per subject; a duplicate surfaces as a unique violation
// (SQLSTATE 23505) that the service translates into a 409.
func (r *LegalHoldRepository) Create(ctx context.Context, q Queryer, hold *model.LegalHold) error {
	query := `
		INSERT INTO legal_holds (
			id, tenant_id, subject_type, subject_id, reason, reference, status,
			custodian, notes, applied_by, applied_at, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		hold.ID, hold.TenantID, hold.SubjectType, hold.SubjectID, hold.Reason, hold.Reference, hold.Status,
		hold.Custodian, hold.Notes, hold.AppliedBy, hold.AppliedAt, hold.Metadata,
	).Scan(&hold.CreatedAt, &hold.UpdatedAt)
}

// Get loads a single hold by id within the tenant.
func (r *LegalHoldRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalHold, error) {
	query := legalHoldJSONSelect(`h.tenant_id = $1 AND h.id = $2`)
	return queryRowJSON[model.LegalHold](ctx, r.db, query, tenantID, id)
}

// GetActiveForSubject returns the single active hold for a subject, or
// pgx.ErrNoRows when the subject is not under hold.
func (r *LegalHoldRepository) GetActiveForSubject(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (*model.LegalHold, error) {
	query := legalHoldJSONSelect(`h.tenant_id = $1 AND h.subject_type = $2 AND h.subject_id = $3 AND h.status = 'active'`)
	return queryRowJSON[model.LegalHold](ctx, r.db, query, tenantID, subjectType, subjectID)
}

// ListActiveForSubject returns all active holds for a subject (normally zero or
// one, but the API returns a slice so callers do not depend on the uniqueness
// invariant for correctness).
func (r *LegalHoldRepository) ListActiveForSubject(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) ([]model.LegalHold, error) {
	query := legalHoldJSONSelect(`h.tenant_id = $1 AND h.subject_type = $2 AND h.subject_id = $3 AND h.status = 'active'`) +
		` ORDER BY t.applied_at DESC`
	return queryListJSON[model.LegalHold](ctx, r.db, query, tenantID, subjectType, subjectID)
}

// IsSubjectHeld reports whether the subject currently has an active hold. It is
// a fast existence check used on the destructive-operation enforcement path.
func (r *LegalHoldRepository) IsSubjectHeld(ctx context.Context, q Queryer, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_holds
			WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND status = 'active'
		)`,
		tenantID, subjectType, subjectID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// List returns a tenant-scoped, filtered, paginated set of holds plus the total
// matching count.
func (r *LegalHoldRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.LegalHoldListFilters) ([]model.LegalHold, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"h.tenant_id = $1"}
	if filters.SubjectType != nil {
		conditions = append(conditions, fmt.Sprintf("h.subject_type = $%d", arg))
		args = append(args, *filters.SubjectType)
		arg++
	}
	if filters.SubjectID != nil {
		conditions = append(conditions, fmt.Sprintf("h.subject_id = $%d", arg))
		args = append(args, *filters.SubjectID)
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("h.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if strings.TrimSpace(filters.Reference) != "" {
		conditions = append(conditions, fmt.Sprintf("h.reference ILIKE '%%' || $%d || '%%'", arg))
		args = append(args, strings.TrimSpace(filters.Reference))
		arg++
	}

	where := buildWhere(conditions)

	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM legal_holds h WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	sortColumn, ok := legalHoldSortColumn(filters.SortColumn)
	if !ok {
		sortColumn = "t.applied_at"
	}
	sortDir := "DESC"
	if strings.EqualFold(filters.SortDirection, "asc") {
		sortDir = "ASC"
	}

	page, perPage := normalizePage(filters.Page, filters.PerPage)
	offset := (page - 1) * perPage

	query := legalHoldJSONSelect(where) +
		fmt.Sprintf(" ORDER BY %s %s, t.id ASC LIMIT $%d OFFSET $%d", sortColumn, sortDir, arg, arg+1)
	args = append(args, perPage, offset)

	items, err := queryListJSON[model.LegalHold](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Release marks an active hold as released. It is idempotent at the SQL level:
// only an active row is updated, so a second release affects zero rows and the
// caller receives pgx.ErrNoRows.
func (r *LegalHoldRepository) Release(ctx context.Context, q Queryer, tenantID, id, releasedBy uuid.UUID, releasedAt time.Time, releaseNote string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_holds
		SET status = 'released',
		    released_by = $3,
		    released_at = $4,
		    release_note = $5,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
		tenantID, id, releasedBy, releasedAt, releaseNote,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func legalHoldJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT h.id, h.tenant_id, h.subject_type, h.subject_id, h.reason, h.reference,
			       h.status, h.custodian, h.notes, h.applied_by, h.applied_at,
			       h.released_by, h.released_at, h.release_note,
			       COALESCE(h.metadata, '{}'::jsonb) AS metadata,
			       h.created_at, h.updated_at
			FROM legal_holds h
			WHERE ` + where + `
		) t`
}

func legalHoldSortColumn(column string) (string, bool) {
	switch column {
	case "applied_at":
		return "t.applied_at", true
	case "released_at":
		return "t.released_at", true
	case "status":
		return "t.status", true
	case "subject_type":
		return "t.subject_type", true
	case "created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
