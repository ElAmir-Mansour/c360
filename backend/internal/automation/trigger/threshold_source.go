package trigger

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// DefaultThresholdTopics are the bus topics a threshold trigger may watch by
// default (§4.3 row "threshold"): cyber alerts, cyber risk scores, and
// DataStream DR alerts (RPO breach, stream degraded). An automation names ONE of
// these in its TriggerConfig.Topic; the source subscribes to the union so every
// configured topic is covered by a single consumer.
func DefaultThresholdTopics() []string {
	return []string{
		events.Topics.AlertEvents,
		events.Topics.RiskEvents,
		events.Topics.DRAlerts,
	}
}

// ThresholdSource is the metric-threshold trigger source (model.TriggerTypeThreshold).
// It subscribes to alert/risk/DR-alert topics, extracts the configured
// ThresholdField (a dotted path) from each event's data, and fires when the
// value crosses the configured bound under ThresholdOp. It reuses the same
// numeric coercion as the event filter so a JSON float64 compares correctly
// against an authored float bound, mirroring the DR severity-filter pattern.
type ThresholdSource struct {
	consumer   *events.Consumer
	lister     AutomationLister
	dispatcher *Dispatcher
	topics     []string
	logger     zerolog.Logger
}

// ThresholdSourceConfig wires a ThresholdSource.
type ThresholdSourceConfig struct {
	Consumer   *events.Consumer
	Lister     AutomationLister
	Dispatcher *Dispatcher
	// Topics defaults to DefaultThresholdTopics when empty.
	Topics []string
	Logger zerolog.Logger
}

// NewThresholdSource constructs a ThresholdSource.
func NewThresholdSource(cfg ThresholdSourceConfig) (*ThresholdSource, error) {
	if cfg.Consumer == nil {
		return nil, fmt.Errorf("threshold source: consumer is required")
	}
	if cfg.Lister == nil {
		return nil, fmt.Errorf("threshold source: lister is required")
	}
	if cfg.Dispatcher == nil {
		return nil, fmt.Errorf("threshold source: dispatcher is required")
	}
	topics := cfg.Topics
	if len(topics) == 0 {
		topics = DefaultThresholdTopics()
	}
	return &ThresholdSource{
		consumer:   cfg.Consumer,
		lister:     cfg.Lister,
		dispatcher: cfg.Dispatcher,
		topics:     topics,
		logger:     cfg.Logger.With().Str("component", "automation_threshold_source").Logger(),
	}, nil
}

// Type identifies this source.
func (s *ThresholdSource) Type() string { return model.TriggerTypeThreshold }

// Start subscribes to the threshold topics and begins consuming, blocking until
// ctx is cancelled.
func (s *ThresholdSource) Start(ctx context.Context) error {
	handler := events.EventHandlerFunc(func(ctx context.Context, event *events.Event) error {
		return s.HandleEvent(ctx, event)
	})
	for _, topic := range s.topics {
		s.consumer.Subscribe(topic, handler)
	}
	s.logger.Info().Strs("topics", s.topics).Msg("automation threshold source starting")
	return s.consumer.Start(ctx)
}

// HandleEvent evaluates every enabled threshold automation on the event's topic
// against the event data and dispatches a FiredTrigger for each crossing.
// Exported so tests can drive it without a broker.
func (s *ThresholdSource) HandleEvent(ctx context.Context, event *events.Event) error {
	if event.TenantID == "" {
		s.logger.Warn().Str("event_type", event.Type).Str("event_id", event.ID).Msg("event missing tenant id; skipping")
		return nil
	}
	topic := eventTopic(event)
	if topic == "" {
		return nil
	}
	data, err := decodeEventData(event)
	if err != nil {
		s.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed event data; skipping")
		return nil
	}

	candidates, err := s.lister.ListEnabledByTopic(ctx, event.TenantID, model.TriggerTypeThreshold, topic)
	if err != nil {
		return fmt.Errorf("listing threshold automations for topic %s: %w", topic, err)
	}
	if len(candidates) == 0 {
		return nil
	}
	sortAutomationsByName(candidates)

	for _, a := range candidates {
		if a.Trigger.Type != model.TriggerTypeThreshold {
			continue
		}
		crossed, ok := evalThreshold(a.Trigger, data)
		if !ok {
			// The field is absent or non-numeric on this event: not a crossing,
			// not an error — many alert events won't carry every metric.
			s.logger.Debug().
				Str("automation_id", a.ID).
				Str("field", a.Trigger.ThresholdField).
				Str("event_id", event.ID).
				Msg("threshold field absent/non-numeric; skipping")
			continue
		}
		if !crossed {
			continue
		}
		ft := FiredTrigger{
			AutomationID: a.ID,
			TenantID:     event.TenantID,
			EventID:      event.ID,
			TriggerType:  model.TriggerTypeThreshold,
			Payload:      buildThresholdPayload(event, data, a.Trigger),
		}
		if err := s.dispatcher.Dispatch(ctx, ft); err != nil {
			return fmt.Errorf("dispatching threshold trigger (automation %s): %w", a.ID, err)
		}
	}
	return nil
}

// evalThreshold extracts tc.ThresholdField from data and compares it to
// tc.ThresholdValue under tc.ThresholdOp. It returns (crossed, true) on a usable
// numeric comparison, or (false, false) when the field is missing or not
// numeric. The operator set mirrors model.ThresholdOp* (and the expression DSL).
func evalThreshold(tc model.TriggerConfig, data map[string]any) (crossed bool, ok bool) {
	raw, found := lookupPath(data, tc.ThresholdField)
	if !found {
		return false, false
	}
	val, isNum := toFloat(raw)
	if !isNum {
		return false, false
	}
	switch tc.ThresholdOp {
	case model.ThresholdOpGT:
		return val > tc.ThresholdValue, true
	case model.ThresholdOpGTE:
		return val >= tc.ThresholdValue, true
	case model.ThresholdOpLT:
		return val < tc.ThresholdValue, true
	case model.ThresholdOpLTE:
		return val <= tc.ThresholdValue, true
	case model.ThresholdOpEQ:
		return val == tc.ThresholdValue, true
	case model.ThresholdOpNEQ:
		return val != tc.ThresholdValue, true
	default:
		// An unknown op should have been rejected by TriggerConfig.Validate at
		// create time; treat it as "no usable comparison" rather than firing.
		return false, false
	}
}

// buildThresholdPayload records the crossing for replay and downstream rules:
// the event data plus the threshold context (field/op/bound and the observed
// value) so an operator (and the rule engine) can see exactly what fired.
func buildThresholdPayload(event *events.Event, data map[string]any, tc model.TriggerConfig) map[string]any {
	observed, _ := lookupPath(data, tc.ThresholdField)
	return map[string]any{
		"trigger": map[string]any{
			"type":   model.TriggerTypeThreshold,
			"source": event.Type,
			"id":     event.ID,
			"data":   data,
			"threshold": map[string]any{
				"field":    tc.ThresholdField,
				"op":       tc.ThresholdOp,
				"value":    tc.ThresholdValue,
				"observed": observed,
			},
		},
	}
}
