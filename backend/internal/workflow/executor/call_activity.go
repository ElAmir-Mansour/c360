package executor

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// ChildStarter is the narrow seam a composition step (call_activity /
// multi_instance) uses to start a CHILD workflow instance from another
// definition, recording the parent->child link so the engine can resume the
// parent when the child terminates. It is implemented by service.EngineService
// (StartChildInstance) and wired via SetChildStarter, so the executor package
// takes NO dependency on the service package — mirroring the FormLoader /
// SubstitutionResolver seams and avoiding the import cycle (service imports
// executor, never the reverse).
type ChildStarter interface {
	// StartChildInstance resolves the ACTIVE child definition for definitionKey
	// in the parent's tenant, seeds it with inputVars, records the parent link
	// (parentInstanceID + parentStepID) on the child, starts it, and returns the
	// new child instance id. A resolution / start failure is returned as an error
	// (the caller raises it on the parent step) — the child is NEVER started
	// half-linked.
	StartChildInstance(ctx context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, inputVars map[string]interface{}) (string, error)

	// StartMultiInstanceChild is the fan-out variant used by multi_instance. It
	// performs the create -> SEED THE FAN-IN LEDGER SLOT (with the child id) ->
	// advance sequence in that order, so a fast child that completes synchronously
	// during advance finds its ledger slot already present (closing the race where
	// the completion hook fires before the slot exists). childIndex is the child's
	// 0-based position in the resolved collection. Returns the new child id.
	StartMultiInstanceChild(ctx context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, childIndex int, inputVars map[string]interface{}) (string, error)

	// SeedMultiInstanceSlot records a NOT-YET-STARTED fan-in slot (child instance
	// id nil) for the sequential path, so ListChildren knows the full cardinality
	// up-front and the engine can start the next slot as prior children complete.
	SeedMultiInstanceSlot(ctx context.Context, tenantID, parentInstanceID, parentStepID string, childIndex int) error
}

// CallActivityExecutor implements the BPMN call-activity / sub-process step. It
// resolves a CHILD definition by definition_key, maps a subset of the parent's
// data into the child's input variables, starts the child (recording a
// parent->child link), and PARKS the parent. When the child COMPLETES the engine
// maps the child's outputs back onto the parent step's output and resumes; when
// the child FAILS the engine propagates per the parent step's configured policy.
//
// Reversible / additive: no existing definition references call_activity, so
// registering this executor changes nothing for existing workflows.
type CallActivityExecutor struct {
	starter  ChildStarter
	resolver *expression.VariableResolver
	logger   zerolog.Logger
}

// NewCallActivityExecutor creates a CallActivityExecutor. The child starter is
// REQUIRED for the executor to do useful work; when nil the executor fails the
// step with a clear configuration error (so a misconfigured wiring is loud, not
// silent).
func NewCallActivityExecutor(starter ChildStarter, logger zerolog.Logger) *CallActivityExecutor {
	return &CallActivityExecutor{
		starter:  starter,
		resolver: expression.NewVariableResolver(),
		logger:   logger.With().Str("executor", "call_activity").Logger(),
	}
}

// Config keys for a call_activity step.
const (
	// configCallDefinitionKey names the CHILD definition's stable lineage key.
	configCallDefinitionKey = "definition_key"
	// configCallInputMapping maps parent expressions to child input variables:
	// { "<child_var>": "${variables.x}" | literal, ... }.
	configCallInputMapping = "input_mapping"
	// configCallOnChildFailure selects how a child failure/incident affects the
	// parent step: "fail" (default — the parent step fails, entering the parent's
	// own retry/incident path) or "propagate" (alias of fail).
	configCallOnChildFailure = "on_child_failure"
)

