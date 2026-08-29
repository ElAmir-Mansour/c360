// Package trigger implements the five Automation trigger sources
// (DESIGN_Workflow_Forms_Automation.md §4.3, FR-AUTOMATION-001): event,
// schedule, threshold, manual, and webhook. Each source watches its own input
// (the bus, a cron clock, an inbound HTTP request, or a direct API call),
// decides which enabled automations a given occurrence matches, and emits a
// normalized FiredTrigger to a TriggerSink for exactly-once dispatch.
//
// Exactly-once (§4.3): every occurrence carries a stable EventID. Before a
// FiredTrigger is handed to the sink, the shared Dispatcher consults an
// events.IdempotencyGuard keyed on that EventID — copying the pattern from
// internal/notification/consumer. A duplicate id (a Kafka re-delivery, a webhook
// retry, an overlapping cron tick) is suppressed before any run is created; the
// (tenant_id, source_event_id) UNIQUE constraint on automation_runs is the
// permanent DB backstop the sink relies on (WP-8 repository.CreateRun).
//
// The sink itself (the AutomationService that resolves rules and creates a run)
// is implemented in a later work package; this package depends only on the
// TriggerSink interface so the sources are unit-testable against a fake.
package trigger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// FiredTrigger is the normalized output every trigger source produces. It binds
// one enabled automation to one trigger occurrence. EventID is the stable
// identity used for both the idempotency guard and the automation_runs
// (tenant_id, source_event_id) backstop, so the same occurrence never spawns two
// runs of the same automation.
type FiredTrigger struct {
	// AutomationID is the automation this occurrence matched and will run.
	AutomationID string
	// TenantID scopes the run; always non-empty (sources drop occurrences
	// without a tenant before they ever reach a FiredTrigger).
	TenantID string
	// EventID is the exactly-once key. For an automation matched by a single
	// bus event, several automations may match the SAME source event, so the
	// per-FiredTrigger key combines the source event id with the automation id
	// (see dispatchKey) — one occurrence fires each matching automation exactly
	// once, independently.
	EventID string
	// TriggerType records which source produced this (model.TriggerType*),
	// for metrics and the run's recorded trigger metadata.
	TriggerType string
	// Payload is the recorded trigger data the run replays from (§4.7): the
	// event.data map, the webhook body, the manual-invoke body, or the schedule
	// fire metadata.
	Payload map[string]any
}

// TriggerSink receives FiredTriggers that have already passed the exactly-once
// gate. The implementation (a later WP's AutomationService) resolves the
// automation's rules and creates a durable Run. Dispatch must be idempotent at
// the DB layer too: it returns model.ErrAlreadyExists when the
// (tenant_id, source_event_id) backstop rejects a duplicate the Redis guard
// missed (e.g. after a guard TTL expiry or a Redis flush), and the Dispatcher
// treats that as a benign suppression rather than an error.
type TriggerSink interface {
	// Dispatch creates (or recognizes as already-created) the run for ft.
	Dispatch(ctx context.Context, ft FiredTrigger) error
}

// SinkFunc adapts a function to the TriggerSink interface.
type SinkFunc func(ctx context.Context, ft FiredTrigger) error

// Dispatch implements TriggerSink.
func (f SinkFunc) Dispatch(ctx context.Context, ft FiredTrigger) error { return f(ctx, ft) }

// Dispatcher wraps a TriggerSink with the exactly-once idempotency guard shared
// by every trigger source. The guard is keyed on a stable per-FiredTrigger key
// (source event id + automation id) so two distinct automations matching one bus
// event each fire once, while a redelivery of that same event fires neither
// twice.
type Dispatcher struct {
	sink   TriggerSink
	guard  *events.IdempotencyGuard
	logger zerolog.Logger
}

// NewDispatcher builds a Dispatcher. A nil guard is permitted (the guard's own
// methods no-op on a nil receiver, falling back to the DB unique backstop), so
// air-gapped or Redis-less deployments still get at-least-once + DB exactly-once.
func NewDispatcher(sink TriggerSink, guard *events.IdempotencyGuard, logger zerolog.Logger) *Dispatcher {
	return &Dispatcher{
		sink:   sink,
		guard:  guard,
		logger: logger.With().Str("component", "automation_trigger_dispatcher").Logger(),
	}
}

// dispatchKey is the exactly-once key for a FiredTrigger: the source event id
// scoped by the automation it fires. Distinct automations matched by one event
// get distinct keys (each fires once); a redelivery of the same event reuses the
// key (suppressed).
func dispatchKey(ft FiredTrigger) string {
	return fmt.Sprintf("automation:%s:%s", ft.AutomationID, ft.EventID)
}

