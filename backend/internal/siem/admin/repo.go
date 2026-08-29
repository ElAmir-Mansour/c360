package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Repo persists SIEM parser catalogue and tenant settings records.
type Repo struct {
	db querier
}

func NewRepo(db querier) *Repo {
	return &Repo{db: db}
}

const parserColumns = `id, tenant_id, name, source_type, parser_version, status,
  ecs_version, config, fixtures, sha256, created_by, created_at, updated_at, retired_at`

func (r *Repo) CreateParser(ctx context.Context, in ParserCreateInput, sha string) (*Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `
INSERT INTO siem.parsers
  (tenant_id, name, source_type, parser_version, ecs_version, config, fixtures, sha256, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING ` + parserColumns
	row := r.db.QueryRow(ctx, q,
		in.TenantID, in.Name, in.SourceType, in.Version, in.ECSVersion,
		[]byte(in.Config), []byte(in.Fixtures), sha, in.CreatedBy,
	)
	p, err := scanParser(row)
	if err != nil {
		return nil, classifyDBError(err)
	}
	return p, nil
}

func (r *Repo) GetParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `SELECT ` + parserColumns + ` FROM siem.parsers WHERE id = $1 AND tenant_id = $2`
	p, err := scanParser(r.db.QueryRow(ctx, q, id, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: parser %s", ErrNotFound, id)
	}
	return p, err
}

func (r *Repo) ListParsers(ctx context.Context, tenantID uuid.UUID, lq ParserListQuery) ([]Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	limit := lq.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	clauses := []string{"tenant_id = $1"}
	args := []any{tenantID}
	next := 2
	if lq.Status != nil {
		clauses = append(clauses, fmt.Sprintf("status = $%d", next))
		args = append(args, string(*lq.Status))
		next++
	}
	if lq.SourceType != nil && *lq.SourceType != "" {
		clauses = append(clauses, fmt.Sprintf("source_type = $%d", next))
		args = append(args, *lq.SourceType)
		next++
	}
	args = append(args, limit)
	q := fmt.Sprintf(`
SELECT %s
FROM siem.parsers
WHERE %s
ORDER BY updated_at DESC
LIMIT $%d`, parserColumns, strings.Join(clauses, " AND "), next)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Parser, 0)
	for rows.Next() {
		p, err := scanParser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *Repo) UpdateParser(ctx context.Context, tenantID, id uuid.UUID, in ParserCreateInput, sha string) (*Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `
UPDATE siem.parsers
SET name = $3,
    source_type = $4,
    parser_version = $5,
    ecs_version = $6,
    config = $7,
    fixtures = $8,
    sha256 = $9,
    updated_at = now()
WHERE id = $1 AND tenant_id = $2 AND status = 'draft'
RETURNING ` + parserColumns
	row := r.db.QueryRow(ctx, q,
		id, tenantID, in.Name, in.SourceType, in.Version, in.ECSVersion,
		[]byte(in.Config), []byte(in.Fixtures), sha,
	)
	p, err := scanParser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		current, getErr := r.GetParser(ctx, tenantID, id)
		if getErr != nil {
			return nil, getErr
		}
		return nil, fmt.Errorf("%w: parser %s is %s", ErrInvalidState, id, current.Status)
	}
	if err != nil {
		return nil, classifyDBError(err)
	}
	return p, nil
}

func (r *Repo) PromoteParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `
WITH target AS (
  SELECT name, source_type
  FROM siem.parsers
  WHERE id = $1 AND tenant_id = $2
),
retire_existing AS (
  UPDATE siem.parsers p
  SET status = 'retired',
      retired_at = COALESCE(p.retired_at, now()),
      updated_at = now()
  FROM target
  WHERE p.tenant_id = $2
    AND p.name = target.name
    AND p.source_type = target.source_type
    AND p.status = 'active'
    AND p.id <> $1
)
UPDATE siem.parsers p
SET status = 'active',
    retired_at = NULL,
    updated_at = now()
WHERE p.id = $1 AND p.tenant_id = $2 AND EXISTS (SELECT 1 FROM target)
RETURNING ` + parserColumns
	p, err := scanParser(r.db.QueryRow(ctx, q, id, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: parser %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, classifyDBError(err)
	}
	return p, nil
}

