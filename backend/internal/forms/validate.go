package forms

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/clario360/platform/internal/cron"
	"github.com/clario360/platform/internal/workflow/expression"
)

// Violation is a single validation failure. Field names the offending field (or
// "" for a form-level/structural problem); Rule names the kind of check that
// failed; Message is the bilingual, author-supplied (or default) explanation.
type Violation struct {
	Field   string        `json:"field"`
	Rule    string        `json:"rule"`
	Message LocalizedText `json:"message"`
}

func (v Violation) String() string {
	return fmt.Sprintf("%s: %s (%s)", v.Field, v.Rule, v.Message.EN)
}

// uuidRE matches a canonical RFC-4122 UUID (any version), case-insensitive.
var uuidRE = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// emailRE is a pragmatic email shape check (one @, a dotted domain). It is not a
// full RFC 5322 grammar — the same shape the FE Zod schema uses — so the two
// validators agree.
var emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// Validate checks a FormDefinition's STRUCTURE (independently of any submission):
// field types, option-backed fields, rule kinds, condition references, direction
// values, and the FR-XC-008 bilingual-label gate. It returns every problem found
// (not just the first). A definition with no structural problems returns nil.
//
// This is the gate the authoring API and a CI check run before a form is stored.
func (fd *FormDefinition) Validate() []Violation {
	var vs []Violation
	idx := fd.fieldByName()

	if fd.DefaultLocale != "" && !contains(fd.Locales, fd.DefaultLocale) {
		vs = append(vs, Violation{
			Field: "", Rule: "default_locale",
			Message: enf("default locale %q is not in locales %v", fd.DefaultLocale, fd.Locales),
		})
	}

	seen := make(map[string]bool, len(fd.Fields))
	for i := range fd.Fields {
		f := &fd.Fields[i]

		if f.Name == "" {
			vs = append(vs, Violation{Field: "", Rule: "name", Message: en("field at index " + strconv.Itoa(i) + " has no name")})
		} else if seen[f.Name] {
			vs = append(vs, Violation{Field: f.Name, Rule: "name", Message: enf("duplicate field name %q", f.Name)})
		}
		seen[f.Name] = true

		if !f.Type.IsValid() {
			vs = append(vs, Violation{Field: f.Name, Rule: "type", Message: enf("unknown field type %q", string(f.Type))})
		}
		if !validDirs[f.Dir] {
			vs = append(vs, Violation{Field: f.Name, Rule: "dir", Message: enf("invalid dir %q", f.Dir)})
		}

		// FR-XC-008: every author-facing label must carry BOTH locales.
		if f.Label.AR == "" {
			vs = append(vs, Violation{Field: f.Name, Rule: "bilingual", Message: enf("field %q label missing Arabic (ar) text", f.Name)})
		}
		if f.Label.EN == "" {
			vs = append(vs, Violation{Field: f.Name, Rule: "bilingual", Message: enf("field %q label missing English (en) text", f.Name)})
		}

		// Option-backed fields must declare options with bilingual labels.
		if f.Type.isOptionBacked() && len(f.Options) == 0 {
			vs = append(vs, Violation{Field: f.Name, Rule: "options", Message: enf("field %q (%s) requires options", f.Name, string(f.Type))})
		}
		for oi := range f.Options {
			o := f.Options[oi]
			if o.Label.AR == "" || o.Label.EN == "" {
				vs = append(vs, Violation{Field: f.Name, Rule: "bilingual", Message: enf("option %q of field %q is missing an Arabic or English label", o.Value, f.Name)})
			}
		}

		// Validate rule kinds and their condition references.
		for ri := range f.Validation {
			r := f.Validation[ri]
			if !validRuleKinds[r.Kind] {
				vs = append(vs, Violation{Field: f.Name, Rule: "rule_kind", Message: enf("field %q has unknown validation kind %q", f.Name, r.Kind)})
			}
			vs = append(vs, validateConditionRefs(f.Name, "rule.when", r.When, idx)...)
		}
		vs = append(vs, validateConditionRefs(f.Name, "visibleWhen", f.VisibleWhen, idx)...)
		vs = append(vs, validateConditionRefs(f.Name, "requiredWhen", f.RequiredWhen, idx)...)
	}

	return vs
}

