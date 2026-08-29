package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// UserPersonaRepository persists the last-selected Lex active persona per
// (tenant, user) — the smallest backing for Lex_Codebase_RBAC_Map.md §17.3. It is
// a UX preference store, NOT an authorization boundary (§17.4): route
// authorization still evaluates the caller's JWT role slugs. Queries filter by
// tenant_id (primary predicate) with table RLS (migration 000077) as a backstop.
type UserPersonaRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewUserPersonaRepository(db *pgxpool.Pool, logger zerolog.Logger) *UserPersonaRepository {
	return &UserPersonaRepository{db: db, logger: logger}
}

// GetActiveRoleSlug returns the user's last-selected persona slug, or ("", nil)
// when none has been persisted yet (the absence of a row is not an error — /me
// falls back to a deterministic primary-role pick).
func (r *UserPersonaRepository) GetActiveRoleSlug(ctx context.Context, tenantID, userID uuid.UUID) (string, error) {
	if r == nil || r.db == nil {
		return "", nil
	}
	var slug string
	err := r.db.QueryRow(ctx,
		`SELECT role_slug FROM lex_user_persona WHERE tenant_id = $1 AND user_id = $2`,
		tenantID, userID,
	).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return slug, nil
}

// SetActiveRoleSlug upserts the user's active persona slug. The natural key is
// (tenant, user) so a re-selection overwrites the prior preference. The caller is
// responsible for validating that roleSlug is one the user actually holds.
func (r *UserPersonaRepository) SetActiveRoleSlug(ctx context.Context, tenantID, userID uuid.UUID, roleSlug string) error {
	if r == nil || r.db == nil {
		return errors.New("user persona store not configured")
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO lex_user_persona (tenant_id, user_id, role_slug)
		VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id, user_id)
		DO UPDATE SET role_slug = EXCLUDED.role_slug, updated_at = now()`,
		tenantID, userID, roleSlug,
	)
	return err
}
