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

// request_approval_policy_conflict.go reuses the pure, database-free overlap
// predicates from approval_policy_conflict.go (numericRangesOverlap,
// timeWindowsOverlap, categoriesOverlap, normalizedCategory, float64PtrEqual,
// timePtrEqual, validateApprovalPolicyWindow) — swapping the contract_type scope
// dimension for the request scope dimensions (request_type, service_id, stage,
// department, priority_tier). Keeping the predicates in-process keeps identical
// detection exact even though the SQL pre-filters overlap.

// RequestApprovalPolicyConflict describes a single active policy whose routing
// scope overlaps a candidate policy's scope. It is advisory unless Identical.
type RequestApprovalPolicyConflict struct {
	PolicyID  uuid.UUID `json:"policy_id"`
	Name      string    `json:"name"`
	Reason    string    `json:"reason"`
	Identical bool      `json:"identical"`
}

// requestApprovalScope is the pure, comparable projection of a request-approval
// policy's scope dimensions used for conflict detection.
type requestApprovalScope struct {
	RequestType  *string
	ServiceID    *uuid.UUID
	Stage        *model.RequestApprovalStage
	Department   *string
	PriorityTier *string
	MinValue     *float64
	MaxValue     *float64
	ValidFrom    *time.Time
	ValidUntil   *time.Time
}

func requestApprovalScopeOf(p *model.RequestApprovalPolicy) requestApprovalScope {
	return requestApprovalScope{
		RequestType:  p.RequestType,
		ServiceID:    p.ServiceID,
		Stage:        p.Stage,
		Department:   p.Department,
		PriorityTier: p.PriorityTier,
		MinValue:     p.MinValue,
		MaxValue:     p.MaxValue,
		ValidFrom:    p.ValidFrom,
		ValidUntil:   p.ValidUntil,
	}
}

// requestServiceIDsOverlap reports whether two optional service-id dimensions
// overlap. A nil value on either side means "any" and always overlaps; two set
// values overlap only when equal.
func requestServiceIDsOverlap(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return true
	}
	return *a == *b
}

func requestStagesOverlap(a, b *model.RequestApprovalStage) bool {
	return categoriesOverlap(requestStageAsString(a), requestStageAsString(b))
}

func requestStageAsString(stage *model.RequestApprovalStage) *string {
	if stage == nil {
		return nil
	}
	s := string(*stage)
	return &s
}

