package migrate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// approval.go (Wave 5, H2) routes Clario Migrate's move-group approval through the
// SHARED workflow engine instead of the local DecideMoveGroup status flip the
// Wave-4 audit flagged as "the bypass the spec forbids".
//
// Flow:
//   1. SubmitMoveGroup moves the group to approval_pending AND (when the workflow
//      client is configured) opens a human-task approval workflow instance in the
//      workflow engine, persisting a migrate_approval_binding linking the two.
//   2. The approver completes the workflow task in the workflow engine
//      (POST /api/v1/workflows/tasks/{id}/complete with {decision, rationale}).
//   3. The workflow engine advances; on completion the decision lands in the
//      instance's step_outputs.
//   4. Migrate applies the decision to its own FSM either via:
//        - the callback endpoint (POST /internal/migrate/approve-callback), which
//          RE-READS the workflow instance to confirm the decision (never trusts the
//          callback body), or
//        - the sync/pull endpoint (POST /move-groups/{id}/sync-approval), which
//          reads the workflow decision on demand.
//   5. The local DecideMoveGroup endpoint is now a GUARDED MANUAL OVERRIDE: it is
//      refused whenever the workflow engine is configured (403 gated), and only
//      usable as an explicitly-audited break-glass path when no engine is wired.

// ErrApprovalWorkflowRequired is returned when a manual DecideMoveGroup is
// attempted while the workflow engine is configured — the decision MUST come from
// the workflow, not a local flip. The router maps it to 409/gate_blocked.
var ErrApprovalWorkflowRequired = errors.New("migrate approval must be decided through the workflow engine")

// ErrManualOverrideNotAllowed is returned when a manual override is attempted but
// the override is not permitted (no allowOverride flag on a configured engine).
var ErrManualOverrideNotAllowed = errors.New("migrate manual approval override is not permitted while the workflow engine is configured")

// ApprovalStatus is the migrate-side view of a subject's approval, combining the
// local move-group state with the bound workflow instance state.
type ApprovalStatus struct {
	MoveGroup *MoveGroup       `json:"move_group"`
	Binding   *ApprovalBinding `json:"binding,omitempty"`
	// WorkflowStatus is the live workflow instance status (running/completed/…),
	// present only when the binding is pending and the engine is reachable.
	WorkflowStatus string `json:"workflow_status,omitempty"`
	// Decided reports whether the bound workflow reached a terminal decision.
	Decided bool `json:"decided"`
}

// ApprovalsConfigured reports whether the workflow-backed approval seam is wired.
// When false the router exposes only the guarded manual-override path.
func (s *Service) ApprovalsConfigured() bool {
	return s.approvals != nil && s.approvals.Configured()
}

// requestMoveGroupApproval opens the approval workflow for a move group and
// records the binding. It runs INSIDE the caller's open transaction so the binding
// row commits atomically with the submit status change. It is a no-op returning
// (nil, nil) when the workflow client is not configured — the caller then leaves
// the group in approval_pending for the guarded manual-override path.
func (s *Service) requestMoveGroupApproval(ctx context.Context, tx DBTX, tenantID uuid.UUID, group *MoveGroup, actor Actor, at time.Time) (*ApprovalBinding, error) {
	if !s.ApprovalsConfigured() {
		return nil, nil
	}
	requester := actor.UserID
	instance, err := s.approvals.StartApproval(ctx, tenantID, StartApprovalRequest{
		DefinitionID: s.approvals.DefaultDefinitionID(),
		InputVariables: map[string]any{
			"subject_type":         string(ApprovalSubjectMoveGroup),
			"move_group_id":        group.ID.String(),
			"move_group_reference": group.Reference,
			"move_group_name":      group.Name,
			"program_id":           group.ProgramID.String(),
			"submitted_by":         requester.String(),
			"workloads_count":      len(group.Workloads),
			"completeness_status":  group.CompletenessStatus,
			// approver_role lets the workflow definition assign the human task to the
			// migrate-approver role dynamically when it reads it from input variables.
			"approver_role": PermMigrateApprove,
		},
	})
	if err != nil {
		return nil, err
	}
	// WorkflowStepID is left empty at start (there are no step outputs yet); it is
	// discovered and persisted when the decision is read (DecisionFromInstance
	// reports the step it read the decision from, for a single-step approval).
	binding := &ApprovalBinding{
		TenantID:             tenantID,
		ProgramID:            group.ProgramID,
		SubjectType:          ApprovalSubjectMoveGroup,
		SubjectID:            group.ID,
		WorkflowInstanceID:   instance.ID,
		WorkflowDefinitionID: instance.DefinitionID,
		Status:               ApprovalBindingPending,
		RequestedBy:          &requester,
	}
	if err := s.store.CreateApprovalBinding(ctx, tx, binding); err != nil {
		return nil, err
	}
	return binding, nil
}

