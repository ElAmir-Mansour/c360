package drsource

import (
	"sort"

	intmodel "github.com/clario360/platform/internal/integration/model"
)

// The DR suite label. service.extractSuite takes the FIRST dotted segment of the
// trimmed event type. The canonical contract types are "datastream.dr.*" (suite
// "datastream"), but real producers also stage "dr.*" (ransomware, prediction)
// and "rpo.*" (the rpo monitor) — so a DR filter scoped only to "datastream"
// would drop those. suitesFor(types) derives the exact suite set from the
// EventTypes list so the Suites constraint never contradicts the EventTypes.
const SuiteDataStream = "datastream"

// suitesFor returns the distinct first-segment suite labels of the given trimmed
// event types, sorted. It mirrors service.extractSuite so a filter's Suites and
// EventTypes are always consistent.
func suitesFor(types []string) []string {
	set := map[string]struct{}{}
	for _, t := range types {
		seg := t
		if i := indexByte(t, '.'); i >= 0 {
			seg = t[:i]
		}
		if seg != "" {
			set[seg] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// indexByte returns the index of the first occurrence of b in s, or -1. (Avoids
// importing strings for a single call.)
func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// RouteKind names a recommended default DR routing target by delivery intent so
// the admin one-click flow can pick a connector for each.
type RouteKind string

const (
	// RoutePaging delivers incident-grade DR alerts (RPO breach, ransomware,
	// predicted breach, failover failed) at a severity floor — wire to
	// PagerDuty / ServiceNow / a high-urgency Slack channel.
	RoutePaging RouteKind = "paging"
	// RouteChat delivers failover / drill / attestation lifecycle events for
	// awareness — wire to a Slack / Teams channel.
	RouteChat RouteKind = "chat"
	// RouteTicketing opens a ticket for sustained incidents (RPO breach,
	// ransomware, failover failed) — wire to Jira / ServiceNow.
	RouteTicketing RouteKind = "ticketing"
)

// RoutePreset is a recommended default DR routing rule: a delivery intent, a
// human description, and the concrete EventFilter set an operator can apply to
// an integration to realise it. The filters are valid model.EventFilter values
// understood by the existing service.matchesFilter matcher, so applying a preset
// requires no engine change — only writing the filters onto an Integration.
type RoutePreset struct {
	// Kind is the delivery intent.
	Kind RouteKind `json:"kind"`
	// Description explains, for the admin UI, what the preset routes and why.
	Description string `json:"description"`
	// SeverityFloor is the lowest severity the preset forwards (informational
	// for chat; high for paging/ticketing). It is the floor applied when
	// building the Severities filter.
	SeverityFloor Severity `json:"severity_floor"`
	// Filters is the EventFilter set to attach to an integration. The slice is
	// OR-combined by the matcher: an event passes if it satisfies any filter.
	Filters []intmodel.EventFilter `json:"filters"`
}

// rawSeverityAliases maps each canonical severity to the raw "severity" strings
// real DR producers stamp into event payloads that resolve to it (see
// resolveSeverity). The rpo/predict/failover producers stamp NO severity field
// (their events are gated by EventTypes + Suites alone), but the ransomware
// monitor stamps "confirmed". An EventFilter.Severities set must therefore list
// these raw spellings too, or the matcher — which compares the literal payload
// string — would drop a confirmed ransomware alert from a high-floor route.
var rawSeverityAliases = map[Severity][]string{
	SeverityCritical: {"confirmed", "fatal", "error"},
	SeverityHigh:     {"warning"},
	SeverityMedium:   {"moderate", "notice"},
	SeverityInfo:     {"low", "informational"},
}

// severitiesAtLeast returns the EventFilter.Severities value for a floor: the
// canonical severity strings >= floor (most-severe first) PLUS the raw producer
// severity aliases that resolve to a severity >= floor. The matcher passes an
// event when its literal payload "severity" string is in this set; events with
// no severity field pass on EventTypes/Suites alone.
func severitiesAtLeast(floor Severity) []string {
	all := []Severity{SeverityCritical, SeverityHigh, SeverityMedium, SeverityInfo}
	out := make([]string, 0, len(all)*2)
	for _, s := range all {
		if !s.AtLeast(floor) {
			continue
		}
		out = append(out, string(s))
		out = append(out, rawSeverityAliases[s]...)
	}
	return out
}

// expandWithAliases returns the given canonical types PLUS every producer alias
// that maps to them, sorted and de-duplicated. The matcher compares an incoming
// event's trimmed type against the literal EventTypes list, so a filter MUST
// list the alias spellings the real producers stage (e.g. "rpo.breached",
// "dr.ransomware.suspected", "datastream.dr.failover.gate1.passed") or those
// live events would never match.
func expandWithAliases(canonicalTypes []string) []string {
	set := map[string]struct{}{}
	for _, t := range canonicalTypes {
		set[t] = struct{}{}
		if spec, ok := byType[t]; ok {
			for _, a := range spec.Aliases {
				set[a] = struct{}{}
			}
		}
	}
	out := make([]string, 0, len(set))
	for t := range set {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// AlertEventTypes returns the DR alert (incident-grade) event types — the
// canonical types plus their producer aliases — sorted. This is the EventTypes
// a paging/ticketing filter targets.
func AlertEventTypes() []string {
	return expandWithAliases(TypesForChannel(ChannelAlert))
}

// LifecycleEventTypes returns the DR lifecycle event types — the canonical types
// plus their producer aliases — sorted. This is the EventTypes a chat filter
// targets.
func LifecycleEventTypes() []string {
	return expandWithAliases(TypesForChannel(ChannelLifecycle))
}

// PagingFilter builds the EventFilter for incident-grade DR alerts at or above
// floor: it scopes to the datastream suite, to the alert-channel event types,
// and to the severity floor. With floor=SeverityHigh this routes
// "datastream.dr.alerts at severity>=high to a paging connector".
func PagingFilter(floor Severity) intmodel.EventFilter {
	types := AlertEventTypes()
	return intmodel.EventFilter{
		Suites:     suitesFor(types),
		EventTypes: types,
		Severities: severitiesAtLeast(floor),
	}
}

// ChatFilter builds the EventFilter for DR failover/drill/attestation lifecycle
// events, routed to a chat connector for awareness. It is severity-agnostic
// (lifecycle events are informational) and scoped to the lifecycle event types.
func ChatFilter() intmodel.EventFilter {
	types := LifecycleEventTypes()
	return intmodel.EventFilter{
		Suites:     suitesFor(types),
		EventTypes: types,
	}
}

// TicketingFilter builds the EventFilter for sustained DR incidents that warrant
// a ticket: RPO breach, ransomware, failover failed — at or above floor.
func TicketingFilter(floor Severity) intmodel.EventFilter {
	types := expandWithAliases([]string{
		"datastream.dr.alert.rpo_breach",
		"datastream.dr.ransomware.suspected",
		"datastream.dr.failover.failed",
	})
	return intmodel.EventFilter{
		Suites:     suitesFor(types),
		EventTypes: types,
		Severities: severitiesAtLeast(floor),
	}
}

// DefaultPresets returns the recommended default DR routing presets an operator
// can one-click apply:
//
//   - paging: DR alerts at severity>=high -> a paging connector
//   - chat: failover/drill lifecycle -> a chat connector
//   - ticketing: RPO breach / ransomware / failover failed at severity>=high
//
// Each preset's Filters are concrete, valid model.EventFilter values; applying a
// preset means writing preset.Filters onto an Integration. No engine code
// changes — the existing consumer + matcher route the events.
func DefaultPresets() []RoutePreset {
	return []RoutePreset{
		{
			Kind:          RoutePaging,
			Description:   "Page on DataStream/DR incident alerts (RPO breach, ransomware suspected, predicted breach, failover failed) at severity high or above.",
			SeverityFloor: SeverityHigh,
			Filters:       []intmodel.EventFilter{PagingFilter(SeverityHigh)},
		},
		{
			Kind:          RouteChat,
			Description:   "Post DataStream/DR failover, drill and attestation lifecycle events to a chat channel for awareness.",
			SeverityFloor: SeverityInfo,
			Filters:       []intmodel.EventFilter{ChatFilter()},
		},
		{
			Kind:          RouteTicketing,
			Description:   "Open a ticket for sustained DataStream/DR incidents (RPO breach, ransomware suspected, failover failed) at severity high or above.",
			SeverityFloor: SeverityHigh,
			Filters:       []intmodel.EventFilter{TicketingFilter(SeverityHigh)},
		},
	}
}

// DefaultDRFilters returns the union of the paging and chat default filters — a
// single EventFilter slice that enables "all DR notifications" on one
// integration (paging-grade alerts plus lifecycle awareness). This is the
// one-click "enable DR notifications" set referenced by the SOURCE contract.
func DefaultDRFilters() []intmodel.EventFilter {
	return []intmodel.EventFilter{
		PagingFilter(SeverityHigh),
		ChatFilter(),
	}
}

// PresetFor returns the default preset for a route kind, and whether one exists.
func PresetFor(kind RouteKind) (RoutePreset, bool) {
	for _, p := range DefaultPresets() {
		if p.Kind == kind {
			return p, true
		}
	}
	return RoutePreset{}, false
}
