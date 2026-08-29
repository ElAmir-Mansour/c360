package drsource

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
)

const testTenant = "11111111-0000-0000-0000-000000000001"

// newDREvent builds a real CloudEvents-compliant DR event with the given
// trimmed type and payload, exactly as the internal/dr producers do (via
// events.NewEvent, which prefixes "com.clario360.").
func newDREvent(t *testing.T, eventType, subject string, payload any) *events.Event {
	t.Helper()
	evt, err := events.NewEvent(eventType, "clario-dr-service", testTenant, payload)
	if err != nil {
		t.Fatalf("NewEvent(%s): %v", eventType, err)
	}
	evt.Subject = subject
	// Pin a deterministic time so title/context assertions are stable.
	evt.Time = time.Date(2026, 6, 13, 9, 30, 0, 0, time.UTC)
	evt.Timestamp = evt.Time
	return evt
}

// fieldValue returns the rendered value for a field label, or "" if absent.
func fieldValue(n Notification, label string) string {
	for _, f := range n.Fields {
		if f.Label == label {
			return f.Value
		}
	}
	return ""
}

func hasField(n Notification, label string) bool {
	for _, f := range n.Fields {
		if f.Label == label {
			return true
		}
	}
	return false
}

func TestRender_RPOBreach(t *testing.T) {
	// Mirrors rpo.monitor.EventPayload for a breach.
	live := int64(95)
	payload := map[string]any{
		"tenant_id":             testTenant,
		"stream_id":             "stream-7",
		"site_id":               "site-dr-1",
		"site_name":             "tier-0",
		"site_kind":             "secondary",
		"previous_status":       "healthy",
		"status":                "degraded",
		"rpo_objective_seconds": 60,
		"live_rpo_seconds":      live,
		"reason":                "rpo_objective_exceeded",
		"message":               "live RPO 95s exceeds objective 60s",
	}
	// Use the canonical SOURCE-contract type.
	evt := newDREvent(t, "datastream.dr.alert.rpo_breach", "stream-7", payload)
	n := Render(evt)

	if n.Severity != SeverityCritical {
		t.Fatalf("severity = %q, want critical", n.Severity)
	}
	if !strings.Contains(n.Title, "RPO Breach") || !strings.Contains(n.Title, "tier-0") {
		t.Fatalf("title = %q, want RPO Breach + site tier-0", n.Title)
	}
	if got := fieldValue(n, "RPO Objective"); got != "1m 0s" {
		t.Fatalf("RPO Objective = %q, want 1m 0s", got)
	}
	if got := fieldValue(n, "RPO Actual"); got != "1m 35s" {
		t.Fatalf("RPO Actual = %q, want 1m 35s", got)
	}
	if got := fieldValue(n, "Status"); got != "Healthy -> Degraded" {
		t.Fatalf("Status = %q, want transition", got)
	}
	if n.Summary != "live RPO 95s exceeds objective 60s" {
		t.Fatalf("summary = %q, want producer message", n.Summary)
	}
	if n.Subject != "stream-7" {
		t.Fatalf("subject = %q", n.Subject)
	}
}

func TestRender_RPOBreach_ProducerAlias(t *testing.T) {
	// The rpo monitor stages the raw "rpo.breached" type, not the contract
	// spelling. The renderer must resolve it via the alias.
	payload := map[string]any{
		"stream_id":             "s1",
		"status":                "error",
		"rpo_objective_seconds": 30,
		"no_checkpoint_seconds": int64(120),
		"reason":                "no_applied_checkpoint",
	}
	evt := newDREvent(t, "rpo.breached", "s1", payload)
	n := Render(evt)
	if n.EventType != "rpo.breached" {
		t.Fatalf("event type = %q", n.EventType)
	}
	if n.Severity != SeverityCritical {
		t.Fatalf("severity = %q, want critical via alias", n.Severity)
	}
	if got := fieldValue(n, "No Checkpoint For"); got != "2m 0s" {
		t.Fatalf("No Checkpoint For = %q, want 2m 0s", got)
	}
}

func TestRender_RansomwareSuspected(t *testing.T) {
	// Mirrors ransomware.monitor.EventPayload (severity "confirmed").
	payload := map[string]any{
		"tenant_id":                 testTenant,
		"stream_id":                 "stream-9",
		"severity":                  "confirmed",
		"signal_kinds":              []any{"entropy", "byte_rate"},
		"mean_entropy":              7.92,
		"curated_recovery_point_id": "rp-clean-42",
		"source_lsn":                "0/16B3F8",
	}
	evt := newDREvent(t, "dr.ransomware.suspected", "stream-9", payload)
	n := Render(evt)

	if n.Severity != SeverityCritical {
		t.Fatalf("severity = %q, want critical (confirmed)", n.Severity)
	}
	if got := fieldValue(n, "Signal Kind"); got != "Entropy, Byte Rate" {
		t.Fatalf("Signal Kind = %q, want humanized kinds", got)
	}
	if got := fieldValue(n, "Mean Entropy"); got != "7.92" {
		t.Fatalf("Mean Entropy = %q", got)
	}
	if got := fieldValue(n, "Clean Recovery Point"); got != "rp-clean-42" {
		t.Fatalf("Clean Recovery Point = %q", got)
	}
	if !strings.Contains(n.Title, "Ransomware Suspected") {
		t.Fatalf("title = %q", n.Title)
	}
}

