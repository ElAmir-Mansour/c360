package executor

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// EventGatewayArmKind distinguishes the two kinds of event a gateway arm waits on.
const (
	eventGatewayArmTimer   = "timer"
	eventGatewayArmMessage = "message"
)

// EventGatewayArm is one arm of an event-based gateway: an event (a timer or a
// correlated message) that, when it fires FIRST, wins the race and routes the
// flow to Target. The engine cancels the other arms when one wins.
type EventGatewayArm struct {
	// ID uniquely identifies this arm within the gateway (used to key the durable
	// timer / event-wait registration so a specific arm can be cancelled).
	ID string
	// Kind is timer | message.
	Kind string
	// Target is the step the flow routes to when this arm wins.
	Target string
	// Timer arm: one of Duration / FireAt (same shape as a timer step).
	Duration string
	FireAt   string
	// Message arm: the topic + correlation value (may be a ${...} reference), and
	// an optional timeout in seconds (defaults to the event-wait default).
	Topic            string
	CorrelationValue string
	TimeoutSeconds   float64
}

// BoundaryRegistrar is the narrow seam the event-based gateway (and the engine's
// boundary-event scheduling) uses to register a DURABLE timer or event-wait that,
// when it fires, routes to the engine's boundary-fire entry point rather than the
// normal advance. It is implemented by service.SchedulerService and wired via
// SetBoundaryRegistrar. Keeping it an interface here avoids an import cycle
// (executor must not import service), mirroring the ChildStarter / FormLoader
// seams. When unset the gateway fails the step with a clear configuration error
// (loud, not silent) so a misconfigured wiring is obvious.
//
// The armKey MUST encode (instanceID, stepID, armID) so the fire path can route
// to FireGatewayArm(instanceID, stepID, armID); RegisterBoundaryTimer /
// RegisterBoundaryMessageWait build that key from those three components. Cancel*
// remove a specific arm's registration when a sibling arm wins.
type BoundaryRegistrar interface {
	RegisterBoundaryTimer(ctx context.Context, instanceID, stepID, armID string, fireAt time.Time) error
	RegisterBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string, ttl time.Duration) error
	CancelBoundaryTimer(ctx context.Context, instanceID, stepID, armID string) error
	CancelBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string) error
}

// EventGatewayExecutor implements the BPMN event-based gateway. It parks the
// instance and registers each configured arm (a timer or a correlated message
// wait) on the DURABLE timer / event-wait subsystems (via a BoundaryRegistrar).
// Whichever arm fires FIRST wins: the engine's FireGatewayArm cancels the losing
// arms and routes to the winner's target. Deterministic single-winner resolution
// is guaranteed by the engine's per-instance serialization (the first arm to flip
// the running step-execution wins; the rest no-op).
//
// Reuse: timer arms ride the same Redis sorted set as timer steps; message arms
// ride the same event-wait correlation keys as event_task WAIT. Additive +
// fail-closed: no existing definition references event_based_gateway.
type EventGatewayExecutor struct {
	registrar BoundaryRegistrar
	rdb       *redis.Client
	resolver  *expression.VariableResolver
	logger    zerolog.Logger
}

// NewEventGatewayExecutor creates an EventGatewayExecutor. The registrar is
// REQUIRED for the gateway to do useful work; when nil the executor fails the
// step with a clear configuration error.
func NewEventGatewayExecutor(registrar BoundaryRegistrar, rdb *redis.Client, logger zerolog.Logger) *EventGatewayExecutor {
	return &EventGatewayExecutor{
		registrar: registrar,
		rdb:       rdb,
		resolver:  expression.NewVariableResolver(),
		logger:    logger.With().Str("executor", "event_based_gateway").Logger(),
	}
}

// SetBoundaryRegistrar installs/overrides the durable registrar after
// construction (mirrors the other optional seams; used by tests that build the
// engine before the scheduler).
func (e *EventGatewayExecutor) SetBoundaryRegistrar(r BoundaryRegistrar) {
	e.registrar = r
}

