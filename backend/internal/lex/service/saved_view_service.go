package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// SavedViewService owns the server-side saved-views surface (#12): named
// list-workspace configurations per namespace (e.g. 'lex-contracts') with
// share scopes and a default-for-role marker.
//
// Authorization model (design):
//   - personal — the OWNER only, for both read and write. Not even a
//     lex:catalog:manage holder may read or edit another user's personal view
//     (it is a private preference, not tenant configuration).
//   - team/org — readable tenant-wide; writable by the owner OR a holder of
//     lex:catalog:manage (the Lex config-authority key).
//   - default-for-role (role_slug) — ANY change (set or clear) requires
//     lex:catalog:manage, because it dictates the landing experience of every
//     holder of that role, and is only meaningful on a shared view. Exactly one
//     default per (namespace, role): promoting a view transactionally demotes
//     the previous holder (upsert semantics), with
//     uq_lex_saved_views_role_default as the hard backstop.
type SavedViewService struct {
	db     *pgxpool.Pool
	views  *repository.SavedViewRepository
	logger zerolog.Logger
}

func NewSavedViewService(db *pgxpool.Pool, views *repository.SavedViewRepository, logger zerolog.Logger) *SavedViewService {
	return &SavedViewService{
		db:     db,
		views:  views,
		logger: logger.With().Str("service", "lex-saved-views").Logger(),
	}
}

// List returns the saved views the caller may see in a namespace: all shared
// (team/org) views of the tenant plus the caller's own personal views.
func (s *SavedViewService) List(ctx context.Context, tenantID, userID uuid.UUID, namespace string) ([]model.SavedView, error) {
	namespace = dto.NormalizeSavedViewNamespace(namespace)
	if !dto.IsValidSavedViewNamespace(namespace) {
		return nil, validationError("invalid namespace", map[string]string{
			"namespace": "namespace must be 1-64 chars of [a-z0-9._-] starting alphanumeric",
		})
	}
	items, err := s.views.ListVisible(ctx, tenantID, userID, namespace)
	if err != nil {
		return nil, internalError("list saved views", err)
	}
	return items, nil
}

// Create stores a new saved view owned by the caller. Setting role_slug
// (default-for-role) requires lex:catalog:manage and a shared scope; the
// previous default for that role+namespace is demoted in the same transaction.
func (s *SavedViewService) Create(ctx context.Context, tenantID, userID uuid.UUID, roles []string, req dto.CreateSavedViewRequest) (*model.SavedView, error) {
	req.Normalize()
	if fields := req.Validate(); fields != nil {
		return nil, validationError("invalid saved view", fields)
	}
	if req.RoleSlug != nil && !canManageSavedViewRoleDefaults(ctx, roles) {
		return nil, forbiddenError("setting a default view for a role requires the lex:catalog:manage permission")
	}

	view := &model.SavedView{
		TenantID:    tenantID,
		OwnerUserID: userID,
		Namespace:   req.Namespace,
		Name:        req.Name,
		Scope:       req.Scope,
		RoleSlug:    req.RoleSlug,
		Payload:     req.Payload,
	}

	created, err := s.withTx(ctx, func(tx pgx.Tx) (*model.SavedView, error) {
		if view.RoleSlug != nil {
			if err := s.views.ClearRoleDefault(ctx, tx, tenantID, view.Namespace, *view.RoleSlug, uuid.Nil); err != nil {
				return nil, internalError("demote previous role-default view", err)
			}
		}
		return s.views.Create(ctx, tx, view)
	})
	if err != nil {
		if isUniqueViolationOn(err, "uq_lex_saved_views_owner_name") {
			return nil, conflictError("you already have a saved view with this name in this workspace")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("saved view conflicts with an existing view")
		}
		return nil, internalError("create saved view", err)
	}
	return created, nil
}

// Update partially updates one saved view under the share-scope write rules.
// Changing role_slug in either direction requires lex:catalog:manage;
// promoting demotes the previous default in the same transaction.
func (s *SavedViewService) Update(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID, req dto.UpdateSavedViewRequest) (*model.SavedView, error) {
	return s.updateInNamespace(ctx, tenantID, userID, roles, id, "", req)
}