func TestRender_FailoverGatePassed(t *testing.T) {
	// Mirrors the failover driver gate1.passed detail map.
	payload := map[string]any{
		"recovery_point_id":    "rp-1001",
		"rpo_seconds":          12,
		"validation_ratio":     0.9994,
		"mode":                 "live",
		"recovery_point_stage": "gate1.validate",
	}
	// Producer alias spelling.
	evt := newDREvent(t, "datastream.dr.failover.gate1.passed", "run-55", payload)
	n := Render(evt)

	if n.Severity != SeverityHigh {
		t.Fatalf("severity = %q, want high", n.Severity)
	}
	if got := fieldValue(n, "Recovery Point"); got != "rp-1001" {
		t.Fatalf("Recovery Point = %q", got)
	}
	if got := fieldValue(n, "RPO Actual"); got != "12s" {
		t.Fatalf("RPO Actual = %q", got)
	}
	if got := fieldValue(n, "Validation Ratio"); got != "0.9994" {
		t.Fatalf("Validation Ratio = %q", got)
	}
	if got := fieldValue(n, "Mode"); got != "Live" {
		t.Fatalf("Mode = %q", got)
	}
	if !strings.Contains(n.Title, "Failover Gate Passed") {
		t.Fatalf("title = %q", n.Title)
	}
}

func TestRender_DrillCompleted(t *testing.T) {
	// Mirrors the gameday orchestrator run.completed scorecard map, plus the
	// drillsched DrillResult achieved RTO/RPO.
	payload := map[string]any{
		"run_id":               "run-77",
		"group_id":             "grp-payments",
		"status":               "completed",
		"steps_total":          5,
		"steps_passed":         5,
		"score":                1.0,
		"all_faults_reverted":  true,
		"rto_achieved_seconds": 600,
		"rpo_achieved_seconds": 120,
	}
	evt := newDREvent(t, "datastream.dr.gameday.run.completed", "run-77", payload)
	n := Render(evt)

	if n.Severity != SeverityMedium {
		t.Fatalf("severity = %q, want medium", n.Severity)
	}
	if got := fieldValue(n, "Steps Passed"); got != "5 / 5" {
		t.Fatalf("Steps Passed = %q", got)
	}
	if got := fieldValue(n, "Score"); got != "100%" {
		t.Fatalf("Score = %q", got)
	}
	if got := fieldValue(n, "RTO Achieved"); got != "10m 0s" {
		t.Fatalf("RTO Achieved = %q, want 10m 0s", got)
	}
	if got := fieldValue(n, "RPO Achieved"); got != "2m 0s" {
		t.Fatalf("RPO Achieved = %q, want 2m 0s", got)
	}
	if got := fieldValue(n, "Faults Reverted"); got != "all" {
		t.Fatalf("Faults Reverted = %q", got)
	}
	if !strings.Contains(n.Title, "DR Drill Completed") {
		t.Fatalf("title = %q", n.Title)
	}
}

func TestRender_PredictionRPOBreachForecast(t *testing.T) {
	// Mirrors predict.AlertPayload.
	horizon := 180.0
	payload := map[string]any{
		"tenant_id":                testTenant,
		"stream_id":                "stream-3",
		"group_label":              "tier-1",
		"rpo_objective_seconds":    300,
		"smoothed_lag_seconds":     210.0,
		"lag_trend_slope":          0.5123,
		"predicted_breach_seconds": horizon,
		"already_breached":         false,
		"smoothed_throughput_bps":  4_500_000.0,
		"reason":                   "rpo_breach_forecast",
		"message":                  "RPO breach forecast for stream stream-3",
	}
	evt := newDREvent(t, "dr.prediction.rpo_breach_forecast", "stream-3", payload)
	n := Render(evt)

	if n.Severity != SeverityHigh {
		t.Fatalf("severity = %q, want high", n.Severity)
	}
	if got := fieldValue(n, "Predicted Breach In"); got != "3m 0s" {
		t.Fatalf("Predicted Breach In = %q, want 3m 0s", got)
	}
	if got := fieldValue(n, "Smoothed Lag"); got != "3m 30s" {
		t.Fatalf("Smoothed Lag = %q, want 3m 30s", got)
	}
	if got := fieldValue(n, "Lag Trend"); got != "+0.5123 s/s" {
		t.Fatalf("Lag Trend = %q", got)
	}
	if got := fieldValue(n, "Throughput"); got != "4.3 MiB/s" {
		t.Fatalf("Throughput = %q", got)
	}
	if got := fieldValue(n, "Group"); got != "tier-1" {
		t.Fatalf("Group = %q", got)
	}
}

