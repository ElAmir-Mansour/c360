package drsource

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
)

// TestNewEventTransform_NonDREventUnchanged confirms a non-DR event is returned
// as the SAME pointer with no mutation, so every connector behaves identically to
// the pre-wiring path for ordinary events (parity for the five existing
// connectors).
func TestNewEventTransform_NonDREventUnchanged(t *testing.T) {
	transform := NewEventTransform("https://app.clario360.example")
	evt, err := events.NewEvent("cyber.alert.created", "clario", testTenant, map[string]any{"title": "Brute force", "severity": "high"})
	if err != nil {
		t.Fatalf("new event: %v", err)
	}
	originalData := string(evt.Data)

	out := transform(evt)
	if out != evt {
		t.Fatalf("non-DR event should be returned unchanged (same pointer)")
	}
	if string(out.Data) != originalData {
		t.Fatalf("non-DR event data mutated: before=%s after=%s", originalData, out.Data)
	}
}

// TestNewEventTransform_DREventEnriched confirms a DR event's Data is rewritten
// with the rendered title/severity/summary/fields, that the original event is not
// mutated (a clone is returned), and that producer fields survive underneath.
func TestNewEventTransform_DREventEnriched(t *testing.T) {
	transform := NewEventTransform("https://app.clario360.example")

	payload := map[string]any{
		"tenant_id":             testTenant,
		"stream_id":             "stream-7",
		"site_name":             "tier-0",
		"previous_status":       "healthy",
		"status":                "degraded",
		"rpo_objective_seconds": 60,
		"live_rpo_seconds":      95,
	}
	evt := newDREvent(t, "datastream.dr.alert.rpo_breach", "stream-7", payload)
	evt.Time = time.Date(2026, 6, 13, 9, 30, 0, 0, time.UTC)
	before := string(evt.Data)

	out := transform(evt)
	if out == evt {
		t.Fatalf("DR transform should return a clone, not the same pointer")
	}
	if string(evt.Data) != before {
		t.Fatalf("original event data was mutated")
	}

	var merged map[string]any
	if err := json.Unmarshal(out.Data, &merged); err != nil {
		t.Fatalf("unmarshal transformed data: %v", err)
	}

	// Rendered presentation fields the connectors read.
	if got, _ := merged["severity"].(string); got != "critical" {
		t.Errorf("severity = %q, want critical (RPO breach catalog default)", got)
	}
	title, _ := merged["title"].(string)
	if title == "" {
		t.Errorf("title not set on enriched payload")
	}
	if _, ok := merged["fields"]; !ok {
		t.Errorf("fields not set on enriched payload (rest/email/PD rendering)")
	}
	if _, ok := merged["field_map"]; !ok {
		t.Errorf("field_map not set on enriched payload")
	}
	if desc, _ := merged["description"].(string); desc == "" {
		t.Errorf("description (legacy slack/teams summary) not set")
	}
	// Producer fields survive underneath the rendered overlay.
	if got, _ := merged["stream_id"].(string); got != "stream-7" {
		t.Errorf("producer field stream_id lost: %q", got)
	}
	// Deep link built from appURL + subject.
	if url, _ := merged["url"].(string); url == "" {
		t.Errorf("deep link url not set")
	}
}

// TestNewEventTransform_NilEvent confirms a nil event is handled (returns nil)
// rather than panicking.
func TestNewEventTransform_NilEvent(t *testing.T) {
	transform := NewEventTransform("https://app.clario360.example")
	if out := transform(nil); out != nil {
		t.Fatalf("nil event should map to nil, got %+v", out)
	}
}
