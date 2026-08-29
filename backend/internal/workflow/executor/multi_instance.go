package executor

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// MultiInstanceExecutor implements the BPMN multi-instance (for-each) step. It
// resolves a COLLECTION via the VariableResolver (${...}) and fans out one inner
// activity per element under a completion policy (all / any / n_of_m), reusing
// the parallel-gateway policy semantics.
//
// It supports two inner-activity shapes:
//
//	ASYNC (default when child_definition_key is set): each element spawns a CHILD
//	call-activity instance (parent link recorded, fan-in ledger seeded), and the
//	step PARKS. The engine's completion-counter fan-in (each child completion
//	marks its ledger slot and re-checks the policy) resumes the parent EXACTLY
//	ONCE when the policy is satisfied, optionally early-cancelling the rest — no
//	goroutine is blocked waiting on async children.
//
//	SYNC (when inner_step names a step id AND no child_definition_key): each
//	element executes that inner step through the registry, in parallel via an
//	errgroup join (early-cancel on the policy), aggregating outputs. No park —
//	purely synchronous inner work reuses the parallel_gateway join directly.
//
// Reversible / additive: no existing definition references multi_instance.
type MultiInstanceExecutor struct {
	starter    ChildStarter
	registry   *ExecutorRegistry
	stepLookup StepLookup
	resolver   *expression.VariableResolver
	logger     zerolog.Logger
}

// NewMultiInstanceExecutor creates a MultiInstanceExecutor. starter powers the
// async child fan-out (and owns fan-in-ledger seeding via its ordered
// StartMultiInstanceChild / SeedMultiInstanceSlot seams); registry+stepLookup
// power the sync inner-step fan-out. Either may be nil when that mode is not
// wired — the executor fails a step that requires an unwired mode with a clear
// configuration error.
func NewMultiInstanceExecutor(starter ChildStarter, registry *ExecutorRegistry, stepLookup StepLookup, logger zerolog.Logger) *MultiInstanceExecutor {
	return &MultiInstanceExecutor{
		starter:    starter,
		registry:   registry,
		stepLookup: stepLookup,
		resolver:   expression.NewVariableResolver(),
		logger:     logger.With().Str("executor", "multi_instance").Logger(),
	}
}

// Config keys for a multi_instance step.
const (
	// configMICollection is the ${...} reference (or literal slice) whose elements
	// are fanned over.
	configMICollection = "collection"
	// configMIChildDefinitionKey (async mode) is the child definition each element
	// is passed to as a call-activity.
	configMIChildDefinitionKey = "child_definition_key"
	// configMIInnerStep (sync mode) is a step id in the SAME definition executed
	// once per element.
	configMIInnerStep = "inner_step"
	// configMIElementVar names the per-element input variable given to the child /
	// exposed to the inner step (default "item").
	configMIElementVar = "element_var"
	// configMIInputMapping (async mode) maps additional child input variables from
	// the parent context, exactly like call_activity's input_mapping.
	configMIInputMapping = "input_mapping"
	// configMICompletionPolicy is "all" (default) / "any" / N (n_of_m).
	configMICompletionPolicy = "completion_policy"
	// configMISequential runs children one-at-a-time when true (async mode still
	// seeds all slots but starts them serially); default false = parallel.
	configMISequential = "sequential"
)

// Execute resolves the collection and fans out the inner activity.
func (e *MultiInstanceExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	dataCtx := buildDataContext(instance)

	collection, err := e.resolveCollection(step.Config, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("multi_instance %s: %w", step.ID, err)
	}

	// An EMPTY collection is a valid vacuous fan-out: nothing to do, complete
	// immediately with an empty result (mirrors BPMN "none behaves like all met").
	if len(collection) == 0 {
		return &ExecutionResult{
			Output: map[string]interface{}{
				"multi_instance":     true,
				"collection_size":    0,
				"results":            []interface{}{},
				"completion_policy":  ResolveMICompletionPolicy(step.Config, 0),
				"completed_children": 0,
			},
		}, nil
	}

	childDefKey := strings.TrimSpace(configStringOptional(step.Config, configMIChildDefinitionKey))
	innerStep := strings.TrimSpace(configStringOptional(step.Config, configMIInnerStep))

	if childDefKey != "" {
		return e.fanOutAsync(ctx, instance, step, collection, childDefKey, dataCtx)
	}
	if innerStep != "" {
		return e.fanOutSync(ctx, instance, step, collection, innerStep, dataCtx)
	}
	return nil, fmt.Errorf("multi_instance %s: config must set either %q (async child) or %q (sync inner step)", step.ID, configMIChildDefinitionKey, configMIInnerStep)
}