// requestScopesOverlap reports whether two request-approval scopes overlap on
// EVERY dimension (request type AND service AND stage AND department AND priority
// tier AND value range AND effective window).
func requestScopesOverlap(a, b requestApprovalScope) bool {
	if !categoriesOverlap(a.RequestType, b.RequestType) {
		return false
	}
	if !requestServiceIDsOverlap(a.ServiceID, b.ServiceID) {
		return false
	}
	if !requestStagesOverlap(a.Stage, b.Stage) {
		return false
	}
	if !categoriesOverlap(a.Department, b.Department) {
		return false
	}
	if !categoriesOverlap(a.PriorityTier, b.PriorityTier) {
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

// requestScopesIdentical reports whether two scopes target exactly the same
// dimensions (used to distinguish a hard duplicate from a soft overlap).
func requestScopesIdentical(a, b requestApprovalScope) bool {
	return normalizedCategory(a.RequestType) == normalizedCategory(b.RequestType) &&
		requestServiceIDPtrEqual(a.ServiceID, b.ServiceID) &&
		normalizedCategory(requestStageAsString(a.Stage)) == normalizedCategory(requestStageAsString(b.Stage)) &&
		normalizedCategory(a.Department) == normalizedCategory(b.Department) &&
		normalizedCategory(a.PriorityTier) == normalizedCategory(b.PriorityTier) &&
		float64PtrEqual(a.MinValue, b.MinValue) &&
		float64PtrEqual(a.MaxValue, b.MaxValue) &&
		timePtrEqual(a.ValidFrom, b.ValidFrom) &&
		timePtrEqual(a.ValidUntil, b.ValidUntil)
}

func requestServiceIDPtrEqual(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// requestConflictReason builds a human-readable explanation for an overlapping
// scope.
func requestConflictReason(existing requestApprovalScope, identical bool) string {
	if identical {
		return "another active policy targets the identical scope"
	}
	parts := make([]string, 0, 6)
	if existing.RequestType != nil && strings.TrimSpace(*existing.RequestType) != "" {
		parts = append(parts, "request type "+strings.TrimSpace(*existing.RequestType))
	}
	if existing.ServiceID != nil {
		parts = append(parts, "service "+existing.ServiceID.String())
	}
	if existing.Stage != nil && strings.TrimSpace(string(*existing.Stage)) != "" {
		parts = append(parts, "stage "+string(*existing.Stage))
	}
	if existing.Department != nil && strings.TrimSpace(*existing.Department) != "" {
		parts = append(parts, "department "+strings.TrimSpace(*existing.Department))
	}
	if existing.PriorityTier != nil && strings.TrimSpace(*existing.PriorityTier) != "" {
		parts = append(parts, "priority tier "+strings.TrimSpace(*existing.PriorityTier))
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

// ConflictCheck returns the active policies whose scope overlaps the candidate's.
// It is read-only. When excludeID is non-nil it is omitted so a policy never
// conflicts with itself (used on update). The candidate's effective window is
// validated first.
func (s *RequestApprovalPolicyService) ConflictCheck(ctx context.Context, tenantID uuid.UUID, candidate *model.RequestApprovalPolicy, excludeID *uuid.UUID) ([]RequestApprovalPolicyConflict, error) {
	if candidate == nil {
		return nil, validationError("request approval policy candidate is required", map[string]string{"policy": "required"})
	}
	if err := validateApprovalPolicyWindow(candidate.ValidFrom, candidate.ValidUntil); err != nil {
		return nil, err
	}
	repoCandidate := repository.RequestApprovalConflictCandidate{
		ExcludeID:    excludeID,
		RequestType:  candidate.RequestType,
		ServiceID:    candidate.ServiceID,
		Stage:        candidate.Stage,
		Department:   candidate.Department,
		PriorityTier: candidate.PriorityTier,
		MinValue:     candidate.MinValue,
		MaxValue:     candidate.MaxValue,
		ValidFrom:    candidate.ValidFrom,
		ValidUntil:   candidate.ValidUntil,
	}
	rows, err := s.repo.FindConflicting(ctx, tenantID, repoCandidate)
	if err != nil {
		return nil, internalError("find conflicting request approval policies", err)
	}
	candidateScope := requestApprovalScopeOf(candidate)
	out := make([]RequestApprovalPolicyConflict, 0, len(rows))
	for i := range rows {
		existing := rows[i]
		existingScope := requestApprovalScopeOf(&existing)
		if !requestScopesOverlap(candidateScope, existingScope) {
			continue
		}
		identical := requestScopesIdentical(candidateScope, existingScope)
		out = append(out, RequestApprovalPolicyConflict{
			PolicyID:  existing.ID,
			Name:      existing.Name,
			Reason:    requestConflictReason(existingScope, identical),
			Identical: identical,
		})
	}
	return out, nil
}

// PreviewConflicts builds a transient candidate (no DB write) from a create
// request and delegates to ConflictCheck.
func (s *RequestApprovalPolicyService) PreviewConflicts(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateRequestApprovalPolicyRequest, excludeID *uuid.UUID) ([]RequestApprovalPolicyConflict, error) {
	candidate, err := requestApprovalPolicyFromCreateRequest(tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	return s.ConflictCheck(ctx, tenantID, candidate, excludeID)
}

// hasRequestIdenticalConflict reports whether any conflict is an identical-scope
// duplicate (the only class that hard-fails a create/update).
func hasRequestIdenticalConflict(conflicts []RequestApprovalPolicyConflict) bool {
	for _, c := range conflicts {
		if c.Identical {
			return true
		}
	}
	return false
}
