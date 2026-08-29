package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// CaseClassificationRepository persists the admin-extensible legal-case
// classification taxonomy (legal_case_classifications) plus an append-only
// governance audit log (legal_case_classification_audit_log). Reads project rows
// through row_to_json so the JSONB name LocalizedText round-trips cleanly via
// queryRowJSON/queryListJSON; writes marshal the LocalizedText struct to JSONB
// and maintain the materialized ancestor path.
type CaseClassificationRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseClassificationRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseClassificationRepository {
	return &CaseClassificationRepository{db: db, logger: logger}
}

func (r *CaseClassificationRepository) Create(ctx context.Context, q Queryer, c *model.CaseClassification) error {
	nameJSON, err := json.Marshal(c.Name)
	if err != nil {
		return fmt.Errorf("marshal case classification name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case classification metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_classifications (
			id, tenant_id, parent_id, code, name, path, is_system, active, sort, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.ParentID, c.Code, nameJSON, c.Path, c.IsSystem, c.Active, c.Sort, metadataJSON, c.CreatedBy,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *CaseClassificationRepository) Update(ctx context.Context, q Queryer, c *model.CaseClassification) error {
	nameJSON, err := json.Marshal(c.Name)
	if err != nil {
		return fmt.Errorf("marshal case classification name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case classification metadata: %w", err)
	}
	query := `
		UPDATE legal_case_classifications
		SET parent_id = $3,
		    code = $4,
		    name = $5::jsonb,
		    path = $6,
		    active = $7,
		    sort = $8,
		    metadata = $9::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		c.TenantID, c.ID, c.ParentID, c.Code, nameJSON, c.Path, c.Active, c.Sort, metadataJSON,
	).Scan(&c.UpdatedAt)
}

// RepathDescendants rewrites materialized paths for every descendant of id after
// id itself has been moved. newSelfPath must be the moved node's new path
// including id, while descendant suffixes below id are preserved.
func (r *CaseClassificationRepository) RepathDescendants(ctx context.Context, q Queryer, tenantID, id uuid.UUID, newSelfPath []string) error {
	_, err := q.Exec(ctx, `
		UPDATE legal_case_classifications
		SET path = $3::text[] || COALESCE(path[array_position(path, $2::text) + 1:array_length(path, 1)], '{}'::text[]),
		    updated_at = now()
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND $2 = ANY(path)`,
		tenantID, id.String(), newSelfPath,
	)
	return err
}

func (r *CaseClassificationRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.CaseClassification, error) {
	query := caseClassificationJSONSelect(`c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`)
	return queryRowJSON[model.CaseClassification](ctx, r.db, query, tenantID, id)
}

func (r *CaseClassificationRepository) GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.CaseClassification, error) {
	query := caseClassificationJSONSelect(`c.tenant_id = $1 AND c.code = $2 AND c.deleted_at IS NULL`)
	return queryRowJSON[model.CaseClassification](ctx, r.db, query, tenantID, strings.ToUpper(strings.TrimSpace(code)))
}

func (r *CaseClassificationRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.CaseClassificationListFilters) ([]model.CaseClassification, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(c.code ILIKE '%%' || $%d || '%%' OR c.name->>'en' ILIKE '%%' || $%d || '%%' OR c.name->>'ar' ILIKE '%%' || $%d || '%%')", arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.ParentID != nil {
		conditions = append(conditions, fmt.Sprintf("c.parent_id = $%d", arg))
		args = append(args, *filters.ParentID)
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("c.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	if filters.IsSystem != nil {
		conditions = append(conditions, fmt.Sprintf("c.is_system = $%d", arg))
		args = append(args, *filters.IsSystem)
		arg++
	}
	if filters.RootOnly {
		conditions = append(conditions, "c.parent_id IS NULL")
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_case_classifications c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.CaseClassification{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.sort"
	if mapped, ok := caseClassificationSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "ASC"
	if filters.SortDirection == "desc" {
		orderDir = "DESC"
	}
	query := caseClassificationJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s, t.code ASC LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.CaseClassification](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// ListAll returns every non-deleted classification for the tenant ordered by
// path depth then sort then code, suitable for assembling the full tree without
// pagination.
func (r *CaseClassificationRepository) ListAll(ctx context.Context, tenantID uuid.UUID) ([]model.CaseClassification, error) {
	query := caseClassificationJSONSelect(`c.tenant_id = $1 AND c.deleted_at IS NULL`) +
		` ORDER BY COALESCE(array_length(t.path, 1), 0) ASC, t.sort ASC, t.code ASC`
	return queryListJSON[model.CaseClassification](ctx, r.db, query, tenantID)
}

func (r *CaseClassificationRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_case_classifications SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// HasChildren reports whether the classification has any non-deleted child node;
// used to refuse deletion of a node that still anchors a subtree.
func (r *CaseClassificationRepository) HasChildren(ctx context.Context, tenantID, id uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_case_classifications
			WHERE tenant_id = $1 AND parent_id = $2 AND deleted_at IS NULL
		)`,
		tenantID, id,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// Ancestors returns the classification rows along the materialized path
// (root-first), followed by the classification itself, ordered root -> leaf.
// Used by cascade-path resolution. Deleted ancestors are excluded.
func (r *CaseClassificationRepository) Ancestors(ctx context.Context, tenantID, id uuid.UUID) ([]model.CaseClassification, error) {
	query := caseClassificationJSONSelect(`c.tenant_id = $1 AND c.deleted_at IS NULL AND c.id IN (
		SELECT (unnest(path))::uuid FROM legal_case_classifications WHERE tenant_id = $1 AND id = $2
		UNION SELECT $2
	)`) + ` ORDER BY array_length(t.path, 1) ASC NULLS FIRST, t.sort ASC, t.created_at ASC`
	return queryListJSON[model.CaseClassification](ctx, r.db, query, tenantID, id)
}

// AppendAudit writes one append-only governance audit row. before/after are the
// JSON snapshots (nil-safe) of the classification around the mutation.
func (r *CaseClassificationRepository) AppendAudit(ctx context.Context, q Queryer, tenantID, classificationID uuid.UUID, action string, actorID *uuid.UUID, before, after any) error {
	beforeJSON, err := marshalAuditSnapshot(before)
	if err != nil {
		return fmt.Errorf("marshal classification audit before: %w", err)
	}
	afterJSON, err := marshalAuditSnapshot(after)
	if err != nil {
		return fmt.Errorf("marshal classification audit after: %w", err)
	}
	_, err = q.Exec(ctx, `
		INSERT INTO legal_case_classification_audit_log (
			tenant_id, classification_id, action, actor_id, before, after
		) VALUES ($1,$2,$3,$4,$5,$6)`,
		tenantID, classificationID, action, actorID, beforeJSON, afterJSON,
	)
	return err
}

// Usage returns the tenant-scoped count of legal_cases directly referencing each
// classification (direct classification_id references only, not descendants).
// Classifications with zero matters are omitted from the map.
func (r *CaseClassificationRepository) Usage(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]int, error) {
	rows, err := r.db.Query(ctx, `
		SELECT classification_id, COUNT(*)
		FROM legal_cases
		WHERE tenant_id = $1 AND classification_id IS NOT NULL AND deleted_at IS NULL
		GROUP BY classification_id`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := make(map[uuid.UUID]int)
	for rows.Next() {
		var id uuid.UUID
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		usage[id] = count
	}
	return usage, rows.Err()
}

// ReassignMatters reassigns every legal_cases row referencing the source
// classification to target for the tenant, returning the number of rows moved.
func (r *CaseClassificationRepository) ReassignMatters(ctx context.Context, q Queryer, tenantID, source, target uuid.UUID) (int64, error) {
	ct, err := q.Exec(ctx, `
		UPDATE legal_cases
		SET classification_id = $3, updated_at = now()
		WHERE tenant_id = $1 AND classification_id = $2 AND deleted_at IS NULL`,
		tenantID, source, target,
	)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// Deactivate flags a classification inactive within an open transaction.
func (r *CaseClassificationRepository) Deactivate(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_classifications
		SET active = false, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ListAudit returns the append-only governance audit rows for one classification,
// tenant-scoped and newest-first (matching idx_legal_case_classification_audit_classification).
func (r *CaseClassificationRepository) ListAudit(ctx context.Context, tenantID, classificationID uuid.UUID) ([]dto.CaseClassificationAuditEntry, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, classification_id, action, actor_id, before, after, created_at
		FROM legal_case_classification_audit_log
		WHERE tenant_id = $1 AND classification_id = $2
		ORDER BY created_at DESC, id DESC`,
		tenantID, classificationID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]dto.CaseClassificationAuditEntry, 0)
	for rows.Next() {
		var entry dto.CaseClassificationAuditEntry
		var beforeRaw, afterRaw []byte
		if err := rows.Scan(&entry.ID, &entry.ClassificationID, &entry.Action, &entry.ActorID, &beforeRaw, &afterRaw, &entry.CreatedAt); err != nil {
			return nil, err
		}
		if len(beforeRaw) > 0 {
			if err := json.Unmarshal(beforeRaw, &entry.Before); err != nil {
				return nil, fmt.Errorf("unmarshal classification audit before: %w", err)
			}
		}
		if len(afterRaw) > 0 {
			if err := json.Unmarshal(afterRaw, &entry.After); err != nil {
				return nil, fmt.Errorf("unmarshal classification audit after: %w", err)
			}
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

// SiblingIDs returns the ids of every non-deleted classification directly under
// parentID (parentID nil => root-level nodes) for the tenant. Used to validate a
// reorder request: the supplied ordered_ids must be exactly a subset of these.
func (r *CaseClassificationRepository) SiblingIDs(ctx context.Context, tenantID uuid.UUID, parentID *uuid.UUID) (map[uuid.UUID]bool, error) {
	var rows pgx.Rows
	var err error
	if parentID == nil {
		rows, err = r.db.Query(ctx, `
			SELECT id FROM legal_case_classifications
			WHERE tenant_id = $1 AND parent_id IS NULL AND deleted_at IS NULL`,
			tenantID,
		)
	} else {
		rows, err = r.db.Query(ctx, `
			SELECT id FROM legal_case_classifications
			WHERE tenant_id = $1 AND parent_id = $2 AND deleted_at IS NULL`,
			tenantID, *parentID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	siblings := make(map[uuid.UUID]bool)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		siblings[id] = true
	}
	return siblings, rows.Err()
}

// ReorderSiblings sets sort = position for each id in orderedIDs in a single
// statement (idx -> sort via an unnest-with-ordinality join), tenant-scoped and
// constrained to the given parent so a stray id under a different parent cannot be
// re-sequenced. Returns the number of rows updated.
func (r *CaseClassificationRepository) ReorderSiblings(ctx context.Context, q Queryer, tenantID uuid.UUID, parentID *uuid.UUID, orderedIDs []uuid.UUID) (int64, error) {
	ids := make([]string, len(orderedIDs))
	for i, id := range orderedIDs {
		ids[i] = id.String()
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_classifications c
		SET sort = o.ord - 1, updated_at = now()
		FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, ord)
		WHERE c.id = o.id
		  AND c.tenant_id = $1
		  AND c.deleted_at IS NULL
		  AND c.parent_id IS NOT DISTINCT FROM $2`,
		tenantID, parentID, ids,
	)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// Activate flags a classification active within an open transaction, mirroring
// Deactivate.
func (r *CaseClassificationRepository) Activate(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_classifications
		SET active = true, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func marshalAuditSnapshot(value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	return json.Marshal(value)
}

func caseClassificationJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.parent_id, c.code,
			       COALESCE(c.name, '{}'::jsonb) AS name,
			       COALESCE(c.path, '{}') AS path, c.is_system, c.active, c.sort,
			       COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at, c.deleted_at
			FROM legal_case_classifications c
			WHERE ` + where + `
		) t`
}

func caseClassificationSortColumn(column string) (string, bool) {
	switch column {
	case "c.code":
		return "t.code", true
	case "c.sort":
		return "t.sort", true
	case "c.active":
		return "t.active", true
	case "c.updated_at":
		return "t.updated_at", true
	case "c.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
