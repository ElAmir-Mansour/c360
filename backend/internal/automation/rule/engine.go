// Package rule implements the Automation rule engine (DESIGN_Workflow_Forms_
// Automation.md §4.4, FR-AUTOMATION-002).
//
// A fired trigger (event/schedule/threshold/manual/webhook) carries a payload.
// The engine takes that payload plus the automation's []model.Rule and decides
// which action(s) to run:
//
//   - Each rule's When []model.Condition is evaluated by REUSING the workflow
//     expression DSL (internal/workflow/expression.Evaluator) — the same boolean
//     grammar (== != < > >= <= && || ! in [...], dotted paths) the workflow
//     transition conditions use. A rule matches when ALL of its conditions are
//     true (an empty When always matches), exactly as model.Rule documents.
//   - Rules are evaluated in PRIORITY order. Lower Priority number = higher
//     precedence (the convention the model documents and the orchestrator obeys).
//     Ties break deterministically by rule index so the result never depends on
//     map iteration or slice order churn.
//   - Duplicate selected actions are SUPPRESSED: if two matched rules resolve to
//     the same action (same kind + same config), the action is emitted once.
//   - On CONFLICT — two matched rules that resolve to a *different* action for
//     the same conflict key (by default the action kind) — the HIGHER-priority
//     rule wins and the loser is logged and dropped. Override the conflict key
//     per automation via Options.ConflictKey.
//
// The engine is pure and deterministic: given the same trigger payload and the
// same rules it always returns the same decision. It performs no I/O, holds no
// mutable state across calls, and is safe for concurrent use.
package rule

import (
	"sort"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/workflow/expression"
)

// FiredTrigger is the resolved occurrence of an automation trigger. It is built
// by the trigger sources (WP-9) from a bus event, a cron tick, a threshold
// breach, a manual invoke, or an inbound webhook, and handed to the engine to
// decide what to run. Data is the trigger payload (an event's decoded data, the
// webhook body, the manual invoke body, …); Variables are automation-scoped
// values an author may reference alongside the trigger payload.
type FiredTrigger struct {
	// TenantID scopes the occurrence; carried through to the run for RLS.
	TenantID string
	// AutomationID is the automation whose rules are being evaluated.
	AutomationID string
	// SourceEventID is the stable identity used for exactly-once dedupe (§4.3);
	// the engine does not enforce dedupe itself but threads the id into the
	// decision so callers and logs can correlate.
	SourceEventID string
	// Type is the trigger type (model.TriggerType*), recorded for logging.
	Type string
	// Data is the trigger payload exposed to rules as `trigger.data.<path>`.
	Data map[string]any
	// Variables are exposed to rules as `variables.<path>`.
	Variables map[string]any
}

// MatchedRule records one rule that matched the trigger, in evaluation order.
type MatchedRule struct {
	// RuleID is model.Rule.ID (may be empty for inline rules).
	RuleID string
	// Priority is the rule's declared priority (lower = higher precedence).
	Priority int
	// Index is the rule's original position in the input slice (the tie-break).
	Index int
	// Action is the rule's resolved action.
	Action model.ActionRef
}

// SuppressedRule records a rule that matched but whose action was NOT selected,
// with the reason — for audit (Cutover "immutable audit") and operator insight.
type SuppressedRule struct {
	MatchedRule
	// Reason is one of ReasonDuplicate or ReasonConflict.
	Reason string
	// WinnerRuleID is the rule whose action was selected instead (for conflict)
	// or the rule whose identical action was already selected (for duplicate).
	WinnerRuleID string
	// ConflictKey is the key on which a conflict was detected (conflict only).
	ConflictKey string
}

// Suppression reasons.
const (
	// ReasonDuplicate: an identical action (same kind + config) was already
	// selected by an equal-or-higher-priority rule, so this one is collapsed.
	ReasonDuplicate = "duplicate"
	// ReasonConflict: a different action shares this rule's conflict key and a
	// higher-priority rule already claimed it, so this one loses.
	ReasonConflict = "conflict"
)