// UpdateInNamespace applies the normal saved-view authorization rules and also
// requires the target row to belong to namespace. It is used by purpose-built
// preference surfaces (for example Lex report definitions) so a granular route
// cannot be abused to mutate a row from another saved-view workspace.
func (s *SavedViewService) UpdateInNamespace(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID, namespace string, req dto.UpdateSavedViewRequest) (*model.SavedView, error) {
	namespace = dto.NormalizeSavedViewNamespace(namespace)
	if !dto.IsValidSavedViewNamespace(namespace) {
		return nil, validationError("invalid namespace", map[string]string{
			"namespace": "namespace must be 1-64 chars of [a-z0-9._-] starting alphanumeric",
		})
	}
	return s.updateInNamespace(ctx, tenantID, userID, roles, id, namespace, req)
}

func (s *SavedViewService) updateInNamespace(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID, namespace string, req dto.UpdateSavedViewRequest) (*model.SavedView, error) {
	req.Normalize()
	if fields := req.Validate(); fields != nil {
		return nil, validationError("invalid saved view update", fields)
	}
	if req.IsEmpty() {
		return nil, validationError("empty update", map[string]string{"body": "provide at least one of name, scope, role_slug, payload"})
	}

	existing, err := s.loadVisible(ctx, tenantID, userID, id)
	if err != nil {
		return nil, err
	}
	if namespace != "" && existing.Namespace != namespace {
		return nil, notFoundError("saved view not found")
	}
	if !canWriteSavedView(ctx, existing, userID, roles) {
		return nil, forbiddenError("only the owner (or a lex:catalog:manage holder, for shared views) may modify this saved view")
	}
	if savedViewRoleDefaultChanged(existing, req) && !canManageSavedViewRoleDefaults(ctx, roles) {
		return nil, forbiddenError("changing a role's default view requires the lex:catalog:manage permission")
	}
	if err := applySavedViewUpdate(existing, req); err != nil {
		return nil, err
	}

	updated, err := s.withTx(ctx, func(tx pgx.Tx) (*model.SavedView, error) {
		if existing.RoleSlug != nil {
			if err := s.views.ClearRoleDefault(ctx, tx, tenantID, existing.Namespace, *existing.RoleSlug, existing.ID); err != nil {
				return nil, internalError("demote previous role-default view", err)
			}
		}
		return s.views.Update(ctx, tx, existing)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("saved view not found")
		}
		if isUniqueViolationOn(err, "uq_lex_saved_views_owner_name") {
			return nil, conflictError("the owner already has a saved view with this name in this workspace")
		}
		if isUniqueViolation(err) {
			return nil, conflictError("saved view conflicts with an existing view")
		}
		return nil, internalError("update saved view", err)
	}
	return updated, nil
}

// Delete removes one saved view under the share-scope write rules. Deleting a
// role-default view simply drops that role's default.
func (s *SavedViewService) Delete(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID) error {
	return s.deleteInNamespace(ctx, tenantID, userID, roles, id, "")
}

// DeleteInNamespace is the namespace-constrained counterpart to Delete. See
// UpdateInNamespace for why purpose-built granular routes use this boundary.
func (s *SavedViewService) DeleteInNamespace(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID, namespace string) error {
	namespace = dto.NormalizeSavedViewNamespace(namespace)
	if !dto.IsValidSavedViewNamespace(namespace) {
		return validationError("invalid namespace", map[string]string{
			"namespace": "namespace must be 1-64 chars of [a-z0-9._-] starting alphanumeric",
		})
	}
	return s.deleteInNamespace(ctx, tenantID, userID, roles, id, namespace)
}

func (s *SavedViewService) deleteInNamespace(ctx context.Context, tenantID, userID uuid.UUID, roles []string, id uuid.UUID, namespace string) error {
	existing, err := s.loadVisible(ctx, tenantID, userID, id)
	if err != nil {
		return err
	}
	if namespace != "" && existing.Namespace != namespace {
		return notFoundError("saved view not found")
	}
	if !canWriteSavedView(ctx, existing, userID, roles) {
		return forbiddenError("only the owner (or a lex:catalog:manage holder, for shared views) may delete this saved view")
	}
	deleted, err := s.views.Delete(ctx, tenantID, id)
	if err != nil {
		return internalError("delete saved view", err)
	}
	if !deleted {
		return notFoundError("saved view not found")
	}
	return nil
}

