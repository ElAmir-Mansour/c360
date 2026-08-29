package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// Simulation step-type name for the approval-chain step (WP-5). The simulator
// recognizes it by name so a definition that uses approval chains can be
// dry-run before WP-5's executor/model constant is wired in. It mirrors the
// human_task mock outcome (auto-resolve / mockDecision driven).
const stepTypeApprovalChain = "approval_chain"

// MockOutcomeKind classifies how a step's outcome was synthesized during a
// side-effect-free dry run. It records what the real executor *would* have done
// without doing it.
type MockOutcomeKind string

const (
	// MockSyntheticResponse is a service_task: a synthetic HTTP 200 with empty
	// body — no real HTTP call was made.
	MockSyntheticResponse MockOutcomeKind = "synthetic_response"
	// MockWouldPublish is an event_task in PUBLISH mode: the event that would
	// have been emitted is recorded but nothing is published.
	MockWouldPublish MockOutcomeKind = "would_publish"
	// MockWouldWait is an event_task in WAIT mode: in a real run this parks the
	// instance; in simulation the wait is resolved instantly so traversal can
	// continue, and the fact that it would have parked is recorded.
	MockWouldWait MockOutcomeKind = "would_wait"
	// MockAutoApproved is a human_task / approval_chain resolved without a
	// supplied mock decision (defaults to approved).
	MockAutoApproved MockOutcomeKind = "auto_approved"
	// MockOutcomeDecision is a human_task / approval_chain resolved from a
	// caller-supplied mock decision in mockDecisions.
	MockOutcomeDecision MockOutcomeKind = "mock_decision"
	// MockTimerInstant is a timer resolved instantly (its projected fire time is
	// recorded on the SLA timeline; the virtual clock advances).
	MockTimerInstant MockOutcomeKind = "timer_instant"
	// MockConditionEvaluated is a condition step whose expression was evaluated
	// for real by the side-effect-free Evaluator.
	MockConditionEvaluated MockOutcomeKind = "condition_evaluated"
	// MockParallelMerged is a parallel_gateway whose branches were traversed
	// in-memory with mock sub-step outcomes and merged.
	MockParallelMerged MockOutcomeKind = "parallel_merged"
	// MockEndReached marks the terminal end step.
	MockEndReached MockOutcomeKind = "end_reached"
)

// SimulationStep is one entry in the executed dry-run path. It records the step,
// the mock outcome kind, the synthetic output that was fed forward into the
// instance state, and (for steps that would have parked) what the real run
// would have waited on.
type SimulationStep struct {
	// StepID is the definition step ID.
	StepID string `json:"step_id"`
	// StepType is the definition step type (e.g. "service_task").
	StepType string `json:"step_type"`
	// StepName is the human-readable step name.
	StepName string `json:"step_name"`
	// Order is the 0-based position of this step in the executed path.
	Order int `json:"order"`
	// Outcome describes how the step's result was synthesized.
	Outcome MockOutcomeKind `json:"outcome"`
	// Output is the synthetic step output recorded in the in-memory instance
	// state under steps.<id>.output, exactly as a real executor would store it.
	Output map[string]interface{} `json:"output"`
	// WouldHavePaused is true for steps whose real executor parks the instance
	// (human_task, approval_chain, event_task WAIT, timer). The simulator does
	// not pause; it records the fact and continues.
	WouldHavePaused bool `json:"would_have_paused"`
	// SideEffectNote is a human-readable description of the side effect that was
	// suppressed (e.g. "would POST http://...", "would publish to topic ...").
	SideEffectNote string `json:"side_effect_note,omitempty"`
}

// ConditionEvaluation records the real evaluation of a single gate expression —
// either a condition step's expression or a transition guard. These are the
// only computations the simulator runs "for real" (the Evaluator is
// side-effect-free).
type ConditionEvaluation struct {
	// StepID is the step the expression belongs to (the source step for a
	// transition guard, or the condition step itself).
	StepID string `json:"step_id"`
	// Kind is "condition_step" or "transition".
	Kind string `json:"kind"`
	// Expression is the raw boolean expression that was evaluated.
	Expression string `json:"expression"`
	// Target is the transition target (only set when Kind == "transition").
	Target string `json:"target,omitempty"`
	// Result is the boolean outcome of the evaluation.
	Result bool `json:"result"`
	// Error is non-empty if the expression failed to evaluate (the transition is
	// then skipped, mirroring the real engine).
	Error string `json:"error,omitempty"`
}

// SLAEntry is one projected deadline on the simulation's SLA timeline. It is
// derived from human_task / approval_chain sla_hours and timer durations,
// walking a virtual clock from the simulation start time.
type SLAEntry struct {
	// StepID is the step that introduced the deadline.
	StepID string `json:"step_id"`
	// StepType is the step type that produced this entry.
	StepType string `json:"step_type"`
	// Kind is "sla_deadline" (human/approval) or "timer_fire" (timer).
	Kind string `json:"kind"`
	// EnteredAt is the virtual time the step was entered.
	EnteredAt time.Time `json:"entered_at"`
	// DueAt is the projected deadline / fire time.
	DueAt time.Time `json:"due_at"`
	// DurationSeconds is DueAt-EnteredAt expressed in seconds.
	DurationSeconds float64 `json:"duration_seconds"`
	// Escalations are the projected escalation tiers (if the step config
	// declares an escalation policy), each offset from EnteredAt.
	Escalations []SLAEscalation `json:"escalations,omitempty"`
}

