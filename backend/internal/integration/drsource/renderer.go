package drsource

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/events"
)

// Field is one labelled value in a rendered DR notification. Connectors that
// render structured output (Slack fields, Teams FactSet, email tables) iterate
// Fields; plain-text connectors join them.
type Field struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// Notification is the connector-agnostic, fully-rendered form of a DR event:
// everything a delivery target needs without re-parsing the raw payload. It is
// produced by Render and consumed by ToSlackBlocks / ToTeamsCard / ToGenericMap.
type Notification struct {
	// EventType is the canonical (trimmed) DR type, e.g.
	// "datastream.dr.alert.rpo_breach".
	EventType string `json:"event_type"`
	// Title is the one-line headline (label + key subject), e.g.
	// "RPO Breach — group tier-0".
	Title string `json:"title"`
	// Severity is the resolved severity (explicit payload severity wins, else
	// the catalog default).
	Severity Severity `json:"severity"`
	// Summary is a human sentence describing the event; the producer-supplied
	// "message" when present, otherwise a generated one.
	Summary string `json:"summary"`
	// Fields are the extracted, labelled details (RPO objective vs actual, RTO,
	// site, recovery point, drill achieved RTO/RPO, predicted horizon,
	// ransomware signal kinds, …) in display order.
	Fields []Field `json:"fields"`
	// Subject is the primary resource identifier (stream / group / run id),
	// taken from the event Subject or payload.
	Subject string `json:"subject,omitempty"`
	// TenantID is the owning tenant (from the event envelope).
	TenantID string `json:"tenant_id,omitempty"`
	// OccurredAt is the event time.
	OccurredAt time.Time `json:"occurred_at"`
}

// Render parses a DR *events.Event into a Notification. It never returns an
// error: an unrecognised or malformed payload still yields a usable, generic
// Notification (the integration engine must not drop a deliverable event just
// because its body was unexpected). Render is the single extraction entry point;
// the per-type extractors below pull the real producer field names.
func Render(event *events.Event) Notification {
	if event == nil {
		return Notification{Severity: SeverityInfo, Title: "DR Event"}
	}

	data := decodeData(event.Data)
	spec, known := Lookup(event.Type)

	n := Notification{
		EventType:  trimType(event.Type),
		Severity:   resolveSeverity(spec, known, data),
		Subject:    firstNonEmpty(event.Subject, extractString(data, "stream_id", "group_id", "run_id", "id")),
		TenantID:   firstNonEmpty(event.TenantID, extractString(data, "tenant_id")),
		OccurredAt: eventTime(event),
	}

	label := "DR Event"
	if known {
		label = spec.Label
	} else {
		label = humanizeType(n.EventType)
	}

	// Dispatch field extraction on the resolved leaf action so producer aliases
	// and the canonical types share one extractor.
	leaf := leafKey(n.EventType)
	if known {
		leaf = leafKey(spec.Type)
	}

	var fields []Field
	switch leaf {
	case "rpo_breach", "breached":
		fields = extractRPOBreach(data)
	case "rpo_recovered", "recovered":
		fields = extractRPOBreach(data) // same payload shape (rpo monitor)
	case "suspected":
		fields = extractRansomware(data)
	case "rpo_breach_forecast", "rpo_forecast_cleared", "throughput_collapse":
		fields = extractPrediction(data)
	case "gate_passed", "passed":
		fields = extractFailoverGate(data)
	case "failed":
		fields = extractFailoverFailed(data)
	case "issued":
		fields = extractAttestation(data)
	case "completed":
		fields = extractDrill(data)
	case "scheduled":
		fields = extractDrillScheduled(data)
	default:
		fields = extractGeneric(data)
	}
	n.Fields = fields
	n.Title = buildTitle(label, n.Subject, data)
	n.Summary = resolveSummary(data, label, n.Fields)
	return n
}

