package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/middleware"
)

// isPolicyGovUnconfigured reports whether err signals that the approval-policy
// governance repository has not been wired in. Conflict checks during
// create/update tolerate this so the core CRUD keeps working even when the
// governance surface is absent (e.g. in lightweight tests).
func isPolicyGovUnconfigured(err error) bool {
	return errors.Is(err, errPolicyGovUnconfigured)
}

// appendApprovalPolicyAudit writes a single append-only audit entry inside the
// supplied transaction. It is a no-op (returns nil) when the governance
// repository is not wired, so the surrounding CRUD transaction still succeeds.
// before/after may be nil (before is nil on create).
func (s *WorkflowService) appendApprovalPolicyAudit(
	ctx context.Context,
	q repository.Queryer,
	tenantID, policyID uuid.UUID,
	action model.ApprovalPolicyAuditAction,
	actorID uuid.UUID,
	before, after *model.ApprovalPolicy,
) error {
	if s.policyGov == nil {
		return nil
	}
	var actor *uuid.UUID
	if actorID != uuid.Nil {
		actor = &actorID
	}
	entry := &model.ApprovalPolicyAuditEntry{
		TenantID:  tenantID,
		PolicyID:  policyID,
		Action:    action,
		ActorID:   actor,
		Before:    cloneApprovalPolicyPtr(before),
		After:     cloneApprovalPolicyPtr(after),
		RequestID: middleware.GetRequestID(ctx),
	}
	if err := s.policyGov.AppendApprovalPolicyAudit(ctx, q, entry); err != nil {
		return internalError("append approval policy audit", err)
	}
	return nil
}

