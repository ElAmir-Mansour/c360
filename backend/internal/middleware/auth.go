package middleware

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/auth"
)

// Auth validates the JWT from the Authorization header, extracts claims,
// and populates the request context with user and tenant information.
func Auth(jwtMgr *auth.JWTManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeAuthError(w, "MISSING_TOKEN", "authorization header is required")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				writeAuthError(w, "INVALID_TOKEN_FORMAT", "authorization header must be: Bearer <token>")
				return
			}

			claims, err := jwtMgr.ValidateAccessToken(parts[1])
			if err != nil {
				writeAuthError(w, "INVALID_TOKEN", "token is invalid or expired")
				return
			}

			// Build context user from claims
			ctxUser := &auth.ContextUser{
				ID:        claims.UserID,
				TenantID:  claims.TenantID,
				Email:     claims.Email,
				Roles:     claims.Roles,
				SessionID: claims.SessionID,
			}

			ctx := auth.WithUser(r.Context(), ctxUser)
			ctx = auth.WithTenantID(ctx, claims.TenantID)
			ctx = auth.WithClaims(ctx, claims)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequirePermission returns middleware that checks if the authenticated user
// has the required permission before allowing access.
//
// The check is TENANT-AWARE: when the service has registered a tenant
// role-permission overlay loader (auth.SetTenantOverlayLoader — today only
// lex-service, for activated role-matrix imports), the tenant's imported
// grants shadow the code-map defaults per role slug. In every service without
// a loader this is behaviourally identical to auth.HasPermission.
func RequirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := auth.UserFromContext(r.Context())
			if user == nil {
				writeAuthError(w, "UNAUTHENTICATED", "authentication required")
				return
			}

			if !auth.HasPermissionForTenant(r.Context(), user.TenantID, user.Roles, permission) {
				writeForbidden(w, []string{permission})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyPermission returns middleware that allows the request when the
// authenticated user holds AT LEAST ONE of the supplied permissions. It is used
// to gate routes behind a granular permission while still honouring a coarser
// legacy permission, so introducing finer-grained permissions never locks out
// roles that only carry the legacy grant (or an admin:* / resource:* wildcard).
func RequireAnyPermission(permissions ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := auth.UserFromContext(r.Context())
			if user == nil {
				writeAuthError(w, "UNAUTHENTICATED", "authentication required")
				return
			}

			if !auth.HasAnyPermissionForTenant(r.Context(), user.TenantID, user.Roles, permissions...) {
				writeForbidden(w, permissions)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// writeForbidden writes a 403 that NAMES the missing privilege so the client can
// render an actionable message ("you need X — contact a user with that role")
// instead of a silent console error. required lists the permission(s) the route
// demands (one for RequirePermission; any-of for RequireAnyPermission). The body
// stays backwards-compatible (status/code/message preserved) and just ADDS the
// required_permission(s) fields.
func writeForbidden(w http.ResponseWriter, required []string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	body := map[string]any{
		"status":  403,
		"code":    "FORBIDDEN",
		"message": "You do not have permission to perform this action. It requires a privilege your role does not hold — please contact your administrator or a user with the required role.",
	}
	switch len(required) {
	case 0:
		// no-op: generic forbidden
	case 1:
		body["required_permission"] = required[0]
	default:
		body["required_permissions"] = required
	}
	_ = json.NewEncoder(w).Encode(body)
}

// OptionalAuth attempts to extract a JWT but does not reject unauthenticated requests.
func OptionalAuth(jwtMgr *auth.JWTManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				next.ServeHTTP(w, r)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				next.ServeHTTP(w, r)
				return
			}

			claims, err := jwtMgr.ValidateAccessToken(parts[1])
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}

			ctxUser := &auth.ContextUser{
				ID:       claims.UserID,
				TenantID: claims.TenantID,
				Email:    claims.Email,
				Roles:    claims.Roles,
			}

			ctx := auth.WithUser(r.Context(), ctxUser)
			ctx = auth.WithTenantID(ctx, claims.TenantID)
			ctx = auth.WithClaims(ctx, claims)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeAuthError(w http.ResponseWriter, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  401,
		"code":    code,
		"message": message,
	})
}