// SLAEscalation is one projected escalation tier within an SLA entry.
type SLAEscalation struct {
	// AfterSeconds is the offset from the step's EnteredAt at which the tier
	// fires.
	AfterSeconds float64 `json:"after_seconds"`
	// FireAt is EnteredAt + AfterSeconds.
	FireAt time.Time `json:"fire_at"`
	// Notify is the escalation target (e.g. "role:lead").
	Notify string `json:"notify,omitempty"`
	// Action is the escalation action (e.g. "reassign"), if declared.
	Action string `json:"action,omitempty"`
}

// SimulationStatus is the terminal disposition of a dry run.
type SimulationStatus string

const (
	// SimStatusCompleted means traversal reached an end step.
	SimStatusCompleted SimulationStatus = "completed"
	// SimStatusMaxStepsExceeded means the max-steps guard tripped (probable
	// loop or an over-long path).
	SimStatusMaxStepsExceeded SimulationStatus = "max_steps_exceeded"
	// SimStatusNoTransition means a non-end step had no matching transition;
	// the real engine would stall here.
	SimStatusNoTransition SimulationStatus = "no_transition"
	// SimStatusError means traversal aborted on an error (e.g. a missing step
	// target, a missing required config key).
	SimStatusError SimulationStatus = "error"
)

// SimulationResult is the complete, side-effect-free outcome of a dry run.
type SimulationResult struct {
	// DefinitionID is the simulated definition's ID.
	DefinitionID string `json:"definition_id"`
	// DefinitionVersion is the simulated definition's version.
	DefinitionVersion int `json:"definition_version"`
	// Status is the terminal disposition of the run.
	Status SimulationStatus `json:"status"`
	// Path is the ordered list of executed steps with their mock outcomes.
	Path []SimulationStep `json:"path"`
	// Evaluations is every gate/condition expression evaluated, in order.
	Evaluations []ConditionEvaluation `json:"evaluations"`
	// FinalVariables is the computed variable map at the end of traversal.
	FinalVariables map[string]interface{} `json:"final_variables"`
	// StepOutputs is the accumulated steps.<id>.output map at the end of
	// traversal (the same shape the engine stores on the instance).
	StepOutputs map[string]interface{} `json:"step_outputs"`
	// SLATimeline is the projected deadline timeline, sorted by DueAt.
	SLATimeline []SLAEntry `json:"sla_timeline"`
	// StepsExecuted is the number of steps traversed (== len(Path)).
	StepsExecuted int `json:"steps_executed"`
	// StartedAt is the virtual clock start used for the SLA projection.
	StartedAt time.Time `json:"started_at"`
	// ProjectedEndAt is the virtual clock value after traversal (advanced by
	// timers and, optionally, by SLA durations of parking steps).
	ProjectedEndAt time.Time `json:"projected_end_at"`
	// Message carries a human-readable note for non-completed statuses.
	Message string `json:"message,omitempty"`
}

// SimulationOptions tunes a dry run.
type SimulationOptions struct {
	// MaxSteps caps the number of steps traversed before the guard trips. It
	// prevents infinite loops in cyclic definitions. Zero selects
	// DefaultMaxSimulationSteps.
	MaxSteps int
	// StartTime is the virtual clock origin for the SLA timeline. Zero selects
	// time.Now().UTC(), making projections relative to "now".
	StartTime time.Time
	// AdvanceClockOnSLA, when true, advances the virtual clock by a parking
	// step's projected SLA duration (human_task / approval_chain) as if the
	// approver took the full SLA window. When false (default), only timers
	// advance the clock and SLA deadlines are recorded without moving the clock.
	AdvanceClockOnSLA bool
}

// DefaultMaxSimulationSteps bounds traversal when SimulationOptions.MaxSteps is
// not set. It is generous enough for realistic workflows but finite, so a cyclic
// definition terminates with SimStatusMaxStepsExceeded instead of hanging.
const DefaultMaxSimulationSteps = 256

// MockDecision is a caller-supplied outcome for a human_task / approval_chain
// step, keyed by step ID in the mockDecisions argument to Simulate. It lets a
// dry run drive a specific approval/rejection branch without creating any task.
type MockDecision struct {
	// Approved selects the approve vs. reject outcome. It is surfaced both as a
	// "decision" output field and (for convenience in transition guards) as an
	// "approved" boolean output field.
	Approved bool `json:"approved"`
	// Output is merged into the step's synthetic output, so a guard can read
	// steps.<id>.output.<field>. Reserved keys "decision" and "approved" are set
	// by the simulator and override any same-named entry here.
	Output map[string]interface{} `json:"output,omitempty"`
}

