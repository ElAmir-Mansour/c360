package integration

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// =============================================================================
// Integration EXTENSIBILITY #19 — transform / filter rules engine.
//
// A connector's config may carry a sync_rules array (RuleSpec[]). During a sync
// the connector runs the pulled records through a RulePipeline BEFORE reconcile:
// transforms rewrite field values in place; filters drop records that fail a
// predicate. The same pipeline drives the dry-run preview (#5) so an operator sees
// exactly what the rules WOULD do.
//
// The engine is PURE: RulePipeline.Apply takes a slice of flat string->any record
// maps and a rule list, and returns the transformed/filtered slice plus a count of
// records dropped by filters. It performs NO IO, holds NO state, and never logs —
// so it is trivially unit-tested (rules_engine_test.go) and reusable from both the
// live sync path and the preview path.
//
// Records are the NEUTRAL map shape the connector hands the engine (e.g. a CSV row,
// a SCIM resource, a custom-connector response record). The engine mutates copies,
// never the caller's input maps.
// =============================================================================

// RuleType is the kind of a sync rule: a value transform or a record filter.
type RuleType string

const (
	// RuleTypeTransform rewrites a field's value on every record.
	RuleTypeTransform RuleType = "transform"
	// RuleTypeFilter drops records that do not satisfy the predicate.
	RuleTypeFilter RuleType = "filter"
)

// Transform ops (RuleSpec.Op when Type == transform).
const (
	// TransformConcat sets Field to the concatenation of args[1:] values, where each
	// arg is either a literal or a {field} reference, joined by args[0] (separator).
	TransformConcat = "concat"
	// TransformLookup maps the current Field value through a key=value table supplied
	// in args ("key=value" entries); an unmatched value is left unchanged unless a
	// "*=default" entry is present.
	TransformLookup = "lookup"
	// TransformDefault sets Field to args[0] ONLY when the field is missing/empty.
	TransformDefault = "default"
	// TransformRegex replaces matches of args[0] (a regexp) in Field with args[1].
	TransformRegex = "regex"
	// TransformDateFormat reparses Field from layout args[0] to layout args[1] (Go
	// reference layouts, or the aliases iso8601 / rfc3339 / date / unix).
	TransformDateFormat = "date_format"
)

// Filter ops (RuleSpec.Op when Type == filter). The predicate is applied to Field.
const (
	FilterEq     = "eq"     // keep when Field == args[0]
	FilterNe     = "ne"     // keep when Field != args[0]
	FilterIn     = "in"     // keep when Field is one of args
	FilterExists = "exists" // keep when Field is present + non-empty
	FilterGt     = "gt"     // keep when numeric(Field) > numeric(args[0])
	FilterLt     = "lt"     // keep when numeric(Field) < numeric(args[0])
)

// RuleSpec is one transform/filter rule as stored in config.sync_rules. It is the
// wire shape the console form edits and the connector reads from decrypted config.
type RuleSpec struct {
	// Type selects transform vs filter.
	Type RuleType `json:"type"`
	// Op is the operation within the type (concat|lookup|default|regex|date_format
	// for transforms; eq|ne|in|exists|gt|lt for filters).
	Op string `json:"op"`
	// Field is the record field the rule reads (filters) or writes (transforms).
	Field string `json:"field"`
	// Args parametrise the op (separator+sources for concat, table for lookup, the
	// comparison operand(s) for filters, etc.).
	Args []string `json:"args,omitempty"`
}

// SyncRulesKey is the config map key holding the RuleSpec array (#19). The
// connector reads it from decrypted config and the schema declares it (schema.go).
const SyncRulesKey = "sync_rules"

// RulePipeline applies an ordered RuleSpec list to a record stream. It is a pure
// value type with no dependencies; build one per sync (it is cheap) and call Apply.
type RulePipeline struct {
	rules []RuleSpec
}

