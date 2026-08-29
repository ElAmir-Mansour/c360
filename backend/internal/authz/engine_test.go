package authz

import (
	"context"
	"testing"
)

const testTenant = "tenant-1"

func eng(policies ...Policy) *Engine {
	return NewEngine(&StaticPolicyProvider{Policies: policies})
}

// TestEvaluate_NoPolicies_AllowsByDefault is the backward-compatibility
// guarantee: with no ABAC policies, the engine allows everything so pure-RBAC
// behavior is preserved.
func TestEvaluate_NoPolicies_AllowsByDefault(t *testing.T) {
	d, err := eng().Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document", Owner: "someone-else"},
		"data:read")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("expected allow with no policies, got deny: %s", d.Reason)
	}
}

// TestEvaluate_NoMatchingPolicy_Allows ensures policies that don't match the
// action/resource leave the request allowed (RBAC unchanged).
func TestEvaluate_NoMatchingPolicy_Allows(t *testing.T) {
	p := Policy{
		ID: "p-deny-cyber", TenantID: testTenant, Effect: EffectDeny,
		Action: "cyber:write", ResourceType: "incident", Enabled: true,
	}
	d, err := eng(p).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document"},
		"data:read")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("expected allow when no policy matches action/resource, got deny: %s", d.Reason)
	}
}

func TestEvaluate_AllowPolicyMatches(t *testing.T) {
	p := Policy{
		ID: "p-allow", TenantID: testTenant, Effect: EffectAllow,
		Action: "data:read", ResourceType: "document", Enabled: true,
		Conditions: []Condition{
			{Attribute: "resource.owner", Operator: OpAttrEquals, Value: "subject.id"},
		},
	}
	d, err := eng(p).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document", Owner: "u1"},
		"data:read")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("expected allow, got deny: %s", d.Reason)
	}
	if d.MatchedPolicyID != "p-allow" {
		t.Fatalf("expected matched policy p-allow, got %q", d.MatchedPolicyID)
	}
}

// TestEvaluate_DenyOverridesAllow proves deny-overrides combining: when both an
// allow and a deny policy match, the result is DENY.
func TestEvaluate_DenyOverridesAllow(t *testing.T) {
	allow := Policy{
		ID: "p-allow", TenantID: testTenant, Effect: EffectAllow,
		Action: "data:read", ResourceType: "document", Enabled: true,
	}
	deny := Policy{
		ID: "p-deny", TenantID: testTenant, Effect: EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: true,
		Conditions: []Condition{
			{Attribute: "resource.classification", Operator: OpEquals, Value: "restricted"},
		},
	}
	d, err := eng(allow, deny).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document", Classification: "restricted"},
		"data:read")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if d.Allowed {
		t.Fatalf("expected deny to override allow, got allow: %s", d.Reason)
	}
	if d.MatchedPolicyID != "p-deny" {
		t.Fatalf("expected matched policy p-deny, got %q", d.MatchedPolicyID)
	}
}

// TestEvaluate_OwnerCondition covers resource.owner == subject.id match/no-match.
func TestEvaluate_OwnerCondition(t *testing.T) {
	// Deny when the subject is NOT the owner.
	deny := Policy{
		ID: "p-owner-only", TenantID: testTenant, Effect: EffectDeny,
		Action: "data:write", ResourceType: "document", Enabled: true,
		Conditions: []Condition{
			{Attribute: "resource.owner", Operator: OpAttrNotEquals, Value: "subject.id"},
		},
	}
	e := eng(deny)

	// Owner matches → no deny condition triggers → allowed.
	owned, _ := e.Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document", Owner: "u1"},
		"data:write")
	if !owned.Allowed {
		t.Fatalf("expected allow when subject owns resource, got deny: %s", owned.Reason)
	}

	// Owner differs → deny condition triggers → denied.
	notOwned, _ := e.Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document", Owner: "u2"},
		"data:write")
	if notOwned.Allowed {
		t.Fatalf("expected deny when subject does not own resource, got allow: %s", notOwned.Reason)
	}
}