// fanOutAsync seeds the fan-in ledger and starts one CHILD call-activity per
// element, then PARKS. The engine's fan-in resumes the parent when the policy is
// met. When sequential=true only the first child is started here; subsequent
// children are started by the engine as prior children complete (the ledger
// records the not-yet-started slots as 'running' placeholders with a nil child
// instance id until they start). For simplicity and safety, the default
// (parallel) path starts every child up-front; the sequential path starts them
// one at a time, which the engine drives on each completion.
func (e *MultiInstanceExecutor) fanOutAsync(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, collection []interface{}, childDefKey string, dataCtx map[string]interface{}) (*ExecutionResult, error) {
	if e.starter == nil {
		return nil, fmt.Errorf("multi_instance %s: async child fan-out requires a child starter", step.ID)
	}

	elementVar := configStringOptional(step.Config, configMIElementVar)
	if elementVar == "" {
		elementVar = "item"
	}
	sequential := configBoolOptional(step.Config, configMISequential)

	startedBy := ""
	if instance.StartedBy != nil {
		startedBy = *instance.StartedBy
	}

	// Base input mapping (resolved once against the parent context); the per-
	// element variable is layered on top for each child.
	baseInputs, err := e.resolveInputMapping(step.Config, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("multi_instance %s: %w", step.ID, err)
	}

	started := 0
	for idx, element := range collection {
		if sequential && idx > 0 {
			// Sequential: seed the slot as a NOT-YET-STARTED placeholder; the engine
			// starts it as prior children complete.
			if serr := e.starter.SeedMultiInstanceSlot(ctx, instance.TenantID, instance.ID, step.ID, idx); serr != nil {
				return nil, fmt.Errorf("multi_instance %s: seeding sequential slot %d: %w", step.ID, idx, serr)
			}
			continue
		}

		childInputs := mergeInputs(baseInputs, elementVar, element, idx, len(collection))
		// StartMultiInstanceChild performs create -> seed slot (with the child id)
		// -> advance IN THAT ORDER, so the fan-in slot exists before the child can
		// complete (no race between a fast child's completion hook and slot seeding).
		if _, serr := e.starter.StartMultiInstanceChild(ctx, instance.TenantID, startedBy, instance.ID, step.ID, childDefKey, idx, childInputs); serr != nil {
			return nil, fmt.Errorf("multi_instance %s: starting child %d (%q): %w", step.ID, idx, childDefKey, serr)
		}
		started++
	}

	e.logger.Info().
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Str("child_definition_key", childDefKey).
		Int("collection_size", len(collection)).
		Int("started", started).
		Bool("sequential", sequential).
		Msg("multi_instance fanned out child call-activities, parking parent")

	return &ExecutionResult{
		Output: map[string]interface{}{
			"multi_instance":    true,
			"collection_size":   len(collection),
			"child_definition":  childDefKey,
			"completion_policy": ResolveMICompletionPolicy(step.Config, len(collection)),
			"sequential":        sequential,
			"started":           started,
		},
		Parked: true,
	}, nil
}

