package service

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

func TestFirstApprovalStagePrefersRequesterBeforeProvider(t *testing.T) {
	service := &RequestApprovalService{}

	stage, status := service.firstApprovalStage(&model.LegalRequest{
		RequesterApprovalReqd: true,
		ProviderApprovalReqd:  true,
	})

	if stage != model.RequestApprovalStageRequester {
		t.Fatalf("stage = %q, want requester", stage)
	}
	if status != model.RequestStatusPendingRequesterApproval {
		t.Fatalf("status = %q, want pending_requester_approval", status)
	}
}

func TestApprovalStartStatusAllowed(t *testing.T) {
	tests := []struct {
		name   string
		status model.RequestStatus
		target model.RequestStatus
		want   bool
	}{
		{
			name:   "submitted can enter requester approval",
			status: model.RequestStatusSubmitted,
			target: model.RequestStatusPendingRequesterApproval,
			want:   true,
		},
		{
			name:   "legacy unstarted requester pending can be recovered",
			status: model.RequestStatusPendingRequesterApproval,
			target: model.RequestStatusPendingRequesterApproval,
			want:   true,
		},
		{
			name:   "legacy unstarted provider pending can be recovered",
			status: model.RequestStatusPendingProviderApproval,
			target: model.RequestStatusPendingProviderApproval,
			want:   true,
		},
		{
			name:   "wrong pending stage is rejected",
			status: model.RequestStatusPendingProviderApproval,
			target: model.RequestStatusPendingRequesterApproval,
		},
		{
			name:   "approved is rejected",
			status: model.RequestStatusApproved,
			target: model.RequestStatusPendingRequesterApproval,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := approvalStartStatusAllowed(tt.status, tt.target)
			if got != tt.want {
				t.Fatalf("approvalStartStatusAllowed() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRequestApprovalAdvancePlanFor(t *testing.T) {
	tests := []struct {
		name        string
		request     model.LegalRequest
		resolution  workflowexec.Resolution
		wantTarget  model.RequestStatus
		wantClear   bool
		wantChanged bool
	}{
		{
			name: "requester approval advances to provider stage and clears workflow",
			request: model.LegalRequest{
				Status:               model.RequestStatusPendingRequesterApproval,
				ProviderApprovalReqd: true,
			},
			resolution:  workflowexec.ResolutionAdvance,
			wantTarget:  model.RequestStatusPendingProviderApproval,
			wantClear:   true,
			wantChanged: true,
		},
		{
			name: "requester approval without provider stage approves request",
			request: model.LegalRequest{
				Status: model.RequestStatusPendingRequesterApproval,
			},
			resolution:  workflowexec.ResolutionAdvance,
			wantTarget:  model.RequestStatusApproved,
			wantChanged: true,
		},
		{
			name: "provider approval approves request",
			request: model.LegalRequest{
				Status: model.RequestStatusPendingProviderApproval,
			},
			resolution:  workflowexec.ResolutionAdvance,
			wantTarget:  model.RequestStatusApproved,
			wantChanged: true,
		},
		{
			name: "reject returns request and clears workflow",
			request: model.LegalRequest{
				Status: model.RequestStatusPendingProviderApproval,
			},
			resolution:  workflowexec.ResolutionReject,
			wantTarget:  model.RequestStatusReturned,
			wantClear:   true,
			wantChanged: true,
		},
		{
			name: "wait leaves status unchanged",
			request: model.LegalRequest{
				Status: model.RequestStatusPendingRequesterApproval,
			},
			resolution: workflowexec.ResolutionWait,
			wantTarget: model.RequestStatusPendingRequesterApproval,
		},
		{
			name: "advance from non-pending status is ignored",
			request: model.LegalRequest{
				Status: model.RequestStatusSubmitted,
			},
			resolution: workflowexec.ResolutionAdvance,
			wantTarget: model.RequestStatusSubmitted,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := requestApprovalAdvancePlanFor(&tt.request, tt.resolution)
			if got.target != tt.wantTarget || got.clearWorkflow != tt.wantClear || got.changed != tt.wantChanged {
				t.Fatalf("advance plan = %+v, want target=%q clear=%v changed=%v", got, tt.wantTarget, tt.wantClear, tt.wantChanged)
			}
		})
	}
}
