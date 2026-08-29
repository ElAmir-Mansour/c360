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

// case_approval_orchestrator.go is the thin, subject-specific shell that binds the
// REUSABLE, subject-agnostic ApprovalOrchestrator to a legal_case. It mirrors the
// RequestApprovalService.subjectSpec / advance pattern exactly but over the
// litigation case row, so the Phase-1 administrative directive chain (CAP-032/033)
// runs through the SAME engine (locking, quorum, X.509 DoA authority evidence,
// CloudEvents) as the request-approval path. It does NOT touch the contract-bound
// WorkflowService.
//
// CaseApprovalOrchestrator owns no per-task transaction of its own — it delegates
// DecideTask to the shared engine and supplies the case-FSM hooks the engine calls
// back into. The owning LegalCaseIntakeService composes one.

// caseApprovalStatusAdvancer is the case-FSM advance hook supplied to the shared
// orchestrator. It is wired by LegalCaseIntakeService so the engine can move the
// case from phase1 → phase2 on approve, or back to intake on reject, inside the
// engine's own transaction.
type caseApprovalStatusAdvancer func(ctx context.Context, tx pgx.Tx, tenantID, userID, caseID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error)

// CaseApprovalOrchestrator binds the shared engine to legal_cases.
type CaseApprovalOrchestrator struct {
	engine *ApprovalOrchestrator
	cases  *repository.LegalCaseRepository
}

// NewCaseApprovalOrchestrator wraps the shared ApprovalOrchestrator (the one
// constructed once in app.go with the X.509 DoA validator already wired) for
// legal_case subjects.
func NewCaseApprovalOrchestrator(engine *ApprovalOrchestrator, cases *repository.LegalCaseRepository) *CaseApprovalOrchestrator {
	return &CaseApprovalOrchestrator{engine: engine, cases: cases}
}

// subjectSpec builds the orchestrator hook set for a legal case: it locks the
// case row FOR UPDATE and advances its FSM as the directive chain resolves. The
// advance hook is injected so the intake service can sequence phase transitions.
func (o *CaseApprovalOrchestrator) subjectSpec(caseID uuid.UUID, advance caseApprovalStatusAdvancer) ApprovalSubjectSpec {
	return ApprovalSubjectSpec{
		SubjectType: "legal_case",
		SubjectID:   caseID,
		EventEntity: "case",
		LockSubject: func(ctx context.Context, tx pgx.Tx, tenantID, subjectID uuid.UUID) (string, error) {
			return o.cases.LockStatus(ctx, tx, tenantID, subjectID)
		},
		AdvanceSubject: func(ctx context.Context, tx pgx.Tx, tenantID, userID, subjectID uuid.UUID, resolution workflowexec.Resolution, decision string, now time.Time) (string, error) {
			return advance(ctx, tx, tenantID, userID, subjectID, resolution, decision, now)
		},
	}
}

// DecideTask records one directive-chain approver decision on a case's Phase-1
// workflow task by delegating to the shared engine with a case subject spec.
func (o *CaseApprovalOrchestrator) DecideTask(ctx context.Context, tenantID, userID, caseID, workflowInstanceID, taskID uuid.UUID, advance caseApprovalStatusAdvancer, req dto.WorkflowDecisionRequest) (*ApprovalDecisionOutcome, error) {
	spec := o.subjectSpec(caseID, advance)
	return o.engine.DecideTask(ctx, spec, tenantID, userID, workflowInstanceID, taskID, req)
}

// caseDirectiveAdvancePlan describes the case-FSM move for a directive-chain
// resolution. On approve the case advances phase1 → phase2; on reject it returns
// to intake. Other statuses are left untouched (idempotent).
type caseDirectiveAdvancePlan struct {
	target  model.CaseStatus
	changed bool
}

func caseDirectiveAdvancePlanFor(current model.CaseStatus, resolution workflowexec.Resolution) caseDirectiveAdvancePlan {
	switch resolution {
	case workflowexec.ResolutionReject:
		if current == model.CaseStatusPhase1 {
			return caseDirectiveAdvancePlan{target: model.CaseStatusIntake, changed: true}
		}
		return caseDirectiveAdvancePlan{target: current}
	case workflowexec.ResolutionAdvance:
		if current == model.CaseStatusPhase1 {
			return caseDirectiveAdvancePlan{target: model.CaseStatusPhase2, changed: true}
		}
		return caseDirectiveAdvancePlan{target: current}
	default:
		return caseDirectiveAdvancePlan{target: current}
	}
}
