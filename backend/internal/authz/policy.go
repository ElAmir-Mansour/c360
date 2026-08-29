// Package authz implements an Attribute-Based Access Control (ABAC) policy
// engine for Clario 360. It is ADDITIVE to the existing role-based (RBAC)
// permission system: RBAC continues to gate every route as before, and ABAC
// only applies an extra attribute-condition layer when policies exist for a
// given action/resource. With no matching policies, the engine returns an
// "allow" decision so existing behavior is unchanged.
package authz

import (
	"strings"
	"time"
)

// Effect is the outcome a policy grants when it matches.
type Effect string

const (
	// EffectAllow grants access when the policy matches.
	EffectAllow Effect = "allow"
	// EffectDeny denies access when the policy matches. Deny always overrides allow.
	EffectDeny Effect = "deny"
)

// Operator enumerates the comparison operators supported in policy conditions.
type Operator string

const (
	OpEquals             Operator = "eq"     // attribute == value
	OpNotEquals          Operator = "neq"    // attribute != value
	OpIn                 Operator = "in"     // attribute is one of value([])
	OpNotIn              Operator = "not_in" // attribute is not one of value([])
	OpContains           Operator = "contains"
	OpGreaterThan        Operator = "gt"
	OpGreaterThanOrEqual Operator = "gte"
	OpLessThan           Operator = "lt"
	OpLessThanOrEqual    Operator = "lte"
	// OpAttrEquals compares two attributes to each other, e.g. resource.owner == subject.id.
	// The condition's Value holds the name of the second attribute reference.
	OpAttrEquals    Operator = "attr_eq"
	OpAttrNotEquals Operator = "attr_neq"
)

// Condition is a single boolean predicate evaluated against the request
// attributes. Attribute is a dotted reference such as "resource.owner",
// "subject.id", "subject.department", "subject.clearance",
// "resource.classification", or "env.time".
type Condition struct {
	Attribute string   `json:"attribute"`
	Operator  Operator `json:"operator"`
	// Value is the literal compared against, OR (for attr_eq/attr_neq) the name
	// of another attribute to compare with.
	Value any `json:"value,omitempty"`
}

// Policy is a tenant-scoped ABAC rule. A policy MATCHES a request when its
// Action and ResourceType match (with wildcard support) AND every condition
// evaluates true. The Effect of all matching policies is then combined with
// deny-overrides semantics.
type Policy struct {
	ID           string      `json:"id"`
	TenantID     string      `json:"tenant_id"`
	Name         string      `json:"name"`
	Description  string      `json:"description,omitempty"`
	Effect       Effect      `json:"effect"`
	Action       string      `json:"action"`        // permission/action this policy concerns, e.g. "data:read"; "*" matches any
	ResourceType string      `json:"resource_type"` // resource type, e.g. "document"; "*" matches any
	Conditions   []Condition `json:"conditions"`
	Priority     int         `json:"priority"`
	Enabled      bool        `json:"enabled"`
}

// Subject holds the attributes of the authenticated principal making the request.
type Subject struct {
	ID         string
	TenantID   string
	Roles      []string
	Department string
	// Clearance is the subject's data clearance level (e.g. "public",
	// "internal", "confidential", "restricted"). Compared against resource
	// Classification using the canonical ClassificationRank ordering.
	Clearance string
	// Attributes carries any additional custom subject attributes, addressable
	// as "subject.<key>" in conditions.
	Attributes map[string]any
}

// Resource holds the attributes of the resource being accessed.
type Resource struct {
	Type     string
	ID       string
	Owner    string
	TenantID string
	// Classification is the data classification of the resource. Compared
	// against subject Clearance using ClassificationRank.
	Classification string
	// Attributes carries any additional custom resource attributes, addressable
	// as "resource.<key>" in conditions.
	Attributes map[string]any
}

// Environment holds contextual attributes of the request (time, IP, etc.).
type Environment struct {
	Time       time.Time
	IPAddress  string
	Attributes map[string]any
}

// Decision is the result of evaluating a request against the policy set.
type Decision struct {
	// Allowed is true when access is permitted.
	Allowed bool
	// Reason is a human-readable explanation, useful for audit and debugging.
	Reason string
	// MatchedPolicyID is the ID of the policy that determined the decision, if any.
	MatchedPolicyID string
}

// ClassificationRank is the canonical ordering of data classification /
// clearance levels, lowest to highest sensitivity. It is used by the
// comparison operators when either operand looks like a classification value.
var ClassificationRank = map[string]int{
	"public":       0,
	"internal":     1,
	"confidential": 2,
	"restricted":   3,
	"secret":       4,
	"top_secret":   5,
}

// classificationLevel returns the numeric rank of a classification/clearance
// string and whether it is a recognized classification value.
func classificationLevel(v string) (int, bool) {
	rank, ok := ClassificationRank[strings.ToLower(strings.TrimSpace(v))]
	return rank, ok
}
