package executor

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// approverList builds the approvers []interface{} shape that step.Config carries.
func approverList(pairs ...[2]string) []interface{} {
	out := make([]interface{}, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, map[string]interface{}{"type": p[0], "ref": p[1]})
	}
	return out
}

func approvalStep(cfg map[string]interface{}) *model.StepDefinition {
	return &model.StepDefinition{
		ID:     "step-approval",
		Name:   "Multi-level approval",
		Type:   StepTypeApprovalChain,
		Config: cfg,
	}
}

// ---------- ParseApprovalConfig ----------

func TestParseApprovalConfig(t *testing.T) {
	tests := []struct {
		name      string
		config    map[string]interface{}
		wantErr   bool
		checkPass func(t *testing.T, c ApprovalConfig)
	}{
		{
			name: "defaults to sequential/all",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "lead"}, [2]string{"user", "u-1"}),
			},
			checkPass: func(t *testing.T, c ApprovalConfig) {
				if c.Mode != ApprovalModeSequential {
					t.Errorf("mode = %s, want sequential", c.Mode)
				}
				if c.Quorum != QuorumAll {
					t.Errorf("quorum = %s, want all", c.Quorum)
				}
				if len(c.Approvers) != 2 {
					t.Errorf("approvers = %d, want 2", len(c.Approvers))
				}
			},
		},
		{
			name: "parallel n_of_m parsed",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "a"}, [2]string{"role", "b"}, [2]string{"role", "c"}),
				"mode":      "parallel",
				"quorum":    "n_of_m",
				"quorum_n":  2.0,
				"sla_hours": 4.0,
			},
			checkPass: func(t *testing.T, c ApprovalConfig) {
				if c.Mode != ApprovalModeParallel || c.Quorum != QuorumNofM || c.QuorumN != 2 {
					t.Errorf("got mode=%s quorum=%s n=%d", c.Mode, c.Quorum, c.QuorumN)
				}
				if c.SLA == 0 {
					t.Error("expected non-zero SLA")
				}
			},
		},
		{
			name:    "missing approvers fails",
			config:  map[string]interface{}{"mode": "parallel"},
			wantErr: true,
		},
		{
			name:    "empty approvers fails",
			config:  map[string]interface{}{"approvers": []interface{}{}},
			wantErr: true,
		},
		{
			name: "bad approver type fails",
			config: map[string]interface{}{
				"approvers": []interface{}{map[string]interface{}{"type": "group", "ref": "x"}},
			},
			wantErr: true,
		},
		{
			name: "missing ref fails",
			config: map[string]interface{}{
				"approvers": []interface{}{map[string]interface{}{"type": "role", "ref": ""}},
			},
			wantErr: true,
		},
		{
			name: "unknown mode fails",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "a"}),
				"mode":      "round_robin",
			},
			wantErr: true,
		},
		{
			name: "unknown quorum fails",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "a"}),
				"quorum":    "most",
			},
			wantErr: true,
		},
		{
			name: "n_of_m without n fails",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "a"}, [2]string{"role", "b"}),
				"quorum":    "n_of_m",
			},
			wantErr: true,
		},
		{
			name: "n_of_m with n exceeding approvers fails",
			config: map[string]interface{}{
				"approvers": approverList([2]string{"role", "a"}, [2]string{"role", "b"}),
				"quorum":    "n_of_m",
				"quorum_n":  5.0,
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := ParseApprovalConfig(tc.config)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.checkPass != nil {
				tc.checkPass(t, cfg)
			}
		})
	}
}

// ---------- Execute: sequential vs parallel task creation ----------

