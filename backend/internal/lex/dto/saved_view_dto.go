package dto

import (
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

// savedViewNameMaxLen bounds the display name of a saved view.
const savedViewNameMaxLen = 120

// savedViewNamespaceMaxLen bounds the namespace slug of a saved view.
const savedViewNamespaceMaxLen = 64

// NormalizeSavedViewNamespace trims and lowercases a saved-view namespace slug.
func NormalizeSavedViewNamespace(namespace string) string {
	return strings.ToLower(strings.TrimSpace(namespace))
}

// IsValidSavedViewNamespace reports whether namespace (already normalized) is a
// well-formed workspace slug: 1..64 chars of [a-z0-9._-], starting with an
// alphanumeric (e.g. 'lex-contracts', 'lex-matters').
func IsValidSavedViewNamespace(namespace string) bool {
	if namespace == "" || len(namespace) > savedViewNamespaceMaxLen {
		return false
	}
	for i, r := range namespace {
		alnum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if i == 0 {
			if !alnum {
				return false
			}
			continue
		}
		if !alnum && r != '-' && r != '_' && r != '.' {
			return false
		}
	}
	return true
}

// CreateSavedViewRequest creates one named saved view inside a namespace.
// Payload is the opaque frontend-owned view blob (filters/sort/columns/density/
// view mode). A non-nil RoleSlug requests default-for-role (shared scopes only;
// lex:catalog:manage enforced by the service).
type CreateSavedViewRequest struct {
	Namespace string         `json:"namespace"`
	Name      string         `json:"name"`
	Scope     string         `json:"scope"`
	RoleSlug  *string        `json:"role_slug,omitempty"`
	Payload   map[string]any `json:"payload"`
}

// Normalize canonicalizes the request in place: namespace/scope/role_slug are
// trimmed+lowered (empty scope defaults to personal, empty role_slug becomes
// nil), name is trimmed, and a nil payload becomes an empty object so the
// JSONB column never stores SQL NULL.
func (r *CreateSavedViewRequest) Normalize() {
	r.Namespace = NormalizeSavedViewNamespace(r.Namespace)
	r.Name = strings.TrimSpace(r.Name)
	r.Scope = strings.ToLower(strings.TrimSpace(r.Scope))
	if r.Scope == "" {
		r.Scope = model.SavedViewScopePersonal
	}
	r.RoleSlug = normalizeSavedViewRoleSlug(r.RoleSlug)
	if r.Payload == nil {
		r.Payload = map[string]any{}
	}
}

// Validate returns per-field errors for an already-Normalized request, or nil.
func (r CreateSavedViewRequest) Validate() map[string]string {
	fields := map[string]string{}
	if !IsValidSavedViewNamespace(r.Namespace) {
		fields["namespace"] = "namespace must be 1-64 chars of [a-z0-9._-] starting alphanumeric"
	}
	if r.Name == "" {
		fields["name"] = "name is required"
	} else if len(r.Name) > savedViewNameMaxLen {
		fields["name"] = "name must be at most 120 characters"
	}
	if !model.IsValidSavedViewScope(r.Scope) {
		fields["scope"] = "scope must be one of personal, team, org"
	}
	if r.RoleSlug != nil && !model.IsSharedSavedViewScope(r.Scope) {
		fields["role_slug"] = "a default-for-role view must be shared (scope team or org)"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// UpdateSavedViewRequest partially updates a saved view. nil fields are left
// unchanged. RoleSlug is tri-state: nil = unchanged, "" = clear the
// default-for-role, non-empty = set this view as the default for that role
// (shared scopes only; lex:catalog:manage enforced by the service).
type UpdateSavedViewRequest struct {
	Name     *string        `json:"name,omitempty"`
	Scope    *string        `json:"scope,omitempty"`
	RoleSlug *string        `json:"role_slug,omitempty"`
	Payload  map[string]any `json:"payload,omitempty"`
}

// Normalize canonicalizes the provided fields in place, preserving the
// tri-state RoleSlug: a provided-but-blank slug stays a non-nil empty string
// (the "clear" sentinel), a provided non-blank slug is trimmed+lowered.
func (r *UpdateSavedViewRequest) Normalize() {
	if r.Name != nil {
		trimmed := strings.TrimSpace(*r.Name)
		r.Name = &trimmed
	}
	if r.Scope != nil {
		scope := strings.ToLower(strings.TrimSpace(*r.Scope))
		r.Scope = &scope
	}
	if r.RoleSlug != nil {
		slug := strings.ToLower(strings.TrimSpace(*r.RoleSlug))
		r.RoleSlug = &slug
	}
}

// Validate returns per-field errors for an already-Normalized request, or nil.
// Cross-field invariants that need the EXISTING row (e.g. role_slug vs the
// resulting scope) are enforced by the service after merging.
func (r UpdateSavedViewRequest) Validate() map[string]string {
	fields := map[string]string{}
	if r.Name != nil {
		if *r.Name == "" {
			fields["name"] = "name cannot be blank"
		} else if len(*r.Name) > savedViewNameMaxLen {
			fields["name"] = "name must be at most 120 characters"
		}
	}
	if r.Scope != nil && !model.IsValidSavedViewScope(*r.Scope) {
		fields["scope"] = "scope must be one of personal, team, org"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// IsEmpty reports whether the update carries no change at all.
func (r UpdateSavedViewRequest) IsEmpty() bool {
	return r.Name == nil && r.Scope == nil && r.RoleSlug == nil && r.Payload == nil
}

func normalizeSavedViewRoleSlug(slug *string) *string {
	if slug == nil {
		return nil
	}
	normalized := strings.ToLower(strings.TrimSpace(*slug))
	if normalized == "" {
		return nil
	}
	return &normalized
}
