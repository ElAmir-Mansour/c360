package drsource

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	intmodel "github.com/clario360/platform/internal/integration/model"
	intsvc "github.com/clario360/platform/internal/integration/service"
)

// --- format adapter tests -------------------------------------------------

// sampleRPOBreach is the canonical sample used by the format adapter tests.
func sampleRPOBreach(t *testing.T) Notification {
	t.Helper()
	payload := map[string]any{
		"stream_id":             "stream-7",
		"site_name":             "tier-0",
		"previous_status":       "healthy",
		"status":                "degraded",
		"rpo_objective_seconds": 60,
		"live_rpo_seconds":      int64(95),
		"message":               "live RPO 95s exceeds objective 60s",
	}
	return Render(newDREvent(t, "datastream.dr.alert.rpo_breach", "stream-7", payload))
}

func TestToSlackBlocks_ContainsKeyFields(t *testing.T) {
	n := sampleRPOBreach(t)
	blocks := n.ToSlackBlocks("https://app.clario360.example")

	if len(blocks) == 0 {
		t.Fatal("no blocks rendered")
	}
	// First block must be a Block Kit header.
	if blocks[0]["type"] != "header" {
		t.Fatalf("first block type = %v, want header", blocks[0]["type"])
	}

	// Serialize the whole block array and assert the key field labels/values and
	// the summary are present, and that it is valid Block Kit JSON.
	raw, err := json.Marshal(blocks)
	if err != nil {
		t.Fatalf("blocks not JSON-marshalable: %v", err)
	}
	doc := string(raw)
	for _, want := range []string{
		"RPO Breach", "tier-0",
		"RPO Objective", "1m 0s",
		"RPO Actual", "1m 35s",
		"Status", "Healthy", "Degraded", // ">" is JSON-escaped to >
		"live RPO 95s exceeds objective 60s",
		"View in Clario 360",
		"datastream.dr.alert.rpo_breach",
	} {
		if !strings.Contains(doc, want) {
			t.Fatalf("slack blocks missing %q\n%s", want, doc)
		}
	}
	// The Status transition value carries the "->" arrow. Assert it on the
	// in-memory block (not the JSON-escaped wire form) to avoid the encoder's
	// ">" escaping of ">".
	foundStatus := false
	for _, b := range blocks {
		fs, ok := b["fields"].([]map[string]any)
		if !ok {
			continue
		}
		for _, f := range fs {
			if strings.Contains(f["text"].(string), "Status:") &&
				strings.Contains(f["text"].(string), "Healthy -> Degraded") {
				foundStatus = true
			}
		}
	}
	if !foundStatus {
		t.Fatalf("slack blocks missing Status transition field\n%s", doc)
	}

	// Header text must carry the severity emoji + word.
	hdr := blocks[0]["text"].(map[string]any)
	if !strings.Contains(hdr["text"].(string), "Critical") {
		t.Fatalf("header missing severity: %v", hdr["text"])
	}

	// A section block must use "fields" (the two-column grid) and contain the
	// RPO objective pair.
	foundFieldsSection := false
	for _, b := range blocks {
		if b["type"] == "section" {
			if fs, ok := b["fields"].([]map[string]any); ok && len(fs) > 0 {
				foundFieldsSection = true
				for _, f := range fs {
					if f["type"] != "mrkdwn" {
						t.Fatalf("field block type = %v, want mrkdwn", f["type"])
					}
				}
			}
		}
	}
	if !foundFieldsSection {
		t.Fatal("no section with fields[] grid rendered")
	}
}

func TestToSlackBlocks_NoAppURLNoActions(t *testing.T) {
	n := sampleRPOBreach(t)
	blocks := n.ToSlackBlocks("")
	for _, b := range blocks {
		if b["type"] == "actions" {
			t.Fatal("actions block must be omitted when appURL is empty")
		}
	}
}

