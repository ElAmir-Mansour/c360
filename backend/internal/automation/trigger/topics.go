package trigger

import (
	"strings"

	"github.com/clario360/platform/internal/events"
)

// topicForEventType derives the conventional bus topic for a CloudEvents type
// when the Kafka topic is not stamped in the event metadata (e.g. an event handed
// directly to a source in a unit test). The platform's type convention is
// "com.clario360.<segments...>"; the topic for a domain is "<suite>.<entity>.events".
// The two are not derivable by a single rule across suites (platform types omit
// the "platform" suite word, cyber types include "cyber"), so this matches the
// event type's segments against an explicit prefix table.
//
// Unknown or non-conforming types return "" so the caller skips the event rather
// than guessing a wrong topic.
func topicForEventType(eventType string) string {
	const prefix = "com.clario360."
	if !strings.HasPrefix(eventType, prefix) {
		return ""
	}
	rest := eventType[len(prefix):]
	// Try a two-segment match first (e.g. "cyber.alert" → cyber.alert.events),
	// then a one-segment match (e.g. "workflow" → platform.workflow.events), so
	// the more specific suite.entity prefix wins.
	if topic := lookupPrefix(rest, 2); topic != "" {
		return topic
	}
	return lookupPrefix(rest, 1)
}

// lookupPrefix joins the first n dot-separated segments of rest and looks the
// result up in prefixTopics. Returns "" when rest has fewer than n segments or
// the prefix is unknown.
func lookupPrefix(rest string, n int) string {
	segs := strings.SplitN(rest, ".", n+1)
	if len(segs) < n {
		return ""
	}
	key := strings.Join(segs[:n], ".")
	return prefixTopics[key]
}

// prefixTopics maps an event-type prefix (after "com.clario360.") to its bus
// topic. Two-segment keys cover suite-qualified types (cyber.*, datastream.*);
// one-segment keys cover the platform domains whose types omit the suite word.
var prefixTopics = map[string]string{
	// Platform domains (types are "com.clario360.<domain>.<entity>.<verb>").
	"iam":          events.Topics.IAMEvents,
	"onboarding":   events.Topics.OnboardingEvents,
	"audit":        events.Topics.AuditEvents,
	"notification": events.Topics.NotificationEvents,
	"integration":  events.Topics.IntegrationEvents,
	"workflow":     events.Topics.WorkflowEvents,
	"automation":   events.Topics.AutomationEvents,
	"file":         events.Topics.FileEvents,
	"ai":           events.Topics.AIEvents,
	"notebook":     events.Topics.NotebookEvents,
	"license":      events.Topics.LicenseEvents,

	// Cybersecurity (types are "com.clario360.cyber.<entity>.<verb>").
	"cyber.asset":         events.Topics.AssetEvents,
	"cyber.vulnerability": events.Topics.VulnerabilityEvents,
	"cyber.threat":        events.Topics.ThreatEvents,
	"cyber.alert":         events.Topics.AlertEvents,
	"cyber.rule":          events.Topics.RuleEvents,
	"cyber.ctem":          events.Topics.CtemEvents,
	"cyber.risk":          events.Topics.RiskEvents,
	"cyber.remediation":   events.Topics.RemediationEvents,
	"cyber.dspm":          events.Topics.DSPMEvents,
	"cyber.vciso":         events.Topics.VCISOEvents,
	"cyber.ueba":          events.Topics.UEBAEvents,

	// DataStream / ClarioDR (types are "com.clario360.datastream.dr.<verb>").
	"datastream.dr": events.Topics.DREvents,
}
