package middleware

import (
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/suiteapi"
)

// RequireWorkforceAccess gates org/tenant workforce reads while preserving the
// approved self-view exception. The service repeats this check so alternate
// transports cannot bypass it.
func RequireWorkforceAccess(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("scope")), "self") {
				next.ServeHTTP(w, r)
				return
			}
			user := auth.UserFromContext(r.Context())
			if user == nil {
				suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required", nil)
				return
			}
			if !auth.HasPermissionForTenant(r.Context(), user.TenantID, user.Roles, permission) {
				suiteapi.WriteError(w, r, http.StatusForbidden, "FORBIDDEN", "workforce reporting requires "+permission, nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
