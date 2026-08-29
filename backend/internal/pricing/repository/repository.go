// Package repository persists the pricing_config version store. Every method
// takes a DBTX so callers choose the execution context: a pool for single
// reads, or the service's open transaction so a publish and its outbox event
// commit atomically (mirroring the licensing repository).
package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/pricing/model"
)

// DBTX is the subset of pgx satisfied by both *pgxpool.Pool and pgx.Tx.
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repository holds no state; it exists so the service can depend on an
// interface-shaped value and tests can substitute it.
type Repository struct{}

func New() *Repository { return &Repository{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

const configColumns = `id, version, status, payload, currency, effective_from, effective_to, notes, created_by, created_at, updated_at`

// scanConfig reads one pricing_config row, unmarshalling the JSONB payload into
// the typed PricingRates struct.
func scanConfig(row pgx.Row) (*model.PricingConfig, error) {
	var (
		c       model.PricingConfig
		payload []byte
	)
	if err := row.Scan(&c.ID, &c.Version, &c.Status, &payload, &c.Currency, &c.EffectiveFrom, &c.EffectiveTo, &c.Notes, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload, &c.Rates); err != nil {
		return nil, fmt.Errorf("decoding pricing_config payload (version %d): %w", c.Version, err)
	}
	return &c, nil
}

const selectActiveSQL = `SELECT ` + configColumns + ` FROM pricing_config WHERE status = 'active'`

// GetActive returns the single active version, or model.ErrNoActive if none.
func (r *Repository) GetActive(ctx context.Context, db DBTX) (*model.PricingConfig, error) {
	c, err := scanConfig(db.QueryRow(ctx, selectActiveSQL))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.ErrNoActive
		}
		return nil, fmt.Errorf("loading active pricing config: %w", err)
	}
	return c, nil
}

const selectByVersionSQL = `SELECT ` + configColumns + ` FROM pricing_config WHERE version = $1`

// GetByVersion loads one version, or model.ErrNotFound.
func (r *Repository) GetByVersion(ctx context.Context, db DBTX, version int) (*model.PricingConfig, error) {
	c, err := scanConfig(db.QueryRow(ctx, selectByVersionSQL, version))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("pricing config version %d: %w", version, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading pricing config version %d: %w", version, err)
	}
	return c, nil
}

const listConfigSQL = `SELECT ` + configColumns + ` FROM pricing_config ORDER BY version DESC`

// List returns all versions, newest first.
func (r *Repository) List(ctx context.Context, db DBTX) ([]*model.PricingConfig, error) {
	rows, err := db.Query(ctx, listConfigSQL)
	if err != nil {
		return nil, fmt.Errorf("listing pricing configs: %w", err)
	}
	defer rows.Close()

	var out []*model.PricingConfig
	for rows.Next() {
		c, err := scanConfig(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning pricing config: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading pricing configs: %w", err)
	}
	return out, nil
}

const maxVersionSQL = `SELECT COALESCE(MAX(version), 0) FROM pricing_config`

// MaxVersion returns the highest existing version (0 if the table is empty).
func (r *Repository) MaxVersion(ctx context.Context, db DBTX) (int, error) {
	var max int
	if err := db.QueryRow(ctx, maxVersionSQL).Scan(&max); err != nil {
		return 0, fmt.Errorf("reading max pricing config version: %w", err)
	}
	return max, nil
}

const insertDraftSQL = `
INSERT INTO pricing_config (version, status, payload, currency, notes, created_by)
VALUES ($1, 'draft', $2, $3, $4, $5)
RETURNING ` + configColumns

// CreateDraft inserts a new draft version with a caller-assigned version number.
func (r *Repository) CreateDraft(ctx context.Context, db DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	payload, err := json.Marshal(c.Rates)
	if err != nil {
		return nil, fmt.Errorf("encoding pricing rates: %w", err)
	}
	currency := c.Currency
	if currency == "" {
		currency = "SAR"
	}
	out, err := scanConfig(db.QueryRow(ctx, insertDraftSQL, c.Version, payload, currency, c.Notes, c.CreatedBy))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("pricing config version %d: %w", c.Version, model.ErrAlreadyExists)
		}
		return nil, fmt.Errorf("creating pricing config draft: %w", err)
	}
	return out, nil
}

