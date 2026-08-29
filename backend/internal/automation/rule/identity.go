package rule

import (
	"encoding/json"

	"github.com/clario360/platform/internal/automation/model"
)

// actionIdentity returns a stable string identity for an action used to suppress
// duplicates: two matched rules that resolve to the SAME action (same kind AND
// same config) contribute the action only once. The config is serialized with
// encoding/json, which marshals map keys in sorted order, so the identity is
// independent of Go map iteration order and is stable across calls.
//
// If the config cannot be marshalled (it never should for the JSON-friendly
// shapes an ActionRef carries), the identity falls back to the kind plus a Go
// value rendering — still deterministic for a given value, and conservative
// (distinct unmarshalable configs may collide, which only over-suppresses; it
// never causes a duplicate to slip through).
func actionIdentity(a model.ActionRef) string {
	cfg, err := json.Marshal(a.Config)
	if err != nil {
		return a.Kind + "\x00" + sprintfConfig(a.Config)
	}
	return a.Kind + "\x00" + string(cfg)
}

// sprintfConfig is the marshalling fallback for actionIdentity. It is only
// reached for configs encoding/json refuses (e.g. an unsupported type smuggled
// into the map); it renders deterministically for a given value.
func sprintfConfig(cfg map[string]any) string {
	// A second json attempt over a fmt-rendered copy would still fail; instead
	// build a stable rendering by sorting keys ourselves.
	if len(cfg) == 0 {
		return "{}"
	}
	keys := make([]string, 0, len(cfg))
	for k := range cfg {
		keys = append(keys, k)
	}
	sortStrings(keys)
	out := "{"
	for i, k := range keys {
		if i > 0 {
			out += ","
		}
		out += k + "=" + renderValue(cfg[k])
	}
	return out + "}"
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

func renderValue(v any) string {
	if b, err := json.Marshal(v); err == nil {
		return string(b)
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}