// fanOutSync executes an inner step once per element, in parallel via an
// errgroup (reusing the parallel_gateway join + early-cancel), aggregating each
// element's output into a result collection. No park — this is purely
// synchronous inner work. The inner step MUST NOT itself park; a parking inner
// step is rejected (the same constraint parallel_gateway branches carry).
func (e *MultiInstanceExecutor) fanOutSync(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, collection []interface{}, innerStepID string, dataCtx map[string]interface{}) (*ExecutionResult, error) {
	if e.registry == nil || e.stepLookup == nil {
		return nil, fmt.Errorf("multi_instance %s: sync inner-step fan-out requires a registry and step lookup", step.ID)
	}
	innerDef, ok := e.stepLookup(innerStepID)
	if !ok {
		return nil, fmt.Errorf("multi_instance %s: inner step %q not found in definition", step.ID, innerStepID)
	}

	elementVar := configStringOptional(step.Config, configMIElementVar)
	if elementVar == "" {
		elementVar = "item"
	}

	policy, requiredN := parseMIPolicy(step.Config, len(collection))

	timeout := 5 * time.Minute
	if v, ok := step.Config["timeout_seconds"]; ok {
		if seconds := toFloat(v); seconds > 0 {
			timeout = time.Duration(seconds * float64(time.Second))
		}
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var (
		resultsMu sync.Mutex
		results   = make([]interface{}, len(collection))
		completed int64
	)

	g, gCtx := errgroup.WithContext(execCtx)
	for i, element := range collection {
		idx := i
		el := element
		g.Go(func() error {
			select {
			case <-gCtx.Done():
				return gCtx.Err()
			default:
			}

			// Per-element instance snapshot: the inner step sees the parent's
			// variables PLUS the per-element variable, without mutating the shared
			// instance (each goroutine gets its own copy of the variables map).
			perElem := miPerElementInstance(instance, elementVar, el, idx, len(collection))

			subExec := &model.StepExecution{
				ID:         events.GenerateUUID(),
				InstanceID: instance.ID,
				StepID:     innerStepID,
				StepType:   innerDef.Type,
				Status:     model.StepStatusRunning,
				Attempt:    1,
				CreatedAt:  time.Now().UTC(),
			}

			res, rerr := e.registry.Execute(gCtx, perElem, innerDef, subExec)
			if rerr != nil {
				return fmt.Errorf("element %d: %w", idx, rerr)
			}
			if res != nil && res.Parked {
				return fmt.Errorf("element %d: inner step %q parked; multi_instance sync inner steps cannot park (use child_definition_key for async work)", idx, innerStepID)
			}

			resultsMu.Lock()
			if res != nil {
				results[idx] = res.Output
			}
			resultsMu.Unlock()

			count := atomic.AddInt64(&completed, 1)
			if policy == "any" && count >= 1 {
				cancel()
			} else if policy == "n_of_m" && int(count) >= requiredN {
				cancel()
			}
			return nil
		})
	}

	groupErr := g.Wait()
	finalCompleted := int(atomic.LoadInt64(&completed))

	switch policy {
	case "all":
		if groupErr != nil && finalCompleted < len(collection) {
			return nil, fmt.Errorf("multi_instance %s: %d/%d elements failed: %w", step.ID, len(collection)-finalCompleted, len(collection), groupErr)
		}
	case "any":
		if finalCompleted < 1 {
			return nil, fmt.Errorf("multi_instance %s: no elements completed: %w", step.ID, groupErr)
		}
	case "n_of_m":
		if finalCompleted < requiredN {
			return nil, fmt.Errorf("multi_instance %s: only %d/%d required elements completed: %w", step.ID, finalCompleted, requiredN, groupErr)
		}
	}

	// Compact the results to the elements that actually produced output (early-
	// cancelled/failed elements leave nil holes under any / n_of_m).
	compact := make([]interface{}, 0, len(results))
	for _, r := range results {
		if r != nil {
			compact = append(compact, r)
		}
	}

	e.logger.Info().
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Str("inner_step", innerStepID).
		Int("collection_size", len(collection)).
		Int("completed", finalCompleted).
		Str("policy", policy).
		Msg("multi_instance sync inner-step fan-out completed")

	return &ExecutionResult{
		Output: map[string]interface{}{
			"multi_instance":     true,
			"collection_size":    len(collection),
			"completed_children": finalCompleted,
			"completion_policy":  policy,
			"results":            compact,
		},
	}, nil
}

// resolveCollection resolves the collection config into a slice. It accepts a
// ${...} reference resolving to a slice, or a literal slice.
func (e *MultiInstanceExecutor) resolveCollection(config map[string]interface{}, dataCtx map[string]interface{}) ([]interface{}, error) {
	raw, ok := config[configMICollection]
	if !ok || raw == nil {
		return nil, fmt.Errorf("missing required config key %q", configMICollection)
	}

	resolved, err := e.resolver.Resolve(raw, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("resolving collection: %w", err)
	}
	switch v := resolved.(type) {
	case []interface{}:
		return v, nil
	case nil:
		return nil, nil
	default:
		return nil, fmt.Errorf("collection must resolve to an array, got %T", resolved)
	}
}

// resolveInputMapping mirrors call_activity's input_mapping resolution for the
// async child fan-out.
func (e *MultiInstanceExecutor) resolveInputMapping(config map[string]interface{}, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	raw, ok := config[configMIInputMapping]
	if !ok || raw == nil {
		return nil, nil
	}
	mapping, ok := raw.(map[string]interface{})
	if !ok || len(mapping) == 0 {
		return nil, nil
	}
	out := make(map[string]interface{}, len(mapping))
	for childVar, spec := range mapping {
		val, err := e.resolver.Resolve(spec, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("resolving input_mapping[%q]: %w", childVar, err)
		}
		out[childVar] = val
	}
	return out, nil
}

// mergeInputs returns a fresh input-variable map combining the base inputs with
// the per-element variable and loop bookkeeping (loop_index, loop_total).
func mergeInputs(base map[string]interface{}, elementVar string, element interface{}, idx, total int) map[string]interface{} {
	out := make(map[string]interface{}, len(base)+3)
	for k, v := range base {
		out[k] = v
	}
	out[elementVar] = element
	out["loop_index"] = idx
	out["loop_total"] = total
	return out
}

// miPerElementInstance returns a shallow copy of the instance with a per-element
// variables map so the sync inner step sees the parent variables plus the loop
// element, without mutating the shared instance across goroutines.
func miPerElementInstance(instance *model.WorkflowInstance, elementVar string, element interface{}, idx, total int) *model.WorkflowInstance {
	cp := *instance
	vars := make(map[string]interface{}, len(instance.Variables)+3)
	for k, v := range instance.Variables {
		vars[k] = v
	}
	vars[elementVar] = element
	vars["loop_index"] = idx
	vars["loop_total"] = total
	cp.Variables = vars
	return &cp
}

// parseMIPolicy resolves the completion policy for the sync fan-out (matches the
// parallel-gateway parsing).
func parseMIPolicy(config map[string]interface{}, total int) (string, int) {
	raw, ok := config[configMICompletionPolicy]
	if !ok {
		return "all", total
	}
	switch v := raw.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "any":
			return "any", 1
		case "all":
			return "all", total
		default:
			n := toInt(v)
			if n > 0 && n <= total {
				return "n_of_m", n
			}
			return "all", total
		}
	default:
		n := toInt(v)
		if n > 0 && n <= total {
			return "n_of_m", n
		}
		return "all", total
	}
}