// Decision is the full, auditable result of evaluating an automation's rules
// against one fired trigger.
type Decision struct {
	// Actions are the actions to run, in winning order (highest precedence
	// first), duplicates suppressed and conflicts resolved.
	Actions []model.ActionRef
	// Matched lists every rule that matched, in evaluation (priority) order —
	// including those whose action was later suppressed.
	Matched []MatchedRule
	// Suppressed lists matched rules whose action was dropped, with the reason.
	Suppressed []SuppressedRule
	// Skipped lists rules that did NOT match (all conditions evaluated, none-or-
	// some false), in evaluation order, for debuggability.
	Skipped []MatchedRule
}

// HasActions reports whether the decision selected at least one action to run.
func (d Decision) HasActions() bool { return len(d.Actions) > 0 }

// Options tunes conflict resolution. The zero value is valid (conflict key =
// action kind, the §4.4 default).
type Options struct {
	// ConflictKey maps a resolved action to the key on which two *different*
	// actions are considered to conflict (same key, different action → the
	// higher-priority rule wins). Default: the action Kind. Returning a unique
	// key per action (e.g. its ID) effectively disables conflict resolution and
	// keeps only duplicate suppression.
	ConflictKey func(model.ActionRef) string
}

// Engine evaluates automation rules. It is stateless and safe for concurrent
// use; construct one per process and share it.
type Engine struct {
	evaluator *expression.Evaluator
	logger    zerolog.Logger
	opts      Options
}

// NewEngine constructs a rule engine. The logger is used to record conflicts
// (FR-AUTOMATION-002 requires conflicts be logged); pass zerolog.Nop() in tests
// that do not assert on logs.
func NewEngine(logger zerolog.Logger, opts Options) *Engine {
	if opts.ConflictKey == nil {
		opts.ConflictKey = defaultConflictKey
	}
	return &Engine{
		evaluator: expression.NewEvaluator(),
		logger:    logger.With().Str("component", "automation-rule-engine").Logger(),
		opts:      opts,
	}
}

// defaultConflictKey treats two actions as conflicting when they share an action
// kind (§4.4: "on conflict higher priority wins"). Two start_workflow actions
// with different configs conflict; a start_workflow and a notification do not.
func defaultConflictKey(a model.ActionRef) string { return a.Kind }