// RequestMoveGroupApproval explicitly opens (or returns the existing) approval
// workflow for a move group already in approval_pending. It is the endpoint behind
// POST /move-groups/{id}/request-approval — used when a group was submitted while
// the engine was down, or to (re)open an approval. Fails closed with 503 when the
// workflow engine is not configured.
func (s *Service) RequestMoveGroupApproval(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor) (*ApprovalStatus, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	if !s.ApprovalsConfigured() {
		return nil, ErrWorkflowEngineUnavailable
	}
	now := s.now()
	var status ApprovalStatus
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		group, err := s.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if err != nil {
			return err
		}
		// A group must be pending approval (submitted) to open a workflow for it.
		if group.Status != MoveGroupApprovalPending {
			return fmt.Errorf("move group must be submitted for approval first (status=%s): %w", group.Status, ErrCompletenessBlocked)
		}
		// If an active binding already exists, return it (idempotent) rather than
		// opening a second workflow.
		if existing, err := s.store.GetActiveApprovalBinding(ctx, tx, tenantID, ApprovalSubjectMoveGroup, moveGroupID); err == nil {
			status = ApprovalStatus{MoveGroup: group, Binding: existing, WorkflowStatus: WorkflowInstanceRunning}
			return nil
		} else if !errors.Is(err, ErrApprovalNotStarted) {
			return err
		}
		binding, err := s.requestMoveGroupApproval(ctx, tx, tenantID, group, actor, now)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, group.ProgramID, &actor.UserID, "move_group.approval_workflow_started", &moveGroupID, "move_group", "Approval workflow opened in the shared workflow engine", map[string]any{
			"workflow_instance_id":   binding.WorkflowInstanceID,
			"workflow_definition_id": binding.WorkflowDefinitionID,
		}, now); err != nil {
			return err
		}
		status = ApprovalStatus{MoveGroup: group, Binding: binding, WorkflowStatus: WorkflowInstanceRunning}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &status, nil
}

// SyncMoveGroupApproval reads the bound workflow instance's decision and, if the
// workflow has reached a terminal approve/reject, applies it to the migrate FSM
// (move_group.status -> approved/rejected) and completes the binding. It is the
// pull path behind POST /move-groups/{id}/sync-approval — safe to call repeatedly:
// it is a no-op (returning ErrApprovalNotDecided) while the workflow is still
// running. Requires migrate:approve (the decision is the approver's, applied here).
func (s *Service) SyncMoveGroupApproval(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor) (*MoveGroup, error) {
	if !actor.Can(PermMigrateApprove) {
		return nil, ErrUnauthorized
	}
	if !s.ApprovalsConfigured() {
		return nil, ErrWorkflowEngineUnavailable
	}
	// 1. Resolve the active binding (outside the write tx; a read).
	var binding *ApprovalBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		b, err := s.store.GetActiveApprovalBinding(ctx, tx, tenantID, ApprovalSubjectMoveGroup, moveGroupID)
		if err != nil {
			return err
		}
		binding = b
		return nil
	}); err != nil {
		return nil, err
	}
	// 2. Read the authoritative decision from the workflow engine (cross-service).
	instance, err := s.approvals.GetInstance(ctx, tenantID, binding.WorkflowInstanceID)
	if err != nil {
		return nil, err
	}
	decision := DecisionFromInstance(instance, binding.WorkflowStepID)
	// 3. Apply it (or handle a terminal-but-undecided instance) transactionally.
	return s.applyWorkflowDecision(ctx, tenantID, moveGroupID, binding, instance, decision, actor)
}

