package rule

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// newTestEngine builds an Engine whose logger writes into the returned buffer so
// tests can assert that conflicts are logged (FR-AUTOMATION-002). The buffer is
// guarded because zerolog may write from the calling goroutine under -race.
func newTestEngine(t *testing.T, opts Options) (*Engine, *syncBuffer) {
	t.Helper()
	buf := &syncBuffer{}
	logger := zerolog.New(buf)
	return NewEngine(logger, opts), buf
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func action(kind string, cfg map[string]any) model.ActionRef {
	return model.ActionRef{Kind: kind, Config: cfg}
}

// kinds extracts the action kinds from a decision in selection order.
func kinds(d Decision) []string {
	out := make([]string, len(d.Actions))
	for i, a := range d.Actions {
		out[i] = a.Kind
	}
	return out
}

func sampleTrigger() FiredTrigger {
	return FiredTrigger{
		TenantID:      "tenant-1",
		AutomationID:  "auto-1",
		SourceEventID: "evt-1",
		Type:          model.TriggerTypeEvent,
		Data: map[string]any{
			"severity":       "critical",
			"severity_score": 9,
			"category":       "phishing",
			"asset": map[string]any{
				"tier":  "gold",
				"owner": "soc",
			},
			"tags": []any{"prod", "external"},
		},
		Variables: map[string]any{
			"region":      "eu-west",
			"auto_remedy": true,
		},
	}
}

// TestEvaluate_TwoMatchingRulesInPriorityOrder is the core FR-AUTOMATION-002
// case: two distinct, both-matching rules produce both actions, ordered by
// priority (lower number first).
func TestEvaluate_TwoMatchingRulesInPriorityOrder(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		// Declared OUT of priority order to prove the engine sorts, not the input.
		{
			ID:        "notify",
			Priority:  20,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "soc"}),
		},
		{
			ID:        "start-wf",
			Priority:  10,
			When:      []model.Condition{{Expr: "trigger.data.severity_score >= 8"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "ir-playbook"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	if got := kinds(dec); !equalStrings(got, []string{model.ActionStartWorkflow, model.ActionNotification}) {
		t.Fatalf("actions in wrong order: got %v want [start_workflow notification]", got)
	}
	if len(dec.Matched) != 2 {
		t.Fatalf("expected 2 matched rules, got %d", len(dec.Matched))
	}
	if dec.Matched[0].RuleID != "start-wf" || dec.Matched[1].RuleID != "notify" {
		t.Fatalf("matched not in priority order: %v", []string{dec.Matched[0].RuleID, dec.Matched[1].RuleID})
	}
	if len(dec.Suppressed) != 0 {
		t.Fatalf("expected no suppressions, got %d", len(dec.Suppressed))
	}
	if !dec.HasActions() {
		t.Fatal("HasActions() should be true")
	}
}

// TestEvaluate_NonMatchingSkipped: a rule whose conditions are false contributes
// no action and is recorded in Skipped.
func TestEvaluate_NonMatchingSkipped(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "match",
			Priority:  1,
			When:      []model.Condition{{Expr: "trigger.data.category == 'phishing'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "soc"}),
		},
		{
			ID:        "no-match",
			Priority:  2,
			When:      []model.Condition{{Expr: "trigger.data.category == 'malware'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "x"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	if got := kinds(dec); !equalStrings(got, []string{model.ActionNotification}) {
		t.Fatalf("expected only notification, got %v", got)
	}
	if len(dec.Skipped) != 1 || dec.Skipped[0].RuleID != "no-match" {
		t.Fatalf("expected 'no-match' skipped, got %+v", dec.Skipped)
	}
}

// TestEvaluate_AllConditionsMustBeTrue: a rule with multiple conditions matches
// only when every condition is true (logical AND across the When slice).
func TestEvaluate_AllConditionsMustBeTrue(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:       "both-true",
			Priority: 1,
			When: []model.Condition{
				{Expr: "trigger.data.severity == 'critical'"},
				{Expr: "trigger.data.severity_score >= 8"},
			},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "a"}),
		},
		{
			ID:       "one-false",
			Priority: 2,
			When: []model.Condition{
				{Expr: "trigger.data.severity == 'critical'"}, // true
				{Expr: "trigger.data.severity_score < 5"},     // false
			},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "x"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	if got := kinds(dec); !equalStrings(got, []string{model.ActionStartWorkflow}) {
		t.Fatalf("expected only the all-true rule's action, got %v", got)
	}
	if len(dec.Skipped) != 1 || dec.Skipped[0].RuleID != "one-false" {
		t.Fatalf("expected 'one-false' skipped, got %+v", dec.Skipped)
	}
}

// TestEvaluate_EmptyWhenAlwaysMatches: a rule with no conditions is a catch-all.
func TestEvaluate_EmptyWhenAlwaysMatches(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "catch-all",
			Priority:  100,
			When:      nil,
			ActionRef: action(model.ActionHTTPCall, map[string]any{"url": "https://svc/notify"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)
	if got := kinds(dec); !equalStrings(got, []string{model.ActionHTTPCall}) {
		t.Fatalf("empty When should always match, got %v", got)
	}
}

// TestEvaluate_DuplicateSuppressed: two matched rules resolving to the IDENTICAL
// action (same kind + config) emit the action once; the second is recorded as a
// duplicate suppression pointing at the first (higher-priority) rule.
func TestEvaluate_DuplicateSuppressed(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	sameCfg := map[string]any{"definition": "ir-playbook", "priority": "high"}
	rules := []model.Rule{
		{
			ID:        "rule-a",
			Priority:  5,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionStartWorkflow, sameCfg),
		},
		{
			ID:       "rule-b",
			Priority: 9,
			When:     []model.Condition{{Expr: "trigger.data.severity_score >= 8"}},
			// Identical action — built independently to prove identity is by
			// VALUE not by pointer/order.
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"priority": "high", "definition": "ir-playbook"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	if got := kinds(dec); !equalStrings(got, []string{model.ActionStartWorkflow}) {
		t.Fatalf("duplicate not suppressed: got %v", got)
	}
	if len(dec.Matched) != 2 {
		t.Fatalf("both rules should match, got %d matched", len(dec.Matched))
	}
	if len(dec.Suppressed) != 1 {
		t.Fatalf("expected 1 suppression, got %d", len(dec.Suppressed))
	}
	s := dec.Suppressed[0]
	if s.Reason != ReasonDuplicate {
		t.Fatalf("expected duplicate reason, got %q", s.Reason)
	}
	if s.RuleID != "rule-b" || s.WinnerRuleID != "rule-a" {
		t.Fatalf("duplicate winner/loser wrong: loser=%q winner=%q", s.RuleID, s.WinnerRuleID)
	}
}

// TestEvaluate_HigherPriorityWinsOnConflict_AndLogged is the explicit conflict
// case: two matched rules resolve to DIFFERENT actions sharing a conflict key
// (the action kind by default). The higher-priority rule's action is selected,
// the lower-priority one is suppressed as a conflict, and the conflict is logged.
func TestEvaluate_HigherPriorityWinsOnConflict_AndLogged(t *testing.T) {
	eng, buf := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "low-prio-loser",
			Priority:  50, // higher number = lower precedence
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "slow-playbook"}),
		},
		{
			ID:        "high-prio-winner",
			Priority:  1, // lower number = higher precedence
			When:      []model.Condition{{Expr: "trigger.data.severity_score >= 8"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "fast-playbook"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	// Only the winner's action is selected.
	if len(dec.Actions) != 1 {
		t.Fatalf("expected exactly 1 action after conflict resolution, got %d: %v", len(dec.Actions), kinds(dec))
	}
	if def, _ := dec.Actions[0].Config["definition"].(string); def != "fast-playbook" {
		t.Fatalf("higher-priority action did not win: got definition=%q", def)
	}
	// The loser is recorded as a conflict suppression.
	if len(dec.Suppressed) != 1 {
		t.Fatalf("expected 1 conflict suppression, got %d", len(dec.Suppressed))
	}
	s := dec.Suppressed[0]
	if s.Reason != ReasonConflict {
		t.Fatalf("expected conflict reason, got %q", s.Reason)
	}
	if s.RuleID != "low-prio-loser" || s.WinnerRuleID != "high-prio-winner" {
		t.Fatalf("conflict winner/loser wrong: loser=%q winner=%q", s.RuleID, s.WinnerRuleID)
	}
	if s.ConflictKey != model.ActionStartWorkflow {
		t.Fatalf("expected conflict key %q, got %q", model.ActionStartWorkflow, s.ConflictKey)
	}

	// The conflict MUST be logged (FR-AUTOMATION-002).
	logs := buf.String()
	if !strings.Contains(logs, "rule conflict") {
		t.Fatalf("conflict was not logged; logs=%s", logs)
	}
	// Verify the log carries the winning and losing rule identities so an
	// operator can see what happened.
	var found bool
	for _, line := range strings.Split(strings.TrimSpace(logs), "\n") {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry["message"] == "rule conflict: higher-priority rule wins, lower-priority action suppressed" {
			if entry["winning_rule_id"] == "high-prio-winner" && entry["losing_rule_id"] == "low-prio-loser" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("conflict log entry missing winner/loser ids; logs=%s", logs)
	}
}

// TestEvaluate_DifferentKindsDoNotConflict: actions of different kinds do not
// share the default conflict key, so both are selected.
func TestEvaluate_DifferentKindsDoNotConflict(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "wf",
			Priority:  1,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "a"}),
		},
		{
			ID:        "notify",
			Priority:  2,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "soc"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)
	if got := kinds(dec); !equalStrings(got, []string{model.ActionStartWorkflow, model.ActionNotification}) {
		t.Fatalf("different kinds should both fire, got %v", got)
	}
	if len(dec.Suppressed) != 0 {
		t.Fatalf("expected no suppressions, got %+v", dec.Suppressed)
	}
}

// TestEvaluate_CustomConflictKey: an automation may scope conflicts more
// finely (e.g. by a config field) so two same-kind actions targeting different
// resources both fire.
func TestEvaluate_CustomConflictKey(t *testing.T) {
	opts := Options{
		ConflictKey: func(a model.ActionRef) string {
			def, _ := a.Config["definition"].(string)
			return a.Kind + ":" + def
		},
	}
	eng, _ := newTestEngine(t, opts)

	rules := []model.Rule{
		{
			ID:        "wf-a",
			Priority:  1,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "playbook-a"}),
		},
		{
			ID:        "wf-b",
			Priority:  2,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "playbook-b"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)
	if len(dec.Actions) != 2 {
		t.Fatalf("custom conflict key should let both fire, got %d: %v", len(dec.Actions), kinds(dec))
	}
}

// TestEvaluate_Tiebreak_StableByIndex: equal-priority rules keep their original
// declaration order, and on a same-kind conflict the FIRST-declared wins.
func TestEvaluate_Tiebreak_StableByIndex(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "first",
			Priority:  5,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "first"}),
		},
		{
			ID:        "second",
			Priority:  5,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "second"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)
	if len(dec.Actions) != 1 {
		t.Fatalf("equal-priority same-kind conflict should leave 1 action, got %d", len(dec.Actions))
	}
	if ch, _ := dec.Actions[0].Config["channel"].(string); ch != "first" {
		t.Fatalf("tie-break should favor first-declared, got channel=%q", ch)
	}
	if len(dec.Suppressed) != 1 || dec.Suppressed[0].RuleID != "second" {
		t.Fatalf("expected 'second' suppressed, got %+v", dec.Suppressed)
	}
}