// ResolveMICompletionPolicy returns a display string for the policy the async
// fan-out records on its output ("all" / "any" / "N"). The engine reads the same
// config to decide when the fan-in is satisfied, so both agree.
func ResolveMICompletionPolicy(config map[string]interface{}, total int) string {
	policy, n := parseMIPolicy(config, total)
	if policy == "n_of_m" {
		return fmt.Sprintf("%d", n)
	}
	return policy
}

// MICompletionSatisfied reports whether an async multi_instance step's completion
// policy is met given the counts of completed and failed children out of a total.
// It is the ENGINE-side fan-in decision (the engine owns the ledger), exposed
// here so the policy parsing is not duplicated:
//
//	all:    every child must complete (any failure => the step fails per policy)
//	any:    at least one child completes
//	n_of_m: at least N children complete
//
// It returns (satisfied, failedPolicy): satisfied means resume the parent step;
// failedPolicy means the step can no longer meet its policy (e.g. under "all" a
// child failed, or too many failed under n_of_m to ever reach N) and the engine
// should fail/incident the parent step.
func MICompletionSatisfied(config map[string]interface{}, total, completed, failed int) (satisfied bool, failedPolicy bool) {
	policy, requiredN := parseMIPolicy(config, total)
	remaining := total - completed - failed
	switch policy {
	case "any":
		if completed >= 1 {
			return true, false
		}
		if remaining == 0 {
			return false, true
		}
		return false, false
	case "n_of_m":
		if completed >= requiredN {
			return true, false
		}
		if completed+remaining < requiredN {
			return false, true
		}
		return false, false
	default: // all
		if failed > 0 {
			return false, true
		}
		if completed >= total {
			return true, false
		}
		return false, false
	}
}
