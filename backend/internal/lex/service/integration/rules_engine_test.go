package integration

import (
	"testing"
)

func recsEqual(t *testing.T, got []map[string]any, wantLen int) {
	t.Helper()
	if len(got) != wantLen {
		t.Fatalf("expected %d records, got %d: %v", wantLen, len(got), got)
	}
}

func TestRulePipeline_PassThrough(t *testing.T) {
	recs := []map[string]any{{"a": "1"}, {"a": "2"}}
	kept, dropped := NewRulePipeline(nil).Apply(recs)
	recsEqual(t, kept, 2)
	if dropped != 0 {
		t.Fatalf("expected 0 dropped, got %d", dropped)
	}
	// Purity: mutating the output must not touch the input.
	kept[0]["a"] = "mutated"
	if recs[0]["a"] != "1" {
		t.Fatalf("pipeline mutated caller input: %v", recs[0])
	}
}

func TestTransform_Concat(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformConcat, Field: "full", Args: []string{" ", "{first}", "{last}"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"first": "Jane", "last": "Doe"}})
	if got := kept[0]["full"]; got != "Jane Doe" {
		t.Fatalf("concat: want %q got %q", "Jane Doe", got)
	}
}

func TestTransform_ConcatLiteral(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformConcat, Field: "code", Args: []string{"-", "DEPT", "{num}"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"num": "42"}})
	if got := kept[0]["code"]; got != "DEPT-42" {
		t.Fatalf("concat literal: want %q got %q", "DEPT-42", got)
	}
}

func TestTransform_Lookup(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformLookup, Field: "status", Args: []string{"A=active", "T=terminated", "*=unknown"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"status": "A"}, {"status": "T"}, {"status": "X"}})
	if kept[0]["status"] != "active" || kept[1]["status"] != "terminated" || kept[2]["status"] != "unknown" {
		t.Fatalf("lookup mismatch: %v", kept)
	}
}

func TestTransform_LookupNoDefaultLeavesUnchanged(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformLookup, Field: "s", Args: []string{"A=active"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"s": "Z"}})
	if kept[0]["s"] != "Z" {
		t.Fatalf("lookup without default should leave value: got %v", kept[0]["s"])
	}
}

func TestTransform_Default(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformDefault, Field: "dept", Args: []string{"GENERAL"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"dept": ""}, {"dept": "LEGAL"}, {}})
	if kept[0]["dept"] != "GENERAL" || kept[1]["dept"] != "LEGAL" || kept[2]["dept"] != "GENERAL" {
		t.Fatalf("default mismatch: %v", kept)
	}
}

func TestTransform_Regex(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformRegex, Field: "phone", Args: []string{"[^0-9]", ""}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"phone": "+966 (50) 123"}})
	if kept[0]["phone"] != "96650123" {
		t.Fatalf("regex strip: got %v", kept[0]["phone"])
	}
}

func TestTransform_DateFormat(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeTransform, Op: TransformDateFormat, Field: "d", Args: []string{"2006/01/02", "date"}}}
	kept, _ := NewRulePipeline(rules).Apply([]map[string]any{{"d": "2026/06/24"}})
	if kept[0]["d"] != "2026-06-24" {
		t.Fatalf("date_format: got %v", kept[0]["d"])
	}
}

func TestFilter_Eq(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeFilter, Op: FilterEq, Field: "active", Args: []string{"true"}}}
	kept, dropped := NewRulePipeline(rules).Apply([]map[string]any{{"active": "true"}, {"active": "false"}})
	recsEqual(t, kept, 1)
	if dropped != 1 || kept[0]["active"] != "true" {
		t.Fatalf("eq filter: kept=%v dropped=%d", kept, dropped)
	}
}

func TestFilter_NeAndIn(t *testing.T) {
	ne := []RuleSpec{{Type: RuleTypeFilter, Op: FilterNe, Field: "type", Args: []string{"bot"}}}
	kept, dropped := NewRulePipeline(ne).Apply([]map[string]any{{"type": "human"}, {"type": "bot"}})
	if len(kept) != 1 || dropped != 1 {
		t.Fatalf("ne filter: kept=%v dropped=%d", kept, dropped)
	}
	in := []RuleSpec{{Type: RuleTypeFilter, Op: FilterIn, Field: "dept", Args: []string{"LEGAL", "FIN"}}}
	kept2, dropped2 := NewRulePipeline(in).Apply([]map[string]any{{"dept": "LEGAL"}, {"dept": "HR"}, {"dept": "FIN"}})
	if len(kept2) != 2 || dropped2 != 1 {
		t.Fatalf("in filter: kept=%v dropped=%d", kept2, dropped2)
	}
}