// resolveSeverity returns the explicit payload severity if it is a known
// severity, otherwise the catalog default, otherwise info. The ransomware /
// rpo producers stamp severity strings like "confirmed"/"error" that are not on
// the canonical ladder; those are normalised here.
func resolveSeverity(spec EventTypeSpec, known bool, data map[string]any) Severity {
	raw := strings.ToLower(strings.TrimSpace(extractString(data, "severity")))
	switch raw {
	case "critical", "confirmed", "fatal", "error":
		return SeverityCritical
	case "high", "warning":
		return SeverityHigh
	case "medium", "moderate", "notice":
		return SeverityMedium
	case "info", "low", "informational":
		return SeverityInfo
	}
	if Severity(raw).Valid() {
		return Severity(raw)
	}
	if known {
		return spec.DefaultSeverity
	}
	return SeverityInfo
}

// resolveSummary prefers a producer-supplied "message", else a "summary"/
// "description", else a one-line synthesis of the leading fields.
func resolveSummary(data map[string]any, label string, fields []Field) string {
	if msg := extractString(data, "message", "summary", "description"); msg != "" {
		return msg
	}
	if len(fields) == 0 {
		return label
	}
	parts := make([]string, 0, 3)
	for _, f := range fields {
		if len(parts) == 3 {
			break
		}
		parts = append(parts, fmt.Sprintf("%s: %s", f.Label, f.Value))
	}
	return label + " — " + strings.Join(parts, "; ")
}

// buildTitle assembles "<Label> — <qualifier>" using the most descriptive
// available subject (group/site/stream/run) so a chat headline is informative.
func buildTitle(label, subject string, data map[string]any) string {
	if q := extractString(data, "group_label"); q != "" {
		return fmt.Sprintf("%s — group %s", label, q)
	}
	if q := extractString(data, "site_name"); q != "" {
		return fmt.Sprintf("%s — site %s", label, q)
	}
	if q := extractString(data, "group_id"); q != "" {
		return fmt.Sprintf("%s — group %s", label, q)
	}
	if q := extractString(data, "stream_id"); q != "" {
		return fmt.Sprintf("%s — stream %s", label, q)
	}
	if subject != "" {
		return fmt.Sprintf("%s — %s", label, subject)
	}
	return label
}

// --- per-type field extractors -------------------------------------------
//
// Each extractor reads the REAL producer payload field names (gathered from
// internal/dr/{rpo,ransomware,predict,failover,gameday}) and emits a stable,
// ordered set of display Fields. Missing fields are skipped, not rendered blank.

// extractRPOBreach reads rpo.monitor.EventPayload (rpo.breached / rpo.recovered).
func extractRPOBreach(d map[string]any) []Field {
	f := newFields()
	f.add("Stream", extractString(d, "stream_id"))
	f.add("Site", firstNonEmpty(extractString(d, "site_name"), extractString(d, "site_id")))
	if kind := extractString(d, "site_kind"); kind != "" {
		f.add("Site Kind", kind)
	}
	f.addStatus("Status", extractString(d, "previous_status"), extractString(d, "status"))
	if obj, ok := extractInt(d, "rpo_objective_seconds"); ok {
		f.add("RPO Objective", humanizeDuration(float64(obj)))
	}
	if live, ok := extractInt(d, "live_rpo_seconds"); ok {
		f.add("RPO Actual", humanizeDuration(float64(live)))
	}
	if nc, ok := extractInt(d, "no_checkpoint_seconds"); ok {
		f.add("No Checkpoint For", humanizeDuration(float64(nc)))
	}
	if reason := extractString(d, "reason"); reason != "" {
		f.add("Reason", humanizeToken(reason))
	}
	return f.list
}

