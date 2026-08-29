package authz

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

// PolicyProvider supplies the set of policies relevant to a tenant. The engine
// calls it once per evaluation. Implementations should be fast (cached) because
// this sits on the request path.
type PolicyProvider interface {
	// PoliciesForTenant returns all enabled policies for the given tenant.
	// Implementations may return an empty slice (and nil error) when no
	// policies are configured — the engine treats that as "no ABAC rules ⇒ allow".
	PoliciesForTenant(ctx context.Context, tenantID string) ([]Policy, error)
}

// StaticPolicyProvider is an in-memory PolicyProvider, primarily for tests and
// for callers that want to evaluate against a fixed policy set.
type StaticPolicyProvider struct {
	Policies []Policy
}

// PoliciesForTenant returns the static policies that belong to the tenant.
func (p *StaticPolicyProvider) PoliciesForTenant(_ context.Context, tenantID string) ([]Policy, error) {
	out := make([]Policy, 0, len(p.Policies))
	for _, pol := range p.Policies {
		if pol.TenantID == "" || pol.TenantID == tenantID {
			out = append(out, pol)
		}
	}
	return out, nil
}

// Engine evaluates access requests against a PolicyProvider using
// deny-overrides combining semantics.
type Engine struct {
	provider PolicyProvider
}

// NewEngine constructs an ABAC engine backed by the given provider.
func NewEngine(provider PolicyProvider) *Engine {
	return &Engine{provider: provider}
}

// Evaluate decides whether the subject may perform action on the resource.
//
// Semantics (deny-overrides, default-allow when no policies match):
//   - Collect every policy whose Action and ResourceType match the request and
//     whose conditions all evaluate true.
//   - If ANY matching policy has Effect=deny, the decision is DENY (deny wins).
//   - Else if ANY matching policy has Effect=allow, the decision is ALLOW.
//   - If NO policy matches, the decision is ALLOW. This is the crucial
//     backward-compatibility property: routes with no applicable ABAC policy
//     behave exactly as they did under pure RBAC.
func (e *Engine) Evaluate(ctx context.Context, subject Subject, resource Resource, action string) (Decision, error) {
	if e == nil || e.provider == nil {
		return Decision{Allowed: true, Reason: "no policy provider configured"}, nil
	}

	policies, err := e.provider.PoliciesForTenant(ctx, subject.TenantID)
	if err != nil {
		return Decision{}, fmt.Errorf("loading abac policies: %w", err)
	}

	env := Environment{Time: timeNow()}
	return e.evaluatePolicies(policies, subject, resource, env, action), nil
}

// EvaluateWithEnv is Evaluate but lets the caller supply explicit environment
// attributes (time, IP, etc.).
func (e *Engine) EvaluateWithEnv(ctx context.Context, subject Subject, resource Resource, env Environment, action string) (Decision, error) {
	if e == nil || e.provider == nil {
		return Decision{Allowed: true, Reason: "no policy provider configured"}, nil
	}
	policies, err := e.provider.PoliciesForTenant(ctx, subject.TenantID)
	if err != nil {
		return Decision{}, fmt.Errorf("loading abac policies: %w", err)
	}
	if env.Time.IsZero() {
		env.Time = timeNow()
	}
	return e.evaluatePolicies(policies, subject, resource, env, action), nil
}

func (e *Engine) evaluatePolicies(policies []Policy, subject Subject, resource Resource, env Environment, action string) Decision {
	var allowMatch *Policy
	matched := 0

	for i := range policies {
		pol := policies[i]
		if !pol.Enabled {
			continue
		}
		if !actionMatches(pol.Action, action) {
			continue
		}
		if !resourceTypeMatches(pol.ResourceType, resource.Type) {
			continue
		}
		if !conditionsSatisfied(pol.Conditions, subject, resource, env) {
			continue
		}

		matched++
		// Deny overrides: a single matching deny short-circuits to DENY.
		if pol.Effect == EffectDeny {
			return Decision{
				Allowed:         false,
				Reason:          fmt.Sprintf("denied by policy %q", policyLabel(pol)),
				MatchedPolicyID: pol.ID,
			}
		}
		if pol.Effect == EffectAllow && allowMatch == nil {
			p := pol
			allowMatch = &p
		}
	}

	if allowMatch != nil {
		return Decision{
			Allowed:         true,
			Reason:          fmt.Sprintf("allowed by policy %q", policyLabel(*allowMatch)),
			MatchedPolicyID: allowMatch.ID,
		}
	}

	if matched == 0 {
		// No ABAC policy applies — preserve pure-RBAC behavior.
		return Decision{Allowed: true, Reason: "no matching abac policy; rbac decision stands"}
	}

	// Matched policies existed but none granted allow (and none denied, which is
	// impossible here). Defensive default: allow.
	return Decision{Allowed: true, Reason: "matching policies produced no explicit deny"}
}

// actionMatches reports whether a policy's action selector matches the request
// action. Supports exact match, "*" (any), and "prefix:*" wildcards
// (mirroring the RBAC permission wildcard convention).
func actionMatches(policyAction, requestAction string) bool {
	if policyAction == "" || policyAction == "*" {
		return true
	}
	if policyAction == requestAction {
		return true
	}
	if strings.HasSuffix(policyAction, ":*") {
		prefix := strings.TrimSuffix(policyAction, "*")
		return strings.HasPrefix(requestAction, prefix)
	}
	return false
}

// resourceTypeMatches reports whether a policy's resource-type selector matches
// the request's resource type. Empty or "*" matches any resource type.
func resourceTypeMatches(policyType, requestType string) bool {
	if policyType == "" || policyType == "*" {
		return true
	}
	return strings.EqualFold(policyType, requestType)
}