func TestApprovalChainExecute_ParallelCreatesAllTasks(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	exec := NewApprovalChainExecutor(creator, publisher, zerolog.Nop())

	step := approvalStep(map[string]interface{}{
		"approvers": approverList([2]string{"role", "lead"}, [2]string{"role", "manager"}, [2]string{"user", "u-3"}),
		"mode":      "parallel",
		"quorum":    "n_of_m",
		"quorum_n":  2.0,
		"sla_hours": 4.0,
	})

	result, err := exec.Execute(context.Background(), testInstance(), step, testExec())
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if !result.Parked {
		t.Fatal("approval chain must park the workflow")
	}
	if len(creator.tasks) != 3 {
		t.Fatalf("parallel created tasks = %d, want 3 (one per approver)", len(creator.tasks))
	}
	// Every task must carry approval metadata and an SLA deadline.
	for i, task := range creator.tasks {
		if task.Metadata["approval_chain"] != true {
			t.Errorf("task %d missing approval_chain metadata", i)
		}
		if task.SLADeadline == nil {
			t.Errorf("task %d missing SLA deadline", i)
		}
		if task.Status != model.TaskStatusPending {
			t.Errorf("task %d status = %s, want pending", i, task.Status)
		}
	}
	// One created event per task.
	if len(publisher.events) != 3 {
		t.Fatalf("published events = %d, want 3", len(publisher.events))
	}
	// The third approver is a user ref, must be set as AssigneeID not role.
	userTask := creator.tasks[2]
	if userTask.AssigneeID == nil || *userTask.AssigneeID != "u-3" {
		t.Errorf("user approver assignee = %v, want u-3", userTask.AssigneeID)
	}
	if userTask.AssigneeRole != nil {
		t.Errorf("user approver should not have a role, got %v", *userTask.AssigneeRole)
	}
}

func TestApprovalChainExecute_SequentialCreatesFirstOnly(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	exec := NewApprovalChainExecutor(creator, publisher, zerolog.Nop())

	step := approvalStep(map[string]interface{}{
		"approvers": approverList([2]string{"role", "lead"}, [2]string{"role", "manager"}),
		"mode":      "sequential",
		"quorum":    "all",
	})

	result, err := exec.Execute(context.Background(), testInstance(), step, testExec())
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if !result.Parked {
		t.Fatal("approval chain must park the workflow")
	}
	if len(creator.tasks) != 1 {
		t.Fatalf("sequential created tasks = %d, want 1 (only the first approver)", len(creator.tasks))
	}
	first := creator.tasks[0]
	if first.AssigneeRole == nil || *first.AssigneeRole != "lead" {
		t.Errorf("first task role = %v, want lead", first.AssigneeRole)
	}
	if got := first.Metadata["approver_index"]; got != 0 {
		t.Errorf("first task approver_index = %v, want 0", got)
	}
	if got := first.Metadata["approver_total"]; got != 2 {
		t.Errorf("first task approver_total = %v, want 2", got)
	}
}

func TestApprovalChainExecute_NoSLAWhenUnset(t *testing.T) {
	creator := &fakeTaskCreator{}
	exec := NewApprovalChainExecutor(creator, nil, zerolog.Nop())
	step := approvalStep(map[string]interface{}{
		"approvers": approverList([2]string{"role", "lead"}),
		"mode":      "parallel",
	})
	if _, err := exec.Execute(context.Background(), testInstance(), step, testExec()); err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if creator.tasks[0].SLADeadline != nil {
		t.Error("no sla_hours configured: SLADeadline must be nil")
	}
}

func TestApprovalChainExecute_TaskCreateFailureAborts(t *testing.T) {
	creator := &fakeTaskCreator{err: errors.New("db down")}
	publisher := &fakeEventPublisher{}
	exec := NewApprovalChainExecutor(creator, publisher, zerolog.Nop())
	step := approvalStep(map[string]interface{}{
		"approvers": approverList([2]string{"role", "lead"}),
		"mode":      "parallel",
	})
	if _, err := exec.Execute(context.Background(), testInstance(), step, testExec()); err == nil {
		t.Fatal("expected error when task creation fails")
	}
	if len(publisher.events) != 0 {
		t.Errorf("published events = %d, want 0 when create fails", len(publisher.events))
	}
}

