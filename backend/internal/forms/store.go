package forms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBTX is the execution-context type the store speaks: a *pgxpool.Pool for a
// single read, or the caller's open pgx.Tx so a form write commits atomically
// with any outbox event in the same transaction. The caller chooses the DBTX and
// therefore the RLS context (a tenant request runs under RunWithTenant; a
// system/migration path may bypass). This mirrors internal/dr/repository.DBTX
// and is re-declared locally so the forms package owns its contract without
// editing any shared repository file.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store persists FormDefinition rows in workflow_forms. It holds no state; the
// caller supplies the DBTX so the same code serves request transactions and
// background jobs.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

// formBody is the JSONB-serialized portion of a FormDefinition (the bilingual
// content). The audit/version columns (id/tenant_id/name/version/timestamps)
// live in their own columns, not in the JSONB, so they can be indexed and
// constrained.
type formBody struct {
	Locales       []string    `json:"locales"`
	DefaultLocale string      `json:"default_locale"`
	Fields        []FormField `json:"fields"`
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Create inserts a new form definition. It performs structural validation first
// (a malformed definition is never persisted) and maps a unique-constraint
// violation on (tenant_id, name, version) to ErrConflict. The generated id,
// created_at, and updated_at are written back into the returned definition.
func (s *Store) Create(ctx context.Context, db DBTX, fd *FormDefinition) (*FormDefinition, error) {
	if violations := fd.Validate(); len(violations) > 0 {
		return nil, fmt.Errorf("%w: %d violation(s), first: %s", ErrInvalid, len(violations), violations[0].String())
	}
	body, err := json.Marshal(formBody{
		Locales:       fd.Locales,
		DefaultLocale: fd.DefaultLocale,
		Fields:        fd.Fields,
	})
	if err != nil {
		return nil, fmt.Errorf("forms: marshal body: %w", err)
	}

	version := fd.Version
	if version <= 0 {
		version = 1
	}

	out := *fd
	out.Version = version
	err = db.QueryRow(ctx, `
		INSERT INTO workflow_forms (tenant_id, name, version, fields)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at`,
		fd.TenantID, fd.Name, version, body,
	).Scan(&out.ID, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("forms: %s v%d: %w", fd.Name, version, ErrConflict)
		}
		return nil, fmt.Errorf("forms: insert: %w", err)
	}
	return &out, nil
}

// scanRow maps one workflow_forms row (id, tenant_id, name, version, fields,
// created_at, updated_at) into a FormDefinition, decoding the JSONB body.
func scanRow(row pgx.Row) (*FormDefinition, error) {
	var (
		fd   FormDefinition
		body []byte
	)
	if err := row.Scan(&fd.ID, &fd.TenantID, &fd.Name, &fd.Version, &body, &fd.CreatedAt, &fd.UpdatedAt); err != nil {
		return nil, err
	}
	var b formBody
	if err := json.Unmarshal(body, &b); err != nil {
		return nil, fmt.Errorf("forms: unmarshal body for %s: %w", fd.ID, err)
	}
	fd.Locales = b.Locales
	fd.DefaultLocale = b.DefaultLocale
	fd.Fields = b.Fields
	return &fd, nil
}

const selectColumns = `id, tenant_id, name, version, fields,
	to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
	to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

// GetByID returns the form definition with the given id, or ErrNotFound.
func (s *Store) GetByID(ctx context.Context, db DBTX, id string) (*FormDefinition, error) {
	fd, err := scanRow(db.QueryRow(ctx,
		`SELECT `+selectColumns+` FROM workflow_forms WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("forms: id %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("forms: get by id: %w", err)
	}
	return fd, nil
}

// GetByNameVersion returns a specific (name, version) within the DBTX's tenant
// scope, or ErrNotFound.
func (s *Store) GetByNameVersion(ctx context.Context, db DBTX, name string, version int) (*FormDefinition, error) {
	fd, err := scanRow(db.QueryRow(ctx,
		`SELECT `+selectColumns+` FROM workflow_forms WHERE name = $1 AND version = $2`,
		name, version))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("forms: %s v%d: %w", name, version, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("forms: get by name/version: %w", err)
	}
	return fd, nil
}

// GetLatest returns the highest-version definition for a name within the DBTX's
// tenant scope, or ErrNotFound.
func (s *Store) GetLatest(ctx context.Context, db DBTX, name string) (*FormDefinition, error) {
	fd, err := scanRow(db.QueryRow(ctx,
		`SELECT `+selectColumns+` FROM workflow_forms WHERE name = $1
		 ORDER BY version DESC LIMIT 1`, name))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("forms: %s: %w", name, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("forms: get latest: %w", err)
	}
	return fd, nil
}

// List returns all form definitions visible in the DBTX's tenant scope, ordered
// by name then version descending.
func (s *Store) List(ctx context.Context, db DBTX) ([]*FormDefinition, error) {
	rows, err := db.Query(ctx,
		`SELECT `+selectColumns+` FROM workflow_forms ORDER BY name ASC, version DESC`)
	if err != nil {
		return nil, fmt.Errorf("forms: list: %w", err)
	}
	defer rows.Close()

	var out []*FormDefinition
	for rows.Next() {
		fd, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("forms: scan list row: %w", err)
		}
		out = append(out, fd)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("forms: list rows: %w", err)
	}
	return out, nil
}

// UpdateBody replaces the bilingual content (locales/default_locale/fields) of an
// existing definition in place, re-validating first and bumping updated_at. It
// returns ErrNotFound when no row matches the id in the tenant scope. Name and
// version are immutable here — a new version is a new row via Create.
func (s *Store) UpdateBody(ctx context.Context, db DBTX, fd *FormDefinition) (*FormDefinition, error) {
	if violations := fd.Validate(); len(violations) > 0 {
		return nil, fmt.Errorf("%w: %d violation(s), first: %s", ErrInvalid, len(violations), violations[0].String())
	}
	body, err := json.Marshal(formBody{
		Locales:       fd.Locales,
		DefaultLocale: fd.DefaultLocale,
		Fields:        fd.Fields,
	})
	if err != nil {
		return nil, fmt.Errorf("forms: marshal body: %w", err)
	}

	out := *fd
	err = db.QueryRow(ctx, `
		UPDATE workflow_forms
		SET fields = $2, updated_at = now()
		WHERE id = $1
		RETURNING id, tenant_id, name, version,
			to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
			to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		fd.ID, body,
	).Scan(&out.ID, &out.TenantID, &out.Name, &out.Version, &out.CreatedAt, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("forms: id %s: %w", fd.ID, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("forms: update: %w", err)
	}
	return &out, nil
}

// Delete removes a form definition by id within the DBTX's tenant scope. It
// returns ErrNotFound when no row was deleted.
func (s *Store) Delete(ctx context.Context, db DBTX, id string) error {
	tag, err := db.Exec(ctx, `DELETE FROM workflow_forms WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("forms: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("forms: id %s: %w", id, ErrNotFound)
	}
	return nil
}
