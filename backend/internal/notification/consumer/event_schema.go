package consumer

import (
	"encoding/json"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/metrics"
)

// Event payload schema versioning (#13).
//
// consumer/notification_consumer.go decodes event.Data into a
// map[string]interface{} and rule_engine.go reads fields by string name
// (data["severity"], data["days_until_expiry"], ...). A producer renaming or
// removing one of those fields silently stops matching the rule, so the
// notification just vanishes with no error anywhere.
//
// To make that drift observable we define versioned TYPED structs for the
// high-value event types whose rules actually BRANCH on a payload field (a
// Condition or PriorityFunc in rule_engine.go), decode each incoming event into
// its struct, and log + metric when a required field is missing or zero-valued.
// The map-based matching path is unchanged and remains the fallback for every
// event type without a registered schema — this is purely additive observability.

// severityPayload covers event types whose rule Condition requires a non-empty
// `severity` string: cyber.alert.created, data.quality.check_failed,
// data.contradiction.detected and lex.clause.risk_flagged.
type severityPayload struct {
	Severity string `json:"severity"`
}

// playbookDeviationPayload covers lex.playbook.deviations_detected, whose rule
// branches on max_severity and missing_required_count.
type playbookDeviationPayload struct {
	MaxSeverity          string   `json:"max_severity"`
	MissingRequiredCount *float64 `json:"missing_required_count"`
}

// meetingReminderPayload covers acta.meeting.reminder, whose PriorityFunc
// branches on hours_until.
type meetingReminderPayload struct {
	HoursUntil *float64 `json:"hours_until"`
}

// contractExpiringPayload covers lex.contract.expiring (+ enterprise variant),
// whose PriorityFunc branches on days_until_expiry.
type contractExpiringPayload struct {
	DaysUntilExpiry *float64 `json:"days_until_expiry"`
}

// schemaValidator decodes a raw payload into its typed struct and returns the
// names of REQUIRED rule-engine fields that are missing (absent, empty string,
// or a null number). An empty slice means the payload satisfies the schema.
type schemaValidator func(data json.RawMessage) []string

// eventSchemas maps a CloudEvent type to its validator. Only the high-value
// types whose rules branch on a payload field are registered; unknown types are
// intentionally absent so they fall through to the map path with no check.
var eventSchemas = map[string]schemaValidator{
	"com.clario360.cyber.alert.created":              requireSeverity,
	"com.clario360.data.quality.check_failed":        requireSeverity,
	"com.clario360.data.contradiction.detected":      requireSeverity,
	"com.clario360.lex.clause.risk_flagged":          requireSeverity,
	"com.clario360.lex.playbook.deviations_detected": requirePlaybookDeviation,
	"com.clario360.acta.meeting.reminder":            requireMeetingReminder,
	"com.clario360.lex.contract.expiring":            requireContractExpiring,
	"com.clario360.enterprise.lex.contract.expiring": requireContractExpiring,
}

func requireSeverity(data json.RawMessage) []string {
	var p severityPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return []string{"severity"}
	}
	if p.Severity == "" {
		return []string{"severity"}
	}
	return nil
}

func requirePlaybookDeviation(data json.RawMessage) []string {
	var p playbookDeviationPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return []string{"max_severity", "missing_required_count"}
	}
	var missing []string
	if p.MaxSeverity == "" {
		missing = append(missing, "max_severity")
	}
	if p.MissingRequiredCount == nil {
		missing = append(missing, "missing_required_count")
	}
	return missing
}

func requireMeetingReminder(data json.RawMessage) []string {
	var p meetingReminderPayload
	if err := json.Unmarshal(data, &p); err != nil || p.HoursUntil == nil {
		return []string{"hours_until"}
	}
	return nil
}

func requireContractExpiring(data json.RawMessage) []string {
	var p contractExpiringPayload
	if err := json.Unmarshal(data, &p); err != nil || p.DaysUntilExpiry == nil {
		return []string{"days_until_expiry"}
	}
	return nil
}

// CheckEventSchema returns the required rule-engine fields missing from an
// event's payload for the registered high-value types, or nil when the type has
// no registered schema (fallback path). It is exported so a contract test can
// assert representative producer payloads satisfy the consumer's typed schema.
func CheckEventSchema(eventType string, data json.RawMessage) []string {
	validator, ok := eventSchemas[eventType]
	if !ok {
		return nil
	}
	return validator(data)
}

// logSchemaDrift checks an event against its registered schema and, for each
// missing required field, logs a warning and increments
// notification_event_schema_field_missing_total so silent rule-match loss
// becomes visible. It never mutates matching behaviour.
func logSchemaDrift(logger zerolog.Logger, eventType string, eventID string, data json.RawMessage) {
	missing := CheckEventSchema(eventType, data)
	for _, field := range missing {
		metrics.EventSchemaFieldMissing.WithLabelValues(eventType, field).Inc()
		logger.Warn().
			Str("event_type", eventType).
			Str("event_id", eventID).
			Str("missing_field", field).
			Msg("event payload missing a rule-engine field; rules keyed on it will not match (possible producer schema drift)")
	}
}