// NewRulePipeline builds a pipeline from a rule list. A nil/empty list is a valid
// pass-through pipeline (Apply returns the records unchanged).
func NewRulePipeline(rules []RuleSpec) RulePipeline {
	return RulePipeline{rules: rules}
}

// ParseSyncRules extracts the RuleSpec list from a decrypted config map's
// sync_rules key, tolerating the JSON round-trip shape ([]any of map[string]any)
// the config takes through encryption + the masked-config echo. An absent/blank/
// malformed value yields an empty list (pass-through), never an error — a bad rule
// must not break a sync; it is simply ignored.
func ParseSyncRules(config map[string]any) []RuleSpec {
	if config == nil {
		return nil
	}
	raw, ok := config[SyncRulesKey]
	if !ok || raw == nil {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]RuleSpec, 0, len(arr))
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		spec := RuleSpec{
			Type:  RuleType(strings.ToLower(strings.TrimSpace(ruleString(m["type"])))),
			Op:    strings.ToLower(strings.TrimSpace(ruleString(m["op"]))),
			Field: strings.TrimSpace(ruleString(m["field"])),
		}
		if args, ok := m["args"].([]any); ok {
			for _, a := range args {
				spec.Args = append(spec.Args, ruleString(a))
			}
		}
		if spec.Type == "" || spec.Op == "" {
			continue
		}
		out = append(out, spec)
	}
	return out
}

// Apply runs every rule, in order, over the records. Transforms rewrite a field on
// each record; filters drop records that fail the predicate. It returns the kept
// records (copies — the caller's maps are never mutated) and the number of records
// dropped by filters. An unrecognised op is a no-op (skipped), so a forward-compat
// rule from a newer console never corrupts a sync.
func (p RulePipeline) Apply(records []map[string]any) (kept []map[string]any, dropped int) {
	// Copy each record so the engine is pure w.r.t. the caller's input.
	work := make([]map[string]any, 0, len(records))
	for _, rec := range records {
		work = append(work, copyRecord(rec))
	}
	for _, rule := range p.rules {
		switch rule.Type {
		case RuleTypeTransform:
			for i := range work {
				applyTransform(work[i], rule)
			}
		case RuleTypeFilter:
			next := work[:0]
			for _, rec := range work {
				if filterKeeps(rec, rule) {
					next = append(next, rec)
				} else {
					dropped++
				}
			}
			work = next
		}
	}
	return work, dropped
}

// Rules reports the rule list (read-only) so callers can describe the pipeline in a
// preview detail string without re-parsing.
func (p RulePipeline) Rules() []RuleSpec { return p.rules }

// ----------------------------------------------------------------------------
// Transforms
// ----------------------------------------------------------------------------

func applyTransform(rec map[string]any, rule RuleSpec) {
	if rule.Field == "" {
		return
	}
	switch rule.Op {
	case TransformConcat:
		if len(rule.Args) < 1 {
			return
		}
		sep := rule.Args[0]
		parts := make([]string, 0, len(rule.Args)-1)
		for _, a := range rule.Args[1:] {
			parts = append(parts, resolveConcatArg(rec, a))
		}
		rec[rule.Field] = strings.Join(parts, sep)
	case TransformLookup:
		cur := recString(rec, rule.Field)
		table, def, hasDef := parseLookupTable(rule.Args)
		if mapped, ok := table[cur]; ok {
			rec[rule.Field] = mapped
		} else if hasDef {
			rec[rule.Field] = def
		}
	case TransformDefault:
		if len(rule.Args) < 1 {
			return
		}
		if recString(rec, rule.Field) == "" {
			rec[rule.Field] = rule.Args[0]
		}
	case TransformRegex:
		if len(rule.Args) < 2 {
			return
		}
		re, err := regexp.Compile(rule.Args[0])
		if err != nil {
			return
		}
		rec[rule.Field] = re.ReplaceAllString(recString(rec, rule.Field), rule.Args[1])
	case TransformDateFormat:
		if len(rule.Args) < 2 {
			return
		}
		if out, ok := reformatDate(recString(rec, rule.Field), rule.Args[0], rule.Args[1]); ok {
			rec[rule.Field] = out
		}
	}
}

