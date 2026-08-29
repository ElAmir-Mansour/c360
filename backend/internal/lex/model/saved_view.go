package model

import (
	"time"

	"github.com/google/uuid"
)

// Saved-view share scopes (migration 000078). personal views are visible and
// writable by the OWNER only; team/org views are readable tenant-wide and
// writable by the owner or a lex:catalog:manage holder. team vs org is a
// presentation distinction (how widely the view is advertised) — both share
// the same tenant-wide read / manage-or-owner write semantics.
const (
	SavedViewScopePersonal = "personal"
	SavedViewScopeTeam     = "team"
	SavedViewScopeOrg      = "org"
)

// IsValidSavedViewScope reports whether scope is one of the three share scopes.
func IsValidSavedViewScope(scope string) bool {
	switch scope {
	case SavedViewScopePersonal, SavedViewScopeTeam, SavedViewScopeOrg:
		return true
	}
	return false
}

// IsSharedSavedViewScope reports whether scope is readable tenant-wide
// (team/org). Only a shared view may carry a role_slug (default-for-role).
func IsSharedSavedViewScope(scope string) bool {
	return scope == SavedViewScopeTeam || scope == SavedViewScopeOrg
}

// SavedView is one named list-workspace configuration inside a namespace
// (e.g. 'lex-contracts'). Payload is an OPAQUE frontend-owned JSONB blob
// (filters / sort / columns / density / view mode) — the backend stores and
// authorizes it but never interprets it. A non-nil RoleSlug marks the view as
// the DEFAULT for every holder of that legal role in this namespace (at most
// one per role+namespace, enforced by uq_lex_saved_views_role_default).
// Mirrors the lex_saved_views table (migration 000078).
type SavedView struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	OwnerUserID uuid.UUID      `json:"owner_user_id"`
	Namespace   string         `json:"namespace"`
	Name        string         `json:"name"`
	Scope       string         `json:"scope"`
	RoleSlug    *string        `json:"role_slug,omitempty"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}
