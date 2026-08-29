package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

// TestDefendantTwoTierMemo_RequiresDistinctApprovers proves acceptance bullet 6
// (second half / CAP Defendant §5.4): the defendant first-response memo two-tier
// review opts the engine's distinct-approver constraint ON, so a SINGLE user may
// not decide BOTH tiers at runtime, while two distinct deciders are accepted.
//
// It exercises the full server-side path the orchestrator uses on each decision:
//
//	build chain config  ->  orchestratorChainConfig (reconstruct on resume)  ->
//	DistinctApproverConflict (separation-of-duties verdict)
//
// without a database, so it pins the wiring (flag set, flag propagated, conflict
// enforced) end-to-end.
func TestDefendantTwoTierMemo_RequiresDistinctApprovers(t *testing.T) {
	s := &LitigationDefendantService{}
	tenantID := uuid.New()
	d := &model.LegalDefendantCase{ID: uuid.New(), CaseID: uuid.New(), TenantID: tenantID}
	now := time.Date(2026, 6, 29, 9, 0, 0, 0, time.UTC)

	approvers := defendantReviewApprovers(dto.StartResponseReviewRequest{})
	if err := validateTwoTierReviewChain(approvers); err != nil {
		t.Fatalf("two-tier chain should validate: %v", err)
	}

	task := s.buildFirstApproverTask(tenantID, d, uuid.New().String(), "step-exec-1", approvers, now)

	// 1) The chain config the task stamps must opt into distinct approvers.
	chainCfg, ok := task.Metadata["approval_chain_config"].(map[string]any)
	if !ok {
		t.Fatalf("approval_chain_config missing/!map: %#v", task.Metadata["approval_chain_config"])
	}
	if rd, _ := chainCfg["require_distinct_approvers"].(bool); !rd {
		t.Fatalf("require_distinct_approvers must be true on the defendant memo chain, got %#v", chainCfg["require_distinct_approvers"])
	}

	// 2) The orchestrator reconstructs the config from the task metadata on each
	// resume — the flag must survive that round-trip (it drives DistinctApproverConflict).
	cfg := orchestratorChainConfig(task.Metadata)
	if !cfg.RequireDistinctApprovers {
		t.Fatalf("orchestratorChainConfig dropped require_distinct_approvers; cfg=%+v", cfg)
	}
	if cfg.Mode != workflowexec.ApprovalModeSequential || cfg.Quorum != workflowexec.QuorumAll || len(cfg.Approvers) != 2 {
		t.Fatalf("reconstructed chain shape wrong: %+v", cfg)
	}

	supervisor := uuid.New().String()
	sectionManager := uuid.New().String()

	// 3a) Single user decides BOTH tiers -> separation-of-duties conflict (rejected).
	sameActor := []workflowexec.ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: workflowexec.DecisionApprove, DecidedBy: supervisor},
		{Approver: cfg.Approvers[1], Decision: workflowexec.DecisionApprove, DecidedBy: supervisor},
	}
	if actor, conflict := workflowexec.DistinctApproverConflict(cfg, sameActor); !conflict {
		t.Fatalf("single user deciding both tiers must conflict; got conflict=false actor=%q", actor)
	}

	// 3b) Two DISTINCT deciders -> no conflict (the review proceeds).
	distinctActors := []workflowexec.ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: workflowexec.DecisionApprove, DecidedBy: supervisor},
		{Approver: cfg.Approvers[1], Decision: workflowexec.DecisionApprove, DecidedBy: sectionManager},
	}
	if actor, conflict := workflowexec.DistinctApproverConflict(cfg, distinctActors); conflict {
		t.Fatalf("two distinct approvers must NOT conflict; got conflict actor=%q", actor)
	}
}