// TestEvaluate_OperatorVocabulary exercises the real expression.Evaluator across
// the operators the prompt calls out: ==, in, >=, &&, ||, plus !=, and dotted
// nested paths. Each sub-case asserts the rule matches or not as the operator
// dictates — proving the engine wires the DSL, not a reimplementation.
func TestEvaluate_OperatorVocabulary(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})
	tr := sampleTrigger()

	tests := []struct {
		name      string
		expr      string
		wantMatch bool
	}{
		{"eq string", "trigger.data.severity == 'critical'", true},
		{"eq string false", "trigger.data.severity == 'low'", false},
		{"neq", "trigger.data.category != 'malware'", true},
		{"gte int", "trigger.data.severity_score >= 8", true},
		{"gte int boundary false", "trigger.data.severity_score >= 10", false},
		{"in array literal", "trigger.data.severity in ['high', 'critical']", true},
		{"in array literal false", "trigger.data.category in ['malware', 'ransomware']", false},
		{"value in payload array", "'prod' in trigger.data.tags", true},
		{"and both true", "trigger.data.severity == 'critical' && trigger.data.severity_score >= 8", true},
		{"and one false", "trigger.data.severity == 'critical' && trigger.data.severity_score >= 99", false},
		{"or one true", "trigger.data.severity == 'low' || trigger.data.severity_score >= 8", true},
		{"or both false", "trigger.data.severity == 'low' || trigger.data.severity_score >= 99", false},
		{"nested dotted path", "trigger.data.asset.tier == 'gold'", true},
		{"variables path", "variables.region == 'eu-west'", true},
		{"variables bool", "variables.auto_remedy == true", true},
		{"data alias", "data.severity == 'critical'", true},
		{"complex grouped", "(trigger.data.severity == 'critical' || trigger.data.severity == 'high') && trigger.data.severity_score >= 8", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rules := []model.Rule{{
				ID:        "r",
				Priority:  1,
				When:      []model.Condition{{Expr: tt.expr}},
				ActionRef: action(model.ActionNotification, map[string]any{"channel": "x"}),
			}}
			dec := eng.Evaluate(tr, rules)
			gotMatch := len(dec.Actions) == 1
			if gotMatch != tt.wantMatch {
				t.Fatalf("expr %q: match=%v want %v (matched=%d skipped=%d)",
					tt.expr, gotMatch, tt.wantMatch, len(dec.Matched), len(dec.Skipped))
			}
		})
	}
}