// TestEvaluate_ClassificationComparison covers the classification/clearance
// ordering: deny reads where the resource classification exceeds the subject's
// clearance.
func TestEvaluate_ClassificationComparison(t *testing.T) {
	// Model "subject may not read above their clearance" as a deny that fires
	// when the resource classification is >= restricted AND the subject's
	// clearance is < restricted. This exercises the ClassificationRank ordering.
	denyRestricted := Policy{
		ID: "p-deny-restricted", TenantID: testTenant, Effect: EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: true,
		Conditions: []Condition{
			{Attribute: "resource.classification", Operator: OpGreaterThanOrEqual, Value: "restricted"},
			{Attribute: "subject.clearance", Operator: OpLessThan, Value: "restricted"},
		},
	}
	e := eng(denyRestricted)

	// Low-clearance subject reading a restricted doc → denied.
	low, _ := e.Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant, Clearance: "internal"},
		Resource{Type: "document", Classification: "restricted"},
		"data:read")
	if low.Allowed {
		t.Fatalf("expected deny for low-clearance subject reading restricted doc, got allow: %s", low.Reason)
	}

	// High-clearance subject reading the same doc → allowed (deny condition not met).
	high, _ := e.Evaluate(context.Background(),
		Subject{ID: "u2", TenantID: testTenant, Clearance: "restricted"},
		Resource{Type: "document", Classification: "restricted"},
		"data:read")
	if !high.Allowed {
		t.Fatalf("expected allow for cleared subject reading restricted doc, got deny: %s", high.Reason)
	}
}

func TestEvaluate_TenantScoping(t *testing.T) {
	// A deny policy belonging to a different tenant must not affect this tenant.
	deny := Policy{
		ID: "p-other-tenant", TenantID: "tenant-2", Effect: EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: true,
	}
	d, _ := eng(deny).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document"},
		"data:read")
	if !d.Allowed {
		t.Fatalf("expected allow — other tenant's deny must not apply, got deny: %s", d.Reason)
	}
}

func TestEvaluate_DisabledPolicyIgnored(t *testing.T) {
	deny := Policy{
		ID: "p-disabled", TenantID: testTenant, Effect: EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: false,
	}
	d, _ := eng(deny).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant},
		Resource{Type: "document"},
		"data:read")
	if !d.Allowed {
		t.Fatalf("expected allow — disabled deny must be ignored, got deny: %s", d.Reason)
	}
}

func TestEvaluate_WildcardActionAndResource(t *testing.T) {
	deny := Policy{
		ID: "p-wild", TenantID: testTenant, Effect: EffectDeny,
		Action: "data:*", ResourceType: "*", Enabled: true,
		Conditions: []Condition{
			{Attribute: "subject.department", Operator: OpEquals, Value: "contractor"},
		},
	}
	e := eng(deny)

	denied, _ := e.Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant, Department: "contractor"},
		Resource{Type: "anything"},
		"data:delete")
	if denied.Allowed {
		t.Fatalf("expected wildcard deny for contractor, got allow: %s", denied.Reason)
	}

	allowed, _ := e.Evaluate(context.Background(),
		Subject{ID: "u2", TenantID: testTenant, Department: "staff"},
		Resource{Type: "anything"},
		"data:delete")
	if !allowed.Allowed {
		t.Fatalf("expected allow for staff department, got deny: %s", allowed.Reason)
	}
}

func TestEvaluate_InOperator(t *testing.T) {
	deny := Policy{
		ID: "p-dept-in", TenantID: testTenant, Effect: EffectDeny,
		Action: "*", ResourceType: "*", Enabled: true,
		Conditions: []Condition{
			{Attribute: "subject.department", Operator: OpIn, Value: []any{"contractor", "intern"}},
		},
	}
	d, _ := eng(deny).Evaluate(context.Background(),
		Subject{ID: "u1", TenantID: testTenant, Department: "intern"},
		Resource{Type: "x"},
		"data:read")
	if d.Allowed {
		t.Fatalf("expected deny for intern via in-operator, got allow")
	}
}

func TestStaticProvider_GlobalPolicyAppliesToAllTenants(t *testing.T) {
	// A policy with empty TenantID is treated as global by the static provider.
	global := Policy{ID: "g", Effect: EffectDeny, Action: "*", ResourceType: "*", Enabled: true}
	p := &StaticPolicyProvider{Policies: []Policy{global}}
	got, _ := p.PoliciesForTenant(context.Background(), "any-tenant")
	if len(got) != 1 {
		t.Fatalf("expected 1 global policy, got %d", len(got))
	}
}
