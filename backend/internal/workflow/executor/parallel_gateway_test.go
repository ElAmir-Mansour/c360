package executor

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// recordingExecutor is a real (non-mock) StepExecutor used to observe how the
// parallel gateway drives sub-steps through the registry. It records every
// execution, can sleep to expose concurrency, and can be configured to park or
// fail so the gateway's policy and error paths are exercised end-to-end.
type recordingExecutor struct {
	mu        sync.Mutex
	executed  []string      // step IDs in execution order
	maxActive int32         // peak concurrent executions observed
	active    int32         // current concurrent executions
	sleep     time.Duration // simulate work to observe concurrency
	park      bool          // return a parked result
	failOn    string        // step ID that should return an error
}

func (r *recordingExecutor) Execute(ctx context.Context, _ *model.WorkflowInstance, step *model.StepDefinition, _ *model.StepExecution) (*ExecutionResult, error) {
	cur := atomic.AddInt32(&r.active, 1)
	for {
		peak := atomic.LoadInt32(&r.maxActive)
		if cur <= peak || atomic.CompareAndSwapInt32(&r.maxActive, peak, cur) {
			break
		}
	}
	defer atomic.AddInt32(&r.active, -1)

	r.mu.Lock()
	r.executed = append(r.executed, step.ID)
	r.mu.Unlock()

	if r.sleep > 0 {
		select {
		case <-time.After(r.sleep):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	if r.failOn != "" && step.ID == r.failOn {
		return nil, fmt.Errorf("recordingExecutor: forced failure on %s", step.ID)
	}

	return &ExecutionResult{
		Output: map[string]interface{}{"ran": step.ID},
		Parked: r.park,
	}, nil
}

func (r *recordingExecutor) executedSteps() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.executed))
	copy(out, r.executed)
	return out
}

// stepLookupFor builds a real StepLookup over a flat set of step definitions,
// exactly as the engine would resolve step IDs from a loaded definition.
func stepLookupFor(steps map[string]*model.StepDefinition) StepLookup {
	return func(stepID string) (*model.StepDefinition, bool) {
		s, ok := steps[stepID]
		return s, ok
	}
}

func pgTestInstance() *model.WorkflowInstance {
	return &model.WorkflowInstance{
		ID:        "inst-pg",
		TenantID:  "tenant-1",
		Variables: map[string]interface{}{"approved": true, "score": 90.0},
	}
}

func pgStep(branches [][]string, policy interface{}) *model.StepDefinition {
	branchesCfg := make([]interface{}, len(branches))
	for i, b := range branches {
		ids := make([]interface{}, len(b))
		for j, id := range b {
			ids[j] = id
		}
		branchesCfg[i] = ids
	}
	cfg := map[string]interface{}{"branches": branchesCfg}
	if policy != nil {
		cfg["completion_policy"] = policy
	}
	return &model.StepDefinition{ID: "gw-1", Name: "fork", Type: model.StepTypeParallelGateway, Config: cfg}
}

// TestParallelGateway_AllPolicyRunsEveryBranchConcurrently proves the executor,
// wired into a real ExecutorRegistry with a real StepLookup, fans out branches,
// runs them concurrently, drives sub-steps through the registry, and merges output.
func TestParallelGateway_AllPolicyRunsEveryBranchConcurrently(t *testing.T) {
	rec := &recordingExecutor{sleep: 40 * time.Millisecond}

	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	steps := map[string]*model.StepDefinition{
		"a1": {ID: "a1", Type: "worker"},
		"a2": {ID: "a2", Type: "worker"},
		"b1": {ID: "b1", Type: "worker"},
		"c1": {ID: "c1", Type: "worker"},
	}

	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"a1", "a2"}, {"b1"}, {"c1"}}, "all")

	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if got := result.Output["branches_completed"]; got != 3 {
		t.Errorf("branches_completed = %v, want 3", got)
	}
	if got := result.Output["branches_total"]; got != 3 {
		t.Errorf("branches_total = %v, want 3", got)
	}
	if got := result.Output["completion_policy"]; got != "all" {
		t.Errorf("completion_policy = %v, want all", got)
	}

	// All four sub-steps must have executed exactly once.
	if got := len(rec.executedSteps()); got != 4 {
		t.Fatalf("executed sub-steps = %d, want 4 (%v)", got, rec.executedSteps())
	}

	// The three branches run concurrently, so peak concurrency must exceed 1.
	if atomic.LoadInt32(&rec.maxActive) < 2 {
		t.Errorf("peak concurrency = %d, want >= 2 (branches did not run in parallel)", rec.maxActive)
	}

	// Merged output must contain per-branch results.
	outputs, ok := result.Output["branch_outputs"].(map[string]interface{})
	if !ok {
		t.Fatalf("branch_outputs missing or wrong type: %T", result.Output["branch_outputs"])
	}
	if len(outputs) != 3 {
		t.Errorf("branch_outputs has %d entries, want 3", len(outputs))
	}
}

// TestParallelGateway_RealConditionSubSteps proves branches execute genuine,
// registry-dispatched executors (the real ConditionExecutor), not just stubs.
func TestParallelGateway_RealConditionSubSteps(t *testing.T) {
	registry := NewExecutorRegistry()
	registry.Register(model.StepTypeCondition, NewConditionExecutor())

	steps := map[string]*model.StepDefinition{
		"chk-approved": {
			ID:     "chk-approved",
			Type:   model.StepTypeCondition,
			Config: map[string]interface{}{"expression": "variables.approved == true"},
		},
		"chk-score": {
			ID:     "chk-score",
			Type:   model.StepTypeCondition,
			Config: map[string]interface{}{"expression": "variables.score >= 80"},
		},
	}

	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"chk-approved"}, {"chk-score"}}, "all")

	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	outputs := result.Output["branch_outputs"].(map[string]interface{})
	// branch_0 -> chk-approved -> { "chk-approved": {"result": true} }
	b0 := outputs["branch_0"].(map[string]interface{})
	approved := b0["chk-approved"].(map[string]interface{})
	if approved["result"] != true {
		t.Errorf("branch_0 chk-approved result = %v, want true", approved["result"])
	}
	b1 := outputs["branch_1"].(map[string]interface{})
	score := b1["chk-score"].(map[string]interface{})
	if score["result"] != true {
		t.Errorf("branch_1 chk-score result = %v, want true", score["result"])
	}
}