func TestToTeamsCard_ContainsKeyFields(t *testing.T) {
	n := sampleRPOBreach(t)
	card := n.ToTeamsCard("https://app.clario360.example")

	if card["type"] != "AdaptiveCard" {
		t.Fatalf("card type = %v, want AdaptiveCard", card["type"])
	}
	if card["version"] != "1.5" {
		t.Fatalf("card version = %v, want 1.5", card["version"])
	}

	// The body must contain a FactSet with the RPO objective/actual facts.
	body, ok := card["body"].([]map[string]any)
	if !ok || len(body) == 0 {
		t.Fatalf("card body missing")
	}
	var factSet map[string]any
	for _, b := range body {
		if b["type"] == "FactSet" {
			factSet = b
		}
	}
	if factSet == nil {
		t.Fatal("no FactSet in card body")
	}
	facts := factSet["facts"].([]map[string]any)
	want := map[string]string{
		"RPO Objective": "1m 0s",
		"RPO Actual":    "1m 35s",
		"Status":        "Healthy -> Degraded",
	}
	for _, f := range facts {
		k := f["title"].(string)
		if exp, ok := want[k]; ok {
			if f["value"].(string) != exp {
				t.Fatalf("fact %q = %q, want %q", k, f["value"], exp)
			}
			delete(want, k)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing facts: %v", want)
	}

	// Title block must be coloured Attention for a critical event.
	title := body[0]
	if title["color"] != "Attention" {
		t.Fatalf("title color = %v, want Attention", title["color"])
	}

	// Whole card must be JSON-marshalable (real Teams payload).
	if _, err := json.Marshal(card); err != nil {
		t.Fatalf("card not JSON-marshalable: %v", err)
	}

	// Deep link action present.
	actions, ok := card["actions"].([]map[string]any)
	if !ok || len(actions) == 0 || actions[0]["type"] != "Action.OpenUrl" {
		t.Fatalf("missing OpenUrl action: %v", card["actions"])
	}
}

func TestToGenericMap(t *testing.T) {
	n := sampleRPOBreach(t)
	g := n.ToGenericMap("https://app.clario360.example")

	if g.Severity != "critical" {
		t.Fatalf("severity = %q", g.Severity)
	}
	if g.FieldMap["RPO Objective"] != "1m 0s" {
		t.Fatalf("FieldMap RPO Objective = %q", g.FieldMap["RPO Objective"])
	}
	if g.FieldMap["RPO Actual"] != "1m 35s" {
		t.Fatalf("FieldMap RPO Actual = %q", g.FieldMap["RPO Actual"])
	}
	if len(g.Fields) != len(g.FieldMap) {
		t.Fatalf("Fields/FieldMap length mismatch: %d vs %d", len(g.Fields), len(g.FieldMap))
	}
	if !strings.HasSuffix(g.URL, "/dr/streams/stream-7") {
		t.Fatalf("URL = %q, want deep link", g.URL)
	}
	if n.PagerDutySeverity() != "critical" {
		t.Fatalf("PagerDutySeverity = %q", n.PagerDutySeverity())
	}

	// Generic payload must round-trip through JSON (email/REST connectors).
	raw, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("generic payload not JSON-marshalable: %v", err)
	}
	if !strings.Contains(string(raw), "field_map") {
		t.Fatalf("serialized payload missing field_map: %s", raw)
	}
}

func TestPagerDutySeverityMapping(t *testing.T) {
	cases := map[Severity]string{
		SeverityCritical: "critical",
		SeverityHigh:     "error",
		SeverityMedium:   "warning",
		SeverityInfo:     "info",
	}
	for sv, want := range cases {
		n := Notification{Severity: sv}
		if got := n.PagerDutySeverity(); got != want {
			t.Fatalf("PagerDutySeverity(%s) = %q, want %q", sv, got, want)
		}
	}
}

func TestPlainTextAndEmailSubject(t *testing.T) {
	n := sampleRPOBreach(t)
	txt := n.PlainText()
	for _, want := range []string{"Critical", "RPO Breach", "RPO Objective: 1m 0s", "RPO Actual: 1m 35s"} {
		if !strings.Contains(txt, want) {
			t.Fatalf("plain text missing %q\n%s", want, txt)
		}
	}
	subj := n.EmailSubject()
	if !strings.HasPrefix(subj, "[Clario DR][Critical]") {
		t.Fatalf("email subject = %q", subj)
	}
}

// --- routing tests (against the real service.MatchesEventFilters matcher) --

// drEvent builds an event with an optional payload severity for routing tests,
// matching how the real producers populate the bus.
func drEvent(t *testing.T, eventType, severity string) *events.Event {
	t.Helper()
	payload := map[string]any{"stream_id": "s"}
	if severity != "" {
		payload["severity"] = severity
	}
	return newDREvent(t, eventType, "s", payload)
}