// ApplyApprovalCallback is the callback path behind POST /internal/migrate/
// approve-callback: the workflow engine (or its notification consumer) reports that
// a workflow instance completed. Migrate resolves the binding by instance id and
// applies the decision. CRITICAL: it does NOT trust the callback body's decision —
// it RE-READS the workflow instance from the engine to confirm the real outcome,
// so a forged/replayed callback cannot flip an approval. actorHint is the approver
// the callback reports (used only for the audit trail; the decision itself comes
// from the engine).
func (s *Service) ApplyApprovalCallback(ctx context.Context, tenantID uuid.UUID, instanceID string, actorHint *uuid.UUID) (*ApprovalBinding, error) {
	if !s.ApprovalsConfigured() {
		return nil, ErrWorkflowEngineUnavailable
	}
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return nil, fmt.Errorf("workflow_instance_id is required: %w", ErrValidation)
	}
	// 1. Resolve the binding by instance id.
	var binding *ApprovalBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		b, err := s.store.GetApprovalBindingByInstance(ctx, tx, tenantID, instanceID)
		if err != nil {
			return err
		}
		binding = b
		return nil
	}); err != nil {
		return nil, err
	}
	// Already applied — idempotent no-op (a replayed callback).
	if binding.Status != ApprovalBindingPending {
		return binding, nil
	}
	// 2. Re-read the authoritative instance state (never trust the callback body).
	instance, err := s.approvals.GetInstance(ctx, tenantID, instanceID)
	if err != nil {
		return nil, err
	}
	decision := DecisionFromInstance(instance, binding.WorkflowStepID)
	actor := Actor{Permission: []string{PermMigrateApprove}}
	if actorHint != nil {
		actor.UserID = *actorHint
	} else if binding.RequestedBy != nil {
		actor.UserID = *binding.RequestedBy
	}
	if _, err := s.applyWorkflowDecision(ctx, tenantID, binding.SubjectID, binding, instance, decision, actor); err != nil {
		// A subject that is not decided yet is not an error for the callback — it
		// simply means the instance is not terminal; surface it so the caller retries.
		return nil, err
	}
	// Reload the binding to return its completed state.
	var updated *ApprovalBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		b, err := s.store.GetApprovalBindingByInstance(ctx, tx, tenantID, instanceID)
		if err != nil {
			return err
		}
		updated = b
		return nil
	}); err != nil {
		return nil, err
	}
	return updated, nil
}