// SimulationOrchestrator runs side-effect-free dry runs of workflow definitions.
// It is fully self-contained: it does NOT hold the executor registry, an event
// producer, a Redis client, an HTTP client, or any repository. Its only
// collaborators are the side-effect-free Evaluator and VariableResolver, exactly
// the two primitives the design (§3.5, §6) names as safe to reuse.
//
// Because it touches none of those externals, a SimulationOrchestrator is
// trivially safe to construct and call from a read-only request handler; the
// /simulate route wiring is the INTEGRATE phase.
type SimulationOrchestrator struct {
	evaluator *expression.Evaluator
	resolver  *expression.VariableResolver
}

// NewSimulationOrchestrator builds a SimulationOrchestrator with the
// side-effect-free Evaluator and VariableResolver. It takes no external
// dependencies by design.
func NewSimulationOrchestrator() *SimulationOrchestrator {
	return &SimulationOrchestrator{
		evaluator: expression.NewEvaluator(),
		resolver:  expression.NewVariableResolver(),
	}
}

// Simulate runs a self-contained, side-effect-free dry-run traversal of def.
//
// It mirrors the real engine's FSM semantics (initial-variable resolution like
// StartInstance, step-then-transition advance like AdvanceWorkflow, end-step
// completion) entirely in memory, substituting a MOCK outcome for every step
// type that would otherwise perform a side effect:
//
//   - service_task   -> synthetic HTTP 200 with empty body (NO HTTP)
//   - event_task     -> records the event it WOULD publish / wait on (NO emit)
//   - human_task     -> uses mockDecisions[stepID] or auto-approves (NO task row)
//   - approval_chain -> same as human_task (NO task rows)
//   - condition      -> REAL Evaluator evaluation
//   - timer          -> resolves instantly, advancing the virtual clock (NO Redis)
//   - parallel_gateway -> branches traversed in-memory with mock sub-step outcomes
//   - end            -> terminates traversal
//
// Transitions are evaluated for real by the Evaluator. Nothing touches
// Redis/Kafka/HTTP/DB. The returned SimulationResult carries the executed path,
// every gate evaluation, the computed variables and step outputs, and a
// projected SLA timeline.
//
// triggerData is the raw trigger payload (the simulated event/manual body).
// varOverrides are explicit variable overrides (the StartInstance
// InputVariables analogue). mockDecisions drives human/approval branches.
func (o *SimulationOrchestrator) Simulate(
	ctx context.Context,
	def *model.WorkflowDefinition,
	triggerData map[string]interface{},
	varOverrides map[string]interface{},
	mockDecisions map[string]MockDecision,
) (SimulationResult, error) {
	return o.SimulateWithOptions(ctx, def, triggerData, varOverrides, mockDecisions, SimulationOptions{})
}

// SimulateWithOptions is Simulate with explicit SimulationOptions (max-steps
// guard, virtual-clock origin, SLA clock policy).
func (o *SimulationOrchestrator) SimulateWithOptions(
	ctx context.Context,
	def *model.WorkflowDefinition,
	triggerData map[string]interface{},
	varOverrides map[string]interface{},
	mockDecisions map[string]MockDecision,
	opts SimulationOptions,
) (SimulationResult, error) {
	if def == nil {
		return SimulationResult{}, fmt.Errorf("workflow definition is nil")
	}

	maxSteps := opts.MaxSteps
	if maxSteps <= 0 {
		maxSteps = DefaultMaxSimulationSteps
	}

	startTime := opts.StartTime
	if startTime.IsZero() {
		startTime = time.Now().UTC()
	} else {
		startTime = startTime.UTC()
	}

	// Build the ephemeral in-memory instance state. This never leaves the
	// function and is never persisted.
	st := &simState{
		variables:   o.resolveInitialVariables(def.Variables, varOverrides, triggerData),
		stepOutputs: make(map[string]interface{}),
		triggerData: cloneMap(triggerData),
		clock:       startTime,
	}

	result := SimulationResult{
		DefinitionID:      def.ID,
		DefinitionVersion: def.Version,
		Path:              []SimulationStep{},
		Evaluations:       []ConditionEvaluation{},
		SLATimeline:       []SLAEntry{},
		StartedAt:         startTime,
	}

	if len(def.Steps) == 0 {
		result.Status = SimStatusCompleted
		result.Message = "definition has no steps"
		o.finalize(&result, st)
		return result, nil
	}

	stepIndex := indexSteps(def.Steps)
	currentID := def.Steps[0].ID

	for order := 0; ; order++ {
		// Respect context cancellation (e.g. a request timeout on /simulate).
		if err := ctx.Err(); err != nil {
			result.Status = SimStatusError
			result.Message = fmt.Sprintf("context cancelled during simulation: %v", err)
			o.finalize(&result, st)
			return result, err
		}

		if order >= maxSteps {
			result.Status = SimStatusMaxStepsExceeded
			result.Message = fmt.Sprintf("max-steps guard tripped at %d steps (possible loop)", maxSteps)
			o.finalize(&result, st)
			return result, nil
		}

		step, ok := stepIndex[currentID]
		if !ok {
			result.Status = SimStatusError
			result.Message = fmt.Sprintf("step %q not found in definition", currentID)
			o.finalize(&result, st)
			return result, nil
		}

		// End step terminates traversal.
		if step.Type == model.StepTypeEnd {
			result.Path = append(result.Path, SimulationStep{
				StepID:   step.ID,
				StepType: step.Type,
				StepName: step.Name,
				Order:    order,
				Outcome:  MockEndReached,
				Output:   map[string]interface{}{},
			})
			result.Status = SimStatusCompleted
			o.finalize(&result, st)
			return result, nil
		}

		// Apply the mock outcome for this step type. This records the executed
		// path entry, mutates the in-memory step outputs, and (for parking /
		// timer steps) appends to the SLA timeline.
		simStep, err := o.applyMockOutcome(step, st, order, mockDecisions, opts, stepIndex, &result)
		if err != nil {
			result.Status = SimStatusError
			result.Message = err.Error()
			o.finalize(&result, st)
			return result, nil
		}
		result.Path = append(result.Path, simStep)

		// Store the synthetic output under steps.<id>.output, exactly like the
		// real engine's storeStepOutput.
		st.stepOutputs[step.ID] = map[string]interface{}{"output": simStep.Output}

		// Evaluate transitions for real. The next step is the first transition
		// whose guard is true (or the first unconditional transition).
		nextID, transErr := o.evaluateTransitions(step, st, &result)
		if transErr != nil {
			// Mirror the engine: a non-end step with no matching transition is a
			// stall, not a hard error. Record and stop.
			result.Status = SimStatusNoTransition
			result.Message = transErr.Error()
			o.finalize(&result, st)
			return result, nil
		}

		currentID = nextID
	}
}

