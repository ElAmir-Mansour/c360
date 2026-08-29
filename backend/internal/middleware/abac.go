package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/authz"
)

// ResourceExtractor derives the resource and action being accessed from the
// HTTP request, so the ABAC engine can evaluate attribute conditions against it.
// Routes that do not need resource-level attributes can return a zero Resource;
// the engine still evaluates subject/environment conditions.
type ResourceExtractor func(r *http.Request) (resource authz.Resource, action string)

// SubjectFromContext builds an ABAC Subject from the authenticated request
// context. Department and Clearance are read from claim extensions when present;
// otherwise they are left empty (conditions referencing them simply won't match,
// which is safe).
func SubjectFromContext(r *http.Request) authz.Subject {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		return authz.Subject{}
	}
	subj := authz.Subject{
		ID:       user.ID,
		TenantID: user.TenantID,
		Roles:    user.Roles,
	}

	// Enrich from full claims when available. These are read defensively so the
	// middleware never panics on a minimal token.
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		subj.Attributes = map[string]any{
			"email": claims.Email,
		}
	}
	return subj
}

// EnforceABAC returns middleware that applies the ABAC attribute-policy layer.
//
// It is ADDITIVE and BACKWARD-COMPATIBLE: apply it AFTER RequirePermission.
// RBAC (RequirePermission) still gates the route exactly as before. This
// middleware then asks the engine for a Decision; because the engine returns
// "allow" whenever no policy matches, routes without applicable ABAC policies
// are completely unaffected. Only when a tenant has configured matching
// policies — and one of them denies — does this middleware return 403.
//
// engine may be nil (e.g. ABAC not configured for a service); in that case the
// middleware is a transparent pass-through.
func EnforceABAC(engine *authz.Engine, extract ResourceExtractor) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if engine == nil {
				next.ServeHTTP(w, r)
				return
			}

			user := auth.UserFromContext(r.Context())
			if user == nil {
				// Defensive: EnforceABAC must run after Auth + RequirePermission.
				writeAuthError(w, "UNAUTHENTICATED", "authentication required")
				return
			}

			subject := SubjectFromContext(r)

			var (
				resource authz.Resource
				action   string
			)
			if extract != nil {
				resource, action = extract(r)
			}
			if resource.TenantID == "" {
				resource.TenantID = user.TenantID
			}

			env := authz.Environment{IPAddress: clientIP(r)}

			decision, err := engine.EvaluateWithEnv(r.Context(), subject, resource, env, action)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":  500,
					"code":    "ABAC_EVALUATION_FAILED",
					"message": "failed to evaluate access policy",
				})
				return
			}

			if !decision.Allowed {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":  403,
					"code":    "FORBIDDEN",
					"message": "access denied by attribute policy",
					"reason":  decision.Reason,
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// clientIP returns the best-effort client IP for environment conditions.
func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	return r.RemoteAddr
}