func (r *Repo) RetireParser(ctx context.Context, tenantID, id uuid.UUID) (*Parser, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `
UPDATE siem.parsers
SET status = 'retired',
    retired_at = COALESCE(retired_at, now()),
    updated_at = now()
WHERE id = $1 AND tenant_id = $2
RETURNING ` + parserColumns
	p, err := scanParser(r.db.QueryRow(ctx, q, id, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: parser %s", ErrNotFound, id)
	}
	return p, err
}

func (r *Repo) GetSettings(ctx context.Context, tenantID uuid.UUID) (*Settings, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const ensure = `INSERT INTO siem.settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, ensure, tenantID); err != nil {
		return nil, err
	}
	const q = `
SELECT tenant_id, retention_days, parser_ci_required, hsm_required,
       warm_tier_days, cold_tier_enabled, updated_by, updated_at
FROM siem.settings
WHERE tenant_id = $1`
	return scanSettings(r.db.QueryRow(ctx, q, tenantID))
}

func (r *Repo) UpdateSettings(ctx context.Context, in SettingsInput) (*Settings, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("siem admin repo: nil db")
	}
	const q = `
INSERT INTO siem.settings
  (tenant_id, retention_days, parser_ci_required, hsm_required,
   warm_tier_days, cold_tier_enabled, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT (tenant_id) DO UPDATE
SET retention_days = EXCLUDED.retention_days,
    parser_ci_required = EXCLUDED.parser_ci_required,
    hsm_required = EXCLUDED.hsm_required,
    warm_tier_days = EXCLUDED.warm_tier_days,
    cold_tier_enabled = EXCLUDED.cold_tier_enabled,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
RETURNING tenant_id, retention_days, parser_ci_required, hsm_required,
          warm_tier_days, cold_tier_enabled, updated_by, updated_at`
	s, err := scanSettings(r.db.QueryRow(ctx, q,
		in.TenantID, in.RetentionDays, in.ParserCIRequired, in.HSMRequired,
		in.WarmTierDays, in.ColdTierEnabled, nullableUUID(in.UpdatedBy),
	))
	if err != nil {
		return nil, classifyDBError(err)
	}
	return s, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanParser(rs rowScanner) (*Parser, error) {
	var (
		p            Parser
		status       string
		configBytes  []byte
		fixtureBytes []byte
		retiredAt    *time.Time
	)
	err := rs.Scan(
		&p.ID, &p.TenantID, &p.Name, &p.SourceType, &p.Version, &status,
		&p.ECSVersion, &configBytes, &fixtureBytes, &p.SHA256, &p.CreatedBy,
		&p.CreatedAt, &p.UpdatedAt, &retiredAt,
	)
	if err != nil {
		return nil, err
	}
	p.Status = ParserStatus(status)
	p.RetiredAt = retiredAt
	if len(configBytes) == 0 {
		p.Config = json.RawMessage(`{}`)
	} else {
		p.Config = json.RawMessage(configBytes)
	}
	if len(fixtureBytes) == 0 {
		p.Fixtures = json.RawMessage(`[]`)
	} else {
		p.Fixtures = json.RawMessage(fixtureBytes)
	}
	return &p, nil
}

func scanSettings(rs rowScanner) (*Settings, error) {
	var (
		s         Settings
		updatedBy *uuid.UUID
	)
	err := rs.Scan(
		&s.TenantID, &s.RetentionDays, &s.ParserCIRequired, &s.HSMRequired,
		&s.WarmTierDays, &s.ColdTierEnabled, &updatedBy, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if updatedBy != nil {
		s.UpdatedBy = *updatedBy
	}
	return &s, nil
}

func classifyDBError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return fmt.Errorf("%w: %s", ErrConflict, pgErr.ConstraintName)
		case "23514", "22P02":
			return fmt.Errorf("%w: %s", ErrValidation, pgErr.Message)
		}
	}
	return err
}

func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