// Dispatch runs the exactly-once protocol for one FiredTrigger:
//
//  1. IsProcessed acquires the right to process (or reports a duplicate/in-flight
//     occurrence, which is suppressed).
//  2. The sink creates the run. A model.ErrAlreadyExists from the DB backstop is
//     treated as a successful suppression (the run already exists).
//  3. On success MarkProcessed records the key; on a transient sink error
//     Release frees the lock so the next delivery retries.
//
// It mirrors notification_consumer.handleEvent exactly so both consumers share
// one proven idempotency discipline.
func (d *Dispatcher) Dispatch(ctx context.Context, ft FiredTrigger) error {
	if ft.AutomationID == "" || ft.TenantID == "" || ft.EventID == "" {
		return fmt.Errorf("%w: fired trigger missing automation_id/tenant_id/event_id", model.ErrInvalidConfig)
	}
	key := dispatchKey(ft)

	if d.guard != nil {
		processed, err := d.guard.IsProcessed(ctx, key)
		if err != nil {
			return fmt.Errorf("checking trigger idempotency: %w", err)
		}
		if processed {
			d.logger.Debug().
				Str("automation_id", ft.AutomationID).
				Str("event_id", ft.EventID).
				Str("trigger_type", ft.TriggerType).
				Msg("duplicate trigger occurrence suppressed")
			return nil
		}
	}

	if err := d.sink.Dispatch(ctx, ft); err != nil {
		// The DB unique backstop fired: the run already exists for this
		// (tenant, source_event_id). That is the exactly-once guarantee working,
		// not a failure — mark processed so we stop retrying it.
		if isAlreadyExists(err) {
			if d.guard != nil {
				if markErr := d.guard.MarkProcessed(ctx, key); markErr != nil {
					d.logger.Warn().Err(markErr).Str("event_id", ft.EventID).Msg("marking processed after dedupe")
				}
			}
			d.logger.Debug().
				Str("automation_id", ft.AutomationID).
				Str("event_id", ft.EventID).
				Msg("trigger occurrence already had a run (db backstop)")
			return nil
		}
		// Transient failure: release the lock so a redelivery retries this
		// occurrence rather than being wrongly suppressed.
		if d.guard != nil {
			if relErr := d.guard.Release(ctx, key); relErr != nil {
				d.logger.Warn().Err(relErr).Str("event_id", ft.EventID).Msg("releasing trigger idempotency lock")
			}
		}
		return fmt.Errorf("dispatching trigger for automation %s: %w", ft.AutomationID, err)
	}

	if d.guard != nil {
		if err := d.guard.MarkProcessed(ctx, key); err != nil {
			return fmt.Errorf("marking trigger processed: %w", err)
		}
	}
	d.logger.Info().
		Str("automation_id", ft.AutomationID).
		Str("tenant_id", ft.TenantID).
		Str("trigger_type", ft.TriggerType).
		Str("event_id", ft.EventID).
		Msg("trigger fired")
	return nil
}

// isAlreadyExists reports whether err is (or wraps) model.ErrAlreadyExists, the
// signal that the DB unique backstop suppressed a duplicate run.
func isAlreadyExists(err error) bool {
	return err != nil && errors.Is(err, model.ErrAlreadyExists)
}

// isNotFound reports whether err is (or wraps) model.ErrNotFound, used by the
// webhook source to answer 404 for an unknown token without leaking existence.
func isNotFound(err error) bool {
	return err != nil && errors.Is(err, model.ErrNotFound)
}

// AutomationLister is the read surface the bus-driven sources (event, threshold)
// use to find the enabled automations that might match an incoming event. The
// service (a later WP) implements it over the repository; tests use an in-memory
// fake. It returns enabled automations of the given trigger type subscribed to
// the given topic, for the event's tenant.
type AutomationLister interface {
	// ListEnabledByTopic returns enabled automations of triggerType whose
	// trigger subscribes to topic, within tenantID. An empty result means no
	// automation cares about this event (the common, hot path).
	ListEnabledByTopic(ctx context.Context, tenantID, triggerType, topic string) ([]*model.Automation, error)
}

// ScheduleLister is the read surface the schedule source uses to enumerate the
// enabled schedule-trigger automations whose cron clock it advances. Unlike the
// bus sources it spans all tenants (the leader-singleton clock fires every
// tenant's schedules), so it is a documented system path.
type ScheduleLister interface {
	// SystemListEnabledSchedules returns every enabled schedule-trigger
	// automation across all tenants. SYSTEM PATH — leader loop only.
	SystemListEnabledSchedules(ctx context.Context) ([]*model.Automation, error)
}

// matchFilter reports whether every key in filter is present in data with an
// equal value. An empty filter matches any event (subscribe-all). Comparison
// coerces numbers and stringifies the rest so a JSON-decoded float64 in the
// event matches an int filter authored in config, mirroring the expression
// DSL's compareEqual semantics.
func matchFilter(filter map[string]any, data map[string]any) bool {
	for k, want := range filter {
		got, ok := lookupPath(data, k)
		if !ok {
			return false
		}
		if !valuesEqual(want, got) {
			return false
		}
	}
	return true
}

// lookupPath resolves a dotted path ("a.b.c") into a nested map, returning the
// leaf value and whether it was found. A non-dotted key is a direct lookup.
func lookupPath(data map[string]any, path string) (any, bool) {
	if !strings.Contains(path, ".") {
		v, ok := data[path]
		return v, ok
	}
	var current any = data
	for _, seg := range strings.Split(path, ".") {
		m, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		v, ok := m[seg]
		if !ok {
			return nil, false
		}
		current = v
	}
	return current, true
}

// valuesEqual compares two values with numeric coercion (JSON numbers decode to
// float64), boolean equality, and a string fallback — the same vocabulary the
// expression evaluator uses so filters and rules agree.
func valuesEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	af, aNum := toFloat(a)
	bf, bNum := toFloat(b)
	if aNum && bNum {
		return af == bf
	}
	ab, aBool := a.(bool)
	bb, bBool := b.(bool)
	if aBool && bBool {
		return ab == bb
	}
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

// toFloat coerces numeric kinds (including a numeric string) to float64.
func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// sortAutomationsByName gives deterministic ordering when several automations
// match one event, so emission order (and thus any conflict logging downstream)
// is stable across runs.
func sortAutomationsByName(as []*model.Automation) {
	sort.Slice(as, func(i, j int) bool {
		if as[i].Name != as[j].Name {
			return as[i].Name < as[j].Name
		}
		return as[i].ID < as[j].ID
	})
}
