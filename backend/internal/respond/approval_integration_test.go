//go:build integration

package respond

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationApprovalGateBlocksUntilApproved(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	requester := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleCommander}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:       "payments failover needed",
		Description: "Primary card authorization region is unavailable.",
		Severity:    SeveritySEV1,
		Actor:       requester,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	_, err = svc.RequireApprovedAction(ctx, tenantID, RequireApprovedActionInput{
		IncidentID: inc.ID,
		Action:     ApprovalActionAuthorizeFailover,
		ActionKey:  "card-auth-region",
		Actor:      requester,
	})
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("RequireApprovedAction before request = %v, want ErrApprovalRequired", err)
	}

	requiredRole := RoleTechnicalLead
	approval, err := svc.RequestApproval(ctx, tenantID, RequestApprovalInput{
		IncidentID:   inc.ID,
		Action:       ApprovalActionAuthorizeFailover,
		ActionKey:    "card-auth-region",
		RequiredRole: &requiredRole,
		WorkflowRef: WorkflowApprovalRef{
			System:     "workflow.approval_chain",
			InstanceID: "wf-123",
			TaskID:     "task-approve-1",
		},
		Metadata: map[string]any{"target": "card-auth-region"},
		Actor:    requester,
	})
	if err != nil {
		t.Fatalf("request approval: %v", err)
	}
	if approval.Decision != ApprovalDecisionPending || approval.WorkflowRef.InstanceID != "wf-123" {
		t.Fatalf("approval after request = %+v", approval)
	}

	_, err = svc.RequireApprovedAction(ctx, tenantID, RequireApprovedActionInput{
		IncidentID: inc.ID,
		Action:     ApprovalActionAuthorizeFailover,
		ActionKey:  "card-auth-region",
		Actor:      requester,
	})
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("RequireApprovedAction while pending = %v, want ErrApprovalRequired", err)
	}

	if _, err := svc.DecideApproval(ctx, tenantID, DecideApprovalInput{
		ApprovalID: approval.ID,
		Decision:   ApprovalDecisionApproved,
		Actor:      Actor{UserID: requester.UserID, IncidentRoles: []IncidentRole{RoleTechnicalLead}},
	}); !errors.Is(err, ErrApprovalSelfDecision) {
		t.Fatalf("self approval error = %v, want ErrApprovalSelfDecision", err)
	}

	if _, err := svc.DecideApproval(ctx, tenantID, DecideApprovalInput{
		ApprovalID: approval.ID,
		Decision:   ApprovalDecisionApproved,
		Actor:      Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleResolver}},
	}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("resolver approval error = %v, want ErrUnauthorized", err)
	}

	decided, err := svc.DecideApproval(ctx, tenantID, DecideApprovalInput{
		ApprovalID: approval.ID,
		Decision:   ApprovalDecisionApproved,
		Reason:     "Failover is required to restore card authorization.",
		Actor:      Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleTechnicalLead}},
	})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if decided.Decision != ApprovalDecisionApproved || decided.DecidedBy == nil || decided.DecidedAt == nil {
		t.Fatalf("decided approval = %+v", decided)
	}

	approved, err := svc.RequireApprovedAction(ctx, tenantID, RequireApprovedActionInput{
		IncidentID: inc.ID,
		Action:     ApprovalActionAuthorizeFailover,
		ActionKey:  "card-auth-region",
		Actor:      requester,
	})
	if err != nil {
		t.Fatalf("RequireApprovedAction after approval: %v", err)
	}
	if approved.ID != approval.ID {
		t.Fatalf("approved gate id = %s, want %s", approved.ID, approval.ID)
	}

	events, err := svc.ListTimelineEvents(ctx, tenantID, inc.ID, requester, TimelineFilter{
		EventTypes: []string{EventApprovalRequested, EventApprovalDecided},
		Limit:      10,
	})
	if err != nil {
		t.Fatalf("list approval timeline: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("approval timeline events = %d, want 2", len(events))
	}
}
