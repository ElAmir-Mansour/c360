// Package drsource makes DataStream / ClarioDR events a first-class source for
// the integration engine. The consumer already routes datastream.dr.* events to
// integrations via EventFilter; this package adds the two missing pieces:
//
//   - DR-specific rendering (renderer.go): turn a raw *events.Event whose Type is
//     a datastream.dr.* type into a structured, human-readable Notification
//     (Title, Severity, Summary, Fields) and into vendor payloads — Slack Block
//     Kit, Teams Adaptive Card, and a generic title+fields map for email /
//     PagerDuty / REST connectors.
//
//   - DR default routing (routing.go): sensible default EventFilter sets so an
//     operator can one-click enable DR notifications (page on high/critical DR
//     alerts; chat on failover/drill lifecycle).
//
// This file is the DR event TYPE catalog: the canonical list of datastream.dr.*
// event types this package understands, each with a display label and a default
// severity, so the admin UI and filter builder can present them.
//
// The package is purely additive and behavior-preserving: it imports the
// existing internal/events and internal/integration/model packages and never
// mutates the running slack/teams/jira/servicenow/webhook clients.
package drsource

import (
	"sort"
	"strings"
)

// Severity is the canonical severity ladder DR rendering and routing use. It is
// a deliberately small, ordered set that maps onto the EventFilter.Severities
// strings the existing matcher compares against (see service.matchesFilter).
type Severity string

const (
	// SeverityCritical is an active, ongoing loss-of-protection or attack: an
	// RPO breach in effect, a confirmed ransomware signal, a failed failover.
	SeverityCritical Severity = "critical"
	// SeverityHigh is an imminent or predicted breach, or a failover gate that
	// must be acted on: a forecast breach, a passed gate awaiting promotion.
	SeverityHigh Severity = "high"
	// SeverityMedium is a notable lifecycle outcome that warrants review but is
	// not itself an incident: a drill completed (passed), a forecast cleared.
	SeverityMedium Severity = "medium"
	// SeverityInfo is routine lifecycle telemetry.
	SeverityInfo Severity = "info"
)

// severityRank orders severities for threshold comparisons (higher is worse).
var severityRank = map[Severity]int{
	SeverityInfo:     0,
	SeverityMedium:   1,
	SeverityHigh:     2,
	SeverityCritical: 3,
}

// Valid reports whether s is one of the known severities.
func (s Severity) Valid() bool {
	_, ok := severityRank[s]
	return ok
}

// Rank returns the ordering rank of the severity (info<medium<high<critical).
// Unknown severities rank below info so they never satisfy a high-only filter.
func (s Severity) Rank() int {
	if r, ok := severityRank[s]; ok {
		return r
	}
	return -1
}

// AtLeast reports whether s is as severe as floor (s.Rank() >= floor.Rank()).
func (s Severity) AtLeast(floor Severity) bool {
	return s.Rank() >= floor.Rank()
}

// String returns the severity as its wire string.
func (s Severity) String() string { return string(s) }

// Channel classifies a DR event type by how it should be delivered. Alerts page
// (incidents); lifecycle events inform a chat channel; telemetry is low-signal.
type Channel string

const (
	// ChannelAlert is for incident-grade DR events (RPO breach, ransomware,
	// predicted breach) — route to a paging connector at a severity floor.
	ChannelAlert Channel = "alert"
	// ChannelLifecycle is for failover / drill / attestation lifecycle events —
	// route to a chat connector for awareness.
	ChannelLifecycle Channel = "lifecycle"
	// ChannelTelemetry is for high-volume progress telemetry — generally not
	// delivered to humans by default.
	ChannelTelemetry Channel = "telemetry"
)

