package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ApprovalPolicyConflict describes a single active policy whose routing scope
// overlaps a candidate policy's scope. It is advisory: callers surface it as a
// warning rather than a hard error unless the scope is an identical duplicate.
type ApprovalPolicyConflict struct {
	PolicyID uuid.UUID `json:"policy_id"`
	Name     string    `json:"name"`
	Reason   string    `json:"reason"`
	// Identical is true when the conflicting policy shares the exact same scope
	// dimensions (contract type, department, value range, effective window) as
	// the candidate. Identical-scope conflicts are eligible to hard-fail a
	// create/update; merely overlapping ones only warn.
	Identical bool `json:"identical"`
}

// approvalPolicyScope is the pure, comparable projection of the scope dimensions
// used for conflict detection. Extracting it keeps the overlap predicates
// database-free and unit-testable.
type approvalPolicyScope struct {
	ContractType *model.ContractType
	Department   *string
	MinValue     *float64
	MaxValue     *float64
	ValidFrom    *time.Time
	ValidUntil   *time.Time
}

func approvalPolicyScopeOf(p *model.ApprovalPolicy) approvalPolicyScope {
	return approvalPolicyScope{
		ContractType: p.ContractType,
		Department:   p.Department,
		MinValue:     p.MinValue,
		MaxValue:     p.MaxValue,
		ValidFrom:    p.ValidFrom,
		ValidUntil:   p.ValidUntil,
	}
}

// numericRangesOverlap reports whether the closed ranges [aMin,aMax] and
// [bMin,bMax] intersect. A nil bound is an open (unbounded) end and therefore
// always satisfies its side of the comparison. The standard overlap test is
// aMin <= bMax && bMin <= aMax.
func numericRangesOverlap(aMin, aMax, bMin, bMax *float64) bool {
	// aMin <= bMax: fails only when both are set and aMin > bMax.
	if aMin != nil && bMax != nil && *aMin > *bMax {
		return false
	}
	// bMin <= aMax: fails only when both are set and bMin > aMax.
	if bMin != nil && aMax != nil && *bMin > *aMax {
		return false
	}
	return true
}

// timeWindowsOverlap reports whether the effective windows
// [aFrom,aUntil] and [bFrom,bUntil] intersect. Nil bounds are open ends. The
// test mirrors numericRangesOverlap: aFrom <= bUntil && bFrom <= aUntil.
func timeWindowsOverlap(aFrom, aUntil, bFrom, bUntil *time.Time) bool {
	if aFrom != nil && bUntil != nil && aFrom.After(*bUntil) {
		return false
	}
	if bFrom != nil && aUntil != nil && bFrom.After(*aUntil) {
		return false
	}
	return true
}

// categoriesOverlap reports whether two optional category dimensions (contract
// type, department) overlap. A nil/empty value on either side means "any" and
// always overlaps; two set values overlap only when equal.
func categoriesOverlap(a, b *string) bool {
	av := normalizedCategory(a)
	bv := normalizedCategory(b)
	if av == "" || bv == "" {
		return true
	}
	return av == bv
}

func normalizedCategory(v *string) string {
	if v == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(*v))
}

// scopesOverlap reports whether two policy scopes overlap on every dimension
// (the dimensions are ANDed: a conflict requires overlap on contract type AND
// department AND value range AND effective window).
func scopesOverlap(a, b approvalPolicyScope) bool {
	if !categoriesOverlap(contractTypeAsString(a.ContractType), contractTypeAsString(b.ContractType)) {
		return false
	}
	if !categoriesOverlap(a.Department, b.Department) {
		return false
	}
	if !numericRangesOverlap(a.MinValue, a.MaxValue, b.MinValue, b.MaxValue) {
		return false
	}
	if !timeWindowsOverlap(a.ValidFrom, a.ValidUntil, b.ValidFrom, b.ValidUntil) {
		return false
	}
	return true
}

// scopesIdentical reports whether two scopes target exactly the same dimensions
// (used to distinguish a hard duplicate from a soft overlap).
func scopesIdentical(a, b approvalPolicyScope) bool {
	return normalizedCategory(contractTypeAsString(a.ContractType)) == normalizedCategory(contractTypeAsString(b.ContractType)) &&
		normalizedCategory(a.Department) == normalizedCategory(b.Department) &&
		float64PtrEqual(a.MinValue, b.MinValue) &&
		float64PtrEqual(a.MaxValue, b.MaxValue) &&
		timePtrEqual(a.ValidFrom, b.ValidFrom) &&
		timePtrEqual(a.ValidUntil, b.ValidUntil)
}