func TestRender_SeverityResolution(t *testing.T) {
	cases := []struct {
		name      string
		eventType string
		payloadSv string
		want      Severity
	}{
		{"explicit critical wins", "datastream.dr.drill.completed", "critical", SeverityCritical},
		{"confirmed maps critical", "dr.ransomware.suspected", "confirmed", SeverityCritical},
		{"warning maps high", "datastream.dr.alert.rpo_breach", "warning", SeverityHigh},
		{"no severity uses catalog default (alert critical)", "datastream.dr.alert.rpo_breach", "", SeverityCritical},
		{"no severity uses catalog default (forecast high)", "dr.prediction.rpo_breach_forecast", "", SeverityHigh},
		{"unknown type defaults info", "datastream.dr.unknown.thing", "", SeverityInfo},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := map[string]any{"stream_id": "x"}
			if tc.payloadSv != "" {
				payload["severity"] = tc.payloadSv
			}
			evt := newDREvent(t, tc.eventType, "x", payload)
			if got := Render(evt).Severity; got != tc.want {
				t.Fatalf("severity = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRender_NilAndMalformed(t *testing.T) {
	if n := Render(nil); n.Severity != SeverityInfo || n.Title == "" {
		t.Fatalf("nil event render = %+v, want safe default", n)
	}

	// Malformed (non-object) JSON data must still yield a usable notification.
	evt := &events.Event{
		ID:       "e1",
		Type:     "com.clario360.datastream.dr.alert.rpo_breach",
		TenantID: testTenant,
		Time:     time.Now().UTC(),
		Data:     json.RawMessage(`"not an object"`),
	}
	n := Render(evt)
	if n.EventType != "datastream.dr.alert.rpo_breach" {
		t.Fatalf("event type = %q", n.EventType)
	}
	if n.Severity != SeverityCritical { // catalog default still applies
		t.Fatalf("severity = %q, want critical default", n.Severity)
	}
}

func TestRender_UnknownDRTypeGenericFields(t *testing.T) {
	payload := map[string]any{
		"tenant_id":  testTenant,
		"region":     "eu-west",
		"node_count": 4,
		"healthy":    true,
		"nested":     map[string]any{"skip": "me"}, // must be skipped
	}
	evt := newDREvent(t, "datastream.dr.cluster.rebalanced", "c1", payload)
	n := Render(evt)
	if n.Severity != SeverityInfo {
		t.Fatalf("severity = %q, want info", n.Severity)
	}
	if got := fieldValue(n, "Region"); got != "eu-west" {
		t.Fatalf("Region = %q", got)
	}
	if got := fieldValue(n, "Node Count"); got != "4" {
		t.Fatalf("Node Count = %q", got)
	}
	if got := fieldValue(n, "Healthy"); got != "true" {
		t.Fatalf("Healthy = %q", got)
	}
	if hasField(n, "Nested") {
		t.Fatalf("nested object must be skipped in generic view")
	}
	// tenant_id must be excluded from the generic field view.
	if hasField(n, "Tenant Id") {
		t.Fatalf("tenant_id must not be a generic field")
	}
}

func TestExtractInt_FractionalRejected(t *testing.T) {
	d := map[string]any{"whole": 12.0, "frac": 12.5, "str": "7", "i": 3}
	if v, ok := extractInt(d, "whole"); !ok || v != 12 {
		t.Fatalf("whole = %d,%v", v, ok)
	}
	if _, ok := extractInt(d, "frac"); ok {
		t.Fatalf("fractional float must be rejected as int")
	}
	if v, ok := extractInt(d, "str"); !ok || v != 7 {
		t.Fatalf("string int = %d,%v", v, ok)
	}
	if v, ok := extractInt(d, "i"); !ok || v != 3 {
		t.Fatalf("int = %d,%v", v, ok)
	}
}

func TestHumanizeDuration(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{45, "45s"},
		{200, "3m 20s"},
		{7500, "2h 5m"},
		{97200, "1d 3h"},
		{0, "0s"},
		{-30, "-30s"},
	}
	for _, tc := range cases {
		if got := humanizeDuration(tc.in); got != tc.want {
			t.Fatalf("humanizeDuration(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
