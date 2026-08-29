package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

// investigation_approval.go is the thin, subject-specific shell that binds the
// REUSABLE, subject-agnostic ApprovalOrchestrator to a legal_investigation. It
// mirrors CaseApprovalOrchestrator exactly but over the investigation row, so the
// CAP-083 results-approval chain runs through the SAME engine (locking, quorum,
// X.509 DoA authority evidence, CloudEvents) as the request/case approval paths.
// It does NOT touch the contract-bound WorkflowService.

// investigationApprovalStatusAdvancer is the investigation-FSM advance hook
// supplied to the shared orchestrator by InvestigationService so the engine can
// move the investigation pending_approval → approved on approve, or → rejected on
// reject, inside the engine's own transaction.
type investigationApprovalStatusAdvancer func(ctx context.Context, tx pgx.Tx, tenantID, userID, investigationID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error)

// InvestigationApprovalOrchestrator binds the shared ApprovalOrchestrator to
// legal_investigations.
type InvestigationApprovalOrchestrator struct {
	engine         *ApprovalOrchestrator
	investigations *repository.InvestigationRepository
}

// NewInvestigationApprovalOrchestrator wraps the shared ApprovalOrchestrator (the
// one constructed once in app.go with the X.509 DoA validator already wired) for
// legal_investigation subjects.
func NewInvestigationApprovalOrchestrator(engine *ApprovalOrchestrator, investigations *repository.InvestigationRepository) *InvestigationApprovalOrchestrator {
	return &InvestigationApprovalOrchestrator{engine: engine, investigations: investigations}
}

// subjectSpec builds the orchestrator hook set for an investigation: it locks the
// investigation row FOR UPDATE and advances its FSM as the results-approval chain
// resolves. The advance hook is injected so the service sequences transitions.
func (o *InvestigationApprovalOrchestrator) subjectSpec(investigationID uuid.UUID, advance investigationApprovalStatusAdvancer) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_investigation",
		SubjectID:   investigationID,
		EventEntity: "investigation",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			return o.investigations.LockStatus(ctx, tx, tenantID, subjectID)
		},
		AdvanceSubject: func(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
			return advance(ctx, tx, tenantID, userID, subjectID, resolution, decision, now)
		},
	}
}

// DecideTask records one results-approval decision on an investigation's workflow
// task by delegating to the shared engine with an investigation subject spec.
func (o *InvestigationApprovalOrchestrator) DecideTask(ctx context.Context, tenantID, userID, investigationID, workflowInstanceID, taskID uuid.UUID, advance investigationApprovalStatusAdvancer, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	spec := o.subjectSpec(investigationID, advance)
	return o.engine.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
}

// investigationApprovalAdvancePlan describes the investigation-FSM move for a
// results-approval resolution. On approve the investigation advances
// pending_approval → approved; on reject it enters the explicit rejected state
// and must take the rejected -> in_progress edge before rework.
type investigationApprovalAdvancePlan struct {
	target  model.InvestigationStatus
	changed bool
}

func investigationApprovalAdvancePlanFor(current model.InvestigationStatus, resolution workflowexec.Resolution) investigationApprovalAdvancePlan {
	switch resolution {
	case workflowexec.ResolutionReject:
		if current == model.InvestigationStatusPendingApprove {
			return investigationApprovalAdvancePlan{target: model.InvestigationStatusRejected, changed: true}
		}
		return investigationApprovalAdvancePlan{target: current}
	case workflowexec.ResolutionAdvance:
		if current == model.InvestigationStatusPendingApprove {
			return investigationApprovalAdvancePlan{target: model.InvestigationStatusApproved, changed: true}
		}
		return investigationApprovalAdvancePlan{target: current}
	default:
		return investigationApprovalAdvancePlan{target: current}
	}
}