// applyWorkflowDecision is the shared write path for both the sync (pull) and
// callback flows. It flips the migrate move-group FSM to reflect the workflow's
// decision, completes the binding, and stages the decision event — all in ONE
// transaction so the local state, the binding, and the audit/notification event
// commit atomically. The decision ORIGINATES from the workflow engine; migrate
// never invents it here.
func (s *Service) applyWorkflowDecision(ctx context.Context, tenantID, moveGroupID uuid.UUID, binding *ApprovalBinding, instance *ApprovalInstance, decision ApprovalDecision, actor Actor) (*MoveGroup, error) {
	now := s.now()
	// Terminal-but-undecided: the workflow instance failed or was cancelled. Free
	// the binding so a new approval can be requested; do NOT touch the move group.
	if instance.Status == WorkflowInstanceFailed || instance.Status == WorkflowInstanceCancelled {
		var out *ApprovalBinding
		err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
			status := ApprovalBindingFailed
			if instance.Status == WorkflowInstanceCancelled {
				status = ApprovalBindingCancelled
			}
			b, ferr := s.store.FailApprovalBinding(ctx, tx, tenantID, binding.ID, status, "workflow instance "+instance.Status, now)
			if ferr != nil {
				return ferr
			}
			out = b
			return s.audit(ctx, tx, tenantID, binding.ProgramID, actorPtr(actor.UserID), "move_group.approval_workflow_"+instance.Status, &moveGroupID, "move_group", "Approval workflow ended without a decision", map[string]any{
				"workflow_instance_id": binding.WorkflowInstanceID,
				"workflow_status":      instance.Status,
			}, now)
		})
		if err != nil {
			return nil, err
		}
		_ = out
		return nil, ErrApprovalNotDecided
	}
	if !decision.Decided {
		return nil, ErrApprovalNotDecided
	}

	var group *MoveGroup
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.store.GetMoveGroup(ctx, tx, tenantID, moveGroupID)
		if err != nil {
			return err
		}
		// Only a group still awaiting approval is driven by the workflow decision.
		if current.Status != MoveGroupApprovalPending {
			return fmt.Errorf("move group is no longer awaiting approval (status=%s): %w", current.Status, ErrInvalidTransition)
		}
		// Persist the step id we actually read the decision from (for audit).
		if decision.StepID != "" {
			binding.WorkflowStepID = decision.StepID
		}
		outcome := ApprovalDecisionRejected
		if decision.Approved {
			outcome = ApprovalDecisionApproved
		}
		// Complete the binding first (optimistic guard: only a pending binding is
		// completed, so a concurrent callback+sync race applies the decision once).
		// decided_by is the approver actor when the caller (sync/callback) reported
		// one, else the requester on the binding (the step_outputs carry the form
		// decision but not a user id).
		decidedBy := actorPtr(actor.UserID)
		if decidedBy == nil {
			decidedBy = binding.RequestedBy
		}
		if _, err := s.store.CompleteApprovalBinding(ctx, tx, tenantID, binding.ID, outcome, decision.Rationale, decidedBy, now); err != nil {
			return err
		}
		// Drive the migrate FSM with the WORKFLOW's decision (not a local actor's).
		group, err = s.store.DecideMoveGroup(ctx, tx, tenantID, moveGroupID, decisionActor(actor, binding), decision.Approved, decision.Rationale, now, current.RowVersion)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, current.ProgramID, actorPtr(actor.UserID), "move_group.approval_decided", &moveGroupID, "move_group", "Move group approval decided by the workflow engine", map[string]any{
			"approved":             decision.Approved,
			"rationale":            decision.Rationale,
			"source":               "workflow_engine",
			"workflow_instance_id": binding.WorkflowInstanceID,
			"workflow_step_id":     binding.WorkflowStepID,
		}, now); err != nil {
			return err
		}
		decided := decision.Approved
		return s.stageEvent(ctx, tx, tenantID, EventMoveGroupDecided, actorPtr(actor.UserID), MoveGroupEvent{
			ProgramID:   current.ProgramID,
			MoveGroupID: moveGroupID,
			Reference:   group.Reference,
			Name:        group.Name,
			Status:      string(group.Status),
			DecidedBy:   actorIDString(actor.UserID),
			Approved:    &decided,
			Rationale:   decision.Rationale,
		})
	})
	if err != nil {
		return nil, err
	}
	return group, nil
}

// decisionActor resolves the uuid used as approved_by on the move group. It is the
// approver actor when known; else the requester recorded on the binding (so
// approved_by is never nil — the DecideMoveGroup update requires a non-nil actor).
func decisionActor(actor Actor, binding *ApprovalBinding) uuid.UUID {
	if actor.UserID != uuid.Nil {
		return actor.UserID
	}
	if binding.RequestedBy != nil {
		return *binding.RequestedBy
	}
	return uuid.Nil
}