// loadVisible loads a saved view and applies READ visibility: a personal view
// belonging to someone else is reported as 404 (not 403) so its existence is
// never leaked.
func (s *SavedViewService) loadVisible(ctx context.Context, tenantID, userID, id uuid.UUID) (*model.SavedView, error) {
	view, err := s.views.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("saved view not found")
		}
		return nil, internalError("load saved view", err)
	}
	if !canReadSavedView(view, userID) {
		return nil, notFoundError("saved view not found")
	}
	return view, nil
}

// withTx runs fn inside a pgx transaction, committing on success.
func (s *SavedViewService) withTx(ctx context.Context, fn func(tx pgx.Tx) (*model.SavedView, error)) (*model.SavedView, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin saved-view transaction", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	out, err := fn(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit saved-view transaction", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Pure share-scope / permission decisions (unit-tested without a database).
// ---------------------------------------------------------------------------

// canReadSavedView: personal views are readable by the OWNER only; shared
// (team/org) views are readable tenant-wide.
func canReadSavedView(view *model.SavedView, userID uuid.UUID) bool {
	if view == nil {
		return false
	}
	if view.Scope == model.SavedViewScopePersonal {
		return view.OwnerUserID == userID
	}
	return true
}

// canWriteSavedView: the owner may always modify their own view. A non-owner
// may modify a SHARED (team/org) view only when they hold lex:catalog:manage;
// another user's personal view is never writable, whatever the caller holds.
func canWriteSavedView(ctx context.Context, view *model.SavedView, userID uuid.UUID, roles []string) bool {
	if view == nil {
		return false
	}
	if view.OwnerUserID == userID {
		return true
	}
	if view.Scope == model.SavedViewScopePersonal {
		return false
	}
	return canManageSavedViewRoleDefaults(ctx, roles)
}

// canManageSavedViewRoleDefaults gates every role_slug (default-for-role)
// change — and non-owner writes to shared views — on the Lex config-authority
// key. Wildcards (lex:*, admin:*) pass via auth.HasPermission as everywhere.
func canManageSavedViewRoleDefaults(ctx context.Context, roles []string) bool {
	return auth.HasPermissionCtx(ctx, roles, auth.PermLexCatalogManage)
}

// savedViewRoleDefaultChanged reports whether the update touches the
// default-for-role marker at all (set, move, or clear). A no-op "clear" on a
// view that has no role_slug is not a change.
func savedViewRoleDefaultChanged(existing *model.SavedView, req dto.UpdateSavedViewRequest) bool {
	if req.RoleSlug == nil {
		return false
	}
	if *req.RoleSlug == "" {
		return existing.RoleSlug != nil
	}
	return existing.RoleSlug == nil || *existing.RoleSlug != *req.RoleSlug
}

// applySavedViewUpdate merges the request into the view and re-checks the
// cross-field invariant that a default-for-role view must stay shared. The
// tri-state RoleSlug follows the DTO contract: nil = unchanged, "" = clear,
// non-empty = set.
func applySavedViewUpdate(view *model.SavedView, req dto.UpdateSavedViewRequest) error {
	if req.Name != nil {
		view.Name = *req.Name
	}
	if req.Scope != nil {
		view.Scope = *req.Scope
	}
	if req.RoleSlug != nil {
		if *req.RoleSlug == "" {
			view.RoleSlug = nil
		} else {
			slug := *req.RoleSlug
			view.RoleSlug = &slug
		}
	}
	if req.Payload != nil {
		view.Payload = req.Payload
	}
	if view.RoleSlug != nil && !model.IsSharedSavedViewScope(view.Scope) {
		return validationError("a personal view cannot be a role default", map[string]string{
			"scope": "clear role_slug before making this view personal, or keep a shared scope",
		})
	}
	return nil
}