// validateConditionRefs checks that each condition references an existing field
// and a known operator, and that "in"/"notIn" carry an array value.
func validateConditionRefs(field, where string, conds []Condition, idx map[string]*FormField) []Violation {
	var vs []Violation
	for _, c := range conds {
		if c.Field == "" {
			vs = append(vs, Violation{Field: field, Rule: where, Message: enf("%s condition has empty field reference", where)})
			continue
		}
		if _, ok := idx[c.Field]; !ok {
			vs = append(vs, Violation{Field: field, Rule: where, Message: enf("%s references unknown field %q", where, c.Field)})
		}
		if _, ok := supportedOperators[c.Operator]; !ok {
			vs = append(vs, Violation{Field: field, Rule: where, Message: enf("%s uses unsupported operator %q", where, c.Operator)})
		}
		if (c.Operator == "in" || c.Operator == "notIn") && !isArray(c.Value) {
			vs = append(vs, Violation{Field: field, Rule: where, Message: enf("%s operator %q requires an array value", where, c.Operator)})
		}
	}
	return vs
}

// ValidateSubmission is the REAL server-side submission validator. Given a
// (structurally sound) definition and a submitted FormData map it:
//
//  1. Computes field visibility from VisibleWhen using the SAME expression
//     Evaluator as the workflow DSL (a {"fields": {...}} context). HIDDEN fields
//     (VisibleWhen evaluates false) are EXCLUDED from all validation so a hidden
//     required field can never block a submit.
//  2. Enforces field.Required and any RequiredWhen-derived requirement.
//  3. Type-checks each visible field's value.
//  4. Evaluates every ValidationRule (min/max/length/pattern/email/url/uuid/cron/
//     enum/requiredIf) whose own When-guard (if any) holds.
//
// It returns EVERY violation (deterministically ordered by field then rule), or
// nil when the submission is valid. The definition is not re-structurally
// validated here; call Validate first (or ValidateAll).
func (fd *FormDefinition) ValidateSubmission(data FormData) []Violation {
	var vs []Violation
	eval := expression.NewEvaluator()
	ctx := map[string]any{"fields": normalizeContext(data)}

	for i := range fd.Fields {
		f := &fd.Fields[i]
		if !f.Type.holdsValue() {
			continue // section: layout only
		}

		visible, err := conditionsHold(eval, ctx, f.VisibleWhen, true)
		if err != nil {
			vs = append(vs, Violation{Field: f.Name, Rule: "visibleWhen", Message: enf("could not evaluate visibility: %v", err)})
			continue
		}
		if !visible {
			continue // hidden -> excluded from validation entirely
		}

		raw, present := data[f.Name]
		value := raw
		empty := isEmptyValue(raw)

		// Requiredness: static Required OR a satisfied RequiredWhen OR a satisfied
		// requiredIf validation rule. A requiredIf rule is a requiredness check
		// (not a value check), so it is folded in here — it must fire even when
		// the value is absent, which the per-value rule loop below cannot do.
		required := f.Required
		if !required && len(f.RequiredWhen) > 0 {
			req, rerr := conditionsHold(eval, ctx, f.RequiredWhen, false)
			if rerr != nil {
				vs = append(vs, Violation{Field: f.Name, Rule: "requiredWhen", Message: enf("could not evaluate requiredWhen: %v", rerr)})
			}
			required = required || req
		}
		requiredRule, reqRuleViolations := requiredIfActive(eval, ctx, f)
		vs = append(vs, reqRuleViolations...)

		if (required || requiredRule.active) && (!present || empty) {
			rule := RuleRequired
			if requiredRule.active && !required {
				rule = RuleRequiredIf
			}
			vs = append(vs, Violation{Field: f.Name, Rule: rule, Message: requiredRule.message(f)})
			continue // nothing further to check on a missing required value
		}
		if !present || empty {
			continue // optional & absent: skip type/rule checks
		}

		// Type check the present value.
		if tv := typeCheck(f, value); tv != nil {
			vs = append(vs, *tv)
			continue // a wrong-typed value can't be meaningfully rule-checked
		}

		// Per-field declarative rules.
		for ri := range f.Validation {
			r := f.Validation[ri]
			active, gerr := conditionsHold(eval, ctx, r.When, true)
			if gerr != nil {
				vs = append(vs, Violation{Field: f.Name, Rule: r.Kind, Message: enf("could not evaluate rule guard: %v", gerr)})
				continue
			}
			if !active {
				continue
			}
			if v := applyRule(eval, ctx, f, r, value); v != nil {
				vs = append(vs, *v)
			}
		}
	}

	sortViolations(vs)
	return vs
}

