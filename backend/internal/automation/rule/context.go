package rule

import (
	"encoding/json"

	"github.com/clario360/platform/internal/events"
)

// BuildContext assembles the data context the expression DSL evaluates a rule
// against. It mirrors the workflow engine's context shape verbatim
// (internal/workflow/executor.buildDataContext / engine_service.buildExpression
// Context) so a rule author uses ONE grammar and ONE context shape across
// workflow transitions and automation rules:
//
//	{
//	  "trigger":   {"data": <trigger payload>},
//	  "data":      <trigger payload>,   // convenience alias for `trigger.data`
//	  "variables": <automation variables>,
//	}
//
// `trigger.data.<path>` is the canonical reference (matches workflow); `data.
// <path>` is an alias so the same payload can be reached either way. Both the
// payload and the variables are deep-normalized to map[string]interface{} /
// []interface{} so the Evaluator's resolvePath (which type-asserts
// map[string]interface{} at every segment) can walk them regardless of the
// concrete Go types the trigger source built — e.g. a payload assembled with
// map[string]string nested values, or numeric values as int rather than the
// float64 a JSON decode would yield.
func BuildContext(t FiredTrigger) map[string]any {
	data := normalizeMap(t.Data)
	vars := normalizeMap(t.Variables)
	return map[string]any{
		"trigger": map[string]any{
			"data": data,
		},
		"data":      data,
		"variables": vars,
	}
}

// FiredTriggerFromEvent builds a FiredTrigger from a bus event (the event and
// threshold trigger sources, WP-9). The event's data JSON becomes the trigger
// payload; the event ID is the exactly-once source key. Variables may be nil.
// It returns an error only if the event's data is present but not valid JSON.
func FiredTriggerFromEvent(ev *events.Event, automationID string, variables map[string]any) (FiredTrigger, error) {
	ft := FiredTrigger{
		TenantID:      ev.TenantID,
		AutomationID:  automationID,
		SourceEventID: ev.ID,
		Type:          ev.Type,
		Variables:     variables,
	}
	if len(ev.Data) > 0 {
		var decoded map[string]any
		if err := json.Unmarshal(ev.Data, &decoded); err != nil {
			return ft, err
		}
		ft.Data = decoded
	} else {
		ft.Data = map[string]any{}
	}
	return ft, nil
}

// normalizeMap deep-converts an arbitrary map into the map[string]interface{} /
// []interface{} tree the Evaluator can resolve. A nil input yields an empty (not
// nil) map so `trigger.data` is always a resolvable map node rather than a path
// error at the root.
func normalizeMap(m map[string]any) map[string]any {
	if len(m) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = normalizeValue(v)
	}
	return out
}

// normalizeValue recursively converts a value into the shape the Evaluator
// understands: maps become map[string]interface{}, slices become
// []interface{}, scalars pass through. Maps with non-string keys (rare, e.g.
// map[interface{}]interface{} from some YAML decoders) are converted by
// stringifying keys; anything that cannot be handled structurally is JSON-round-
// tripped as a last resort so no input ever defeats path resolution.
func normalizeValue(v any) any {
	switch val := v.(type) {
	case nil:
		return nil
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			out[k] = normalizeValue(vv)
		}
		return out
	case map[string]string:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			out[k] = vv
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			out[keyString(k)] = normalizeValue(vv)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, e := range val {
			out[i] = normalizeValue(e)
		}
		return out
	case []string:
		out := make([]any, len(val))
		for i, e := range val {
			out[i] = e
		}
		return out
	case []int:
		out := make([]any, len(val))
		for i, e := range val {
			out[i] = e
		}
		return out
	case string, bool, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return val
	default:
		// Structurally unknown (e.g. a struct from a typed trigger source).
		// JSON-round-trip into the canonical map/slice tree so the Evaluator can
		// still walk it; if it cannot be marshalled, return it unchanged (a
		// scalar-leaf that compares by fmt.Sprintf in the DSL).
		b, err := json.Marshal(val)
		if err != nil {
			return val
		}
		var decoded any
		if err := json.Unmarshal(b, &decoded); err != nil {
			return val
		}
		return normalizeValue(decoded)
	}
}

// keyString renders a non-string map key as a string for the canonical map.
func keyString(k any) string {
	if s, ok := k.(string); ok {
		return s
	}
	b, err := json.Marshal(k)
	if err != nil {
		return ""
	}
	// JSON-marshalled string keys are quoted; strip the surrounding quotes for
	// the common string-in-interface case, otherwise use the raw marshalling.
	s := string(b)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}
