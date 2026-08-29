package executor

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// DecisionExecutor implements the DMN (Decision Model and Notation) decision-table
// step type (`decision_task`). A decision table maps a set of INPUT expressions
// (columns) against RULES (rows of cell conditions) and produces OUTPUT values
// under a HIT POLICY:
//
//	UNIQUE   - exactly one rule may match; zero or >1 matches is an error/incident.
//	FIRST    - the first matching rule (in declaration order) wins; later matches
//	           are ignored.
//	COLLECT  - every matching rule contributes; outputs are gathered into lists,
//	           optionally aggregated (sum/min/max/count) per output column.
//	PRIORITY - among matching rules, the one with the highest `priority` wins
//	           (ties broken by declaration order).
//
// Evaluation is DETERMINISTIC and FAIL-CLOSED: a malformed table, an
// unsatisfiable input expression, a UNIQUE-policy violation, or a no-match with
// no default output all surface as an error (the engine raises the step to
// failed/incident) rather than silently routing nowhere.
//
// The decision's outputs are written into the step output (steps.<id>.output.*)
// AND, by default, merged into the instance variables (variables.*) so downstream
// transitions can ROUTE on the decision result directly. Both sinks are populated
// so existing routing conventions (which read step outputs) and DMN-style routing
// (which reads variables) both work. Merging into variables is disabled by
// setting config write_to_variables:false.
//
// Reversible / additive: no existing definition references decision_task, so
// registering this executor changes nothing for existing workflows.
type DecisionExecutor struct {
	evaluator *expression.Evaluator
}

// NewDecisionExecutor creates a DecisionExecutor.
func NewDecisionExecutor() *DecisionExecutor {
	return &DecisionExecutor{
		evaluator: expression.NewEvaluator(),
	}
}

// Hit policy constants.
const (
	HitPolicyUnique   = "UNIQUE"
	HitPolicyFirst    = "FIRST"
	HitPolicyCollect  = "COLLECT"
	HitPolicyPriority = "PRIORITY"
)

// ValidHitPolicies is the set of allowed hit policies (upper-cased).
var ValidHitPolicies = map[string]bool{
	HitPolicyUnique:   true,
	HitPolicyFirst:    true,
	HitPolicyCollect:  true,
	HitPolicyPriority: true,
}

// Collect aggregation constants (COLLECT policy only).
const (
	CollectAggList  = "list" // default: gather each matching output into a list
	CollectAggSum   = "sum"
	CollectAggMin   = "min"
	CollectAggMax   = "max"
	CollectAggCount = "count"
)

// ValidCollectAggregations is the set of allowed COLLECT aggregations.
var ValidCollectAggregations = map[string]bool{
	CollectAggList:  true,
	CollectAggSum:   true,
	CollectAggMin:   true,
	CollectAggMax:   true,
	CollectAggCount: true,
}

// Config keys for a decision_task step.
const (
	configDecisionTable            = "decision_table"
	configDecisionWriteToVariables = "write_to_variables"
)

// DecisionTable is the parsed, validated shape of a decision_task's table config.
type DecisionTable struct {
	// HitPolicy is one of UNIQUE / FIRST / COLLECT / PRIORITY.
	HitPolicy string
	// Aggregation applies only to COLLECT (list|sum|min|max|count); default list.
	Aggregation string
	// Inputs are the input columns: each has a label and an expression evaluated
	// against the instance data (variables/steps/trigger).
	Inputs []DecisionInput
	// Outputs are the output columns: labels whose value is taken from the winning
	// rule's output cell (a literal or an expression).
	Outputs []DecisionOutput
	// Rules are the rows. Each rule has one entry cell per input column, one
	// output cell per output column, and (PRIORITY) an optional priority.
	Rules []DecisionRule
	// DefaultOutput, when present, is used when NO rule matches instead of
	// erroring (configurable no-match handling). It is a { outputLabel: value }
	// map. When absent, a no-match under UNIQUE/FIRST/PRIORITY is an error.
	DefaultOutput map[string]interface{}
	HasDefault    bool
}