// ValidateAll runs structural validation then, only if the definition is sound,
// the submission validation. Returns the combined violations.
func (fd *FormDefinition) ValidateAll(data FormData) []Violation {
	if structural := fd.Validate(); len(structural) > 0 {
		return structural
	}
	return fd.ValidateSubmission(data)
}

// ---------------------------------------------------------------------------
// Condition compilation — reuse the workflow expression vocabulary.
// ---------------------------------------------------------------------------

// supportedOperators maps a form Condition operator to whether it is known.
// eq/neq/gt/gte/lt/lte/in/notIn/contains compile to an expression fragment;
// truthy/falsy/isSet/isEmpty are evaluated directly against the field value
// (they do not depend on Condition.Value).
var supportedOperators = map[string]bool{
	"eq": true, "neq": true, "gt": true, "gte": true, "lt": true, "lte": true,
	"in": true, "notIn": true, "contains": true,
	"truthy": true, "falsy": true, "isSet": true, "isEmpty": true,
}

// conditionsHold evaluates an AND of conditions. An empty list returns
// emptyResult (true for "visible by default", true for "rule active by default";
// RequiredWhen passes false so an empty list means "not required").
func conditionsHold(eval *expression.Evaluator, ctx map[string]any, conds []Condition, emptyResult bool) (bool, error) {
	if len(conds) == 0 {
		return emptyResult, nil
	}
	fields, _ := ctx["fields"].(map[string]any)
	for _, c := range conds {
		ok, err := evalCondition(eval, ctx, fields, c)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil // AND short-circuit
		}
	}
	return true, nil
}

// evalCondition evaluates a single condition. The value-comparison operators
// compile to a DSL expression string and call the shared Evaluator so the form
// engine and the workflow engine share ONE grammar. The presence operators are
// resolved directly (the Evaluator's path resolver errors on absent keys, which
// is exactly what "isSet" must NOT do).
func evalCondition(eval *expression.Evaluator, ctx map[string]any, fields map[string]any, c Condition) (bool, error) {
	switch c.Operator {
	case "isSet":
		return !isEmptyValue(fields[c.Field]), nil
	case "isEmpty":
		return isEmptyValue(fields[c.Field]), nil
	case "truthy":
		return truthy(fields[c.Field]), nil
	case "falsy":
		return !truthy(fields[c.Field]), nil
	}

	// A comparison against an absent field can never hold; resolving it through
	// the Evaluator would error on the missing path, so short-circuit to false.
	if _, ok := fields[c.Field]; !ok {
		return false, nil
	}

	expr, err := compileCondition(c)
	if err != nil {
		return false, err
	}
	return eval.Evaluate(expr, ctx)
}

// compileCondition turns a Condition into an expression-DSL string referencing
// fields.<name>. It is the single place the form operator names map onto the
// Evaluator's operator tokens.
func compileCondition(c Condition) (string, error) {
	path := "fields." + c.Field
	switch c.Operator {
	case "eq":
		return path + " == " + literal(c.Value), nil
	case "neq":
		return path + " != " + literal(c.Value), nil
	case "gt":
		return path + " > " + literal(c.Value), nil
	case "gte":
		return path + " >= " + literal(c.Value), nil
	case "lt":
		return path + " < " + literal(c.Value), nil
	case "lte":
		return path + " <= " + literal(c.Value), nil
	case "in":
		return path + " in " + arrayLiteral(c.Value), nil
	case "notIn":
		return "!(" + path + " in " + arrayLiteral(c.Value) + ")", nil
	case "contains":
		// element membership: <value> in fields.<list>
		return literal(c.Value) + " in " + path, nil
	default:
		return "", fmt.Errorf("unsupported operator %q", c.Operator)
	}
}