func TestApprovalChainExecute_InvalidConfigFails(t *testing.T) {
	creator := &fakeTaskCreator{}
	exec := NewApprovalChainExecutor(creator, nil, zerolog.Nop())
	step := approvalStep(map[string]interface{}{"mode": "parallel"}) // no approvers
	if _, err := exec.Execute(context.Background(), testInstance(), step, testExec()); err == nil {
		t.Fatal("expected error for missing approvers")
	}
	if len(creator.tasks) != 0 {
		t.Errorf("created tasks = %d, want 0 on config error", len(creator.tasks))
	}
}

// ---------- ResolveApproval: quorum semantics ----------

// decisionsFor builds a decisions slice of `total` length where the first
// `approve` entries approve, the next `reject` entries reject, and the rest are
// pending (empty decision). It models recorded tasks in a parallel chain.
func decisionsFor(total, approve, reject int) []ApproverDecision {
	out := make([]ApproverDecision, 0, total)
	for i := 0; i < total; i++ {
		d := ApproverDecision{Approver: Approver{Type: "role", Ref: "r"}}
		switch {
		case i < approve:
			d.Decision = DecisionApprove
		case i < approve+reject:
			d.Decision = DecisionReject
		default:
			d.Decision = ""
		}
		out = append(out, d)
	}
	return out
}

func cfgFor(total int, quorum string, n int) ApprovalConfig {
	approvers := make([]Approver, total)
	for i := range approvers {
		approvers[i] = Approver{Type: "role", Ref: "r"}
	}
	return ApprovalConfig{Approvers: approvers, Mode: ApprovalModeParallel, Quorum: quorum, QuorumN: n}
}

func TestResolveApproval_Quorum(t *testing.T) {
	tests := []struct {
		name     string
		total    int
		quorum   string
		n        int
		approve  int
		reject   int
		expected Resolution
	}{
		// ----- all -----
		{"all: all approved -> advance", 3, QuorumAll, 0, 3, 0, ResolutionAdvance},
		{"all: one rejected -> reject (cannot reach all)", 3, QuorumAll, 0, 1, 1, ResolutionReject},
		{"all: partial approvals waiting", 3, QuorumAll, 0, 2, 0, ResolutionWait},
		{"all: none decided waiting", 3, QuorumAll, 0, 0, 0, ResolutionWait},

		// ----- any -----
		{"any: one approved -> advance", 3, QuorumAny, 0, 1, 0, ResolutionAdvance},
		{"any: none yet -> wait", 3, QuorumAny, 0, 0, 0, ResolutionWait},
		{"any: all rejected -> reject", 3, QuorumAny, 0, 0, 3, ResolutionReject},
		{"any: some rejected still waiting", 3, QuorumAny, 0, 0, 2, ResolutionWait},

		// ----- n_of_m -----
		{"n_of_m: reached n -> advance", 5, QuorumNofM, 3, 3, 0, ResolutionAdvance},
		{"n_of_m: too many rejects -> reject", 5, QuorumNofM, 3, 1, 3, ResolutionReject}, // decided=4, pending=1: 1 approve + 1 pending = 2 < 3
		{"n_of_m: still reachable -> wait", 5, QuorumNofM, 3, 2, 0, ResolutionWait},
		{"n_of_m: exactly enough capacity left -> wait", 5, QuorumNofM, 3, 1, 1, ResolutionWait}, // decided=2, pending=3: 1 + 3 >= 3
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := cfgFor(tc.total, tc.quorum, tc.n)
			got := ResolveApproval(cfg, decisionsFor(tc.total, tc.approve, tc.reject))
			if got != tc.expected {
				t.Errorf("ResolveApproval = %q, want %q", got, tc.expected)
			}
		})
	}
}