// TestParallelGateway_AnyPolicyShortCircuits proves the "any" policy completes as
// soon as a single branch finishes and cancels the rest.
func TestParallelGateway_AnyPolicyShortCircuits(t *testing.T) {
	rec := &recordingExecutor{}
	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	steps := map[string]*model.StepDefinition{
		"fast": {ID: "fast", Type: "worker"},
		"slow": {ID: "slow", Type: "worker"},
	}
	// Make "slow" actually slow by giving it its own slow executor.
	slow := &recordingExecutor{sleep: 2 * time.Second}
	registry.Register("slow-worker", slow)
	steps["slow"].Type = "slow-worker"

	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"fast"}, {"slow"}}, "any")

	start := time.Now()
	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if got := result.Output["completion_policy"]; got != "any" {
		t.Errorf("completion_policy = %v, want any", got)
	}
	if got := result.Output["branches_completed"]; got.(int) < 1 {
		t.Errorf("branches_completed = %v, want >= 1", got)
	}
	// Must not have waited for the 2s slow branch.
	if elapsed > 1500*time.Millisecond {
		t.Errorf("elapsed = %v, want short-circuit well under the slow branch's 2s", elapsed)
	}
}

// TestParallelGateway_NOfMPolicy proves the n_of_m policy completes once N
// branches finish.
func TestParallelGateway_NOfMPolicy(t *testing.T) {
	rec := &recordingExecutor{}
	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	steps := map[string]*model.StepDefinition{
		"x": {ID: "x", Type: "worker"},
		"y": {ID: "y", Type: "worker"},
		"z": {ID: "z", Type: "worker"},
	}

	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"x"}, {"y"}, {"z"}}, 2) // require 2 of 3

	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if got := result.Output["completion_policy"]; got != "n_of_m" {
		t.Errorf("completion_policy = %v, want n_of_m", got)
	}
	if got := result.Output["branches_completed"].(int); got < 2 {
		t.Errorf("branches_completed = %d, want >= 2", got)
	}
}

// TestParallelGateway_ParkingSubStepFailsBranch proves a parking sub-step inside
// a branch produces an error under the "all" policy (parallel branches cannot
// contain parking steps).
func TestParallelGateway_ParkingSubStepFailsBranch(t *testing.T) {
	rec := &recordingExecutor{park: true}
	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	steps := map[string]*model.StepDefinition{"p": {ID: "p", Type: "worker"}}
	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"p"}}, "all")

	_, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err == nil {
		t.Fatal("Execute() error = nil, want error for parking sub-step under all policy")
	}
}

// TestParallelGateway_SubStepFailurePropagates proves a failing sub-step under
// the "all" policy fails the gateway.
func TestParallelGateway_SubStepFailurePropagates(t *testing.T) {
	rec := &recordingExecutor{failOn: "boom"}
	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	steps := map[string]*model.StepDefinition{
		"ok":   {ID: "ok", Type: "worker"},
		"boom": {ID: "boom", Type: "worker"},
	}
	gw := NewParallelGatewayExecutor(registry, stepLookupFor(steps), zerolog.Nop())
	step := pgStep([][]string{{"ok"}, {"boom"}}, "all")

	_, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err == nil {
		t.Fatal("Execute() error = nil, want failure under all policy when a branch fails")
	}
}

// TestParallelGateway_UnknownStepID proves the StepLookup miss path returns an
// error rather than silently skipping work.
func TestParallelGateway_UnknownStepID(t *testing.T) {
	registry := NewExecutorRegistry()
	registry.Register("worker", &recordingExecutor{})
	gw := NewParallelGatewayExecutor(registry, stepLookupFor(map[string]*model.StepDefinition{}), zerolog.Nop())
	step := pgStep([][]string{{"missing"}}, "all")

	_, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err == nil {
		t.Fatal("Execute() error = nil, want error when a branch references an unknown step ID")
	}
}

// TestParallelGateway_EmptyBranches proves the degenerate empty-config case.
func TestParallelGateway_EmptyBranches(t *testing.T) {
	registry := NewExecutorRegistry()
	gw := NewParallelGatewayExecutor(registry, stepLookupFor(map[string]*model.StepDefinition{}), zerolog.Nop())
	step := pgStep([][]string{}, "all")

	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if got := result.Output["branches_completed"]; got != 0 {
		t.Errorf("branches_completed = %v, want 0", got)
	}
}

// TestParallelGateway_MissingBranchesConfig proves a malformed config errors.
func TestParallelGateway_MissingBranchesConfig(t *testing.T) {
	registry := NewExecutorRegistry()
	gw := NewParallelGatewayExecutor(registry, stepLookupFor(map[string]*model.StepDefinition{}), zerolog.Nop())
	step := &model.StepDefinition{ID: "gw-1", Type: model.StepTypeParallelGateway, Config: map[string]interface{}{}}

	_, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err == nil {
		t.Fatal("Execute() error = nil, want error for missing branches config")
	}
	// The error should name the missing config key so the cause is actionable.
	if !strings.Contains(err.Error(), "branches") {
		t.Errorf("error = %q, want it to mention the missing %q config key", err.Error(), "branches")
	}
}
