package service

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func rapFloat(v float64) *float64 { return &v }
func rapString(v string) *string  { return &v }

func rapTime(s string) *time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return &t
}

func rapStage(v string) *model.RequestApprovalStage {
	stage := model.RequestApprovalStage(v)
	return &stage
}

func TestRequestScopesOverlap_AllDimensionsANDed(t *testing.T) {
	serviceA := uuid.New()
	serviceB := uuid.New()
	base := requestApprovalScope{
		RequestType:  rapString("legal_advice"),
		ServiceID:    &serviceA,
		Stage:        rapStage("requester"),
		Department:   rapString("Legal"),
		PriorityTier: rapString("urgent"),
		MinValue:     rapFloat(0),
		MaxValue:     rapFloat(100),
		ValidFrom:    rapTime("2026-01-01T00:00:00Z"),
		ValidUntil:   rapTime("2026-12-31T00:00:00Z"),
	}

	if !requestScopesOverlap(base, base) {
		t.Fatal("identical request approval scope must overlap")
	}

	other := base
	other.ServiceID = &serviceB
	if requestScopesOverlap(base, other) {
		t.Fatal("different concrete services must not overlap")
	}

	other = base
	other.Stage = rapStage("provider")
	if requestScopesOverlap(base, other) {
		t.Fatal("different concrete stages must not overlap")
	}

	other = base
	other.RequestType = nil
	if !requestScopesOverlap(base, other) {
		t.Fatal("any request type must overlap a concrete request type")
	}

	other = base
	other.Department = rapString("legal")
	if !requestScopesOverlap(base, other) {
		t.Fatal("case-insensitive department match must overlap")
	}

	other = base
	other.PriorityTier = rapString("standard")
	if requestScopesOverlap(base, other) {
		t.Fatal("different concrete priority tiers must not overlap")
	}

	other = base
	other.MinValue = rapFloat(200)
	other.MaxValue = rapFloat(300)
	if requestScopesOverlap(base, other) {
		t.Fatal("disjoint value ranges must not overlap")
	}

	other = base
	other.ValidFrom = rapTime("2027-01-01T00:00:00Z")
	other.ValidUntil = rapTime("2027-12-31T00:00:00Z")
	if requestScopesOverlap(base, other) {
		t.Fatal("disjoint effective windows must not overlap")
	}
}

func TestRequestScopesIdentical(t *testing.T) {
	serviceID := uuid.New()
	base := requestApprovalScope{
		RequestType:  rapString("legal_advice"),
		ServiceID:    &serviceID,
		Stage:        rapStage("requester"),
		Department:   rapString("Legal"),
		PriorityTier: rapString("urgent"),
		MinValue:     rapFloat(0),
		MaxValue:     rapFloat(100),
		ValidFrom:    rapTime("2026-01-01T00:00:00Z"),
		ValidUntil:   rapTime("2026-12-31T00:00:00Z"),
	}

	same := base
	if !requestScopesIdentical(base, same) {
		t.Fatal("identical request approval scopes must compare equal")
	}

	caseDiff := base
	caseDiff.RequestType = rapString("LEGAL_ADVICE")
	caseDiff.Stage = rapStage("REQUESTER")
	caseDiff.Department = rapString("legal")
	caseDiff.PriorityTier = rapString("URGENT")
	if !requestScopesIdentical(base, caseDiff) {
		t.Fatal("category-like dimensions should compare case-insensitively")
	}

	overlapRange := base
	overlapRange.MaxValue = rapFloat(150)
	if requestScopesIdentical(base, overlapRange) {
		t.Fatal("overlapping-but-distinct ranges must not be identical")
	}
	if !requestScopesOverlap(base, overlapRange) {
		t.Fatal("overlapping range should still overlap")
	}

	anyService := base
	anyService.ServiceID = nil
	if requestScopesIdentical(base, anyService) {
		t.Fatal("nil service and concrete service must not be identical")
	}
}

func TestRequestConflictReason(t *testing.T) {
	if got := requestConflictReason(requestApprovalScope{}, false); got != "another active policy has an overlapping (unbounded) scope" {
		t.Fatalf("unbounded reason = %q", got)
	}
	if got := requestConflictReason(requestApprovalScope{}, true); got != "another active policy targets the identical scope" {
		t.Fatalf("identical reason = %q", got)
	}

	serviceID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	reason := requestConflictReason(requestApprovalScope{
		RequestType:  rapString("legal_advice"),
		ServiceID:    &serviceID,
		Stage:        rapStage("provider"),
		Department:   rapString("Legal"),
		PriorityTier: rapString("urgent"),
		MinValue:     rapFloat(10),
		ValidFrom:    rapTime("2026-01-01T00:00:00Z"),
	}, false)
	for _, want := range []string{
		"request type legal_advice",
		"service " + serviceID.String(),
		"stage provider",
		"department Legal",
		"priority tier urgent",
		"an overlapping value range",
		"an overlapping effective window",
	} {
		if !strings.Contains(reason, want) {
			t.Fatalf("reason %q missing %q", reason, want)
		}
	}
}