// resolveConcatArg resolves a concat source: a "{field}" reference reads that
// record field; anything else is a literal.
func resolveConcatArg(rec map[string]any, arg string) string {
	if strings.HasPrefix(arg, "{") && strings.HasSuffix(arg, "}") && len(arg) > 2 {
		return recString(rec, arg[1:len(arg)-1])
	}
	return arg
}

// parseLookupTable parses "key=value" args into a map, treating "*=value" as the
// default for unmatched values.
func parseLookupTable(args []string) (table map[string]string, def string, hasDef bool) {
	table = map[string]string{}
	for _, a := range args {
		k, v, ok := strings.Cut(a, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "*" {
			def, hasDef = v, true
			continue
		}
		table[k] = v
	}
	return table, def, hasDef
}

// reformatDate reparses value from layout `from` to layout `to`, accepting a few
// human aliases for common layouts. Returns (_, false) when value does not parse.
func reformatDate(value, from, to string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	fromLayout := dateLayoutAlias(from)
	if fromLayout == "unix" {
		if secs, err := strconv.ParseInt(value, 10, 64); err == nil {
			return time.Unix(secs, 0).UTC().Format(dateLayoutAlias(to)), true
		}
		return "", false
	}
	t, err := time.Parse(fromLayout, value)
	if err != nil {
		return "", false
	}
	toLayout := dateLayoutAlias(to)
	if toLayout == "unix" {
		return strconv.FormatInt(t.UTC().Unix(), 10), true
	}
	return t.Format(toLayout), true
}

func dateLayoutAlias(layout string) string {
	switch strings.ToLower(strings.TrimSpace(layout)) {
	case "iso8601", "rfc3339":
		return time.RFC3339
	case "date":
		return "2006-01-02"
	case "datetime":
		return "2006-01-02 15:04:05"
	case "unix":
		return "unix"
	default:
		return layout
	}
}

// ----------------------------------------------------------------------------
// Filters
// ----------------------------------------------------------------------------

func filterKeeps(rec map[string]any, rule RuleSpec) bool {
	if rule.Field == "" {
		return true
	}
	val := recString(rec, rule.Field)
	switch rule.Op {
	case FilterEq:
		return len(rule.Args) > 0 && val == rule.Args[0]
	case FilterNe:
		return !(len(rule.Args) > 0 && val == rule.Args[0])
	case FilterIn:
		for _, a := range rule.Args {
			if val == a {
				return true
			}
		}
		return false
	case FilterExists:
		_, present := rec[rule.Field]
		return present && val != ""
	case FilterGt:
		return numericCompare(val, rule.Args, func(a, b float64) bool { return a > b })
	case FilterLt:
		return numericCompare(val, rule.Args, func(a, b float64) bool { return a < b })
	default:
		// Unrecognised filter op: keep the record (forward-compat, never silently drop).
		return true
	}
}

func numericCompare(val string, args []string, cmp func(a, b float64) bool) bool {
	if len(args) < 1 {
		return false
	}
	a, err1 := strconv.ParseFloat(strings.TrimSpace(val), 64)
	b, err2 := strconv.ParseFloat(strings.TrimSpace(args[0]), 64)
	if err1 != nil || err2 != nil {
		return false
	}
	return cmp(a, b)
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

func copyRecord(rec map[string]any) map[string]any {
	out := make(map[string]any, len(rec))
	for k, v := range rec {
		out[k] = v
	}
	return out
}

// recString reads a record field as a trimmed string, tolerating the common scalar
// types a JSON-decoded record carries.
func recString(rec map[string]any, field string) string {
	v, ok := rec[field]
	if !ok {
		return ""
	}
	return ruleString(v)
}

func ruleString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(t)
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}
