package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

func TestConsultationApprovedEventPayloadCarriesDurationBounds(t *testing.T) {
	consultationID := uuid.New()
	workflowID := uuid.New()
	taskID := uuid.New()
	deciderID := uuid.New()
	createdAt := time.Date(2026, 6, 20, 9, 0, 0, 0, time.UTC)
	decidedAt := time.Date(2026, 6, 22, 11, 30, 0, 0, time.UTC)
	department := "legal"
	c := &model.Consultation{
		ID:                 consultationID,
		ConsultationNumber: "CONS-20260620-0001",
		Type:               model.ConsultationTypeContractual,
		Department:         &department,
		CreatedAt:          createdAt,
	}
	outcome := &ApprovalDecisionOutcome{
		SubjectID:          consultationID,
		WorkflowInstanceID: workflowID,
		TaskID:             taskID,
		Decision:           "approve",
		Resolution:         workflowexec.ResolutionAdvance,
		PreviousStatus:     string(model.ConsultationStatusResponded),
		Status:             string(model.ConsultationStatusApproved),
		DecidedBy:          deciderID,
		DecidedAt:          decidedAt,
	}

	payload := consultationApprovedEventPayload(c, outcome)
	if payload["started_at"] != createdAt {
		t.Fatalf("started_at = %v, want %v", payload["started_at"], createdAt)
	}
	if payload["completed_at"] != decidedAt {
		t.Fatalf("completed_at = %v, want %v", payload["completed_at"], decidedAt)
	}
	if payload["status"] != string(model.ConsultationStatusApproved) {
		t.Fatalf("status = %v, want approved", payload["status"])
	}
}