const updateDraftSQL = `
UPDATE pricing_config
SET payload = $2, notes = $3, updated_at = now()
WHERE version = $1 AND status = 'draft'
RETURNING ` + configColumns

// UpdateDraft edits a draft's payload/notes. Returns model.ErrImmutable if the
// version is not a draft (active/archived are immutable), model.ErrNotFound if
// it does not exist.
func (r *Repository) UpdateDraft(ctx context.Context, db DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	payload, err := json.Marshal(c.Rates)
	if err != nil {
		return nil, fmt.Errorf("encoding pricing rates: %w", err)
	}
	out, err := scanConfig(db.QueryRow(ctx, updateDraftSQL, c.Version, payload, c.Notes))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Either the version is absent or it is not a draft. Disambiguate so
			// the handler can map to 404 vs 409.
			if _, gErr := r.GetByVersion(ctx, db, c.Version); errors.Is(gErr, model.ErrNotFound) {
				return nil, gErr
			}
			return nil, fmt.Errorf("pricing config version %d: %w", c.Version, model.ErrImmutable)
		}
		return nil, fmt.Errorf("updating pricing config version %d: %w", c.Version, err)
	}
	return out, nil
}

const archiveActiveSQL = `
UPDATE pricing_config
SET status = 'archived', effective_to = now(), updated_at = now()
WHERE status = 'active'`

// ArchiveActive flips any current active version to archived and stamps its
// effective_to. It is safe to call when there is no active version (0 rows).
func (r *Repository) ArchiveActive(ctx context.Context, db DBTX) error {
	if _, err := db.Exec(ctx, archiveActiveSQL); err != nil {
		return fmt.Errorf("archiving active pricing config: %w", err)
	}
	return nil
}

const activateDraftSQL = `
UPDATE pricing_config
SET status = 'active', effective_from = now(), effective_to = NULL, updated_at = now()
WHERE version = $1 AND status = 'draft'
RETURNING ` + configColumns

// Activate flips a draft to active. Callers MUST have archived the prior active
// version in the same transaction first, or the partial unique index rejects it.
func (r *Repository) Activate(ctx context.Context, db DBTX, version int) (*model.PricingConfig, error) {
	out, err := scanConfig(db.QueryRow(ctx, activateDraftSQL, version))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, gErr := r.GetByVersion(ctx, db, version); errors.Is(gErr, model.ErrNotFound) {
				return nil, gErr
			}
			return nil, fmt.Errorf("pricing config version %d is not a draft: %w", version, model.ErrImmutable)
		}
		return nil, fmt.Errorf("activating pricing config version %d: %w", version, err)
	}
	return out, nil
}

const archiveVersionSQL = `
UPDATE pricing_config
SET status = 'archived', effective_to = now(), updated_at = now()
WHERE version = $1 AND status = 'active'
RETURNING ` + configColumns

// ArchiveVersion archives a specific active version (used by the explicit
// archive route). Returns model.ErrImmutable if the version is not active.
func (r *Repository) ArchiveVersion(ctx context.Context, db DBTX, version int) (*model.PricingConfig, error) {
	out, err := scanConfig(db.QueryRow(ctx, archiveVersionSQL, version))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, gErr := r.GetByVersion(ctx, db, version); errors.Is(gErr, model.ErrNotFound) {
				return nil, gErr
			}
			return nil, fmt.Errorf("pricing config version %d is not active: %w", version, model.ErrImmutable)
		}
		return nil, fmt.Errorf("archiving pricing config version %d: %w", version, err)
	}
	return out, nil
}