func TestPagingFilter_MatchesIntendedAlerts(t *testing.T) {
	filters := []intmodel.EventFilter{PagingFilter(SeverityHigh)}

	// Must match: high-grade DR alerts. Includes the ransomware "confirmed" raw
	// severity (which resolves to critical) — the matcher compares the literal
	// payload string, so the filter's Severities must list "confirmed".
	matchCases := []struct {
		eventType string
		severity  string
	}{
		{"datastream.dr.alert.rpo_breach", ""},    // no severity -> passes on types/suite
		{"dr.ransomware.suspected", "confirmed"},  // raw producer severity
		{"dr.prediction.rpo_breach_forecast", ""}, // catalog default high
		{"datastream.dr.failover.failed", ""},     // alert channel
		{"dr.prediction.throughput_collapse", ""}, // alert channel high
	}
	for _, tc := range matchCases {
		evt := drEvent(t, tc.eventType, tc.severity)
		if !intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("paging filter must match %s (sev=%q)", tc.eventType, tc.severity)
		}
	}

	// Must NOT match: lifecycle events (different EventTypes) and non-DR events.
	noMatch := []*events.Event{
		drEvent(t, "datastream.dr.failover.gate1.passed", ""), // lifecycle, not in alert types
		drEvent(t, "datastream.dr.gameday.run.completed", ""), // lifecycle
		drEvent(t, "datastream.dr.drill.scheduled", ""),       // lifecycle/info
	}
	for _, evt := range noMatch {
		if intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("paging filter must NOT match %s", evt.Type)
		}
	}

	// A non-DR event of the same severity must not match (wrong suite + type).
	nonDR, err := events.NewEvent("cyber.alert.detected", "cyber-service", testTenant, map[string]any{"severity": "critical"})
	if err != nil {
		t.Fatal(err)
	}
	if intsvc.MatchesEventFilters(nonDR, filters) {
		t.Fatalf("paging filter must NOT match a non-DR cyber alert")
	}
}

func TestChatFilter_MatchesLifecycleNotAlerts(t *testing.T) {
	filters := []intmodel.EventFilter{ChatFilter()}

	match := []*events.Event{
		drEvent(t, "datastream.dr.failover.gate1.passed", ""), // alias -> gate_passed
		drEvent(t, "datastream.dr.gameday.run.completed", ""), // alias -> drill.completed
		drEvent(t, "datastream.dr.attestation.issued", ""),
		drEvent(t, "datastream.dr.drill.scheduled", ""),
	}
	for _, evt := range match {
		if !intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("chat filter must match lifecycle %s", evt.Type)
		}
	}

	// Alert-channel events are not lifecycle types -> must not match the chat
	// filter (they have their own paging route).
	noMatch := []*events.Event{
		drEvent(t, "datastream.dr.alert.rpo_breach", ""),
		drEvent(t, "dr.ransomware.suspected", "confirmed"),
		drEvent(t, "dr.prediction.rpo_breach_forecast", ""),
	}
	for _, evt := range noMatch {
		if intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("chat filter must NOT match alert %s", evt.Type)
		}
	}
}

func TestTicketingFilter_TargetsSustainedIncidents(t *testing.T) {
	filters := []intmodel.EventFilter{TicketingFilter(SeverityHigh)}

	match := []*events.Event{
		drEvent(t, "datastream.dr.alert.rpo_breach", ""),
		drEvent(t, "dr.ransomware.suspected", "confirmed"),
		drEvent(t, "datastream.dr.failover.failed", ""),
	}
	for _, evt := range match {
		if !intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("ticketing filter must match %s", evt.Type)
		}
	}

	// A predicted (not-yet-real) breach is paging-only, not a ticket.
	if intsvc.MatchesEventFilters(drEvent(t, "dr.prediction.rpo_breach_forecast", ""), filters) {
		t.Fatalf("ticketing filter must NOT match a forecast")
	}
}

func TestDefaultDRFilters_UnionMatchesAlertsAndLifecycle(t *testing.T) {
	filters := DefaultDRFilters()

	all := []*events.Event{
		drEvent(t, "datastream.dr.alert.rpo_breach", ""),
		drEvent(t, "dr.ransomware.suspected", "confirmed"),
		drEvent(t, "dr.prediction.rpo_breach_forecast", ""),
		drEvent(t, "datastream.dr.failover.gate1.passed", ""),
		drEvent(t, "datastream.dr.gameday.run.completed", ""),
		drEvent(t, "datastream.dr.attestation.issued", ""),
	}
	for _, evt := range all {
		if !intsvc.MatchesEventFilters(evt, filters) {
			t.Fatalf("default DR filters must match %s", evt.Type)
		}
	}
}