func TestResolveApproval_SequentialPartialDecisions(t *testing.T) {
	// Sequential all-of-3: only the first task exists and approved. The other
	// two have no decision row yet — counted as pending, so still WAIT.
	cfg := cfgFor(3, QuorumAll, 0)
	cfg.Mode = ApprovalModeSequential
	decisions := []ApproverDecision{{Approver: cfg.Approvers[0], Decision: DecisionApprove}}
	if got := ResolveApproval(cfg, decisions); got != ResolutionWait {
		t.Errorf("sequential first-approved = %q, want wait", got)
	}

	// First rejects in an all-quorum: cannot reach all -> reject.
	decisions = []ApproverDecision{{Approver: cfg.Approvers[0], Decision: DecisionReject}}
	if got := ResolveApproval(cfg, decisions); got != ResolutionReject {
		t.Errorf("sequential first-rejected (all) = %q, want reject", got)
	}
}

func TestNextSequentialApprover(t *testing.T) {
	cfg := cfgFor(3, QuorumAll, 0)
	cfg.Mode = ApprovalModeSequential
	cfg.Approvers[0] = Approver{Type: "role", Ref: "a"}
	cfg.Approvers[1] = Approver{Type: "role", Ref: "b"}
	cfg.Approvers[2] = Approver{Type: "role", Ref: "c"}

	// No decisions yet — wait state, next is index 0.
	ap, idx, ok := NextSequentialApprover(cfg, nil)
	if !ok || idx != 0 || ap.Ref != "a" {
		t.Fatalf("first next = (%v,%d,%v), want (a,0,true)", ap, idx, ok)
	}

	// First approved — next is index 1.
	decisions := []ApproverDecision{{Decision: DecisionApprove}}
	ap, idx, ok = NextSequentialApprover(cfg, decisions)
	if !ok || idx != 1 || ap.Ref != "b" {
		t.Fatalf("second next = (%v,%d,%v), want (b,1,true)", ap, idx, ok)
	}

	// All approved — advanced, so no next.
	decisions = []ApproverDecision{{Decision: DecisionApprove}, {Decision: DecisionApprove}, {Decision: DecisionApprove}}
	if _, _, ok = NextSequentialApprover(cfg, decisions); ok {
		t.Error("expected no next approver after advance")
	}

	// Parallel mode never yields a sequential next.
	par := cfgFor(2, QuorumAll, 0)
	if _, _, ok = NextSequentialApprover(par, nil); ok {
		t.Error("parallel mode must not yield a sequential next approver")
	}
}

// ---------- DistinctApproverConflict: separation of duties ----------

// distinctCfg builds a two-tier sequential chain with the distinct-approver flag
// set to `require`.
func distinctCfg(require bool) ApprovalConfig {
	cfg := cfgFor(2, QuorumAll, 0)
	cfg.Mode = ApprovalModeSequential
	cfg.RequireDistinctApprovers = require
	return cfg
}

func TestDistinctApproverConflict_FlagOnSameActorRejected(t *testing.T) {
	cfg := distinctCfg(true)
	// Same user "u-1" decides tier-1 (approve) then tier-2 (approve).
	decisions := []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: "u-1"},
		{Approver: cfg.Approvers[1], Decision: DecisionApprove, DecidedBy: "u-1"},
	}
	actor, conflict := DistinctApproverConflict(cfg, decisions)
	if !conflict {
		t.Fatal("expected a separation-of-duties conflict when one actor decides both tiers")
	}
	if actor != "u-1" {
		t.Errorf("conflicting actor = %q, want u-1", actor)
	}
}

func TestDistinctApproverConflict_FlagOnSameActorCaseInsensitive(t *testing.T) {
	cfg := distinctCfg(true)
	decisions := []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: "U-1"},
		{Approver: cfg.Approvers[1], Decision: DecisionReject, DecidedBy: " u-1 "},
	}
	if _, conflict := DistinctApproverConflict(cfg, decisions); !conflict {
		t.Fatal("expected conflict for the same actor differing only in case/whitespace")
	}
}