// DecisionInput is one input column.
type DecisionInput struct {
	Label      string
	Expression string
}

// DecisionOutput is one output column.
type DecisionOutput struct {
	Label string
}

// DecisionRule is one row of the table.
type DecisionRule struct {
	// When is the list of input-cell conditions, positionally matching
	// DecisionTable.Inputs. An empty / "-" / "*" cell is a wildcard (always
	// matches). Otherwise the cell is combined with the input's evaluated value
	// to form a boolean test (see cellMatches).
	When []string
	// Then is the map of output-label -> output cell (literal or expression),
	// positionally-populated from the parsed rule.
	Then map[string]interface{}
	// Priority is used only under the PRIORITY hit policy (higher wins). Absent
	// => 0.
	Priority int
}

// Execute evaluates the decision table against the instance data and writes the
// winning output(s) into the step output (and, by default, the instance
// variables).
//
// Expected step.Config keys:
//   - decision_table (object, required): the table (inputs/outputs/rules/hit_policy).
//   - write_to_variables (bool, optional, default true): also merge outputs into
//     instance variables.
func (e *DecisionExecutor) Execute(ctx context.Context, instance *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*ExecutionResult, error) {
	table, err := ParseDecisionTable(step.Config)
	if err != nil {
		return nil, fmt.Errorf("decision %s: %w", step.ID, err)
	}

	dataCtx := buildDataContext(instance)

	// 1. Evaluate each input expression once against the instance data.
	inputValues := make([]interface{}, len(table.Inputs))
	for i, in := range table.Inputs {
		v, err := e.evaluator.EvaluateValue(in.Expression, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("decision %s: evaluating input %q (%q): %w", step.ID, in.Label, in.Expression, err)
		}
		inputValues[i] = v
	}

	// 2. Match rules.
	var matched []int
	for ri, rule := range table.Rules {
		ok, err := e.ruleMatches(rule, table.Inputs, inputValues, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("decision %s: matching rule %d: %w", step.ID, ri, err)
		}
		if ok {
			matched = append(matched, ri)
			if table.HitPolicy == HitPolicyFirst {
				break // FIRST: stop at the first match.
			}
		}
	}

	// 3. Resolve outputs per hit policy (fail-closed).
	output, err := e.resolveOutputs(table, matched, dataCtx)
	if err != nil {
		return nil, fmt.Errorf("decision %s: %w", step.ID, err)
	}

	// Meta fields to aid downstream routing/observability. These never collide
	// with output labels because they are namespaced under a reserved prefix.
	result := make(map[string]interface{}, len(output)+2)
	for k, v := range output {
		result[k] = v
	}
	result["_matched_rules"] = len(matched)
	result["_hit_policy"] = table.HitPolicy

	// 4. Optionally merge outputs into instance variables so transitions can route
	// on variables.<label>. This mutation is persisted by the engine's
	// storeStepOutput (UpdateWithLock) right after Execute returns, and Execute
	// runs inside the per-instance critical section, so it is safe.
	if configWriteToVariables(step.Config) {
		if instance.Variables == nil {
			instance.Variables = make(map[string]interface{})
		}
		for _, out := range table.Outputs {
			if v, ok := output[out.Label]; ok {
				instance.Variables[out.Label] = v
			}
		}
	}

	return &ExecutionResult{Output: result}, nil
}