// simState is the ephemeral in-memory instance state for a single dry run.
type simState struct {
	variables   map[string]interface{}
	stepOutputs map[string]interface{}
	triggerData map[string]interface{}
	// clock is the virtual wall clock used to project the SLA timeline. Timers
	// advance it; parking SLAs advance it only when AdvanceClockOnSLA is set.
	clock time.Time
}

// exprContext builds the data context the Evaluator/Resolver expect:
//
//	{"variables": {...}, "steps": {...}, "trigger": {"data": {...}}}
//
// It is the in-memory analogue of EngineService.buildExpressionContext /
// executor.buildDataContext, built without an instance struct.
func (st *simState) exprContext() map[string]interface{} {
	return map[string]interface{}{
		"variables": st.variables,
		"steps":     st.stepOutputs,
		"trigger":   map[string]interface{}{"data": st.triggerData},
	}
}

// applyMockOutcome synthesizes the side-effect-free outcome for one step and
// returns its path entry. It never performs a real side effect.
func (o *SimulationOrchestrator) applyMockOutcome(
	step *model.StepDefinition,
	st *simState,
	order int,
	mockDecisions map[string]MockDecision,
	opts SimulationOptions,
	stepIndex map[string]*model.StepDefinition,
	result *SimulationResult,
) (SimulationStep, error) {
	base := SimulationStep{
		StepID:   step.ID,
		StepType: step.Type,
		StepName: step.Name,
		Order:    order,
	}

	var (
		simStep SimulationStep
		err     error
	)
	switch step.Type {
	case model.StepTypeServiceTask:
		simStep, err = o.mockServiceTask(step, st, base)

	case model.StepTypeEventTask:
		simStep, err = o.mockEventTask(step, st, base)

	case model.StepTypeHumanTask, stepTypeApprovalChain:
		// human_task / approval_chain consume mockDecisions internally (merging
		// Output with reserved decision/approved precedence), so they are exempt
		// from the generic override below.
		return o.mockHumanLike(step, st, base, mockDecisions, opts, result)

	case model.StepTypeCondition:
		simStep, err = o.mockCondition(step, st, base, result)

	case model.StepTypeTimer:
		simStep, err = o.mockTimer(step, st, base, result)

	case model.StepTypeParallelGateway:
		return o.mockParallelGateway(step, st, base, mockDecisions, opts, stepIndex, result)

	default:
		return base, fmt.Errorf("step %q: unsupported step type %q for simulation", step.ID, step.Type)
	}
	if err != nil {
		return simStep, err
	}

	// Caller-supplied output overrides let a dry run satisfy guards that read a
	// NON-human step's output (e.g. a service task's `compliant == true`), which
	// the synthetic 200/empty response would otherwise never set — the classic
	// cause of a false "possible loop" when every gate falls through to a fallback.
	if dec, ok := mockDecisions[step.ID]; ok && len(dec.Output) > 0 {
		if simStep.Output == nil {
			simStep.Output = make(map[string]interface{}, len(dec.Output))
		}
		for k, v := range dec.Output {
			simStep.Output[k] = v
		}
	}
	return simStep, nil
}

