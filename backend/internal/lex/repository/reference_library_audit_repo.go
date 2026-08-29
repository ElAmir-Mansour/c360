package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ReferenceLibraryAuditRepository persists the per-access audit trail for the
// GLOBAL reference library (reference_library_access_log). It is deliberately
// write-mostly (Insert) plus a small read path (List) for an operator audit
// surface. It takes a Queryer (satisfied by *pgxpool.Pool AND by pgxmock) so the
// insert/list SQL is unit-testable without a live database.
//
// The repository is NIL-SAFE: a nil *ReferenceLibraryAuditRepository makes every
// method a no-op returning nil, so a deployment that has not (yet) migrated the
// audit table degrades to structured-log-only auditing rather than failing the
// request path.
type ReferenceLibraryAuditRepository struct {
	db     Queryer
	logger zerolog.Logger
}

func NewReferenceLibraryAuditRepository(db Queryer, logger zerolog.Logger) *ReferenceLibraryAuditRepository {
	return &ReferenceLibraryAuditRepository{db: db, logger: logger}
}

// Insert appends one audit row. It is best-effort by contract: the caller runs it
// off the request's critical path and treats an error as non-fatal (the download
// already succeeded), so a transient audit-write failure never blocks a read.
func (r *ReferenceLibraryAuditRepository) Insert(ctx context.Context, e model.ReferenceLibraryAccessEntry) error {
	if r == nil || r.db == nil {
		return nil
	}
	const q = `
INSERT INTO reference_library_access_log (
    document_id, action, tenant_id, user_id, user_email, client_ip, user_agent,
    byte_source, outcome, bytes_served, query_hash, query_sample, status_code
) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13
)`
	_, err := r.db.Exec(ctx, q,
		e.DocumentID, e.Action, e.TenantID, e.UserID, e.UserEmail, e.ClientIP, e.UserAgent,
		e.ByteSource, e.Outcome, e.BytesServed, e.QueryHash, e.QuerySample, e.StatusCode,
	)
	return err
}

// ReferenceLibraryAuditFilters narrows the operator audit browse.
type ReferenceLibraryAuditFilters struct {
	DocumentID *uuid.UUID
	Action     string
	Limit      int
}

// List returns the newest audit rows first, applying the filters. It is used by
// an operator audit surface (not the tenant-facing read path). Limit is bounded
// 1..500 to keep the projection cheap.
func (r *ReferenceLibraryAuditRepository) List(ctx context.Context, f ReferenceLibraryAuditFilters) ([]model.ReferenceLibraryAccessEntry, error) {
	if r == nil || r.db == nil {
		return []model.ReferenceLibraryAccessEntry{}, nil
	}
	where, args := buildReferenceLibraryAuditWhere(f)
	limit := f.Limit
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	query := fmt.Sprintf(`
		SELECT row_to_json(t)
		FROM (
			SELECT id, document_id, action, tenant_id, user_id, user_email, client_ip,
			       user_agent, byte_source, outcome, bytes_served, query_hash,
			       query_sample, status_code, created_at
			FROM reference_library_access_log
			WHERE %s
			ORDER BY created_at DESC
			LIMIT $%d
		) t`, where, len(args)+1)
	args = append(args, limit)
	return queryListJSON[model.ReferenceLibraryAccessEntry](ctx, r.db, query, args...)
}

// buildReferenceLibraryAuditWhere builds the audit browse predicate + positional
// args. Extracted as a pure function so the filter logic is unit-testable without
// a database.
func buildReferenceLibraryAuditWhere(f ReferenceLibraryAuditFilters) (string, []any) {
	conditions := []string{"TRUE"}
	args := []any{}
	arg := 1
	if f.DocumentID != nil {
		conditions = append(conditions, fmt.Sprintf("document_id = $%d", arg))
		args = append(args, *f.DocumentID)
		arg++
	}
	if strings.TrimSpace(f.Action) != "" {
		conditions = append(conditions, fmt.Sprintf("action = $%d", arg))
		args = append(args, strings.TrimSpace(f.Action))
		arg++
	}
	return strings.Join(conditions, " AND "), args
}