// ruleMatches reports whether every input cell of the rule matches its input
// value. All input cells are ANDed (a rule matches only if ALL its cells match).
func (e *DecisionExecutor) ruleMatches(rule DecisionRule, inputs []DecisionInput, inputValues []interface{}, dataCtx map[string]interface{}) (bool, error) {
	for i := range inputs {
		cell := ""
		if i < len(rule.When) {
			cell = strings.TrimSpace(rule.When[i])
		}
		ok, err := e.cellMatches(cell, inputValues[i], dataCtx)
		if err != nil {
			return false, fmt.Errorf("input column %d (%q): %w", i, inputs[i].Label, err)
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

// cellMatches evaluates one input cell against the (already-evaluated) input
// value. Supported cell forms (deterministic + fail-closed):
//
//	""  "-"  "*"           -> wildcard, always matches
//	comparison operator    -> a cell BEGINNING with an operator (>, >=, <, <=,
//	                          ==, !=) is combined with the input value:
//	                          "> 10"  becomes  "__input__ > 10"
//	 in [..] / not in [..] -> membership test on the input value
//	otherwise              -> equality: the cell is parsed as a full boolean
//	                          expression where __input__ is bound to the input
//	                          value; if it is not a boolean expression it is
//	                          treated as a literal to test equality against.
//
// The input value is exposed to the cell expression under the reserved name
// `__input__` in the evaluation context, so a cell like ">= variables.threshold"
// can reference other variables too.
func (e *DecisionExecutor) cellMatches(cell string, inputVal interface{}, dataCtx map[string]interface{}) (bool, error) {
	if cell == "" || cell == "-" || cell == "*" {
		return true, nil
	}

	// Bind the input value under __input__ in a shallow copy of the context so we
	// never mutate the shared data map.
	cellCtx := make(map[string]interface{}, len(dataCtx)+1)
	for k, v := range dataCtx {
		cellCtx[k] = v
	}
	cellCtx["__input__"] = inputVal

	expr := BuildCellExpression(cell)
	res, err := e.evaluator.EvaluateValue(expr, cellCtx)
	if err != nil {
		return false, fmt.Errorf("evaluating cell %q as %q: %w", cell, expr, err)
	}
	b, ok := res.(bool)
	if !ok {
		// A non-boolean cell result means the cell was a bare value; treat it as
		// equality against the input value (e.g. cell "'critical'" or "5").
		return compareCellEquality(inputVal, res), nil
	}
	return b, nil
}

// BuildCellExpression turns a decision-table cell into a full boolean expression
// that the evaluator can run, with the input value bound to __input__. It is
// exported so publish-time validation (in the service package) can check the
// EXACT expression the executor will run, keeping validation and execution in
// sync.
func BuildCellExpression(cell string) string {
	trimmed := strings.TrimSpace(cell)

	// Leading comparison operator: "> 10", ">=x", "== 'a'", "!= null".
	for _, op := range []string{">=", "<=", "==", "!=", ">", "<"} {
		if strings.HasPrefix(trimmed, op) {
			return "__input__ " + trimmed
		}
	}
	// Membership: "in [..]" / "not in [..]".
	if strings.HasPrefix(trimmed, "in ") || strings.HasPrefix(trimmed, "not in ") {
		return "__input__ " + trimmed
	}
	// Bare value cell (string literal, number, bool, path): compare for equality.
	return "__input__ == " + trimmed
}

// compareCellEquality is the equality fallback used when a cell expression
// evaluated to a non-boolean value.
func compareCellEquality(a, b interface{}) bool {
	return compareEqualValues(a, b)
}

// resolveOutputs applies the hit policy to the matched rules and produces the
// output map (output-label -> value). Fail-closed on UNIQUE violations and
// unhandled no-match.
func (e *DecisionExecutor) resolveOutputs(table *DecisionTable, matched []int, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	// No match: use the configured default output, else error (fail-closed).
	if len(matched) == 0 {
		if table.HasDefault {
			return e.evalOutputCells(table, table.DefaultOutput, dataCtx)
		}
		return nil, fmt.Errorf("no rule matched and no default_output configured (hit policy %s)", table.HitPolicy)
	}

	switch table.HitPolicy {
	case HitPolicyUnique:
		if len(matched) != 1 {
			return nil, fmt.Errorf("UNIQUE hit policy violated: %d rules matched (expected exactly 1)", len(matched))
		}
		return e.evalRuleOutputs(table, table.Rules[matched[0]], dataCtx)

	case HitPolicyFirst:
		return e.evalRuleOutputs(table, table.Rules[matched[0]], dataCtx)

	case HitPolicyPriority:
		winner := matched[0]
		best := table.Rules[matched[0]].Priority
		for _, ri := range matched[1:] {
			if table.Rules[ri].Priority > best {
				best = table.Rules[ri].Priority
				winner = ri
			}
		}
		return e.evalRuleOutputs(table, table.Rules[winner], dataCtx)

	case HitPolicyCollect:
		return e.collectOutputs(table, matched, dataCtx)

	default:
		return nil, fmt.Errorf("unsupported hit policy: %s", table.HitPolicy)
	}
}

// evalRuleOutputs evaluates all output cells of a single winning rule.
func (e *DecisionExecutor) evalRuleOutputs(table *DecisionTable, rule DecisionRule, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	return e.evalOutputCells(table, rule.Then, dataCtx)
}

// evalOutputCells resolves each output cell (literal or expression) for the
// table's output columns.
func (e *DecisionExecutor) evalOutputCells(table *DecisionTable, cells map[string]interface{}, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	out := make(map[string]interface{}, len(table.Outputs))
	for _, col := range table.Outputs {
		raw, ok := cells[col.Label]
		if !ok {
			// A missing output cell yields null for that column.
			out[col.Label] = nil
			continue
		}
		v, err := e.resolveOutputCell(raw, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("resolving output %q: %w", col.Label, err)
		}
		out[col.Label] = v
	}
	return out, nil
}

// resolveOutputCell resolves a single output cell. A string cell is evaluated as
// an expression (so it can reference variables / do arithmetic); if it does not
// parse as an expression it is used as a literal string. Non-string cells
// (numbers/bools/null from JSON) are used as-is.
func (e *DecisionExecutor) resolveOutputCell(raw interface{}, dataCtx map[string]interface{}) (interface{}, error) {
	s, ok := raw.(string)
	if !ok {
		return raw, nil
	}
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return s, nil
	}
	v, err := e.evaluator.EvaluateValue(trimmed, dataCtx)
	if err != nil {
		// Not a valid expression: treat the cell as a plain string literal.
		return s, nil
	}
	return v, nil
}

// collectOutputs implements the COLLECT hit policy: gather each matching rule's
// output per column, then aggregate.
func (e *DecisionExecutor) collectOutputs(table *DecisionTable, matched []int, dataCtx map[string]interface{}) (map[string]interface{}, error) {
	// Gather per-column lists in rule order (deterministic).
	perColumn := make(map[string][]interface{}, len(table.Outputs))
	for _, col := range table.Outputs {
		perColumn[col.Label] = nil
	}
	// Ensure a stable order of matched rules (they are already appended in rule
	// order, but sort defensively).
	sorted := append([]int(nil), matched...)
	sort.Ints(sorted)
	for _, ri := range sorted {
		cellVals, err := e.evalRuleOutputs(table, table.Rules[ri], dataCtx)
		if err != nil {
			return nil, err
		}
		for _, col := range table.Outputs {
			perColumn[col.Label] = append(perColumn[col.Label], cellVals[col.Label])
		}
	}

	out := make(map[string]interface{}, len(table.Outputs))
	agg := table.Aggregation
	if agg == "" {
		agg = CollectAggList
	}
	for _, col := range table.Outputs {
		vals := perColumn[col.Label]
		aggregated, err := aggregateCollect(agg, vals)
		if err != nil {
			return nil, fmt.Errorf("aggregating output %q: %w", col.Label, err)
		}
		out[col.Label] = aggregated
	}
	return out, nil
}

// aggregateCollect applies a COLLECT aggregation to a column's gathered values.
func aggregateCollect(agg string, vals []interface{}) (interface{}, error) {
	switch agg {
	case CollectAggList, "":
		if vals == nil {
			return []interface{}{}, nil
		}
		return vals, nil
	case CollectAggCount:
		return int64(len(vals)), nil
	case CollectAggSum, CollectAggMin, CollectAggMax:
		nums := make([]float64, 0, len(vals))
		allInt := true
		for _, v := range vals {
			f, ok := toFloatValue(v)
			if !ok {
				return nil, fmt.Errorf("%s requires numeric outputs, got %T", agg, v)
			}
			if _, isInt := asInt64(v); !isInt {
				allInt = false
			}
			nums = append(nums, f)
		}
		if len(nums) == 0 {
			return int64(0), nil
		}
		var res float64
		switch agg {
		case CollectAggSum:
			for _, f := range nums {
				res += f
			}
		case CollectAggMin:
			res = nums[0]
			for _, f := range nums[1:] {
				if f < res {
					res = f
				}
			}
		case CollectAggMax:
			res = nums[0]
			for _, f := range nums[1:] {
				if f > res {
					res = f
				}
			}
		}
		if allInt {
			return int64(res), nil
		}
		return res, nil
	default:
		return nil, fmt.Errorf("unknown collect aggregation: %s", agg)
	}
}

// configWriteToVariables reads the write_to_variables flag (default TRUE).
func configWriteToVariables(config map[string]interface{}) bool {
	v, ok := config[configDecisionWriteToVariables]
	if !ok {
		return true
	}
	b, ok := v.(bool)
	if !ok {
		return true
	}
	return b
}

// ---------- parsing ----------

// ParseDecisionTable parses and validates a decision_task step's config into a
// DecisionTable. It is exported so the publish-time validator (in the service
// package) can reuse the exact same parser — validation and execution therefore
// agree on what a well-formed table is. Fail-closed: any structural problem is
// an error.
func ParseDecisionTable(config map[string]interface{}) (*DecisionTable, error) {
	raw, ok := config[configDecisionTable]
	if !ok || raw == nil {
		return nil, fmt.Errorf("missing required config key %q", configDecisionTable)
	}
	tbl, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("config key %q must be an object", configDecisionTable)
	}

	dt := &DecisionTable{}

	// hit_policy (required, case-insensitive).
	hp, _ := tbl["hit_policy"].(string)
	hp = strings.ToUpper(strings.TrimSpace(hp))
	if hp == "" {
		return nil, fmt.Errorf("decision_table requires a hit_policy")
	}
	if !ValidHitPolicies[hp] {
		return nil, fmt.Errorf("invalid hit_policy %q (must be UNIQUE, FIRST, COLLECT or PRIORITY)", hp)
	}
	dt.HitPolicy = hp

	// aggregation (COLLECT only).
	if aggRaw, ok := tbl["aggregation"]; ok && aggRaw != nil {
		agg, _ := aggRaw.(string)
		agg = strings.ToLower(strings.TrimSpace(agg))
		if agg != "" {
			if hp != HitPolicyCollect {
				return nil, fmt.Errorf("aggregation is only valid with the COLLECT hit policy")
			}
			if !ValidCollectAggregations[agg] {
				return nil, fmt.Errorf("invalid aggregation %q (must be list, sum, min, max or count)", agg)
			}
			dt.Aggregation = agg
		}
	}

	// inputs (required, non-empty).
	inputsRaw, ok := tbl["inputs"].([]interface{})
	if !ok || len(inputsRaw) == 0 {
		return nil, fmt.Errorf("decision_table requires a non-empty inputs list")
	}
	for i, ir := range inputsRaw {
		im, ok := ir.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("input %d must be an object", i)
		}
		expr, _ := im["expression"].(string)
		expr = strings.TrimSpace(expr)
		if expr == "" {
			return nil, fmt.Errorf("input %d requires a non-empty expression", i)
		}
		label, _ := im["label"].(string)
		if strings.TrimSpace(label) == "" {
			label = fmt.Sprintf("input_%d", i)
		}
		dt.Inputs = append(dt.Inputs, DecisionInput{Label: label, Expression: expr})
	}

	// outputs (required, non-empty).
	outputsRaw, ok := tbl["outputs"].([]interface{})
	if !ok || len(outputsRaw) == 0 {
		return nil, fmt.Errorf("decision_table requires a non-empty outputs list")
	}
	seenOut := map[string]bool{}
	for i, or := range outputsRaw {
		om, ok := or.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("output %d must be an object", i)
		}
		label, _ := om["label"].(string)
		label = strings.TrimSpace(label)
		if label == "" {
			return nil, fmt.Errorf("output %d requires a non-empty label", i)
		}
		if seenOut[label] {
			return nil, fmt.Errorf("duplicate output label %q", label)
		}
		seenOut[label] = true
		dt.Outputs = append(dt.Outputs, DecisionOutput{Label: label})
	}

	// rules (required, non-empty).
	rulesRaw, ok := tbl["rules"].([]interface{})
	if !ok || len(rulesRaw) == 0 {
		return nil, fmt.Errorf("decision_table requires a non-empty rules list")
	}
	for ri, rr := range rulesRaw {
		rm, ok := rr.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("rule %d must be an object", ri)
		}
		rule := DecisionRule{Then: map[string]interface{}{}}

		// when: positional list of input cells, one per input column.
		whenRaw, ok := rm["when"].([]interface{})
		if !ok {
			return nil, fmt.Errorf("rule %d requires a when list (one cell per input column)", ri)
		}
		if len(whenRaw) != len(dt.Inputs) {
			return nil, fmt.Errorf("rule %d has %d when-cells but the table has %d input columns", ri, len(whenRaw), len(dt.Inputs))
		}
		for _, wc := range whenRaw {
			rule.When = append(rule.When, cellToString(wc))
		}

		// then: object of output-label -> cell.
		thenRaw, ok := rm["then"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("rule %d requires a then object (output cells)", ri)
		}
		for label, cell := range thenRaw {
			if !seenOut[label] {
				return nil, fmt.Errorf("rule %d then references unknown output %q", ri, label)
			}
			rule.Then[label] = cell
		}

		// priority (PRIORITY policy only; ignored otherwise but validated as int).
		if pRaw, ok := rm["priority"]; ok && pRaw != nil {
			p, ok := asInt64(pRaw)
			if !ok {
				return nil, fmt.Errorf("rule %d priority must be an integer", ri)
			}
			rule.Priority = int(p)
		}

		dt.Rules = append(dt.Rules, rule)
	}

	// default_output (optional).
	if doRaw, ok := tbl["default_output"]; ok && doRaw != nil {
		dom, ok := doRaw.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("default_output must be an object")
		}
		for label := range dom {
			if !seenOut[label] {
				return nil, fmt.Errorf("default_output references unknown output %q", label)
			}
		}
		dt.DefaultOutput = dom
		dt.HasDefault = true
	}

	return dt, nil
}