// mockServiceTask synthesizes a 200/empty response WITHOUT any HTTP call. It
// resolves the URL/body for the record only so the dry run shows what would have
// been called; resolution failures are tolerated (the side effect is suppressed
// regardless).
func (o *SimulationOrchestrator) mockServiceTask(step *model.StepDefinition, st *simState, base SimulationStep) (SimulationStep, error) {
	method := configStringOr(step.Config, "method", "GET")
	urlPath := configStringOr(step.Config, "url", "")
	service := configStringOr(step.Config, "service", "")

	resolvedURL := urlPath
	if urlPath != "" {
		if v, err := o.resolver.Resolve(urlPath, st.exprContext()); err == nil {
			resolvedURL = fmt.Sprintf("%v", v)
		}
	}

	base.Outcome = MockSyntheticResponse
	base.Output = map[string]interface{}{
		"status_code": 200,
		"response":    map[string]interface{}{},
		"simulated":   true,
	}
	note := fmt.Sprintf("would %s %s", strings.ToUpper(method), resolvedURL)
	if service != "" {
		note = fmt.Sprintf("would call service %q: %s %s", service, strings.ToUpper(method), resolvedURL)
	}
	base.SideEffectNote = note
	return base, nil
}

// mockEventTask records the event it WOULD publish (PUBLISH mode) or wait on
// (WAIT mode) WITHOUT emitting or registering anything in Redis/Kafka. WAIT
// mode, which parks in a real run, is resolved instantly so traversal continues.
func (o *SimulationOrchestrator) mockEventTask(step *model.StepDefinition, st *simState, base SimulationStep) (SimulationStep, error) {
	mode := strings.ToUpper(configStringOr(step.Config, "mode", "PUBLISH"))

	switch mode {
	case "WAIT":
		topic := configStringOr(step.Config, "topic", "")
		corr := configStringOr(step.Config, "correlation_value", "")
		resolvedCorr := corr
		if corr != "" {
			if v, err := o.resolver.Resolve(corr, st.exprContext()); err == nil {
				resolvedCorr = fmt.Sprintf("%v", v)
			}
		}
		base.Outcome = MockWouldWait
		base.WouldHavePaused = true
		base.Output = map[string]interface{}{
			"waiting_for":        topic,
			"correlation_value":  resolvedCorr,
			"simulated":          true,
			"resolved_instantly": true,
		}
		base.SideEffectNote = fmt.Sprintf("would wait on topic %q for correlation %q (resolved instantly in simulation)", topic, resolvedCorr)
		return base, nil

	default: // PUBLISH
		topic := configStringOr(step.Config, "topic", "")
		eventType := configStringOr(step.Config, "event_type", "")
		base.Outcome = MockWouldPublish
		base.Output = map[string]interface{}{
			"topic":      topic,
			"event_type": eventType,
			"published":  false,
			"simulated":  true,
		}
		base.SideEffectNote = fmt.Sprintf("would publish event_type %q to topic %q", eventType, topic)
		return base, nil
	}
}

// mockHumanLike resolves a human_task or approval_chain step. It NEVER creates a
// task row. The decision comes from mockDecisions[stepID] if present, otherwise
// it auto-approves. The step's SLA deadline (and any escalation tiers) is
// projected onto the timeline.
func (o *SimulationOrchestrator) mockHumanLike(
	step *model.StepDefinition,
	st *simState,
	base SimulationStep,
	mockDecisions map[string]MockDecision,
	opts SimulationOptions,
	result *SimulationResult,
) (SimulationStep, error) {
	enteredAt := st.clock

	approved := true
	output := map[string]interface{}{}
	if dec, ok := mockDecisions[step.ID]; ok {
		approved = dec.Approved
		for k, v := range dec.Output {
			output[k] = v
		}
		base.Outcome = MockOutcomeDecision
	} else {
		base.Outcome = MockAutoApproved
	}

	// Reserved fields are authoritative.
	output["decision"] = decisionString(approved)
	output["approved"] = approved
	output["simulated"] = true
	base.Output = output
	base.WouldHavePaused = true
	base.SideEffectNote = fmt.Sprintf("would create human task(s); decision=%s (no task row created)", decisionString(approved))

	// Project the SLA timeline entry.
	slaHours := configFloatOr(step.Config, "sla_hours", 24.0)
	dueAt := enteredAt.Add(time.Duration(slaHours * float64(time.Hour)))
	entry := SLAEntry{
		StepID:          step.ID,
		StepType:        step.Type,
		Kind:            "sla_deadline",
		EnteredAt:       enteredAt,
		DueAt:           dueAt,
		DurationSeconds: dueAt.Sub(enteredAt).Seconds(),
		Escalations:     o.projectEscalations(step.Config, enteredAt),
	}
	result.SLATimeline = append(result.SLATimeline, entry)

	if opts.AdvanceClockOnSLA {
		st.clock = dueAt
	}

	return base, nil
}