func cloneApprovalPolicyPtr(p *model.ApprovalPolicy) *model.ApprovalPolicy {
	if p == nil {
		return nil
	}
	out := *p
	return &out
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

// ListApprovalPolicyVersions returns the immutable version history for a policy,
// newest version first.
func (s *WorkflowService) ListApprovalPolicyVersions(ctx context.Context, tenantID, policyID uuid.UUID) ([]model.ApprovalPolicyVersion, error) {
	if policyID == uuid.Nil {
		return nil, validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	if s.policyGov == nil {
		return nil, internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	// Confirm the policy exists / is visible to the tenant before listing.
	if _, err := s.getApprovalPolicy(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	versions, err := s.policyGov.ListApprovalPolicyVersions(ctx, tenantID, policyID)
	if err != nil {
		return nil, internalError("list approval policy versions", err)
	}
	return versions, nil
}

// GetApprovalPolicyVersion returns a single immutable version snapshot of a
// policy by its version number. The policy must be visible to the tenant.
func (s *WorkflowService) GetApprovalPolicyVersion(ctx context.Context, tenantID, policyID uuid.UUID, version int) (*model.ApprovalPolicyVersion, error) {
	if policyID == uuid.Nil {
		return nil, validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	if version < 1 {
		return nil, validationError("version must be a positive integer", map[string]string{"version": "invalid"})
	}
	if s.policyGov == nil {
		return nil, internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	if _, err := s.getApprovalPolicy(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	snapshot, err := s.policyGov.GetApprovalPolicyVersion(ctx, tenantID, policyID, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("approval policy version not found")
		}
		return nil, internalError("load approval policy version", err)
	}
	return snapshot, nil
}

// RestoreApprovalPolicyVersion loads a historical snapshot and re-applies it as
// a NEW current version of the policy: the current state is snapshotted, the
// version counter is bumped, the historical values are written back, and an
// audit entry with action=restored is recorded — all in one transaction.
func (s *WorkflowService) RestoreApprovalPolicyVersion(ctx context.Context, tenantID, userID, policyID uuid.UUID, version int) (*model.ApprovalPolicy, error) {
	if policyID == uuid.Nil {
		return nil, validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	if version < 1 {
		return nil, validationError("version must be a positive integer", map[string]string{"version": "invalid"})
	}
	if s.policyGov == nil {
		return nil, internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	existing, err := s.getApprovalPolicy(ctx, tenantID, policyID)
	if err != nil {
		return nil, err
	}
	snapshotRow, err := s.policyGov.GetApprovalPolicyVersion(ctx, tenantID, policyID, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("approval policy version not found")
		}
		return nil, internalError("load approval policy version", err)
	}

	// Build the desired state from the snapshot, but keep identity/ownership and
	// effective-window coherence from the live row. The version counter itself is
	// managed by updateApprovalPolicyTx (version + 1).
	desired := snapshotRow.Snapshot
	desired.ID = existing.ID
	desired.TenantID = tenantID
	desired.CreatedBy = existing.CreatedBy
	desired.CreatedAt = existing.CreatedAt
	desired.Version = existing.Version
	if err := validateApprovalPolicyWindow(desired.ValidFrom, desired.ValidUntil); err != nil {
		return nil, err
	}

	restored, err := s.updateApprovalPolicyTx(ctx, tenantID, userID, policyID, existing, &desired, model.ApprovalPolicyAuditRestored)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.workflows.approval_policy_restored", tenantID, &userID, map[string]any{
		"id":               restored.ID,
		"name":             restored.Name,
		"restored_version": version,
		"new_version":      restored.Version,
	}, s.logger)
	return restored, nil
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// ListApprovalPolicyAudit returns paginated audit entries for a policy, newest
// first. page/perPage are normalised with the shared paging helper.
func (s *WorkflowService) ListApprovalPolicyAudit(ctx context.Context, tenantID, policyID uuid.UUID, page, perPage int) ([]model.ApprovalPolicyAuditEntry, error) {
	if policyID == uuid.Nil {
		return nil, validationError("approval policy id is invalid", map[string]string{"id": "invalid"})
	}
	if s.policyGov == nil {
		return nil, internalError("approval policy governance repository is not configured", errPolicyGovUnconfigured)
	}
	if _, err := s.getApprovalPolicy(ctx, tenantID, policyID); err != nil {
		return nil, err
	}
	page, perPage = serviceNormalizePage(page, perPage)
	entries, err := s.policyGov.ListApprovalPolicyAudit(ctx, tenantID, policyID, perPage, (page-1)*perPage)
	if err != nil {
		return nil, internalError("list approval policy audit", err)
	}
	return entries, nil
}

// ---------------------------------------------------------------------------
// Conflict-aware create/update wrappers (return warnings alongside the result)
// ---------------------------------------------------------------------------

// ApprovalPolicyMutationResult bundles a created/updated policy with any
// advisory (non-fatal) scope conflicts detected against it.
type ApprovalPolicyMutationResult struct {
	Policy    *model.ApprovalPolicy    `json:"policy"`
	Conflicts []ApprovalPolicyConflict `json:"conflicts,omitempty"`
}

// CreateApprovalPolicyWithConflicts creates a policy and additionally returns
// any overlapping (non-identical) active policies as warnings. Identical-scope
// duplicates still hard-fail inside CreateApprovalPolicy.
func (s *WorkflowService) CreateApprovalPolicyWithConflicts(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateApprovalPolicyRequest) (*ApprovalPolicyMutationResult, error) {
	conflicts, err := s.PreviewApprovalPolicyConflicts(ctx, tenantID, userID, req, nil)
	if err != nil && !isPolicyGovUnconfigured(err) {
		return nil, err
	}
	policy, err := s.CreateApprovalPolicy(ctx, tenantID, userID, req)
	if err != nil {
		return nil, err
	}
	return &ApprovalPolicyMutationResult{Policy: policy, Conflicts: conflicts}, nil
}

// UpdateApprovalPolicyWithConflicts updates a policy and returns overlapping
// (non-identical) active policies as warnings.
func (s *WorkflowService) UpdateApprovalPolicyWithConflicts(ctx context.Context, tenantID, userID, policyID uuid.UUID, req dto.UpdateApprovalPolicyRequest) (*ApprovalPolicyMutationResult, error) {
	updated, err := s.UpdateApprovalPolicy(ctx, tenantID, userID, policyID, req)
	if err != nil {
		return nil, err
	}
	conflicts, cerr := s.ConflictCheckApprovalPolicy(ctx, tenantID, updated, &policyID)
	if cerr != nil && !isPolicyGovUnconfigured(cerr) {
		return nil, cerr
	}
	return &ApprovalPolicyMutationResult{Policy: updated, Conflicts: conflicts}, nil
}