// TestEvaluate_BadExpressionTreatedAsNonMatch: a malformed expression (bad path,
// syntax error) must not fire the action and must not abort evaluation of the
// remaining rules. The valid rule after it still fires.
func TestEvaluate_BadExpressionTreatedAsNonMatch(t *testing.T) {
	eng, buf := newTestEngine(t, Options{})

	rules := []model.Rule{
		{
			ID:        "bad-path",
			Priority:  1,
			When:      []model.Condition{{Expr: "trigger.data.does_not_exist == 'x'"}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "a"}),
		},
		{
			ID:        "bad-syntax",
			Priority:  2,
			When:      []model.Condition{{Expr: "trigger.data.severity =="}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "b"}),
		},
		{
			ID:        "empty-cond",
			Priority:  3,
			When:      []model.Condition{{Expr: ""}},
			ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "c"}),
		},
		{
			ID:        "good",
			Priority:  4,
			When:      []model.Condition{{Expr: "trigger.data.severity == 'critical'"}},
			ActionRef: action(model.ActionNotification, map[string]any{"channel": "soc"}),
		},
	}

	dec := eng.Evaluate(sampleTrigger(), rules)

	if got := kinds(dec); !equalStrings(got, []string{model.ActionNotification}) {
		t.Fatalf("only the valid rule should fire, got %v", got)
	}
	// The three broken rules are skipped (not matched, not selected).
	if len(dec.Skipped) != 3 {
		t.Fatalf("expected 3 skipped rules, got %d: %+v", len(dec.Skipped), dec.Skipped)
	}
	// Bad evaluations are logged at warn.
	if !strings.Contains(buf.String(), "failed to evaluate") && !strings.Contains(buf.String(), "non-matching") {
		t.Fatalf("expected warn logs for broken rules; logs=%s", buf.String())
	}
}