func contractTypeAsString(ct *model.ContractType) *string {
	if ct == nil {
		return nil
	}
	s := string(*ct)
	return &s
}

func float64PtrEqual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

// validateApprovalPolicyWindow enforces that, when both bounds are present,
// valid_until is strictly after valid_from. This is a pure predicate so it can
// be unit-tested without a database.
func validateApprovalPolicyWindow(validFrom, validUntil *time.Time) error {
	if validFrom != nil && validUntil != nil && !validUntil.After(*validFrom) {
		return validationError("valid_until must be after valid_from", map[string]string{"valid_until": "invalid"})
	}
	return nil
}

// conflictReason builds a human-readable explanation for an overlapping scope.
func conflictReason(existing approvalPolicyScope, identical bool) string {
	if identical {
		return "another active policy targets the identical scope"
	}
	parts := make([]string, 0, 4)
	if ct := contractTypeAsString(existing.ContractType); ct != nil && *ct != "" {
		parts = append(parts, "contract type "+*ct)
	}
	if existing.Department != nil && strings.TrimSpace(*existing.Department) != "" {
		parts = append(parts, "department "+strings.TrimSpace(*existing.Department))
	}
	if existing.MinValue != nil || existing.MaxValue != nil {
		parts = append(parts, "an overlapping value range")
	}
	if existing.ValidFrom != nil || existing.ValidUntil != nil {
		parts = append(parts, "an overlapping effective window")
	}
	if len(parts) == 0 {
		return "another active policy has an overlapping (unbounded) scope"
	}
	return "overlaps on " + strings.Join(parts, ", ")
}

// ConflictCheckApprovalPolicy returns the active policies whose scope overlaps
// the candidate's. It is read-only and never persists. When excludeID is
// non-nil it is omitted so a policy never conflicts with itself (used on
// update). The candidate's effective window is validated first.
func (s *WorkflowService) ConflictCheckApprovalPolicy(ctx context.Context, tenantID uuid.UUID, candidate *model.ApprovalPolicy, excludeID *uuid.UUID) ([]ApprovalPolicyConflict, error) {
	if candidate == nil {
		return nil, validationError("approval policy candidate is required", map[string]string{"policy": "required"})
	}
	if err := validateApprovalPolicyWindow(candidate.ValidFrom, candidate.ValidUntil); err != nil {
		return nil, err
	}
	if s.policyGov == nil {
		return nil, internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	repoCandidate := repository.ApprovalPolicyConflictCandidate{
		ExcludeID:    excludeID,
		ContractType: candidate.ContractType,
		Department:   candidate.Department,
		MinValue:     candidate.MinValue,
		MaxValue:     candidate.MaxValue,
		ValidFrom:    candidate.ValidFrom,
		ValidUntil:   candidate.ValidUntil,
	}
	rows, err := s.policyGov.FindConflictingApprovalPolicies(ctx, tenantID, repoCandidate)
	if err != nil {
		return nil, internalError("find conflicting approval policies", err)
	}
	candidateScope := approvalPolicyScopeOf(candidate)
	out := make([]ApprovalPolicyConflict, 0, len(rows))
	for i := range rows {
		existing := rows[i]
		existingScope := approvalPolicyScopeOf(&existing)
		// The SQL pre-filters overlap; re-confirm with the pure predicate so the
		// in-process logic stays authoritative and identical detection is exact.
		if !scopesOverlap(candidateScope, existingScope) {
			continue
		}
		identical := scopesIdentical(candidateScope, existingScope)
		out = append(out, ApprovalPolicyConflict{
			PolicyID:  existing.ID,
			Name:      existing.Name,
			Reason:    conflictReason(existingScope, identical),
			Identical: identical,
		})
	}
	return out, nil
}

// PreviewApprovalPolicyConflicts is a convenience wrapper for clients that want
// to preview conflicts from a create/update request before persisting. It
// builds a transient candidate (no DB write) and delegates to
// ConflictCheckApprovalPolicy.
func (s *WorkflowService) PreviewApprovalPolicyConflicts(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateApprovalPolicyRequest, excludeID *uuid.UUID) ([]ApprovalPolicyConflict, error) {
	candidate, err := approvalPolicyFromCreateRequest(tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	return s.ConflictCheckApprovalPolicy(ctx, tenantID, candidate, excludeID)
}

// hasIdenticalConflict reports whether any conflict is an identical-scope
// duplicate (the only class that hard-fails a create/update).
func hasIdenticalConflict(conflicts []ApprovalPolicyConflict) bool {
	for _, c := range conflicts {
		if c.Identical {
			return true
		}
	}
	return false
}