func TestHasRequestIdenticalConflict(t *testing.T) {
	if hasRequestIdenticalConflict(nil) {
		t.Fatal("nil conflicts must report no identical conflict")
	}
	if hasRequestIdenticalConflict([]RequestApprovalPolicyConflict{{Identical: false}}) {
		t.Fatal("overlap-only conflicts must not be identical")
	}
	if !hasRequestIdenticalConflict([]RequestApprovalPolicyConflict{{Identical: false}, {Identical: true}}) {
		t.Fatal("a single identical conflict must be detected")
	}
}

func TestRequestApprovalPolicyFromCreateRequestNormalizesRoutingAndScope(t *testing.T) {
	requireEvidence := false
	stage := model.RequestApprovalStage(" Provider ")
	requestType := " Legal Advice "
	department := " Legal "
	priorityTier := " Urgent "
	requiredRole := " CFO "
	policy, err := requestApprovalPolicyFromCreateRequest(uuid.New(), uuid.New(), dto.CreateRequestApprovalPolicyRequest{
		Name:                     "  Provider approval  ",
		RequestType:              &requestType,
		Stage:                    &stage,
		Department:               &department,
		PriorityTier:             &priorityTier,
		Currency:                 " usd ",
		Approvers:                []dto.ApprovalPolicyApprover{{Type: " Role ", Ref: " legal_approver ", Label: " Legal "}},
		RequireAuthorityEvidence: &requireEvidence,
		RequiredRole:             &requiredRole,
		Metadata:                 map[string]any{"source": "test"},
	})
	if err != nil {
		t.Fatalf("build policy: %v", err)
	}

	if policy.Name != "Provider approval" {
		t.Fatalf("name = %q", policy.Name)
	}
	if policy.Status != model.RequestApprovalPolicyStatusActive {
		t.Fatalf("status = %q", policy.Status)
	}
	if policy.RequestType == nil || *policy.RequestType != "Legal Advice" {
		t.Fatalf("request type = %v", policy.RequestType)
	}
	if policy.Stage == nil || *policy.Stage != model.RequestApprovalStageProvider {
		t.Fatalf("stage = %v", policy.Stage)
	}
	if policy.Department == nil || *policy.Department != "Legal" {
		t.Fatalf("department = %v", policy.Department)
	}
	if policy.PriorityTier == nil || *policy.PriorityTier != "Urgent" {
		t.Fatalf("priority tier = %v", policy.PriorityTier)
	}
	if policy.Currency != "USD" {
		t.Fatalf("currency = %q", policy.Currency)
	}
	if policy.RequireAuthorityEvidence {
		t.Fatal("require authority evidence should honor explicit false")
	}
	if policy.RequiredRole == nil || *policy.RequiredRole != "cfo" {
		t.Fatalf("required role = %v", policy.RequiredRole)
	}
	if len(policy.Approvers) != 1 || policy.Approvers[0].Type != "role" || policy.Approvers[0].Ref != "legal_approver" {
		t.Fatalf("approvers = %+v", policy.Approvers)
	}
	if policy.Metadata["source"] != "test" {
		t.Fatalf("metadata = %+v", policy.Metadata)
	}
}

func TestRequestApprovalPolicyFromCreateRequestValidation(t *testing.T) {
	t.Run("invalid stage", func(t *testing.T) {
		stage := model.RequestApprovalStage("finance")
		_, err := requestApprovalPolicyFromCreateRequest(uuid.New(), uuid.New(), dto.CreateRequestApprovalPolicyRequest{
			Name:      "policy",
			Stage:     &stage,
			Approvers: []dto.ApprovalPolicyApprover{{Type: "role", Ref: "legal"}},
		})
		if err == nil {
			t.Fatal("expected invalid stage error")
		}
	})

	t.Run("duplicate form fields case insensitive", func(t *testing.T) {
		_, err := requestApprovalPolicyFromCreateRequest(uuid.New(), uuid.New(), dto.CreateRequestApprovalPolicyRequest{
			Name:      "policy",
			Approvers: []dto.ApprovalPolicyApprover{{Type: "role", Ref: "legal"}},
			FormFields: []dto.ApprovalFormFieldRequest{
				{Name: "decision", Type: "text"},
				{Name: " Decision ", Type: "text"},
			},
		})
		if err == nil {
			t.Fatal("expected duplicate form field error")
		}
	})
}
