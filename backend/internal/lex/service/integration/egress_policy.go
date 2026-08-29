package integration

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Egress policy (#15 — data residency / field egress governance).
//
// Two per-endpoint NON-secret config fields declare what may leave the boundary
// when a connector calls an external system:
//
//   - allowed_regions       — the destination regions an endpoint may egress to
//     (PDPL data-residency; e.g. ["sa"] = in-Kingdom only). Empty = unconstrained.
//   - allowed_egress_fields — the field names permitted to leave (data-minimisation
//     allow-list; e.g. ["national_id","case_number"]). Empty = unconstrained.
//
// EgressEnforcer.Check is called in the registry's Sync/Invoke dispatch path with
// the fields a call would egress and the destination region. A disallowed region or
// field is DENIED (a secret-free validation error) and AUDITED (egress.blocked), so
// a residency/minimisation breach is stopped before the connector opens a connection.
//
// CUSTODY. The policy reads non-sensitive config only and audits field NAMES and
// region only — never field VALUES, never secrets.
// =============================================================================

// AllowedRegionsKey is the per-endpoint NON-secret config field naming the
// destination regions an endpoint may egress to (data residency). Empty = any.
const AllowedRegionsKey = "allowed_regions"

// AllowedEgressFieldsKey is the per-endpoint NON-secret config field naming the
// field allow-list permitted to leave the boundary (data minimisation). Empty = any.
const AllowedEgressFieldsKey = "allowed_egress_fields"

// EgressPolicy is the resolved data-residency + field-egress policy for one
// endpoint, surfaced over GET /integrations/{id}/egress-policy and enforced on every
// outbound call. It is non-sensitive. BlockedCount is a running tally of denied
// egress attempts (operational telemetry the console badges).
type EgressPolicy struct {
	AllowedRegions      []string  `json:"allowed_regions"`
	AllowedEgressFields []string  `json:"allowed_egress_fields"`
	BlockedCount        int       `json:"blocked_count"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// EgressPolicyFromConfig reads the allowed_regions + allowed_egress_fields lists
// from an endpoint's (non-secret) config, tolerating []any / []string / a
// comma-separated string encoding (the config map round-trips through JSON and the
// masked-config echo). Values are lower-cased + trimmed; blanks are dropped. The
// BlockedCount + UpdatedAt are sourced from metadata (egress_blocked_count,
// egress_policy_updated_at) when present.
func EgressPolicyFromConfig(endpoint model.IntegrationEndpoint) EgressPolicy {
	p := EgressPolicy{
		AllowedRegions:      stringList(endpoint.Config[AllowedRegionsKey]),
		AllowedEgressFields: stringList(endpoint.Config[AllowedEgressFieldsKey]),
	}
	if endpoint.Metadata != nil {
		if v, ok := endpoint.Metadata["egress_blocked_count"]; ok {
			p.BlockedCount = asInt(v)
		}
		if v, ok := endpoint.Metadata["egress_policy_updated_at"].(string); ok && strings.TrimSpace(v) != "" {
			if t, err := time.Parse(time.RFC3339, strings.TrimSpace(v)); err == nil {
				p.UpdatedAt = t.UTC()
			}
		}
	}
	return p
}

// RegionAllowed reports whether a destination region may receive egress under this
// policy. An EMPTY allow-list is unconstrained (any region allowed); otherwise the
// region (case-insensitive) must be in the list. An empty region argument is treated
// as allowed (the caller did not assert a region — region enforcement is opt-in per
// call).
func (p EgressPolicy) RegionAllowed(region string) bool {
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "" || len(p.AllowedRegions) == 0 {
		return true
	}
	for _, r := range p.AllowedRegions {
		if r == region {
			return true
		}
	}
	return false
}

// DisallowedFields returns the egress field names NOT permitted by the policy's
// field allow-list. An EMPTY allow-list is unconstrained (no field is disallowed).
// Field names are compared case-insensitively. The result is sorted for a stable,
// secret-free audit/error message.
func (p EgressPolicy) DisallowedFields(fields []string) []string {
	if len(p.AllowedEgressFields) == 0 {
		return nil
	}
	allow := map[string]bool{}
	for _, f := range p.AllowedEgressFields {
		allow[f] = true
	}
	var bad []string
	for _, f := range fields {
		key := strings.ToLower(strings.TrimSpace(f))
		if key == "" {
			continue
		}
		if !allow[key] {
			bad = append(bad, key)
		}
	}
	sort.Strings(bad)
	return bad
}

// EgressAuditEmitter is the thin seam the enforcer uses to record a denied egress to
// the lex audit trail. It is satisfied by a small adapter over the registry's
// LexAuditEmitter wired at construction time; a nil emitter disables audit (the deny
// still happens). It carries field NAMES + region only — never values or secrets.
type EgressAuditEmitter interface {
	EmitEgressBlocked(ctx context.Context, tenantID uuid.UUID, endpoint model.IntegrationEndpoint, region string, fields []string, reason string)
}

// EgressEnforcer enforces an endpoint's data-residency + field-egress policy on the
// outbound dispatch path. The registry calls Check in Sync/Invoke with the fields a
// call would egress and the destination region; a disallowed region/field is DENIED
// + AUDITED. A nil enforcer (or an endpoint with an unconstrained policy) is a
// no-op allow, so the existing dispatch path is untouched when no policy is set.
type EgressEnforcer struct {
	audit EgressAuditEmitter
}

// NewEgressEnforcer builds the enforcer. A nil audit emitter disables audit (the
// deny still occurs); it is wired at construction time by the integrator.
func NewEgressEnforcer(audit EgressAuditEmitter) *EgressEnforcer {
	return &EgressEnforcer{audit: audit}
}

// ErrEgressDenied classifies a denied-egress outcome so the registry can map it to a
// secret-free 422 validation error.
type EgressDeniedError struct {
	Region string
	Fields []string
	Reason string
}

func (e *EgressDeniedError) Error() string {
	if e.Reason != "" {
		return e.Reason
	}
	return "egress denied by data-residency / field-egress policy"
}

// Check enforces the endpoint's egress policy for an outbound call carrying the
// named fields to the destination region. It returns a secret-free EgressDeniedError
// (and audits egress.blocked) when the region is outside allowed_regions OR any field
// is outside allowed_egress_fields; otherwise it returns nil (allow). An endpoint with
// an unconstrained policy (both lists empty) always allows. fields/region are the
// call's egress surface — the caller passes field NAMES only, never values.
func (e *EgressEnforcer) Check(ctx context.Context, endpoint model.IntegrationEndpoint, fields []string, region string) error {
	policy := EgressPolicyFromConfig(endpoint)
	// Unconstrained: nothing to enforce.
	if len(policy.AllowedRegions) == 0 && len(policy.AllowedEgressFields) == 0 {
		return nil
	}
	if !policy.RegionAllowed(region) {
		reason := fmt.Sprintf("egress to region %q is not permitted by the endpoint data-residency policy", strings.ToLower(strings.TrimSpace(region)))
		e.auditBlocked(ctx, endpoint, region, nil, reason)
		return &EgressDeniedError{Region: strings.ToLower(strings.TrimSpace(region)), Reason: reason}
	}
	if bad := policy.DisallowedFields(fields); len(bad) > 0 {
		reason := fmt.Sprintf("egress of field(s) %s is not permitted by the endpoint field-egress allow-list", strings.Join(bad, ", "))
		e.auditBlocked(ctx, endpoint, region, bad, reason)
		return &EgressDeniedError{Region: strings.ToLower(strings.TrimSpace(region)), Fields: bad, Reason: reason}
	}
	return nil
}

func (e *EgressEnforcer) auditBlocked(ctx context.Context, endpoint model.IntegrationEndpoint, region string, fields []string, reason string) {
	if e == nil || e.audit == nil {
		return
	}
	e.audit.EmitEgressBlocked(ctx, endpoint.TenantID, endpoint, region, fields, reason)
}

// stringList coerces a config value (which round-trips through JSON) into a
// lower-cased, trimmed, de-blanked string slice. It accepts []any, []string, and a
// comma-separated string. Anything else yields an empty slice.
func stringList(raw any) []string {
	if raw == nil {
		return nil
	}
	var out []string
	switch v := raw.(type) {
	case []string:
		for _, s := range v {
			if t := strings.ToLower(strings.TrimSpace(s)); t != "" {
				out = append(out, t)
			}
		}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				if t := strings.ToLower(strings.TrimSpace(s)); t != "" {
					out = append(out, t)
				}
			}
		}
	case string:
		for _, s := range strings.Split(v, ",") {
			if t := strings.ToLower(strings.TrimSpace(s)); t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}

// asInt coerces a JSON-decoded numeric (int / int64 / float64 / string) to an int,
// defaulting to 0.
func asInt(raw any) int {
	switch v := raw.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case string:
		n := 0
		_, _ = fmt.Sscanf(strings.TrimSpace(v), "%d", &n)
		return n
	default:
		return 0
	}
}