// Execute resolves the child definition, maps inputs, starts the child, and
// parks the parent.
//
// Expected step.Config keys:
//   - definition_key (string, required): the child definition's lineage key.
//   - input_mapping (map, optional): { child_var: parent-expr-or-literal, ... }.
//   - on_child_failure (string, optional): "fail" (default).
func (e *CallActivityExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	if e.starter == nil {
		return nil, fmt.Errorf("call_activity %s: no child starter wired", step.ID)
	}

	definitionKey := strings.TrimSpace(configStringOptional(step.Config, configCallDefinitionKey))
	if definitionKey == "" {
		return nil, fmt.Errorf("call_activity %s: missing required config key %q", step.ID, configCallDefinitionKey)
	}

	dataCtx := buildDataContext(instance)
	inputVars, err := e.resolveInputMapping(step.Config, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("call_activity %s: %w", step.ID, err)
	}

	startedBy := ""
	if instance.StartedBy != nil {
		startedBy = *instance.StartedBy
	}

	childID, err := e.starter.StartChildInstance(ctx, instance.TenantID, startedBy, instance.ID, step.ID, definitionKey, inputVars)
	if err != nil {
		return nil, fmt.Errorf("call_activity %s: starting child %q: %w", step.ID, definitionKey, err)
	}

	e.logger.Info().
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Str("child_definition_key", definitionKey).
		Str("child_instance_id", childID).
		Msg("child instance started, parking parent (call-activity)")

	// PARK the parent: the child now owns forward progress. The engine resumes
	// this step (mapping the child's outputs back) when the child completes, or
	// raises this step to failed/incident when the child fails.
	return &ExecutionResult{
		Output: map[string]interface{}{
			"child_instance_id":    childID,
			"child_definition_key": definitionKey,
		},
		Parked: true,
	}, nil
}

// resolveInputMapping resolves each mapped input value against the parent data
// context. A missing / non-map input_mapping yields nil (the child starts with
// only its own defaults). Each value may be a literal or a ${...} reference.
func (e *CallActivityExecutor) resolveInputMapping(config map[string]interface{}, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	raw, ok := config[configCallInputMapping]
	if !ok || raw == nil {
		return nil, nil
	}
	mapping, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("config key %q must be an object", configCallInputMapping)
	}
	if len(mapping) == 0 {
		return nil, nil
	}

	out := make(map[string]interface{}, len(mapping))
	for childVar, spec := range mapping {
		resolved, err := e.resolver.Resolve(spec, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("resolving input_mapping[%q]: %w", childVar, err)
		}
		out[childVar] = resolved
	}
	return out, nil
}

// CallOutputMapping is the OUTPUT side of the parent<->child variable contract.
// It is resolved by the ENGINE (not the executor) when the child completes,
// because the engine owns the child instance's terminal step_outputs/variables.
// It is exposed here so the engine and executor share the config-key vocabulary.
const configCallOutputMapping = "output_mapping"

// ResolveOnChildFailurePolicy reads the on_child_failure config, defaulting to
// "fail". Only "fail"/"propagate" are recognized; anything else defaults to
// fail (fail-closed — an unknown policy never silently swallows a child failure).
func ResolveOnChildFailurePolicy(config map[string]interface{}) string {
	switch strings.ToLower(strings.TrimSpace(configStringOptional(config, configCallOnChildFailure))) {
	case "", "fail", "propagate":
		return "fail"
	default:
		return "fail"
	}
}

// CallActivityOutputMapping returns the parent step's output_mapping config as a
// { parent_var: child-expr } map, or nil when absent/empty. The engine uses it
// to project the completed child's data (exposed under a "child" root) back onto
// the parent step's output and the parent's variables. Exposed as a package
// helper so the engine (which owns the child instance state) can resolve it
// without duplicating the config-shape parsing.
func CallActivityOutputMapping(config map[string]interface{}) map[string]interface{} {
	raw, ok := config[configCallOutputMapping]
	if !ok || raw == nil {
		return nil
	}
	mapping, ok := raw.(map[string]interface{})
	if !ok || len(mapping) == 0 {
		return nil
	}
	return mapping
}