// mockCondition evaluates the condition step's expression FOR REAL via the
// side-effect-free Evaluator and records the evaluation. The boolean result is
// stored as the step output, exactly like ConditionExecutor.
func (o *SimulationOrchestrator) mockCondition(step *model.StepDefinition, st *simState, base SimulationStep, result *SimulationResult) (SimulationStep, error) {
	expr := configStringOr(step.Config, "expression", "")
	if expr == "" {
		return base, fmt.Errorf("condition %q: missing required config key %q", step.ID, "expression")
	}

	res, err := o.evaluator.Evaluate(expr, st.exprContext())
	eval := ConditionEvaluation{
		StepID:     step.ID,
		Kind:       "condition_step",
		Expression: expr,
		Result:     res,
	}
	if err != nil {
		eval.Error = err.Error()
		result.Evaluations = append(result.Evaluations, eval)
		return base, fmt.Errorf("condition %q: evaluating expression %q: %w", step.ID, expr, err)
	}
	result.Evaluations = append(result.Evaluations, eval)

	base.Outcome = MockConditionEvaluated
	base.Output = map[string]interface{}{"result": res}
	return base, nil
}

// mockTimer resolves a timer INSTANTLY without touching Redis. The projected
// fire time is computed from duration / fire_at and recorded on the SLA
// timeline; the virtual clock advances to it so downstream SLAs project from the
// correct point.
func (o *SimulationOrchestrator) mockTimer(step *model.StepDefinition, st *simState, base SimulationStep, result *SimulationResult) (SimulationStep, error) {
	enteredAt := st.clock
	var fireAt time.Time

	if durRaw, ok := step.Config["duration"]; ok {
		durStr := fmt.Sprintf("%v", durRaw)
		if v, err := o.resolver.Resolve(durRaw, st.exprContext()); err == nil {
			durStr = fmt.Sprintf("%v", v)
		}
		dur, err := parseISO8601Duration(durStr)
		if err != nil {
			return base, fmt.Errorf("timer %q: parsing duration %q: %w", step.ID, durStr, err)
		}
		fireAt = enteredAt.Add(dur)
	} else if fireRaw, ok := step.Config["fire_at"]; ok {
		fireStr := fmt.Sprintf("%v", fireRaw)
		if v, err := o.resolver.Resolve(fireRaw, st.exprContext()); err == nil {
			fireStr = fmt.Sprintf("%v", v)
		}
		parsed, err := parseSimTime(fireStr)
		if err != nil {
			return base, fmt.Errorf("timer %q: parsing fire_at %q: %w", step.ID, fireStr, err)
		}
		fireAt = parsed
	} else {
		return base, fmt.Errorf("timer %q: config must specify either 'duration' or 'fire_at'", step.ID)
	}

	// Advance the virtual clock to the fire time (only forward).
	if fireAt.After(st.clock) {
		st.clock = fireAt
	}

	result.SLATimeline = append(result.SLATimeline, SLAEntry{
		StepID:          step.ID,
		StepType:        step.Type,
		Kind:            "timer_fire",
		EnteredAt:       enteredAt,
		DueAt:           fireAt,
		DurationSeconds: fireAt.Sub(enteredAt).Seconds(),
	})

	base.Outcome = MockTimerInstant
	base.Output = map[string]interface{}{
		"fire_at":   fireAt.UTC().Format(time.RFC3339),
		"simulated": true,
	}
	base.SideEffectNote = fmt.Sprintf("would schedule timer to fire at %s (resolved instantly)", fireAt.UTC().Format(time.RFC3339))
	return base, nil
}

// mockParallelGateway traverses each branch's step IDs in-memory with mock
// sub-step outcomes and merges the branch outputs, mirroring the real
// ParallelGatewayExecutor's output shape WITHOUT any concurrency, HTTP, or
// task rows. Sub-step outputs are also written into the shared step-output map
// so later guards can reference them, matching real execution where each
// sub-step stores its output on the instance.
func (o *SimulationOrchestrator) mockParallelGateway(
	step *model.StepDefinition,
	st *simState,
	base SimulationStep,
	mockDecisions map[string]MockDecision,
	opts SimulationOptions,
	stepIndex map[string]*model.StepDefinition,
	result *SimulationResult,
) (SimulationStep, error) {
	branches, err := parseBranchStepIDs(step.Config)
	if err != nil {
		return base, fmt.Errorf("parallel_gateway %q: %w", step.ID, err)
	}

	branchOutputs := make(map[string]interface{})
	for bi, branch := range branches {
		for _, subID := range branch {
			subStep, ok := stepIndex[subID]
			if !ok {
				return base, fmt.Errorf("parallel_gateway %q: branch %d references unknown step %q", step.ID, bi, subID)
			}
			// Recurse via the same mock dispatcher. order is reported as -1 for
			// sub-steps (they are not top-level path entries); we do not append
			// them to result.Path to keep the path linear, but their outputs are
			// stored so guards can read them.
			subSim, subErr := o.applyMockOutcome(subStep, st, -1, mockDecisions, opts, stepIndex, result)
			if subErr != nil {
				return base, fmt.Errorf("parallel_gateway %q: branch %d step %q: %w", step.ID, bi, subID, subErr)
			}
			st.stepOutputs[subID] = map[string]interface{}{"output": subSim.Output}
		}
		branchOutputs[fmt.Sprintf("branch_%d", bi)] = branch
	}

	base.Outcome = MockParallelMerged
	base.Output = map[string]interface{}{
		"branch_outputs":     branchOutputs,
		"branches_total":     len(branches),
		"branches_completed": len(branches),
		"simulated":          true,
	}
	base.SideEffectNote = fmt.Sprintf("would fork %d branch(es); sub-steps mocked", len(branches))
	return base, nil
}

