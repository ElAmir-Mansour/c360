// Package connectors holds concrete connector.Connector implementations built
// purely on the connector SDK (internal/integration/connector). Each connector
// is a single self-contained file plus tests: it declares a Manifest (the
// config schema, capabilities and auth kind) and implements Send (and, where
// relevant, Test). Adding a connector is one New() + one registry.Register call
// in the integrate phase — no edits to any dispatch switch, config validator or
// main.go. This is the "config not code" proof.
package connectors

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/events"
)

// eventFields is a flattened, connector-friendly view of an events.Event: the
// envelope attributes plus the decoded data payload as a map. Connectors render
// notifications/tickets from these fields without each re-implementing JSON
// decoding and severity extraction.
type eventFields struct {
	// ID is the CloudEvents id.
	ID string
	// Type is the CloudEvents type (e.g. "com.clario360.cyber.alert.created").
	Type string
	// Source is the originating service.
	Source string
	// Subject is the resource id, if set.
	Subject string
	// TenantID is the owning tenant.
	TenantID string
	// UserID is the acting user, if set.
	UserID string
	// CorrelationID links related events.
	CorrelationID string
	// Severity is the lower-cased severity drawn from the payload (falls back to
	// "info" when absent). One of the Clario severities: critical/high/medium/
	// low/info.
	Severity string
	// Title is a best-effort human title for the event.
	Title string
	// Summary is a best-effort human summary/description.
	Summary string
	// Data is the decoded payload object (nil if the payload is not a JSON object).
	Data map[string]any
}

// extractEventFields decodes event into an eventFields view. It never errors:
// a non-object or empty payload simply yields a nil Data map and the envelope
// attributes are still populated, because notifications must be best-effort.
func extractEventFields(event *events.Event) eventFields {
	ef := eventFields{
		Severity: "info",
	}
	if event == nil {
		return ef
	}
	ef.ID = event.ID
	ef.Type = event.Type
	ef.Source = event.Source
	ef.Subject = event.Subject
	ef.TenantID = event.TenantID
	ef.UserID = event.UserID
	ef.CorrelationID = event.CorrelationID

	if len(event.Data) > 0 {
		var data map[string]any
		if err := json.Unmarshal(event.Data, &data); err == nil {
			ef.Data = data
		}
	}

	if sev := payloadSeverity(ef.Data); sev != "" {
		ef.Severity = sev
	}
	ef.Title = firstNonEmpty(
		dataString(ef.Data, "title"),
		dataString(ef.Data, "name"),
		dataString(ef.Data, "summary"),
		humanizeType(event.Type),
	)
	ef.Summary = firstNonEmpty(
		dataNestedString(ef.Data, "explanation", "summary"),
		dataString(ef.Data, "summary"),
		dataString(ef.Data, "description"),
		dataString(ef.Data, "message"),
	)
	return ef
}

// payloadSeverity reads the severity from the decoded payload, checking the
// common keys ClarioDR and the suites use. It returns "" when none is present.
func payloadSeverity(data map[string]any) string {
	if data == nil {
		return ""
	}
	for _, key := range []string{"severity", "level", "priority"} {
		if s := strings.ToLower(strings.TrimSpace(dataString(data, key))); s != "" {
			return s
		}
	}
	return ""
}

// dataString returns the string value at key, formatting non-string scalars
// with %v. It returns "" for absent keys or nested objects/arrays.
func dataString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	value, ok := data[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case map[string]any, []any:
		return ""
	default:
		return fmt.Sprintf("%v", v)
	}
}

// dataNestedString returns data[parent][child] as a string, or "".
func dataNestedString(data map[string]any, parent, child string) string {
	if data == nil {
		return ""
	}
	nested, ok := data[parent].(map[string]any)
	if !ok {
		return ""
	}
	return dataString(nested, child)
}

// humanizeType turns a CloudEvents dotted type into a readable phrase, e.g.
// "com.clario360.cyber.alert.created" -> "Cyber Alert Created".
func humanizeType(eventType string) string {
	t := strings.TrimPrefix(eventType, "com.clario360.")
	if t == "" {
		t = eventType
	}
	parts := strings.FieldsFunc(t, func(r rune) bool { return r == '.' || r == '_' })
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	out := strings.Join(parts, " ")
	if out == "" {
		return "Event"
	}
	return out
}

// firstNonEmpty returns the first argument whose trimmed value is non-empty.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// cfgString reads a string config value, tolerating the map[string]any shape
// configs arrive in. Missing/non-string values yield "".
func cfgString(cfg map[string]any, key string) string {
	if cfg == nil {
		return ""
	}
	if s, ok := cfg[key].(string); ok {
		return s
	}
	return ""
}

// cfgBool reads a bool config value, accepting native bool and the common
// string encodings ("true"/"false"). Missing/unparseable values yield def.
func cfgBool(cfg map[string]any, key string, def bool) bool {
	if cfg == nil {
		return def
	}
	switch v := cfg[key].(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	}
	return def
}

// cfgInt reads an int config value, accepting Go ints and JSON float64 with no
// fractional part. Missing/unparseable values yield def.
func cfgInt(cfg map[string]any, key string, def int) int {
	if cfg == nil {
		return def
	}
	switch v := cfg[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		if v == float64(int(v)) {
			return int(v)
		}
	}
	return def
}

// cfgStringSlice reads a list-of-strings config value. It accepts []string,
// []any (each formatted as a string), and a single comma-separated string. It
// returns nil when absent. Empty entries are dropped.
func cfgStringSlice(cfg map[string]any, key string) []string {
	if cfg == nil {
		return nil
	}
	raw, ok := cfg[key]
	if !ok || raw == nil {
		return nil
	}
	var out []string
	switch v := raw.(type) {
	case []string:
		for _, s := range v {
			if strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	case []any:
		for _, item := range v {
			s := strings.TrimSpace(fmt.Sprintf("%v", item))
			if s != "" {
				out = append(out, s)
			}
		}
	case string:
		for _, part := range strings.Split(v, ",") {
			if p := strings.TrimSpace(part); p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}

// cfgStringMap reads an object config value into a map[string]string, accepting
// both map[string]string and map[string]any (values formatted with %v). Returns
// nil when absent.
func cfgStringMap(cfg map[string]any, key string) map[string]string {
	if cfg == nil {
		return nil
	}
	raw, ok := cfg[key]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case map[string]string:
		out := make(map[string]string, len(v))
		for k, val := range v {
			out[k] = val
		}
		return out
	case map[string]any:
		out := make(map[string]string, len(v))
		for k, val := range v {
			if val == nil {
				continue
			}
			if s, ok := val.(string); ok {
				out[k] = s
				continue
			}
			out[k] = fmt.Sprintf("%v", val)
		}
		return out
	}
	return nil
}
