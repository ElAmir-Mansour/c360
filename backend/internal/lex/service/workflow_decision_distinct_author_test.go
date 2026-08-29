package service

import (
	"testing"

	"github.com/google/uuid"
)

// TestValidateWorkflowDecisionDistinctAuthor proves the dynamic-SoD parity (design
// v2 §4.2) on the contract-review workflow-decision path: the contract AUTHOR may
// not render the approve/reject verdict on the contract they authored, and an
// unresolved author fails CLOSED. A distinct decider is accepted. This mirrors
// lexmw.RequireDistinctActor on the dedicated /status (sign-off) and DELETE (close)
// routes, where the contract id is a URL param; on the workflow-decision route the
// contract id is only resolvable in-service (target.contractCreatedBy), so the
// check lives in DecideTask.
func TestValidateWorkflowDecisionDistinctAuthor(t *testing.T) {
	author := uuid.New()
	other := uuid.New()

	// 1) Author deciding their OWN contract -> SoD conflict.
	if err := validateWorkflowDecisionDistinctAuthor(author, workflowDecisionTarget{contractCreatedBy: author}); err == nil {
		t.Error("author deciding own contract review must be forbidden (SoD)")
	}

	// 2) A distinct decider (not the author) -> allowed.
	if err := validateWorkflowDecisionDistinctAuthor(other, workflowDecisionTarget{contractCreatedBy: author}); err != nil {
		t.Errorf("distinct decider must be allowed: %v", err)
	}

	// 3) Unresolved author (zero UUID) -> fails CLOSED (forbidden), never silently
	//    bypasses the parity check.
	if err := validateWorkflowDecisionDistinctAuthor(other, workflowDecisionTarget{contractCreatedBy: uuid.Nil}); err == nil {
		t.Error("unresolved contract author must fail closed (forbidden)")
	}
}