func TestFilter_Exists(t *testing.T) {
	rules := []RuleSpec{{Type: RuleTypeFilter, Op: FilterExists, Field: "email"}}
	kept, dropped := NewRulePipeline(rules).Apply([]map[string]any{{"email": "a@b.c"}, {"email": ""}, {}})
	if len(kept) != 1 || dropped != 2 {
		t.Fatalf("exists filter: kept=%v dropped=%d", kept, dropped)
	}
}

func TestFilter_GtLt(t *testing.T) {
	gt := []RuleSpec{{Type: RuleTypeFilter, Op: FilterGt, Field: "age", Args: []string{"18"}}}
	kept, dropped := NewRulePipeline(gt).Apply([]map[string]any{{"age": "21"}, {"age": "16"}, {"age": "notnum"}})
	if len(kept) != 1 || dropped != 2 {
		t.Fatalf("gt filter: kept=%v dropped=%d", kept, dropped)
	}
	lt := []RuleSpec{{Type: RuleTypeFilter, Op: FilterLt, Field: "n", Args: []string{"100"}}}
	kept2, _ := NewRulePipeline(lt).Apply([]map[string]any{{"n": "50"}, {"n": "150"}})
	if len(kept2) != 1 || kept2[0]["n"] != "50" {
		t.Fatalf("lt filter: kept=%v", kept2)
	}
}

func TestPipeline_TransformThenFilterOrder(t *testing.T) {
	// Transform A->active, then filter active==active keeps only originally-A rows.
	rules := []RuleSpec{
		{Type: RuleTypeTransform, Op: TransformLookup, Field: "status", Args: []string{"A=active", "T=terminated"}},
		{Type: RuleTypeFilter, Op: FilterEq, Field: "status", Args: []string{"active"}},
	}
	kept, dropped := NewRulePipeline(rules).Apply([]map[string]any{{"status": "A"}, {"status": "T"}})
	if len(kept) != 1 || dropped != 1 || kept[0]["status"] != "active" {
		t.Fatalf("ordered pipeline: kept=%v dropped=%d", kept, dropped)
	}
}

func TestParseSyncRules_JSONRoundTrip(t *testing.T) {
	config := map[string]any{
		SyncRulesKey: []any{
			map[string]any{"type": "transform", "op": "default", "field": "dept", "args": []any{"GENERAL"}},
			map[string]any{"type": "filter", "op": "exists", "field": "id"},
			map[string]any{"type": "", "op": "noop"}, // skipped (empty type)
		},
	}
	rules := ParseSyncRules(config)
	if len(rules) != 2 {
		t.Fatalf("expected 2 parsed rules, got %d: %v", len(rules), rules)
	}
	if rules[0].Type != RuleTypeTransform || rules[0].Op != "default" || len(rules[0].Args) != 1 || rules[0].Args[0] != "GENERAL" {
		t.Fatalf("rule[0] mismatch: %+v", rules[0])
	}
	if rules[1].Type != RuleTypeFilter || rules[1].Op != "exists" {
		t.Fatalf("rule[1] mismatch: %+v", rules[1])
	}
}

func TestParseSyncRules_AbsentOrMalformed(t *testing.T) {
	if r := ParseSyncRules(nil); r != nil {
		t.Fatalf("nil config should yield nil rules")
	}
	if r := ParseSyncRules(map[string]any{"sync_rules": "not-an-array"}); r != nil {
		t.Fatalf("malformed sync_rules should yield nil rules")
	}
}

func TestUnknownOp_NoOp(t *testing.T) {
	// Unknown transform op leaves records untouched; unknown filter op keeps all.
	rules := []RuleSpec{
		{Type: RuleTypeTransform, Op: "frobnicate", Field: "a", Args: []string{"x"}},
		{Type: RuleTypeFilter, Op: "weird", Field: "a"},
	}
	kept, dropped := NewRulePipeline(rules).Apply([]map[string]any{{"a": "1"}})
	if len(kept) != 1 || dropped != 0 || kept[0]["a"] != "1" {
		t.Fatalf("unknown ops should be no-ops: kept=%v dropped=%d", kept, dropped)
	}
}
