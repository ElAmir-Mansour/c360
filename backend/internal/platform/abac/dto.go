package abac

import (
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/authz"
)

// knownOperators is the set of operators the engine understands (mirrors the
// constants in authz/policy.go). Validation rejects anything outside this set so
// a policy can never be persisted in a form the engine silently ignores.
var knownOperators = map[authz.Operator]bool{
	authz.OpEquals:             true,
	authz.OpNotEquals:          true,
	authz.OpIn:                 true,
	authz.OpNotIn:              true,
	authz.OpContains:           true,
	authz.OpGreaterThan:        true,
	authz.OpGreaterThanOrEqual: true,
	authz.OpLessThan:           true,
	authz.OpLessThanOrEqual:    true,
	authz.OpAttrEquals:         true,
	authz.OpAttrNotEquals:      true,
}

// knownAttributeScopes are the valid prefixes for a dotted attribute reference
// (e.g. "subject.department", "resource.classification", "env.ip").
var knownAttributeScopes = map[string]bool{
	"subject":  true,
	"resource": true,
	"env":      true,
}

// conditionDTO mirrors authz.Condition for request decoding.
type conditionDTO struct {
	Attribute string         `json:"attribute"`
	Operator  authz.Operator `json:"operator"`
	Value     any            `json:"value,omitempty"`
}

// policyRequest is the body for create/update. tenant_id and id are taken from
// the JWT and the URL respectively, never from the body.
type policyRequest struct {
	Name         string         `json:"name"`
	Description  string         `json:"description,omitempty"`
	Effect       authz.Effect   `json:"effect"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	Conditions   []conditionDTO `json:"conditions"`
	Priority     int            `json:"priority"`
	Enabled      bool           `json:"enabled"`
}

// validate enforces the documented constraints: name required, effect in
// (allow,deny), every condition's operator in the known set and attribute a
// valid dotted reference with a (subject|resource|env) prefix.
func (req policyRequest) validate() (string, bool) {
	if strings.TrimSpace(req.Name) == "" {
		return "'name' is required", false
	}
	if req.Effect != authz.EffectAllow && req.Effect != authz.EffectDeny {
		return "'effect' must be one of: allow, deny", false
	}
	if strings.TrimSpace(req.Action) == "" {
		return "'action' is required", false
	}
	if strings.TrimSpace(req.ResourceType) == "" {
		return "'resource_type' is required", false
	}
	for i, c := range req.Conditions {
		if !knownOperators[c.Operator] {
			return fmt.Sprintf("conditions[%d]: unknown operator %q", i, c.Operator), false
		}
		if msg, ok := validateAttributeRef(c.Attribute); !ok {
			return fmt.Sprintf("conditions[%d]: %s", i, msg), false
		}
		// attr_eq/attr_neq compare against another attribute reference held in Value.
		if c.Operator == authz.OpAttrEquals || c.Operator == authz.OpAttrNotEquals {
			ref, _ := c.Value.(string)
			if msg, ok := validateAttributeRef(ref); !ok {
				return fmt.Sprintf("conditions[%d].value: %s", i, msg), false
			}
		}
	}
	return "", true
}

// validateAttributeRef checks that a reference is "<scope>.<key>" with a known
// scope prefix and a non-empty key.
func validateAttributeRef(ref string) (string, bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "attribute reference is required", false
	}
	scope, key, found := strings.Cut(ref, ".")
	if !found || key == "" {
		return fmt.Sprintf("attribute %q must be a dotted reference like 'subject.department'", ref), false
	}
	if !knownAttributeScopes[scope] {
		return fmt.Sprintf("attribute %q must start with subject, resource, or env", ref), false
	}
	return "", true
}

func (req policyRequest) toPolicy() authz.Policy {
	conditions := make([]authz.Condition, 0, len(req.Conditions))
	for _, c := range req.Conditions {
		conditions = append(conditions, authz.Condition{
			Attribute: c.Attribute,
			Operator:  c.Operator,
			Value:     c.Value,
		})
	}
	return authz.Policy{
		Name:         req.Name,
		Description:  req.Description,
		Effect:       req.Effect,
		Action:       req.Action,
		ResourceType: req.ResourceType,
		Conditions:   conditions,
		Priority:     req.Priority,
		Enabled:      req.Enabled,
	}
}

// --- simulate ---

type subjectDTO struct {
	ID         string         `json:"id,omitempty"`
	Roles      []string       `json:"roles,omitempty"`
	Department string         `json:"department,omitempty"`
	Clearance  string         `json:"clearance,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

func (s subjectDTO) toSubject() authz.Subject {
	return authz.Subject{
		ID:         s.ID,
		Roles:      s.Roles,
		Department: s.Department,
		Clearance:  s.Clearance,
		Attributes: s.Attributes,
	}
}

type resourceDTO struct {
	Type           string         `json:"type,omitempty"`
	ID             string         `json:"id,omitempty"`
	Owner          string         `json:"owner,omitempty"`
	TenantID       string         `json:"tenant_id,omitempty"`
	Classification string         `json:"classification,omitempty"`
	Attributes     map[string]any `json:"attributes,omitempty"`
}

func (rs resourceDTO) toResource() authz.Resource {
	return authz.Resource{
		Type:           rs.Type,
		ID:             rs.ID,
		Owner:          rs.Owner,
		TenantID:       rs.TenantID,
		Classification: rs.Classification,
		Attributes:     rs.Attributes,
	}
}

type envDTO struct {
	IPAddress  string         `json:"ip_address,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

func (e envDTO) toEnvironment() authz.Environment {
	return authz.Environment{
		IPAddress:  e.IPAddress,
		Attributes: e.Attributes,
	}
}

type simulateRequest struct {
	Subject  subjectDTO  `json:"subject"`
	Resource resourceDTO `json:"resource"`
	Action   string      `json:"action"`
	Env      envDTO      `json:"env"`
}

type simulateResponse struct {
	Allowed         bool   `json:"allowed"`
	Reason          string `json:"reason"`
	MatchedPolicyID string `json:"matched_policy_id"`
}