// EventTypeSpec describes one datastream.dr.* event type the renderer
// understands: its canonical (trimmed) type, a human display label, the default
// severity to assign it, and the delivery channel class. The admin UI and the
// filter builder consume the catalog returned by Catalog().
type EventTypeSpec struct {
	// Type is the canonical, trimmed event type (no "com.clario360." prefix),
	// e.g. "datastream.dr.alert.rpo_breach". This is the value an operator puts
	// in EventFilter.EventTypes; the matcher compares it against both the full
	// and the trimmed form of an incoming event.
	Type string `json:"type"`
	// Label is the human-readable name for the admin UI.
	Label string `json:"label"`
	// DefaultSeverity is the severity assigned when the event payload does not
	// carry an explicit "severity" field.
	DefaultSeverity Severity `json:"default_severity"`
	// Channel classifies the delivery intent (alert / lifecycle / telemetry).
	Channel Channel `json:"channel"`
	// Aliases are alternate type spellings real DR producers emit that map to
	// this spec (e.g. the rpo monitor emits "rpo.breached"; the failover driver
	// emits "datastream.dr.failover.gate1.passed"). Both the canonical Type and
	// every alias resolve to this spec. Aliases are matched on the trimmed type
	// and also by leaf suffix (see Lookup).
	Aliases []string `json:"aliases,omitempty"`
}

// The canonical DR event catalog. The five types named in the SOURCE contract
// (rpo_breach, ransomware.suspected, failover.gate_passed, drill.completed,
// prediction.rpo_breach_forecast) are first-class entries; the Aliases capture
// the exact spellings the real internal/dr producers stage so a live event is
// recognised regardless of which producer emitted it.
var catalog = []EventTypeSpec{
	{
		Type:            "datastream.dr.alert.rpo_breach",
		Label:           "RPO Breach",
		DefaultSeverity: SeverityCritical,
		Channel:         ChannelAlert,
		// rpo monitor stages raw "rpo.breached"; the alert spelling is the
		// SOURCE contract.
		Aliases: []string{"rpo.breached", "datastream.dr.rpo.breached", "dr.rpo.breached"},
	},
	{
		Type:            "datastream.dr.alert.rpo_recovered",
		Label:           "RPO Recovered",
		DefaultSeverity: SeverityMedium,
		Channel:         ChannelAlert,
		Aliases:         []string{"rpo.recovered", "datastream.dr.rpo.recovered", "dr.rpo.recovered"},
	},
	{
		Type:            "datastream.dr.ransomware.suspected",
		Label:           "Ransomware Suspected",
		DefaultSeverity: SeverityCritical,
		Channel:         ChannelAlert,
		// ransomware monitor stages "dr.ransomware.suspected".
		Aliases: []string{"dr.ransomware.suspected"},
	},
	{
		Type:            "datastream.dr.prediction.rpo_breach_forecast",
		Label:           "RPO Breach Forecast",
		DefaultSeverity: SeverityHigh,
		Channel:         ChannelAlert,
		// predict service stages "dr.prediction.rpo_breach_forecast".
		Aliases: []string{"dr.prediction.rpo_breach_forecast"},
	},
	{
		Type:            "datastream.dr.prediction.rpo_forecast_cleared",
		Label:           "RPO Forecast Cleared",
		DefaultSeverity: SeverityMedium,
		Channel:         ChannelAlert,
		Aliases:         []string{"dr.prediction.rpo_forecast_cleared"},
	},
	{
		Type:            "datastream.dr.prediction.throughput_collapse",
		Label:           "Replication Throughput Collapse",
		DefaultSeverity: SeverityHigh,
		Channel:         ChannelAlert,
		Aliases:         []string{"dr.prediction.throughput_collapse"},
	},
	{
		Type:            "datastream.dr.failover.gate_passed",
		Label:           "Failover Gate Passed",
		DefaultSeverity: SeverityHigh,
		Channel:         ChannelLifecycle,
		// failover driver stages "datastream.dr.failover.gate1.passed".
		Aliases: []string{"datastream.dr.failover.gate1.passed"},
	},
	{
		Type:            "datastream.dr.failover.failed",
		Label:           "Failover Failed",
		DefaultSeverity: SeverityCritical,
		Channel:         ChannelAlert,
	},
	{
		Type:            "datastream.dr.attestation.issued",
		Label:           "DR Attestation Issued",
		DefaultSeverity: SeverityMedium,
		Channel:         ChannelLifecycle,
	},
	{
		Type:            "datastream.dr.drill.completed",
		Label:           "DR Drill Completed",
		DefaultSeverity: SeverityMedium,
		Channel:         ChannelLifecycle,
		// gameday orchestrator stages "datastream.dr.gameday.run.completed".
		Aliases: []string{"datastream.dr.gameday.run.completed", "datastream.dr.drill.run.completed"},
	},
	{
		Type:            "datastream.dr.drill.scheduled",
		Label:           "DR Drill Scheduled",
		DefaultSeverity: SeverityInfo,
		Channel:         ChannelLifecycle,
	},
}