// cellToString normalizes a when-cell (which may be decoded as a string, number,
// bool, or null) into the string form the cell matcher expects.
func cellToString(v interface{}) string {
	switch c := v.(type) {
	case string:
		return c
	case nil:
		return ""
	case bool:
		if c {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", c)
	}
}

// ---------- small local numeric helpers (kept package-local, decision-only) ----------

// compareEqualValues mirrors the evaluator's numeric-coercing equality for the
// cell-equality fallback without importing evaluator internals: it reuses the
// evaluator's exported comparison via a tiny expression would be overkill, so we
// inline a minimal numeric/string/bool comparison.
func compareEqualValues(a, b interface{}) bool {
	af, aOk := toFloatValue(a)
	bf, bOk := toFloatValue(b)
	if aOk && bOk {
		return af == bf
	}
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

// toFloatValue converts a numeric interface value to float64.
func toFloatValue(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int64:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	default:
		return 0, false
	}
}

// asInt64 converts an integral numeric value to int64 (JSON numbers decode to
// float64, so a whole float64 counts as integral).
func asInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case int64:
		return n, true
	case int:
		return int64(n), true
	case int32:
		return int64(n), true
	case float64:
		if n == float64(int64(n)) {
			return int64(n), true
		}
		return 0, false
	default:
		return 0, false
	}
}
