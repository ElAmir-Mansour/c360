package residency

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
)

// Enforcer holds the deployment's residency policy and the tenant region loader.
// It produces a chi-compatible middleware that enforces WTQ-SEC-03 at request
// time.
type Enforcer struct {
	serviceRegion  string
	allowedRegions []string
	loader         RegionLoader
	logger         zerolog.Logger
}

// NewEnforcer builds an Enforcer from residency config and a region loader.
// The loader may be nil when enforcement is disabled (ServiceRegion empty); in
// that case the middleware is always a pass-through.
func NewEnforcer(cfg config.ResidencyConfig, loader RegionLoader) *Enforcer {
	return &Enforcer{
		serviceRegion:  cfg.ServiceRegion,
		allowedRegions: append([]string(nil), cfg.AllowedRegions...),
		loader:         loader,
		logger:         zerolog.Nop(),
	}
}

// WithAuditLogger attaches a logger that records every residency DENY decision
// as a structured "residency.denied" event — the in-code substrate of the
// WTQ-SEC-03 audit trail. Production log aggregation/retention and KSA-region
// deployment attestation remain an infra/audit gate. Backward-compatible: with
// no logger configured, residency decisions are not logged.
func (e *Enforcer) WithAuditLogger(l zerolog.Logger) *Enforcer {
	e.logger = l
	return e
}

func (e *Enforcer) auditDeny(tenantID, tenantRegion, reason string) {
	e.logger.Warn().
		Str("event", "residency.denied").
		Str("code", "RESIDENCY_VIOLATION").
		Str("tenant_id", tenantID).
		Str("tenant_region", tenantRegion).
		Str("service_region", e.serviceRegion).
		Str("reason", reason).
		Msg("data-residency enforcement denied request")
}

// Enabled reports whether this enforcer will actively enforce residency.
func (e *Enforcer) Enabled() bool {
	return e.serviceRegion != "" && e.loader != nil
}

// Middleware returns chi middleware enforcing data residency.
//
// Behavior:
//   - Enforcement disabled (no ServiceRegion or no loader): pass-through.
//   - No tenant in context: pass-through (tenant-less routes such as health
//     checks and login are unaffected; tenant binding is handled elsewhere).
//   - Tenant region unset (unrestricted): pass-through.
//   - Tenant region permitted for this ServiceRegion: pass-through.
//   - Tenant region NOT permitted: HTTP 403 with a clear reason.
//   - Tenant not found or load error while enforcing: HTTP 403 (fail-closed) —
//     residency must not be silently bypassed on a lookup failure.
func (e *Enforcer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !e.Enabled() {
			next.ServeHTTP(w, r)
			return
		}

		tenantID := auth.TenantFromContext(r.Context())
		if tenantID == "" {
			// No tenant context to enforce against (e.g. public/health routes).
			next.ServeHTTP(w, r)
			return
		}

		tenantRegion, err := e.loader.TenantRegion(r.Context(), tenantID)
		if err != nil {
			if errors.Is(err, ErrTenantNotFound) {
				reason := "tenant has no resolvable residency binding; refusing to serve data from this region"
				e.auditDeny(tenantID, "", reason)
				writeResidencyDenied(w, reason)
				return
			}
			// Lookup failure must not bypass residency — fail closed.
			reason := "unable to verify tenant data-residency region"
			e.auditDeny(tenantID, "", reason)
			writeResidencyDenied(w, reason)
			return
		}

		if EnforceRegion(tenantRegion, e.serviceRegion, e.allowedRegions...) == Deny {
			reason := "tenant data may not be served from this region (" + e.serviceRegion + ")"
			e.auditDeny(tenantID, tenantRegion, reason)
			writeResidencyDenied(w, reason)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// writeResidencyDenied writes a structured 403 response mirroring the platform's
// existing middleware error shape.
func writeResidencyDenied(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  http.StatusForbidden,
		"code":    "RESIDENCY_VIOLATION",
		"message": reason,
	})
}