// byType / byAlias index the catalog for O(1) Lookup. byLeaf indexes the final
// dotted segment(s) so a producer spelling that differs only in the middle
// path still resolves (e.g. "...gateway1.passed" vs "...gate_passed" differ;
// leaf matching is a fallback, not the primary key).
var (
	byType  = map[string]EventTypeSpec{}
	byAlias = map[string]EventTypeSpec{}
)

func init() {
	for _, spec := range catalog {
		byType[spec.Type] = spec
		for _, a := range spec.Aliases {
			byAlias[a] = spec
		}
	}
}

// Catalog returns a copy of the DR event type catalog, sorted by Type, for the
// admin UI / filter builder. The slice is freshly allocated so callers may not
// mutate package state.
func Catalog() []EventTypeSpec {
	out := make([]EventTypeSpec, len(catalog))
	copy(out, catalog)
	sort.Slice(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

// CanonicalTypes returns just the canonical trimmed event types in the catalog,
// sorted — the set an EventFilter.EventTypes can be populated from.
func CanonicalTypes() []string {
	out := make([]string, 0, len(catalog))
	for _, spec := range catalog {
		out = append(out, spec.Type)
	}
	sort.Strings(out)
	return out
}

// TypesForChannel returns the canonical types whose Channel equals ch, sorted.
func TypesForChannel(ch Channel) []string {
	out := make([]string, 0, len(catalog))
	for _, spec := range catalog {
		if spec.Channel == ch {
			out = append(out, spec.Type)
		}
	}
	sort.Strings(out)
	return out
}

// trimType removes the CloudEvents "com.clario360." prefix so lookups work on
// either the full type or the trimmed form (matching service.trimEventType).
func trimType(eventType string) string {
	return strings.TrimPrefix(eventType, "com.clario360.")
}

// IsDREvent reports whether eventType is a DataStream/DR event (its trimmed form
// begins with "datastream.dr." or the legacy "dr." prefix some producers use).
func IsDREvent(eventType string) bool {
	t := trimType(eventType)
	return strings.HasPrefix(t, "datastream.dr.") || strings.HasPrefix(t, "dr.")
}

// Lookup resolves an incoming event type (full or trimmed, canonical or a
// producer alias) to its catalog spec. Resolution order:
//
//  1. exact canonical Type match (trimmed),
//  2. exact alias match (trimmed),
//  3. leaf-suffix match: the last two dotted segments of the trimmed type are
//     compared against each catalog entry's leaf, so a never-before-seen
//     spelling that shares the action leaf (".rpo_breach", ".suspected",
//     ".completed") still resolves.
//
// The second return value reports whether a spec was found.
func Lookup(eventType string) (EventTypeSpec, bool) {
	t := trimType(eventType)
	if spec, ok := byType[t]; ok {
		return spec, true
	}
	if spec, ok := byAlias[t]; ok {
		return spec, true
	}
	leaf := leafKey(t)
	if leaf != "" {
		for _, spec := range catalog {
			if leafKey(spec.Type) == leaf {
				return spec, true
			}
			for _, a := range spec.Aliases {
				if leafKey(a) == leaf {
					return spec, true
				}
			}
		}
	}
	return EventTypeSpec{}, false
}

// leafKey returns the final dotted segment of a trimmed type — the action verb
// (e.g. "rpo_breach", "suspected", "completed", "gate_passed"). It is the unit
// the leaf-suffix fallback compares.
func leafKey(trimmed string) string {
	idx := strings.LastIndex(trimmed, ".")
	if idx < 0 || idx == len(trimmed)-1 {
		return trimmed
	}
	return trimmed[idx+1:]
}

// DefaultSeverityFor returns the catalog default severity for an event type, or
// SeverityInfo when the type is not in the catalog.
func DefaultSeverityFor(eventType string) Severity {
	if spec, ok := Lookup(eventType); ok {
		return spec.DefaultSeverity
	}
	return SeverityInfo
}