// extractRansomware reads ransomware.monitor.EventPayload (ransomware.suspected).
func extractRansomware(d map[string]any) []Field {
	f := newFields()
	f.add("Stream", extractString(d, "stream_id"))
	if kinds := extractStringSlice(d, "signal_kinds"); len(kinds) > 0 {
		humanized := make([]string, 0, len(kinds))
		for _, k := range kinds {
			humanized = append(humanized, humanizeToken(k))
		}
		f.add("Signal Kind", strings.Join(humanized, ", "))
	}
	if me, ok := extractFloat(d, "mean_entropy"); ok {
		f.add("Mean Entropy", fmt.Sprintf("%.2f", me))
	}
	if cp := extractString(d, "curated_recovery_point_id"); cp != "" {
		f.add("Clean Recovery Point", cp)
	} else {
		f.add("Clean Recovery Point", "none available")
	}
	if lsn := extractString(d, "source_lsn"); lsn != "" {
		f.add("Source LSN", lsn)
	}
	return f.list
}

// extractPrediction reads predict.AlertPayload (rpo_breach_forecast /
// rpo_forecast_cleared / throughput_collapse).
func extractPrediction(d map[string]any) []Field {
	f := newFields()
	f.add("Stream", extractString(d, "stream_id"))
	f.add("Group", extractString(d, "group_label"))
	if obj, ok := extractInt(d, "rpo_objective_seconds"); ok {
		f.add("RPO Objective", humanizeDuration(float64(obj)))
	}
	if lag, ok := extractFloat(d, "smoothed_lag_seconds"); ok {
		f.add("Smoothed Lag", humanizeDuration(lag))
	}
	if slope, ok := extractFloat(d, "lag_trend_slope"); ok {
		f.add("Lag Trend", fmt.Sprintf("%+.4f s/s", slope))
	}
	if h, ok := extractFloat(d, "predicted_breach_seconds"); ok {
		f.add("Predicted Breach In", humanizeDuration(h))
	}
	if breached, ok := extractBool(d, "already_breached"); ok && breached {
		f.add("Already Breached", "yes")
	}
	if tp, ok := extractFloat(d, "smoothed_throughput_bps"); ok {
		f.add("Throughput", humanizeBytesPerSec(tp))
	}
	if reason := extractString(d, "reason"); reason != "" {
		f.add("Reason", humanizeToken(reason))
	}
	return f.list
}

// extractFailoverGate reads the failover driver gate1.passed detail map
// (recovery_point_id, rpo_seconds, validation_ratio, plus the run mode/site).
func extractFailoverGate(d map[string]any) []Field {
	f := newFields()
	f.add("Recovery Point", extractString(d, "recovery_point_id"))
	if rpo, ok := extractInt(d, "rpo_seconds"); ok {
		f.add("RPO Actual", humanizeDuration(float64(rpo)))
	}
	if vr, ok := extractFloat(d, "validation_ratio"); ok {
		f.add("Validation Ratio", fmt.Sprintf("%.4f", vr))
	}
	if mode := extractString(d, "mode"); mode != "" {
		f.add("Mode", humanizeToken(mode))
	}
	f.add("Site", firstNonEmpty(extractString(d, "site_name"), extractString(d, "site_id")))
	if stage := extractString(d, "recovery_point_stage"); stage != "" {
		f.add("Gate", stage)
	}
	return f.list
}

// extractFailoverFailed reads the failover driver failed detail map (error,
// step, mode).
func extractFailoverFailed(d map[string]any) []Field {
	f := newFields()
	if step := extractString(d, "step"); step != "" {
		f.add("Failed Step", humanizeToken(step))
	}
	if mode := extractString(d, "mode"); mode != "" {
		f.add("Mode", humanizeToken(mode))
	}
	f.add("Error", extractString(d, "error"))
	return f.list
}

// extractAttestation reads the failover driver attestation.issued detail map
// (attestation_id, report_object_key, content_hash).
func extractAttestation(d map[string]any) []Field {
	f := newFields()
	f.add("Attestation", extractString(d, "attestation_id"))
	if rto, ok := extractInt(d, "rto_actual_seconds"); ok {
		f.add("RTO Achieved", humanizeDuration(float64(rto)))
	}
	f.add("Report Object", extractString(d, "report_object_key"))
	if h := extractString(d, "content_hash"); h != "" {
		f.add("Content Hash", shortHash(h))
	}
	return f.list
}