// projectEscalations reads an optional tiered escalation policy from the step
// config and projects each tier's fire time relative to enteredAt. The policy
// shape mirrors §3.4: config["escalation"] is an array of
// {after: <ISO8601 duration | seconds>, notify: <string>, action: <string>}.
func (o *SimulationOrchestrator) projectEscalations(config map[string]interface{}, enteredAt time.Time) []SLAEscalation {
	raw, ok := config["escalation"]
	if !ok {
		return nil
	}
	tiers, ok := raw.([]interface{})
	if !ok {
		return nil
	}

	var out []SLAEscalation
	for _, t := range tiers {
		tier, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		var after time.Duration
		switch av := tier["after"].(type) {
		case string:
			if d, err := parseISO8601Duration(av); err == nil {
				after = d
			}
		case float64:
			after = time.Duration(av * float64(time.Second))
		case int:
			after = time.Duration(av) * time.Second
		}
		esc := SLAEscalation{
			AfterSeconds: after.Seconds(),
			FireAt:       enteredAt.Add(after),
		}
		if n, ok := tier["notify"].(string); ok {
			esc.Notify = n
		}
		if a, ok := tier["action"].(string); ok {
			esc.Action = a
		}
		out = append(out, esc)
	}
	return out
}

// evaluateTransitions finds the next step by evaluating each transition's guard
// for real, recording every evaluation. It mirrors EngineService.evaluateTransitions:
// an empty condition is an unconditional match; a guard that errors is skipped;
// the first true guard wins; no match is an error (a stall).
func (o *SimulationOrchestrator) evaluateTransitions(step *model.StepDefinition, st *simState, result *SimulationResult) (string, error) {
	if len(step.Transitions) == 0 {
		return "", fmt.Errorf("no transitions from step %q", step.ID)
	}

	exprCtx := st.exprContext()
	for _, t := range step.Transitions {
		if t.Condition == "" {
			// Unconditional transition: record as an always-true evaluation for
			// traceability and take it.
			result.Evaluations = append(result.Evaluations, ConditionEvaluation{
				StepID:     step.ID,
				Kind:       "transition",
				Expression: "",
				Target:     t.Target,
				Result:     true,
			})
			return t.Target, nil
		}

		res, err := o.evaluator.Evaluate(t.Condition, exprCtx)
		eval := ConditionEvaluation{
			StepID:     step.ID,
			Kind:       "transition",
			Expression: t.Condition,
			Target:     t.Target,
			Result:     res,
		}
		if err != nil {
			// Mirror the engine: a guard that fails to evaluate is skipped.
			eval.Result = false
			eval.Error = err.Error()
			result.Evaluations = append(result.Evaluations, eval)
			continue
		}
		result.Evaluations = append(result.Evaluations, eval)
		if res {
			return t.Target, nil
		}
	}

	return "", fmt.Errorf("no matching transition from step %q", step.ID)
}

// resolveInitialVariables replicates EngineService.resolveInitialVariables in
// memory: defaults, then trigger Source overrides, then explicit overrides, then
// undeclared overrides. triggerData here is already a decoded map.
func (o *SimulationOrchestrator) resolveInitialVariables(
	defs map[string]model.VariableDef,
	overrides map[string]interface{},
	triggerData map[string]interface{},
) map[string]interface{} {
	result := make(map[string]interface{})

	for name, def := range defs {
		if def.Default != nil {
			result[name] = def.Default
		}
		if def.Source != "" && triggerData != nil {
			if val, ok := triggerData[def.Source]; ok {
				result[name] = val
			}
		}
		if overrides != nil {
			if val, ok := overrides[name]; ok {
				result[name] = val
			}
		}
	}

	// Undeclared overrides pass through, matching the engine.
	for name, val := range overrides {
		if _, exists := result[name]; !exists {
			result[name] = val
		}
	}

	return result
}

// finalize copies the ephemeral state into the result and sorts the SLA
// timeline. It is the single exit-bookkeeping point so every return path
// produces a consistent result.
func (o *SimulationOrchestrator) finalize(result *SimulationResult, st *simState) {
	result.FinalVariables = st.variables
	result.StepOutputs = st.stepOutputs
	result.StepsExecuted = len(result.Path)
	result.ProjectedEndAt = st.clock
	sort.SliceStable(result.SLATimeline, func(i, j int) bool {
		return result.SLATimeline[i].DueAt.Before(result.SLATimeline[j].DueAt)
	})
}

// ---------- helpers (self-contained; no executor-package coupling) ----------

// indexSteps builds a step-ID -> *StepDefinition index over the definition's
// steps (which is a value slice; we take stable pointers into it).
func indexSteps(steps []model.StepDefinition) map[string]*model.StepDefinition {
	idx := make(map[string]*model.StepDefinition, len(steps))
	for i := range steps {
		idx[steps[i].ID] = &steps[i]
	}
	return idx
}

