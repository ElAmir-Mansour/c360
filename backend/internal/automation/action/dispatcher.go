package action

import (
	"context"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
)

// Dispatcher is the single service.ActionExecutor the orchestrator (WP-11) is
// wired with. It routes a RunStep by its action Kind to the matching real
// executor (start_workflow / integration / notification / dr_runbook /
// http_call), records the target's response in the Output for the run's
// append-only execution log (§4.7), and maps a target-unavailable failure to the
// retry path the orchestrator already implements (it re-attempts a step whose
// error is non-terminal up to the run's MaxAttempts).
//
// The Dispatcher holds NO database handle: every executor reaches its target via
// HTTP or the bus (FR-XC-004), so the whole action surface is safe to invoke
// outside the orchestrator's advance transaction (the §4.6 integrate-phase
// contract).
type Dispatcher struct {
	executors map[string]service.ActionExecutor
	// skipOnUnavailable, when true, records a SKIPPED-shaped output and returns
	// nil for a target-unavailable failure instead of surfacing the retryable
	// error. Default false (retry per policy). This realises the §4.6
	// "ret/skip per policy" choice at the dispatch layer.
	skipOnUnavailable bool
}

// Ensure the Dispatcher satisfies the orchestrator's executor seam.
var _ service.ActionExecutor = (*Dispatcher)(nil)

// DispatcherConfig wires a Dispatcher from the five real executors. Any executor
// left nil makes its action Kind unsupported (Execute returns an invalid-config
// error if such a step is dispatched), which is useful for a service that only
// enables a subset of the action surface.
type DispatcherConfig struct {
	StartWorkflow service.ActionExecutor
	Integration   service.ActionExecutor
	Notification  service.ActionExecutor
	DRRunbook     service.ActionExecutor
	HTTPCall      service.ActionExecutor

	// SkipOnUnavailable selects the target-unavailable policy: when true, a
	// transient/availability failure is recorded as a skipped step and swallowed
	// (the run proceeds); when false (default), it is surfaced as a retryable
	// error so the orchestrator re-attempts up to MaxAttempts.
	SkipOnUnavailable bool
}

// NewDispatcher builds a Dispatcher. At least one executor must be supplied.
func NewDispatcher(cfg DispatcherConfig) (*Dispatcher, error) {
	executors := map[string]service.ActionExecutor{}
	if cfg.StartWorkflow != nil {
		executors[model.ActionStartWorkflow] = cfg.StartWorkflow
	}
	if cfg.Integration != nil {
		executors[model.ActionIntegration] = cfg.Integration
	}
	if cfg.Notification != nil {
		executors[model.ActionNotification] = cfg.Notification
	}
	if cfg.DRRunbook != nil {
		executors[model.ActionDRRunbook] = cfg.DRRunbook
	}
	if cfg.HTTPCall != nil {
		executors[model.ActionHTTPCall] = cfg.HTTPCall
	}
	if len(executors) == 0 {
		return nil, fmt.Errorf("automation dispatcher: at least one action executor is required")
	}
	return &Dispatcher{executors: executors, skipOnUnavailable: cfg.SkipOnUnavailable}, nil
}

// Execute routes the step to the executor for its action Kind and records the
// outcome. The recorded Output always carries the action kind and a dispatched
// marker so the execution log shows the routing decision even on the rarer
// skip-on-unavailable path.
func (d *Dispatcher) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	if step == nil {
		return service.Output{}, invalidConfig("dispatch: run step is nil")
	}
	kind := step.Action.Kind
	exec, ok := d.executors[kind]
	if !ok {
		// Unknown/unwired kind is a permanent config error — never retried.
		return service.Output{}, invalidConfig("dispatch: no executor for action kind %q", kind)
	}

	out, err := exec.Execute(ctx, step)
	if err != nil {
		if IsRetryable(err) && d.skipOnUnavailable {
			// Policy: skip an unreachable target rather than retrying. Record the
			// skip in the log and let the run proceed (nil error).
			return service.Output{Data: map[string]any{
				"action":     kind,
				"dispatched": true,
				"skipped":    true,
				"reason":     "target_unavailable",
				"error":      err.Error(),
				"skipped_at": time.Now().UTC().Format(time.RFC3339Nano),
			}}, nil
		}
		// Retryable (default policy) and permanent errors both propagate: the
		// orchestrator retries a non-terminal error up to MaxAttempts and fails
		// the run thereafter; a permanent error fails the step on the first pass.
		return service.Output{}, err
	}

	// Annotate the recorded output with the routing decision for the audit log.
	if out.Data == nil {
		out.Data = map[string]any{}
	}
	if _, exists := out.Data["action"]; !exists {
		out.Data["action"] = kind
	}
	out.Data["dispatched"] = true
	return out, nil
}

// Supports reports whether the dispatcher has an executor for the given Kind.
func (d *Dispatcher) Supports(kind string) bool {
	_, ok := d.executors[kind]
	return ok
}
