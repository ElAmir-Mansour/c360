package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/authz"
)

// ABACResourceExtractor derives the ABAC resource + action for a Watheeq/Lex
// request so the attribute-policy engine can evaluate it (WTQ-SEC-01).
//
// The action mirrors the RBAC verb — "lex:read" for GET/HEAD, "lex:write"
// otherwise — so attribute policies can be authored against the same action
// vocabulary as RequirePermission. The resource type is the leading path
// segment after /lex/ or /watheeq/ (e.g. "contracts"), and the {id} route param
// (when present) becomes the resource ID for owner/attribute conditions.
func ABACResourceExtractor(r *http.Request) (authz.Resource, string) {
	action := "lex:read"
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		action = "lex:write"
	}
	res := authz.Resource{Type: lexResourceType(r.URL.Path)}
	if id := chi.URLParam(r, "id"); id != "" {
		res.ID = id
	}
	return res, action
}

func lexResourceType(path string) string {
	for _, anchor := range []string{"/lex/", "/watheeq/"} {
		if i := strings.Index(path, anchor); i >= 0 {
			rest := path[i+len(anchor):]
			if j := strings.IndexByte(rest, '/'); j >= 0 {
				return rest[:j]
			}
			return rest
		}
	}
	return ""
}
