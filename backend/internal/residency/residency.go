// Package residency implements WTQ-SEC-03 — app-level data-residency binding
// and enforcement.
//
// Physical hosting placement (which datacenter/region a deployment actually runs
// in) is an infrastructure concern and is out of scope here. This package
// provides the *code mechanism* that binds each tenant to a residency region and
// enforces, at request time, that the current deployment (ServiceRegion) is
// permitted to serve that tenant's data. When residency enforcement is disabled
// (no ServiceRegion configured) or a tenant has no residency region set, all
// requests pass through unchanged — preserving existing behavior.
package residency

import "strings"

// Decision is the outcome of an EnforceRegion evaluation.
type Decision int

const (
	// Allow means the deployment is permitted to serve the tenant's data.
	Allow Decision = iota
	// Deny means the deployment must not serve the tenant's data (region mismatch).
	Deny
)

func (d Decision) String() string {
	switch d {
	case Allow:
		return "allow"
	case Deny:
		return "deny"
	default:
		return "unknown"
	}
}

// normalizeRegion lower-cases and trims a region string for case-insensitive,
// whitespace-tolerant comparison.
func normalizeRegion(region string) string {
	return strings.ToLower(strings.TrimSpace(region))
}

// EnforceRegion decides whether a deployment running in serviceRegion may serve
// data for a tenant bound to tenantRegion, given an optional allowlist of
// additional regions the deployment may serve.
//
// Decision rules:
//   - serviceRegion empty            => Allow (enforcement disabled).
//   - tenantRegion empty             => Allow (tenant is unrestricted).
//   - tenantRegion == serviceRegion  => Allow (same region).
//   - tenantRegion in allowedRegions => Allow (explicitly permitted).
//   - otherwise                      => Deny (cross-region access).
//
// Comparison is case-insensitive and whitespace-tolerant.
func EnforceRegion(tenantRegion, serviceRegion string, allowedRegions ...string) Decision {
	svc := normalizeRegion(serviceRegion)
	if svc == "" {
		// Enforcement disabled for this deployment.
		return Allow
	}

	ten := normalizeRegion(tenantRegion)
	if ten == "" {
		// Tenant has no residency constraint.
		return Allow
	}

	if ten == svc {
		return Allow
	}

	for _, allowed := range allowedRegions {
		if ten == normalizeRegion(allowed) {
			return Allow
		}
	}

	return Deny
}
