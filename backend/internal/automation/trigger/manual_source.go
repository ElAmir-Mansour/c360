package trigger

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// ManualSource is the manual trigger source (model.TriggerTypeManual, §4.3 row
// "manual"). Unlike the bus/cron sources it has no loop: the handler layer calls
// Invoke directly from POST /api/v1/automation/{id}/invoke (Auth+Tenant+RBAC).
// Each invocation gets a freshly generated EventID so two deliberate invocations
// are two distinct runs (an operator may legitimately re-run a manual automation)
// — the idempotency guard only suppresses an accidental double-delivery of the
// SAME invocation, which the handler must signal by reusing an EventID.
type ManualSource struct {
	dispatcher *Dispatcher
	logger     zerolog.Logger
}

// NewManualSource constructs a ManualSource.
func NewManualSource(dispatcher *Dispatcher, logger zerolog.Logger) (*ManualSource, error) {
	if dispatcher == nil {
		return nil, fmt.Errorf("manual source: dispatcher is required")
	}
	return &ManualSource{
		dispatcher: dispatcher,
		logger:     logger.With().Str("component", "automation_manual_source").Logger(),
	}, nil
}

// Type identifies this source.
func (s *ManualSource) Type() string { return model.TriggerTypeManual }

// Invoke fires a manual trigger for the given automation. tenantID and
// automationID come from the authenticated request; userID is the operator
// (recorded in the payload for audit); body is the optional JSON request body
// (already decoded by the handler). A fresh EventID is generated so each
// deliberate invocation is its own run.
func (s *ManualSource) Invoke(ctx context.Context, tenantID, automationID, userID string, body map[string]any) error {
	if tenantID == "" || automationID == "" {
		return fmt.Errorf("%w: manual invoke requires tenant and automation id", model.ErrInvalidConfig)
	}
	eventID := "manual:" + events.GenerateUUID()
	return s.invokeWithEventID(ctx, tenantID, automationID, userID, eventID, body)
}

// InvokeWithEventID fires a manual trigger using a caller-supplied EventID. The
// handler uses this to make a retried invocation idempotent: passing the same
// EventID (e.g. an Idempotency-Key header value) on a retry causes the guard to
// suppress the duplicate, while a new key starts a new run.
func (s *ManualSource) InvokeWithEventID(ctx context.Context, tenantID, automationID, userID, eventID string, body map[string]any) error {
	if eventID == "" {
		return fmt.Errorf("%w: manual invoke requires a non-empty event id", model.ErrInvalidConfig)
	}
	return s.invokeWithEventID(ctx, tenantID, automationID, userID, eventID, body)
}

func (s *ManualSource) invokeWithEventID(ctx context.Context, tenantID, automationID, userID, eventID string, body map[string]any) error {
	if body == nil {
		body = map[string]any{}
	}
	ft := FiredTrigger{
		AutomationID: automationID,
		TenantID:     tenantID,
		EventID:      eventID,
		TriggerType:  model.TriggerTypeManual,
		Payload: map[string]any{
			"trigger": map[string]any{
				"type":       model.TriggerTypeManual,
				"invoked_by": userID,
				"data":       body,
			},
		},
	}
	if err := s.dispatcher.Dispatch(ctx, ft); err != nil {
		return fmt.Errorf("dispatching manual trigger (automation %s): %w", automationID, err)
	}
	s.logger.Info().
		Str("automation_id", automationID).
		Str("tenant_id", tenantID).
		Str("invoked_by", userID).
		Msg("manual trigger invoked")
	return nil
}