// literal renders a Go value as an expression-DSL literal.
func literal(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return "'" + escapeSingleQuotes(x) + "'"
	case int:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		// JSON numbers decode to float64; render integers without a trailing .0.
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return "'" + escapeSingleQuotes(fmt.Sprintf("%v", x)) + "'"
	}
}

// arrayLiteral renders a slice value as an expression-DSL array literal. A
// non-slice value degrades to a single-element array so "in" still works.
func arrayLiteral(v any) string {
	items := toAnySlice(v)
	parts := make([]string, len(items))
	for i, it := range items {
		parts[i] = literal(it)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}

// ---------------------------------------------------------------------------
// Type checking.
// ---------------------------------------------------------------------------

// typeCheck verifies a present value matches the field's declared type. Returns
// a Violation pointer on mismatch, nil on success. JSON numbers arrive as
// float64; booleans as bool; strings as string; lists as []any.
func typeCheck(f *FormField, value any) *Violation {
	bad := func(want string) *Violation {
		return &Violation{Field: f.Name, Rule: "type", Message: enf("field %q expects %s", f.Name, want)}
	}
	switch f.Type {
	case FieldNumber, FieldCurrency:
		if _, ok := toFloat(value); !ok {
			return bad("a number")
		}
	case FieldBoolean:
		if _, ok := value.(bool); !ok {
			return bad("a boolean")
		}
	case FieldText, FieldTextarea, FieldDate, FieldDateTime, FieldEmail, FieldURL, FieldPhone:
		if _, ok := value.(string); !ok {
			return bad("a string")
		}
	case FieldSelect, FieldCombobox, FieldRadio:
		s, ok := value.(string)
		if !ok {
			return bad("a string option")
		}
		if !optionExists(f, s) {
			return &Violation{Field: f.Name, Rule: RuleEnum, Message: enumMsg(f, s)}
		}
	case FieldMultiSelect:
		items := toAnySlice(value)
		if items == nil {
			return bad("a list of options")
		}
		for _, it := range items {
			s, ok := it.(string)
			if !ok {
				return bad("a list of string options")
			}
			if !optionExists(f, s) {
				return &Violation{Field: f.Name, Rule: RuleEnum, Message: enumMsg(f, s)}
			}
		}
	case FieldDateRange:
		items := toAnySlice(value)
		if len(items) != 2 {
			return bad("a [start, end] date range")
		}
		for _, it := range items {
			if _, ok := it.(string); !ok {
				return bad("a [start, end] date range of strings")
			}
		}
	case FieldFile:
		// A file value is an opaque reference (id/url string or an object the
		// upload service produced). Accept a non-empty string or object.
		switch value.(type) {
		case string, map[string]any:
		default:
			return bad("a file reference")
		}
	}
	return nil
}

// requiredResult is the outcome of evaluating a field's requiredIf rules: active
// reports whether at least one requiredIf rule's condition holds, and msg (when
// non-empty) is that rule's author-supplied message used for the violation.
type requiredResult struct {
	active bool
	msg    LocalizedText
}

// message returns the author-supplied requiredIf message when present, else the
// default "required" message for the field.
func (r requiredResult) message(f *FormField) LocalizedText {
	if !r.msg.IsEmpty() {
		return r.msg
	}
	return requiredMsg(f)
}

// requiredIfActive evaluates every requiredIf validation rule on the field. It
// returns whether the field is thereby required (any condition holds) and any
// errors encountered evaluating the rule conditions (surfaced as violations so a
// malformed requiredIf is visible rather than silently ignored).
func requiredIfActive(eval *expression.Evaluator, ctx map[string]any, f *FormField) (requiredResult, []Violation) {
	var (
		res  requiredResult
		errs []Violation
	)
	for ri := range f.Validation {
		r := f.Validation[ri]
		if r.Kind != RuleRequiredIf {
			continue
		}
		conds, err := paramConditions(r.Param)
		if err != nil {
			errs = append(errs, Violation{Field: f.Name, Rule: RuleRequiredIf, Message: enf("invalid requiredIf param: %v", err)})
			continue
		}
		hold, herr := conditionsHold(eval, ctx, conds, false)
		if herr != nil {
			errs = append(errs, Violation{Field: f.Name, Rule: RuleRequiredIf, Message: enf("could not evaluate requiredIf: %v", herr)})
			continue
		}
		if hold {
			res.active = true
			if res.msg.IsEmpty() {
				res.msg = r.Message
			}
		}
	}
	return res, errs
}

// ---------------------------------------------------------------------------
// Rule application.
// ---------------------------------------------------------------------------

// applyRule evaluates one ValidationRule against a present, type-correct value.
func applyRule(eval *expression.Evaluator, ctx map[string]any, f *FormField, r ValidationRule, value any) *Violation {
	fail := func(def LocalizedText) *Violation {
		msg := r.Message
		if msg.IsEmpty() {
			msg = def
		}
		return &Violation{Field: f.Name, Rule: r.Kind, Message: msg}
	}

	switch r.Kind {
	case RuleRequired:
		if isEmptyValue(value) {
			return fail(requiredMsg(f))
		}
	case RuleRequiredIf:
		// Handled in the requiredness block of ValidateSubmission (it must fire
		// even when the value is absent, which this per-value loop cannot). No-op
		// here so a present-and-non-empty value is simply accepted.
		return nil
	case RuleMin:
		n, ok := toFloat(value)
		min, mok := toFloat(r.Param)
		if ok && mok && n < min {
			return fail(enf("field %q must be >= %s", f.Name, trimNum(min)))
		}
	case RuleMax:
		n, ok := toFloat(value)
		max, mok := toFloat(r.Param)
		if ok && mok && n > max {
			return fail(enf("field %q must be <= %s", f.Name, trimNum(max)))
		}
	case RuleMinLength:
		l, ok := valueLength(value)
		min, mok := toInt(r.Param)
		if ok && mok && l < min {
			return fail(enf("field %q must be at least %d long", f.Name, min))
		}
	case RuleMaxLength:
		l, ok := valueLength(value)
		max, mok := toInt(r.Param)
		if ok && mok && l > max {
			return fail(enf("field %q must be at most %d long", f.Name, max))
		}
	case RulePattern:
		s, sok := value.(string)
		pat, pok := r.Param.(string)
		if sok && pok {
			re, err := regexp.Compile(pat)
			if err != nil {
				return fail(enf("invalid pattern %q: %v", pat, err))
			}
			if !re.MatchString(s) {
				return fail(enf("field %q does not match the required pattern", f.Name))
			}
		}
	case RuleEmail:
		if s, ok := value.(string); ok && !emailRE.MatchString(s) {
			return fail(enf("field %q must be a valid email address", f.Name))
		}
	case RuleURL:
		if s, ok := value.(string); ok && !validURL(s) {
			return fail(enf("field %q must be a valid URL", f.Name))
		}
	case RuleUUID:
		if s, ok := value.(string); ok && !uuidRE.MatchString(s) {
			return fail(enf("field %q must be a valid UUID", f.Name))
		}
	case RuleCron:
		if s, ok := value.(string); ok {
			if _, err := cron.ParseCron(s); err != nil {
				return fail(enf("field %q must be a valid cron expression", f.Name))
			}
		}
	case RuleEnum:
		allowed := enumValues(r.Param, f)
		if !inStrings(allowed, value) {
			return fail(enumMsg(f, fmt.Sprintf("%v", value)))
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Value helpers.
// ---------------------------------------------------------------------------

// normalizeContext copies the submitted data so the evaluation context is not
// mutated and absent keys are simply absent (the path resolver treats a present
// key with a nil value differently from an absent one).
func normalizeContext(data FormData) map[string]any {
	out := make(map[string]any, len(data))
	for k, v := range data {
		out[k] = v
	}
	return out
}

// isEmptyValue reports whether a submitted value counts as "not provided".
func isEmptyValue(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case []string:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	default:
		return false
	}
}

// truthy mirrors the Evaluator's notion of truthiness for presence operators.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	case int:
		return x != 0
	case int64:
		return x != 0
	default:
		return !isEmptyValue(v)
	}
}

func optionExists(f *FormField, value string) bool {
	for i := range f.Options {
		if f.Options[i].Value == value {
			return true
		}
	}
	return false
}

func enumValues(param any, f *FormField) []string {
	if items := toAnySlice(param); items != nil {
		out := make([]string, 0, len(items))
		for _, it := range items {
			out = append(out, fmt.Sprintf("%v", it))
		}
		return out
	}
	// Fall back to the field's declared options.
	out := make([]string, 0, len(f.Options))
	for i := range f.Options {
		out = append(out, f.Options[i].Value)
	}
	return out
}

func inStrings(allowed []string, value any) bool {
	s := fmt.Sprintf("%v", value)
	for _, a := range allowed {
		if a == s {
			return true
		}
	}
	return false
}

// valueLength returns the length of a string (rune count) or a list.
func valueLength(v any) (int, bool) {
	switch x := v.(type) {
	case string:
		return len([]rune(x)), true
	case []any:
		return len(x), true
	case []string:
		return len(x), true
	default:
		return 0, false
	}
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func toInt(v any) (int, bool) {
	if f, ok := toFloat(v); ok {
		return int(f), true
	}
	return 0, false
}

func toAnySlice(v any) []any {
	switch x := v.(type) {
	case []any:
		return x
	case []string:
		out := make([]any, len(x))
		for i := range x {
			out[i] = x[i]
		}
		return out
	default:
		return nil
	}
}

func isArray(v any) bool {
	switch v.(type) {
	case []any, []string:
		return true
	default:
		return false
	}
}

func validURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil {
		return false
	}
	return u.Scheme != "" && u.Host != ""
}

// paramConditions extracts a []Condition from a rule's Param. The Param may be a
// []Condition (programmatic construction) or a []any of maps (decoded JSON).
func paramConditions(param any) ([]Condition, error) {
	switch x := param.(type) {
	case []Condition:
		return x, nil
	case []any:
		out := make([]Condition, 0, len(x))
		for _, item := range x {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("condition must be an object")
			}
			c := Condition{}
			if f, ok := m["field"].(string); ok {
				c.Field = f
			}
			if op, ok := m["operator"].(string); ok {
				c.Operator = op
			}
			c.Value = m["value"]
			out = append(out, c)
		}
		return out, nil
	case nil:
		return nil, nil
	default:
		return nil, fmt.Errorf("expected a list of conditions, got %T", param)
	}
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

func trimNum(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// sortViolations gives a deterministic order (by field, then rule, then message)
// so callers and tests see stable output.
func sortViolations(vs []Violation) {
	sort.SliceStable(vs, func(i, j int) bool {
		if vs[i].Field != vs[j].Field {
			return vs[i].Field < vs[j].Field
		}
		if vs[i].Rule != vs[j].Rule {
			return vs[i].Rule < vs[j].Rule
		}
		return vs[i].Message.EN < vs[j].Message.EN
	})
}

// ---------------------------------------------------------------------------
// Message helpers.
// ---------------------------------------------------------------------------

// en builds an English-only LocalizedText (default/fallback messages). Authored
// Message overrides always win; these are only used when no Message is supplied.
func en(s string) LocalizedText { return LocalizedText{EN: s} }

func enf(format string, args ...any) LocalizedText { return en(fmt.Sprintf(format, args...)) }

func requiredMsg(f *FormField) LocalizedText {
	return LocalizedText{
		AR: fmt.Sprintf("الحقل %q مطلوب", f.Label.Localize("ar")),
		EN: fmt.Sprintf("field %q is required", f.Name),
	}
}

func enumMsg(f *FormField, value string) LocalizedText {
	return enf("field %q value %q is not one of the allowed options", f.Name, value)
}