// extractDrill reads the gameday run.completed scorecard map (run_id, group_id,
// status, steps_total, steps_passed, score, all_faults_reverted) and the
// drillsched DrillResult achieved RTO/RPO when present.
func extractDrill(d map[string]any) []Field {
	f := newFields()
	f.add("Run", firstNonEmpty(extractString(d, "run_id"), extractString(d, "id")))
	f.add("Group", extractString(d, "group_id"))
	if status := extractString(d, "status"); status != "" {
		f.add("Outcome", humanizeToken(status))
	} else if passed, ok := extractBool(d, "passed"); ok {
		if passed {
			f.add("Outcome", "Passed")
		} else {
			f.add("Outcome", "Failed")
		}
	}
	total, hasTotal := extractInt(d, "steps_total")
	passed, hasPassed := extractInt(d, "steps_passed")
	if hasTotal && hasPassed {
		f.add("Steps Passed", fmt.Sprintf("%d / %d", passed, total))
	}
	if score, ok := extractFloat(d, "score"); ok {
		f.add("Score", fmt.Sprintf("%.0f%%", score*100))
	}
	if rto, ok := extractInt(d, "rto_achieved_seconds"); ok {
		f.add("RTO Achieved", humanizeDuration(float64(rto)))
	}
	if rpo, ok := extractInt(d, "rpo_achieved_seconds"); ok {
		f.add("RPO Achieved", humanizeDuration(float64(rpo)))
	}
	if reverted, ok := extractBool(d, "all_faults_reverted"); ok {
		if reverted {
			f.add("Faults Reverted", "all")
		} else {
			f.add("Faults Reverted", "incomplete")
		}
	}
	return f.list
}

// extractDrillScheduled reads the drillsched scheduled event (group_id, when).
func extractDrillScheduled(d map[string]any) []Field {
	f := newFields()
	f.add("Group", firstNonEmpty(extractString(d, "group_id"), extractString(d, "group_label")))
	f.add("Schedule", extractString(d, "schedule_id"))
	f.add("Scheduled For", extractString(d, "scheduled_for", "fire_at", "next_run_at"))
	return f.list
}

// extractGeneric is the fallback for a DR type with no dedicated extractor: it
// surfaces the scalar payload fields (sorted for determinism), skipping nested
// objects and obviously-internal keys, so the event is still readable.
func extractGeneric(d map[string]any) []Field {
	keys := make([]string, 0, len(d))
	for k := range d {
		switch k {
		case "tenant_id", "severity", "message", "summary", "description":
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	f := newFields()
	for _, k := range keys {
		switch v := d[k].(type) {
		case map[string]any, []any:
			continue // skip nested structures in the generic view
		case nil:
			continue
		default:
			f.add(humanizeToken(k), stringOf(v))
		}
	}
	return f.list
}

// --- field accumulator ----------------------------------------------------

type fieldList struct{ list []Field }

func newFields() *fieldList { return &fieldList{} }

// add appends a Field iff value is non-empty (whitespace-trimmed).
func (f *fieldList) add(label, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	f.list = append(f.list, Field{Label: label, Value: value})
}

// addStatus renders a "prev -> next" transition when prev differs from next,
// otherwise just the current status.
func (f *fieldList) addStatus(label, prev, next string) {
	switch {
	case next == "":
		return
	case prev != "" && prev != next:
		f.add(label, fmt.Sprintf("%s -> %s", humanizeToken(prev), humanizeToken(next)))
	default:
		f.add(label, humanizeToken(next))
	}
}

// --- value extraction helpers --------------------------------------------

func decodeData(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func eventTime(e *events.Event) time.Time {
	if !e.Time.IsZero() {
		return e.Time
	}
	if !e.Timestamp.IsZero() {
		return e.Timestamp
	}
	return time.Now().UTC()
}

func extractString(d map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := d[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if strings.TrimSpace(t) != "" {
				return t
			}
		case json.Number:
			return t.String()
		}
	}
	return ""
}

// extractInt reads an integer that may have been JSON-decoded as float64,
// json.Number, an int, or a *int (pointer payloads like live_rpo_seconds). A
// fractional float64 is rejected (ok=false).
func extractInt(d map[string]any, key string) (int64, bool) {
	v, ok := d[key]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		if t != math.Trunc(t) {
			return 0, false
		}
		return int64(t), true
	case int:
		return int64(t), true
	case int64:
		return t, true
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return i, true
		}
		if fl, err := t.Float64(); err == nil && fl == math.Trunc(fl) {
			return int64(fl), true
		}
	case string:
		if i, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64); err == nil {
			return i, true
		}
	}
	return 0, false
}

