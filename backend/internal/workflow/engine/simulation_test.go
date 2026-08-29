package engine

import (
	"context"
	"testing"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

// endStep is a small helper to build a terminal end step.
func endStep(id string) model.StepDefinition {
	return model.StepDefinition{ID: id, Type: model.StepTypeEnd, Name: "End"}
}

// pathIDs extracts the ordered step IDs from a simulation result path.
func pathIDs(res SimulationResult) []string {
	ids := make([]string, 0, len(res.Path))
	for _, s := range res.Path {
		ids = append(ids, s.StepID)
	}
	return ids
}

// findStepEntry returns the path entry for stepID, or false.
func findStepEntry(res SimulationResult, stepID string) (SimulationStep, bool) {
	for _, s := range res.Path {
		if s.StepID == stepID {
			return s, true
		}
	}
	return SimulationStep{}, false
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestSimulate_BranchingDefinition_RoutesByTriggerData verifies that a branching
// definition (condition gate with two guarded transitions) takes the correct
// branch for distinct trigger data inputs, and that the condition is evaluated
// for real.
func TestSimulate_BranchingDefinition_RoutesByTriggerData(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID:      "def-branch",
		Version: 3,
		Variables: map[string]model.VariableDef{
			"severity": {Type: "string", Source: "severity"},
		},
		Steps: []model.StepDefinition{
			{
				ID:   "gate",
				Type: model.StepTypeCondition,
				Name: "Severity gate",
				Config: map[string]interface{}{
					"expression": "variables.severity == 'critical'",
				},
				Transitions: []model.Transition{
					{Condition: "steps.gate.output.result == true", Target: "escalate"},
					{Condition: "steps.gate.output.result == false", Target: "notify"},
				},
			},
			{
				ID:          "escalate",
				Type:        model.StepTypeServiceTask,
				Name:        "Escalate",
				Config:      map[string]interface{}{"service": "pager", "method": "POST", "url": "/page"},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{
				ID:          "notify",
				Type:        model.StepTypeServiceTask,
				Name:        "Notify",
				Config:      map[string]interface{}{"service": "notify", "method": "POST", "url": "/notify"},
				Transitions: []model.Transition{{Target: "end"}},
			},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()

	tests := []struct {
		name     string
		trigger  map[string]interface{}
		wantPath []string
	}{
		{
			name:     "critical routes to escalate",
			trigger:  map[string]interface{}{"severity": "critical"},
			wantPath: []string{"gate", "escalate", "end"},
		},
		{
			name:     "low routes to notify",
			trigger:  map[string]interface{}{"severity": "low"},
			wantPath: []string{"gate", "notify", "end"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res, err := orch.Simulate(context.Background(), def, tc.trigger, nil, nil)
			if err != nil {
				t.Fatalf("Simulate returned error: %v", err)
			}
			if res.Status != SimStatusCompleted {
				t.Fatalf("status = %q, want %q (msg: %s)", res.Status, SimStatusCompleted, res.Message)
			}
			if got := pathIDs(res); !equalStringSlices(got, tc.wantPath) {
				t.Fatalf("path = %v, want %v", got, tc.wantPath)
			}
			if res.DefinitionVersion != 3 {
				t.Errorf("definition version = %d, want 3", res.DefinitionVersion)
			}
			// The condition step must have been evaluated for real.
			gate, ok := findStepEntry(res, "gate")
			if !ok {
				t.Fatalf("gate step missing from path")
			}
			if gate.Outcome != MockConditionEvaluated {
				t.Errorf("gate outcome = %q, want %q", gate.Outcome, MockConditionEvaluated)
			}
		})
	}
}

// TestSimulate_ConditionGate_EvaluatesRealExpression checks that the condition
// step's expression and the transition guards are recorded as real evaluations
// with the correct boolean results.
func TestSimulate_ConditionGate_EvaluatesRealExpression(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-cond",
		Variables: map[string]model.VariableDef{
			"amount": {Type: "number", Source: "amount"},
		},
		Steps: []model.StepDefinition{
			{
				ID:   "check",
				Type: model.StepTypeCondition,
				Name: "Amount check",
				Config: map[string]interface{}{
					"expression": "variables.amount > 1000",
				},
				Transitions: []model.Transition{
					{Condition: "steps.check.output.result == true", Target: "review"},
					{Target: "auto"}, // unconditional fallback
				},
			},
			{ID: "review", Type: model.StepTypeServiceTask, Name: "Review",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/r"},
				Transitions: []model.Transition{{Target: "end"}}},
			{ID: "auto", Type: model.StepTypeServiceTask, Name: "Auto",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/a"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()

	// amount=5000 -> review
	res, err := orch.Simulate(context.Background(), def, map[string]interface{}{"amount": 5000}, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if got := pathIDs(res); !equalStringSlices(got, []string{"check", "review", "end"}) {
		t.Fatalf("path = %v, want [check review end]", got)
	}

	// Find the condition_step evaluation and assert it is true.
	var foundCond, foundTrueTransition bool
	for _, e := range res.Evaluations {
		if e.Kind == "condition_step" && e.StepID == "check" {
			foundCond = true
			if !e.Result {
				t.Errorf("condition expression result = false, want true for amount=5000")
			}
			if e.Error != "" {
				t.Errorf("condition expression unexpected error: %s", e.Error)
			}
		}
		if e.Kind == "transition" && e.StepID == "check" && e.Target == "review" && e.Result {
			foundTrueTransition = true
		}
	}
	if !foundCond {
		t.Errorf("no condition_step evaluation recorded for 'check'")
	}
	if !foundTrueTransition {
		t.Errorf("no true transition to 'review' recorded")
	}

	// amount=50 -> falls through unconditional fallback to auto.
	res2, err := orch.Simulate(context.Background(), def, map[string]interface{}{"amount": 50}, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if got := pathIDs(res2); !equalStringSlices(got, []string{"check", "auto", "end"}) {
		t.Fatalf("path = %v, want [check auto end]", got)
	}
}

// TestSimulate_NoSideEffects asserts the dry run produces synthetic outputs and
// never performs a real side effect. There is no executor registry, HTTP client,
// event producer, or Redis client reachable from the orchestrator, so the only
// possible evidence of a side effect would be a non-synthetic output. Every
// service_task / event_task / timer / human output must carry simulated=true and
// no published/parked external state.
func TestSimulate_NoSideEffects(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-sideeffect",
		Steps: []model.StepDefinition{
			{ID: "call", Type: model.StepTypeServiceTask, Name: "Call",
				Config:      map[string]interface{}{"service": "billing", "method": "POST", "url": "/charge"},
				Transitions: []model.Transition{{Target: "emit"}}},
			{ID: "emit", Type: model.StepTypeEventTask, Name: "Emit",
				Config:      map[string]interface{}{"mode": "PUBLISH", "topic": "billing.events", "event_type": "charged"},
				Transitions: []model.Transition{{Target: "wait"}}},
			{ID: "wait", Type: model.StepTypeEventTask, Name: "Wait",
				Config:      map[string]interface{}{"mode": "WAIT", "topic": "billing.events", "correlation_value": "abc"},
				Transitions: []model.Transition{{Target: "delay"}}},
			{ID: "delay", Type: model.StepTypeTimer, Name: "Delay",
				Config:      map[string]interface{}{"duration": "PT2H"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusCompleted {
		t.Fatalf("status = %q, want completed (msg: %s)", res.Status, res.Message)
	}

	// service_task: synthetic 200, simulated, no real call.
	call, _ := findStepEntry(res, "call")
	if call.Outcome != MockSyntheticResponse {
		t.Errorf("call outcome = %q, want %q", call.Outcome, MockSyntheticResponse)
	}
	if sc, _ := call.Output["status_code"].(int); sc != 200 {
		t.Errorf("call status_code = %v, want 200", call.Output["status_code"])
	}
	if call.Output["simulated"] != true {
		t.Errorf("call output not marked simulated: %v", call.Output)
	}

	// event_task PUBLISH: would publish, but published=false (NOT emitted).
	emit, _ := findStepEntry(res, "emit")
	if emit.Outcome != MockWouldPublish {
		t.Errorf("emit outcome = %q, want %q", emit.Outcome, MockWouldPublish)
	}
	if emit.Output["published"] != false {
		t.Errorf("emit published = %v, want false (no real emit)", emit.Output["published"])
	}

	// event_task WAIT: would have paused but resolved instantly in sim.
	wait, _ := findStepEntry(res, "wait")
	if wait.Outcome != MockWouldWait {
		t.Errorf("wait outcome = %q, want %q", wait.Outcome, MockWouldWait)
	}
	if !wait.WouldHavePaused {
		t.Errorf("wait should record WouldHavePaused=true")
	}

	// timer: instant, virtual clock advanced; no Redis.
	delay, _ := findStepEntry(res, "delay")
	if delay.Outcome != MockTimerInstant {
		t.Errorf("delay outcome = %q, want %q", delay.Outcome, MockTimerInstant)
	}
	if delay.Output["simulated"] != true {
		t.Errorf("delay output not marked simulated")
	}

	// Every non-end step output must be flagged simulated (no real I/O leaked).
	for _, s := range res.Path {
		if s.StepType == model.StepTypeEnd {
			continue
		}
		if s.Output["simulated"] != true {
			t.Errorf("step %q output not marked simulated: %v", s.StepID, s.Output)
		}
	}
}

// TestSimulate_MockDecisionDrivesApprovalBranch verifies that mockDecisions
// drive a human_task / approval_chain branch (approve vs reject) without
// creating any task row, and that the resulting "approved" output steers a
// transition guard.
func TestSimulate_MockDecisionDrivesApprovalBranch(t *testing.T) {
	build := func() *model.WorkflowDefinition {
		return &model.WorkflowDefinition{
			ID: "def-approval",
			Steps: []model.StepDefinition{
				{
					ID:   "approve",
					Type: model.StepTypeHumanTask,
					Name: "Manager approval",
					Config: map[string]interface{}{
						"form_fields": []interface{}{},
						"sla_hours":   8.0,
					},
					Transitions: []model.Transition{
						{Condition: "steps.approve.output.approved == true", Target: "provision"},
						{Condition: "steps.approve.output.approved == false", Target: "reject"},
					},
				},
				{ID: "provision", Type: model.StepTypeServiceTask, Name: "Provision",
					Config:      map[string]interface{}{"service": "svc", "method": "POST", "url": "/p"},
					Transitions: []model.Transition{{Target: "end"}}},
				{ID: "reject", Type: model.StepTypeServiceTask, Name: "Reject",
					Config:      map[string]interface{}{"service": "svc", "method": "POST", "url": "/x"},
					Transitions: []model.Transition{{Target: "end"}}},
				endStep("end"),
			},
		}
	}

	orch := NewSimulationOrchestrator()

	// Approve branch.
	resApprove, err := orch.Simulate(context.Background(), build(), nil, nil, map[string]MockDecision{
		"approve": {Approved: true, Output: map[string]interface{}{"comment": "ok"}},
	})
	if err != nil {
		t.Fatalf("Simulate (approve) error: %v", err)
	}
	if got := pathIDs(resApprove); !equalStringSlices(got, []string{"approve", "provision", "end"}) {
		t.Fatalf("approve path = %v, want [approve provision end]", got)
	}
	approveStep, _ := findStepEntry(resApprove, "approve")
	if approveStep.Outcome != MockOutcomeDecision {
		t.Errorf("approve outcome = %q, want %q", approveStep.Outcome, MockOutcomeDecision)
	}
	if approveStep.Output["decision"] != "approved" {
		t.Errorf("approve decision = %v, want approved", approveStep.Output["decision"])
	}
	if approveStep.Output["comment"] != "ok" {
		t.Errorf("approve custom output not merged: %v", approveStep.Output)
	}
	if !approveStep.WouldHavePaused {
		t.Errorf("human task should record WouldHavePaused=true (no task row created)")
	}

	// Reject branch.
	resReject, err := orch.Simulate(context.Background(), build(), nil, nil, map[string]MockDecision{
		"approve": {Approved: false},
	})
	if err != nil {
		t.Fatalf("Simulate (reject) error: %v", err)
	}
	if got := pathIDs(resReject); !equalStringSlices(got, []string{"approve", "reject", "end"}) {
		t.Fatalf("reject path = %v, want [approve reject end]", got)
	}

	// Auto-approve (no decision supplied) defaults to approved.
	resAuto, err := orch.Simulate(context.Background(), build(), nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate (auto) error: %v", err)
	}
	if got := pathIDs(resAuto); !equalStringSlices(got, []string{"approve", "provision", "end"}) {
		t.Fatalf("auto path = %v, want [approve provision end]", got)
	}
	autoStep, _ := findStepEntry(resAuto, "approve")
	if autoStep.Outcome != MockAutoApproved {
		t.Errorf("auto outcome = %q, want %q", autoStep.Outcome, MockAutoApproved)
	}
}

// TestSimulate_ApprovalChainStepType verifies the approval_chain step type
// (WP-5, recognized by name) is handled like a human task in simulation.
func TestSimulate_ApprovalChainStepType(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-chain",
		Steps: []model.StepDefinition{
			{
				ID:   "chain",
				Type: stepTypeApprovalChain,
				Name: "Two-level approval",
				Config: map[string]interface{}{
					"quorum":    "all",
					"sla_hours": 4.0,
				},
				Transitions: []model.Transition{
					{Condition: "steps.chain.output.approved == true", Target: "end"},
					{Target: "rejected"},
				},
			},
			{ID: "rejected", Type: model.StepTypeServiceTask, Name: "Rejected",
				Config:      map[string]interface{}{"service": "svc", "method": "POST", "url": "/r"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, map[string]MockDecision{
		"chain": {Approved: true},
	})
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if got := pathIDs(res); !equalStringSlices(got, []string{"chain", "end"}) {
		t.Fatalf("path = %v, want [chain end]", got)
	}
	chain, _ := findStepEntry(res, "chain")
	if !chain.WouldHavePaused {
		t.Errorf("approval_chain should record WouldHavePaused=true")
	}
	// SLA timeline must include the chain's 4h deadline.
	if len(res.SLATimeline) != 1 {
		t.Fatalf("SLA timeline length = %d, want 1", len(res.SLATimeline))
	}
	if res.SLATimeline[0].Kind != "sla_deadline" {
		t.Errorf("SLA kind = %q, want sla_deadline", res.SLATimeline[0].Kind)
	}
	if res.SLATimeline[0].DurationSeconds != 4*3600 {
		t.Errorf("SLA duration = %v seconds, want 14400", res.SLATimeline[0].DurationSeconds)
	}
}

// TestSimulate_MaxStepsGuard verifies the guard terminates a cyclic definition
// instead of looping forever.
func TestSimulate_MaxStepsGuard(t *testing.T) {
	// A -> B -> A cycle: no end step is reachable.
	def := &model.WorkflowDefinition{
		ID: "def-loop",
		Steps: []model.StepDefinition{
			{ID: "a", Type: model.StepTypeServiceTask, Name: "A",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/a"},
				Transitions: []model.Transition{{Target: "b"}}},
			{ID: "b", Type: model.StepTypeServiceTask, Name: "B",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/b"},
				Transitions: []model.Transition{{Target: "a"}}},
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.SimulateWithOptions(context.Background(), def, nil, nil, nil, SimulationOptions{MaxSteps: 10})
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusMaxStepsExceeded {
		t.Fatalf("status = %q, want %q", res.Status, SimStatusMaxStepsExceeded)
	}
	if res.StepsExecuted != 10 {
		t.Errorf("steps executed = %d, want 10 (guard cap)", res.StepsExecuted)
	}
	// The guard must not have let it run unbounded.
	if len(res.Path) > 10 {
		t.Errorf("path length = %d exceeds guard of 10", len(res.Path))
	}
}

// TestSimulate_DefaultMaxStepsGuard verifies the default guard applies when
// MaxSteps is unset.
func TestSimulate_DefaultMaxStepsGuard(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-loop2",
		Steps: []model.StepDefinition{
			{ID: "a", Type: model.StepTypeServiceTask, Name: "A",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/a"},
				Transitions: []model.Transition{{Target: "a"}}}, // self-loop
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusMaxStepsExceeded {
		t.Fatalf("status = %q, want %q", res.Status, SimStatusMaxStepsExceeded)
	}
	if res.StepsExecuted != DefaultMaxSimulationSteps {
		t.Errorf("steps executed = %d, want %d", res.StepsExecuted, DefaultMaxSimulationSteps)
	}
}

// TestSimulate_ComputedVariables verifies initial variable resolution mirrors
// StartInstance: defaults, trigger Source, explicit overrides, and undeclared
// overrides — all reflected in FinalVariables.
func TestSimulate_ComputedVariables(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-vars",
		Variables: map[string]model.VariableDef{
			"region":   {Type: "string", Default: "us-east"},
			"severity": {Type: "string", Source: "sev"},
			"owner":    {Type: "string", Default: "unassigned"},
		},
		Steps: []model.StepDefinition{
			{ID: "noop", Type: model.StepTypeServiceTask, Name: "Noop",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/${variables.region}"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(
		context.Background(),
		def,
		map[string]interface{}{"sev": "critical"},                    // trigger Source
		map[string]interface{}{"owner": "alice", "extra_flag": true}, // overrides (one declared, one undeclared)
		nil,
	)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}

	vars := res.FinalVariables
	if vars["region"] != "us-east" {
		t.Errorf("region = %v, want us-east (default)", vars["region"])
	}
	if vars["severity"] != "critical" {
		t.Errorf("severity = %v, want critical (trigger Source)", vars["severity"])
	}
	if vars["owner"] != "alice" {
		t.Errorf("owner = %v, want alice (override beats default)", vars["owner"])
	}
	if vars["extra_flag"] != true {
		t.Errorf("extra_flag = %v, want true (undeclared override passthrough)", vars["extra_flag"])
	}

	// The resolved URL note should reflect the resolved variable.
	noop, _ := findStepEntry(res, "noop")
	if noop.SideEffectNote == "" {
		t.Errorf("expected a side-effect note for the mocked service call")
	}
}

// TestSimulate_SLATimeline_ProjectionAndOrdering verifies the projected SLA
// timeline: a timer advances the virtual clock so a subsequent human SLA is
// projected from the later point, and the timeline is sorted by due time.
func TestSimulate_SLATimeline_ProjectionAndOrdering(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-sla",
		Steps: []model.StepDefinition{
			{ID: "wait1", Type: model.StepTypeTimer, Name: "Wait 1h",
				Config:      map[string]interface{}{"duration": "PT1H"},
				Transitions: []model.Transition{{Target: "review"}}},
			{ID: "review", Type: model.StepTypeHumanTask, Name: "Review",
				Config: map[string]interface{}{
					"form_fields": []interface{}{},
					"sla_hours":   2.0,
					"escalation": []interface{}{
						map[string]interface{}{"after": "PT1H", "notify": "role:lead"},
						map[string]interface{}{"after": "PT90M", "notify": "role:manager", "action": "reassign"},
					},
				},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	start := time.Date(2026, 6, 13, 9, 0, 0, 0, time.UTC)
	orch := NewSimulationOrchestrator()
	res, err := orch.SimulateWithOptions(context.Background(), def, nil, nil, nil, SimulationOptions{StartTime: start})
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusCompleted {
		t.Fatalf("status = %q, want completed", res.Status)
	}

	if len(res.SLATimeline) != 2 {
		t.Fatalf("SLA timeline length = %d, want 2", len(res.SLATimeline))
	}

	// Timeline is sorted by DueAt: timer fires at 10:00, human SLA due at 12:00.
	timer := res.SLATimeline[0]
	human := res.SLATimeline[1]

	if timer.Kind != "timer_fire" {
		t.Errorf("first entry kind = %q, want timer_fire", timer.Kind)
	}
	wantTimerDue := start.Add(time.Hour)
	if !timer.DueAt.Equal(wantTimerDue) {
		t.Errorf("timer due = %v, want %v", timer.DueAt, wantTimerDue)
	}

	if human.Kind != "sla_deadline" {
		t.Errorf("second entry kind = %q, want sla_deadline", human.Kind)
	}
	// Human task entered at 10:00 (after the 1h timer), SLA 2h -> due 12:00.
	wantHumanEntered := start.Add(time.Hour)
	if !human.EnteredAt.Equal(wantHumanEntered) {
		t.Errorf("human entered = %v, want %v (after timer advanced the clock)", human.EnteredAt, wantHumanEntered)
	}
	wantHumanDue := start.Add(3 * time.Hour)
	if !human.DueAt.Equal(wantHumanDue) {
		t.Errorf("human due = %v, want %v", human.DueAt, wantHumanDue)
	}

	// Escalations projected from the human task's entered time.
	if len(human.Escalations) != 2 {
		t.Fatalf("human escalations = %d, want 2", len(human.Escalations))
	}
	if human.Escalations[0].Notify != "role:lead" {
		t.Errorf("escalation[0] notify = %q, want role:lead", human.Escalations[0].Notify)
	}
	if !human.Escalations[0].FireAt.Equal(wantHumanEntered.Add(time.Hour)) {
		t.Errorf("escalation[0] fire = %v, want %v", human.Escalations[0].FireAt, wantHumanEntered.Add(time.Hour))
	}
	if human.Escalations[1].Action != "reassign" {
		t.Errorf("escalation[1] action = %q, want reassign", human.Escalations[1].Action)
	}
	if !human.Escalations[1].FireAt.Equal(wantHumanEntered.Add(90 * time.Minute)) {
		t.Errorf("escalation[1] fire = %v, want %v", human.Escalations[1].FireAt, wantHumanEntered.Add(90*time.Minute))
	}

	// ProjectedEndAt reflects the final virtual clock (advanced by the timer).
	if !res.ProjectedEndAt.Equal(wantTimerDue) {
		t.Errorf("projected end = %v, want %v", res.ProjectedEndAt, wantTimerDue)
	}
}

// TestSimulate_AdvanceClockOnSLA verifies the optional policy that advances the
// virtual clock by a parking step's SLA so a subsequent SLA is offset.
func TestSimulate_AdvanceClockOnSLA(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-sla-advance",
		Steps: []model.StepDefinition{
			{ID: "a", Type: model.StepTypeHumanTask, Name: "A",
				Config:      map[string]interface{}{"form_fields": []interface{}{}, "sla_hours": 2.0},
				Transitions: []model.Transition{{Target: "b"}}},
			{ID: "b", Type: model.StepTypeHumanTask, Name: "B",
				Config:      map[string]interface{}{"form_fields": []interface{}{}, "sla_hours": 3.0},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	start := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)
	orch := NewSimulationOrchestrator()
	res, err := orch.SimulateWithOptions(context.Background(), def, nil, nil, nil, SimulationOptions{
		StartTime:         start,
		AdvanceClockOnSLA: true,
	})
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}

	if len(res.SLATimeline) != 2 {
		t.Fatalf("SLA timeline length = %d, want 2", len(res.SLATimeline))
	}
	// Sorted by due: A due at +2h, B entered at +2h and due at +5h.
	a := res.SLATimeline[0]
	b := res.SLATimeline[1]
	if !a.DueAt.Equal(start.Add(2 * time.Hour)) {
		t.Errorf("A due = %v, want +2h", a.DueAt)
	}
	if !b.EnteredAt.Equal(start.Add(2 * time.Hour)) {
		t.Errorf("B entered = %v, want +2h (clock advanced by A's SLA)", b.EnteredAt)
	}
	if !b.DueAt.Equal(start.Add(5 * time.Hour)) {
		t.Errorf("B due = %v, want +5h", b.DueAt)
	}
}

// TestSimulate_ParallelGateway verifies a parallel gateway traverses each
// branch's sub-steps in-memory, merges branch metadata, and makes sub-step
// outputs available to later guards — all without concurrency or side effects.
func TestSimulate_ParallelGateway(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-parallel",
		Steps: []model.StepDefinition{
			{
				ID:   "fork",
				Type: model.StepTypeParallelGateway,
				Name: "Fork",
				Config: map[string]interface{}{
					"branches": []interface{}{
						[]interface{}{"b1"},
						[]interface{}{"b2"},
					},
				},
				Transitions: []model.Transition{{Target: "join"}},
			},
			{ID: "b1", Type: model.StepTypeServiceTask, Name: "Branch 1",
				Config: map[string]interface{}{"service": "svc", "method": "GET", "url": "/1"}},
			{ID: "b2", Type: model.StepTypeServiceTask, Name: "Branch 2",
				Config: map[string]interface{}{"service": "svc", "method": "GET", "url": "/2"}},
			{ID: "join", Type: model.StepTypeServiceTask, Name: "Join",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/j"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusCompleted {
		t.Fatalf("status = %q, want completed (msg: %s)", res.Status, res.Message)
	}

	// Top-level path is linear: fork -> join -> end (sub-steps are not path
	// entries but their outputs are stored).
	if got := pathIDs(res); !equalStringSlices(got, []string{"fork", "join", "end"}) {
		t.Fatalf("path = %v, want [fork join end]", got)
	}

	fork, _ := findStepEntry(res, "fork")
	if fork.Outcome != MockParallelMerged {
		t.Errorf("fork outcome = %q, want %q", fork.Outcome, MockParallelMerged)
	}
	if total, _ := fork.Output["branches_total"].(int); total != 2 {
		t.Errorf("branches_total = %v, want 2", fork.Output["branches_total"])
	}

	// Sub-step outputs were stored so guards could read them.
	if _, ok := res.StepOutputs["b1"]; !ok {
		t.Errorf("b1 sub-step output not stored")
	}
	if _, ok := res.StepOutputs["b2"]; !ok {
		t.Errorf("b2 sub-step output not stored")
	}
}

// TestSimulate_NoTransitionStall verifies a non-end step whose guards all fail
// terminates with SimStatusNoTransition (the engine's stall behavior) rather
// than erroring or looping.
func TestSimulate_NoTransitionStall(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-stall",
		Variables: map[string]model.VariableDef{
			"flag": {Type: "boolean", Default: false},
		},
		Steps: []model.StepDefinition{
			{ID: "gate", Type: model.StepTypeCondition, Name: "Gate",
				Config: map[string]interface{}{"expression": "variables.flag == true"},
				Transitions: []model.Transition{
					// Only matches when flag is true; flag is false -> no match.
					{Condition: "variables.flag == true", Target: "end"},
				}},
			endStep("end"),
		},
	}

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusNoTransition {
		t.Fatalf("status = %q, want %q (msg: %s)", res.Status, SimStatusNoTransition, res.Message)
	}
	// The gate still appears in the path even though traversal stalled after it.
	if got := pathIDs(res); !equalStringSlices(got, []string{"gate"}) {
		t.Fatalf("path = %v, want [gate]", got)
	}
}

// TestSimulate_EmptyDefinition verifies a definition with no steps completes
// trivially without panicking.
func TestSimulate_EmptyDefinition(t *testing.T) {
	def := &model.WorkflowDefinition{ID: "def-empty"}
	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(context.Background(), def, nil, nil, nil)
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if res.Status != SimStatusCompleted {
		t.Errorf("status = %q, want completed", res.Status)
	}
	if len(res.Path) != 0 {
		t.Errorf("path length = %d, want 0", len(res.Path))
	}
}

// TestSimulate_NilDefinition verifies a nil definition is a hard error.
func TestSimulate_NilDefinition(t *testing.T) {
	orch := NewSimulationOrchestrator()
	_, err := orch.Simulate(context.Background(), nil, nil, nil, nil)
	if err == nil {
		t.Fatalf("expected error for nil definition, got nil")
	}
}

// TestSimulate_ContextCancellation verifies an already-cancelled context aborts
// the run with SimStatusError and returns the context error.
func TestSimulate_ContextCancellation(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID: "def-ctx",
		Steps: []model.StepDefinition{
			{ID: "a", Type: model.StepTypeServiceTask, Name: "A",
				Config:      map[string]interface{}{"service": "svc", "method": "GET", "url": "/a"},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	orch := NewSimulationOrchestrator()
	res, err := orch.Simulate(ctx, def, nil, nil, nil)
	if err == nil {
		t.Fatalf("expected context error, got nil")
	}
	if res.Status != SimStatusError {
		t.Errorf("status = %q, want %q", res.Status, SimStatusError)
	}
}

// TestSimulate_TimerFireAt verifies the timer fire_at branch and absolute-time
// projection.
func TestSimulate_TimerFireAt(t *testing.T) {
	fireAt := time.Date(2026, 12, 31, 23, 59, 0, 0, time.UTC)
	def := &model.WorkflowDefinition{
		ID: "def-fireat",
		Steps: []model.StepDefinition{
			{ID: "t", Type: model.StepTypeTimer, Name: "Timer",
				Config:      map[string]interface{}{"fire_at": fireAt.Format(time.RFC3339)},
				Transitions: []model.Transition{{Target: "end"}}},
			endStep("end"),
		},
	}

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	orch := NewSimulationOrchestrator()
	res, err := orch.SimulateWithOptions(context.Background(), def, nil, nil, nil, SimulationOptions{StartTime: start})
	if err != nil {
		t.Fatalf("Simulate error: %v", err)
	}
	if len(res.SLATimeline) != 1 {
		t.Fatalf("SLA timeline = %d, want 1", len(res.SLATimeline))
	}
	if !res.SLATimeline[0].DueAt.Equal(fireAt) {
		t.Errorf("timer due = %v, want %v", res.SLATimeline[0].DueAt, fireAt)
	}
}

// TestParseISO8601Duration covers the self-contained duration parser used for
// timers and escalation tiers.
func TestParseISO8601Duration(t *testing.T) {
	tests := []struct {
		in      string
		want    time.Duration
		wantErr bool
	}{
		{"PT4H", 4 * time.Hour, false},
		{"PT30M", 30 * time.Minute, false},
		{"PT1H30M", 90 * time.Minute, false},
		{"PT90S", 90 * time.Second, false},
		{"PT1H30M45S", time.Hour + 30*time.Minute + 45*time.Second, false},
		{"P1DT2H", 26 * time.Hour, false},
		{"P2D", 48 * time.Hour, false},
		{"", 0, true},
		{"4H", 0, true},  // missing P
		{"PT", 0, true},  // zero duration
		{"PTX", 0, true}, // invalid
		{"P1Y", 0, true}, // years unsupported (date component must be D)
	}

	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := parseISO8601Duration(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("parseISO8601Duration(%q) = %v, want error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseISO8601Duration(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("parseISO8601Duration(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestSimulate_OutputOverrideBreaksFalseLoop reproduces the reported symptom —
// a contract-review graph that loops legal_review -> revision_required until the
// max-steps guard trips — and proves the decision-picker fix. Auto-approve sets
// only generic decision/approved outputs, so guards that read DOMAIN fields
// (legal_approved on a human gate, compliant on a SERVICE task) are never true
// and every gate falls through to its revision fallback. Supplying those fields
// via mock decisions — including on the service task, which previously ignored
// output overrides — drives the happy path to completion.
func TestSimulate_OutputOverrideBreaksFalseLoop(t *testing.T) {
	build := func() *model.WorkflowDefinition {
		return &model.WorkflowDefinition{
			ID: "def-contract-review",
			Steps: []model.StepDefinition{
				{
					ID:   "legal_review",
					Type: model.StepTypeHumanTask,
					Name: "Legal Review",
					Config: map[string]interface{}{
						"sla_hours": 48.0,
						"form_fields": []interface{}{
							map[string]interface{}{"name": "legal_approved", "type": "boolean", "label": "Legally Approved?"},
						},
					},
					Transitions: []model.Transition{
						{Condition: "steps.legal_review.output.legal_approved == true", Target: "compliance_check"},
						{Target: "revision_required"},
					},
				},
				{
					ID:     "compliance_check",
					Type:   model.StepTypeServiceTask,
					Name:   "Compliance Check",
					Config: map[string]interface{}{"service": "compliance", "method": "POST", "url": "/check"},
					Transitions: []model.Transition{
						{Condition: "steps.compliance_check.output.compliant == true", Target: "end"},
						{Target: "revision_required"},
					},
				},
				{
					ID:          "revision_required",
					Type:        model.StepTypeServiceTask,
					Name:        "Revision Required",
					Config:      map[string]interface{}{"service": "noop", "method": "POST", "url": "/rev"},
					Transitions: []model.Transition{{Target: "legal_review"}},
				},
				endStep("end"),
			},
		}
	}

	orch := NewSimulationOrchestrator()

	// Auto-approve (no mock outputs) → the custom guards are never true, so the
	// graph loops until the max-steps guard trips. This is the reported symptom.
	loop, err := orch.SimulateWithOptions(context.Background(), build(), nil, nil, nil, SimulationOptions{MaxSteps: 40})
	if err != nil {
		t.Fatalf("Simulate (auto) error: %v", err)
	}
	if loop.Status != SimStatusMaxStepsExceeded {
		t.Fatalf("auto status = %q, want %q (msg: %s)", loop.Status, SimStatusMaxStepsExceeded, loop.Message)
	}

	// Supplying the domain outputs — including the SERVICE task's `compliant`
	// (previously impossible: the synthetic response ignored overrides) — drives
	// the happy path straight to the end.
	done, err := orch.Simulate(context.Background(), build(), nil, nil, map[string]MockDecision{
		"legal_review":     {Approved: true, Output: map[string]interface{}{"legal_approved": true}},
		"compliance_check": {Output: map[string]interface{}{"compliant": true}},
	})
	if err != nil {
		t.Fatalf("Simulate (happy path) error: %v", err)
	}
	if done.Status != SimStatusCompleted {
		t.Fatalf("happy-path status = %q, want %q (msg: %s)", done.Status, SimStatusCompleted, done.Message)
	}
	if got := pathIDs(done); !equalStringSlices(got, []string{"legal_review", "compliance_check", "end"}) {
		t.Fatalf("happy-path = %v, want [legal_review compliance_check end]", got)
	}
	if cc, ok := findStepEntry(done, "compliance_check"); !ok || cc.Output["compliant"] != true {
		t.Fatalf("service-task output override not applied: %+v", cc.Output)
	}
}