// Evaluate runs the priority-ordered rule evaluation for one fired trigger and
// returns the selected actions plus a full audit trail.
//
// Algorithm (deterministic):
//  1. Sort a copy of rules by (Priority asc, original index asc) — stable.
//  2. Build the expression context once: {trigger:{data:…}, data:…, variables:…}.
//  3. For each rule in order, evaluate ALL its conditions via the real
//     expression.Evaluator. A condition that errors (bad path / bad expr) is
//     treated as false and logged at warn — a malformed rule must not fire an
//     action, and must not abort evaluation of the remaining rules.
//  4. A matched rule's action is selected unless: an identical action was
//     already selected (ReasonDuplicate) or a different action with the same
//     conflict key was already selected by a higher-priority rule
//     (ReasonConflict). Conflicts are logged.
func (e *Engine) Evaluate(t FiredTrigger, rules []model.Rule) Decision {
	ctx := BuildContext(t)

	ordered := orderRules(rules)

	dec := Decision{}
	// selected tracks duplicate suppression by exact action identity.
	selectedActions := make(map[string]MatchedRule)
	// claimed tracks conflict resolution by conflict key → the winning rule.
	claimedKeys := make(map[string]MatchedRule)

	for _, mr := range ordered {
		matched, err := e.ruleMatches(t, rules, mr.Index, ctx)
		if err != nil {
			// Conditions already individually handled; this only fires for a
			// rule with an unrecoverable structural problem (kept defensive).
			e.logger.Warn().
				Str("tenant_id", t.TenantID).
				Str("automation_id", t.AutomationID).
				Str("rule_id", mr.RuleID).
				Err(err).
				Msg("rule evaluation error, treating rule as non-matching")
			dec.Skipped = append(dec.Skipped, mr)
			continue
		}
		if !matched {
			dec.Skipped = append(dec.Skipped, mr)
			continue
		}

		dec.Matched = append(dec.Matched, mr)

		// Duplicate suppression: same kind + same config already selected.
		actKey := actionIdentity(mr.Action)
		if winner, dup := selectedActions[actKey]; dup {
			dec.Suppressed = append(dec.Suppressed, SuppressedRule{
				MatchedRule:  mr,
				Reason:       ReasonDuplicate,
				WinnerRuleID: winner.RuleID,
			})
			continue
		}

		// Conflict resolution: a *different* action with the same conflict key
		// was already claimed by a higher-priority rule — that rule wins.
		ck := e.opts.ConflictKey(mr.Action)
		if winner, claimed := claimedKeys[ck]; claimed {
			e.logger.Info().
				Str("tenant_id", t.TenantID).
				Str("automation_id", t.AutomationID).
				Str("conflict_key", ck).
				Str("winning_rule_id", winner.RuleID).
				Int("winning_priority", winner.Priority).
				Str("losing_rule_id", mr.RuleID).
				Int("losing_priority", mr.Priority).
				Str("winning_action", winner.Action.Kind).
				Str("losing_action", mr.Action.Kind).
				Msg("rule conflict: higher-priority rule wins, lower-priority action suppressed")
			dec.Suppressed = append(dec.Suppressed, SuppressedRule{
				MatchedRule:  mr,
				Reason:       ReasonConflict,
				WinnerRuleID: winner.RuleID,
				ConflictKey:  ck,
			})
			continue
		}

		// Selected.
		selectedActions[actKey] = mr
		claimedKeys[ck] = mr
		dec.Actions = append(dec.Actions, mr.Action)
	}

	return dec
}

// ruleMatches evaluates every condition of the rule at index i. ALL conditions
// must be true for the rule to match (an empty When always matches). A condition
// whose evaluation errors is treated as false (logged at warn) — a broken rule
// must never silently fire and must never poison sibling rules.
func (e *Engine) ruleMatches(t FiredTrigger, rules []model.Rule, i int, ctx map[string]any) (bool, error) {
	r := rules[i]
	if len(r.When) == 0 {
		return true, nil
	}
	for ci, cond := range r.When {
		if cond.Expr == "" {
			// An explicit empty condition can never be true (the Evaluator
			// rejects an empty expression); a rule that lists a blank condition
			// is misconfigured and must not match.
			e.logger.Warn().
				Str("tenant_id", t.TenantID).
				Str("automation_id", t.AutomationID).
				Str("rule_id", r.ID).
				Int("condition_index", ci).
				Msg("rule condition is empty, treating rule as non-matching")
			return false, nil
		}
		ok, err := e.evaluator.Evaluate(cond.Expr, ctx)
		if err != nil {
			e.logger.Warn().
				Str("tenant_id", t.TenantID).
				Str("automation_id", t.AutomationID).
				Str("rule_id", r.ID).
				Int("condition_index", ci).
				Str("condition", cond.Expr).
				Err(err).
				Msg("rule condition failed to evaluate, treating rule as non-matching")
			return false, nil
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

// orderRules returns the rules as MatchedRule descriptors sorted by ascending
// Priority, ties broken by ascending original index. The original slice is not
// mutated; the index is preserved so callers can map a result back to input.
func orderRules(rules []model.Rule) []MatchedRule {
	out := make([]MatchedRule, len(rules))
	for i, r := range rules {
		out[i] = MatchedRule{
			RuleID:   r.ID,
			Priority: r.Priority,
			Index:    i,
			Action:   r.ActionRef,
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Priority != out[b].Priority {
			return out[a].Priority < out[b].Priority
		}
		return out[a].Index < out[b].Index
	})
	return out
}
