package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SavedViewRepository persists server-side list-workspace saved views
// (migration 000078). It follows the lex JSON-projection style (queryRowJSON /
// queryListJSON, tenant_id-first predicates with table RLS as a backstop).
// Share-scope AUTHORIZATION (personal owner-only, shared owner-or-manage) is
// the service's job; the repo only bakes visibility into the list read so a
// stranger's personal views never leave the database.
//
// Write methods take an explicit Queryer so the service can compose the
// default-for-role swap (clear previous holder + set new one) in one
// transaction against uq_lex_saved_views_role_default.
type SavedViewRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSavedViewRepository(db *pgxpool.Pool, logger zerolog.Logger) *SavedViewRepository {
	return &SavedViewRepository{db: db, logger: logger}
}

const savedViewColumns = `sv.id, sv.tenant_id, sv.owner_user_id, sv.namespace, sv.name,
	       sv.scope, sv.role_slug, sv.payload, sv.created_at, sv.updated_at`

func savedViewJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ` + savedViewColumns + `
			FROM lex_saved_views sv
			WHERE ` + where + suffix + `
		) t`
}

// ListVisible returns the saved views the given user may SEE in a namespace:
// every shared (team/org) view of the tenant plus the user's own personal
// views. Shared views sort before personal ones, then by name.
func (r *SavedViewRepository) ListVisible(ctx context.Context, tenantID, userID uuid.UUID, namespace string) ([]model.SavedView, error) {
	query := savedViewJSONSelectWithSuffix(
		`sv.tenant_id = $1 AND sv.namespace = $2
			AND (sv.scope IN ('team', 'org') OR sv.owner_user_id = $3)`,
		` ORDER BY (sv.scope = 'personal') ASC, sv.name ASC`,
	)
	return queryListJSON[model.SavedView](ctx, r.db, query, tenantID, namespace, userID)
}

// Get loads one saved view by id within the tenant. Returns pgx.ErrNoRows when
// absent (the service maps that — and invisible personal views — to 404).
func (r *SavedViewRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.SavedView, error) {
	query := savedViewJSONSelectWithSuffix(`sv.tenant_id = $1 AND sv.id = $2`, ``)
	return queryRowJSON[model.SavedView](ctx, r.db, query, tenantID, id)
}

// Create inserts a saved view and returns the stored row. Unique violations
// (duplicate name per owner, duplicate role default) surface as pg errors the
// service translates to 409s.
func (r *SavedViewRepository) Create(ctx context.Context, q Queryer, view *model.SavedView) (*model.SavedView, error) {
	query := `
		WITH ins AS (
			INSERT INTO lex_saved_views (tenant_id, owner_user_id, namespace, name, scope, role_slug, payload)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING *
		)
		SELECT row_to_json(t)
		FROM (
			SELECT ` + savedViewColumns + `
			FROM ins sv
		) t`
	return queryRowJSON[model.SavedView](ctx, q, query,
		view.TenantID, view.OwnerUserID, view.Namespace, view.Name, view.Scope, view.RoleSlug, view.Payload)
}

// Update persists name/scope/role_slug/payload for one saved view and returns
// the stored row. Returns pgx.ErrNoRows when the row vanished underneath us.
func (r *SavedViewRepository) Update(ctx context.Context, q Queryer, view *model.SavedView) (*model.SavedView, error) {
	query := `
		WITH upd AS (
			UPDATE lex_saved_views
			SET name = $3, scope = $4, role_slug = $5, payload = $6, updated_at = now()
			WHERE tenant_id = $1 AND id = $2
			RETURNING *
		)
		SELECT row_to_json(t)
		FROM (
			SELECT ` + savedViewColumns + `
			FROM upd sv
		) t`
	return queryRowJSON[model.SavedView](ctx, q, query,
		view.TenantID, view.ID, view.Name, view.Scope, view.RoleSlug, view.Payload)
}

// Delete removes one saved view. Returns whether a row was actually deleted so
// the service can 404 a stale id.
func (r *SavedViewRepository) Delete(ctx context.Context, tenantID, id uuid.UUID) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM lex_saved_views WHERE tenant_id = $1 AND id = $2`,
		tenantID, id,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ClearRoleDefault demotes any CURRENT default view for (namespace, roleSlug)
// other than exceptID (pass uuid.Nil on create). Run inside the same
// transaction as the promoting Create/Update — together they are the upsert
// against uq_lex_saved_views_role_default (one default per role+namespace).
func (r *SavedViewRepository) ClearRoleDefault(ctx context.Context, q Queryer, tenantID uuid.UUID, namespace, roleSlug string, exceptID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_saved_views
		SET role_slug = NULL, updated_at = now()
		WHERE tenant_id = $1 AND namespace = $2 AND role_slug = $3 AND id <> $4`,
		tenantID, namespace, roleSlug, exceptID,
	)
	return err
}