// conditionsSatisfied returns true when ALL conditions evaluate true (logical AND).
// An empty condition list is trivially satisfied.
func conditionsSatisfied(conditions []Condition, subject Subject, resource Resource, env Environment) bool {
	for _, c := range conditions {
		if !evalCondition(c, subject, resource, env) {
			return false
		}
	}
	return true
}

func evalCondition(c Condition, subject Subject, resource Resource, env Environment) bool {
	left, leftOK := resolveAttribute(c.Attribute, subject, resource, env)

	switch c.Operator {
	case OpEquals:
		return leftOK && valuesEqual(left, c.Value)
	case OpNotEquals:
		return !leftOK || !valuesEqual(left, c.Value)
	case OpIn:
		return leftOK && valueIn(left, c.Value)
	case OpNotIn:
		return !leftOK || !valueIn(left, c.Value)
	case OpContains:
		return leftOK && sliceContains(left, c.Value)
	case OpAttrEquals:
		ref, _ := c.Value.(string)
		right, rightOK := resolveAttribute(ref, subject, resource, env)
		return leftOK && rightOK && valuesEqual(left, right)
	case OpAttrNotEquals:
		ref, _ := c.Value.(string)
		right, rightOK := resolveAttribute(ref, subject, resource, env)
		// If either side is missing, treat them as unequal.
		if !leftOK || !rightOK {
			return true
		}
		return !valuesEqual(left, right)
	case OpGreaterThan, OpGreaterThanOrEqual, OpLessThan, OpLessThanOrEqual:
		if !leftOK {
			return false
		}
		return compareOrdered(c.Operator, left, c.Value)
	default:
		return false
	}
}

// resolveAttribute looks up a dotted attribute reference. Returns the value and
// whether it was found.
func resolveAttribute(ref string, subject Subject, resource Resource, env Environment) (any, bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, false
	}
	scope, key, found := strings.Cut(ref, ".")
	if !found {
		return nil, false
	}
	switch scope {
	case "subject":
		switch key {
		case "id":
			return subject.ID, subject.ID != ""
		case "tenant", "tenant_id":
			return subject.TenantID, subject.TenantID != ""
		case "roles":
			return subject.Roles, true
		case "department":
			return subject.Department, subject.Department != ""
		case "clearance", "classification":
			return subject.Clearance, subject.Clearance != ""
		default:
			v, ok := subject.Attributes[key]
			return v, ok
		}
	case "resource":
		switch key {
		case "id":
			return resource.ID, resource.ID != ""
		case "owner":
			return resource.Owner, resource.Owner != ""
		case "tenant", "tenant_id":
			return resource.TenantID, resource.TenantID != ""
		case "type":
			return resource.Type, resource.Type != ""
		case "classification":
			return resource.Classification, resource.Classification != ""
		default:
			v, ok := resource.Attributes[key]
			return v, ok
		}
	case "env":
		switch key {
		case "ip", "ip_address":
			return env.IPAddress, env.IPAddress != ""
		case "time":
			return env.Time, !env.Time.IsZero()
		default:
			v, ok := env.Attributes[key]
			return v, ok
		}
	}
	return nil, false
}

// valuesEqual compares two attribute values with light type coercion to string.
func valuesEqual(a, b any) bool {
	return toComparableString(a) == toComparableString(b)
}

// valueIn reports whether a is present in the set b (b is expected to be a slice).
func valueIn(a, b any) bool {
	target := toComparableString(a)
	for _, item := range toSlice(b) {
		if toComparableString(item) == target {
			return true
		}
	}
	return false
}

// sliceContains reports whether the slice attribute a contains value b.
func sliceContains(a, b any) bool {
	target := toComparableString(b)
	for _, item := range toSlice(a) {
		if toComparableString(item) == target {
			return true
		}
	}
	return false
}

// compareOrdered handles gt/gte/lt/lte. If both operands parse as numbers it
// compares numerically; otherwise it compares using ClassificationRank so that
// clearance/classification levels order correctly. Falls back to string compare.
func compareOrdered(op Operator, left, right any) bool {
	ls := toComparableString(left)
	rs := toComparableString(right)

	if lf, lok := parseFloat(ls); lok {
		if rf, rok := parseFloat(rs); rok {
			return applyOrder(op, lf, rf)
		}
	}

	if ll, lok := classificationLevel(ls); lok {
		if rl, rok := classificationLevel(rs); rok {
			return applyOrder(op, float64(ll), float64(rl))
		}
	}

	// Lexical fallback.
	return applyOrderStr(op, ls, rs)
}

func applyOrder(op Operator, l, r float64) bool {
	switch op {
	case OpGreaterThan:
		return l > r
	case OpGreaterThanOrEqual:
		return l >= r
	case OpLessThan:
		return l < r
	case OpLessThanOrEqual:
		return l <= r
	}
	return false
}

func applyOrderStr(op Operator, l, r string) bool {
	switch op {
	case OpGreaterThan:
		return l > r
	case OpGreaterThanOrEqual:
		return l >= r
	case OpLessThan:
		return l < r
	case OpLessThanOrEqual:
		return l <= r
	}
	return false
}

func toComparableString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case float64:
		// Render integers without trailing .0 for stable equality with strings.
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func toSlice(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case []string:
		out := make([]any, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out
	case nil:
		return nil
	default:
		return []any{t}
	}
}

func parseFloat(s string) (float64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

func policyLabel(p Policy) string {
	if p.Name != "" {
		return p.Name
	}
	if p.ID != "" {
		return p.ID
	}
	return string(p.Effect) + ":" + p.Action
}