func extractFloat(d map[string]any, key string) (float64, bool) {
	v, ok := d[key]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		if fl, err := t.Float64(); err == nil {
			return fl, true
		}
	case string:
		if fl, err := strconv.ParseFloat(strings.TrimSpace(t), 64); err == nil {
			return fl, true
		}
	}
	return 0, false
}

func extractBool(d map[string]any, key string) (bool, bool) {
	v, ok := d[key]
	if !ok || v == nil {
		return false, false
	}
	switch t := v.(type) {
	case bool:
		return t, true
	case string:
		if b, err := strconv.ParseBool(strings.TrimSpace(t)); err == nil {
			return b, true
		}
	}
	return false, false
}

func extractStringSlice(d map[string]any, key string) []string {
	v, ok := d[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// --- formatting helpers ---------------------------------------------------

func stringOf(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == math.Trunc(t) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	case json.Number:
		return t.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// humanizeToken turns "rpo_breach_forecast" / "sync-confirmed" into "Rpo Breach
// Forecast" / "Sync Confirmed" for display.
func humanizeToken(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	repl := strings.NewReplacer("_", " ", "-", " ", ".", " ")
	words := strings.Fields(repl.Replace(s))
	for i, w := range words {
		switch strings.ToUpper(w) {
		case "RPO", "RTO", "ID", "LSN", "DR", "URL":
			words[i] = strings.ToUpper(w)
		default:
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// humanizeType turns "datastream.dr.foo.bar_baz" into "Foo Bar Baz" for an
// unknown DR type's display label.
func humanizeType(trimmed string) string {
	t := strings.TrimPrefix(trimmed, "datastream.dr.")
	t = strings.TrimPrefix(t, "dr.")
	return humanizeToken(t)
}

// humanizeDuration renders a seconds count as a compact human duration:
// "45s", "3m 20s", "2h 5m", "1d 3h".
func humanizeDuration(seconds float64) string {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return "n/a"
	}
	neg := seconds < 0
	total := int64(math.Round(math.Abs(seconds)))
	var out string
	switch {
	case total < 60:
		out = fmt.Sprintf("%ds", total)
	case total < 3600:
		out = fmt.Sprintf("%dm %ds", total/60, total%60)
	case total < 86400:
		out = fmt.Sprintf("%dh %dm", total/3600, (total%3600)/60)
	default:
		out = fmt.Sprintf("%dd %dh", total/86400, (total%86400)/3600)
	}
	if neg {
		return "-" + out
	}
	return out
}

// humanizeBytesPerSec renders a bytes/sec rate with a binary unit suffix.
func humanizeBytesPerSec(bps float64) string {
	if math.IsNaN(bps) || math.IsInf(bps, 0) {
		return "n/a"
	}
	abs := math.Abs(bps)
	units := []string{"B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"}
	i := 0
	for abs >= 1024 && i < len(units)-1 {
		abs /= 1024
		i++
	}
	sign := ""
	if bps < 0 {
		sign = "-"
	}
	if i == 0 {
		return fmt.Sprintf("%s%.0f %s", sign, abs, units[i])
	}
	return fmt.Sprintf("%s%.1f %s", sign, abs, units[i])
}

// shortHash truncates a long content hash for display, keeping it identifiable.
func shortHash(h string) string {
	if len(h) <= 16 {
		return h
	}
	return h[:12] + "…"
}