// Execute parses the gateway's arms, registers each on the durable timer /
// event-wait subsystems, and PARKS the instance. The engine resumes at the
// winning arm's target when the first arm fires.
//
// Expected step.Config keys:
//   - events ([]interface{}, required): each element is an object describing one
//     arm: { "type": "timer"|"message", "target": "<stepID>", ...type params }.
//     timer params: "duration" | "fire_at". message params: "topic",
//     "correlation_value" (literal or ${...}), optional "timeout_seconds".
func (e *EventGatewayExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	if e.registrar == nil {
		return nil, fmt.Errorf("event_based_gateway %s: no boundary registrar wired", step.ID)
	}

	arms, err := ParseEventGatewayArms(step.Config)
	if err != nil {
		return nil, fmt.Errorf("event_based_gateway %s: %w", step.ID, err)
	}
	if len(arms) == 0 {
		return nil, fmt.Errorf("event_based_gateway %s: at least one event arm is required", step.ID)
	}

	dataCtx := buildDataContext(instance)
	registered := make([]map[string]interface{}, 0, len(arms))

	for _, arm := range arms {
		switch arm.Kind {
		case eventGatewayArmTimer:
			fireAt, ferr := resolveBoundaryTimerFireAt(e.resolver, arm.Duration, arm.FireAt, dataCtx)
			if ferr != nil {
				return nil, fmt.Errorf("event_based_gateway %s: arm %q: %w", step.ID, arm.ID, ferr)
			}
			if rerr := e.registrar.RegisterBoundaryTimer(ctx, instance.ID, step.ID, arm.ID, fireAt); rerr != nil {
				return nil, fmt.Errorf("event_based_gateway %s: registering timer arm %q: %w", step.ID, arm.ID, rerr)
			}
			registered = append(registered, map[string]interface{}{
				"arm_id": arm.ID, "kind": arm.Kind, "target": arm.Target,
				"fire_at": fireAt.Format(time.RFC3339),
			})

		case eventGatewayArmMessage:
			resolved, rerr := e.resolver.Resolve(arm.CorrelationValue, dataCtx)
			if rerr != nil {
				return nil, fmt.Errorf("event_based_gateway %s: arm %q resolving correlation_value: %w", step.ID, arm.ID, rerr)
			}
			corr := fmt.Sprintf("%v", resolved)
			ttl := 7 * 24 * time.Hour
			if arm.TimeoutSeconds > 0 {
				ttl = time.Duration(arm.TimeoutSeconds * float64(time.Second))
			}
			if werr := e.registrar.RegisterBoundaryMessageWait(ctx, instance.ID, step.ID, arm.ID, arm.Topic, corr, ttl); werr != nil {
				return nil, fmt.Errorf("event_based_gateway %s: registering message arm %q: %w", step.ID, arm.ID, werr)
			}
			registered = append(registered, map[string]interface{}{
				"arm_id": arm.ID, "kind": arm.Kind, "target": arm.Target,
				"topic": arm.Topic, "correlation_value": corr,
			})

		default:
			return nil, fmt.Errorf("event_based_gateway %s: arm %q has unsupported type %q (expected timer or message)", step.ID, arm.ID, arm.Kind)
		}
	}

	e.logger.Info().
		Str("step_id", step.ID).
		Str("instance_id", instance.ID).
		Int("arm_count", len(arms)).
		Msg("event-based gateway armed, parking instance")

	return &ExecutionResult{
		Output: map[string]interface{}{
			"event_gateway": true,
			"armed":         registered,
		},
		Parked: true,
	}, nil
}

// ParseEventGatewayArms parses the "events" config array into typed arms. It is
// exported so publish-time validation (validateStepConfig) and runtime execution
// agree exactly on what is well-formed. Each arm requires a type + target and the
// type-specific params. Arm ids default to their index when omitted.
func ParseEventGatewayArms(config map[string]interface{}) ([]EventGatewayArm, error) {
	raw, ok := config["events"]
	if !ok {
		return nil, fmt.Errorf("missing required config key %q", "events")
	}
	list, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("config key %q must be an array of event objects", "events")
	}

	arms := make([]EventGatewayArm, 0, len(list))
	seen := make(map[string]bool, len(list))
	for i, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("events[%d] must be an object", i)
		}
		arm := EventGatewayArm{}
		arm.Kind = strOf(m, "type")
		if arm.Kind == "" {
			return nil, fmt.Errorf("events[%d]: missing 'type' (timer or message)", i)
		}
		arm.Target = strOf(m, "target")
		if arm.Target == "" {
			return nil, fmt.Errorf("events[%d]: missing 'target' step id", i)
		}
		arm.ID = strOf(m, "id")
		if arm.ID == "" {
			arm.ID = fmt.Sprintf("arm-%d", i)
		}
		if seen[arm.ID] {
			return nil, fmt.Errorf("events[%d]: duplicate arm id %q", i, arm.ID)
		}
		seen[arm.ID] = true

		switch arm.Kind {
		case eventGatewayArmTimer:
			arm.Duration = strOf(m, "duration")
			arm.FireAt = strOf(m, "fire_at")
			if arm.Duration == "" && arm.FireAt == "" {
				return nil, fmt.Errorf("events[%d]: timer arm requires 'duration' or 'fire_at'", i)
			}
		case eventGatewayArmMessage:
			arm.Topic = strOf(m, "topic")
			arm.CorrelationValue = strOf(m, "correlation_value")
			if arm.Topic == "" {
				return nil, fmt.Errorf("events[%d]: message arm requires 'topic'", i)
			}
			if arm.CorrelationValue == "" {
				return nil, fmt.Errorf("events[%d]: message arm requires 'correlation_value'", i)
			}
			if v, ok := m["timeout_seconds"]; ok {
				arm.TimeoutSeconds = toFloat(v)
			}
		default:
			return nil, fmt.Errorf("events[%d]: unsupported type %q (expected timer or message)", i, arm.Kind)
		}
		arms = append(arms, arm)
	}
	return arms, nil
}

// strOf reads a string config value (returns "" for missing / non-string).
func strOf(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