func TestDistinctApproverConflict_FlagOnDistinctActorsAllowed(t *testing.T) {
	cfg := distinctCfg(true)
	// Two different users decide the two tiers — no conflict.
	decisions := []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: "u-1"},
		{Approver: cfg.Approvers[1], Decision: DecisionApprove, DecidedBy: "u-2"},
	}
	if actor, conflict := DistinctApproverConflict(cfg, decisions); conflict {
		t.Fatalf("distinct actors must be allowed, got conflict on %q", actor)
	}
}

func TestDistinctApproverConflict_FlagOffNeverConflicts(t *testing.T) {
	cfg := distinctCfg(false)
	// Same actor on both tiers, but the flag is off → no behavioural change.
	decisions := []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: "u-1"},
		{Approver: cfg.Approvers[1], Decision: DecisionApprove, DecidedBy: "u-1"},
	}
	if _, conflict := DistinctApproverConflict(cfg, decisions); conflict {
		t.Fatal("flag off must never report a conflict (existing flows unchanged)")
	}
	// ResolveApproval is unaffected by the flag: still advances on all-approved.
	if got := ResolveApproval(cfg, decisions); got != ResolutionAdvance {
		t.Errorf("ResolveApproval = %q, want advance (flag must not change resolution)", got)
	}
}

func TestDistinctApproverConflict_PendingAndUnknownIgnored(t *testing.T) {
	cfg := distinctCfg(true)
	// One decided tier and one still-pending tier with no decider: no conflict.
	decisions := []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: "u-1"},
		{Approver: cfg.Approvers[1], Decision: "", DecidedBy: ""},
	}
	if _, conflict := DistinctApproverConflict(cfg, decisions); conflict {
		t.Fatal("a pending tier must not trigger a conflict")
	}

	// Decided tiers whose deciders are unknown (no DecidedBy) cannot establish a
	// conflict even if it is the same (empty) actor — distinctness is unprovable.
	decisions = []ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: DecisionApprove, DecidedBy: ""},
		{Approver: cfg.Approvers[1], Decision: DecisionApprove, DecidedBy: ""},
	}
	if _, conflict := DistinctApproverConflict(cfg, decisions); conflict {
		t.Fatal("unknown deciders must not be treated as a conflict")
	}
}

func TestParseApprovalConfig_RequireDistinctApprovers(t *testing.T) {
	// Default: absent key → false.
	cfg, err := ParseApprovalConfig(map[string]interface{}{
		"approvers": approverList([2]string{"role", "a"}),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.RequireDistinctApprovers {
		t.Error("require_distinct_approvers must default to false")
	}

	// Explicit bool true.
	cfg, err = ParseApprovalConfig(map[string]interface{}{
		"approvers":                  approverList([2]string{"role", "a"}, [2]string{"role", "b"}),
		"require_distinct_approvers": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.RequireDistinctApprovers {
		t.Error("require_distinct_approvers: true must parse to true")
	}

	// String "true" (config may arrive via JSON/string forms).
	cfg, _ = ParseApprovalConfig(map[string]interface{}{
		"approvers":                  approverList([2]string{"role", "a"}),
		"require_distinct_approvers": "true",
	})
	if !cfg.RequireDistinctApprovers {
		t.Error("require_distinct_approvers: \"true\" must parse to true")
	}
}

func TestSummarizeDecisions(t *testing.T) {
	decisions := []ApproverDecision{
		{Decision: DecisionApprove},
		{Decision: DecisionApprove},
		{Decision: DecisionReject},
		{Decision: ""},
	}
	counts := SummarizeDecisions(decisions)
	if counts[DecisionApprove] != 2 || counts[DecisionReject] != 1 || counts[""] != 1 {
		t.Errorf("SummarizeDecisions = %v", counts)
	}
}