func TestDefaultPresets_Shape(t *testing.T) {
	presets := DefaultPresets()
	if len(presets) != 3 {
		t.Fatalf("want 3 presets, got %d", len(presets))
	}
	seen := map[RouteKind]bool{}
	for _, p := range presets {
		seen[p.Kind] = true
		if len(p.Filters) == 0 {
			t.Fatalf("preset %s has no filters", p.Kind)
		}
		for _, f := range p.Filters {
			if len(f.Suites) == 0 || f.Suites[0] != SuiteDataStream {
				t.Fatalf("preset %s filter not scoped to datastream suite: %+v", p.Kind, f)
			}
			if len(f.EventTypes) == 0 {
				t.Fatalf("preset %s filter has no event types", p.Kind)
			}
		}
	}
	for _, k := range []RouteKind{RoutePaging, RouteChat, RouteTicketing} {
		if !seen[k] {
			t.Fatalf("missing preset kind %s", k)
		}
	}

	if p, ok := PresetFor(RoutePaging); !ok || p.SeverityFloor != SeverityHigh {
		t.Fatalf("PresetFor(paging) = %+v ok=%v", p, ok)
	}
	if _, ok := PresetFor(RouteKind("nope")); ok {
		t.Fatalf("PresetFor(unknown) should be false")
	}
}

func TestSeveritiesAtLeast_IncludesRawAliases(t *testing.T) {
	sv := severitiesAtLeast(SeverityHigh)
	want := []string{"critical", "high", "confirmed", "warning"}
	for _, w := range want {
		found := false
		for _, s := range sv {
			if s == w {
				found = true
			}
		}
		if !found {
			t.Fatalf("severitiesAtLeast(high) missing %q: %v", w, sv)
		}
	}
	// medium/info must be excluded by a high floor.
	for _, bad := range []string{"medium", "info", "low"} {
		for _, s := range sv {
			if s == bad {
				t.Fatalf("severitiesAtLeast(high) must not include %q", bad)
			}
		}
	}
}

func TestCatalogIntegrity(t *testing.T) {
	cat := Catalog()
	if len(cat) == 0 {
		t.Fatal("empty catalog")
	}
	for _, spec := range cat {
		if !strings.HasPrefix(spec.Type, "datastream.dr.") {
			t.Fatalf("catalog type not canonical: %q", spec.Type)
		}
		if !spec.DefaultSeverity.Valid() {
			t.Fatalf("catalog %q has invalid default severity %q", spec.Type, spec.DefaultSeverity)
		}
		if spec.Label == "" {
			t.Fatalf("catalog %q missing label", spec.Type)
		}
		// Every catalog type must resolve back to itself via Lookup.
		got, ok := Lookup(spec.Type)
		if !ok || got.Type != spec.Type {
			t.Fatalf("Lookup(%q) failed to round-trip", spec.Type)
		}
		// And via the full com.clario360 prefix.
		if _, ok := Lookup("com.clario360." + spec.Type); !ok {
			t.Fatalf("Lookup of full %q failed", spec.Type)
		}
	}

	// The five SOURCE-contract types (canonical or alias) must all resolve.
	for _, et := range []string{
		"com.clario360.datastream.dr.alert.rpo_breach",
		"com.clario360.dr.ransomware.suspected",
		"com.clario360.datastream.dr.failover.gate1.passed",
		"com.clario360.datastream.dr.gameday.run.completed",
		"com.clario360.dr.prediction.rpo_breach_forecast",
	} {
		if _, ok := Lookup(et); !ok {
			t.Fatalf("Lookup(%q) failed — SOURCE-contract event not recognised", et)
		}
	}

	if !IsDREvent("com.clario360.datastream.dr.alert.rpo_breach") {
		t.Fatal("IsDREvent false for datastream.dr type")
	}
	if !IsDREvent("dr.ransomware.suspected") {
		t.Fatal("IsDREvent false for dr. type")
	}
	if IsDREvent("cyber.alert.detected") {
		t.Fatal("IsDREvent true for non-DR type")
	}
}

func TestDefaultSeverityForUnknownIsInfo(t *testing.T) {
	if got := DefaultSeverityFor("datastream.dr.totally.unknown.leaf"); got != SeverityInfo {
		t.Fatalf("DefaultSeverityFor(unknown) = %q, want info", got)
	}
	// time import kept meaningful: ensure event time flows into notification.
	evt := newDREvent(t, "datastream.dr.alert.rpo_breach", "s", map[string]any{"stream_id": "s"})
	evt.Time = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if got := Render(evt).OccurredAt; !got.Equal(evt.Time) {
		t.Fatalf("OccurredAt = %v, want %v", got, evt.Time)
	}
}