// cloneMap returns a shallow copy of m, or an empty map if m is nil. Used so the
// simulation never aliases the caller's trigger payload.
func cloneMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// decisionString maps an approval boolean to a stable string.
func decisionString(approved bool) string {
	if approved {
		return "approved"
	}
	return "rejected"
}

// configStringOr returns the string value at key, or def if absent / not a
// string.
func configStringOr(config map[string]interface{}, key, def string) string {
	if config == nil {
		return def
	}
	v, ok := config[key]
	if !ok {
		return def
	}
	s, ok := v.(string)
	if !ok {
		return def
	}
	return s
}

// configFloatOr returns the numeric value at key as float64, or def if absent /
// non-positive / not numeric.
func configFloatOr(config map[string]interface{}, key string, def float64) float64 {
	if config == nil {
		return def
	}
	v, ok := config[key]
	if !ok {
		return def
	}
	switch n := v.(type) {
	case float64:
		if n > 0 {
			return n
		}
	case int:
		if n > 0 {
			return float64(n)
		}
	case int64:
		if n > 0 {
			return float64(n)
		}
	case json.Number:
		if f, err := n.Float64(); err == nil && f > 0 {
			return f
		}
	}
	return def
}

// parseBranchStepIDs extracts the parallel_gateway "branches" config: an array
// of arrays of step-ID strings. Mirrors ParallelGatewayExecutor.parseBranches.
func parseBranchStepIDs(config map[string]interface{}) ([][]string, error) {
	raw, ok := config["branches"]
	if !ok {
		return nil, fmt.Errorf("missing required config key %q", "branches")
	}
	slice, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("config key %q must be an array of arrays", "branches")
	}
	branches := make([][]string, 0, len(slice))
	for i, branchRaw := range slice {
		branchSlice, ok := branchRaw.([]interface{})
		if !ok {
			return nil, fmt.Errorf("branches[%d] must be an array of step IDs", i)
		}
		ids := make([]string, 0, len(branchSlice))
		for j, idRaw := range branchSlice {
			id, ok := idRaw.(string)
			if !ok {
				return nil, fmt.Errorf("branches[%d][%d] must be a string step ID", i, j)
			}
			ids = append(ids, id)
		}
		branches = append(branches, ids)
	}
	return branches, nil
}

// ---------- ISO 8601 duration + time parsing (self-contained) ----------
//
// These mirror the timer executor's parsers but live here so the simulation
// package has no dependency on the executor package (disjoint ownership: the
// executor files are owned by other phases and must not be imported for this).

// parseISO8601Duration parses an ISO 8601 duration of the form P[nD]T[nH][nM][nS]
// into a time.Duration. Examples: PT4H, PT30M, PT1H30M, PT90S, P1DT2H.
func parseISO8601Duration(s string) (time.Duration, error) {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return 0, fmt.Errorf("empty duration string")
	}
	if !strings.HasPrefix(s, "P") {
		return 0, fmt.Errorf("invalid ISO 8601 duration %q: must start with 'P'", s)
	}

	rest := s[1:]
	datePart := rest
	timePart := ""
	if idx := strings.Index(rest, "T"); idx >= 0 {
		datePart = rest[:idx]
		timePart = rest[idx+1:]
	}

	var dur time.Duration

	// Date part supports only days (D) for our workflow use.
	if datePart != "" {
		days, unit, err := splitNumUnit(datePart)
		if err != nil || unit != "D" {
			return 0, fmt.Errorf("invalid date component in duration %q", s)
		}
		dur += time.Duration(days) * 24 * time.Hour
	}

	// Time part: any of H, M, S in order.
	for timePart != "" {
		n, unit, err := splitNumUnit(timePart)
		if err != nil {
			return 0, fmt.Errorf("invalid time component in duration %q: %w", s, err)
		}
		switch unit {
		case "H":
			dur += time.Duration(n) * time.Hour
		case "M":
			dur += time.Duration(n) * time.Minute
		case "S":
			dur += time.Duration(n) * time.Second
		default:
			return 0, fmt.Errorf("unsupported time unit %q in duration %q", unit, s)
		}
		// Advance past the consumed "<digits><unit>".
		consumed := len(fmt.Sprintf("%d", n)) + 1
		timePart = timePart[consumed:]
	}

	if dur == 0 {
		return 0, fmt.Errorf("duration is zero: %q", s)
	}
	return dur, nil
}

// splitNumUnit reads a leading run of digits followed by a single unit letter
// from s, returning the integer value and the unit. It does not consume beyond
// the first unit letter.
func splitNumUnit(s string) (int, string, error) {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 {
		return 0, "", fmt.Errorf("expected a number in %q", s)
	}
	if i >= len(s) {
		return 0, "", fmt.Errorf("expected a unit after number in %q", s)
	}
	n := 0
	for _, c := range s[:i] {
		n = n*10 + int(c-'0')
	}
	return n, string(s[i]), nil
}

// parseSimTime parses an absolute time in the same formats the timer executor
// accepts, returning UTC.
func parseSimTime(s string) (time.Time, error) {
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse time %q", s)
}
