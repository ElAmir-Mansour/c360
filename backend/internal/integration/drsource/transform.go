package drsource

import (
	"encoding/json"

	"github.com/clario360/platform/internal/events"
)

// EventTransform is the signature the connector Registry's send-transform hook
// expects (it equals connector.EventTransform structurally). It is declared here
// — rather than importing the connector package — so drsource stays a leaf
// dependency with no import cycle: the wiring layer (main.go) passes the result
// of NewEventTransform straight into registry.SetSendTransform.
type EventTransform func(*events.Event) *events.Event

// NewEventTransform returns a send-transform that enriches DataStream/DR events
// with the rendered DR notification, leaving every non-DR event untouched.
//
// For a datastream.dr.* (or legacy dr.*) event it runs Render, then rewrites the
// event's Data so that EVERY connector — the legacy slack/teams/webhook clients
// AND the new email/pagerduty/rest connectors — produces DR-appropriate output
// from its existing payload-extraction logic, with no connector or client code
// change:
//
//   - title       -> the DR Notification.Title  (slack/teams headline, email/PD subject)
//   - severity    -> the resolved DR severity   (slack emoji, teams colour, PD severity)
//   - summary     -> the DR summary             (read by the new connectors)
//   - description -> the DR summary             (read by the legacy slack/teams clients)
//   - fields      -> the ordered [{label,value}] detail list (rest templates / generic)
//   - field_map   -> the label->value map       (rest templates)
//   - event_type / subject / tenant_id / occurred_at / url -> from the rendered payload
//
// The ORIGINAL payload keys are preserved underneath these so no producer data
// is lost; the rendered keys only override the presentation fields. appURL is
// used to build the deep link in the rendered payload.
//
// For any event that is not a DR event, the transform returns it unchanged
// (same pointer), so non-DR deliveries are byte-for-byte identical to the
// pre-wiring path. The transform never errors: an unrenderable DR payload still
// yields a usable generic Notification (see Render).
func NewEventTransform(appURL string) EventTransform {
	return func(event *events.Event) *events.Event {
		if event == nil || !IsDREvent(event.Type) {
			return event
		}

		notification := Render(event)
		generic := notification.ToGenericMap(appURL)

		// Start from the original decoded payload so producer fields survive,
		// then overlay the rendered presentation fields.
		merged := decodeData(event.Data)
		merged["title"] = notification.Title
		merged["severity"] = string(notification.Severity)
		merged["summary"] = notification.Summary
		merged["description"] = notification.Summary
		merged["event_type"] = generic.EventType
		merged["fields"] = generic.Fields
		merged["field_map"] = generic.FieldMap
		merged["occurred_at"] = generic.OccurredAt
		if generic.Subject != "" {
			merged["subject"] = generic.Subject
		}
		if generic.TenantID != "" {
			merged["tenant_id"] = generic.TenantID
		}
		if generic.URL != "" {
			merged["url"] = generic.URL
		}

		raw, err := json.Marshal(merged)
		if err != nil {
			// Marshalling the merged map cannot realistically fail (it holds only
			// JSON-safe values), but if it does, deliver the original event rather
			// than dropping it.
			return event
		}

		// Copy the envelope so we never mutate the caller's event (the delivery
		// worker may reuse it for metrics/audit after dispatch).
		clone := *event
		clone.Data = raw
		return &clone
	}
}