// TestEvaluate_NoRules: an automation with no rules selects no actions (and does
// not panic).
func TestEvaluate_NoRules(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})
	dec := eng.Evaluate(sampleTrigger(), nil)
	if dec.HasActions() {
		t.Fatalf("no rules should yield no actions, got %v", kinds(dec))
	}
}

// TestEvaluate_Deterministic: evaluating the same input repeatedly yields an
// identical decision (no map-iteration nondeterminism leaks into the result).
func TestEvaluate_Deterministic(t *testing.T) {
	eng, _ := newTestEngine(t, Options{})
	rules := []model.Rule{
		{ID: "a", Priority: 3, When: []model.Condition{{Expr: "trigger.data.severity == 'critical'"}}, ActionRef: action(model.ActionNotification, map[string]any{"k": "v1"})},
		{ID: "b", Priority: 1, When: nil, ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "d"})},
		{ID: "c", Priority: 2, When: []model.Condition{{Expr: "trigger.data.severity_score >= 8"}}, ActionRef: action(model.ActionHTTPCall, map[string]any{"url": "u"})},
	}
	want := kinds(eng.Evaluate(sampleTrigger(), rules))
	for i := 0; i < 50; i++ {
		got := kinds(eng.Evaluate(sampleTrigger(), rules))
		if !equalStrings(got, want) {
			t.Fatalf("non-deterministic result on iteration %d: got %v want %v", i, got, want)
		}
	}
	// Expected: priority order b(1) start_workflow, c(2) http_call, a(3) notification.
	if !equalStrings(want, []string{model.ActionStartWorkflow, model.ActionHTTPCall, model.ActionNotification}) {
		t.Fatalf("unexpected ordering: %v", want)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// --- FiredTriggerFromEvent ---------------------------------------------------

func TestFiredTriggerFromEvent(t *testing.T) {
	ev, err := events.NewEvent(
		"com.clario360.cyber.alert.raised",
		"clario360/cyber-service",
		"tenant-9",
		map[string]any{"severity": "critical", "score": 9},
	)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}

	ft, err := FiredTriggerFromEvent(ev, "auto-42", map[string]any{"region": "eu"})
	if err != nil {
		t.Fatalf("FiredTriggerFromEvent: %v", err)
	}
	if ft.TenantID != "tenant-9" {
		t.Fatalf("tenant not carried: %q", ft.TenantID)
	}
	if ft.AutomationID != "auto-42" {
		t.Fatalf("automation id not carried: %q", ft.AutomationID)
	}
	if ft.SourceEventID != ev.ID {
		t.Fatalf("source event id should be event id: got %q want %q", ft.SourceEventID, ev.ID)
	}
	if sev, _ := ft.Data["severity"].(string); sev != "critical" {
		t.Fatalf("event data not decoded: %+v", ft.Data)
	}
	if r, _ := ft.Variables["region"].(string); r != "eu" {
		t.Fatalf("variables not carried: %+v", ft.Variables)
	}

	// A trigger built from this event must be evaluable end-to-end.
	eng, _ := newTestEngine(t, Options{})
	rules := []model.Rule{{
		ID:        "r",
		Priority:  1,
		When:      []model.Condition{{Expr: "trigger.data.score >= 8 && variables.region == 'eu'"}},
		ActionRef: action(model.ActionStartWorkflow, map[string]any{"definition": "ir"}),
	}}
	dec := eng.Evaluate(ft, rules)
	if !dec.HasActions() {
		t.Fatalf("event-derived trigger should match the rule")
	}
}

func TestFiredTriggerFromEvent_EmptyData(t *testing.T) {
	ev := &events.Event{ID: "e1", TenantID: "t1", Type: "x"}
	ft, err := FiredTriggerFromEvent(ev, "a1", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ft.Data == nil {
		t.Fatal("Data should be non-nil empty map for an event with no payload")
	}
	if len(ft.Data) != 0 {
		t.Fatalf("Data should be empty, got %+v", ft.Data)
	}
}

func TestFiredTriggerFromEvent_BadJSON(t *testing.T) {
	ev := &events.Event{ID: "e1", TenantID: "t1", Type: "x", Data: []byte("{not json")}
	if _, err := FiredTriggerFromEvent(ev, "a1", nil); err == nil {
		t.Fatal("expected error for malformed event data JSON")
	}
}
